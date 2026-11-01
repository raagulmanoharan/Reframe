import { sceneDesign } from './scene-design.js';
export const shapes = ['box', 'roundedBox', 'capsule', 'sphere', 'cylinder', 'cone', 'torus', 'icosahedron'];
const number = { type: 'number' };
const vector = { type: 'array', items: number, minItems: 3, maxItems: 3 };
export const sceneSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    design: { type: 'string', minLength: 1, maxLength: 1200 },
    title: { type: 'string' }, background: { type: 'string' }, floor: { type: 'string' },
    camera: { type: 'object', additionalProperties: false, properties: { position: vector, target: vector }, required: ['position', 'target'] },
    objects: {
      type: 'array', minItems: 1, maxItems: 96,
      items: { type: 'object', additionalProperties: false, properties: {
        name: { type: 'string' }, group: { type: 'string', minLength: 1, maxLength: 80 }, shape: { type: 'string', enum: shapes },
        position: vector, size: vector, rotation: vector,
        color: { type: 'string' }, roughness: number, metalness: number,
      }, required: ['name', 'group', 'shape', 'position', 'size', 'rotation', 'color', 'roughness', 'metalness'] },
    },
  }, required: ['design', 'title', 'background', 'floor', 'camera', 'objects'],
};
const color = v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
const vectorIn = (v, min, max) => Array.isArray(v) && v.length === 3 && v.every(n => Number.isFinite(n) && n >= min && n <= max);
export function validateScene(s) {
  // Old captured scenes have no design brief; newly generated schemas require it.
  sceneDesign(s?.design);
  if (!s || typeof s.title !== 'string' || s.title.length > 100 || !color(s.background) || !color(s.floor)) throw new Error('Invalid scene metadata.');
  if (!vectorIn(s.camera?.position, -50, 50) || !vectorIn(s.camera?.target, -25, 25)) throw new Error('Invalid scene camera.');
  if (s.camera.position[1] < 0.1 || Math.hypot(...s.camera.position.map((x, i) => x - s.camera.target[i])) < 0.5) throw new Error('Invalid camera distance.');
  if (!Array.isArray(s.objects) || s.objects.length < 1 || s.objects.length > 96) throw new Error('Invalid scene object count.');
  // Legacy snapshots may have no grouping. Never accept partially grouped scenes.
  const grouped = s.objects.some(o => o.group !== undefined);
  for (const o of s.objects) {
    if (grouped && (typeof o.group !== 'string' || !o.group.trim() || o.group.length > 80 || o.group !== o.group.trim())) throw new Error('Invalid scene object group.');
    if (typeof o.name !== 'string' || o.name.length > 100 || !shapes.includes(o.shape) || !color(o.color) || !vectorIn(o.position, -25, 25) || !vectorIn(o.size, 0.01, 30) || !vectorIn(o.rotation, -Math.PI * 2, Math.PI * 2) || !Number.isFinite(o.roughness) || o.roughness < 0 || o.roughness > 1 || !Number.isFinite(o.metalness) || o.metalness < 0 || o.metalness > 1) throw new Error('Invalid scene object.');
  }
  return s;
}
