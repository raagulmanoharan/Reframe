import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isFreeModel, chooseModel, generateScene, generatePhoto } from '../src/openrouter.js';
const scene = JSON.parse(await readFile(new URL('../tests/fixtures/scene.json', import.meta.url)));
const image = 'data:image/png;base64,dGVzdA==';
const free = { id: 'fixture/vision:free', pricing: { prompt: '0', completion: '0', image: '0' }, architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] }, supported_parameters: ['structured_outputs'] };
const photo = { ...free, id: 'fixture/photo:free', architecture: { input_modalities: ['text', 'image'], output_modalities: ['text', 'image'] } };
async function provider(models, respond, run) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.ok(url.startsWith('https://openrouter.ai/api/v1/'));
    assert.equal(options.credentials, 'omit');
    if (url.endsWith('/models')) { assert.equal(options.headers.Authorization, undefined); return Response.json({ data: models }); }
    assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer fixture-key');
    const body = JSON.parse(options.body);
    assert.equal(body.provider.allow_fallbacks, false);
    assert.deepEqual(body.provider.max_price, { prompt: '0', completion: '0', image: '0', request: '0' });
    return respond(body);
  };
  try { await run(); } finally { globalThis.fetch = original; }
}
test('free selection rejects paid image charges, promotional discounts, unknown prices and pricing overrides', () => {
  assert.ok(isFreeModel(free));
  for (const candidate of [
    { ...free, id: 'fixture/paid' },
    { ...free, pricing: { prompt: '0', completion: '0.01' } },
    { ...photo, pricing: { prompt: '0', completion: '0', image_output: '0.02' } },
    { ...free, pricing: { prompt: '0.01', completion: '0', discount: 1 } },
    { ...free, pricing: { prompt: null, completion: '0' } },
    { ...free, pricing: { prompt: '0', completion: '0', overrides: [{ pricing: { prompt: '0.01' } }] } },
  ]) assert.equal(Boolean(isFreeModel(candidate)), false);
  const textOnly = { ...free, architecture: { input_modalities: ['text'], output_modalities: ['text'] } };
  assert.throws(() => chooseModel([textOnly], { reference: true }), /vision/);
  assert.throws(() => chooseModel([free], { photo: true }), /no compatible free image/);
});
test('free vision scene sends the reference and validates actual JSON geometry', async () => {
  await provider([free], body => {
    assert.equal(body.model, free.id); assert.equal(body.messages[1].content[1].image_url.url, image);
    assert.equal(body.response_format.json_schema.strict, true);
    return Response.json({ choices: [{ message: { content: JSON.stringify(scene) } }] });
  }, async () => assert.equal((await generateScene('fixture-key', { reference: image })).scene.title, scene.title));
  await provider([free], () => Response.json({ choices: [{ message: { content: '{"objects":[]}' } }] }), async () => assert.rejects(generateScene('fixture-key', { prompt: 'sofa' }), /invalid 3D scene/));
});
test('free image generation preserves ordered composition/reference, annotations and requested ratio', async () => {
  const reference = 'data:image/jpeg;base64,cmVmZXJlbmNl';
  await provider([photo], body => {
    assert.equal(body.model, photo.id); assert.deepEqual(body.modalities, ['image', 'text']);
    assert.equal(body.messages[0].content[0].image_url.url, image);
    assert.equal(body.messages[0].content[1].image_url.url, reference);
    assert.match(body.messages[0].content[2].text, /Keep the stitching/);
    assert.equal(body.image_config.aspect_ratio, '16:9');
    return Response.json({ choices: [{ message: { images: [{ image_url: { url: image } }] } }] });
  }, async () => assert.equal((await generatePhoto('fixture-key', { prompt: 'sofa', reference, composition: image, ratio: '16:9', notes: 'Keep the stitching' })).image, image));
});
test('no image-output model fails before inference and text is never treated as a generated photograph', async () => {
  await provider([free], () => { assert.fail('No inference call should be made'); }, async () => assert.rejects(generatePhoto('fixture-key', { prompt: 'sofa', composition: image, ratio: '4:3' }), /no compatible free image/));
  await provider([photo], () => Response.json({ choices: [{ message: { content: 'Here is your image: https://example.com/photo.png' } }] }), async () => assert.rejects(generatePhoto('fixture-key', { prompt: 'sofa', composition: image, ratio: '4:3' }), /no usable image/));
});
test('free-model rate limits and HTTP-200 provider errors are surfaced without falling back', async () => {
  let calls = 0;
  await provider([free], () => { calls++; return Response.json({ error: { code: 429 } }); }, async () => assert.rejects(generateScene('fixture-key', { prompt: 'sofa' }), /free-model limit/));
  assert.equal(calls, 1);
});
