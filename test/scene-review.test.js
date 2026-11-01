import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewSceneLoop, validateReview } from '../lib/scene-review.js';
const initial = { scene: { title: 'original' }, model: 'builder:free' };
const revised = { scene: { title: 'repaired' }, model: 'builder:free' };
const issue = { severity: 'major', object: 'Chair', problem: 'Seat floats above the legs.', fix: 'Connect the legs to the underside of the seat.' };
const failed = { verdict: 'revise', summary: 'The seat needs support.', issues: [issue] };
const passed = { verdict: 'pass', summary: 'The visible supports meet the seat.', issues: [] };

test('visual feedback renders every candidate, passes critique to repair and reviews the revised scene', async () => {
  const events = [];
  const result = await reviewSceneLoop(initial, {
    render: scene => { events.push(`render:${scene.title}`); return [scene.title, 'side']; },
    review: (candidate, images) => { assert.equal(images[0], candidate.scene.title); events.push(`review:${candidate.scene.title}`); return candidate === initial ? failed : passed; },
    repair: (candidate, assessment) => { assert.equal(candidate, initial); assert.deepEqual(assessment, failed); events.push('repair'); return revised; },
  });
  assert.equal(result.scene.title, 'repaired'); assert.equal(result.review.status, 'reviewed');
  assert.equal(result.review.repairs, 1); assert.equal(result.review.reviews, 2);
  assert.deepEqual(events, ['render:original', 'review:original', 'repair', 'render:repaired', 'review:repaired']);
});
test('a passing initial review stops without a repair', async () => {
  const result = await reviewSceneLoop(initial, { render: () => [], review: () => passed, repair: () => assert.fail('unexpected repair') });
  assert.equal(result.review.status, 'reviewed'); assert.equal(result.review.repairs, 0); assert.equal(result.review.reviews, 1);
});
test('worse or unreviewable repairs never replace a reviewed draft, and the loop is bounded', async () => {
  for (const mode of ['worse', 'unreadable', 'rate-limit', 'repair-failure']) {
    let calls = 0;
    const result = await reviewSceneLoop(initial, {
      render: () => [],
      review: () => {
        if (++calls === 1) return failed;
        if (mode === 'rate-limit') throw new Error('Free-model limit reached.');
        if (mode === 'unreadable') return { verdict: 'pass' };
        return { ...failed, issues: [issue, { ...issue, object: 'Table' }] };
      },
      repair: () => { if (mode === 'repair-failure') throw new Error('Invalid geometry.'); return revised; },
    });
    assert.equal(result.scene.title, 'original'); assert.equal(result.review.status, 'needs-work');
    assert.equal(result.review.repairs, 1); assert.ok(calls <= 2); assert.deepEqual(result.review.assessment, failed);
  }
});
test('an improved draft that still has issues stays explicitly marked as needing work', async () => {
  let calls = 0;
  const result = await reviewSceneLoop(initial, { render: () => [], review: () => ++calls === 1 ? { ...failed, issues: [issue, issue] } : failed, repair: () => revised });
  assert.equal(result.scene.title, 'repaired'); assert.equal(result.review.status, 'needs-work');
});
test('missing or malformed review is never treated as approval; contradictory and oversized reviews fail', async () => {
  for (const value of [null, { ...passed, issues: [issue] }, { ...failed, issues: [] }, { ...failed, issues: Array(6).fill(issue) }, { ...passed, summary: 'x'.repeat(501) }]) assert.throws(() => validateReview(value), /unusable/);
  const result = await reviewSceneLoop(initial, { render: () => [], review: () => null, repair: () => assert.fail('no valid feedback') });
  assert.equal(result.review.status, 'unreviewed'); assert.equal(result.review.assessment, null);
});
test('Stop at any review stage discards results; timeout keeps a clearly labelled draft', async () => {
  for (const stage of ['render', 'review', 'repair']) {
    const controller = new AbortController();
    await assert.rejects(reviewSceneLoop(initial, {
      signal: controller.signal,
      render: () => { if (stage === 'render') controller.abort(); return []; },
      review: () => { if (stage === 'review') controller.abort(); return failed; },
      repair: () => { controller.abort(); return revised; },
    }), /generation stopped/);
  }
  const timeout = new AbortController();
  const result = await reviewSceneLoop(initial, { signal: timeout.signal, render: () => { timeout.abort(new DOMException('Timed out', 'TimeoutError')); return []; }, review: () => assert.fail('expired') });
  assert.equal(result.review.status, 'unreviewed'); assert.match(result.review.reason, /time limit/);
});
