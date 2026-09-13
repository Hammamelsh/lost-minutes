// The estimated-movement core: every rule is a stated behaviour with a test.
import test from 'node:test';
import assert from 'node:assert/strict';
import {addFix,DEFAULT_PARAMS,decodePolyline,emptyHistory,estimate,headingAt,historyFrom,makeTrack,metres,
        needsFrames,observedAt,pointAt,project,shortestTurn,slice,stepVisual,tickClock,turnToward,
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
 let v = stepVisual(null, estimate(h1, track, 25_000, P), 25_000, track, P);
 for (let t = 25_050; t <= 30_000; t += 50) v = stepVisual(v, estimate(h1, track, t, P), t, track, P);
 const before = v.s;
 // The next report says the bus was 25 m further on than we estimated.
 const h2 = addFix(h1, fix(360 + 8 * 10 + 25, 30_000)).history;
 const offsets = [];
 let previousS = before;
 for (let t = 30_050; t <= 36_000; t += 50) {
  v = stepVisual(v, estimate(h2, track, t, P), t, track, P);
  assert.ok(Math.abs(v.s - previousS) < 3, `no jump between frames (${(v.s - previousS).toFixed(2)} m)`);
  assert.ok(v.s >= previousS - 1e-9, 'never backwards while catching up');
  previousS = v.s; offsets.push(v.offset);
 }
 assert.ok(offsets.every(o => o <= 0), 'the offset never changes sign: no overshoot');
 assert.ok(Math.abs(offsets.at(-1)) < 0.5, 'and it has settled');
 assert.equal(v.lastCorrection.kind, 'smooth');
});

test('visual: a small correction backwards is held while moving; a large one snaps and says so', () => {
 const h1 = historyFrom([fix(200, 0), fix(360, 20_000)]);
 let v = stepVisual(null, estimate(h1, L, 29_000, P), 29_000, L, P);
 v = stepVisual(v, estimate(h1, L, 30_000, P), 30_000, L, P);
 const drawn = v.s;
 // The bus was 8 m behind the estimate: the drawn bus holds rather than reverses.
 const h2 = addFix(h1, fix(drawn - 8 - 8 * 0, 30_000 - 1)).history;
 v = stepVisual(v, estimate(h2, L, 30_100, P), 30_100, L, P);
 assert.equal(v.correction, 'hold');
 assert.ok(v.s >= drawn - 1e-6);
 // A report 400 m away snaps.
 const h3 = addFix(h2, fix(900, 31_000)).history;
 v = stepVisual(v, estimate(h3, L, 31_100, P), 31_100, L, P);
 assert.equal(v.lastCorrection.kind, 'snap');
 assert.ok(v.lastCorrection.metres > P.largeCorrection);
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
 for (let t = 26_000; t <= 35_950; t += 50) v = stepVisual(v, estimate(one, L, t, P), t, L, P);
 assert.equal(v.mode, 'observed');
 const two = addFix(one, fix(380, 30_000)).history;               // 8 m/s: now it can be estimated
 v = stepVisual(v, estimate(two, L, 36_000, P), 36_000, L, P);    // one frame later
 assert.equal(v.mode, 'estimated');
 assert.ok(Math.abs(v.s - project(L, one.fixes[0]).s) < 10, 'the first estimated frame starts where the bus was drawn');
 let previousS = v.s;
 for (let t = 36_050; t <= 50_000; t += 50) {
  v = stepVisual(v, estimate(two, L, t, P), t, L, P);
  assert.ok(v.s - previousS <= (8 + P.catchUp) * 0.05 + 1e-6, `no faster than its speed plus the catch-up rate (${(v.s - previousS).toFixed(2)} m)`);
  previousS = v.s;
 }
 assert.ok(Math.abs(v.s - estimate(two, L, 50_000, P).s) < 1, 'and it has caught up');
});

test('visual: a large correction is caught up gradually, not in a lurch', () => {
 const h1 = historyFrom([fix(200, 0), fix(360, 20_000)]);
 let v = null;
 for (let t = 25_000; t <= 30_000; t += 50) v = stepVisual(v, estimate(h1, L, t, P), t, L, P);
 // The next report puts the bus about 120 m further on than it was drawn: glide, do not snap.
 const h2 = addFix(h1, fix(360 + 80 + 120, 30_000)).history;
 let previousS = v.s;
 for (let t = 30_050; t <= 42_000; t += 50) {
  const e = estimate(h2, L, t, P);
  v = stepVisual(v, e, t, L, P);
  assert.ok(v.s - previousS <= (e.speed + P.catchUp) * 0.05 + 1e-6, `at most speed plus catch-up (${(v.s - previousS).toFixed(2)} m)`);
  assert.ok(v.s >= previousS - 1e-9, 'and never backwards');
  previousS = v.s;
 }
 assert.equal(v.lastCorrection.kind, 'smooth');
 assert.ok(v.lastCorrection.metres > 100 && v.lastCorrection.metres < P.largeCorrection);
 assert.ok(Math.abs(v.offset) < 0.5, 'and it has caught up');
});

test('visual: a bus shown at its report only while loading is then simply drawn at its estimate', () => {
 const h = historyFrom([fix(200, 0), fix(360, 20_000)]);
 let v = stepVisual(null, observedAt(h, 25_000, 'loading its road geometry', true), 25_000, null, P);
 assert.equal(v.provisional, true);
 const e = estimate(h, L, 25_100, P);
 v = stepVisual(v, e, 25_100, L, P);
 assert.equal(v.mode, 'estimated');
 assert.ok(Math.abs(v.s - e.s) < 0.01, 'no glide from the report: the estimate is simply drawn');
 assert.equal(v.lastCorrection, null, 'and it is not reported as a correction');
});

test('visual: withdrawing an estimate is a correction that is said; moving to a new report is not', () => {
 const h = historyFrom([fix(200, 0), fix(360, 20_000)]);
 let v = stepVisual(null, estimate(h, L, 30_000, P), 30_000, L, P);       // drawn 80 m past its report
 v = stepVisual(v, observedAt(h, 30_050, 'you chose reported positions only'), 30_050, null, P);
 assert.equal(v.lastCorrection.kind, 'snap');
 assert.ok(Math.abs(v.lastCorrection.metres - 80) < 3, `it went back ${v.lastCorrection.metres} m to the report`);
 const h2 = addFix(h, fix(440, 30_000)).history;
 const w = stepVisual(v, observedAt(h2, 31_000, 'you chose reported positions only'), 31_000, null, P);
 assert.equal(w.lastCorrection, v.lastCorrection, 'a bus shown at its reports moving to the next is not a correction');
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
 let v = stepVisual(null, estimate(h, L, 10_000, P), 10_000, L, P);
 v = {...v, bearing: 350};                                   // drawn as if facing slightly west of north
 const seen = [];
 for (let t = 10_050; t <= 12_000; t += 50) { v = stepVisual(v, estimate(h, L, t, P), t, L, P); seen.push(v.bearing); }
 assert.ok(seen.every(b => b <= 95 || b >= 345), 'it never swings the long way through the south');
 assert.ok(Math.abs(seen.at(-1) - 90) < 3);
});

test('frames are requested only while something is actually moving', () => {
 const moving = historyFrom([fix(200, 0), fix(360, 20_000)]);
 const standing = historyFrom([fix(300, 0), fix(300, 20_000)]);
 const e1 = estimate(moving, L, 25_000, P), e2 = estimate(standing, L, 25_000, P);
 assert.equal(needsFrames(e1, stepVisual(null, e1, 25_000, L, P)), true);
 assert.equal(needsFrames(e2, stepVisual(null, e2, 25_000, L, P)), false);
 assert.equal(needsFrames(estimate(moving, null, 25_000, P), null), false);
});

test('uncertainty comes from measured errors, or is not drawn', () => {
 const profile = {version: 'x', basis: 'held-out', bins: [{upTo: 10, n: 120, p50: 9, p80: 18}, {upTo: 30, n: 12, p50: 30, p80: 60}]};
 assert.deepEqual(uncertaintyAt(profile, 6), {metres: 18, n: 120, upTo: 10});
 assert.equal(uncertaintyAt(profile, 20), null, 'too few measured cases to say');
 assert.equal(uncertaintyAt(null, 5), null);
});
