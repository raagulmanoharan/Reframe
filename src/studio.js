import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { validateScene } from '../lib/scene-schema.js';

export function createStudio(container, ratio) {
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
  let layout = null;
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
    for (const object of [...world.children]) { world.remove(object); object.geometry.dispose(); object.material.dispose(); }
    layout = next;
    scene.background.set(next.background);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshStandardMaterial({ color: next.floor, roughness: 0.95 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.02; floor.receiveShadow = true; world.add(floor);
    for (const object of next.objects) {
      const mesh = new THREE.Mesh(geometries[object.shape](), new THREE.MeshStandardMaterial({ color: object.color, roughness: object.roughness, metalness: object.metalness, flatShading: true }));
      mesh.position.fromArray(object.position); mesh.scale.fromArray(object.size); mesh.rotation.fromArray(object.rotation);
      mesh.castShadow = true; mesh.receiveShadow = true; world.add(mesh);
    }
    reset();
  }
  function resize() {
    const viewport = container.parentElement;
    const [rw, rh] = ratio.value.split(':').map(Number), aspect = rw / rh;
    const width = Math.min(viewport.clientWidth, viewport.clientHeight * aspect), height = width / aspect;
    Object.assign(container.style, { position: 'absolute', width: `${width}px`, height: `${height}px`, left: `${(viewport.clientWidth - width) / 2}px`, top: `${(viewport.clientHeight - height) / 2}px` });
    renderer.setSize(width, height); camera.aspect = aspect; camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container.parentElement);
  renderer.setAnimationLoop(() => { if (!document.hidden) { controls.update(); renderer.render(scene, camera); } });
  function capture() {
    if (!layout) throw new Error('Create a scene first.');
    controls.update();
    const size = new THREE.Vector2(); renderer.getSize(size);
    const pixelRatio = renderer.getPixelRatio(), aspect = camera.aspect;
    try {
      const [w, h] = ratio.value.split(':').map(Number);
      const width = w >= h ? 1024 : Math.round(1024 * w / h), height = h >= w ? 1024 : Math.round(1024 * h / w);
      renderer.setPixelRatio(1); renderer.setSize(width, height, false);
      camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.render(scene, camera);
      return { composition: renderer.domElement.toDataURL('image/jpeg', 0.88), position: camera.position.toArray(), target: controls.target.toArray(), ratio: ratio.value };
    } finally {
      renderer.setPixelRatio(pixelRatio); renderer.setSize(size.x, size.y, false);
      camera.aspect = aspect; camera.updateProjectionMatrix(); renderer.render(scene, camera);
    }
  }
  function restore(shot) {
    setScene(shot.scene); camera.position.fromArray(shot.position); controls.target.fromArray(shot.target);
    ratio.value = shot.ratio; controls.update(); resize();
  }
  return { setScene, reset, resize, capture, restore };
}
