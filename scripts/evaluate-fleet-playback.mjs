/**
 * Every bus in a reel of rebuilt publications, played back through the drawing as the page draws
 * it — with its pattern's checked road where one is accepted — and judged bus by bus.
 *
 *   node --experimental-strip-types --import ./tests/alias-loader.mjs scripts/evaluate-fleet-playback.mjs \
 *     --reel data/evaluation/reel-2026-09-22-evening-300-publications.json [--min-publications 6] [--top 12]
 *
 * For each vehicle: the publications it appears in are served in order at their recorded receipt
 * times, the page's history is rebuilt from each (the newest report and its trail), and the drawing
 * is stepped every 100 ms. What is measured is what a passenger would see: the share of frames the
 * bus moves in, its drawn speed and acceleration, the largest step between frames, how far it is
 * drawn from its checked road while on one, and every repositioning with its reason. Anything
 * outside the bounds the drawing is held to is listed by vehicle, so a fault on one bus is not
 * hidden in an average.
 */
import {readFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {historyFrom, observedAt, stepVisual, makeTrack, decodePolyline, project, PACE, PLAYBACK} from '@/lib/motion';

const arg = (k, d) => {const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d};
const reelPath = arg('reel', 'data/evaluation/reel-live-evening.json');
const minPubs = Number(arg('min-publications', 6));
const top = Number(arg('top', 12));
const reel = JSON.parse(readFileSync(reelPath, 'utf8'));
const index = JSON.parse(readFileSync('public/data/shapes/index.json', 'utf8')).patterns;
const tracks = new Map();
const trackFor = id => {
  if (!id || !index[id] || index[id].status !== 'accepted') return null;
  if (!tracks.has(id)) {
    const file = join('public/data/shapes', index[id].file);
    tracks.set(id, existsSync(file) ? (() => {const s = JSON.parse(readFileSync(file, 'utf8')); return makeTrack(id, decodePolyline(s.polyline6, 6), s.stopOffsets ?? [])})() : null);
  }
  return tracks.get(id);
};
const metres = (a, b) => Math.hypot((b.lat - a.lat) * 111195, (b.lon - a.lon) * 111195 * Math.cos(a.lat * Math.PI / 180));
const q = (a, p) => {if (!a.length) return null; const b = [...a].sort((x, y) => x - y); return b[Math.floor((b.length - 1) * p)]};
const dirOf = (a, b) => (Math.atan2((b.lon - a.lon) * Math.cos(a.lat * Math.PI / 180), b.lat - a.lat) * 180 / Math.PI + 360) % 360;
const turnOf = (a, b) => ((b - a) % 360 + 540) % 360 - 180;
// How the page's publications reach a phone: every `--poll` seconds (the site's configuration is 20 s),
// the newest publication written by then. 0 serves each at its own receipt time, as before.
const pollMs = Number(arg('poll', 0)) * 1000;

// Publications per vehicle, keeping the journey the vehicle is on (a new journey is a new run).
const byVehicle = new Map();
for (const p of reel.publications) for (const v of p.live.vehicles ?? []) {
  const key = `${v.operator}|${v.vehicle}|${v.route}|${v.direction}|${v.journeyRef}`;
  if (!byVehicle.has(key)) byVehicle.set(key, []);
  byVehicle.get(key).push({receivedAtMs: p.receivedAtMs, v});
}
const runs = [...byVehicle.entries()].filter(([, pubs]) => pubs.length >= minPubs);
const results = [];
for (const [key, pubs] of runs) {
  const patternId = pubs.at(-1).v.match?.patternId ?? null;
  const road = trackFor(patternId);
  const t0 = pubs[0].receivedAtMs, start = 1_000_000, shift = start - t0;
  const fixesOf = v => {const fx = (v.trail ?? []).map(t => ({at: v.observedAtMs - t[0] + shift, lat: t[1], lon: t[2], bearing: t[3], service: 's', source: 'h'}));
    fx.push({at: v.observedAtMs + shift, lat: v.lat, lon: v.lon, bearing: v.bearing, service: 's', source: 'h'}); return fx};
  let vis = null, i = -1, prev = null, prevV = null;
  const steps = [], speeds = [], accels = [], off = [], snaps = [], swings = [], unsaidSteps = [];
  let frames = 0, moving = 0, onRoadFrames = 0, distinct = new Set();
  // What 24 September's route-43 incident exposed, judged on every bus: which way it faces against
  // the way it is drawn moving, one-frame turns, a lost heading, and the delay it is drawn at.
  const headingOff = [], spins = [], delays = []; let nullAfterKnown = 0, knownYet = false, misRun = 0, misLongest = 0;
  // How far the reports themselves moved over the window: a bus drawn standing while its reports
  // moved is a drawing fault; one drawn standing because its reports stood is not.
  const reportPoints = pubs.map(p => ({lat: p.v.lat, lon: p.v.lon}));
  const reportsMoved = Math.max(0, ...reportPoints.map(r => metres(reportPoints[0], r)));
  const end = start + (pubs.at(-1).receivedAtMs - t0) + 20_000;
  for (let wall = start; wall <= end; wall += 100) {
    const visibleAt = pollMs ? start + Math.floor((wall - start) / pollMs) * pollMs : wall;
    while (i + 1 < pubs.length && pubs[i + 1].receivedAtMs + shift + (pollMs ? 2500 : 0) <= visibleAt) i++;
    if (i < 0) continue;
    const fixes = fixesOf(pubs[i].v); distinct.add(pubs[i].v.observedAtMs);
    if (fixes.length < 2) continue;
    const h = historyFrom(fixes), e = observedAt(h, wall, 'fleet');
    vis = stepVisual(vis, e, wall, null, undefined, h, road); frames++;
    const said = vis.lastCorrection?.kind === 'snap' && wall - vis.lastCorrection.at <= 200;
    if (vis.bearing !== null) knownYet = true; else if (knownYet) nullAfterKnown++;
    if (prev && prev.bearing !== null && vis.bearing !== null && !said) spins.push(Math.abs(turnOf(prev.bearing, vis.bearing)));
    if (prev && metres(prev, vis) >= 0.5 && vis.bearing !== null && !said) { const o = Math.abs(turnOf(vis.bearing, dirOf(prev, vis))); headingOff.push(o);
      misRun = o > 30 ? misRun + 1 : 0; misLongest = Math.max(misLongest, misRun); }
    if (vis.buffer && pubs[i].v.observedAtMs + shift > wall - PLAYBACK.maxDelayMs) delays.push((wall - (vis.buffer.represented ?? vis.buffer.shown)) / 1000);
    if (prev) { const st = metres(prev, vis); steps.push(st); if (st > 0.05) moving++;
      // A step over a bus length is a repositioning, and must have been said on that frame.
      if (st > 12 && !(vis.lastCorrection?.kind === 'snap' && wall - vis.lastCorrection.at <= 200)) unsaidSteps.push({at: wall - start, metres: Math.round(st)}); }
    if (vis.lastCorrection?.kind === 'snap' && (!snaps.length || snaps.at(-1).at !== vis.lastCorrection.at))
      snaps.push({at: vis.lastCorrection.at, metres: Math.round(vis.lastCorrection.metres), why: vis.lastCorrection.why ?? 'unsaid'});
    if (road && vis.buffer?.onRoad) { onRoadFrames++; off.push(project(road, vis).offset); }
    speeds.push(vis.velocity ?? 0);
    if (speeds.length > 200) swings.push(Math.abs((vis.velocity ?? 0) - speeds[speeds.length - 201]));
    if (prevV !== null) accels.push(Math.abs((vis.velocity ?? 0) - prevV) / 0.1);
    prev = {lat: vis.lat, lon: vis.lon, bearing: vis.bearing}; prevV = vis.velocity ?? 0;
  }
  if (frames < 50) continue;
  const unsaid = snaps.filter(s => s.why === 'unsaid').length;
  results.push({key, patternId, road: !!road, publications: pubs.length, reports: distinct.size, frames, reportsMoved: Math.round(reportsMoved),
    movingShare: moving / Math.max(1, steps.length), stepP95: q(steps, .95), stepMax: Math.max(0, ...steps),
    speedP95: q(speeds, .95), speedMax: Math.max(0, ...speeds), swing20sP95: q(swings, .95), accelP95: q(accels.slice(1), .95), accelMax: Math.max(0, ...accels.slice(1)),
    onRoadShare: road ? onRoadFrames / frames : null, offRoadP95: off.length ? q(off, .95) : null, offRoadMax: off.length ? Math.max(...off) : null,
    snaps: snaps.length, unsaid: unsaid + unsaidSteps.length, unsaidSteps: unsaidSteps.slice(0, 3), snapList: snaps.slice(0, 4),
    headingOffP95: q(headingOff, .95), misalignedLongestS: misLongest / 10, spinMax: Math.max(0, ...spins), nullHeadingFrames: nullAfterKnown,
    delayP50: q(delays, .5), delayMax: delays.length ? Math.max(...delays) : null});
}
const fleet = {
  vehicles: results.length, withRoad: results.filter(r => r.road).length,
  movingShareP50: q(results.map(r => r.movingShare), .5), movingShareP10: q(results.map(r => r.movingShare), .1),
  stepMaxP95: q(results.map(r => r.stepMax), .95), stepMaxMax: Math.max(...results.map(r => r.stepMax)),
  speedMaxMax: Math.max(...results.map(r => r.speedMax)), accelMaxP95: q(results.map(r => r.accelMax), .95),
  // How much the drawn speed changes over 20 s, across the fleet: the surge a passenger sees.
  swing20sP95Median: q(results.map(r => r.swing20sP95 ?? 0), .5), swing20sP95P90: q(results.map(r => r.swing20sP95 ?? 0), .9),
  offRoadP95OfP95: q(results.filter(r => r.offRoadP95 !== null).map(r => r.offRoadP95), .95),
  offRoadMaxMax: Math.max(0, ...results.filter(r => r.offRoadMax !== null).map(r => r.offRoadMax)),
  snapsTotal: results.reduce((a, r) => a + r.snaps, 0), unsaidTotal: results.reduce((a, r) => a + r.unsaid, 0),
  stoodWholeWindow: results.filter(r => r.movingShare < 0.05 && r.reportsMoved < 50).length,
  headingOffP95Median: q(results.map(r => r.headingOffP95 ?? 0), .5), headingOffP95P90: q(results.map(r => r.headingOffP95 ?? 0), .9),
  misalignedOver1_5s: results.filter(r => r.misalignedLongestS > 1.5).length, spinOver10: results.filter(r => r.spinMax > 10).length,
  nullHeadingBuses: results.filter(r => r.nullHeadingFrames > 0).length,
  delayP50Median: q(results.map(r => r.delayP50 ?? 0).filter(Boolean), .5), delayMaxMax: Math.max(0, ...results.map(r => r.delayMax ?? 0)),
  delayOver75: results.filter(r => (r.delayMax ?? 0) > 75).length,
  drawnStandingWhileReportsMoved: results.filter(r => r.movingShare < 0.2 && r.reportsMoved > 150).length,
};
// Bounds the drawing is held to: a step over a bus length is a repositioning (and must be said);
// speeds above PACE.maxMps and accelerations above the brake bound are the follower's own faults.
const outliers = results.filter(r => r.unsaid > 0 || r.misalignedLongestS > 1.5 || r.spinMax > 10 || (r.delayMax ?? 0) > 75 || r.speedMax > PACE.maxMps + 0.5 || (r.offRoadP95 !== null && r.offRoadP95 > 5) || (r.movingShare < 0.2 && r.reportsMoved > 150))
  .sort((a, b) => b.stepMax - a.stepMax);
// The buses drawn furthest from the road they are said to be on, whatever their 95th percentile:
// a single moment off the road is a moment a passenger can see.
const furthestOffRoad = results.filter(r => r.offRoadMax !== null).sort((a, b) => b.offRoadMax - a.offRoadMax).slice(0, 5)
  .map(r => ({key: r.key, offRoadMax: +r.offRoadMax.toFixed(1), offRoadP95: +(r.offRoadP95 ?? 0).toFixed(1), snaps: r.snapList}));
console.log(JSON.stringify({reel: reelPath, publications: reel.publications.length, minPubs, fleet, furthestOffRoad,
  outliers: outliers.slice(0, top), slowest: results.filter(r => r.reportsMoved > 150).sort((a, b) => a.movingShare - b.movingShare).slice(0, top).map(r => ({key: r.key, movingShare: +r.movingShare.toFixed(2), reports: r.reports, reportsMoved: r.reportsMoved, road: r.road, snaps: r.snaps}))}, null, 1));
