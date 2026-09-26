// The view from above (components/gods-eye.tsx): a second renderer over the map, drawing the same
// buses at the same drawn places, opened and left without touching the journey. FIXTURE data, and a
// FIXTURE 3D Tiles tileset (a bounding region with no content, so the renderer loads it and shows
// nothing photographic — this checks the viewer, not any imagery); CesiumJS from this site's own
// copy. SwiftShader, so the timings are a software renderer's, not a phone's.
import {test, expect} from '@playwright/test';
import {fastConfig, fleetLive, servePatterns, serveLive, serveMotion, waitForPaint} from './fixtures.mjs';

const TILESET_URL = 'https://fixture.invalid/tileset.json';
const rad = deg => deg * Math.PI / 180;
/** A 3D Tiles tileset over the fixture road with nothing in it: valid, loads at once, draws nothing. */
const FIXTURE_TILESET = {asset: {version: '1.1', copyright: 'FIXTURE imagery credit'}, geometricError: 2000,
  root: {boundingVolume: {region: [rad(-2.34), rad(53.44), rad(-2.29), rad(53.46), 0, 400]}, geometricError: 0, refine: 'ADD'}};

const map = page => page.locator('.vector-map').first();
const above = page => page.locator('.gods-eye');
const stats = async page => ((await above(page).getAttribute('data-above-stats')) ?? '').split(',').map(Number);

async function serveAbove(page, {photo3d = true} = {}) {
  await servePatterns(page);
  await serveMotion(page, {evaluation: null});
  const start = Date.now() - 90_000;
  await serveLive(page, [() => fleetLive({nowMs: Date.now(), startMs: start, count: 4, spacing: 120, roads: true})]);
  // Registered after serveLive's own config route, so this one answers first.
  if (photo3d) {
    await page.route('**/data/config.json*', route => route.fulfill({json: {...fastConfig(),
      photo3d: {provider: 'sample', tilesetUrl: TILESET_URL, attribution: 'FIXTURE: a sample tileset', note: 'FIXTURE'}}}));
    await page.route(TILESET_URL, route => route.fulfill({json: FIXTURE_TILESET}));
  }
}

test('the view from above opens on the same buses, descends to the chosen one, and leaves the journey as it was', async ({page}) => {
  test.setTimeout(150_000);
  await serveAbove(page);
  await page.goto('/?bus=BNML%7CFX-MOVING%7C256%7Cinbound%7CFX-MOVING-J');
  await waitForPaint(page);
  await expect(map(page)).toHaveAttribute('data-selected-key', 'BNML|FX-MOVING');
  await expect(map(page)).toHaveAttribute('data-display', /\d/, {timeout: 15_000});
  const motionBefore = await map(page).getAttribute('data-motion');
  // The way in: the Explore block's row (on a phone the sheet opens to the block first).
  const link = page.locator('[data-try-ride-link]');
  if (await link.isVisible()) await link.click();
  const entry = page.locator('[data-above-entry]');
  await entry.scrollIntoViewIfNeeded();
  await entry.click();
  await expect(above(page)).toHaveAttribute('data-above', /ready|failed/, {timeout: 60_000});
  const status = await above(page).getAttribute('data-above');
  const why = await above(page).locator('[data-above-note]').textContent();
  expect(status, `the renderer loaded from this site (${why})`).toBe('ready');
  await expect(above(page)).toHaveAttribute('data-above-imagery', 'loaded', {timeout: 30_000});
  // The buses the map draws are on it — the chosen one among them — and the camera descends to it.
  await expect.poll(async () => (await stats(page))[0], {timeout: 15_000}).toBeGreaterThanOrEqual(1);
  await expect(above(page)).toHaveAttribute('data-above-mode', 'following', {timeout: 20_000});
  await expect(above(page).locator('[data-above-bus]')).toContainText('256');
  await expect(above(page).locator('[data-above-note]')).toContainText('sample');
  const ready = await above(page).getAttribute('data-above-ready-ms'), usable = await above(page).getAttribute('data-above-usable-ms');
  const s = await stats(page);
  console.log(`above: ready in ${ready} ms, imagery usable in ${usable} ms, ${s[0]} buses drawn, tick ${s[1]} ms, ${s[2]} frames${s[3] ? `, heap ${s[3]} MB` : ''}`);
  await page.screenshot({path: test.info().outputPath(`${test.info().project.name}-above-following.png`)});
  // A drag takes the camera; Return to bus gives it back.
  const box = await above(page).locator('.gods-eye-canvas').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 40, {steps: 8});
  await page.mouse.up();
  await expect(above(page)).toHaveAttribute('data-above-mode', 'exploring', {timeout: 5000});
  await page.getByRole('button', {name: 'Return to bus'}).click();
  await expect(above(page)).toHaveAttribute('data-above-mode', 'following');
  // Leaving: the map is as it was, the same bus chosen and still drawn from its reports.
  await page.getByRole('button', {name: 'Exit the view from above'}).click();
  await expect(above(page)).toHaveCount(0);
  await expect(map(page)).toHaveAttribute('data-selected-key', 'BNML|FX-MOVING');
  await expect(map(page)).toHaveAttribute('data-motion', motionBefore);
  await expect(map(page)).toHaveAttribute('data-display', /\d/);
});

test('with no tileset configured the view is not offered at all', async ({page}) => {
  await serveAbove(page, {photo3d: false});
  await page.goto('/');
  await waitForPaint(page);
  const link = page.locator('[data-try-ride-link]');
  if (await link.isVisible()) await link.click();
  await expect(page.locator('.try-ride')).toBeVisible();
  await expect(page.locator('[data-above-entry]')).toHaveCount(0);
});

test('a tileset that cannot be loaded is said, and the way back is one tap', async ({page}) => {
  test.setTimeout(120_000);
  await serveAbove(page);
  await page.route(TILESET_URL, route => route.fulfill({status: 403, body: 'forbidden'}));
  await page.goto('/?bus=BNML%7CFX-MOVING%7C256%7Cinbound%7CFX-MOVING-J');
  await waitForPaint(page);
  const link = page.locator('[data-try-ride-link]');
  if (await link.isVisible()) await link.click();
  await page.locator('[data-above-entry]').click();
  await expect(above(page)).toHaveAttribute('data-above', 'failed', {timeout: 60_000});
  await expect(above(page).locator('[role="alert"]')).toContainText('imagery could not be loaded');
  await page.getByRole('button', {name: 'Back to the map'}).click();
  await expect(above(page)).toHaveCount(0);
  await expect(map(page)).toHaveAttribute('data-selected-key', 'BNML|FX-MOVING');
});
