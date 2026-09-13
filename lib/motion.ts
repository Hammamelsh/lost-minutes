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
 * observation time and brought forward to the presentation time; the difference from what was
 * being drawn becomes an offset that decays, so the drawn bus never jumps, never overshoots and
 * does not shuffle backwards and forwards. An estimate is never an observation: it is not
 * published, stored, or used to say that a bus reached, left or served a stop.
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

export type Track = {id: string; points: LonLat[]; cum: number[]; length: number};

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

export function makeTrack(id: string, points: LonLat[]): Track {
 const cum = [0];
 for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + metres(at(points[i - 1]), at(points[i])));
 return {id, points, cum, length: cum[cum.length - 1] ?? 0};
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
 * the rest are fixed choices. settle, holdBack, turnSettle, largeCorrection and catchUp only
 * shape how a correction is drawn, never where the estimate is. The defaults keep the page
 * usable before an evaluation exists.
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
};

export const DEFAULT_PARAMS: MotionParams = {
 version: 'motion-1 (unevaluated defaults)', maxSpeed: 17, stationarySpeed: 0.6, minSpan: 8,
 speedWindow: 45, maxGap: 120, horizon: 30, decay: 0, stale: 150, offTrack: 40, backwardTolerance: 25,
 largeCorrection: 150, settle: 0.9, holdBack: 35, turnSettle: 0.35, catchUp: 15,
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
};

type Speed = {speed: number | null; basis: string};

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
 if (speed < params.stationarySpeed) return {speed: 0, basis: `standing: ${Math.round(Math.max(0, ds))} m in ${Math.round(dt)} s`};
 const capped = speed > params.maxSpeed;
 speed = Math.min(speed, params.maxSpeed);
 return {speed, basis: `${Math.round(ds)} m in ${Math.round(dt)} s between its reports${capped ? ', capped' : ''}`};
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
 const horizon = Math.min(reportAge, params.horizon);
 // Buses stop at stops and lights, so the longer since the report, the less likely it has kept
 // its speed: with a decay time the distance eases off as speed × decay × (1 − e^(−t/decay)).
 const travelled = params.decay > 0 ? params.decay * (1 - Math.exp(-horizon / params.decay)) : horizon;
 const s = Math.min(track.length, Math.max(0, place.s + speed.speed * travelled));
 const point = pointAt(track, s);
 return {mode: 'estimated', reason: speed.speed === 0 ? 'standing at its last reports' : 'moving along its route',
  lat: point.lat, lon: point.lon, bearing: headingAt(track, s), s, basis: latest, reportAge, horizon,
  capped: reportAge > params.horizon, speed: speed.speed, speedBasis: speed.basis};
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

export type Visual = {
 mode: 'estimated' | 'observed';
 s: number | null; lat: number; lon: number; bearing: number | null;
 offset: number;               // drawn minus estimated, metres along the track; decays to 0
 trackId: string | null;
 basisAt: number;              // the report the current estimate starts from
 frame: number;                // presentation time of this frame, ms
 correction: Correction;
 lastCorrection: {kind: Correction; metres: number; at: number} | null;
 provisional: boolean;         // drawn at its report only while loading
};

function place(e: Estimate, now: number, trackId: string | null, correction: Correction,
               last: Visual['lastCorrection']): Visual {
 return {mode: e.mode, s: e.s, lat: e.lat, lon: e.lon, bearing: e.bearing, offset: 0, trackId,
  basisAt: e.basis.at, frame: now, correction, lastCorrection: last, provisional: e.provisional ?? false};
}

/**
 * Advance the drawn position to a new frame. A new report re-anchors the estimate; the gap
 * between what was drawn and the corrected estimate becomes an offset that decays
 * exponentially, no faster than `catchUp` m/s, which cannot overshoot. While the bus is
 * moving, a small correction that would draw it backwards is held instead, and the estimate
 * catches up; a large one snaps, and is reported as such so the page can say so.
 */
export function stepVisual(previous: Visual | null, e: Estimate, now: number, track: Track | null,
                           params = DEFAULT_PARAMS): Visual {
 const trackId = track?.id ?? null;
 // Shown at its report only while the settings or geometry loaded: the first estimate is simply
 // drawn, not presented as a correction.
 if (previous?.provisional && previous.mode === 'observed' && e.mode === 'estimated')
  return place(e, now, trackId, 'none', previous.lastCorrection);
 // Estimating resumes (a second report arrived after a jump, say): the bus eases on from where
 // it was drawn, on the same road, rather than jumping to the estimate.
 if (previous && previous.mode === 'observed' && e.mode === 'estimated' && track && e.s !== null) {
  const from = project(track, previous, e.s);
  if (from.offset <= params.offTrack && Math.abs(from.s - e.s) <= params.largeCorrection) {
   const point = pointAt(track, from.s);
   previous = {...previous, mode: 'estimated', s: from.s, lat: point.lat, lon: point.lon, offset: from.s - e.s,
    trackId, basisAt: e.basis.at, bearing: previous.bearing ?? headingAt(track, from.s)};
  }
 }
 if (!previous || e.mode !== 'estimated' || previous.mode !== 'estimated' || previous.trackId !== trackId
     || previous.s === null || e.s === null || !track) {
  // Leaving an estimate for a report is a correction, and is said; a bus shown at its reports
  // moving to its next report is simply that report.
  const moved = previous?.mode === 'estimated' ? metres(previous, e) : 0;
  const kind: Correction = moved > 1 ? 'snap' : 'none';
  return place(e, now, trackId, kind, kind === 'snap' ? {kind, metres: moved, at: now} : previous?.lastCorrection ?? null);
 }
 const dt = Math.max(0, (now - previous.frame) / 1000);
 // On a new report the estimate jumps; the drawn bus does not.
 let offset = previous.basisAt !== e.basis.at ? previous.s + 0 - e.s : previous.offset;
 let last = previous.lastCorrection;
 if (previous.basisAt !== e.basis.at && Math.abs(offset) > params.largeCorrection) {
  last = {kind: 'snap', metres: Math.abs(offset), at: now};
  const snapped = place(e, now, trackId, 'snap', last);
  return {...snapped, bearing: e.bearing};
 }
 if (previous.basisAt !== e.basis.at && Math.abs(offset) > 1) last = {kind: 'smooth', metres: Math.abs(offset), at: now};
 // The drawn bus catches up, never faster than catchUp m/s on top of its own movement, so a
 // correction reads as catching up rather than as a lurch.
 const decayed = offset * Math.exp(-dt / params.settle), most = params.catchUp * dt;
 offset = Math.abs(offset - decayed) > most ? offset - Math.sign(offset) * most : decayed;
 let s = e.s + offset, correction: Correction = Math.abs(offset) > 0.5 ? 'smooth' : 'none';
 if (s < previous.s && (e.speed ?? 0) > 0 && Math.abs(offset) <= params.holdBack) {
  s = previous.s;                // hold: the estimate catches up rather than the bus reversing
  offset = s - e.s;
  correction = 'hold';
 }
 s = Math.min(track.length, Math.max(0, s));
 const point = pointAt(track, s), heading = headingAt(track, s);
 const bearing = previous.bearing === null ? heading
  : turnToward(previous.bearing, heading, 1 - Math.exp(-dt / params.turnSettle));
 return {mode: 'estimated', s, lat: point.lat, lon: point.lon, bearing, offset, trackId,
  basisAt: e.basis.at, frame: now, correction, lastCorrection: last, provisional: false};
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

/** Whether another frame is needed: an estimate is moving, or a correction is still settling. */
export function needsFrames(e: Estimate | null, v: Visual | null) {
 if (!e || !v || e.mode !== 'estimated') return false;
 return (e.speed ?? 0) > 0 && !e.capped || Math.abs(v.offset) > 0.5
  || (v.bearing !== null && e.bearing !== null && Math.abs(shortestTurn(v.bearing, e.bearing)) > 0.5);
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
