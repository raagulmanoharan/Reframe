import './style.css';
import { createIcons, CircleHelp, ImagePlus, ArrowUpRight, RotateCcw, Download, Sparkles, X, KeyRound } from 'lucide';
import { createStudio } from './studio.js';
import { generateScene, generatePhoto } from './ai.js';
import { setupChatGPT } from './chatgpt.js';
const icons = { CircleHelp, ImagePlus, ArrowUpRight, RotateCcw, Download, Sparkles, X, KeyRound };
const $ = selector => document.querySelector(selector);
const iconify = () => createIcons({ icons });
let timer, current = null, shots = [], shotId = 0, reference = null, studio, busy = false;
// User-supplied key stays in this tab's memory. Never persist or bundle it.
let accessCode = '';
const hosted = import.meta.env.VITE_AI_MODE === 'chatgpt';
const chatgpt = hosted ? setupChatGPT() : null;
function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('show'); clearTimeout(timer); timer = setTimeout(() => $('#toast').classList.remove('show'), 4500); }
function error(message = '') { $('#error').textContent = message; $('#error').hidden = !message; }
function setBusy(value, text) {
  busy = value;
  $('#build').disabled = value || !studio;
  $('#capture').disabled = value || !current;
  $('#render').disabled = value || !shots.some(s => s.selected && !s.photo);
  $('#generate').disabled = value || !shots.some(s => s.selected);
  $('#status').textContent = text || (current ? 'Your scene is ready. Find your angle.' : 'Describe a scene to begin.');
  $('#status').setAttribute('aria-busy', String(value));
}
let resolveCode;
function getCode() {
  if (accessCode) return Promise.resolve(accessCode);
  $('#access-dialog').showModal();
  return new Promise(resolve => { resolveCode = resolve; });
}
if (!hosted) {
$('#access-form').onsubmit = event => {
  event.preventDefault(); accessCode = $('#access-code').value.trim();
  if (!accessCode) return;
  $('#access-code').value = '';
  $('#access-dialog').close(); resolveCode?.(accessCode); resolveCode = null;
};
$('#access-dialog').addEventListener('close', () => { if (resolveCode) { resolveCode(null); resolveCode = null; } });
$('#cancel-access').onclick = () => $('#access-dialog').close();
$('#access-settings').onclick = () => { $('#access-dialog').showModal(); };
$('#forget-key').onclick = () => { accessCode = ''; $('#access-code').value = ''; $('#access-dialog').close(); toast('API key removed from this tab.'); };
}
async function api(path, payload) {
  if (chatgpt) return chatgpt(path, payload);
  const code = await getCode();
  if (!code) throw new Error('Generation cancelled.');
  try { return await (path === 'scene' ? generateScene(code, payload) : generatePhoto(code, payload)); }
  catch (e) { if (e.status === 401) accessCode = ''; throw e; }
}
function message(e) {
  if (e.name === 'TimeoutError') return 'Generation timed out. Please try again.';
  if (e instanceof TypeError) return 'Cannot reach the AI service. Check your connection and try again.';
  return e.message;
}
try { studio = createStudio($('#canvas-wrap'), $('#ratio')); } catch { $('#webgl-error').hidden = false; }
$('#reset').onclick = () => studio?.reset();
$('#ratio').onchange = () => studio?.resize();
const prompts = {
  living: 'A sculptural sofa in a warm, sunlit living room. Olive upholstery, an oak coffee table, and a tall plant.',
  jewellery: 'An emerald ring on black stone with a dramatic side light. Gold details and a quiet editorial composition.',
  industrial: 'An industrial smelting complex with tall chimneys, steel silos, gantries, and a loading yard.',
};
document.querySelectorAll('.preset').forEach(button => button.onclick = () => {
  $('#prompt').value = prompts[button.dataset.scene];
  document.querySelectorAll('.preset').forEach(b => b.classList.toggle('active', b === button));
});
$('#prompt').oninput = () => document.querySelectorAll('.preset').forEach(b => b.classList.remove('active'));
$('#build').onclick = async () => {
  const prompt = $('#prompt').value.trim();
  if (!prompt) { error('Describe the scene you want to create.'); return; }
  error(); setBusy(true, 'AI is arranging your scene…');
  // Snapshot the brief and reference together so later edits cannot alter this scene's shots.
  const sceneReference = reference;
  try {
    const data = await api('scene', { prompt, reference: sceneReference });
    studio.setScene(data.scene);
    current = { scene: data.scene, prompt, reference: sceneReference };
    $('#scene-name').textContent = data.scene.title;
    $('#scene-empty').hidden = true;
    if (innerWidth <= 700) $('.workspace').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) { error(message(e)); } finally { setBusy(false); }
};
function updateShots() {
  const container = $('#shots'); container.replaceChildren();
  $('#shot-count').textContent = `${shots.length} shot${shots.length === 1 ? '' : 's'}`;
  if (!shots.length) { const empty = document.createElement('div'); empty.className = 'empty-shot'; empty.textContent = 'Find a view you like. Tap the shutter.'; container.append(empty); }
  for (const shot of shots) {
    const card = document.createElement('div'); card.className = `shot${shot.selected ? ' selected' : ''}`;
    const view = document.createElement('button'); view.className = 'shot-image'; view.setAttribute('aria-label', `Restore shot ${shot.id}`);
    const image = document.createElement('img'); image.src = shot.photo || shot.composition; image.alt = `${shot.photo ? 'AI photograph' : 'Composition'} ${shot.id}`; view.append(image);
    view.onclick = () => {
      if (busy) return;
      studio.restore(shot); current = { scene: shot.scene, prompt: shot.prompt, reference: shot.reference };
      $('#scene-name').textContent = shot.scene.title; $('#scene-empty').hidden = true; setBusy(false); toast(`Shot ${shot.id} restored`);
      if (shot.photo) { $('#photo-preview').src = shot.photo; $('#photo-dialog').showModal(); }
    };
    const remove = document.createElement('button'); remove.className = 'shot-delete'; remove.setAttribute('aria-label', `Delete shot ${shot.id}`); remove.innerHTML = '<i data-lucide="x"></i>'; remove.disabled = busy;
    remove.onclick = () => { shots = shots.filter(s => s.id !== shot.id); updateShots(); };
    const caption = document.createElement('div'); caption.className = 'shot-caption';
    const title = document.createElement('span'); title.textContent = `${shot.photo ? 'AI PHOTO' : 'SHOT'} ${String(shot.id).padStart(2, '0')}`;
    const label = document.createElement('label'), checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = shot.selected; checkbox.disabled = busy; checkbox.setAttribute('aria-label', `Select shot ${shot.id}`);
    checkbox.onchange = () => { shot.selected = checkbox.checked; updateShots(); }; label.append(checkbox); caption.append(title, label);
    card.append(view, remove, caption); container.append(card);
  }
  $('#render').disabled = busy || !shots.some(s => s.selected && !s.photo);
  $('#generate').disabled = busy || !shots.some(s => s.selected);
  iconify();
}
$('#capture').onclick = () => {
  if (busy || !current) return;
  if (shots.length >= 12) { toast('Delete a shot to make room for another.'); return; }
  shots.push({ id: ++shotId, ...current, ...studio.capture(), selected: true, photo: null });
  updateShots(); $('#flash').classList.remove('fire'); void $('#flash').offsetWidth; $('#flash').classList.add('fire'); toast('Angle captured.');
};
$('#render').onclick = async () => {
  if (busy) return;
  const selected = shots.filter(s => s.selected && !s.photo); if (!selected.length) return;
  error(); setBusy(true); updateShots(); let completed = 0;
  try {
    for (const shot of selected) {
      $('#status').textContent = `Generating photo ${completed + 1} of ${selected.length}… This can take a few minutes.`;
      const result = await api('render', { prompt: shot.prompt, reference: shot.reference, composition: shot.composition, ratio: shot.ratio });
      if (typeof result.image !== 'string' || !/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/]+=*$/.test(result.image)) throw new Error('The AI service returned an invalid image.');
      shot.photo = result.image; completed++; updateShots();
    }
    toast(`${completed} photo${completed === 1 ? '' : 's'} ready.`);
  } catch (e) { error(`${completed ? `${completed} photo(s) saved. ` : ''}${message(e)}`); }
  finally { setBusy(false); updateShots(); }
};
$('#generate').onclick = () => {
  for (const shot of shots.filter(s => s.selected)) {
    const a = document.createElement('a'); a.href = shot.photo || shot.composition;
    a.download = `reframe-${shot.photo ? 'photo' : 'composition'}-${shot.id}.${shot.photo?.startsWith('data:image/png') ? 'png' : 'jpg'}`; a.click();
  }
};
let referenceVersion = 0;
async function handleFile(file) {
  if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) { error('Choose a JPG, PNG, or WEBP image smaller than 10 MB.'); return; }
  const version = ++referenceVersion;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext('2d'); context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
    if (version !== referenceVersion) return;
    reference = canvas.toDataURL('image/jpeg', 0.85);
    const img = document.createElement('img'); img.src = reference; img.alt = 'Your product reference'; $('#upload-icon').replaceChildren(img);
    $('#upload-title').textContent = file.name; $('#remove-reference').hidden = false; error(); toast('Reference added for your next scene.');
  } catch { error('This image could not be read. Please try another.'); }
}
$('#reference').onchange = e => handleFile(e.target.files[0]);
$('.upload').ondragover = e => e.preventDefault(); $('.upload').ondrop = e => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); };
$('#remove-reference').onclick = () => { referenceVersion++; reference = null; $('#reference').value = ''; $('#upload-icon').innerHTML = '<i data-lucide="image-plus"></i>'; $('#upload-title').textContent = 'Add reference'; $('#remove-reference').hidden = true; iconify(); };
$('#help').onclick = () => $('#help-dialog').showModal(); $('#close-help').onclick = () => $('#help-dialog').close(); $('#close-photo').onclick = () => $('#photo-dialog').close();
iconify(); setBusy(false);
if (hosted) $('#privacy-note').textContent = 'Prompts, references and captures pass through Reframe to OpenAI when you generate. Sign-in lasts for this session; it clears when you sign out or the server restarts. Download photos before leaving.';
