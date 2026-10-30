import './style.css';
const params = new URLSearchParams(location.search);
const code = params.get('code'), state = params.get('state'), error = params.get('error');
// Remove the one-time authorization code before rendering or opening any link.
history.replaceState(null, '', location.pathname);
const status = document.querySelector('#auth-return-status');
if (!state || !/^[A-Za-z0-9_-]{43}$/.test(state) || (!code && !error)) {
  status.textContent = 'This sign-in link is incomplete. Return to Reframe and start sign-in again.';
} else {
  const payload = { type: 'reframe-openrouter-callback', state, code, error: Boolean(error) };
  let delivered = false;
  if (window.opener) {
    try { window.opener.postMessage(payload, location.origin); delivered = true; } catch { /* Try the same-origin channel below. */ }
  }
  if ('BroadcastChannel' in window) {
    const channel = new BroadcastChannel(`reframe-openrouter-${state}`);
    channel.onmessage = event => {
      if (event.data?.type !== 'reframe-openrouter-finished' || event.data.state !== state) return;
      status.textContent = event.data.success ? 'Connected. Return to your original Reframe tab.' : 'Sign-in did not finish. Return to Reframe to try again.';
      channel.close(); if (event.data.success) window.close();
    };
    channel.postMessage(payload); delivered = true;
    setTimeout(() => channel.close(), 5 * 60 * 1000);
  }
  if (!delivered) status.textContent = 'The original Reframe tab is unavailable. Return to Reframe and sign in again.';
}
