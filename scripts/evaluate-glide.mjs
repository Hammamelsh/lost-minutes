/**
 * How far the drawn bus moves in one frame, for a bus shown at its reports.
 *
 *   node --experimental-strip-types --import ./tests/alias-loader.mjs scripts/evaluate-glide.mjs \
 *     --reports data/evaluation/motion-reports-fresh.json
 *
 * Real recorded journeys are replayed at 60 frames a second in observed-only mode (no accepted
 * road geometry, which is what most services still are). Two drawings are measured on the very
 * same reports and the very same frame times:
 *
 *   before  the bus is placed at its latest report every frame, so a report arriving after 20 s
 *           of standing still moves it the whole way in one frame: the jump;
 *   after   the bus travels from the report it was drawn at to the report that arrived, taking
 *           the time the bus itself took between them (GLIDE in lib/motion.ts), and waits there.
 *
 * Reported are the largest step in a single frame, how often a step is larger than a bus is long
 * (12 m), and how far behind the newest report the drawn bus is — the delay the smoothing costs.
 * Nothing here is an estimate: both drawings only ever show the bus between two observed
 * positions, and neither is carried past the newest report.
 */
import {readFileSync} from 'node:fs';
import {GLIDE, historyFrom, metres, observedAt, stepVisual} from '@/lib/motion';

const arg = (k, d) => {const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d};
const FPS = 60, STEP = 1000 / FPS;
const pct = (xs, q) => {if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b);
 const i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo)};

const file = arg('reports', 'data/evaluation/motion-reports-fresh.json');
const data = JSON.parse(readFileSync(file, 'utf8'));
const out = {before: {steps: [], lag: []}, after: {steps: [], lag: []}};
let journeys = 0, reports = 0;

for (const seq of data.sequences) {
 const fixes = seq.fixes.map(f => ({at: f[0], lat: f[2], lon: f[3], bearing: f[4], service: 'x', source: String(f[6])}));
 if (fixes.length < 4) continue;
 journeys++; reports += fixes.length;
 // Each drawing gets its own state; the reports and the frame times are shared exactly.
 let vAfter = null, prevAfter = null, prevBefore = null;
 let next = 1;
 for (let t = fixes[0].at; t <= fixes[fixes.length - 1].at; t += STEP) {
  while (next < fixes.length && fixes[next].at <= t) next++;
  const history = historyFrom(fixes.slice(0, next));
  const e = observedAt(history, t, 'no accepted road geometry for this service');
  const latest = fixes[next - 1];
  // before: the report itself, every frame.
  if (prevBefore) out.before.steps.push(metres(prevBefore, e));
  out.before.lag.push(0);
  prevBefore = {lat: e.lat, lon: e.lon};
  // after: travelling between the reports, which needs the reports themselves.
  vAfter = stepVisual(vAfter, e, t, null, undefined, history);
  if (prevAfter) out.after.steps.push(metres(prevAfter, vAfter));
  out.after.lag.push(metres(vAfter, latest));
  prevAfter = {lat: vAfter.lat, lon: vAfter.lon};
 }
}

const report = which => {
 const s = out[which].steps, jumps = s.filter(d => d > 12).length;
 let max = 0, capped = 0;
 for (const d of s) {if (d > max) max = d; if (d > capped && d <= GLIDE.maxMetres) capped = d}
 // The lag is what smoothing costs: how far the drawn bus is behind the newest known report. It
 // is zero except in the moments just after a report, so it is reported over those moments.
 const lag = out[which].lag, behind = lag.filter(d => d > 1);
 const moving = which === 'after' ? s.filter(d => d * FPS > 0.5).length : 0;
 return {stepsOverABusLength: jumps, perHour: +(jumps / (s.length / FPS / 3600)).toFixed(1),
  framesDrawnMoving: which === 'after' ? `${(moving / s.length * 100).toFixed(0)}%` : '0%',
  largestStepMetres: +max.toFixed(1), largestStepWithinTheCapMetres: +capped.toFixed(1),
  p999StepMetres: +pct(s, 0.999).toFixed(2),
  framesBehindTheLatestReport: +(behind.length / lag.length * 100).toFixed(1) + '%',
  medianLagWhenBehindMetres: behind.length ? +pct(behind, 0.5).toFixed(1) : 0,
  largestLagMetres: behind.length ? +pct(behind, 1).toFixed(1) : 0};
};
console.log(JSON.stringify({file, journeys, reports, frames: out.before.steps.length + 1, fps: FPS,
 glide: GLIDE, before: report('before'), after: report('after')}, null, 1));
