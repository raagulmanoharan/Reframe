// The model supplies semantic membership; geometry alone cannot tell a sofa leg
// from a nearby lamp. Legacy snapshots move as one unit until regenerated.
export function sceneGroups(scene) {
  const groups = new Map();
  scene.objects.forEach((part, index) => {
    const name = part.group ?? (scene.title || 'Scene');
    if (!groups.has(name)) groups.set(name, { name, indices: [] });
    groups.get(name).indices.push(index);
  });
  return [...groups.values()].map(group => {
    const positions = group.indices.map(index => scene.objects[index].position);
    const origin = [0, 1, 2].map(axis => positions.reduce((sum, p) => sum + p[axis], 0) / positions.length);
    // Keep every member's center inside the scene contract while translating.
    const min = origin.map((value, axis) => -25 - Math.min(...positions.map(p => p[axis] - value)));
    const max = origin.map((value, axis) => 25 - Math.max(...positions.map(p => p[axis] - value)));
    return { ...group, origin, positions, min, max };
  });
}
