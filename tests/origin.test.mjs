// Where a walk starts from: what the browser said, how much to believe it, what the hand-off sends.
import test from 'node:test';
import assert from 'node:assert/strict';
import {FRESH_POSITION_OPTIONS,fromGeolocation,googleMapsLinkLabel,googleMapsWalkingUrl,
        ORIGIN_RULES,originConfidence} from '../lib/origin.ts';

const NOW = 1_800_000_000_000;
const device = (accuracyMetres, ageMs = 0) => ({kind: 'device', lat: 53.4487, lon: -2.3095, accuracyMetres, takenAtMs: NOW - ageMs});
const HILLINGDON_OPP = {id: '1800SJ32251', lat: 53.44867, lon: -2.29932};

test('a fresh, tight fix may be stated plainly', () => {
 const c = originConfidence(device(12), NOW);
 assert.equal(c.band, 'confident');
 assert.equal(c.caveat, null);
 assert.ok(c.mayStateConfidently);
});

test('a loose fix is usable but must say the street may be wrong', () => {
 const c = originConfidence(device(90), NOW);
 assert.equal(c.band, 'uncertain');
 assert.match(c.caveat, /about 90 m out/);
 assert.match(c.caveat, /street this starts from may be wrong/);
 assert.ok(!c.mayStateConfidently);
});

test('a very loose fix is not worth routing from', () => {
 const c = originConfidence(device(400), NOW);
 assert.equal(c.band, 'too_rough');
 assert.match(c.caveat, /only known to about 400 m/);
});

test('the bands meet at the documented thresholds, with no gap', () => {
 assert.equal(originConfidence(device(ORIGIN_RULES.confidentMetres), NOW).band, 'confident');
 assert.equal(originConfidence(device(ORIGIN_RULES.confidentMetres + 0.1), NOW).band, 'uncertain');
 assert.equal(originConfidence(device(ORIGIN_RULES.tooRoughMetres), NOW).band, 'uncertain');
 assert.equal(originConfidence(device(ORIGIN_RULES.tooRoughMetres + 0.1), NOW).band, 'too_rough');
});

test('a tight fix that is old is uncertain, and says how old', () => {
 const c = originConfidence(device(10, 7 * 60_000), NOW);
 assert.equal(c.band, 'uncertain');
 assert.match(c.caveat, /taken 7 min ago/);
 const fresh = originConfidence(device(10, ORIGIN_RULES.staleMs), NOW);
 assert.equal(fresh.band, 'confident', 'exactly at the limit is still fresh');
});

test('no accuracy from the browser is unknown, not confident', () => {
 const c = originConfidence({kind: 'device', lat: 1, lon: 2, takenAtMs: NOW}, NOW);
 assert.equal(c.band, 'unknown');
 assert.match(c.caveat, /did not say how accurate/);
 assert.ok(!c.mayStateConfidently);
});

test('a start the passenger chose is believed, and is never called stale or inaccurate', () => {
 const c = originConfidence({kind: 'chosen', lat: 1, lon: 2, label: 'a point on the map', chosenAtMs: NOW - 3_600_000}, NOW);
 assert.equal(c.band, 'confident');
 assert.equal(c.caveat, null);
});

test('no origin at all is unknown with nothing to caveat', () => {
 assert.deepEqual(originConfidence(null, NOW), {band: 'unknown', caveat: null, mayStateConfidently: false});
});

test('a geolocation result keeps its own accuracy and its own timestamp, not ours', () => {
 const o = fromGeolocation({coords: {latitude: 53.1, longitude: -2.2, accuracy: 23.5}, timestamp: 1234567});
 assert.deepEqual(o, {kind: 'device', lat: 53.1, lon: -2.2, accuracyMetres: 23.5, takenAtMs: 1234567});
 const withheld = fromGeolocation({coords: {latitude: 53.1, longitude: -2.2, accuracy: NaN}, timestamp: 1234567});
 assert.equal(withheld.accuracyMetres, undefined, 'NaN is withheld, not zero');
});

test('a fresh fix is asked for: best accuracy, and never a cached position', () => {
 assert.equal(FRESH_POSITION_OPTIONS.enableHighAccuracy, true);
 assert.equal(FRESH_POSITION_OPTIONS.maximumAge, 0);
});

test('the Google Maps link goes to the boarding point by coordinates, walking, with no origin', () => {
 const url = new URL(googleMapsWalkingUrl(HILLINGDON_OPP, null));
 assert.equal(url.origin + url.pathname, 'https://www.google.com/maps/dir/');
 assert.equal(url.searchParams.get('api'), '1');
 assert.equal(url.searchParams.get('travelmode'), 'walking');
 assert.equal(url.searchParams.get('destination'), '53.44867,-2.29932');
 assert.equal(url.searchParams.get('origin'), null, 'the device decides where it is');
 assert.ok(!url.href.includes('Hillingdon'), 'never the name, which two stops 40 m apart share');
});

test('the device origin is not sent even when we hold one; only a chosen start is', () => {
 assert.equal(new URL(googleMapsWalkingUrl(HILLINGDON_OPP, device(8))).searchParams.get('origin'), null);
 const chosen = {kind: 'chosen', lat: 53.44921, lon: -2.30310, label: 'Kenwood Road', chosenAtMs: NOW};
 const url = new URL(googleMapsWalkingUrl(HILLINGDON_OPP, chosen));
 assert.equal(url.searchParams.get('origin'), '53.44921,-2.3031');
 assert.equal(url.searchParams.get('destination'), '53.44867,-2.29932');
 assert.equal(url.searchParams.get('travelmode'), 'walking');
});

test('the button says when a chosen start will be sent', () => {
 assert.equal(googleMapsLinkLabel(null), 'Walk to stop in Google Maps');
 assert.equal(googleMapsLinkLabel(device(5)), 'Walk to stop in Google Maps');
 assert.match(googleMapsLinkLabel({kind: 'chosen', lat: 0, lon: 0, label: 'x', chosenAtMs: 0}), /from your chosen start/);
});
