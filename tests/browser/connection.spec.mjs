// A journey with one change, as a passenger makes it: From and To, choose the journey, and make it a step at a time
// (components/trip-view.tsx, 4 October 2026; until then one journey card beside the stop's board).
//
// FIXTURE: the 256 along its recorded road to Thomas Street, a 113 m walk to Talbot Court, the 53
// along Talbot Road to Trafford Bar. The boards are invented around the moment the test starts, the
// walking router is mocked (a short walk, or a long one that breaks the connection, answered at once
// or late), and the moving 256 is tied to the first timetabled journey by its reported departure.
// Chromium, both sizes.
import {test, expect} from '@playwright/test';
import {FIXTURE_STOP_OFFSETS, FX, FX53, chooseOption, boardOrigins, connectionCatalogue, departureBoard, fastConfig, movingLive, serveDepartures, serveLive,
  serveMotion, servePatterns, serveScheduleAnchor, waitForPaint} from './fixtures.mjs';

const START = {postcode: FX53.start.postcode, latitude: FX53.start.latitude, longitude: FX53.start.longitude, admin_district: 'Trafford', admin_ward: 'Stretford'};
const TRAFFORD_BAR = {features: [{properties: {name: 'Trafford Bar', osm_key: 'railway', osm_value: 'station', city: 'Manchester'},
  geometry: {coordinates: [FX53.destination.lon, FX53.destination.lat]}}]};
const SALFORD_QUAYS = {features: [{properties: {name: 'Salford Quays', osm_key: 'place', osm_value: 'suburb', city: 'Salford'},
  geometry: {coordinates: [-2.2950, 53.4720]}}]};
const londonDay = ms => new Intl.DateTimeFormat('en-CA', {timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit'}).format(ms);
const wall = ms => new Intl.DateTimeFormat('en-GB', {timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false}).format(ms);
// A time after London's midnight is said as tomorrow's by the planner's list (lib/departures.ts, clockOn). Until
// 29 September 2026 these checks expected the bare time and could fail in a gate's last half hour before midnight.
const departs = (ms, now) => `${wall(ms)}${londonDay(ms) !== londonDay(now) ? ' tomorrow' : ''}`;

const panel = page => page.locator('.plan-panel');
const trip = page => page.locator('.trip');
const map = page => page.locator('.vector-map');
const search = (page, label) => page.getByRole('combobox', {name: label});
const yourStop = page => page.locator('.your-stop-copy strong');
const step = page => trip(page).locator('.trip-title');

/** The fixture world: catalogue, boards timed from `now`, the moving 256 on the first journey, places and the router. */
async function serveWorld(page, {now, walk = {metres: 150, seconds: 110}, walkDelayMs = 0, routerTimeoutSeconds = null, anchor,
                                  secondBus = false, direct = null, startS = undefined} = {}) {
  const catalogue = connectionCatalogue();
  // A 99 straight from Stretford Mall (Stop A) to Trafford Bar (Stop A), five minutes' ride: a direct
  // bus beside the change, leaving Stop A at `direct` minutes from now.
  if (direct) catalogue.patterns.push({...catalogue.patterns[0], id: 'FX:99:direct', line: '99', operator: 'BNML', direction: 'outbound',
    destination: 'Old Trafford', stops: [FX.stopA, FX53.stops[3][0], FX53.stops.at(-1)[0]], metres: [0, 900, 1500], seconds: [0, 180, 300],
    timings: [[0, 180, 300]], stopCount: 3, stopsInArea: 3, lengthMetres: 1500});
  await servePatterns(page, catalogue);
  if (anchor) await serveScheduleAnchor(page, anchor);
  await serveMotion(page);
  const stopA = departureBoard({nowMs: now, atMinutes: [4, 14, 26]});
  if (direct) stopA.services.push(...departureBoard({nowMs: now, atMinutes: direct, line: '99', destination: 'Old Trafford',
    direction: 'outbound', sequence: 0, patternId: 'FX:99:direct', offset: 0}).services);
  await serveDepartures(page, {boards: {
    [FX.stopA]: stopA,
    [FX53.board]: departureBoard({stop: FX53.board, nowMs: now, atMinutes: [9, 17, 30], line: '53', destination: 'Trafford Bar',
      operator: 'BNSM', direction: 'outbound', sequence: 0, patternId: 'FX:53:main', offset: 0}),
  }});
  const [firstDeparture] = boardOrigins({nowMs: now, atMinutes: [4], offset: 247});
  await serveLive(page, [() => {
    const live = movingLive({startMs: now, nowMs: Date.now(), ...(startS === undefined ? {} : {startS})});
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
  // The router's time limit is runtime configuration (8 s by default); a check of an answer that comes
  // after the list's 6 s wait sets it longer, so that the order of events is certain, not a race.
  if (routerTimeoutSeconds) await page.route('**/data/config.json*', route => route.fulfill({json: {...fastConfig(),
    walking: {provider: 'osrm', baseUrl: 'https://routing.openstreetmap.de/routed-foot', profile: 'foot', name: 'routing.openstreetmap.de',
      operator: 'FOSSGIS e.V.', attribution: 'Walking route: OSRM foot profile on routing.openstreetmap.de (FOSSGIS e.V.), OpenStreetMap data',
      maxStraightLineMetres: 3000, minSecondsBetweenRequests: 10, timeoutSeconds: routerTimeoutSeconds, inaccurateMetres: 200}}}));
  await page.route('**/api.postcodes.io/postcodes/**', route => route.fulfill({json: {status: 200, result: START}}));
  await page.route('**/api.postcodes.io/postcodes?**', route => route.fulfill({json: {status: 200, result: [START]}}));
  await page.route('**/photon.komoot.io/**', route => {
    const q = (new URL(route.request().url()).searchParams.get('q') ?? '').toLowerCase();
    route.fulfill({json: q.includes('trafford') ? TRAFFORD_BAR : q.includes('salford') ? SALFORD_QUAYS : {features: []}});
  });
  const walks = [];
  await page.route('**/routed-foot/**', async route => {
    const url = new URL(route.request().url());
    walks.push(url.pathname);
    if (walkDelayMs) await new Promise(resolve => setTimeout(resolve, walkDelayMs));
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
  await chooseOption(page.locator('.place-search [role=option]', {hasText: START.postcode}));
  await search(page, 'Destination').fill(to);
  await chooseOption(page.locator('.place-search [role=option]').first());
}

test('From and To give a journey with one change; Go starts it: one step at a time, the times as the timetable’s, both legs on the map', async ({page}, info) => {
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
  await expect(option.locator('[data-plan-strip]')).toHaveAttribute('aria-label', /^walk \d+ min, then bus 256, then walk 2 min, then bus 53/);
  await expect(option.locator('.plan-legs')).toContainText('Get off at Thomas Street (nr)');
  // The walk between the stops was checked before the list was shown, and the list says so.
  await expect(option.locator('[data-transfer-walk]')).toHaveAttribute('data-transfer-walk', 'checked');
  await expect(option.locator('[data-transfer-walk]')).toContainText('(2 min, about 150 m, a checked route)');
  // Before it is chosen, it says when its next connection is, by the timetable: the first 256 and the 53 it makes,
  // and when that reaches Trafford Bar, with that checked walk (110 s) and 2 min to change.
  const nextLine = option.locator('[data-plan-next]');
  await expect(nextLine).toHaveAttribute('data-plan-next', 'timed');
  await expect(nextLine).toContainText(`256 ${departs(now + 4 * 60_000, now)} from Stretford Mall (Stop A)`);
  await expect(nextLine).toContainText(`then 53 ${departs(now + 17 * 60_000, now)}`);
  await expect(nextLine).toContainText(`at Trafford Bar ${wall(now + 17 * 60_000 + FX53.seconds.at(-1) * 1000)}`);
  await expect(nextLine).toContainText('by the timetable, not live');
  await option.locator('[data-choose-connection]').click();
  // A trip, its steps in order, the first now; the planner stands down, its options one step back.
  await expect(page.locator('.follow')).toHaveAttribute('data-panel', 'trip');
  await expect(trip(page)).toHaveAttribute('data-trip-step', 'walk');
  await expect(step(page)).toHaveText('Walk to Stretford Mall (Stop A)');
  await expect(trip(page).locator('[data-trip-step-link]')).toHaveText(['Walk to Stretford Mall (Stop A)',
    'Board the 256 towards Piccadilly Gardens at Stretford Mall (Stop A)', 'Get off at Thomas Street (nr)', 'Walk to Talbot Court (nr) to change',
    'Board the 53 towards Trafford Bar at Talbot Court (nr)', 'Get off at Trafford Bar (Stop A)', 'Walk to Trafford Bar (Stop A)']);
  await expect(panel(page)).toHaveCount(0);
  await expect(page.locator('[data-panel-back]')).toHaveText('Back to your options');
  // When to leave for the chosen first bus, and when the 53 it makes gets there, by the timetable.
  await expect(trip(page).locator('[data-trip-leave]')).toContainText(`for the 256 at ${departs(now + 4 * 60_000, now)}`);
  await expect(trip(page).locator('.trip-head')).toContainText('arrive about');
  // Both legs on the map, the first on its checked road, the second stop to stop; the walk as routed.
  await expect.poll(async () => JSON.parse(await map(page).getAttribute('data-journey') ?? 'null'), {timeout: 15_000})
    .toMatchObject({legs: [{n: 1, onRoad: true}, {n: 2, onRoad: false}], transfer: 'route'});
  await expect(map(page)).toHaveAttribute('data-journey-focus', 'whole');
  // Reports arriving do not move the frame: the camera is where the step put it, three publications later.
  await page.waitForTimeout(2000);
  const framed = await map(page).getAttribute('data-camera');
  await page.waitForTimeout(7000);
  expect(await map(page).getAttribute('data-camera'), 'no reframing on reports').toBe(framed);
  // The whole trip on request.
  await trip(page).locator('[data-trip-all] summary').click();
  await trip(page).locator('[data-trip-whole]').click();
  await expect(map(page)).toHaveAttribute('data-frame', /\|whole$/);
  await expect.poll(() => map(page).getAttribute('data-camera')).not.toBe(framed);
  // How the times are known, in the folded list of steps.
  await expect(trip(page).locator('[data-basis]')).toContainText('operators’ timetables, the checked walk and 2 min to change · not adjusted for where the buses are');
  await expect(trip(page).locator('[data-basis]')).toContainText('one timetable has not been checked against its own buses');
  // At the stop: the connection chosen, which holds; and the moving 256 tied to its first journey; nothing on the 53.
  await trip(page).locator('[data-trip-next]').click();
  await expect(trip(page)).toHaveAttribute('data-trip-step', 'wait');
  const chosen = trip(page).locator('[data-chosen]');
  await expect(chosen).toContainText(`256${departs(now + 4 * 60_000, now)}`);
  await expect(chosen).toContainText(`53${departs(now + 17 * 60_000, now)}`);
  // Ready at +10:53 (arrival at the change, a 110 s walk, 2 min): the 53 at +9 is gone, the +17 is the one.
  await expect(chosen).toContainText('10 min to change');
  await expect(trip(page).locator('[data-change]')).toHaveCount(0);
  await expect(trip(page).locator('[data-trip-coming="BNML|FX-MOVING"]')).toContainText(/On your connection · \d+ stops? away/);
  await page.screenshot({path: info.outputPath(`${info.project.name}-wait-connection.png`)});
  // The page's stop is the first boarding point, filtered to the first bus: one tap to its own board.
  await trip(page).locator('[data-trip-stop]').click();
  await expect(yourStop(page)).toContainText('Stretford Mall (Stop A)');
  await expect(page.locator('.service-chip.on')).toContainText('to Piccadilly Gardens');
  await page.locator('[data-panel-back]').click();
  await expect(trip(page)).toHaveAttribute('data-trip-step', 'wait');
  // On the first bus (whichever it was, or one not listed), then off at the change: the walk between
  // the stops is the list's own answer, never asked again, and nothing about the passenger was sent.
  await trip(page).locator('[data-trip-board]').click();
  const asked = trip(page).locator('[data-trip-ask]');
  if (await asked.count()) await asked.locator('[data-trip-candidate="none"]').click();
  await expect(trip(page)).toHaveAttribute('data-trip-step', 'ride');
  await trip(page).locator('[data-trip-next]').click();
  await expect(trip(page)).toHaveAttribute('data-trip-step', 'change');
  await expect(step(page)).toHaveText('Walk to Talbot Court (nr)');
  await expect(trip(page).locator('[data-transfer]')).toHaveAttribute('data-transfer', 'route');
  await expect(trip(page).locator('[data-transfer]')).toContainText('2 min · 150 m, a walking route');
  expect(walks.length, 'one request for the change, none for the passenger').toBe(1);
  await page.screenshot({path: info.outputPath(`${info.project.name}-change.png`)});
  expect(walks[0], 'from Thomas Street (rounded) to Talbot Court (the stop itself)').toMatch(/\/-2\.30*,53\.453;-2\.29832,53\.45315$/);
  // At the second stop: the 53's next by the timetable, from the stop itself; no tracked 53 is claimed.
  await trip(page).locator('[data-trip-next]').click();
  await expect(trip(page)).toHaveAttribute('data-trip-step', 'wait');
  await expect(step(page)).toHaveText('Wait at Talbot Court (nr)');
  await expect(trip(page).locator('[data-trip-departure]').first()).toContainText(departs(now + 9 * 60_000, now));
  await expect(trip(page).locator('[data-trip-coming]')).toHaveAttribute('data-trip-coming', 'none');
  await expect(trip(page).locator('[data-trip-coming]')).toContainText('No 53 is reporting on its way here');
  await page.screenshot({path: info.outputPath(`${info.project.name}-wait-second.png`)});
});

test('the steps move the page’s stop along the journey, survive a reload and a look at another bus, and the ride keeps the other leg in view', async ({page}) => {
  test.setTimeout(150_000);
  const now = Date.now();
  // The moving 256 a stop before Stretford Mall: one of the buses a passenger at the stop may have boarded.
  await serveWorld(page, {now, startS: FIXTURE_STOP_OFFSETS[5]});
  await planIt(page);
  await panel(page).locator('[data-choose-connection]').click();
  await trip(page).locator('[data-trip-next]').click();
  await expect(trip(page)).toHaveAttribute('data-trip-step', 'wait');
  // A look at another bus from the stop's own board, and back to the trip in one tap.
  await trip(page).locator('[data-trip-stop]').click();
  await page.locator('.waiting .follow-row').first().click();
  await expect(page.locator('.follow')).toHaveAttribute('data-panel', 'bus');
  await page.locator('[data-trip-resume]').click();
  await expect(page.locator('.follow')).toHaveAttribute('data-panel', 'trip');
  await expect(trip(page)).toHaveAttribute('data-trip-step', 'wait');
  // On the first bus: the page asks which, and follows the one chosen; the 53's times from the change follow it.
  await trip(page).locator('[data-trip-board]').click();
  const ask = trip(page).locator('[data-trip-ask]');
  if (await ask.count()) await ask.locator('[data-trip-candidate="BNML|FX-MOVING"]').click();
  await expect(trip(page)).toHaveAttribute('data-trip-step', 'ride');
  await expect(page.locator('.follow')).toHaveAttribute('data-journey-plan', /\|first$/);
  await expect(map(page)).toHaveAttribute('data-selected-key', 'BNML|FX-MOVING');
  await expect(step(page)).toContainText('Get off at Thomas Street (nr)');
  const onward = trip(page).locator('[data-trip-next-leg]');
  await expect(onward).toContainText('Then the 53 towards Trafford Bar from Talbot Court (nr)');
  await expect(onward.locator('[data-trip-departure]')).toHaveCount(3);
  await expect(onward.locator('[data-trip-departure]').first()).toContainText(departs(now + 9 * 60_000, now));
  // A reload keeps the trip, the step and the bus (this tab's own).
  const key = await page.locator('.follow').getAttribute('data-trip');
  await page.reload();
  await waitForPaint(page);
  await expect(page.locator('.follow')).toHaveAttribute('data-trip', key, {timeout: 30_000});
  await expect(trip(page)).toHaveAttribute('data-trip-step', 'ride');
  await expect(map(page)).toHaveAttribute('data-selected-key', 'BNML|FX-MOVING', {timeout: 20_000});
  // Riding along with the first bus: the stop to get off at, and the next leg, stay in view over the map.
  await trip(page).locator('[data-trip-ride]').click();
  await expect(map(page)).toHaveAttribute('data-ride', /entering|following/, {timeout: 15_000});
  await expect(page.locator('.ride-card [data-ride-trip]')).toContainText('Get off at Thomas Street (nr)');
  const next = page.locator('.ride-card .ride-next-leg');
  await expect(next).toContainText('Then walk to Talbot Court (nr), take the 53 towards Trafford Bar');
  await expect(next).toContainText(`53 at ${wall(now + 9 * 60_000)}`);
  await expect(next).toContainText('no tracked bus reporting yet');
  await next.locator('[data-switch-leg]').click();
  await expect(map(page)).toHaveAttribute('data-ride', 'off');
  await expect(map(page)).toHaveAttribute('data-journey-focus', 'second');
  await expect(trip(page)).toHaveAttribute('data-trip-step', 'ride');
  // Off at the change, then a correction back a step: the stage follows the passenger's word.
  await trip(page).locator('[data-trip-next]').click();
  await expect(trip(page)).toHaveAttribute('data-trip-step', 'change');
  await trip(page).locator('[data-trip-next]').click();
  await trip(page).locator('[data-trip-board]').click();
  await expect(trip(page)).toHaveAttribute('data-trip-step', 'ride');
  await expect(page.locator('.follow')).toHaveAttribute('data-journey-plan', /\|second$/);
  await expect(step(page)).toContainText('Get off at Trafford Bar (Stop A)');
  await trip(page).locator('[data-trip-prev]').click();
  await expect(page.locator('.follow')).toHaveAttribute('data-journey-plan', /\|first$/);
  // End: the trip, its stop and its destination go; nothing is left to come back.
  await page.locator('[data-trip-end]').click();
  await expect(trip(page)).toHaveCount(0);
  await expect(yourStop(page)).toHaveCount(0);
  await page.reload();
  await waitForPaint(page);
  await expect(trip(page)).toHaveCount(0);
});

test('a second bus tracked on the line is said to be at its stop, and the ride can switch focus to it and back', async ({page}) => {
  test.setTimeout(120_000);
  const now = Date.now();
  await serveWorld(page, {now, secondBus: true, startS: FIXTURE_STOP_OFFSETS[5]});
  await planIt(page);
  await panel(page).locator('[data-choose-connection]').click();
  await trip(page).locator('[data-trip-next]').click();
  await trip(page).locator('[data-trip-board]').click();
  const ask = trip(page).locator('[data-trip-ask]');
  if (await ask.count()) await ask.locator('[data-trip-candidate="BNML|FX-MOVING"]').click();
  await expect(trip(page)).toHaveAttribute('data-trip-step', 'ride');
  await trip(page).locator('[data-trip-ride]').click();
  await expect(map(page)).toHaveAttribute('data-ride', /entering|following/, {timeout: 15_000});
  await page.locator('.ride-card [data-switch-leg]').click();
  // Still riding, now the 53, with the plan intact: the journey's own second bus, not a bus that does not serve the stop.
  await expect(map(page)).toHaveAttribute('data-ride', /following|entering/, {timeout: 15_000});
  await expect(page.locator('.ride-card')).toHaveAttribute('data-vehicle', 'FX-53');
  await expect(page.locator('.ride-card .ride-card-eyebrow')).toHaveAttribute('data-journey-leg', '2');
  await expect(page.locator('.ride-card .ride-card-eyebrow')).toHaveText('Your second bus · from Talbot Court (nr)');
  await expect(page.locator('.ride-card .ride-next-leg')).toContainText('Then: get off at Trafford Bar (Stop A)');
  await expect(page.locator('.ride-card .ride-next-leg')).toContainText('First bus: 256, reported');
  // The focus moved; the step did not: the passenger has not said they changed buses. Leaving the ride, the bus they
  // boarded is followed again, and at the second stop the 53 is said to be there.
  await page.getByRole('button', {name: /Exit/}).first().click();
  await expect(trip(page)).toHaveAttribute('data-trip-step', 'ride');
  await expect(map(page)).toHaveAttribute('data-selected-key', 'BNML|FX-MOVING');
  await trip(page).locator('[data-trip-next]').click();
  await trip(page).locator('[data-trip-next]').click();
  await expect(step(page)).toHaveText('Wait at Talbot Court (nr)');
  await expect(trip(page).locator('[data-trip-coming="BNSM|FX-53"]')).toContainText('at this stop by its last report');
});

test('beside a direct bus that gets there sooner, journeys with one change fold away under one line, and open on request', async ({page}) => {
  test.setTimeout(120_000);
  const now = Date.now();
  await serveWorld(page, {now, direct: [5, 20, 35]});
  await planIt(page);
  const direct = panel(page).locator('.plan-option:not(.connection)');
  await expect(direct).toHaveCount(1);
  await expect(direct).toHaveAttribute('data-plan-option', '99');
  // Timed from its own stop's board, as the journeys with one change are: the 99 at +5 is there at +10.
  await expect(direct.locator('[data-plan-next]')).toHaveAttribute('data-plan-next', 'timed');
  await expect(direct.locator('[data-plan-next]')).toContainText(`99 ${departs(now + 5 * 60_000, now)} from Stretford Mall (Stop A)`);
  await expect(direct.locator('[data-plan-next]')).toContainText(wall(now + 10 * 60_000));
  await expect(panel(page).locator('[data-plan-no-direct]')).toHaveCount(0);
  await expect(panel(page).locator('[data-plan-change-first]')).toHaveCount(0);
  const folded = panel(page).locator('[data-plan-connections]');
  await expect(folded).toHaveAttribute('data-plan-connections', '1');
  // The fold says when its soonest gets there: the 53 at +17 reaches Trafford Bar at +23, and a short walk on.
  await expect(folded.locator(':scope > summary')).toHaveText(/^Journeys with one change \(1\) · soonest there \d\d:\d\d( tomorrow)?$/);
  const soonest = /(\d\d:\d\d)( tomorrow)?$/.exec(await folded.locator(':scope > summary').innerText())[1];
  expect([wall(now + 23 * 60_000), wall(now + 24 * 60_000)]).toContain(soonest);
  await expect(folded.locator('.plan-option.connection')).toBeHidden();
  await folded.locator(':scope > summary').click();
  await expect(folded.locator('.plan-option.connection')).toBeVisible();
  await expect(folded.locator('[data-plan-next]')).toContainText(`256 ${departs(now + 4 * 60_000, now)}`);
});

test('a direct bus that serves both stops but leaves too late does not lead: the journey with one change does, and says why', async ({page}) => {
  test.setTimeout(120_000);
  const now = Date.now();
  // The 99's next is in an hour (there at +65); the 256 and the 53 get there at +23, sooner even with
  // a change counted as ten minutes.
  await serveWorld(page, {now, direct: [60, 90]});
  await planIt(page);
  await expect(panel(page).locator('[data-plan-change-first]')).toContainText('A journey with one change gets there sooner than any direct bus.');
  const options = panel(page).locator('.plan-options > .plan-option');
  await expect(options.first()).toHaveAttribute('data-plan-connection', '256|53');
  const fold = panel(page).locator('[data-plan-direct-fold]');
  await expect(fold).toHaveAttribute('data-plan-direct-fold', '1');
  await expect(fold.locator(':scope > summary')).toHaveText(`Direct buses (1) · soonest there ${departs(now + 65 * 60_000, now)}`);
  await expect(fold.locator('.plan-option')).toBeHidden();
  await fold.locator(':scope > summary').click();
  await expect(fold.locator('[data-plan-option="99"] [data-plan-next]')).toContainText(`99 ${departs(now + 60 * 60_000, now)}`);
});

test('a long walk between the stops, checked before the list is shown, is in the times offered: nothing chosen has to change', async ({page}) => {
  test.setTimeout(120_000);
  const now = Date.now();
  const walks = await serveWorld(page, {now, walk: {metres: 900, seconds: 720}});
  await planIt(page);
  const option = panel(page).locator('.plan-option.connection');
  await expect(option.locator('[data-transfer-walk]')).toHaveAttribute('data-transfer-walk', 'checked');
  await expect(option.locator('[data-transfer-walk]')).toContainText('(12 min, about 900 m, a checked route)');
  // By hand: the 256 at +4 is at Thomas Street at +7:03; 12 min and 2 min to change make +21:03, so
  // the 53 at +17 cannot be made and the +30 is the one, at Trafford Bar at +36.
  await expect(option.locator('[data-plan-next]')).toContainText(`256 ${departs(now + 4 * 60_000, now)}`);
  await expect(option.locator('[data-plan-next]')).toContainText(`then 53 ${departs(now + 30 * 60_000, now)}`);
  await expect(option.locator('[data-plan-next]')).toContainText(`at Trafford Bar ${wall(now + 36 * 60_000)}`);
  await option.locator('[data-choose-connection]').click();
  // The connection the list showed is the one chosen, and holds: nothing to accept, no note.
  await trip(page).locator('[data-trip-next]').click();
  const chosen = trip(page).locator('[data-chosen]');
  await expect(chosen).toContainText(`256${departs(now + 4 * 60_000, now)}`);
  await expect(chosen).toContainText(`53${departs(now + 30 * 60_000, now)}`);
  await expect(chosen).toContainText('23 min to change');
  await expect(trip(page).locator('[data-change]')).toHaveCount(0);
  await expect(page.locator('[data-walk-note]')).toHaveCount(0);
  // At the change, the walk is the list's own checked answer.
  await trip(page).locator('[data-trip-board]').click();
  const asked = trip(page).locator('[data-trip-ask]');
  if (await asked.count()) await asked.locator('[data-trip-candidate="none"]').click();
  await trip(page).locator('[data-trip-next]').click();
  await expect(trip(page).locator('[data-transfer]')).toHaveAttribute('data-transfer', 'route');
  await expect(trip(page).locator('[data-transfer]')).toContainText('12 min · 900 m, a walking route');
  expect(walks.length, 'the trip used the list’s answer').toBe(1);
  // Another option is one step back.
  await page.locator('[data-panel-back]').click();
  await expect(panel(page).locator('.plan-option.connection')).toHaveCount(1);
  await expect(panel(page).locator('[data-plan-resume]')).toBeVisible();
});

test('a walk checked only after the choice, that breaks it, is checked before any time is confirmed, and the change is the passenger’s to accept', async ({page}) => {
  test.setTimeout(150_000);
  const now = Date.now();
  // The router answers after 12 s: twice what the list waits (6 s), so the list is provisional and
  // the choice is made before the answer.
  const walks = await serveWorld(page, {now, walk: {metres: 900, seconds: 720}, walkDelayMs: 12_000, routerTimeoutSeconds: 30});
  await planIt(page);
  await expect(panel(page).locator('[data-plan-checking]')).toContainText('checking the walks between stops');
  const option = panel(page).locator('.plan-option.connection');
  await expect(option.locator('[data-transfer-walk]')).toHaveAttribute('data-transfer-walk', 'estimated', {timeout: 15_000});
  await expect(option.locator('[data-transfer-walk]')).toContainText('not checked');
  // By the estimate (113 m × 1.3 at 80 m/min, 110 s), the 256 at +4 makes the 53 at +17.
  await expect(option.locator('[data-plan-next]')).toContainText(`at Trafford Bar ${wall(now + 23 * 60_000)}`);
  await option.locator('[data-choose-connection]').click();
  // The trip confirms no time until the walk it depends on is checked, and says that is what it waits for.
  await expect(trip(page).locator('[data-trip-times="none"]')).toContainText('Checking the walk between the stops before giving times');
  await expect(trip(page).locator('[data-trip-leave]')).toHaveCount(0);
  // The router's answer: 12 min. The choice is not replaced; the change is said, with the offer, under the step.
  const change = trip(page).locator('[data-change]');
  await expect(change).toHaveAttribute('data-change', 'missed', {timeout: 20_000});
  await expect(change).toContainText(`Your 256 at ${departs(now + 4 * 60_000, now)} no longer makes the 53 at ${departs(now + 17 * 60_000, now)}.`);
  await expect(change).toContainText('with the walk between the stops checked at 12 min and 2 min to change');
  await expect(change.locator('[data-offer]')).toContainText(`It makes the 53 at ${departs(now + 30 * 60_000, now)} instead, at Trafford Bar ${departs(now + 36 * 60_000, now)}.`);
  await expect(trip(page).locator('[data-trip-times="none"]')).toContainText('Your connection has changed: see below.');
  // Accepting it is the passenger's act: the offer becomes their connection, and the notice goes.
  await change.locator('[data-accept-change]').click();
  await expect(trip(page).locator('[data-change]')).toHaveCount(0);
  await expect(trip(page).locator('[data-trip-leave]')).toContainText(`for the 256 at ${departs(now + 4 * 60_000, now)}`);
  await trip(page).locator('[data-trip-next]').click();
  await expect(trip(page).locator('[data-chosen]')).toContainText(departs(now + 30 * 60_000, now));
  await expect(trip(page).locator('[data-chosen]')).toContainText('23 min to change');
  // It survives a reload, as the choice it now is.
  await page.reload();
  await waitForPaint(page);
  await expect(trip(page).locator('[data-chosen]')).toContainText(departs(now + 30 * 60_000, now), {timeout: 30_000});
  await expect(trip(page).locator('[data-change]')).toHaveCount(0);
  expect(walks.length, 'the list and the card shared one request, and the reload one more').toBeLessThanOrEqual(2);
});

test('a timetable known to run ahead of its buses gives the journey without times, and says why', async ({page}) => {
  test.setTimeout(120_000);
  const now = Date.now();
  await serveWorld(page, {now, anchor: {'FX:256:main': {verified: false, medianOffsetMinutes: 15.4,
    reason: 'schedule runs 15 min early against the bus’s own reports at its first stops'}}});
  await planIt(page);
  await panel(page).locator('[data-choose-connection]').click();
  const note = trip(page).locator('[data-trip-times="none"]');
  await expect(note).toContainText('No times for the 256: schedule runs 15 min early against the bus’s own reports at its first stops');
  await expect(trip(page).locator('[data-trip-leave]')).toHaveCount(0);
  await expect(trip(page).locator('[data-trip-arrive]')).toHaveCount(0);
  // The steps, the stop and the map are still there: it is the times that are withheld.
  await expect(trip(page).locator('[data-trip-step-link]')).toHaveCount(7);
  await expect(step(page)).toHaveText('Walk to Stretford Mall (Stop A)');
  await expect(trip(page).locator('.trip-details')).toContainText('schedule runs 15 min early');
  await trip(page).locator('[data-trip-next]').click();
  await expect(trip(page).locator('[data-trip-departures="none"]')).toContainText('No times for the 256');
  await expect(trip(page).locator('[data-trip-departure]')).toHaveCount(0);
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
