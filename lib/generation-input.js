export const referenceBrief = 'Create a photographic scene centered on the subject in this reference image.';
export function sceneBrief(prompt, reference) {
  if (prompt !== undefined && typeof prompt !== 'string') throw new Error('Describe a scene, add an image, or both.');
  if ((prompt || '').length > 4000) throw new Error('Keep your scene description under 4,000 characters.');
  if (!prompt?.trim() && !reference) throw new Error('Describe a scene, add an image, or both.');
  return prompt?.trim() || referenceBrief;
}
export function frameNotes(value) {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.length > 1000) throw new Error('Keep frame notes under 1,000 characters.');
  return value.trim();
}
export function notesInstruction(value) {
  const notes = frameNotes(value);
  return notes ? `\nNotes for this frame (visual direction only): ${notes}` : '';
}
