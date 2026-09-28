// A journey with one change, as a passenger makes it: From and To, choose the journey, follow it.
//
// FIXTURE: the 256 along its recorded road to Thomas Street, a 113 m walk to Talbot Court, the 53
// along Talbot Road to Trafford Bar. The boards are invented around the moment the test starts, the
// walking router is mocked (a short walk, or a long one that breaks the connection), and the moving
// 256 is tied to the first timetabled journey by its reported departure. Chromium, both sizes.
import {test, expect} from '@playwright/test';
import {FX, FX53, boardOrigins, connectionCatalogue, departureBoard, movingLive, serveDepartures, serveLive,
  serveMotion, servePatterns, serveScheduleAnchor, waitForPaint} from './fixtures.mjs';

const START = {postcode: FX53.start.postcode, latitude: FX53.start.latitude, longitude: FX53.start.longitude, admin_district: 'Trafford', admin_ward: 'Stretford'};
const TRAFFORD_BAR = {features: [{properties: {name: 'Trafford Bar', osm_key: 'railway', osm_value: 'station', city: 'Manchester'},
  geometry: {coordinates: [FX53.destination.lon, FX53.destination.lat]}}]};
const SALFORD_QUAYS = {features: [{properties: {name: 'Salford Quays', osm_key: 'place', osm_value: 'suburb', city: 'Salford'},
  geometry: {coordinates: [-2.2950, 53.4720]}}]};
const londonDay = ms => new Intl.DateTimeFormat('en-CA', {timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit'}).format(ms);
const wall = ms => new Intl.DateTimeFormat('en-GB', {timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false}).format(ms);

const panel = page => page.locator('.plan-panel');
const card = page => page.locator('.journey-card');
const map = page => page.locator('.vector-map');
const search = (page, label) => page.getByRole('combobox', {name: label});
const yourStop = page => page.locator('.your-stop-copy strong');

/** The fixture world: catalogue, boards timed from `now`, the moving 256 on the first journey, places and the router. */
async function serveWorld(page, {now, walk = {metres: 150, seconds: 110}, anchor, secondBus = false, direct = false} = {}) {
  const catalogue = connectionCatalogue();
  // A 99 straight from Stretford Mall (Stop A) to Trafford Bar (Stop A): a direct bus beside the change.
  if (direct) catalogue.patterns.push({...catalogue.patterns[0], id: 'FX:99:direct', line: '99', operator: 'BNML', direction: 'outbound',
    destination: 'Old Trafford', stops: [FX.stopA, FX53.stops[3][0], FX53.stops.at(-1)[0]], metres: [0, 900, 1500], seconds: [0, 180, 300],
    timings: [[0, 180, 300]], stopCount: 3, stopsInArea: 3, lengthMetres: 1500});
  await servePatterns(page, catalogue);
  if (anchor) await serveScheduleAnchor(page, anchor);
  await serveMotion(page);
  await serveDepartures(page, {boards: {
    [FX.stopA]: departureBoard({nowMs: now, atMinutes: [4, 14, 26]}),
    [FX53.board]: departureBoard({stop: FX53.board, nowMs: now, atMinutes: [9, 17, 30], line: '53', destination: 'Trafford Bar',
      operator: 'BNSM', direction: 'outbound', sequence: 0, patternId: 'FX:53:main', offset: 0}),
  }});
  const [firstDeparture] = boardOrigins({nowMs: now, atMinutes: [4], offset: 247});
  await serveLive(page, [() => {
    const live = movingLive({startMs: now, nowMs: Date.now()});
    // The moving 256 reports the first timetabled journey's own departure: the card can tie it to that row.
    live.vehicles[0].aimedDeparture = new Date(now + 4 * 60_000 - 247_000).toISOString().replace('.000Z', '+00:00');
    live.vehicles[0].match.scheduled = {departure: firstDeparture, journeys: 1, serviceDay: londonDay(now)};
    if (secondBus) live.vehicles.push({...live.vehicles[0], vehicle: 'FX-53', route: '53', operator: 'BNSM', direction: 'outbound',
      journeyRef: 'FX-53-J', destination: 'Trafford_Bar', lat: FX53.stops[0][1] - 0.0004, lon: FX53.stops[0][2] - 0.0006,
      trail: [], aimedDeparture: null, bearing: 40,
      match: {patternId: 'FX:53:main', patternIndex: 0, nearestStop: FX53.board, metresAlongPattern: 0, metresFromPatternStop: 60,
        patternDirection: 'outbound', patternDestination: 'Trafford Bar', evidence: live.vehicles[0].match.evidence}});
    return live;
  }]);
  await page.route('**/api.postcodes.io/postcodes/**', route => route.fulfill({json: {status: 200, result: START}}));
  await page.route('**/api.postcodes.io/postcodes?**', route => route.fulfill({json: {status: 200, result: [START]}}));
  await page.route('**/photon.komoot.io/**', route => {
    const q = (new URL(route.request().url()).searchParams.get('q') ?? '').toLowerCase();
    route.fulfill({json: q.includes('trafford') ? TRAFFORD_BAR : q.includes('salford') ? SALFORD_QUAYS : {features: []}});
  });
  const walks = [];
  await page.route('**/routed-foot/**', route => {
    const url = new URL(route.request().url());
    walks.push(url.pathname);
    const [a, b] = url.pathname.split('/').pop().split(';').map(p => p.split(',').map(Number));
    route.fulfill({json: {code: 'Ok', routes: [{distance: walk.metres, duration: walk.seconds,
      geometry: {type: 'LineString', coordinates: [a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 0.0002], b]}}],
      waypoints: [{distance: 2, location: a}, {distance: 3, location: b}]}});
  });
  return walks;
}

async function planIt(page, {to = 'trafford bar'} = {}) {
  await page.goto('/');
  await waitForPaint(page);
  await page.locator('[data-plan-entry]').click();
  await expect(panel(page)).toBeVisible();
  await panel(page).locator('[data-plan-from]').click();
  await search(page, 'Starting point').fill(START.postcode);
  await page.locator('.place-search [role=option]', {hasText: START.postcode}).dispatchEvent('mousedown');
  await search(page, 'Destination').fill(to);
  await page.locator('.place-search [role=option]').first().dispatchEvent('mousedown');
}

test('From and To give a journey with one change; choosing it shows one card, the stop, the times as the timetable’s, and both legs on the map', async ({page}) => {
  test.setTimeout(150_000);
  const now = Date.now();
  const walks = await serveWorld(page, {now});
  await planIt(page);
  // No direct bus reaches Trafford Bar; the 256 then the 53 does, and says where the change is.
  await expect(panel(page).locator('[data-plan-no-direct]')).toBeVisible();
  const option = panel(page).locator('.plan-option.connection');
  await expect(option).toHaveCount(1);
  await expect(option).toHaveAttribute('data-plan-connection', '256|53');
  await expect(option).toContainText('one change at Talbot Court');
  await expect(option).toContainText('Get off at Thomas Street (nr)');
  // Before it is chosen, it says when its next connection is, by the timetable: the first 256 and when
  // the 53 it makes reaches Trafford Bar (the walk provisional here, 113 m × 1.3 at 80 m/min).
  const nextLine = option.locator('[data-plan-next]');
  await expect(nextLine).toHaveAttribute('data-plan-next', 'timed');
  await expect(nextLine).toContainText(`Next: 256 ${wall(now + 4 * 60_000)} from Stretford Mall (Stop A)`);
  await expect(nextLine).toContainText(`at Trafford Bar ${wall(now + 17 * 60_000 + FX53.seconds.at(-1) * 1000)}`);
  await expect(nextLine).toContainText('by the timetable, not live');
  await option.locator('[data-choose-connection]').click();
  // One card: the steps in order, the first marked as now.
  await expect(card(page)).toHaveAttribute('data-stage', 'before');
  const steps = card(page).locator('.journey-step');
  await expect(steps).toHaveCount(3);
  await expect(steps.nth(0)).toContainText('Take the 256 towards Piccadilly Gardens');
  await expect(steps.nth(0)).toContainText('from Stretford Mall (Stop A)');
  await expect(steps.nth(0)).toContainText('get off at Thomas Street (nr) · 4 stops');
  await expect(steps.nth(0)).toHaveClass(/tone-now/);
  await expect(steps.nth(1)).toContainText('Walk to Talbot Court (nr)');
  await expect(steps.nth(2)).toContainText('Take the 53 towards Trafford Bar');
  await expect(steps.nth(2)).toContainText('get off at Trafford Bar (Stop A)');
  // The page's stop is the first boarding point, filtered to the first bus; the planner stands down.
  await expect(yourStop(page)).toContainText('Stretford Mall (Stop A)');
  await expect(page.locator('.service-chip.on')).toContainText('to Piccadilly Gardens');
  await expect(panel(page)).toHaveCount(0);
  // The walk between the stops was asked of the router once, as two stop positions, and is now checked.
  await expect(card(page).locator('[data-transfer]')).toHaveAttribute('data-transfer', 'route');
  await expect(card(page).locator('[data-transfer]')).toContainText('2 min walk');
  expect(walks.length, 'one request for the change, none for the passenger').toBe(1);
  expect(walks[0], 'from Thomas Street (rounded) to Talbot Court (the stop itself)').toMatch(/\/-2\.30*,53\.453;-2\.29832,53\.45315$/);
  // The times, and what they are: the first 256, when it reaches the change, the 53 it makes.
  await expect(card(page)).toHaveAttribute('data-timing', 'timed');
  const first = card(page).locator('.journey-row').first();
  // The board's "in 4 min" is at Stop A; Thomas Street is 183 s further by the pattern's seconds.
  await expect(first).toContainText(wall(now + 4 * 60_000));
  await expect(first).toContainText(`→ ${wall(now + 4 * 60_000 + 183_000)} at Thomas Street`);
  // Ready at +10:53 (arrival, a 110 s walk, 2 min): the 53 at +9 is gone, the +17 is the one.
  await expect(first).toContainText(wall(now + 17 * 60_000));
  await expect(first).toContainText('10 min to change');
  await expect(card(page).locator('[data-basis]')).toContainText('operators’ timetables, the checked walk and 2 min to change · not adjusted for where the buses are');
  await expect(card(page).locator('[data-basis]')).toContainText('one timetable has not been checked against its own buses');
  // The moving 256 is tied to that first journey; nothing on the 53 is claimed.
  await expect(steps.nth(0).locator('[data-tracked]')).toHaveAttribute('data-tracked', 'journey');
  await expect(steps.nth(0).locator('[data-tracked]')).toContainText(/Tracked on this journey · \d+ stops? before Stretford Mall \(Stop A\)/);
  await expect(steps.nth(2).locator('[data-tracked]')).toHaveAttribute('data-tracked', 'none');
  await expect(steps.nth(2).locator('[data-tracked]')).toContainText('No tracked bus on the 53');
  // Both legs on the map, the first on its checked road, the second stop to stop; the walk as routed.
  await expect.poll(async () => JSON.parse(await map(page).getAttribute('data-journey') ?? 'null'), {timeout: 15_000})
    .toMatchObject({legs: [{n: 1, onRoad: true}, {n: 2, onRoad: false}], transfer: 'route'});
  await expect(map(page)).toHaveAttribute('data-journey-focus', 'whole');
  // Reports arriving do not move the frame: the camera is where the choice put it, three publications later.
  await page.waitForTimeout(2000);
  const framed = await map(page).getAttribute('data-camera');
  await page.waitForTimeout(7000);
  expect(await map(page).getAttribute('data-camera'), 'no reframing on reports').toBe(framed);
  // Focus: one leg or the whole journey, on request only.
  await card(page).locator('[data-focus="second"]').click();
  await expect(map(page)).toHaveAttribute('data-journey-focus', 'second');
  await expect.poll(() => map(page).getAttribute('data-camera')).not.toBe(framed);
  await card(page).locator('[data-focus="whole"]').click();
  await expect(map(page)).toHaveAttribute('data-journey-focus', 'whole');
});

test('the stages move the page’s stop along the journey, survive a reload and a look at another bus, and the ride keeps the other leg in view', async ({page}) => {
  test.setTimeout(150_000);
  const now = Date.now();
  await serveWorld(page, {now});
  await planIt(page);
  await panel(page).locator('[data-choose-connection]').click();
  await expect(card(page)).toHaveAttribute('data-stage', 'before');
  await card(page).locator('[data-stage-to="first"]').click();
  await expect(card(page)).toHaveAttribute('data-stage', 'first');
  await expect(yourStop(page)).toContainText('Thomas Street (nr)');
  // On the first bus: getting off is the next action, the change is what follows; nothing is struck through yet.
  await expect(card(page).locator('.journey-step').nth(0)).toHaveClass(/tone-riding/);
  await expect(card(page).locator('.journey-step').nth(0)).toContainText('On the 256 towards Piccadilly Gardens');
  await expect(card(page).locator('.journey-step').nth(0).locator('.journey-next')).toContainText('get off at Thomas Street (nr)');
  await expect(card(page).locator('.journey-step').nth(1)).toHaveClass(/tone-soon/);
  // And the times are the 53's from the change, from the soonest the passenger could walk there: which
  // 256 they are on is not assumed.
  await expect(card(page).locator('.journey-times')).toHaveAttribute('data-times', 'onward-timed');
  await expect(card(page).locator('.journey-times')).toContainText('The next 53 from Talbot Court (nr), by the timetable');
  await expect(card(page).locator('[data-onward-row]')).toHaveCount(3);
  await expect(card(page).locator('[data-onward-row]').first()).toContainText(wall(now + 9 * 60_000));
  await expect(card(page).locator('.journey-row[data-row]')).toHaveCount(0);
  await card(page).locator('[data-stage-to="second"]').click();
  await expect(card(page)).toHaveAttribute('data-stage', 'second');
  // On the second bus there is nothing more to catch: no times.
  await expect(card(page).locator('.journey-times')).toHaveCount(0);
  await expect(card(page).locator('.journey-step').nth(0)).toHaveClass(/tone-done/);
  await expect(card(page).locator('.journey-step').nth(2)).toHaveClass(/tone-riding/);
  await expect(yourStop(page)).toContainText('Trafford Bar (Stop A)');
  // The 53 ends there, so nobody boards it there and no service chip filters to it: the stop is the one to get off at.
  await expect(page.locator('.service-chip.on')).toHaveCount(0);
  // A correction goes back a stage.
  await card(page).locator('[data-stage-to="first"]').click();
  await expect(card(page)).toHaveAttribute('data-stage', 'first');
  await expect(yourStop(page)).toContainText('Thomas Street (nr)');
  // A reload keeps the journey and the stage (this tab's own).
  const key = await card(page).getAttribute('data-journey');
  await page.reload();
  await waitForPaint(page);
  await expect(card(page)).toHaveAttribute('data-journey', key);
  await expect(card(page)).toHaveAttribute('data-stage', 'first');
  await expect(yourStop(page)).toContainText('Thomas Street (nr)');
  // Looking at another bus, and coming back, leaves the journey as it was.
  await card(page).locator('[data-stage-to="before"]').click();
  await expect(yourStop(page)).toContainText('Stretford Mall (Stop A)');
  await page.locator('.waiting .follow-row').first().click();
  await expect(page.locator('.follow')).toHaveAttribute('data-panel', 'bus');
  await expect(card(page)).toHaveAttribute('data-stage', 'before');
  await page.locator('[data-panel-back]').click();
  await expect(card(page)).toHaveAttribute('data-journey', key);
  // Riding the first bus: the next leg stays in view over the map, with one control to it.
  await page.getByRole('button', {name: /Ride along with route 256/}).click();
  await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 15_000});
  const next = page.locator('.ride-card .ride-next-leg');
  await expect(next).toContainText('Next bus: the 53 towards Trafford Bar from Talbot Court (nr)');
  await expect(next).toContainText(`53 at ${wall(now + 17 * 60_000)} by the timetable · no tracked bus reporting yet`);
  await next.locator('[data-switch-leg]').click();
  await expect(map(page)).toHaveAttribute('data-ride', 'off');
  await expect(map(page)).toHaveAttribute('data-journey-focus', 'second');
  await expect(card(page)).toHaveAttribute('data-journey', key);
  // End: the journey, its stop and its destination go; nothing is left to come back.
  await card(page).locator('[data-end-journey]').click();
  await expect(card(page)).toHaveCount(0);
  await expect(yourStop(page)).toHaveCount(0);
  await page.reload();
  await waitForPaint(page);
  await expect(card(page)).toHaveCount(0);
});

test('a second bus tracked on the line is said to be one, journey not identified, and the ride can switch focus to it', async ({page}) => {
  test.setTimeout(120_000);
  const now = Date.now();
  await serveWorld(page, {now, secondBus: true});
  await planIt(page);
  await panel(page).locator('[data-choose-connection]').click();
  const second = card(page).locator('.journey-step').nth(2).locator('[data-tracked]');
  await expect(second).toHaveAttribute('data-tracked', 'line');
  await expect(second).toContainText('A 53 is tracked');
  await expect(second).toContainText('which journey it is on is not identified');
  await page.getByRole('button', {name: /Ride along with route 256/}).click();
  await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 15_000});
  await page.locator('.ride-card [data-switch-leg]').click();
  // Still riding, now the 53, at the second leg, with the plan intact.
  await expect(map(page)).toHaveAttribute('data-ride', /following|entering/, {timeout: 15_000});
  await expect(page.locator('.ride-card')).toHaveAttribute('data-vehicle', 'FX-53');
  // The journey's own second bus, whichever stop the page is on: not "a selected bus that does not serve your stop".
  await expect(page.locator('.ride-card .ride-card-eyebrow')).toHaveAttribute('data-journey-leg', '2');
  await expect(page.locator('.ride-card .ride-card-eyebrow')).toHaveText('Your second bus · from Talbot Court (nr)');
  await expect(page.locator('.ride-card .ride-next-leg')).toContainText('Then: get off at Trafford Bar (Stop A)');
  await expect(page.locator('.ride-card .ride-next-leg')).toContainText('First bus: 256, reported');
  // The focus moved; the stage did not: the passenger has not said they changed buses.
  await page.getByRole('button', {name: /Exit/}).first().click();
  await expect(card(page)).toHaveAttribute('data-stage', 'before');
  await expect(map(page)).toHaveAttribute('data-journey-focus', 'second');
});

test('beside a direct bus, journeys with one change fold away under one line, and open on request', async ({page}) => {
  test.setTimeout(120_000);
  const now = Date.now();
  await serveWorld(page, {now, direct: true});
  await planIt(page);
  await expect(panel(page).locator('.plan-option:not(.connection)')).toHaveCount(1);
  await expect(panel(page).locator('.plan-option:not(.connection)')).toHaveAttribute('data-plan-option', '99');
  await expect(panel(page).locator('[data-plan-no-direct]')).toHaveCount(0);
  const folded = panel(page).locator('[data-plan-connections]');
  await expect(folded).toHaveAttribute('data-plan-connections', '1');
  await expect(folded.locator('summary')).toHaveText('Journeys with one change (1)');
  await expect(folded.locator('.plan-option.connection')).toBeHidden();
  await folded.locator('summary').click();
  await expect(folded.locator('.plan-option.connection')).toBeVisible();
  await expect(folded.locator('[data-plan-next]')).toContainText(`Next: 256 ${wall(now + 4 * 60_000)}`);
});

test('a walk the router finds long breaks the connection by the timetable: said, with the next bus offered', async ({page}) => {
  test.setTimeout(120_000);
  const now = Date.now();
  await serveWorld(page, {now, walk: {metres: 900, seconds: 720}});
  await planIt(page);
  await panel(page).locator('[data-choose-connection]').click();
  await expect(card(page).locator('[data-transfer]')).toHaveAttribute('data-transfer', 'route');
  await expect(card(page).locator('[data-transfer]')).toContainText('12 min walk');
  await expect(page.locator('[data-walk-note]')).toContainText(`The walk between the stops is 12 min by a checked route, so the ${wall(now + 17 * 60_000)} 53 cannot be reached by the timetable; the next is the ${wall(now + 30 * 60_000)}.`);
  await expect(card(page).locator('.journey-row').first()).toContainText(`${wall(now + 30 * 60_000)}`);
  await expect(card(page).locator('.journey-row').first()).toContainText('23 min to change');
  // The note is about choosing the connection: on the first bus the card's times are the 53s from the
  // change, and the note beside them would answer another question.
  await card(page).locator('[data-stage-to="first"]').click();
  await expect(card(page)).toHaveAttribute('data-stage', 'first');
  await expect(page.locator('[data-walk-note]')).toHaveCount(0);
  await card(page).locator('[data-stage-to="before"]').click();
  await expect(page.locator('[data-walk-note]')).toBeVisible();
  // Another option is one control away.
  await card(page).locator('[data-other-options]').click();
  await expect(panel(page).locator('.plan-option.connection')).toHaveCount(1);
});

test('a timetable known to run ahead of its buses gives the journey without times, and says why', async ({page}) => {
  test.setTimeout(120_000);
  const now = Date.now();
  await serveWorld(page, {now, anchor: {'FX:256:main': {verified: false, medianOffsetMinutes: 15.4,
    reason: 'schedule runs 15 min early against the bus’s own reports at its first stops'}}});
  await planIt(page);
  await panel(page).locator('[data-choose-connection]').click();
  await expect(card(page)).toHaveAttribute('data-timing', 'withheld');
  const note = card(page).locator('[data-times-withheld]');
  await expect(note).toHaveAttribute('data-times-withheld', '1');
  await expect(note).toContainText('No times for the 256: schedule runs 15 min early against the bus’s own reports at its first stops');
  await expect(card(page).locator('.journey-row')).toHaveCount(0);
  // The steps, the stop and the map are still there: it is the times that are withheld.
  await expect(card(page).locator('.journey-step')).toHaveCount(3);
  await expect(yourStop(page)).toContainText('Stretford Mall (Stop A)');
  await expect(card(page).locator('.journey-details')).toContainText('schedule runs 15 min early');
});

test('a destination none of the held timetables reaches is said to be that, not “no journey”', async ({page}) => {
  test.setTimeout(120_000);
  await serveWorld(page, {now: Date.now()});
  await planIt(page, {to: 'salford quays'});
  await expect(panel(page).locator('.plan-empty')).toContainText('No bus journey found within a 900 m walk of both places on today’s timetable, direct or with one change');
  await expect(panel(page).locator('.plan-empty')).toContainText('not proof that no journey exists');
  await expect(panel(page).locator('[data-handoff="google"]')).toBeVisible();
  await expect(panel(page).locator('.plan-option')).toHaveCount(0);
});
