// Every bus in a reel through the fleet's drawing (lib/fleet.ts) as the map runs it: polled every
// 20 s, stepped every 100 ms, every bus in view, each bus's checked road loaded as the map loads it
// at a street zoom. Counts what a passenger could see as a cut — a step of more than `--cut` metres
// in 100 ms — and whether the map marked it as a repositioning, beside every marked repositioning by
// its reason. Nothing is sampled from a page: this is the drawing itself, on the reel's publications.
//
//   node --experimental-strip-types --import ./tests/alias-loader.mjs scripts/evaluate-fleet-steps.mjs \
//     --reel data/evaluation/reel-live-evening.json [--fleet path/to/fleet.ts] [--minutes 30] [--phase 7]
//
// `--fleet` runs another version of lib/fleet.ts (a copy of an earlier commit's, say) on the same
// frames, for a before-and-after. Written 26 September 2026 for the two 192s at Piccadilly.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseLive} from '../lib/live.ts';
import {busesFromLive} from '../lib/follow.ts';
import {decodePolyline, makeTrack} from '../lib/motion.ts';

const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : fallback; };
const reel = JSON.parse(readFileSync(arg('reel', 'data/evaluation/reel-live-evening.json'), 'utf8'));
const fleetPath = arg('fleet', null);
const {reconcileFleet, stepFleet} = await import(fleetPath ? pathToFileURL(resolve(fleetPath)).href : '../lib/fleet.ts');
const CUT = Number(arg('cut', 3)), POLL = 20_000, WRITE_MS = 2500, ROAD_MS = 400;
const phase = Number(arg('phase', 7)) * 1000;
const metres = (a, b) => Math.hypot((b.lat - a.lat) * 111195, (b.lon - a.lon) * 111195 * Math.cos(a.lat * Math.PI / 180));

const index = JSON.parse(readFileSync('public/data/shapes/index.json', 'utf8')).patterns;
const roads = new Map();
function roadFor(id) {
 if (!id || index[id]?.status !== 'accepted' || !index[id].file) return null;
 if (!roads.has(id)) {
  const shape = JSON.parse(readFileSync(`public/data/shapes/${index[id].file}`, 'utf8'));
  roads.set(id, makeTrack(id, decodePolyline(shape.polyline6, 6), shape.stopOffsets ?? []));
 }
 return roads.get(id);
}

const pubs = reel.publications;
const start = pubs[0].receivedAtMs + WRITE_MS, minutes = Number(arg('minutes', 0));
const end = minutes ? Math.min(pubs.at(-1).receivedAtMs, start + minutes * 60_000) : pubs.at(-1).receivedAtMs + 60_000;
const options = {selectedKey: null, relevant: new Set(), inView: () => true, animate: true, models: null};
let fleet = new Map(), served = null, ticks = 0, busTicks = 0;
const pending = [], last = new Map(), journeyChangedAt = new Map();
const cuts = [], marks = [];
const seenMarks = new Set();
for (let t = start; t <= end; t += 100) {
 if ((t - start - phase) % POLL === 0) {
  let best = null;
  for (const p of pubs) { if (p.receivedAtMs + WRITE_MS <= t) best = p; else break; }
  if (best && best !== served) {
   served = best;
   const buses = busesFromLive(parseLive(best.live), t, t, t);
   for (const b of buses) {
    const j = `${b.route}|${b.direction}|${b.journeyRef}`, was = fleet.get(b.key)?.journey;
    if (was && was !== j) journeyChangedAt.set(b.key, t);
   }
   fleet = reconcileFleet(fleet, buses);
   for (const entry of fleet.values()) {
    if (entry.road !== undefined || entry.roadAsked) continue;
    entry.roadAsked = true;
    const id = entry.bus.match && 'patternId' in entry.bus.match ? entry.bus.match.patternId : null;
    if (!id) { entry.road = null; continue; }
    pending.push({at: t + ROAD_MS, entry, track: roadFor(id)});
   }
  }
 }
 for (let i = pending.length - 1; i >= 0; i--) if (pending[i].at <= t) { pending[i].entry.road = pending[i].track; pending.splice(i, 1); }
 const step = stepFleet(fleet, t, options);
 ticks += 1;
 const moved = new Map((step.moved ?? []).map(m => [m.key, m]));
 for (const m of step.moved ?? []) {
  const id = `${m.key}@${m.at}`;
  if (!seenMarks.has(id)) { seenMarks.add(id); marks.push(m); }
 }
 // A bus left out of a publication is off the map until it is back: its return is not a step.
 const present = new Set(step.features.map(f => f.properties.key));
 for (const key of [...last.keys()]) if (!present.has(key)) last.delete(key);
 for (const f of step.features) {
  busTicks += 1;
  const key = f.properties.key, here = {lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0]};
  const before = last.get(key);
  last.set(key, here);
  if (!before) continue;
  const d = metres(before, here);
  if (d <= CUT) continue;
  const m = moved.get(key);
  const changed = journeyChangedAt.get(key);
  cuts.push({key, at: t, metres: d, marked: Boolean(m && m.at === t), afterJourneyChange: changed !== undefined && t - changed < 90_000});
 }
}
const unmarked = cuts.filter(c => !c.marked);
const pct = (xs, q) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return +s[Math.min(s.length - 1, Math.floor(q * s.length))].toFixed(1); };
const byReason = marks.reduce((a, m) => (a[m.why ?? 'none'] = (a[m.why ?? 'none'] ?? 0) + 1, a), {});
console.log(JSON.stringify({
 reel: arg('reel', 'data/evaluation/reel-live-evening.json'), fleet: fleetPath ?? 'lib/fleet.ts', pollPhaseSeconds: phase / 1000,
 minutes: +((end - start) / 60_000).toFixed(1), ticks, busTicks, buses: last.size, journeyChanges: journeyChangedAt.size,
 cutsOver3m: cuts.length,
 unmarked: {count: unmarked.length, afterJourneyChange: unmarked.filter(c => c.afterJourneyChange).length,
  medianMetres: pct(unmarked.map(c => c.metres), 0.5), maxMetres: pct(unmarked.map(c => c.metres), 1),
  worst: unmarked.sort((a, b) => b.metres - a.metres).slice(0, 5).map(c => `${c.key} ${new Date(c.at).toISOString().slice(11, 19)} ${c.metres.toFixed(0)} m${c.afterJourneyChange ? ' (journey change)' : ''}`)},
 marked: {count: marks.length, byReason, medianMetres: pct(marks.map(m => m.metres), 0.5), maxMetres: pct(marks.map(m => m.metres), 1)},
}, null, 1));
