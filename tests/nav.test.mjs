// The passenger's screens in the browser's history (lib/nav.ts, 1 October 2026): what an entry records, how deep it
// is, and what the page's Back says, so that the phone's Back and the page's are the same step.
import test from 'node:test';
import assert from 'node:assert/strict';
import {backWords, pushed, replaced, screenName, screenOf, withScreen} from '../lib/nav.ts';

test('an entry the page wrote is read back; any other is not a screen', () => {
 const s = pushed(null, {panel: 'plan', name: 'the planner'});
 assert.deepEqual(screenOf(withScreen({lmIntermediate: true}, s)), s);
 assert.equal(screenOf(null), null);
 assert.equal(screenOf({}), null);
 assert.equal(screenOf({lm: {panel: 'elsewhere'}}), null, 'a panel the page does not have');
 assert.equal(withScreen({lmIntermediate: true}, s).lmIntermediate, true, 'the entry keeps its other keys');
});

test('a screen opened over another is one deeper and names it; a screen in its place keeps both', () => {
 const start = replaced(null, {panel: 'home', name: screenName('home')});
 assert.equal(start.depth, 0);
 const plan = pushed(start, {panel: 'plan', name: screenName('plan', {planned: true})});
 const stop = pushed(plan, {panel: 'stop', name: screenName('stop', {stop: 'Comus Street (nr)'})});
 const bus = pushed(stop, {panel: 'bus', name: screenName('bus', {route: '33'})});
 const ride = pushed(bus, {panel: 'bus', ride: true, name: screenName('bus', {route: '33'})});
 assert.deepEqual([plan, stop, bus, ride].map(s => s.depth), [1, 2, 3, 4]);
 assert.deepEqual([plan, stop, bus, ride].map(backWords),
  ['Back to the start', 'Back to your options', 'Back to Comus Street (nr)', 'Back to the 33']);
 const another = replaced(bus, {panel: 'bus', name: screenName('bus', {route: '42'})});
 assert.equal(another.depth, 3);
 assert.equal(backWords(another), 'Back to Comus Street (nr)', 'another bus in its place goes back to the same board');
});

test('with nothing of the page\'s own below (a shared link), Back goes to the start', () => {
 assert.equal(backWords(replaced(null, {panel: 'stop'})), 'Back to the start');
 assert.equal(backWords(null), 'Back to the start');
});
