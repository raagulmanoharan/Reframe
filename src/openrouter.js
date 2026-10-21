import { sceneSchema, validateScene } from '../lib/scene-schema.js';
import { sceneInstructions } from '../lib/scene-instructions.js';
import { sceneBrief, notesInstruction } from '../lib/generation-input.js';

const baseURL = 'https://openrouter.ai/api/v1';
const zero = value => (typeof value === 'string' && value.trim() !== '' || typeof value === 'number') && Number(value) === 0;
export function isFreeModel(model) {
  const pricing = model?.pricing;
  // Require an explicitly free variant AND zero listed pricing. A free trial,
  // discount, router, unknown price or conditional pricing is not sufficient.
  return typeof model?.id === 'string' && model.id.endsWith(':free') && pricing &&
    zero(pricing.prompt) && zero(pricing.completion) &&
    (!pricing.overrides || Array.isArray(pricing.overrides) && pricing.overrides.length === 0) &&
    Object.entries(pricing).every(([key, value]) => key === 'discount' || key === 'overrides' || zero(value));
}
export function chooseModel(models, { photo = false, reference = false } = {}) {
  const eligible = models.filter(model => isFreeModel(model) &&
    model.architecture?.input_modalities?.includes('text') &&
    model.architecture?.output_modalities?.includes(photo ? 'image' : 'text') &&
    (!(reference || photo) || model.architecture?.input_modalities?.includes('image')));
  const score = model => (model.supported_parameters?.includes('structured_outputs') ? 4 : 0) +
    (model.architecture?.input_modalities?.includes('image') ? 2 : 0);
  eligible.sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id));
  if (!eligible.length) throw new Error(photo
    ? 'OpenRouter currently lists no compatible free image-generation model. Your frames are saved in this tab. No paid model was used.'
    : reference ? 'OpenRouter currently lists no compatible free vision model. Try a text-only scene or check again later.'
      : 'OpenRouter currently lists no compatible free scene model. Please check again later.');
  return eligible[0];
}
async function request(path, { key, body, timeout = 120000 } = {}) {
  let response;
  try {
    response = await fetch(`${baseURL}/${path}`, {
      method: body ? 'POST' : 'GET', credentials: 'omit', referrerPolicy: 'no-referrer',
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(timeout), cache: 'no-store',
    });
  } catch (e) {
    throw new Error(e.name === 'TimeoutError' || e.name === 'AbortError' ? 'OpenRouter took too long. Please try again.' : 'Cannot reach OpenRouter. Check your connection and try again.');
  }
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.error) {
    const status = Number(result?.error?.code) || response.status;
    const messages = {
      400: 'This free model could not process the request. Try a simpler scene.',
      401: 'Your OpenRouter API key was not accepted. Open Account to replace it.',
      402: 'OpenRouter declined this free request. Check your account limits. No paid fallback was requested.',
      403: 'OpenRouter could not use this model. Check your account’s model and privacy settings.',
      404: 'The selected free model is no longer available. Please try again.',
      429: 'OpenRouter’s free-model limit was reached. Wait and try again.',
      503: 'No free provider is available for this request. Try again later.',
    };
    const error = new Error(messages[status] || 'OpenRouter is unavailable. Please try again.'); error.status = status; throw error;
  }
  if (!result) throw new Error('OpenRouter returned an unreadable response.');
  return result;
}
export async function getFreeModels() {
  const result = await request('models', { timeout: 20000 });
  if (!Array.isArray(result.data)) throw new Error('OpenRouter returned an invalid model catalog.');
  return result.data.filter(isFreeModel);
}
export async function getAvailability() {
  const models = await getFreeModels();
  const select = options => { try { return chooseModel(models, options).id; } catch { return null; } };
  return { scene: select({}), vision: select({ reference: true }), photo: select({ photo: true }) };
}
function inputImage(data, required = false) {
  if (!data && !required) return null;
  if (typeof data !== 'string' || data.length > 1_500_000 || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new Error('Use a JPG, PNG, or WEBP image smaller than 1 MB.');
  return { type: 'image_url', image_url: { url: data } };
}
async function complete(key, model, body) {
  if (typeof key !== 'string' || !key.trim()) throw new Error('Enter your OpenRouter API key.');
  return request('chat/completions', { key, timeout: 240000, body: {
    ...body, model: model.id, stream: false,
    provider: { allow_fallbacks: false, require_parameters: true, max_price: { prompt: '0', completion: '0', image: '0', request: '0' } },
  } });
}
export async function generateScene(key, input) {
  const reference = inputImage(input.reference), prompt = sceneBrief(input.prompt, reference);
  const model = chooseModel(await getFreeModels(), { reference: Boolean(reference) });
  const content = [{ type: 'text', text: prompt }]; if (reference) content.push(reference);
  const structured = model.supported_parameters?.includes('structured_outputs');
  const result = await complete(key, model, {
    messages: [{ role: 'system', content: `${sceneInstructions}\nReturn only JSON matching this schema, without prose or markdown: ${JSON.stringify(sceneSchema)}` }, { role: 'user', content }],
    max_tokens: Math.min(12000, model.top_provider?.max_completion_tokens || 12000),
    ...(structured ? { response_format: { type: 'json_schema', json_schema: { name: 'scene', strict: true, schema: sceneSchema } } } : {}),
  });
  const answer = result.choices?.[0];
  if (answer?.finish_reason === 'length') throw new Error('The free model ran out of space for this scene. Try a simpler description.');
  if (answer?.message?.refusal) throw new Error('The free model could not create this scene. Try another description.');
  try {
    const text = answer.message.content.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, '$1');
    return { scene: validateScene(JSON.parse(text)), model: model.id };
  } catch { throw new Error('The free model returned an invalid 3D scene. Please try again or simplify the description.'); }
}
export async function generatePhoto(key, input) {
  const composition = inputImage(input.composition, true), reference = inputImage(input.reference);
  const prompt = sceneBrief(input.prompt, reference), notes = notesInstruction(input.notes);
  if (!['1:1', '4:3', '9:16', '16:9'].includes(input.ratio)) throw new Error('Invalid aspect ratio.');
  const model = chooseModel(await getFreeModels(), { photo: true });
  const text = `Turn the FIRST image, a low-poly composition, into a photorealistic photograph. Preserve its camera viewpoint, framing, perspective, object positions, scale and spatial relationships. Refine the block shapes into realistic forms. Scene: ${prompt}. Aspect ratio: ${input.ratio}. ${reference ? 'The SECOND image is the product reference: preserve its design, colors, proportions and distinctive details. It defines appearance, not composition.' : ''}${notes}\nReturn one generated image, not a description or image URL.`;
  const result = await complete(key, model, {
    modalities: model.architecture.output_modalities.includes('text') ? ['image', 'text'] : ['image'],
    messages: [{ role: 'user', content: [composition, ...(reference ? [reference] : []), { type: 'text', text }] }],
    image_config: { aspect_ratio: input.ratio },
  });
  const image = result.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (typeof image !== 'string' || image.length > 40_000_000 || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image)) throw new Error('The free model returned no usable image. Your captured frames are still available.');
  return { image, model: model.id, requestedRatio: input.ratio };
}
