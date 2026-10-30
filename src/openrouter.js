import { draftSchema, expandDraft, draftInstructions } from '../lib/scene-draft.js';
import { sceneBrief, notesInstruction } from '../lib/generation-input.js';
import { lensInstructions } from '../lib/camera-settings.js';

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
    (!(reference || photo) || model.architecture?.input_modalities?.includes('image')) &&
    (photo || (!model.top_provider?.max_completion_tokens || model.top_provider.max_completion_tokens >= 2048) && (!model.context_length || model.context_length >= 8192)));
  const score = model => (model.supported_parameters?.includes('structured_outputs') ? 4 : 0) -
    (photo ? 0 : model.reasoning?.mandatory ? 100 : model.supported_parameters?.includes('reasoning') && !model.reasoning ? 10 : 0);
  // Vision is required only for reference uploads, not preferred for text-only drafts.

  eligible.sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id));
  if (!eligible.length) throw new Error(photo
    ? 'OpenRouter currently lists no compatible free image-generation model. Your frames are saved in this tab. No paid model was used.'
    : reference ? 'OpenRouter currently lists no compatible free vision model. Try a text-only scene or check again later.'
      : 'OpenRouter currently lists no compatible free scene model. Please check again later.');
  return eligible[0];
}
async function request(path, { key, body, timeout = 120000, signal } = {}) {
  let response, result;
  try {
    response = await fetch(`${baseURL}/${path}`, {
      method: body ? 'POST' : 'GET', credentials: 'omit', referrerPolicy: 'no-referrer',
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout), cache: 'no-store',
    });
    result = await response.json();
  } catch (e) {
    if (signal?.aborted && signal.reason?.name !== 'TimeoutError') throw new Error('Scene generation stopped. Your message is still here.');
    const timedOut = e.name === 'TimeoutError' || e.name === 'AbortError' || signal?.reason?.name === 'TimeoutError';
    const error = new Error(timedOut ? 'The free provider took too long to respond. Please try again.' : 'Cannot read a response from OpenRouter. Please try again.');
    error.code = timedOut ? 'TIMEOUT' : 'NETWORK'; throw error;
  }
  if (!response.ok || result?.error) {
    const status = Number(result?.error?.code) || response.status;
    const messages = {
      400: 'The free model could not process this request. Please try again.',
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
export async function getFreeModels({ signal, timeout = 20000 } = {}) {
  const result = await request('models', { timeout, signal });
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
async function complete(key, model, body, { timeout = 240000, signal } = {}) {
  if (typeof key !== 'string' || !key.trim()) throw new Error('Enter your OpenRouter API key.');
  return request('chat/completions', { key, timeout, signal, body: {
    ...body, model: model.id, stream: false,
    provider: { allow_fallbacks: false, require_parameters: true, max_price: { prompt: '0', completion: '0', image: '0', request: '0' } },
  } });
}
function reasoningSettings(model) {
  if (!model.reasoning && !model.supported_parameters?.includes('reasoning')) return {};
  const allowed = model.reasoning?.supported_efforts;
  const order = model.reasoning?.mandatory ? ['minimal', 'low', 'medium'] : ['none', 'minimal', 'low'];
  const effort = order.find(value => !Array.isArray(allowed) || allowed.includes(value));
  return effort ? { reasoning: { effort } } : {};
}
export async function generateScene(key, input, { signal, onProgress = () => {} } = {}) {
  const reference = inputImage(input.reference), prompt = sceneBrief(input.prompt, reference);
  // Includes catalog lookup, both attempts and response-body reading.
  const deadline = AbortSignal.timeout(60000);
  const budget = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const models = await getFreeModels({ signal: budget, timeout: 10000 });
  const first = chooseModel(models, { reference: Boolean(reference) });
  let alternate;
  try { alternate = chooseModel(models.filter(model => model.id !== first.id), { reference: Boolean(reference) }); } catch { alternate = first; }
  const content = [{ type: 'text', text: prompt }]; if (reference) content.push(reference);
  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal?.aborted) throw new Error('Scene generation stopped. Your message is still here.');
    if (deadline.aborted) throw new Error('The free provider took too long to respond. Please try again.');
    const model = attempt ? alternate : first, maxObjects = attempt ? 10 : 18;
    const schema = draftSchema(maxObjects), structured = model.supported_parameters?.includes('structured_outputs');
    onProgress(attempt ? 'Trying a smaller draft with a free model…' : 'Creating your 3D draft…');
    const progressTimer = setTimeout(() => onProgress('Still waiting for the free provider. You can stop and try again.'), 15000);
    try {
      const result = await complete(key, model, {
        messages: [{ role: 'system', content: `${draftInstructions(maxObjects)}${structured ? '' : `\nJSON schema: ${JSON.stringify(schema)}`}` }, { role: 'user', content }],
        max_tokens: Math.min(attempt ? 2048 : 3072, model.top_provider?.max_completion_tokens || 4096),
        ...reasoningSettings(model),
        ...(structured ? { response_format: { type: 'json_schema', json_schema: { name: 'scene', strict: true, schema } } } : {}),
      }, { timeout: 35000, signal: budget });
      if (signal?.aborted) throw new Error('Scene generation stopped. Your message is still here.');
      const answer = result.choices?.[0];
      if (answer?.message?.refusal || answer?.finish_reason === 'content_filter') throw new Error('The free model declined this scene request.');
      try {
        const text = answer.message.content.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, '$1');
        // Some providers flag length after a complete JSON object; keep it only
        // when the whole object parses and all geometry passes validation.
        return { scene: expandDraft(JSON.parse(text), maxObjects), model: model.id };
      } catch {
        const error = new Error('The free model did not finish a usable 3D scene. Your prompt is fine—please try again.');
        error.code = 'INVALID_DRAFT'; throw error;
      }
    } catch (error) {
      const retryable = error.code === 'INVALID_DRAFT' || error.code === 'TIMEOUT' || [404, 408, 500, 502, 503].includes(error.status) || error.status === 400 && alternate.id !== first.id;
      if (attempt || signal?.aborted || deadline.aborted || !retryable) throw error;
    } finally { clearTimeout(progressTimer); }
  }
}
export async function generatePhoto(key, input) {
  const composition = inputImage(input.composition, true), reference = inputImage(input.reference);
  const prompt = sceneBrief(input.prompt, reference), notes = notesInstruction(input.notes), camera = lensInstructions(input.lens);
  if (!['1:1', '4:3', '9:16', '16:9'].includes(input.ratio)) throw new Error('Invalid aspect ratio.');
  const model = chooseModel(await getFreeModels(), { photo: true });
  const text = `Turn the FIRST image, a low-poly composition, into a photorealistic photograph. Preserve its camera viewpoint, framing, perspective, object positions, scale and spatial relationships. Refine the block shapes into realistic forms. Scene: ${prompt}. Aspect ratio: ${input.ratio}. ${reference ? 'The SECOND image is the product reference: preserve its design, colors, proportions and distinctive details. It defines appearance, not composition.' : ''}${notes}${camera}\nReturn one generated image, not a description or image URL.`;
  const result = await complete(key, model, {
    modalities: model.architecture.output_modalities.includes('text') ? ['image', 'text'] : ['image'],
    messages: [{ role: 'user', content: [composition, ...(reference ? [reference] : []), { type: 'text', text }] }],
    image_config: { aspect_ratio: input.ratio },
  });
  const image = result.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (typeof image !== 'string' || image.length > 40_000_000 || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image)) throw new Error('The free model returned no usable image. Your captured frames are still available.');
  return { image, model: model.id, requestedRatio: input.ratio };
}
