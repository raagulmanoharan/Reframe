import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isFreeModel, chooseModel, generateScene, generatePhoto, generateReviewedScene } from '../src/openrouter.js';
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
  await provider([free], () => Response.json({ choices: [{ message: { content: '{"objects":[]}' } }] }), async () => assert.rejects(generateScene('fixture-key', { prompt: 'sofa' }), /did not finish a usable 3D scene/));
});
test('free image generation preserves ordered composition/reference, annotations and requested ratio', async () => {
  const reference = 'data:image/jpeg;base64,cmVmZXJlbmNl';
  await provider([photo], body => {
    assert.equal(body.model, photo.id); assert.deepEqual(body.modalities, ['image', 'text']);
    assert.equal(body.messages[0].content[0].image_url.url, image);
    assert.equal(body.messages[0].content[1].image_url.url, reference);
    assert.match(body.messages[0].content[2].text, /Keep the stitching/);
    assert.match(body.messages[0].content[2].text, /lens zoom 1.50x/); assert.match(body.messages[0].content[2].text, /moderate depth-of-field blur/);
    assert.equal(body.image_config.aspect_ratio, '16:9');
    return Response.json({ choices: [{ message: { images: [{ image_url: { url: image } }] } }] });
  }, async () => assert.equal((await generatePhoto('fixture-key', { prompt: 'sofa', reference, composition: image, ratio: '16:9', notes: 'Keep the stitching', lens: { zoom: 1.5, focusDistance: 8, blur: 50 } })).image, image));
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
test('truncated scene retries once with a smaller free draft, preserving the original brief and reference', async () => {
  const next = { ...free, id: 'fixture/z-backup:free' }, progress = []; let calls = 0;
  const compact = { ...scene, objects: scene.objects.map(({ roughness, metalness, ...object }) => object) };
  await provider([free, next], body => {
    calls++;
    assert.equal(body.messages[1].content[0].text, 'A living room with a rocking chair');
    assert.equal(body.messages[1].content[1].image_url.url, image);
    assert.equal(body.response_format.json_schema.schema.properties.objects.maxItems, calls === 1 ? 64 : 32);
    assert.ok(!body.messages[0].content.includes('65'));
    assert.equal(body.max_tokens, calls === 1 ? 12288 : 8192);
    assert.ok(body.response_format.json_schema.schema.properties.objects.items.required.includes('roughness'));
    assert.ok(body.response_format.json_schema.schema.required.includes('design'));
    if (calls === 1) return Response.json({ choices: [{ finish_reason: 'length', message: { content: '{"objects":[' } }] });
    assert.equal(body.model, next.id);
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(compact) } }] });
  }, async () => {
    const result = await generateScene('fixture-key', { prompt: 'A living room with a rocking chair', reference: image }, { onProgress: text => progress.push(text) });
    assert.equal(result.scene.objects[0].roughness, 0.75); assert.equal(result.scene.objects[0].metalness, 0);
    assert.equal(result.scene.objects[0].shape, scene.objects[0].shape);
  });
  assert.equal(calls, 2); assert.ok(progress.some(text => text.includes('compact scene')));
});
test('model selection prefers free reasoning with sufficient output capacity and requests bounded effort', async () => {
  const reasoning = { ...free, id: 'fixture/a-reasoner:free', reasoning: { mandatory: true, supported_efforts: ['high', 'low'] } };
  const small = { ...free, id: 'fixture/a-small:free', top_provider: { max_completion_tokens: 512 } };
  assert.equal(chooseModel([reasoning, small, free]).id, reasoning.id);
  const optional = { ...free, supported_parameters: ['structured_outputs', 'reasoning'], reasoning: { mandatory: false, supported_efforts: ['high', 'low', 'none'] } };
  await provider([optional], body => {
    assert.deepEqual(body.reasoning, { effort: 'low', exclude: true });
    return Response.json({ choices: [{ message: { content: JSON.stringify(scene) } }] });
  }, () => generateScene('fixture-key', { prompt: 'A rocking chair' }));
  await provider([reasoning], body => {
    assert.deepEqual(body.reasoning, { effort: 'low', exclude: true });
    return Response.json({ choices: [{ message: { content: JSON.stringify(scene) } }] });
  }, () => generateScene('fixture-key', { prompt: 'A rocking chair' }));
});
test('a fully valid scene is accepted even if the provider also flags the length limit', async () => {
  let calls = 0;
  await provider([free], () => { calls++; return Response.json({ choices: [{ finish_reason: 'length', message: { content: JSON.stringify(scene) } }] }); },
    async () => assert.equal((await generateScene('fixture-key', { prompt: 'A room' })).scene.title, scene.title));
  assert.equal(calls, 1);
});
test('two incomplete drafts stop with an honest error; safety refusals do not retry', async () => {
  let calls = 0;
  await provider([free], () => { calls++; return Response.json({ choices: [{ finish_reason: 'length', message: { content: '{"objects":[' } }] }); },
    async () => assert.rejects(generateScene('fixture-key', { prompt: 'A room' }), /Your prompt is fine/));
  assert.equal(calls, 2); calls = 0;
  await provider([free], () => { calls++; return Response.json({ choices: [{ message: { refusal: 'Declined' } }] }); },
    async () => assert.rejects(generateScene('fixture-key', { prompt: 'A room' }), /declined/));
  assert.equal(calls, 1);
});
test('stop cancels response reading without a retry, and the shared deadline also covers the response body', async () => {
  const originalFetch = globalThis.fetch, originalTimeout = AbortSignal.timeout;
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    if (url.endsWith('/models')) return Response.json({ data: [free] });
    calls++;
    return { ok: true, json: () => new Promise((resolve, reject) => {
      if (options.signal.aborted) reject(options.signal.reason);
      else options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    }) };
  };
  try {
    const controller = new AbortController();
    const operation = generateScene('fixture-key', { prompt: 'A room' }, { signal: controller.signal });
    setTimeout(() => controller.abort(), 15);
    await assert.rejects(operation, /generation stopped/); assert.equal(calls, 1);
    calls = 0;
    AbortSignal.timeout = ms => originalTimeout(ms === 120000 ? 20 : ms);
    // Keep the event loop alive while Node's unreferenced AbortSignal timer fires.
    const keepAlive = setTimeout(() => {}, 200);
    try { await assert.rejects(generateScene('fixture-key', { prompt: 'A room' }), /took too long/); }
    finally { clearTimeout(keepAlive); }
    assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; AbortSignal.timeout = originalTimeout; }
});

test('reasoned scene budgets adapt to provider limits; additions stay within their reserved parts', async () => {
  const limited = { ...free, context_length: 16384, top_provider: { max_completion_tokens: 4096 }, supported_parameters: ['structured_outputs', 'reasoning'] };
  await provider([limited], body => {
    assert.equal(body.max_tokens, 4096); assert.deepEqual(body.reasoning, { effort: 'medium', exclude: true });
    assert.ok(body.response_format.json_schema.schema.properties.objects.maxItems <= 12);
    return Response.json({ choices: [{ message: { content: JSON.stringify(scene) } }] });
  }, () => generateScene('fixture-key', { prompt: 'A living room', reference: image }));
  await provider([free], body => {
    assert.equal(body.response_format.json_schema.schema.properties.objects.maxItems, 32);
    assert.match(body.messages[0].content, /ONLY the requested new object/);
    assert.match(body.messages[0].content, /32 total parts/);
    return Response.json({ choices: [{ message: { content: JSON.stringify(scene) } }] });
  }, () => generateScene('fixture-key', { prompt: 'A chair', element: true }));
});

test('photo guidance carries the captured design while edited composition takes precedence', async () => {
  await provider([photo], body => {
    const instruction = body.messages[0].content.at(-1).text;
    assert.ok(instruction.includes(scene.design));
    assert.match(instruction, /take priority/); assert.match(instruction, /do not restore/);
    return Response.json({ choices: [{ message: { images: [{ image_url: { url: image } }] } }] });
  }, () => generatePhoto('fixture-key', { prompt: 'observatory', design: scene.design, composition: image, ratio: '4:3' }));
});

test('builder and vision reviewer exchange actual previews, original reference and actionable feedback with zero pricing', async () => {
  let builds = 0, reviews = 0;
  const revised = { ...structuredClone(scene), title: 'Repaired scene' };
  const issue = { severity: 'major', object: 'Observatory', problem: 'The telescope lacks a support.', fix: 'Add a support joining it to the enclosure.' };
  await provider([{ ...free, supported_parameters: ['structured_outputs', 'reasoning'] }], body => {
    if (body.response_format.json_schema.name === 'scene_review') {
      reviews++; assert.deepEqual(body.reasoning, { effort: 'low', exclude: true });
      const content = body.messages[1].content;
      assert.deepEqual(content.filter(x => x.type === 'image_url').map(x => x.image_url.url), [image, 'data:image/png;base64,ZnJvbnQ=', 'data:image/png;base64,c2lkZQ==']);
      assert.match(content[0].text, /Original request: An observatory/);
      return Response.json({ choices: [{ message: { content: JSON.stringify(reviews === 1 ? { verdict: 'revise', summary: 'Missing support.', issues: [issue] } : { verdict: 'pass', summary: 'Support is visible.', issues: [] }) } }] });
    }
    builds++;
    assert.equal(body.messages[1].content[0].text, 'An observatory'); assert.equal(body.messages[1].content[1].image_url.url, image);
    if (builds === 2) { assert.ok(body.messages[1].content[2].text.includes(issue.fix)); assert.ok(body.messages[1].content[2].text.includes(scene.title)); }
    return Response.json({ choices: [{ message: { content: JSON.stringify(builds === 1 ? scene : revised) } }] });
  }, async () => {
    const result = await generateReviewedScene('fixture-key', { prompt: 'An observatory', reference: image }, { renderPreview: () => ['data:image/png;base64,ZnJvbnQ=', 'data:image/png;base64,c2lkZQ=='] });
    assert.equal(result.scene.title, 'Repaired scene'); assert.equal(result.review.status, 'reviewed');
  });
  assert.equal(builds, 2); assert.equal(reviews, 2);
});
test('no free vision reviewer returns an explicitly unreviewed scene without a paid fallback', async () => {
  const textOnly = { ...free, architecture: { input_modalities: ['text'], output_modalities: ['text'] } };
  let calls = 0;
  await provider([textOnly, { ...free, id: 'fixture/paid-vision' }], () => { calls++; return Response.json({ choices: [{ message: { content: JSON.stringify(scene) } }] }); }, async () => {
    const result = await generateReviewedScene('fixture-key', { prompt: 'An observatory' }, { renderPreview: () => assert.fail('no reviewer') });
    assert.equal(result.review.status, 'unreviewed'); assert.match(result.review.reason, /No compatible free vision/);
  });
  assert.equal(calls, 1);
});
