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
  const controls = new OrbitControls(camera, renderer.domElement);
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
  let layout = null, moveMode = false, selected = null, drag = null, undo = [], active = false;
  let meshes = [], entities = [];
  const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
  const highlight = new THREE.BoxHelper(new THREE.Object3D(), 0x9b742e);
  highlight.visible = false; scene.add(highlight);
  function selectionChanged() {
    if (selected !== null) highlight.setFromObject(entities[selected].node);
    highlight.visible = moveMode && selected !== null;
    onSelection(selected === null ? null : { index: selected, name: entities[selected].name, height: entities[selected].node.position.y }, undo.length > 0);
  }
  function selectObject(index) {
    selected = Number.isInteger(index) && entities[index] ? index : null;
    selectionChanged();
  }
  function rememberMove() {
    if (selected !== null) {
      undo.push({ index: selected, position: entities[selected].node.position.toArray() });
      if (undo.length > 30) undo.shift();
    }
  }
  function commitPosition() {
    const entity = entities[selected], position = entity.node.position.toArray();
    entity.indices.forEach((index, member) => {
      layout.objects[index].position = entity.positions[member].map((value, axis) => value + (position[axis] - entity.origin[axis]));
    });
    selectionChanged();
  }
  function setHeight(height) {
    if (selected === null || !Number.isFinite(height)) return;
    const entity = entities[selected];
    rememberMove(); entity.node.position.y = THREE.MathUtils.clamp(height, entity.min[1], entity.max[1]); commitPosition();
  }
  function undoMove() {
    const previous = undo.pop(); if (!previous) return;
    selected = previous.index; entities[selected].node.position.fromArray(previous.position); commitPosition();
  }
  function setMoveMode(enabled) {
    moveMode = enabled; drag = null;
    controls.enableDamping = false; controls.update(); controls.enableDamping = true;
    controls.enabled = !enabled;
    container.style.cursor = enabled ? 'grab' : '';
    selectionChanged();
  }
  function cast(event) {
    const bounds = renderer.domElement.getBoundingClientRect();
    pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
  }
  renderer.domElement.addEventListener('pointerdown', event => {
    if (!moveMode || event.button !== 0 || drag) return;
    event.stopImmediatePropagation(); event.preventDefault(); cast(event);
    const hit = raycaster.intersectObjects(meshes, false)[0];
    if (!hit) { selectObject(null); return; }
    selectObject(hit.object.userData.groupIndex);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -hit.point.y);
    const point = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
    if (!point) return;
    rememberMove();
    drag = { pointerId: event.pointerId, plane, offset: entities[selected].node.position.clone().sub(point) };
    renderer.domElement.setPointerCapture(event.pointerId);
    container.style.cursor = 'grabbing';
  }, true);
  renderer.domElement.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.stopImmediatePropagation(); cast(event);
    const point = raycaster.ray.intersectPlane(drag.plane, new THREE.Vector3());
    if (!point) return;
    point.add(drag.offset);
    const entity = entities[selected];
    entity.node.position.x = THREE.MathUtils.clamp(point.x, entity.min[0], entity.max[0]);
    entity.node.position.z = THREE.MathUtils.clamp(point.z, entity.min[2], entity.max[2]);
    commitPosition();
  }, true);
  const release = event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.stopImmediatePropagation(); drag = null; container.style.cursor = 'grab';
    if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
    selectionChanged();
  };
  renderer.domElement.addEventListener('pointerup', release, true);
  renderer.domElement.addEventListener('pointercancel', release, true);
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
    layout = structuredClone(next); selected = null; meshes = []; undo = []; drag = null;
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
      return { ...entity, node };
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
    controls.update();
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
  return { setScene, reset, resize, capture, restore, selectObject, setHeight, setMoveMode, undoMove,
    getObjects: () => entities.map((object, index) => ({ name: object.name, index })),
    setActive: value => { active = value; if (value) resize(); },
  };
}
