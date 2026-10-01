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
 *
 * With --osm, every drawn frame (every 500 ms) and every report is also measured against the map's own drivable
 * roads and buildings (scripts/osm-streets.mjs): how far from the nearest road the bus is drawn, and whether it is
 * drawn inside a building, against the same for its reports. Asked for by the owner on 30 September 2026, after a
 * 74 with every report within 3.4 m of its road was drawn over the houses beside it.
 */
import {readFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {historyFrom, observedAt, stepVisual, makeTrack, decodePolyline, project, PACE, PLAYBACK} from '@/lib/motion';
import {loadOsm} from './osm-streets.mjs';
import {extendStreets, prepareStreets} from '@/lib/streets';
import {tileStreets, tilesCovering} from '@/lib/mvt';

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
// Where in each bus's run the page first meets it, as a share of its publications: 0 from its first,
// 0.5 halfway. A passenger opens a ride at any moment, and a bus met mid-stand has none of the
// reports that gave it a heading (25 September 2026, a served 216 at Piccadilly Gardens).
const meet = Number(arg('meet', 0));

// Publications per vehicle, keeping the journey the vehicle is on (a new journey is a new run).
const byVehicle = new Map();
for (const p of reel.publications) for (const v of p.live.vehicles ?? []) {
  const key = `${v.operator}|${v.vehicle}|${v.route}|${v.direction}|${v.journeyRef}`;
  if (!byVehicle.has(key)) byVehicle.set(key, []);
  byVehicle.get(key).push({receivedAtMs: p.receivedAtMs, v});
}
const runs = [...byVehicle.entries()].filter(([, pubs]) => pubs.length >= minPubs);
const osm = process.argv.includes('--osm') ? await loadOsm(runs.flatMap(([, pubs]) => pubs.map(p => [p.v.lat, p.v.lon]))) : null;
if (osm) console.error(JSON.stringify({osm: {version: osm.version, tiles: osm.tiles, fetched: osm.fetched, kb: Math.round(osm.bytes / 1024), roadLines: osm.lines}}));
const roadM = (lat, lon) => osm.nearestRoad(lat, lon)?.metres ?? 80;
// With --streets (and --osm), a bus with no checked road is drawn along the map's streets between its reports
// (lib/streets.ts), as the page now draws it: its street track kept and extended at each publication, on the streets
// the page reads — the same z14 tiles, cut at their edges (lib/mvt.ts), in one set grown a tile at a time.
const streets = osm && process.argv.includes('--streets');
const pageStreets = (() => {
  const all = [], held = new Set();
  return box => {
    for (const [x, y] of tilesCovering(box)) {
      const key = `${x}/${y}`, file = join('data/evaluation/osm-tiles', `${osm.version}-14-${x}-${y}.pbf`);
      if (held.has(key)) continue;
      held.add(key);
      if (!existsSync(file)) continue;
      for (const line of tileStreets(readFileSync(file), 14, x, y)) all.push(line);
      prepareStreets(all, 53.48);
    }
    return all;
  };
})();
const streetFor = (run, fixes) => extendStreets(run, fixes, pageStreets);
const results = [];
for (const [key, pubs] of runs) {
  const patternId = pubs.at(-1).v.match?.patternId ?? null;
  const road = trackFor(patternId);
  const t0 = pubs[0].receivedAtMs, start = 1_000_000, shift = start - t0;
  const fixesOf = v => {const fx = (v.trail ?? []).map(t => ({at: v.observedAtMs - t[0] + shift, lat: t[1], lon: t[2], bearing: t[3], service: 's', source: 'h'}));
    fx.push({at: v.observedAtMs + shift, lat: v.lat, lon: v.lon, bearing: v.bearing, service: 's', source: 'h'}); return fx};
  let vis = null, i = -1, prev = null, prevV = null, streetAt = -1, street = null, streetFrames = 0;
  const steps = [], speeds = [], accels = [], off = [], snaps = [], swings = [], unsaidSteps = [];
  let frames = 0, moving = 0, onRoadFrames = 0, distinct = new Set();
  // What 24 September's route-43 incident exposed, judged on every bus: which way it faces against
  // the way it is drawn moving, one-frame turns, a lost heading, and the delay it is drawn at.
  const headingOff = [], spins = [], delays = [], lateFrames = []; let misEasing = 0, misPlain = 0, nullAfterKnown = 0, knownYet = false, misRun = 0, misLongest = 0;
  // And what the served 216 exposed: a bus drawn on its road but called off it, one with no heading
  // there, and the most a bus turned within 5 s while drawn standing still (under 5 cm a frame) —
  // scatter round a stand turned buses round on the spot.
  let offLabelOnRoad = 0, nullOnRoad = 0, standTurnMax = 0, still = [];
  // How far the reports themselves moved over the window: a bus drawn standing while its reports
  // moved is a drawing fault; one drawn standing because its reports stood is not.
  const reportPoints = pubs.map(p => ({lat: p.v.lat, lon: p.v.lon}));
  // Against the map: every drawn frame each 500 ms, and every distinct report, from the nearest drivable road.
  const drawnRoad = [], drawnInside = [], worstDrawn = {m: -1}, insideAt = [];
  const reportRoad = osm ? [...new Map(pubs.map(p => [p.v.observedAtMs, p.v])).values()].map(v => roadM(v.lat, v.lon)) : [];
  const reportsMoved = Math.max(0, ...reportPoints.map(r => metres(reportPoints[0], r)));
  const end = start + (pubs.at(-1).receivedAtMs - t0) + 20_000;
  for (let wall = start; wall <= end; wall += 100) {
    const visibleAt = pollMs ? start + Math.floor((wall - start) / pollMs) * pollMs : wall;
    while (i + 1 < pubs.length && pubs[i + 1].receivedAtMs + shift + (pollMs ? 2500 : 0) <= visibleAt) i++;
    if (i < 0 || i < Math.floor(meet * pubs.length)) continue;
    const fixes = fixesOf(pubs[i].v); distinct.add(pubs[i].v.observedAtMs);
    if (fixes.length < 2) continue;
    const h = historyFrom(fixes), e = observedAt(h, wall, 'fleet');
    if (streets && !road && streetAt !== i) { street = streetFor(street, fixes); streetAt = i; }
    vis = stepVisual(vis, e, wall, null, undefined, h, road ?? (streets ? street?.track ?? null : null)); frames++;
    if (street && !road && vis.buffer?.onRoad) streetFrames++;
    if (osm && frames % 5 === 0) {
      const m = roadM(vis.lat, vis.lon), b = osm.building(vis.lat, vis.lon);
      drawnRoad.push(m); drawnInside.push(b && b.base < 3.3 ? 1 : 0);
      if (b && b.base < 3.3) insideAt.push([+vis.lat.toFixed(4), +vis.lon.toFixed(4), b.height, +m.toFixed(1)]);
      if (m > worstDrawn.m) Object.assign(worstDrawn, {m, at: wall - start, lat: +vis.lat.toFixed(6), lon: +vis.lon.toFixed(6), onRoad: vis.buffer?.onRoad ?? null});
    }
    const said = vis.lastCorrection?.kind === 'snap' && wall - vis.lastCorrection.at <= 200;
    if (vis.bearing !== null) knownYet = true; else if (knownYet) nullAfterKnown++;
    if (prev && prev.bearing !== null && vis.bearing !== null && !said) spins.push(Math.abs(turnOf(prev.bearing, vis.bearing)));
    if (prev && metres(prev, vis) >= 0.5 && vis.bearing !== null && !said) { const o = Math.abs(turnOf(vis.bearing, dirOf(prev, vis))); headingOff.push(o);
      misRun = o > 30 ? misRun + 1 : 0; misLongest = Math.max(misLongest, misRun);
      // Why a frame faces off its movement: an eased correction under way (the bus moved across, not along), or not.
      if (o > 30) { const ez = vis.buffer?.ease; if (ez && wall < ez.at + ez.ms) misEasing++; else misPlain++; } }
    if (vis.buffer && pubs[i].v.observedAtMs + shift > wall - PLAYBACK.maxDelayMs) { const dl = (wall - (vis.buffer.represented ?? vis.buffer.shown)) / 1000; delays.push(dl); if (dl > 75) lateFrames.push(wall); }
    if (prev) { const st = metres(prev, vis); steps.push(st); if (st > 0.05) moving++;
      // A step over a bus length is a repositioning, and must have been said on that frame.
      if (st > 12 && !(vis.lastCorrection?.kind === 'snap' && wall - vis.lastCorrection.at <= 200)) unsaidSteps.push({at: wall - start, metres: Math.round(st)}); }
    if (vis.lastCorrection?.kind === 'snap' && (!snaps.length || snaps.at(-1).at !== vis.lastCorrection.at))
      snaps.push({at: vis.lastCorrection.at, metres: Math.round(vis.lastCorrection.metres), why: vis.lastCorrection.why ?? 'unsaid'});
    if (road && vis.buffer?.onRoad) { onRoadFrames++; off.push(project(road, vis).offset); }
    if (road && project(road, vis).offset <= 10) { if (vis.buffer?.onRoad === false) offLabelOnRoad++; if (vis.bearing === null) nullOnRoad++; }
    if (prev && !said && metres(prev, vis) < 0.05 && prev.bearing !== null && vis.bearing !== null) {
      if (!still.length) still.push({wall: wall - 100, bearing: prev.bearing});
      still.push({wall, bearing: vis.bearing});
      while (still[0].wall < wall - 5000) still.shift();
      for (const b of still) standTurnMax = Math.max(standTurnMax, Math.abs(turnOf(b.bearing, vis.bearing)));
    } else still = [];
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
    snaps: snaps.length, unsaid: unsaid + unsaidSteps.length, unsaidSteps: unsaidSteps.slice(0, 3), snapList: snaps.slice(0, 4), snapAll: snaps,
    headingOffP95: q(headingOff, .95), misalignedLongestS: misLongest / 10, misEasing, misPlain, spinMax: Math.max(0, ...spins), nullHeadingFrames: nullAfterKnown,
    delayP50: q(delays, .5), delayMax: delays.length ? Math.max(...delays) : null,
    // Frames drawn over 75 s behind, and how many of them fall in the 15 s before a repositioning (a bus waiting at
    // an old report to be moved on, whose drawn place is that old): the rest would be a bus drawn behind while going.
    delayOver75Frames: lateFrames.length, delayOver75BeforeSnap: lateFrames.filter(w => snaps.some(sn => sn.at >= w && sn.at - w <= 15_000)).length,
    offLabelOnRoad, nullOnRoad, standTurnMax,
    ...(osm ? {osm: {frames: drawnRoad.length, over10: drawnRoad.filter(m => m > 10).length, over20: drawnRoad.filter(m => m > 20).length,
      inside: drawnInside.reduce((a, b) => a + b, 0), drawnP95: q(drawnRoad, .95), drawnMax: worstDrawn.m, worst: worstDrawn,
      reportsOver10: reportRoad.filter(m => m > 10).length, reports: reportRoad.length, reportP95: q(reportRoad, .95),
      streetShare: !road && streets ? streetFrames / frames : null, insideAt}} : {})});
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
  snapsByReason: results.flatMap(r => r.snapAll).reduce((a, s) => ({...a, [s.why]: (a[s.why] ?? 0) + 1}), {}),
  stoodWholeWindow: results.filter(r => r.movingShare < 0.05 && r.reportsMoved < 50).length,
  headingOffP95Median: q(results.map(r => r.headingOffP95 ?? 0), .5), headingOffP95P90: q(results.map(r => r.headingOffP95 ?? 0), .9),
  misalignedOver1_5s: results.filter(r => r.misalignedLongestS > 1.5).length, spinOver10: results.filter(r => r.spinMax > 10).length,
  misalignedFramesEasing: results.reduce((a, r) => a + r.misEasing, 0), misalignedFramesPlain: results.reduce((a, r) => a + r.misPlain, 0),
  nullHeadingBuses: results.filter(r => r.nullHeadingFrames > 0).length,
  offLabelOnRoadBuses: results.filter(r => r.offLabelOnRoad > 0).length, nullOnRoadBuses: results.filter(r => r.nullOnRoad > 0).length,
  standTurnOver20: results.filter(r => r.standTurnMax > 20).length,
  delayP50Median: q(results.map(r => r.delayP50 ?? 0).filter(Boolean), .5), delayMaxMax: Math.max(0, ...results.map(r => r.delayMax ?? 0)),
  delayOver75: results.filter(r => (r.delayMax ?? 0) > 75).length,
  delayOver75NotBeforeSnap: results.filter(r => r.delayOver75Frames - r.delayOver75BeforeSnap > 0).length,
  drawnStandingWhileReportsMoved: results.filter(r => r.movingShare < 0.2 && r.reportsMoved > 150).length,
};
// Bounds the drawing is held to: a step over a bus length is a repositioning (and must be said);
// speeds above PACE.maxMps and accelerations above the brake bound are the follower's own faults.
const outliers = results.filter(r => r.unsaid > 0 || r.misalignedLongestS > 1.5 || r.spinMax > 10 || (r.delayMax ?? 0) > 75 || r.speedMax > PACE.maxMps + 0.5 || (r.offRoadP95 !== null && r.offRoadP95 > 5) || (r.movingShare < 0.2 && r.reportsMoved > 150))
  .sort((a, b) => b.stepMax - a.stepMax);
// The buses drawn furthest from the road they are said to be on, whatever their 95th percentile:
// a single moment off the road is a moment a passenger can see.
// The buses that turned most while drawn standing, and those called off a road they were drawn on.
const standTurners = results.filter(r => r.standTurnMax > 20).sort((a, b) => b.standTurnMax - a.standTurnMax).slice(0, 12)
  .map(r => ({key: r.key, road: r.road, standTurnMax: Math.round(r.standTurnMax), movingShare: +r.movingShare.toFixed(2)}));
const offLabelled = results.filter(r => r.offLabelOnRoad > 0).sort((a, b) => b.offLabelOnRoad - a.offLabelOnRoad).slice(0, 12)
  .map(r => ({key: r.key, frames: r.offLabelOnRoad, of: r.frames, onRoadShare: +(r.onRoadShare ?? 0).toFixed(2)}));
const furthestOffRoad = results.filter(r => r.offRoadMax !== null).sort((a, b) => b.offRoadMax - a.offRoadMax).slice(0, 5)
  .map(r => ({key: r.key, offRoadMax: +r.offRoadMax.toFixed(1), offRoadP95: +(r.offRoadP95 ?? 0).toFixed(1), snaps: r.snapList}));
// Against the map, the fleet's drawn frames and reports, split by whether the bus has a checked road.
const osmSummary = osm ? (() => {
  const part = rs => { const f = rs.reduce((a, r) => a + r.osm.frames, 0), rep = rs.reduce((a, r) => a + r.osm.reports, 0);
    const share = (k) => f ? +(rs.reduce((a, r) => a + r.osm[k], 0) / f).toFixed(4) : null;
    return {buses: rs.length, frames: f, drawnOver10m: share('over10'), drawnOver20m: share('over20'), drawnInsideBuilding: share('inside'),
      busesEverOver20m: rs.filter(r => r.osm.over20 > 0).length, busesEverInside: rs.filter(r => r.osm.inside > 0).length,
      reports: rep, reportsOver10m: rep ? +(rs.reduce((a, r) => a + r.osm.reportsOver10, 0) / rep).toFixed(4) : null};
  };
  const measured = results.filter(r => r.osm);
  // Where buses are drawn inside a building, by place (about 10 m cells): the few places that account for most.
  const spots = {};
  for (const r of results) for (const [la, lo, h, m] of r.osm?.insideAt ?? []) { const k = `${la},${lo}`; (spots[k] ??= {n: 0, h, road: m, buses: new Set()}).n++; spots[k].buses.add(r.key); }
  const insideSpots = Object.entries(spots).sort((a, b) => b[1].n - a[1].n).slice(0, 12).map(([k, v]) => ({at: k, samples: v.n, height: v.h, roadMetres: v.road, buses: v.buses.size}));
  return {map: `OpenFreeMap ${osm.version}`, streets: !!streets, insideSpots,
    onStreetShare: streets ? +(measured.filter(r => !r.road).reduce((a, r) => a + (r.osm.streetShare ?? 0) * r.frames, 0)
      / Math.max(1, measured.filter(r => !r.road).reduce((a, r) => a + r.frames, 0))).toFixed(4) : null,
    all: part(measured), checkedRoad: part(measured.filter(r => r.road)), noCheckedRoad: part(measured.filter(r => !r.road)),
    worst: measured.sort((a, b) => b.osm.drawnMax - a.osm.drawnMax).slice(0, top).map(r => ({key: r.key, road: r.road,
      drawnMax: +r.osm.drawnMax.toFixed(1), drawnP95: +(r.osm.drawnP95 ?? 0).toFixed(1), over20: r.osm.over20, inside: r.osm.inside, frames: r.osm.frames,
      reportP95: +(r.osm.reportP95 ?? 0).toFixed(1), worst: r.osm.worst}))};
})() : undefined;
console.log(JSON.stringify({reel: reelPath, publications: reel.publications.length, minPubs, fleet, osm: osmSummary, standTurners, offLabelled, furthestOffRoad,
  outliers: outliers.slice(0, top), slowest: results.filter(r => r.reportsMoved > 150).sort((a, b) => a.movingShare - b.movingShare).slice(0, top).map(r => ({key: r.key, movingShare: +r.movingShare.toFixed(2), reports: r.reports, reportsMoved: r.reportsMoved, road: r.road, snaps: r.snaps}))}, null, 1));
