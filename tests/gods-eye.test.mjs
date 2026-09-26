// The view from above's geometry (lib/gods-eye.ts): where the camera goes to sit behind a bus.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ABOVE_FOLLOW, offsetAlong} from '../lib/gods-eye.ts';

test('a point offset along a bearing lands where a bus that far along its heading would be', () => {
 const lat = 53.48, lon = -2.24;
 const north = offsetAlong(lat, lon, 0, 100);
 assert.ok(Math.abs((north.lat - lat) * 111195 - 100) < 0.01 && north.lon === lon);
 const east = offsetAlong(lat, lon, 90, 100);
 assert.ok(Math.abs((east.lon - lon) * 111195 * Math.cos(lat * Math.PI / 180) - 100) < 0.01);
 assert.ok(Math.abs(east.lat - lat) < 1e-9);
 // Behind a bus heading 45°: back along 225°, the follow's range.
 const behind = offsetAlong(lat, lon, 45 + 180, ABOVE_FOLLOW.range);
 const d = Math.hypot((behind.lat - lat) * 111195, (behind.lon - lon) * 111195 * Math.cos(lat * Math.PI / 180));
 assert.ok(Math.abs(d - ABOVE_FOLLOW.range) < 0.05);
 assert.ok(behind.lat < lat && behind.lon < lon, 'south-west of the bus');
});

test('the one request that opens the imagery says which failure it is, by its answer', async () => {
 const {failureOf, FAILURE_WORDS} = await import('../lib/gods-eye.ts');
 assert.equal(failureOf({statusCode: 429}), 'quota');
 assert.equal(failureOf({statusCode: 403}), 'refused');
 assert.equal(failureOf({statusCode: 401}), 'refused');
 assert.equal(failureOf({statusCode: 0}), 'unreachable');
 assert.equal(failureOf(new Error('Failed to fetch')), 'unreachable');
 assert.equal(failureOf(null), 'unreachable');
 assert.equal(failureOf({statusCode: 500}), 'imagery');
 for (const words of Object.values(FAILURE_WORDS)) assert.ok(words.length > 20 && words.endsWith('.'));
});
