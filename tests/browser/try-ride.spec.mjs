// Try Ride-along: the way in for someone with no stop in mind, from the latest publication's own
// eligibility. It lists buses whose ride is certain now with what kind of ride each will be, in
// order of what the ride can be; choosing one starts the ride at once, with no stop chosen; it is
// honest when nothing qualifies; and with no live feed only a recording is offered. FIXTURE data.
import {test, expect} from '@playwright/test';
import {FIXTURE_MOTION, journeyLive, movingLive, servePatterns, serveLive, serveMotion, unavailableState, waitForPaint} from './fixtures.mjs';

const section = page => page.locator('.try-ride');
const card = page => page.locator('#lm-bus-card');
const noRecordings = page => page.route('**/data/rides/index.json*', route => route.fulfill({json: {schemaVersion: 1, rides: []}}));

test('lists the buses whose ride is certain now, and choosing one starts the ride with no stop', async ({page}) => {
  await servePatterns(page);
  await serveMotion(page);
  await noRecordings(page);
  await serveLive(page, [() => journeyLive()]);
  await page.goto('/');
  await waitForPaint(page);
  await expect(section(page)).toHaveAttribute('data-rides', 'ready', {timeout: 15_000});
  // FX-COMING and FX-PASSED are on the accepted, evaluated road and lead; FX-ATSTOP and FX-NEARBY
  // are placed on no pattern at all, and FX-SHARED is unsettled: neither is offered.
  const rows = section(page).locator('button[data-ride-bus]');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toHaveAttribute('data-ride-tier', 'estimated');
  await expect(rows.first()).toContainText('Estimated movement · Front view');
  await expect(section(page)).not.toContainText('FX-SHARED');
  await expect(section(page)).toContainText('not a film');
  await rows.first().click();
  await expect(card(page)).toHaveAttribute('data-vehicle', 'FX-COMING');
  await expect(card(page)).toHaveAttribute('data-selection', 'active');
  await expect(card(page)).toContainText('to Piccadilly Gardens');
  // The ride began, on the bus chosen, and no stop was chosen by it.
  await expect(page.locator('.vector-map')).toHaveAttribute('data-ride', /entering|following/, {timeout: 15_000});
  await expect(page.locator('.follow')).not.toHaveClass(/has-stop/);
  // Exit is one tap, and the bus stays chosen afterwards.
  await page.getByRole('button', {name: 'Exit ride-along'}).click();
  await expect(page.locator('.vector-map')).toHaveAttribute('data-ride', 'off');
  await expect(card(page)).toHaveAttribute('data-vehicle', 'FX-COMING');
});

test('a checked road the model was not scored on is offered as reported positions with the front view', async ({page}) => {
  await servePatterns(page);
  await serveMotion(page, {evaluation: {...FIXTURE_MOTION, corridor: {lines: [], patterns: []}}});
  await noRecordings(page);
  const startMs = Date.now();
  await serveLive(page, [() => movingLive({startMs})]);
  await page.goto('/');
  await waitForPaint(page);
  await expect(section(page)).toHaveAttribute('data-rides', 'ready', {timeout: 15_000});
  const first = section(page).locator('button[data-ride-bus]').first();
  await expect(first).toHaveAttribute('data-ride-tier', 'road');
  await expect(first).toContainText('Reported positions · may pause · Front view');
});

test('a bus placed on a pattern with no checked road is offered last, as reported positions only', async ({page}) => {
  await servePatterns(page);
  await serveMotion(page);
  await noRecordings(page);
  await page.route('**/data/shapes/index.json*', route => route.fulfill({json: {schemaVersion: 1,
    patterns: {'FX:256:main': {status: 'rejected', reason: 'FIXTURE: rejected', file: 'FX_256_main.json'}}}}));
  await serveLive(page, [() => journeyLive()]);
  await page.goto('/');
  await waitForPaint(page);
  await expect(section(page)).toHaveAttribute('data-rides', 'ready', {timeout: 15_000});
  const rows = section(page).locator('button[data-ride-bus]');
  await expect(rows).toHaveCount(2);
  for (const i of [0, 1]) await expect(rows.nth(i)).toHaveAttribute('data-ride-tier', 'placed');
  await expect(rows.first()).toContainText('Reported positions · may pause');
  await expect(rows.first()).not.toContainText('Front view');
});

test('nothing qualifies: said with the count, never a stand-in bus', async ({page}) => {
  await servePatterns(page);
  await serveMotion(page);
  await noRecordings(page);
  // Every placed bus older than fresh, and the road rejected: nothing certain to ride.
  await page.route('**/data/shapes/index.json*', route => route.fulfill({json: {schemaVersion: 1,
    patterns: {'FX:256:main': {status: 'rejected', reason: 'FIXTURE: rejected', file: 'FX_256_main.json'}}}}));
  await serveLive(page, [() => journeyLive({publishedAgoSeconds: 70})]);
  await page.goto('/');
  await waitForPaint(page);
  await expect(section(page)).toHaveAttribute('data-rides', 'none', {timeout: 15_000});
  await expect(section(page).locator('[data-ride-none]')).toContainText(/None of the \d+ buses reporting suits a ride/);
  await expect(section(page).locator('button[data-ride-bus]')).toHaveCount(0);
  await expect(card(page)).toHaveCount(0);
});

test('with no live feed and no recording the section is not shown at all', async ({page}) => {
  await servePatterns(page);
  await serveMotion(page);
  await noRecordings(page);
  await serveLive(page, [() => unavailableState()]);
  await page.goto('/');
  await waitForPaint(page);
  await expect(page.locator('.follow-badge')).toContainText('NOT COLLECTING');
  await expect(section(page)).toHaveCount(0);
});
