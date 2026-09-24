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
import {GLIDE, historyFrom, metres, needsFrames, observedAt, PACE, stepVisual} from '../lib/motion.ts';

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

test('a report that arrives is travelled towards over the time the bus took, at a bus\'s pace, and never past it', () => {
  const second = at(20_000, 53.4511, -2.31);           // about 122 m on, twenty seconds later
  // The clock runs the 20 s between the reports at real time. The place shown is the path's
  // average over the previous PACE.smoothMs, so with nothing newer known it comes to a stand
  // short of the newest report — by at most that window's travel — and waits there for the next
  // report; the report's own ring on the map marks where the bus really was.
  const {frames, last} = run(second, {until: 50_000, step: 500});
  const steps = frames.slice(1).map((f, i) => metres(frames[i].v, f.v));
  assert.ok(Math.max(...steps) < 8, `no frame jumps the whole way: largest ${Math.max(...steps).toFixed(1)} m`);
  const moving = steps.filter(d => d > 0.05).length;
  assert.ok(moving > steps.length * 0.5, `it is moving for most of the travel (${moving} of ${steps.length})`);
  assert.ok(frames.some(f => f.dt > 2000 && f.dt < 18_000 && metres(f.v, A_POINT) > 20 && metres(f.v, second) > 20),
    'it is drawn between the two reports while it travels');
  const shortfall = (metres(A_POINT, second) / 20) * (PACE.smoothMs / 2000) + 5;
  assert.ok(metres(last, second) <= shortfall, `it ends within the window's travel of the report: ${metres(last, second).toFixed(0)} m short`);
  assert.ok(metres(A_POINT, last) <= metres(A_POINT, second) + 0.5, 'and never past it');
  assert.ok(last.buffer && last.buffer.shown >= second.at, 'and the clock has reached it (it may run one smoothing window past it)');
  // Once the reports say it stood at that report, it is drawn there exactly.
  const third = at(40_000, second.lat, second.lon);
  let v = last;
  for (let now = 40_000; now <= 80_000; now += 500) v = draw(v, [at(0, A[0], A[1]), second, third], now);
  assert.equal(+v.lat.toFixed(6), +second.lat.toFixed(6), 'it ends at the report once its reports stand there');
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
  const {frames} = run(second, {until: 50_000, step: 500});
  const history = historyFrom([at(0, A[0], A[1]), second]);
  const mid = frames.find(f => f.dt === 5000).v, end = frames.at(-1).v;
  assert.equal(needsFrames(observedAt(history, 25_000, 'no shape'), mid), true, 'drawing while it travels');
  assert.equal(needsFrames(observedAt(history, 70_000, 'no shape'), end), false, 'and parked once it has come to its stand');
});

test('a newer report while travelling is taken up from where the bus is, not queued behind the old one', () => {
  const first = [at(0, A[0], A[1])], second = at(20_000, 53.4511, -2.31), third = at(20_400, 53.4520, -2.31);
  let v = draw(null, first, 0);
  v = draw(v, [...first, second], 20_000);
  v = draw(v, [...first, second], 20_300);
  const mid = {lat: v.lat, lon: v.lon};
  v = draw(v, [...first, second, third], 20_400);
  assert.ok(metres(mid, v) < 15, 'it carries on from where it was drawn');
  // Its own clock reaches the third report when it reaches it, 20.4 s on; the third report is
  // 100 m past the second and 0.4 s after it, which no bus does, so the drawn bus — held to a
  // bus's pace (PACE) — closes that stretch behind the clock and arrives a little later, never
  // faster than a bus and never past the report. Not queued, not hurried.
  let last = v, fastest = 0;
  for (let dt = 0; dt <= 40_000; dt += 100) { last = draw(last, [...first, second, third], 20_400 + dt); fastest = Math.max(fastest, last.velocity); }
  assert.ok(metres(A_POINT, last) > metres(A_POINT, second) - 80, 'it went on towards the newest report');
  assert.ok(metres(A_POINT, last) <= metres(A_POINT, third) + 0.5, 'and never past it');
  assert.ok(fastest <= 22.01, `never faster than a bus: ${fastest.toFixed(1)} m/s`);
  // A fourth report standing at the third: the drawn bus arrives there exactly.
  const fourth = at(40_400, third.lat, third.lon);
  for (let now = 40_400; now <= 90_000; now += 100) last = draw(last, [...first, second, third, fourth], now);
  assert.equal(+last.lat.toFixed(6), +third.lat.toFixed(6), 'and is there once its reports stand there');
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
  const frames = watch(fixes, 0, 90_000, 1000);
  const end = frames.at(-1).v;
  const shortfall = (metres(A_POINT, fixes[1]) / 20) * (PACE.smoothMs / 2000) + 5;
  assert.ok(metres(end, fixes[1]) <= shortfall && metres(A_POINT, end) <= metres(A_POINT, fixes[1]) + 0.5,
    `it waits short of what is known, never past it: ${metres(end, fixes[1]).toFixed(0)} m short`);
  assert.equal(needsFrames(observedAt(historyFrom(fixes), 90_000, 'r'), end), false, 'and stops drawing');
});

test('a gap too long to have been followed is not travelled through', () => {
  const fixes = [at(0, A[0], A[1]), at(90_000, 53.4511, -2.31)];   // a minute and a half apart
  // The clock starts a delay behind and resyncs when it is further behind than that plus
  // PLAYBACK.resyncMs, so the far report's moment is crossed within about a minute of it.
  const frames = watch(fixes, 88_000, 165_000, 500);
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

// A report filed late moves the path under the bus. The drawn bus keeps its place on the new
// path and carries on along it — no jump, no dash — and a late report too far off to have been
// travelled to is a refused pair, said as a repositioning when the moment shown crosses it, never
// an ease that covers 877 m in two seconds (which is what the first playback did, 24 September 2026).
test('a late report moves the path under the bus without a jump, and one too far off is a said repositioning', () => {
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
  // A late report at 50 s, 60 m off the line: the path bends, the drawn bus stays where it was and
  // follows the new path from there.
  const late = offset => [line(0), line(1), line(2), at(50_000, 53.45 + 300 * M + offset * M, -2.31), line(3)];
  const before = {lat: v.lat, lon: v.lon};
  v = draw(v, late(60), 75_100);
  assert.ok(metres(v, before) < 8, `no jump when the path moved: ${metres(v, before).toFixed(1)} m`);
  assert.ok(v.lastCorrection === null || v.lastCorrection.kind === 'smooth', 'never a repositioning for a small shift');
  let w = v; for (let now = 75_200; now <= 95_000; now += 100) w = draw(w, late(60), now);
  const steps = []; let prev = v; for (let now = 75_200; now <= 95_000; now += 100) { const n = draw(prev, late(60), now); steps.push(metres(prev, n)); prev = n; }
  assert.ok(Math.max(...steps) < 3, `it moves at a bus's pace along the new path: largest step ${Math.max(...steps).toFixed(2)} m per 100 ms`);
  // A late report 900 m off the line cannot have been travelled to (over GLIDE.maxMetres from the
  // report before it): the pair is refused, the bus waits at the report before it, and is
  // repositioned and said when the moment shown crosses it.
  let x = play();
  for (let now = 75_100; now <= 100_000; now += 100) x = draw(x, late(900), now);
  assert.equal(x.lastCorrection?.kind, 'snap');
  assert.equal(x.lastCorrection?.why, 'too_far');
});
