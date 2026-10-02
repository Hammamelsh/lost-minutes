// Finding the way (1 October 2026). The owner, parked across the city from a conference, wanted the buses there and
// found the page hard to get round: "when you click on something it's hard to go back". Walked as a phone on the
// served site (scripts/probes/nav-study.mjs), 6 of 8 steps failed: the phone's Back left the site from the search's
// matches and lost a chosen plan; the main search found no places; the planner's places were listed but drawn below
// the screen ("9 places found" and nothing to pick); and with a destination and no start it showed nothing at all.
// Here: every screen is a step the phone's Back undoes, as the page's own Back does, named for where it goes; a place
// is found in the main search and planned to from here; the planner's places are on the screen and taken by a tap.
// FIXTURE positions and timetables; the place providers mocked; the stop catalogue real. Both sizes.
import {test, expect} from '@playwright/test';
import {chooseOption, departureBoard, journeyLive, onScreen, serveDepartures, servePatterns, serveLive, waitForPaint} from './fixtures.mjs';

const STOP_A = '1800SJ00811';
// Beside Stretford Mall: where the fixture's 256 starts its walk from.
const NEAR_STOP_A = {latitude: 53.4487, longitude: -2.3095, accuracy: 30};
// A venue by Sydney Street (nr), which the fixture's 256 calls at: what Photon would answer for it.
const VENUE = {features: [{properties: {name: 'Fixture Conference Centre', osm_key: 'amenity', osm_value: 'conference_centre',
  street: 'Sydney Street', city: 'Manchester', postcode: 'M32 0AA'}, geometry: {coordinates: [-2.3038, 53.4492]}}]};

async function servePlaces(page) {
  await page.route('**/api.postcodes.io/**', route => route.fulfill({json: {status: 200, result: []}}));
  await page.route('**/photon.komoot.io/**', route => {
    const q = new URL(route.request().url()).searchParams.get('q') ?? '';
    return route.fulfill({json: /conference/i.test(q) ? VENUE : {features: []}});
  });
}
async function open(page, path = '/') {
  await servePatterns(page);
  await serveLive(page, [() => journeyLive()]);
  await serveDepartures(page, {board: departureBoard({nowMs: Date.now()})});
  await servePlaces(page);
  await page.goto(path);
  await waitForPaint(page);
}
const follow = page => page.locator('.follow');
const back = page => page.locator('[data-panel-back]');
const mainSearch = page => page.locator('.follow-search input');
const seen = onScreen;

test.describe('with the device\'s location allowed', () => {
  test.use({permissions: ['geolocation'], geolocation: NEAR_STOP_A});

  test('a place found by name is planned to from here, and Back steps through each screen to the start', async ({page}, info) => {
    test.setTimeout(120_000);
    await open(page);
    await mainSearch(page).fill('conference');
    const place = page.locator('.follow-search [data-place]', {hasText: 'Fixture Conference Centre'});
    await expect(place).toBeVisible({timeout: 10_000});
    expect(await seen(place), 'the place is on the screen, not under the keyboard\'s room').toBe(true);
    await expect(page.locator('.follow-search .stop-search-group', {hasText: 'Places'})).toBeVisible();
    await page.screenshot({path: info.outputPath(`${info.project.name}-place-in-search.png`)});
    await chooseOption(place);
    // The planner, there, from here: the device's location was already allowed, so it is used without asking.
    await expect(follow(page)).toHaveAttribute('data-panel', 'plan');
    await expect(page.locator('[data-plan-to]')).toContainText('Fixture Conference Centre');
    await expect(page.locator('[data-plan-from]')).toContainText('My location', {timeout: 15_000});
    const choose = page.locator('.plan-option [data-choose-plan]').first();
    await expect(choose).toBeVisible({timeout: 30_000});
    await expect(back(page)).toHaveText('Back to the start');
    await choose.click();
    // The stop it boards at, led by the plan: where to get off and the walk on are in view.
    await expect(follow(page)).toHaveAttribute('data-panel', 'stop');
    await expect(page.locator('.your-stop-copy strong')).toContainText('Stretford Mall');
    const summary = page.locator('[data-plan-summary]');
    await expect(summary).toContainText('Fixture Conference Centre');
    await expect.poll(() => seen(summary), {message: 'the plan is in view'}).toBe(true);
    await expect(back(page)).toHaveText('Back to your options');
    await page.screenshot({path: info.outputPath(`${info.project.name}-plan-chosen.png`)});
    // The phone's Back: the options again, the places kept.
    await page.goBack();
    await expect(follow(page)).toHaveAttribute('data-panel', 'plan');
    await expect(page.locator('.plan-option').first()).toBeVisible();
    await expect(page.locator('[data-plan-to]')).toContainText('Fixture Conference Centre');
    // The page's own Back is the same step: to the start, still on the page.
    await back(page).click();
    await expect(follow(page)).toHaveAttribute('data-panel', 'home');
    expect(new URL(page.url()).pathname).toBe('/');
    // Forward goes the other way.
    await page.goForward();
    await expect(follow(page)).toHaveAttribute('data-panel', 'plan');
  });

  test('a bus\'s details and the ride are steps: Back leaves the ride, then the details, the bus still chosen', async ({page}) => {
    test.setTimeout(120_000);
    await open(page, `/?stop=${STOP_A}`);
    const row = page.locator('.waiting .follow-row').first();
    await row.click();
    await expect(follow(page)).toHaveAttribute('data-panel', 'bus');
    await expect(back(page)).toContainText('Back to Stretford Mall');
    await page.getByRole('button', {name: /^Ride along with route 256/}).click();
    await expect(page.locator('.vector-map')).toHaveAttribute('data-ride', /entering|following/, {timeout: 15_000});
    await page.goBack();
    await expect(page.locator('.vector-map')).toHaveAttribute('data-ride', 'off', {timeout: 10_000});
    await expect(follow(page)).toHaveAttribute('data-panel', 'bus');
    await page.goBack();
    await expect(follow(page)).toHaveAttribute('data-panel', 'stop');
    // Back changed what leads, not what was chosen.
    await expect(page.locator('.waiting .follow-row[aria-pressed="true"]')).toHaveCount(1);
    // A stop opened from a link has nothing of the page's own below it: Back goes to the start, not off the site.
    await expect(back(page)).toHaveText('Back to the start');
    await back(page).click();
    await expect(follow(page)).toHaveAttribute('data-panel', 'home');
  });
});

test('the search\'s matches are a step: the phone\'s Back closes them and stays; a stop chosen from them takes their place', async ({page}) => {
  await open(page);
  await mainSearch(page).fill('Stretford Mall');
  const matches = page.locator('.follow-search .stop-search-list');
  await expect(matches).toBeVisible();
  await page.goBack();
  await expect(matches).toHaveCount(0);
  expect(new URL(page.url()).pathname, 'still on the page').toBe('/');
  await expect(follow(page)).toHaveAttribute('data-panel', 'home');
  // Emptied by the passenger, the matches go with the text, and the field keeps the focus to type again.
  await mainSearch(page).click();
  await mainSearch(page).fill('');
  await expect(matches).toHaveCount(0);
  await expect(mainSearch(page)).toBeFocused();
  expect(new URL(page.url()).pathname).toBe('/');
  await mainSearch(page).fill('Stretford Mall');
  await expect(matches).toBeVisible();
  await page.goBack();
  await expect(matches).toHaveCount(0);
  // A tap on the field opens them again, with what was typed.
  await mainSearch(page).click();
  await expect(matches).toBeVisible();
  // Chosen from the matches, the stop takes their entry's place: Back from it goes to the start, not the matches.
  await page.locator('.follow-search .stop-search-option', {hasText: 'Stretford Mall'}).first().click();
  await expect(follow(page)).toHaveAttribute('data-panel', 'stop');
  await page.goBack();
  await expect(follow(page)).toHaveAttribute('data-panel', 'home');
  await expect(matches).toHaveCount(0);
});

test('with no location allowed, the planner\'s places are on the screen, and a missing start is asked for, with one tap to it', async ({page, context}) => {
  test.setTimeout(120_000);
  await open(page);
  await page.locator('[data-plan-entry]').click();
  await page.getByRole('combobox', {name: 'Destination'}).fill('conference');
  const option = page.locator('.place-search [role=option]', {hasText: 'Fixture Conference Centre'});
  await expect(option).toBeVisible({timeout: 10_000});
  // Until 1 October 2026 the list was placed against the whole panel and drawn below the screen, on both sizes.
  expect(await seen(option), 'the place is drawn on the screen').toBe(true);
  await chooseOption(option);
  const ask = page.locator('[data-plan-needs-start]');
  await expect(ask).toContainText('Where are you starting from?');
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation(NEAR_STOP_A);
  await ask.locator('[data-plan-use-location]').click();
  await expect(page.locator('[data-plan-from]')).toContainText('My location', {timeout: 15_000});
  await expect(page.locator('.plan-option').first()).toBeVisible({timeout: 30_000});
});

test('on a computer, Escape is Back: from a bus\'s details and from the planner', async ({page}, info) => {
  test.skip(info.project.name !== 'desktop', 'a keyboard\'s Escape');
  await open(page, `/?stop=${STOP_A}`);
  await page.locator('.waiting .follow-row').first().click();
  await expect(follow(page)).toHaveAttribute('data-panel', 'bus');
  await page.locator('body').press('Escape');
  await expect(follow(page)).toHaveAttribute('data-panel', 'stop');
  await page.locator('[data-plan-entry]').click();
  await expect(follow(page)).toHaveAttribute('data-panel', 'plan');
  await page.locator('body').press('Escape');
  await expect(follow(page)).toHaveAttribute('data-panel', 'stop');
});
