import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const scene = JSON.parse(readFileSync(new URL('../tests/fixtures/scene.json', import.meta.url)));
const model = { id: 'fixture/vision:free', pricing: { prompt: '0', completion: '0' }, architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] }, supported_parameters: ['structured_outputs'] };
const photo = { ...model, id: 'fixture/photo:free', architecture: { input_modalities: ['text', 'image'], output_modalities: ['image'] } };
async function connect(page) {
  await page.getByText('Use an API key instead', { exact: true }).click();
  await page.locator('#access-code').fill('fixture-key'); await page.getByRole('button', { name: 'Continue', exact: true }).click();
}
test('OpenRouter chat uses only free models, submits the studio composition and downloads the returned photo', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let image, request;
  await page.route('https://openrouter.ai/api/v1/models', route => route.fulfill({ json: { data: [model, photo] } }));
  await page.route('https://openrouter.ai/api/v1/chat/completions', route => {
    request = route.request().postDataJSON();
    return route.fulfill({ json: { choices: [{ message: request.modalities ? { images: [{ image_url: { url: image } }] } : { content: JSON.stringify(scene) } }] } });
  });
  await page.route('https://api.openai.com/**', () => { throw new Error('OpenAI must not be called in OpenRouter mode'); });
  await page.goto('/'); await page.locator('#prompt').fill('An observatory'); await page.locator('#build').click();
  await expect(page.getByRole('heading', { name: 'Connect OpenRouter' })).toBeVisible(); await connect(page);
  await page.locator('#enter-studio').click(); await page.locator('#capture').click();
  image = await page.locator('.frame-image img').getAttribute('src');
  await page.locator('#render').click(); await expect(page.getByAltText('AI photograph 1')).toBeVisible();
  expect(request.model).toBe(photo.id); expect(request.messages[0].content[0].image_url.url).toBe(image);
  expect(request.provider.max_price.image).toBe('0'); expect(request.provider.allow_fallbacks).toBe(false);
  await expect(page.locator('.studio-submission')).toHaveCount(1);
  const download = page.waitForEvent('download'); await page.getByRole('link', { name: 'Download photograph 1', exact: true }).click(); expect((await download).suggestedFilename()).toBe('reframe-photo-1.jpg');
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
});
test('missing free photo support is visible upfront; availability can recover without losing captured frames', async ({ page }) => {
  let photoAvailable = false;
  await page.route('https://openrouter.ai/api/v1/models', route => route.fulfill({ json: { data: photoAvailable ? [model, photo] : [model] } }));
  await page.route('https://openrouter.ai/api/v1/chat/completions', route => route.fulfill({ json: { choices: [{ message: { content: JSON.stringify(scene) } }] } }));
  await page.goto('/'); await expect(page.locator('#provider-notice')).toContainText('Final photos are unavailable');
  await page.locator('#prompt').fill('An observatory'); await page.locator('#build').click(); await connect(page);
  await page.locator('#enter-studio').click(); await page.locator('#capture').click();
  await expect(page.locator('#render')).toBeDisabled(); await expect(page.locator('#studio-hint')).toContainText('Free photo generation is unavailable');
  await page.locator('#exit-studio').click(); photoAvailable = true;
  await page.locator('#access-settings').click(); await page.locator('#refresh-models').click();
  await expect(page.locator('#provider-availability')).toContainText(photo.id); await page.locator('#cancel-access').click();
  await page.locator('#enter-studio').click(); await expect(page.locator('#shot-count')).toHaveText('1 / 4 frames'); await expect(page.locator('#render')).toBeEnabled();
});
test('the reported rocking-chair truncation recovers automatically without asking for a simpler prompt', async ({ page }) => {
  let calls = 0;
  await page.route('https://openrouter.ai/api/v1/models', route => route.fulfill({ json: { data: [model] } }));
  await page.route('https://openrouter.ai/api/v1/chat/completions', route => {
    calls++; const body = route.request().postDataJSON();
    expect(body.messages[1].content[0].text).toBe('A living room with a rocking chair');
    return route.fulfill({ json: { choices: [{ finish_reason: calls === 1 ? 'length' : 'stop', message: { content: calls === 1 ? '{"objects":[' : JSON.stringify(scene) } }] } });
  });
  await page.goto('/'); await page.locator('#prompt').fill('A living room with a rocking chair'); await page.locator('#build').click(); await connect(page);
  await expect(page.locator('#enter-studio')).toBeVisible(); expect(calls).toBe(2);
  await expect(page.locator('.user-message')).toHaveCount(1); await expect(page.locator('.message-failed')).toHaveCount(0);
});
test('a failed scene appears once and Stop cancels a slow provider without generating a scene', async ({ page }) => {
  let calls = 0, slow = false;
  await page.route('https://openrouter.ai/api/v1/models', route => route.fulfill({ json: { data: [model] } }));
  await page.route('https://openrouter.ai/api/v1/chat/completions', route => {
    calls++; if (slow) return;
    return route.fulfill({ json: { choices: [{ finish_reason: 'length', message: { content: '{"objects":[' } }] } });
  });
  await page.goto('/'); await page.locator('#prompt').fill('A living room with a rocking chair'); await page.locator('#build').click(); await connect(page);
  await expect(page.locator('.message-failed')).toContainText('Your prompt is fine');
  await expect(page.locator('#error')).toBeHidden(); await expect(page.locator('#enter-studio')).toHaveCount(0); expect(calls).toBe(2);
  slow = true; await page.getByRole('button', { name: 'Use this message again' }).click(); await page.locator('#build').click();
  await expect(page.locator('.thinking-label')).toHaveText('Creating your 3D draft…');
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.locator('.message-failed').last()).toContainText('generation stopped');
  await expect(page.locator('#build')).toBeEnabled(); await expect(page.locator('#error')).toBeHidden();
});
