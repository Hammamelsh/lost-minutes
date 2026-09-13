// How smoothly the page draws estimated movement, measured over captured journeys: the page's
// frame loop run offline, at 10 frames a second, polling every 10 s and holding the latest report
// with up to six before it, as it does live. The estimate is the published, frozen one and is the
// same for every variant; only how the drawn bus follows it differs, so nothing here changes an
// evaluated error. What a passenger sees as twitching is counted directly: steps in the drawn
// speed (over 1 m/s within a tenth of a second), hard speed changes (over 4 m/s²), reversing,
// and how far the drawn bus strays from the estimate it stands for.
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
 'drawn now (DRAWING, hold within the measured error)': (v, e, t, track) => NOW.stepVisual(v, e, t, track, NOW.drawingFor(e, profile)),
 'the same with only the fixed 35 m hold': (v, e, t, track) => NOW.stepVisual(v, e, t, track, NOW.DRAWING),
};
const before = arg('before');
if (before) {
 const B = await import(pathToFileURL(resolve(before)).href), p = settings(B);
 variants[`before (${before})`] = (v, e, t, track) => B.stepVisual(v, e, t, track, p);
}

const FPS = 10, POLL = 10_000, DT = 1000 / FPS;
const tally = Object.fromEntries(Object.keys(variants).map(k => [k, {frames: 0, steps: 0, hard: 0, back: 0, backMetres: 0,
 snaps: 0, stray: [], speed: []}]));
let used = 0;
for (const sequence of data.sequences) {
 const fixes = fixesOf(sequence);
 if (fixes.length < 2 || !fixes.some(f => f.pattern && tracks.has(f.pattern))) continue;
 used++;
 const start = fixes[0].availableAt, end = fixes.at(-1).availableAt + 25_000;
 const state = Object.fromEntries(Object.keys(variants).map(k => [k, {v: null, s: null, speed: null, stepping: false}]));
 let polled = start, known = [];
 for (let k = 0, now = start; now <= end; k++, now = start + k * DT) {
  if (now >= polled) { known = fixes.filter(f => f.availableAt <= now); polled += POLL; }
  if (!known.length) continue;
  const latest = known.at(-1), track = latest.pattern ? tracks.get(latest.pattern) ?? null : null;
  const history = NOW.historyFrom(known.slice(-7));
  const e = track ? NOW.estimate(history, track, now, params) : NOW.observedAt(history, now, 'no accepted road geometry');
  for (const [name, step] of Object.entries(variants)) {
   const st = state[name], a = tally[name], previous = st.v;
   st.v = step(previous, e, now, e.mode === 'estimated' ? track : null);
   const snapped = st.v.lastCorrection?.kind === 'snap' && st.v.lastCorrection.at === now;
   if (snapped) a.snaps++;
   if (e.mode !== 'estimated' || st.v.mode !== 'estimated' || snapped || st.s === null || previous?.trackId !== st.v.trackId) {
    st.s = st.v.mode === 'estimated' ? st.v.s : null; st.speed = null; continue;
   }
   const speed = (st.v.s - st.s) / (DT / 1000);
   a.frames++;
   if (speed < -0.1) { a.back++; a.backMetres += -speed * DT / 1000; }
   if (k % 3 === 0) { a.stray.push(Math.abs(st.v.s - e.s)); a.speed.push(speed); }
   if (st.speed !== null) {
    const change = Math.abs(speed - st.speed) / (DT / 1000);
    if (change > 4) a.hard++;
    if (change > 10 && !st.stepping) a.steps++;
    st.stepping = change > 10;
   }
   st.s = st.v.s; st.speed = speed;
  }
 }
}
const q = (values, p) => { const s = Float64Array.from(values).sort(); return s.length ? +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(1) : null; };
const result = {schemaVersion: 1, generatedAt: new Date().toISOString(), reports: reportsFile, label, journeys: used,
 model: model.version, framesPerSecond: FPS, pollSeconds: POLL / 1000, drawing: NOW.DRAWING, variants: {}};
for (const [name, a] of Object.entries(tally)) {
 const hours = a.frames / FPS / 3600;
 result.variants[name] = {hoursDrawn: +hours.toFixed(2), speedStepsPerHour: +(a.steps / hours).toFixed(1),
  hardChangeShare: +(a.hard / a.frames).toFixed(4), reversingShare: +(a.back / a.frames).toFixed(4),
  reversedMetresPerHour: Math.round(a.backMetres / hours), snapsPerHour: +(a.snaps / hours).toFixed(1),
  speed: {p50: q(a.speed, 0.5), p95: q(a.speed, 0.95), p99: q(a.speed, 0.99)},
  strayFromEstimate: {p50: q(a.stray, 0.5), p80: q(a.stray, 0.8), p95: q(a.stray, 0.95)}};
}
mkdirSync(dirname(out), {recursive: true});
writeFileSync(out, JSON.stringify(result, null, 1));
for (const [name, r] of Object.entries(result.variants))
 console.log(`${name}: ${r.hoursDrawn} h drawn; speed steps ${r.speedStepsPerHour}/h; hard changes ${(r.hardChangeShare * 100).toFixed(1)}%;`
  + ` reversing ${(r.reversingShare * 100).toFixed(1)}% (${r.reversedMetresPerHour} m/h); snaps ${r.snapsPerHour}/h;`
  + ` stray p50 ${r.strayFromEstimate.p50} p80 ${r.strayFromEstimate.p80} p95 ${r.strayFromEstimate.p95} m`);
console.log(`${used} journeys; written to ${out}`);
