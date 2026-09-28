/**
 * Estimated minutes to the passenger's stop: the blended candidate, on the device, from raw reports.
 *
 * This is scripts/evaluate-arrival.py's `blended_eta`, ported line by line, on the evaluation's own
 * geometry (pipeline/passages.py: 111,320 m a degree, longitude scaled at each segment's start, the
 * same search window and the same fall-back), with the parameters frozen from the development set
 * (scripts/arrival-params-frozen.json, `ARRIVAL_MODEL` names its hash) and the same truncation to the
 * millisecond. `scripts/arrival-parity.mjs` holds it to the evaluator's own answers on every held-out
 * moment. It reads the bus's own reports and nothing drawn: not the playback position, not an eased
 * speed, not anything in DRAWING.
 *
 * Until 28 September 2026 this was a near port on the map's geometry (6,371 km Earth, a different
 * search window, stops re-indexed in road order, cruise speeds rounded, a 7 m/s default), read only
 * the six reports a publication carries, and was released by direction alone: "outbound" would have
 * shown minutes for every outbound service with a checked road. Now a direction is shown only for
 * the exact operator, line, direction, pattern and model a release names (`releasedScope`).
 *
 *   remaining  the timetable's seconds from where the bus is now to the stop: a difference, so
 *              the origin departure and its anchor do not enter;
 *   progress   remaining road at the observed recent speed plus a dwell per stop between;
 *   blended    remaining, with progress taking over linearly inside the last NEAR metres.
 */

import {alignedOffsets} from '@/lib/stop-mapping';

/** The frozen parameters, exactly as scripts/arrival-params-frozen.json holds them (a test compares). */
export const ARRIVAL_MODEL = 'blended@9a626129f782';
export const ARRIVAL_PARAMS = {
 dwellS: 20, windowS: 180, standingBelow: 1.0, nearM: 1000,
 /** Module constants of the evaluator (MAX_SPEED, JUMP_SPEED = MAX_SPEED × 1.5) and its placement rule. */
 maxSpeed: 20, jumpSpeed: 30, offRoadM: 40,
 /** Development cruise speeds per pattern, m/s; a pattern not listed takes 8.0, as `score()` does. */
 cruise: {'BNML:15:inbound:9c10700c6c': 6.835152809242572, 'BNML:15:outbound:c9291c1aea': 6.5604698255297675} as Record<string, number>,
 cruiseDefault: 8.0,
} as const;

/** What the page adds on top of the evaluated estimate, none of it an input to the estimate. */
export const ARRIVAL_DISPLAY = {
 /** A report older than this is not estimated from (the freshness policy's "ageing" band ends at 150 s). */
 staleS: 150,
 /** The band the release criteria were judged in: minutes outside it are not shown. */
 minMinutes: 2, maxMinutes: 10,
};

export type Report = {at: number; lat: number; lon: number};

// ------------------------------------------------------------------ the evaluation's geometry

/** The accepted road as pipeline/passages.py's Track holds it: points as (lat, lon), cumulative metres
 *  by its own rule, and the stop offsets indexed by the pattern's own stops (null where none). */
export type ArrivalTrack = {points: [number, number][]; cum: number[]; length: number; stopOffsets: (number | null)[]};

const M_PER_DEG = 111320;
const DEG = Math.PI / 180;

function decodePolyline6(text: string): [number, number][] {
 const points: [number, number][] = [];
 let index = 0, lat = 0, lon = 0;
 const next = () => {
  let result = 0, shift = 0, byte: number;
  do { byte = text.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
  return result & 1 ? ~(result >> 1) : result >> 1;
 };
 while (index < text.length) { lat += next(); lon += next(); points.push([lat / 1000000, lon / 1000000]); }
 return points;
}

const metres = (a: [number, number], b: [number, number]) =>
 Math.hypot((a[0] - b[0]) * M_PER_DEG, (a[1] - b[1]) * M_PER_DEG * Math.cos(a[0] * DEG));

/**
 * The road from its published shape, its stops on the pattern's own indices from the shape's explicit stop
 * mapping (lib/stop-mapping.ts): null for a stop the road was not built through. A shape with no mapping, or
 * one that disagrees with this pattern in any respect, gives no track: which stop is which is never inferred
 * from list position (until 28 September 2026 it was, and was wrong for inbound 15).
 */
export function arrivalTrack(polyline6: string, mapping: unknown, pattern: {id: string; stops: string[]}): ArrivalTrack | null {
 const points = decodePolyline6(polyline6);
 if (points.length < 2) return null;
 const cum = [0];
 for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + metres(points[i - 1], points[i]));
 const aligned = alignedOffsets(mapping, pattern, cum[cum.length - 1]);
 if ('error' in aligned) return null;
 return {points, cum, length: cum[cum.length - 1], stopOffsets: aligned.offsets};
}

function segmentAt(track: ArrivalTrack, s: number) {
 let lo = 0, hi = track.cum.length - 1;
 while (lo < hi - 1) { const mid = (lo + hi) >> 1; if (track.cum[mid] <= s) lo = mid; else hi = mid; }
 return lo;
}

/** Track.project: (offset along the road, distance off it), searched near `near` and, if that misses
 *  by more than 25 m, along the whole road. */
export function projectOnto(track: ArrivalTrack, p: {lat: number; lon: number}, near: number | null = null): [number, number] {
 let best: [number, number] = [0, Infinity];
 let lo = 0, hi = track.points.length - 1;
 if (near !== null) {
  lo = Math.max(0, segmentAt(track, near - 600));
  hi = Math.min(track.points.length - 1, segmentAt(track, near + 3000) + 1);
 }
 for (let i = Math.max(1, lo); i <= hi; i++) {
  const a = track.points[i - 1], b = track.points[i];
  const cosl = Math.cos(a[0] * DEG);
  const bx = (b[1] - a[1]) * M_PER_DEG * cosl, by = (b[0] - a[0]) * M_PER_DEG;
  const px = (p.lon - a[1]) * M_PER_DEG * cosl, py = (p.lat - a[0]) * M_PER_DEG;
  const seg = bx * bx + by * by;
  const t = seg === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / seg));
  const d = Math.hypot(px - t * bx, py - t * by);
  if (d < best[1]) best = [track.cum[i - 1] + t * (track.cum[i] - track.cum[i - 1]), d];
 }
 if (near !== null && best[1] > 25) return projectOnto(track, p);
 return best;
}

/** place_reports: in time order, each searched near the one before, off-road ones (over 40 m) dropped. */
export function placeReports(track: ArrivalTrack, reports: Report[]): [number, number][] {
 const placed: [number, number][] = [];
 let near: number | null = null;
 const ordered = [...reports].sort((a, b) => a.at - b.at || a.lat - b.lat || a.lon - b.lon);
 for (const r of ordered) {
  const [s, off] = projectOnto(track, r, near);
  if (off > ARRIVAL_PARAMS.offRoadM) continue;
  placed.push([r.at, s]);
  near = s;
 }
 return placed;
}

// ------------------------------------------------------------------ the candidate

/** observed_speed: along-road speed from the reports within the window, reading only from after the latest jump. */
export function observedSpeed(placed: [number, number][], at: number, windowS: number): number | null {
 const [tNow, sNow] = placed[at];
 let start = at;
 while (start > 0 && tNow - placed[start - 1][0] <= windowS * 1000) {
  const dt = (placed[start][0] - placed[start - 1][0]) / 1000, ds = placed[start][1] - placed[start - 1][1];
  if (dt <= 0 || ds < -25 || ds / dt > ARRIVAL_PARAMS.jumpSpeed) break;
  start--;
 }
 if (start === at) return null;
 const span = (tNow - placed[start][0]) / 1000;
 if (span < 20) return null;
 return Math.max(0, Math.min(ARRIVAL_PARAMS.maxSpeed, (sNow - placed[start][1]) / span));
}

/** scheduled_seconds_at: the timetable's seconds at an offset, linear between the bracketing stops. */
export function scheduledSecondsAt(offsets: (number | null)[], timing: (number | null)[], s: number): number | null {
 const stops: [number, number][] = [];
 for (let i = 0; i < Math.min(offsets.length, timing.length); i++) {
  const off = offsets[i], sec = timing[i];
  if (off !== null && off !== undefined && sec !== null && sec !== undefined) stops.push([off, sec]);
 }
 if (stops.length < 2) return null;
 if (s <= stops[0][0]) return stops[0][1];
 for (let k = 1; k < stops.length; k++) {
  const [o0, t0] = stops[k - 1], [o1, t1] = stops[k];
  if (o0 <= s && s <= o1) return o1 === o0 ? t0 : t0 + (t1 - t0) * (s - o0) / (o1 - o0);
 }
 return stops[stops.length - 1][1];
}

function remainingEta(placed: [number, number][], at: number, stopIndex: number, offsets: (number | null)[], timing: (number | null)[]) {
 const [tNow, sNow] = placed[at];
 const atStop = stopIndex < timing.length ? timing[stopIndex] : null;
 const here = scheduledSecondsAt(offsets, timing, sNow);
 const stopOffset = offsets[stopIndex];
 if (atStop === null || atStop === undefined || here === null || stopOffset === null || stopOffset === undefined || sNow >= stopOffset) return null;
 return Math.trunc(tNow + Math.max(0, atStop - here) * 1000);
}

function progressEta(placed: [number, number][], at: number, stopOffset: number, offsets: (number | null)[], cruise: number) {
 const [tNow, sNow] = placed[at];
 if (sNow >= stopOffset) return null;
 let v = observedSpeed(placed, at, ARRIVAL_PARAMS.windowS);
 if (v === null) return null;
 if (v < ARRIVAL_PARAMS.standingBelow) v = cruise;
 const remaining = stopOffset - sNow;
 const between = offsets.filter(so => so !== null && so !== undefined && sNow < so && so < stopOffset).length;
 const seconds = remaining / Math.max(v, 0.5) + between * ARRIVAL_PARAMS.dwellS;
 return Math.trunc(tNow + seconds * 1000);
}

/** blended_eta, in ms, or null: the evaluator's answer for placed[at] and the stop at `stopIndex`. */
export function blendedEta(placed: [number, number][], at: number, stopIndex: number, offsets: (number | null)[],
                           timing: (number | null)[], cruise: number): number | null {
 const stopOffset = offsets[stopIndex];
 if (stopOffset === null || stopOffset === undefined) return null;
 const sched = remainingEta(placed, at, stopIndex, offsets, timing);
 const prog = progressEta(placed, at, stopOffset, offsets, cruise);
 const remaining = stopOffset - placed[at][1];
 if (sched === null) return prog;
 if (prog === null || remaining > ARRIVAL_PARAMS.nearM) return sched;
 const w = remaining / ARRIVAL_PARAMS.nearM;
 return Math.trunc(w * sched + (1 - w) * prog);
}

export const cruiseFor = (patternId: string) => ARRIVAL_PARAMS.cruise[patternId] ?? ARRIVAL_PARAMS.cruiseDefault;

// ------------------------------------------------------------------ what a release covers

/** One released scope, as scripts/arrival-release-check.py writes it: exactly what was evaluated and approved. */
export type ArrivalScope = {operator: string; line: string; direction: string; patternIds: string[]; model: string;
 p80Abs?: number | null; medianAbs?: number | null};
/** The published verdict. `released` is the list of directions before 28 September 2026, kept empty
 *  so a page from before then shows nothing; `scopes` is what a page may show minutes for now. */
export type ArrivalRelease = {released: string[]; scopes?: ArrivalScope[]} | null;

/** The scope that releases this pattern, if any: operator, line, direction, pattern and model all named. */
export function releasedScope(release: ArrivalRelease, pattern: {id: string; operator?: string | null; line: string; direction?: string | null}): ArrivalScope | null {
 for (const scope of release?.scopes ?? []) {
  if (scope.model === ARRIVAL_MODEL && scope.operator === (pattern.operator ?? '') && scope.line === pattern.line
   && scope.direction === (pattern.direction ?? '') && Array.isArray(scope.patternIds) && scope.patternIds.includes(pattern.id)) return scope;
 }
 return null;
}

// ------------------------------------------------------------------ the page's reading of one journey

/**
 * One journey's reports as the page has received them, and from when it holds every one of them. A
 * publication carries the latest report and at most `TRAIL_POINTS` earlier ones of the same journey
 * within `TRAIL_SECONDS` (pipeline/live.py): the six newest, so a full trail is complete back to its
 * oldest point and a shorter one back to the window's start. Publications that overlap extend what is
 * complete; a gap starts again from the new one. The evaluator reads 180 s of reports for a speed, so
 * minutes are given only once every report of those 180 s is held.
 */
export const TRAIL_POINTS = 6, TRAIL_SECONDS = 240;
export type JourneyHistory = {key: string; reports: Report[]; completeFrom: number; latest: number};

export function withPublication(history: JourneyHistory | null, key: string, latest: Report, trail: Report[]): JourneyHistory {
 const known = history && history.key === key ? history : null;
 const own = [...trail.filter(r => r.at < latest.at), latest];
 const completeFrom = trail.length >= TRAIL_POINTS ? Math.min(...trail.map(r => r.at)) : latest.at - TRAIL_SECONDS * 1000;
 if (!known) return {key, reports: dedupe(own), completeFrom, latest: latest.at};
 if (latest.at < known.latest) return known;       // an older publication than one already read
 // Contiguous if this publication reaches back to what was already held.
 const joined = completeFrom <= known.latest;
 return {key, reports: dedupe([...known.reports, ...own]), completeFrom: joined ? Math.min(known.completeFrom, completeFrom) : completeFrom,
         latest: latest.at};
}
function dedupe(reports: Report[]) {
 const byAt = new Map<number, Report>();
 for (const r of reports) byAt.set(r.at, r);
 // Only what the window and a margin need: older reports cannot change an estimate.
 const newest = Math.max(...byAt.keys());
 return [...byAt.values()].filter(r => r.at >= newest - (TRAIL_SECONDS + ARRIVAL_PARAMS.windowS) * 1000).sort((a, b) => a.at - b.at);
}

// ------------------------------------------------------------------ the estimate, and every reason there is none

export type ArrivalEstimate =
 | {kind: 'estimate'; atMs: number; minutes: number; lowMinutes: number; highMinutes: number;
    method: 'blended'; model: string; reportAgeS: number; remainingM: number}
 | {kind: 'none'; reason: string};

/**
 * The estimate at `nowMs` for the stop at `stopIndex`, or why there is none. Every refusal before the
 * evaluator's answer is the page's own, and none of them changes that answer: the scope, the road, a
 * journey the passenger did not choose, the 180 s of reports, freshness, a latest report off the road.
 * After it, minutes outside the band the criteria were judged in are not shown.
 */
export function arrivalEstimate(input: {
 release: ArrivalRelease; pattern: {id: string; operator?: string | null; line: string; direction?: string | null};
 track: ArrivalTrack | null; timing: (number | null)[]; stopIndex: number;
 history: JourneyHistory | null; nowMs: number;
 /** The chosen bus has since started another journey: the minutes would be for a journey not chosen. */
 journeyChanged?: boolean;
}): ArrivalEstimate {
 const scope = releasedScope(input.release, input.pattern);
 if (!scope) return {kind: 'none', reason: 'estimated minutes are not released for this service'};
 if (input.journeyChanged) return {kind: 'none', reason: 'it has started another journey'};
 if (!input.track) return {kind: 'none', reason: 'its checked road is not loaded, or its stops do not line up with the timetable'};
 const history = input.history;
 if (!history || !history.reports.length) return {kind: 'none', reason: 'no report of this journey has been read yet'};
 const latest = history.reports[history.reports.length - 1];
 if (latest.at > input.nowMs + 1000) return {kind: 'none', reason: 'its latest report is timed after our clock'};
 if (history.completeFrom > latest.at - ARRIVAL_PARAMS.windowS * 1000)
  return {kind: 'none', reason: 'reading its recent pace: minutes follow once three minutes of its reports are in'};
 const ageS = (input.nowMs - latest.at) / 1000;
 if (ageS > ARRIVAL_DISPLAY.staleS) return {kind: 'none', reason: `its last report is ${Math.round(ageS)} s old, too old to estimate from`};
 const placed = placeReports(input.track, history.reports.filter(r => r.at <= latest.at));
 if (!placed.length || placed[placed.length - 1][0] !== latest.at) return {kind: 'none', reason: 'its last report is off its checked road'};
 const at = placed.length - 1;
 const stopOffset = input.track.stopOffsets[input.stopIndex];
 if (stopOffset === null || stopOffset === undefined) return {kind: 'none', reason: 'its checked road does not place your stop'};
 if (placed[at][1] >= stopOffset) return {kind: 'none', reason: 'its last report is at or past your stop'};
 const eta = blendedEta(placed, at, input.stopIndex, input.track.stopOffsets, input.timing, cruiseFor(input.pattern.id));
 if (eta === null) return {kind: 'none', reason: 'neither its pace nor the timetable gives a time to your stop'};
 const minutes = (eta - input.nowMs) / 60000;
 if (minutes < ARRIVAL_DISPLAY.minMinutes) return {kind: 'none', reason: 'under 2 minutes away: minutes are given from 2 to 10'};
 if (minutes > ARRIVAL_DISPLAY.maxMinutes) return {kind: 'none', reason: 'more than 10 minutes away: minutes are given from 2 to 10'};
 const p80 = scope.p80Abs ?? 2;
 return {kind: 'estimate', atMs: eta, minutes, lowMinutes: Math.max(0, minutes - p80), highMinutes: minutes + p80,
         method: 'blended', model: ARRIVAL_MODEL, reportAgeS: Math.round(ageS), remainingM: Math.round(stopOffset - placed[at][1])};
}

/** "about 6 min", or "4–9 min" when the direction's measured 80th-percentile error is over 2 min: the
 *  ends rounded to whole minutes, never below 1. */
export function arrivalWords(e: Extract<ArrivalEstimate, {kind: 'estimate'}>) {
 const spread = e.highMinutes - e.minutes;
 if (spread > 2) return `${Math.max(1, Math.round(e.lowMinutes))}–${Math.round(e.highMinutes)} min`;
 return `about ${Math.max(1, Math.round(e.minutes))} min`;
}
