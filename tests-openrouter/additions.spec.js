import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const scene = JSON.parse(readFileSync(new URL('../tests/fixtures/scene.json', import.meta.url)));
const model = { id: 'fixture/layout:free', pricing: { prompt: '0', completion: '0' }, architecture: { input_modalities: ['text'], output_modalities: ['text'] }, supported_parameters: ['structured_outputs'] };
const lamp = { ...scene, objects: [
  { ...scene.objects[0], group: 'Lamp', name: 'Stem', position: [0, 1, 0], size: [0.1, 2, 0.1] },
  { ...scene.objects[1], group: 'Lamp', name: 'Shade', position: [0, 2, 0], size: [0.8, 0.5, 0.8] },
] };
async function openStudio(page) {
  await page.goto('/'); await page.locator('#prompt').fill('An observatory'); await page.locator('#build').click();
  await page.getByText('Use an API key instead', { exact: true }).click();
  await page.locator('#access-code').fill('fixture-key'); await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.locator('#enter-studio').click();
}
async function add(page, description = 'A brass floor lamp') {
  await page.locator('#add-element').click(); await page.locator('#element-description').fill(description);
  await page.getByRole('button', { name: 'Place node', exact: true }).click();
}
test('a placed, resized node regenerates in the studio, keeps captured frames and survives reopening', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const requests = [], errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.route('https://openrouter.ai/api/v1/models', route => route.fulfill({ json: { data: [model] } }));
  await page.route('https://openrouter.ai/api/v1/chat/completions', route => {
    const body = route.request().postDataJSON(); requests.push(body);
    expect(body.provider.max_price).toEqual({ prompt: '0', completion: '0', image: '0', request: '0' });
    return route.fulfill({ json: { choices: [{ message: { content: JSON.stringify(requests.length === 1 ? scene : lamp) } }] } });
  });
  await openStudio(page);
  await expect(page.locator('#move-mode, #camera-mode')).toHaveCount(0);
  await page.locator('#capture').click(); const original = await page.locator('.frame-image img').getAttribute('src');
  await add(page);
  await expect(page.locator('#addition-controls')).toBeVisible(); await expect(page.locator('#capture')).toBeDisabled();
  await expect(page.locator('#object-select option')).toHaveText(['Select an object', 'Observatory', 'Boulder', 'Antenna', 'A brass floor lamp']);
  await page.locator('#object-scale').evaluate(el => { el.value = '1.5'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.locator('#object-height').evaluate(el => { el.value = '2'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.screenshot({ path: '/tmp/reframe-node-mobile.png' });
  await page.locator('#exit-studio').click(); await page.locator('#enter-studio').click();
  await expect(page.locator('#addition-controls')).toBeVisible();
  await page.locator('#regenerate').click(); await expect(page.locator('#addition-controls')).toBeHidden();
  await expect(page.locator('#studio-panel')).toBeVisible(); await expect(page.locator('#studio-error')).toBeHidden();
  expect(requests).toHaveLength(2);
  expect(requests[1].messages[1].content[0].text).toContain('ONLY one new object: A brass floor lamp');
  expect(requests[1].messages[1].content[0].text).toContain('2.25 × 2.25 × 2.25');
  expect(await page.locator('.frame-image img').getAttribute('src')).toBe(original);
  await expect(page.locator('#object-select option')).toHaveCount(5);
  await page.locator('#capture').click(); expect(await page.locator('.frame-image img').nth(1).getAttribute('src')).not.toBe(original);
  await page.locator('#exit-studio').click(); await page.locator('#enter-studio').click();
  await expect(page.locator('#object-select option')).toHaveCount(5); await expect(page.locator('#shot-count')).toHaveText('2 / 4 frames');
  await page.getByRole('button', { name: 'Restore frame 1', exact: true }).click();
  await expect(page.locator('#object-select option')).toHaveCount(4);
  await page.getByRole('button', { name: 'Restore frame 2', exact: true }).click();
  await expect(page.locator('#object-select option')).toHaveCount(5);
  await page.screenshot({ path: '/tmp/reframe-added-mobile.png' });
  expect(errors).toEqual([]);
});
test('regeneration failure and Stop preserve the placeholder; removing it restores the existing composition', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  let calls = 0, slow = false;
  await page.route('https://openrouter.ai/api/v1/models', route => route.fulfill({ json: { data: [model] } }));
  await page.route('https://openrouter.ai/api/v1/chat/completions', route => {
    calls++; if (slow) return;
    return route.fulfill(calls === 1 ? { json: { choices: [{ message: { content: JSON.stringify(scene) } }] } } : { status: 429, json: { error: { code: 429 } } });
  });
  await openStudio(page); await page.locator('#capture').click();
  const original = await page.locator('.frame-image img').getAttribute('src');
  await add(page); await page.locator('#regenerate').click();
  await expect(page.locator('#studio-error')).toContainText('free-model limit');
  await expect(page.locator('#addition-controls')).toBeVisible(); await expect(page.locator('#regenerate')).toBeEnabled();
  slow = true; await page.locator('#regenerate').click(); await expect(page.locator('#regenerate')).toBeDisabled();
  await page.getByRole('button', { name: 'Stop regeneration', exact: true }).click();
  await expect(page.locator('#studio-error')).toContainText('Regeneration stopped');
  await expect(page.locator('#regenerate')).toBeEnabled();
  await page.getByRole('button', { name: 'Remove placeholder', exact: true }).click();
  await page.locator('#capture').click(); expect(await page.locator('.frame-image img').nth(1).getAttribute('src')).toBe(original);
  for (const size of [{ width: 320, height: 568 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(size); await add(page);
    const button = await page.locator('#regenerate').boundingBox(); expect(button.x + button.width).toBeLessThanOrEqual(size.width);
    const footer = await page.locator('#render').boundingBox(); expect(footer.y + footer.height).toBeLessThanOrEqual(size.height);
    await page.getByRole('button', { name: 'Remove placeholder', exact: true }).click();
  }
});
