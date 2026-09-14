// The passenger's chosen bus and the page's suggestion, kept apart. Every rule is a stated
// behaviour with a test.
import test from 'node:test';
import assert from 'node:assert/strict';
import {adoptJourney,alternativesTo,keepSuggestion,pinFromKey,pinOf,resolveSelection,sameJourney} from '../lib/selection.ts';

const bus = (vehicle, extra = {}) => ({key: `BNML|${vehicle}`, operator: 'BNML', vehicle, route: '256', direction: 'inbound',
  journeyRef: `${vehicle}-J1`, destination: 'Piccadilly Gardens', lat: 53.45, lon: -2.3, observedAtMs: 1_000_000,
  recordedAt: '', ageSeconds: 10, freshness: 'fresh', ageWords: 'reported 10s ago', sourceHash: 'h', bearing: null,
  bearingStatus: 'absent', ...extra});
const A = bus('A'), B = bus('B'), C = bus('C');

test('no pin, no selection: what is shown is only a suggestion', () => {
  assert.deepEqual(resolveSelection(null, [A, B]), {kind: 'none'});
});

test('a pinned bus is the selection whatever order the buses come in', () => {
  const pin = pinOf(A, 'follow');
  for (const order of [[A, B], [B, A], [B, C, A]]) {
    const selection = resolveSelection(pin, order);
    assert.equal(selection.kind, 'active');
    assert.equal(selection.bus.key, A.key);
  }
});

test('a pinned bus missing from the latest positions is absent, never replaced by another', () => {
  const pin = pinOf(A, 'ride');
  const selection = resolveSelection(pin, [B, C], key => (key === A.key ? {...A, ageSeconds: 70, freshness: 'ageing'} : null));
  assert.equal(selection.kind, 'absent');
  assert.equal(selection.pin.bus.key, A.key);
  assert.equal(selection.last.key, A.key, 'its last report this visit is offered as what it was');
  const expired = resolveSelection(pin, [B], () => ({...A, ageSeconds: 1200, freshness: 'expired'}));
  assert.equal(expired.kind, 'absent');
  assert.equal(expired.last, null, 'a report past the cut-off is not offered as a position');
  assert.equal(resolveSelection(pin, [B]).last, null, 'nothing recalled: nothing drawn');
});

test('the same vehicle on another journey is a new journey, said so, not silently followed', () => {
  const pin = pinOf(A, 'list');
  assert.equal(resolveSelection(pin, [{...A, journeyRef: 'A-J2'}]).kind, 'new_journey');
  assert.equal(resolveSelection(pin, [{...A, direction: 'outbound'}]).kind, 'new_journey');
  assert.equal(resolveSelection(pin, [{...A, route: '250'}]).kind, 'new_journey');
  assert.equal(resolveSelection(pin, [{...A, journeyRef: ''}]).kind, 'active', 'a reference not reported is not a change');
  assert.equal(resolveSelection(pin, [{...A, lat: 53.46, observedAtMs: 1_020_000}]).kind, 'active', 'a new report is not a change');
  const continued = pinOf({...A, journeyRef: 'A-J2'}, 'continue');
  assert.equal(resolveSelection(continued, [{...A, journeyRef: 'A-J2'}]).kind, 'active', 'continued on request');
});

test('a link that names only a vehicle learns its journey when the vehicle is first seen', () => {
  const pin = pinFromKey('BNML|A', 'link');
  assert.equal(pin.journeyKnown, false);
  assert.equal(resolveSelection(pin, [{...A, journeyRef: 'anything'}]).kind, 'active');
  const learnt = adoptJourney(pin, A);
  assert.equal(learnt.journeyKnown, true);
  assert.equal(learnt.bus.journeyRef, 'A-J1');
  assert.equal(learnt.via, 'link');
  assert.equal(resolveSelection(learnt, [{...A, journeyRef: 'A-J2'}]).kind, 'new_journey');
});

test('a suggestion stays put while it is still a candidate; reordering alone never changes it', () => {
  assert.equal(keepSuggestion(null, [A, B]), A.key);
  assert.equal(keepSuggestion(A.key, [B, A]), A.key);
  assert.equal(keepSuggestion(A.key, [C, B, A]), A.key);
  assert.equal(keepSuggestion(A.key, [B, C]), B.key, 'gone from the candidates: the first one now');
  assert.equal(keepSuggestion(A.key, []), null);
});

test('alternatives are offered without the pinned bus, and only a few', () => {
  const pin = pinOf(A, 'follow');
  assert.deepEqual(alternativesTo(pin, [A, B, C]).map(b => b.key), [B.key, C.key]);
  assert.equal(alternativesTo(pin, [A, B, C, bus('D'), bus('E')], 3).length, 3);
});

test('journey identity: route, direction and a reference where both report one', () => {
  assert.equal(sameJourney(A, {...A}), true);
  assert.equal(sameJourney(A, {...A, journeyRef: ''}), true);
  assert.equal(sameJourney(A, {...A, journeyRef: 'other'}), false);
  assert.equal(sameJourney(A, {...A, direction: 'outbound'}), false);
});
