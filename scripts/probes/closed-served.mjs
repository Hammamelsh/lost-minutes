// Is a service closed to the public ever offered by the planners, on a real catalogue? For each closed
// service (the catalogue's own publicUse flag, or the known list while it carries none), plan direct trips
// along its own stops and check it is in no option; then, as the control, the same trips with every
// pattern declared open, where it must appear.
//   node --experimental-strip-types --import ./tests/alias-loader.mjs scripts/probes/closed-served.mjs \
//     --catalogue <patterns.json> [--stops public/data/stops.json] [--day 2026-09-29]
import {readFileSync} from 'node:fs';
import {directOptions} from '../../lib/plan.ts';
import {KNOWN_CLOSED, carriesPublicUse} from '../../lib/connections.ts';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const catalogue = JSON.parse(readFileSync(arg('catalogue'), 'utf8'));
const stops = JSON.parse(readFileSync(arg('stops', 'public/data/stops.json'), 'utf8')).stops;
const day = arg('day', '2026-09-29');
const byId = new Map(stops.map(s => [s.id, s]));
const flagged = carriesPublicUse(catalogue.patterns);
const closed = catalogue.patterns.filter(p => flagged ? p.publicUse === false : KNOWN_CLOSED.has(`${p.operator ?? ''}|${p.line}`));
const lines = o => [o.leg.pattern, ...o.leg.also.map(l => l.pattern)].map(p => `${p.operator}|${p.line}`);
const open = {...catalogue, patterns: catalogue.patterns.map(p => ({...p, publicUse: true}))};
let trips = 0, offered = 0, controlOffered = 0;
for (const p of closed) {
 const inside = p.stops.filter(id => byId.has(id));
 // Every ordered pair of its stops inside the area (a closed school service often has only two or three).
 const pairs = inside.flatMap((_, a) => inside.map((__, b) => [a, b])).filter(([a, b]) => a < b && inside[a] !== inside[b]).slice(0, 12);
 for (const [a, b] of pairs) {
  const from = byId.get(inside[a]), to = byId.get(inside[b]);
  const key = `${p.operator}|${p.line}`;
  trips++;
  if (directOptions(from, to, catalogue, stops, day).some(o => lines(o).includes(key))) { offered++; console.log('OFFERED', key, p.id, from.name, '->', to.name); }
  if (directOptions(from, to, open, stops, day).some(o => lines(o).includes(key))) controlOffered++;
 }
}
console.log(JSON.stringify({catalogueCarriesPublicUse: flagged, closedPatterns: closed.length,
 closedServices: [...new Set(closed.map(p => `${p.operator}|${p.line}`))].sort(), day, trips, offered,
 controlOfferedWhenDeclaredOpen: controlOffered}));
