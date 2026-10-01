/**
 * How often the map's streets join two consecutive reports of the same bus (lib/streets.ts), over a reel, and why
 * not where they do not: a report off every street, only a way far longer than the reports allow, or no way at all
 * (the network broken there). Written 30 September 2026 to find why street tracks stopped short.
 *
 *   node --experimental-strip-types --import ./tests/alias-loader.mjs scripts/street-joins.mjs --reel <reel> [--examples 8]
 */
import {readFileSync} from 'node:fs';
import {joinReports} from '@/lib/streets';
import {loadOsm} from './osm-streets.mjs';
const arg = (k, d) => {const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d};
const reel = JSON.parse(readFileSync(arg('reel'), 'utf8'));
const examples = Number(arg('examples', 8));
const reports = new Map();
for (const p of reel.publications) for (const v of p.live.vehicles ?? []) {
  const k = `${v.operator}|${v.vehicle}|${v.journeyRef}`;
  if (!reports.has(k)) reports.set(k, new Map());
  const m = reports.get(k);
  for (const t of v.trail ?? []) m.set(v.observedAtMs - t[0], {at: v.observedAtMs - t[0], lat: t[1], lon: t[2], bearing: t[3] ?? null});
  m.set(v.observedAtMs, {at: v.observedAtMs, lat: v.lat, lon: v.lon, bearing: v.bearing ?? null});
}
const osm = await loadOsm([...reports.values()].flatMap(m => [...m.values()].map(f => [f.lat, f.lon])));
const counts = {}, samples = {};
for (const [k, m] of reports) {
  const fx = [...m.values()].sort((a, b) => a.at - b.at);
  for (let i = 1; i < fx.length; i++) {
    const a = fx[i - 1], b = fx[i];
    if (b.at - a.at > 45_000) continue;
    const pad = 0.0015, lines = osm.roadLines([Math.min(a.lat, b.lat) - pad, Math.min(a.lon, b.lon) - pad * 1.7, Math.max(a.lat, b.lat) + pad, Math.max(a.lon, b.lon) + pad * 1.7]);
    const r = joinReports(a, b, lines), why = r.why.replace(/\(.*\)/, '').trim();
    counts[why] = (counts[why] ?? 0) + 1;
    if (!r.ok && (samples[why] ??= []).length < examples)
      samples[why].push({bus: k, a: `${a.lat.toFixed(6)},${a.lon.toFixed(6)}`, b: `${b.lat.toFixed(6)},${b.lon.toFixed(6)}`, why: r.why});
  }
}
const total = Object.values(counts).reduce((a, b) => a + b, 0);
console.log(JSON.stringify({pairs: total, share: Object.fromEntries(Object.entries(counts).map(([k, n]) => [k, +(n / total).toFixed(4)])), counts, samples}, null, 1));
