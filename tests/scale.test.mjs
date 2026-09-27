// The map's scale (lib/scale.ts): MapLibre's world is 512 pixels at zoom 0. A 256-pixel tile's figure,
// twice the true one, drew the front view's roads at half their width until 26 September 2026.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {metresPerPixel} from '../lib/scale.ts';

test('a pixel covers 78,271.517 m at zoom 0 on the equator, half a 256-pixel tile\'s 156,543.03 m', () => {
 assert.ok(Math.abs(metresPerPixel(0, 0) - 78271.517) < 0.01);
 assert.ok(Math.abs(metresPerPixel(0, 0) * 2 - 156543.03) < 0.05);
});

test('each zoom level halves it, and it shrinks with the cosine of the latitude', () => {
 assert.ok(Math.abs(metresPerPixel(1, 0) - metresPerPixel(0, 0) / 2) < 1e-9);
 assert.ok(Math.abs(metresPerPixel(15, 60) - metresPerPixel(15, 0) / 2) < 1e-9);
 // Manchester at a street zoom: 1.4215 m a pixel at 15, and 0.0444 m in the ride's framing at 20.
 assert.ok(Math.abs(metresPerPixel(15, 53.48) - 1.4215) < 0.0005);
 assert.ok(Math.abs(metresPerPixel(20, 53.48) - 0.04442) < 0.00005);
});
