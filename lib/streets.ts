/**
 * A street track for a bus with no checked road: the map's own streets joining its reports, so that it is drawn
 * along a road between them rather than on the straight line, which cut across blocks (30 September 2026).
 *
 * The owner rode a Diamond 74 at Charlestown, whose every report lay within 3.4 m of its road, and saw it drawn
 * over the houses beside it: the line between two reports 100 m apart cut the inside of the bend. Measured over a
 * whole evening's fleet (334 buses), a bus with no checked road was drawn more than 10 m from any drivable road in
 * 10.0% of frames and inside a building in 6.9%, against 4.6% of its own reports that far off; a bus with a
 * checked road, 0.85% and 0.3%. The streets are the basemap's (OpenMapTiles `transportation`), which the page
 * already holds; the drawing takes this track exactly as it takes a checked road (lib/motion.ts), but never holds a
 * report off it as a fault, and nothing that reads "the road" for anything else (the front view, the road ahead, the
 * arrival estimate) is given it.
 *
 * It is not a checked road and is never said to be one: it is the shortest way along the mapped streets between
 * two consecutive reports, accepted only where it is a way a bus could have gone in the time:
 *  - each report within `snapMetres` of a drivable street, on the carriageway running its way;
 *  - one-way streets driven only their way;
 *  - the way between two reports no longer than `detour` times the straight line plus `detourSlack`, at no more
 *    than `maxMps`, and without turning back on itself.
 */
import {makeTrack, metres, type Track} from '@/lib/motion';

/** What a bus can use in OpenMapTiles' `transportation` layer: motorway to minor, service, busway and bus guideway. */
export const DRIVABLE = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service', 'busway', 'bus_guideway']);

/** The drivable streets among a map's `transportation` features (GeoJSON, as MapLibre's querySourceFeatures gives). */
export function streetsFrom(features: {geometry: {type: string; coordinates: unknown}; properties?: Record<string, unknown> | null}[]): StreetLine[] {
 const lines: StreetLine[] = [];
 for (const f of features) {
  const cls = String(f.properties?.class ?? '');
  if (!DRIVABLE.has(cls)) continue;
  const oneway = Number(f.properties?.oneway ?? 0);
  if (f.geometry.type === 'LineString') lines.push({coords: f.geometry.coordinates as [number, number][], cls, oneway});
  else if (f.geometry.type === 'MultiLineString') for (const c of f.geometry.coordinates as [number, number][][]) lines.push({coords: c, cls, oneway});
 }
 return lines;
}

/** A drivable street: its points [lon, lat], its class, and OpenMapTiles' `oneway` (1 along the points, -1 against). */
export type StreetLine = {coords: [number, number][]; cls?: string; oneway?: number};
type Fix = {lat: number; lon: number; at: number; bearing?: number | null};

export const STREETS = {
 /** A report further than this from every drivable street is not on one (a stand, a depot, a GPS fault). */
 snapMetres: 25,
 /** Street vertices this close are one junction: the map's tiles each carry their own copy of a road that
  *  crosses their edge, and its vertices land a fraction of a metre apart. */
 mergeMetres: 1.5,
 /** A street's loose end this close to another street's line is joined to it (m): a road cut at a tile's edge, or a
  *  junction the tile's simplification lost. */
 joinMetres: 2,
 detour: 1.6,
 detourSlack: 40,
 maxMps: 25,
 /** Consecutive reports further apart than this in time are not joined (GLIDE's own limit). */
 maxGapMs: 45_000,
 /** A report nearer than this to where the track has got to, and back along it, is the same place: scatter round a
  *  standing bus (backAtEnd). */
 samePlace: 12,
 /** An out-and-back no longer than this is a report's scatter past a junction, and is cut from the track. */
 spurMetres: 30,
 /** A carriageway running more than this off the bus's heading is the other way's (degrees). */
 carriagewayDegrees: 60,
 /** What a carriageway running the other way costs a report snapping to it, in metres of distance. */
 wrongWayMetres: 15,
 /** A way turning back on itself by more than this within `hairpinMetres` is not one a bus takes between two
  *  reports (degrees, metres). */
 hairpinDegrees: 150,
 hairpinMetres: 30,
 /** A turn sharper than this with a leg shorter than `hookMetres` is a junction's clutter, not a way a bus drives. */
 hookDegrees: 100,
 hookMetres: 15,
 /** Kinks deviating less than this from the line through them are simplified away (m). */
 kinkMetres: 2.5,
 /** The radius a bend is rounded to (m): about a bus's turning circle at a junction. */
 turnRadius: 10,
 /** How much of a bus's street track is kept behind its newest end (m). Cutting the oldest part moved reports near
  *  the cut onto or off it, and the bus with them (the fleet check); at this length it is not cut within a ride. */
 keepMetres: 30_000,
 /** How long a bus may be off its street track's end before the track starts again (ms): longer than the drawing
  *  ever runs behind its newest report (PLAYBACK, at most a minute), so nothing already drawn moves. */
 restartMs: 90_000,
 /** How far around the places joined the streets are asked for (m): wide enough that every way the allowance admits
  *  is among them, whichever reports the page happens to hold. Given only the streets round the reports held, a way
  *  found at one publication was not at the one before, and a bus was moved 40 m across a block when it was. */
 padMetres: 400,
 /** One-way streets driven only their way. Off, every street is two-way (a bus lane against the traffic is often
  *  mapped only as the street's own one-way). */
 respectOneway: true,
};

const M = 111195;
const RAD = Math.PI / 180;

/** Segments: `dir` 1 drivable a to b only, -1 b to a only, 0 both. Edges are directed, as the streets allow. */
type Seg = {a: number; b: number; dir: 0 | 1 | -1};
/** The streets as a graph, grown a set of lines at a time (addLines). `edges[n]` is flat pairs (to, metres) of the ways
 *  out of n as the streets may be driven; `near[n]` every node joined to n either way; `cell` the segments by 25 m
 *  cell; `node` the nodes by merge cell; `loose` the nodes with one neighbour, to be joined as streets come in. */
type Graph = {lon: number[]; lat: number[]; edges: number[][]; near: number[][]; segs: Seg[];
 cell: Map<number, number[]>; node: Map<number, number[]>; loose: number[]; kx: number; used: number};
type Snap = {seg: number; t: number; lon: number; lat: number; d: number};
const SEG_CELL = 25;
/** A grid cell as one number: string keys made building a graph several times slower. Unique for |cy| < 2^22. */
const cellKey = (cx: number, cy: number) => cx * 8_388_608 + cy;

function emptyGraph(lat0: number): Graph {
 return {lon: [], lat: [], edges: [], near: [], segs: [], cell: new Map(), node: new Map(), loose: [],
  kx: M * Math.cos(lat0 * RAD), used: 0};
}

/**
 * Add streets to a graph. A vertex within `mergeMetres` of one already there is that one (the copies of a road in two
 * tiles meet); then every loose end the new streets could reach, old or new, is joined to a street within
 * `joinMetres` of it. Built this way a tile at a time, the page's graph is the graph of every street it holds.
 */
function addLines(g: Graph, lines: StreetLine[]) {
 const kx = g.kx, step = STREETS.mergeMetres * 2, firstNode = g.lon.length, firstSeg = g.segs.length;
 const addNode = (lon: number, lat: number) => {
  const id = g.lon.length;
  g.lon.push(lon); g.lat.push(lat); g.edges.push([]); g.near.push([]);
  return id;
 };
 const idOf = (lon: number, lat: number) => {
  const cx = Math.floor(lon * kx / step), cy = Math.floor(lat * M / step);
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
   const list = g.node.get(cellKey(cx + dx, cy + dy));
   if (list) for (const id of list) if (Math.hypot((g.lon[id] - lon) * kx, (g.lat[id] - lat) * M) <= STREETS.mergeMetres) return id;
  }
  const id = addNode(lon, lat), key = cellKey(cx, cy), list = g.node.get(key);
  if (list) list.push(id); else g.node.set(key, [id]);
  return id;
 };
 const w = (a: number, b: number) => Math.hypot((g.lon[b] - g.lon[a]) * kx, (g.lat[b] - g.lat[a]) * M);
 const link = (a: number, b: number, dir: 0 | 1 | -1) => {
  const d = w(a, b);
  if (dir !== -1) g.edges[a].push(b, d);
  if (dir !== 1) g.edges[b].push(a, d);
  g.near[a].push(b); g.near[b].push(a);
 };
 const drop = (list: number[], to: number, pairs: boolean) => {
  for (let i = 0; i < list.length; i += pairs ? 2 : 1) if (list[i] === to) { list.splice(i, pairs ? 2 : 1); i -= pairs ? 2 : 1; }
 };
 const unlink = (a: number, b: number) => {
  drop(g.edges[a], b, true); drop(g.edges[b], a, true); drop(g.near[a], b, false); drop(g.near[b], a, false);
 };
 const addSeg = (seg: Seg) => {
  const sid = g.segs.length; g.segs.push(seg);
  const {a, b} = seg;
  const x0 = Math.min(g.lon[a], g.lon[b]) * kx, x1 = Math.max(g.lon[a], g.lon[b]) * kx;
  const y0 = Math.min(g.lat[a], g.lat[b]) * M, y1 = Math.max(g.lat[a], g.lat[b]) * M;
  for (let cx = Math.floor(x0 / SEG_CELL); cx <= Math.floor(x1 / SEG_CELL); cx++)
   for (let cy = Math.floor(y0 / SEG_CELL); cy <= Math.floor(y1 / SEG_CELL); cy++) {
    const key = cellKey(cx, cy), list = g.cell.get(key); if (list) list.push(sid); else g.cell.set(key, [sid]);
   }
 };
 for (const line of lines) {
  const dir: 0 | 1 | -1 = STREETS.respectOneway && (line.oneway === 1 || line.oneway === -1) ? line.oneway : 0;
  let prev = -1;
  for (const [lon, lat] of line.coords) {
   const id = idOf(lon, lat);
   if (prev >= 0 && prev !== id && !g.near[prev].includes(id)) { link(prev, id, dir); addSeg({a: prev, b: id, dir}); }
   prev = id;
  }
 }
 // Loose ends joined to the street they stop on. The map's tiles each cut a road at their edge, so a road crossing
 // one is two overlapping copies that share no point on a long straight; and where a side road meets a through road,
 // the tile's simplification can drop the through road's point there. Either way the streets did not join, and 7%
 // of consecutive reports in an evening's fleet could not be joined at all (scripts/street-joins.mjs, 30 September
 // 2026; 0.7% once joined): a loose end within `joinMetres` of another street's line is joined to it, split there.
 // The new streets' loose ends, and the old loose ends a new street passes near (a tile's edge, its neighbour come).
 const touched = new Set<number>();
 for (let s = firstSeg; s < g.segs.length; s++) for (const n of [g.segs[s].a, g.segs[s].b]) {
  const cx = Math.floor(g.lon[n] * kx / SEG_CELL), cy = Math.floor(g.lat[n] * M / SEG_CELL);
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) touched.add(cellKey(cx + dx, cy + dy));
 }
 const cellOf = (n: number) => cellKey(Math.floor(g.lon[n] * kx / SEG_CELL), Math.floor(g.lat[n] * M / SEG_CELL));
 const candidates: number[] = [];
 for (const n of g.loose) if (g.near[n].length === 1 && touched.has(cellOf(n))) candidates.push(n);
 for (let n = firstNode; n < g.lon.length; n++) if (g.near[n].length === 1) candidates.push(n);
 for (const n of candidates) {
  const x = g.lon[n] * kx, y = g.lat[n] * M;
  let best: {sid: number; t: number; d: number} | null = null;
  const seen = new Set<number>();
  for (let cx = Math.floor(x / SEG_CELL) - 1; cx <= Math.floor(x / SEG_CELL) + 1; cx++)
   for (let cy = Math.floor(y / SEG_CELL) - 1; cy <= Math.floor(y / SEG_CELL) + 1; cy++)
    for (const sid of g.cell.get(cellKey(cx, cy)) ?? []) {
     if (seen.has(sid)) continue; seen.add(sid);
     const {a, b} = g.segs[sid];
     if (a === n || b === n) continue;
     const ax = g.lon[a] * kx, ay = g.lat[a] * M, dx = g.lon[b] * kx - ax, dy = g.lat[b] * M - ay, l2 = dx * dx + dy * dy;
     const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
     const d = Math.hypot(ax + t * dx - x, ay + t * dy - y);
     if (d <= STREETS.joinMetres && (!best || d < best.d)) best = {sid, t, d};
    }
  if (!best) continue;
  const {a, b, dir} = g.segs[best.sid];
  let m: number;
  if (best.t <= 0.001) m = a; else if (best.t >= 0.999) m = b;
  else {
   m = addNode(g.lon[a] + (g.lon[b] - g.lon[a]) * best.t, g.lat[a] + (g.lat[b] - g.lat[a]) * best.t);
   unlink(a, b); link(a, m, dir); link(m, b, dir);
   g.segs[best.sid] = {a, b: m, dir}; addSeg({a: m, b, dir});
  }
  if (m !== n && !g.near[n].includes(m)) link(n, m, 0);
 }
 g.loose = [...g.loose, ...Array.from({length: g.lon.length - firstNode}, (_, k) => firstNode + k)].filter(n => g.near[n].length === 1);
}

function buildGraph(lines: StreetLine[], lat0: number): Graph {
 const g = emptyGraph(lat0);
 addLines(g, lines);
 g.used = lines.length;
 return g;
}

/**
 * One graph per set of streets, and grown with it: a set only ever added to (as the page's is, a tile at a time) has
 * its new lines added to the graph it has, and every bus is routed on that one graph. Built afresh for each set of
 * tiles a bus's box covered, the page built 248 graphs over 105 tiles in a night's fleet, each 32 ms at the median
 * and up to 213 ms, several in one frame (0.45 s) as a phone panned into a street zoom (30 September 2026).
 */
const graphs = new WeakMap<StreetLine[], Graph>();
function graphFor(lines: StreetLine[], lat0: number): Graph {
 let g = graphs.get(lines);
 if (!g) { g = emptyGraph(lat0); graphs.set(lines, g); }
 if (g.used < lines.length) { addLines(g, lines.slice(g.used)); g.used = lines.length; }
 return g;
}

/** Make the graph of a set of streets ready (the page, as each tile arrives, so that no frame builds one). The set may
 *  be added to afterwards, never changed or cut. */
export function prepareStreets(lines: StreetLine[], lat0: number) { graphFor(lines, lat0); }

/** The bearing a segment is driven along, a to b or b to a as `forward` says. */
const segBearing = (g: Graph, s: Seg, forward: boolean) => {
 const [p, q] = forward ? [s.a, s.b] : [s.b, s.a];
 return (Math.atan2((g.lon[q] - g.lon[p]) * g.kx, (g.lat[q] - g.lat[p]) * M) / RAD + 360) % 360;
};
const turnBetween = (a: number, b: number) => Math.abs(((b - a) % 360 + 540) % 360 - 180);

/**
 * Where a report is on the streets: the nearest place on a drivable street within `snapMetres`, preferring the
 * carriageway that runs the bus's way (its heading, where known): of a dual carriageway's two one-way lines, 10 m
 * apart, the nearer was often the other way's, and the way between them went up to the next junction and back,
 * turning the drawn bus round (the fleet check, 30 September 2026).
 */
function snap(g: Graph, fix: Fix, heading: number | null = null): Snap | null {
 const x = fix.lon * g.kx, y = fix.lat * M, r = Math.ceil(STREETS.snapMetres / SEG_CELL);
 let best: (Snap & {score: number}) | null = null;
 const seen = new Set<number>();
 for (let cx = Math.floor(x / SEG_CELL) - r; cx <= Math.floor(x / SEG_CELL) + r; cx++)
  for (let cy = Math.floor(y / SEG_CELL) - r; cy <= Math.floor(y / SEG_CELL) + r; cy++)
   for (const s of g.cell.get(cellKey(cx, cy)) ?? []) {
    if (seen.has(s)) continue; seen.add(s);
    const seg = g.segs[s], {a, b} = seg;
    const ax = g.lon[a] * g.kx, ay = g.lat[a] * M, dx = g.lon[b] * g.kx - ax, dy = g.lat[b] * M - ay, len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
    const d = Math.hypot(ax + t * dx - x, ay + t * dy - y);
    if (d > STREETS.snapMetres) continue;
    let score = d;
    if (heading !== null && len2 > 1) {
     const ways = seg.dir === 1 ? [true] : seg.dir === -1 ? [false] : [true, false];
     if (!ways.some(f => turnBetween(heading, segBearing(g, seg, f)) <= STREETS.carriagewayDegrees)) score += STREETS.wrongWayMetres;
    }
    if (!best || score < best.score)
     best = {seg: s, t, d, score, lon: g.lon[a] + (g.lon[b] - g.lon[a]) * t, lat: g.lat[a] + (g.lat[b] - g.lat[a]) * t};
   }
 return best ? {seg: best.seg, t: best.t, lon: best.lon, lat: best.lat, d: best.d} : null;
}

/**
 * Whether a way turns back on itself (a hairpin): by more than `hairpinDegrees` within any `hairpinMetres` of it, so
 * that a U made of two right angles through a short connector (a dual carriageway's crossing) counts as one.
 */
function hairpin(points: [number, number][], kx: number): boolean {
 const legs: {dir: number; len: number}[] = [];
 for (let i = 0; i + 1 < points.length; i++) {
  const dx = (points[i + 1][0] - points[i][0]) * kx, dy = (points[i + 1][1] - points[i][1]) * M, len = Math.hypot(dx, dy);
  if (len >= 0.5) legs.push({dir: Math.atan2(dx, dy) / RAD, len});
 }
 for (let i = 0; i + 1 < legs.length; i++) {
  let turned = 0, along = 0;
  for (let j = i + 1; j < legs.length && along <= STREETS.hairpinMetres; j++) {
   turned += ((legs[j].dir - legs[j - 1].dir) % 360 + 540) % 360 - 180;
   if (Math.abs(turned) > STREETS.hairpinDegrees) return true;
   along += legs[j].len;
  }
 }
 return false;
}

/** The shortest way along the streets, as they may be driven, between two snapped places; null past `cutoff` metres,
 *  or where the only way turns back on itself. */
function route(g: Graph, from: Snap, to: Snap, cutoff: number): {points: [number, number][]; length: number} | null {
 const segLen = (s: number) => { const {a, b} = g.segs[s]; return Math.hypot((g.lon[b] - g.lon[a]) * g.kx, (g.lat[b] - g.lat[a]) * M); };
 const here: [number, number] = [from.lon, from.lat], there: [number, number] = [to.lon, to.lat];
 const A = g.segs[from.seg], B = g.segs[to.seg], la = segLen(from.seg), lb = segLen(to.seg);
 // Both on one segment, and it may be driven from one to the other: along it, directly.
 if (from.seg === to.seg && (A.dir === 0 || (A.dir === 1) === (to.t >= from.t))) {
  const length = Math.abs(to.t - from.t) * la;
  return length <= cutoff ? {points: [here, there], length} : null;
 }
 const dist = new Map<number, number>(), prev = new Map<number, number>();
 const heap: [number, number][] = [];
 const push = (d: number, n: number) => {
  heap.push([d, n]); let i = heap.length - 1;
  while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
 };
 const pop = (): [number, number] => {
  const top = heap[0], last = heap.pop()!;
  if (heap.length) { heap[0] = last; let i = 0;
   for (;;) { const l = 2 * i + 1, r = l + 1; let m = i;
    if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
    if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } }
  return top;
 };
 const start = (n: number, d: number) => { if (d < (dist.get(n) ?? Infinity)) { dist.set(n, d); prev.set(n, -1); push(d, n); } };
 // Off the first segment the ways it may be driven; onto the last from the ends it may be entered from.
 if (A.dir !== -1) start(A.b, (1 - from.t) * la);
 if (A.dir !== 1) start(A.a, from.t * la);
 const ends = new Map<number, number>();
 if (B.dir !== -1) ends.set(B.a, to.t * lb);
 if (B.dir !== 1) ends.set(B.b, (1 - to.t) * lb);
 let best = Infinity, bestEnd = -1;
 while (heap.length) {
  const [d, n] = pop();
  if (d > (dist.get(n) ?? Infinity) || d > cutoff || d >= best) continue;
  const tail = ends.get(n);
  if (tail !== undefined && d + tail < best) { best = d + tail; bestEnd = n; }
  const out = g.edges[n];
  for (let k = 0; k < out.length; k += 2) {
   const to = out[k], nd = d + out[k + 1];
   if (nd < (dist.get(to) ?? Infinity) && nd <= cutoff) { dist.set(to, nd); prev.set(to, n); push(nd, to); }
  }
 }
 if (bestEnd < 0 || best > cutoff) return null;
 const path: number[] = [];
 for (let n = bestEnd; n >= 0; n = prev.get(n) ?? -1) path.unshift(n);
 const points: [number, number][] = [here, ...path.map(n => [g.lon[n], g.lat[n]] as [number, number]), there];
 return hairpin(points, g.kx) ? null : {points, length: best};
}

/**
 * The track at a bus's own scale. The map draws a junction's islands and lane splits as kinks a few metres long, and
 * a track following them turned the drawn bus 90 degrees on the spot, which no bus does (the fleet check, 30
 * September 2026: a 203 traced a 4.6 m peak at a junction). A hook, a turn of more than `hookDegrees` with a leg
 * shorter than `hookMetres`, is cut; kinks under `kinkMetres` are simplified away (Douglas-Peucker); and each bend is
 * rounded to `turnRadius`, as a bus drives it: on a corner itself the body, laid along its 12 m, faced 45 degrees off
 * the way the drawn bus went. The first point is kept where it is, so a track extended at its end never moves what is
 * already drawn.
 */
function tidy(points: [number, number][], kx: number): [number, number][] {
 const len = (p: [number, number], q: [number, number]) => Math.hypot((p[0] - q[0]) * kx, (p[1] - q[1]) * M);
 let out = points.slice();
 for (let changed = true; changed && out.length > 2;) {
  changed = false;
  for (let i = 1; i + 1 < out.length; i++) {
   const a = out[i - 1], b = out[i], c = out[i + 1];
   const ux = (b[0] - a[0]) * kx, uy = (b[1] - a[1]) * M, vx = (c[0] - b[0]) * kx, vy = (c[1] - b[1]) * M;
   const nu = Math.hypot(ux, uy), nv = Math.hypot(vx, vy);
   if (!(nu > 0 && nv > 0)) { out.splice(i, 1); changed = true; break; }
   const turn = Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (nu * nv)))) / RAD;
   if (turn > STREETS.hookDegrees && Math.min(nu, nv) < STREETS.hookMetres) { out.splice(i, 1); changed = true; break; }
  }
 }
 const keep = new Array(out.length).fill(false); keep[0] = keep[out.length - 1] = true;
 const dp = (i: number, j: number) => {
  let worst = -1, at = -1;
  const a = out[i], b = out[j], dx = (b[0] - a[0]) * kx, dy = (b[1] - a[1]) * M, l2 = dx * dx + dy * dy;
  for (let k = i + 1; k < j; k++) {
   const px = (out[k][0] - a[0]) * kx, py = (out[k][1] - a[1]) * M;
   const t = l2 > 0 ? Math.max(0, Math.min(1, (px * dx + py * dy) / l2)) : 0;
   const d = Math.hypot(px - t * dx, py - t * dy);
   if (d > worst) { worst = d; at = k; }
  }
  if (at >= 0 && worst > STREETS.kinkMetres) { keep[at] = true; dp(i, at); dp(at, j); }
 };
 if (out.length > 2) dp(0, out.length - 1);
 out = out.filter((_, k) => keep[k]);
 const rounded: [number, number][] = [out[0]];
 for (let i = 1; i + 1 < out.length; i++) {
  const a = out[i - 1], b = out[i], c = out[i + 1];
  const ux = (b[0] - a[0]) * kx, uy = (b[1] - a[1]) * M, vx = (c[0] - b[0]) * kx, vy = (c[1] - b[1]) * M;
  const nu = Math.hypot(ux, uy), nv = Math.hypot(vx, vy);
  const turn = nu > 0 && nv > 0 ? Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (nu * nv)))) : 0;
  if (turn < 15 * RAD) { rounded.push(b); continue; }
  const tangent = Math.min(STREETS.turnRadius * Math.tan(turn / 2), 0.45 * nu, 0.45 * nv);
  const p0: [number, number] = [b[0] - ux / nu * tangent / kx, b[1] - uy / nu * tangent / M];
  const p1: [number, number] = [b[0] + vx / nv * tangent / kx, b[1] + vy / nv * tangent / M];
  // A quadratic Bezier through the corner: tangent to both legs at its ends, as an arc is, and smooth between.
  const steps = Math.max(2, Math.ceil(turn / (12 * RAD)));
  for (let k = 0; k <= steps; k++) {
   const t = k / steps, w0 = (1 - t) * (1 - t), w1 = 2 * (1 - t) * t, w2 = t * t;
   rounded.push([w0 * p0[0] + w1 * b[0] + w2 * p1[0], w0 * p0[1] + w1 * b[1] + w2 * p1[1]]);
  }
 }
 if (out.length > 1) rounded.push(out[out.length - 1]);
 return rounded.filter((p, k) => k === 0 || len(p, rounded[k - 1]) > 0.05);
}

/**
 * A report near the track's end, a bus standing or creeping, its reports scattered about the spot: back along the
 * track it is the same place (the track does not turn back for it, which turned buses round); forward it is a creep,
 * added, so that each report keeps its own place along the track. Collapsed onto the track's end, a standing bus's
 * reports all shared one place, and the drawing dated the bus by the first of them: "as it was about 93 s ago" of a
 * bus whose latest report there was 23 s old (the fleet check, 30 September 2026).
 */
function backAtEnd(points: [number, number][], to: {lon: number; lat: number}, kx: number): boolean {
 const m = points.length, tip = points[m - 1];
 const ex = (to.lon - tip[0]) * kx, ey = (to.lat - tip[1]) * M;
 if (Math.hypot(ex, ey) < 1) return true;
 if (m < 2 || Math.hypot(ex, ey) >= STREETS.samePlace) return false;
 const dx = (tip[0] - points[m - 2][0]) * kx, dy = (tip[1] - points[m - 2][1]) * M;
 return dx * ex + dy * ey <= 0;
}

/** The way a bus was heading at a report: its own reported bearing, else from the report before where far enough. */
function headingOf(fixes: Fix[], k: number): number | null {
 const f = fixes[k];
 if (f.bearing !== null && f.bearing !== undefined && Number.isFinite(f.bearing)) return f.bearing;
 const p = k > 0 ? fixes[k - 1] : null;
 if (!p || metres(p, f) < 10) return null;
 return (Math.atan2((f.lon - p.lon) * Math.cos(f.lat * RAD), f.lat - p.lat) / RAD + 360) % 360;
}

/** Append a way to a track, cutting any out-and-back of up to `spurMetres` where the way leaves the old end. */
function append(points: [number, number][], way: [number, number][], kx: number) {
 const len = (p: [number, number], q: [number, number]) => Math.hypot((p[0] - q[0]) * kx, (p[1] - q[1]) * M);
 let spur = 0;
 for (const q of way.slice(1)) {
  const m = points.length;
  if (m >= 2 && len(q, points[m - 2]) < 0.5 && spur + len(points[m - 1], points[m - 2]) <= STREETS.spurMetres) {
   spur += len(points[m - 1], points[m - 2]); points.pop(); continue;
  }
  if (len(q, points[m - 1]) < 0.05) continue;
  points.push(q); spur = 0;
 }
}

/** How far a place lies from a way (m). */
function offWay(p: {lat: number; lon: number}, way: [number, number][], kx: number): number {
 let best = Infinity;
 for (let i = 0; i + 1 < way.length; i++) {
  const ax = (way[i][0] - p.lon) * kx, ay = (way[i][1] - p.lat) * M, dx = (way[i + 1][0] - way[i][0]) * kx, dy = (way[i + 1][1] - way[i][1]) * M;
  const l2 = dx * dx + dy * dy, t = l2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
  best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
 }
 return best;
}

const allowance = (a: Fix, b: Fix) =>
 Math.max(2, Math.min(metres(a, b) * STREETS.detour + STREETS.detourSlack, STREETS.maxMps * (b.at - a.at) / 1000 + 15));

/**
 * The street track through a bus's reports, oldest first, or null where not even its newest two join. `lines` are
 * the drivable streets near them (the caller keeps them to a box around the reports).
 *
 * Built forward from the oldest report of the run that reaches the newest (every report on a street, each within
 * `maxGapMs` of the one before), always from where the track has got to:
 *  - a report within `samePlace` of that and back along the track is the same place (a bus standing, its reports
 *    scattered about the spot), and the track does not turn back for it; forward, it is a creep, added (backAtEnd);
 *  - an out-and-back of up to `spurMetres` is cut (a report just past a junction, the next one round the corner);
 *  - a report the streets do not join to it in the time starts the track again from itself.
 */
export function streetTrack(fixes: Fix[], lines: StreetLine[], id = 'street'): Track | null {
 if (fixes.length < 2 || !lines.length) return null;
 const g = graphFor(lines, fixes[fixes.length - 1].lat);
 const snaps = fixes.map((f, k) => snap(g, f, headingOf(fixes, k)));
 const n = fixes.length;
 if (!snaps[n - 1]) return null;
 let first = n - 1;
 while (first > 0 && snaps[first - 1] && fixes[first].at > fixes[first - 1].at && fixes[first].at - fixes[first - 1].at <= STREETS.maxGapMs) first--;
 if (first === n - 1) return null;
 let points: [number, number][] = [[snaps[first]!.lon, snaps[first]!.lat]];
 let end = first;
 for (let k = first + 1; k < n; k++) {
  const sb = snaps[k]!;
  if (backAtEnd(points, sb, g.kx)) continue;
  const way = route(g, snaps[end]!, sb, allowance(fixes[end], fixes[k]));
  if (!way) { points = [[sb.lon, sb.lat]]; end = k; continue; }
  append(points, way.points, g.kx);
  end = k;
 }
 const tidied = tidy(points, g.kx);
 return tidied.length >= 2 ? makeTrack(`street:${id}`, tidied) : null;
}

/**
 * A bus's street track as the page keeps it: built once, then only ever extended at its newest end, so the streets
 * already drawn never change under the bus. Rebuilt from each publication's reports instead, the track changed
 * shape whenever the oldest report dropped off the trail or a new one did not fit, and the drawn bus was eased
 * across to the new line facing along the old: 44 of 334 buses faced more than 30 degrees off their movement for
 * over 1.5 s (the fleet check, 30 September 2026), against 1 drawn on straight lines.
 */
export type StreetRun = {id: string; points: [number, number][]; last: Fix; track: Track};
/** A box [south, west, north, east] round some places, padded by `padMetres`: what to ask for streets in. */
export type StreetBox = [number, number, number, number];
export function streetBox(places: {lat: number; lon: number}[]): StreetBox {
 const lat = places.map(p => p.lat), lon = places.map(p => p.lon);
 const dLat = STREETS.padMetres / M, dLon = STREETS.padMetres / (M * Math.cos(lat[0] * RAD));
 return [Math.min(...lat) - dLat, Math.min(...lon) - dLon, Math.max(...lat) + dLat, Math.max(...lon) + dLon];
}

/**
 * `streetsIn` gives the drivable streets in a box (the page reads them from the map's loaded tiles; a measurement
 * from the same tiles on disk). They are asked for round what is being joined — the track's end and the reports since,
 * or every report when starting — so the ways found do not depend on which older reports the page still holds.
 */
export function extendStreets(run: StreetRun | null, fixes: Fix[], streetsIn: (box: StreetBox) => StreetLine[],
                              id = 'street', why?: string[]): StreetRun | null {
 const newest = fixes[fixes.length - 1];
 const start = (): StreetRun | null => {
  const track = streetTrack(fixes, streetsIn(streetBox(fixes)), id);
  return track ? {id, points: track.points as [number, number][], last: newest, track} : null;
 };
 if (!run) return start();
 const fresh = fixes.filter(f => f.at > run.last.at);
 if (!fresh.length) return run;
 const tipPlace = run.points[run.points.length - 1];
 const lines = streetsIn(streetBox([{lon: tipPlace[0], lat: tipPlace[1]}, ...fresh]));
 if (!lines.length) return run;
 const g = graphFor(lines, newest.lat);
 const tip = run.points[run.points.length - 1], before = run.points.length > 1 ? run.points[run.points.length - 2] : null;
 const tipHeading = before ? (Math.atan2((tip[0] - before[0]) * g.kx, (tip[1] - before[1]) * M) / RAD + 360) % 360 : null;
 let end = snap(g, {lon: tip[0], lat: tip[1], at: run.last.at}, tipHeading);
 let points = run.points.slice(), last = run.last, extended = false;
 // Reports passed over since the track's end: still where the bus went. A way to a later report that does not pass
 // them is not its way: a 52's track took a 526 m way round a block its report 20 s earlier was not on, and the bus
 // drawn there was moved 40 m across (the fleet check, 30 September 2026).
 const passed: Fix[] = [];
 for (const f of fresh) {
  const sb = end ? snap(g, f, headingOf(fixes, fixes.indexOf(f))) : null;
  why?.push(!end ? 'track end off the streets' : !sb ? 'report off the streets' : f.at - last.at > STREETS.maxGapMs ? 'gap' : 'try');
  // A report off the streets, or one the streets do not join to the track's end in the time (a GPS fault, a
  // stand), is passed over: the track waits at its end and the next report is tried from there. Stopping at it
  // left the track stuck while the bus drove on, and started it again later under the bus (the fleet check).
  if (!end || !sb || f.at - last.at > STREETS.maxGapMs) { passed.push(f); continue; }
  if (backAtEnd(points, sb, g.kx)) { last = {...f, lat: last.lat, lon: last.lon}; extended = true; continue; }
  const way = route(g, end, sb, allowance(last, f));
  if (!way) { why?.push(`no way within ${Math.round(allowance(last, f))} m`); passed.push(f); continue; }
  if (passed.some(q => offWay(q, way.points, g.kx) > STREETS.snapMetres)) { why?.push('not past the reports passed over'); passed.push(f); continue; }
  append(points, way.points, g.kx);
  why?.push(`joined ${Math.round(way.length)} m`);
  end = sb; last = f; extended = true; passed.length = 0;
 }
 // Left behind for longer than the drawing ever runs behind its reports: the drawn bus is past the track's end, so
 // starting it again from the reports as they are moves nothing already drawn. Until then, and whenever a fresh
 // start finds nothing, the track the bus has is kept: taking it away mid-drawing moved the bus (the fleet check).
 // (Going on from the old track through a straight join instead drew buses behind at the join: 'late' repositionings
 // 4 to 10, and three buses over 75 s behind while moving, the fleet check.)
 if (newest.at - last.at > STREETS.restartMs) return start() ?? run;
 if (!extended) return run;
 // Only what was added is tidied, from the old tip on: what the bus may already be drawn along stays as it was. A
 // spur cut back into the old track leaves nothing to tidy past it.
 const kept = Math.min(run.points.length, points.length);
 let same = 0;
 while (same < kept && points[same] === run.points[same]) same++;
 if (same >= 1 && points.length > same) points = [...points.slice(0, same - 1), ...tidy(points.slice(same - 1), g.kx)];
 // Kept to the last few kilometres: only the reports the page holds are ever measured onto it.
 let track = makeTrack(`street:${id}`, points);
 if (track.length > STREETS.keepMetres * 1.5) {
  const from = track.cum.findIndex(c => c >= track.length - STREETS.keepMetres);
  points = points.slice(Math.max(0, from - 1));
  track = makeTrack(`street:${id}`, points);
 }
 return {id, points, last, track};
}

/** For measuring (scripts/street-joins.mjs): whether the streets join two reports, and why not. */
export function joinReports(a: Fix, b: Fix, lines: StreetLine[]): {ok: boolean; why: string; length?: number} {
 const g = buildGraph(lines, b.lat);
 const heading = metres(a, b) >= 10 ? (Math.atan2((b.lon - a.lon) * Math.cos(b.lat * RAD), b.lat - a.lat) / RAD + 360) % 360 : null;
 const sa = snap(g, a, a.bearing ?? heading), sb = snap(g, b, b.bearing ?? heading);
 if (!sa || !sb) return {ok: false, why: !sa ? 'first off the streets' : 'second off the streets'};
 const way = route(g, sa, sb, allowance(a, b));
 if (way) return {ok: true, why: 'joined', length: way.length};
 const far = route(g, sa, sb, 5000);
 return {ok: false, why: far ? `only the long way (${Math.round(far.length)} m for ${Math.round(metres(a, b))} m)` : 'not joined at all'};
}

/** For measuring: where the streets around two unjoined reports come apart — the nearest two points of the pieces
 *  each report is on, and whether either is a street's loose end (a dead end, or a join the map lost). */
export function gapBetween(a: Fix, b: Fix, lines: StreetLine[]): {metres: number; at: [number, number]; looseEnd: boolean} | null {
 const g = buildGraph(lines, b.lat), sa = snap(g, a), sb = snap(g, b);
 if (!sa || !sb) return null;
 const reach = (s: Snap) => {
  const seen = new Set<number>([g.segs[s.seg].a, g.segs[s.seg].b]), stack = [...seen];
  while (stack.length) { const n = stack.pop()!; for (const m of g.near[n]) if (!seen.has(m)) { seen.add(m); stack.push(m); } }
  return seen;
 };
 const A = reach(sa), B = reach(sb);
 if ([...A].some(n => B.has(n))) return null;
 let best: {metres: number; at: [number, number]; looseEnd: boolean} | null = null;
 for (const x of A) for (const y of B) {
  const d = Math.hypot((g.lon[x] - g.lon[y]) * g.kx, (g.lat[x] - g.lat[y]) * M);
  if (!best || d < best.metres) best = {metres: d, at: [g.lon[x], g.lat[x]], looseEnd: g.near[x].length === 1 || g.near[y].length === 1};
 }
 return best;
}

/** A street track is the map's streets between reports, never a road checked against the service's own. */
export const isStreetTrack = (track: Track | null | undefined) => !!track && track.id.startsWith('street:');
