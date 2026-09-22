// Two buses under one finger. Until 21 September 2026 a tap took whichever marker was nearer by a
// pixel; now a tap that lands on two buses, neither clearly nearer, asks at the tap. A tap that
// lands on one bus still takes it (selection.spec keeps that check), and a tap on empty map chooses
// nothing. FIXTURE data on the vector map, clicked on desktop and tapped on the phone; the tilted
// City view is tried as well as the flat one. Chromium with software WebGL, not a phone.
import {test, expect} from '@playwright/test';
import {foldSheet, journeyLive, mapBand, servePatterns, serveLive, waitForPaint} from './fixtures.mjs';

const LONGFORD_PARK = {latitude: 53.4487, longitude: -2.3095, accuracy: 40};
test.use({permissions: ['geolocation'], geolocation: LONGFORD_PARK});

const map = page => page.locator('.vector-map');
const card = page => page.locator('#lm-bus-card');
const chooser = page => page.locator('.bus-chooser');

/** FX-COMING and, two metres from it, FX-TWIN: the same road, another destination, an older report. */
function twins() {
  const live = journeyLive({omit: ['FX-SHARED', 'FX-PASSED']});
  const coming = live.vehicles.find(v => v.vehicle === 'FX-COMING');
  live.vehicles.push({...coming, vehicle: 'FX-TWIN', journeyRef: 'FX-FX-TWIN', destination: 'Manchester_Piccadilly',
    lat: coming.lat + 0.00002, lon: coming.lon, ageSeconds: 20, observedAtMs: coming.observedAtMs - 6000,
    recordedAt: new Date(coming.observedAtMs - 6000).toISOString().replace('.000Z', '+00:00'),
    match: {...coming.match, scheduled: undefined}});
  return live;
}

/** Where a bus is drawn: the map lists the other buses in data-bus-points and the chosen one in
 *  data-bus-screen, so a bus is found in whichever it is in at the time. */
async function busPoint(page, vehicle) {
  const handle = await page.waitForFunction(v => {
    const el = document.querySelector('.vector-map');
    const raw = el?.getAttribute('data-bus-points');
    const listed = raw ? JSON.parse(raw).find(p => p.key.endsWith(`|${v}`)) : null;
    if (listed) return listed;
    if (el?.getAttribute('data-selected-key')?.endsWith(`|${v}`)) {
      const [x, y] = (el.getAttribute('data-bus-screen') || '').split(',').map(Number);
      if (Number.isFinite(x) && Number.isFinite(y)) return {key: el.getAttribute('data-selected-key'), x, y};
    }
    return false;
  }, vehicle, {timeout: 15_000});
  return handle.jsonValue();
}
async function settledMap(page) {
  await map(page).evaluate(el => el.scrollIntoView({block: 'start'}));
  let last;
  await expect.poll(async () => {
    const now = await map(page).evaluate(el => `${el.getAttribute('data-camera')}|${el.getAttribute('data-bus-screen')}`);
    const still = now === last; last = now; return still;
  }, {intervals: [500], timeout: 15_000, message: 'the camera comes to rest'}).toBe(true);
  await page.waitForTimeout(400);
}
const covered = (page, x, y) => page.evaluate(([px, py]) => {
  const el = document.elementFromPoint(px, py);
  return el?.classList.contains('maplibregl-canvas') ? null : (el?.className?.toString() || el?.tagName || 'nothing');
}, [x, y]);
async function tapAt(page, point) {
  const box = await page.locator('.vector-map-canvas').boundingBox();
  const x = box.x + point.x, y = box.y + point.y;
  expect(await covered(page, x, y), `the spot (${Math.round(x)}, ${Math.round(y)}) is the map`).toBeNull();
  if (test.info().project.name === 'mobile') await page.touchscreen.tap(x, y); else await page.mouse.click(x, y);
}
/** A spot on the canvas at least 60 px from every drawn bus and under no control. */
async function emptySpot(page) {
  const points = JSON.parse(await map(page).getAttribute('data-bus-points') || '[]');
  // Every boarding point is drawn since 22 September, and a tap on one chooses that stop, so an
  // empty spot has to be clear of the signs as well as of the buses.
  const signs = JSON.parse(await map(page).getAttribute('data-stop-points') || '[]');
  const canvas = await page.locator('.vector-map-canvas').boundingBox();
  // The band is the part of the canvas nothing covers; the answer is measured from the canvas,
  // as the map's own diagnostics are.
  const band = await mapBand(page);
  const dy = band.y - canvas.y;
  for (const [fx, fy] of [[0.5, 0.55], [0.35, 0.45], [0.65, 0.5], [0.5, 0.35], [0.4, 0.6], [0.6, 0.65]]) {
    const p = {x: band.width * fx, y: dy + band.height * fy};
    if (points.every(q => Math.hypot(q.x - p.x, q.y - p.y) > 60)
        && signs.every(q => Math.hypot(q.x - p.x, q.y - p.y) > 45)
        && await covered(page, canvas.x + p.x, canvas.y + p.y) === null) return p;
  }
  throw new Error('no empty spot found on the canvas');
}

async function openTwins(page) {
  await servePatterns(page);
  await serveLive(page, [twins]);
  await page.goto('/');
  await waitForPaint(page);
  await page.getByRole('button', {name: 'Buses near me'}).click();
  await page.locator('.nearby-stop', {hasText: 'Stop A'}).first().click();
  await expect(card(page)).toHaveAttribute('data-vehicle', 'FX-COMING', {timeout: 15_000});
  // On a phone the sheet covers the lower half of the map, as it is meant to; a passenger who
  // wants to tap a bus pulls it down first, and so does this check.
  await foldSheet(page);
  await settledMap(page);
}

test('two buses under one tap: the passenger is asked, can pick either, or neither, by pointer or keyboard', async ({page}) => {
  test.setTimeout(120_000);
  await openTwins(page);
  const before = await map(page).getAttribute('data-selected-key');
  await tapAt(page, await busPoint(page, 'FX-TWIN'));
  const dialog = chooser(page);
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('2 buses here');
  await expect(dialog.locator('button[data-choose]')).toHaveCount(2);
  await expect(dialog).toContainText('to Piccadilly Gardens');
  await expect(dialog).toContainText('to Manchester Piccadilly');
  // Nothing was chosen by the tap itself: the suggested bus is still the suggestion.
  await expect(map(page)).toHaveAttribute('data-selected-key', before);
  await expect(card(page)).toHaveAttribute('data-selection', 'suggested');
  // Keyboard: the first choice has focus; Escape declines and changes nothing.
  await expect(dialog.locator('button').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(card(page)).toHaveAttribute('data-vehicle', 'FX-COMING');
  // Pointer: ask again, pick the twin; it is chosen, pinned, and the chooser is gone. (A second
  // tap inside MapLibre's double-tap window would be a zoom, so the map is let settle first.)
  await settledMap(page);
  await tapAt(page, await busPoint(page, 'FX-TWIN'));
  await expect(dialog).toBeVisible();
  await dialog.locator('button[data-choose$="|FX-TWIN"]').click();
  await expect(dialog).toHaveCount(0);
  await expect(card(page)).toHaveAttribute('data-vehicle', 'FX-TWIN');
  await expect(card(page)).toHaveAttribute('data-selection', 'active');
  await expect(card(page)).toContainText('to Manchester Piccadilly');
  // Keyboard, all the way: ask again, Enter takes the focused (first) choice.
  await settledMap(page);
  await tapAt(page, await busPoint(page, 'FX-COMING'));
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('button').first()).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect(card(page)).toHaveAttribute('data-selection', 'active');
  // "Neither" closes it and keeps what was chosen.
  const kept = await card(page).getAttribute('data-vehicle');
  await settledMap(page);
  await tapAt(page, await busPoint(page, 'FX-COMING'));
  await dialog.getByRole('button', {name: 'Neither'}).click();
  await expect(dialog).toHaveCount(0);
  await expect(card(page)).toHaveAttribute('data-vehicle', kept);
});

test('a tap on empty map chooses nothing and asks nothing; the tilted City view asks too', async ({page}) => {
  test.setTimeout(120_000);
  await openTwins(page);
  const before = await card(page).getAttribute('data-vehicle');
  await tapAt(page, await emptySpot(page));
  await page.waitForTimeout(600);
  await expect(chooser(page)).toHaveCount(0);
  await expect(card(page)).toHaveAttribute('data-vehicle', before);
  await expect(card(page)).toHaveAttribute('data-selection', 'suggested');
  await page.getByRole('button', {name: 'City'}).click();
  await expect(map(page)).toHaveAttribute('data-view', 'city');
  await settledMap(page);
  await tapAt(page, await busPoint(page, 'FX-TWIN'));
  await expect(chooser(page)).toBeVisible();
  await chooser(page).locator('button[data-choose$="|FX-TWIN"]').click();
  await expect(card(page)).toHaveAttribute('data-vehicle', 'FX-TWIN');
  await expect(card(page)).toHaveAttribute('data-selection', 'active');
});
