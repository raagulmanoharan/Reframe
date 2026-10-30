import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 500, height: 700 }); await page.goto('/');
  await page.evaluate(async () => {
    const { createStudio } = await import('/src/studio.js');
    const THREE = await import('/node_modules/three/build/three.module.js');
    const viewport = document.createElement('div'); viewport.id = 'gesture-test';
    Object.assign(viewport.style, { position: 'fixed', inset: '0', zIndex: '9999' });
    const container = document.createElement('div'); viewport.append(container); document.body.append(viewport);
    const part = (name, group, position, size) => ({ name, group, position, size, shape: 'box', rotation: [0, 0, 0], color: '#998877', roughness: 0.75, metalness: 0 });
    const studio = createStudio(container, { value: '1:1' }, (selection, canUndo) => { window.inputSelection = selection; window.inputUndo = canUndo; });
    studio.setScene({ title: 'Sofa and lamp', background: '#eeeeee', floor: '#cccccc', camera: { position: [0, 3, 8], target: [0, 1, 0] }, objects: [
      part('Seat', 'Sofa', [0, 0.5, 0], [2, 1, 1]), part('Back', 'Sofa', [0, 1.25, -0.5], [2, 1.5, 0.2]), part('Lamp', 'Lamp', [3.5, 1, 0], [0.3, 2, 0.3]),
    ] });
    studio.setActive(true); studio.resize();
    window.inputTest = { studio, original: studio.capture(), project(position) {
      const shot = studio.capture(), camera = new THREE.PerspectiveCamera(44, 1, 0.03, 200);
      camera.position.fromArray(shot.position); camera.lookAt(...shot.target); camera.updateMatrixWorld();
      const point = new THREE.Vector3(...position).project(camera), bounds = container.getBoundingClientRect();
      return { x: bounds.left + (point.x + 1) * bounds.width / 2, y: bounds.top + (1 - point.y) * bounds.height / 2 };
    } };
  });
});
const capture = page => page.evaluate(() => { const shot = window.inputTest.studio.capture(); delete shot.composition; return shot; });
const point = page => page.evaluate(() => window.inputTest.project([0, 0.6, 0.4]));
function checkResize(original, resized) {
  const scale = resized.objects[0].size[0] / original.objects[0].size[0]; expect(scale).toBeGreaterThan(1.1);
  for (let i = 0; i < 2; i++) original.objects[i].size.forEach((size, axis) => expect(resized.objects[i].size[axis]).toBeCloseTo(size * scale, 10));
  expect(resized.objects[2]).toEqual(original.objects[2]);
  const bottom = objects => Math.min(...objects.slice(0, 2).map(o => o.position[1] - o.size[1] / 2));
  expect(bottom(resized.objects)).toBeCloseTo(bottom(original.objects), 10);
}
test('drag before selection orbits; a click selects; a second drag moves the whole object', async ({ page }) => {
  const before = await capture(page), p = await point(page);
  await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + 55, p.y + 15, { steps: 6 }); await page.mouse.up();
  const orbit = await capture(page); expect(orbit.scene).toEqual(before.scene); expect(orbit.position).not.toEqual(before.position);
  expect(await page.evaluate(() => window.inputSelection)).toBeNull();
  await page.evaluate(() => window.inputTest.studio.restore(window.inputTest.original));
  await page.mouse.click(p.x, p.y);
  const selected = await capture(page); expect(selected.scene).toEqual(before.scene); expect(selected.position).toEqual(before.position);
  expect(await page.evaluate(() => window.inputSelection.name)).toBe('Sofa');
  expect(selected.lens.focusTarget.group).toBe('Sofa');
  await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + 45, p.y + 15, { steps: 6 }); await page.mouse.up();
  const moved = await capture(page); expect(moved.position).toEqual(before.position); expect(moved.scene.objects[2]).toEqual(before.scene.objects[2]);
  const delta = moved.scene.objects[0].position.map((n, i) => n - before.scene.objects[0].position[i]); expect(Math.abs(delta[0])).toBeGreaterThan(0.1);
  moved.scene.objects[1].position.forEach((n, i) => expect(n - before.scene.objects[1].position[i]).toBeCloseTo(delta[i], 10));
  await page.evaluate(() => window.inputTest.studio.undoMove()); expect((await capture(page)).scene).toEqual(before.scene);
  expect(await page.evaluate(() => window.inputUndo)).toBe(false);
  await page.mouse.click(15, 20); expect(await page.evaluate(() => window.inputSelection)).toBeNull();
});
test('desktop edges resize uniformly, stay grounded, undo once and restore from a saved frame', async ({ page }) => {
  const before = await capture(page), p = await point(page); await page.mouse.click(p.x, p.y);
  const handle = page.locator('#gesture-test .resize-handle[data-resize=se]'); await expect(handle).toBeVisible();
  await handle.hover(); await expect(handle).toHaveCSS('cursor', 'nwse-resize');
  const bounds = await handle.boundingBox(), x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 30, y + 25, { steps: 6 }); await page.mouse.up();
  const resized = await capture(page); checkResize(before.scene, resized.scene); expect(resized.position).toEqual(before.position);
  await page.evaluate(() => { window.inputTest.saved = window.inputTest.studio.capture(); window.inputTest.studio.undoMove(); });
  expect((await capture(page)).scene).toEqual(before.scene); expect(await page.evaluate(() => window.inputUndo)).toBe(false);
  await page.evaluate(() => window.inputTest.studio.restore(window.inputTest.saved)); expect((await capture(page)).scene).toEqual(resized.scene);
  await page.evaluate(() => window.inputTest.studio.selectObject(0));
  await page.screenshot({ path: '/tmp/reframe-resize-handles.png' });
});
test('pinching a selected object resizes it; pinching outside controls the camera without a release jump', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const cdp = await page.context().newCDPSession(page), p = await point(page), before = await capture(page);
  const send = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  const a = { id: 1, x: p.x - 20, y: p.y }, b = { id: 2, x: p.x + 20, y: p.y };
  await send('touchStart', [a]); await send('touchEnd', []);
  expect(await page.evaluate(() => window.inputSelection.name)).toBe('Sofa'); expect((await capture(page)).scene).toEqual(before.scene);
  await send('touchStart', [a]); await send('touchStart', [a, b]);
  const spread = [{ ...a, x: a.x - 15 }, { ...b, x: b.x + 15 }];
  await send('touchMove', spread);
  const resized = await capture(page); checkResize(before.scene, resized.scene); expect(resized.position).toEqual(before.position);
  await send('touchEnd', [spread[0]]); await send('touchMove', [{ ...spread[0], x: spread[0].x + 30 }]);
  const remaining = await capture(page); expect(remaining.scene).toEqual(resized.scene); expect(remaining.position).toEqual(resized.position);
  await send('touchEnd', []); await page.evaluate(() => window.inputTest.studio.undoMove());
  expect((await capture(page)).scene).toEqual(before.scene); expect(await page.evaluate(() => window.inputUndo)).toBe(false);
  const outside = [{ id: 1, x: 30, y: 30 }, { id: 2, x: 90, y: 30 }];
  await send('touchStart', [outside[0]]); await send('touchStart', outside);
  await send('touchMove', [outside[0], { ...outside[1], x: 130 }]); await send('touchEnd', []);
  const orbit = await capture(page); expect(orbit.scene).toEqual(before.scene); expect(orbit.position).not.toEqual(before.position);
  // Cancellation must release ownership so the next camera gesture still works.
  await page.evaluate(() => { window.inputTest.studio.restore(window.inputTest.original); window.inputTest.studio.selectObject(0); });
  await send('touchStart', [a]); await send('touchStart', [a, b]); await send('touchMove', spread); await send('touchCancel', []);
  const cancelled = await capture(page);
  await send('touchStart', [outside[0]]); await send('touchMove', [{ ...outside[0], x: 80 }]); await send('touchEnd', []);
  const next = await capture(page); expect(next.scene).toEqual(cancelled.scene); expect(next.position).not.toEqual(cancelled.position);
  await page.evaluate(() => { window.inputTest.studio.restore(window.inputTest.original); window.inputTest.studio.selectObject(0); });
  await send('touchStart', [a]); await page.evaluate(() => window.inputTest.studio.selectObject(null));
  await send('touchMove', [{ ...a, x: a.x + 40 }]); await send('touchEnd', []);
  expect((await capture(page)).scene).toEqual(before.scene); expect(await page.evaluate(() => window.inputSelection)).toBeNull();
  expect(errors).toEqual([]);
});
