import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sceneGroups } from '../lib/scene-groups.js';
import { validateScene } from '../lib/scene-schema.js';
import { expandDraft, draftSchema } from '../lib/scene-draft.js';
const fixture = JSON.parse(readFileSync(new URL('../tests/fixtures/scene.json', import.meta.url)));

test('semantic groups contain complete objects, even when parts are interleaved', () => {
  const scene = structuredClone(fixture);
  scene.objects = [scene.objects[0], scene.objects[3], scene.objects[1], scene.objects[4], scene.objects[2]];
  const groups = sceneGroups(validateScene(scene));
  assert.deepEqual(groups.map(({ name, indices }) => ({ name, indices })), [
    { name: 'Observatory', indices: [0, 2, 4] }, { name: 'Boulder', indices: [1] }, { name: 'Antenna', indices: [3] },
  ]);
  for (const group of groups) for (const position of group.positions) for (let axis = 0; axis < 3; axis++) {
    const local = position[axis] - group.origin[axis];
    assert.ok(local + group.min[axis] >= -25 - 1e-10);
    assert.ok(local + group.max[axis] <= 25 + 1e-10);
  }
});
test('new drafts require valid grouping; legacy snapshots stay together', () => {
  assert.ok(draftSchema().properties.objects.items.required.includes('group'));
  for (const value of [undefined, '', ' ', ' Sofa ', 'x'.repeat(81), 7, null]) {
    const scene = structuredClone(fixture); scene.objects[0].group = value;
    assert.throws(() => expandDraft(scene), /group/i);
  }
  const legacy = structuredClone(fixture); legacy.objects.forEach(part => delete part.group);
  assert.doesNotThrow(() => validateScene(legacy));
  assert.equal(sceneGroups(legacy).length, 1);
  assert.equal(sceneGroups(legacy)[0].indices.length, legacy.objects.length);
  assert.throws(() => expandDraft(legacy), /groups/);
});
