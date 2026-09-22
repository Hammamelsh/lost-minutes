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

// Real buses take turns to report last, which is what once made the page swap one bus for another.
test('real positions: the bus followed, then ridden, stays the one chosen through real publications', async ({page}) => {
  test.setTimeout(300_000);
  const publications = new Set();
  page.on('response', async response => {
    if (!liveResponse(response)) return;
    const body = await response.json().catch(() => null);
    if (body?.publishedAt) publications.add(body.publishedAt);
  });
  await page.goto('/');
  await expect(page.locator('.follow-badge')).toContainText('LIVE', {timeout: 30_000});
  const map = page.locator('.vector-map');
  await expect(map).toHaveAttribute('data-map-state', 'painted', {timeout: 45_000});
  const card = page.locator('article.bus-card');
  await expect(card).toHaveAttribute('data-vehicle', /\S/, {timeout: 20_000});
  const vehicle = await card.getAttribute('data-vehicle');
  await page.getByRole('button', {name: 'Keep this bus centred'}).click();
  await expect(card).toHaveAttribute('data-selection', 'active');
  const read = () => page.evaluate(() => {
    const m = document.querySelector('.vector-map'), c = m?.querySelector('.vector-map-canvas')?.getBoundingClientRect();
    const [x, y] = (m?.getAttribute('data-bus-screen') || '').split(',').map(Number);
    return {card: document.querySelector('article.bus-card')?.getAttribute('data-vehicle'),
      selection: document.querySelector('article.bus-card')?.getAttribute('data-selection'),
      eyebrow: document.querySelector('.bus-card-eyebrow')?.textContent ?? null,
      summaries: document.querySelectorAll('.active-bus').length,
      route: document.querySelector('#follow-route')?.value ?? null,
      strip: document.querySelector('.active-bus')?.getAttribute('data-vehicle'),
      rideCard: document.querySelector('.ride-card')?.getAttribute('data-vehicle') ?? null,
      map: m?.getAttribute('data-selected-key'), ride: m?.getAttribute('data-ride'),
      busInView: c ? x >= 0 && y >= 0 && x <= c.width && y <= c.height : null};
  });
  const seen = [];
  const start = publications.size;
  const routeOffered = (await read()).route;
  for (let k = 1; k <= 5; k++) {
    if (k === 3) {
      await map.evaluate(el => el.scrollIntoView({block: 'start'}));
      await page.getByRole('button', {name: /^Ride along with route/}).click();
      await expect(map).toHaveAttribute('data-ride', 'following', {timeout: 10_000});
    }
    await expect.poll(() => publications.size, {timeout: 90_000, message: `publication ${k} since the bus was chosen`})
      .toBeGreaterThanOrEqual(start + k);
    await page.waitForTimeout(1000);
    const now = await read();
    seen.push({k, ...now});
    expect(now.card, `publication ${k}: the card`).toBe(vehicle);
    expect(now.strip, `publication ${k}: the strip under the map`).toBe(vehicle);
    expect(now.selection, `publication ${k}: still the passenger's choice, never a suggestion`).not.toBe('suggested');
    if (now.selection === 'active') {
      expect(now.map, `publication ${k}: the map`).toContain(vehicle);
      // Its route still has a bus, so the route offered below stays the one it was chosen from.
      expect(now.route, `publication ${k}: the route offered`).toBe(routeOffered);
      // Restated on 22 September 2026: the sticky strip and the card's head were one name said
      // twice, and are now one sticky head. What this check is for is that there is exactly one.
      expect(now.summaries, `publication ${k}: one summary of the chosen bus, not two`).toBe(1);
    }
    if (k >= 3) {
      expect(now.rideCard, `publication ${k}: the ride card`).toBe(vehicle);
      if (now.selection === 'active') expect(now.busInView, `publication ${k}: the ridden bus is in view`).toBe(true);
    }
  }
  await page.screenshot({path: test.info().outputPath(`${test.info().project.name}-real-follow.png`)});
  test.info().annotations.push({type: 'real follow', description: JSON.stringify({vehicle, seen})});
});
