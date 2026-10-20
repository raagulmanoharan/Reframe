import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const scene = JSON.parse(readFileSync(new URL('./fixtures/scene.json', import.meta.url)));
async function enterKey(page) { await expect(page.locator('#access-dialog')).toBeVisible(); await page.locator('#access-code').fill('test-only-not-a-real-key'); await page.getByRole('button', { name: 'Continue', exact: true }).click(); }
async function upload(page) {
  const reference = Buffer.from(await page.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 64; c.getContext('2d').fillRect(0, 0, 64, 64); return c.toDataURL('image/png').split(',')[1]; }), 'base64');
  await page.locator('#reference').setInputFiles({ name: 'reference.png', mimeType: 'image/png', buffer: reference });
  await expect(page.locator('#upload-title')).toHaveText('reference.png');
}
async function build(page) { await page.locator('#build').click(); await enterKey(page); await expect(page.locator('#card-title')).toHaveText(scene.title); await expect(page.locator('#studio-panel')).toBeHidden(); await page.locator('#enter-studio').click(); }
for (const mobile of [false, true]) test(`prompt → studio → four annotated frames → photographs: ${mobile ? 'mobile' : 'desktop'}`, async ({ page }) => {
  await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
  const errors = [], sceneRequests = [], renderBodies = []; page.on('pageerror', e => errors.push(e.message));
  await page.route('https://api.openai.com/v1/chat/completions', async route => {
    sceneRequests.push(route.request().postDataJSON()); await route.fulfill({ json: { choices: [{ message: { content: JSON.stringify(scene) } }] } });
  });
  await page.goto('/'); await expect(page.locator('#studio-panel')).toBeHidden(); await expect(page.locator('#scene-card')).toBeHidden();
  await upload(page); await page.locator('#prompt').fill('An observatory on the moon with a telescope and antenna');
  await page.screenshot({ path: `/tmp/reframe-prompt-${mobile ? 'mobile' : 'desktop'}.png`, fullPage: true });
  await build(page);
  await expect(page.locator('.user-message').first()).toContainText('An observatory on the moon');
  await expect(page.locator('#prompt')).toHaveValue('');
  await expect(page.locator('#reference-preview')).toBeHidden();
  expect(sceneRequests[0].messages[1].content[1].image_url.url).toMatch(/^data:image\/jpeg/);
  const panel = await page.locator('#studio-panel').boundingBox(); expect(panel.x).toBe(0); expect(panel.y).toBe(0); expect(panel.height).toBe(mobile ? 844 : 1000);
  await page.locator('#annotate').click(); await page.locator('#frame-note').fill('Warm light from the left. Keep the antenna.'); await page.locator('#close-notes').click();
  await page.locator('#capture').click(); const first = await page.locator('.frame-image img').first().getAttribute('src'); expect(first.length).toBeGreaterThan(10000);
  // Move a primitive vertically, capture, then restore frame 1. Its original layout must survive.
  await page.locator('#move-mode').click(); await page.locator('#object-select').selectOption('0');
  const initialHeight = await page.locator('#object-height').inputValue();
  await page.locator('#object-height').evaluate(el => { el.value = Number(el.value) + 1.5; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect(page.locator('#undo-move')).toBeEnabled();
  await page.locator('#capture').click(); expect(await page.locator('.frame-image img').nth(1).getAttribute('src')).not.toBe(first);
  await page.getByRole('button', { name: 'Restore frame 1', exact: true }).click();
  await page.locator('#object-select').selectOption('0'); expect(await page.locator('#object-height').inputValue()).toBe(initialHeight);
  await page.locator('#camera-mode').click();
  const bounds = await page.locator('canvas').boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width / 2 + 65, bounds.y + bounds.height / 2 + 20, { steps: 10 }); await page.mouse.up(); await page.waitForTimeout(300);
  await page.locator('#ratio').selectOption('9:16'); await page.locator('#capture').click();
  const third = page.locator('.frame-image img').nth(2); expect(await third.getAttribute('src')).not.toBe(first);
  const dimensions = await third.evaluate(img => [img.naturalWidth, img.naturalHeight]); expect(dimensions[0] / dimensions[1]).toBeCloseTo(9 / 16, 2);
  await page.locator('#capture').click(); await expect(page.locator('#capture')).toBeDisabled(); await expect(page.locator('#shot-count')).toHaveText('4 / 4 frames');
  await page.getByRole('button', { name: 'Delete frame 4', exact: true }).click(); await expect(page.locator('#capture')).toBeEnabled(); await page.locator('#capture').click();
  await page.screenshot({ path: `/tmp/reframe-studio-${mobile ? 'mobile' : 'desktop'}.png` });
  await page.locator('#exit-studio').click(); await page.locator('#prompt').fill('A completely different next scene'); await upload(page); await page.locator('#remove-reference').click(); await page.locator('#enter-studio').click();
  await page.route('https://api.openai.com/v1/images/edits', async route => { renderBodies.push(route.request().postData()); await route.fulfill({ json: { data: [{ b64_json: first.split(',')[1] }] } }); });
  await page.getByRole('button', { name: 'Let’s Go', exact: true }).click();
  await expect(page.locator('#studio-panel')).toBeHidden(); await expect(page.getByAltText('AI photograph 4')).toBeVisible();
  await expect(page.locator('.studio-submission img')).toHaveCount(4);
  await expect(page.locator('.studio-submission')).toContainText('Warm light from the left. Keep the antenna.');
  expect(await page.locator('#chat-thread > article, #chat-thread > section').evaluateAll(nodes => nodes.map(node => node.classList.contains('user-message') ? 'user' : 'assistant'))).toEqual(['user', 'assistant', 'user', 'assistant']);
  expect(renderBodies).toHaveLength(4);
  expect(renderBodies[0]).toContain('Warm light from the left. Keep the antenna.'); expect(renderBodies[1]).not.toContain('Warm light from the left. Keep the antenna.');
  for (const body of renderBodies) { expect(body).toContain('An observatory on the moon'); expect(body).not.toContain('A completely different next scene'); expect(body).toContain('reference.jpeg'); }
  await page.getByRole('button', { name: 'View photograph 1', exact: true }).click(); await expect(page.locator('#photo-dialog')).toBeVisible(); await page.locator('#close-photo').click();
  const download = page.waitForEvent('download'); await page.getByRole('link', { name: 'Download photograph 1', exact: true }).click(); expect((await download).suggestedFilename()).toBe('reframe-photo-1.jpg');
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); expect(errors).toEqual([]);
  await page.screenshot({ path: `/tmp/reframe-results-${mobile ? 'mobile' : 'desktop'}.png`, fullPage: true });
});
test('image-only input produces a scene card; empty input and provider failures never fabricate a scene', async ({ page }) => {
  await page.route('https://api.openai.com/v1/chat/completions', async route => {
    expect(route.request().postDataJSON().messages[1].content[0].text).toContain('reference image');
    await route.fulfill({ status: 401, json: { error: { message: 'bad key' } } });
  });
  await page.goto('/'); await page.locator('#build').click(); await expect(page.locator('#error')).toContainText('add an image'); await expect(page.locator('#access-dialog')).toBeHidden();
  await upload(page); await page.locator('#build').click(); await enterKey(page);
  await expect(page.locator('#error')).toContainText('key was not accepted'); await expect(page.locator('#scene-card')).toBeHidden(); await expect(page.locator('#studio-panel')).toBeHidden();
  await page.getByRole('button', { name: 'Use this message again' }).click();
  await page.locator('#build').click(); await expect(page.locator('#access-dialog')).toBeVisible(); await page.locator('#cancel-access').click(); await expect(page.locator('#error')).toHaveText('Generation cancelled.');
});
test('earlier studio cards and failed image replies keep their own context across chat turns', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('https://api.openai.com/v1/chat/completions', route => {
    const prompt = route.request().postDataJSON().messages[1].content[0].text;
    return route.fulfill({ json: { choices: [{ message: { content: JSON.stringify({ ...scene, title: prompt }) } }] } });
  });
  await page.goto('/'); await page.locator('#prompt').fill('First scene'); await buildWithoutTitle();
  await page.locator('#annotate').click(); await page.locator('#frame-note').fill('Keep the silver telescope.'); await page.locator('#close-notes').click();
  await page.locator('#capture').click();
  const image = await page.locator('.frame-image img').getAttribute('src');
  let fail = true; const bodies = [];
  await page.route('https://api.openai.com/v1/images/edits', route => {
    bodies.push(route.request().postData());
    return route.fulfill(fail ? { status: 429, json: { error: {} } } : { json: { data: [{ b64_json: image.split(',')[1] }] } });
  });
  await page.locator('#render').click(); await expect(page.locator('.retry-render')).toBeVisible();
  await page.locator('#prompt').fill('Second scene'); await page.locator('#build').click();
  await expect(page.locator('#card-title')).toHaveText('Second scene');
  await expect(page.locator('.scene-card')).toHaveCount(2);
  await page.locator('.open-studio').first().click();
  await expect(page.locator('#scene-name')).toHaveText('First scene');
  await expect(page.locator('#shot-count')).toHaveText('1 / 4 frames');
  expect(await page.locator('.frame-image img').getAttribute('src')).toBe(image);
  await page.locator('#exit-studio').click();
  fail = false; await page.locator('.retry-render').click();
  await expect(page.getByAltText('AI photograph 1')).toBeVisible();
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toContain('First scene'); expect(bodies[1]).toContain('Keep the silver telescope.');
  expect(bodies[1]).not.toContain('Second scene');
  await page.locator('.open-studio').last().click();
  await expect(page.locator('#scene-name')).toHaveText('Second scene');
  await expect(page.locator('#shot-count')).toHaveText('0 / 4 frames');
  await page.locator('#capture').click(); await page.locator('#render').click();
  await expect(page.getByAltText('AI photograph 2')).toBeVisible();
  await expect(page.locator('.results-message')).toHaveCount(2);
  await expect(page.locator('.studio-submission')).toHaveCount(2);
  await page.locator('#new-chat').click(); await page.locator('#cancel-new-chat').click();
  await expect(page.locator('.scene-card')).toHaveCount(2);
  await page.locator('#new-chat').click(); await page.locator('#confirm-new-chat').click();
  await expect(page.locator('#chat-intro')).toBeVisible(); await expect(page.locator('#chat-thread')).toBeEmpty();
  async function buildWithoutTitle() {
    await page.locator('#build').click(); await enterKey(page);
    await expect(page.locator('#card-title')).toHaveText('First scene'); await page.locator('#enter-studio').click();
  }
});
test('partial image failure keeps completed images and retries only unfinished frames', async ({ page }) => {
  await page.route('https://api.openai.com/v1/chat/completions', route => route.fulfill({ json: { choices: [{ message: { content: JSON.stringify(scene) } }] } }));
  await page.goto('/'); await page.locator('#prompt').fill('An observatory'); await build(page);
  await page.locator('#capture').click(); await page.locator('#capture').click();
  const image = (await page.locator('.frame-image img').first().getAttribute('src')).split(',')[1]; let calls = 0;
  await page.route('https://api.openai.com/v1/images/edits', route => { calls++; return route.fulfill(calls === 2 ? { status: 429, json: { error: {} } } : { json: { data: [{ b64_json: image }] } }); });
  await page.locator('#render').click(); await expect(page.getByAltText('AI photograph 1')).toBeVisible(); await expect(page.locator('#retry-render')).toBeVisible(); await expect(page.locator('#error')).toContainText('rate limiting');
  await page.locator('#retry-render').click(); await expect(page.getByAltText('AI photograph 2')).toBeVisible(); expect(calls).toBe(3);
});
test('object dragging changes the composition, undo restores it, and controls fit small screens', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.route('https://api.openai.com/v1/chat/completions', route => route.fulfill({ json: { choices: [{ message: { content: JSON.stringify(scene) } }] } }));
  await page.goto('/'); await page.locator('#prompt').fill('An observatory'); await build(page);
  await page.locator('#capture').click(); const original = await page.locator('.frame-image img').first().getAttribute('src');
  await page.locator('#move-mode').click();
  const canvas = await page.locator('canvas').boundingBox();
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2); await page.mouse.down();
  await page.mouse.move(canvas.x + canvas.width / 2 + 35, canvas.y + canvas.height / 2 + 10, { steps: 8 }); await page.mouse.up();
  expect(await page.locator('#object-select').inputValue()).not.toBe('');
  await page.locator('#capture').click(); expect(await page.locator('.frame-image img').nth(1).getAttribute('src')).not.toBe(original);
  await page.locator('#undo-move').click(); await page.locator('#capture').click(); expect(await page.locator('.frame-image img').nth(2).getAttribute('src')).toBe(original);
  for (const size of [{ width: 320, height: 568 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(size);
    const button = await page.locator('#render').boundingBox();
    expect(button.y + button.height).toBeLessThanOrEqual(size.height);
    const panel = await page.locator('#studio-panel').boundingBox(); expect(panel.y).toBe(0); expect(panel.height).toBe(size.height);
  }
  await page.keyboard.press('Escape'); await expect(page.locator('#studio-panel')).toBeHidden();
});
