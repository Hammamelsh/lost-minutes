// Plan a journey: a fixed starting point (a postcode), a destination found by name, the direct
// buses the FIXTURE timetable supports between them, and what follows: Go starts the trip
// (tests/browser/trip.spec.mjs makes one); the trip survives a reload; the return is recomputed;
// New journey clears it. The two place providers are mocked
// here (postcodes.io, Photon); the stop catalogue is the real one. Chromium, both sizes.
import {test, expect} from '@playwright/test';
import {chooseOption, departureBoard, journeyLive, serveDepartures, servePatterns, serveLive, waitForPaint} from './fixtures.mjs';

const M32 = {postcode: 'M32 8LZ', latitude: 53.443649, longitude: -2.307795, admin_district: 'Trafford', admin_ward: 'Longford'};
const OLD_TRAFFORD = {features: [
  {properties: {name: 'Old Trafford', osm_key: 'leisure', osm_value: 'stadium', city: 'Manchester', postcode: 'M16 0RA'}, geometry: {coordinates: [-2.2913, 53.4631]}},
  {properties: {name: 'Old Trafford', osm_key: 'place', osm_value: 'suburb', city: 'Manchester'}, geometry: {coordinates: [-2.28, 53.455]}}]};

async function servePlaces(page, {delayPhotonFor = null} = {}) {
  await page.route('**/api.postcodes.io/postcodes/**', route => route.fulfill({json: {status: 200, result: M32}}));
  await page.route('**/api.postcodes.io/postcodes?**', route => route.fulfill({json: {status: 200, result: [M32]}}));
  await page.route('**/photon.komoot.io/**', async route => {
    const q = new URL(route.request().url()).searchParams.get('q') ?? '';
    if (delayPhotonFor && q.toLowerCase().includes(delayPhotonFor)) await new Promise(r => setTimeout(r, 1500));
    await route.fulfill({json: /old/i.test(q) ? OLD_TRAFFORD : {features: []}});
  });
}
const panel = page => page.locator('.plan-panel');
const field = (page, which) => panel(page).locator(`[data-field="${which}"]`);
const search = (page, label) => page.getByRole('combobox', {name: label});

const wall = ms => new Intl.DateTimeFormat('en-GB', {timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false}).format(ms);
// A departure after London's midnight is said as tomorrow's, as the page says it (components/plan-panel.tsx). Until
// 29 September 2026 this check expected the bare time, and failed when a gate reached it in the half hour before
// midnight: at 23:55 the fixture's bus at 00:09 was, rightly, "00:09 tomorrow".
const londonDay = ms => new Intl.DateTimeFormat('en-CA', {timeZone: 'Europe/London'}).format(ms);
const departs = (ms, now) => `${wall(ms)}${londonDay(ms) !== londonDay(now) ? ' tomorrow' : ''}`;

async function open(page, opts) {
  await servePatterns(page);
  await serveLive(page, [() => journeyLive()]);
  // Stretford Mall (Stop A)'s board: the 256 at +4, +14 and +26 minutes from the moment the check starts.
  await serveDepartures(page, {board: departureBoard({nowMs: opts?.now ?? Date.now()})});
  await servePlaces(page, opts);
  await page.goto('/');
  await waitForPaint(page);
  await page.locator('[data-plan-entry]').click();
  await expect(page.locator('.plan-panel')).toBeVisible();
}

test('a fixed start and a destination give the direct bus in one look, with its legs one tap away; Go starts the trip from the boarding stop', async ({page}) => {
  test.setTimeout(150_000); // the phone profile runs the same journey slower
  const now = Date.now();
  await open(page, {now});
  // No location permission was given: planning works from a postcode.
  await field(page, 'from').locator('[data-plan-from]').click();
  await search(page, 'Starting point').fill('M32 8LZ');
  const options = page.locator('.place-search [role=option]');
  await expect(options.filter({hasText: 'M32 8LZ'})).toHaveCount(1);
  await expect(options.first(), 'My location is offered first, never taken').toContainText('My location');
  await chooseOption(options.filter({hasText: 'M32 8LZ'}));
  await expect(field(page, 'from')).toContainText('M32 8LZ');
  await expect(field(page, 'from')).toContainText('a fixed starting point, not this device');
  await expect(page.locator('.legend-you')).toHaveText('Starting point');
  await search(page, 'Destination').fill('sydney street');
  await chooseOption(page.locator('.place-search [role=option]', {hasText: 'Sydney Street'}).first());
  await expect(field(page, 'to')).toContainText('Sydney Street');
  const option = panel(page).locator('.plan-option').first();
  await expect(option).toContainText('256');
  await expect(option).toContainText('towards Piccadilly Gardens');
  await expect(option.locator('.plan-legs li').nth(0)).toContainText(/Walk about \d+0 m \(straight line; about \d+ min on foot, estimated\) to Stretford Mall \(Stop A\)/);
  await expect(option.locator('.plan-legs li').nth(2)).toContainText('Get off at Sydney Street');
  await expect(option).toContainText('Tracked: the nearest bus between these stops is');
  // A tracked bus is still placed by its report, never given minutes to arrive, and its age is worded
  // as everywhere else on the page (a real report's age has a fraction: "52.442 s" was served).
  await expect(option).toContainText('No arrival minutes: it is placed by its last report');
  await expect(option.locator('.plan-tracked')).toContainText(/before your boarding stop, reported \d+s ago/);
  // The next bus is the timetable's, said to be, and one the passenger can walk to the stop for:
  // worked out here from the walk the option states (straight line × 1.3 at 80 m a minute).
  const walked = Number(/Walk about (\d+) m/.exec(await option.locator('.plan-legs li').nth(0).textContent())[1]);
  const walkMinutes = walked * 1.3 / 80;
  // The page timed it at some moment since the check began; the bus it can reach must not depend on which.
  const reachableAt = elapsedMinutes => [4, 14, 26].find(m => m >= elapsedMinutes + (walkMinutes < 1 ? -1 : walkMinutes));
  const reachable = reachableAt(0);
  expect(reachableAt((Date.now() - now) / 60_000), 'the fixture sits on a boundary: move its departures').toBe(reachable);
  await expect(option.locator('[data-plan-next]')).toHaveAttribute('data-plan-next', 'timed');
  await expect(option.locator('[data-plan-next]')).toContainText(`256 ${departs(now + reachable * 60_000, now)} from Stretford Mall (Stop A)`);
  await expect(option.locator('[data-plan-next]')).toContainText(/^Leave (now|in \d+ min|at \d\d:\d\d( tomorrow)?) · /);
  // In one look: walk, the bus, walk; when to set off and when it gets there; Go. The legs are folded under it.
  await expect(option.locator('[data-plan-strip]')).toHaveAttribute('aria-label', /^walk \d+ min, then bus 256/);
  await expect(option.locator('[data-plan-when]')).toContainText(/\d\d:\d\d – \d\d:\d\d/);
  await expect(option.locator('.plan-legs')).toBeHidden();
  await expect(option.locator('[data-plan-next]')).toContainText('by the timetable, not live');
  await expect(panel(page).locator('[data-handoff="google"]')).toHaveAttribute('href', /travelmode=transit/);
  await expect(panel(page).locator('[data-handoff="bee"]')).toContainText('does not take the places from a link');
  expect(await page.evaluate(() => location.search)).toMatch(/to=53\.4488/);
  expect(await page.evaluate(() => location.search)).toMatch(/from=53\.4436/);
  await option.locator('[data-choose-plan]').click();
  await expect(page.locator('.follow')).toHaveAttribute('data-panel', 'trip');
  await expect(page.locator('.trip .trip-title')).toHaveText('Walk to Stretford Mall (Stop A)');
  await expect(page.locator('.trip [data-trip-step-link]').nth(2)).toHaveText(/^Get off at Sydney Street/);
  // From a fixed start the distance is from it, said to be; this device's location is not asked for.
  await expect(page.locator('.trip [data-trip-here]')).toContainText(/^From M32 8LZ: \d+ m in a straight line\.$/);
  // The stop's own board, filtered to the bus, is one tap away once at the stop.
  await page.locator('.trip [data-trip-next]').click();
  await page.locator('.trip [data-trip-stop]').click();
  await expect(page.locator('.your-stop-copy strong')).toContainText('Stretford Mall (Stop A)');
  await expect(page.locator('.waiting .section-head')).toContainText('256 to Piccadilly Gardens');
  await page.locator('[data-trip-resume]').click();
  // A reload keeps the trip at its step, and the destination and the start (this tab's own).
  await page.reload();
  await waitForPaint(page);
  await expect(page.locator('.trip')).toHaveAttribute('data-trip-step', 'wait', {timeout: 30_000});
  await page.locator('[data-trip-end]').click();
  await expect(page.locator('.trip')).toHaveCount(0);
});

test('a place with namesakes is shown with what tells them apart, and nothing is chosen until it is picked', async ({page}) => {
  await open(page);
  await search(page, 'Destination').fill('old trafford');
  // Our own stops named Old Trafford come first (they can be boarded at), then the two places
  // from OpenStreetMap, each with what tells it from the other.
  const options = page.locator('.place-search [role=option]');
  await expect(page.locator('.place-search .stop-search-group')).toHaveText(['Bus stops', 'Addresses and places']);
  await expect(options.filter({hasText: 'stadium · Manchester · M16 0RA'})).toHaveCount(1);
  await expect(options.filter({hasText: 'suburb · Manchester'})).toHaveCount(1);
  await expect(panel(page)).toHaveAttribute('data-plan', 'empty');
  await expect(page.locator('.plan-panel .stop-search-status')).toContainText('pick one to confirm it');
});

test('a late answer for the previous destination never shows: the results are the newer query’s', async ({page}) => {
  await open(page, {delayPhotonFor: 'old'});
  const box = search(page, 'Destination');
  await box.fill('old trafford');
  await page.waitForTimeout(400);
  await box.fill('stretford public hall');
  await expect(page.locator('.place-search [role=option]').first()).toContainText('Stretford Public Hall', {timeout: 5000});
  await page.waitForTimeout(2000);
  await expect(page.locator('.place-search [role=option]', {hasText: 'Old Trafford'})).toHaveCount(0);
});

test('the return is recomputed from the places, sharing says what is shared, and New journey clears the plan but not a saved stop', async ({page}) => {
  test.setTimeout(150_000); // the phone profile runs the same journey slower
  await open(page);
  await field(page, 'from').locator('[data-plan-from]').click();
  await search(page, 'Starting point').fill('M32 8LZ');
  await chooseOption(page.locator('.place-search [role=option]', {hasText: 'M32 8LZ'}));
  await search(page, 'Destination').fill('sydney street');
  await chooseOption(page.locator('.place-search [role=option]', {hasText: 'Sydney Street'}).first());
  // The main pattern first (the best walks); the fixture branch may offer a second, worse, option.
  await expect(panel(page).locator('.plan-option').first()).toContainText('towards Piccadilly Gardens');
  // Go, then back to the options and a new destination: the trip goes with the old one.
  await panel(page).locator('.plan-option [data-choose-plan]').first().click();
  await expect(page.locator('.follow')).toHaveAttribute('data-panel', 'trip');
  await page.locator('[data-panel-back]').click();
  await expect(panel(page).locator('[data-plan-resume]')).toBeVisible();
  await page.locator('[data-clear-plan]').click();
  await expect(panel(page).locator('[data-plan-resume]')).toHaveCount(0);
  await expect(panel(page).locator('.plan-option')).toHaveCount(0);
  await search(page, 'Destination').fill('sydney street');
  await chooseOption(page.locator('.place-search [role=option]', {hasText: 'Sydney Street'}).first());
  const choose = panel(page).locator('.plan-option [data-choose-plan]');
  await expect(choose.first()).toBeVisible();
  // The return: the fixture has no outbound pattern, so the answer is honest and the planners remain.
  await panel(page).getByRole('button', {name: 'Plan the return'}).click();
  await expect(field(page, 'from')).toContainText('Sydney Street');
  await expect(field(page, 'to')).toContainText('M32 8LZ');
  await expect(panel(page).locator('.plan-empty')).toContainText('No bus journey found within a 900 m walk of both places on today’s timetable, direct or with one change');
  await expect(panel(page).locator('[data-handoff="google"]')).toHaveAttribute('href', /origin=53\.4488/);
  // A saved stop survives New journey; the plan does not.
  await search(page, 'Stop, bus number or place').first().fill('stretford mall');
  await chooseOption(page.locator('.stop-search-option').first());
  await page.getByRole('button', {name: 'Save this stop'}).click();
  await page.getByRole('button', {name: /New journey/}).click();
  await expect(page.locator('.saved .stop-chip', {hasText: 'Stretford Mall'})).toBeVisible();
  await expect(panel(page), 'New journey closes the planner with everything else').toHaveCount(0);
  expect(await page.evaluate(() => location.search)).toBe('');
  await page.locator('[data-plan-entry]').click();
  await expect(panel(page), 'and nothing was carried over into it').toHaveAttribute('data-plan', 'empty');
});
