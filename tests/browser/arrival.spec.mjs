// Estimated minutes on the bus card, as a passenger sees them. FIXTURE: the moving 256 on its recorded
// road, coming to Stretford Mall (Stop A), and a release file written here. The pilot is not approved
// in production (deploy/arrival-release-approval.json approves nothing), so the first check is what the
// served page does now: nothing. The rest check what a released scope would show, and every refusal.
import {test, expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {departureBoard, fixtureMainShape, movingLive, serveDepartures, serveLive, serveMotion, servePatterns, waitForPaint} from './fixtures.mjs';

const MODEL = `blended@${createHash('sha256').update(readFileSync(new URL('../../scripts/arrival-params-frozen.json', import.meta.url)))
 .digest('hex').slice(0, 12)}`;
const SCOPE = {operator: 'BNML', line: '256', direction: 'inbound', patternIds: ['FX:256:main'], model: MODEL,
 protocol: 'display-1', interval: {low: -1.15, high: 5.75, coverage: 0.81}};
const card = page => page.locator('.bus-card');
test.use({permissions: ['geolocation'], geolocation: {latitude: 53.4487, longitude: -2.3095, accuracy: 40}});

async function open(page, {release, live = {}, expectRoute = true, beforeLoad = null}) {
 await servePatterns(page);
 await serveMotion(page);
 if (beforeLoad) await beforeLoad(page);          // routes added last are matched first
 await serveDepartures(page, {board: departureBoard({nowMs: Date.now()})});
 await page.route('**/data/arrival-release.json*', route => release === null
  ? route.fulfill({status: 404, body: 'none'}) : route.fulfill({json: release}));
 const startMs = Date.now();
 await serveLive(page, [() => movingLive({startMs, ...live})]);
 await page.goto('/');
 await waitForPaint(page);
 await page.getByRole('button', {name: 'Buses near me'}).click();
 await page.locator('.nearby-stop', {hasText: 'Stop A'}).first().click();
 if (expectRoute) await expect(card(page).locator('.route-badge')).toHaveText('256');
}

test('with nothing released, or a direction released the old way, no minutes and no word about them', async ({page}) => {
 await open(page, {release: {released: ['inbound'], schemaVersion: 2, scopes: []}, live: {cadence: 40}});
 await page.waitForTimeout(3000);
 await expect(card(page).locator('.bus-card-arrival')).toHaveCount(0);
 // The timetable's own rows are still the timetable's.
 await expect(page.locator('[data-board-when]')).toContainText('no arrival minutes here yet');
});

test('a released scope shows estimated minutes, labelled, beside and apart from the timetable', async ({page}) => {
 await open(page, {release: {released: [], schemaVersion: 2, scopes: [SCOPE]}, live: {cadence: 40}});
 const line = card(page).locator('.bus-card-arrival[data-arrival-model]');
 await expect(line).toBeVisible({timeout: 20_000});
 await expect(line).toHaveAttribute('data-arrival-model', MODEL);
 await expect(line.locator('strong')).toHaveText(/^Estimated \d+–\d+ min to your stop$/);
 await expect(line).toContainText('an estimate from its reports, last');
 await expect(line).toContainText('a pilot on this service only · not a promise');
 const minutes = Number(await line.getAttribute('data-arrival'));
 expect(minutes, 'within the band the criteria were judged in').toBeGreaterThanOrEqual(2);
 expect(minutes).toBeLessThanOrEqual(10);
 // The departure board is the timetable's and says so; the estimate replaced none of it.
 await expect(page.locator('[data-board-when]')).toContainText('arrival minutes only on the service our estimate has passed its criteria for');
});

test('a released scope says why it gives no minutes: its pace not yet read, or its report too old', async ({page}) => {
 // Reports every 10 s: one publication holds a minute of them, not the three the estimator reads.
 await open(page, {release: {released: [], schemaVersion: 2, scopes: [SCOPE]}});
 const none = card(page).locator('.bus-card-arrival[data-arrival="none"]');
 await expect(none).toContainText('No estimated minutes: reading its recent pace', {timeout: 20_000});
 await expect(card(page).locator('.bus-card-arrival[data-arrival-model]')).toHaveCount(0);
});

test('a bus whose report is past the freshness limit is given no minutes anywhere', async ({page}) => {
 // 166 s old: past the 150 s limit, the page no longer counts the bus as coming to the stop at all, so
 // no card carries minutes for it (the estimator's own refusal, "too old", is held in tests/arrival.test.mjs).
 await open(page, {release: {released: [], schemaVersion: 2, scopes: [SCOPE]}, live: {cadence: 40, extraAge: 160}, expectRoute: false});
 await page.waitForTimeout(4000);
 await expect(page.locator('.bus-card-arrival[data-arrival-model]')).toHaveCount(0);
});

test('a release for another pattern or model shows nothing on this one', async ({page}) => {
 await open(page, {release: {released: [], schemaVersion: 2, scopes: [{...SCOPE, patternIds: ['FX:256:branch']}, {...SCOPE, model: 'blended@000000000000'}]},
  live: {cadence: 40}});
 await page.waitForTimeout(3000);
 await expect(card(page).locator('.bus-card-arrival')).toHaveCount(0);
});

test('a released scope whose road carries no stop mapping gives no minutes, and says why', async ({page}) => {
  // A shape from before stop mapping version 2 (docs/STOP_MAPPING.md): which stop each offset is cannot be known,
  // so the page refuses the road rather than pair its offsets with the pattern's stops by list position.
  await open(page, {release: {released: [], schemaVersion: 3, scopes: [SCOPE]}, live: {cadence: 40},
    beforeLoad: p => p.route('**/data/shapes/FX_256_main.json*', route => route.fulfill({json: fixtureMainShape({mapping: false})}))});
  const none = card(page).locator('.bus-card-arrival[data-arrival="none"]');
  await expect(none).toContainText('its checked road is not loaded, or its stops do not line up with the timetable', {timeout: 20_000});
  await expect(card(page).locator('.bus-card-arrival[data-arrival-model]')).toHaveCount(0);
});
