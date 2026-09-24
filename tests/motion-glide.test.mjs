// A bus with no accepted road geometry is shown at its reports, and travels from one to the next
// instead of teleporting. It is never drawn past the newest report, its bearing is never taken from
// the direction it is travelling, and a gap too large to have been followed is left as the jump it
// is — said as one.
//
// Restated on 23 September 2026 for PLAYBACK (lib/motion.ts). Until then each report was travelled
// to *as it arrived*, over the time the bus had taken, so what these checks timed was the arrival.
// Now the bus is drawn a bounded time behind its reports and its own clock decides when it reaches
// each one, so the checks that named an arrival time name the clock's time instead; what they hold
// to — never ahead of a report, never a bearing from movement, never a jump left unsaid — is the
// same. In these checks the second report arrives at its own timestamp (no lag), so the delay is
// PLAYBACK.minDelayMs and the clock sets off from the first report at the moment the second lands.
import test from 'node:test';
import assert from 'node:assert/strict';
import {GLIDE, historyFrom, metres, needsFrames, observedAt, stepVisual} from '../lib/motion.ts';

const at = (t, lat, lon, bearing = 90) => ({at: t, lat, lon, bearing, service: 's', source: 'h' + t});
const A = [53.45, -2.31];
const draw = (previous, fixes, now) => {const h = historyFrom(fixes);
  return stepVisual(previous, observedAt(h, now, 'no shape'), now, null, undefined, h)};
/** The first report drawn, then a second report arriving at `t`, then frames up to `until`. */
function run(second, {t = 20_000, until = 2000, step = 100} = {}) {
  const first = [at(0, A[0], A[1])];
  let v = draw(null, first, 0);
  const fixes = [...first, second];
  const frames = [];
  for (let dt = 0; dt <= until; dt += step) {v = draw(v, fixes, t + dt); frames.push({dt, v})}
  return {frames, last: frames[frames.length - 1].v, second};
}

test('a report that arrives is travelled to over the time the bus took, and the bus stops exactly there', () => {
  const second = at(20_000, 53.4511, -2.31);           // about 122 m on, twenty seconds later
  // The clock runs the 20 s between the reports at real time while the buffer is full and eases
  // towards PLAYBACK.slowestRate as it runs down, so the report is reached inside 26 s.
  const {frames, last} = run(second, {until: 26_000, step: 500});
  const steps = frames.slice(1).map((f, i) => metres(frames[i].v, f.v));
  assert.ok(Math.max(...steps) < 8, `no frame jumps the whole way: largest ${Math.max(...steps).toFixed(1)} m`);
  const moving = steps.filter(d => d > 0.05).length;
  assert.ok(moving > steps.length * 0.8, `it is moving for most of the interval (${moving} of ${steps.length})`);
  assert.ok(frames.some(f => f.dt > 2000 && f.dt < 18_000 && metres(f.v, A_POINT) > 20 && metres(f.v, second) > 20),
    'it is drawn between the two reports while it travels');
  assert.equal(+last.lat.toFixed(6), +second.lat.toFixed(6), 'it ends at the report');
  assert.ok(last.buffer && last.buffer.shown === second.at, 'and the clock has reached it');
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
  const {frames, last} = run(far, {until: 26_000, step: 500});
  assert.ok(metres(A_POINT, far) > GLIDE.maxMetres);
  // Nothing is drawn across the gap: the bus waits at the first report until the clock passes the
  // far one, and then it is there, with the move said for what it was.
  for (const {v} of frames) assert.ok(metres(v, A_POINT) < 1 || metres(v, far) < 1, 'never drawn between');
  assert.equal(last.lat, far.lat, 'it is drawn at the report');
  assert.equal(last.lastCorrection?.kind, 'snap');
  assert.equal(last.lastCorrection?.why, 'too_far');
});

test('a wobble smaller than the floor is not animated, and frames stop once the travel is done', () => {
  const wobble = at(20_000, A[0] + 0.000005, A[1]);     // about 0.6 m: GPS noise at a standstill
  const {last} = run(wobble, {until: 200});
  assert.equal(last.glide, null, 'a sub-metre wobble is placed, not travelled');
  const second = at(20_000, 53.4511, -2.31);
  const {frames} = run(second, {until: 26_000, step: 500});
  const history = historyFrom([at(0, A[0], A[1]), second]);
  const mid = frames.find(f => f.dt === 5000).v, end = frames.at(-1).v;
  assert.equal(needsFrames(observedAt(history, 25_000, 'no shape'), mid), true, 'drawing while it travels');
  assert.equal(needsFrames(observedAt(history, 46_000, 'no shape'), end), false, 'and parked once it has arrived');
});

test('a newer report while travelling is taken up from where the bus is, not queued behind the old one', () => {
  const first = [at(0, A[0], A[1])], second = at(20_000, 53.4511, -2.31), third = at(20_400, 53.4520, -2.31);
  let v = draw(null, first, 0);
  v = draw(v, [...first, second], 20_000);
  v = draw(v, [...first, second], 20_300);
  const mid = {lat: v.lat, lon: v.lon};
  v = draw(v, [...first, second, third], 20_400);
  assert.ok(metres(mid, v) < 15, 'it carries on from where it was drawn');
  // Its own clock reaches the third report when it reaches it — 20.4 s of travel, up to
  // PLAYBACK.fastestRate faster with a full buffer in hand — and no sooner: not queued, not hurried.
  let last = v;
  for (let dt = 0; dt <= 26_000; dt += 100) last = draw(last, [...first, second, third], 20_400 + dt);
  assert.equal(+last.lat.toFixed(6), +third.lat.toFixed(6), 'and arrives at the newest report');
});

// ---------------------------------------------------------------- between its own reports

/** Frames from `from` to `to`, feeding the whole history so the travel takes the reports' own gap. */
function watch(fixes, from, to, step = 250) {
  let v = null; const frames = [];
  for (let now = from; now <= to; now += step) {
    const known = fixes.filter(f => f.at <= now);
    if (!known.length) continue;
    const history = historyFrom(known);
    v = stepVisual(v, observedAt(history, now, 'no accepted road geometry'), now, null, undefined, history);
    frames.push({now, v});
  }
  return frames;
}

test('the travel between two reports takes the time the bus itself took, not a hop', () => {
  const fixes = [at(0, A[0], A[1]), at(20_000, 53.4511, -2.31), at(40_000, 53.4522, -2.31)];
  const frames = watch(fixes, 0, 44_000);
  const moving = frames.slice(1).filter((f, i) => metres(frames[i].v, f.v) > 0.05).length;
  assert.ok(moving / frames.length > 0.5,
    `it is moving for most of the watch, not 5% of it (${moving} of ${frames.length} frames)`);
  // Never past the newest report known at that moment.
  for (const {now, v} of frames) {
    const newest = fixes.filter(f => f.at <= now).at(-1);
    assert.ok(metres({lat: A[0], lon: A[1]}, v) <= metres({lat: A[0], lon: A[1]}, newest) + 0.5,
      'never drawn past the newest report');
  }
});

test('a report that arrives late leaves the bus waiting at the one it reached, not guessing on', () => {
  const fixes = [at(0, A[0], A[1]), at(20_000, 53.4511, -2.31)];
  const frames = watch(fixes, 0, 70_000, 1000);
  const end = frames.at(-1).v;
  assert.equal(+end.lat.toFixed(6), 53.4511, 'it waits at what is known');
  assert.equal(needsFrames(observedAt(historyFrom(fixes), 70_000, 'r'), end), false, 'and stops drawing');
});

test('a gap too long to have been followed is not travelled through', () => {
  const fixes = [at(0, A[0], A[1]), at(90_000, 53.4511, -2.31)];   // a minute and a half apart
  const frames = watch(fixes, 88_000, 118_000, 500);
  for (const {v} of frames) assert.ok(metres(v, A_POINT) < 1 || metres(v, fixes[1]) < 1, 'never drawn between');
  const end = frames.at(-1).v;
  assert.equal(+end.lat.toFixed(6), 53.4511, 'it is drawn at the report once the clock reaches it');
  assert.equal(end.lastCorrection?.why, 'too_long', 'and the move is said for what it was');
});

test('"reported positions only" is exactly that: no history, no travel', () => {
  const fixes = [at(0, A[0], A[1]), at(20_000, 53.4511, -2.31)];
  let v = stepVisual(null, observedAt(historyFrom([fixes[0]]), 0, 'r'), 0, null);
  v = stepVisual(v, observedAt(historyFrom(fixes), 20_000, 'r'), 20_000, null);   // no history passed
  assert.equal(v.glide, null);
  assert.equal(v.lat, 53.4511, 'it is placed at the newest report, as before');
});

// A report filed late can move the path under the bus. Under the drawing's snap distance that is
// eased at about 10 m/s and said as a correction; beyond it the ground between is not known, so it
// is a repositioning with its reason — never an ease that covers 877 m in two seconds, which is
// what the first playback did on 24 September 2026.
test('a late report that moves the path under the bus is eased at about 10 m/s, and past the snap distance it is a repositioning', () => {
  const at = (t, lat, lon) => ({at: t, lat, lon, bearing: 0, service: 's', source: 'h' + t});
  const M = 1 / 111195;
  const draw = (previous, fixes, now) => {const h = historyFrom(fixes); return stepVisual(previous, observedAt(h, now, 'no shape'), now, null, undefined, h)};
  // Reports every 20 s at 6 m/s (120 m apart); the clock plays them back 20 s behind, so at
  // 75 s the moment shown lies between the 40 s and 60 s reports.
  const line = k => at(k * 20_000, 53.45 + k * 120 * M, -2.31);
  const fixes = [line(0), line(1), line(2), line(3)];
  const play = () => {let v = null; for (let now = 60_000; now <= 75_000; now += 100) v = draw(v, fixes, now); return v};
  let v = play();
  assert.equal(v.lastCorrection, null);
  assert.ok(v.buffer.shown > 40_000 && v.buffer.shown < 60_000, `shown ${v.buffer.shown}`);
  // A late report at 50 s, 60 m off the line: the moment shown moves by about 30 m — eased, and said as smooth.
  const late = offset => [line(0), line(1), line(2), at(50_000, 53.45 + 300 * M + offset * M, -2.31), line(3)];
  const before = {lat: v.lat, lon: v.lon};
  v = draw(v, late(60), 75_100);
  assert.equal(v.lastCorrection?.kind, 'smooth');
  const eased = v.buffer.ease;
  assert.ok(eased && eased.ms >= v.lastCorrection.metres * 100 - 1, `eased over ${eased?.ms} ms for ${v.lastCorrection.metres} m: about 10 m/s`);
  assert.ok(metres(v, before) < 2, 'the ease starts where the bus was drawn, not at the new place');
  // A late report 500 m off the line shifts the moment shown by about 250 m: a repositioning, said as too far, not an ease.
  let w = play();
  w = draw(w, late(500), 75_100);
  assert.equal(w.lastCorrection?.kind, 'snap');
  assert.equal(w.lastCorrection?.why, 'too_far');
  assert.equal(w.buffer.ease, null, 'no ease is running');
  assert.ok(w.lastCorrection.metres > 150, `moved ${w.lastCorrection.metres} m`);
});
