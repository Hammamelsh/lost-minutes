// Two buses back from a silence longer than a published trail reaches (240 s, pipeline/live.py), through
// the fleet's drawing as the page runs it: polled every 20 s, stepped every 100 ms, in view, each bus's
// checked road loaded as the map loads it. The publications are the served ones with every other vehicle
// removed (tests/recorded/fleet-silence-*.json say where each came from).
//
// The report after such a silence arrives with no report from before it, so the bus's path began there,
// and the move to it was judged afresh rather than from where the bus stood. On the deployed code
// (4d1f586) the route-65 below was said to have moved because "there was no earlier report to travel
// from", seven minutes after its last one, and both buses were moved as soon as their report arrived,
// 3–22 s ahead of the moment the drawing showed. The drawn place is now kept in front of the reports
// (continuity, lib/motion.ts), and the move is judged by the pair rule as any two reports are: 172 m after
// 445 s unseen is "too long"; 3,969 m is "too far". It is made when the drawing reaches the report after
// the silence, from where the bus stood, and nothing is drawn across it.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {reconcileFleet, stepFleet} from '../lib/fleet.ts';
import {parseLive} from '../lib/live.ts';
import {busesFromLive} from '../lib/follow.ts';
import {decodePolyline, makeTrack, project} from '../lib/motion.ts';

const load = name => JSON.parse(readFileSync(new URL(`./recorded/${name}`, import.meta.url), 'utf8'));
const WRITE_MS = 2500;            // the collector publishes a moment after its capture's timestamp
const ROAD_MS = 400;              // a road file asked for arrives a moment later
const metres = (a, b) => Math.hypot((b.lat - a.lat) * 111195, (b.lon - a.lon) * 111195 * Math.cos(a.lat * Math.PI / 180));
const options = {selectedKey: null, relevant: new Set(), inView: () => true, animate: true, models: null};
const hhmmss = t => Number.isFinite(t) ? new Date(t).toISOString().slice(11, 21) : String(t);

const CASES = [
 {name: 'the route-65', file: 'fleet-silence-65.json', key: 'BNDB|YY73OYL', day: '2026-09-26',
  before: '11:55:10', after: '12:02:35', silence: 445, apart: 172, why: 'too_long', from: '11:58:00', to: '12:07:20'},
 {name: 'the route-370', file: 'fleet-silence-370.json', key: 'BNML|YX74OJM', day: '2026-09-22',
  before: '21:11:20', after: '21:25:33', silence: 853, apart: 3969, why: 'too_far', from: '21:15:30', to: '21:36:30'},
];

function prepare(c) {
 const recorded = load(c.file);
 let road = null;
 if (recorded.shape) {
  const shape = JSON.parse(readFileSync(new URL('../' + recorded.shape, import.meta.url), 'utf8'));
  road = makeTrack(shape.id, decodePolyline(shape.polyline6, 6), shape.stopOffsets ?? []);
 }
 const T = s => Date.parse(`${c.day}T${s}Z`);
 const reports = new Map();
 for (const p of recorded.publications) for (const v of p.live.vehicles) reports.set(v.observedAtMs, v);
 // A report is drawn on its checked road where it measures onto it: that far from where it was made.
 const off = p => road ? project(road, p).offset : 0;
 return {recorded, road, T, off, before: reports.get(T(c.before)), after: reports.get(T(c.after)),
  // When the report after the silence was first published.
  arrived: recorded.publications.find(p => p.live.vehicles.some(v => v.observedAtMs === T(c.after))).receivedAtMs};
}

/** The bus drawn every 100 ms over the case's window, polling every 20 s from `phase` ms. */
function run(c, {recorded, road, T}, phase) {
 let fleet = new Map(), served = null;
 const pending = [], drawn = [], traces = [];
 for (let t = T(c.from); t <= T(c.to); t += 100) {
  if ((t - T(c.from) - phase) % 20_000 === 0) {
   let best = null;
   for (const p of recorded.publications) if (p.receivedAtMs + WRITE_MS <= t) best = p;
   if (best && best !== served) {
    served = best;
    fleet = reconcileFleet(fleet, busesFromLive(parseLive(best.live), t, t, t));
    for (const entry of fleet.values()) {
     if (entry.road !== undefined || entry.roadAsked) continue;
     entry.roadAsked = true;
     const id = entry.bus.match && 'patternId' in entry.bus.match ? entry.bus.match.patternId : null;
     if (!id) { entry.road = null; continue; }
     pending.push({at: t + ROAD_MS, entry, journey: entry.journey, track: road && id === road.id ? road : null});
    }
   }
  }
  for (const p of pending.filter(p => p.at <= t)) { if (p.entry.journey === p.journey) p.entry.road = p.track; pending.splice(pending.indexOf(p), 1); }
  const step = stepFleet(fleet, t, options);
  const f = step.features.find(x => x.properties.key === c.key);
  const buffer = fleet.get(c.key)?.vis?.buffer;
  if (f) drawn.push({t, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], shown: buffer?.shown});
  for (const m of step.moved ?? []) if (m.key === c.key && !traces.some(x => x.at === m.at)) traces.push({...m, shown: buffer?.shown});
 }
 return {drawn, traces};
}

for (const c of CASES) {
 const data = prepare(c);

 test(`${c.name}'s reports are the published ones: ${c.silence} s unseen, ${c.apart} m apart, one journey`, () => {
  assert.ok(data.before && data.after, 'both reports are in the recording');
  assert.equal((data.after.observedAtMs - data.before.observedAtMs) / 1000, c.silence);
  assert.equal(Math.round(metres(data.before, data.after)), c.apart);
  assert.equal(data.after.journeyRef, data.before.journeyRef, 'the same journey either side of the silence');
  // The report after the silence arrives with nothing from before it: the trail reaches back 240 s.
  const first = data.recorded.publications.find(p => p.receivedAtMs === data.arrived).live.vehicles[0];
  assert.equal(first.observedAtMs, data.after.observedAtMs);
  assert.ok((first.trail ?? []).every(point => point[0] <= 240_000), 'its trail is within the published window');
  assert.ok(!(first.trail ?? []).some(point => data.after.observedAtMs - point[0] <= data.before.observedAtMs),
   'and holds no report from before the silence');
 });

 test(`${c.name}'s silence is one repositioning, "${c.why}", made when the drawing reaches the report after it, at every poll phase`, () => {
  for (let phase = 0; phase < 20_000; phase += 1000) {
   const {drawn, traces} = run(c, data, phase);
   const at = `phase ${phase / 1000} s`;
   assert.equal(traces.length, 1, `${at}: one move marked, got ${traces.map(m => `${m.metres.toFixed(0)} m ${m.why} at ${hhmmss(m.at)}`).join(', ')}`);
   const [m] = traces;
   assert.equal(m.why, c.why, `${at}: the pair's own reason`);
   // From where the bus stood at its report before the silence, to the report after it.
   const stood = drawn.filter(p => p.t < m.at).at(-1);
   assert.ok(metres(stood, m.from) < 0.5, `${at}: the move starts where the bus was drawn`);
   const offBefore = data.off(data.before), offAfter = data.off(data.after);
   assert.ok(metres(data.before, m.from) < offBefore + 0.5, `${at}: at its report before the silence (${metres(data.before, m.from).toFixed(1)} m off it, ${offBefore.toFixed(1)} m off its road)`);
   assert.ok(metres(data.after, m.to) < offAfter + 0.5, `${at}: to its report after it (${metres(data.after, m.to).toFixed(1)} m off it, ${offAfter.toFixed(1)} m off its road)`);
   assert.ok(Math.abs(m.metres - c.apart) < 1 + offBefore + offAfter, `${at}: the reports' own distance, ${m.metres.toFixed(1)} m`);
   // Once the drawing's moment has reached that report, not when it arrived: in between, the bus stands.
   assert.ok(m.shown >= data.after.observedAtMs, `${at}: the moment shown, ${hhmmss(m.shown)}, has reached the report of ${c.after}`);
   assert.ok(m.at > data.arrived, `${at}: after the report arrived`);
   const between = drawn.filter(p => p.t >= data.arrived && p.t < m.at);
   assert.ok(between.length > 0 && between.every(p => metres(p, m.from) < 0.5),
    `${at}: nothing is drawn across the silence (${Math.max(...between.map(p => metres(p, m.from))).toFixed(1)} m at most from where it stood)`);
   // And nothing else moves it unmarked.
   for (let i = 1; i < drawn.length; i++) {
    const d = metres(drawn[i - 1], drawn[i]);
    if (d > 3) assert.equal(drawn[i].t, m.at, `${at}: ${d.toFixed(1)} m unmarked at ${hhmmss(drawn[i].t)}`);
   }
  }
 });
}
