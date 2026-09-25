/**
 * Every bus in a reel, ridden as the ride-along draws it, with what goes wrong told apart by cause —
 * never one "clean ride" figure (the owner's instruction of 25 September 2026):
 *
 *   A. the drawing's or camera's own faults: a step over a bus length with nothing said; facing over
 *      30° off where it should face (its body along its road, or its line) for more than 1.5 s while
 *      moving; turning over 10° in one frame; turning over 20° within 5 s while still (under
 *      0.1 m/s); drawn more than 5 m off a checked road its reports are on, outside an eased
 *      correction; standing
 *      10 s or more while its reports moved on; a sprint (over 1.25 × and 3 m/s above the speed its own
 *      reports show round that moment, for 3 s or more); no heading on a checked road; over 22 m/s.
 *   B. the bus's own stops: standing 10 s or more where its reports stood too.
 *   C. missing or uncertain data, handled by the intended fallback: a repositioning said over a gap,
 *      a late path change or a pause of the page; turning round on a straight line between two reports
 *      with no checked road under it (the way it turned is not known); waiting at the newest report for a late one; drawn
 *      over 75 s behind; a contradicted report held; drawn off its road where its reports are off
 *      it (or it has none); no heading with no road, no bearing and no movement yet.
 *
 * The camera is not simulated here: it follows the drawn bus and turns at most 120° a second, so its
 * faults are the drawing's (a cut at a said repositioning is intended). The renderer probe measures it.
 *
 *   node --experimental-strip-types --import ./tests/alias-loader.mjs scripts/evaluate-ride-faults.mjs \
 *     --reel data/evaluation/reel-live-evening.json [--evaluated playback|estimate] [--meet 0.5] [--routes 15,250,256]
 */
import {readFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import * as motion from '@/lib/motion';
const {historyFrom, observedAt, estimate, stepVisual, drawingFor, makeTrack, decodePolyline, project, DEFAULT_PARAMS} = motion;

const arg = (k, d) => {const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d};
const reelPath = arg('reel', 'data/evaluation/reel-live-evening.json');
const evaluatedAs = arg('evaluated', 'playback');
const meet = Number(arg('meet', 0)), pollMs = 20_000, minPubs = Number(arg('min-publications', 6));
const routes = arg('routes', null)?.split(',') ?? null;
const reel = JSON.parse(readFileSync(reelPath, 'utf8'));
const index = JSON.parse(readFileSync('public/data/shapes/index.json', 'utf8')).patterns;
const evaluation = JSON.parse(readFileSync('public/data/motion-evaluation.json', 'utf8'));
const params = {...DEFAULT_PARAMS};
for (const [k, v] of Object.entries(evaluation.params ?? {})) if (k in params && typeof v === typeof params[k]) params[k] = v;
const scored = new Set(evaluation.corridor.patterns);
const tracks = new Map();
const trackFor = id => {
  if (!id || index[id]?.status !== 'accepted') return null;
  if (!tracks.has(id)) {
    const file = join('public/data/shapes', index[id].file);
    tracks.set(id, existsSync(file) ? (() => {const s = JSON.parse(readFileSync(file, 'utf8')); return makeTrack(id, decodePolyline(s.polyline6, 6), s.stopOffsets ?? [])})() : null);
  }
  return tracks.get(id);
};
const metres = (a, b) => Math.hypot((b.lat - a.lat) * 111195, (b.lon - a.lon) * 111195 * Math.cos(a.lat * Math.PI / 180));
const turnOf = (a, b) => ((b - a) % 360 + 540) % 360 - 180;

const byJourney = new Map();
for (const p of reel.publications) for (const v of p.live.vehicles ?? []) {
  if (routes && !routes.includes(v.route)) continue;
  const key = `${v.operator}|${v.vehicle}|${v.route}|${v.direction}|${v.journeyRef}`;
  if (!byJourney.has(key)) byJourney.set(key, []);
  byJourney.get(key).push({receivedAtMs: p.receivedAtMs, v});
}

const KINDS = {
  A: ['unsaid_step', 'facing_off', 'spin', 'turns_standing', 'off_road_on_its_road', 'stalls', 'sprint', 'no_heading_on_road', 'over_speed'],
  B: ['stops'],
  C: ['repositioned', 'waits_for_report', 'late', 'held_report', 'off_road_reports_off', 'no_heading_unknown', 'turning_unknown_path'],
};
const tally = {rides: 0, minutes: 0, events: {}, ridesWith: {}, groupRides: {A: 0, B: 0, C: 0}, examples: []};
for (const kinds of Object.values(KINDS)) for (const k of kinds) { tally.events[k] = 0; tally.ridesWith[k] = 0; }

for (const [key, pubs] of byJourney) {
  if (pubs.length < minPubs) continue;
  const patternId = pubs.at(-1).v.match?.patternId ?? null, road = trackFor(patternId);
  const estimated = evaluatedAs === 'estimate' && road && scored.has(patternId);
  const t0 = pubs[0].receivedAtMs;
  const startAt = Math.floor(meet * pubs.length);
  const events = {};
  const add = (kind, detail) => { events[kind] = (events[kind] ?? 0) + 1; if ((KINDS.A.includes(kind) && tally.examples.length < 40) || kind === arg('show', '')) tally.examples.push({key, kind, ...detail}); };
  let vis = null, i = -1, prev = null, frames = 0, mis = 0, stand = null, sprint = 0, lastSnapAt = null, lastHeld = 0, heldSeen = new Set();
  let still = [], turnedStill = false;
  const end = pubs.at(-1).receivedAtMs + 20_000;
  for (let wall = t0; wall <= end; wall += 100) {
    const visibleAt = t0 + Math.floor((wall - t0) / pollMs) * pollMs;
    while (i + 1 < pubs.length && pubs[i + 1].receivedAtMs + 2500 <= visibleAt) i++;
    if (i < startAt) continue;
    const v = pubs[i].v;
    const fixes = (v.trail ?? []).map(t => ({at: v.observedAtMs - t[0], lat: t[1], lon: t[2], bearing: t[3], service: 's', source: 'h'}));
    fixes.push({at: v.observedAtMs, lat: v.lat, lon: v.lon, bearing: v.bearing, availableAt: v.retrievedAtMs ?? null, service: 's', source: 'h'});
    const h = historyFrom(fixes);
    const e = estimated ? estimate(h, road, wall, params) : observedAt(h, wall, 'ride');
    vis = stepVisual(vis, e, wall, e.mode === 'estimated' ? road : null, drawingFor(e, evaluation.errorProfile ?? null), h, road);
    frames++;
    const b = vis.buffer;
    const said = vis.lastCorrection?.kind === 'snap' && vis.lastCorrection.at === wall;
    if (said && lastSnapAt !== wall) { add('repositioned', {why: vis.lastCorrection.why}); lastSnapAt = wall; }
    // Held reports: counted once each, by the report's time.
    if (b?.path?.held) { const newest = fixes.at(-1).at; if (b.path.held > lastHeld && !heldSeen.has(newest)) { heldSeen.add(newest); add('held_report'); } lastHeld = b.path.held; }
    const offset = road ? project(road, vis).offset : null;
    if (b && road) {
      // An eased correction across to the road (a lone report drawn where it was made, then measured
      // onto its road) is said and deliberate; off the road otherwise, with its reports on it, is a fault.
      const easing = b.ease && wall < b.ease.at + b.ease.ms;
      if (b.onRoad && offset > 5 && !easing) add('off_road_on_its_road', {offset: +offset.toFixed(1), at: wall - t0});
      if (b.onRoad === false && frames % 50 === 0) add('off_road_reports_off');
    }
    if (vis.bearing == null) {
      if (road && offset !== null && offset <= 10) { if (frames % 50 === 0) add('no_heading_on_road', {at: wall - t0}); }
      else if (frames % 50 === 0) add('no_heading_unknown');
    }
    // Late only while its reports are still coming: after a journey's last report the delay grows
    // by definition, and that is the end of the ride, not lateness.
    if (b && wall - fixes.at(-1).at < 90_000 && (wall - (b.represented ?? b.shown)) / 1000 > 75 && frames % 50 === 0) add('late', {at: wall - t0, delay: Math.round((wall - (b.represented ?? b.shown)) / 1000), clockDelay: Math.round((wall - b.shown) / 1000), gap: Math.round(b.goalS - b.sd)});
    if ((vis.velocity ?? 0) > 22.5 && frames % 10 === 0) add('over_speed', {at: wall - t0});
    if (prev) {
      const step = metres(prev, vis);
      if (step > 12 && !said) add('unsaid_step', {metres: Math.round(step), at: wall - t0});
      if (prev.bearing != null && vis.bearing != null && !said && Math.abs(turnOf(prev.bearing, vis.bearing)) > 10) add('spin', {at: wall - t0});
      // Facing: against where the drawing says the bus should face at that place (its body along its
      // road, or the line it travels), which the heading turns towards at a bus's rate. At a sharp
      // corner of the road's line a bus's body is rightly turned part way through; what is wrong is
      // the heading lagging that for more than 1.5 s while the bus moves.
      if (step >= 0.05 && vis.bearing != null && vis.heading != null && !said) {
        mis = Math.abs(turnOf(vis.bearing, vis.heading)) > 30 ? mis + 0.1 : 0;
        // On a straight line between two reports with no checked road under it, a bus that turned
        // round between them (a terminus loop) did so on a route nobody knows: that is uncertain data.
        if (Math.abs(mis - 1.6) < 0.05) add(b && b.onRoad === false ? 'turning_unknown_path' : 'facing_off', {at: wall - t0, off: Math.round(turnOf(vis.bearing, vis.heading))});
      }
      // Turning while standing still.
      if (step < 0.01 && !said && prev.bearing != null && vis.bearing != null) {
        if (!still.length) still.push({wall: wall - 100, b: prev.bearing});
        still.push({wall, b: vis.bearing});
        while (still[0].wall < wall - 5000) still.shift();
        if (!turnedStill && still.some(s => Math.abs(turnOf(s.b, vis.bearing)) > 20)) { add('turns_standing', {at: wall - t0}); turnedStill = true; }
      } else { still = []; turnedStill = false; }
      // Standing: classified when it ends, by what the reports did over the moments it stood for.
      // Standing: judged by where the reports put the bus at the moments shown while it stood (the
      // clock's goal). If that place moved on while the drawn bus stood, the drawing stalled; if it
      // too stood, the bus stopped; if the drawing stood at the end of the reports it had, it waited.
      // (A path rebuilt mid-stand re-bases distances along it, so the goal is compared on the map.)
      const goalPlace = b ? {lat: vis.lat, lon: vis.lon, ahead: b.goalS - b.sd} : null;
      // Waiting means the drawing reached the newest report while the reports had the bus moving
      // there (its last two over 25 m apart); a bus whose reports stood there has stopped.
      const movingAtNewest = fixes.length > 1 && metres(fixes.at(-2), fixes.at(-1)) >= 25;
      if (step < 0.02) { stand ??= {from: wall, atEnd: false, maxAhead: 0}; stand.to = wall; stand.atEnd ||= b ? b.sd >= b.end - 0.5 && movingAtNewest : false;
        if (goalPlace) stand.maxAhead = Math.max(stand.maxAhead, goalPlace.ahead); }
      else if (stand) {
        if (stand.to - stand.from >= 10_000) {
          if (stand.maxAhead < 25) add(stand.atEnd ? 'waits_for_report' : 'stops');
          else add('stalls', {seconds: Math.round((stand.to - stand.from) / 1000), ahead: Math.round(stand.maxAhead), at: stand.from - t0});
        }
        stand = null;
      }
      // Sprint: faster than any stretch of its own reports the place shown can stand for. The place
      // shown is the path's average over the previous 24 s (PACE.smoothMs), so every report pair
      // overlapping that window, and a little after it, counts.
      if (b) {
        const rep = b.represented ?? b.shown;
        let reportSpeed = 0, pairs = 0;
        for (let k = 1; k < fixes.length; k++) {
          if (fixes[k].at < rep - 40_000 || fixes[k - 1].at > rep + 15_000) continue;
          pairs++;
          // Along its checked road where both reports are on it: the straight line under-reads a
          // curving road (a 135 read 6.8 m/s where the road says 9).
          let d = metres(fixes[k - 1], fixes[k]);
          if (road) { const a = project(road, fixes[k - 1]), c = project(road, fixes[k], a.s);
            if (a.offset < 40 && c.offset < 40) d = Math.max(d, Math.abs(c.s - a.s)); }
          reportSpeed = Math.max(reportSpeed, d / Math.max(1, (fixes[k].at - fixes[k - 1].at) / 1000));
        }
        const v10 = step * 10;
        sprint = pairs && v10 > Math.max(1.25 * reportSpeed, reportSpeed + 3) ? sprint + 0.1 : 0;
        if (Math.abs(sprint - 3.0) < 0.05) add('sprint', {speed: +v10.toFixed(1), reports: +reportSpeed.toFixed(1), at: wall - t0});
      }
    }
    prev = {lat: vis.lat, lon: vis.lon, bearing: vis.bearing};
  }
  if (frames < 50) continue;
  tally.rides++; tally.minutes += frames / 600;
  for (const [k, n] of Object.entries(events)) { tally.events[k] += n; tally.ridesWith[k]++; }
  for (const [group, kinds] of Object.entries(KINDS)) if (kinds.some(k => events[k])) tally.groupRides[group]++;
}
const perHour = n => +(n / (tally.minutes / 60)).toFixed(2);
// Events of the "off its road where its reports are off", "late" and "no heading" kinds are counted
// in 5 s units of time, the others one per occurrence.
const out = {reel: reelPath, evaluatedAs, meet, routes, rides: tally.rides, hours: +(tally.minutes / 60).toFixed(1), groups: {}};
for (const [group, kinds] of Object.entries(KINDS)) {
  out.groups[group] = Object.fromEntries(kinds.map(k => [k, {rides: tally.ridesWith[k], events: tally.events[k], perHour: perHour(tally.events[k])}]));
  out.groups[group].ridesWithAny = tally.groupRides[group];
}
out.examplesA = arg('show', '') ? tally.examples.filter(x => x.kind === arg('show', '')) : tally.examples.slice(0, 20);
console.log(JSON.stringify(out, null, 1));
