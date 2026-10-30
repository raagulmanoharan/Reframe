import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { validateScene } from '../lib/scene-schema.js';
import { sceneGroups } from '../lib/scene-groups.js';

export function createStudio(container, ratio, onSelection = () => {}) {
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
  const touches = new Map();
  let handingOff = false;
  let meshes = [], entities = [];
  const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
  const highlight = new THREE.BoxHelper(new THREE.Object3D(), 0x9b742e);
  highlight.visible = false; scene.add(highlight);
  function selectionChanged() {
    if (selected !== null) highlight.setFromObject(entities[selected].node);
    highlight.visible = selected !== null;
    onSelection(selected === null ? null : { index: selected, name: entities[selected].name, height: entities[selected].node.position.y, scale: entities[selected].node.scale.x }, undo.length > 0);
  }
  function selectObject(index) {
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
  function setScale(value) {
    if (selected === null || !Number.isFinite(value)) return;
    const entity = entities[selected], dimensions = entity.sizes.flat();
    const span = Math.max(...[0, 1, 2].map(axis => Math.max(...entity.positions.map(p => p[axis])) - Math.min(...entity.positions.map(p => p[axis]))));
    const min = Math.max(0.1, 0.01 / Math.min(...dimensions));
    const max = Math.min(5, 30 / Math.max(...dimensions), span ? 50 / span : 5);
    rememberMove(); entity.node.scale.setScalar(THREE.MathUtils.clamp(value, min, max)); clampPosition(entity); commitPosition();
  }
  function undoMove() {
    const previous = undo.pop(); if (!previous) return;
    selected = previous.index; entities[selected].node.position.fromArray(previous.position); entities[selected].node.scale.setScalar(previous.scale); commitPosition();
  }
  function stopCameraMotion() {
    controls.enableDamping = false; controls.update(); controls.enableDamping = true;
  }
  function cast(event) {
    const bounds = renderer.domElement.getBoundingClientRect();
    pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
  }
  surface.addEventListener('pointerdown', event => {
    if (handingOff) return;
    if (!enabled) { event.stopImmediatePropagation(); return; }
    if (event.pointerType === 'touch') {
      touches.set(event.pointerId, { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY });
      if (touches.size > 1) {
        // Hand the first finger to OrbitControls too, so pinch/pan works even
        // when the gesture began on an object. Do not move the object again.
        if (drag) {
          const first = touches.get(drag.pointerId); drag = null; controls.enabled = true;
          handingOff = true;
          try { surface.dispatchEvent(new PointerEvent('pointerdown', { ...first, pointerType: 'touch', button: 0, bubbles: true })); }
          finally { handingOff = false; }
        }
        return;
      }
    }
    if (event.button !== 0 || drag) return;
    const bounds = renderer.domElement.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) { selectObject(null); return; }
    cast(event);
    const hit = raycaster.intersectObjects(meshes, false)[0];
    if (!hit) { selectObject(null); return; }
    event.stopImmediatePropagation(); event.preventDefault(); stopCameraMotion(); controls.enabled = false;
    selectObject(hit.object.userData.groupIndex);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -hit.point.y);
    const point = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
    if (!point) { controls.enabled = true; return; }
    drag = { pointerId: event.pointerId, plane, offset: entities[selected].node.position.clone().sub(point), x: event.clientX, y: event.clientY, moved: false };
    surface.setPointerCapture(event.pointerId);
    container.style.cursor = 'grabbing';
  }, true);
  surface.addEventListener('pointermove', event => {
    if (touches.has(event.pointerId)) touches.set(event.pointerId, { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY });
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.stopImmediatePropagation(); cast(event);
    if (!drag.moved) {
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 4) return;
      rememberMove(); drag.moved = true;
    }
    const point = raycaster.ray.intersectPlane(drag.plane, new THREE.Vector3());
    if (!point) return;
    point.add(drag.offset);
    const entity = entities[selected];
    entity.node.position.x = point.x; entity.node.position.z = point.z; clampPosition(entity);
    commitPosition();
  }, true);
  const release = event => {
    touches.delete(event.pointerId);
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.stopImmediatePropagation(); drag = null; controls.enabled = enabled; container.style.cursor = 'grab';
    if (surface.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId);
    selectionChanged();
  };
  surface.addEventListener('pointerup', release, true);
  surface.addEventListener('pointercancel', release, true);
  const geometries = {
    box: () => new THREE.BoxGeometry(1, 1, 1),
    sphere: () => new THREE.SphereGeometry(0.5, 16, 10),
    cylinder: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 16),
    cone: () => new THREE.ConeGeometry(0.5, 1, 12),
    torus: () => new THREE.TorusGeometry(0.43, 0.07, 10, 32),
    icosahedron: () => new THREE.IcosahedronGeometry(0.5, 0),
  };
  function reset() {
    if (!layout) return;
    stopCameraMotion();
    camera.position.fromArray(layout.camera.position); controls.target.fromArray(layout.camera.target);
    const distance = camera.position.distanceTo(controls.target);
    controls.minDistance = Math.max(0.15, distance * 0.08); controls.maxDistance = Math.max(20, distance * 4);
    controls.update();
  }
  function setScene(next) {
    validateScene(next);
    world.traverse(object => { if (object.isMesh) { object.geometry.dispose(); object.material.dispose(); } });
    world.clear();
    // Edits never mutate the response card or an earlier captured frame.
    layout = structuredClone(next); selected = null; meshes = []; undo = []; drag = null; controls.enabled = enabled;
    scene.background.set(next.background);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshStandardMaterial({ color: next.floor, roughness: 0.95 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.02; floor.receiveShadow = true; world.add(floor);
    entities = sceneGroups(layout).map((entity, groupIndex) => {
      const node = new THREE.Group(); node.position.fromArray(entity.origin); world.add(node);
      for (const index of entity.indices) {
        const object = layout.objects[index];
        const mesh = new THREE.Mesh(geometries[object.shape](), new THREE.MeshStandardMaterial({ color: object.color, roughness: object.roughness, metalness: object.metalness, flatShading: true }));
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
    renderer.setSize(width, height); camera.aspect = aspect; camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container.parentElement);
  renderer.setAnimationLoop(() => { if (active && !document.hidden) { controls.update(); renderer.render(scene, camera); } });
  function capture() {
    if (!layout) throw new Error('Create a scene first.');
    stopCameraMotion();
    const size = new THREE.Vector2(); renderer.getSize(size);
    const pixelRatio = renderer.getPixelRatio(), aspect = camera.aspect;
    const wasHighlighted = highlight.visible;
    try {
      highlight.visible = false;
      const [w, h] = ratio.value.split(':').map(Number);
      const width = w >= h ? 1024 : Math.round(1024 * w / h), height = h >= w ? 1024 : Math.round(1024 * h / w);
      renderer.setPixelRatio(1); renderer.setSize(width, height, false);
      camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.render(scene, camera);
      return { scene: structuredClone(layout), composition: renderer.domElement.toDataURL('image/jpeg', 0.88), position: camera.position.toArray(), target: controls.target.toArray(), ratio: ratio.value };
    } finally {
      highlight.visible = wasHighlighted;
      renderer.setPixelRatio(pixelRatio); renderer.setSize(size.x, size.y, false);
      camera.aspect = aspect; camera.updateProjectionMatrix(); renderer.render(scene, camera);
    }
  }
  function restore(shot) {
    setScene(shot.scene); camera.position.fromArray(shot.position); controls.target.fromArray(shot.target);
    ratio.value = shot.ratio; controls.update(); resize();
  }
  function replaceScene(next) {
    stopCameraMotion();
    const position = camera.position.clone(), target = controls.target.clone();
    setScene(next); camera.position.copy(position); controls.target.copy(target); controls.update();
  }
  return { setScene, replaceScene, reset, resize, capture, restore, selectObject, setHeight, setScale, undoMove,
    snapshot: () => structuredClone(layout),
    setEnabled: value => { enabled = value; controls.enabled = value; if (!value) { stopCameraMotion(); drag = null; } selectionChanged(); },
    getObjects: () => entities.map((object, index) => ({ name: object.name, index })),
    setActive: value => { active = value; if (value) resize(); },
  };
}
