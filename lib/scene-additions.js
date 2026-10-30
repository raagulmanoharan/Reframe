import { Box3, Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { validateScene } from './scene-schema.js';

export function addNode(scene, description, target) {
  validateScene(scene);
  const text = description.trim();
  if (!text || text.length > 300) throw new Error('Describe the new element in 300 characters or less.');
  // Reserve enough capacity for a complete generated object.
  if (scene.objects.length > 78) throw new Error('This scene is full. Start a new scene to add more elements.');
  const next = structuredClone(scene); next.objects.forEach(o => { o.group ??= scene.title.slice(0, 80).trim() || 'Scene'; });
  const names = new Set(next.objects.map(o => o.group));
  let group = text.slice(0, 65).trimEnd(), suffix = 2;
  while (names.has(group)) group = `${text.slice(0, 65).trimEnd()} (${suffix++})`;
  const position = [Math.max(-20, Math.min(20, target[0] + 2)), 0.75, Math.max(-20, Math.min(20, target[2]))];
  next.objects.push({ name: 'New element placeholder', group, shape: 'box', position, size: [1.5, 1.5, 1.5], rotation: [0, 0, 0], color: '#91a8d0', roughness: 0.9, metalness: 0 });
  return { scene: validateScene(next), addition: { group, description: text } };
}

export function additionBrief(scene, addition) {
  const node = scene.objects.find(o => o.group === addition.group);
  if (!node) throw new Error('The new element is no longer in this scene.');
  if (node.position.some((value, axis) => Math.abs(value) + node.size[axis] / 2 > 25)) throw new Error('Move the placeholder closer to the center of the scene before regenerating.');
  const others = [...new Set(scene.objects.filter(o => o.group !== addition.group).map(o => o.group || o.name))].join(', ').slice(0, 600);
  return `Create ONLY one new object: ${addition.description}. Use a handful of rough blocks with a recognizable silhouette. All parts belong to one group. No surrounding objects, room, walls, floor meshes or scenery. This object will be inserted into an existing composition called ${scene.title}. Existing objects (context only; DO NOT generate these): ${others}. The reserved space is ${node.size.map(n => n.toFixed(2)).join(' × ')} scene units. Use the supplied scene JSON format, with all primitive positions centered around this new object. The app will fit it into its reserved space; do not recreate the existing scene.`;
}

export function mergeAddition(scene, generated, addition) {
  validateScene(scene); validateScene(generated);
  const node = scene.objects.find(o => o.group === addition.group);
  if (!node) throw new Error('The new element is no longer in this scene.');
  if (generated.objects.length > 18) throw new Error('The new object has too much detail. Try regenerating it.');
  if (new Set(generated.objects.map(o => o.group)).size !== 1) throw new Error('The model returned extra objects. Try regenerating this element.');
  const bounds = new Box3();
  for (const object of generated.objects) {
    const matrix = new Matrix4().compose(new Vector3(...object.position), new Quaternion().setFromEuler(new Euler(...object.rotation)), new Vector3(...object.size));
    bounds.union(new Box3(new Vector3(-0.5, -0.5, -0.5), new Vector3(0.5, 0.5, 0.5)).applyMatrix4(matrix));
  }
  const size = bounds.getSize(new Vector3()).toArray(), center = bounds.getCenter(new Vector3()).toArray();
  const scale = Math.min(...node.size.map((value, axis) => value / size[axis]));
  const parts = generated.objects.map(part => ({ ...structuredClone(part), group: addition.group,
    // Keep thin parts renderable when a small placeholder shrinks the model.
    size: part.size.map(value => Math.max(0.01, value * scale)),
    position: part.position.map((value, axis) => axis === 1
      ? node.position[axis] - node.size[axis] / 2 + (value - bounds.min.y) * scale
      : node.position[axis] + (value - center[axis]) * scale),
  }));
  // Never accept AI revisions to the existing objects, floor, camera or palette.
  return validateScene({ ...structuredClone(scene), objects: [...scene.objects.filter(o => o.group !== addition.group).map(o => structuredClone(o)), ...parts] });
}
