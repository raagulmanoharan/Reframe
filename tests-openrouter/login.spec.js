import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const scene = JSON.parse(readFileSync(new URL('../tests/fixtures/scene.json', import.meta.url)));
const model = { id: 'fixture/vision:free', pricing: { prompt: '0', completion: '0' }, architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] }, supported_parameters: ['structured_outputs'] };
async function mockCatalog(context) {
  await context.route('https://openrouter.ai/api/v1/models', route => route.fulfill({ json: { data: [model] } }));
  await context.route(/^https:\/\/openrouter\.ai\/auth\?/, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Fixture OpenRouter authorization</title><p>Authorize Reframe</p>' }));
}
async function openLogin(page) {
  const popupEvent = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Continue with OpenRouter' }).click();
  const popup = await popupEvent; await popup.waitForURL(/^https:\/\/openrouter\.ai\/auth\?/); return popup;
}
test('PKCE sign-in resumes a pending scene, exchanges once, preserves draft state and stores no key', async ({ page, context }) => {
  await mockCatalog(context); let authorization, exchanges = 0, requests = 0;
  await context.route('https://openrouter.ai/api/v1/auth/keys', route => {
    exchanges++; const body = route.request().postDataJSON();
    expect(body.code).toBe('fixture-one-time-code'); expect(body.code_challenge_method).toBe('S256');
    expect(createHash('sha256').update(body.code_verifier).digest('base64url')).toBe(authorization.searchParams.get('code_challenge'));
    expect(route.request().headers().authorization).toBeUndefined();
    return route.fulfill({ json: { key: 'sk-or-v1-fixture-login-key', user_id: 'fixture-user' } });
  });
  await context.route('https://openrouter.ai/api/v1/chat/completions', route => {
    requests++; expect(route.request().headers().authorization).toBe('Bearer sk-or-v1-fixture-login-key');
    expect(route.request().postDataJSON().messages[1].content[0].text).toBe('A moon observatory');
    return route.fulfill({ json: { choices: [{ message: { content: JSON.stringify(scene) } }] } });
  });
  await page.goto('/'); await page.locator('#prompt').fill('A moon observatory'); await page.locator('#build').click();
  const popup = await openLogin(page); authorization = new URL(popup.url());
  expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
  const callback = new URL(authorization.searchParams.get('callback_url'));
  expect(callback.origin).toBe('http://127.0.0.1:5175'); expect(callback.pathname).toBe('/auth.html');
  const state = callback.searchParams.get('state'); expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
  // A same-origin message from the wrong window must not initiate an exchange.
  await page.evaluate(state => window.postMessage({ type: 'reframe-openrouter-callback', state, code: 'injected' }, location.origin), state);
  expect(exchanges).toBe(0);
  callback.searchParams.set('code', 'fixture-one-time-code');
  await popup.goto(callback.href).catch(e => { if (!popup.isClosed()) throw e; });
  await expect(page.locator('#enter-studio')).toBeVisible(); await expect(page.locator('#access-dialog')).toBeHidden();
  expect(exchanges).toBe(1); expect(requests).toBe(1);
  await expect(page.locator('.user-message').first()).toContainText('A moon observatory');
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  await page.locator('#access-settings').click(); await expect(page.locator('#openrouter-login-status')).toHaveText('Connected to OpenRouter for this tab.');
  await page.locator('#openrouter-disconnect').click(); await expect(page.locator('#openrouter-sign-in')).toBeVisible();
  await page.locator('#cancel-access').click(); await expect(page.locator('#enter-studio')).toBeVisible();
});
test('wrong state is ignored; closing the dialog cancels sign-in and does not exchange a code', async ({ page, context }) => {
  await mockCatalog(context); let exchanges = 0;
  await context.route('https://openrouter.ai/api/v1/auth/keys', route => { exchanges++; return route.fulfill({ status: 400, json: {} }); });
  await page.goto('/'); await page.locator('#access-settings').click(); const popup = await openLogin(page);
  const callback = new URL(new URL(popup.url()).searchParams.get('callback_url'));
  callback.searchParams.set('state', 'x'.repeat(43)); callback.searchParams.set('code', 'wrong-state-code'); await popup.goto(callback.href);
  await expect(popup).toHaveURL('http://127.0.0.1:5175/auth.html');
  await expect(page.locator('#openrouter-sign-in')).toBeDisabled();
  await page.locator('#cancel-access').click(); await expect(page.locator('#access-dialog')).toBeHidden();
  expect(exchanges).toBe(0);
  await page.locator('#access-settings').click(); await expect(page.locator('#openrouter-sign-in')).toBeEnabled();
});
test('blocked popup and declined authorization leave a retryable sign-in', async ({ page, context }) => {
  await mockCatalog(context);
  await page.goto('/'); await page.locator('#access-settings').click();
  await page.evaluate(() => { window.originalOpen = window.open; window.open = () => null; });
  await page.locator('#openrouter-sign-in').click(); await expect(page.locator('#openrouter-login-status')).toContainText('Allow the sign-in window');
  await page.evaluate(() => { window.open = window.originalOpen; });
  const popup = await openLogin(page);
  const callback = new URL(new URL(popup.url()).searchParams.get('callback_url')); callback.searchParams.set('error', 'access_denied');
  await popup.goto(callback.href).catch(e => { if (!popup.isClosed()) throw e; });
  await expect(page.locator('#openrouter-login-status')).toContainText('cancelled or declined'); await expect(page.locator('#openrouter-sign-in')).toBeEnabled();
});
test('sign-in survives an isolated popup without window.opener and keeps the unsent draft', async ({ page, context }) => {
  await mockCatalog(context);
  await context.route('https://openrouter.ai/api/v1/auth/keys', route => route.fulfill({ json: { key: 'sk-or-v1-fixture-isolated-key' } }));
  await page.goto('/'); await page.locator('#prompt').fill('My unsent scene');
  await page.locator('#access-settings').click(); const popup = await openLogin(page);
  const callback = new URL(new URL(popup.url()).searchParams.get('callback_url')); callback.searchParams.set('code', 'isolated-code');
  await popup.evaluate(() => { window.opener = null; });
  await popup.goto(callback.href).catch(e => { if (!popup.isClosed()) throw e; });
  await expect(page.locator('#access-dialog')).toBeHidden(); await expect(page.locator('#prompt')).toHaveValue('My unsent scene');
  await page.locator('#access-settings').click(); await expect(page.locator('#openrouter-disconnect')).toBeVisible();
});
