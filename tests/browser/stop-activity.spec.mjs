// What a bus's own reports say about it and a stop, on the page. FIXTURE buses on a FIXTURE
// timetable over real NaPTAN stops: Sevenways "nr" (1800SJ08901) is on the fixture's south-eastbound
// pattern; Sevenways "adj" (1800SJ01061), 23 m away across the road, is north-westbound and is not.
// The fixture bus FX-COMING is reported 11 m from Sevenways nr, heading 135°, 14 s before publication.
import {test, expect} from '@playwright/test';
import {journeyLive, servePatterns, serveLive, waitForPaint} from './fixtures.mjs';

const LONGFORD_PARK = {latitude: 53.4487, longitude: -2.3095, accuracy: 40};
test.use({permissions: ['geolocation'], geolocation: LONGFORD_PARK});
const north = metres => metres / 111195;

/** journeyLive(), with FX-COMING changed as given. */
function withComing(change) {
  const live = journeyLive();
  change(live.vehicles.find(v => v.vehicle === 'FX-COMING'), live);
  return live;
}
// Three distinct reports over 24 s, each within a few metres of the others, by the stop.
const standing = () => withComing((bus, live) => {
  live.trailSources = ['a'.repeat(64), 'b'.repeat(64)];
  bus.trail = [[10_000, bus.lat - north(3), bus.lon, 135, 0], [24_000, bus.lat + north(4), bus.lon, 135, 1]];
});
// An earlier report 10 s before the current one, published twice (as a feed repeats a report that
// did not change): two observations over 10 s, not three. A trail entry is always earlier than the
// report it belongs to (`lib/live.ts` refuses one at the same time), so a repeat can only be earlier.
const repeated = () => withComing((bus, live) => {
  live.trailSources = ['a'.repeat(64)];
  bus.trail = [[10_000, bus.lat, bus.lon, 135, 0], [10_000, bus.lat, bus.lon, 135, 0]];
});
const headingAway = () => withComing(bus => { bus.bearing = 315; });

async function openStopA(page, build) {
  await servePatterns(page);
  await serveLive(page, [build]);
  await page.goto('/');
  await waitForPaint(page);
  await page.getByRole('button', {name: 'Buses near me'}).click();
  await page.locator('.nearby-stop', {hasText: 'Stop A'}).first().click();
  await expect(page.locator('article.bus-card')).toHaveAttribute('data-vehicle', 'FX-COMING', {timeout: 15_000});
}
const card = page => page.locator('article.bus-card');

test('reports standing by a stop on its route over 24 s: "appears stopped near", with each report as evidence', async ({page}) => {
  await openStopA(page, standing);
  const activity = card(page).locator('.bus-card-activity');
  await expect(activity).toContainText('Appears stopped near Sevenways');
  await activity.locator('summary').click();
  await expect(activity).toContainText('not the same as at it');
  await expect(card(page)).not.toContainText(/doors (are )?open|board now|boarding now/i);
  await card(page).locator('.bus-evidence-toggle summary').click();
  const evidence = card(page).locator('.activity-evidence');
  await expect(evidence).toContainText('Appears stopped near Sevenways');
  await expect(evidence.locator('li.counted')).toHaveCount(3);
  await expect(evidence).toContainText('Never from the estimate');
  await page.locator('.vector-map').evaluate(el => el.scrollIntoView({block: 'start'}));
  await page.getByRole('button', {name: 'Ride along with route 256'}).click();
  await expect(page.locator('.ride-card')).toContainText('Appears stopped near Sevenways');
  await page.screenshot({path: test.info().outputPath(`${test.info().project.name}-stopped-near.png`)});
});

// The finding, where the card and its evidence state it. (The evidence's rule names both levels,
// "Appears stopped" among them, so the card as a whole always contains the words.)
const finding = page => card(page).locator('.activity-evidence dd').first();

test('one current report by the stop is only "last reported near": one position cannot show standing', async ({page}) => {
  await openStopA(page, () => journeyLive());
  await expect(card(page).locator('.bus-card-activity')).toContainText('Last reported near Sevenways');
  await expect(card(page).locator('.bus-card-activity')).not.toContainText('Appears stopped');
  await expect(finding(page)).toHaveText('Last reported near Sevenways');
});

test('a report repeated with the same time counts once: not enough to say it appears stopped', async ({page}) => {
  await openStopA(page, repeated);
  await expect(card(page).locator('.bus-card-activity')).toContainText('Last reported near Sevenways');
  await expect(card(page).locator('.bus-card-activity')).not.toContainText('Appears stopped');
  await expect(finding(page)).toHaveText('Last reported near Sevenways');
  await expect(card(page).locator('.activity-reports li'), 'the repeated report is listed once').toHaveCount(2);
});

test('heading the other way to the stop’s direction of travel (as from the stop across the road): nothing is said', async ({page}) => {
  await openStopA(page, headingAway);
  await expect(card(page).locator('.bus-card-activity')).toHaveCount(0);
  await card(page).locator('.bus-evidence-toggle summary').click();
  await expect(card(page).locator('.activity-evidence')).toContainText('not the direction buses travel at Sevenways');
});

test('an old report says nothing about a stop now', async ({page}) => {
  await servePatterns(page);
  await serveLive(page, [() => journeyLive({publishedAgoSeconds: 600})]);
  await page.goto('/');
  await waitForPaint(page);
  await page.getByRole('button', {name: 'Buses near me'}).click();
  await page.locator('.nearby-stop', {hasText: 'Stop A'}).first().click();
  await page.locator('.exploring summary').click();
  await page.locator('.exploring .board-group', {hasText: 'Old reports'}).locator('.follow-row').first().click();
  await expect(card(page)).toHaveAttribute('data-selection', 'active');
  await expect(card(page).locator('.bus-card-activity')).toHaveCount(0);
});
