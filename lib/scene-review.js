const shortText = maxLength => ({ type: 'string', minLength: 1, maxLength });
export const reviewSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    verdict: { type: 'string', enum: ['pass', 'revise'] }, summary: shortText(500),
    issues: { type: 'array', maxItems: 5, items: {
      type: 'object', additionalProperties: false,
      properties: { severity: { type: 'string', enum: ['major', 'minor'] }, object: shortText(80), problem: shortText(300), fix: shortText(300) },
      required: ['severity', 'object', 'problem', 'fix'],
    } },
  }, required: ['verdict', 'summary', 'issues'],
};
export function validateReview(value) {
  const text = (s, max) => typeof s === 'string' && s.trim().length > 0 && s.length <= max;
  if (!value || !['pass', 'revise'].includes(value.verdict) || !text(value.summary, 500) || !Array.isArray(value.issues) || value.issues.length > 5 ||
    value.issues.some(i => !i || !['major', 'minor'].includes(i.severity) || !text(i.object, 80) || !text(i.problem, 300) || !text(i.fix, 300)) ||
    value.verdict === 'pass' && value.issues.some(i => i.severity === 'major') || value.verdict === 'revise' && !value.issues.length)
    throw new Error('The visual reviewer returned an unusable assessment.');
  return structuredClone(value);
}
const penalty = review => review.issues.reduce((total, issue) => total + (issue.severity === 'major' ? 10 : 1), 0);

// Separate builder/reviewer calls, with a single repair. A candidate is never
// promoted just because it was generated later; it must be rendered and reviewed.
export async function reviewSceneLoop(initial, { render, review, repair, signal, onProgress = () => {} }) {
  let best = initial, assessment = null, reviews = 0, repairs = 0;
  const checkStop = () => {
    if (signal?.aborted) {
      const error = new Error(signal.reason?.name === 'TimeoutError' ? 'The scene review reached its time limit.' : 'Scene generation stopped. Your message is still here.');
      error.code = signal.reason?.name === 'TimeoutError' ? 'TIMEOUT' : 'CANCELLED'; throw error;
    }
  };
  const inspect = async candidate => {
    checkStop(); onProgress('Rendering two views for the visual reviewer…');
    const images = await render(structuredClone(candidate.scene)); checkStop();
    onProgress(repairs ? 'Checking the repaired scene…' : 'Checking the scene against your description…');
    const result = validateReview(await review(candidate, images)); checkStop(); reviews++;
    return result;
  };
  const result = (status, reason = '') => ({ ...best, review: { status, assessment, reviews, repairs, reason } });
  try {
    assessment = await inspect(initial);
    if (assessment.verdict === 'pass') return result('reviewed');
    checkStop(); onProgress('Repairing the issues found in the scene…'); repairs++;
    const candidate = await repair(initial, assessment); checkStop();
    const nextAssessment = await inspect(candidate);
    if (nextAssessment.verdict === 'pass' || penalty(nextAssessment) < penalty(assessment)) { best = candidate; assessment = nextAssessment; }
    return result(assessment.verdict === 'pass' ? 'reviewed' : 'needs-work', assessment.verdict === 'pass' ? '' : 'The review still found issues after one repair.');
  } catch (error) {
    // Explicit cancellation discards the whole operation, even if an earlier
    // draft exists. Expired budgets/provider failures may return that draft.
    if (error.code === 'CANCELLED' || signal?.aborted && signal.reason?.name !== 'TimeoutError' || error.status === 401) throw error;
    return result(assessment ? 'needs-work' : 'unreviewed', error.message || 'Visual review could not finish.');
  }
}
