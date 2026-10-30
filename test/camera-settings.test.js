import test from 'node:test';
import assert from 'node:assert/strict';
import { validateLens, lensInstructions } from '../lib/camera-settings.js';
import { validateInput } from '../server/codex.js';

const lens = { zoom: 1.5, focusDistance: 8, blur: 75, focusTarget: { group: 'Sofa', point: [1, 1, 0] } };
test('camera direction preserves subject, focus and blur with honest relative units', () => {
  const copy = validateLens(lens); copy.focusTarget.point[0] = 5;
  assert.equal(lens.focusTarget.point[0], 1);
  const text = lensInstructions(lens);
  assert.match(text, /zoom 1.50x/); assert.match(text, /8.00 scene units/);
  assert.match(text, /named "Sofa" in focus/); assert.match(text, /strong depth-of-field blur/);
  assert.match(lensInstructions({ ...lens, blur: 0 }), /Do not add background blur/);
  assert.equal(lensInstructions(undefined), '');
});
test('invalid camera settings are rejected, including by the hosted API', () => {
  for (const value of [null, {}, { ...lens, zoom: 10 }, { ...lens, focusDistance: NaN }, { ...lens, blur: -1 }, { ...lens, focusTarget: { group: 'Sofa', point: [Infinity, 0, 0] } }]) {
    assert.throws(() => validateLens(value), /camera/);
    assert.throws(() => validateInput('photo', { prompt: 'Sofa', lens: value, composition: 'data:image/png;base64,YQ==', ratio: '1:1' }), error => error.status === 400);
  }
  const input = validateInput('photo', { prompt: 'Sofa', lens, composition: 'data:image/png;base64,YQ==', ratio: '1:1' });
  assert.deepEqual(input.lens, lens);
});
