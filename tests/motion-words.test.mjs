// What the card says about a bus played back behind its reports. Two ages, said apart: the moment
// drawn — the one the map measured, this frame's presentation time less the moment the drawn place
// stands for, rounded to five seconds and said as "about" so it is honest and does not flicker — and
// the latest report's own age beside it; what the playback adds is said in the sentence. A playback
// within a few seconds of its report is not a delay, and the label gives the report's age alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import {delaySeconds, describeMotion} from '../lib/motion-view.ts';

const observed = {mode: 'observed', reason: 'the published evaluation did not score this pattern', reportAge: 12,
  capped: false, horizon: 120, between: true, travels: true, onRoad: true, displayDelaySeconds: 43,
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

test('the label gives the moment drawn and the report’s age apart; the sentence gives what the playback adds', () => {
  // Restated 25 September 2026: the label read "drawn about 35 s behind", which did not say behind
  // what, and the release record called it a delay behind the newest report. The figure is measured
  // from now, so it includes the report's age; the label now says so, with the report's age beside it.
  const words = describeMotion(observed);
  assert.equal(words.label, 'Moving between its reports · as it was about 45 s ago · report 12 s old');
  assert.match(words.detail, /about 45 seconds ago: its latest report is 12 s old, and the playback draws it about 30 s behind that report/);
  assert.match(words.detail, /down the road checked against/);
});

test('the moment drawn is never said to be newer than the report, whatever the rounding', () => {
  for (let age = 0; age <= 80; age++) for (let total = age; total <= age + 70; total++) {
    const {label} = describeMotion({...observed, reportAge: age, displayDelaySeconds: total});
    const said = /as it was about (\d+) (s|min) ago/.exec(label);
    if (said?.[2] === 's') assert.ok(Number(said[1]) > age, `${label} (report ${age} s, drawn ${total} s ago)`);
    else if (said) assert.ok(Number(said[1]) >= Math.round(age / 60), `${label} (report ${age} s, drawn ${total} s ago)`);
    else assert.equal(label, `Moving between its reports · latest ${age} s ago`, `${age}, ${total}`);
  }
});

test('with no delay to state the label gives the report’s own age instead', () => {
  assert.equal(describeMotion({...observed, displayDelaySeconds: 1}).label, 'Moving between its reports · latest 12 s ago');
  assert.equal(describeMotion({...observed, displayDelaySeconds: null}).label, 'Moving between its reports · latest 12 s ago');
  // Within a few seconds of its report the playback adds nothing worth a number.
  assert.equal(describeMotion({...observed, displayDelaySeconds: 14}).label, 'Moving between its reports · latest 12 s ago');
});

test('at its newest report the sentence gives the report’s age, never a smaller figure', () => {
  // a63006b said "drawn where its reports put it about 5 seconds ago" of a bus standing at a report
  // 20 s old: the figure ran on past the report with the clock.
  const words = describeMotion({...observed, between: false, reportAge: 20, displayDelaySeconds: 20});
  assert.equal(words.label, 'Last reported position · 20 s ago');
  assert.match(words.detail, /It is drawn at or just behind its latest report, 20 s old, at a bus’s own pace/);
  assert.doesNotMatch(words.detail, /seconds ago/);
});

test('a bus standing where its reports stood is said to be standing, not moving between its reports', () => {
  // 25 September 2026: in the ride every bus is played back from its reports, and a bus waiting at a
  // stop was captioned "Moving between its reports" the whole time it stood.
  assert.equal(describeMotion({...observed, standing: true}).label, 'Standing · as it was about 45 s ago · report 12 s old');
  assert.equal(describeMotion({...observed, standing: true, displayDelaySeconds: 1}).label, 'Standing · latest 12 s ago');
  assert.equal(describeMotion({...observed, standing: false}).label, 'Moving between its reports · as it was about 45 s ago · report 12 s old');
});
