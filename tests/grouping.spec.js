import { test, expect } from '@playwright/test';

test('sofa parts move as one object, independently of the lamp, through capture, undo and restore', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  // Exercise the real renderer without adding test-only accessors to the app.
  await page.evaluate(async () => {
    const { createStudio } = await import('/src/studio.js');
    const THREE = await import('/node_modules/three/build/three.module.js');
    const viewport = document.createElement('div');
    Object.assign(viewport.style, { position: 'fixed', inset: '0', zIndex: '9999' });
    const container = document.createElement('div'); container.id = 'group-test';
    viewport.append(container); document.body.append(viewport);
    const part = (name, group, position, size) => ({ name, group, position, size, shape: 'box', rotation: [0, 0, 0], color: '#998877', roughness: 0.75, metalness: 0 });
    const scene = { title: 'Sofa and lamp', background: '#eeeeee', floor: '#cccccc', camera: { position: [0, 3, 8], target: [0, 1, 0] }, objects: [
      part('Seat', 'Sofa', [0, 0.6, 0], [2.4, 0.4, 1.3]),
      part('Stem', 'Lamp', [3, 1, 0], [0.1, 2, 0.1]),
      part('Left arm', 'Sofa', [-1.2, 0.9, 0.15], [0.3, 0.8, 1.3]),
      part('Right arm', 'Sofa', [1.2, 0.9, 0.15], [0.3, 0.8, 1.3]),
      part('Shade', 'Lamp', [3, 2, 0], [0.8, 0.5, 0.8]),
      part('Back', 'Sofa', [0, 1.1, -0.6], [2.4, 1.2, 0.2]),
    ] };
    const studio = createStudio(container, { value: '1:1' }, selection => { window.groupSelection = selection; });
    studio.setScene(scene); studio.setActive(true); studio.resize();
    window.groupTest = { studio, original: studio.capture(), project(position) {
      const camera = new THREE.PerspectiveCamera(44, 1, 0.03, 200);
      camera.position.fromArray(scene.camera.position); camera.lookAt(...scene.camera.target); camera.updateMatrixWorld();
      const p = new THREE.Vector3(...position).project(camera), bounds = container.getBoundingClientRect();
      return { x: bounds.left + (p.x + 1) * bounds.width / 2, y: bounds.top + (1 - p.y) * bounds.height / 2 };
    } };
  });
  expect(await page.evaluate(() => window.groupTest.studio.getObjects())).toEqual([{ name: 'Sofa', index: 0 }, { name: 'Lamp', index: 1 }]);
  const original = await page.evaluate(() => window.groupTest.original.scene);
  function checkTranslation(changed, group, axes) {
    const members = original.objects.map((p, i) => p.group === group ? i : -1).filter(i => i >= 0);
    const delta = changed.objects[members[0]].position.map((value, axis) => value - original.objects[members[0]].position[axis]);
    expect(axes.some(axis => Math.abs(delta[axis]) > 0.1)).toBe(true);
    original.objects.forEach((part, index) => {
      if (part.group !== group) expect(changed.objects[index]).toEqual(part);
      else part.position.forEach((value, axis) => expect(changed.objects[index].position[axis] - value).toBeCloseTo(delta[axis], 10));
    });
  }
  // Selecting either arm must resolve to Sofa, not the individual mesh.
  for (const position of [[-1.2, 0.9, 0.15], [1.2, 0.9, 0.15]]) {
    const point = await page.evaluate(position => window.groupTest.project(position), position);
    await page.mouse.move(point.x, point.y); await page.mouse.down();
    await page.mouse.move(point.x + 25, point.y + 10, { steps: 5 }); await page.mouse.up();
    expect(await page.evaluate(() => window.groupSelection.name)).toBe('Sofa');
    checkTranslation(await page.evaluate(() => window.groupTest.studio.capture().scene), 'Sofa', [0, 2]);
    await page.evaluate(() => window.groupTest.studio.undoMove());
    expect(await page.evaluate(() => window.groupTest.studio.capture().scene)).toEqual(original);
  }
  const raised = await page.evaluate(() => {
    const { studio } = window.groupTest;
    studio.selectObject(0); studio.setHeight(window.groupSelection.height + 2);
    window.groupTest.raised = studio.capture(); return window.groupTest.raised.scene;
  });
  checkTranslation(raised, 'Sofa', [1]);
  await page.evaluate(() => {
    const { studio, raised } = window.groupTest;
    studio.selectObject(1); studio.setHeight(4); studio.restore(raised);
  });
  expect(await page.evaluate(() => window.groupTest.studio.capture().scene)).toEqual(raised);
  expect(await page.evaluate(() => window.groupTest.original.scene)).toEqual(original);
  const resized = await page.evaluate(() => {
    const { studio } = window.groupTest; studio.selectObject(0); studio.setScale(1.5); return studio.capture().scene;
  });
  raised.objects.forEach((part, index) => {
    if (part.group === 'Sofa') part.size.forEach((value, axis) => expect(resized.objects[index].size[axis]).toBeCloseTo(value * 1.5));
    else expect(resized.objects[index]).toEqual(part);
  });
  await page.evaluate(() => window.groupTest.studio.undoMove());
  expect(await page.evaluate(() => window.groupTest.studio.capture().scene)).toEqual(raised);
  const clamped = await page.evaluate(() => {
    const { studio } = window.groupTest; studio.selectObject(0); studio.setHeight(1000); return studio.capture().scene;
  });
  for (const part of clamped.objects) expect(part.position[1]).toBeLessThanOrEqual(25);
  await page.evaluate(() => window.groupTest.studio.restore(window.groupTest.original));
  const cameraBefore = await page.evaluate(() => window.groupTest.studio.capture().position);
  const bounds = await page.locator('#group-test canvas').boundingBox();
  await page.mouse.move(bounds.x + 15, bounds.y + 15); await page.mouse.down();
  await page.mouse.move(bounds.x + 65, bounds.y + 30, { steps: 5 }); await page.mouse.up();
  expect(await page.evaluate(() => window.groupTest.studio.capture().position)).not.toEqual(cameraBefore);
  expect(await page.evaluate(() => window.groupTest.studio.capture().scene)).toEqual(original);

  const outsideCamera = await page.evaluate(() => window.groupTest.studio.capture().position);
  await page.mouse.move(20, 50); await page.mouse.down();
  await page.mouse.move(80, 70, { steps: 5 }); await page.mouse.up();
  expect(await page.evaluate(() => window.groupTest.studio.capture().position)).not.toEqual(outsideCamera);

  // Native touch events: the first finger lands on the sofa, then a second
  // finger turns the gesture into camera pinch/pan without changing geometry.
  await page.evaluate(() => window.groupTest.studio.restore(window.groupTest.original));
  const point = await page.evaluate(() => window.groupTest.project([-1.2, 0.9, 0.15]));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: point.x, y: point.y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: point.x, y: point.y }, { id: 2, x: point.x + 60, y: point.y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x: point.x - 15, y: point.y }, { id: 2, x: point.x + 85, y: point.y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  expect(await page.evaluate(() => window.groupTest.studio.capture().scene)).toEqual(original);
  expect(await page.evaluate(() => window.groupTest.studio.capture().position)).not.toEqual(cameraBefore);
  const replacement = await page.evaluate(async () => {
    const { addNode } = await import('/lib/scene-additions.js');
    const { studio } = window.groupTest, before = studio.capture();
    studio.replaceScene(addNode(before.scene, 'Plant', before.target).scene);
    const after = studio.capture();
    return { before: { position: before.position, target: before.target, ratio: before.ratio }, after: { position: after.position, target: after.target, ratio: after.ratio } };
  });
  expect(replacement.after).toEqual(replacement.before);
});
