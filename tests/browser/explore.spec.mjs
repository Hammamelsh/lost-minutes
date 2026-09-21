// Explore a bus with the front view: an optional way in for someone with no stop in mind, from the
// latest publication's own eligibility. It lists only buses with a recent report on a road accepted
// against that service's reports, says whether the ride is estimated or reported positions, and is
// honest when nothing qualifies. Choosing one pins it and leaves the stop unchosen. FIXTURE data.
import {test, expect} from '@playwright/test';
import {FIXTURE_MOTION, journeyLive, movingLive, servePatterns, serveLive, serveMotion, unavailableState, waitForPaint} from './fixtures.mjs';

const section = page => page.locator('.explore-front');
const card = page => page.locator('#lm-bus-card');

test('lists the buses whose ride has the front view now, and choosing one explores it without a stop', async ({page}) => {
  await servePatterns(page);
  await serveMotion(page);
  await serveLive(page, [() => journeyLive()]);
  await page.goto('/');
  await waitForPaint(page);
  await expect(section(page)).toHaveAttribute('data-explore', 'ready', {timeout: 15_000});
  // FX-COMING and FX-PASSED are on the accepted, evaluated road; FX-SHARED is unsettled and is not offered.
  const rows = section(page).locator('button[data-explore-bus]');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('Estimated movement');
  await expect(rows.first()).toContainText('Front view');
  await expect(section(page)).not.toContainText('FX-SHARED');
  await expect(section(page)).toContainText('not a bus for any stop');
  await rows.first().click();
  await expect(card(page)).toHaveAttribute('data-vehicle', 'FX-COMING');
  await expect(card(page)).toHaveAttribute('data-selection', 'active');
  await expect(card(page)).toContainText('to Piccadilly Gardens');
  // Exploring, not waiting: no stop was chosen by it, and the ride's promise is on the map.
  await expect(page.locator('.your-stop.unset')).toBeVisible();
  await expect(page.locator('.vector-map-foot .ride-offer')).toHaveText('Estimated movement · Front view', {timeout: 15_000});
});

test('a checked road the model was not scored on is offered as reported positions', async ({page}) => {
  await servePatterns(page);
  await serveMotion(page, {evaluation: {...FIXTURE_MOTION, corridor: {lines: [], patterns: []}}});
  const startMs = Date.now();
  await serveLive(page, [() => movingLive({startMs})]);
  await page.goto('/');
  await waitForPaint(page);
  await expect(section(page)).toHaveAttribute('data-explore', 'ready', {timeout: 15_000});
  await expect(section(page).locator('button[data-explore-bus]').first()).toContainText('Reported positions · may pause · Front view');
});

test('nothing qualifies: said with the count, never a stand-in bus', async ({page}) => {
  await servePatterns(page);
  await serveMotion(page);
  await page.route('**/data/shapes/index.json*', route => route.fulfill({json: {schemaVersion: 1,
    patterns: {'FX:256:main': {status: 'rejected', reason: 'FIXTURE: rejected', file: 'FX_256_main.json'}}}}));
  await serveLive(page, [() => journeyLive()]);
  await page.goto('/');
  await waitForPaint(page);
  await expect(section(page)).toHaveAttribute('data-explore', 'none', {timeout: 15_000});
  await expect(section(page)).toContainText(/None of the \d+ buses reporting has a recent report on a checked road/);
  await expect(section(page).locator('button[data-explore-bus]')).toHaveCount(0);
  await expect(card(page)).toHaveCount(0);
});

test('with no live feed the section is not shown at all', async ({page}) => {
  await servePatterns(page);
  await serveMotion(page);
  await serveLive(page, [() => unavailableState()]);
  await page.goto('/');
  await waitForPaint(page);
  await expect(page.locator('.follow-badge')).toContainText('NOT COLLECTING');
  await expect(section(page)).toHaveCount(0);
});
