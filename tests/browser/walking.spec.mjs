// Walking guidance to the chosen boarding point.
//
// The router is answered from a RECORDED response: a real FOSSGIS OSRM foot route from
// Longford Park to Stretford Mall (Stop A), captured once on 13 September 2026
// (tests/browser/recorded). The live service is checked separately (walking-real.spec.mjs).
import {readFileSync} from 'node:fs';
import {test, expect} from '@playwright/test';
import {journeyLive, servePatterns, serveLive, waitForPaint} from './fixtures.mjs';

// The start's controls fold into the disclosure once the start is confident; opened here first.
const openStart = async guide => {const d = guide.locator('[data-walk-details]'); if (!(await d.evaluate(e => e.open))) await d.locator('summary').click()};
const RECORDED = JSON.parse(readFileSync(
  new URL('./recorded/osrm-foot-longford-park-to-stretford-mall-stop-a.json', import.meta.url), 'utf8'));
// A precise fix: only its rounded form may reach the router.
const LONGFORD_PRECISE = {latitude: 53.448712, longitude: -2.309487, accuracy: 30};
const shot = async (page, name) =>
  page.screenshot({path: test.info().outputPath(`${test.info().project.name}-${name}.png`)});

async function routeWalking(page, reply) {
  const calls = [];
  await page.route('**/routed-foot/**', route => { calls.push(route.request().url()); return reply(route, calls.length); });
  return calls;
}

async function openAtStopA(page) {
  await servePatterns(page);
  await serveLive(page, [() => journeyLive()]);
  await page.goto('/');
  await waitForPaint(page);
  await page.getByRole('button', {name: 'Buses near me'}).click();
  await page.locator('.nearby-stop', {hasText: 'Stop A'}).first().click();
  await expect(page.locator('.your-stop-copy strong')).toContainText('Stretford Mall (Stop A)');
}

test.describe('with a location', () => {
  test.use({permissions: ['geolocation'], geolocation: LONGFORD_PRECISE});

  test('nothing is sent until asked; then a real walking route is on the map and the card', async ({page}) => {
    const calls = await routeWalking(page, route => route.fulfill({json: RECORDED}));
    const logs = [];
    page.on('console', message => logs.push(message.text()));
    await openAtStopA(page);
    const guide = page.locator('.walk-guide');
    await expect(guide).toContainText('routing.openstreetmap.de');
    await expect(guide).toContainText('rounded to about 10 m');
    await expect(guide).toContainText('straight line, not a walking route');
    expect(calls, 'no request before the passenger asks').toHaveLength(0);
    await page.getByRole('button', {name: 'Show walking route'}).click();
    await expect(guide).toContainText('5 min walk');
    await expect(guide).toContainText('340 m to Stretford Mall (Stop A)');
    await expect(guide).toContainText('Fix the map');
    await expect(page.locator('.bus-card')).toContainText('You: 5 min walk');
    await expect(page.locator('.bus-card .distance-lines')).toContainText('walking route from routing.openstreetmap.de');
    await expect(page.locator('.vector-map')).toHaveAttribute('data-walk', 'route');
    await expect(page.locator('.map-legend-chips')).toContainText('Walk');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('/route/v1/foot/-2.3095,53.4487;-2.31056,53.44629');
    expect(calls[0], 'the precise fix never leaves the device').not.toContain('53.448712');
    expect(page.url(), 'no location in the page address').not.toMatch(/53\.44|2\.30/);
    expect(logs.join('\n'), 'no location in the page’s own logs').not.toMatch(/53\.448|2\.309/);
    await shot(page, 'walking-route');
    // A 15 m wobble of the fix and another Locate me do not ask the router again.
    await page.context().setGeolocation({latitude: 53.44884, longitude: -2.30955, accuracy: 30});
    await openStart(page.locator('.walk-guide'));
    await page.locator('.walk-guide [data-update-location]').click();
    await page.waitForTimeout(2000);
    expect(calls, 'location jitter is not a new route').toHaveLength(1);
    await expect(page.locator('.map-tools').getByRole('button', {name: 'Locate me'}),
      'one Locate me at a time: the guide has it while a stop is chosen').toHaveCount(0);
  });

  test('a tight fix is stated plainly; the hand-off goes to the boarding point by coordinates, walking, with no origin', async ({page}) => {
    await routeWalking(page, route => route.fulfill({json: RECORDED}));
    await openAtStopA(page);
    await page.getByRole('button', {name: 'Show walking route'}).click();
    const guide = page.locator('.walk-guide');
    await expect(guide).toHaveAttribute('data-origin-band', 'confident');
    await expect(guide).toHaveAttribute('data-origin-kind', 'device');
    await expect(guide.locator('.walk-answer strong')).toHaveText('5 min walk');
    await expect(guide.locator('[data-caveat]')).toHaveCount(0);
    const href = await guide.locator('[data-maps-link]').getAttribute('href');
    const url = new URL(href);
    expect(url.origin + url.pathname).toBe('https://www.google.com/maps/dir/');
    expect(url.searchParams.get('api')).toBe('1');
    expect(url.searchParams.get('travelmode')).toBe('walking');
    expect(url.searchParams.get('destination'), 'Stop A by its coordinates, never its name').toBe('53.44629,-2.31056');
    expect(url.searchParams.get('origin'), 'the device decides where it is').toBeNull();
    expect(href).not.toMatch(/Stretford|Stop%20A|Stop\+A/);
    await guide.locator('[data-walk-details]').click();
    await expect(guide).toContainText('accurate to about 30 m');
    await expect(guide).toContainText('1800SJ');
    await shot(page, 'walking-confident');
  });

  test('a start the passenger chose outranks the device, is sent to Google Maps, and is given up only on request', async ({page}) => {
    // The recorded route is from Longford Park. A chosen start must re-ask the router from the
    // chosen point, so the fixture answers each call from the origin that call actually carried.
    const calls = await routeWalking(page, route => {
      const [lon, lat] = new URL(route.request().url()).pathname.split('/').pop().split(';')[0].split(',').map(Number);
      const body = JSON.parse(JSON.stringify(RECORDED));
      body.routes[0].geometry.coordinates[0] = [lon, lat];
      body.waypoints[0].location = [lon, lat];
      return route.fulfill({json: body});
    });
    await openAtStopA(page);
    await page.getByRole('button', {name: 'Show walking route'}).click();
    const guide = page.locator('.walk-guide');
    await openStart(guide);
    await guide.locator('[data-choose-start]').click();
    await expect(guide.locator('[data-picking]')).toContainText('Tap the map where you are starting from');
    const map = page.locator('.vector-map canvas').first();
    const box = await map.boundingBox();
    await map.click({position: {x: box.width * 0.4, y: box.height * 0.6}});
    await expect(guide).toHaveAttribute('data-origin-kind', 'chosen');
    await expect(guide).toHaveAttribute('data-origin-band', 'confident');
    await expect(guide).toContainText('Starting from a point on the map, which you chose');
    await expect.poll(() => calls.length, 'our router is asked again, from the chosen start').toBe(2);
    const chosenOrigin = new URL(calls[1]).pathname.split('/').pop().split(';')[0];
    expect(chosenOrigin, 'the second request starts where the passenger tapped').not.toBe('-2.3095,53.4487');
    expect(chosenOrigin, 'rounded to about 10 m; JS drops trailing zeros').toMatch(/^-2\.\d{1,4},53\.\d{1,4}$/);
    await expect(page.locator('.map-legend-chips .legend-you'), 'the legend names a chosen start as one').toHaveText('Starting point');
    await expect(guide.locator('[data-caveat]')).toHaveCount(0);
    const chosenHref = await guide.locator('[data-maps-link]').getAttribute('href');
    const chosen = new URL(chosenHref);
    expect(chosen.searchParams.get('origin'), 'a chosen start is sent').toMatch(/^53\.\d+,-2\.\d+$/);
    expect(chosen.searchParams.get('destination')).toBe('53.44629,-2.31056');
    await expect(guide.locator('[data-maps-link]')).toContainText('from your chosen start');
    await expect(page.locator('.your-stop-copy strong'), 'the stop is unchanged').toContainText('Stretford Mall (Stop A)');
    await shot(page, 'walking-chosen-start');
    // Reloading keeps the chosen start for this session.
    await page.reload();
    await waitForPaint(page);
    await expect(page.locator('.walk-guide')).toHaveAttribute('data-origin-kind', 'chosen');
    // Going back to the device is explicit.
    await openStart(page.locator('.walk-guide'));
    await page.locator('.walk-guide [data-update-location]').click();
    await expect(page.locator('.walk-guide')).toHaveAttribute('data-origin-kind', 'device');
    expect(new URL(await page.locator('.walk-guide [data-maps-link]').getAttribute('href')).searchParams.get('origin')).toBeNull();
  });

  test('a router failure is stated and retried on request, never replaced by a straight line', async ({page}) => {
    const calls = await routeWalking(page, (route, n) => n === 1
      ? route.fulfill({status: 502, contentType: 'text/html', body: '<html>bad gateway</html>'})
      : route.fulfill({json: RECORDED}));
    await openAtStopA(page);
    await page.getByRole('button', {name: 'Show walking route'}).click();
    const guide = page.locator('.walk-guide');
    await expect(guide).toContainText('The walking router answered 502');
    await expect(page.locator('.bus-card .distance-lines')).toContainText('straight line, not a walking route');
    await expect(page.locator('.vector-map')).toHaveAttribute('data-walk', 'none');
    await page.getByRole('button', {name: 'Try again'}).click();
    await expect(guide).toContainText('5 min walk');
    expect(calls).toHaveLength(2);
  });

  test('no path and an unreachable stop are said plainly', async ({page}) => {
    await routeWalking(page, route => route.fulfill({status: 400, json: {code: 'NoRoute', message: 'Impossible route'}}));
    await openAtStopA(page);
    await page.getByRole('button', {name: 'Show walking route'}).click();
    await expect(page.locator('.walk-guide')).toContainText('found no path between you and this stop');
    await expect(page.locator('.vector-map')).toHaveAttribute('data-walk', 'none');
  });
});

test.describe('with a loose location', () => {
  test.use({permissions: ['geolocation'], geolocation: {latitude: 53.448712, longitude: -2.309487, accuracy: 90}});

  test('the walk is routed but hedged, and says the start could be a street out', async ({page}) => {
    await routeWalking(page, route => route.fulfill({json: RECORDED}));
    await openAtStopA(page);
    await page.getByRole('button', {name: 'Show walking route'}).click();
    const guide = page.locator('.walk-guide');
    await expect(guide).toHaveAttribute('data-origin-band', 'uncertain');
    await expect(guide.locator('.walk-answer strong')).toContainText('about 5 min walk');
    await expect(guide.locator('[data-caveat]')).toContainText('Starting point uncertain');
    await expect(guide.locator('[data-caveat]')).toContainText('about 90 m out');
    await expect(guide.locator('[data-caveat]')).toContainText('street this starts from may be wrong');
    await expect(guide.locator('[data-update-location]')).toBeVisible();
    await expect(guide.locator('[data-choose-start]')).toBeVisible();
    await shot(page, 'walking-uncertain');
  });
});

test.describe('with a rough location', () => {
  test.use({permissions: ['geolocation'], geolocation: {latitude: 53.4487, longitude: -2.3095, accuracy: 1500}});
  test('an inaccurate fix is not routed from', async ({page}) => {
    const calls = await routeWalking(page, route => route.fulfill({json: RECORDED}));
    await openAtStopA(page);
    await expect(page.locator('.walk-guide')).toContainText('too rough to plan a walk from');
    expect(calls).toHaveLength(0);
  });
});

test.describe('far away', () => {
  test.use({permissions: ['geolocation'], geolocation: {latitude: 53.4808, longitude: -2.2426, accuracy: 20}});
  test('too far to walk is said before any request', async ({page}) => {
    const calls = await routeWalking(page, route => route.fulfill({json: RECORDED}));
    await servePatterns(page);
    await serveLive(page, [() => journeyLive()]);
    await page.goto('/');
    await page.getByRole('button', {name: 'Buses near me'}).click();
    const search = page.getByRole('combobox', {name: 'Bus number, stop or area'});
    await search.fill('stretford mall');
    await page.getByRole('option', {name: /Stop A/}).first().click();
    await expect(page.locator('.walk-guide')).toContainText('too far to plan a walk here');
    expect(calls).toHaveLength(0);
  });
});

test('without a location, walking directions say what they need', async ({page}) => {
  const calls = await routeWalking(page, route => route.fulfill({json: RECORDED}));
  await servePatterns(page);
  await serveLive(page, [() => journeyLive()]);
  await page.goto('/');
  const search = page.getByRole('combobox', {name: 'Bus number, stop or area'});
  await search.fill('stretford mall');
  await page.getByRole('option', {name: /Stop A/}).first().click();
  await expect(page.locator('.walk-guide')).toContainText('Walking directions start from your location');
  await expect(page.locator('.walk-guide').getByRole('button', {name: 'Locate me'})).toBeVisible();
  expect(calls).toHaveLength(0);
});
