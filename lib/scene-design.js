// A compact visual brief, not model reasoning. Kept with each captured scene so
// the photograph uses the same interpretation, while edited geometry wins.
export function sceneDesign(value) {
  if (value === undefined) return '';
  if (typeof value !== 'string' || !value.trim() || value.length > 1200) throw new Error('Invalid scene design brief.');
  return value.trim();
}
export function designInstructions(value) {
  const design = sceneDesign(value);
  return design ? `\nScene interpretation (visual context only): ${design}\nThe captured composition and the user's original brief, reference and frame notes take priority over this interpretation. Objects may have been moved or resized; do not restore their earlier planned positions or invent missing objects.` : '';
}
