/**
 * What this app can say about the fleet that is actually reporting, capability by capability.
 *
 *   node --experimental-strip-types --import ./tests/alias-loader.mjs scripts/coverage-breakdown.mjs \
 *     [--live out/data/live.json] [--patterns public/data/patterns.json] [--shapes public/data/shapes/index.json]
 *
 * Four capabilities with different requirements, never rolled into one number (lib/coverage.ts):
 *
 *   position    the bus's own report. Near-total inside the area.
 *   timetable   a registration valid today, running today, in the reported direction, settled to
 *               one pattern. An unsettled branch is counted apart: it is not a failure to hold a
 *               timetable, it is two roads that both fit.
 *   geometry    a road path through that pattern's stops, accepted only where that pattern's own
 *               reports lie close to it (35 m at the 95th percentile, at least 30 reports).
 *   estimate    movement between reports: needs the geometry above, and nothing else.
 *   front view  needs the same geometry, and in addition the bus to be on it with its look-ahead
 *               on road every candidate shares. Arrival minutes are a separate gate again
 *               (docs/ARRIVAL_RELEASE_CRITERIA.md) and are not counted here.
 *
 * Every refused bus is counted under the reason it was refused, so the remainder is explained
 * rather than implied.
 */
import {readFileSync} from 'node:fs';
const arg = (k, d) => {const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d};
const read = f => JSON.parse(readFileSync(f, 'utf8'));

const live = read(arg('live', 'out/data/live.json'));
const shapes = read(arg('shapes', 'public/data/shapes/index.json')).patterns ?? {};
const vehicles = live.vehicles ?? [];
const accepted = new Set(Object.entries(shapes).filter(([, s]) => s.status === 'accepted').map(([k]) => k));
const built = new Set(Object.keys(shapes));

const tally = {}, bump = (k, by = 1) => {tally[k] = (tally[k] ?? 0) + by};
const refusal = {}, why = r => {refusal[r] = (refusal[r] ?? 0) + 1};
const services = new Map();

for (const v of vehicles) {
 bump('position');
 const m = v.match ?? null;
 const pattern = m && 'patternId' in m ? m.patternId : null;
 const key = `${v.operator}|${v.route}`;
 const row = services.get(key) ?? {key, reporting: 0, placed: 0, withGeometry: 0};
 row.reporting++;
 if (!pattern) {
  // An unsettled branch is not necessarily without a road: where every candidate's geometry has
  // been accepted, the app measures the stretch they all run down and uses that where the bus and
  // its whole look-ahead are inside it (lib/motion-view.ts). Whether this bus is inside it right
  // now is geometry this summary does not do, so they are counted as candidates, not as covered.
  const ids = m && 'candidates' in m ? (m.candidates ?? []).map(c => c.patternId) : [];
  if (ids.length && ids.every(id => accepted.has(id))) bump('sharedRoadCandidate');
  else why(m?.unresolved ?? 'no_match_recorded');
 } else {
  bump('timetable'); row.placed++;
  if (accepted.has(pattern)) {bump('geometryAccepted'); bump('estimate'); bump('frontView'); row.withGeometry++;}
  else if (built.has(pattern)) why(`geometry_built_but_rejected:${shapes[pattern].reason?.slice(0, 48) ?? '?'}`);
  else why('no_geometry_built_for_this_pattern');
 }
 services.set(key, row);
}

const rows = [...services.values()].sort((a, b) => b.reporting - a.reporting);
const pc = n => `${n} (${(n / vehicles.length * 100).toFixed(0)}%)`;
console.log(JSON.stringify({
 publishedAt: live.publishedAt, vehicles: vehicles.length,
 distinctServices: rows.length,
 capabilities: {
  position: pc(tally.position ?? 0),
  timetablePlaced: pc(tally.timetable ?? 0),
  roadGeometryAccepted: pc(tally.geometryAccepted ?? 0),
  estimatedMovementEligible: pc(tally.estimate ?? 0),
  frontViewEligibleBeforeTheOnRoadCheck: pc(tally.frontView ?? 0),
  unsettledBranchWithEveryCandidateAccepted: pc(tally.sharedRoadCandidate ?? 0),
 },
 refusedAndWhy: Object.fromEntries(Object.entries(refusal).sort((a, b) => b[1] - a[1])),
 shapeIndex: {patterns: Object.keys(shapes).length, accepted: accepted.size},
 servicesWithNoGeometry: rows.filter(r => r.placed > 0 && r.withGeometry === 0).slice(0, 15)
  .map(r => `${r.key}: ${r.reporting} reporting, ${r.placed} placed, no accepted road`),
}, null, 1));
