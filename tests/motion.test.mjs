// The estimated-movement core: every rule is a stated behaviour with a test.
import test from 'node:test';
import assert from 'node:assert/strict';
import {addFix,advance,alongAt,DEFAULT_PARAMS,DRAWING,drawingFor,decodePolyline,emptyHistory,estimate,headingAt,historyFrom,
        makeTrack,metres,needsFrames,observedAt,pointAt,project,shortestTurn,slice,stepVisual,tickClock,turnToward,
        uncertaintyAt} from '../lib/motion.ts';

// An L-shaped road: 600 m north from the origin, then 400 m east.
const O = {lat: 53.45, lon: -2.30};
const north = m => O.lat + m / 111195;
const eastLon = (m, lat) => O.lon + m / (111195 * Math.cos(lat * Math.PI / 180));
const corner = north(600);
const L = makeTrack('L', [[O.lon, O.lat], [O.lon, corner], [eastLon(400, corner), corner]]);
const along = s => pointAt(L, s);
const fix = (s, t, extra = {}) => ({...along(s), at: t, bearing: null, service: '15|outbound|J1', ...extra});
const P = {...DEFAULT_PARAMS};

test('geometry: distance, projection, position and heading along a route', () => {
 assert.ok(Math.abs(L.length - 1000) < 1.5, `length ${L.length}`);
 const p = project(L, {lat: north(300), lon: eastLon(10, north(300))});
 assert.ok(Math.abs(p.s - 300) < 1 && Math.abs(p.offset - 10) < 1);
 assert.ok(metres(along(700), {lat: corner, lon: eastLon(100, corner)}) < 1);
 assert.ok(Math.abs(headingAt(L, 300) - 0) < 1, 'north on the first leg');
 assert.ok(Math.abs(headingAt(L, 800) - 90) < 1, 'east on the second');
 const part = slice(L, 500, 700);
 assert.equal(part.length, 3, 'a slice keeps the corner it passes');
});

test('a polyline decodes to the published points', () => {
 // Google's documented example.
 const points = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
 assert.deepEqual(points.map(([lon, lat]) => [+lat.toFixed(3), +lon.toFixed(3)]),
  [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]);
});

test('bearings turn the short way round', () => {
 assert.equal(shortestTurn(350, 10), 20);
 assert.equal(shortestTurn(10, 350), -20);
 assert.equal(shortestTurn(90, 270), 180);
 assert.equal(Math.round(turnToward(350, 10, 0.5)), 0);
});

test('reports: duplicates ignored, late reports filed, a new journey starts afresh', () => {
 let h = emptyHistory(), r;
 r = addFix(h, fix(100, 10_000)); h = r.history; assert.equal(r.event, 'first');
 r = addFix(h, fix(200, 30_000)); h = r.history; assert.equal(r.event, 'added');
 r = addFix(h, fix(200, 30_000)); assert.equal(r.event, 'duplicate'); assert.equal(r.history.fixes.length, 2);
 r = addFix(h, fix(150, 20_000)); h = r.history; assert.equal(r.event, 'out_of_order');
 assert.deepEqual(h.fixes.map(f => f.at), [10_000, 20_000, 30_000]);
 assert.equal(h.fixes.at(-1).at, 30_000, 'a late report never becomes the basis');
 r = addFix(h, fix(0, 40_000, {service: '15|inbound|J2'}));
 assert.equal(r.event, 'service_change'); assert.equal(r.history.fixes.length, 1);
 assert.equal(addFix(r.history, fix(300, 35_000)).event, 'ignored', 'an older report of the old journey is not mixed in');
});

test('estimate: along the route at the speed of its own reports, for a bounded time', () => {
 const h = historyFrom([fix(200, 0), fix(360, 20_000)]);   // 160 m in 20 s = 8 m/s
 const e = estimate(h, L, 30_000, P);
 assert.equal(e.mode, 'estimated');
 assert.ok(Math.abs(e.speed - 8) < 0.2);
 assert.ok(Math.abs(e.s - (360 + 80)) < 3, `10 s later: ${e.s}`);
 assert.equal(e.reportAge, 10);
 const late = estimate(h, L, 20_000 + (P.horizon + 25) * 1000, P);
 assert.ok(late.capped, 'past the horizon the estimate says it is capped');
 assert.ok(Math.abs(late.s - (360 + 8 * P.horizon)) < 3, 'and moves no further than the horizon allows');
 const corner = estimate(historyFrom([fix(500, 0), fix(580, 10_000)]), L, 20_000, P);
 assert.ok(Math.abs(corner.bearing - 90) < 2, 'the estimate turns with the road, not along a straight line');
});

test('estimate: with a decay time the estimate eases off as the report ages, and stays bounded', () => {
 const h = historyFrom([fix(200, 0), fix(360, 20_000)]);   // 8 m/s
 const Q = {...P, decay: 45, horizon: 120, stale: 150};
 const ahead = t => estimate(h, L, 20_000 + t * 1000, Q).s - 360;
 assert.ok(Math.abs(ahead(10) - 8 * 45 * (1 - Math.exp(-10 / 45))) < 1.5, `10 s on: ${ahead(10)}`);
 assert.ok(ahead(10) < 80 && ahead(60) < 8 * 60, 'less far than constant speed would take it');
 assert.ok(ahead(60) > ahead(30), 'but still moving on');
 assert.ok(ahead(120) < 8 * 45, 'and never beyond speed × decay time');
 assert.equal(estimate(h, L, 30_000, {...P, decay: 0}).s, estimate(h, L, 30_000, P).s, '0 keeps constant speed');
});

test('estimate: each fallback is explicit', () => {
 const two = historyFrom([fix(200, 0), fix(360, 20_000)]);
 assert.match(estimate(two, null, 25_000, P).reason, /no evaluated road geometry/);
 assert.match(estimate(historyFrom([fix(360, 20_000)]), L, 25_000, P).reason, /second report/);
 const off = historyFrom([fix(200, 0), {...fix(360, 20_000), lon: eastLon(120, north(360))}]);
 assert.match(estimate(off, L, 25_000, P).reason, /m from the route/);
 assert.match(estimate(two, L, 20_000 + (P.stale + 1) * 1000, P).reason, /too old/);
 assert.match(estimate(historyFrom([fix(400, 0), fix(300, 20_000)]), L, 25_000, P).reason, /backwards/);
 assert.match(estimate(historyFrom([fix(200, 0), fix(400, (P.maxGap + 30) * 1000)]), L, (P.maxGap + 35) * 1000, P).reason, /apart/);
 for (const e of [estimate(two, null, 25_000, P)]) {
  assert.equal(e.mode, 'observed');
  assert.deepEqual([e.lat, e.lon], [two.fixes[1].lat, two.fixes[1].lon], 'observed mode draws the report itself');
 }
});

test('estimate: a standing bus does not drift', () => {
 const h = historyFrom([fix(300, 0), fix(302, 20_000), fix(301, 40_000)]);
 const e = estimate(h, L, 70_000, P);
 assert.equal(e.speed, 0);
 assert.ok(Math.abs(e.s - project(L, h.fixes.at(-1)).s) < 0.01);
});

test('visual: a new report never makes the drawn bus jump, and corrections decay without overshoot', () => {
 const track = L;
 const h1 = historyFrom([fix(200, 0), fix(360, 20_000)]);
 let v = stepVisual(null, estimate(h1, track, 25_000, P), 25_000, track);
 for (let t = 25_050; t <= 30_000; t += 50) v = stepVisual(v, estimate(h1, track, t, P), t, track);
 const before = v.s;
 // The next report says the bus was 25 m further on than we estimated.
 const h2 = addFix(h1, fix(360 + 8 * 10 + 25, 30_000)).history;
 const offsets = [];
 let previousS = before, previousV = v.velocity;
 for (let t = 30_050; t <= 44_000; t += 50) {
  v = stepVisual(v, estimate(h2, track, t, P), t, track);
  assert.ok(Math.abs(v.s - previousS) < 3, `no jump between frames (${(v.s - previousS).toFixed(2)} m)`);
  assert.ok(v.s >= previousS - 1e-9, 'never backwards while catching up');
  assert.ok(Math.abs(v.velocity - previousV) <= DRAWING.approachAccel * 0.05 + 1e-9, 'its speed changes gradually');
  previousS = v.s; previousV = v.velocity; offsets.push(v.offset);
 }
 assert.ok(offsets.every(o => o <= 1e-9), 'the offset never changes sign: no overshoot');
 assert.ok(Math.abs(offsets.at(-1)) < 0.5, 'and it has settled');
 assert.equal(v.lastCorrection.kind, 'smooth');
});

test('visual: moving, a correction backwards slows the drawn bus, standing it if need be, but never reverses it; a large one snaps', () => {
 const h1 = historyFrom([fix(200, 0), fix(300, 20_000)]);       // 5 m/s
 let v = stepVisual(null, estimate(h1, L, 29_000, P), 29_000, L);
 v = stepVisual(v, estimate(h1, L, 30_000, P), 30_000, L);
 const drawn = v.s;
 // The bus was 30 m behind where it is drawn, and slower (4 m/s): the drawn bus slows to a stand
 // rather than reversing, and waits for the estimate.
 const h2 = addFix(h1, fix(drawn - 30, 30_000 - 1)).history;
 let previousS = drawn, held = false;
 for (let t = 30_050; t <= 52_000; t += 50) {
  v = stepVisual(v, estimate(h2, L, t, P), t, L);
  held ||= v.correction === 'hold';
  assert.ok(v.s >= previousS - 1e-9, `never backwards (${(v.s - previousS).toFixed(3)} m)`);
  previousS = v.s;
 }
 assert.ok(held, 'it stood while the estimate caught up');
 assert.ok(Math.abs(v.offset) < 0.5, `and then they met (${v.offset.toFixed(2)} m)`);
 // A report 400 m away snaps.
 const h3 = addFix(h2, fix(900, 53_000)).history;
 v = stepVisual(v, estimate(h3, L, 53_100, P), 53_100, L);
 assert.equal(v.lastCorrection.kind, 'snap');
 assert.ok(v.lastCorrection.metres > DRAWING.largeCorrection);
});

test('a jump in the reports is not read as speed: the report is shown until a second one follows', () => {
 const h = historyFrom([fix(200, 0), fix(280, 10_000), fix(360, 20_000), fix(900, 30_000)]);
 const e = estimate(h, L, 32_000, P);
 assert.equal(e.mode, 'observed');
 assert.match(e.reason, /jumped further than a bus travels/);
 const after = addFix(h, fix(980, 40_000)).history;
 const resumed = estimate(after, L, 42_000, P);
 assert.equal(resumed.mode, 'estimated', 'readable again after the next report');
 assert.ok(Math.abs(resumed.speed - 8) < 0.5, `its speed is read from after the jump only, not across it (${resumed.speed})`);
 const soon = addFix(h, fix(905, 33_000)).history;
 assert.equal(estimate(soon, L, 34_000, P).mode, 'observed', 'a report too soon after the jump gives no speed either');
});

test('visual: when estimating resumes, the bus eases on from where it was drawn, no faster than it can catch up', () => {
 const one = historyFrom([fix(300, 20_000)]);
 let v = null;
 for (let t = 26_000; t <= 35_950; t += 50) v = stepVisual(v, estimate(one, L, t, P), t, L);
 assert.equal(v.mode, 'observed');
 const two = addFix(one, fix(380, 30_000)).history;               // 8 m/s: now it can be estimated
 v = stepVisual(v, estimate(two, L, 36_000, P), 36_000, L);    // one frame later
 assert.equal(v.mode, 'estimated');
 assert.ok(Math.abs(v.s - project(L, one.fixes[0]).s) < 10, 'the first estimated frame starts where the bus was drawn');
 let previousS = v.s, previousV = v.velocity;
 for (let t = 36_050; t <= 75_000; t += 50) {
  v = stepVisual(v, estimate(two, L, t, P), t, L);
  assert.ok(v.s - previousS <= (8 + DRAWING.catchUp) * 0.05 + 1e-6, `no faster than its speed plus the catch-up rate (${(v.s - previousS).toFixed(2)} m)`);
  assert.ok(Math.abs(v.velocity - previousV) <= DRAWING.approachAccel * 0.05 + 1e-9, 'pulling away gradually');
  previousS = v.s; previousV = v.velocity;
 }
 assert.ok(Math.abs(v.s - estimate(two, L, 75_000, P).s) < 1, 'and it has caught up');
});

test('visual: a large correction is caught up gradually, not in a lurch', () => {
 const h1 = historyFrom([fix(200, 0), fix(360, 20_000)]);
 let v = null;
 for (let t = 25_000; t <= 30_000; t += 50) v = stepVisual(v, estimate(h1, L, t, P), t, L);
 // The next report puts the bus about 120 m further on than it was drawn: glide, do not snap.
 const h2 = addFix(h1, fix(360 + 80 + 120, 30_000)).history;
 let previousS = v.s;
 for (let t = 30_050; t <= 56_000; t += 50) {
  const e = estimate(h2, L, t, P);
  v = stepVisual(v, e, t, L);
  assert.ok(v.s - previousS <= (e.speed + DRAWING.catchUp) * 0.05 + 1e-6, `at most speed plus catch-up (${(v.s - previousS).toFixed(2)} m)`);
  assert.ok(v.s >= previousS - 1e-9, 'and never backwards');
  previousS = v.s;
 }
 assert.equal(v.lastCorrection.kind, 'smooth');
 assert.ok(v.lastCorrection.metres > 100 && v.lastCorrection.metres < DRAWING.largeCorrection);
 assert.ok(Math.abs(v.offset) < 0.5, 'and it has caught up');
});

test('visual: a bus shown at its report only while loading is then simply drawn at its estimate', () => {
 const h = historyFrom([fix(200, 0), fix(360, 20_000)]);
 let v = stepVisual(null, observedAt(h, 25_000, 'loading its road geometry', true), 25_000, null);
 assert.equal(v.provisional, true);
 const e = estimate(h, L, 25_100, P);
 v = stepVisual(v, e, 25_100, L);
 assert.equal(v.mode, 'estimated');
 assert.ok(Math.abs(v.s - e.s) < 0.01, 'no glide from the report: the estimate is simply drawn');
 assert.equal(v.lastCorrection, null, 'and it is not reported as a correction');
});

test('visual: withdrawing an estimate is a correction that is said; moving to a new report is not', () => {
 const h = historyFrom([fix(200, 0), fix(360, 20_000)]);
 let v = stepVisual(null, estimate(h, L, 30_000, P), 30_000, L);       // drawn 80 m past its report
 v = stepVisual(v, observedAt(h, 30_050, 'you chose reported positions only'), 30_050, null);
 assert.equal(v.lastCorrection.kind, 'snap');
 assert.ok(Math.abs(v.lastCorrection.metres - 80) < 3, `it went back ${v.lastCorrection.metres} m to the report`);
 const h2 = addFix(h, fix(440, 30_000)).history;
 // Travelled to, with the reports to travel by: not a correction.
 const w = stepVisual(v, observedAt(h2, 31_000, 'you chose reported positions only'), 31_000, null, DRAWING, h2);
 assert.equal(w.lastCorrection, v.lastCorrection, 'a bus shown at its reports moving to the next is not a correction');
 assert.ok(w.buffer, 'it is played back towards the new report');
 // Without the reports it cannot travel, so it is repositioned — and that is said, not silent.
 // Until 22 September 2026 this case returned the bus at the new report with no correction at
 // all, and this check passed because it asked the question without the history.
 const jumped = stepVisual(v, observedAt(h2, 31_000, 'you chose reported positions only'), 31_000, null);
 assert.equal(jumped.lastCorrection.kind, 'snap');
 assert.equal(jumped.lastCorrection.why, 'no_earlier_report');
 assert.equal(jumped.glide, null, 'and it does not pretend to have travelled');
});

test('the presentation clock is never stepped: a new server offset is approached gradually', () => {
 let c = tickClock(null, 1_000_000, -400);
 assert.equal(c.now, 999_600);
 const seen = [c.now];
 for (let wall = 1_000_033; wall <= 1_012_000; wall += 33) { c = tickClock(c, wall, 600); seen.push(c.now); }
 const steps = seen.slice(1).map((n, i) => n - seen[i]);
 assert.ok(steps.every(d => d >= 33 * 0.9 - 1e-9 && d <= 33 * 1.1 + 1e-9), 'within a tenth of real time, never a step');
 assert.ok(Math.abs(c.offset - 600) < 1e-9, 'and it reaches the new offset');
 assert.equal(tickClock(c, 1_012_033, 60_000).offset, 60_000, 'a change of clock over five seconds is taken at once');
 assert.ok(tickClock(c, 1_012_066, -900).now >= c.now, 'and it never runs backwards');
});

test('visual: turning follows the shortest way round and settles', () => {
 const h = historyFrom([fix(560, 0), fix(640, 10_000)]);    // just past the corner, heading east
 let v = stepVisual(null, estimate(h, L, 10_000, P), 10_000, L);
 v = {...v, bearing: 350};                                   // drawn as if facing slightly west of north
 const seen = [];
 for (let t = 10_050; t <= 12_000; t += 50) { v = stepVisual(v, estimate(h, L, t, P), t, L); seen.push(v.bearing); }
 assert.ok(seen.every(b => b <= 95 || b >= 345), 'it never swings the long way through the south');
 assert.ok(Math.abs(seen.at(-1) - 90) < 3);
});

test('frames are requested only while something is actually moving', () => {
 const moving = historyFrom([fix(200, 0), fix(360, 20_000)]);
 const standing = historyFrom([fix(300, 0), fix(300, 20_000)]);
 const e1 = estimate(moving, L, 25_000, P), e2 = estimate(standing, L, 25_000, P);
 assert.equal(needsFrames(e1, stepVisual(null, e1, 25_000, L)), true);
 assert.equal(needsFrames(e2, stepVisual(null, e2, 25_000, L)), false);
 assert.equal(needsFrames(estimate(moving, null, 25_000, P), null), false);
 // Standing just before the corner: the drawn bus turns to face the road ahead, then the clock
 // stops (it used to compare the drawn heading with the estimate's, which differ at a bend, and
 // kept drawing a standing bus sixty times a second).
 const corner = historyFrom([fix(598, 0), fix(598, 20_000)]);
 let v = stepVisual(null, estimate(corner, L, 25_000, P), 25_000, L);
 for (let t = 25_050; t <= 29_000; t += 50) v = stepVisual(v, estimate(corner, L, t, P), t, L);
 assert.equal(needsFrames(estimate(corner, L, 29_000, P), v), false, 'a bus standing at a bend costs nothing');
});

test('uncertainty comes from measured errors, or is not drawn', () => {
 const profile = {version: 'x', basis: 'held-out', bins: [{upTo: 10, n: 120, p50: 9, p80: 18}, {upTo: 30, n: 12, p50: 30, p80: 60}]};
 assert.deepEqual(uncertaintyAt(profile, 6), {metres: 18, n: 120, upTo: 10});
 assert.equal(uncertaintyAt(profile, 20), null, 'too few measured cases to say');
 assert.equal(uncertaintyAt(null, 5), null);
});

test('stops: with a dwell time the estimate pauses at each timetabled stop it reaches', () => {
 const S = makeTrack('S', L.points, [300, 500, 900]);
 const Q = {...P, dwell: 10, stopTolerance: 20};
 assert.equal(advance(S, 100, 8, 10, Q), 180, 'before the first stop it is plain distance');
 assert.equal(advance(S, 100, 8, 25, Q), 300, '25 s: reaches the stop at 300 (25 s) and is paused there');
 assert.equal(advance(S, 100, 8, 35, Q), 300, 'still paused within the 10 s dwell');
 assert.ok(Math.abs(advance(S, 100, 8, 45, Q) - 380) < 1e-9, 'then on: 10 s more at 8 m/s');
 assert.ok(Math.abs(advance(S, 290, 8, 10, Q) - 370) < 1e-9, 'a report within stopTolerance of a stop is at it: no second pause');
 assert.equal(advance(S, 100, 8, 25, {...Q, dwell: 0}), 300, 'dwell 0 ignores stops');
 const h = historyFrom([fix(100, 0), fix(260, 20_000)]);   // 8 m/s, latest report 40 m before the stop at 300
 const paused = estimate(h, S, 32_000, {...Q, horizon: 120});   // 12 s on: 5 s to the stop, then paused there
 assert.ok(Math.abs(paused.s - 300) < 1e-6 && paused.reason === 'moving along its route', `paused at the stop (${paused.s})`);
 const onward = estimate(h, S, 45_000, {...Q, horizon: 120});   // 25 s on: 5 s there, 10 s paused, 10 s more
 assert.ok(Math.abs(onward.s - 380) < 1e-6, `moved on after the dwell (${onward.s})`);
});

test('speed: cruise reads the moving stretches only, and standing reports are seen as standing', () => {
 // Moved 160 m in 20 s, then stood for 30 s (two reports at the same place). With no hold a
 // standing bus is not projected at all (below); the speed readings are seen through a long hold,
 // which keeps the estimate at its report while still reading the speed it would move on at.
 const h = historyFrom([fix(200, 0), fix(360, 20_000), fix(362, 35_000), fix(361, 50_000)]);
 const windowed = estimate(h, L, 60_000, {...P, speedWindow: 75, standingHold: 120});
 const cruising = estimate(h, L, 60_000, {...P, speedWindow: 75, cruise: true, standingHold: 120});
 assert.ok(windowed.speed > 2 && windowed.speed < 4, `the window average is dragged down by standing (${windowed.speed})`);
 assert.ok(Math.abs(cruising.speed - 8) < 0.3, `cruise is the speed while moving (${cruising.speed})`);
 for (const e of [estimate(h, L, 60_000, {...P, speedWindow: 75}), estimate(h, L, 60_000, {...P, speedWindow: 75, cruise: true})])
  assert.ok(e.mode === 'observed' && e.held === true && /standing/.test(e.reason), 'with no hold, a standing bus stands at its report');
});

test('standing hold: a bus its reports show standing is held, then moves on at cruise speed', () => {
 const h = historyFrom([fix(200, 0), fix(360, 20_000), fix(362, 35_000), fix(361, 50_000)]);
 const Q = {...P, speedWindow: 75, cruise: true, standingHold: 20, horizon: 120};
 const held = estimate(h, L, 60_000, Q);
 assert.equal(held.held, true);
 assert.match(held.reason, /standing/);
 assert.ok(Math.abs(held.s - project(L, h.fixes.at(-1)).s) < 0.01, 'held at its last report');
 assert.equal(held.resumeAt, 70_000, 'and it says when it would move on');
 assert.equal(needsFrames(held, stepVisual(null, held, 60_000, L)), false, 'nothing to draw while held');
 const soon = estimate(h, L, 68_000, Q);
 assert.equal(soon.held, true);
 assert.equal(needsFrames(soon, stepVisual(null, soon, 68_000, L)), true, 'a few seconds before it moves on, it is eased away');
 const moving = estimate(h, L, 80_000, Q);
 assert.equal(moving.held, false);
 assert.ok(Math.abs(moving.s - (project(L, h.fixes.at(-1)).s + 8 * 10)) < 1, `10 s on at 8 m/s (${moving.s})`);
 // Without a hold it is not projected at all: it stands at its report until a moving report comes
 // (authorised 21 September 2026; every hold length had traded the backward snap for a forward one).
 const off = estimate(h, L, 80_000, {...Q, standingHold: 0});
 assert.equal(off.mode, 'observed'); assert.equal(off.held, true);
});

test('the estimate’s path: read at any moment it covers, it is the estimate itself', () => {
 const S = makeTrack('S', L.points, [300, 500, 900]);
 const cases = [
  [historyFrom([fix(100, 0), fix(260, 20_000)]), {...P, dwell: 10, horizon: 120, stale: 150}],
  [historyFrom([fix(100, 0), fix(260, 20_000)]), {...P, dwell: 10, decay: 45, horizon: 120, stale: 150}],
  [historyFrom([fix(200, 0), fix(360, 20_000), fix(362, 35_000), fix(361, 50_000)]),
   {...P, speedWindow: 75, cruise: true, standingHold: 20, horizon: 120, stale: 150}],
 ];
 for (const [h, Q] of cases) {
  const basis = h.fixes.at(-1).at, first = estimate(h, S, basis + 1000, Q);
  let compared = 0;
  for (let t = basis; t <= basis + Q.stale * 1000; t += 500) {
   const e = estimate(h, S, t, Q);
   if (e.mode !== 'estimated') continue;
   assert.ok(Math.abs(alongAt(S, first, t) - e.s) < 1e-6, `at ${t} ms: ${alongAt(S, first, t)} against ${e.s}`);
   compared++;
  }
  assert.ok(compared > 200, `compared over the whole horizon (${compared})`);
 }
 const moving = estimate(historyFrom([fix(200, 0), fix(360, 20_000)]), L, 25_000, P);
 assert.ok(Math.abs(alongAt(L, moving, 18_000) - (360 - 16)) < 1e-6, 'before its report it is carried back at its starting speed');
});

test('visual: the drawn bus eases into a pause at a stop and away again, and its speed never jumps', () => {
 const S = makeTrack('S', L.points, [300, 500, 900]);
 const Q = {...P, dwell: 10, stopTolerance: 20, horizon: 120, stale: 150};
 // 8 m/s, last report 40 m before the stop at 300: the estimate reaches it at 25 s, stands there
 // until 35 s, then moves on.
 const h = historyFrom([fix(100, 0), fix(260, 20_000)]);
 let v = stepVisual(null, estimate(h, S, 20_000, Q), 20_000, S);
 let previousV = v.velocity, previousS = v.s, furthest = -Infinity;
 const at = {};
 for (let t = 20_016; t <= 45_008; t += 16) {
  v = stepVisual(v, estimate(h, S, t, Q), t, S);
  assert.ok(Math.abs(v.velocity - previousV) <= DRAWING.approachAccel * 0.016 + 1e-9,
   `its speed changes gradually (${previousV.toFixed(2)} to ${v.velocity.toFixed(2)} m/s at ${t} ms)`);
  assert.ok(v.s >= previousS - 1e-9, 'never backwards');
  if (t >= 25_000 && t <= 32_000) furthest = Math.max(furthest, v.s);
  if ([21_008, 24_000, 30_000, 34_000, 45_008].includes(t)) at[t] = {s: v.s, speed: v.velocity};
  previousV = v.velocity; previousS = v.s;
 }
 assert.ok(Math.abs(at[21_008].speed - 8) < 0.1, `at its speed before the stop (${at[21_008].speed.toFixed(2)} m/s)`);
 assert.ok(at[24_000].speed < 7, `slowing before the estimate reaches the stop (${at[24_000].speed.toFixed(2)} m/s)`);
 assert.ok(Math.abs(at[30_000].s - 300) < 0.5 && at[30_000].speed < 0.2,
  `standing at the stop mid-pause (${at[30_000].s.toFixed(2)} m, ${at[30_000].speed.toFixed(2)} m/s)`);
 assert.ok(furthest <= 300.5, `not past the stop until the estimate is about to leave it (${furthest.toFixed(2)} m)`);
 assert.ok(at[34_000].speed > 0.5, `pulling away just before the estimate does (${at[34_000].speed.toFixed(2)} m/s)`);
 assert.ok(Math.abs(at[45_008].speed - 8) < 0.2, `back to its speed (${at[45_008].speed.toFixed(2)} m/s)`);
});

test('visual: after a pause in drawing, the next frame starts from where the bus stood; it does not leap', () => {
 const standing = historyFrom([fix(300, 0), fix(301, 20_000)]);
 let v = stepVisual(null, estimate(standing, L, 25_000, P), 25_000, L);
 for (let t = 25_050; t <= 27_000; t += 50) v = stepVisual(v, estimate(standing, L, t, P), t, L);
 assert.equal(needsFrames(estimate(standing, L, 27_000, P), v), false, 'nothing moves, so the page stops drawing');
 // 20 s later a report shows the bus 100 m on, and the page draws again.
 const moved = addFix(standing, fix(400, 45_000)).history;
 const before = v.s;
 v = stepVisual(v, estimate(moved, L, 47_000, P), 47_000, L);
 assert.ok(Math.abs(v.s - before) < 1, `no leap on the first frame back (${(v.s - before).toFixed(1)} m)`);
 assert.equal(v.lastCorrection.kind, 'smooth', 'the change is a correction, and said');
 let previousS = v.s;
 for (let t = 47_050; t <= 60_000; t += 50) {
  v = stepVisual(v, estimate(moved, L, t, P), t, L);
  assert.ok(v.s - previousS < 1.5 && v.s >= previousS - 1e-9, `then it glides (${(v.s - previousS).toFixed(2)} m)`);
  previousS = v.s;
 }
});

test('visual: within the estimate’s measured error a report ahead of the drawn bus is waited for, not reversed', () => {
 const profile = {version: 'x', basis: 'held-out', bins: [{upTo: 10, n: 120, p50: 30, p80: 49}, {upTo: 30, n: 120, p50: 50, p80: 110}]};
 const h = historyFrom([fix(200, 0), fix(360, 20_000)]);
 assert.equal(drawingFor(estimate(h, L, 25_000, P), profile).holdBack, 49);
 assert.equal(drawingFor(estimate(h, L, 45_000, P), profile).holdBack, 110);
 assert.equal(drawingFor(estimate(h, L, 25_000, P), null).holdBack, DRAWING.holdBack, 'no measured error: the fixed hold');
 // Drawn 45 m ahead of where a moving bus turns out to be, twelve seconds after its last report:
 // the bus moved 11 m on from it (a report under 8 m on would read as standing, and a standing
 // bus is not projected at all).
 const h1 = historyFrom([fix(200, 0), fix(300, 20_000)]);   // 5 m/s
 const furthestBack = draw => {
  let v = stepVisual(null, estimate(h1, L, 31_000, P), 31_000, L);
  v = stepVisual(v, estimate(h1, L, 32_000, P), 32_000, L);
  const h2 = addFix(h1, fix(v.s - 45, 32_000 - 1)).history;
  assert.equal(estimate(h2, L, 32_050, P).mode, 'estimated', 'the report reads as a moving bus');
  let back = 0, previous = v.s;
  for (let t = 32_050; t <= 52_000; t += 50) {
   const e = estimate(h2, L, t, P);
   v = stepVisual(v, e, t, L, draw(e));
   back = Math.max(back, previous - v.s); previous = v.s;
  }
  return back;
 };
 assert.ok(furthestBack(e => drawingFor(e, profile)) < 1e-9, 'within the measured error it slows and waits');
 assert.ok(furthestBack(() => DRAWING) > 0.1, 'with the fixed 35 m hold alone it would have reversed');
});

test('visual: waiting for a moving estimate the drawn bus crawls rather than standing, and stops when the estimate stops', () => {
 // A bus standing still while its estimate moves looks like a stop that never happened; one still
 // moving once its estimate has stopped (too old, or past the horizon) would be travel nobody saw.
 const h1 = historyFrom([fix(200, 0), fix(300, 20_000)]);   // 5 m/s
 const run = draw => {
  let v = stepVisual(null, estimate(h1, L, 29_000, P), 29_000, L);
  v = stepVisual(v, estimate(h1, L, 30_000, P), 30_000, L);
  const h2 = addFix(h1, fix(v.s - 30, 30_000 - 1)).history;   // drawn 30 m ahead of where it is
  let slowest = Infinity, held = 0, at70 = null;
  for (let t = 30_050; t <= 75_000; t += 50) {
   v = stepVisual(v, estimate(h2, L, t, P), t, L, draw);
   if (v.correction === 'hold' && v.goalSpeed > 0.5) { held++; slowest = Math.min(slowest, v.velocity / v.goalSpeed); }
   if (t === 70_000) at70 = v.s;
  }
  return {held, slowest, after70: Math.abs(v.s - at70), velocity: v.velocity};
 };
 const crawl = run(DRAWING), stand = run({...DRAWING, crawl: 0});
 assert.ok(crawl.held > 20 && stand.held > 20, 'both wait for the estimate rather than reversing');
 assert.ok(crawl.slowest >= DRAWING.crawl - 0.02, `never below the crawl while the estimate moves (${crawl.slowest.toFixed(2)} of its speed)`);
 assert.ok(stand.slowest < 0.05, 'without the crawl it stands');
 assert.ok(crawl.after70 < 0.05 && Math.abs(crawl.velocity) < 0.02,
  `past the horizon the drawn bus has stopped too (${crawl.after70.toFixed(3)} m in the last 5 s)`);
});

test('visual: a new report that changes the speed changes the drawn speed gradually, never at once', () => {
 const W = {...P, speedWindow: 15};
 const h1 = historyFrom([fix(200, 0), fix(280, 10_000)]);            // 8 m/s
 let v = stepVisual(null, estimate(h1, L, 12_000, W), 12_000, L);
 for (let t = 12_016; t <= 20_000; t += 16) v = stepVisual(v, estimate(h1, L, t, W), t, L);
 // The next report: 30 m short of the drawn bus, and 5 m/s since the one before.
 const h2 = addFix(h1, fix(330, 20_000)).history;
 assert.ok(Math.abs(estimate(h2, L, 20_016, W).speed - 5) < 0.1);
 let previousV = v.velocity, previousS = v.s;
 for (let t = 20_016; t <= 42_000; t += 16) {
  v = stepVisual(v, estimate(h2, L, t, W), t, L);
  assert.ok(Math.abs(v.velocity - previousV) <= DRAWING.approachAccel * 0.016 + 1e-9,
   `no step in speed (${previousV.toFixed(2)} to ${v.velocity.toFixed(2)} m/s at ${t} ms)`);
  assert.ok(v.s >= previousS - 1e-9, 'never backwards');
  previousV = v.velocity; previousS = v.s;
 }
 assert.ok(Math.abs(v.velocity - 5) < 0.1 && Math.abs(v.offset) < 0.5,
  `it settles on the new speed (${v.velocity.toFixed(2)} m/s, ${v.offset.toFixed(2)} m)`);
});

// The standing fallback, authorised on 21 September 2026: a bus whose last two reports stand
// still while its speed window still reads movement is not projected forward.
test('estimate: a bus whose last two reports stand still is not projected forward, and resumes when it moves', () => {
 // 8 m/s for a minute, then a report 2 m on from the last: standing, with a moving window speed.
 const h = historyFrom([fix(0, 0), fix(160, 20_000), fix(320, 40_000), fix(480, 60_000), fix(482, 80_000)]);
 const standing = estimate(h, L, 95_000, P);
 assert.equal(standing.mode, 'observed');
 assert.match(standing.reason, /standing/);
 assert.equal(standing.held, true);
 assert.ok(metres(standing, along(482)) < 0.01, 'at its report, not past it');
 // Another standing report keeps it there (by then the window itself reads standing: speed 0 at
 // the report, which is also not a projection); the first moving report resumes estimation.
 const h2 = addFix(h, fix(483, 100_000)).history;
 const again = estimate(h2, L, 110_000, P);
 assert.ok(again.mode === 'observed' || again.speed === 0, `not projected (${again.mode}, ${again.speed})`);
 assert.ok(metres(again, along(483)) < 0.5, 'at its report');
 const h3 = addFix(h2, fix(600, 120_000)).history;
 const moving = estimate(h3, L, 130_000, P);
 assert.equal(moving.mode, 'estimated');
 assert.ok(moving.s > 600, `moving on from the report that moved (${moving.s.toFixed(0)} m)`);
 // Where a hold is configured the hold's own rule applies instead.
 assert.equal(estimate(h, L, 95_000, {...P, standingHold: 15}).mode, 'estimated');
 // A bus standing from its first reports has no moving window speed: estimated, speed 0, as before.
 const still = estimate(historyFrom([fix(300, 0), fix(302, 20_000), fix(301, 40_000)]), L, 70_000, P);
 assert.equal(still.mode, 'estimated'); assert.equal(still.speed, 0);
});

test('visual: an estimate that had rolled past a standing bus eases back to its report, no frame jumping', () => {
 const h = historyFrom([fix(0, 0), fix(160, 20_000), fix(320, 40_000), fix(480, 60_000)]);
 let v = stepVisual(null, estimate(h, L, 66_000, P), 66_000, L);
 for (let t = 66_050; t <= 80_000; t += 50) v = stepVisual(v, estimate(h, L, t, P), t, L);
 assert.ok(v.s > 480 + 60, `rolled on past the report (${v.s.toFixed(0)} m)`);
 const from = {lat: v.lat, lon: v.lon};
 const h2 = addFix(h, fix(482, 80_000)).history;
 const e = estimate(h2, L, 80_050, P);
 assert.equal(e.mode, 'observed');
 v = stepVisual(v, e, 80_050, null, DRAWING, h2);
 assert.equal(v.lastCorrection?.kind, 'smooth');
 assert.ok(metres(v, from) < 5, 'the first frame stays where the bus was drawn');
 assert.ok(needsFrames(e, v), 'frames are needed while it eases back');
 let last = v;
 // The ease-back is timed from a speed, not a budget: 100 ms a metre, so about 10 m/s. At the
 // old 25 ms a metre this 110 m correction was taken back at a peak of 3.74 m per 50 ms frame
 // — 75 m/s, 269 km/h — and the check allowed 8 m a frame, so it passed. It is now under 1 m a
 // frame, and the window runs to 93 s because the correction honestly takes about eleven
 // seconds.
 for (let t = 80_100; t <= 93_000; t += 50) {
  v = stepVisual(v, estimate(h2, L, t, P), t, null, DRAWING, h2);
  assert.ok(metres(v, last) < 1, `no frame jumps (${metres(v, last).toFixed(2)} m)`);
  last = v;
 }
 assert.ok(metres(v, along(482)) < 2, 'settled at the standing report');
});
