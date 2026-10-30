import { test, expect } from '@playwright/test';

test('depth preview changes the focus plane, tap focus tracks the subject, and lens settings survive restoration', async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 500, height: 700 });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  page.on('console', message => { if (message.type() === 'error' && /shader|WebGL/i.test(message.text())) errors.push(message.text()); });
  await page.goto('/');
  await page.evaluate(async () => {
    const { createStudio } = await import('/src/studio.js');
    const viewport = document.createElement('div'); Object.assign(viewport.style, { position: 'fixed', inset: '0', zIndex: '9999' });
    const container = document.createElement('div'); container.id = 'lens-test'; viewport.append(container); document.body.append(viewport);
    const objects = [];
    for (const [group, x, z, width, height] of [['Near panel', -1.1, 4, 1.4, 2], ['Far panel', 2.3, -4, 3.27, 4.67]]) {
      for (let i = 0; i < 12; i++) objects.push({ name: `Stripe ${i}`, group, shape: 'box', position: [x - width / 2 + width / 12 * (i + 0.5), 1.5, z], size: [width / 12, height, 0.05], rotation: [0, 0, 0], color: i % 2 ? '#eeeeee' : '#111111', roughness: 1, metalness: 0 });
    }
    const studio = createStudio(container, { value: '1:1' });
    studio.setScene({ title: 'Focus test', background: '#bfcad4', floor: '#aaaaaa', camera: { position: [0, 1.5, 10], target: [0, 1.5, 0] }, objects });
    studio.setActive(true); studio.resize();
    window.lensTest = { studio, near: null, far: null };
  });
  const metrics = await page.evaluate(async () => {
    const { studio } = window.lensTest;
    async function edges(url) {
      const image = new Image(); image.src = url; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1024;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
      const values = ctx.getImageData(0, 0, 1024, 1024).data;
      return [280, 720].map(center => {
        let total = 0;
        for (let y = 485; y < 535; y++) for (let x = center - 90; x < center + 90; x++) {
          const offset = (y * 1024 + x) * 4; total += (values[offset] - values[offset + 4]) ** 2;
        }
        return total / (50 * 180);
      });
    }
    const sharp = await edges(studio.capture().composition);
    studio.setBlur(100); studio.setFocusDistance(6); window.lensTest.near = studio.capture();
    const near = await edges(window.lensTest.near.composition);
    studio.setFocusDistance(14); window.lensTest.far = studio.capture();
    const far = await edges(window.lensTest.far.composition);
    return { sharp, near, far };
  });
  expect(metrics.near[0]).toBeGreaterThan(metrics.sharp[0] * 0.75);
  expect(metrics.near[1]).toBeLessThan(metrics.far[1] * 0.8);
  expect(metrics.far[0]).toBeLessThan(metrics.near[0] * 0.8);

  const bounds = await page.locator('#lens-test canvas').boundingBox();
  await page.mouse.click(bounds.x + bounds.width * 0.273, bounds.y + bounds.height * 0.5);
  const focused = await page.evaluate(() => window.lensTest.studio.getLens());
  expect(focused.focusTarget.group).toBe('Near panel'); expect(focused.focusDistance).toBeCloseTo(5.975, 2);
  await page.mouse.wheel(0, -150);
  const moved = await page.evaluate(() => window.lensTest.studio.capture().lens);
  expect(moved.focusDistance).toBeLessThan(focused.focusDistance); expect(moved.focusTarget.group).toBe('Near panel');
  const restored = await page.evaluate(() => {
    const { studio, near } = window.lensTest;
    studio.setZoom(2); studio.setFocusDistance(50); studio.setBlur(0); studio.restore(near);
    const shot = studio.capture(); return { lens: shot.lens, sameImage: shot.composition === near.composition, original: near.lens };
  });
  expect(restored.lens).toEqual({ zoom: 1, focusDistance: 6, blur: 100 });
  expect(restored.sameImage).toBe(true); expect(restored.original).toEqual(restored.lens);
  const replacement = await page.evaluate(() => {
    const { studio } = window.lensTest; studio.setZoom(1.5); studio.selectObject(1); studio.focusSelected();
    const before = studio.capture(); studio.replaceScene(studio.snapshot()); const after = studio.capture();
    return { before: before.lens, after: after.lens, positionBefore: before.position, positionAfter: after.position };
  });
  expect(replacement.after).toEqual(replacement.before); expect(replacement.positionAfter).toEqual(replacement.positionBefore);
  await page.screenshot({ path: '/tmp/reframe-focus-preview.png' });
  const legacy = await page.evaluate(() => {
    const { studio, near } = window.lensTest; const { lens, ...old } = near; studio.restore(old); return studio.getLens();
  });
  expect(legacy.zoom).toBe(1); expect(legacy.blur).toBe(0); expect(errors).toEqual([]);
});
