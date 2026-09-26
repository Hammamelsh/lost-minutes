// Two route-192 buses at the Piccadilly terminus, each changing from an inbound to an outbound
// journey in the 12:03:18 publication of 26 September 2026, through the fleet's drawing as the page
// runs it (lib/fleet.ts): polled every 20 s, stepped every 100 ms, in view, the checked road of the
// new pattern loaded as the map loads it. The publications are the server's own, rebuilt from the
// collector's captures (tests/recorded/fleet-journey-change-192.json says how).
//
// Seen on the served site at 12:03:32–12:03:52 UTC: both buses stepped in one sample. Reproduced
// here, the cause is the fleet itself: a vehicle on another journey was given a new drawing, which
// started at its new report, so the bus left the place it was drawn with nothing between and nothing
// said. BNSM 11918 had reported 41 s and 54 m before the change — its own reports could be travelled
// between, and are now. BNSM 11930 had not reported for seven minutes before its new journey put it
// 108 m on — no movement can be drawn across that, so it is a repositioning, and the map now marks
// it as one (the fleet's trace), where the chosen bus has always been told.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {reconcileFleet, stepFleet, FLEET_MOVED_MS} from '../lib/fleet.ts';
import {parseLive} from '../lib/live.ts';
import {busesFromLive} from '../lib/follow.ts';
import {decodePolyline, makeTrack} from '../lib/motion.ts';

const recorded = JSON.parse(readFileSync(new URL('./recorded/fleet-journey-change-192.json', import.meta.url), 'utf8'));
const shape = JSON.parse(readFileSync(new URL('../' + recorded.shape, import.meta.url), 'utf8'));
const road = makeTrack('BNSM:192:outbound:434045882c', decodePolyline(shape.polyline6, 6), shape.stopOffsets ?? []);
const T = s => Date.parse(`2026-09-26T${s}Z`);
const WRITE_MS = 2500;            // the collector publishes a moment after its capture's timestamp
const ROAD_MS = 400;              // a road file asked for arrives a moment later
const metres = (a, b) => Math.hypot((b.lat - a.lat) * 111195, (b.lon - a.lon) * 111195 * Math.cos(a.lat * Math.PI / 180));
const options = {selectedKey: null, relevant: new Set(), inView: () => true, animate: true, models: null};

/** The two buses drawn every 100 ms from 11:58 to 12:06:20, polling every 20 s from `phase` ms. */
function run(phase) {
 let fleet = new Map(), served = null;
 const pending = [];
 const drawn = new Map();   // key -> [{t, lat, lon}]
 const traces = [];
 for (let t = T('11:58:00'); t <= T('12:06:20'); t += 100) {
  if ((t - T('11:58:00') - phase) % 20_000 === 0) {
   let best = null;
   for (const p of recorded.publications) if (p.receivedAtMs + WRITE_MS <= t) best = p;
   if (best && best !== served) {
    served = best;
    fleet = reconcileFleet(fleet, busesFromLive(parseLive(best.live), t, t, t));
    // The map asks for the road of every bus in view without one, at a street zoom.
    for (const entry of fleet.values()) {
     if (entry.road !== undefined || entry.roadAsked) continue;
     entry.roadAsked = true;
     const id = entry.bus.match && 'patternId' in entry.bus.match ? entry.bus.match.patternId : null;
     if (!id) { entry.road = null; continue; }
     pending.push({at: t + ROAD_MS, entry, track: id === road.id ? road : null});
    }
   }
  }
  for (const p of pending.filter(p => p.at <= t)) { p.entry.road = p.track; pending.splice(pending.indexOf(p), 1); }
  const step = stepFleet(fleet, t, options);
  for (const f of step.features) {
   const list = drawn.get(f.properties.key) ?? [];
   list.push({t, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0]});
   drawn.set(f.properties.key, list);
  }
  for (const m of step.moved ?? []) if (!traces.some(x => x.key === m.key && x.at === m.at)) traces.push(m);
 }
 return {drawn, traces};
}

test('the reports the fixture carries are the ones the served site had: a journey change 54 m and 108 m on', () => {
 // The publications either side of the change, by the second they were made.
 const at = s => recorded.publications.find(p => Math.abs(p.receivedAtMs - T(s)) < 1000).live.vehicles;
 const before = Object.fromEntries(at('12:02:58').map(v => [v.vehicle, v]));
 const after = Object.fromEntries(at('12:03:18').map(v => [v.vehicle, v]));
 assert.equal(before['11918'].journeyRef, '202');
 assert.equal(after['11918'].journeyRef, '221');
 assert.equal(before['11930'].journeyRef, '204');
 assert.equal(after['11930'].journeyRef, '223');
 assert.equal(Math.round(metres(before['11918'], after['11918'])), 54);
 assert.equal(Math.round(metres(before['11930'], after['11930'])), 108);
 // 11930 had stood silent for seven minutes; 11918 had reported 41 s before its new journey began.
 assert.equal((after['11930'].observedAtMs - before['11930'].observedAtMs) / 1000, 422);
 assert.equal((after['11918'].observedAtMs - before['11918'].observedAtMs) / 1000, 41);
});

const OLD_11930 = {lat: 53.48049, lon: -2.23558};   // its last inbound report, 11:55:58

test('across the journey changes no bus is moved unmarked, at any poll phase', () => {
 for (let phase = 0; phase < 20_000; phase += 1000) {
  const {drawn, traces} = run(phase);
  for (const key of ['BNSM|11918', 'BNSM|11930']) {
   const points = drawn.get(key);
   for (let i = 1; i < points.length; i++) {
    const d = metres(points[i - 1], points[i]);
    if (d <= 3) continue;
    const marked = traces.find(m => m.key === key && m.at === points[i].t);
    assert.ok(marked, `phase ${phase / 1000} s: ${key} moved ${d.toFixed(1)} m unmarked at ${new Date(points[i].t).toISOString().slice(11, 21)}`);
    assert.ok(Math.abs(marked.metres - d) < 1, 'the mark spans the move');
   }
  }
 }
});

test('11918 is drawn across its journey change from its own reports, not cut to the new one', () => {
 let continuous = 0;
 for (let phase = 0; phase < 20_000; phase += 1000) {
  const {traces} = run(phase);
  const mine = traces.filter(m => m.key === 'BNSM|11918');
  // Where its next report reached the page late enough that the drawing had waited past the old one
  // by more than the rewind allowance, the playback's own rule repositions it, and it is marked —
  // the late-report rule every bus has, not the 54 m cut the change of journey made.
  assert.ok(mine.length <= 1, `phase ${phase / 1000} s: ${mine.length} repositionings`);
  for (const m of mine) {
   assert.ok(m.metres < 30, `phase ${phase / 1000} s: a ${m.metres.toFixed(0)} m repositioning`);
   assert.equal(m.why, 'too_long');
  }
  if (!mine.length) continuous += 1;
 }
 assert.ok(continuous >= 12, `travelled without a repositioning at ${continuous} of 20 poll phases`);
});

test('11930’s seven unseen minutes are one marked repositioning, when the moment shown reaches its new report', () => {
 for (let phase = 0; phase < 20_000; phase += 1000) {
  const {traces} = run(phase);
  const mine = traces.filter(m => m.key === 'BNSM|11930');
  assert.equal(mine.length, 1, `phase ${phase / 1000} s: one repositioning marked, got ${mine.length}`);
  const [m] = mine;
  assert.equal(m.why, 'too_long', 'the reason is the time unseen');
  assert.ok(metres(OLD_11930, m.from) < 2, `from where it stood: ${metres(OLD_11930, m.from).toFixed(1)} m off its last inbound report`);
  // Onto its new journey: within reach of one of its new reports (the checked road places it).
  const news = recorded.publications.flatMap(p => p.live.vehicles).filter(v => v.vehicle === '11930' && v.journeyRef === '223');
  assert.ok(Math.min(...news.map(v => metres(v, m.to))) < 40, 'onto its new journey');
  // Not at the publication's arrival but as the playback reaches the report, a delay after it was made.
  assert.ok(m.at >= T('12:03:30') && m.at <= T('12:04:05'), new Date(m.at).toISOString());
 }
 assert.ok(FLEET_MOVED_MS >= 4000 && FLEET_MOVED_MS <= 8000, 'the mark stays a few seconds, as the chosen bus’s does');
});
