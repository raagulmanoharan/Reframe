import { sceneInstructions } from '../lib/scene-instructions.js';
import { sceneSchema, validateScene } from '../lib/scene-schema.js';
import { sceneBrief, notesInstruction } from '../lib/generation-input.js';

function description(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 4000) throw new Error('Describe your scene in 1–4,000 characters.');
  return value.trim();
}
function image(value, required = false) {
  if (!value && !required) return null;
  if (typeof value !== 'string' || value.length > 1_500_000) throw new Error('The image is too large. Please use a smaller reference.');
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw new Error('Use a JPG, PNG, or WEBP image.');
  const bytes = Uint8Array.from(atob(match[2]), c => c.charCodeAt(0));
  return { data: value, blob: new Blob([bytes], { type: `image/${match[1]}` }), extension: match[1] };
}
async function openai(path, key, options, timeout = 120000) {
  if (typeof key !== 'string' || !key.trim()) throw new Error('Enter your OpenAI API key.');
  let response;
  try {
    response = await fetch(`https://api.openai.com/v1/${path}`, {
      ...options, headers: { ...options.headers, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(timeout), credentials: 'omit', referrerPolicy: 'no-referrer',
    });
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') throw new Error('OpenAI took too long. Please try again.');
    throw new Error('Cannot reach OpenAI. Check your connection and try again.');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const messages = {
      400: 'OpenAI could not process this request. Try another description or reference.',
      401: 'Your OpenAI API key was not accepted. Open AI settings to replace it.',
      403: 'Your OpenAI account cannot access this model. Check model access and account verification.',
      429: data?.error?.code === 'insufficient_quota' ? 'Your OpenAI account needs API credit or a higher usage limit.' : 'OpenAI is rate limiting requests. Wait a moment and try again.',
    };
    const error = new Error(messages[response.status] || 'OpenAI is unavailable. Please try again.');
    error.status = response.status; throw error;
  }
  if (!data) throw new Error('OpenAI returned an unreadable response.');
  return data;
}
export async function generateScene(key, input) {
  const reference = image(input.reference), prompt = sceneBrief(input.prompt, reference);
  const content = [{ type: 'text', text: prompt }];
  if (reference) content.push({ type: 'image_url', image_url: { url: reference.data, detail: 'high' } });
  const result = await openai('chat/completions', key, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4.1-mini', max_completion_tokens: 10000,
      messages: [{ role: 'system', content: sceneInstructions }, { role: 'user', content }],
      response_format: { type: 'json_schema', json_schema: { name: 'scene', strict: true, schema: sceneSchema } },
    }),
  });
  if (result.choices?.[0]?.message?.refusal) throw new Error('OpenAI could not generate this scene. Please try a different description.');
  try { return { scene: validateScene(JSON.parse(result.choices?.[0]?.message?.content)) }; }
  catch { throw new Error('OpenAI returned an invalid scene. Please try again.'); }
}
export async function generatePhoto(key, input) {
  const prompt = description(input.prompt), composition = image(input.composition, true), reference = image(input.reference);
  const notes = notesInstruction(input.notes);
  if (!['4:3', '1:1', '9:16', '16:9'].includes(input.ratio)) throw new Error('Invalid aspect ratio.');
  const form = new FormData();
  form.set('model', 'gpt-image-1');
  form.set('prompt', `Turn the first image, a low-poly composition draft, into a high-quality photorealistic photograph. Scene brief: ${prompt}\nPreserve the first image's camera viewpoint, framing, perspective, main subject position, scale and spatial relationships as closely as possible. Replace block geometry with realistic forms, materials, lighting and detail. Do not introduce text or watermarks. The intended aspect ratio is ${input.ratio}. ${reference ? 'The SECOND image is the actual product reference: preserve its design, proportions, colors, materials and distinctive details while placing it at the location and orientation in the first image. It is not a reference for composition.' : ''}${notes}`);
  form.append('image[]', composition.blob, `composition.${composition.extension}`);
  if (reference) form.append('image[]', reference.blob, `reference.${reference.extension}`);
  form.set('quality', 'high'); form.set('input_fidelity', 'high'); form.set('n', '1');
  form.set('size', input.ratio === '1:1' ? '1024x1024' : input.ratio === '9:16' ? '1024x1536' : '1536x1024');
  form.set('output_format', 'jpeg'); form.set('output_compression', '85');
  const result = await openai('images/edits', key, { method: 'POST', body: form }, 240000);
  const b64 = result.data?.[0]?.b64_json;
  if (typeof b64 !== 'string' || !b64.length || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw new Error('OpenAI returned no usable image. Please try again.');
  return { image: `data:image/jpeg;base64,${b64}`, requestedRatio: input.ratio };
}
