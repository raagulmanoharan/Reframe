export function validateLens(value) {
  if (value === undefined) return undefined; // Older frames have no lens settings.
  const inRange = (n, min, max) => Number.isFinite(n) && n >= min && n <= max;
  if (!value || !inRange(value.zoom, 0.5, 3) || !inRange(value.focusDistance, 0.1, 200) || !inRange(value.blur, 0, 100)) throw new Error('Invalid camera settings.');
  const lens = { zoom: value.zoom, focusDistance: value.focusDistance, blur: value.blur };
  if (value.focusTarget !== undefined) {
    const target = value.focusTarget;
    if (!target || typeof target.group !== 'string' || !target.group.trim() || target.group.length > 100 || !Array.isArray(target.point) || target.point.length !== 3 || !target.point.every(n => inRange(n, -100, 100))) throw new Error('Invalid camera focus target.');
    lens.focusTarget = { group: target.group, point: [...target.point] };
  }
  return lens;
}

export function lensInstructions(value) {
  const lens = validateLens(value);
  if (!lens) return '';
  const fov = 2 * Math.atan(Math.tan(22 * Math.PI / 180) / lens.zoom) * 180 / Math.PI;
  const depth = lens.blur === 0 ? 'Deep focus: keep foreground, subject and background sharp. Do not add background blur.'
    : `Use ${lens.blur < 35 ? 'subtle' : lens.blur < 70 ? 'moderate' : 'strong'} depth-of-field blur (${Math.round(lens.blur)}/100), with natural foreground and background defocus away from the focus plane. Preserve the sharp and blurred regions shown in the composition.`;
  return `\nCamera direction saved with this frame: lens zoom ${lens.zoom.toFixed(2)}x, vertical field of view ${fov.toFixed(1)} degrees. Preserve this framing rather than zooming or moving the camera. Focus plane: ${lens.focusDistance.toFixed(2)} scene units along the viewing direction (relative scene scale, not meters). ${lens.focusTarget ? `Keep the subject named ${JSON.stringify(lens.focusTarget.group)} in focus. ` : ''}${depth}`;
}
