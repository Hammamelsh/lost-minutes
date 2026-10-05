// A trip, made as a passenger makes it (4 October 2026). The owner asked for planning to work the way Google Maps
// does: walking help to the bus stop, and then, on the bus, following it. Walked as a phone on the served site
// (scripts/probes/journey-study.mjs), a chosen journey had opened the boarding stop's whole board, nine sections deep,
// with the walking help 2,902 px down and no way from the plan to the bus at all.
//
// Here: Go starts a trip; one card says what to do now; the device's own location moves it on at the stop; the bus the
// passenger says they boarded is followed, stop by stop, to the stop to get off at, which is said before it comes;
// then the walk on, and arrival. FIXTURE timetable, positions and walking router (mocked); the device's location is
// Chromium's (context.setGeolocation), not a phone's GPS. The bus's reports are moved stop by stop by the check
// itself, so what the page says at each is certain. Both sizes.
import {test, expect} from '@playwright/test';
import {FIXTURE_STOP_OFFSETS, FX, chooseOption, departureBoard, fixtureCatalogue, movingLive, onScreen, serveDepartures, servePatterns, serveLive,
  waitForPaint} from './fixtures.mjs';

// About 280 m north of Stretford Mall (Stop A), where the fixture's 256 is boarded.
const NEAR_STOP_A = {latitude: 53.4487, longitude: -2.3095, accuracy: 20};
const AT_STOP_A = {latitude: FX.main[6][1], longitude: FX.main[6][2], accuracy: 10};
// A venue by Sydney Street (nr), where the 256 is left: what Photon would answer for it.
const VENUE_AT = {lat: 53.4492, lon: -2.3038};
const VENUE = {features: [{properties: {name: 'Fixture Conference Centre', osm_key: 'amenity', osm_value: 'conference_centre',
  street: 'Sydney Street', city: 'Manchester', postcode: 'M32 0AA'}, geometry: {coordinates: [VENUE_AT.lon, VENUE_AT.lat]}}]};
const wall = ms => new Intl.DateTimeFormat('en-GB', {timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false}).format(ms);

const trip = page => page.locator('.trip');
const map = page => page.locator('.vector-map');
const follow = page => page.locator('.follow');

/** The fixture world: the timetable, Stop A's board timed from `now`, the 256s at the stops the check puts them at
 *  (`world.at`, by pattern index; a second bus with `world.second`), the venue, and the walking router. */
async function serveWorld(page, world, now, {catalogue = fixtureCatalogue(), venue = VENUE} = {}) {
  await servePatterns(page, catalogue);
  await serveDepartures(page, {board: departureBoard({nowMs: now})});
  await serveLive(page, [() => {
    const live = movingLive({standing: true, startS: FIXTURE_STOP_OFFSETS[world.at]});
    if (world.second !== undefined) {
      const other = movingLive({standing: true, startS: FIXTURE_STOP_OFFSETS[world.second]}).vehicles[0];
      live.vehicles.push({...other, vehicle: 'FX-SECOND', journeyRef: 'FX-SECOND-J'});
    }
    return live;
  }]);
  await page.route('**/api.postcodes.io/**', route => route.fulfill({json: {status: 200, result: []}}));
  await page.route('**/photon.komoot.io/**', route =>
    route.fulfill({json: /conference/i.test(new URL(route.request().url()).searchParams.get('q') ?? '') ? venue : {features: []}}));
  const walks = [];
  await page.route('**/routed-foot/**', route => {
    const url = new URL(route.request().url());
    walks.push(url.pathname);
    const [a, b] = url.pathname.split('/').pop().split(';').map(p => p.split(',').map(Number));
    route.fulfill({json: {code: 'Ok', routes: [{distance: 320, duration: 250,
      geometry: {type: 'LineString', coordinates: [a, [(a[0] + b[0]) / 2 + 0.0003, (a[1] + b[1]) / 2], b]}}],
      waypoints: [{distance: 2, location: a}, {distance: 3, location: b}]}});
  });
  return walks;
}

/** From the start of the page to the trip's first step: the venue found by name, planned to from here, and Go. */
async function goToVenue(page, name = 'Fixture Conference Centre', which = '.plan-option[data-plan-option="256"]') {
  await page.goto('/');
  await waitForPaint(page);
  await page.locator('.follow-search input').fill('conference');
  await chooseOption(page.locator('.follow-search [data-place]', {hasText: name}));
  await expect(follow(page)).toHaveAttribute('data-panel', 'plan');
  await expect(page.locator('[data-plan-from]')).toContainText('My location', {timeout: 15_000});
  const option = page.locator(which).first();
  await expect(option).toBeVisible({timeout: 30_000});
  return option;
}
const refresh = page => page.getByRole('button', {name: 'Check for newer positions'}).locator('visible=true').first().click();
/** The step's own action is on the screen as it stands, at the top of its card: in a phone's half sheet, with nothing
 *  scrolled for it (real services' longer names once pushed it under the edge; scripts/probes/journey-study.mjs). */
const inView = (page, selector) => expect.poll(() => onScreen(page.locator(`.trip ${selector}`)), {message: `${selector} on the screen`}).toBe(true);

test.use({permissions: ['geolocation'], geolocation: NEAR_STOP_A});

test('a direct trip: walk to the stop, reached by the device itself; the bus boarded, followed and said before the stop to get off at; then the walk on', async ({page, context}, info) => {
  test.setTimeout(180_000);
  const now = Date.now();
  const world = {at: 5};
  const walks = await serveWorld(page, world, now);
  const option = await goToVenue(page);
  // The option in one look: walk, the 256, walk; when to leave and when it gets there; Go.
  await expect(option.locator('[data-plan-strip]')).toHaveAttribute('aria-label', /^walk \d+ min, then bus 256, then walk \d+ min$/);
  await expect(option.locator('[data-plan-when]')).toContainText(/\d\d:\d\d – \d\d:\d\d/);
  await expect(option.locator('[data-plan-next]')).toContainText(/Leave (now|in \d+ min) · 256 \d\d:\d\d from Stretford Mall \(Stop A\)/);
  await expect(option.locator('[data-plan-next]')).toContainText('by the timetable, not live');
  await expect(option.locator('.plan-more')).not.toHaveAttribute('open', '');
  await page.screenshot({path: info.outputPath(`${info.project.name}-1-options.png`)});
  await option.locator('[data-choose-plan]').click();

  // 1. Walk to the stop: one card, the walk estimated, when to leave, how far, and the way back to the options.
  await expect(follow(page)).toHaveAttribute('data-panel', 'trip');
  await expect(trip(page)).toHaveAttribute('data-trip-step', 'walk');
  await expect(trip(page).locator('.trip-title')).toHaveText('Walk to Stretford Mall (Stop A)');
  await expect(trip(page).locator('[data-trip-walk]')).toHaveAttribute('data-trip-walk', 'estimate');
  await expect(trip(page).locator('[data-trip-walk]')).toContainText('in a straight line, estimated');
  await expect(trip(page).locator('[data-trip-leave]')).toContainText(/Leave (now|in \d+ min) for the 256 at \d\d:\d\d/);
  await expect(trip(page).locator('[data-trip-here]')).toContainText(/You are about \d+ m away in a straight line/);
  await expect(page.locator('[data-panel-back]')).toHaveText('Back to your options');
  await expect(page.locator('.your-stop'), 'the stop’s own block is not repeated under the trip').toHaveCount(0);
  await inView(page, '[data-trip-next]');
  await expect(map(page)).toHaveAttribute('data-frame', /\|0$/);
  await expect.poll(async () => JSON.parse(await map(page).getAttribute('data-journey') ?? 'null')?.legs?.length).toBe(1);
  // The walking route is asked for only when the passenger says so, and says what it sends.
  expect(walks.length, 'nothing sent unasked').toBe(0);
  await expect(trip(page).locator('.trip-ask-route')).toContainText('Sends your location, rounded to about 10 m');
  await trip(page).locator('[data-show-route]').click();
  await expect(trip(page).locator('[data-trip-walk]')).toHaveAttribute('data-trip-walk', 'route');
  await expect(trip(page).locator('[data-trip-walk]')).toContainText('4 min · 320 m, a walking route');
  expect(walks.length).toBe(1);
  expect(walks[0], 'from the device, rounded, to the stop itself').toMatch(/\/-2\.3095,53\.4487;-2\.31056,53\.44629$/);
  await expect(map(page)).toHaveAttribute('data-walk', 'route');
  await page.screenshot({path: info.outputPath(`${info.project.name}-2-walk.png`)});
  // Said yes once, for this visit; the way to stop it is in the trip's own list.
  await expect(trip(page).locator('[data-stop-sending]')).toHaveCount(1);

  // 2. At the stop, by the device's own location: the trip moves on by itself, to the wait.
  await context.setGeolocation(AT_STOP_A);
  await expect(trip(page)).toHaveAttribute('data-trip-step', 'wait', {timeout: 15_000});
  await expect(trip(page).locator('.trip-title')).toHaveText('Wait at Stretford Mall (Stop A)');
  // The stop's next two 256s by the timetable, on one line, the first with how long until it.
  await expect(trip(page).locator('[data-trip-departure]').first()).toHaveText(new RegExp(`^${wall(now + 4 * 60_000)} \\(in [2-4] min\\)$`));
  await expect(trip(page).locator('[data-trip-departure]')).toHaveCount(2);
  await expect(trip(page).locator('[data-trip-departure]').nth(1)).toHaveText(` · ${wall(now + 14 * 60_000)}`);
  const coming = trip(page).locator('[data-trip-coming="BNML|FX-MOVING"]');
  await expect(coming).toContainText('1 stop away');
  await inView(page, '[data-trip-board]');
  // Gone back a step at the stop, the passenger is not pushed on again.
  await trip(page).locator('[data-trip-prev]').click();
  await expect(trip(page)).toHaveAttribute('data-trip-step', 'walk');
  await page.waitForTimeout(2500);
  await expect(trip(page)).toHaveAttribute('data-trip-step', 'walk');
  await trip(page).locator('[data-trip-next]').click();
  await expect(trip(page)).toHaveAttribute('data-trip-step', 'wait');
  await page.screenshot({path: info.outputPath(`${info.project.name}-3-wait.png`)});

  // 3. On the bus: the only 256 around the stop is the one boarded, chosen, and followed.
  await trip(page).locator('[data-trip-board]').click();
  await expect(trip(page)).toHaveAttribute('data-trip-step', 'ride');
  await expect(map(page)).toHaveAttribute('data-selected-key', 'BNML|FX-MOVING');
  await expect(trip(page).locator('[data-trip-before]')).toContainText('1 stop before Stretford Mall (Stop A)');
  await expect(trip(page).locator('.trip-title')).toContainText('On the 256 · Get off at Sydney Street (nr)');
  await inView(page, '[data-trip-next]');
  // Its reports move it on: stops to go, the next ones by name; then the stop to get off at is next, said and alerted.
  world.at = 6; await refresh(page);
  await expect(trip(page).locator('[data-trip-togo]')).toHaveAttribute('data-trip-togo', '2', {timeout: 15_000});
  await expect(trip(page).locator('[data-trip-next-stops]')).toContainText('Next: Stretford Public Hall · Sydney Street');
  await expect(trip(page).locator('[data-trip-alert]')).toHaveCount(0);
  world.at = 7; await refresh(page);
  await expect(trip(page).locator('[data-trip-togo]')).toHaveAttribute('data-trip-togo', '1', {timeout: 15_000});
  await expect(trip(page).locator('[data-trip-alert]')).toContainText('Get off at the next stop: Sydney Street (nr)');
  await expect(page.locator('.sheet-words').locator('visible=true')).toHaveCount(info.project.name === 'mobile' ? 1 : 0);
  if (info.project.name === 'mobile') await expect(page.locator('.sheet-words')).toHaveText('Your stop is next · Sydney Street (nr)');
  await page.screenshot({path: info.outputPath(`${info.project.name}-4-get-off.png`)});
  // Riding along, the stop to get off at is on the ride's own card, and getting off is one tap from there.
  await trip(page).locator('[data-trip-ride]').click();
  await expect(map(page)).toHaveAttribute('data-ride', /entering|following/, {timeout: 15_000});
  await expect(page.locator('.ride-card [data-ride-trip]')).toContainText('Get off at Sydney Street (nr)');
  await expect(page.locator('.ride-card [data-ride-trip-alert]')).toHaveText('Your stop is next');
  await page.screenshot({path: info.outputPath(`${info.project.name}-5-ride.png`)});
  await page.locator('.ride-card [data-ride-got-off]').click();
  await expect(map(page)).toHaveAttribute('data-ride', 'off', {timeout: 10_000});

  // 4. The walk on, and arrival by the device's own location.
  await expect(follow(page)).toHaveAttribute('data-panel', 'trip');
  await expect(trip(page)).toHaveAttribute('data-trip-step', 'arrive');
  await expect(trip(page).locator('.trip-title')).toHaveText('Walk to Fixture Conference Centre');
  await expect(map(page), 'the bus got off is not chosen any more').not.toHaveAttribute('data-selection', 'active');
  await expect(trip(page).locator('[data-trip-walk]')).toHaveAttribute('data-trip-walk', /route|estimate/);
  await context.setGeolocation({latitude: VENUE_AT.lat, longitude: VENUE_AT.lon, accuracy: 10});
  await expect(trip(page).locator('[data-trip-arrived]')).toHaveText('You’ve arrived.', {timeout: 15_000});
  await page.screenshot({path: info.outputPath(`${info.project.name}-6-arrived.png`)});
  await trip(page).locator('[data-trip-finish]').click();
  await expect(follow(page)).toHaveAttribute('data-panel', 'home');
  await page.reload();
  await waitForPaint(page);
  await expect(trip(page)).toHaveCount(0);
  await expect(page.locator('[data-trip-resume]')).toHaveCount(0);
});

test('a trip survives a reload and a look at the options or the stop’s board, each one step back; End clears it', async ({page, context}) => {
  test.setTimeout(150_000);
  const now = Date.now();
  const world = {at: 6};
  await serveWorld(page, world, now);
  const option = await goToVenue(page);
  await option.locator('[data-choose-plan]').click();
  await context.setGeolocation(AT_STOP_A);
  await expect(trip(page)).toHaveAttribute('data-trip-step', 'wait', {timeout: 15_000});
  await trip(page).locator('[data-trip-board]').click();
  await expect(trip(page).locator('[data-trip-togo]')).toHaveAttribute('data-trip-togo', '2');
  // A reload: the same step, the same bus followed.
  await page.reload();
  await waitForPaint(page);
  await expect(trip(page)).toHaveAttribute('data-trip-step', 'ride', {timeout: 30_000});
  await expect(trip(page).locator('[data-trip-togo]')).toHaveAttribute('data-trip-togo', '2', {timeout: 20_000});
  await expect(map(page)).toHaveAttribute('data-selected-key', 'BNML|FX-MOVING');
  // Location already allowed is taken up again: the trip is made where the device is.
  await expect(page.locator('.vector-map')).toHaveAttribute('data-here', /^53\.4462/, {timeout: 15_000});
  // Riding along, the ride's own Details opens the bus's details over the trip; Back is the trip, still riding.
  await trip(page).locator('[data-trip-ride]').click();
  await expect(map(page)).toHaveAttribute('data-ride', /entering|following/, {timeout: 15_000});
  await page.locator('.ride-card .ride-details').click();
  await expect(follow(page)).toHaveAttribute('data-panel', 'bus');
  await expect(page.locator('[data-panel-back]')).toHaveText('Back to your trip');
  await page.locator('[data-panel-back]').click();
  await expect(follow(page)).toHaveAttribute('data-panel', 'trip');
  await expect(trip(page)).toHaveAttribute('data-trip-step', 'ride');
  // Back is the options, with the way back to the trip on top; that way is the same step forward.
  await page.locator('[data-panel-back]').click();
  await expect(follow(page)).toHaveAttribute('data-panel', 'plan');
  await expect(page.locator('[data-plan-resume]')).toContainText('2 stops to go · get off at Sydney Street (nr)');
  await expect(page.locator('.plan-option.on [data-choose-plan]')).toHaveText('Continue');
  await page.locator('[data-plan-resume]').click();
  await expect(follow(page)).toHaveAttribute('data-panel', 'trip');
  await expect(trip(page)).toHaveAttribute('data-trip-step', 'ride');
  // Not on it after all: the bus is let go, and the stop's own board is one tap away and one step back.
  await trip(page).locator('[data-trip-prev]').click();
  await expect(trip(page)).toHaveAttribute('data-trip-step', 'wait');
  await expect(map(page), 'not on it: let go, at most suggested').not.toHaveAttribute('data-selection', 'active');
  await trip(page).locator('[data-trip-stop]').click();
  await expect(follow(page)).toHaveAttribute('data-panel', 'stop');
  await expect(page.locator('.your-stop-copy strong')).toContainText('Stretford Mall (Stop A)');
  await expect(page.locator('[data-trip-resume]')).toContainText('Your trip to Fixture Conference Centre');
  await expect(page.locator('[data-panel-back]')).toHaveText('Back to your trip');
  await page.goBack();
  await expect(follow(page)).toHaveAttribute('data-panel', 'trip');
  await expect(trip(page)).toHaveAttribute('data-trip-step', 'wait');
  // End: the trip, its stop and its destination go, and nothing comes back on a reload.
  await page.locator('[data-trip-end]').click();
  await expect(follow(page)).toHaveAttribute('data-panel', 'home');
  expect(await page.evaluate(() => sessionStorage.getItem('lost-minutes.trip.v1'))).toBeNull();
  await page.reload();
  await waitForPaint(page);
  await expect(trip(page)).toHaveCount(0);
  await expect(page.locator('[data-trip-resume]')).toHaveCount(0);
});

test('with two 256s that could be the one boarded the page asks, never chooses; a wrong one is undone; one beside a device that left the stop is offered', async ({page, context}) => {
  test.setTimeout(150_000);
  const now = Date.now();
  const world = {at: 5, second: 7};
  await serveWorld(page, world, now);
  const option = await goToVenue(page);
  await option.locator('[data-choose-plan]').click();
  await trip(page).locator('[data-trip-next]').click();
  await expect(trip(page)).toHaveAttribute('data-trip-step', 'wait');
  await trip(page).locator('[data-trip-board]').click();
  // Asked: both, nearest the stop first; nothing chosen yet.
  const ask = trip(page).locator('[data-trip-ask]');
  await expect(ask.locator('[data-trip-candidate]')).toHaveCount(3);
  await expect(ask.locator('[data-trip-candidate="BNML|FX-MOVING"]')).toContainText('1 stop before Stretford Mall (Stop A)');
  await expect(ask.locator('[data-trip-candidate="BNML|FX-SECOND"]')).toContainText('1 stop past Stretford Mall (Stop A)');
  await expect(trip(page)).toHaveAttribute('data-trip-step', 'wait');
  await ask.locator('[data-trip-candidate="BNML|FX-SECOND"]').click();
  await expect(trip(page)).toHaveAttribute('data-trip-step', 'ride');
  await expect(map(page)).toHaveAttribute('data-selected-key', 'BNML|FX-SECOND');
  await expect(trip(page).locator('[data-trip-togo]')).toHaveAttribute('data-trip-togo', '1');
  // Not this bus: it is let go, and the buses it could be are offered in its place.
  await trip(page).locator('[data-trip-wrong-bus]').click();
  await expect(trip(page)).toHaveAttribute('data-trip-step', 'ride');
  await expect(trip(page).locator('[data-trip-ask] [data-trip-candidate="BNML|FX-MOVING"]')).toBeVisible();
  await trip(page).locator('[data-trip-ask] [data-trip-candidate="BNML|FX-MOVING"]').click();
  await expect(map(page)).toHaveAttribute('data-selected-key', 'BNML|FX-MOVING');
  // Back at the stop, then off along the road with a bus reported beside the device: offered, not chosen.
  await trip(page).locator('[data-trip-prev]').click();
  await expect(trip(page)).toHaveAttribute('data-trip-step', 'wait');
  await context.setGeolocation({latitude: FX.main[7][1], longitude: FX.main[7][2], accuracy: 15});
  const offer = trip(page).locator('[data-trip-suggest]');
  await expect(offer).toHaveAttribute('data-trip-suggest', 'BNML|FX-SECOND', {timeout: 15_000});
  await expect(trip(page)).toHaveAttribute('data-trip-step', 'wait');
  await offer.getByRole('button', {name: 'Yes, follow it'}).click();
  await expect(trip(page)).toHaveAttribute('data-trip-step', 'ride');
  await expect(map(page)).toHaveAttribute('data-selected-key', 'BNML|FX-SECOND');
});

test('with sibling lines and long names, as real services have, each step’s action is still on the screen and the header one line', async ({page, context}) => {
  test.setTimeout(150_000);
  // The 142 from Oxford Road runs with the 42 and the 42B, to three places (scripts/probes/journey-study.mjs): two
  // FIXTURE sibling lines on the same stops, with long destinations, and a venue with a long name.
  const catalogue = fixtureCatalogue();
  const main = catalogue.patterns[0];
  // Five lines in all, as the 142's family is in the evening.
  catalogue.patterns.push({...main, id: 'FX:256X:long', line: '256X', destination: 'Davenport Arms via Stretford, Old Trafford and Hulme'},
    {...main, id: 'FX:256B:long', line: '256B', destination: 'Stockport Interchange (Bus Station) via the Precinct'},
    {...main, id: 'FX:256C:long', line: '256C', destination: 'Cheadle Post Office'},
    {...main, id: 'FX:256D:long', line: '256D', destination: 'Thornley Lane South (Shopping Centre)'});
  const venue = {features: [{...VENUE.features[0], properties: {...VENUE.features[0].properties,
    name: 'Fixture Conference Centre and Exhibition Halls, North Entrance'}}]};
  const world = {at: 5};
  await serveWorld(page, world, Date.now(), {catalogue, venue});
  const option = await goToVenue(page, 'Exhibition Halls', '.plan-option');
  // One option, its three lines together (which leads is the planner's order).
  await expect(option.locator('[data-plan-strip] .route-pill')).toHaveText(/^256\w? \+4$/);
  await expect(option.locator('.plan-go-words')).toHaveText(/^any 256\w?, 256\w?, 256\w?, 256\w? or 256\w? · 2 stops$/);
  // The strip and the times on one line, both read at once. On a phone the card is still moving as the sheet rises to
  // full for the planner (its top 685, then 541, then 537 px over the first half second), and two separate reads in the
  // gate of 5 October 2026 most likely caught it at two places: 112 px apart, where one read at once gives one line.
  await expect(option.locator('[data-plan-when]')).toBeVisible({timeout: 15_000});
  const apart = await option.evaluate(el => {
    const middle = node => { const r = node.getBoundingClientRect(); return r.top + r.height / 2; };
    return Math.abs(middle(el.querySelector('[data-plan-strip]')) - middle(el.querySelector('[data-plan-when]')));
  });
  expect(apart, 'one line').toBeLessThan(12);
  await option.locator('[data-choose-plan]').click();
  await expect(trip(page)).toHaveAttribute('data-trip-step', 'walk');
  await expect(trip(page).locator('.trip-chip .route-pill')).toHaveText(/^256\w? \+4$/);
  await inView(page, '[data-trip-next]');
  expect(await trip(page).locator('.trip-head').evaluate(e => e.getBoundingClientRect().height), 'one line, the name cut short').toBeLessThan(26);
  await context.setGeolocation(AT_STOP_A);
  await expect(trip(page)).toHaveAttribute('data-trip-step', 'wait', {timeout: 15_000});
  await expect(trip(page).locator('.trip-for')).toHaveText(/^for the 256\w?, 256\w?, 256\w?, 256\w? or 256\w?, any of them$/);
  await page.screenshot({path: test.info().outputPath(`${test.info().project.name}-long-wait.png`)});
  await inView(page, '[data-trip-board]');
  await trip(page).locator('[data-trip-board]').click();
  await expect(trip(page)).toHaveAttribute('data-trip-step', 'ride');
  await inView(page, '[data-trip-next]');
});

test('a link that carries a journey opens its trip from the first step, from wherever it is opened, and names no location', async ({page}) => {
  test.setTimeout(120_000);
  await serveWorld(page, {at: 5}, Date.now());
  const key = 'd:FX:256:main|1800SJ00811|1800SJ00101';
  await page.goto(`/?to=${VENUE_AT.lat},${VENUE_AT.lon}&toLabel=${encodeURIComponent('Fixture Conference Centre')}&plan=${encodeURIComponent(key)}`);
  await waitForPaint(page);
  await expect(trip(page)).toHaveAttribute('data-trip-step', 'walk', {timeout: 30_000});
  await expect(follow(page)).toHaveAttribute('data-trip', `${key}|0`);
  await expect(trip(page).locator('.trip-title')).toHaveText('Walk to Stretford Mall (Stop A)');
  // From this device, where its location is allowed; a link never carries one.
  await expect(trip(page).locator('[data-trip-here]')).toContainText(/You are about \d+ m away in a straight line/, {timeout: 15_000});
  // Opened from a link, nothing of the page's own lies below: Back goes to the start, and the trip is kept to go back to.
  await expect(page.locator('[data-panel-back]')).toHaveText('Back to the start');
  await page.locator('[data-panel-back]').click();
  await expect(page.locator('[data-trip-resume]')).toContainText('Your trip to Fixture Conference Centre');
  expect(new URL(page.url()).pathname).toBe('/');
});
