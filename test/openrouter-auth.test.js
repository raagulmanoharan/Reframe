import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createAuthorization, exchangeCode } from '../src/openrouter-auth.js';
test('authorization uses fresh S256 PKCE and preserves the GitHub Pages callback path', async () => {
  const a = await createAuthorization('https://example.github.io/Reframe/auth.html?old=value#fragment');
  const b = await createAuthorization('https://example.github.io/Reframe/auth.html');
  const url = new URL(a.url), callback = new URL(url.searchParams.get('callback_url'));
  assert.equal(url.origin, 'https://openrouter.ai'); assert.equal(url.pathname, '/auth');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('code_challenge'), createHash('sha256').update(a.verifier).digest('base64url'));
  assert.equal(callback.pathname, '/Reframe/auth.html'); assert.equal(callback.searchParams.get('state'), a.state);
  assert.equal(callback.searchParams.get('old'), null); assert.equal(callback.hash, '');
  assert.notEqual(a.verifier, b.verifier); assert.notEqual(a.state, b.state);
  assert.ok(!a.url.includes(a.verifier));
});
test('exchange rejects expired codes and never treats a provider error as a credential', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ error: 'expired' }, { status: 400 });
    await assert.rejects(exchangeCode('expired-code', 'x'.repeat(43)), /not completed/);
    globalThis.fetch = async () => Response.json({ key: 'not-a-key' });
    await assert.rejects(exchangeCode('code', 'x'.repeat(43)), /not completed/);
  } finally { globalThis.fetch = original; }
});
