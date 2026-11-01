import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { draftSchema, expandDraft } from '../lib/scene-draft.js';
import { validateScene } from '../lib/scene-schema.js';
import { sceneGroups } from '../lib/scene-groups.js';
import { designInstructions } from '../lib/scene-design.js';
import { validateInput } from '../server/codex.js';
const scene = JSON.parse(readFileSync(new URL('../tests/fixtures/scene.json', import.meta.url)));
const slat = { ...scene.objects[0], shape: 'roundedBox', group: 'Chair', name: 'Back slat', position: [-0.6, 1.5, 0], size: [0.1, 1, 0.1], repeat: { count: 5, offset: [0.3, 0, 0] } };

test('repeated construction expands without mutation, preserves materials and edits as one whole object', () => {
  const input = { ...scene, objects: [slat, { ...scene.objects[1], shape: 'capsule', group: 'Chair', repeat: null }] };
  const before = structuredClone(input), result = expandDraft(input);
  assert.equal(result.objects.length, 6); assert.deepEqual(input, before);
  assert.equal(sceneGroups(result).length, 1);
  assert.equal(result.objects[4].position[0], 0.6);
  assert.equal(result.objects[0].metalness, slat.metalness);
  assert.equal(result.design, scene.design);
  assert.ok(result.objects.every(o => !('repeat' in o)));
  result.objects[0].rotation[0] = 1;
  assert.equal(result.objects[1].rotation[0], 0); assert.deepEqual(input, before);
  assert.equal(draftSchema().properties.objects.maxItems, 64);
});

test('bounded expansion rejects runaway patterns, off-scene copies and oversized additions', () => {
  for (const repeat of [{ count: 100000, offset: [1, 0, 0] }, { count: 2.5, offset: [1, 0, 0] }, { count: 2, offset: [0, 0, 0] }, { count: 2, offset: [NaN, 0, 0] }, { count: 2, offset: [1] }, 'code']) {
    assert.throws(() => expandDraft({ ...scene, objects: [{ ...slat, repeat }] }), /repeated/);
  }
  assert.throws(() => expandDraft({ ...scene, objects: [{ ...slat, position: [25, 0, 0] }] }), /scene object/);
  assert.throws(() => expandDraft({ ...scene, objects: Array(20).fill(slat) }), /Too many/);
  assert.throws(() => expandDraft({ ...scene, objects: Array(7).fill(slat) }, 32, 32), /Too many/);
  assert.throws(() => expandDraft({ ...scene, objects: [slat, slat] }, 1), /count/);
});

test('generated scenes require a bounded visual brief; legacy snapshots remain readable', () => {
  const legacy = structuredClone(scene); delete legacy.design;
  assert.doesNotThrow(() => validateScene(legacy));
  assert.throws(() => expandDraft(legacy), /design brief/);
  for (const design of ['', ' ', null, 123, 'x'.repeat(1201)]) {
    assert.throws(() => validateScene({ ...scene, design }), /design brief/);
    assert.throws(() => designInstructions(design), /design brief/);
  }
  const instructions = designInstructions(scene.design);
  assert.ok(instructions.includes(scene.design)); assert.match(instructions, /take priority/);
  assert.match(instructions, /do not restore/);
  assert.equal(designInstructions(undefined), '');
  assert.throws(() => validateInput('photo', { prompt: 'chair', design: 'x'.repeat(1201) }), /design brief/);
});
