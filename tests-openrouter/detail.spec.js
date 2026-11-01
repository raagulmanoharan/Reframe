import { test, expect } from '@playwright/test';

// Explicit provider fixture to exercise the richer contract and real WebGL
// renderer. This is not a generated-quality benchmark or a production preset.
const part = (name, group, shape, position, size, color, extra = {}) => ({ name, group, shape, position, size, color, rotation: [0, 0, 0], roughness: 0.8, metalness: 0, repeat: null, ...extra });
const design = 'An olive upholstered sofa anchors a warm living room. Separate seat and back cushions sit between rounded arms on an oak base and feet; a low timber coffee table, woven rug, brass lamp and open bookshelf supply believable scale and depth. Keep the foreground open for a three-quarter view.';
const scene = {
  design, title: 'Olive living room', background: '#eae4db', floor: '#ccc1ae',
  camera: { position: [5.3, 3.8, 6.6], target: [0, 0.9, 0] },
  objects: [
    part('Base', 'Sofa', 'roundedBox', [0, 0.38, 0], [3, 0.3, 1.25], '#7e6547'),
    part('Seat cushion', 'Sofa', 'roundedBox', [-0.78, 0.69, 0.12], [0.75, 0.35, 1.05], '#747c4c', { repeat: { count: 3, offset: [0.78, 0, 0] } }),
    part('Back cushion', 'Sofa', 'roundedBox', [-0.78, 1.16, -0.46], [0.76, 0.85, 0.25], '#7d8555', { rotation: [-0.12, 0, 0], repeat: { count: 3, offset: [0.78, 0, 0] } }),
    part('Arm', 'Sofa', 'roundedBox', [-1.37, 0.87, 0], [0.3, 0.7, 1.27], '#6b7344', { repeat: { count: 2, offset: [2.74, 0, 0] } }),
    part('Front foot', 'Sofa', 'capsule', [-1.2, 0.16, 0.45], [0.13, 0.32, 0.13], '#62472f', { repeat: { count: 2, offset: [2.4, 0, 0] } }),
    part('Back foot', 'Sofa', 'capsule', [-1.2, 0.16, -0.45], [0.13, 0.32, 0.13], '#62472f', { repeat: { count: 2, offset: [2.4, 0, 0] } }),
    part('Pillow', 'Sofa', 'roundedBox', [0.88, 1, 0], [0.45, 0.45, 0.2], '#cfb48f', { rotation: [0, 0, 0.3] }),
    part('Rug', 'Rug', 'roundedBox', [0, 0.025, 1.2], [4.2, 0.05, 3], '#d9cdb7'),
    part('Top', 'Coffee table', 'roundedBox', [0, 0.62, 1.65], [1.8, 0.14, 0.85], '#a27e51'),
    part('Front legs', 'Coffee table', 'capsule', [-0.65, 0.3, 1.9], [0.09, 0.6, 0.09], '#795a3b', { repeat: { count: 2, offset: [1.3, 0, 0] } }),
    part('Back legs', 'Coffee table', 'capsule', [-0.65, 0.3, 1.4], [0.09, 0.6, 0.09], '#795a3b', { repeat: { count: 2, offset: [1.3, 0, 0] } }),
    part('Tray', 'Tray', 'cylinder', [0.3, 0.71, 1.65], [0.35, 0.04, 0.35], '#665c4f'),
    part('Vase', 'Vase', 'sphere', [-0.45, 0.84, 1.65], [0.25, 0.3, 0.25], '#e5ddc9'),
    part('Lamp base', 'Lamp', 'cylinder', [2, 0.06, -0.4], [0.5, 0.12, 0.5], '#ae8e50', { metalness: 0.75, roughness: 0.3 }),
    part('Lamp stem', 'Lamp', 'capsule', [2, 1.03, -0.4], [0.06, 1.95, 0.06], '#ae8e50', { metalness: 0.75, roughness: 0.3 }),
    part('Shade', 'Lamp', 'cone', [2, 2.05, -0.4], [0.7, 0.5, 0.7], '#e8d8b5'),
    part('Bookcase sides', 'Bookcase', 'box', [-2.5, 1.12, -1.4], [0.1, 2.24, 0.5], '#93704a', { repeat: { count: 2, offset: [1.2, 0, 0] } }),
    part('Shelves', 'Bookcase', 'box', [-1.9, 0.12, -1.4], [1.2, 0.08, 0.5], '#93704a', { repeat: { count: 5, offset: [0, 0.52, 0] } }),
    part('Lower books', 'Bookcase', 'box', [-2.35, 0.33, -1.35], [0.1, 0.34, 0.3], '#90755e', { repeat: { count: 8, offset: [0.12, 0, 0] } }),
    part('Upper books', 'Bookcase', 'box', [-2.3, 1.37, -1.35], [0.12, 0.34, 0.3], '#788476', { repeat: { count: 6, offset: [0.14, 0, 0] } }),
  ],
};
const model = { id: 'fixture/reasoner:free', pricing: { prompt: '0', completion: '0' }, architecture: { input_modalities: ['text'], output_modalities: ['text'] }, supported_parameters: ['structured_outputs', 'reasoning'], top_provider: { max_completion_tokens: 16384 } };
const photo = { ...model, id: 'fixture/photo:free', architecture: { input_modalities: ['text', 'image'], output_modalities: ['image'] } };

test('detailed scenes render on mobile, remain grouped and pass captured design to photographs', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = [], requests = []; page.on('pageerror', e => errors.push(e.message));
  let composition;
  await page.route('https://openrouter.ai/api/v1/models', route => route.fulfill({ json: { data: [model, photo] } }));
  await page.route('https://openrouter.ai/api/v1/chat/completions', route => {
    const body = route.request().postDataJSON(); requests.push(body);
    return route.fulfill({ json: { choices: [{ message: body.modalities ? { images: [{ image_url: { url: composition } }] } : { content: JSON.stringify(scene) } }] } });
  });
  await page.goto('/'); await page.locator('#prompt').fill('A living room with a sofa'); await page.locator('#build').click();
  await page.getByText('Use an API key instead', { exact: true }).click(); await page.locator('#access-code').fill('fixture-key');
  await page.getByRole('button', { name: 'Continue', exact: true }).click(); await page.locator('#enter-studio').click();
  expect(requests[0].reasoning).toEqual({ effort: 'medium', exclude: true });
  expect(requests[0].provider.max_price).toEqual({ prompt: '0', completion: '0', image: '0', request: '0' });
  await expect(page.locator('#object-select option')).toHaveText(['Select an object', 'Sofa', 'Rug', 'Coffee table', 'Tray', 'Vase', 'Lamp', 'Bookcase']);
  await page.screenshot({ path: '/tmp/reframe-detailed-mobile.png' });
  await page.locator('#capture').click(); const original = await page.locator('.frame-image img').getAttribute('src');
  await page.locator('#object-select').selectOption('0');
  const handle = page.locator('.resize-handle[data-resize=se]'); await handle.focus(); await handle.press('ArrowUp');
  await page.locator('#capture').click();
  const resized = await page.locator('.frame-image img').nth(1).getAttribute('src'); expect(resized).not.toBe(original);
  await page.getByRole('button', { name: 'Restore frame 1', exact: true }).click();
  await page.locator('#capture').click(); expect(await page.locator('.frame-image img').nth(2).getAttribute('src')).toBe(original);
  composition = original; await page.locator('#render').click();
  await expect(page.getByAltText('AI photograph 3')).toBeVisible();
  for (const request of requests.slice(1)) {
    expect(request.messages[0].content.at(-1).text).toContain(design);
    expect(request.messages[0].content.at(-1).text).toContain('take priority');
  }
  expect(requests[2].messages[0].content[0].image_url.url).toBe(resized);
  expect(errors).toEqual([]);
});
