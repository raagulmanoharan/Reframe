import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const scene = JSON.parse(readFileSync(new URL('../tests/fixtures/scene.json', import.meta.url)));
test('ChatGPT sign-in comes first, then image-only brief, studio, notes and generated image', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let signedIn = false, photoInput, sceneInput, png; const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth') return route.fulfill({ json: { state: signedIn ? 'signedIn' : 'signedOut' } });
    if (path === '/api/auth/start') return route.fulfill({ json: { verificationUrl: 'https://auth.openai.com/codex/device', userCode: 'TEST-CODE' } });
    if (path === '/api/scene') { sceneInput = route.request().postDataJSON(); return route.fulfill({ status: 202, json: { jobId: 'scene-job' } }); }
    if (path === '/api/jobs/scene-job') return route.fulfill({ json: { result: { scene } } });
    if (path === '/api/photo') { photoInput = route.request().postDataJSON(); return route.fulfill({ status: 202, json: { jobId: 'photo-job' } }); }
    if (path === '/api/jobs/photo-job') return route.fulfill({ json: { result: { image: png } } });
    if (path === '/api/auth/logout') { signedIn = false; return route.fulfill({ json: { ok: true } }); }
    throw new Error(`Unexpected path ${path}`);
  });
  await page.goto('/'); await expect(page.locator('#welcome')).toBeVisible(); await expect(page.locator('#conversation')).toBeHidden();
  await page.screenshot({ path: '/tmp/reframe-welcome-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Continue with ChatGPT', exact: true }).click();
  await expect(page.locator('#device-code')).toHaveText('TEST-CODE');
  await expect(page.locator('#device-link')).toHaveAttribute('href', 'https://auth.openai.com/codex/device');
  signedIn = true; await expect(page.locator('#conversation')).toBeVisible(); await expect(page.locator('#access-dialog')).toBeHidden();
  png = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64; canvas.getContext('2d').fillRect(0, 0, 64, 64); return canvas.toDataURL('image/png'); });
  await page.locator('#reference').setInputFiles({ name: 'reference.png', mimeType: 'image/png', buffer: Buffer.from(png.split(',')[1], 'base64') });
  await expect(page.locator('#upload-title')).toHaveText('reference.png');
  await page.locator('#build').click(); await expect(page.locator('#card-title')).toHaveText(scene.title);
  expect(sceneInput.prompt).toContain('reference image'); expect(sceneInput.reference).toMatch(/^data:image\/jpeg/);
  await expect(page.locator('#studio-panel')).toBeHidden(); await page.locator('#enter-studio').click();
  await page.locator('#annotate').click(); await page.locator('#frame-note').fill('Keep the metallic finish.'); await page.locator('#close-notes').click();
  await page.locator('#capture').click(); await page.locator('#render').click();
  await expect(page.getByAltText('AI photograph 1')).toBeVisible();
  expect(photoInput.notes).toBe('Keep the metallic finish.'); expect(photoInput.composition).toMatch(/^data:image\/jpeg;base64,/); expect(photoInput.reference).toBe(sceneInput.reference);
  const download = page.waitForEvent('download'); await page.getByRole('link', { name: 'Download photograph 1', exact: true }).click(); expect((await download).suggestedFilename()).toBe('reframe-photo-1.png');
  await page.locator('#access-settings').click(); await page.getByRole('button', { name: 'Sign out', exact: true }).click(); await expect(page.locator('#welcome')).toBeVisible();
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]); expect(errors).toEqual([]);
});
test('failed device sign-in stays on the welcome screen with an actionable error', async ({ page }) => {
  await page.route('**/api/auth', route => route.fulfill({ json: { state: 'signedOut' } }));
  await page.route('**/api/auth/start', route => route.fulfill({ status: 503, json: { error: 'ChatGPT sign-in is unavailable.' } }));
  await page.goto('/'); await page.locator('#welcome-login').click();
  await expect(page.locator('#login-status')).toHaveText('ChatGPT sign-in is unavailable.'); await expect(page.locator('#chatgpt-login')).toBeEnabled();
  await page.locator('#cancel-access').click(); await expect(page.locator('#welcome-login')).toBeEnabled(); await expect(page.locator('#conversation')).toBeHidden();
});
