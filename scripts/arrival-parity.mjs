// The page's arrival estimator (lib/arrival.ts) held to the evaluated one (scripts/evaluate-arrival.py)
// on the same retained reports, catalogue, road and moments: every answer compared, every refusal
// compared, from the file scripts/arrival-parity-cases.py writes.
//
//   node --experimental-strip-types --import ./tests/alias-loader.mjs scripts/arrival-parity.mjs \
//     --cases cases.json [--deployed <an older lib/arrival.ts to measure too>]
//
// Three readings of each moment:
//   full     every report of the journey at or before the moment, as the evaluator reads them;
//   window   only the reports of the last 180 s, which is all the page holds when it gives minutes
//            (lib/arrival.ts, JourneyHistory): the answer must not change;
//   deployed (with --deployed) the estimator as it was served, on the reports a publication carries
//            (the latest and six earlier within 240 s), to say how far it had been from the evaluation.
//            It places every report again for each question, so it is asked at every 50th moment only.
import {readFileSync} from 'node:fs';
import {ARRIVAL_MODEL, ARRIVAL_PARAMS, arrivalTrack, blendedEta, cruiseFor, placeReports} from '@/lib/arrival';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const cases = JSON.parse(readFileSync(arg('cases'), 'utf8'));
const index = JSON.parse(readFileSync('public/data/shapes/index.json', 'utf8'));
const shape = JSON.parse(readFileSync(`public/data/shapes/${index.patterns[cases.pattern].file}`, 'utf8'));
const track = arrivalTrack(shape.polyline6, shape.stopMapping, {id: cases.pattern, stops: cases.patternStops});
if (!track) throw new Error('the page could not build the road');

const summary = {pattern: cases.pattern, model: {evaluated: cases.model, page: ARRIVAL_MODEL, same: cases.model === ARRIVAL_MODEL},
 paramsSame: JSON.stringify({dwell_s: ARRIVAL_PARAMS.dwellS, window_s: ARRIVAL_PARAMS.windowS, standing_below: ARRIVAL_PARAMS.standingBelow,
  near_m: ARRIVAL_PARAMS.nearM}) === JSON.stringify(cases.params) && cruiseFor(cases.pattern) === cases.cruise,
 offsetsSame: cases.stopOffsets.every((o, j) => track.stopOffsets[j] === o) && track.stopOffsets.slice(cases.stopOffsets.length).every(o => o === null),
 journeys: cases.journeys.length, moments: 0, cases: 0, placement: {compared: 0, maxDiffM: 0}};
const tally = () => ({same: 0, differ: 0, bothNone: 0, onlyEvaluator: 0, onlyPage: 0, maxDiffMs: 0, examples: []});
const full = tally(), windowed = tally();
const compare = (t, evaluated, page, where) => {
 if (evaluated === null && page === null) t.bothNone++;
 else if (evaluated === null) { t.onlyPage++; if (t.examples.length < 5) t.examples.push({...where, evaluated, page}); }
 else if (page === null) { t.onlyEvaluator++; if (t.examples.length < 5) t.examples.push({...where, evaluated, page}); }
 else { const d = Math.abs(page - evaluated); t.maxDiffMs = Math.max(t.maxDiffMs, d);
  if (d === 0) t.same++; else { t.differ++; if (t.examples.length < 5) t.examples.push({...where, evaluated, page, diffMs: page - evaluated}); } }
};

// The deployed estimator, if asked for: its own road (the map's), its own gates, the reports a publication carries.
let deployed = null;
if (arg('deployed')) {
 const old = await import(new URL(arg('deployed'), `file://${process.cwd()}/`).href);
 const {makeTrack, decodePolyline} = await import('@/lib/motion');
 deployed = {old, track: makeTrack(cases.pattern, decodePolyline(shape.polyline6, 6), shape.stopOffsets), full: tally(), carried: tally()};
}

const cruise = cruiseFor(cases.pattern);
for (const journey of cases.journeys) {
 const raw = journey.reports.map(([at, lat, lon]) => ({at, lat, lon}));
 const byMoment = new Map();
 for (const [i, j, eta] of journey.cases) { if (!byMoment.has(i)) byMoment.set(i, []); byMoment.get(i).push([j, eta]); }
 for (const [i, targets] of byMoment) {
  const tNow = journey.placed[i][0];
  const upTo = raw.filter(r => r.at <= tNow);
  const placedFull = placeReports(track, upTo);
  const at = placedFull.length - 1;
  summary.placement.compared++;
  summary.placement.maxDiffM = Math.max(summary.placement.maxDiffM, Math.abs(placedFull[at][1] - journey.placed[i][1]),
   placedFull[at][0] === tNow ? 0 : Infinity);
  const recent = upTo.filter(r => r.at >= tNow - ARRIVAL_PARAMS.windowS * 1000);
  const placedWindow = placeReports(track, recent);
  const carried = deployed ? [...upTo.filter(r => r.at < tNow && r.at >= tNow - 240_000).slice(-6), upTo[upTo.length - 1]] : null;
  summary.moments++;
  for (const [j, eta] of targets) {
   summary.cases++;
   const where = {journey: journey.key, moment: i, stop: j};
   compare(full, eta, blendedEta(placedFull, at, j, track.stopOffsets, journey.timing, cruise), where);
   compare(windowed, eta, placedWindow.length ? blendedEta(placedWindow, placedWindow.length - 1, j, track.stopOffsets, journey.timing, cruise) : null, where);
   if (deployed && summary.moments % 50 === 0) {
    const ask = reports => {
     const e = deployed.old.arrivalEstimate({track: deployed.track, patternId: cases.pattern, timing: journey.timing, stopIndex: j, reports,
      nowMs: tNow, release: {released: [cases.direction]}, direction: cases.direction});
     return e.kind === 'estimate' ? e.atMs : null;
    };
    compare(deployed.full, eta, ask(upTo), where);
    compare(deployed.carried, eta, ask(carried), where);
   }
  }
 }
}
const out = {...summary, full, window: windowed};
if (deployed) out.deployed = {fullReports: deployed.full, publicationReports: deployed.carried};
console.log(JSON.stringify(out, null, 1));
