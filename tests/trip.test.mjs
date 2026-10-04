// A journey made one step at a time (lib/trip.ts, 4 October 2026): the steps a plan is made of, which stop each is
// about, when a position is at a place, which bus a passenger at the stop has most likely boarded, how far a ridden bus
// has to go, and the words for when to leave. Small hand-made legs, stops and buses; the planner's own tests cover how
// the legs are found.
import test from 'node:test';
import assert from 'node:assert/strict';
import {AT, boardingCandidates, connectionStage, connectionTripTimes, directTripTimes, durationWords, inWords, isAt, leaveWords,
  offsetWords, readStoredTrip, rideProgress, stepOfStage, stepStop, storedTrip, tripSteps} from '../lib/trip.ts';

// Ten stops due north, about 111 m apart (0.001° of latitude).
const stop = i => ({id: `S${i}`, name: `Stop ${i}`, indicator: null, lat: 53.47 + i * 0.001, lon: -2.24});
const stops = Array.from({length: 10}, (_, i) => stop(i));
const pattern = (id, ids) => ({id, stops: ids});
const leg = (p, board, alight, line = '42', also = []) => ({pattern: p, line, operator: 'BNML', headsign: 'Didsbury',
  board: stops[board], boardIndex: board, alight: stops[alight], alightIndex: alight, rideStops: alight - board, rideMetres: null, also});
const P = pattern('P42', stops.map(s => s.id));
const bus = (key, patternId, patternIndex, at = stops[Math.max(0, Math.min(9, patternIndex))]) => ({key, route: '42', lat: at.lat, lon: at.lon,
  observedAtMs: 1_000, ageWords: '20 s ago', match: {patternId, patternIndex}});
const to = {lat: 53.481, lon: -2.24, label: 'Didsbury'};

test('a direct plan is: walk to the stop, wait, ride, walk to the destination; each step about one stop', () => {
  const l = leg(P, 2, 7);
  const steps = tripSteps({kind: 'direct', option: {key: 'd:x', leg: l, board: l.board, alight: l.alight}}, to);
  assert.deepEqual(steps.map(s => s.kind), ['walk', 'wait', 'ride', 'arrive']);
  assert.deepEqual(steps.map(s => stepStop(s).id), ['S2', 'S2', 'S7', 'S7'], 'the page\'s stop: the boarding stop, then the stop to get off at');
  assert.equal(steps[3].to.label, 'Didsbury');
});

test('a journey with a change has a walk between the stops, or none at the same stop; and its stages map to the steps', () => {
  const first = leg(P, 1, 4), second = leg(pattern('P250', ['S4', 'S5', 'S6', 'S8']), 0, 3, '250');
  second.board = stops[5]; second.alight = stops[8];
  const option = (sameStop) => ({key: 'c:x', first, second, transfer: {from: stops[4], to: sameStop ? stops[4] : stops[5], straightMetres: 111, sameStop}});
  const walked = tripSteps({kind: 'connection', option: option(false)}, to);
  assert.deepEqual(walked.map(s => s.kind), ['walk', 'wait', 'ride', 'change', 'wait', 'ride', 'arrive']);
  assert.deepEqual(walked.map((_, i) => connectionStage(walked, i)), ['before', 'before', 'first', 'first', 'first', 'second', 'second']);
  assert.equal(stepOfStage(walked, 'first'), 2);
  assert.equal(stepOfStage(walked, 'second'), 5);
  assert.equal(stepStop(walked[3]).id, 'S5', 'the change is about the stop the second bus leaves from');
  const same = tripSteps({kind: 'connection', option: option(true)}, to);
  assert.deepEqual(same.map(s => s.kind), ['walk', 'wait', 'ride', 'wait', 'ride', 'arrive'], 'no walk of its own at the same stop');
});

test('at a place: within the fix\'s own accuracy, never under 35 m and never over 60 m', () => {
  const place = {lat: 53.47, lon: -2.24};
  const north = (m, accuracyMetres) => ({lat: 53.47 + m / 111_195, lon: -2.24, accuracyMetres});
  assert.equal(isAt(north(30, 5), place), true, 'a tight fix 30 m away: at it (the floor is 35 m)');
  assert.equal(isAt(north(40, 5), place), false);
  assert.equal(isAt(north(50, 55), place), true, 'a 55 m fix 50 m away');
  assert.equal(isAt(north(70, 200), place), false, 'a poor fix is not an arrival: the ceiling is 60 m');
  assert.equal(isAt(null, place), false);
  assert.deepEqual(AT, {minMetres: 35, maxMetres: 60});
});

test('the bus just boarded: one of the leg\'s buses from two stops before the stop to four after, nearest the device first', () => {
  const l = leg(P, 3, 8);
  const buses = [bus('far-before', 'P42', 0), bus('just-before', 'P42', 2), bus('at', 'P42', 3), bus('left', 'P42', 5),
    bus('well-on', 'P42', 8), bus('other-line', 'P99', 3)];
  const ranked = boardingCandidates(l, buses).map(c => c.bus.key);
  assert.deepEqual(ranked, ['at', 'just-before', 'left'], 'within the window, nearest the stop first; past the alighting stop and other lines out');
  const here = {lat: stops[5].lat, lon: stops[5].lon};
  assert.equal(boardingCandidates(l, buses, here)[0].bus.key, 'left', 'the one whose report is where the device is leads');
  // A bus of a sibling line between the same stops counts as the leg's own.
  const P142 = pattern('P142', stops.map(s => s.id));
  const withSibling = leg(P, 3, 8, '42', [leg(P142, 3, 8, '142')]);
  assert.deepEqual(boardingCandidates(withSibling, [bus('sib', 'P142', 4)]).map(c => c.bus.key), ['sib']);
  // On board with no bus chosen yet: anywhere from a stop before the boarding stop to the stop before the one to get off at.
  const onBoard = boardingCandidates(l, buses, null, {before: 1, after: l.rideStops}).map(c => c.bus.key);
  assert.deepEqual(onBoard, ['at', 'just-before', 'left'], 'past the stop to get off at is not the bus to follow there');
  assert.equal(offsetWords(-2, 'Stop 3'), '2 stops before Stop 3');
  assert.equal(offsetWords(0, 'Stop 3'), 'last report nearest Stop 3');
  assert.equal(offsetWords(1, 'Stop 3'), '1 stop past Stop 3');
});

test('a trip kept for this tab comes back as it was; one kept before trips (a journey with a change, by stage) is read as one', () => {
  const chosen = {first: 'P|07:00|2026-10-04', second: 'Q|07:20|2026-10-04', firstLine: '42', firstDepartMs: 1, secondLine: '250', secondDepartMs: 2, arriveMs: 3};
  const kept = storedTrip({kind: 'direct', key: 'd:P42|S2|S7', index: 2, boarded: {leg: 1, bus: 'BNML|1234'}, moreTime: false, chosen: null});
  assert.deepEqual(readStoredTrip(kept), {kind: 'direct', key: 'd:P42|S2|S7', index: 2, boarded: {leg: 1, bus: 'BNML|1234'}, moreTime: false, chosen: null});
  const old = JSON.stringify({key: 'c:P|S1|S4|Q|S5|S8', stage: 'first', moreTime: true, chosen});
  assert.deepEqual(readStoredTrip(old), {kind: 'connection', key: 'c:P|S1|S4|Q|S5|S8', index: null, stage: 'first', boarded: null, moreTime: true, chosen});
  // Anything else is nothing, not a guess.
  for (const bad of [null, '', 'not json', '{}', JSON.stringify({v: 1, kind: 'walk', key: 'd:x', index: 0}),
    JSON.stringify({v: 1, kind: 'direct', key: 'd:x', index: -1}), JSON.stringify({key: 'd:x', stage: 'first'})])
    assert.equal(readStoredTrip(bad), null, String(bad));
  // A boarded bus that is not one is dropped, the trip kept.
  assert.equal(readStoredTrip(JSON.stringify({v: 1, kind: 'direct', key: 'd:x', index: 1, boarded: {leg: 3, bus: 'x'}})).boarded, null);
});

test('a ridden bus\'s progress: stops to go and the next ones by name, or before the stop, past it, or not placed', () => {
  const l = leg(P, 2, 7);
  assert.deepEqual(rideProgress(bus('b', 'P42', 4), l), {kind: 'riding', stopsToGo: 3, next: ['S5', 'S6', 'S7']});
  assert.deepEqual(rideProgress(bus('b', 'P42', 6), l), {kind: 'riding', stopsToGo: 1, next: ['S7']});
  assert.deepEqual(rideProgress(bus('b', 'P42', 1), l), {kind: 'before', stopsAway: 1});
  assert.deepEqual(rideProgress(bus('b', 'P42', 7), l), {kind: 'past'}, 'at the stop to get off at by its report is past it');
  assert.deepEqual(rideProgress(bus('b', 'P99', 4), l), {kind: 'unknown'});
  assert.deepEqual(rideProgress(null, l), {kind: 'unknown'});
});

test('times: set off, leave, the bus, the arrival on foot; all from the timetable, in words a passenger acts on', () => {
  const now = Date.UTC(2026, 9, 4, 15, 0);
  const min = 60_000;
  const direct = directTripTimes({kind: 'timed', rows: [{departure: {line: '42'}, departMs: now + 10 * min, arriveMs: now + 40 * min, spareSeconds: 300}],
    access: {basis: 'straight', metres: 300, seconds: 240}, egress: {basis: 'straight', metres: 120, seconds: 90}, later: false});
  assert.equal(direct.setOffMs, now + 6 * min);
  assert.equal(direct.arriveMs, now + 41.5 * min);
  assert.equal(directTripTimes({kind: 'unavailable', reason: 'x'}), null);
  const row = {first: {departure: {line: '42'}, departMs: now + 5 * min, arriveMs: now + 20 * min}, second: {departure: {line: '250'}, departMs: now + 25 * min, arriveMs: now + 45 * min}};
  const change = connectionTripTimes({kind: 'timed', rows: [row], all: [row], access: {basis: 'route', metres: 80, seconds: 60}, walk: {basis: 'route', metres: 0, seconds: 0},
    egress: {basis: 'straight', metres: 0, seconds: 0}, allowanceSeconds: 120, later: false});
  assert.equal(change.secondLine, '250');
  assert.equal(change.arriveMs, now + 45 * min);
  assert.equal(connectionTripTimes({kind: 'loading'}), null);
  const clock = ms => new Date(ms).toISOString().slice(11, 16);
  assert.equal(leaveWords(now - min, now, clock), 'Leave now');
  assert.equal(leaveWords(now + 4 * min, now, clock), 'Leave in 4 min');
  assert.equal(leaveWords(now + 90 * min, now, clock), 'Leave at 16:30');
  assert.equal(inWords(now + 6 * min, now, clock), 'in 6 min');
  assert.equal(inWords(now, now, clock), 'now');
  assert.equal(durationWords(34 * min), '34 min');
  assert.equal(durationWords(65 * min), '1 h 5 min');
  assert.equal(durationWords(20_000), '1 min');
});
