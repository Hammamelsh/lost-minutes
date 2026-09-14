// What a bus's own reports say about it and a stop. Each edge case the method must not be fooled
// by (a passing bus, the stop across the road, lights, GPS noise, a repeated report, an old report,
// one point within 150 m) is a test.
import test from 'node:test';
import assert from 'node:assert/strict';
import {activityWords,stopActivity,STOP_ACTIVITY} from '../lib/stop-activity.ts';

const O = {lat: 53.45, lon: -2.30};
const north = m => O.lat + m / 111195;
const east = (m, lat = O.lat) => O.lon + m / (111195 * Math.cos(lat * Math.PI / 180));
const stop = (id, n, bearing = 'N', e = 0) => ({id, name: id, bearing, lat: north(n), lon: east(e)});
// A northbound road: three stops on this bus's pattern, and one across the road on the southbound one.
const S1 = stop('S1', 0), S2 = stop('S2', 300), S3 = stop('S3', 600), ACROSS = stop('ACROSS', 300, 'S', 18);
const stops = new Map([S1, S2, S3, ACROSS].map(s => [s.id, s]));
const NORTHBOUND = {id: 'P-N', stops: ['S1', 'S2', 'S3']};
const SOUTHBOUND = {id: 'P-S', stops: ['ACROSS']};
const NOW = 10_000_000;

/** A bus whose latest report is `age` s old at `n` m north, with earlier reports as [seconds
 *  before the latest, metres north, metres east]. */
function bus({n, e = 0, age = 10, freshness, trail = [], bearing = 0}) {
  const at = NOW - age * 1000;
  return {key: 'BNML|V', operator: 'BNML', vehicle: 'V', route: '256', direction: 'inbound', journeyRef: 'J',
    destination: 'X', lat: north(n), lon: east(e), observedAtMs: at, recordedAt: '', ageSeconds: age,
    freshness: freshness ?? (age <= 60 ? 'fresh' : age <= 150 ? 'ageing' : 'stale'), ageWords: '', sourceHash: 'latest',
    bearing, bearingStatus: bearing === null ? 'absent' : 'reported',
    trail: trail.map(([before, tn, te = 0]) => ({at: at - before * 1000, lat: north(tn), lon: east(te), bearing: null, source: `t${before}`})),
    match: {patternId: 'P-N'}};
}

test('one current report within 50 m of a stop on its pattern: last reported near it, never stopped', () => {
  const found = stopActivity(bus({n: 280}), NORTHBOUND, stops);
  assert.equal(found.kind, 'near');
  assert.equal(found.stop, 'S2');
  assert.equal(activityWords(found, id => id).text, 'Last reported near S2');
});

test('reports standing by the stop over 20 s or more, the latest fresh: appears stopped near it', () => {
  const found = stopActivity(bus({n: 295, trail: [[10, 297], [22, 294]]}), NORTHBOUND, stops);
  assert.equal(found.kind, 'stopped');
  assert.equal(found.reports, 3);
  assert.equal((found.at - found.since) / 1000, 22);
  const words = activityWords(found, id => id);
  assert.equal(words.text, 'Appears stopped near S2');
  assert.match(words.detail, /not the same as at it/);
  assert.doesNotMatch(`${words.text} ${words.detail}`, /doors (are )?open|board now|boarding/i);
});

test('a passing bus: two reports near the stop but 40 m apart is near, not stopped', () => {
  assert.equal(stopActivity(bus({n: 310, trail: [[20, 270]]}), NORTHBOUND, stops).kind, 'near');
});

test('beside the stop across the road: only stops on its own pattern are ever named', () => {
  // A southbound bus reported right beside the northbound stop names the southbound one, its own.
  const southbound = {...bus({n: 300, e: 4, bearing: 180}), match: {patternId: 'P-S'}};
  const found = stopActivity(southbound, SOUTHBOUND, stops);
  assert.equal(found.kind, 'near');
  assert.equal(found.stop, 'ACROSS');
});

test('heading against the direction buses travel at the stop: nothing is said', () => {
  const found = stopActivity(bus({n: 300, bearing: 180}), NORTHBOUND, stops);
  assert.equal(found.kind, 'none');
  assert.match(found.reason, /not the direction buses travel/);
});

test('an old report says nothing about now', () => {
  const found = stopActivity(bus({n: 300, age: 200, trail: [[20, 300], [40, 300]]}), NORTHBOUND, stops);
  assert.equal(found.kind, 'none');
  assert.match(found.reason, /too old/);
});

test('an ageing report can be near a stop but never stopped', () => {
  assert.equal(stopActivity(bus({n: 300, age: 90, trail: [[20, 300], [40, 301]]}), NORTHBOUND, stops).kind, 'near');
});

test('a repeated report is one observation, not two', () => {
  const repeated = bus({n: 300, trail: [[0, 300]]});
  assert.equal(stopActivity(repeated, NORTHBOUND, stops).kind, 'near');
});

test('one position within 150 m but beyond 50 m of any stop on its route names nothing', () => {
  const found = stopActivity(bus({n: 420}), NORTHBOUND, stops);
  assert.equal(found.kind, 'none');
  assert.match(found.reason, /m from the nearest stop on its route/);
});

test('GPS noise of up to 15 m does not break a stand; more than that does', () => {
  assert.equal(stopActivity(bus({n: 300, e: 6, trail: [[12, 292, -4], [25, 305, 3]]}), NORTHBOUND, stops).kind, 'stopped');
  assert.equal(stopActivity(bus({n: 300, trail: [[12, 330], [25, 331]]}), NORTHBOUND, stops).kind, 'near');
});

test('standing, but for less than 20 s: not yet enough to say it appears stopped', () => {
  assert.equal(stopActivity(bus({n: 300, trail: [[10, 301]]}), NORTHBOUND, stops).kind, 'near');
  assert.equal(STOP_ACTIVITY.standSeconds, 20);
});

test('standing 35 m before a stop (at lights, say) is "near" the stop, and worded as near, never at', () => {
  const found = stopActivity(bus({n: 265, trail: [[15, 266], [30, 264]]}), NORTHBOUND, stops);
  assert.equal(found.kind, 'stopped');
  assert.match(activityWords(found, id => id).text, /near S2$/);
});

test('without one matched pattern, or from a recording, nothing is said', () => {
  assert.equal(stopActivity(bus({n: 300}), null, stops).kind, 'none');
  assert.equal(stopActivity({...bus({n: 300}), ageSeconds: null}, NORTHBOUND, stops).kind, 'none');
});

test('the evidence lists every report read and which ones counted', () => {
  const found = stopActivity(bus({n: 298, trail: [[12, 300], [25, 299], [60, 150]]}), NORTHBOUND, stops);
  assert.equal(found.kind, 'stopped');
  assert.deepEqual(found.observations.map(o => o.counted), [true, true, true, false]);
  assert.equal(found.observations.at(-1).source, 't60');
});
