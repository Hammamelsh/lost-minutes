/**
 * GLIDE against PLAYBACK on identical recorded reports and identical frames, at 60 fps.
 *
 *   node --experimental-strip-types --import ./tests/alias-loader.mjs scripts/evaluate-playback.mjs \
 *     --reports data/evaluation/motion-reports-fresh.json [--arrival 15000]
 *
 * Both drawings see each report only from the moment it would have reached a phone: `--arrival`
 * ms after it was made (a report is 10–20 s old when published and the page polls every 20 s), so
 * the frame timing is the one a passenger gets, not the one the collector gets. What is measured
 * is what a passenger sees: how much of the time the bus is moving, how long it stands, how fast
 * it is drawn moving, and how far behind the newest known report it is — the delay being the price
 * of the continuity.
 */
import {execFileSync} from 'node:child_process';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {historyFrom, metres, observedAt, PLAYBACK} from '@/lib/motion';
import {stepVisual as playback} from '@/lib/motion';
const arg = (k, d) => {const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d};

// The drawing this one replaced, for the comparison: read from the commit it last shipped in
// (`--baseline <ref>`, b9cbe88 by default, the 23 September 2026 deploy), so the repository does
// not carry a second copy of lib/motion.ts. It needs a checkout with that commit.
const baselineRef = arg('baseline', 'b9cbe88');
const baselineDir = join(process.cwd(), 'outputs', 'evaluation');
mkdirSync(baselineDir, {recursive: true});
const baselineFile = join(baselineDir, `motion-${baselineRef}.ts`);
writeFileSync(baselineFile, execFileSync('git', ['show', `${baselineRef}:lib/motion.ts`], {encoding: 'utf8'}));
const {stepVisual: glide} = await import(pathToFileURL(baselineFile).href);

const FPS = 60, STEP = 1000 / FPS;
const file = arg('reports', 'data/evaluation/motion-reports-fresh.json');
const arrival = Number(arg('arrival', 15_000));
// `--jitter lo,hi`: each report's arrival lag drawn from that range (ms), seeded, instead of fixed.
const jitter = (arg('jitter', '') || '').split(',').map(Number).filter(Number.isFinite);
let seed = 7; const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const lagFor = () => jitter.length === 2 ? jitter[0] + rand() * (jitter[1] - jitter[0]) : arrival;
// `--delay ms`: pin the playback delay instead of letting it size itself from the lags seen.
const pinned = Number(arg('delay', 0));
if (pinned) { PLAYBACK.minDelayMs = pinned; PLAYBACK.maxDelayMs = pinned; }
const pct = (xs, q) => {if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b);
 const i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo)};
const data = JSON.parse(readFileSync(file, 'utf8'));
const runs = {glide: {step: [], lag: [], stand: 0, frames: 0, stalls: [], snaps: 0}, playback: {step: [], lag: [], stand: 0, frames: 0, stalls: [], snaps: 0}};
let journeys = 0, reports = 0;
for (const seq of data.sequences) {
 const fixes = seq.fixes.map(f => ({at: f[0], lat: f[2], lon: f[3], bearing: f[4], service: 'x', source: String(f[6])}));
 if (fixes.length < 4) continue;
 const arrives = fixes.map(() => lagFor());
 journeys++; reports += fixes.length;
 const v = {glide: null, playback: null}, prev = {glide: null, playback: null}, standing = {glide: 0, playback: 0};
 let known = 1;
 for (let t = fixes[0].at + arrives[0]; t <= fixes[fixes.length - 1].at + arrives[fixes.length - 1]; t += STEP) {
  while (known < fixes.length && fixes[known].at + arrives[known] <= t) known++;
  const history = historyFrom(fixes.slice(0, known));
  const newest = fixes[known - 1];
  for (const which of ['glide', 'playback']) {
   const e = observedAt(history, t, 'no accepted road geometry for this service');
   const fn = which === 'glide' ? glide : playback;
   v[which] = fn(v[which], e, t, null, undefined, history);
   const r = runs[which];
   r.frames++;
   if (prev[which]) {
    const d = metres(prev[which], v[which]);
    r.step.push(d);
    if (d * FPS < 0.5) { r.stand++; standing[which] += STEP; } else { if (standing[which] > 0) r.stalls.push(standing[which]); standing[which] = 0; }
    if (v[which].lastCorrection?.kind === 'snap' && v[which].lastCorrection.at === t) r.snaps++;
    if (d > 12 && which === 'playback' && (r.big ??= []).length < 8)
     r.big.push({metres: +d.toFixed(1), said: v[which].lastCorrection?.at === t ? v[which].lastCorrection.why ?? 'snap' : 'no',
      shownAgoS: +((t - (v[which].buffer?.shown ?? t)) / 1000).toFixed(1), newestAgoS: +((t - newest.at) / 1000).toFixed(1),
      firstFrame: !prev[which]});
   }
   r.lag.push(metres(v[which], newest));
   prev[which] = {lat: v[which].lat, lon: v[which].lon};
  }
 }
}
const report = r => ({
 movingShareOfFrames: `${((1 - r.stand / r.step.length) * 100).toFixed(0)}%`,
 stallsOver5s: r.stalls.filter(s => s > 5000).length, stallsOver5sPerHour: +(r.stalls.filter(s => s > 5000).length / (r.frames / FPS / 3600)).toFixed(1),
 longestStallSeconds: +((Math.max(0, ...r.stalls)) / 1000).toFixed(1),
 drawnSpeedP95MetresPerSecond: +(pct(r.step, 0.95) * FPS).toFixed(1), drawnSpeedMaxMetresPerSecond: +(pct(r.step, 1) * FPS).toFixed(1),
 stepsOverABusLength: r.step.filter(d => d > 12).length, repositionings: r.snaps,
 behindNewestReportP50Metres: +pct(r.lag, 0.5).toFixed(0), behindNewestReportP95Metres: +pct(r.lag, 0.95).toFixed(0),
 bigSteps: r.big ?? [],
});
console.log(JSON.stringify({file, journeys, reports, arrivalLagMs: jitter.length === 2 ? jitter : arrival, delayMs: pinned || 'adaptive', glide: report(runs.glide), playback: report(runs.playback)}, null, 1));
