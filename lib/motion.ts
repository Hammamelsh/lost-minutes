/**
 * Where a selected bus has probably got to since its last report, kept apart from where it
 * reported.
 *
 * Three things are never merged:
 *   reports    immutable observations with their own timestamps (Fix), from the feed
 *   estimate   the vehicle state at a presentation time, re-derived from the reports
 *   visual     the position actually drawn, which follows the estimate smoothly
 *
 * The estimate moves only along evaluated road geometry, at a speed read from the bus's own
 * recent reports, for no longer than a measured horizon. When any of that is missing it says
 * so and falls back to the last reported position. A new report is reconciled at its own
 * observation time and brought forward to the presentation time. The drawn bus follows the
 * estimate's own path, smoothed over the few seconds of it that are already known, with a speed
 * that only changes gradually: it eases into a pause at a stop, never jumps, and a small
 * correction backwards slows it rather than reversing it. An estimate is never an observation:
 * it is not published, stored, or used to say that a bus reached, left or served a stop.
 */

export type LonLat = [number, number];

/** One report, as received. `service` ties reports of the same journey together. */
export type Fix = {
 at: number;                     // observation time, ms
 lat: number; lon: number;
 bearing: number | null;         // reported heading, degrees; null when not reported
 availableAt?: number | null;    // when it was fetched: nothing could know it earlier
 service: string;                // route|direction|journeyRef
 source?: string | null;         // SHA-256 of the source file
};

/** Road geometry, with the timetabled stops' offsets along it where the shape carries them. */
export type Track = {id: string; points: LonLat[]; cum: number[]; length: number; stops: number[]};

// ------------------------------------------------------------------ geometry

const EARTH = 6371008.8;
const RAD = Math.PI / 180;

/** Metres between two nearby points (equirectangular: exact enough over a few km). */
export function metres(a: {lat: number; lon: number}, b: {lat: number; lon: number}) {
 const x = (b.lon - a.lon) * Math.cos(((a.lat + b.lat) / 2) * RAD) * EARTH * RAD;
 const y = (b.lat - a.lat) * EARTH * RAD;
 return Math.hypot(x, y);
}

const at = (p: LonLat) => ({lon: p[0], lat: p[1]});

export function makeTrack(id: string, points: LonLat[], stops: (number | null)[] = []): Track {
 const cum = [0];
 for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + metres(at(points[i - 1]), at(points[i])));
 const length = cum[cum.length - 1] ?? 0;
 // A stop the shape could not place is null and is simply not a pause; the rest are kept in order.
 const placed = stops.filter((s): s is number => typeof s === 'number' && Number.isFinite(s) && s >= 0 && s <= length)
  .sort((a, b) => a - b);
 return {id, points, cum, length, stops: placed};
}

/** Google's encoded polyline, as the published shapes carry it. */
export function decodePolyline(text: string, precision = 5): LonLat[] {
 const factor = 10 ** precision, points: LonLat[] = [];
 let index = 0, lat = 0, lon = 0;
 const next = () => {
  let result = 0, shift = 0, byte: number;
  do { byte = text.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
  return result & 1 ? ~(result >> 1) : result >> 1;
 };
 while (index < text.length) { lat += next(); lon += next(); points.push([lon / factor, lat / factor]); }
 return points;
}

type Projection = {s: number; offset: number};

function projectSegments(track: Track, p: {lat: number; lon: number}, from: number, to: number): Projection {
 const kx = Math.cos(p.lat * RAD) * EARTH * RAD, ky = EARTH * RAD;
 let best: Projection = {s: 0, offset: Infinity};
 for (let i = Math.max(0, from); i < Math.min(track.points.length - 1, to); i++) {
  const [ax, ay] = track.points[i], [bx, by] = track.points[i + 1];
  const dx = (bx - ax) * kx, dy = (by - ay) * ky, px = (p.lon - ax) * kx, py = (p.lat - ay) * ky;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.min(1, Math.max(0, (px * dx + py * dy) / len2)) : 0;
  const offset = Math.hypot(px - t * dx, py - t * dy);
  if (offset < best.offset) best = {s: track.cum[i] + t * (track.cum[i + 1] - track.cum[i]), offset};
 }
 return best;
}

/**
 * Nearest point of the track to a position. With `near` (metres along the track) a match close
 * to the expected place is preferred when it fits about as well, so a road used twice by one
 * route does not send the estimate to the wrong pass.
 */
export function project(track: Track, p: {lat: number; lon: number}, near?: number): Projection {
 const global = projectSegments(track, p, 0, track.points.length);
 if (near === undefined) return global;
 const lo = segmentAt(track, Math.max(0, near - 400)), hi = segmentAt(track, Math.min(track.length, near + 3000)) + 1;
 const local = projectSegments(track, p, lo, hi);
 return local.offset <= global.offset + 25 ? local : global;
}

function segmentAt(track: Track, s: number) {
 let lo = 0, hi = track.cum.length - 1;
 while (lo < hi - 1) { const mid = (lo + hi) >> 1; if (track.cum[mid] <= s) lo = mid; else hi = mid; }
 return lo;
}

export function pointAt(track: Track, s: number): {lat: number; lon: number} {
 if (!track.points.length) return {lat: 0, lon: 0};
 const clamped = Math.min(track.length, Math.max(0, s));
 const i = segmentAt(track, clamped);
 const a = track.points[i], b = track.points[Math.min(i + 1, track.points.length - 1)];
 const span = track.cum[Math.min(i + 1, track.cum.length - 1)] - track.cum[i];
 const t = span > 0 ? (clamped - track.cum[i]) / span : 0;
 return {lon: a[0] + (b[0] - a[0]) * t, lat: a[1] + (b[1] - a[1]) * t};
}

/** Direction of travel along the track at s, degrees from north, read over about 16 m. */
export function headingAt(track: Track, s: number): number {
 const a = pointAt(track, s - 8), b = pointAt(track, s + 8);
 const x = (b.lon - a.lon) * Math.cos(((a.lat + b.lat) / 2) * RAD), y = b.lat - a.lat;
 return (Math.atan2(x, y) / RAD + 360) % 360;
}

/** How far ahead the drawn bus looks for its heading: about a bus's length. */
const HEADING_AHEAD = 12;

/**
 * The drawn heading: towards the road a bus's length ahead, so a bend is turned into gradually,
 * as a bus turns, instead of the drawn bus (and the ride-along camera) rotating at each vertex of
 * the road shape.
 */
export function headingAhead(track: Track, s: number): number {
 const to = Math.min(track.length, s + HEADING_AHEAD);
 if (to - s < 2) return headingAt(track, s);
 const a = pointAt(track, s), b = pointAt(track, to);
 const x = (b.lon - a.lon) * Math.cos(((a.lat + b.lat) / 2) * RAD), y = b.lat - a.lat;
 return (Math.atan2(x, y) / RAD + 360) % 360;
}

/** The part of the track between two distances, for drawing an estimate or its uncertainty. */
export function slice(track: Track, s0: number, s1: number): LonLat[] {
 const lo = Math.max(0, Math.min(s0, s1)), hi = Math.min(track.length, Math.max(s0, s1));
 const start = pointAt(track, lo), end = pointAt(track, hi);
 const points: LonLat[] = [[start.lon, start.lat]];
 for (let i = segmentAt(track, lo) + 1; i < track.points.length && track.cum[i] < hi; i++) points.push(track.points[i]);
 points.push([end.lon, end.lat]);
 return points;
}

// ------------------------------------------------------------------ angles

/** The signed turn from one heading to another, the short way round: (-180, 180]. */
export function shortestTurn(from: number, to: number) {
 const turn = ((to - from) % 360 + 540) % 360 - 180;
 return turn === -180 ? 180 : turn;
}

export function turnToward(from: number, to: number, fraction: number) {
 return (from + shortestTurn(from, to) * Math.min(1, Math.max(0, fraction)) + 360) % 360;
}

// ------------------------------------------------------------------ reports

export type History = {fixes: Fix[]; service: string | null};
export type FixEvent = 'first' | 'added' | 'duplicate' | 'out_of_order' | 'service_change' | 'ignored';

export const emptyHistory = (): History => ({fixes: [], service: null});

/**
 * Add a report to a vehicle's history. A duplicate is ignored; a late report of the same
 * journey is filed in time order but never becomes the basis; a newer report of a different
 * journey starts a new history, because the route it follows has changed.
 */
export function addFix(history: History, fix: Fix, keep = 12): {history: History; event: FixEvent} {
 const latest = history.fixes[history.fixes.length - 1];
 if (!latest) return {history: {fixes: [fix], service: fix.service}, event: 'first'};
 if (fix.service !== history.service) {
  return fix.at > latest.at ? {history: {fixes: [fix], service: fix.service}, event: 'service_change'}
                            : {history, event: 'ignored'};
 }
 if (history.fixes.some(f => f.at === fix.at)) return {history, event: 'duplicate'};
 const fixes = [...history.fixes, fix].sort((a, b) => a.at - b.at).slice(-keep);
 return {history: {fixes, service: history.service}, event: fix.at < latest.at ? 'out_of_order' : 'added'};
}

// ------------------------------------------------------------------ parameters

/**
 * The estimator's settings. maxSpeed, speedWindow and horizon are fitted on training captures
 * when a motion evaluation is published (public/data/motion-evaluation.json says which, and how);
 * the rest are fixed choices. settle, holdBack, turnSettle, largeCorrection and catchUp are
 * recorded with an evaluation as the drawing choices it was made with (holdBack and
 * largeCorrection are also what it counts corrections by); the page draws with DRAWING, below,
 * which never changes where the estimate is. The defaults keep the page usable before an
 * evaluation exists.
 */
export type MotionParams = {
 version: string;
 maxSpeed: number;            // m/s along the route; faster readings are capped
 stationarySpeed: number;     // below this the bus is treated as standing
 minSpan: number;             // s: reports closer than this are too close to read speed from
 speedWindow: number;         // s: speed is read over up to this much recent history
 maxGap: number;              // s: reports further apart than this give no speed
 horizon: number;             // s: movement is extrapolated for at most this long
 decay: number;               // s: the estimate's speed eases off with report age at this time constant; 0 keeps it constant
 stale: number;               // s: beyond this report age nothing is estimated
 offTrack: number;            // m: a report further than this from the geometry is not placed on it
 backwardTolerance: number;   // m: GPS noise allowed before reports count as going backwards
 largeCorrection: number;     // m: a correction bigger than this snaps rather than glides
 settle: number;              // s: time constant of a visual correction
 holdBack: number;            // m: a smaller backward correction, while moving, is held not reversed
 turnSettle: number;          // s: time constant of turning the drawn bus
 catchUp: number;             // m/s: a correction is absorbed no faster than this, on top of the bus's own movement
 // Stops. Buses pause at timetabled stops, and the reports show it: the estimate can allow for
 // that instead of easing every speed off everywhere.
 dwell: number;               // s: the pause allowed at each timetabled stop the estimate passes; 0 ignores stops
 stopTolerance: number;       // m: a report this close before a stop is taken to be at it, so it is not paused twice
 cruise: boolean;             // read speed from the stretches between reports where the bus moved, not the whole window
 standingMetres: number;      // m: two reports closer than this along the road show the bus standing
 standingHold: number;        // s: a bus standing at its last reports is held there this long after them before it is moved on
};

export const DEFAULT_PARAMS: MotionParams = {
 version: 'motion-1 (unevaluated defaults)', maxSpeed: 17, stationarySpeed: 0.6, minSpan: 8,
 speedWindow: 45, maxGap: 120, horizon: 30, decay: 0, stale: 150, offTrack: 40, backwardTolerance: 25,
 largeCorrection: 150, settle: 0.9, holdBack: 35, turnSettle: 0.35, catchUp: 15,
 dwell: 0, stopTolerance: 20, cruise: false, standingMetres: 8, standingHold: 0,
};

// ------------------------------------------------------------------ the estimate

export type Estimate = {
 mode: 'estimated' | 'observed';
 reason: string;              // plain words: why this mode
 lat: number; lon: number; bearing: number | null;
 s: number | null;            // metres along the track
 basis: Fix;                  // the report the estimate starts from
 reportAge: number;           // s since the basis report, at the presentation time
 horizon: number;             // s of extrapolation actually applied
 capped: boolean;             // older than the horizon: movement is paused at the bound
 speed: number | null;        // m/s along the track
 speedBasis: string | null;
 provisional?: boolean;       // shown at its report only while the settings or road geometry load
 held?: boolean;              // standing at its last reports, and held there for now
 resumeAt?: number | null;    // ms: when a held estimate would move on, if no report comes first
 path?: EstimatePath;         // how it moves on from its report until the next one arrives
};

/**
 * The estimate's path from its report: everything that makes where it is a function of time
 * alone, so the page can read where the same estimate puts the bus a moment earlier or later.
 */
export type EstimatePath = {
 from: number;                // m along the track: where the report is
 speed: number;               // m/s it moves on at; 0 standing
 wait: number;                // s it stays at the report first (a standing hold); otherwise 0
 decay: number; horizon: number; dwell: number; stopTolerance: number;
};

type Speed = {speed: number | null; basis: string; standingNow?: boolean; cruise?: number | null};

function speedAlong(history: History, track: Track, params: MotionParams, sLatest: number): Speed {
 const all = history.fixes, latest = all[all.length - 1];
 if (all.length < 2) return {speed: null, basis: 'waiting for a second report to read its movement'};
 // Where each report lies along the road, each placed near the one after it, so a road the
 // route uses twice does not send an earlier report to the wrong pass.
 const along = new Array<number>(all.length);
 along[all.length - 1] = sLatest;
 for (let i = all.length - 2; i >= 0; i--) along[i] = project(track, all[i], along[i + 1] - 50).s;
 const span = params.minSpan * 1000;
 const readableBefore = (j: number) => { for (let i = j - 1; i >= 0; i--) if (all[j].at - all[i].at >= span) return i; return -1; };
 // A step further than a bus travels in that time is a jump (a GPS fault, or a report far from
 // the one before), not a speed. Speed is read only from the reports since the latest jump, so
 // nothing is extrapolated from the jump itself, and after it only once another report follows.
 let from = 0;
 for (let j = all.length - 1; j > 0 && from === 0; j--) {
  const i = readableBefore(j);
  if (i < 0) continue;
  const dt = (all[j].at - all[i].at) / 1000;
  if (dt <= params.maxGap && Math.abs(along[j] - along[i]) / dt > params.maxSpeed * 1.5) from = j;
 }
 if (from === all.length - 1) return {speed: null, basis: 'its last report jumped further than a bus travels in that time'};
 const earlier: number[] = [];
 for (let i = from; i < all.length - 1; i++) if (latest.at - all[i].at >= span) earlier.push(i);
 if (!earlier.length) return {speed: null, basis: from > 0
  ? 'its reports jumped further than a bus travels, and too few have followed to read its speed'
  : 'its reports are too close together to read movement'};
 const within = earlier.filter(i => latest.at - all[i].at <= params.speedWindow * 1000);
 const previous = within[0] ?? earlier[earlier.length - 1];
 const dt = (latest.at - all[previous].at) / 1000;
 if (dt > params.maxGap) return {speed: null, basis: `its last reports are ${Math.round(dt)} s apart`};
 const ds = sLatest - along[previous];
 if (ds < -params.backwardTolerance) return {speed: null, basis: 'its reports went backwards along the route'};
 let speed = Math.max(0, ds) / dt;
 // The chain of readable reports back from the latest, each at least minSpan before the next:
 // the stretches between them show where the bus moved and where it stood.
 const chain = [all.length - 1];
 for (let i = readableBefore(chain[chain.length - 1]); i >= previous && i >= from; i = readableBefore(i)) chain.push(i);
 let movingMetres = 0, movingSeconds = 0;
 for (let k = 0; k + 1 < chain.length; k++) {
  const j = chain[k], i = chain[k + 1], step = along[j] - along[i], seconds = (all[j].at - all[i].at) / 1000;
  if (step >= params.standingMetres) { movingMetres += step; movingSeconds += seconds; }
 }
 const cruise = movingSeconds >= params.minSpan ? Math.min(params.maxSpeed, movingMetres / movingSeconds) : null;
 const standingNow = chain.length > 1 && along[chain[0]] - along[chain[1]] < params.standingMetres;
 if (speed < params.stationarySpeed) return {speed: 0, basis: `standing: ${Math.round(Math.max(0, ds))} m in ${Math.round(dt)} s`,
  standingNow, cruise};
 const capped = speed > params.maxSpeed;
 speed = Math.min(speed, params.maxSpeed);
 if (params.cruise && cruise !== null) return {speed: cruise, standingNow, cruise,
  basis: `${Math.round(movingMetres)} m in the ${Math.round(movingSeconds)} s its reports show it moving`};
 return {speed, basis: `${Math.round(ds)} m in ${Math.round(dt)} s between its reports${capped ? ', capped' : ''}`, standingNow, cruise};
}

/**
 * Where a bus at s0 gets to in `seconds` at `speed`, allowing `dwell` seconds at each timetabled
 * stop it reaches on the way. A report within stopTolerance before a stop is taken to be at it
 * already, so that stop is not paused for again.
 */
export function advance(track: Track, s0: number, speed: number, seconds: number,
                        params: Pick<MotionParams, 'dwell' | 'stopTolerance'> = DEFAULT_PARAMS): number {
 if (speed <= 0 || seconds <= 0) return s0;
 if (!(params.dwell > 0) || !track.stops.length) return s0 + speed * seconds;
 let s = s0, t = seconds;
 for (const stop of track.stops) {
  if (stop <= s0 + params.stopTolerance) continue;
  const need = (stop - s) / speed;
  if (t <= need) return s + speed * t;
  s = stop; t -= need;
  if (t <= params.dwell) return s;
  t -= params.dwell;
 }
 return s + speed * t;
}

/** The estimated state at a presentation time, from the reports available by then. */
export function estimate(history: History, track: Track | null, when: number, params = DEFAULT_PARAMS): Estimate {
 const latest = history.fixes[history.fixes.length - 1];
 const reportAge = Math.max(0, (when - latest.at) / 1000);
 const observed = (reason: string): Estimate => ({mode: 'observed', reason, lat: latest.lat, lon: latest.lon,
  bearing: latest.bearing, s: null, basis: latest, reportAge, horizon: 0, capped: false, speed: null, speedBasis: null});
 if (!track || track.points.length < 2) return observed('no evaluated road geometry for this service');
 const place = project(track, latest);
 if (place.offset > params.offTrack)
  return observed(`its last report is ${Math.round(place.offset)} m from the route’s road geometry`);
 if (reportAge > params.stale) return observed('its last report is too old to estimate from');
 const speed = speedAlong(history, track, params, place.s);
 if (speed.speed === null) return observed(speed.basis);
 // Its last two reports lie within standingMetres of each other along the road while the window
 // still reads a moving speed: a bus at a stop or at lights whose earlier reports were moving.
 // Projecting it forward was the fault reproduced on 21 September 2026 (81–103 m past a standing
 // route-15 bus, then a 179 m snap back), and no hold length cured it. With no hold configured
 // it is not projected at all: it stands at its report, in observed mode, and estimation resumes
 // at its first moving report. The cost, stated: that first moving report is a whole interval of
 // travel away, and the drawn bus catches it up as a correction — eased under 150 m, a snap above.
 if (speed.standingNow && speed.speed > 0 && params.standingHold === 0)
  return {...observed('its last reports show it standing'), held: true};
 const horizon = Math.min(reportAge, params.horizon);
 let s = place.s, held = false, resumeAt: number | null = null, applied = speed.speed, wait = 0;
 if (speed.standingNow && params.standingHold > 0 && speed.speed > 0) {
  // Its last reports show it standing (a stop, or lights). It is held there for a measured
  // while after the latest one, then moved on at the speed its reports show while moving.
  resumeAt = latest.at + params.standingHold * 1000;
  wait = params.standingHold;
  const go = horizon - params.standingHold;
  if (go <= 0) held = true;
  else s = advance(track, place.s, speed.speed, go, params);
 } else if (speed.speed > 0) {
  // With a decay time the distance eases off as speed × decay × (1 − e^(−t/decay)); with a dwell
  // time the bus pauses at each timetabled stop it reaches instead.
  const travelled = params.decay > 0 ? params.decay * (1 - Math.exp(-horizon / params.decay)) : horizon;
  s = advance(track, place.s, speed.speed, travelled, params);
 } else applied = 0;
 s = Math.min(track.length, Math.max(0, s));
 const point = pointAt(track, s);
 return {mode: 'estimated', reason: applied === 0 || held ? 'standing at its last reports' : 'moving along its route',
  lat: point.lat, lon: point.lon, bearing: headingAt(track, s), s, basis: latest, reportAge, horizon,
  capped: reportAge > params.horizon, speed: applied, speedBasis: speed.basis, held, resumeAt,
  path: {from: place.s, speed: applied, wait, decay: wait > 0 ? 0 : params.decay, horizon: params.horizon,
   dwell: params.dwell, stopTolerance: params.stopTolerance}};
}

/**
 * Where the same estimate puts the bus at another moment, from the same reports: the path it
 * follows until the next report arrives. For every moment the estimate covers this is exactly
 * `estimate(history, track, when).s` (a test checks it); before its report it is carried back
 * at the speed it starts with, so the path has no corner there. Nothing here is new movement:
 * it is only the estimate read at another time.
 */
export function alongAt(track: Track, e: Estimate, when: number): number | null {
 const p = e.path;
 if (e.mode !== 'estimated' || !p || e.s === null) return e.s;
 const age = (when - e.basis.at) / 1000;
 let s = p.from;
 if (age < 0) s = p.wait > 0 ? p.from : p.from + p.speed * age;
 else if (p.speed > 0) {
  const t = Math.min(age, p.horizon) - p.wait;
  if (t > 0) s = advance(track, p.from, p.speed, p.decay > 0 ? p.decay * (1 - Math.exp(-t / p.decay)) : t, p);
 }
 return Math.min(track.length, Math.max(0, s));
}

/** The last report itself, with the reason no estimate is drawn. `provisional` while loading. */
export function observedAt(history: History, when: number, reason: string, provisional = false): Estimate {
 const latest = history.fixes[history.fixes.length - 1];
 return {mode: 'observed', reason, lat: latest.lat, lon: latest.lon, bearing: latest.bearing, s: null,
  basis: latest, reportAge: Math.max(0, (when - latest.at) / 1000), horizon: 0, capped: false,
  speed: null, speedBasis: null, provisional};
}

/** Build a history from reports in any order, as an evaluation replays them. */
export function historyFrom(fixes: Fix[]): History {
 let history = emptyHistory();
 for (const fix of [...fixes].sort((a, b) => a.at - b.at)) history = addFix(history, fix).history;
 return history;
}

// ------------------------------------------------------------------ the drawn position

export type Correction = 'none' | 'smooth' | 'hold' | 'snap';

/**
 * How the drawn bus follows the estimate. None of this changes where the estimate is, or any
 * evaluated number: it shapes only what is drawn from one frame to the next.
 */
export type Drawing = {
 smoothing: number;       // s: the estimate's own path is averaged over this much of its known past and future,
                          //    so a pause at a stop, a hold or the end of the horizon is eased into beforehand
 approachAccel: number;   // m/s²: the drawn bus speeds up or slows down no faster than this
 catchUp: number;         // m/s: a correction is absorbed no faster than this, on top of the path's own speed
 settle: number;          // s: the time constant a correction ends in, so it lands softly
 holdBack: number;        // m: moving, a smaller correction backwards slows the drawn bus but never reverses it
 crawl: number;           // share of the path's own speed kept while waiting for the estimate; 0 stands still
 largeCorrection: number; // m: a correction bigger than this snaps rather than glides, and says so
 turnSettle: number;      // s: time constant of turning the drawn bus
};

/** Gentle enough that a typical 50 m correction reads as the bus speeding up for a few seconds,
 *  not as a lurch (measured in docs/LOCAL_VERIFICATION.md). Waiting at half the path's speed rather
 *  than standing cut the drawn stands its own reports contradict from 11.9 to 3.2 an hour on fresh
 *  captures, with held-out error and display lag no worse (docs/MOTION_MODEL.md). */
export const DRAWING: Drawing = {smoothing: 3, approachAccel: 3, catchUp: 12, settle: 2, holdBack: 35, crawl: 0.5,
 largeCorrection: 150, turnSettle: 0.35};

/**
 * The drawing for one frame: the hold widened to the estimate's own measured error at this
 * report age (8 in 10 held-out cases lie within it). A report that finds the drawn bus ahead of
 * a moving estimate by no more than the estimate could itself be out slows the drawn bus to a
 * crawl and lets the estimate catch up, rather than reversing it; beyond that it glides back, and
 * past largeCorrection it snaps.
 */
export function drawingFor(e: Estimate, profile: ErrorProfile | null | undefined, draw: Drawing = DRAWING): Drawing {
 const band = uncertaintyAt(profile, e.reportAge);
 return band && band.metres > draw.holdBack ? {...draw, holdBack: Math.min(band.metres, draw.largeCorrection)} : draw;
}

export type Visual = {
 mode: 'estimated' | 'observed';
 s: number | null; lat: number; lon: number; bearing: number | null;
 heading: number | null;       // the heading the drawn bus is turning towards
 offset: number;               // drawn minus estimated, metres along the track
 velocity: number;             // the drawn bus's speed along the road, m/s: it changes gradually, never jumps
 goal: number | null;          // where the drawn bus is heading for: the estimate's path, smoothed (goalAt)
 goalSpeed: number;            // how fast that goal moves, m/s
 trackId: string | null;
 basisAt: number;              // the report the current estimate starts from
 frame: number;                // presentation time of this frame, ms
 correction: Correction;
 /** `why` is set only for a repositioning, and says which continuity was missing. */
 lastCorrection: {kind: Correction; metres: number; at: number; why?: RepositionReason} | null;
 provisional: boolean;         // drawn at its report only while loading
 /** A bus shown at its reports, moving from the report it was drawn at to the one that has just
  *  arrived. Both ends are observed positions. `road` is set only where both of them lie on the
  *  same checked road shape, and then the bus travels down that road; without it the line between
  *  them is a straight line and is not claimed to be road. */
 glide: {fromLat: number; fromLon: number; toLat: number; toLon: number; at: number; ms: number;
         road: {trackId: string; fromS: number; toS: number;
                /** How far each end lies off the road: the travel follows the road's shape but
                 *  still starts and ends exactly where the bus was drawn and where it reported. */
                fromOff: [number, number]; toOff: [number, number]} | null} | null;
 /** A bus drawn at its reports, played back a bounded time behind them (PLAYBACK): the moment
  *  being shown, the delay it is shown at, and the arrival lags that delay is sized from. */
 buffer: {shown: number; delay: number; lags: number[];
          /** An ease in progress where a late-filed report moved the path under the bus. */
          ease: {fromLat: number; fromLon: number; at: number; ms: number} | null;
          /** The drawn bus along its path: distance, speed (m/s), the path's end, whether it is on
           *  the checked road, and the path itself keyed by its reports' times. */
          sd: number; vd: number; end: number; goalS: number; k: number; onRoad: boolean; roadS: number | null; pathKey: string; path: unknown;
          /** The report-time moment the drawn place stands for (what "drawn N s behind" is measured
           *  from), and, while it waits for fresh reports after a pause in drawing, when it began. */
          represented?: number; resume?: number | null;
          /** The furthest the clock may run on the reports it has: when it stands here, the frame loop
           *  may rest, and a gap in frames is not a pause in drawing. */
          latestAt?: number} | null;
};

/**
 * Why a bus was repositioned rather than travelled to its new report. Each is a fact about the
 * evidence, not about the app: there was nothing to travel from, the move is too far to have been
 * followed, or too long went unseen. The passenger is told which.
 */
export type RepositionReason = 'no_earlier_report' | 'too_far' | 'too_long' | 'resumed';

/**
 * Moving a bus shown at its reports from one report to the next.
 *
 * A bus with no accepted road geometry is drawn where it reported, and until 20 September 2026
 * that meant it stood still for twenty seconds and then teleported the 150 m its next report had
 * moved. Nothing about that is more honest than moving it: both ends are observed positions, and
 * the passenger reads a jump as the app losing the bus.
 *
 * The first attempt travelled the whole way in 900 ms and then waited, which removed the teleport
 * and left a hop every twenty seconds — measured at 96% of frames standing still. So the journey
 * between two reports now takes **the time the bus itself took to make it**: the drawn bus leaves
 * the earlier report and arrives at the later one about when the next report is due, and waits
 * there if it is late. It is never carried past the newest report, so what is drawn is always
 * between two positions the bus actually reported, and always older than the newest of them —
 * never newer, which is the direction to err.
 *
 * The straight line between the two is not claimed to be the road, no bearing is taken from the
 * direction of travel, and this is not an estimate: it never goes beyond the evidence. A gap
 * beyond `maxMetres`, or longer than `maxMs`, is left as the step it is, because a bus that moved
 * that far or was away that long was not followed and pretending otherwise would invent a journey.
 * `maxMs` is 45 s from the fleet's own measured cadence on 21 September 2026: consecutive reports
 * are a median 21 s apart, 30 s at the 95th percentile, and only 0.6% of intervals exceed 45 s.
 *
 * The bus is drawn at the speed its own two reports imply. Reports reach the page further apart
 * than they were made — the collector has to publish them and the page has to poll — so the bus
 * arrives at the newest report and waits there until the next comes. It moves at a true speed and
 * then stands, rather than at an invented one stretched to fill the wait.
 */
export const GLIDE = {minMs: 600, maxMs: 45_000, minMetres: 1.5, maxMetres: 400};

/** Under this, a move is scatter around a standing bus rather than a repositioning worth saying. */
export const REPOSITION_METRES = 25;

/**
 * Playing a bus's reports back a bounded time behind them, so that it moves steadily.
 *
 * GLIDE travelled to each report as it arrived, over the time the bus itself had taken. That
 * removed the teleport, and left the pacing at the mercy of *when reports arrive*: a report is
 * 10–20 s old when the collector publishes it and the page polls every 20 s, so it reaches a phone
 * anywhere from 10 to 40 s after it was made. A glide that ended before the next report arrived
 * left the bus standing; a report that arrived mid-glide cut it short and restarted it a little
 * fast. Measured on the reels of 23 September 2026 the bus was moving in about 63% of frames and
 * standing in the rest, and that stop-start, on a service with no prediction, is what a passenger
 * described as unnatural pacing.
 *
 * So a bus drawn at its reports is now drawn where its reports put it `delay` ago. The display
 * clock runs a little under or over real-time rate behind the presentation clock (`slowestRate`
 * with a thin buffer of reports ahead of the moment shown, up to `fastestRate` with a deep one,
 * and never backwards); the position is read off the two
 * reports that bracket the moment shown — down the checked road where both lie on it, along the
 * chord otherwise — and as long as reports keep arriving before their moment comes round, the
 * bus moves continuously at the speed its own reports imply. It is never drawn past the newest
 * report, and never ahead of a report.
 *
 * The delay is the price, and it is bounded and said. It is sized from the lags actually seen
 * (the median of how old reports were when they arrived, plus `marginMs`) between `minDelayMs`
 * and `maxDelayMs`. When a report is late the clock waits at the newest report and then resumes,
 * recovering the lost ground at no more than `fastestRate` — no sprint. Fallen further behind
 * than a whole delay plus `resyncMs`, it
 * repositions and says so rather than crawling for a minute. A gap the rules refuse (GLIDE's
 * maxMetres and maxMs) is never interpolated across: the bus is repositioned at the later report
 * when the moment shown crosses it, with the reason.
 */
export const PLAYBACK = {
 /** Measured on 27 recorded journeys with arrival lags drawn from 8–38 s (scripts/evaluate-playback.mjs,
  *  23 September 2026): with the rate control below, a 30 s delay had the bus moving in 73% of
  *  frames against GLIDE's 57%, with stalls over five seconds down from 60 an hour to 20 — and 40,
  *  50 and 60 s bought nothing more (74%, 18.5/h, 18.2/h, 17.8/h) while putting the drawn bus 150,
  *  190 and 220 m behind its newest report at the median instead of 110 m. The rest of the standing
  *  is the buses' own: reports that say they stood. So the delay is sized from the median lag seen
  *  plus a margin, and bounded where the measurement says the trade stops paying. */
 /** Re-sized on 24 September 2026 from the trace of a real 219: its reports were made every
  *  20 s and reached the page 16–23 s later, so a delay of median lag + 8 s (28 s) ran dry at
  *  every late report — the clock reached the newest report, the bus braked to a stand, and set
  *  off again when the next arrived: fits and starts. To play continuously the delay has to cover
  *  the lag *and* a report interval, so the margin is a report interval (the fleet's median is
  *  21 s), bounded 30–60 s. The A/B on 27 recorded journeys found 30–60 s indistinguishable in
  *  how much the bus moves; what the extra delay costs is said on the card. */
 minDelayMs: 30_000, maxDelayMs: 60_000, marginMs: 20_000,
 /** The display clock's rate is eased between these as the buffer runs short or long: a little
  *  slower rather than a stop when the next report is late, a little faster rather than a sprint
  *  when it has caught up. Neither is a speed a passenger would read as wrong. */
 slowestRate: 1, fastestRate: 1.05,
 /** Behind the delay by more than this, the clock is repositioned (and says so) rather than left
  *  to crawl back at `fastestRate`. It was 45 s, which let the drawing sit up to 105 s behind for
  *  minutes: on 24 September 2026 a route-43 ride read "drawn about 75 s behind", and a 90 s gap in
  *  publications left it 87 s behind a minute after they resumed. */
 resyncMs: 15_000,
 /** While the reports say the bus stood, the clock may run this much faster to make up time it
  *  lost waiting for late reports: a standing bus looks the same at any rate, so nothing moves
  *  faster than it should — the stand is only shorter. */
 standingRate: 4,
};

/**
 * Which way the drawn bus faces, and how fast it may turn. It faces the way it is drawn
 * travelling: along its checked road where it is on the road, along the straight line where it is
 * between two reports off the road, and as it was while it stands. Until 24 September 2026 a
 * played-back bus faced the *reported* bearing of the next report the clock was heading for — a
 * different moment from where it was drawn — so on Portland Street a route-43 bus faced the street
 * it would turn into a minute later, 90–100° across its own road, and the ride-along camera, which
 * takes the drawn heading, spun the whole view in one frame at each new report; a report with no
 * bearing turned the bus into a round token. The reported bearing is still what the report says,
 * in "How we know this"; this is only which way the drawn bus is pointed.
 */
export const HEADING = {settleMs: 450, maxDegPerSecond: 90};

const median = (xs: number[]) => {
 if (!xs.length) return 0;
 const s = [...xs].sort((a, b) => a - b);
 return s[Math.floor(s.length / 2)];
};

/** The delay the playback runs at, from the arrival lags seen so far: bounded either way. */
export function playbackDelay(lags: number[]): number {
 return Math.max(PLAYBACK.minDelayMs, Math.min(PLAYBACK.maxDelayMs, median(lags) + PLAYBACK.marginMs));
}

/** The two reports bracketing a moment, and how far between them it falls. */
function bracket(fixes: Fix[], at: number): {i: number; f: number} {
 let i = 0;
 while (i + 1 < fixes.length && fixes[i + 1].at <= at) i++;
 if (i + 1 >= fixes.length) return {i, f: 0};
 const span = fixes[i + 1].at - fixes[i].at;
 return {i, f: span > 0 ? Math.max(0, Math.min(1, (at - fixes[i].at) / span)) : 1};
}

/** Whether two consecutive reports may be travelled between at all (GLIDE's rules). A long
 *  silence that ends a few metres away is a bus that stood there, not a journey to invent: only
 *  a silence that ends further off than scatter is refused. */
function travelable(a: Fix, b: Fix): RepositionReason | null {
 const gap = metres(a, b);
 if (gap > GLIDE.maxMetres) return 'too_far';
 if (b.at - a.at > GLIDE.maxMs && gap > REPOSITION_METRES) return 'too_long';
 return null;
}

// ------------------------------------------------------------------ the playback path

/** How the drawn bus may change speed: within what buses do. The fleet's own reports, averaged
 *  over 20 s segments, imply accelerations under 0.82 m/s² (p99 0.53, 2,086 segments of the
 *  27 recorded journeys); measured on real buses, accelerating peaks at about 1.4 m/s² over
 *  13 s and braking at 1.8 m/s² over 10 s (Characterisation of Real-World Bus Acceleration and
 *  Deceleration Signals). The drawn bus is held inside those: it pulls away and slows as a bus
 *  does, and never sprints. */
export const PACE = {accelMps2: 1.0, brakeMps2: 1.5, maxMps: 22, catchUpSeconds: 6, overSpeed: 1.12,
 /** How much over the reports' own speed the bus may run to close a gap the reports opened. */
 closingMps: 4,
 /** The reports' own timing is jerky: a real 219 reported 207 m in 24 s, 16 m in 17 s, 345 m in
  *  28 s, 67 m in 16 s along open road (24 September 2026), which no bus does. A drawing that
  *  reaches every report at its exact moment must surge like that. The place shown is instead the
  *  path's average over the previous `smoothMs` — a causal box filter: monotone, never ahead of
  *  any report, never reshaped by a later one — which smooths the pace at the cost of about half
  *  that window in added lag, said on the card. While no newer report is known the place shown
  *  stops short of the newest by that half-window's travel and waits for the next report: the
  *  newest report's own ring on the map shows where the bus really was. */
 smoothMs: Number(process.env.LM_SMOOTH_MS ?? 24_000)};

/**
 * A bus's reports as one path to play back along. Each report is projected onto the checked road
 * where it lies on it (within `offTrack`); consecutive reports are joined by the road between them
 * where both are on it, in order, and the road is not the long way round, and by the straight
 * chord otherwise; a pair GLIDE's rules refuse is not joined at all — the bus waits at the earlier
 * report and is repositioned, said, when the moment shown crosses it. `S` is the distance along
 * the path at each report, so a moment between two reports has one place on it.
 *
 * Until 24 September 2026 the road travel carried each report's own offset from the road across
 * the stretch, so a bus whose reports sat 15–35 m beside the road was drawn beside it, and the
 * heading came from the report rather than the road: what the owner saw as a bus "not in line
 * on the road" on Rochdale Road and Wilmslow Road. On the road, the bus is drawn on the road.
 */
export type PathNode = {fix: Fix; S: number; onRoad: boolean; roadS: number; road: boolean; jump: RepositionReason | null};
export type Path = {nodes: PathNode[]; road: Track | null; key: string; tangents: number[]};

/** How far a report whose own bearing agrees with its road may lie from it and still be placed on it. */
export const BEARING_AGREED_METRES = 50;
/** A reported bearing agrees with the road where they differ by no more than this. */
const AGREE_DEGREES = 45;
/** Within this of the road a report is on it whatever its bearing says: a bearing is the report's
 *  own, and can be stale or noisy (at a stand, say); it chooses a place only for a report further off. */
const ON_ROAD_WHATEVER_BEARING = 20;

/**
 * Where a report sits on its road: the nearest place, unless the report carries a bearing that the
 * nearest place does not face, and a place within BEARING_AGREED_METRES along the way ahead does.
 * On 24 September 2026 a route-43 bus's reports ran 18–44 m to one side of its accepted road for two
 * minutes in the city centre — two other 43s crossed the same stretch within 20 m of it, and every
 * one of its bearings matched the road's direction — and the report taken on the corner of Whitworth
 * Street and Oxford Street, facing 150°, lay nearest the Whitworth Street arm (242°), 43.5 m off: just
 * outside `offTrack`, it was drawn where it was made, and the bus crossed the block to it. Facing
 * Oxford Street it is 44 m from the road, in order, at a bus's pace.
 */
function placeOnRoad(road: Track, fix: Fix, near: number | undefined): {s: number; offset: number; agrees: boolean | null} {
 const p = project(road, fix, near);
 if (fix.bearing === null || fix.bearing === undefined || p.offset <= ON_ROAD_WHATEVER_BEARING) return {s: p.s, offset: p.offset, agrees: null};
 if (Math.abs(shortestTurn(fix.bearing, headingAt(road, p.s))) <= AGREE_DEGREES) return {s: p.s, offset: p.offset, agrees: true};
 const from = Math.max(0, (near ?? p.s) - 60), to = Math.min(road.length, Math.max(near ?? p.s, p.s) + 400);
 let best: {s: number; offset: number} | null = null;
 for (let s = from; s <= to; s += 3) {
  const q = pointAt(road, s), d = metres(q, fix);
  if (d <= BEARING_AGREED_METRES && (!best || d < best.offset) && Math.abs(shortestTurn(fix.bearing, headingAt(road, s))) <= AGREE_DEGREES) best = {s, offset: d};
 }
 // No place facing its way: the nearest stands, under `offTrack` as for a report with no bearing.
 return best ? {...best, agrees: true} : {s: p.s, offset: p.offset, agrees: null};
}

export function buildPath(fixes: Fix[], road: Track | null): Path {
 const nodes: PathNode[] = [];
 let S = 0, prevS: number | undefined;
 for (let i = 0; i < fixes.length; i++) {
  const fix = fixes[i];
  const p = road && road.points.length ? placeOnRoad(road, fix, prevS) : null;
  // On the road: within `offTrack` of it; or, where its own bearing agrees with a place on the road
  // further off, within BEARING_AGREED_METRES of that place. (A first version also refused a report
  // lying on the road because its bearing pointed elsewhere; a stale bearing then turned a bus's road
  // into straight chords that cut its corners.)
  let onRoad = !!p && p.offset <= (p.agrees ? BEARING_AGREED_METRES : DEFAULT_PARAMS.offTrack);
  let roadS = onRoad && p ? p.s : 0;
  let roadSeg = false, jump: RepositionReason | null = null, length = 0;
  if (i > 0) {
   const prev = nodes[i - 1], gap = metres(prev.fix, fix);
   // Two reports a metre apart whose projections land far apart along the road are one place
   // where the road passes twice within reach (a loop at a terminus, both carriageways): the
   // projection is ambiguous there, and the bus is taken to have stood at the earlier one rather
   // than drawn hopping between the two arms (24 September 2026: a 22 m step, unsaid).
   // Only for reports close together: on 24 September 2026 a 250 whose accepted road loops for
   // 1,353 m where the bus drove 302 m straight on had its report pinned back to the previous one's
   // place on the road, and every report after it compared against that pinned place too — the bus
   // was drawn standing while the clock ran on, re-anchored to the wrong pass up to 388 m behind,
   // and at last repositioned 1,181 m. Far apart, the pair is simply not joined by the road: the
   // stretch between their own places is straight (the along-road check below).
   if (onRoad && prev.onRoad && gap < 30 && Math.abs(roadS - prev.roadS) > gap * 1.6 + 15) roadS = prev.roadS;
   // A report within scatter of the one before is drawn as the same kind of place — on the road, or
   // where it was made — as that one was: at a terminus stand two reports from one spot, one facing
   // away from the road and one with no bearing, were drawn one where it was made and one on the
   // road 34 m off, and the standing bus hopped sideways between them (24 September 2026, the fleet
   // check). Only the kind is carried: taking the earlier report's place as well held a bus creeping
   // in 8 m steps at one spot while its distance along the path grew, and the two disagreed.
   if (gap < 10 && onRoad !== prev.onRoad) { onRoad = prev.onRoad; roadS = onRoad && p ? p.s : 0; }
   jump = travelable(prev.fix, fix);
   if (!jump) {
    const along = roadS - prev.roadS, seconds = (fix.at - prev.fix.at) / 1000;
    // The road joins two reports where it is not much longer than the line between them — or, round
    // a corner, where it is longer only because both reports lie to the inside of the turn, which
    // shows as a road up to three times the line at no more than a bus's pace (the route-43 corner
    // of Whitworth Street and Oxford Street: 158 m of road between reports 69 m apart, 22 s, 7 m/s).
    // A road far longer at an impossible pace (a 250's accepted road looping 1,353 m where it drove
    // 302 m in 27 s) is not the way it went, and the stretch is straight.
    roadSeg = prev.onRoad && onRoad && gap >= GLIDE.minMetres && along > 0
     && (along <= Math.max(60, gap * 1.6) || (along <= gap * 3 && seconds > 0 && along / seconds <= 15));
    length = roadSeg ? along : gap;
   }
  }
  S += length;
  nodes.push({fix, S, onRoad, roadS, road: roadSeg, jump});
  if (onRoad) prevS = roadS;
 }
 return {nodes, road, key: fixes.map(f => f.at).join(','), tangents: tangentsFor(nodes)};
}

/**
 * Distance along the path against time, through every report: on each stretch between two
 * reports a cubic that leaves the earlier report at the speed the stretch *before* it implied and
 * arrives at the later one at the speed this stretch implies — the bus eases from the pace it had
 * to the pace its next report says it kept, and a stretch that ends where it began is a stand it
 * slows into. Each stretch depends only on reports at or before its end, so a report arriving
 * later never reshapes a stretch already being played: the first version used Fritsch–Carlson
 * tangents that looked ahead, and every new report bent the stretch the bus was on by 10–24 m,
 * which the follower then chased (24 September 2026, traced on a real 219). A start tangent is
 * held under three times the stretch's own average speed, which keeps the cubic monotone: the
 * bus never runs backwards. Tangents are in metres per millisecond.
 */
function tangentsFor(nodes: PathNode[]): number[] {
 // Per stretch: [start, end] tangents, flattened as m[2k], m[2k + 1].
 const n = nodes.length, m: number[] = [];
 let previous: number | null = null;
 for (let k = 0; k < n - 1; k++) {
  const span = nodes[k + 1].fix.at - nodes[k].fix.at;
  const d = span > 0 ? (nodes[k + 1].S - nodes[k].S) / span : 0;
  const start = previous === null ? d : Math.min(previous, 3 * d);
  m.push(start, d);
  previous = d;
 }
 return m;
}

/** The curve itself at a moment: exact through every report. */
function curveAt(path: Path, at: number): {S: number; v: number; i: number} {
 const nodes = path.nodes;
 const {i, f} = bracket(nodes.map(n => n.fix), at);
 if (i + 1 >= nodes.length) return {S: nodes[i].S, v: 0, i};
 const a = nodes[i], b = nodes[i + 1], h = b.fix.at - a.fix.at;
 if (h <= 0) return {S: b.S, v: 0, i};
 const m0 = path.tangents[2 * i], m1 = path.tangents[2 * i + 1];
 const f2 = f * f, f3 = f2 * f;
 const S = (2 * f3 - 3 * f2 + 1) * a.S + (f3 - 2 * f2 + f) * h * m0 + (-2 * f3 + 3 * f2) * b.S + (f3 - f2) * h * m1;
 const dS = (6 * f2 - 6 * f) * a.S + (3 * f2 - 4 * f + 1) * h * m0 + (-6 * f2 + 6 * f) * b.S + (3 * f2 - 2 * f) * h * m1;
 return {S: Math.min(b.S, Math.max(a.S, S)), v: Math.max(0, dS / h * 1000), i};
}

/** Where the reports put the bus along the path at a moment, smoothed over the previous
 *  PACE.smoothMs (see PACE), and how fast that place moves, m/s. */
function pathAt(path: Path, at: number): {S: number; v: number; i: number} {
 const first = path.nodes[0].fix.at;
 const exact = curveAt(path, at);
 // The window never reaches before the first report known: what the bus did before it is not
 // known, so the window shrinks there rather than the curve flipping between smoothed and exact
 // as the trail's oldest report drops off (which read as a repositioning, 24 September 2026).
 const w = Math.min(PACE.smoothMs, at - first);
 if (!(w > 1000)) return exact;
 // Simpson's rule over the window: the curve is smooth enough for eight panels to be exact to
 // well under a metre.
 const n = 8, step = w / n;
 let sum = 0;
 for (let k = 0; k <= n; k++) sum += curveAt(path, at - w + k * step).S * (k === 0 || k === n ? 1 : k % 2 ? 4 : 2);
 const S = sum * step / 3 / w;
 const v = (exact.S - curveAt(path, at - w).S) / w * 1000;
 return {S: Math.min(exact.S, S), v: Math.max(0, v), i: exact.i};
}

/** Where a report is drawn: on the road where it measures onto it, else where it was made. Every
 *  stretch runs between two such points, so a chord meets the road at a node without a step. */
function nodePoint(path: Path, n: PathNode): {lat: number; lon: number} {
 return n.onRoad && path.road ? pointAt(path.road, n.roadS) : {lat: n.fix.lat, lon: n.fix.lon};
}

/** The place on the path at a distance along it. `hint` is the report the moment shown lies at,
 *  which decides which side of a refused pair a distance both reports share belongs to. */
function pointOnPath(path: Path, s: number, hint: number): {lat: number; lon: number; heading: number | null; onRoad: boolean; roadS: number | null; k: number} {
 const nodes = path.nodes;
 let k = Math.max(0, Math.min(nodes.length - 1, hint));
 // A hair of tolerance: a distance handed back through the path's own arithmetic can sit a
 // nanometre short of the report it was read at, and stepping back over a tie there drew the bus
 // 46 m back at the earlier report of a refused pair (24 September 2026).
 const eps = 1e-6;
 while (k > 0 && s < nodes[k].S - eps) k--;
 while (k + 1 < nodes.length && s > nodes[k + 1].S + eps) k++;
 if (k + 1 >= nodes.length) {
  const n = nodes[k];
  return n.onRoad && path.road ? {...nodePoint(path, n), heading: headingAhead(path.road, n.roadS), onRoad: true, roadS: n.roadS, k}
   : {...nodePoint(path, n), heading: null, onRoad: false, roadS: null, k};
 }
 const a = nodes[k], b = nodes[k + 1], len = b.S - a.S;
 const f = len > 0 ? Math.max(0, Math.min(1, (s - a.S) / len)) : 0;
 if (b.road && path.road) {
  const rs = a.roadS + (s - a.S);
  return {...pointAt(path.road, rs), heading: headingAhead(path.road, rs), onRoad: true, roadS: rs, k};
 }
 // The chord: two positions the bus reported and the straight line between them, which is not
 // claimed to be the road. The drawn bus faces along the line it is drawn travelling — a report's
 // own bearing is another moment's, and pointed it across the line (24 September 2026). A
 // stretch too short to have a direction leaves the heading as it was.
 const pa = nodePoint(path, a), pb = nodePoint(path, b);
 return {lat: pa.lat + (pb.lat - pa.lat) * f, lon: pa.lon + (pb.lon - pa.lon) * f,
  heading: metres(pa, pb) >= 2 ? bearingBetween(pa, pb) : null, onRoad: false, roadS: null, k};
}

const bearingBetween = (a: {lat: number; lon: number}, b: {lat: number; lon: number}) =>
 (Math.atan2((b.lon - a.lon) * Math.cos(((a.lat + b.lat) / 2) * RAD), b.lat - a.lat) / RAD + 360) % 360;

/** The drawn heading one frame on: towards `target` at a bus's rate of turn, eased in; held where
 *  there is no target, and taken at once across a repositioning (nothing is shown turning there). */
function steer(from: number | null, target: number | null, dtMs: number, cut: boolean): number | null {
 if (target === null) return from;
 if (from === null || cut) return target;
 const turnBy = shortestTurn(from, target), eased = turnBy * (1 - Math.exp(-dtMs / HEADING.settleMs));
 const limit = HEADING.maxDegPerSecond * dtMs / 1000;
 return (from + Math.max(-limit, Math.min(limit, eased)) + 360) % 360;
}

/** The nearest place on the path to a point: its distance along, and how far off the path it is.
 *  Where the path passes the point more than once about as closely (reports wandering round a
 *  stand, a road that doubles back), the pass nearest `preferS` is taken: on 24 September 2026 a
 *  rebuilt path put a bus that had stood at its terminus back on its first pass, 32 m of wander
 *  behind, and the delay it was drawn at read 153 s. */
function nearestOnPath(path: Path, p: {lat: number; lon: number}, preferS?: number): {S: number; metres: number; k: number} {
 const nodes = path.nodes;
 const candidates: {S: number; metres: number; k: number}[] = [];
 let best = {S: nodes[0].S, metres: metres(nodePoint(path, nodes[0]), p), k: 0};
 candidates.push(best);
 for (let k = 0; k + 1 < nodes.length; k++) {
  const a = nodes[k], b = nodes[k + 1], len = b.S - a.S;
  if (len <= 0) { const d = metres(nodePoint(path, b), p); candidates.push({S: b.S, metres: d, k: k + 1}); if (d < best.metres) best = {S: b.S, metres: d, k: k + 1}; continue; }
  if (b.road && path.road) {
   // A stretch along the road is measured along the road, or at its ends — never along the chord
   // between them, which is another curve with other distances: taken for it, a place on the chord
   // 0.6 m from the drawn bus was a place on the road 13 m on (24 September 2026, the fleet check).
   const pr = project(path.road, p, a.roadS);
   if (pr.s >= a.roadS && pr.s <= b.roadS) { const c = {S: a.S + (pr.s - a.roadS), metres: pr.offset, k}; candidates.push(c); if (pr.offset < best.metres) best = c; }
   else for (const [n, at, kk] of [[a, a.S, k], [b, b.S, k + 1]] as const) {
    const c = {S: at, metres: metres(nodePoint(path, n), p), k: kk}; candidates.push(c); if (c.metres < best.metres) best = c;
   }
   continue;
  }
  const pa = nodePoint(path, a), pb = nodePoint(path, b);
  const cl = Math.cos(pa.lat * RAD);
  const bx = (pb.lon - pa.lon) * cl, by = pb.lat - pa.lat, px = (p.lon - pa.lon) * cl, py = p.lat - pa.lat;
  const L = bx * bx + by * by, t = L > 0 ? Math.max(0, Math.min(1, (px * bx + py * by) / L)) : 0;
  const q = {lat: pa.lat + (pb.lat - pa.lat) * t, lon: pa.lon + (pb.lon - pa.lon) * t};
  const d = metres(q, p);
  candidates.push({S: a.S + len * t, metres: d, k});
  if (d < best.metres) best = {S: a.S + len * t, metres: d, k};
 }
 if (preferS === undefined) return best;
 const close = candidates.filter(c => c.metres <= best.metres + 2);
 return close.reduce((x, c) => Math.abs(c.S - preferS) < Math.abs(x.S - preferS) ? c : x, best);
}

/** The moment the place shown was at a distance along the path: the inverse of pathAt, found by
 *  bisection over the whole path (the smoothed place is monotone in time, and reaches a stretch's
 *  end later than the stretch's own time, so it cannot be inverted stretch by stretch). */
function momentAt(path: Path, S: number): number {
 const nodes = path.nodes;
 let lo = nodes[0].fix.at, hi = nodes[nodes.length - 1].fix.at + PACE.smoothMs;
 if (S <= pathAt(path, lo).S) return lo;
 if (S >= pathAt(path, hi).S) return hi;
 for (let n = 0; n < 30 && hi - lo > 1; n++) { const mid = (lo + hi) / 2; if (pathAt(path, mid).S < S) lo = mid; else hi = mid; }
 return (lo + hi) / 2;
}

/** The last moment, up to `upTo`, at which the place the reports put the bus at was no further on
 *  than `S` (half a metre's grace): bisection, the smoothed place being monotone in time. */
function lastMomentAt(path: Path, S: number, upTo: number): number {
 let lo = path.nodes[0].fix.at, hi = upTo;
 if (pathAt(path, hi).S <= S + 0.5) return hi;
 if (pathAt(path, lo).S > S + 0.5) return lo;
 for (let n = 0; n < 30 && hi - lo > 1; n++) { const mid = (lo + hi) / 2; if (pathAt(path, mid).S <= S + 0.5) lo = mid; else hi = mid; }
 return lo;
}

/**
 * Playing a bus's reports back a bounded time behind them. The display clock runs at real time,
 * `delay` behind the presentation clock; the reports put the bus at one place on its path at the
 * moment shown (pathAt); and the drawn bus follows that place at a bus's pace (PACE) — it may
 * lag it by a few seconds while it pulls away or slows, catches it up at no more than a few per
 * cent over the reports' own speed, brakes to a stand at the newest report when nothing newer
 * is known, and is never drawn ahead of where the reports put it. A report filed late moves the
 * path under the bus: eased over if the move is under the drawing's snap distance, said as a
 * repositioning beyond it.
 */
function playback(previous: Visual | null, e: Estimate, fixes: Fix[], now: number, road: Track | null,
                  settled: Visual): Visual {
 // The clock may run one smoothing window past the newest report, on the reading that the bus
 // then stood there: the place shown is the path's average over that window, and reaches the
 // newest report only once the window is wholly past it. The place is never past the report. When
 // the next report says the bus had in fact moved on, the place shown moves ahead and the drawn
 // bus catches it up at its own pace — which is what a bus setting off after a stand looks like.
 const latestAt = fixes[fixes.length - 1].at + PACE.smoothMs;
 const prior = previous?.buffer ?? null;
 const path: Path = prior && prior.pathKey === fixes.map(f => f.at).join(',') && prior.path ? prior.path as Path : buildPath(fixes, road);
 const end = path.nodes[path.nodes.length - 1].S;
 // A report's age when it arrived: the lag the delay is sized from. Recorded when the newest
 // report changes, which is the moment it arrived here.
 let lags = prior?.lags ?? [];
 if (!previous || previous.basisAt !== e.basis.at) lags = [...lags, Math.max(0, now - e.basis.at)].slice(-8);
 const delay = playbackDelay(lags);
 const target = now - delay;
 let shown: number, sd: number, vd: number, last = previous?.lastCorrection ?? null, correction: Correction = 'none';
 let ease = prior?.ease ?? null;
 let rebuilt: {lat: number; lon: number} | null = null;
 let resume: number | null = null, resumed = false;
 // The stretch the drawn bus was on, carried across a rebuild of the path so that a refused pair
 // crossed on the very frame a publication arrives is still seen crossed (every publication
 // re-times its trail by a second or so, so the path is rebuilt at each one).
 let leftK: number | null = null;
 const raw = previous ? Math.max(0, now - previous.frame) : 0;
 // The frame loop rests on purpose once the clock has reached the end of the reports it has and
 // the bus stands there; it wakes when a publication arrives. The first frame after that is not a
 // pause in drawing — nothing was left undrawn, the clock was waiting — so it carries on from where
 // it waited, one frame on. Taken for a pause it would have jumped the bus and said the page had
 // been in the background (found 24 September 2026, reading the playback against the frame loop).
 const rested = prior?.latestAt != null && prior.shown >= prior.latestAt - 500;
 const paused = raw > 1000 && !rested;
 const elapsed = raw > 1000 && rested ? 100 : raw;
 // The follower integrates the time that really passed between frames, up to a second; after a
 // longer pause in drawing (a tab put away) it is put back at the reports' own place rather than
 // left to make the lost ground up, while the clock below keeps real time regardless.
 const dt = paused ? 0 : Math.min(1000, elapsed) / 1000;
 if (!prior) {
  // Playback starts from where the bus is drawn where that is on the path: a bus that has waited
  // at its report until the next arrived sets off from that report. Starting at the delay's
  // moment instead moved it 80–120 m in one frame at the start of every journey.
  const near = previous ? nearestOnPath(path, previous) : null;
  if (near && near.metres < REPOSITION_METRES) { sd = near.S; shown = Math.min(latestAt, Math.max(fixes[0].at, momentAt(path, sd))); leftK = near.k; }
  else { shown = Math.min(latestAt, Math.max(fixes[0].at, target)); sd = pathAt(path, shown).S; }
  // Where the bus is drawn belongs to a moment much further back than the delay — a report that
  // stood alone for a minute and a half, say — the clock does not start there and crawl: it starts
  // at the delay's moment, and the move, if any, is a repositioning said below.
  if (target - shown > delay + PLAYBACK.resyncMs / 3) { shown = Math.min(latestAt, Math.max(fixes[0].at, target)); sd = pathAt(path, shown).S; }
  // It pulls away from a stand, as a bus does, rather than appearing at speed.
  vd = 0;
 } else {
  const behind = target - prior.shown;
  // Newer reports than the moment shown exist to go to: the clock is behind for want of time, not
  // for want of reports. While it has simply run out of reports it waits at the newest, as the bus
  // is drawn doing, and that is true.
  const reportsAhead = latestAt > prior.shown + 1000;
  if (paused || prior.resume) {
   // Coming back from a pause in drawing (the tab put away, the screen locked): nothing was drawn
   // meanwhile, so the bus is not shown making up the time — the clock goes straight to the
   // delay's moment and the bus to its place then, and if that is a move worth mentioning it is a
   // repositioning, said as one. The first frame back often runs before the fresh publication the
   // page asks for on its return has arrived; while the reports it has are older than the moment
   // to show, it waits where it was drawn rather than moving twice (24 September 2026: a route-43
   // tab shown again after a minute put the bus 125 m on in one frame and said nothing).
   const fresh = latestAt >= target || now - (prior.resume ?? now) > 5000;
   shown = fresh ? Math.min(latestAt, Math.max(prior.shown, target)) : prior.shown;
   sd = prior.sd; vd = 0;
   resume = fresh ? null : prior.resume ?? now;
   resumed = fresh;
  } else if (behind > PLAYBACK.resyncMs && reportsAhead) {
   // Too far behind to make up unseen: the reports came late, and the time lost waiting for them
   // is more than a stand can absorb. This is a repositioning, and is said as one below — not
   // made up by driving faster than the reports say the bus went.
   shown = Math.min(latestAt, target);
   sd = pathAt(path, shown).S; vd = 0;
   correction = 'snap';
  } else {
   // Real time, and a shade over it while the clock is behind where the delay would have it
   // (it waits whenever the reports run out, and would otherwise never make that time back):
   // 5% over is not a speed a passenger can see, where the old 20% was. Where the reports say the
   // bus stood, the time is made up faster: a standing bus looks the same at any rate.
   const standing = pathAt(path, prior.shown).v < 0.3;
   const rate = behind > 2000 ? (standing ? PLAYBACK.standingRate : PLAYBACK.fastestRate) : 1;
   shown = Math.min(latestAt, Math.max(prior.shown, prior.shown + Math.min(elapsed * rate, Math.max(elapsed, behind))));
   sd = prior.sd; vd = prior.vd;
  }
  // A repositioning just decided (a resync, or the return from a pause) puts the bus at its goal:
  // keeping its old place through the path's rebuild undid it, left it far behind with nothing
  // said, and had it chase (24 September 2026, the incident's own reports after a 90 s gap).
  if (prior.pathKey !== path.key && correction !== 'snap' && !resumed) {
   // The reports changed under the bus: a new report on the end, the trail's oldest dropped off,
   // or a late report filed in order between two already played. The drawn bus keeps its *place*
   // — the nearest point of the new path to where it is drawn — and its goal is read afresh from
   // the moment shown; because each stretch of the curve depends only on reports up to its end,
   // the goal is never behind it after a rebuild, so it never waits, it only catches up. How far
   // its place lies off the new path is how far a late report moved the path under it.
   const near = nearestOnPath(path, previous!, pathAt(path, shown).S);
   sd = near.S;
   // The stretch is the one the place is on, not the clock's: a late report filed in before the
   // moment shown would otherwise be crossed unsaid (602 m, 24 September 2026).
   const anchor = pointOnPath(path, sd, near.k);
   leftK = anchor.k;
   rebuilt = near.metres > 1 ? anchor : null;
  } else leftK = prior.k;
 }
 // The follower: towards the place the reports put the bus at the moment shown, at a bus's pace.
 const goal = pathAt(path, shown);
 if (resumed) { sd = goal.S; vd = goal.v; }
 else if (resume !== null) { /* waiting for the fresh publication: stand where drawn */ }
 else if (prior && goal.S - sd > GLIDE.maxMetres) {
  // Further behind its goal than a bus could be followed across — the reports moved on by more
  // than it can catch up at a bus's pace — it is repositioned, and that is said. Under that it
  // catches up, a few metres a second over the reports' own speed.
  sd = goal.S; vd = 0; correction = 'snap';
 }
 else if (correction !== 'snap' && prior) {
  const gapAhead = goal.S - sd;
  // Towards the goal at its speed plus a share of the gap — and, where the goal stands, at least
  // the speed that arrives with room to brake, so a bus arrives rather than creeping in.
  let want = Math.max(0, goal.v + gapAhead / PACE.catchUpSeconds, Math.sqrt(2 * PACE.brakeMps2 * Math.max(0, gapAhead)));
  // Behind its goal it may run a little over the reports' own speed, or — where the goal stands
  // and the bus is well behind it, as after a burst the pace could not follow — as fast as it
  // can still brake to the goal from, never faster than a bus.
  want = Math.min(want, Math.max(goal.v * PACE.overSpeed + 0.3, Math.min(Math.sqrt(2 * PACE.brakeMps2 * Math.max(0, gapAhead)), goal.v + PACE.closingMps)), PACE.maxMps);
  // Nothing newer known beyond the path's end: brake to a stand there, as a bus arriving does.
  want = Math.min(want, Math.sqrt(2 * PACE.brakeMps2 * Math.max(0, end - sd)));
  vd += Math.max(-PACE.brakeMps2 * dt, Math.min(PACE.accelMps2 * dt, want - vd));
  vd = Math.max(0, vd);
  // Never past the newest report; ahead of the moment shown only by what a path change left it.
  sd = Math.min(end, Math.max(sd, sd + vd * dt), Math.max(sd, goal.S));
  if (sd >= goal.S) vd = Math.min(vd, goal.v);
  // Within a step of a standing goal it is there: a bus arrives, it does not creep for ever.
  if (goal.v < 0.05 && goal.S - sd < 0.3) { sd = goal.S; vd = 0; }
 }
 sd = Math.min(end, Math.max(0, sd));
 // At a distance two reports share (a refused pair, or two reports at one place) the later of the
 // clock's stretch and the bus's own decides: the bus is never drawn back at an earlier report it
 // has already left (24 September 2026: a 46 m step, unsaid, on a re-published trail).
 const at = pointOnPath(path, sd, Math.max(goal.i, leftK ?? 0));
 // The drawn bus has passed a report since the last frame. If the pair it left could not be
 // travelled between, it has just been moved across it, and that is said with the reason. Read
 // from the stretch the *drawn* bus is on, not the clock's: the bus follows the clock at its own
 // pace, and the first version read the clock and missed the move (24 September 2026: two of the
 // A/B's three big steps went unsaid).
 const left = leftK ?? at.k;
 const crossed = left < at.k ? path.nodes.slice(left + 1, at.k + 1).map(n => n.jump).find(j => j !== null) ?? null : null;
 const moved = previous ? metres(previous, at) : 0;
 if (resumed && moved >= REPOSITION_METRES) { correction = 'snap'; last = {kind: 'snap', metres: moved, at: now, why: 'resumed'}; }
 // A short pause (the device busy for a second or two) leaves a small move: eased over at the
 // correction's own pace rather than hopped, and too small to be worth saying.
 else if (resumed && previous && moved > 1) { ease = {fromLat: previous.lat, fromLon: previous.lon, at: now, ms: Math.max(400, moved * 100)}; correction = 'smooth'; }
 else if (correction === 'snap' && moved >= REPOSITION_METRES) last = {kind: 'snap', metres: moved, at: now, why: 'too_long'};
 else if (crossed && moved >= REPOSITION_METRES) { correction = 'snap'; last = {kind: 'snap', metres: moved, at: now, why: crossed}; }
 else if (!prior && previous && moved >= REPOSITION_METRES) { correction = 'snap'; last = {kind: 'snap', metres: moved, at: now, why: 'too_long'}; }
 else if (previous && rebuilt) {
  // The new path has the bus's moment somewhere else: a knot appended to the curve bends the
  // stretch before it by a metre or two, a late report by more. Under the drawing's snap distance
  // the move is eased over from where the bus was drawn — timed from a speed, 100 ms a metre,
  // about 10 m/s, as the estimate's own corrections are — and said as a correction where it is
  // more than scatter. Beyond the snap distance the ground between is not known and it is a
  // repositioning with its reason: on 24 September 2026 an 877 m shift was eased in two seconds
  // and called smooth.
  const shift = metres(previous, rebuilt);
  if (shift > DRAWING.largeCorrection) { correction = 'snap'; last = {kind: 'snap', metres: shift, at: now, why: 'too_far'}; }
  else if (shift > 1) {
   ease = {fromLat: previous.lat, fromLon: previous.lon, at: now, ms: Math.max(400, shift * 100)};
   if (shift > 8) { correction = 'smooth'; if (!(last?.kind === 'snap' && now - last.at < 8000)) last = {kind: 'smooth', metres: shift, at: now}; }
   else correction = 'none';
  } else correction = ease && now < ease.at + ease.ms ? 'smooth' : 'none';
 } else correction = ease && now < ease.at + ease.ms ? 'smooth' : 'none';
 let drawn = {lat: at.lat, lon: at.lon};
 if (ease && now < ease.at + ease.ms) {
  const f = (now - ease.at) / ease.ms, w = f * f * (3 - 2 * f);
  drawn = {lat: ease.fromLat + (at.lat - ease.fromLat) * w, lon: ease.fromLon + (at.lon - ease.fromLon) * w};
 } else ease = null;
 // Which way it faces: the way it is drawn travelling, turned into at a bus's rate; before it has
 // ever moved, its road's direction or, with no road, the newest report's own bearing.
 const cut = correction === 'snap' && last?.at === now;
 const start = previous?.bearing ?? at.heading ?? fixes[fixes.length - 1].bearing ?? null;
 const bearing = steer(previous ? previous.bearing ?? start : start, at.heading, previous ? Math.min(1000, Math.max(0, now - previous.frame)) : 0, cut);
 // The moment the drawn place stands for: the delay the card states is measured from this, not
 // from the clock, which the drawn bus may trail by a few seconds while it pulls away. At its goal
 // it stands for the clock's own moment. Behind it, it stands for the *last* moment the reports
 // still had the bus there — until then the drawn place was true: over a stand, or a slow start
 // from one, every moment of the stand has that place, and reading the earliest (as the inverse
 // does) put a bus pulling away from a terminus 150 s behind (24 September 2026).
 // While a correction is eased in, the drawn place is between two paths and stands for no moment of
 // either: the clock's moment is said (reading the re-anchored place put a 23 m eased correction at
 // "165 s behind" for four seconds, 24 September 2026).
 const represented = goal.S - sd < 0.5 || ease ? shown : lastMomentAt(path, sd, shown);
 return {...settled, lat: drawn.lat, lon: drawn.lon, bearing, heading: at.heading ?? bearing, velocity: vd,
  correction, lastCorrection: last, glide: null,
  buffer: {shown, delay, lags, ease, sd, vd, end, goalS: goal.S, k: at.k, onRoad: at.onRoad, roadS: at.roadS, pathKey: path.key, path,
   represented, resume, latestAt}};
}

/**
 * The stretch of checked road between two consecutive reports, or null.
 *
 * Both reports must lie on the shape within the same tolerance a report needs to be placed on it
 * at all (`offTrack`), they must be in order along it, and the road between them must be close to
 * the straight line between them — a bus that reported either side of a loop, or that the shape
 * sends the long way round, is not known to have gone that way. Where any of that fails the bus
 * travels along the chord as before, which is the honest shape of "two positions and nothing in
 * between".
 */
function roadBetween(road: Track | null, from: {lat: number; lon: number}, to: {lat: number; lon: number},
                     gap: number): NonNullable<Visual['glide']>['road'] {
 if (!road || !road.points.length) return null;
 const a = project(road, from), b = project(road, to);
 if (a.offset > DEFAULT_PARAMS.offTrack || b.offset > DEFAULT_PARAMS.offTrack) return null;
 const along = b.s - a.s;
 if (along <= 0) return null;
 if (along > Math.max(60, gap * 1.6)) return null;
 const onRoadFrom = pointAt(road, a.s), onRoadTo = pointAt(road, b.s);
 return {trackId: road.id, fromS: a.s, toS: b.s,
  fromOff: [from.lat - onRoadFrom.lat, from.lon - onRoadFrom.lon],
  toOff: [to.lat - onRoadTo.lat, to.lon - onRoadTo.lon]};
}

const WINDOW_STEPS = 24;
const MAX_FRAME = 0.25;          // s: a longer gap between frames means the page was not drawing

/**
 * Where the drawn bus is heading for at `when`, and how fast that moves: the estimate's own path
 * averaged over ± `smoothing` seconds of its known past and future, weighted towards `when` (a
 * triangle). Until the next report the estimate is fixed, so the moment it will reach a stop,
 * stand, or end its horizon is known in advance: the average starts slowing a few seconds before
 * and finishes a few seconds after, and the drawn bus eases into a pause and away again instead
 * of stopping dead or leaping off. On a steady stretch the average is the estimate itself.
 */
function goalAt(track: Track, e: Estimate, when: number, draw: Drawing): {s: number; speed: number} {
 const half = draw.smoothing * 1000;
 const at = (t: number) => {
  if (!(half > 0)) return alongAt(track, e, t) ?? 0;
  let sum = 0, total = 0;
  for (let k = 1; k < WINDOW_STEPS; k++) {
   const tau = -half + (2 * half * k) / WINDOW_STEPS, w = half - Math.abs(tau);
   sum += w * (alongAt(track, e, t + tau) ?? 0); total += w;
  }
  return sum / total;
 };
 return {s: at(when), speed: (at(when + 50) - at(when - 50)) / 0.1};
}

function place(e: Estimate, now: number, trackId: string | null, correction: Correction,
               last: Visual['lastCorrection'], track: Track | null = null, draw: Drawing = DRAWING): Visual {
 const goal = track && e.mode === 'estimated' && e.s !== null ? goalAt(track, e, now, draw) : null;
 return {mode: e.mode, s: e.s, lat: e.lat, lon: e.lon, bearing: e.bearing, heading: e.bearing, offset: 0,
  velocity: goal?.speed ?? 0, goal: goal?.s ?? null, goalSpeed: goal?.speed ?? 0, trackId,
  basisAt: e.basis.at, frame: now, correction, lastCorrection: last, provisional: e.provisional ?? false,
  glide: null, buffer: null};
}

/** Where a gliding bus is drawn now: eased between the two reports, and never past the newer one.
 *  The bearing is left as reported, because a bearing is never taken from movement. */
function glideAt(v: Visual, g: NonNullable<Visual['glide']>, now: number, road: Track | null = null): Visual {
 const f = Math.max(0, Math.min(1, (now - g.at) / g.ms));
 // Smoothstep: it leaves the old report and reaches the new one without a visible start or stop.
 const e = f * f * (3 - 2 * f);
 // On a road both reports were measured against, the bus goes down the road. Only a bus with no
 // such road is drawn along the chord, because that chord cuts corners: measured on one route-25
 // journey of 60 consecutive report pairs, it left the checked road by a median 5.3 m, 28.5 m at
 // the 95th percentile and 34.4 m at worst, which at that distance is the next street.
 if (g.road && road && road.id === g.road.trackId) {
  const s = g.road.fromS + (g.road.toS - g.road.fromS) * e;
  const point = pointAt(road, s);
  // A report is not on the road, it is near it, and the drawn bus must still end where the bus
  // reported. So the road gives the *shape* of the travel and each end's own offset from it is
  // carried across: the path leaves the drawn position exactly and arrives at the report exactly.
  // Without this the travel ended on the road and then hopped to the report — measured at 5.46 m
  // in one 48 ms frame on the route-25 journey, which is a small teleport at the end of every
  // twenty seconds.
  const lat = g.road.fromOff[0] + (g.road.toOff[0] - g.road.fromOff[0]) * e;
  const lon = g.road.fromOff[1] + (g.road.toOff[1] - g.road.fromOff[1]) * e;
  return {...v, lat: point.lat + lat, lon: point.lon + lon};
 }
 return {...v, lat: g.fromLat + (g.toLat - g.fromLat) * e, lon: g.fromLon + (g.toLon - g.fromLon) * e};
}

/**
 * Advance the drawn position to a new frame. The drawn bus has a place along the road and a
 * speed, and the speed never jumps: it changes by at most `approachAccel` m/s each second. It
 * heads for the estimate's own path, smoothed over its next and last few seconds (goalAt), so a
 * pause at a stop is eased into and out of. A new report re-anchors the estimate; the gap
 * between what was drawn and the corrected path is closed the way a driver closes a gap: no
 * faster than `catchUp` on top of the path's own speed, slowing in time to meet it, and ending
 * in a settle of about `settle` seconds. While the bus moves, a small correction backwards slows
 * the drawn bus, and holds it if need be, but never reverses it; a large one snaps, and is
 * reported so the page can say so. The estimate itself is untouched: only how the drawn bus
 * follows it.
 */
export function stepVisual(previous: Visual | null, e: Estimate, now: number, track: Track | null,
                           draw: Drawing = DRAWING, history?: History | null,
                           road: Track | null = null): Visual {
 const trackId = track?.id ?? null;
 // Shown at its report only while the settings or geometry loaded: the first estimate is simply
 // drawn, not presented as a correction.
 if (previous?.provisional && previous.mode === 'observed' && e.mode === 'estimated')
  return place(e, now, trackId, 'none', previous.lastCorrection, track, draw);
 // Estimating resumes (a second report arrived after a jump, say): the bus eases on from where
 // it was drawn, standing, on the same road, rather than jumping to the estimate.
 if (previous && previous.mode === 'observed' && e.mode === 'estimated' && track && e.s !== null) {
  const from = project(track, previous, e.s);
  if (from.offset <= DEFAULT_PARAMS.offTrack && Math.abs(from.s - e.s) <= draw.largeCorrection) {
   const point = pointAt(track, from.s);
   previous = {...previous, mode: 'estimated', s: from.s, lat: point.lat, lon: point.lon, offset: from.s - e.s,
    velocity: 0, goal: null, trackId, basisAt: e.basis.at, bearing: previous.bearing ?? headingAt(track, from.s)};
  }
 }
 if (!previous || e.mode !== 'estimated' || previous.mode !== 'estimated' || previous.trackId !== trackId
     || previous.s === null || e.s === null || !track) {
  // Leaving an estimate for a report is a correction, and is said; a bus shown at its reports
  // moving to its next report is simply that report, travelled to rather than jumped to (GLIDE).
  const moved = previous?.mode === 'estimated' ? metres(previous, e) : 0;
  // An estimate that had rolled on past a bus now read as standing eases back to the report over
  // a second or two, a correction like any other under 150 m; only a larger one snaps.
  if (previous?.mode === 'estimated' && e.mode === 'observed' && e.held && moved > 1 && moved <= draw.largeCorrection) {
   const eased = place(e, now, trackId, 'smooth', {kind: 'smooth', metres: moved, at: now}, track, draw);
   // The ease-back is timed from a speed, not a fixed budget. At the old 25 ms a metre a 110 m
   // correction was taken back in 2.5 s — a peak of 75 m/s, 269 km/h — which reads as a jump
   // however smoothly it is interpolated, and the bigger the mistake the faster the bus flew.
   // 100 ms a metre is 10 m/s, the speed of the bus itself, so a correction now looks like one.
   const glide = {fromLat: previous.lat, fromLon: previous.lon, toLat: e.lat, toLon: e.lon, at: now,
    ms: Math.max(600, Math.min(12_000, moved * 100)), road: null};
   return {...glideAt(eased, glide, now), glide};
  }
  const kind: Correction = moved > 1 ? 'snap' : 'none';
  const settled = place(e, now, trackId, kind,
   kind === 'snap' ? {kind, metres: moved, at: now} : previous?.lastCorrection ?? null, track, draw);
  if (!previous && e.mode === 'observed' && history?.fixes && history.fixes.length >= 2)
   return playback(null, e, history.fixes, now, road, settled);
  if (!previous || e.mode !== 'observed' || previous.mode !== 'observed') return settled;
  // A glide already under way continues to the report it was aimed at, unless a newer one has
  // arrived, which restarts it from wherever the bus is now: never two targets at once.
  const running = previous.glide && now < previous.glide.at + previous.glide.ms ? previous.glide : null;
  // An eased correction in flight (an estimate withdrawn) runs to its end before anything else.
  if (running && previous.basisAt === e.basis.at) return {...glideAt(settled, running, now, road), glide: running};
  // With the reports to play back, the bus is drawn a bounded time behind them (PLAYBACK), every
  // frame, whether or not a new report has arrived; the rest of this branch is what happens
  // without them.
  if (history?.fixes && history.fixes.length >= 2) return playback(previous, e, history.fixes, now, road, settled);
  // Still the same report: stand at it. A finished glide is cleared rather than kept.
  if (previous.basisAt === e.basis.at) return settled;
  const gap = metres(previous, e);
  /**
   * Where the drawn bus cannot travel to the new report, it is *repositioned*, and that is said.
   *
   * Until 22 September 2026 each of the three refusals below returned the bus at its new report
   * with `lastCorrection` left untouched — so the map drew no repositioning trace and the card
   * said nothing, and the bus simply appeared somewhere else. Reproduced against the model: an
   * empty trail moved it 92.7 m, a gap past `maxMetres` 864.8 m, and a span past `maxMs` 270.7 m,
   * each in one frame with `lastCorrection` null. The estimated path had always reported its
   * snaps; the observed path, which is most of the fleet and both of the reported cases, had no
   * such treatment at all.
   *
   * Under `REPOSITION_METRES` the move is GPS scatter around a standing bus, not a journey, and
   * announcing it would cry wolf every twenty seconds.
   */
  const reposition = (why: RepositionReason): Visual => gap < REPOSITION_METRES ? settled
   : place(e, now, trackId, 'snap', {kind: 'snap', metres: gap, at: now, why}, track, draw);
  if (gap > GLIDE.maxMetres) return reposition('too_far');
  if (gap < GLIDE.minMetres) return settled;
  // How long the bus took to make this move, by its own timestamps: from the report it was drawn
  // at to the one that has arrived. Two reports landing in one publication are one move over both
  // their intervals, not two gaps travelled in one gap's time; until 21 September 2026 the span
  // was taken between the newest two reports only, and a backlog was drawn at double speed. A
  // glide cut short by a newer report is timed from the report it was heading for, so the
  // remainder and the new gap share one interval: a little fast, and bounded below. A report that
  // follows another very closely still gets a visible step rather than an instant one.
  // Without the reports there is nothing to take the time from, and nothing to travel between:
  // that is what "reported positions only" asks for, and it is left exactly as it was.
  const fixes = history?.fixes;
  if (!fixes || fixes.length < 2) return reposition('no_earlier_report');
  const from = previous.basisAt > 0 && previous.basisAt < e.basis.at ? previous.basisAt : fixes[fixes.length - 2].at;
  const span = e.basis.at - from;
  if (span <= 0) return settled;
  if (span > GLIDE.maxMs) return reposition('too_long');
  const ms = Math.max(GLIDE.minMs, Math.min(GLIDE.maxMs, span));
  const glide = {fromLat: previous.lat, fromLon: previous.lon, toLat: e.lat, toLon: e.lon, at: now, ms,
   road: roadBetween(road, previous, e, gap)};
  return {...glideAt(settled, glide, now, road), glide};
 }
 // A frame after the page stopped drawing (nothing was moving) is not one long frame: the drawn
 // bus stood where it was all that time, so the step starts just before now. Integrating the
 // whole pause would draw the bus covering it in a single frame.
 const elapsed = Math.max(0, (now - previous.frame) / 1000), dt = Math.min(elapsed, MAX_FRAME);
 const since = now - dt * 1000;
 const fresh = previous.basisAt !== e.basis.at;
 // Where the goal was at the last frame. After a new report it is read again from the corrected
 // estimate, so the gap between what was drawn and the correction is measured at one moment.
 const from = fresh || previous.goal === null || elapsed > dt ? goalAt(track, e, since, draw)
  : {s: previous.goal, speed: previous.goalSpeed};
 const to = goalAt(track, e, now, draw);
 let last = previous.lastCorrection;
 if (fresh) {
  const gap = previous.s - (alongAt(track, e, since) ?? e.s);
  if (Math.abs(gap) > draw.largeCorrection) {
   last = {kind: 'snap', metres: Math.abs(gap), at: now};
   return {...place(e, now, trackId, 'snap', last, track, draw), bearing: e.bearing};
  }
  if (Math.abs(gap) > 1) last = {kind: 'smooth', metres: Math.abs(gap), at: now};
 }
 // In small steps, with the goal moving evenly between the two frames. The speed wanted is the
 // goal's own plus a closing speed: the smaller of catchUp and a braking curve that meets the
 // goal at approachAccel and lands softly, √(c² + 2A|x|) − c with c = A × settle. Along that
 // curve the speed wanted changes more slowly than A, so it can be followed, and a correction
 // taken up from a steady speed lands without overshooting. (One that arrives while the bus is
 // already closing fast can carry it a little past, and is then taken back as gently.)
 const A = draw.approachAccel, c = A * draw.settle, moving = (e.speed ?? 0) > 0;
 const steps = Math.min(2400, Math.max(1, Math.ceil(dt * 120)));
 let s = previous.s, velocity = previous.velocity, held = false;
 for (let k = 0; k < steps && dt > 0; k++) {
  const f = k / steps, h = dt / steps;
  const x = s - (from.s + (to.s - from.s) * f), goalSpeed = from.speed + (to.speed - from.speed) * f;
  let want = goalSpeed - Math.sign(x) * Math.min(draw.catchUp, Math.sqrt(c * c + 2 * A * Math.abs(x)) - c);
  // Moving, and drawn a little ahead: slow down, keeping `crawl` of the path's own speed (a drawn
  // bus standing still while its estimate moves looks like a stop that did not happen), and
  // never reverse.
  const floor = draw.crawl * Math.max(0, goalSpeed);
  if (want < floor && moving && x <= draw.holdBack) { want = floor; held = true; }
  velocity += Math.max(-A * h, Math.min(A * h, want - velocity));
  s += velocity * h;
 }
 if (s < 0 || s > track.length) { s = Math.min(track.length, Math.max(0, s)); velocity = 0; }
 const correction: Correction = held ? 'hold' : Math.abs(s - to.s) > 0.5 ? 'smooth' : 'none';
 const point = pointAt(track, s), heading = headingAhead(track, s);
 const bearing = previous.bearing === null ? heading
  : turnToward(previous.bearing, heading, 1 - Math.exp(-dt / draw.turnSettle));
 return {mode: 'estimated', s, lat: point.lat, lon: point.lon, bearing, heading, offset: s - e.s, velocity,
  goal: to.s, goalSpeed: to.speed, trackId, basisAt: e.basis.at, frame: now, correction, lastCorrection: last,
  provisional: false, glide: null, buffer: null};
}

// ------------------------------------------------------------------ the presentation clock

export type PresentationClock = {offset: number; wall: number; now: number};

/**
 * The time every frame is drawn at: this device's clock moved onto the server's. Each
 * publication measures that offset again, only to the second (an HTTP Date header), so a new
 * measurement is approached at no more than `slew` of a second per second rather than stepped,
 * and the clock never runs backwards. A difference over `reset` ms is a real change of clock,
 * or of server, and is taken at once.
 */
export function tickClock(clock: PresentationClock | null, wall: number, target: number,
                          slew = 0.1, reset = 5000): PresentationClock {
 if (!clock || wall < clock.wall || Math.abs(target - clock.offset) > reset) return {offset: target, wall, now: wall + target};
 const most = slew * (wall - clock.wall);
 const offset = clock.offset + Math.max(-most, Math.min(most, target - clock.offset));
 return {offset, wall, now: Math.max(clock.now, wall + offset)};
}

/**
 * Whether another frame is needed: the estimate, its smoothed goal or the drawn bus is moving, a
 * correction is still settling, the bus is still turning, or a held bus is about to be eased
 * away. A standing, paused or reported-only bus costs nothing.
 */
export function needsFrames(e: Estimate | null, v: Visual | null, draw: Drawing = DRAWING) {
 if (!e || !v) return false;
 // A bus shown at its reports draws while it is travelling from the report it was drawn at to the
 // one that arrived; once it is there, nothing moves until the next report and the loop rests.
 if (v.glide && v.frame < v.glide.at + v.glide.ms) return true;
 // Playing back: frames while the moment shown is short of the newest report and the bus is not
 // already within scatter of it, and while an ease is running; then rest until the next report
 // arrives (a re-render wakes the loop, and the clock takes up the rest from where it stopped).
 if (v.buffer && e.mode === 'observed') {
  if (v.buffer.ease && v.frame < v.buffer.ease.at + v.buffer.ease.ms) return true;
  if (v.buffer.shown < e.basis.at + PACE.smoothMs) return true;
  if (v.buffer.sd < v.buffer.goalS - 0.05 || v.buffer.vd > 0.05) return true;
 }
 if (e.mode !== 'estimated') return false;
 return (e.speed ?? 0) > 0 && !e.capped && !e.held || Math.abs(v.velocity) > 0.05 || Math.abs(v.goalSpeed) > 0.05
  || (v.goal !== null && v.s !== null && Math.abs(v.s - v.goal) > 0.5)
  || (e.held === true && e.resumeAt != null && e.resumeAt - v.frame <= draw.smoothing * 1000)
  || (v.bearing !== null && v.heading !== null && Math.abs(shortestTurn(v.bearing, v.heading)) > 0.5);
}

// ------------------------------------------------------------------ uncertainty

/** Measured position error of held-out estimates, by report age. */
export type ErrorProfile = {version: string; basis: string;
 bins: {upTo: number; n: number; p50: number; p80: number}[]};

/**
 * How far from the drawn estimate the bus has actually been found, at this report age, in
 * 8 of 10 held-out cases. Null when too few cases were measured to say.
 */
export function uncertaintyAt(profile: ErrorProfile | null | undefined, reportAge: number, minimum = 30) {
 const bin = profile?.bins.find(b => reportAge <= b.upTo);
 return bin && bin.n >= minimum ? {metres: bin.p80, n: bin.n, upTo: bin.upTo} : null;
}
