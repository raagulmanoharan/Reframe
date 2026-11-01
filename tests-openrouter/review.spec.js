import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const scene = JSON.parse(readFileSync(new URL('../tests/fixtures/scene.json', import.meta.url)));
const revised = structuredClone(scene); revised.title = 'Repaired observatory'; revised.objects[2].position[1] = 1.4;
const builder = { id: 'fixture/a-builder:free', pricing: { prompt: '0', completion: '0' }, architecture: { input_modalities: ['text'], output_modalities: ['text'] }, supported_parameters: ['structured_outputs'] };
const reviewer = { ...builder, id: 'fixture/z-reviewer:free', architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] } };
const pass = { verdict: 'pass', summary: 'The visible construction matches the request.', issues: [] };
const fail = { verdict: 'revise', summary: 'The telescope needs support.', issues: [{ severity: 'major', object: 'Observatory', problem: 'Telescope sits too high above its mount.', fix: 'Lower the telescope onto its mount.' }] };
const answer = value => ({ json: { choices: [{ message: { content: JSON.stringify(value) } }] } });
async function start(page) {
  await page.goto('/'); await page.locator('#prompt').fill('An observatory'); await page.locator('#build').click();
  await page.getByText('Use an API key instead', { exact: true }).click(); await page.locator('#access-code').fill('fixture-key');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
}
test('two rendered views drive a repair and recheck before the studio card is shown', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const requests = [], errors = [], previews = []; let builds = 0, reviews = 0;
  page.on('pageerror', e => errors.push(e.message));
  await page.route('https://openrouter.ai/api/v1/models', route => route.fulfill({ json: { data: [builder, reviewer] } }));
  await page.route('https://openrouter.ai/api/v1/chat/completions', async route => {
    const body = route.request().postDataJSON(); requests.push(body);
    expect(body.provider.max_price).toEqual({ prompt: '0', completion: '0', image: '0', request: '0' });
    expect(body.provider.allow_fallbacks).toBe(false);
    if (body.response_format.json_schema.name === 'scene_review') {
      reviews++; expect(body.model).toBe(reviewer.id);
      const images = body.messages[1].content.filter(c => c.type === 'image_url').map(c => c.image_url.url);
      expect(images).toHaveLength(2); expect(images[0]).toMatch(/^data:image\/jpeg;base64,/); expect(images[0]).not.toBe(images[1]); previews.push(images);
      return route.fulfill(answer(reviews === 1 ? fail : pass));
    }
    builds++; expect(body.model).toBe(builder.id);
    if (builds === 2) {
      expect(body.messages[1].content.at(-1).text).toContain(fail.issues[0].fix);
      expect(body.messages[1].content.at(-1).text).toContain(scene.title);
      await expect(page.locator('#enter-studio')).toHaveCount(0);
    }
    return route.fulfill(answer(builds === 1 ? scene : revised));
  });
  await start(page); await expect(page.locator('#enter-studio')).toBeVisible();
  await expect(page.locator('.assistant-copy')).toContainText('Refined and visually reviewed');
  await expect(page.locator('#card-title')).toHaveText(revised.title);
  expect(requests).toHaveLength(4); expect(previews[0][0]).not.toBe(previews[1][0]);
  await page.locator('.scene-review summary').click(); await expect(page.locator('.scene-review')).toContainText('does not guarantee');
  await page.screenshot({ path: '/tmp/reframe-scene-review-mobile.png' });
  expect(await page.locator('canvas').count()).toBe(1);
  await page.locator('#enter-studio').click(); await page.locator('#capture').click();
  await expect(page.locator('#shot-count')).toHaveText('1 / 4 frames'); expect(errors).toEqual([]);
});
test('failed recheck keeps the original draft and exposes remaining issues, without looping', async ({ page }) => {
  let builds = 0, reviews = 0;
  await page.route('https://openrouter.ai/api/v1/models', route => route.fulfill({ json: { data: [builder, reviewer] } }));
  await page.route('https://openrouter.ai/api/v1/chat/completions', route => {
    if (route.request().postDataJSON().response_format.json_schema.name === 'scene_review') { reviews++; return route.fulfill(answer(fail)); }
    return route.fulfill(answer(++builds === 1 ? scene : revised));
  });
  await start(page); await expect(page.locator('#enter-studio')).toBeVisible();
  await expect(page.locator('#card-title')).toHaveText(scene.title);
  await expect(page.locator('.assistant-copy')).toContainText('still found issues');
  await page.locator('.scene-review summary').click(); await expect(page.locator('.scene-review')).toContainText(fail.issues[0].problem);
  expect(builds).toBe(2); expect(reviews).toBe(2);
});
for (const stage of ['review', 'repair']) test(`Stop during ${stage} discards late results and preserves the earlier studio card`, async ({ page }) => {
  let hold = false, delayed, builds = 0;
  await page.route('https://openrouter.ai/api/v1/models', route => route.fulfill({ json: { data: [builder, reviewer] } }));
  await page.route('https://openrouter.ai/api/v1/chat/completions', route => {
    const body = route.request().postDataJSON(), reviewing = body.response_format.json_schema.name === 'scene_review';
    if (hold && (stage === 'review' && reviewing || stage === 'repair' && !reviewing && body.messages[1].content.length > 1)) { delayed = route; return; }
    if (reviewing) return route.fulfill(answer(hold ? fail : pass));
    builds++; return route.fulfill(answer(scene));
  });
  await start(page); await expect(page.locator('#enter-studio')).toBeVisible();
  await page.locator('#enter-studio').click(); await page.locator('#capture').click(); await page.locator('#exit-studio').click();
  const firstPreview = await page.locator('.scene-preview').getAttribute('src'); hold = true;
  await page.locator('#prompt').fill('Another observatory'); await page.locator('#build').click();
  await expect.poll(() => Boolean(delayed)).toBe(true);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.locator('.message-failed')).toContainText('generation stopped');
  await delayed.fulfill(answer(stage === 'review' ? pass : revised)).catch(() => {});
  await expect(page.locator('.scene-card')).toHaveCount(1);
  expect(await page.locator('.scene-preview').getAttribute('src')).toBe(firstPreview);
  await page.locator('#enter-studio').click(); await expect(page.locator('#shot-count')).toHaveText('1 / 4 frames');
  expect(await page.locator('canvas').count()).toBe(1); expect(builds).toBe(2);
});
