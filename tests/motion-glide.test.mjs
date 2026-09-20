// A bus with no accepted road geometry is shown at its reports, and travels from one to the next
// instead of teleporting (GLIDE in lib/motion.ts). It is never drawn past the newest report, its
// bearing is never taken from the direction it is travelling, and a gap too large to have been
// followed is left as the jump it is.
import test from 'node:test';
import assert from 'node:assert/strict';
import {GLIDE, historyFrom, metres, needsFrames, observedAt, stepVisual} from '../lib/motion.ts';

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
