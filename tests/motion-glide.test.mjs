// A bus with no accepted road geometry is shown at its reports, and travels from one to the next
// instead of teleporting (GLIDE in lib/motion.ts). It is never drawn past the newest report, its
// bearing is never taken from the direction it is travelling, and a gap too large to have been
// followed is left as the jump it is.
import test from 'node:test';
import assert from 'node:assert/strict';
import {GLIDE, historyFrom, metres, needsFrames, observedAt, observedBetween, stepVisual} from '../lib/motion.ts';

const at = (t, lat, lon, bearing = 90) => ({at: t, lat, lon, bearing, service: 's', source: 'h' + t});
const A = [53.45, -2.31];
const draw = (previous, fixes, now) => stepVisual(previous, observedAt(historyFrom(fixes), now, 'no shape'), now, null);
/** The first report drawn, then a second report arriving at `t`, then frames up to `until`. */
function run(second, {t = 20_000, until = 2000, step = 100} = {}) {
  const first = [at(0, A[0], A[1])];
  let v = draw(null, first, 0);
  const fixes = [...first, second];
  const frames = [];
  for (let dt = 0; dt <= until; dt += step) {v = draw(v, fixes, t + dt); frames.push({dt, v})}
  return {frames, last: frames[frames.length - 1].v, second};
}

test('a report that arrives is travelled to, not jumped to, and the bus stops exactly there', () => {
  const second = at(20_000, 53.4511, -2.31);           // about 122 m on
  const {frames, last} = run(second);
  const steps = frames.slice(1).map((f, i) => metres(frames[i].v, f.v));
  assert.ok(Math.max(...steps) < 30, `no frame jumps the whole way: largest ${Math.max(...steps).toFixed(1)} m`);
  assert.ok(frames.some(f => f.dt > 0 && f.dt < GLIDE.ms && metres(f.v, A_POINT) > 5 && metres(f.v, second) > 5),
    'it is drawn between the two reports while it travels');
  assert.equal(+last.lat.toFixed(6), +second.lat.toFixed(6), 'it ends at the report');
  assert.equal(last.glide, null, 'and the glide is done');
});
const A_POINT = {lat: A[0], lon: A[1]};

test('it is never drawn past the newest report, so the drawn position is behind what is known, never ahead', () => {
  const second = at(20_000, 53.4511, -2.31);
  const total = metres(A_POINT, second);
  for (const {v} of run(second).frames) {
    assert.ok(metres(A_POINT, v) <= total + 0.5, 'never beyond the newer report');
    assert.ok(metres(A_POINT, v) >= -0.5, 'never behind the older one');
  }
});

test('the bearing stays the reported one: a bearing is never taken from movement', () => {
  const second = {...at(20_000, 53.4511, -2.31), bearing: null};
  for (const {v} of run(second).frames) assert.equal(v.bearing, null, 'no bearing is invented from the travel');
  const reported = run(at(20_000, 53.4511, -2.31, 217)).last;
  assert.equal(reported.bearing, 217, 'the reported bearing is what is drawn');
});

test('a gap too large to have been followed is left as a jump, and said by the numbers', () => {
  const far = at(20_000, 53.46, -2.34);                 // about 2.4 km
  const {last} = run(far);
  assert.ok(metres(A_POINT, far) > GLIDE.maxMetres);
  assert.equal(last.glide, null, 'no glide over a gap beyond the cap');
  assert.equal(last.lat, far.lat, 'it is drawn at the report');
});

test('a wobble smaller than the floor is not animated, and frames stop once the travel is done', () => {
  const wobble = at(20_000, A[0] + 0.000005, A[1]);     // about 0.6 m: GPS noise at a standstill
  const {last} = run(wobble, {until: 200});
  assert.equal(last.glide, null, 'a sub-metre wobble is placed, not travelled');
  const {frames} = run(at(20_000, 53.4511, -2.31));
  const e = observedAt(historyFrom([at(0, A[0], A[1]), at(20_000, 53.4511, -2.31)]), 20_400, 'no shape');
  assert.equal(needsFrames(e, frames.find(f => f.dt === 400).v), true, 'drawing while it travels');
  assert.equal(needsFrames(e, frames[frames.length - 1].v), false, 'and parked once it has arrived');
});

test('a newer report while travelling is taken up from where the bus is, not queued behind the old one', () => {
  const first = [at(0, A[0], A[1])], second = at(20_000, 53.4511, -2.31), third = at(20_400, 53.4520, -2.31);
  let v = draw(null, first, 0);
  v = draw(v, [...first, second], 20_000);
  v = draw(v, [...first, second], 20_300);
  const mid = {lat: v.lat, lon: v.lon};
  v = draw(v, [...first, second, third], 20_400);
  assert.ok(metres(mid, v) < 15, 'it carries on from where it was drawn');
  let last = v;
  for (let dt = 0; dt <= 1200; dt += 100) last = draw(last, [...first, second, third], 20_400 + dt);
  assert.equal(+last.lat.toFixed(6), +third.lat.toFixed(6), 'and arrives at the newest report');
});

// ---------------------------------------------------------------- between its own reports

test('a bus with no road geometry is drawn between two of its own reports, and never past the newest', () => {
  const fixes = [at(0, A[0], A[1]), at(20_000, 53.4511, -2.31), at(40_000, 53.4522, -2.31)];
  const history = historyFrom(fixes);
  const newest = fixes[2];
  let moved = 0, previous = null;
  for (let now = 42_000; now <= 58_000; now += 500) {
    const e = observedBetween(history, now, 'no accepted road geometry');
    // Never beyond the newest report, and never before the one before it.
    assert.ok(e.lat <= newest.lat + 1e-9, 'never past the newest report');
    assert.ok(e.lat >= fixes[1].lat - 1e-9, 'and not back before the previous one');
    if (previous !== null && e.lat > previous + 1e-9) moved++;
    previous = e.lat;
  }
  assert.ok(moved > 10, `it moves continuously, not in one hop (${moved} of 33 frames moved)`);
});

test('what it costs is stated: the drawn position is older than the newest report, never newer', () => {
  const fixes = [at(0, A[0], A[1]), at(20_000, 53.4511, -2.31), at(40_000, 53.4522, -2.31)];
  const history = historyFrom(fixes);
  const now = 45_000;
  const between = observedBetween(history, now, 'r'), newest = observedAt(history, now, 'r');
  assert.ok(between.reportAge > newest.reportAge, 'the shown position is older than the newest report');
  assert.equal(between.reportAge, 20, 'by the service’s own reporting interval');
  assert.equal(between.between, true);
  assert.equal(newest.between, undefined, '"reported positions only" is left exactly as it was');
});

test('a gap too long or too far to draw a line through is waited out at the earlier report', () => {
  const far = historyFrom([at(0, A[0], A[1]), at(20_000, 53.49, -2.31)]);   // about 4.4 km
  const e = observedBetween(far, 25_000, 'r');
  assert.equal(e.lat, A[0], 'it waits at the report it knows, rather than crossing ground it does not');
  const slow = historyFrom([at(0, A[0], A[1]), at(120_000, 53.4511, -2.31)]);  // two minutes apart
  assert.equal(observedBetween(slow, 130_000, 'r').lat, A[0], 'a two-minute gap is not interpolated');
});

test('the bearing is the reports’ own, never taken from the direction of travel', () => {
  const fixes = [{...at(0, A[0], A[1]), bearing: 10}, {...at(20_000, 53.4511, -2.31), bearing: 200},
                 {...at(40_000, 53.4522, -2.31), bearing: null}];
  const e = observedBetween(historyFrom(fixes), 45_000, 'r');
  assert.equal(e.bearing, 200, 'the newer report’s bearing where it has one, not the way it is moving');
});

test('when the feed falls behind its own cadence the bus catches up to the newest report and waits there', () => {
  const fixes = [at(0, A[0], A[1]), at(20_000, 53.4511, -2.31)];
  const history = historyFrom(fixes);
  const late = observedBetween(history, 90_000, 'r');      // no new report for 70 s
  assert.equal(late.lat, 53.4511, 'it stands at what is known');
  assert.equal(late.between, false, 'and says it is not between reports, so the frame loop rests');
  assert.equal(needsFrames(late, stepVisual(null, late, 90_000, null)), false);
});
