import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { addNode, additionBrief, mergeAddition } from '../lib/scene-additions.js';
const original = JSON.parse(readFileSync(new URL('../tests/fixtures/scene.json', import.meta.url)));
const lamp = { ...original, objects: [
  { ...original.objects[0], group: 'Lamp', name: 'Stem', position: [0, 1, 0], size: [0.1, 2, 0.1], rotation: [0, 0, 0] },
  { ...original.objects[1], group: 'Lamp', name: 'Shade', position: [0, 2, 0], size: [0.8, 0.5, 0.8], rotation: [0, 0.4, 0] },
] };
test('regeneration fills the positioned node without revising existing geometry, camera or appearance', () => {
  const before = structuredClone(original), { scene, addition } = addNode(original, 'A brass floor lamp', [0, 0, 0]);
  const node = scene.objects.at(-1); node.position = [5, 2, -3]; node.size = [2, 3, 2];
  const result = mergeAddition(scene, lamp, addition);
  assert.deepEqual(original, before);
  assert.deepEqual(result.objects.slice(0, original.objects.length), original.objects);
  assert.deepEqual(result.camera, scene.camera); assert.equal(result.floor, scene.floor); assert.equal(result.title, scene.title);
  const parts = result.objects.slice(original.objects.length);
  assert.equal(parts.length, 2); assert.ok(parts.every(p => p.group === addition.group));
  assert.equal(parts[0].position[0], 5); assert.equal(parts[0].position[2], -3);
  assert.ok(Math.abs(parts[0].position[1] - parts[0].size[1] / 2 - 0.5) < 1e-10);
  assert.match(additionBrief(scene, addition), /ONLY one new object: A brass floor lamp/);
  assert.match(additionBrief(scene, addition), /DO NOT generate these/);
  result.objects[0].position[0] = 15; assert.deepEqual(scene.objects[0], original.objects[0]);
});
test('adding a similarly named element cannot replace an existing object; invalid responses preserve the node', () => {
  const { scene, addition } = addNode(original, 'Observatory', [0, 0, 0]);
  assert.equal(addition.group, 'Observatory (2)');
  const before = structuredClone(scene);
  assert.throws(() => mergeAddition(scene, original, addition), /extra objects/);
  assert.throws(() => mergeAddition(scene, { ...lamp, objects: [] }, addition), /count/);
  assert.deepEqual(scene, before);
  assert.throws(() => addNode(original, '', [0, 0, 0]), /Describe/);
  assert.throws(() => addNode({ ...original, objects: Array(65).fill(original.objects[0]) }, 'Lamp', [0, 0, 0]), /full/);
});
test('a small node can fit an object with thin parts without invalidating the scene', () => {
  const { scene, addition } = addNode(original, 'Small lamp', [0, 0, 0]);
  scene.objects.at(-1).size = [0.15, 0.15, 0.15];
  const thin = structuredClone(lamp); thin.objects[0].size = [0.01, 2, 0.01];
  const result = mergeAddition(scene, thin, addition);
  assert.ok(result.objects.slice(original.objects.length).every(part => part.size.every(size => size >= 0.01)));
  assert.deepEqual(result.objects.slice(0, original.objects.length), original.objects);
});
