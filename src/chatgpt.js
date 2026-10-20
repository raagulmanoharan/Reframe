const $ = selector => document.querySelector(selector);
async function request(path, data) {
  const response = await fetch(`/api/${path}`, {
    method: data === undefined ? 'GET' : 'POST', credentials: 'same-origin',
    headers: data === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    signal: AbortSignal.timeout(45000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) {
    const error = new Error(result?.error || 'Cannot reach Reframe. Please try again.');
    error.status = response.status; throw error;
  }
  return result;
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
export function setupChatGPT({ onAccountChange = () => {} } = {}) {
  const dialog = $('#access-dialog');
  dialog.innerHTML = `<h2>Connect ChatGPT</h2>
    <p>Sign in once, then create your scene. Your ChatGPT plan and usage limits apply.</p>
    <p id="login-status" role="status"></p>
    <div id="device-login" hidden><p>Enter this code on OpenAI’s sign-in page:</p><strong id="device-code"></strong>
    <p><a id="device-link" target="_blank" rel="noopener noreferrer">Open ChatGPT sign-in ↗</a></p>
    <small>Return here after signing in. If asked, enable device code sign-in in your ChatGPT security settings.</small></div>
    <div class="dialog-actions"><button id="sign-out" class="quiet" hidden>Sign out</button><button id="cancel-access" class="quiet">Close</button><button id="chatgpt-login" class="primary">Sign in with ChatGPT</button></div>`;
  let waiting = null, polling = 0;
  const status = text => { $('#login-status').textContent = text; };
  async function refresh() {
    const account = await request('auth');
    if (account.state !== 'pending') onAccountChange(account.state === 'signedIn');
    $('#sign-out').hidden = account.state !== 'signedIn';
    $('#chatgpt-login').hidden = account.state === 'signedIn';
    if (account.state === 'signedIn') {
      $('#device-login').hidden = true; status('Connected to ChatGPT.');
    }
    return account.state;
  }
  async function show() {
    dialog.showModal();
    try {
      if (await refresh() === 'signedIn' && waiting) { waiting(true); waiting = null; dialog.close(); }
    } catch (error) { status(error.message); }
  }
  $('#access-settings').onclick = show;
  $('#cancel-access').onclick = () => dialog.close();
  dialog.addEventListener('close', () => {
    polling++; waiting?.(false); waiting = null;
    $('#chatgpt-login').disabled = false;
  });
  $('#sign-out').onclick = async () => {
    try { await request('auth/logout', {}); location.reload(); }
    catch (error) { status(error.message); }
  };
  async function beginLogin() {
    const attempt = ++polling;
    $('#chatgpt-login').disabled = true; status('Connecting to OpenAI…');
    try {
      const login = await request('auth/start', {});
      if (attempt !== polling) return;
      $('#device-code').textContent = login.userCode;
      $('#device-link').href = login.verificationUrl;
      $('#device-login').hidden = false;
      status('Finish signing in, then return to this tab.');
      const deadline = Date.now() + 15 * 60 * 1000;
      while (attempt === polling && Date.now() < deadline) {
        await pause(2500);
        if (attempt !== polling) return;
        const state = await refresh();
        if (state === 'signedIn') {
          waiting?.(true); waiting = null; dialog.close(); return;
        }
        if (state === 'failed' || state === 'signedOut') throw new Error('Sign-in did not finish. Please try again.');
      }
      if (attempt === polling) throw new Error('This sign-in code expired. Please try again.');
    } catch (error) { if (attempt === polling) status(error.message); }
    finally { if (attempt === polling) $('#chatgpt-login').disabled = false; }
  }
  $('#chatgpt-login').onclick = beginLogin;
  async function ensureSignedIn() {
    if (await refresh() === 'signedIn') return;
    const completed = new Promise(resolve => { waiting = resolve; });
    await show();
    if (waiting) void beginLogin();
    if (!await completed) throw new Error('Generation cancelled.');
  }
  const generate = async (path, payload) => {
    await ensureSignedIn();
    const { jobId } = await request(path === 'scene' ? 'scene' : 'photo', payload);
    const deadline = Date.now() + 330000;
    while (Date.now() < deadline) {
      await pause(1500);
      const job = await request(`jobs/${jobId}`);
      if (!job.pending) return job.result;
    }
    throw new Error('Generation timed out. Please try again.');
  };
  return Object.assign(generate, { signIn: ensureSignedIn, refresh });
}
