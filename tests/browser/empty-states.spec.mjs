// The stop page when nothing is confirmed as coming: each situation told apart, with a next step,
// and never "no buses running" from a missing report. A bus already past the stop, one on the
// other side of the road and one on an unsettled branch are listed apart, each with its reason,
// and choosing one says what it is. FIXTURE data around Stretford Mall (Stop A) in Chromium.
import {test, expect} from '@playwright/test';
import {FX, fixtureCatalogue, journeyLive, servePatterns, serveLive, unavailableState, waitForPaint} from './fixtures.mjs';

const LONGFORD_PARK = {latitude: 53.4487, longitude: -2.3095, accuracy: 40};
test.use({permissions: ['geolocation'], geolocation: LONGFORD_PARK});

const empty = page => page.locator('.waiting .empty-state');
// A claim that nothing runs. The aside "a missing report does not mean no bus is running" is the
// opposite claim and is allowed; this matches the assertion, not the denial.
const NO_BUSES_RUNNING = /no buses (are )?running|no bus running|nothing is running/i;

async function chooseStopA(page) {
  await page.goto('/');
  await waitForPaint(page);
  await page.getByRole('button', {name: 'Buses near me'}).click();
  await page.locator('.nearby-stop', {hasText: 'Stop A'}).first().click();
  await expect(page.locator('.waiting')).toBeVisible();
}
/** Stop E, Stretford Public Hall: on the main pattern only, past where the fixture branch leaves. */
async function chooseStopE(page) {
  await page.goto('/');
  await waitForPaint(page);
  const search = page.getByRole('combobox', {name: 'Stop name, street or area'});
  await search.fill('stretford public hall');
  await page.getByRole('option', {hasText: 'Stop E'}).first().click();
  await expect(page.locator('.your-stop-copy strong')).toContainText('Stretford Public Hall');
  await expect(page.locator('.waiting')).toBeVisible();
}

/** The fixture timetable plus one outbound pattern that does not call at Stop A: the other side. */
function withOppositeDirection(catalogue = fixtureCatalogue()) {
  const main = catalogue.patterns[0];
  const stops = [FX.main[10][0], FX.main[9][0], FX.main[8][0], FX.main[7][0], ...FX.branchTail.slice(0, 2)];
  catalogue.patterns.push({...main, id: 'FX:256:back', direction: 'outbound', destination: 'Longford Park (fixture)',
    stops, metres: [0, 361, 533, 827, 1100, 1400], seconds: [0, 55, 86, 132, 170, 210],
    stopCount: stops.length, stopsInArea: stops.length, lengthMetres: 1400});
  return catalogue;
}

/** A route-256 bus heading the other way, reported 36 m from Stop A, matched to the outbound pattern. */
function oppositeBus(live) {
  const model = live.vehicles.find(v => v.vehicle === 'FX-PASSED');
  return {...model, vehicle: 'FX-BACK', direction: 'outbound', journeyRef: 'FX-FX-BACK', destination: 'Longford_Park',
    lat: FX.main[6][1] + 0.0003, lon: FX.main[6][2] - 0.0002, bearing: 315, ageSeconds: 12,
    match: {...model.match, patternId: 'FX:256:back', patternIndex: 3, nearestStop: FX.main[7][0],
      metresAlongPattern: 827, metresFromPatternStop: 30, patternDirection: 'outbound',
      patternDestination: 'Longford Park (fixture)'}};
}

test('a timetabled service with no current report: said as that, never as no bus running', async ({page}) => {
  await servePatterns(page);
  await serveLive(page, [() => journeyLive({omit: ['FX-COMING', 'FX-SHARED']})]);
  await chooseStopA(page);
  await expect(empty(page)).toContainText('timetabled here today, but no bus on');
  await expect(empty(page)).toContainText('A missing report does not mean no bus is running');
  await expect(empty(page)).not.toContainText(NO_BUSES_RUNNING);
  // What is around is still counted: the one at the stop that is not coming here; the one past
  // it and the route-15 bus a kilometre away under "more".
  await expect(empty(page)).toContainText('1 reported nearby, not coming here');
  await expect(empty(page)).toContainText('2 more near your stop');
  await expect(empty(page).getByRole('button', {name: 'Choose another stop'})).toBeVisible();
  await expect(page.getByText('timetabled here today, but no bus on')).toHaveCount(1);
  // A bus already past the stop is a bus, listed under that heading, and choosing it says so.
  await empty(page).getByRole('button', {name: 'More near your stop'}).click();
  const passed = page.locator('.exploring .board-group', {hasText: 'Already past your stop'});
  await expect(passed).toBeVisible();
  await passed.locator('.follow-row').first().click();
  // Said in the timetable's terms, naming the stop: an order, not a measured departure.
  await expect(page.locator('.bus-card')).toContainText('its last report is already past Stretford Mall (Stop A)');
  await expect(page.locator('.bus-card .route-badge')).toHaveText('256');
});

test('a bus on the other side of the road is reported nearby, not coming, and says so when chosen', async ({page}) => {
  await servePatterns(page, withOppositeDirection());
  await serveLive(page, [() => { const live = journeyLive({omit: ['FX-COMING', 'FX-SHARED', 'FX-ATSTOP']}); live.vehicles.push(oppositeBus(live)); return live; }]);
  await chooseStopA(page);
  await expect(empty(page)).toContainText('timetabled here today, but no bus on');
  await expect(empty(page)).toContainText('1 reported nearby, not coming here');
  await empty(page).getByRole('button', {name: 'Buses reported nearby'}).click();
  const row = page.locator('.nearby-reports .follow-row', {hasText: 'Longford Park'});
  await expect(row).toContainText('does not call at your stop');
  await row.click();
  const card = page.locator('.bus-card');
  // Named, not generic: which stop it does not serve, and which pattern it is running instead.
  await expect(card).toContainText('It does not serve Stretford Mall (Stop A)');
  await expect(card).toContainText('running the pattern to Longford Park (fixture), which does not include your stop');
  await expect(card).toContainText('Outbound');
  await expect(card.locator('.route-badge')).toHaveText('256');
  // The stop is not lost: the way back is offered, and the mismatch is said once on the card.
  await expect(card.getByRole('button', {name: 'Back to buses for your stop'})).toBeVisible();
  await expect(card.getByText(/does not serve/)).toHaveCount(1);
});

test('only an unsettled branch: not confirmed, not "no bus", with the one that may call one tap away', async ({page}) => {
  await servePatterns(page);
  // FX-SHARED sits before the branch leaves, fitting both candidates; only the main one calls at
  // Stop E, so it "may call" there. (At Stop A both call, and it is rightly listed as coming.)
  await serveLive(page, [() => journeyLive({omit: ['FX-COMING']})]);
  await chooseStopE(page);
  await expect(empty(page)).toContainText('One bus may call here, but it is not confirmed');
  await expect(empty(page)).toContainText('cannot be settled from the position alone');
  await expect(empty(page)).not.toContainText('no bus on');
  await expect(empty(page)).not.toContainText(NO_BUSES_RUNNING);
  // Said once: the title carries it, so the count line does not repeat it.
  await expect(empty(page)).not.toContainText('may call here (branch not settled)');
  await empty(page).getByRole('button', {name: 'See the one that may call'}).click();
  await expect(page.locator('.maybe-coming .follow-row').first()).toBeInViewport();
});

test('live positions unavailable: nothing is confirmed, and no service is blamed', async ({page}) => {
  await servePatterns(page);
  await serveLive(page, [() => unavailableState()]);
  await chooseStopA(page);
  await expect(page.locator('.follow-badge')).toContainText('NOT COLLECTING');
  await expect(empty(page)).toContainText('Live positions are unavailable, so nothing can be confirmed as coming');
  await expect(empty(page)).not.toContainText('no bus on');
  await expect(empty(page).getByRole('button', {name: 'Choose another stop'})).toBeVisible();
});

test('offline: the last saved positions are shown, and the empty stop says why', async ({page}) => {
  await servePatterns(page);
  await serveLive(page, [() => journeyLive({omit: ['FX-COMING', 'FX-SHARED']})]);
  await chooseStopA(page);
  await expect(empty(page)).toContainText('timetabled here today, but no bus on');
  await page.context().setOffline(true);
  await page.getByRole('button', {name: 'Check for newer positions'}).click();
  await expect(page.locator('.follow-badge')).toContainText('OFFLINE');
  await expect(empty(page)).toContainText('You are offline, so nothing can be confirmed as coming');
  await expect(empty(page)).not.toContainText('no bus on');
  await page.context().setOffline(false);
});

test('no service timetabled today: said with the days it does run, never as no bus running', async ({page}) => {
  const catalogue = fixtureCatalogue();
  // Monday = 0 in the catalogue's week. Every pattern runs on one other day only.
  const today = (new Date().getDay() + 6) % 7, other = (today + 3) % 7;
  for (const p of catalogue.patterns) { p.operatingRules = [{days: [other]}]; p.runs = 'one other day'; }
  await servePatterns(page, catalogue);
  await serveLive(page, [() => journeyLive({omit: ['FX-COMING', 'FX-SHARED', 'FX-PASSED']})]);
  await chooseStopA(page);
  await expect(empty(page)).toContainText('No service is timetabled to call here today');
  await expect(empty(page)).toContainText('run on other days');
  await expect(empty(page)).not.toContainText(NO_BUSES_RUNNING);
  await expect(empty(page).getByRole('button', {name: 'Choose another stop'})).toBeVisible();
});
