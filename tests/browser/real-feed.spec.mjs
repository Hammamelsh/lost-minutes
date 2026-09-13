// The passenger view on the real feed: no fixtures, no routed responses.
//
// Runs only when pointed at a server that is publishing genuine positions:
//   pnpm dev:live                       (in one terminal)
//   LM_REAL_LIVE=1 LM_BASE_URL=http://localhost:3000 pnpm test:browser tests/browser/real-feed.spec.mjs
// It waits for two distinct publications, so it proves the page took a live refresh and kept
// its map, not merely that one file rendered.
import {test, expect} from '@playwright/test';
import {markerPixels, pixelVariety} from './fixtures.mjs';

test.skip(!process.env.LM_REAL_LIVE, 'set LM_REAL_LIVE=1 with LM_BASE_URL pointing at a live server');

const liveResponse = response => /\/data\/live\.json/.test(response.url()) && response.ok();

test('real positions: live badge, painted basemap, buses drawn, and a genuine refresh', async ({page}) => {
  const publications = [];
  page.on('response', async response => {
    if (!liveResponse(response)) return;
    const body = await response.json().catch(() => null);
    if (body?.publishedAt) publications.push({publishedAt: body.publishedAt, vehicles: body.vehicles?.length ?? 0, state: body.state});
  });
  await page.goto('/');
  await expect(page.locator('.follow-badge')).toContainText('LIVE', {timeout: 30_000});
  await expect(page.locator('.vector-map')).toHaveAttribute('data-map-state', 'painted', {timeout: 45_000});
  await expect(page.locator('body')).not.toContainText('FIXTURE');
  await expect(page.locator('.maplibregl-canvas')).toHaveCount(1);
  await page.evaluate(() => { window.__lmFirstCanvas = document.querySelector('.maplibregl-canvas'); });

  // The publisher writes every poll; wait until the page has taken a second, different one.
  await expect.poll(() => new Set(publications.map(p => p.publishedAt)).size, {timeout: 90_000, message: 'two distinct publications received'})
    .toBeGreaterThanOrEqual(2);
  await page.waitForTimeout(1500);

  const identity = await page.evaluate(() => ({
    count: document.querySelectorAll('.maplibregl-canvas').length,
    sameCanvas: document.querySelector('.maplibregl-canvas') === window.__lmFirstCanvas,
  }));
  expect(identity, 'the map survived a real refresh').toEqual({count: 1, sameCanvas: true});
  // The picture first, so a failed assertion still leaves the evidence behind.
  await page.locator('.vector-map').evaluate(el => el.scrollIntoView({block: 'start'}));
  await page.waitForTimeout(400);
  await page.screenshot({path: test.info().outputPath(`${test.info().project.name}-real-live.png`)});
  const variety = await pixelVariety(page, page.locator('.vector-map'));
  const drawn = await markerPixels(page, page.locator('.vector-map'));
  test.info().annotations.push({type: 'real feed', description: JSON.stringify({publications, variety, drawn})});
  expect(variety.distinctColours, 'a painted basemap').toBeGreaterThan(12);
  expect(publications.at(-1).vehicles, 'the latest publication carried vehicles').toBeGreaterThan(0);
  expect(drawn.selectedBus, 'the selected bus is drawn').toBeGreaterThan(15);
});

test('real positions: the ride-along goes to the chosen bus, draws it and follows it', async ({page}) => {
  await page.goto('/');
  await expect(page.locator('.follow-badge')).toContainText('LIVE', {timeout: 30_000});
  const map = page.locator('.vector-map');
  await expect(map).toHaveAttribute('data-map-state', 'painted', {timeout: 45_000});
  // The bus chosen for you must be drawn by the frame loop: under `next dev`, React's Strict Mode
  // remount once left the loop stopped, and the ride-along glided to an empty map.
  await expect(map).toHaveAttribute('data-motion', /estimated|observed/, {timeout: 20_000});
  const launch = page.getByRole('button', {name: /^Ride along with route/});
  await expect(launch).toBeVisible({timeout: 20_000});
  const label = await launch.getAttribute('aria-label');
  await map.evaluate(el => el.scrollIntoView({block: 'start'}));
  await launch.click();
  await expect(map).toHaveAttribute('data-ride', 'following', {timeout: 8000});
  await page.waitForTimeout(800);
  const where = await map.evaluate(el => {
    const c = el.querySelector('.vector-map-canvas').getBoundingClientRect();
    const [x, y] = (el.getAttribute('data-bus-screen') || '').split(',').map(Number);
    return {x, y, width: c.width, height: c.height, camera: el.getAttribute('data-camera'), motion: el.getAttribute('data-motion')};
  });
  await page.screenshot({path: test.info().outputPath(`${test.info().project.name}-real-ride.png`)});
  test.info().annotations.push({type: 'real ride', description: JSON.stringify({label, ...where})});
  expect(where.x >= 0 && where.y >= 0 && where.x <= where.width && where.y <= where.height,
    `the chosen bus is on the map (${JSON.stringify(where)})`).toBe(true);
  expect(Number((where.camera || '0').split(',')[0]), 'at the ride framing').toBeGreaterThan(19);
  const drawn = await markerPixels(page, map);
  expect(drawn.selectedBus, 'the chosen bus is drawn in the ride-along').toBeGreaterThan(15);
});
