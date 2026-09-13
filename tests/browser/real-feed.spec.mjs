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
