// Every bus on the map, drawn from its own reports (lib/fleet.ts, 25 September 2026). Synthetic
// buses on a straight road due north, reporting every 20 s; a report reaches the page 12 s after
// it is made, and the page is met a minute in, so each bus has a trail to play back.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fleetAtReports, reconcileFleet, stepFleet} from '../lib/fleet.ts';

const M = 111195, LAT0 = 53.4, LON0 = -2.2, T0 = Date.parse('2026-09-25T20:00:00Z');
const at = (s, x, lon = LON0) => ({at: T0 + s * 1000, lat: LAT0 + x / M, lon, bearing: 0, source: 'h'});
const progress = p => (p.lat - LAT0) * M;

/** A published bus at `now`: its reports up to those the page could have by then. */
function bus(id, {x0 = 0, speed = 6, now, lon = LON0, route = '42', journeyRef = 'j1', bearing = 0, freshness = 'fresh'}) {
 const reports = [];
 for (let s = 0; T0 + s * 1000 + 12_000 <= now; s += 20) reports.push({...at(s, x0 + speed * s, lon), bearing});
 const latest = reports.at(-1);
 return {key: `OP|${id}`, operator: 'OP', vehicle: id, route, direction: 'inbound', journeyRef, destination: 'Town',
  lat: latest.lat, lon: latest.lon, observedAtMs: latest.at, recordedAt: new Date(latest.at).toISOString(),
  ageSeconds: (now - latest.at) / 1000, freshness, ageWords: 'x', sourceHash: 'h'.repeat(64),
  bearing, bearingStatus: bearing === null ? 'absent' : 'reported', retrievedAtMs: latest.at + 12_000,
  trail: reports.slice(0, -1)};
}
const everywhere = () => true;
const options = (extra = {}) => ({selectedKey: null, relevant: new Set(), inView: everywhere, animate: true, models: null, ...extra});

test('a bus in view is drawn moving between its reports, behind the newest one and never past it', () => {
 const now = T0 + 90_000;
 let fleet = reconcileFleet(new Map(), [bus('a', {now})]);
 const xs = [];
 for (let t = now; t <= now + 20_000; t += 100) {
  const step = stepFleet(fleet, t, options());
  const [lon, lat] = step.features[0].geometry.coordinates;
  xs.push(progress({lat, lon}));
  assert.equal(step.inView, 1);
  assert.ok(progress({lat, lon}) <= progress(fleet.get('OP|a').bus) + 0.01, 'never past the newest report');
 }
 assert.ok(xs.at(-1) - xs[0] > 60, `moved ${(xs.at(-1) - xs[0]).toFixed(0)} m in 20 s`);
 for (let i = 1; i < xs.length; i++) assert.ok(xs[i] >= xs[i - 1] - 0.01, `frame ${i} went back ${(xs[i - 1] - xs[i]).toFixed(2)} m`);
 assert.ok(Math.max(...xs.slice(1).map((x, i) => x - xs[i])) < 2, 'no step over 2 m in 100 ms');
});

test('a bus out of view stands at its newest report and costs no playback; the chosen bus is left out', () => {
 const now = T0 + 90_000;
 const fleet = reconcileFleet(new Map(), [bus('a', {now}), bus('b', {now, lon: LON0 + 0.05}), bus('c', {now, lon: LON0 + 0.1})]);
 const step = stepFleet(fleet, now, options({selectedKey: 'OP|c', inView: (lat, lon) => lon < LON0 + 0.01}));
 assert.equal(step.total, 2, 'the chosen bus is not the fleet’s to draw');
 assert.equal(step.inView, 1);
 assert.equal(step.features.map(f => f.properties.key).join(','), 'OP|a,OP|b');
 const b = step.features[1];
 assert.deepEqual(b.geometry.coordinates, [fleet.get('OP|b').bus.lon, fleet.get('OP|b').bus.lat]);
 assert.equal(fleet.get('OP|b').vis, null, 'no drawing kept for a bus out of view');
 assert.notEqual(fleet.get('OP|a').vis, null);
});

test('the passenger’s own buses are drawn stronger, stale ones muted, and a bus without a heading has no nose', () => {
 const now = T0 + 90_000;
 const fleet = reconcileFleet(new Map(), [bus('a', {now}), bus('b', {now, freshness: 'stale'}), bus('c', {now, bearing: null})]);
 const step = fleetAtReports(fleet, {selectedKey: null, relevant: new Set(['OP|a'])});
 const icons = Object.fromEntries(step.features.map(f => [f.properties.key, f.properties]));
 assert.equal(icons['OP|a'].icon, 'lm-bus-arrow'); assert.equal(icons['OP|a'].tier, 'relevant'); assert.equal(icons['OP|a'].sort, 2);
 assert.equal(icons['OP|b'].icon, 'lm-stale-arrow'); assert.equal(icons['OP|b'].sort, 0);
 assert.equal(icons['OP|c'].icon, 'lm-fleet-dot'); assert.equal(icons['OP|c'].tier, 'other'); assert.equal(icons['OP|c'].sort, 1);
 assert.equal(step.moving, 0, 'nothing is played back at the reports');
});

test('a publication keeps each drawing, rebuilds a changed history, and carries a drawn bus into its next journey', () => {
 const now = T0 + 90_000;
 let fleet = reconcileFleet(new Map(), [bus('a', {now}), bus('b', {now})]);
 stepFleet(fleet, now, options());
 const before = fleet.get('OP|a');
 assert.notEqual(before.vis, null);
 // The next publication: a has a new report, b is on another journey, c is new, and nothing of d.
 // A new journey's first publication carries its first report and no trail, as the feed's do.
 const next = {...bus('b', {now: now + 20_000, journeyRef: 'j2'}), trail: []};
 fleet = reconcileFleet(fleet, [bus('a', {now: now + 20_000}), next, bus('c', {now: now + 20_000})]);
 assert.equal(fleet.get('OP|a'), before, 'the same entry, its drawing kept');
 assert.equal(fleet.get('OP|a').history.fixes.length, before.history.fixes.length, 'history rebuilt from the new reports');
 // Restated 26 September 2026: a new journey was a new drawing, which began at the new report and
 // stepped the bus there unsaid (two 192s at Piccadilly, 54 m and 108 m; tests/fleet-journey-change).
 // The drawing now goes on, with the previous journey's newest report in front of the new reports.
 const b = fleet.get('OP|b');
 assert.notEqual(b.vis, null, 'another journey keeps the drawing it had');
 assert.equal(b.journey, '42|inbound|j2');
 assert.equal(b.road, undefined, 'the new journey’s road is asked for afresh');
 assert.ok(b.carried.length > 0, 'the previous journey’s reports are carried');
 assert.equal(b.history.fixes[0].at, b.carried[0].at, 'in front of the new journey’s reports');
 assert.equal(b.history.fixes.at(-1).at, next.observedAtMs, 'up to the new journey’s newest');
 assert.equal(fleet.get('OP|c').vis, null);
 assert.equal(fleet.size, 3);
});

test('3D models go to the nearest buses in view with a heading, a bounded number, and those give up their flat marker', () => {
 const now = T0 + 90_000;
 const buses = [0, 1, 2, 3, 4].map(i => bus(`b${i}`, {now, lon: LON0 + i * 0.001}));
 buses.push(bus('nohead', {now, lon: LON0 + 0.0005, bearing: null}));
 const fleet = reconcileFleet(new Map(), buses);
 const step = stepFleet(fleet, now, options({models: {centre: {lat: LAT0 + 400 / M, lon: LON0 + 0.004}, limit: 2}}));
 assert.deepEqual(step.modelled.map(m => m.key), ['OP|b4', 'OP|b3']);
 const flags = Object.fromEntries(step.features.map(f => [f.properties.key, f.properties.model]));
 assert.equal(flags['OP|b4'], 1); assert.equal(flags['OP|b3'], 1); assert.equal(flags['OP|b0'], 0); assert.equal(flags['OP|nohead'], 0);
});

test('two hundred buses in view are stepped in a few milliseconds', () => {
 const now = T0 + 90_000;
 const fleet = reconcileFleet(new Map(), Array.from({length: 200}, (_, i) => bus(`v${i}`, {now, lon: LON0 + i * 0.0002, x0: i * 30})));
 stepFleet(fleet, now, options());
 const t0 = performance.now();
 for (let t = now + 100; t <= now + 2_000; t += 100) stepFleet(fleet, t, options());
 const perTick = (performance.now() - t0) / 19;
 assert.ok(perTick < 25, `${perTick.toFixed(1)} ms a tick for 200 buses`);
});
