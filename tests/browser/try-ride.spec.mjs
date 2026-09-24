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

test('three different services come first, and a row keeps its destination whole', async ({page}) => {
  await servePatterns(page);
  await serveMotion(page);
  await noRecordings(page);
  const startMs = Date.now() - 60_000;
  await serveLive(page, [() => {
    // FX-MOVING and FX-PASSED are both the 256 to Piccadilly Gardens on the evaluated road; a third
    // of the same service, and one 256 the other way on the branch (a checked road it is not on,
    // so "placed"): four candidates for three places.
    const live = movingLive({startMs});
    const passed = live.vehicles.find(v => v.vehicle === 'FX-PASSED');
    live.vehicles.push({...passed, vehicle: 'FX-THIRD', journeyRef: 'FX-THIRD'});
    live.vehicles.push({...passed, vehicle: 'FX-OTHER', journeyRef: 'FX-OTHER', destination: 'Chester_Road',
      match: {...passed.match, patternId: 'FX:256:branch', patternDestination: 'Chester Road (fixture branch)'}});
    return live;
  }]);
  await page.goto('/');
  await waitForPaint(page);
  await expect(section(page)).toHaveAttribute('data-rides', 'ready', {timeout: 15_000});
  const rows = section(page).locator('button[data-ride-bus]');
  await expect(rows).toHaveCount(3);
  // Ranked by tier alone this read three 256s to Piccadilly Gardens; the other service now comes
  // second, and the second Piccadilly bus takes the last place.
  await expect(rows.nth(0)).toContainText('to Piccadilly Gardens');
  await expect(rows.nth(1)).toContainText('to Chester Road');
  await expect(rows.nth(1)).toHaveAttribute('data-ride-tier', 'placed');
  await expect(rows.nth(2)).toContainText('to Piccadilly Gardens');
  // The destination is not cut short on a phone: the title wraps instead.
  for (const i of [0, 1, 2]) {
    const title = rows.nth(i).locator('strong');
    const clipped = await title.evaluate(el => el.scrollWidth > el.clientWidth + 1);
    expect(clipped, `row ${i} shows its whole destination`).toBe(false);
  }
});

test('the way in from the first screen: a quiet line under Buses near me opens the section', async ({page}, testInfo) => {
  await servePatterns(page);
  await serveMotion(page);
  await noRecordings(page);
  await serveLive(page, [() => journeyLive()]);
  await page.goto('/');
  await waitForPaint(page);
  const link = page.locator('[data-try-ride-link]');
  await expect(link).toBeVisible();
  await expect(link).toContainText('Or try Ride-along');
  // Finding a stop stays the primary task: the big button is Buses near me, the ride is a text line.
  const primary = page.getByRole('button', {name: 'Buses near me'});
  const [big, small] = await Promise.all([primary.boundingBox(), link.boundingBox()]);
  expect(big.height).toBeGreaterThan(small.height);
  expect(small.y).toBeGreaterThan(big.y);
  await link.click();
  await expect(section(page)).toBeInViewport({timeout: 5000});
  if (testInfo.project.name === 'mobile') await expect(page.locator('.follow')).toHaveAttribute('data-sheet', 'full');
  await expect(section(page).locator('button').first()).toBeFocused();
});

test('a ride started from the full list hands back to the map, not to the list', async ({page}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'the sheet exists on phones only');
  await servePatterns(page);
  await serveMotion(page);
  await noRecordings(page);
  await serveLive(page, [() => journeyLive()]);
  await page.goto('/');
  await waitForPaint(page);
  // The way in opens the sheet to full, and the ride starts from a row in it.
  await page.locator('[data-try-ride-link]').click();
  await expect(page.locator('.follow')).toHaveAttribute('data-sheet', 'full');
  await section(page).locator('button[data-ride-bus]').first().click();
  await expect(page.locator('.vector-map')).toHaveAttribute('data-ride', 'following', {timeout: 15_000});
  await page.getByRole('button', {name: 'Exit ride-along'}).click();
  await expect(page.locator('.vector-map')).toHaveAttribute('data-ride', 'off');
  // Found on the served site: Exit came back to the full list, over the map just returned to flat.
  await expect(page.locator('.follow')).toHaveAttribute('data-sheet', 'half');
  await expect(page.locator('.ride-launch')).toBeInViewport();
  await expect(card(page)).toHaveAttribute('data-vehicle', 'FX-COMING');
});
