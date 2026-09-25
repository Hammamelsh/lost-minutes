// Try Ride-along offers only a ride its own reports promise will be clean (25 September 2026). On
// the recorded reels the old list's rides were clean over their first three minutes 2% of the time
// (estimated-movement buses jumping hundreds of metres, buses standing at a terminus, one called
// TEST_BUS); with this rule 79–85% (scripts/evaluate-ride-offers.mjs). Each refusal is checked here.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeTrack} from '../lib/motion.ts';
import {rideSuitability, cleanRideCandidates, rideCandidates, roadsToJudge} from '../lib/explore.ts';

// A straight road 3 km due east from a point in Manchester.
const LAT = 53.47, LON0 = -2.30, M_PER_DEG_LON = 111195 * Math.cos(LAT * Math.PI / 180);
const east = m => LON0 + m / M_PER_DEG_LON;
const road = makeTrack('P:road', Array.from({length: 31}, (_, i) => [east(i * 100), LAT]), []);
const T = 1_790_000_000_000;
/** A bus whose reports stood at `places` (metres along the road, and metres to one side), every `every` s. */
const bus = (vehicle, places, {every = 20, age = 10, pattern = 'P:road', route = '15', destination = 'Piccadilly'} = {}) => {
  const reports = places.map(([s, side = 0], i) => ({at: T - (places.length - 1 - i) * every * 1000, lat: LAT + side / 111195, lon: east(s)}));
  const last = reports.at(-1);
  return {key: `BNML|${vehicle}`, operator: 'BNML', vehicle, route, direction: 'inbound', journeyRef: 'J', destination,
    lat: last.lat, lon: last.lon, observedAtMs: last.at, recordedAt: '', ageSeconds: age, freshness: 'fresh', ageWords: `reported ${age}s ago`,
    sourceHash: 'h', bearing: null, bearingStatus: 'absent',
    match: {patternId: pattern, patternIndex: 1, nearestStop: 'S', metresAlongPattern: 0, metresFromPatternStop: 1,
      patternDirection: 'inbound', patternDestination: 'P', evidence: {}},
    trail: reports.slice(0, -1).map(r => ({at: r.at, lat: r.lat, lon: r.lon, bearing: null, source: null}))};
};
const moving = [[100], [260], [420], [580], [740]];

test('a bus moving along its checked road, steadily, with road left, is a clean ride', () => {
  assert.deepEqual(rideSuitability(bus('good', moving), road), {ok: true});
});

test('each thing that spoils a ride refuses it, with its reason', () => {
  assert.equal(rideSuitability(bus('noroad', moving), null).reason, 'no_road');
  assert.equal(rideSuitability(bus('few', [[100], [260]]), road).reason, 'few_reports');
  assert.equal(rideSuitability(bus('off', [[100], [260], [420, 30], [580], [740]]), road).reason, 'off_road',
    'a report 30 m to one side: it would be drawn on a straight line off its road');
  assert.equal(rideSuitability(bus('back', [[100], [260], [420], [380], [740]]), road).reason, 'backwards');
  assert.equal(rideSuitability(bus('stands', [[500], [505], [502], [506], [503]]), road).reason, 'not_moving',
    'standing at a terminus is not a ride to offer, and scatter is not movement');
  assert.equal(rideSuitability(bus('gaps', [[100], [260], [420], [800]], {every: 45}), road).reason, 'gaps');
  assert.equal(rideSuitability(bus('ending', [[2000], [2160], [2320], [2480], [2640]]), road).reason, 'ending',
    'under 1.5 km of its road left: the ride would end almost at once');
});

test('the offer list: clean rides on a checked road only, a scored road included, never a test vehicle', () => {
  const accepted = new Set(['P:road', 'P:eval']);
  const model = {patterns: new Set(['P:eval'])};
  const buses = [
    bus('eval', moving, {pattern: 'P:eval', age: 40}),       // scored road: ridden from its reports too
    bus('TEST_BUS', moving),                                   // an operator's test unit
    bus('stands', [[500], [505], [502], [506], [503]]),
    bus('good', moving, {age: 20}),
    bus('other', moving, {age: 30, destination: 'Chester Road'}),
    bus('placed', moving, {pattern: 'P:none'}),                // no checked road
  ];
  const roads = id => (id === 'P:road' || id === 'P:eval' ? road : null);
  const offered = cleanRideCandidates(buses, accepted, model, roads);
  assert.deepEqual(offered.map(c => [c.bus.vehicle, c.tier]), [['good', 'road'], ['other', 'road'], ['eval', 'road']]);
  assert.ok(!rideCandidates(buses, accepted, model).some(c => c.bus.vehicle === 'TEST_BUS'), 'nor in the old list');
  assert.deepEqual(roadsToJudge(buses, accepted, model).sort(), ['P:eval', 'P:road'], 'only the roads it would judge are loaded');
  assert.deepEqual(cleanRideCandidates(buses, accepted, model, () => undefined), [], 'a road not loaded yet is not a pass');
});
