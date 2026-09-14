// A passenger who starts following a bus keeps following that bus. FIXTURE buses on a FIXTURE
// timetable over real NaPTAN stops around Stretford Mall (Stop A).
//
// Two buses, ALPHA and BRAVO, are both three stops before Stop A on the same route. Which of them
// reported last alternates from one publication to the next, so every list the page orders by
// report age reorders each time: the stop's "coming" list breaks ties by it, and the route list is
// ordered by it. Before the fix the page showed whichever bus was first in those lists, so starting
// Follow or Ride along on the bus shown did not keep it: the next publication swapped the card, the
// map and the camera to the other bus. Each check here alternates the reports, removes the chosen
// bus for a while, brings it back and then puts it on another journey, with a theme change, a
// filter to another service and a drag of the map on the way, and asserts after every publication
// which vehicle the card describes and where the camera is.
import {test, expect} from '@playwright/test';
import {FX, journeyLive, servePatterns, serveLive, unavailableState, waitForPaint} from './fixtures.mjs';

const LONGFORD_PARK = {latitude: 53.4487, longitude: -2.3095, accuracy: 40};
test.use({permissions: ['geolocation'], geolocation: LONGFORD_PARK});

const ALPHA = {id: 'FX-ALPHA', lat: FX.main[3][1] + 0.0001, lon: FX.main[3][2], destination: 'Piccadilly_Gardens',
  shown: 'to Piccadilly Gardens'};
const BRAVO = {id: 'FX-BRAVO', lat: FX.main[2][1] + 0.0001, lon: FX.main[2][2], destination: 'Manchester_Piccadilly',
  shown: 'to Manchester Piccadilly'};
const EVIDENCE = {serviceDay: '2026-09-13', weekday: 'Sunday', operatorChecked: true, directionReported: true,
  operatingDayChecked: true, plausiblePaths: 1, resolvedBy: 'position'};

/** One publication: both buses three stops before Stop A, the newer as named. `alphaGone` leaves
 *  ALPHA out; `alphaJourney` puts it on another journey of the same route. */
function pair({newer = 'ALPHA', alphaGone = false, alphaJourney = null, nowMs = Date.now()} = {}) {
  const base = journeyLive({nowMs, omit: ['FX-COMING', 'FX-SHARED', 'FX-PASSED']});
  const published = base.publishedAtMs;
  const vehicle = (bus, age, journey = null) => {
    const observedAtMs = published - age * 1000;
    return {operator: 'BNML', vehicle: bus.id, route: '256', direction: 'inbound',
      journeyRef: journey ?? `${bus.id}-J1`, destination: journey ? 'Stretford_Mall' : bus.destination,
      origin: 'Fixture', observedAtMs, recordedAt: new Date(observedAtMs).toISOString().replace('.000Z', '+00:00'),
      lat: bus.lat, lon: bus.lon, ageSeconds: age, freshness: 'fresh', positionKind: 'observed',
      sourceHash: 'e'.repeat(64), bearing: 135, bearingStatus: 'reported', aimedDeparture: null,
      match: {patternId: 'FX:256:main', patternIndex: 3, nearestStop: FX.main[3][0], metresAlongPattern: FX.metres[3],
        metresFromPatternStop: 12, patternDirection: 'inbound', patternDestination: 'Piccadilly Gardens', evidence: EVIDENCE}};
  };
  const alpha = vehicle(ALPHA, newer === 'ALPHA' ? 6 : 26, alphaJourney);
  const bravo = vehicle(BRAVO, newer === 'BRAVO' ? 6 : 26);
  base.vehicles = [...(alphaGone ? [] : [alpha]), bravo, ...base.vehicles];
  return base;
}

const map = page => page.locator('.vector-map');
const card = page => page.locator('article.bus-card').first();
const metres = (a, b) => Math.hypot((b.lon - a.lon) * Math.cos(a.lat * Math.PI / 180), b.lat - a.lat) * 111195;

/** The vehicle the card describes: its own attribute where the page gives one, otherwise the
 *  vehicle named in its "How we know this" evidence (present in both versions of the page). */
async function cardVehicle(page) {
  const element = card(page);
  if (!(await element.count())) return null;
  const attribute = await element.getAttribute('data-vehicle');
  if (attribute) return attribute;
  return (await element.textContent())?.match(/BNML · (FX-(?:ALPHA|BRAVO))/)?.[1] ?? null;
}
async function camera(page) {
  const [zoom, lat, lon] = ((await map(page).getAttribute('data-camera')) || '0,0,0').split(',').map(Number);
  return {zoom, lat, lon};
}
async function drawn(page) {
  const [lat, lon] = ((await map(page).getAttribute('data-display')) || ',').split(',').map(Number);
  return {lat, lon};
}
async function dragMap(page, dx, dy) {
  await map(page).evaluate(el => el.scrollIntoView({block: 'start'}));
  const box = await page.locator('.vector-map-canvas').boundingBox();
  const x = box.x + box.width * 0.55, y = box.y + box.height * 0.5;
  await page.mouse.move(x, y); await page.mouse.down();
  for (let i = 1; i <= 8; i++) { await page.mouse.move(x + dx * i / 8, y + dy * i / 8); await page.waitForTimeout(30); }
  await page.mouse.up();
}

/** Serve the named phase from now on, ask for it, and wait until the page has it. */
async function publish(page, feed, phase) {
  feed.phase = phase;
  const response = page.waitForResponse(r => r.url().includes('/data/live.json'));
  await page.getByRole('button', {name: 'Check for newer positions'}).click();
  await response;
  await page.waitForTimeout(900);
}

async function openStopA(page, phases) {
  const feed = {phase: 0};
  await servePatterns(page);
  await serveLive(page, [() => phases[feed.phase]()]);
  await page.goto('/');
  await waitForPaint(page);
  await page.getByRole('button', {name: 'Buses near me'}).click();
  await page.locator('.nearby-stop', {hasText: 'Stop A'}).first().click();
  await expect(page.locator('.your-stop-copy strong')).toContainText('Stretford Mall (Stop A)');
  return feed;
}

const PHASES = [
  () => pair({newer: 'ALPHA'}),                              // 0: ALPHA reported last, so it is shown
  () => pair({newer: 'BRAVO'}),                              // 1: BRAVO now newer: the lists reorder
  () => pair({newer: 'ALPHA'}),                              // 2
  () => pair({newer: 'BRAVO'}),                              // 3
  () => pair({newer: 'BRAVO', alphaGone: true}),             // 4: ALPHA missing from the publication
  () => pair({newer: 'BRAVO'}),                              // 5: ALPHA back
  () => pair({newer: 'BRAVO', alphaJourney: 'FX-ALPHA-J2'}), // 6: ALPHA on another journey
];

test('Follow keeps the bus that was shown through reordering, absence, return and a new journey', async ({page}) => {
  test.setTimeout(180_000);
  const feed = await openStopA(page, PHASES);
  await expect.poll(() => cardVehicle(page), {timeout: 15_000}).toBe(ALPHA.id);
  await page.locator('.follow-toggle').click();
  await expect(page.locator('.follow-toggle')).toHaveAttribute('aria-pressed', 'true');
  for (const phase of [1, 2, 3]) {
    await publish(page, feed, phase);
    expect(await cardVehicle(page), `publication ${phase}: the card still describes the bus being followed`).toBe(ALPHA.id);
    await expect.poll(async () => metres(await camera(page), ALPHA), {timeout: 5000,
      message: `publication ${phase}: the camera stays on the followed bus`}).toBeLessThan(40);
  }
  // A theme change, then a filter to a service the followed bus is not on: it is still the bus
  // followed, on the card, the strip and the map, and the strip says it is not in the list below.
  await page.getByRole('button', {name: 'Switch to the night map'}).click();
  await publish(page, feed, 2);
  expect(await cardVehicle(page), 'after a theme change').toBe(ALPHA.id);
  await expect.poll(async () => metres(await camera(page), ALPHA), {timeout: 5000,
    message: 'after a theme change the camera stays on the followed bus'}).toBeLessThan(40);
  const otherService = page.locator('.service-chip', {hasText: 'Chester'});
  await otherService.click();
  await expect(otherService).toHaveAttribute('aria-pressed', 'true');
  await publish(page, feed, 3);
  expect(await cardVehicle(page), 'filtered to another service').toBe(ALPHA.id);
  await expect(page.locator('.active-bus')).toHaveAttribute('data-vehicle', ALPHA.id);
  await expect(page.locator('.active-bus')).toContainText('not in the list below');
  await expect(map(page)).toHaveAttribute('data-selected-key', /FX-ALPHA/);
  await otherService.click();
  await expect(otherService).toHaveAttribute('aria-pressed', 'false');
  // Gone from the publication: said so, never replaced by the other bus, which is offered instead.
  await publish(page, feed, 4);
  expect(await cardVehicle(page), 'while it is missing the card is still about it').toBe(ALPHA.id);
  await expect(card(page)).toContainText('No current report');
  await expect(card(page).locator('.bus-card-title')).not.toContainText(BRAVO.shown);
  await expect(page.locator('.active-bus')).toContainText('No current report');
  await expect(page.getByRole('button', {name: /Follow 256 to Manchester Piccadilly instead/})).toBeVisible();
  expect(metres(await camera(page), BRAVO), 'the camera does not go to the other bus').toBeGreaterThan(100);
  // Back: followed again, with nothing to confirm.
  await publish(page, feed, 5);
  expect(await cardVehicle(page)).toBe(ALPHA.id);
  await expect(card(page)).not.toContainText('No current report');
  await expect(page.locator('.follow-toggle')).toHaveAttribute('aria-pressed', 'true');
  // The same vehicle on another journey: explained, and continued only when asked.
  await publish(page, feed, 6);
  expect(await cardVehicle(page)).toBe(ALPHA.id);
  await expect(card(page)).toContainText('another journey');
  await card(page).getByRole('button', {name: 'Keep following it on this journey'}).click();
  await expect(card(page)).not.toContainText('another journey');
  expect(await cardVehicle(page)).toBe(ALPHA.id);
  await page.screenshot({path: test.info().outputPath(`${test.info().project.name}-follow-kept.png`), fullPage: true});
});

test('Ride along keeps the bus that was shown: the ride card and the camera never move to the other bus', async ({page}) => {
  test.setTimeout(180_000);
  const feed = await openStopA(page, PHASES);
  await expect.poll(() => cardVehicle(page), {timeout: 15_000}).toBe(ALPHA.id);
  await map(page).evaluate(el => el.scrollIntoView({block: 'start'}));
  await page.getByRole('button', {name: 'Ride along with route 256'}).click();
  await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 10_000});
  await expect(page.locator('.ride-card')).toContainText(ALPHA.shown);
  for (const phase of [1, 2, 3]) {
    await publish(page, feed, phase);
    await expect(page.locator('.ride-card'), `publication ${phase}: the ride card`).toContainText(ALPHA.shown);
    await expect(page.locator('.ride-card')).not.toContainText(BRAVO.shown);
    expect(metres(await drawn(page), ALPHA), `publication ${phase}: the bus drawn is the ridden one`).toBeLessThan(40);
    await expect.poll(async () => metres(await camera(page), ALPHA), {timeout: 6000,
      message: `publication ${phase}: the camera is on it`}).toBeLessThan(40);
  }
  // A drag is the passenger looking around: the ridden bus stays the one drawn and described, and
  // Return to bus goes back to it. Then a theme change while riding.
  await dragMap(page, -160, 80);
  await expect(map(page)).toHaveAttribute('data-ride', 'exploring', {timeout: 5000});
  await publish(page, feed, 2);
  await expect(page.locator('.ride-card'), 'while exploring').toContainText(ALPHA.shown);
  expect(metres(await drawn(page), ALPHA), 'while exploring, the bus drawn is still the ridden one').toBeLessThan(40);
  await page.getByRole('button', {name: /Return to bus/}).click();
  await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 10_000});
  await expect.poll(async () => metres(await camera(page), ALPHA), {timeout: 6000,
    message: 'Return to bus goes back to the ridden bus'}).toBeLessThan(40);
  await page.getByRole('button', {name: 'Switch to the night map'}).click();
  await publish(page, feed, 3);
  await expect(page.locator('.ride-card'), 'after a theme change while riding').toContainText(ALPHA.shown);
  await expect.poll(async () => metres(await camera(page), ALPHA), {timeout: 6000,
    message: 'after a theme change the camera is on the ridden bus'}).toBeLessThan(40);
  await publish(page, feed, 4);
  await expect(map(page), 'still riding while it is missing').toHaveAttribute('data-view', 'ride');
  await expect(page.locator('.ride-card')).toContainText(ALPHA.shown);
  await expect(page.locator('.ride-card')).toContainText('No current report');
  expect(metres(await camera(page), BRAVO)).toBeGreaterThan(100);
  await publish(page, feed, 5);
  await expect(page.locator('.ride-card')).not.toContainText('No current report');
  await expect(page.locator('.ride-card')).toContainText(ALPHA.shown);
  await publish(page, feed, 6);
  await expect(page.locator('.ride-card')).toContainText('another journey');
  expect(metres(await camera(page), BRAVO)).toBeGreaterThan(100);
  await page.screenshot({path: test.info().outputPath(`${test.info().project.name}-ride-kept.png`)});
});

test('following a bus picked from a route, with no stop chosen, survives the route list reordering', async ({page}) => {
  test.setTimeout(120_000);
  const feed = {phase: 0};
  await servePatterns(page);
  await serveLive(page, [() => PHASES[feed.phase]()]);
  await page.goto('/');
  await waitForPaint(page);
  await page.locator('#follow-route').selectOption('BNML|256');
  await expect.poll(() => cardVehicle(page), {timeout: 15_000}).toBe(ALPHA.id);
  await page.locator('.follow-toggle').click();
  for (const phase of [1, 2, 3]) {
    await publish(page, feed, phase);
    expect(await cardVehicle(page), `publication ${phase}`).toBe(ALPHA.id);
  }
});

test('the bus is kept from the keyboard, or with a tap on the phone, and Details takes focus to its card', async ({page}) => {
  test.setTimeout(120_000);
  const phone = test.info().project.name === 'mobile';
  const press = async locator => { if (phone) await locator.tap(); else { await locator.focus(); await page.keyboard.press('Enter'); } };
  const feed = await openStopA(page, PHASES);
  await expect.poll(() => cardVehicle(page), {timeout: 15_000}).toBe(ALPHA.id);
  await press(page.locator('.follow-toggle'));
  await expect(page.locator('.follow-toggle')).toHaveAttribute('aria-pressed', 'true');
  await expect(card(page)).toHaveAttribute('data-selection', 'active');
  await publish(page, feed, 1);
  expect(await cardVehicle(page), 'kept after the other bus reports').toBe(ALPHA.id);
  await press(page.locator('.active-bus').getByRole('button', {name: 'Details'}));
  await expect(card(page)).toBeFocused();
  await expect(card(page)).toBeInViewport();
});

test('a followed bus when live positions stop: said so, with nothing chosen in its place', async ({page}) => {
  test.setTimeout(120_000);
  const feed = await openStopA(page, [PHASES[0], () => unavailableState()]);
  await expect.poll(() => cardVehicle(page), {timeout: 15_000}).toBe(ALPHA.id);
  await page.locator('.follow-toggle').click();
  await publish(page, feed, 1);
  expect(await cardVehicle(page)).toBe(ALPHA.id);
  await expect(card(page)).toContainText('Live positions are not available, so this bus cannot be checked');
  await expect(card(page)).toContainText('Nothing else has been chosen in its place');
  await expect(card(page).locator('.bus-card-title')).not.toContainText(BRAVO.shown);
});

test('tapping another bus on the map chooses it, and it stays chosen', async ({page}) => {
  test.setTimeout(120_000);
  // The vector map draws its buses into a canvas; the drawn fallback map has one element per bus.
  // Both call the same selection, so the choice is made here on the fallback, with WebGL withheld.
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      return /webgl/i.test(String(type)) ? null : original.call(this, type, ...rest);
    };
  });
  const feed = {phase: 0};
  await servePatterns(page);
  await serveLive(page, [() => PHASES[feed.phase]()]);
  await page.goto('/');
  await expect(page.locator('.map-fallback-wrap')).toHaveAttribute('data-map-fallback', 'no_webgl');
  await page.getByRole('button', {name: 'Buses near me'}).click();
  await page.locator('.nearby-stop', {hasText: 'Stop A'}).first().click();
  await expect.poll(() => cardVehicle(page), {timeout: 15_000}).toBe(ALPHA.id);
  // Named for a screen reader with the destination as the card writes it.
  await page.getByRole('button', {name: /^Route 256 to Manchester Piccadilly/}).click();
  await expect(card(page)).toHaveAttribute('data-vehicle', BRAVO.id);
  await expect(card(page)).toHaveAttribute('data-selection', 'active');
  for (const phase of [2, 3, 4]) {
    await publish(page, feed, phase);
    expect(await cardVehicle(page), `publication ${phase}: still the bus tapped on the map`).toBe(BRAVO.id);
  }
});

// Found on the real feed: with no route chosen the page offered the route of the latest report,
// re-taken at every publication, so the list and its suggestion jumped whenever another route
// reported last, and a bus followed from it was left under a list of another route.
test('with no route chosen, the route offered and its suggestion stay put while two routes take turns to report last', async ({page}) => {
  test.setTimeout(120_000);
  // Route 256 (FX-ALPHA, FX-BRAVO) and route 53 (FX-ATSTOP) take turns to hold the newest report.
  const turn = newest => () => {
    const live = pair({newer: 'ALPHA'});
    const other = live.vehicles.find(v => v.vehicle === 'FX-ATSTOP');
    const age = newest === '53' ? 3 : 30;
    other.observedAtMs = live.publishedAtMs - age * 1000;
    other.recordedAt = new Date(other.observedAtMs).toISOString().replace('.000Z', '+00:00');
    other.ageSeconds = age;
    return live;
  };
  const phases = [turn('256'), turn('53'), turn('256'), turn('53')];
  const feed = {phase: 0};
  await servePatterns(page);
  await serveLive(page, [() => phases[feed.phase]()]);
  await page.goto('/');
  await waitForPaint(page);
  const routeSelect = page.locator('#follow-route');
  await expect(routeSelect).toHaveValue('BNML|256', {timeout: 15_000});
  await expect.poll(() => cardVehicle(page), {timeout: 15_000}).toBe(ALPHA.id);
  await expect(card(page)).toHaveAttribute('data-selection', 'suggested');
  for (const phase of [1, 2, 3]) {
    await publish(page, feed, phase);
    await expect(routeSelect, `publication ${phase}: the route offered stays`).toHaveValue('BNML|256');
    expect(await cardVehicle(page), `publication ${phase}: the suggestion stays`).toBe(ALPHA.id);
  }
  // Followed with no stop chosen: one name for it, on the card and on the strip.
  await page.locator('.follow-toggle').click();
  await publish(page, feed, 1);
  await expect(routeSelect).toHaveValue('BNML|256');
  expect(await cardVehicle(page)).toBe(ALPHA.id);
  await expect(card(page).locator('.bus-card-eyebrow')).toHaveText('Selected bus');
  await expect(page.locator('.active-bus strong')).toContainText('Selected bus: 256');
});
