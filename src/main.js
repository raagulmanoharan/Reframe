import './style.css';
import { createIcons, CircleHelp, ImagePlus, ArrowUpRight, ArrowLeft, RotateCcw, Download, X, Camera, Move, MessageSquare } from 'lucide';
import { createStudio } from './studio.js';
import { generateScene, generatePhoto } from './ai.js';
import { setupChatGPT } from './chatgpt.js';
const icons = { CircleHelp, ImagePlus, ArrowUpRight, ArrowLeft, RotateCcw, Download, X, Camera, Move, MessageSquare };
const $ = selector => document.querySelector(selector);
const iconify = () => createIcons({ icons });
const hosted = import.meta.env.VITE_AI_MODE === 'chatgpt';
let current = null, shots = [], resultShots = [], shotId = 0, reference = null, studio, busy = false;
let timer, accessCode = '', resolveCode, activeShot = null, notes = '', loggedIn = false;
function toast(text) { $('#toast').textContent = text; $('#toast').classList.add('show'); clearTimeout(timer); timer = setTimeout(() => $('#toast').classList.remove('show'), 3500); }
function error(text = '') { $('#error').textContent = text; $('#error').hidden = !text; }
function message(e) { return e.name === 'TimeoutError' ? 'Generation timed out. Please try again.' : e instanceof TypeError ? 'Cannot reach the AI service. Please try again.' : e.message; }
function setBusy(value, text = '') {
  busy = value;
  $('#build').disabled = value || !studio;
  $('#enter-studio').disabled = value || !current;
  $('#status').textContent = text;
  $('#status').setAttribute('aria-busy', String(value));
  $('#retry-render').disabled = value;
  updateShotControls();
}
function updateShotControls() {
  $('#capture').disabled = busy || !current || shots.length >= 4;
  $('#render').disabled = busy || !shots.some(shot => !shot.photo);
  $('#shot-count').textContent = `${shots.length} / 4 frames`;
  $('#studio-hint').textContent = !shots.length ? 'Capture a frame to get started.' : shots.length === 4 ? 'Four frames. Ready when you are.' : `${shots.length} frame${shots.length === 1 ? '' : 's'} ready. Add more or let’s go.`;
}
function closeStudio() {
  $('#studio-panel').hidden = true; $('#notes-panel').hidden = true;
  $('#toast').classList.remove('show');
  $('#app').inert = false; document.body.style.overflow = ''; studio?.setActive(false);
  $('#enter-studio').focus({ preventScroll: true });
}
function accountChanged(signedIn) {
  $('#welcome').hidden = signedIn; $('#conversation').hidden = !signedIn;
  $('#access-settings').textContent = signedIn ? 'Account' : 'Sign in';
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
  $('#access-form').onsubmit = event => {
    event.preventDefault(); accessCode = $('#access-code').value.trim(); if (!accessCode) return;
    $('#access-code').value = ''; const resolve = resolveCode; resolveCode = null;
    $('#access-dialog').close(); resolve?.(accessCode);
  };
  $('#access-dialog').addEventListener('close', () => { resolveCode?.(null); resolveCode = null; });
  $('#cancel-access').onclick = () => $('#access-dialog').close();
  $('#access-settings').onclick = () => $('#access-dialog').showModal();
  $('#forget-key').onclick = () => { accessCode = ''; $('#access-code').value = ''; $('#access-dialog').close(); toast('API key removed.'); };
}
async function api(path, payload) {
  if (chatgpt) return chatgpt(path, payload);
  if (!accessCode) {
    $('#access-dialog').showModal();
    const code = await new Promise(resolve => { resolveCode = resolve; });
    if (!code) throw new Error('Generation cancelled.');
  }
  try { return await (path === 'scene' ? generateScene(accessCode, payload) : generatePhoto(accessCode, payload)); }
  catch (e) { if (e.status === 401) accessCode = ''; throw e; }
}
try {
  studio = createStudio($('#canvas-wrap'), $('#ratio'), (selection, canUndo) => {
    $('#object-select').value = selection ? String(selection.index) : '';
    $('#object-height').disabled = !selection;
    if (selection) {
      $('#object-height').min = Math.min(0, selection.height);
      $('#object-height').max = Math.max(10, Math.ceil(selection.height));
      $('#object-height').value = selection.height;
    }
    $('#undo-move').disabled = !canUndo;
  });
} catch { $('#webgl-error').hidden = false; }
function populateObjects() {
  $('#object-select').replaceChildren(new Option('Tap a shape to move it', ''));
  for (const object of studio.getObjects()) $('#object-select').add(new Option(object.name, String(object.index)));
}
function mode(move) {
  $('#move-mode').setAttribute('aria-pressed', String(move)); $('#camera-mode').setAttribute('aria-pressed', String(!move));
  $('#object-controls').hidden = !move;
  $('#gesture-hint').textContent = move ? 'Tap a shape and drag · Use Height to lift it' : 'Drag to orbit · Pinch to zoom · Two fingers to pan';
  studio.setMoveMode(move); studio.resize();
}
$('#camera-mode').onclick = () => mode(false); $('#move-mode').onclick = () => mode(true);
$('#object-select').onchange = event => studio.selectObject(event.target.value === '' ? null : Number(event.target.value));
$('#object-height').oninput = event => studio.setHeight(Number(event.target.value));
$('#undo-move').onclick = () => studio.undoMove();
$('#reset').onclick = () => studio?.reset(); $('#ratio').onchange = () => studio?.resize();
$('#enter-studio').onclick = () => {
  if (!current || busy) return;
  $('#studio-panel').hidden = false; $('#app').inert = true; document.body.style.overflow = 'hidden';
  studio.setActive(true); $('#exit-studio').focus({ preventScroll: true });
};
$('#exit-studio').onclick = closeStudio;
// Keep keyboard navigation inside the full-screen studio, including its note sheet.
$('#studio-panel').addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    if (!$('#notes-panel').hidden) { $('#notes-panel').hidden = true; $('#annotate').focus(); }
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
document.querySelectorAll('.preset').forEach(button => button.onclick = () => { $('#prompt').value = prompts[button.dataset.scene]; $('#prompt').focus(); });
$('#brief-form').onsubmit = async event => {
  event.preventDefault(); if (busy || !studio) return;
  const typedPrompt = $('#prompt').value.trim();
  if (!typedPrompt && !reference) { error('Describe a scene, add an image, or both.'); return; }
  const prompt = typedPrompt || 'Create a photographic scene centered on the subject in this reference image.';
  const sceneReference = reference;
  error(); setBusy(true, 'Arranging your scene…');
  try {
    const data = await api('scene', { prompt, reference: sceneReference });
    studio.setScene(data.scene); current = { prompt, reference: sceneReference };
    shots = []; notes = ''; activeShot = null; $('#frame-note').value = ''; $('#note-label').textContent = 'Add note';
    $('#retry-render').hidden = true;
    $('#scene-name').textContent = data.scene.title; $('#card-title').textContent = data.scene.title;
    $('#scene-preview').src = studio.capture().composition; $('#scene-card').hidden = false;
    populateObjects(); mode(false); updateShots();
    $('#scene-card').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (e) { error(message(e)); } finally { setBusy(false); }
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
      if (busy) return;
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
  if (busy || !current || shots.length >= 4) return;
  shots.push({ id: ++shotId, ...current, ...studio.capture(), notes, photo: null });
  activeShot = null; notes = ''; $('#frame-note').value = ''; $('#note-label').textContent = 'Add note';
  updateShots(); $('#flash').classList.remove('fire'); void $('#flash').offsetWidth; $('#flash').classList.add('fire'); toast(`Frame ${shots.length} captured.`);
};
function preview(image) { $('#photo-preview').src = image; $('#photo-dialog').showModal(); }
function updateResults() {
  const grid = $('#result-grid'); grid.replaceChildren();
  for (const [index, shot] of resultShots.entries()) {
    const card = document.createElement('article'); card.className = 'result-card';
    if (shot.photo) {
      const view = document.createElement('button'); view.setAttribute('aria-label', `View photograph ${index + 1}`);
      const image = document.createElement('img'); image.className = 'result-image'; image.src = shot.photo; image.alt = `AI photograph ${index + 1}`; view.append(image); view.onclick = () => preview(shot.photo); card.append(view);
    } else {
      const pending = document.createElement('div'); pending.className = 'result-pending'; pending.textContent = shot.generating ? 'Making your image…' : shot.failed ? 'Not generated yet' : 'Waiting for your image'; card.append(pending);
    }
    const caption = document.createElement('div'); caption.className = 'result-caption'; const label = document.createElement('span'); label.textContent = `Frame ${shot.frame}`; caption.append(label);
    if (shot.photo) {
      const link = document.createElement('a'); link.href = shot.photo; link.download = `reframe-photo-${shot.id}.${shot.photo.startsWith('data:image/png') ? 'png' : 'jpg'}`; link.innerHTML = '<i data-lucide="download"></i> Save'; link.setAttribute('aria-label', `Download photograph ${index + 1}`); caption.append(link);
    }
    card.append(caption);
    if (shot.notes) { const note = document.createElement('p'); note.className = 'result-note'; note.textContent = shot.notes; card.append(note); }
    grid.append(card);
  }
  iconify();
}
async function renderFrames() {
  if (busy) return;
  const pending = shots.filter(shot => !shot.photo); if (!pending.length) return;
  closeStudio(); error(); setBusy(true, 'Turning your frames into images…');
  $('#results').hidden = false; $('#retry-render').hidden = true; $('#results-title').textContent = 'Making your images…';
  for (const shot of pending) {
    if (!resultShots.some(result => result.id === shot.id)) resultShots.push({ ...structuredClone(shot), frame: shots.indexOf(shot) + 1 });
    else { const result = resultShots.find(result => result.id === shot.id); result.notes = shot.notes; }
  }
  updateResults(); $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  let completed = 0;
  try {
    for (const shot of pending) {
      const resultShot = resultShots.find(result => result.id === shot.id); resultShot.generating = true; resultShot.failed = false; updateResults();
      $('#results-status').textContent = `Image ${completed + 1} of ${pending.length}. Good things take a moment.`;
      const result = await api('render', { prompt: shot.prompt, reference: shot.reference, composition: shot.composition, ratio: shot.ratio, notes: shot.notes });
      if (typeof result.image !== 'string' || !/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/]+=*$/.test(result.image)) throw new Error('The AI service returned an invalid image.');
      shot.photo = result.image; resultShot.photo = result.image; resultShot.generating = false; completed++; updateResults();
    }
    $('#results-title').textContent = 'Your images, from your angles.'; $('#results-status').textContent = 'Save your favourites before leaving.';
  } catch (e) {
    resultShots.filter(shot => !shot.photo).forEach(shot => { shot.failed = true; });
    error(message(e)); $('#results-title').textContent = completed ? 'Your finished images are safe.' : 'Let’s give that another try.';
    $('#results-status').textContent = message(e); $('#retry-render').hidden = false;
  } finally {
    resultShots.forEach(shot => { shot.generating = false; }); setBusy(false); updateShots(); updateResults();
  }
}
$('#render').onclick = renderFrames; $('#retry-render').onclick = renderFrames;
let referenceVersion = 0;
async function handleFile(file) {
  if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) { error('Choose a JPG, PNG, or WEBP image smaller than 10 MB.'); return; }
  const version = ++referenceVersion;
  try {
    const bitmap = await createImageBitmap(file); const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext('2d'); context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
    if (version !== referenceVersion) return;
    reference = canvas.toDataURL('image/jpeg', .85); const image = document.createElement('img'); image.src = reference; image.alt = 'Your reference'; $('#upload-icon').replaceChildren(image);
    $('#upload-title').textContent = file.name; $('#remove-reference').hidden = false; error();
  } catch { error('This image could not be read. Please try another.'); }
}
$('#reference').onchange = event => handleFile(event.target.files[0]);
$('.composer').ondragover = event => event.preventDefault(); $('.composer').ondrop = event => { event.preventDefault(); handleFile(event.dataTransfer.files[0]); };
$('#remove-reference').onclick = () => { referenceVersion++; reference = null; $('#reference').value = ''; $('#upload-icon').innerHTML = '<i data-lucide="image-plus"></i>'; $('#upload-title').textContent = 'Add image'; $('#remove-reference').hidden = true; iconify(); };
$('#help').onclick = () => $('#help-dialog').showModal(); $('#close-help').onclick = () => $('#help-dialog').close(); $('#close-photo').onclick = () => $('#photo-dialog').close();
updateShots(); setBusy(false); iconify();
