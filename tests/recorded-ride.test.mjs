// A recorded ride: the reports as published on the day, replayed at their own spacing on the
// page's clock, and never mistaken for live. Every rule is a stated behaviour with a test.
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRecordedRide, parseRideIndex, publicationAt, rideBusKey, rideLengthMs, rideLive, rideWords}
  from '../lib/recorded-ride.ts';
import {rideCandidates, onAcceptedRoad} from '../lib/explore.ts';

const HASH = 'a'.repeat(64);
const envelope = {
  schemaVersion: 1, state: 'live', mode: 'live_bods', unavailableReason: null,
  area: {bbox: [-2.4, 53.4, -2.1, 53.6], label: 'Greater Manchester'},
  collection: {lastRequestAt: null, lastSuccessAt: null, lastPayloadChangeAt: null, cycles: 1, succeeded: 1,
    repeatPayloads: 0, failed: 0, consecutiveFailures: 0, sharedCollector: true, collector: null},
  freshness: {policy: {observationFreshSeconds: 60, observationAgeingSeconds: 150, observationExpirySeconds: 900,
    publicationStaleSeconds: 120, futureToleranceSeconds: 120, pollIntervalSeconds: 20, basis: 'test'}, measured: null},
  withheld: {expiredPositions: 0, positionsAheadOfClock: 0, conflictingIdentities: 0, quarantinedRecords: 0, quarantineReasons: []},
  sourceQuality: {quarantineReasons: [], note: ''}, pipelineFailures: {cycles: [], note: ''},
  attribution: 'test', notes: [],
};
const T0 = 1_790_000_000_000;
const vehicle = (i) => ({operator: 'BNGN', vehicle: '3426', route: '163', direction: 'outbound', journeyRef: '1147',
  observedAtMs: T0 + i * 20_000 - 8_000, recordedAt: `2026-09-23T20:48:${String(10 + i).padStart(2, '0')}+00:00`,
  lat: 53.48 + i * 0.001, lon: -2.24, destination: 'Bury_Interchange', origin: 'Piccadilly', sourceHash: HASH,
  bearing: 10, bearingStatus: 'reported', aimedDeparture: null, retrievedAtMs: T0 + i * 20_000 - 3_000,
  ageSeconds: 8, freshness: 'fresh', positionKind: 'observed',
  match: {patternId: 'BNGN:163:outbound:f3b8c49c1a', patternIndex: 3 + i, nearestStop: 'S', metresAlongPattern: 100 * i,
    metresFromPatternStop: 5, patternDirection: 'outbound', patternDestination: 'Bury Interchange',
    evidence: {serviceDay: '2026-09-23', weekday: 'Wednesday', operatorChecked: true, directionReported: true,
      operatingDayChecked: true, plausiblePaths: 1}},
  trail: i ? [[20_000, 53.48 + (i - 1) * 0.001, -2.24, 10, 0]] : []});
const ride = () => ({
  schemaVersion: 1, id: '2026-09-23-bngn-3426-163', title: '163 to Bury Interchange', operator: 'BNGN', vehicle: '3426',
  route: '163', direction: 'outbound', journeyRef: '1147', destination: 'Bury_Interchange', origin: 'Piccadilly',
  recordedOn: '23 September 2026', from: new Date(T0).toISOString(), to: new Date(T0 + 60_000).toISOString(),
  fromLocal: '21:48', toLocal: '21:49', seconds: 60, reports: 4, basis: 'test', sources: [HASH],
  envelope,
  publications: [0, 1, 2, 3].map(i => ({receivedAtMs: T0 + i * 20_000, publishedAt: new Date(T0 + i * 20_000 - 1000).toISOString(),
    publishedAtMs: T0 + i * 20_000 - 1000, trailSources: i ? [0] : [], vehicle: vehicle(i)})),
});

test('the index lists what is published, and a malformed index offers nothing', () => {
  const rides = parseRideIndex({schemaVersion: 1, rides: [{id: 'a-ride', title: 't', operator: 'BNGN', vehicle: '1',
    route: '163', direction: 'outbound', destination: 'X', recordedOn: 'd', from: 'f', fromLocal: '21:48', toLocal: '22:16',
    seconds: 1700, reports: 86, file: '/data/rides/a-ride.json'}]});
  assert.equal(rides.length, 1);
  assert.deepEqual(parseRideIndex({schemaVersion: 2}), []);
  assert.deepEqual(parseRideIndex({schemaVersion: 1, rides: [{id: 'Bad Id'}]}), []);
});

test('a ride parses, and one out of order or naming an unlisted source is refused', () => {
  const r = parseRecordedRide(ride());
  assert.equal(r.publications.length, 4);
  assert.equal(rideBusKey(r), 'BNGN|3426');
  assert.equal(rideLengthMs(r), 60_000);
  const shuffled = ride(); [shuffled.publications[0], shuffled.publications[1]] = [shuffled.publications[1], shuffled.publications[0]];
  assert.throws(() => parseRecordedRide(shuffled), /out of order/);
  const unlisted = ride(); unlisted.publications[1].trailSources = [4];
  assert.throws(() => parseRecordedRide(unlisted), /source/);
});

test('which publication a phone would have been served, this far into the ride', () => {
  const r = parseRecordedRide(ride());
  assert.equal(publicationAt(r, -1), -1);
  assert.equal(publicationAt(r, 0), 0);
  assert.equal(publicationAt(r, 19_999), 0);
  assert.equal(publicationAt(r, 20_000), 1);
  assert.equal(publicationAt(r, 65_000), 3);
});

test('the replayed publication moves every clock by the same amount and leaves the evidence alone', () => {
  const r = parseRecordedRide(ride());
  const startedAtMs = 1_800_000_000_000;
  const live = rideLive(r, 1, startedAtMs);
  const shift = startedAtMs - T0;
  assert.equal(live.publishedAtMs, T0 + 20_000 - 1000 + shift);
  assert.equal(live.vehicles.length, 1);
  const v = live.vehicles[0];
  assert.equal(v.observedAtMs, T0 + 20_000 - 8_000 + shift, 'observation time moved with the replay');
  assert.equal(v.retrievedAtMs, T0 + 20_000 - 3_000 + shift, 'retrieval time moved with it');
  // The age the page works out is the age it was: 8 s at publication, +1 s of transfer.
  assert.equal((live.publishedAtMs - v.observedAtMs) / 1000, 7);
  assert.equal(v.recordedAt, '2026-09-23T20:48:11+00:00', 'the source\'s own time text is kept verbatim');
  assert.equal(v.sourceHash, HASH);
  assert.equal(v.match.patternId, 'BNGN:163:outbound:f3b8c49c1a');
  assert.deepEqual(live.trailSources, [HASH], 'trail sources are expanded from the ride\'s list');
  assert.deepEqual(v.trail, [[20_000, 53.48, -2.24, 10, 0]], 'the trail carries ages, which do not move');
});

test('the words for the offer: date, time, length', () => {
  assert.equal(rideWords({recordedOn: '23 September 2026', fromLocal: '21:48', seconds: 1700}), '23 September 2026, 21:48 · 28 min');
  assert.equal(rideWords({recordedOn: 'd', fromLocal: '09:00', seconds: 20}), 'd, 09:00 · 1 min');
});

// Try Ride-along's candidates: three kinds, told apart, and ordered by what the ride will be.
const bus = (vehicle, extra = {}) => ({key: `BNML|${vehicle}`, operator: 'BNML', vehicle, route: '15', direction: 'inbound',
  journeyRef: 'J', destination: 'Piccadilly', lat: 53.45, lon: -2.3, observedAtMs: 1, recordedAt: '', ageSeconds: 10,
  freshness: 'fresh', ageWords: 'reported 10s ago', sourceHash: 'h', bearing: null, bearingStatus: 'absent', ...extra});
const placed = id => ({patternId: id, patternIndex: 1, nearestStop: 'S', metresAlongPattern: 0, metresFromPatternStop: 1,
  patternDirection: 'inbound', patternDestination: 'P', evidence: {}});
const model = {patterns: new Set(['P:eval'])};

// Restated 25 September 2026: every ride is drawn from its reports (backlog 31), so a bus on a scored
// road is no longer a tier of its own ranked first; it is a checked road like any other, ranked by age.
test('candidates: a checked road first, freshest first, then merely placed; unplaced and old ones never', () => {
  const accepted = new Set(['P:eval', 'P:road']);
  const buses = [
    bus('placed', {match: placed('P:none'), ageSeconds: 5}),
    bus('road', {match: placed('P:road'), ageSeconds: 30}),
    bus('eval', {match: placed('P:eval'), ageSeconds: 50}),
    bus('unsettled', {match: {unresolved: 'ambiguous_branch', candidates: [{patternId: 'P:eval', patternIndex: 1}]}}),
    bus('old-road', {match: placed('P:road'), ageSeconds: 200, freshness: 'stale'}),
    bus('ageing-placed', {match: placed('P:none'), ageSeconds: 90, freshness: 'ageing'}),
  ];
  const out = rideCandidates(buses, accepted, model);
  assert.deepEqual(out.map(c => [c.bus.vehicle, c.tier, c.estimated]),
    [['road', 'road', false], ['eval', 'road', true], ['placed', 'placed', false]]);
  assert.equal(rideCandidates(buses, accepted, model, 2).length, 2);
  assert.equal(onAcceptedRoad(buses, accepted), 3, 'the denominator counts the old one too');
});

test('an accepted road on an ageing report still rides; a bus with no road rides only on a fresh one', () => {
  const accepted = new Set(['P:road']);
  const out = rideCandidates([bus('a', {match: placed('P:road'), freshness: 'ageing', ageSeconds: 100}),
    bus('b', {match: placed('P:none'), freshness: 'ageing', ageSeconds: 100})], accepted, null);
  assert.deepEqual(out.map(c => c.bus.vehicle), ['a']);
});

test('three different services come first; a second bus of a listed service only fills a short list', () => {
  const accepted = new Set(['P:eval', 'P:road']);
  const buses = [
    bus('a250', {match: placed('P:eval'), ageSeconds: 5, route: '250', destination: 'Piccadilly'}),
    bus('b250', {match: placed('P:eval'), ageSeconds: 8, route: '250', destination: 'Piccadilly'}),
    bus('c250', {match: placed('P:eval'), ageSeconds: 9, route: '250', destination: 'Piccadilly'}),
    bus('d15', {match: placed('P:road'), ageSeconds: 20, route: '15', destination: 'Roedean'}),
    bus('e142', {match: placed('P:none'), ageSeconds: 30, route: '142', destination: 'Parrs Wood'}),
  ];
  // Ranked by tier alone the list was three 250s — one choice dressed as three (the deployed site,
  // 24 September 2026). Each service's first bus keeps its rank; the 250's second bus comes only
  // after every other service, and only where there is room.
  assert.deepEqual(rideCandidates(buses, accepted, model).map(c => c.bus.vehicle), ['a250', 'd15', 'e142']);
  assert.deepEqual(rideCandidates(buses, accepted, model, 5).map(c => c.bus.vehicle), ['a250', 'd15', 'e142', 'b250', 'c250']);
  // Direction and destination tell services apart too: the same number the other way is another ride.
  const both = [bus('out', {match: placed('P:eval'), route: '250', direction: 'outbound', destination: 'Trafford'}),
    bus('in', {match: placed('P:eval'), route: '250', direction: 'inbound', destination: 'Piccadilly'}),
    bus('in2', {match: placed('P:eval'), route: '250', direction: 'inbound', destination: 'Piccadilly', ageSeconds: 12})];
  assert.deepEqual(rideCandidates(both, accepted, model).map(c => c.bus.vehicle), ['out', 'in', 'in2']);
});
