/**
 * Record a run of real publications, exactly as a phone would receive them.
 *
 *   node scripts/probes/record-publications.mjs --base https://lost-minutes.duckdns.org \
 *     --seconds 900 --out data/evaluation/reel-evening.json
 *
 * Each poll keeps the served `live.json` verbatim, with the wall time it arrived. Repeated
 * publications (the same `publishedAt`) are recorded once: the page would see no change either.
 * The result is a reel that `movement-replay.mjs` plays back, so a movement fault can be
 * reproduced from the same reports as often as needed instead of waited for on the live feed.
 *
 * It is a recording of our own published state, not of the upstream feed: the raw captures
 * behind it are kept by the collector and are what `pipeline/restore.py` reads.
 */
import {mkdirSync, writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {arg} from './common.mjs';

const base = (arg('base', 'https://lost-minutes.duckdns.org')).replace(/\/$/, '');
const seconds = Number(arg('seconds', 600));
const every = Number(arg('every', 8)) * 1000;
const out = arg('out', 'data/evaluation/reel.json');

const publications = [];
const started = Date.now();
let seen = null, failures = 0;
process.stdout.write(`recording ${base} for ${seconds}s\n`);
while (Date.now() - started < seconds * 1000) {
  const at = Date.now();
  try {
    const response = await fetch(`${base}/data/live.json?at=${at}`, {cache: 'no-store'});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const live = await response.json();
    if (live.publishedAt !== seen) {
      seen = live.publishedAt;
      publications.push({receivedAtMs: at, live});
      process.stdout.write(`  ${publications.length} ${live.publishedAt} ${live.vehicles?.length ?? 0} vehicles\n`);
    }
  } catch (error) { failures += 1; process.stdout.write(`  ! ${error.message}\n`); }
  await new Promise(r => setTimeout(r, Math.max(0, every - (Date.now() - at))));
}
mkdirSync(dirname(out), {recursive: true});
writeFileSync(out, JSON.stringify({recordedFrom: base, startedAtMs: started, endedAtMs: Date.now(),
  polls: {everyMs: every, failures}, publications}));
process.stdout.write(`\n${publications.length} publications over ${Math.round((Date.now() - started) / 1000)}s -> ${out}\n`);
