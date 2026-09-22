// The device's position, the journey's starting point and the map are three things. Emulated
// geolocation in Chromium (context.setGeolocation), which is not a phone's GPS: the fixes are
// exact, instant and never denied unless told to be. FIXTURE buses; the real stop catalogue.
import {test, expect} from '@playwright/test';
import {foldSheet, unfoldSheet, journeyLive, servePatterns, serveLive, waitForPaint} from './fixtures.mjs';

const LONGFORD_PARK = {latitude: 53.4487, longitude: -2.3095, accuracy: 40};
// 60 m north-east of Longford Park; and 5 m east, which is GPS noise at 40 m accuracy.
const SIXTY_M = {latitude: 53.4491, longitude: -2.3089, accuracy: 40};
const FIVE_M = {latitude: 53.4487, longitude: -2.30942, accuracy: 40};
test.use({permissions: ['geolocation'], geolocation: LONGFORD_PARK});

const map = page => page.locator('.vector-map');
const here = page => map(page).getAttribute('data-here');
const firstStop = page => page.locator('.nearby-stop').first().locator('strong').innerText();
/** The camera at rest: the same reading twice, 600 ms apart (an explicit Locate eases the map to the
 *  device over 500 ms, and that move is the passenger's, not an update's). */
async function settledCamera(page) {
  let last;
  await expect.poll(async () => { const now = await map(page).getAttribute('data-camera'); const still = now === last; last = now; return still; },
    {intervals: [600], timeout: 15_000}).toBe(true);
  return last;
}

async function openAndLocate(page) {
  await servePatterns(page);
  await serveLive(page, [() => journeyLive()]);
  await page.goto('/');
  await waitForPaint(page);
  await page.getByRole('button', {name: 'Buses near me'}).click();
  await expect(page.locator('.nearby-head')).toContainText('Stops near you');
  await expect.poll(() => here(page)).toMatch(/^53\.4487/);
}

test('walking moves You and re-sorts the stops; noise within the fix’s accuracy changes nothing', async ({page, context}) => {
  test.setTimeout(90_000);
  await openAndLocate(page);
  const before = await here(page), stopBefore = await firstStop(page);
  const cameraBefore = await settledCamera(page);
  // Noise: 5 m at 40 m accuracy is inside the band, so the marker and the list stay put.
  await context.setGeolocation(FIVE_M);
  await page.waitForTimeout(2500);
  expect(await here(page), 'a 5 m step at 40 m accuracy is noise').toBe(before);
  // A walk: 60 m, taken up without touching the camera.
  await context.setGeolocation(SIXTY_M);
  await expect.poll(() => here(page), {timeout: 10_000}).toMatch(/^53\.4491/);
  await page.waitForTimeout(1200);
  expect(await map(page).getAttribute('data-camera'), 'the camera is not dragged by a position update').toBe(cameraBefore);
  const stopAfter = await firstStop(page);
  test.info().annotations.push({type: 'nearby', description: `nearest before ${stopBefore}, after 60 m ${stopAfter}`});
  await expect(page.locator('.nearby-head')).toContainText('Stops near you');
});

test('a chosen starting point is fixed: a later fix from the device cannot overwrite it, and both are drawn apart', async ({page, context}) => {
  test.setTimeout(90_000);
  await openAndLocate(page);
  // Choose a start on the map for someone else: the page's own picker, at Stretford Mall.
  await page.locator('.nearby-stop', {hasText: 'Stop A'}).first().click();
  await expect(page.locator('.your-stop-copy strong')).toContainText('Stretford Mall');
  await page.locator('.walk-guide details summary').first().click().catch(() => {});
  await page.getByRole('button', {name: /Choose starting point/}).click();
  // The map is what is being pointed at: on a phone the sheet comes down first.
  await foldSheet(page);
  await expect(map(page)).toHaveAttribute('data-picking', 'true').catch(() => {});
  // A locator click reaches the map under touch emulation too (a raw mouse click does not).
  const box = await page.locator('.vector-map-canvas').boundingBox();
  await page.locator('.vector-map-canvas').click({position: {x: box.width * 0.5, y: box.height * 0.5}});
  await expect.poll(() => here(page), {timeout: 10_000}).not.toMatch(/^53\.4487/);
  // The map has been used; the panel comes back up for the rest of the journey.
  await unfoldSheet(page);
  const chosen = await here(page);
  await expect(page.locator('.legend-you')).toHaveText('Starting point');
  // The device moves; the starting point does not, and the device is still drawn as You.
  await context.setGeolocation(SIXTY_M);
  await page.waitForTimeout(3000);
  expect(await here(page), 'the starting point is fixed').toBe(chosen);
  await expect.poll(() => map(page).getAttribute('data-device'), {timeout: 10_000}).toMatch(/^53\.4491/);
  // Back to the device: explicit, and the start follows the device again.
  await page.locator('.walk-guide [data-update-location]').click();
  await expect.poll(() => here(page), {timeout: 10_000}).toMatch(/^53\.4491/);
  await expect(page.locator('.legend-you')).toHaveText('You');
});

test('stops are listed around the chosen starting point, not around the device', async ({page}) => {
  test.setTimeout(60_000);
  await servePatterns(page);
  await serveLive(page, [() => journeyLive()]);
  await page.goto('/');
  await waitForPaint(page);
  // No location pressed at all: the page must still search and browse.
  await page.getByRole('combobox', {name: 'Bus number, stop or area'}).first().fill('stretford mall');
  await page.locator('.stop-search-option').first().dispatchEvent('mousedown');
  await expect(page.locator('.your-stop-copy strong')).toContainText('Stretford Mall');
  await expect(page.locator('.waiting')).toBeVisible();
});
