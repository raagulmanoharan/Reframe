import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server/index.js';
import { AppError, CodexSession, validateInput } from '../server/codex.js';
import { readFile } from 'node:fs/promises';

const scene = JSON.parse(await readFile(new URL('../tests/fixtures/scene.json', import.meta.url)));
class FakeWorker {
  async init() { this.state = 'pending'; return this; }
  async startLogin() { return { userCode: 'TEST-CODE', verificationUrl: 'https://auth.openai.com/codex/device' }; }
  async account() { return { state: this.state }; }
  async generate(kind, input) {
    this.input = input;
    return new Promise((resolve, reject) => { this.complete = resolve; this.reject = reject; });
  }
  async close() { this.closed = true; this.reject?.(new AppError('Signed out.', 401)); }
}
async function fixture(t, options = {}) {
  const workers = [];
  const app = createApp({ secure: false, workerFactory: () => { const w = new FakeWorker(); workers.push(w); return w; }, ...options });
  app.listen(0, '127.0.0.1'); await once(app, 'listening');
  t.after(() => { app.closeAllConnections(); app.close(); });
  const origin = `http://127.0.0.1:${app.address().port}`;
  const call = (path, data, cookie = '', extra = {}) => fetch(`${origin}/api/${path}`, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { origin, cookie, 'content-type': 'application/json', ...extra },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  const login = async () => {
    const response = await call('auth/start', {});
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie').split(';')[0];
  };
  return { call, login, workers, origin };
}
test('sessions keep accounts and generated jobs isolated; logout destroys runtime', async t => {
  const { call, login, workers } = await fixture(t);
  const cookieA = await login(), cookieB = await login();
  assert.notEqual(cookieA, cookieB);
  assert.equal((await call('scene', { prompt: 'A sofa' }, cookieA)).status, 401);
  workers[0].state = 'signedIn';
  const started = await call('scene', { prompt: 'A sofa' }, cookieA);
  assert.equal(started.status, 202);
  const { jobId } = await started.json();
  assert.equal((await call('scene', { prompt: 'Another scene' }, cookieA)).status, 409);
  assert.equal((await call(`jobs/${jobId}`, undefined, cookieB)).status, 404);
  assert.deepEqual(await (await call('auth', undefined, cookieB)).json(), { state: 'pending' });
  assert.deepEqual(await (await call(`jobs/${jobId}`, undefined, cookieA)).json(), { pending: true });
  workers[0].complete({ scene }); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(await (await call(`jobs/${jobId}`, undefined, cookieA)).json(), { result: { scene } });
  assert.equal((await call('auth/logout', {}, cookieA)).status, 200);
  assert.equal(workers[0].closed, true);
  assert.equal(workers[1].closed, undefined);
  assert.equal((await call(`jobs/${jobId}`, undefined, cookieA)).status, 401);
});
test('rejects CSRF, invalid requests, unknown jobs and excess sessions', async t => {
  const { call, login, workers } = await fixture(t, { maxSessions: 1 });
  assert.equal((await call('auth/start', {}, '', { origin: 'https://attacker.example' })).status, 403);
  assert.equal((await call('auth/start', {}, '', { 'content-type': 'text/plain' })).status, 415);
  assert.equal(workers.length, 0);
  const cookie = await login(); workers[0].state = 'signedIn';
  assert.equal((await call('auth/start', {})).status, 429);
  assert.equal((await call('photo', { prompt: 'sofa', composition: 'file:///etc/passwd', ratio: '4:3' }, cookie)).status, 400);
  assert.equal((await call('scene', { prompt: '' }, cookie)).status, 400);
  assert.equal((await call('scene', { prompt: 'sofa' })).status, 401);
  assert.equal((await call('jobs/unknown', undefined, cookie)).status, 404);
});
test('provider failure is returned honestly without a fabricated result', async t => {
  const { call, login, workers } = await fixture(t);
  const cookie = await login(); workers[0].state = 'signedIn';
  const { jobId } = await (await call('scene', { prompt: 'sofa' }, cookie)).json();
  workers[0].reject(new AppError('Image usage limit reached.', 429));
  workers[0].closed = true;
  await new Promise(resolve => setImmediate(resolve));
  const response = await call(`jobs/${jobId}`, undefined, cookie);
  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), { error: 'Image usage limit reached.' });
});
test('Codex contract uses ephemeral threads, disables environment access and validates final scenes', async () => {
  const worker = new CodexSession(), calls = [];
  worker.loginState = 'signedIn'; worker.directory = '/tmp/test-reframe';
  worker.request = async (method, params) => {
    calls.push({ method, params });
    if (method === 'account/read') return { account: { type: 'chatgpt' } };
    if (method === 'thread/start') return { thread: { id: 'test-thread' } };
    if (method === 'turn/start') {
      worker.emit('notification', { method: 'item/completed', params: { threadId: 'different-user', item: { id: 'bad', type: 'agentMessage', text: '{}' } } });
      worker.emit('notification', { method: 'item/completed', params: { threadId: 'test-thread', item: { id: 'result', type: 'agentMessage', text: JSON.stringify(scene) } } });
      worker.emit('notification', { method: 'turn/completed', params: { threadId: 'test-thread', turn: { status: 'completed' } } });
      return { turn: { id: 'test-turn' } };
    }
    return {};
  };
  assert.deepEqual(await worker.generate('scene', { prompt: 'An observatory' }), { scene });
  const thread = calls.find(call => call.method === 'thread/start').params;
  assert.equal(thread.ephemeral, true); assert.deepEqual(thread.environments, []);
  assert.equal(thread.approvalPolicy, 'never'); assert.equal(thread.sandbox, 'read-only');
  assert.ok(calls.find(call => call.method === 'turn/start').params.outputSchema);
  assert.equal(worker.listenerCount('notification'), 0);
});
test('image requests use the composition and reference in order and require a real image event', async () => {
  const worker = new CodexSession(); worker.loginState = 'signedIn'; worker.directory = '/tmp/test-reframe';
  const composition = 'data:image/png;base64,Y29tcG9zaXRpb24=', reference = 'data:image/png;base64,cmVmZXJlbmNl';
  let input;
  worker.request = async (method, params) => {
    if (method === 'account/read') return { account: { type: 'chatgpt' } };
    if (method === 'modelProvider/capabilities/read') return { imageGeneration: true };
    if (method === 'thread/start') return { thread: { id: 'image-thread' } };
    if (method === 'turn/start') {
      input = params.input;
      worker.emit('notification', { method: 'item/completed', params: { threadId: 'image-thread', item: { id: 'image', type: 'imageGeneration', status: 'completed', result: 'aW1hZ2U=' } } });
      worker.emit('notification', { method: 'turn/completed', params: { threadId: 'image-thread', turn: { status: 'completed' } } });
    }
    return {};
  };
  const result = await worker.generate('photo', { prompt: 'sofa', composition, reference, ratio: '4:3', notes: 'Keep the blue fabric.' });
  assert.deepEqual(input.slice(0, 2), [{ type: 'image', url: composition }, { type: 'image', url: reference }]);
  assert.match(input[2].text, /num_last_images_to_include=2/);
  assert.match(input[2].text, /Keep the blue fabric/);
  assert.match(input[2].text, /highest available detail/);
  assert.equal(result.image, 'data:image/png;base64,aW1hZ2U=');
  assert.throws(() => validateInput('photo', { prompt: 'sofa', composition: '/etc/passwd', ratio: '4:3' }));
  assert.throws(() => validateInput('photo', { prompt: 'sofa', composition, ratio: '4:3', notes: 'x'.repeat(1001) }), /notes/);
  assert.match(validateInput('scene', { reference }).prompt, /reference image/);
});
