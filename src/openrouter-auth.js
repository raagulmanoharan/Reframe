const encode = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export async function createAuthorization(callbackURL) {
  const verifier = encode(crypto.getRandomValues(new Uint8Array(32)));
  const state = encode(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const callback = new URL(callbackURL); callback.search = ''; callback.hash = '';
  // Bind state into the callback URL, which OpenRouter returns with the code.
  callback.searchParams.set('state', state);
  const url = new URL('https://openrouter.ai/auth');
  url.searchParams.set('callback_url', callback.href);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return { url: url.href, verifier, state };
}
export async function exchangeCode(code, verifier, signal) {
  if (typeof code !== 'string' || !code || code.length > 2048 || !/^[A-Za-z0-9_-]{43}$/.test(verifier)) throw new Error('Invalid sign-in response. Please sign in again.');
  let response;
  try {
    response = await fetch('https://openrouter.ai/api/v1/auth/keys', {
      method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
    });
  } catch { throw new Error('Could not finish OpenRouter sign-in. Please try again.'); }
  const data = await response.json().catch(() => null);
  if (!response.ok || typeof data?.key !== 'string' || !data.key.startsWith('sk-or-') || data.key.length > 1024) throw new Error('OpenRouter sign-in was not completed. Please try again.');
  return data.key;
}
export function startOpenRouterLogin() {
  // Open synchronously from the button click, before asynchronous crypto work,
  // so mobile browsers can recognize this as a user-initiated sign-in window.
  const popup = window.open('about:blank', '_blank', 'popup,width=500,height=720');
  if (!popup) return { promise: Promise.reject(new Error('Allow the sign-in window, then try again.')), cancel() {} };
  let cancel;
  const promise = new Promise((resolve, reject) => {
    let settled = false, exchanging = false, authorization, channel;
    const controller = new AbortController();
    const cleanup = () => {
      clearTimeout(deadline); window.removeEventListener('message', receiveWindow); channel?.close(); controller.abort();
      try { popup.close(); } catch { /* A provider may isolate the popup. */ }
    };
    const finish = (error, key) => {
      if (settled) return; settled = true;
      channel?.postMessage({ type: 'reframe-openrouter-finished', state: authorization?.state, success: !error });
      cleanup(); error ? reject(error) : resolve(key);
    };
    cancel = () => finish(new Error('Sign-in cancelled.'));
    const deadline = setTimeout(() => finish(new Error('Sign-in expired. Please try again.')), 5 * 60 * 1000);
    async function receive(data) {
      if (settled || exchanging || !authorization || data?.type !== 'reframe-openrouter-callback' || data.state !== authorization.state) return;
      if (data.error) { finish(new Error('OpenRouter sign-in was cancelled or declined.')); return; }
      if (typeof data.code !== 'string' || !data.code || data.code.length > 2048) { finish(new Error('Invalid sign-in response. Please try again.')); return; }
      exchanging = true;
      try { const key = await exchangeCode(data.code, authorization.verifier, controller.signal); finish(null, key); }
      catch (error) { finish(error); }
    }
    function receiveWindow(event) {
      if (event.origin === location.origin && event.source === popup) void receive(event.data);
    }
    window.addEventListener('message', receiveWindow);
    createAuthorization(new URL('auth.html', location.href).href).then(result => {
      if (settled) return; authorization = result;
      // BroadcastChannel also handles providers that sever window.opener via COOP.
      if ('BroadcastChannel' in window) {
        channel = new BroadcastChannel(`reframe-openrouter-${authorization.state}`);
        channel.onmessage = event => { void receive(event.data); };
      }
      popup.location.href = authorization.url;
    }).catch(() => finish(new Error('Could not open secure sign-in. Please try again.')));
  });
  return { promise, cancel: () => cancel?.() };
}
