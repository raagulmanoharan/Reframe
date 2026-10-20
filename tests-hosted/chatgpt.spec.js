import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const scene = JSON.parse(readFileSync(new URL('../tests/fixtures/scene.json', import.meta.url)));

test('mobile ChatGPT sign-in, camera capture and asynchronous photo generation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let signedIn = false, photoInput, sceneInput, photo;
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth') return route.fulfill({ json: { state: signedIn ? 'signedIn' : 'signedOut' } });
    if (path === '/api/auth/start') return route.fulfill({ json: { verificationUrl: 'https://auth.openai.com/codex/device', userCode: 'TEST-CODE' } });
    if (path === '/api/scene') { sceneInput = route.request().postDataJSON(); return route.fulfill({ status: 202, json: { jobId: 'scene-job' } }); }
    if (path === '/api/jobs/scene-job') return route.fulfill({ json: { result: { scene } } });
    if (path === '/api/photo') { photoInput = route.request().postDataJSON(); return route.fulfill({ status: 202, json: { jobId: 'photo-job' } }); }
    if (path === '/api/jobs/photo-job') return route.fulfill({ json: { result: { image: photo } } });
    if (path === '/api/auth/logout') { signedIn = false; return route.fulfill({ json: { ok: true } }); }
    throw new Error(`Unexpected path ${path}`);
  });
  await page.goto('/');
  await page.locator('#prompt').fill('An observatory with an antenna on the moon');
  await page.locator('#build').click();
  await expect(page.locator('#access-dialog')).toBeVisible();
  await expect(page.locator('#access-code')).toHaveCount(0);
  await page.getByRole('button', { name: 'Sign in with ChatGPT', exact: true }).click();
  await expect(page.locator('#device-code')).toHaveText('TEST-CODE');
  await expect(page.locator('#device-link')).toHaveAttribute('href', 'https://auth.openai.com/codex/device');
  await page.screenshot({ path: '/tmp/reframe-chatgpt-mobile-login.png', fullPage: true });
  signedIn = true;
  await expect(page.locator('#scene-name')).toHaveText('Orbital observatory', { timeout: 10000 });
  expect(sceneInput.prompt).toContain('observatory');
  await page.locator('#capture').click();
  photo = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = c.height = 32;
    c.getContext('2d').fillRect(0, 0, 32, 32); return c.toDataURL('image/png');
  });
  await page.locator('#render').click();
  await expect(page.getByAltText('AI photograph 1')).toBeVisible();
  expect(photoInput.composition).toMatch(/^data:image\/jpeg;base64,/);
  expect(photoInput.prompt).toBe(sceneInput.prompt);
  const download = page.waitForEvent('download'); await page.locator('#generate').click();
  expect((await download).suggestedFilename()).toBe('reframe-photo-1.png');
  await page.locator('#access-settings').click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign in with ChatGPT', exact: true })).toBeVisible();
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('failed sign-in and cancelled generation never create a fake scene', async ({ page }) => {
  await page.route('**/api/auth', route => route.fulfill({ json: { state: 'signedOut' } }));
  await page.route('**/api/auth/start', route => route.fulfill({ status: 503, json: { error: 'ChatGPT sign-in is unavailable.' } }));
  await page.goto('/'); await page.locator('#build').click();
  await page.locator('#chatgpt-login').click();
  await expect(page.locator('#login-status')).toHaveText('ChatGPT sign-in is unavailable.');
  await expect(page.locator('#chatgpt-login')).toBeEnabled();
  await page.locator('#cancel-access').click();
  await expect(page.locator('#error')).toHaveText('Generation cancelled.');
  await expect(page.locator('#capture')).toBeDisabled();
  await expect(page.locator('#scene-empty')).toBeVisible();
});
