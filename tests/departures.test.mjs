// The stop departure board's arithmetic: seconds from local midnight into real instants, across
// midnight and across both clock changes, and which journeys belong to which service day.
//
// These are the cases a browser check cannot choose the moment for, so they are settled here.
import test from 'node:test';
import assert from 'node:assert/strict';
import {clockWords, countdownWords, londonInstant, minutesUntil, nextDepartures, previousDay,
  serviceDayOf} from '../lib/departures.ts';

const WEEK = [{days: [0, 1, 2, 3, 4, 5, 6]}];
/** A board whose one service leaves the origin at the given seconds and reaches this stop `offset`
 *  later. `rule` 0 is the every-day rule; -1 is a journey whose operating profile we could not read. */
const board = (originSeconds, {offset = 600, rule = 0} = {}) => ({
  stop: '1800SJ00811', generatedAt: '2026-09-22T00:00:00Z',
  services: [{patternId: 'P', operator: 'BNML', line: '256', direction: 'inbound',
    destination: 'Piccadilly Gardens', sequence: 6, rules: [0], offsets: [offset],
    runs: [[rule, 0, originSeconds[0], ...originSeconds.slice(1).map((s, i) => s - originSeconds[i])]]}],
});

test('seconds from local midnight become real instants, in GMT and in BST', () => {
  // 22 September 2026 is British Summer Time: 08:00 local is 07:00 UTC.
  assert.equal(new Date(londonInstant('2026-09-22', 8 * 3600)).toISOString(), '2026-09-22T07:00:00.000Z');
  // 22 December is GMT: 08:00 local is 08:00 UTC.
  assert.equal(new Date(londonInstant('2026-12-22', 8 * 3600)).toISOString(), '2026-12-22T08:00:00.000Z');
  // Local midnight itself, either side of the year.
  assert.equal(new Date(londonInstant('2026-09-22', 0)).toISOString(), '2026-09-21T23:00:00.000Z');
  assert.equal(new Date(londonInstant('2026-12-22', 0)).toISOString(), '2026-12-22T00:00:00.000Z');
});

test('the clock changes: an hour that does not happen, and an hour that happens twice', () => {
  // Spring forward, 29 March 2026: 01:00 GMT becomes 02:00 BST, so 00:30 is still GMT.
  assert.equal(new Date(londonInstant('2026-03-29', 30 * 60)).toISOString(), '2026-03-29T00:30:00.000Z');
  // 03:00 local that morning is 02:00 UTC: the day is 23 hours long and a timetable still states
  // wall-clock times, so 03:00 must not be read as 03:00 UTC.
  assert.equal(new Date(londonInstant('2026-03-29', 3 * 3600)).toISOString(), '2026-03-29T02:00:00.000Z');
  // Autumn back, 25 October 2026: 02:00 BST becomes 01:00 GMT. 00:30 is BST, 03:00 is GMT.
  assert.equal(new Date(londonInstant('2026-10-25', 30 * 60)).toISOString(), '2026-10-24T23:30:00.000Z');
  assert.equal(new Date(londonInstant('2026-10-25', 3 * 3600)).toISOString(), '2026-10-25T03:00:00.000Z');
});

test('a journey timed past midnight belongs to the day it set out on, and sorts after it', () => {
  // 23:45 local on 22 September 2026, BST.
  const now = Date.parse('2026-09-22T22:45:00Z');
  // Origins at 23:40, 23:55 and 00:10 the next morning (87 000 s), each ten minutes to this stop.
  const rows = nextDepartures(board([85_200, 86_100, 87_000]), WEEK, now, {withinMinutes: 180});
  assert.deepEqual(rows.map(r => clockWords(r)), ['23:50', '00:05', '00:20']);
  assert.deepEqual(rows.map(r => minutesUntil(r, now)), [5, 20, 35]);
  assert.ok(rows[2].atMs > rows[0].atMs, 'the small hours come after the late evening, never before');
  assert.equal(rows[2].serviceDay, '2026-09-22', 'and they still belong to the day they set out on');
});

test('just after midnight, yesterday’s late journeys are still the ones running', () => {
  // 00:02 local on 23 September; the board for the 23rd has nothing this early.
  const now = Date.parse('2026-09-22T23:02:00Z');
  assert.equal(serviceDayOf(now), '2026-09-23');
  assert.equal(previousDay(serviceDayOf(now)), '2026-09-22');
  const rows = nextDepartures(board([87_000, 88_800]), WEEK, now, {withinMinutes: 180});
  assert.deepEqual(rows.map(r => clockWords(r)), ['00:20', '00:50']);
  assert.deepEqual(rows.map(r => r.serviceDay), ['2026-09-22', '2026-09-22']);
});

test('a departure already gone is dropped, with a minute of grace for the one just leaving', () => {
  const now = Date.parse('2026-09-22T09:00:30Z');            // 10:00:30 local
  const rows = nextDepartures(board([34_200, 35_400, 36_600]), WEEK, now); // 09:30, 09:50, 10:10 + 10 min
  assert.deepEqual(rows.map(r => clockWords(r)), ['10:00', '10:20']);
  assert.equal(countdownWords(rows[0], now), 'due');
  assert.equal(countdownWords(rows[1], now), '20 min');
});

test('a day the service does not run publishes no departures for it', () => {
  const sundays = [{days: [6]}];
  const tuesday = Date.parse('2026-09-22T09:00:00Z');        // 22 September 2026 is a Tuesday
  assert.deepEqual(nextDepartures(board([36_000]), sundays, tuesday), []);
  const sunday = Date.parse('2026-09-27T09:00:00Z');
  assert.equal(nextDepartures(board([36_000]), sundays, sunday).length, 1);
});

test('a journey whose operating profile could not be read is kept and marked, not guessed at', () => {
  const now = Date.parse('2026-09-22T09:00:00Z');
  const rows = nextDepartures(board([36_000], {rule: -1}), WEEK, now);
  assert.equal(rows.length, 1, 'it is listed: dropping it would hide a bus that does run');
  assert.equal(rows[0].dayKnown, false, 'and the board can say the day is unconfirmed');
});

test('two journeys at one departure time are never pinned to a single vehicle', () => {
  const now = Date.parse('2026-09-22T09:00:00Z');
  const twice = board([36_000]);
  twice.services[0].runs.push([0, 0, 36_000]);
  const rows = nextDepartures(twice, WEEK, now);
  assert.equal(rows.length, 2);
  assert.ok(rows.every(r => r.sharedDeparture === 2), 'the board knows the time is shared');
});

test('the board carries the origin departure, which is what a vehicle reports', () => {
  const now = Date.parse('2026-09-22T09:00:00Z');
  const [row] = nextDepartures(board([36_000], {offset: 900}), WEEK, now);
  assert.equal(row.originLocal, '10:00:00', 'the origin, not the time at this stop');
  assert.equal(clockWords(row), '10:15', 'and the time at this stop is the origin plus its run time');
});
