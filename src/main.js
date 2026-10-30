import './style.css';
import { createIcons, CircleHelp, ImagePlus, ArrowUpRight, ArrowUp, ArrowLeft, RotateCcw, Download, X, Camera, MessageSquare, SquarePen, UserRound, Ellipsis, Plus, Aperture, Armchair, Gem, Factory, Box } from 'lucide';
import { createStudio } from './studio.js';
import { generateScene, generatePhoto } from './ai.js';
import * as openrouter from './openrouter.js';
import { startOpenRouterLogin } from './openrouter-auth.js';
import { setupChatGPT } from './chatgpt.js';
import { addNode, additionBrief, mergeAddition } from '../lib/scene-additions.js';
const icons = { CircleHelp, ImagePlus, ArrowUpRight, ArrowUp, ArrowLeft, RotateCcw, Download, X, Camera, MessageSquare, SquarePen, UserRound, Ellipsis, Plus, Aperture, Armchair, Gem, Factory, Box };
const $ = selector => document.querySelector(selector);
const iconify = () => createIcons({ icons });
const aiMode = import.meta.env.VITE_AI_MODE || 'openrouter';
const hosted = aiMode === 'chatgpt';
const useOpenRouter = aiMode === 'openrouter';
let freePhotoAvailable = null, loginAttempt = null;
let current = null, shots = [], shotId = 0, reference = null, studio, busy = false, activeTurn = null, resultOrdinal = 0;
let timer, accessCode = '', resolveCode, activeShot = null, notes = '', loggedIn = false;
let pendingAddition = null, additionController = null, selectedObject = null;
function toast(text) { $('#toast').textContent = text; $('#toast').classList.add('show'); clearTimeout(timer); timer = setTimeout(() => $('#toast').classList.remove('show'), 3500); }
function error(text = '') { $('#error').textContent = text; $('#error').hidden = !text; }
function message(e) { return e.name === 'TimeoutError' ? 'Generation timed out. Please try again.' : e instanceof TypeError ? 'Cannot reach the AI service. Please try again.' : e.message; }
function setBusy(value, text = '') {
  busy = value;
  $('#build').disabled = value || !studio;
  document.querySelectorAll('.open-studio, .retry-render').forEach(button => { button.disabled = value; });
  $('#new-chat').disabled = value;
  studio?.setEnabled(!value);
  for (const id of ['exit-studio', 'reset', 'ratio', 'object-select', 'camera-zoom', 'camera-focus', 'camera-blur']) $(`#${id}`).disabled = value;
  $('#object-height').disabled = value || !selectedObject;
  $('#object-scale').disabled = value || !selectedObject;
  $('#status').textContent = text;
  $('#status').setAttribute('aria-busy', String(value));
  updateShotControls();
}
function scrollChat() {
  requestAnimationFrame(() => $('#chat-scroll').scrollTo({ top: $('#chat-scroll').scrollHeight, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }));
}
function appendMessage(node) {
  $('#chat-intro').hidden = true; $('#chat-thread').append(node); scrollChat();
}
function userMessage(text, images = [], className = '') {
  const node = document.createElement('article'); node.className = `chat-message user-message ${className}`; node.setAttribute('aria-label', 'Your message');
  const bubble = document.createElement('div'); bubble.className = 'user-bubble';
  if (images.length) {
    const grid = document.createElement('div'); grid.className = `message-images${images.length === 1 ? ' single-image' : ''}`;
    for (const [index, item] of images.entries()) {
      const figure = document.createElement('figure'), image = document.createElement('img');
      image.src = item.src; image.alt = item.alt; figure.append(image);
      if (className === 'studio-submission') {
        const caption = document.createElement('figcaption'); caption.textContent = `Frame ${index + 1}`; figure.append(caption);
      }
      if (item.note) { const note = document.createElement('p'); note.className = 'submitted-note'; note.textContent = item.note; figure.append(note); }
      grid.append(figure);
    }
    bubble.append(grid);
  }
  if (text) { const copy = document.createElement('p'); copy.textContent = text; bubble.append(copy); }
  node.append(bubble); appendMessage(node); return node;
}
function clearReference() {
  referenceVersion++; reference = null; $('#reference').value = '';
  $('#upload-icon').replaceChildren(); $('#upload-title').textContent = 'Reference photo';
  $('#reference-preview').hidden = true; $('#remove-reference').hidden = true;
}
function resizeComposer() {
  $('#prompt').style.height = 'auto'; $('#prompt').style.height = `${Math.min(144, $('#prompt').scrollHeight)}px`;
}
$('#prompt').addEventListener('input', resizeComposer);
$('#prompt').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && matchMedia('(pointer: fine)').matches) {
    event.preventDefault(); $('#brief-form').requestSubmit();
  }
});
// Keep the floating composer above the on-screen keyboard on iOS.
function syncViewport() {
  if (!window.visualViewport) return;
  document.documentElement.style.setProperty('--app-height', `${window.visualViewport.height}px`);
  document.documentElement.style.setProperty('--app-top', `${window.visualViewport.offsetTop}px`);
}
window.visualViewport?.addEventListener('resize', syncViewport);
window.visualViewport?.addEventListener('scroll', syncViewport); syncViewport();
function updateShotControls() {
  $('#capture').disabled = busy || Boolean(pendingAddition) || !current || shots.length >= 4;
  $('#render').disabled = busy || freePhotoAvailable === false || !shots.some(shot => !shot.photo);
  $('#shot-count').textContent = `${shots.length} / 4 frames`;
  $('#studio-hint').textContent = pendingAddition ? 'Regenerate your new element before capturing a frame.' : freePhotoAvailable === false ? 'Free photo generation is unavailable. Check Account for updates.' : !shots.length ? 'Capture a frame to get started.' : shots.length === 4 ? 'Four frames. Ready when you are.' : `${shots.length} frame${shots.length === 1 ? '' : 's'} ready. Add more or let’s go.`;
  $('#add-element').disabled = busy || Boolean(pendingAddition);
  $('#regenerate').disabled = busy;
  $('#cancel-addition').disabled = busy && !useOpenRouter;
  $('#cancel-addition').setAttribute('aria-label', busy ? 'Stop regeneration' : 'Remove placeholder');
  $('#addition-controls').hidden = !pendingAddition;
  $('#addition-name').textContent = pendingAddition?.description || '';
}
async function refreshFreeAvailability() {
  if (!useOpenRouter) return;
  $('#refresh-models').disabled = true;
  try {
    const available = await openrouter.getAvailability(); freePhotoAvailable = Boolean(available.photo);
    const notice = !available.scene ? 'No free scene model is available right now. Check again in Account.' : !available.photo ? 'Free 3D scenes are available. Final photos are unavailable until OpenRouter offers a compatible free image model.' : '';
    $('#provider-notice').textContent = notice; $('#provider-notice').hidden = !notice;
    $('#provider-availability').textContent = `Scene: ${available.scene || 'unavailable'}. Photo: ${available.photo || 'no compatible free model'}.`;
  } catch (e) {
    freePhotoAvailable = null; $('#provider-availability').textContent = message(e);
    $('#provider-notice').textContent = 'Free-model availability could not be checked. Open Account to try again.'; $('#provider-notice').hidden = false;
  } finally { $('#refresh-models').disabled = false; updateShotControls(); }
}
function closeStudio() {
  if (busy) return;
  if (activeTurn && !$('#studio-panel').hidden) { activeTurn.view = studio.capture(); activeTurn.shots = shots; Object.assign(activeTurn, current); activeTurn.addition = pendingAddition; }
  $('#studio-panel').hidden = true; $('#notes-panel').hidden = true; $('#element-form').hidden = true; showCameraControls(false);
  $('#toast').classList.remove('show');
  $('#app').inert = false; document.body.style.overflow = ''; studio?.setActive(false);
  activeTurn?.button.focus({ preventScroll: true });
}
function accountChanged(signedIn) {
  $('#welcome').hidden = signedIn; $('#conversation').hidden = !signedIn;
  $('#account-label').textContent = signedIn ? 'Account' : 'Sign in';
  $('#access-settings').setAttribute('aria-label', signedIn ? 'Account' : 'Sign in');
  if (!signedIn && loggedIn) closeStudio();
  loggedIn = signedIn;
}
const chatgpt = hosted ? setupChatGPT({ onAccountChange: accountChanged }) : null;
if (hosted) {
  $('#welcome').hidden = false;
  $('#welcome-login').onclick = async () => {
    $('#welcome-login').disabled = true; $('#welcome-status').textContent = '';
    try { await chatgpt.signIn(); $('#prompt').focus(); }
    catch (e) { $('#welcome-status').textContent = message(e); }
    finally { $('#welcome-login').disabled = false; }
  };
  chatgpt.refresh().catch(() => { $('#welcome-status').textContent = 'Sign in to connect your ChatGPT account.'; });
  $('#privacy-note').textContent = 'Prompts, images and notes pass through Reframe to OpenAI. ChatGPT sign-in uses a device code and lasts for this session. Download images before reloading. Your plan’s access and usage limits apply.';
} else {
  $('#conversation').hidden = false;
  if (useOpenRouter) {
    $('#access-form h2').textContent = 'Connect OpenRouter';
    $('#access-form > p').textContent = 'Sign in to OpenRouter and authorize Reframe. Your connection lasts for this tab. Free models have usage limits and may be unavailable.';
    $('#access-form label').textContent = 'OpenRouter API key';
    $('#openrouter-settings').hidden = false;
    $('#openrouter-login').hidden = false;
    const manual = document.createElement('details'); manual.className = 'manual-key-details';
    const summary = document.createElement('summary'); summary.textContent = 'Use an API key instead'; manual.append(summary);
    $('#manual-key-entry').before(manual); manual.append($('#manual-key-entry'), $('#save-access-key'));
    $('#manual-key-entry').append($('#openrouter-settings a'));
    $('#save-access-key').style.marginTop = '12px';
    $('#forget-key').hidden = true;
    $('#cancel-access').textContent = 'Close';
    $('#openrouter-sign-in').onclick = async () => {
      if (loginAttempt) return;
      const attempt = startOpenRouterLogin(); loginAttempt = attempt;
      $('#openrouter-sign-in').disabled = true;
      $('#openrouter-login-status').textContent = 'Finish signing in with OpenRouter, then return here. Close this dialog to cancel.';
      try {
        const key = await attempt.promise;
        if (loginAttempt !== attempt) return;
        acceptKey(key); toast('Connected to OpenRouter.');
      } catch (e) {
        if (loginAttempt === attempt) $('#openrouter-login-status').textContent = message(e);
      } finally {
        if (loginAttempt === attempt) loginAttempt = null;
        $('#openrouter-sign-in').disabled = false;
      }
    };
    $('#openrouter-disconnect').onclick = () => {
      accessCode = ''; $('#access-code').value = ''; updateOpenRouterAccount();
      $('#openrouter-login-status').textContent = 'Disconnected from this tab.';
    };
    $('#privacy-note').textContent = 'OpenRouter sign-in authorizes an app-specific key, kept only in tab memory. Disconnect or reload clears it here; you can revoke it in OpenRouter settings. Prompts and images go to OpenRouter and the selected provider; their data policies and usage limits apply.';
    $('#refresh-models').onclick = refreshFreeAvailability;
  }
  $('#access-form').onsubmit = event => {
    event.preventDefault(); const key = $('#access-code').value.trim(); if (key) acceptKey(key);
  };
  $('#access-dialog').addEventListener('close', () => {
    const attempt = loginAttempt; loginAttempt = null; attempt?.cancel();
    if (useOpenRouter && attempt && !accessCode) $('#openrouter-login-status').textContent = 'Sign-in cancelled. You can try again.';
    resolveCode?.(null); resolveCode = null;
  });
  $('#cancel-access').onclick = () => $('#access-dialog').close();
  $('#access-settings').onclick = () => $('#access-dialog').showModal();
  $('#forget-key').onclick = () => { accessCode = ''; $('#access-code').value = ''; $('#access-dialog').close(); toast('API key removed.'); };
}
function updateOpenRouterAccount() {
  if (!useOpenRouter) return;
  $('#openrouter-sign-in').hidden = Boolean(accessCode); $('#openrouter-disconnect').hidden = !accessCode;
  $('#account-label').textContent = accessCode ? 'Connected to OpenRouter' : 'Account';
  $('#openrouter-login-status').textContent = accessCode ? 'Connected to OpenRouter for this tab.' : '';
}
function acceptKey(key) {
  accessCode = key; $('#access-code').value = ''; updateOpenRouterAccount();
  const resolve = resolveCode; resolveCode = null;
  $('#access-dialog').close(); resolve?.(key);
}
async function api(path, payload, options = {}) {
  if (chatgpt) return chatgpt(path, payload);
  if (!accessCode) {
    $('#access-dialog').showModal();
    const code = await new Promise(resolve => { resolveCode = resolve; });
    if (!code) throw new Error('Generation cancelled.');
  }
  if (options.signal?.aborted) throw new Error('Scene generation stopped. Your message is still here.');
  const provider = useOpenRouter ? openrouter : { generateScene, generatePhoto };
  try { return await (path === 'scene' ? provider.generateScene(accessCode, payload, options) : provider.generatePhoto(accessCode, payload)); }
  catch (e) { if (e.status === 401) { accessCode = ''; updateOpenRouterAccount(); } throw e; }
}
try {
  studio = createStudio($('#canvas-wrap'), $('#ratio'), (selection, canUndo) => {
    selectedObject = selection;
    $('#object-select').value = selection ? String(selection.index) : '';
    $('#object-height').disabled = busy || !selection; $('#object-scale').disabled = busy || !selection;
    if (selection) {
      $('#object-height').min = Math.min(0, selection.height);
      $('#object-height').max = Math.max(10, Math.ceil(selection.height));
      $('#object-height').value = selection.height;
      $('#object-scale').value = selection.scale;
    }
    $('#undo-move').disabled = busy || !canUndo;
  }, lens => {
    $('#camera-zoom').value = lens.zoom; $('#camera-zoom-value').textContent = `${lens.zoom.toFixed(1)}×`;
    $('#camera-focus').value = Math.log(lens.focusDistance / 0.1) / Math.log(2000) * 100;
    $('#camera-focus').setAttribute('aria-valuetext', `${lens.focusDistance.toFixed(1)} scene units`);
    $('#camera-focus-value').textContent = lens.focusDistance.toFixed(1);
    $('#camera-blur').value = lens.blur; $('#camera-blur-value').textContent = lens.blur ? `${Math.round(lens.blur)}%` : 'Off';
    $('#camera-focus-subject').textContent = lens.focusTarget ? `Focus: ${lens.focusTarget.group}` : 'Tap an object to focus. Blur softens other depths.';
  });
} catch { $('#webgl-error').hidden = false; }
function populateObjects() {
  $('#object-select').replaceChildren(new Option('Select an object', ''));
  for (const object of studio.getObjects()) $('#object-select').add(new Option(object.name, String(object.index)));
}
$('#object-select').onchange = event => { studio.selectObject(event.target.value === '' ? null : Number(event.target.value)); studio.focusSelected(); };
$('#object-height').oninput = event => studio.setHeight(Number(event.target.value));
$('#object-scale').oninput = event => studio.setScale(Number(event.target.value));
$('#undo-move').onclick = () => studio.undoMove();
$('#reset').onclick = () => studio?.reset(); $('#ratio').onchange = () => studio?.resize();
function showCameraControls(show) {
  $('#camera-controls').hidden = !show; $('#camera-settings').setAttribute('aria-expanded', String(show));
}
$('#camera-settings').onclick = () => showCameraControls($('#camera-controls').hidden);
$('#camera-zoom').oninput = event => studio.setZoom(Number(event.target.value));
$('#camera-focus').oninput = event => studio.setFocusDistance(Math.min(200, 0.1 * 2000 ** (Number(event.target.value) / 100)));
$('#camera-blur').oninput = event => studio.setBlur(Number(event.target.value));

function openStudio(turn) {
  if (!turn || busy) return;
  activeTurn = turn; current = { prompt: turn.prompt, reference: turn.reference }; shots = turn.shots;
  pendingAddition = turn.addition || null;
  studio.restore(turn.view); populateObjects(); activeShot = null; notes = '';
  $('#studio-error').hidden = true; $('#addition-status').textContent = 'Move and resize the placeholder, then regenerate.';
  $('#frame-note').value = ''; $('#note-label').textContent = 'Add note'; $('#scene-name').textContent = turn.title; updateShots();
  $('#studio-panel').hidden = false; $('#app').inert = true; document.body.style.overflow = 'hidden';
  studio.setActive(true); $('#exit-studio').focus({ preventScroll: true });
}
$('#exit-studio').onclick = closeStudio;
function studioError(text = '') { $('#studio-error').textContent = text; $('#studio-error').hidden = !text; }
$('#add-element').onclick = () => {
  if (busy || pendingAddition) return;
  studioError(); $('#element-form').hidden = false; $('#element-description').focus();
};
$('#close-element').onclick = () => { $('#element-form').hidden = true; $('#add-element').focus(); };
$('#element-form').onsubmit = event => {
  event.preventDefault(); if (busy || pendingAddition) return;
  try {
    const description = $('#element-description').value.trim();
    if (`${current.prompt}\nAlso include: ${description}`.length > 4000) throw new Error('This scene description is full. Start a new scene to add more elements.');
    const view = studio.capture(), result = addNode(view.scene, description, view.target);
    studio.replaceScene(result.scene); pendingAddition = result.addition; activeTurn.addition = pendingAddition; activeShot = null;
    populateObjects(); studio.selectObject(studio.getObjects().find(o => o.name === pendingAddition.group).index);
    $('#element-form').hidden = true; $('#element-description').value = ''; studioError();
    $('#addition-status').textContent = 'Move and resize the placeholder, then regenerate.';
    updateShotControls(); $('#regenerate').focus();
  } catch (e) { studioError(message(e)); }
};
$('#cancel-addition').onclick = () => {
  if (busy) { additionController?.abort(); return; }
  if (!pendingAddition) return;
  const scene = studio.snapshot(); scene.objects = scene.objects.filter(o => o.group !== pendingAddition.group);
  studio.replaceScene(scene); pendingAddition = null; activeTurn.addition = null;
  populateObjects(); updateShotControls(); studioError(); $('#add-element').focus();
};
$('#regenerate').onclick = async () => {
  if (busy || !pendingAddition) return;
  const addition = { ...pendingAddition }, before = studio.snapshot();
  additionController = new AbortController(); studioError(); setBusy(true, 'Adding your element…');
  $('#addition-status').textContent = 'Creating your new element…';
  try {
    const data = await api('scene', { prompt: additionBrief(before, addition) }, {
      signal: additionController.signal,
      onProgress: text => { $('#addition-status').textContent = text; },
    });
    if (additionController.signal.aborted) throw new Error('Regeneration stopped. Your placeholder is ready to try again.');
    const next = mergeAddition(before, data.scene, addition);
    studio.replaceScene(next); current = { ...current, prompt: `${current.prompt}\nAlso include: ${addition.description}` };
    Object.assign(activeTurn, current); pendingAddition = null; activeTurn.addition = null;
    activeTurn.view = studio.capture();
    activeTurn.button.closest('.scene-card').querySelector('.scene-preview').src = activeTurn.view.composition;
    populateObjects(); studio.selectObject(studio.getObjects().find(o => o.name === addition.group).index);
    toast('Element added. Your composition is ready.');
  } catch (e) {
    studioError(additionController.signal.aborted ? 'Regeneration stopped. Your placeholder is ready to try again.' : message(e));
    $('#addition-status').textContent = 'Your scene is unchanged. Try Regenerate again.';
  } finally { additionController = null; setBusy(false); }
};
// Keep keyboard navigation inside the full-screen studio, including its note sheet.
$('#studio-panel').addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    if (!$('#notes-panel').hidden) { $('#notes-panel').hidden = true; $('#annotate').focus(); }
    else if (!$('#element-form').hidden) { $('#element-form').hidden = true; $('#add-element').focus(); }
    else if (!$('#camera-controls').hidden) { showCameraControls(false); $('#camera-settings').focus(); }
    else closeStudio();
  }
  if (event.key === 'Tab') {
    const scope = $('#notes-panel').hidden ? $('#studio-panel') : $('#notes-panel');
    const focusable = [...scope.querySelectorAll('button:not(:disabled),select:not(:disabled),input:not(:disabled),textarea')].filter(el => el.getClientRects().length);
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});
const prompts = {
  living: 'A sculptural sofa in a warm, sunlit living room. Olive upholstery, an oak coffee table, and a tall plant.',
  jewellery: 'An emerald ring on black stone with a dramatic side light. Gold details and a quiet editorial composition.',
  industrial: 'An industrial smelting complex with tall chimneys, steel silos, gantries, and a loading yard.',
};
document.querySelectorAll('.preset').forEach(button => button.onclick = () => { $('#prompt').value = prompts[button.dataset.scene]; resizeComposer(); $('#prompt').focus(); });
$('#brief-form').onsubmit = async event => {
  event.preventDefault(); if (busy || !studio) return;
  const typedPrompt = $('#prompt').value.trim();
  if (!typedPrompt && !reference) { error('Describe a scene, add an image, or both.'); return; }
  const prompt = typedPrompt || 'Create a photographic scene centered on the subject in this reference image.';
  const sceneReference = reference;
  const sent = userMessage(typedPrompt, sceneReference ? [{ src: sceneReference, alt: 'Your reference photo' }] : []);
  $('#prompt').value = ''; resizeComposer(); clearReference();
  const pending = document.createElement('article'); pending.className = 'chat-message assistant-message thinking-message';
  pending.innerHTML = '<span class="thinking-dot"></span><span class="thinking-label">Setting the scene…</span>';
  const controller = new AbortController();
  if (useOpenRouter) {
    const stop = document.createElement('button'); stop.type = 'button'; stop.className = 'quiet stop-scene'; stop.textContent = 'Stop';
    stop.onclick = () => { controller.abort(); stop.disabled = true; }; pending.append(stop);
  }
  appendMessage(pending);
  error(); setBusy(true, 'Arranging your scene…');
  try {
    const data = await api('scene', { prompt, reference: sceneReference }, {
      signal: controller.signal,
      onProgress: text => { if (pending.isConnected) pending.querySelector('.thinking-label').textContent = text; },
    });
    // Each response retains its own scene and frames when another message is sent.
    if (activeTurn) activeTurn.shots = shots;
    studio.setScene(data.scene); current = { prompt, reference: sceneReference }; pendingAddition = null;
    shots = []; notes = ''; activeShot = null; $('#frame-note').value = ''; $('#note-label').textContent = 'Add note';
    for (const id of ['scene-card', 'scene-preview', 'card-title', 'enter-studio']) document.getElementById(id)?.removeAttribute('id');
    const node = $('#scene-template').content.firstElementChild.cloneNode(true), card = node.querySelector('.scene-card');
    card.id = 'scene-card'; node.querySelector('.card-title').id = 'card-title'; node.querySelector('.scene-preview').id = 'scene-preview';
    const button = node.querySelector('.open-studio'); button.id = 'enter-studio';
    const view = studio.capture(); node.querySelector('.scene-preview').src = view.composition; node.querySelector('.card-title').textContent = data.scene.title;
    activeTurn = { ...current, title: data.scene.title, view, shots, button };
    const turn = activeTurn; button.onclick = () => openStudio(turn);
    pending.replaceWith(node); iconify();
    populateObjects(); updateShots();
    scrollChat();
  } catch (e) {
    pending.classList.add('message-failed'); pending.replaceChildren();
    const copy = document.createElement('p'); copy.textContent = message(e);
    const retry = document.createElement('button'); retry.className = 'quiet'; retry.textContent = 'Use this message again';
    retry.onclick = () => {
      if (busy) return;
      $('#prompt').value = typedPrompt; resizeComposer();
      if (sceneReference) showReference(sceneReference, 'Reference photo'); else clearReference();
      $('#prompt').focus();
    };
    pending.append(copy, retry); sent.dataset.failed = 'true'; scrollChat();
  } finally { setBusy(false); }
};
function updateShots() {
  const container = $('#shots'); container.replaceChildren();
  for (let index = 0; index < 4; index++) {
    const shot = shots[index];
    if (!shot) { const slot = document.createElement('div'); slot.className = 'frame-placeholder'; slot.textContent = index + 1; slot.setAttribute('aria-hidden', 'true'); container.append(slot); continue; }
    const card = document.createElement('div'); card.className = `frame${activeShot === shot.id ? ' active' : ''}`;
    const view = document.createElement('button'); view.className = 'frame-image'; view.setAttribute('aria-label', `Restore frame ${index + 1}`);
    const image = document.createElement('img'); image.src = shot.composition; image.alt = `Composition ${index + 1}`; view.append(image);
    view.onclick = () => {
      if (busy || pendingAddition) { if (pendingAddition) toast('Finish or remove your new element first.'); return; }
      studio.restore(shot); current = { prompt: shot.prompt, reference: shot.reference };
      populateObjects(); activeShot = shot.id; notes = shot.notes; $('#frame-note').value = notes;
      $('#note-label').textContent = notes ? 'Edit note' : 'Add note'; updateShots();
    };
    const badge = document.createElement('span'); badge.className = 'frame-number'; badge.textContent = index + 1;
    const remove = document.createElement('button'); remove.className = 'frame-delete'; remove.setAttribute('aria-label', `Delete frame ${index + 1}`); remove.innerHTML = '<i data-lucide="x"></i>'; remove.disabled = busy;
    remove.onclick = () => { shots = shots.filter(s => s.id !== shot.id); if (activeShot === shot.id) activeShot = null; updateShots(); };
    card.append(view, badge, remove);
    if (shot.notes) { const mark = document.createElement('span'); mark.className = 'frame-note-marker'; mark.innerHTML = '<i data-lucide="message-square"></i>'; mark.title = shot.notes; card.append(mark); }
    container.append(card);
  }
  updateShotControls(); iconify();
}
$('#annotate').onclick = () => {
  const editable = shots.findIndex(shot => shot.id === activeShot && !shot.photo);
  $('#notes-title').textContent = editable >= 0 ? `Note for frame ${editable + 1}` : 'Note for your next frame';
  $('#notes-panel').hidden = false; $('#frame-note').focus();
};
$('#frame-note').oninput = event => {
  notes = event.target.value; $('#note-label').textContent = notes ? 'Edit note' : 'Add note';
  const shot = shots.find(s => s.id === activeShot && !s.photo);
  if (shot) { shot.notes = notes; updateShots(); }
};
$('#close-notes').onclick = () => { $('#notes-panel').hidden = true; $('#annotate').focus(); };
$('#capture').onclick = () => {
  if (busy || pendingAddition || !current || shots.length >= 4) return;
  shots.push({ id: ++shotId, ...current, ...studio.capture(), notes, photo: null });
  activeShot = null; notes = ''; $('#frame-note').value = ''; $('#note-label').textContent = 'Add note';
  updateShots(); $('#flash').classList.remove('fire'); void $('#flash').offsetWidth; $('#flash').classList.add('fire'); toast(`Frame ${shots.length} captured.`);
};
function preview(image) { $('#photo-preview').src = image; $('#photo-dialog').showModal(); }
function updateResults(batch) {
  const grid = batch.node.querySelector('.result-grid'); grid.replaceChildren();
  for (const shot of batch.shots) {
    const card = document.createElement('article'); card.className = 'result-card';
    if (shot.photo) {
      const view = document.createElement('button'); view.setAttribute('aria-label', `View photograph ${shot.ordinal}`);
      const image = document.createElement('img'); image.className = 'result-image'; image.src = shot.photo; image.alt = `AI photograph ${shot.ordinal}`;
      view.append(image); view.onclick = () => preview(shot.photo); card.append(view);
    } else {
      const pending = document.createElement('div'); pending.className = `result-pending${shot.generating ? ' generating' : ''}`;
      pending.innerHTML = '<i data-lucide="aperture"></i>';
      const label = document.createElement('span'); label.textContent = shot.generating ? 'Bringing it to life…' : shot.failed ? 'Ready to try again' : 'Up next'; pending.append(label); card.append(pending);
    }
    const caption = document.createElement('div'); caption.className = 'result-caption';
    const label = document.createElement('span'); label.textContent = `Frame ${shot.frame}`; caption.append(label);
    if (shot.photo) {
      const link = document.createElement('a'); link.href = shot.photo;
      link.download = `reframe-photo-${shot.id}.${shot.photo.startsWith('data:image/png') ? 'png' : shot.photo.startsWith('data:image/webp') ? 'webp' : 'jpg'}`;
      link.innerHTML = '<i data-lucide="download"></i> Save'; link.setAttribute('aria-label', `Download photograph ${shot.ordinal}`); caption.append(link);
    }
    card.append(caption); grid.append(card);
  }
  batch.node.querySelector('.result-disclaimer').hidden = !batch.shots.some(shot => shot.photo);
  iconify();
}
async function renderFrames(existingBatch = null) {
  if (busy) return;
  let batch = existingBatch;
  if (!batch) {
    const pending = shots.filter(shot => !shot.photo); if (!pending.length) return;
    closeStudio();
    userMessage(`Make ${pending.length === 1 ? 'this shot' : `these ${pending.length} shots`} real.`, pending.map(shot => ({ src: shot.composition, alt: `Submitted frame ${shots.indexOf(shot) + 1}`, note: shot.notes })), 'studio-submission');
    for (const id of ['results', 'results-title', 'results-status', 'result-grid', 'retry-render']) document.getElementById(id)?.removeAttribute('id');
    const node = $('#results-template').content.firstElementChild.cloneNode(true); node.id = 'results';
    for (const name of ['results-title', 'results-status', 'result-grid', 'retry-render']) node.querySelector(`.${name}`).id = name;
    batch = { node, shots: pending.map(shot => ({ ...structuredClone(shot), frame: shots.indexOf(shot) + 1, ordinal: ++resultOrdinal, source: shot })) };
    node.querySelector('.retry-render').onclick = () => renderFrames(batch); appendMessage(node);
  }
  const pending = batch.shots.filter(shot => !shot.photo); if (!pending.length) return;
  const title = batch.node.querySelector('.results-title'), status = batch.node.querySelector('.results-status'), retry = batch.node.querySelector('.retry-render');
  error(); setBusy(true, 'Creating your images…'); retry.hidden = true; title.textContent = 'Bringing your frames to life…';
  updateResults(batch); scrollChat();
  try {
    for (const [index, shot] of pending.entries()) {
      shot.generating = true; shot.failed = false; updateResults(batch);
      status.textContent = `Creating image ${index + 1} of ${pending.length} from your composition.`;
      const result = await api('render', { prompt: shot.prompt, reference: shot.reference, composition: shot.composition, ratio: shot.ratio, notes: shot.notes, lens: shot.lens });
      if (typeof result.image !== 'string' || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(result.image)) throw new Error('The AI service returned an invalid image.');
      shot.photo = result.image; shot.source.photo = result.image; shot.generating = false; updateResults(batch);
    }
    title.textContent = batch.shots.length === 1 ? 'Your shot, brought to life.' : 'Your shots, brought to life.';
    status.textContent = 'Framed by you. Made with AI.';
  } catch (e) {
    batch.shots.filter(shot => !shot.photo).forEach(shot => { shot.failed = true; });
    error(message(e)); title.textContent = batch.shots.some(shot => shot.photo) ? 'Your finished images are here.' : 'That didn’t quite work.';
    status.textContent = message(e); retry.hidden = false;
  } finally {
    batch.shots.forEach(shot => { shot.generating = false; }); setBusy(false); updateShots(); updateResults(batch);
  }
}
$('#render').onclick = () => renderFrames();
let referenceVersion = 0;
function showReference(data, name) {
  referenceVersion++; reference = data;
  const image = document.createElement('img'); image.src = data; image.alt = 'Your reference';
  $('#upload-icon').replaceChildren(image); $('#upload-title').textContent = name;
  $('#reference-preview').hidden = false; $('#remove-reference').hidden = false; error();
}
async function handleFile(file) {
  if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) { error('Choose a JPG, PNG, or WEBP image smaller than 10 MB.'); return; }
  const version = ++referenceVersion;
  try {
    const bitmap = await createImageBitmap(file); const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext('2d'); context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
    if (version !== referenceVersion) return;
    showReference(canvas.toDataURL('image/jpeg', .85), file.name);
  } catch { error('This image could not be read. Please try another.'); }
}
$('#reference').onchange = event => handleFile(event.target.files[0]);
$('.composer').ondragover = event => event.preventDefault(); $('.composer').ondrop = event => { event.preventDefault(); handleFile(event.dataTransfer.files[0]); };
$('#remove-reference').onclick = clearReference;
function resetChat() {
  if (busy) return;
  closeStudio(); current = null; activeTurn = null; shots = []; shotId = 0; resultOrdinal = 0; activeShot = null; notes = ''; pendingAddition = null;
  $('#chat-thread').replaceChildren(); $('#chat-intro').hidden = false;
  $('#prompt').value = ''; resizeComposer(); clearReference(); error(); updateShots(); setBusy(false);
  $('#new-chat-dialog').close(); $('#prompt').focus();
}
$('#new-chat').onclick = () => {
  if (busy) return;
  if ($('#chat-thread').childElementCount) $('#new-chat-dialog').showModal(); else $('#prompt').focus();
};
$('#cancel-new-chat').onclick = () => $('#new-chat-dialog').close();
$('#confirm-new-chat').onclick = resetChat;
$('#help').onclick = () => $('#help-dialog').showModal(); $('#close-help').onclick = () => $('#help-dialog').close(); $('#close-photo').onclick = () => $('#photo-dialog').close();
updateShots(); setBusy(false); iconify();

if (useOpenRouter) void refreshFreeAvailability();
