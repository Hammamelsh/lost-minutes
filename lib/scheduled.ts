/**
 * A timetabled time at the passenger's stop: the scheduled journey's departure plus the
 * pattern's scheduled seconds to that stop. It is the operator's timetable, read out, and is
 * labelled as such. It is never an estimate, never adjusted by where the bus is, and never
 * shown for a bus that is not still before the stop in the timetabled order.
 *
 * Why so strict: a scheduled time looks like a prediction, and a passenger will read it as one.
 * So it is shown only when every premise is established rather than assumed:
 *   - the bus is matched to one pattern (an unsettled branch has no single timetable);
 *   - the operator's reported origin departure names exactly one journey on that pattern
 *     (two journeys at one departure would give two answers, which is no answer);
 *   - the pattern declares scheduled seconds at both the bus's stop and the passenger's stop
 *     (a link with no RunTime leaves everything after it unknown, never zero);
 *   - the bus's last report is before the passenger's stop in the stop order. Past it, or at it,
 *     the scheduled time is history and would mislead.
 */

export type ScheduledInput = {
 scheduled: {departure: string; journeys: number; serviceDay: string; timing?: number} | {reason: string} | null | undefined;
 /** The pattern's scheduled seconds from its first stop, parallel to its stops; null past an undeclared link. */
 seconds: (number | null)[] | undefined;
 /** Distinct timings among the merged journeys; `scheduled.timing` names the one every journey at that departure runs. */
 timings?: (number | null)[][];
 /** Index of the stop the bus's last report was nearest to, and of the passenger's stop. */
 busIndex: number;
 stopIndex: number;
 /** Whether this pattern's timetable clock has been checked against its own buses' passages at
  *  the first stops (public/data/schedule-anchor.json). Undefined: not checked, so withheld. On
  *  20 September 2026 inbound route 15 measured fifteen minutes early; nothing on the page could tell. */
 anchor?: {verified: boolean; reason?: string | null; medianOffsetMinutes?: number} | null;
};

export type ScheduledAtStop =
 | {kind: 'time'; atMs: number; wall: string; departure: string; secondsFromDeparture: number}
 | {kind: 'none'; reason: string};

/**
 * London wall-clock time on a service day, as an epoch millisecond, through Intl rather than a
 * DST rule of our own. `hms` is HH:MM:SS; hours of 24 and beyond (a timetable's early-hours
 * journeys) roll into the next day.
 */
export function londonWallToMs(serviceDay: string, hms: string): number | null {
 const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(serviceDay);
 const time = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(hms);
 if (!day || !time) return null;
 const [y, mo, d] = [Number(day[1]), Number(day[2]), Number(day[3])];
 const [h, mi, s] = [Number(time[1]), Number(time[2]), Number(time[3])];
 // Start from the wall time read as UTC, then correct by London's offset at that instant.
 // Two passes settle the reading across a DST change.
 let guess = Date.UTC(y, mo - 1, d, h, mi, s);
 for (let pass = 0; pass < 2; pass++) {
  const offsetMinutes = londonOffsetMinutes(guess);
  const corrected = Date.UTC(y, mo - 1, d, h, mi, s) - offsetMinutes * 60_000;
  if (corrected === guess) break;
  guess = corrected;
 }
 return guess;
}

const parts = new Intl.DateTimeFormat('en-GB', {timeZone: 'Europe/London', hourCycle: 'h23',
 year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'});

/** London's offset from UTC, in minutes, at a given instant. */
export function londonOffsetMinutes(atMs: number): number {
 const p = Object.fromEntries(parts.formatToParts(atMs).filter(x => x.type !== 'literal').map(x => [x.type, Number(x.value)]));
 const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
 return Math.round((asUtc - atMs) / 60_000);
}

/** "14:32" in London time. */
export function londonWall(atMs: number): string {
 const p = Object.fromEntries(parts.formatToParts(atMs).filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
 return `${p.hour}:${p.minute}`;
}

export function scheduledAtStop(input: ScheduledInput): ScheduledAtStop {
 const {scheduled, busIndex, stopIndex} = input;
 if (!scheduled) return {kind: 'none', reason: 'no scheduled journey was named for this bus'};
 if ('reason' in scheduled) return {kind: 'none', reason: reasonWords(scheduled.reason)};
 // With a timing named, the pipeline has checked that every journey at this departure runs the
 // same one, so their time at any stop is the same and naming it is safe. Without one (an
 // older publication), two journeys at a departure could differ, and the answer is withheld.
 const timed = scheduled.timing !== undefined ? input.timings?.[scheduled.timing] : undefined;
 if (scheduled.journeys !== 1 && !timed) return {kind: 'none', reason: `${scheduled.journeys} timetabled journeys leave at ${scheduled.departure.slice(0, 5)}, so which one this is cannot be told`};
 // The timetable's clock must be known to start where the bus does. Unchecked is withheld, not assumed.
 if (!input.anchor) return {kind: 'none', reason: 'this service’s timetable clock has not been checked against its own buses yet'};
 if (!input.anchor.verified) return {kind: 'none', reason: input.anchor.reason ?? 'this service’s timetable clock does not match where its buses are'};
 if (busIndex >= stopIndex) return {kind: 'none', reason: busIndex === stopIndex ? 'its last report was nearest your stop already' : 'its last report was past your stop in the timetabled order'};
 const seconds = timed ?? input.seconds;
 if (!seconds) return {kind: 'none', reason: 'this timetable does not declare running times'};
 const atStop = seconds[stopIndex], atBus = seconds[busIndex];
 if (atStop === null || atStop === undefined || atBus === null || atBus === undefined)
  return {kind: 'none', reason: 'the timetable does not declare a running time to your stop'};
 const atMs = londonWallToMs(scheduled.serviceDay, scheduled.departure);
 if (atMs === null) return {kind: 'none', reason: 'the scheduled departure could not be read'};
 const when = atMs + atStop * 1000;
 return {kind: 'time', atMs: when, wall: londonWall(when), departure: scheduled.departure, secondsFromDeparture: atStop};
}

function reasonWords(reason: string) {
 switch (reason) {
  case 'no_aimed_departure_reported': return 'the operator did not report which departure this bus is running';
  case 'aimed_departure_unreadable': return 'the reported departure time could not be read';
  case 'aimed_departure_not_in_timetable': return 'the reported departure is not in the timetable held here';
  case 'pattern_has_no_departure_times': return 'this timetable lists no departures for the pattern';
  case 'journeys_at_this_time_differ_in_timing': return 'more than one timetabled journey leaves at that time, and they reach your stop at different times';
  default: return reason;
 }
}
