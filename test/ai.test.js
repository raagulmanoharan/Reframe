import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateScene } from '../lib/scene-schema.js';
import { generateScene, generatePhoto } from '../src/ai.js';
const fixture = JSON.parse(await readFile(new URL('../tests/fixtures/scene.json', import.meta.url)));
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV2sAAAAASUVORK5CYII=';
async function provider(fake, fn) { const original = globalThis.fetch; globalThis.fetch = fake; try { await fn(); } finally { globalThis.fetch = original; } }

test('scene validation rejects executable shapes, unbounded geometry, and invalid cameras', () => {
  assert.equal(validateScene(fixture), fixture);
  for (const modify of [s => s.objects[0].shape = 'eval', s => s.objects[0].size[0] = 1e9, s => s.camera.position = s.camera.target, s => s.objects[0].color = 'url(evil)', s => s.objects = Array(97).fill(s.objects[0])]) {
    const scene = structuredClone(fixture); modify(scene); assert.throws(() => validateScene(scene));
  }
});
test('scene request uses actual OpenAI endpoint, vision input, and structured output', async () => {
  await provider(async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer test-only');
    assert.equal(options.credentials, 'omit');
    const body = JSON.parse(options.body); assert.equal(body.model, 'gpt-4.1-mini');
    assert.equal(body.messages[1].content[0].text, 'An observatory on the moon');
    assert.equal(body.messages[1].content[1].image_url.url, png);
    assert.equal(body.response_format.json_schema.strict, true);
    return Response.json({ choices: [{ message: { content: JSON.stringify(fixture) } }] });
  }, async () => assert.equal((await generateScene('test-only', { prompt: 'An observatory on the moon', reference: png })).scene.title, fixture.title));
});
test('photo edit sends captured composition first and reference second', async () => {
  await provider(async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/images/edits');
    assert.equal(options.body.get('model'), 'gpt-image-1');
    assert.equal(options.body.get('input_fidelity'), 'high');
    assert.equal(options.body.get('size'), '1024x1536');
    const images = options.body.getAll('image[]'); assert.equal(images.length, 2);
    assert.equal(images[0].name, 'composition.png'); assert.equal(images[1].name, 'reference.png');
    return Response.json({ data: [{ b64_json: png.split(',')[1] }] });
  }, async () => assert.match((await generatePhoto('test-only', { prompt: 'A ring', reference: png, composition: png, ratio: '9:16' })).image, /^data:image\/jpeg;base64,/));
});
test('provider errors and invalid responses never become a preset scene', async () => {
  for (const [status, expected] of [[401, /key was not accepted/], [403, /account cannot access/], [429, /rate limiting/], [500, /unavailable/]]) {
    await provider(async () => Response.json({ error: {} }, { status }), async () => assert.rejects(generateScene('test-only', { prompt: 'A scene' }), expected));
  }
  await provider(async () => Response.json({ choices: [{ message: { content: '{"objects":[]}' } }] }), async () => assert.rejects(generateScene('test-only', { prompt: 'A scene' }), /invalid scene/));
});
test('rejects blank prompts and non-image input before spending API credit', async () => {
  await provider(async () => { throw new Error('Provider must not be called'); }, async () => {
    await assert.rejects(generateScene('test-only', { prompt: '' }), /Describe/);
    await assert.rejects(generateScene('test-only', { prompt: 'Hello', reference: 'https://evil.example/a.png' }), /JPG/);
    await assert.rejects(generatePhoto('test-only', { prompt: 'Hello', composition: png, ratio: 'invalid' }), /aspect ratio/);
  });
});
