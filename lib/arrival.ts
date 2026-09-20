/**
 * Estimated minutes to the passenger's stop: the blended candidate, on the device, from raw reports.
 *
 * This is the method evaluated in scripts/evaluate-arrival.py (docs/ARRIVAL_RELEASE_CRITERIA.md),
 * ported exactly, with the parameters frozen from the development set
 * (scripts/arrival-params-frozen.json). It reads the bus's own reports projected onto the accepted
 * road shape and the timetable's seconds per stop. It reads nothing from the drawn bus, its eased
 * speed, or anything in DRAWING: two passengers with different frame rates get the same minutes.
 *
 * It is shown only for a direction that public/data/arrival-release.json says has passed the
 * criteria on unseen data. Until then this computes and the page shows nothing, so release is a
 * data event, not a code change.
 *
 *   remaining  the timetable's seconds from where the bus is now to the stop: a difference, so
 *              the origin departure and its anchor do not enter (immune to the inbound discrepancy);
 *   progress   remaining road at the observed recent speed plus a dwell per stop between;
 *   blended    remaining, with progress taking over linearly inside the last NEAR metres.
 */
import {project, type Track} from '@/lib/motion';

export const ARRIVAL_PARAMS = {
 dwellS: 20, windowS: 180, standingBelow: 1.0, nearM: 1000,
 maxSpeed: 20, jumpSpeed: 30, staleS: 150, minLeadS: 60,
 /** Development cruise speeds per pattern, m/s; a pattern not listed falls back to 7 m/s. */
 cruise: {'BNML:15:inbound:9c10700c6c': 6.8, 'BNML:15:outbound:c9291c1aea': 6.6} as Record<string, number>,
} as const;

export type Report = {at: number; lat: number; lon: number};

export type ArrivalEstimate =
 | {kind: 'estimate'; atMs: number; minutes: number; lowMinutes: number; highMinutes: number;
    method: 'blended'; reportAgeS: number; remainingM: number}
 | {kind: 'none'; reason: string};

export type ArrivalRelease = {released: string[]; directions?: Record<string, {released: boolean; p80Abs?: number | null}>} | null;

/** The timetable's seconds at an offset along the road: linear between the bracketing stops. */
export function scheduledSecondsAt(track: Track, timing: (number | null)[], s: number): number | null {
 const stops: [number, number][] = [];
 track.stops.forEach((off, i) => {const sec = timing[i]; if (off !== null && off !== undefined && sec !== null && sec !== undefined) stops.push([off, sec]);});
 if (stops.length < 2) return null;
 if (s <= stops[0][0]) return stops[0][1];
 for (let i = 1; i < stops.length; i++) {
  const [o0, t0] = stops[i - 1], [o1, t1] = stops[i];
  if (o0 <= s && s <= o1) return o1 === o0 ? t0 : t0 + (t1 - t0) * (s - o0) / (o1 - o0);
 }
 return stops[stops.length - 1][1];
}

/** Along-road speed from the reports within the window, reading only from after the latest jump. */
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

/** Reports projected onto the road, in time order, off-road ones dropped. */
export function placeReports(track: Track, reports: Report[]): [number, number][] {
 const placed: [number, number][] = [];
 let near: number | undefined;
 for (const r of [...reports].sort((a, b) => a.at - b.at)) {
  const p = project(track, {lat: r.lat, lon: r.lon}, near);
  if (p.offset > 40) continue;
  placed.push([r.at, p.s]);
  near = p.s;
 }
 return placed;
}

/**
 * The estimate at `nowMs`, or why there is none. `stopIndex` is the passenger's stop on the
 * pattern; `timing` the pattern's seconds per stop (the named timing where the journey has one).
 */
export function arrivalEstimate(input: {
 track: Track; patternId: string; timing: (number | null)[]; stopIndex: number;
 reports: Report[]; nowMs: number;
 /** Which directions the criteria have released; the pattern's direction must be among them. */
 release: ArrivalRelease; direction: string;
}): ArrivalEstimate {
 const {track, timing, stopIndex, nowMs} = input;
 if (!input.release || !input.release.released.includes(input.direction))
  return {kind: 'none', reason: 'estimated minutes are not yet released for this direction: the evaluation has not met its criteria on unseen journeys'};
 const stopOffset = track.stops[stopIndex];
 if (stopOffset === undefined || stopOffset === null) return {kind: 'none', reason: 'the road shape does not place your stop'};
 const placed = placeReports(track, input.reports);
 if (placed.length < 2) return {kind: 'none', reason: 'too few reports on the road to read movement from'};
 const at = placed.length - 1;
 const [tNow, sNow] = placed[at];
 const ageS = (nowMs - tNow) / 1000;
 if (ageS > ARRIVAL_PARAMS.staleS) return {kind: 'none', reason: `its last report is ${Math.round(ageS)} s old, too old to estimate from`};
 if (sNow >= stopOffset) return {kind: 'none', reason: 'its last report is at or past your stop'};
 const atStop = timing[stopIndex], here = scheduledSecondsAt(track, timing, sNow);
 if (atStop === null || atStop === undefined || here === null) return {kind: 'none', reason: 'the timetable does not declare running times over this stretch'};
 const remainingSched = Math.max(0, atStop - here);
 const schedEta = tNow + remainingSched * 1000;
 const v = observedSpeed(placed, at, ARRIVAL_PARAMS.windowS);
 const remainingM = stopOffset - sNow;
 let eta = schedEta;
 if (v !== null && remainingM <= ARRIVAL_PARAMS.nearM) {
  const speed = v < ARRIVAL_PARAMS.standingBelow ? (ARRIVAL_PARAMS.cruise[input.patternId] ?? 7) : v;
  const between = track.stops.filter(so => so > sNow && so < stopOffset).length;
  const progEta = tNow + (remainingM / Math.max(speed, 0.5) + between * ARRIVAL_PARAMS.dwellS) * 1000;
  const w = remainingM / ARRIVAL_PARAMS.nearM;
  eta = w * schedEta + (1 - w) * progEta;
 }
 const minutes = Math.max(0, (eta - nowMs) / 60000);
 // The band is the measured p80 for the direction, if the release file carries one, else 2 min.
 const p80 = input.release.directions?.[input.direction]?.p80Abs ?? 2;
 return {kind: 'estimate', atMs: Math.round(eta), minutes, lowMinutes: Math.max(0, minutes - p80), highMinutes: minutes + p80,
         method: 'blended', reportAgeS: Math.round(ageS), remainingM: Math.round(remainingM)};
}

/** "about 6 min" or "4–8 min": a range when the direction's measured p80 is over 2 min. */
export function arrivalWords(e: Extract<ArrivalEstimate, {kind: 'estimate'}>) {
 const spread = e.highMinutes - e.minutes;
 if (spread > 2) return `${Math.round(e.lowMinutes)}–${Math.round(e.highMinutes)} min`;
 return `about ${Math.max(1, Math.round(e.minutes))} min`;
}
