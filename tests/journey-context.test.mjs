// The active journey: kept on the device and in a link, restored only as what it was, and never
// carrying where the passenger is.
import test from 'node:test';
import assert from 'node:assert/strict';
import {JOURNEY_MAX_AGE_MS, JOURNEY_STORE, initialJourney, journeyQuery, parseJourneyQuery, readJourney,
  restoreBus, restoreService, savedBusOf, writeJourney} from '../lib/journey-context.ts';

const memory = () => { const m = new Map(); return {getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m}; };
const NOW = 1_789_330_000_000;
const SERVICE = 'BNML|256|inbound|Piccadilly Gardens';
const bus = (over = {}) => ({key: 'BNML|SK74BNB', operator: 'BNML', vehicle: 'SK74BNB', route: '256', direction: 'inbound',
  journeyRef: '3729', destination: 'Piccadilly_Gardens', lat: 53.4501, lon: -2.3199, observedAtMs: NOW - 20_000, ...over});

test('a link names a stop, a service and a bus, and nothing about where the passenger is', () => {
  // Extra fields, a location among them, are never written into the address.
  const query = journeyQuery({stopId: '1800SJ00811', serviceKey: SERVICE, busKey: 'BNML|SK74BNB', lat: 53.4487, lon: -2.3095, here: {lat: 53.4487, lon: -2.3095}});
  assert.equal(query, 'stop=1800SJ00811&service=BNML%7C256%7Cinbound%7CPiccadilly+Gardens&bus=BNML%7CSK74BNB');
  assert.doesNotMatch(query, /lat|lon|here|53\.4|2\.30/);
  assert.deepEqual(parseJourneyQuery(`?${query}`), {stopId: '1800SJ00811', serviceKey: SERVICE, busKey: 'BNML|SK74BNB'});
});

test('malformed parts of a link are dropped, and a link naming neither a stop nor a bus is no journey', () => {
  assert.deepEqual(parseJourneyQuery('?stop=1800SJ00811&service=256&bus=SK74BNB'), {stopId: '1800SJ00811', serviceKey: null, busKey: null});
  assert.equal(parseJourneyQuery('?service=' + encodeURIComponent(SERVICE)), null);
  assert.equal(parseJourneyQuery('?stop=../../etc&bus=' + encodeURIComponent('a|b|c')), null);
  assert.equal(journeyQuery({stopId: 'x', serviceKey: 'nope', busKey: 'no'}), '');
});

test('the device keeps a journey for twelve hours and refuses anything malformed', () => {
  const store = memory();
  assert.equal(writeJourney(store, {stopId: '1800SJ00811', serviceKey: SERVICE, bus: savedBusOf(bus()), savedAt: NOW}), true);
  const saved = readJourney(store, NOW + 60_000);
  assert.equal(saved.stopId, '1800SJ00811');
  assert.equal(saved.bus.key, 'BNML|SK74BNB');
  assert.equal('lat' in saved.bus, false, 'a saved bus keeps its identity, not its position');
  assert.equal(readJourney(store, NOW + JOURNEY_MAX_AGE_MS + 1), null, 'older than twelve hours is not restored');
  store.setItem(JOURNEY_STORE, '{"v":1,"stopId":"<script>","serviceKey":null,"bus":null,"savedAt":1}');
  assert.equal(readJourney(store, NOW), null);
  store.setItem(JOURNEY_STORE, 'not json');
  assert.equal(readJourney(store, NOW), null);
  assert.equal(writeJourney(store, {stopId: null, serviceKey: null, bus: null, savedAt: NOW}), true);
  assert.equal(store.getItem(JOURNEY_STORE), null, 'nothing chosen: nothing kept');
  assert.equal(writeJourney({setItem() { throw new Error('quota'); }, removeItem() {}}, {stopId: '1800SJ00811', serviceKey: null, bus: null, savedAt: NOW}), false);
});

test('a link wins over this device, and borrows its saved bus only when it names the same one', () => {
  const store = memory();
  writeJourney(store, {stopId: '1800SJ00811', serviceKey: null, bus: savedBusOf(bus()), savedAt: NOW});
  const same = initialJourney('?stop=1800SJ00081&bus=BNML%7CSK74BNB', store, NOW);
  assert.equal(same.source, 'link');
  assert.equal(same.stopId, '1800SJ00081');
  assert.equal(same.bus.journeyRef, '3729');
  const other = initialJourney('?stop=1800SJ00081&bus=BNML%7COTHER', store, NOW);
  assert.equal(other.bus, null);
  assert.equal(other.busKey, 'BNML|OTHER');
  const device = initialJourney('', store, NOW);
  assert.equal(device.source, 'offer');
  assert.equal(device.busKey, 'BNML|SK74BNB');
  assert.equal(initialJourney('', memory(), NOW), null);
});

test('the same vehicle on the same journey is chosen again', () => {
  const saved = savedBusOf(bus());
  assert.deepEqual(restoreBus({bus: saved, busKey: saved.key}, [bus({lat: 53.46})]), {kind: 'chosen', key: 'BNML|SK74BNB'});
  // A link carries only the vehicle: found is enough to choose it.
  assert.deepEqual(restoreBus({bus: null, busKey: 'BNML|SK74BNB'}, [bus()]), {kind: 'chosen', key: 'BNML|SK74BNB'});
  assert.deepEqual(restoreBus(null, [bus()]), {kind: 'none'});
});

test('a vehicle that has gone is reported, and nothing is chosen in its place', () => {
  const saved = savedBusOf(bus());
  const result = restoreBus({bus: saved, busKey: saved.key}, [bus({key: 'BNML|SK74XXX', vehicle: 'SK74XXX'})]);
  assert.equal(result.kind, 'gone');
  assert.equal(result.saved.key, 'BNML|SK74BNB');
  assert.equal(restoreBus({bus: saved, busKey: saved.key}, []).kind, 'gone');
});

test('a vehicle now on another route, direction or journey is not chosen again', () => {
  const saved = savedBusOf(bus());
  for (const now of [bus({route: '250'}), bus({direction: 'outbound'}), bus({journeyRef: '3801'})]) {
    const result = restoreBus({bus: saved, busKey: saved.key}, [now]);
    assert.equal(result.kind, 'other_journey', JSON.stringify(now));
    assert.equal(result.now.key, 'BNML|SK74BNB');
  }
  // A journey reference the feed left blank is not evidence of another journey.
  assert.equal(restoreBus({bus: saved, busKey: saved.key}, [bus({journeyRef: ''})]).kind, 'chosen');
});

test('a service the stop no longer has in today’s timetable is reported, not applied', () => {
  assert.deepEqual(restoreService(SERVICE, [{key: SERVICE}]), {kind: 'chosen', key: SERVICE});
  assert.deepEqual(restoreService(SERVICE, [{key: 'BNML|250|inbound|Manchester'}]), {kind: 'gone', key: SERVICE});
  assert.deepEqual(restoreService(null, []), {kind: 'none', key: null});
});
