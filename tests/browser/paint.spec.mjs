// The map counts as drawn once the page has framed it, the camera has stopped, and its basemap is in, however busy the
// buses on it are. Until 29 September 2026 it counted only at MapLibre's first "idle" (or a 25 s fallback), which also
// waits on every bus source and label fade: on the served site 6 of 21 loads of one bus link said "Drawing the map…
// slow to arrive" for 24 s over a drawn map (backlog 44). Here 120 fixture buses move in view: the map must count as
// drawn within 12 s (2.3-2.4 s since the fix, 3.0-3.2 s at the first idle before it). FIXTURE fleet, real basemap tiles.
import {test, expect} from '@playwright/test';
import {fleetLive, serveLive, serveMotion, servePatterns} from './fixtures.mjs';

test('with a hundred and twenty buses moving in view, the map still counts as drawn within seconds', async ({page}) => {
  await servePatterns(page);
  await serveMotion(page);
  const start = Date.now() - 90_000;
  await serveLive(page, [() => fleetLive({nowMs: Date.now(), startMs: start, count: 120, spacing: 15})]);
  const t0 = Date.now();
  await page.goto('/?stop=1800SJ00811');
  await page.locator('.vector-map[data-map-state="painted"]').waitFor({timeout: 40_000});
  const seconds = (Date.now() - t0) / 1000;
  test.info().annotations.push({type: 'paint', description: `${seconds.toFixed(1)} s`});
  console.log(`painted after ${seconds.toFixed(1)} s`);
  expect(seconds, 'drawn well before the 25 s fallback').toBeLessThan(12);
  await expect(page.locator('.map-loading')).toHaveCount(0);
});
