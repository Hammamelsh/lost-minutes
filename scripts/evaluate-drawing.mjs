// How the page draws estimated movement, measured over captured journeys: how smooth it is, and how
// close to where the bus really was. The page's frame loop is run offline at 10 frames a second,
// polling every 10 s and holding the latest report with up to six before it, as it does live. The
// estimate is the published, frozen one and is the same for every variant; only how the drawn bus
// follows it differs, so nothing here changes an evaluated error of the estimate.
//
// Three positions are kept apart at every frame: the last report the page had, the estimate made
// from the reports available by then, and the position actually drawn. Each report is then held out
// from what came before it: at the moment the bus made it, how far along the road from it was each
// of the three, when none of them could have known it yet? Display lag is how long after the bus
// reached a reported point the drawn bus (or the estimate, or the last report) reached it.
// None of this is GPS accuracy. The reports carry the vehicles' own GPS error, in every figure
// alike; the published road shapes put 95% of reports within 11–14 m of the road on these routes.
//
// What a passenger sees as twitching is counted too: steps in the drawn speed (over 1 m/s within a
// tenth of a second), hard speed changes (over 4 m/s²), reversing, and how far the drawn bus strays
// from the estimate. And what smoothing must not do: stand still while the bus's own reports show it
// moving (a stop that did not happen), or keep travelling once the estimate has stopped (a report too
// old, or past the horizon).
//
// node --experimental-strip-types --import ./tests/alias-loader.mjs scripts/evaluate-drawing.mjs \
//   --reports data/evaluation/motion-reports-fresh.json --label fresh-2026-09-13-evening \
//   [--before /tmp/motion-before.mts]      # an earlier lib/motion.ts, e.g. from `git show ad0c1cd:lib/motion.ts`
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import * as NOW from '../lib/motion.ts';
import {fixesOf, loadTracks} from './motion-scoring.mjs';

const arg = (name, fallback = null) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const reportsFile = arg('reports');
if (!reportsFile) { console.error('usage: evaluate-drawing.mjs --reports <file> [--label name] [--before module] [--out file]'); process.exit(2); }
const label = arg('label', 'drawing');
const out = arg('out', `data/evaluation/drawing-${label}.json`);
const data = JSON.parse(readFileSync(reportsFile, 'utf8'));
const model = JSON.parse(readFileSync('public/data/motion-evaluation.json', 'utf8'));
const {tracks} = loadTracks('public/data/shapes');
const settings = M => { const p = {...M.DEFAULT_PARAMS}; for (const [k, v] of Object.entries(model.params)) if (k in p && typeof v === typeof p[k]) p[k] = v; return p; };
const params = settings(NOW), profile = model.errorProfile;

// Each variant: how to step the drawn bus for one frame.
const variants = {
 'drawn now (DRAWING: hold within the measured error, waiting at a crawl)': (v, e, t, track) => NOW.stepVisual(v, e, t, track, NOW.drawingFor(e, profile)),
 // While waiting for the estimate: standing still (as drawn before the crawl), or a slower crawl.
 'the same standing still while it waits': (v, e, t, track) => NOW.stepVisual(v, e, t, track, {...NOW.drawingFor(e, profile), crawl: 0}),
 'the same at a 30% crawl': (v, e, t, track) => NOW.stepVisual(v, e, t, track, {...NOW.drawingFor(e, profile), crawl: 0.3}),
 'the same with only the fixed 35 m hold': (v, e, t, track) => NOW.stepVisual(v, e, t, track, NOW.DRAWING),
};
const before = arg('before');
if (before) {
 const B = await import(pathToFileURL(resolve(before)).href), p = settings(B);
 variants[`before (${before})`] = (v, e, t, track) => B.stepVisual(v, e, t, track, p);
}
const SERIES = [...Object.keys(variants), 'the estimate', 'the last report'];

const FPS = 10, POLL = 10_000, DT = 1000 / FPS;
const NEAR_STOP = 50, LAG_WINDOW = 120_000, STAND_FRAMES = 30, MOVED = 30;
const tally = Object.fromEntries(Object.keys(variants).map(k => [k, {frames: 0, steps: 0, hard: 0, back: 0, backMetres: 0,
 snaps: 0, stray: [], speed: [], staleEligible: 0, staleMoving: 0, stands: 0, contradicted: 0}]));
const fidelity = Object.fromEntries(SERIES.map(k => [k, {error: [], signed: [], near: [], between: [], lag: [], ahead: 0, never: 0}]));
let used = 0, heldOut = 0;
const lastAtOrBefore = (times, t) => { let lo = 0, hi = times.length - 1, best = -1; while (lo <= hi) { const mid = (lo + hi) >> 1; if (times[mid] <= t) { best = mid; lo = mid + 1; } else hi = mid - 1; } return best; };

for (const sequence of data.sequences) {
 const fixes = fixesOf(sequence);
 if (fixes.length < 2 || !fixes.some(f => f.pattern && tracks.has(f.pattern))) continue;
 used++;
 const start = fixes[0].availableAt, end = fixes.at(-1).availableAt + 25_000;
 const state = Object.fromEntries(Object.keys(variants).map(k => [k, {v: null, s: null, speed: null, stepping: false, standFrom: null, standFrames: 0}]));
 // Per frame: time, the pattern the page held, and each series' place along the road (null where none).
 const frames = {t: [], pattern: [], series: Object.fromEntries(SERIES.map(k => [k, []]))};
 const stands = Object.fromEntries(Object.keys(variants).map(k => [k, []]));
 let polled = start, known = [];
 for (let k = 0, now = start; now <= end; k++, now = start + k * DT) {
  if (now >= polled) { known = fixes.filter(f => f.availableAt <= now); polled += POLL; }
  if (!known.length) continue;
  const latest = known.at(-1), track = latest.pattern ? tracks.get(latest.pattern) ?? null : null;
  const history = NOW.historyFrom(known.slice(-7));
  const e = track ? NOW.estimate(history, track, now, params) : NOW.observedAt(history, now, 'no accepted road geometry');
  const along = point => track ? NOW.project(track, point, frames.series['the last report'].at(-1) ?? undefined).s : null;
  frames.t.push(now); frames.pattern.push(track ? latest.pattern : null);
  frames.series['the estimate'].push(e.mode === 'estimated' ? e.s : null);
  frames.series['the last report'].push(along(latest));
  // Stopped (too old, no speed) or held at the horizon: the drawn bus must not travel on.
  const halted = e.mode !== 'estimated' || e.capped;
  for (const [name, step] of Object.entries(variants)) {
   const st = state[name], a = tally[name], previous = st.v;
   st.v = step(previous, e, now, e.mode === 'estimated' ? track : null);
   frames.series[name].push(st.v.mode === 'estimated' && st.v.s !== null ? st.v.s : along(st.v));
   const snapped = st.v.lastCorrection?.kind === 'snap' && st.v.lastCorrection.at === now;
   if (snapped) a.snaps++;
   if (e.mode !== 'estimated' || st.v.mode !== 'estimated' || snapped || st.s === null || previous?.trackId !== st.v.trackId) {
    st.s = st.v.mode === 'estimated' ? st.v.s : null; st.speed = null; st.standFrom = null; st.standFrames = 0;
    if (halted) a.staleEligible++;
    continue;
   }
   const speed = (st.v.s - st.s) / (DT / 1000);
   a.frames++;
   if (halted) { a.staleEligible++; if (speed > 0.5) a.staleMoving++; }
   if (speed < -0.1) { a.back++; a.backMetres += -speed * DT / 1000; }
   if (k % 3 === 0) { a.stray.push(Math.abs(st.v.s - e.s)); a.speed.push(speed); }
   if (st.speed !== null) {
    const change = Math.abs(speed - st.speed) / (DT / 1000);
    if (change > 4) a.hard++;
    if (change > 10 && !st.stepping) a.steps++;
    st.stepping = change > 10;
   }
   // Runs of the drawn bus standing still, to be checked against the reports around them.
   if (Math.abs(speed) < 0.3) { st.standFrom ??= now; st.standFrames++; }
   else { if (st.standFrames >= STAND_FRAMES) stands[name].push([st.standFrom, now, latest.pattern]); st.standFrom = null; st.standFrames = 0; }
   st.s = st.v.s; st.speed = speed;
  }
 }
 // A drawn stand contradicted by the reports: the bus's own reports from just before to just after
 // it span at least 30 m of road.
 for (const [name, runs] of Object.entries(stands)) for (const [from, to, pattern] of runs) {
  const track = tracks.get(pattern);
  const around = fixes.filter(f => f.pattern === pattern && f.at >= from - 5000 && f.at <= to + 5000).map(f => NOW.project(track, f).s);
  tally[name].stands++;
  if (around.length >= 2 && Math.max(...around) - Math.min(...around) >= MOVED) tally[name].contradicted++;
 }
 // Held out: each report against what the page showed at the moment the bus made it. The page
 // could not have had it then: a report reaches the page only after it is made.
 for (const fix of fixes) {
  const track = fix.pattern ? tracks.get(fix.pattern) : null;
  if (!track) continue;
  const i = lastAtOrBefore(frames.t, fix.at);
  if (i < 0 || fix.at - frames.t[i] > DT || frames.pattern[i] !== fix.pattern || fix.availableAt <= frames.t[i]) continue;
  heldOut++;
  const truth = NOW.project(track, fix, frames.series['the last report'][i] ?? undefined).s;
  const nearStop = track.stops.some(s => Math.abs(s - truth) <= NEAR_STOP);
  const from = Math.max(0, lastAtOrBefore(frames.t, frames.t[i] - LAG_WINDOW)), to = lastAtOrBefore(frames.t, frames.t[i] + LAG_WINDOW);
  for (const name of SERIES) {
   const series = frames.series[name], x = series[i];
   if (x === null || x === undefined) continue;
   const f = fidelity[name];
   f.error.push(Math.abs(x - truth)); f.signed.push(x - truth);
   (nearStop ? f.near : f.between).push(Math.abs(x - truth));
   // When did this series first reach the reported point? Before the bus did is a lead.
   if (series[from] !== null && series[from] >= truth) { f.ahead++; continue; }
   let reached = null;
   for (let j = from; j <= to; j++) if (series[j] !== null && series[j] >= truth) { reached = j; break; }
   if (reached === null) f.never++; else f.lag.push((frames.t[reached] - frames.t[i]) / 1000);
  }
 }
}

const q = (values, p) => { const s = Float64Array.from(values).sort(); return s.length ? +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(1) : null; };
const result = {schemaVersion: 2, generatedAt: new Date().toISOString(), reports: reportsFile, label, journeys: used,
 heldOutReports: heldOut, model: model.version, framesPerSecond: FPS, pollSeconds: POLL / 1000, drawing: NOW.DRAWING,
 fidelityBasis: 'each report against the position each series showed when the bus made it, before the page could have received it; '
  + 'along the road; not GPS accuracy (the reports carry the vehicles\' GPS error in every figure alike)',
 fidelity: {}, variants: {}};
for (const [name, f] of Object.entries(fidelity)) {
 const reached = f.lag.length + f.ahead + f.never;
 result.fidelity[name] = {n: f.error.length, errorMetres: {p50: q(f.error, 0.5), p80: q(f.error, 0.8), p95: q(f.error, 0.95)},
  signedMedianMetres: q(f.signed, 0.5), nearStop: {n: f.near.length, p50: q(f.near, 0.5), p80: q(f.near, 0.8)},
  betweenStops: {n: f.between.length, p50: q(f.between, 0.5), p80: q(f.between, 0.8)},
  lagSeconds: {p50: q(f.lag, 0.5), p80: q(f.lag, 0.8)}, aheadShare: reached ? +(f.ahead / reached).toFixed(3) : null,
  neverWithinTwoMinutesShare: reached ? +(f.never / reached).toFixed(3) : null};
}
for (const [name, a] of Object.entries(tally)) {
 const hours = a.frames / FPS / 3600;
 result.variants[name] = {hoursDrawn: +hours.toFixed(2), speedStepsPerHour: +(a.steps / hours).toFixed(1),
  hardChangeShare: +(a.hard / a.frames).toFixed(4), reversingShare: +(a.back / a.frames).toFixed(4),
  reversedMetresPerHour: Math.round(a.backMetres / hours), snapsPerHour: +(a.snaps / hours).toFixed(1),
  speed: {p50: q(a.speed, 0.5), p95: q(a.speed, 0.95), p99: q(a.speed, 0.99)},
  strayFromEstimate: {p50: q(a.stray, 0.5), p80: q(a.stray, 0.8), p95: q(a.stray, 0.95)},
  travellingWhileHaltedShare: a.staleEligible ? +(a.staleMoving / a.staleEligible).toFixed(4) : null,
  standsOfThreeSecondsPerHour: +(a.stands / hours).toFixed(1),
  standsTheReportsContradictPerHour: +(a.contradicted / hours).toFixed(1)};
}
mkdirSync(dirname(out), {recursive: true});
writeFileSync(out, JSON.stringify(result, null, 1));
console.log(`${used} journeys, ${heldOut} held-out reports (${result.fidelityBasis})`);
for (const [name, f] of Object.entries(result.fidelity))
 console.log(`  ${name}: error p50 ${f.errorMetres.p50} p80 ${f.errorMetres.p80} p95 ${f.errorMetres.p95} m (signed median ${f.signedMedianMetres});`
  + ` near a stop p50 ${f.nearStop.p50} (n ${f.nearStop.n}), between p50 ${f.betweenStops.p50}; lag p50 ${f.lagSeconds.p50} s p80 ${f.lagSeconds.p80} s;`
  + ` ahead ${f.aheadShare}, not within 2 min ${f.neverWithinTwoMinutesShare}`);
for (const [name, r] of Object.entries(result.variants))
 console.log(`${name}: ${r.hoursDrawn} h drawn; speed steps ${r.speedStepsPerHour}/h; hard changes ${(r.hardChangeShare * 100).toFixed(1)}%;`
  + ` reversing ${(r.reversingShare * 100).toFixed(1)}% (${r.reversedMetresPerHour} m/h); snaps ${r.snapsPerHour}/h;`
  + ` stray p50 ${r.strayFromEstimate.p50} p80 ${r.strayFromEstimate.p80} p95 ${r.strayFromEstimate.p95} m;`
  + ` travelling while halted ${(r.travellingWhileHaltedShare * 100).toFixed(2)}%; stands contradicted by reports ${r.standsTheReportsContradictPerHour}/h of ${r.standsOfThreeSecondsPerHour}/h`);
console.log(`written to ${out}`);
