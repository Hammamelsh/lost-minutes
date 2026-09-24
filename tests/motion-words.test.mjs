// What the card says about a bus played back behind its reports: the delay stated is the one the
// map measured (this frame's presentation time less the moment shown), rounded to five seconds
// and said as "about", so it is honest and does not flicker; under three seconds it is not a delay
// and the label falls back to the report's own age.
import test from 'node:test';
import assert from 'node:assert/strict';
import {delaySeconds, describeMotion} from '../lib/motion-view.ts';

const observed = {mode: 'observed', reason: 'the published evaluation did not score this pattern', reportAge: 40,
  capped: false, horizon: 120, between: true, travels: true, onRoad: true, displayDelaySeconds: 33,
  speedKmh: null, eased: false, uncertaintyMetres: null, uncertaintyN: null, correction: null, version: 'x'};

test('the stated delay is the measured one to the nearest five seconds', () => {
  assert.equal(delaySeconds(31.6), 30);
  assert.equal(delaySeconds(33), 35);
  assert.equal(delaySeconds(57.4), 55);
  assert.equal(delaySeconds(60), 60);
});

test('under three seconds there is no delay to state, and nothing is stated as zero', () => {
  assert.equal(delaySeconds(2), null);
  assert.equal(delaySeconds(0), null);
  assert.equal(delaySeconds(null), null);
  assert.equal(delaySeconds(undefined), null);
  assert.equal(delaySeconds(Number.NaN), null);
});

test('the label and the sentence carry the same rounded figure, said as about', () => {
  const words = describeMotion(observed);
  assert.equal(words.label, 'Moving between its reports · drawn about 35 s behind');
  assert.match(words.detail, /about 35 seconds ago/);
  assert.match(words.detail, /down the road checked against/);
});

test('with no delay to state the label gives the report’s own age instead', () => {
  assert.equal(describeMotion({...observed, displayDelaySeconds: 1}).label, 'Moving between its reports · latest 40 s ago');
  assert.equal(describeMotion({...observed, displayDelaySeconds: null}).label, 'Moving between its reports · latest 40 s ago');
});
