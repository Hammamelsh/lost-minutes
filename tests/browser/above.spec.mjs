// The view from above (components/gods-eye.tsx): a second renderer over the map, drawing the same
// buses at the same drawn places, opened and left without touching the journey. FIXTURE data, and a
// FIXTURE 3D Tiles tileset (a bounding region with no content, so the renderer loads it and shows
// nothing photographic — this checks the viewer, not any imagery); CesiumJS from this site's own
// copy. SwiftShader, so the timings are a software renderer's, not a phone's. No request reaches any
// provider: every tileset address, Google's included, is answered here.
import {test, expect} from '@playwright/test';
import {fastConfig, fleetLive, servePatterns, serveLive, serveMotion, waitForPaint} from './fixtures.mjs';

const TILESET_URL = 'https://fixture.invalid/tileset.json';
const GOOGLE_URL = 'https://tile.googleapis.com/v1/3dtiles/root.json?key=FIXTURE_NOT_A_KEY';
const rad = deg => deg * Math.PI / 180;
const REGION = [rad(-2.34), rad(53.44), rad(-2.29), rad(53.46), 0, 400];
/** A 3D Tiles tileset over the fixture road with nothing in it: valid, loads at once, draws nothing. */
const FIXTURE_TILESET = {asset: {version: '1.1', copyright: 'FIXTURE imagery credit'}, geometricError: 2000,
  root: {boundingVolume: {region: REGION}, geometricError: 0, refine: 'ADD'}};
/** The same, with six tiles under it whose content cannot be fetched: the renderer asks, they fail. */
const FAILING_TILESET = {asset: {version: '1.1'}, geometricError: 4000,
  root: {boundingVolume: {region: REGION}, geometricError: 2000, refine: 'REPLACE',
    children: Array.from({length: 6}, (_, i) => ({boundingVolume: {region: [rad(-2.34 + i * 0.008), rad(53.44), rad(-2.332 + i * 0.008), rad(53.46), 0, 400]},
      geometricError: 0, content: {uri: `https://fixture.invalid/missing-${i}.glb`}}))}};

const map = page => page.locator('.vector-map').first();
const above = page => page.locator('.gods-eye');
const stats = async page => ((await above(page).getAttribute('data-above-stats')) ?? '').split(',').map(Number);
const LINK = '/?bus=BNML%7CFX-MOVING%7C256%7Cinbound%7CFX-MOVING-J';

async function serveAbove(page, {photo3d = true, provider = 'sample', tileset = FIXTURE_TILESET} = {}) {
  await servePatterns(page);
  await serveMotion(page, {evaluation: null});
  const start = Date.now() - 90_000;
  await serveLive(page, [() => fleetLive({nowMs: Date.now(), startMs: start, count: 4, spacing: 120, roads: true})]);
  // Registered after serveLive's own config route, so this one answers first.
  if (photo3d) {
    const url = provider === 'google' ? GOOGLE_URL : TILESET_URL;
    await page.route('**/data/config.json*', route => route.fulfill({json: {...fastConfig(),
      photo3d: {provider, tilesetUrl: url, attribution: provider === 'google' ? 'Google' : 'FIXTURE: a sample tileset', note: 'FIXTURE'}}}));
    await page.route(provider === 'google' ? 'https://tile.googleapis.com/**' : 'https://fixture.invalid/**',
      route => route.request().url().includes('missing-') ? route.fulfill({status: 500, body: 'no'}) : route.fulfill({json: tileset}));
  }
}

async function open(page) {
  const link = page.locator('[data-try-ride-link]');
  if (await link.isVisible()) await link.click();
  const entry = page.locator('[data-above-entry]');
  await entry.scrollIntoViewIfNeeded();
  await entry.click();
}

test('the view from above opens on the same buses, descends to the chosen one, and leaves the journey as it was', async ({page}) => {
  test.setTimeout(150_000);
  await serveAbove(page);
  await page.goto(LINK);
  await waitForPaint(page);
  await expect(map(page)).toHaveAttribute('data-selected-key', 'BNML|FX-MOVING');
  await expect(map(page)).toHaveAttribute('data-display', /\d/, {timeout: 15_000});
  const motionBefore = await map(page).getAttribute('data-motion');
  await open(page);
  await expect(above(page)).toHaveAttribute('data-above', /ready|failed/, {timeout: 60_000});
  const status = await above(page).getAttribute('data-above');
  const why = await above(page).locator('[data-above-note]').textContent();
  expect(status, `the renderer loaded from this site (${why})`).toBe('ready');
  await expect(above(page)).toHaveAttribute('data-above-imagery', 'loaded', {timeout: 30_000});
  // The buses the map draws are on it — the chosen one among them — and the camera descends to it.
  await expect.poll(async () => (await stats(page))[0], {timeout: 15_000}).toBeGreaterThanOrEqual(1);
  await expect(above(page)).toHaveAttribute('data-above-mode', 'following', {timeout: 20_000});
  await expect(above(page).locator('[data-above-bus]')).toContainText('256');
  await expect(above(page).locator('[data-above-bus]')).toContainText('report');
  await expect(above(page).locator('[data-above-note]')).toContainText('sample');
  // Our own data, credited apart from the imagery's.
  await expect(above(page).locator('[data-above-ours]')).toContainText('Bus Open Data Service');
  // The same bus, at the same drawn place and the same moment as the map's own drawing.
  const same = await page.evaluate(() => {
    const view = document.querySelector('.gods-eye')?.getAttribute('data-above-chosen')?.split(',');
    const drawn = document.querySelector('.vector-map')?.getAttribute('data-display')?.split(',');
    return {view, drawn};
  });
  const [key, vlat, vlon, vat] = same.view;
  const [dlat, dlon, , , dat] = same.drawn;
  expect(key).toBe('BNML|FX-MOVING');
  const apart = Math.hypot((+vlat - +dlat) * 111195, (+vlon - +dlon) * 111195 * Math.cos(+dlat * Math.PI / 180));
  expect(apart, `the view draws the chosen bus where the map does: ${apart.toFixed(2)} m apart`).toBeLessThan(5);
  expect(Math.abs(+vat - +dat), 'at the map’s own presentation time').toBeLessThan(400);
  const ready = await above(page).getAttribute('data-above-ready-ms'), usable = await above(page).getAttribute('data-above-usable-ms');
  const s = await stats(page);
  console.log(`above: ready in ${ready} ms, imagery usable in ${usable} ms, ${s[0]} buses drawn, tick ${s[1]} ms, ${s[2]} frames${s[3] ? `, heap ${s[3]} MB` : ''}`);
  await page.screenshot({path: test.info().outputPath(`${test.info().project.name}-above-following.png`)});
  // Closer, then higher: offered, never forced, and the follow resumes at each.
  await page.getByRole('button', {name: 'Closer'}).click();
  await expect(above(page).locator('[data-above-distance]')).toHaveAttribute('data-above-distance', 'close');
  await expect(above(page)).toHaveAttribute('data-above-mode', 'following', {timeout: 20_000});
  await page.getByRole('button', {name: 'Higher'}).click();
  await expect(above(page).locator('[data-above-distance]')).toHaveAttribute('data-above-distance', 'elevated');
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
  await expect(page.locator('.gods-eye-canvas canvas')).toHaveCount(0);
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

for (const [name, answer, kind, words] of [
  ['a key or account the provider refuses', {status: 403, body: 'forbidden'}, 'refused', 'refused this site’s request'],
  ['the day’s quota used up', {status: 429, body: 'quota'}, 'quota', 'allowance of 3D imagery for this site has been used up'],
  ['no answer at all', 'abort', 'unreachable', 'could not be reached'],
]) {
  test(`${name} is said as that, and the way back is one tap`, async ({page}) => {
    test.setTimeout(120_000);
    await serveAbove(page);
    await page.route(TILESET_URL, route => answer === 'abort' ? route.abort('connectionrefused') : route.fulfill(answer));
    await page.goto(LINK);
    await waitForPaint(page);
    await open(page);
    await expect(above(page)).toHaveAttribute('data-above', 'failed', {timeout: 60_000});
    const alert = above(page).locator('[role="alert"]');
    await expect(alert).toHaveAttribute('data-above-failure', kind);
    await expect(alert).toContainText(words);
    await expect(alert).toContainText('The map works as before');
    await page.getByRole('button', {name: 'Back to the map'}).click();
    await expect(above(page)).toHaveCount(0);
    await expect(map(page)).toHaveAttribute('data-selected-key', 'BNML|FX-MOVING');
  });
}

test('tiles that fail after the view opened are said, and the view stays usable', async ({page}) => {
  test.setTimeout(120_000);
  await serveAbove(page, {tileset: FAILING_TILESET});
  await page.goto(LINK);
  await waitForPaint(page);
  await open(page);
  await expect(above(page)).toHaveAttribute('data-above', 'ready', {timeout: 60_000});
  await expect(above(page).locator('[data-above-trouble]')).toHaveAttribute('data-above-trouble', 'tiles', {timeout: 30_000});
  await expect(above(page).locator('[data-above-trouble]')).toContainText('could not be loaded');
  await expect(page.getByRole('button', {name: 'Exit the view from above'})).toBeVisible();
});

test('hidden and shown again, the view goes on drawing the map’s own frames (visibility emulated)', async ({page}) => {
  test.setTimeout(120_000);
  await serveAbove(page);
  await page.goto(LINK);
  await waitForPaint(page);
  await open(page);
  await expect(above(page)).toHaveAttribute('data-above-mode', 'following', {timeout: 60_000});
  const hide = hidden => page.evaluate(h => {
    Object.defineProperty(document, 'hidden', {configurable: true, get: () => h});
    Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => h ? 'hidden' : 'visible'});
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
  await hide(true);
  const during = await above(page).getAttribute('data-above-frame');
  await page.waitForTimeout(3000);
  expect(await above(page).getAttribute('data-above-frame'), 'no ticks while hidden').toBe(during);
  await hide(false);
  await expect.poll(async () => Number(await above(page).getAttribute('data-above-frame')), {timeout: 5000}).toBeGreaterThan(Number(during) + 1000);
  await expect(above(page)).toHaveAttribute('data-above-mode', 'following');
  await expect(above(page)).toHaveAttribute('data-above', 'ready');
});

test('Google’s imagery carries its logo, clear of the renderer’s, and its terms; our data is credited apart', async ({page}) => {
  test.setTimeout(120_000);
  const google = [];
  page.on('request', r => { if (r.url().startsWith('https://tile.googleapis.com/')) google.push(r.url()); });
  await serveAbove(page, {provider: 'google'});
  await page.goto(LINK);
  await waitForPaint(page);
  await page.waitForTimeout(1500);
  // Nothing is asked of Google until the view is opened: the one billed request is the tap's.
  expect(google, 'no request to Google before the view is opened').toEqual([]);
  await open(page);
  await expect(above(page)).toHaveAttribute('data-above', 'ready', {timeout: 60_000});
  const logo = above(page).getByRole('img', {name: 'Google Maps'});
  await expect(logo).toBeVisible();
  await page.waitForTimeout(1500);
  await page.screenshot({path: test.info().outputPath(`${test.info().project.name}-above-google-ready.png`)});

  const lb = await logo.boundingBox();
  expect(lb.height, 'the logo is 16–19 px high').toBeGreaterThanOrEqual(16);
  expect(lb.height).toBeLessThanOrEqual(19);
  const view = await above(page).boundingBox();
  expect(lb.x - view.x, 'clear space on the left').toBeGreaterThanOrEqual(10);
  expect(view.y + view.height - (lb.y + lb.height), 'clear space below').toBeGreaterThanOrEqual(5);
  // The renderer's logo, where it draws one, stands apart from Google's.
  const cesium = page.locator('.gods-eye .cesium-credit-logoContainer');
  if (await cesium.count() && await cesium.first().isVisible()) {
    const cb = await cesium.first().boundingBox();
    const gap = Math.max(cb.x - (lb.x + lb.width), lb.x - (cb.x + cb.width), cb.y - (lb.y + lb.height), lb.y - (cb.y + cb.height));
    expect(gap, 'no overlap, and a clear gap between the two logos').toBeGreaterThanOrEqual(10);
  }
  await expect(above(page).locator('.gods-eye-terms a').first()).toHaveAttribute('href', 'https://maps.google.com/help/terms_maps/');
  await expect(above(page).locator('[data-above-ours]')).toContainText('OpenStreetMap');
  await expect(above(page).locator('[data-above-note]')).toContainText('not a live view');
  expect(google.filter(u => u.includes('root.json')).length, 'one opening request, answered here').toBe(1);
  // The site's own notes carry the notice Google's terms ask for, where its content is offered.
  await expect(page.locator('[data-note="google-maps"]')).toHaveCount(1);
  await page.screenshot({path: test.info().outputPath(`${test.info().project.name}-above-google.png`)});
});
