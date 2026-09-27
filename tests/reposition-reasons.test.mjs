// Why a bus was moved rather than travelled, said truly. Each case is one the fleet's reels found said
// wrongly on 26 September 2026 (scripts/evaluate-fleet-steps.mjs on the noon and evening reels, each
// repositioning tagged with the branch of the drawing that made it): the reason is the pair rule's, judged
// between the report the bus was drawn at and where it was moved to — too far (over 400 m), too long (over
// 45 s unseen), or, for a pair that could have been travelled, skipped because the playback starts its
// delay behind the newest report — and "reported positions only" is the passenger's choice, not a gap.
import test from 'node:test';
import assert from 'node:assert/strict';
import {historyFrom, metres, observedAt, stepVisual} from '../lib/motion.ts';
import {describeMotion} from '../lib/motion-view.ts';

// A straight street east from a point in Manchester; reports placed by metres along it.
const O = {lat: 53.48, lon: -2.24};
const east = m => O.lon + m / (111195 * Math.cos(O.lat * Math.PI / 180));
const BASE = 1_790_000_000_000;
const report = (m, s) => ({lat: O.lat, lon: east(m), at: BASE + s * 1000, bearing: null, service: '203|outbound|2077'});
const REASON = 'no road geometry';

/** A bus drawn at a lone report: what the page has drawn when a bus first appears with an empty trail. */
function drawnAtLone(p) {
 const h = historyFrom([p]);
 return stepVisual(null, observedAt(h, p.at + 5000, REASON), p.at + 5000, null, undefined, h);
}

test('a bus drawn at a lone report, next reported 280 s and 392 m on with its trail empty: too long, not "no earlier report"', () => {
 // MF74NRN, route 203, 26 September 2026: 11:50:22, then 11:55:02, the first older than the trail reaches.
 const v = drawnAtLone(report(0, 0));
 assert.equal(v.buffer, null, 'drawn at its report, not played back');
 const q = report(392, 280), h = historyFrom([q]);
 const w = stepVisual(v, observedAt(h, q.at + 7000, REASON), q.at + 7000, null, undefined, h);
 assert.equal(w.lastCorrection?.kind, 'snap');
 assert.equal(w.lastCorrection.why, 'too_long');
 assert.ok(Math.abs(w.lastCorrection.metres - 392) < 1);
});

test('a bus drawn at a lone report, next reported 20 s and 150 m on with its trail empty, travels there', () => {
 // The pair allows it, and both ends are reports: travelled at the pair's own time, as any two reports are.
 const v = drawnAtLone(report(0, 0));
 const q = report(150, 20), h = historyFrom([q]);
 const w = stepVisual(v, observedAt(h, q.at + 7000, REASON), q.at + 7000, null, undefined, h);
 assert.notEqual(w.lastCorrection?.kind, 'snap', 'not repositioned');
 assert.ok(w.glide, 'it travels');
 assert.ok(metres(w, report(0, 0)) < 1, 'from where it was drawn');
 const later = stepVisual(w, observedAt(h, q.at + 27_000, REASON), q.at + 27_000, null, undefined, h);
 assert.ok(metres(later, q) < 1, 'to the new report, in the pair’s own 20 s');
});

test('a playback that starts away from the lone report the bus was drawn at says the pair’s own reason', () => {
 // Nine such moves on the two reels were all said to be "too long": two were too far (455 m after 191 s,
 // 2,282 m after 204 s) and four could have been travelled (22–43 s apart). The reports after the lone one
 // arrive without it; the bus stands at the later reports, so where the playback starts is known exactly.
 const cases = [
  {name: 'too far', to: 455, first: 185, why: 'too_far'},
  {name: 'too long', to: 282, first: 60, why: 'too_long'},
  {name: 'travelable, skipped because the playback starts behind', to: 287, first: 30, why: 'late'},
 ];
 for (const c of cases) {
  const v = drawnAtLone(report(0, 0));
  const q1 = report(c.to, c.first), q2 = report(c.to, c.first + 10), h = historyFrom([q1, q2]);
  // Arriving 10 s after the newest was made: the playback starts max(first report, now − 30 s delay).
  const now = q2.at + 10_000;
  const w = stepVisual(v, observedAt(h, now, REASON), now, null, undefined, h);
  assert.ok(w.buffer, `${c.name}: played back`);
  assert.equal(w.lastCorrection?.kind, 'snap', `${c.name}: repositioned`);
  assert.equal(w.lastCorrection.why, c.why, c.name);
  assert.ok(Math.abs(w.lastCorrection.metres - c.to) < 1, `${c.name}: ${w.lastCorrection.metres.toFixed(1)} m`);
 }
});

test('reported positions only: each move is the passenger’s choice, said as such', () => {
 // The drawing is not given the reports in this mode, and every move over 25 m was said to be "because there
 // was no earlier report to travel from", of buses with a trail of six.
 const v = drawnAtLone(report(0, 0));
 const h = historyFrom([report(0, 0), report(180, 20)]);
 const w = stepVisual(v, observedAt(h, BASE + 27_000, 'you chose reported positions only'), BASE + 27_000, null);
 assert.equal(w.lastCorrection?.why, 'reports_only');
 const words = describeMotion({mode: 'observed', reason: 'you chose reported positions only', reportAge: 7, capped: false, horizon: 120,
  between: false, travels: false, standing: false, onRoad: false, offRoad: false, displayDelaySeconds: null, speedKmh: null, eased: false,
  uncertaintyMetres: null, uncertaintyN: null, version: 'test',
  correction: {kind: 'snap', metres: 180, at: BASE + 27_000, justNow: true, standing: false, why: 'reports_only'}});
 assert.equal(words.said, 'It was moved 180 m to its latest report rather than travelled there, because you chose to see reported positions only.');
});
