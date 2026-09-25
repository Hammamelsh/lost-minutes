// What the Ride along button promises before it is entered, and what the ride says after.
//
// One quiet line beside the button, from the same facts the ride itself uses, tells three things
// apart: estimated movement on a checked road that the published evaluation scored, or the bus
// travelling between its own reports (which can pause), or an old report; and whether the front
// view (the street preview) is there. After entry the ride card keeps a short mode label with the
// report's age, and a large correction is acknowledged as a repositioning for a few seconds.
// FIXTURE data on the recorded route-256 road; Chromium with software WebGL, not a phone.
import {test, expect} from '@playwright/test';
import {FIXTURE_MOTION, movingLive, servePatterns, serveLive, serveMotion, waitForPaint} from './fixtures.mjs';

const LONGFORD_PARK = {latitude: 53.4487, longitude: -2.3095, accuracy: 40};
test.use({permissions: ['geolocation'], geolocation: LONGFORD_PARK});

const map = page => page.locator('.vector-map');
const offer = page => page.locator('.vector-map-foot .ride-offer');
const launch = page => page.locator('.ride-launch');
const rideMotion = page => page.locator('.ride-hud .ride-motion');

async function openAtStopA(page, {live = {}, motion = {}, before = async () => {}} = {}) {
  await servePatterns(page);
  await serveMotion(page, motion);
  await before();
  const startMs = Date.now();
  await serveLive(page, [() => movingLive({startMs, ...live})]);
  await page.goto('/');
  await waitForPaint(page);
  await page.getByRole('button', {name: 'Buses near me'}).click();
  await page.locator('.nearby-stop', {hasText: 'Stop A'}).first().click();
  await expect(page.locator('.waiting')).toBeVisible();
}

async function enterRide(page) {
  await map(page).evaluate(el => el.scrollIntoView({block: 'start'}));
  await launch(page).click();
  await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 15_000});
}

// Restated 25 September 2026 (backlog 31, the owner's decision): every ride is drawn from the bus's
// own reports, whichever way it is entered, because an estimate corrected by up to hundreds of metres
// as reports reach a phone jumps in a ride. On a scored road the map still shows the estimate,
// labelled; the offer says what the ride will be, and the ride says so, with how far behind it is drawn.
test('a scored road: estimated on the map, but the offer and the ride say reported positions, drawn from its reports', async ({page}) => {
  test.setTimeout(90_000);
  await openAtStopA(page, {live: {startMs: Date.now() - 60_000}});
  await expect(page.locator('.bus-card .route-badge')).toHaveText('256');
  await expect(map(page)).toHaveAttribute('data-motion', 'estimated', {timeout: 20_000});
  await expect(offer(page)).toHaveText('Reported positions · may pause · Front view');
  // The button's accessible name carries the same promise, so a screen reader hears it too.
  await expect(launch(page)).toHaveAttribute('aria-label', 'Ride along with route 256: Reported positions, may pause, Front view');
  await enterRide(page);
  await expect(map(page), 'in the ride it is drawn from its reports').toHaveAttribute('data-motion', 'observed');
  await expect(rideMotion(page)).toHaveText(/^((Moving between its reports|Standing) · (as it was about \d+ (s|min) ago · report \d+ (s|min) old|latest \d+ s ago)|Last reported position · \d+ s ago)$/);
  await expect(page.locator('.ride-mode-state')).toContainText('following the bus');
  await expect(page.getByRole('button', {name: 'Front view', exact: true})).toBeVisible();
  // Nothing about the ride is said twice: one mode label in the ride, one offer line outside it.
  await expect(page.locator('.ride-hud .ride-motion')).toHaveCount(1);
  // Leaving the ride, the map shows the estimate again: the same bus, the same journey.
  await page.getByRole('button', {name: 'Exit ride-along'}).click();
  await expect(map(page)).toHaveAttribute('data-ride', 'off');
  await expect(map(page)).toHaveAttribute('data-motion', 'estimated', {timeout: 10_000});
  await expect(page.locator('.bus-card .route-badge')).toHaveText('256');
});

test('a checked road the model was never scored on: reported positions, may pause, and still the front view', async ({page}) => {
  test.setTimeout(90_000);
  // The road is accepted, but the published evaluation lists no pattern: the second gate.
  await openAtStopA(page, {motion: {evaluation: {...FIXTURE_MOTION, corridor: {lines: [], patterns: []}}}});
  await expect(page.locator('.bus-card .route-badge')).toHaveText('256');
  await expect(map(page)).toHaveAttribute('data-motion', 'observed', {timeout: 20_000});
  await expect(map(page)).toHaveAttribute('data-motion-reason', /not been evaluated/);
  await expect(offer(page)).toHaveText('Reported positions · may pause · Front view');
  await enterRide(page);
  // Between reports it travels; at the newest it waits. Either way the age of the report is there.
  // Since 23 September 2026 a bus between its reports is played back on a clock, and the label says how
  // far behind them it is drawn rather than the newest report's age (docs/MOTION_MODEL.md); since
  // 24 September to the nearest five seconds, as "about".
  await expect(rideMotion(page)).toHaveText(/^((Moving between its reports|Standing) · (as it was about \d+ (s|min) ago · report \d+ (s|min) old|latest \d+ s ago)|Last reported position · \d+ s ago)$/);
  await expect(page.getByRole('button', {name: 'Front view', exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Front view', exact: true}).click();
  await expect(map(page)).toHaveAttribute('data-ride-camera', 'front');
  await expect(page.locator('.ride-mode-state')).toContainText('street preview');
});

test('no accepted road: reported positions, may pause, and no front view promised', async ({page}) => {
  test.setTimeout(90_000);
  await openAtStopA(page, {before: async () => {
    // Registered after serveMotion, so it answers first: the road was built and rejected.
    await page.route('**/data/shapes/index.json*', route => route.fulfill({json: {schemaVersion: 1,
      patterns: {'FX:256:main': {status: 'rejected', reason: 'FIXTURE: 95% of reports lie 80 m off it', file: 'FX_256_main.json'}}}}));
  }});
  await expect(page.locator('.bus-card .route-badge')).toHaveText('256');
  await expect(map(page)).toHaveAttribute('data-motion', 'observed', {timeout: 20_000});
  await expect(offer(page)).toHaveText('Reported positions · may pause');
  await enterRide(page);
  await expect(rideMotion(page)).toHaveText(/^((Moving between its reports|Standing) · (as it was about \d+ (s|min) ago · report \d+ (s|min) old|latest \d+ s ago)|Last reported position · \d+ s ago)$/);
  // The button says on its face what it cannot do, and stays where it is: no exit, no repeat note.
  const front = page.locator('.ride-camera.unavailable');
  await expect(front).toHaveText(/Front view · not on this route/);
  await front.click();
  await expect(page.locator('.ride-note')).toContainText('checked against its own reports');
  await expect(map(page)).toHaveAttribute('data-ride', 'following');
  await expect(map(page)).toHaveAttribute('data-ride-camera', 'outside');
  await front.click();
  await expect(page.locator('.ride-note', {hasText: 'checked against its own reports'})).toHaveCount(1);
});

test('an old report: said so beside the button, with no front view', async ({page}) => {
  test.setTimeout(90_000);
  await openAtStopA(page, {live: {extraAge: 180}});
  await page.locator('.exploring summary').click();
  await page.locator('.exploring .board-group', {hasText: 'Old reports'}).locator('.follow-row').first().click();
  await expect(map(page)).toHaveAttribute('data-motion', 'observed', {timeout: 15_000});
  await expect(map(page)).toHaveAttribute('data-motion-reason', /too old/);
  await expect(offer(page)).toHaveText('Last report is old · may pause');
  await expect(launch(page)).toHaveAttribute('aria-label', 'Ride along with route 256: Last report is old, may pause');
});

test('a large correction is shown as a repositioning: a trace on the map and one line on the card, then gone', async ({page}) => {
  test.setTimeout(150_000);
  await openAtStopA(page, {live: {jump: {atMs: Date.now() + 20_000, metres: 450}}});
  await expect(page.locator('.bus-card .route-badge')).toHaveText('256');
  await expect(map(page)).toHaveAttribute('data-motion', 'estimated', {timeout: 20_000});
  await enterRide(page);
  await expect(map(page)).toHaveAttribute('data-correction', /^snap:[3-5]\d\d/, {timeout: 60_000});
  const line = page.locator('.ride-hud [data-snap]');
  await expect(line).toHaveText(/^Moved [3-5]\d\d m to its latest report/);
  await expect(map(page)).toHaveAttribute('data-snap-trace', /^[3-5]\d\d$/);
  // The bus is still the same bus, still followed: a snap is not an exit.
  await expect(map(page)).toHaveAttribute('data-ride', 'following');
  await expect(page.locator('.ride-hud .route-badge, .bus-card .route-badge').first()).toHaveText('256');
  // The trace lasts six seconds and the line eight, then both go, so a snap is not a permanent notice.
  await expect(map(page)).toHaveAttribute('data-snap-trace', '', {timeout: 12_000});
  await expect(line).toHaveCount(0, {timeout: 12_000});
});
