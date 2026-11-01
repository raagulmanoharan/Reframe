import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { validateScene } from '../lib/scene-schema.js';
import { sceneGroups } from '../lib/scene-groups.js';
import { validateLens } from '../lib/camera-settings.js';

export function createStudio(container, ratio, onSelection = () => {}, onCameraChange = () => {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  container.append(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#e7e4db');
  const camera = new THREE.PerspectiveCamera(44, 1, 0.03, 200);
  const surface = container.parentElement;
  const controls = new OrbitControls(camera, surface);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.screenSpacePanning = true;
  controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
  const world = new THREE.Group(); scene.add(world);
  scene.add(new THREE.HemisphereLight(0xfff8e9, 0x8a9282, 2.6));
  const sun = new THREE.DirectionalLight(0xfff4d9, 4);
  sun.position.set(-5, 12, 8); sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024); sun.shadow.normalBias = 0.03;
  Object.assign(sun.shadow.camera, { left: -25, right: 25, top: 25, bottom: -25, far: 100 });
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xffffff, 0.6); fill.position.set(5, 3, 5); scene.add(fill);
  let layout = null, selected = null, drag = null, undo = [], active = false, enabled = true;
  let lens = { zoom: 1, focusDistance: 1, blur: 0 }, focusAnchor = null, needsRender = true;
  let composer, bokeh, composerSize = '', cameraNotice = '';
  controls.addEventListener('change', () => { needsRender = true; });
  const touches = new Map();
  const ownedPointers = new Set();
  let candidate = null;
  let meshes = [], entities = [];
  const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
  const selectionFrame = document.createElement('div'); selectionFrame.className = 'selection-frame'; selectionFrame.hidden = true;
  for (const [edge, label] of Object.entries({ nw: 'top left', n: 'top', ne: 'top right', e: 'right', se: 'bottom right', s: 'bottom', sw: 'bottom left', w: 'left' })) {
    const handle = document.createElement('button'); handle.type = 'button'; handle.className = 'resize-handle'; handle.dataset.resize = edge;
    handle.setAttribute('aria-label', `Resize selected object from ${label}`); handle.title = 'Drag to resize';
    handle.onkeydown = event => {
      if (!enabled || selected === null || drag || !['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      setScale(entities[selected].node.scale.x + (['ArrowUp', 'ArrowRight'].includes(event.key) ? 0.05 : -0.05));
    };
    selectionFrame.append(handle);
  }
  surface.append(selectionFrame);
  function updateSelectionFrame() {
    selectionFrame.hidden = !active || !enabled || selected === null;
    if (selectionFrame.hidden) return;
    camera.updateMatrixWorld();
    const box = new THREE.Box3().setFromObject(entities[selected].node), projected = [];
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      const point = new THREE.Vector3(x, y, z);
      if (point.clone().applyMatrix4(camera.matrixWorldInverse).z >= -camera.near) { selectionFrame.hidden = true; return; }
      projected.push(point.project(camera));
    }
    const canvas = renderer.domElement.getBoundingClientRect(), bounds = surface.getBoundingClientRect();
    const xs = projected.map(p => canvas.left - bounds.left + (p.x + 1) * canvas.width / 2);
    const ys = projected.map(p => canvas.top - bounds.top + (1 - p.y) * canvas.height / 2);
    const left = Math.max(18, Math.min(...xs) - 6), right = Math.min(bounds.width - 18, Math.max(...xs) + 6);
    const top = Math.max(18, Math.min(...ys) - 6), bottom = Math.min(bounds.height - 18, Math.max(...ys) + 6);
    if (right - left < 16 || bottom - top < 16) { selectionFrame.hidden = true; return; }
    Object.assign(selectionFrame.style, { left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px` });
  }
  function selectionChanged() {
    needsRender = true;
    updateSelectionFrame();
    onSelection(selected === null ? null : { index: selected, name: entities[selected].name, height: entities[selected].node.position.y, scale: entities[selected].node.scale.x }, undo.length > 0);
  }
  function selectObject(index) {
    // A second finger can change the selection using the object list. Consume
    // the old pointer until release without letting it edit the new selection.
    drag = null; candidate = null;
    selected = Number.isInteger(index) && entities[index] ? index : null;
    selectionChanged();
  }
  function rememberMove() {
    if (selected !== null) {
      undo.push({ index: selected, position: entities[selected].node.position.toArray(), scale: entities[selected].node.scale.x });
      if (undo.length > 30) undo.shift();
    }
  }
  function commitPosition() {
    const entity = entities[selected], position = entity.node.position.toArray(), scale = entity.node.scale.x;
    entity.indices.forEach((index, member) => {
      layout.objects[index].position = entity.positions[member].map((value, axis) => value + (position[axis] - entity.origin[axis]) + (value - entity.origin[axis]) * (scale - 1));
      layout.objects[index].size = entity.sizes[member].map(value => value * scale);
    });
    selectionChanged();
  }
  function setHeight(height) {
    if (selected === null || !Number.isFinite(height)) return;
    const entity = entities[selected];
    rememberMove(); entity.node.position.y = height; clampPosition(entity); commitPosition();
  }
  function clampPosition(entity) {
    const scale = entity.node.scale.x;
    ['x', 'y', 'z'].forEach((axis, index) => {
      const offsets = entity.positions.map(p => (p[index] - entity.origin[index]) * scale);
      entity.node.position[axis] = THREE.MathUtils.clamp(entity.node.position[axis], -25 - Math.min(...offsets), 25 - Math.max(...offsets));
    });
  }
  function setScale(value, remember = true) {
    if (selected === null || !Number.isFinite(value)) return;
    const entity = entities[selected], dimensions = entity.sizes.flat();
    const span = Math.max(...[0, 1, 2].map(axis => Math.max(...entity.positions.map(p => p[axis])) - Math.min(...entity.positions.map(p => p[axis]))));
    const min = Math.max(0.1, 0.01 / Math.min(...dimensions));
    const max = Math.min(5, 30 / Math.max(...dimensions), span ? 50 / span : 5);
    const next = THREE.MathUtils.clamp(value, min, max);
    if (next === entity.node.scale.x) return;
    if (remember) rememberMove();
    const bottom = new THREE.Box3().setFromObject(entity.node).min.y;
    entity.node.scale.setScalar(next);
    entity.node.position.y += bottom - new THREE.Box3().setFromObject(entity.node).min.y;
    clampPosition(entity); commitPosition();
  }
  function undoMove() {
    const previous = undo.pop(); if (!previous) return;
    selectObject(previous.index); entities[selected].node.position.fromArray(previous.position); entities[selected].node.scale.setScalar(previous.scale); commitPosition();
  }
  function stopCameraMotion() {
    controls.enableDamping = false; controls.update(); controls.enableDamping = true;
  }
  function focusWorldPoint() {
    const entity = focusAnchor && entities.find(item => item.name === focusAnchor.group);
    if (!entity) return null;
    entity.node.updateWorldMatrix(true, false);
    return entity.node.localToWorld(focusAnchor.local.clone());
  }
  function getLens() {
    camera.updateMatrixWorld();
    const point = focusWorldPoint();
    if (point) lens.focusDistance = THREE.MathUtils.clamp(-point.clone().applyMatrix4(camera.matrixWorldInverse).z, 0.1, 200);
    return { ...lens, ...(point ? { focusTarget: { group: focusAnchor.group, point: point.toArray() } } : {}) };
  }
  function cameraChanged() {
    const settings = getLens();
    const key = `${settings.zoom}|${settings.focusDistance.toFixed(2)}|${settings.blur}|${settings.focusTarget?.group || ''}`;
    if (key !== cameraNotice) { cameraNotice = key; onCameraChange(settings); }
  }
  function applyLens(settings) {
    const next = validateLens(settings);
    lens = { zoom: next.zoom, focusDistance: next.focusDistance, blur: next.blur }; focusAnchor = null;
    const entity = next.focusTarget && entities.find(item => item.name === next.focusTarget.group);
    if (entity) {
      entity.node.updateWorldMatrix(true, false);
      focusAnchor = { group: entity.name, local: entity.node.worldToLocal(new THREE.Vector3(...next.focusTarget.point)) };
    }
    camera.zoom = lens.zoom; camera.updateProjectionMatrix(); needsRender = true; cameraChanged();
  }
  function setZoom(zoom) { applyLens({ ...getLens(), zoom }); }
  function setFocusDistance(focusDistance) { applyLens({ ...lens, focusDistance }); }
  function setBlur(blur) { applyLens({ ...getLens(), blur }); }
  function focusOn(point, entity) {
    applyLens({ ...lens, focusTarget: { group: entity.name, point: point.toArray() } });
  }
  function focusSelected() {
    if (selected === null) return;
    const entity = entities[selected], point = new THREE.Box3().setFromObject(entity.node).getCenter(new THREE.Vector3());
    focusOn(point, entity);
  }
  function renderView(fullResolution = false) {
    cameraChanged();
    updateSelectionFrame();
    if (!lens.blur) { renderer.render(scene, camera); needsRender = false; return; }
    if (!composer) {
      composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      bokeh = new BokehPass(scene, camera, { focus: lens.focusDistance, aperture: 0.01, maxblur: 0.025 });
      composer.addPass(bokeh); composer.addPass(new OutputPass());
    }
    const size = renderer.getSize(new THREE.Vector2());
    // Limit live preview work on phones; captures use their full 1024px size.
    const pixelRatio = fullResolution ? 1 : Math.min(1, 900 / Math.max(size.x, size.y));
    const key = `${size.x}|${size.y}|${pixelRatio}`;
    if (key !== composerSize) { composer.setPixelRatio(pixelRatio); composer.setSize(size.x, size.y); composerSize = key; }
    bokeh.uniforms.focus.value = lens.focusDistance;
    bokeh.uniforms.aperture.value = lens.blur / 100 * 0.04 / Math.max(1, lens.focusDistance);
    bokeh.uniforms.maxblur.value = lens.blur / 100 * 0.035;
    composer.render(); needsRender = false;
  }
  function cast(event) {
    const bounds = renderer.domElement.getBoundingClientRect();
    pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
  }
  function hitObject(event) {
    const bounds = renderer.domElement.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) return null;
    camera.updateMatrixWorld(); world.updateMatrixWorld(true); cast(event);
    return raycaster.intersectObjects(meshes, false)[0] || null;
  }
  function ownPointer(event) {
    ownedPointers.add(event.pointerId); controls.enabled = false;
    event.stopImmediatePropagation(); event.preventDefault(); surface.setPointerCapture(event.pointerId);
  }
  function beginEdit() { if (!drag.moved) { rememberMove(); drag.moved = true; } }
  function endInteraction() { drag = null; candidate = null; controls.enabled = enabled; surface.style.cursor = 'grab'; selectionChanged(); }
  surface.addEventListener('pointerdown', event => {
    if (!enabled) { event.stopImmediatePropagation(); return; }
    if (event.pointerType === 'touch') {
      touches.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
      if (touches.size > 1) {
        candidate = null;
        if (drag) {
          ownPointer(event);
          if (drag.kind !== 'pinch') {
            const ids = [...touches.keys()].slice(0, 2), [a, b] = ids.map(id => touches.get(id));
            drag = { kind: 'pinch', ids, moved: drag.moved, distance: Math.max(1, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)), scale: entities[selected].node.scale.x };
          }
        }
        // A gesture that started off the selection belongs to the camera.
        return;
      }
    }
    if (event.button !== 0 || drag) return;
    stopCameraMotion();
    const handle = event.target.closest?.('.resize-handle');
    if (handle && selectionFrame.contains(handle) && selected !== null) {
      const bounds = selectionFrame.getBoundingClientRect(), edge = handle.dataset.resize;
      ownPointer(event); candidate = null; handle.focus({ preventScroll: true });
      drag = { kind: 'resize', pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false, scale: entities[selected].node.scale.x,
        vx: /[ew]/.test(edge) ? event.clientX - bounds.x - bounds.width / 2 : 0,
        vy: /[ns]/.test(edge) ? event.clientY - bounds.y - bounds.height / 2 : 0 };
      return;
    }
    const hit = hitObject(event), index = hit?.object.userData.groupIndex;
    if (hit && index === selected) {
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -hit.point.y);
      const point = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
      if (!point) return;
      ownPointer(event); candidate = null;
      drag = { kind: 'move', pointerId: event.pointerId, plane, offset: entities[selected].node.position.clone().sub(point), x: event.clientX, y: event.clientY, moved: false, focusPoint: hit.point.clone() };
      surface.style.cursor = 'grabbing';
      return;
    }
    // Let OrbitControls own this pointer. Only a release without a drag selects.
    candidate = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, index, moved: false };
  }, true);
  surface.addEventListener('pointermove', event => {
    if (touches.has(event.pointerId)) touches.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
    if (ownedPointers.has(event.pointerId)) {
      event.stopImmediatePropagation();
      if (!drag || !enabled) return;
      if (drag.kind === 'pinch') {
        const [a, b] = drag.ids.map(id => touches.get(id)); if (!a || !b) return;
        const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        if (!drag.moved && Math.abs(distance - drag.distance) < 3) return;
        beginEdit(); setScale(drag.scale * distance / drag.distance, false); return;
      }
      if (event.pointerId !== drag.pointerId) return;
      if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 4) return;
      beginEdit();
      if (drag.kind === 'resize') {
        const ratio = 1 + ((event.clientX - drag.x) * drag.vx + (event.clientY - drag.y) * drag.vy) / Math.max(100, drag.vx ** 2 + drag.vy ** 2);
        setScale(drag.scale * ratio, false); return;
      }
      cast(event); const point = raycaster.ray.intersectPlane(drag.plane, new THREE.Vector3()); if (!point) return;
      point.add(drag.offset); const entity = entities[selected];
      entity.node.position.x = point.x; entity.node.position.z = point.z; clampPosition(entity); commitPosition();
      return;
    }
    if (candidate?.pointerId === event.pointerId && !candidate.moved) {
      if (Math.hypot(event.clientX - candidate.x, event.clientY - candidate.y) < 4) { event.stopImmediatePropagation(); return; }
      candidate.moved = true;
    }
    if (event.pointerType === 'mouse' && !event.buttons) {
      const hit = hitObject(event); surface.style.cursor = hit && hit.object.userData.groupIndex === selected ? 'move' : 'grab';
    }
  }, true);
  const release = event => {
    touches.delete(event.pointerId);
    if (ownedPointers.has(event.pointerId)) {
      event.stopImmediatePropagation(); ownedPointers.delete(event.pointerId);
      if (drag?.kind === 'move' && !drag.moved && event.type === 'pointerup') focusOn(drag.focusPoint, entities[selected]);
      if (surface.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId);
      // Consume the remaining finger after a pinch so it cannot jump into a move.
      if (!ownedPointers.size) endInteraction();
      return;
    }
    if (candidate?.pointerId === event.pointerId) {
      if (event.type === 'pointerup' && !candidate.moved && Math.hypot(event.clientX - candidate.x, event.clientY - candidate.y) < 4) {
        const hit = hitObject(event);
        if (hit && hit.object.userData.groupIndex === candidate.index) { selectObject(candidate.index); focusOn(hit.point, entities[selected]); }
        else if (!hit && candidate.index === undefined) selectObject(null);
      }
      candidate = null;
    }
  };
  surface.addEventListener('pointerup', release, true);
  surface.addEventListener('pointercancel', release, true);
  surface.addEventListener('lostpointercapture', event => { if (ownedPointers.has(event.pointerId)) release(event); }, true);
  const geometries = {
    box: () => new THREE.BoxGeometry(1, 1, 1),
    roundedBox: () => new RoundedBoxGeometry(1, 1, 1, 2, 0.12),
    capsule: () => new THREE.CapsuleGeometry(0.25, 0.5, 6, 16).scale(2, 1, 2),
    sphere: () => new THREE.SphereGeometry(0.5, 24, 16),
    cylinder: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 24),
    cone: () => new THREE.ConeGeometry(0.5, 1, 24),
    torus: () => new THREE.TorusGeometry(0.43, 0.07, 12, 48),
    icosahedron: () => new THREE.IcosahedronGeometry(0.5, 0),
  };
  function reset() {
    if (!layout) return;
    stopCameraMotion();
    camera.position.fromArray(layout.camera.position); controls.target.fromArray(layout.camera.target);
    const distance = camera.position.distanceTo(controls.target);
    controls.minDistance = Math.max(0.15, distance * 0.08); controls.maxDistance = Math.max(20, distance * 4);
    controls.update();
    applyLens({ zoom: 1, focusDistance: THREE.MathUtils.clamp(distance, 0.1, 200), blur: 0 });
  }
  function setScene(next) {
    validateScene(next);
    world.traverse(object => { if (object.isMesh) { object.geometry.dispose(); object.material.dispose(); } });
    world.clear();
    // Edits never mutate the response card or an earlier captured frame.
    layout = structuredClone(next); selected = null; meshes = []; undo = []; drag = null; candidate = null; controls.enabled = enabled;
    scene.background.set(next.background);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshStandardMaterial({ color: next.floor, roughness: 0.95 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.02; floor.receiveShadow = true; world.add(floor);
    entities = sceneGroups(layout).map((entity, groupIndex) => {
      const node = new THREE.Group(); node.position.fromArray(entity.origin); world.add(node);
      for (const index of entity.indices) {
        const object = layout.objects[index];
        const mesh = new THREE.Mesh(geometries[object.shape](), new THREE.MeshStandardMaterial({ color: object.color, roughness: object.roughness, metalness: object.metalness, flatShading: object.shape === 'icosahedron' }));
        mesh.position.fromArray(object.position).sub(node.position); mesh.scale.fromArray(object.size); mesh.rotation.fromArray(object.rotation);
        mesh.castShadow = true; mesh.receiveShadow = true; mesh.userData.groupIndex = groupIndex; meshes.push(mesh); node.add(mesh);
      }
      return { ...entity, node, sizes: entity.indices.map(index => [...layout.objects[index].size]) };
    });
    reset(); selectionChanged();
  }
  function resize() {
    const viewport = container.parentElement;
    if (!viewport.clientWidth || !viewport.clientHeight) return;
    const [rw, rh] = ratio.value.split(':').map(Number), aspect = rw / rh;
    const width = Math.min(viewport.clientWidth, viewport.clientHeight * aspect), height = width / aspect;
    Object.assign(container.style, { position: 'absolute', width: `${width}px`, height: `${height}px`, left: `${(viewport.clientWidth - width) / 2}px`, top: `${(viewport.clientHeight - height) / 2}px` });
    renderer.setSize(width, height); camera.aspect = aspect; camera.updateProjectionMatrix(); needsRender = true;
  }
  const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(container.parentElement);
  renderer.setAnimationLoop(() => { if (active && !document.hidden) { controls.update(); if (needsRender) renderView(); } });
  function capture(maxDimension = 1024) {
    if (!layout) throw new Error('Create a scene first.');
    stopCameraMotion();
    const size = new THREE.Vector2(); renderer.getSize(size);
    const pixelRatio = renderer.getPixelRatio(), aspect = camera.aspect;
    try {
      const [w, h] = ratio.value.split(':').map(Number);
      const width = w >= h ? maxDimension : Math.round(maxDimension * w / h), height = h >= w ? maxDimension : Math.round(maxDimension * h / w);
      renderer.setPixelRatio(1); renderer.setSize(width, height, false);
      camera.aspect = w / h; camera.updateProjectionMatrix(); renderView(true);
      return { scene: structuredClone(layout), composition: renderer.domElement.toDataURL('image/jpeg', 0.88), position: camera.position.toArray(), target: controls.target.toArray(), ratio: ratio.value, lens: getLens() };
    } finally {
      renderer.setPixelRatio(pixelRatio); renderer.setSize(size.x, size.y, false);
      camera.aspect = aspect; camera.updateProjectionMatrix(); renderView();
    }
  }
  function restore(shot) {
    setScene(shot.scene); camera.position.fromArray(shot.position); controls.target.fromArray(shot.target);
    ratio.value = shot.ratio; controls.update(); resize();
    applyLens(shot.lens || { zoom: 1, focusDistance: THREE.MathUtils.clamp(camera.position.distanceTo(controls.target), 0.1, 200), blur: 0 });
  }
  function replaceScene(next) {
    stopCameraMotion();
    const position = camera.position.clone(), target = controls.target.clone(), settings = getLens();
    setScene(next); camera.position.copy(position); controls.target.copy(target); controls.update();
    applyLens(settings);
  }
  function reviewViews(next) {
    setScene(next); resize();
    const front = capture(640).composition;
    const offset = camera.position.clone().sub(controls.target).applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 3);
    camera.position.copy(controls.target).add(offset); controls.update();
    return [front, capture(640).composition];
  }
  function dispose() {
    renderer.setAnimationLoop(null); resizeObserver.disconnect(); controls.dispose();
    world.traverse(object => { if (object.isMesh) { object.geometry.dispose(); object.material.dispose(); } });
    sun.shadow.dispose();
    if (composer) { for (const pass of composer.passes) pass.dispose?.(); composer.dispose(); }
    renderer.dispose(); renderer.forceContextLoss(); selectionFrame.remove(); renderer.domElement.remove();
  }
  return { setScene, replaceScene, reset, resize, capture, restore, selectObject, setHeight, setScale, undoMove, setZoom, setFocusDistance, setBlur, focusSelected, getLens, reviewViews, dispose,
    snapshot: () => structuredClone(layout),
    setEnabled: value => { enabled = value; controls.enabled = value; if (!value) { stopCameraMotion(); drag = null; candidate = null; } selectionChanged(); },
    getObjects: () => entities.map((object, index) => ({ name: object.name, index })),
    setActive: value => { active = value; if (value) resize(); updateSelectionFrame(); },
  };
}

// An isolated renderer prevents review attempts from overwriting an older chat
// card, undo history, camera or captured frame. It is always released afterwards.
export function renderReviewViews(scene) {
  const host = document.createElement('div'), canvas = document.createElement('div');
  host.setAttribute('aria-hidden', 'true'); host.inert = true;
  Object.assign(host.style, { position: 'fixed', left: '-10000px', width: '640px', height: '480px', pointerEvents: 'none' });
  host.append(canvas); document.body.append(host);
  let preview;
  try { preview = createStudio(canvas, { value: '4:3' }); return preview.reviewViews(scene); }
  finally { preview?.dispose(); host.remove(); }
}
