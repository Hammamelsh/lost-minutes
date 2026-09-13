// Walking guidance to the chosen boarding point.
//
// The router is answered from a RECORDED response: a real FOSSGIS OSRM foot route from
// Longford Park to Stretford Mall (Stop A), captured once on 13 September 2026
// (tests/browser/recorded). The live service is checked separately (walking-real.spec.mjs).
import {readFileSync} from 'node:fs';
import {test, expect} from '@playwright/test';
import {journeyLive, servePatterns, serveLive} from './fixtures.mjs';

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
  await expect(page.locator('.vector-map[data-map-state="painted"]')).toBeVisible({timeout: 45_000});
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
    await page.locator('.map-tools').getByRole('button', {name: 'Locate me'}).click();
    await page.waitForTimeout(2000);
    expect(calls, 'location jitter is not a new route').toHaveLength(1);
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
    const search = page.getByRole('combobox', {name: 'Stop name, street or area'});
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
  const search = page.getByRole('combobox', {name: 'Stop name, street or area'});
  await search.fill('stretford mall');
  await page.getByRole('option', {name: /Stop A/}).first().click();
  await expect(page.locator('.walk-guide')).toContainText('Walking directions start from your location');
  await expect(page.locator('.walk-guide').getByRole('button', {name: 'Locate me'})).toBeVisible();
  expect(calls).toHaveLength(0);
});
