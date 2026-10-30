import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const scene = JSON.parse(readFileSync(new URL('../tests/fixtures/scene.json', import.meta.url)));
const model = { id: 'fixture/scene:free', pricing: { prompt: '0', completion: '0' }, architecture: { input_modalities: ['text'], output_modalities: ['text'] }, supported_parameters: ['structured_outputs'] };
const photo = { ...model, id: 'fixture/photo:free', architecture: { input_modalities: ['text', 'image'], output_modalities: ['image'] } };
test('camera controls save per-frame focus and blur and pass them through to free photo generation', async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 390, height: 844 });
  const requests = []; let image;
  await page.route('https://openrouter.ai/api/v1/models', route => route.fulfill({ json: { data: [model, photo] } }));
  await page.route('https://openrouter.ai/api/v1/chat/completions', route => {
    const body = route.request().postDataJSON();
    if (body.modalities) { requests.push(body); return route.fulfill({ json: { choices: [{ message: { images: [{ image_url: { url: image } }] } }] } }); }
    return route.fulfill({ json: { choices: [{ message: { content: JSON.stringify(scene) } }] } });
  });
  await page.goto('/'); await page.locator('#prompt').fill('An observatory'); await page.locator('#build').click();
  await page.getByText('Use an API key instead', { exact: true }).click();
  await page.locator('#access-code').fill('fixture-key'); await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.locator('#enter-studio').click(); await page.getByRole('button', { name: 'Camera settings', exact: true }).click();
  await page.locator('#object-select').selectOption('0'); await expect(page.locator('#camera-focus-subject')).toHaveText('Focus: Observatory');
  for (const [id, value] of [['camera-zoom', '1.5'], ['camera-blur', '80']]) await page.locator(`#${id}`).evaluate((el, value) => { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); }, value);
  await page.locator('#capture').click(); image = await page.locator('.frame-image img').getAttribute('src');
  await page.locator('#toast').evaluate(el => el.classList.remove('show'));
  await page.screenshot({ path: '/tmp/reframe-camera-mobile.png', animations: 'disabled' });
  await page.locator('#reset').click(); await expect(page.locator('#camera-zoom')).toHaveValue('1'); await expect(page.locator('#camera-blur')).toHaveValue('0');
  await page.locator('#capture').click();
  await page.getByRole('button', { name: 'Restore frame 1', exact: true }).click();
  await expect(page.locator('#camera-zoom')).toHaveValue('1.5'); await expect(page.locator('#camera-blur')).toHaveValue('80');
  await expect(page.locator('#camera-focus-subject')).toHaveText('Focus: Observatory');
  await page.locator('#exit-studio').click(); await page.locator('#enter-studio').click(); await page.locator('#camera-settings').click();
  await expect(page.locator('#camera-zoom')).toHaveValue('1.5'); await expect(page.locator('#camera-blur')).toHaveValue('80');
  for (const size of [{ width: 320, height: 568 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(size); const footer = await page.locator('#render').boundingBox();
    expect(footer.y + footer.height).toBeLessThanOrEqual(size.height); expect(await page.locator('#viewport').evaluate(el => el.clientHeight)).toBeGreaterThanOrEqual(60);
  }
  await page.locator('#render').click(); await expect(page.getByAltText('AI photograph 2')).toBeVisible();
  expect(requests).toHaveLength(2);
  const first = requests[0].messages[0].content.at(-1).text, second = requests[1].messages[0].content.at(-1).text;
  expect(first).toContain('lens zoom 1.50x'); expect(first).toContain('"Observatory" in focus'); expect(first).toContain('strong depth-of-field blur');
  expect(second).toContain('lens zoom 1.00x'); expect(second).toContain('Do not add background blur');
  expect(requests[0].messages[0].content[0].image_url.url).toBe(image);
  expect(requests[0].provider.max_price.image).toBe('0');
});
