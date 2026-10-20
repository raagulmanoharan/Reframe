import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const scene = JSON.parse(readFileSync(new URL('./fixtures/scene.json', import.meta.url)));
async function enterKey(page) { await expect(page.locator('#access-dialog')).toBeVisible(); await page.locator('#access-code').fill('test-only-not-a-real-key'); await page.getByRole('button', { name: 'Continue', exact: true }).click(); }
for (const mobile of [false, true]) test(`AI workflow using explicit provider fixtures: ${mobile ? 'mobile' : 'desktop'}`, async ({ page }) => {
  await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
  const errors = [], requests = []; page.on('pageerror', e => errors.push(e.message));
  await page.route('https://api.openai.com/v1/chat/completions', async route => {
    const body = route.request().postDataJSON(); requests.push(body);
    await route.fulfill({ json: { choices: [{ message: { content: JSON.stringify(scene) } }] } });
  });
  await page.goto('/'); await expect(page.locator('canvas')).toBeVisible(); await expect(page.locator('#capture')).toBeDisabled();
  await page.getByRole('button', { name: 'Jewellery', exact: true }).click();
  await expect(page.locator('#capture')).toBeDisabled(); expect(requests).toHaveLength(0);
  const reference = Buffer.from(await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 64; c.height = 64; const ctx = c.getContext('2d'); ctx.fillStyle = '#aabbcc'; ctx.fillRect(0, 0, 64, 64); return c.toDataURL('image/png').split(',')[1]; }), 'base64');
  await page.locator('#reference').setInputFiles({ name: 'reference.png', mimeType: 'image/png', buffer: reference });
  await expect(page.locator('#upload-title')).toHaveText('reference.png');
  await page.locator('#prompt').fill('An observatory on the moon with a telescope and antenna');
  await page.locator('#build').click(); await enterKey(page);
  await expect(page.locator('#scene-name')).toHaveText('Orbital observatory');
  expect(requests[0].messages[1].content[1].image_url.url).toMatch(/^data:image\/jpeg/);
  await page.locator('#capture').click(); const first = await page.locator('.shot-image img').getAttribute('src'); expect(first.length).toBeGreaterThan(10000);
  const bounds = await page.locator('canvas').boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width / 2 + 65, bounds.y + bounds.height / 2 + 20, { steps: 10 }); await page.mouse.up(); await page.waitForTimeout(400);
  await page.locator('#ratio').selectOption('9:16'); await page.locator('#capture').click();
  const second = page.locator('.shot-image img').last(); expect(await second.getAttribute('src')).not.toEqual(first);
  const dimensions = await second.evaluate(img => [img.naturalWidth, img.naturalHeight]); expect(dimensions[0] / dimensions[1]).toBeCloseTo(9 / 16, 2);
  // Editing the next brief/reference must not change the input for an existing shot.
  await page.locator('#prompt').fill('A completely different next scene'); await page.locator('#remove-reference').click();
  await page.getByRole('checkbox', { name: 'Select shot 2', exact: true }).uncheck();
  let renderBody = '';
  await page.route('https://api.openai.com/v1/images/edits', async route => {
    renderBody = route.request().postData();
    await route.fulfill({ json: { data: [{ b64_json: first.split(',')[1] }] } });
  });
  await page.locator('#render').click(); await expect(page.getByAltText('AI photograph 1')).toBeVisible();
  expect(renderBody).toContain('An observatory on the moon'); expect(renderBody).not.toContain('A completely different next scene'); expect(renderBody).toContain('reference.jpeg'); expect(renderBody).toContain('composition.jpeg');
  await page.getByRole('button', { name: 'Restore shot 1', exact: true }).click(); await expect(page.locator('#photo-dialog')).toBeVisible(); await page.locator('#close-photo').click();
  const download = page.waitForEvent('download'); await page.locator('#generate').click(); expect((await download).suggestedFilename()).toBe('reframe-photo-1.jpg');
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  expect(await page.locator('#access-code').inputValue()).toBe('');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); expect(errors).toEqual([]);
  await page.screenshot({ path: `/tmp/reframe-ai-${mobile ? 'mobile' : 'desktop'}.png`, fullPage: true });
  await page.reload(); await page.locator('#build').click(); await expect(page.locator('#access-dialog')).toBeVisible(); await page.locator('#cancel-access').click();
  await expect(page.locator('#capture')).toBeDisabled(); await expect(page.locator('#error')).toContainText('cancelled');
});
test('provider failure leaves an honest error and no fake scene', async ({ page }) => {
  await page.route('https://api.openai.com/v1/chat/completions', route => route.fulfill({ status: 401, json: { error: { message: 'bad key' } } }));
  await page.goto('/'); await page.locator('#build').click(); await enterKey(page);
  await expect(page.locator('#error')).toContainText('key was not accepted'); await expect(page.locator('#capture')).toBeDisabled(); await expect(page.locator('#scene-empty')).toBeVisible();
  await page.locator('#build').click(); await expect(page.locator('#access-dialog')).toBeVisible();
});
