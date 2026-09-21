// The stop-first passenger journey, on a labelled FIXTURE timetable over real stops.
//
// Every route, pattern and match here is a fixture (tests/browser/fixtures.mjs); the stop
// names are real NaPTAN records. Screenshots from these runs are captioned as fixtures.
import {readFileSync} from 'node:fs';
import {test, expect} from '@playwright/test';
import {FX, journeyLive, markerPixels, pixelVariety, serveLive, servePatterns, waitForPaint} from './fixtures.mjs';

// A real FOSSGIS OSRM foot route, recorded once (tests/browser/recorded), for the map's legend.
const RECORDED_WALK = JSON.parse(readFileSync(
  new URL('./recorded/osrm-foot-longford-park-to-stretford-mall-stop-a.json', import.meta.url), 'utf8'));

const LONGFORD_PARK = {latitude: 53.4487, longitude: -2.3095, accuracy: 40};
const shot = async (page, name) =>
  page.screenshot({path: test.info().outputPath(`${test.info().project.name}-${name}.png`)});
const camera = async page => {
  const value = await page.locator('.vector-map').getAttribute('data-camera');
  const [zoom, lat, lon, pitch, bearing] = (value || '0,0,0,0,0').split(',').map(Number);
  return {zoom, lat, lon, pitch, bearing};
};
const painted = page => page.locator('.vector-map[data-map-state="painted"]');

async function openAtStopA(page, {live = [() => journeyLive()]} = {}) {
  await servePatterns(page);
  const served = await serveLive(page, live);
  await page.goto('/');
  await waitForPaint(page);
  await page.getByRole('button', {name: 'Buses near me'}).click();
  await expect(page.getByText('Stops near you')).toBeVisible();
  await page.locator('.nearby-stop', {hasText: 'Stop A'}).first().click();
  await expect(page.locator('.your-stop-copy strong')).toContainText('Stretford Mall (Stop A)');
  return served;
}

test.describe('with location', () => {
  test.use({permissions: ['geolocation'], geolocation: LONGFORD_PARK});

  test('nearby stops tell the two sides of a road apart and say what leaves from each', async ({page}) => {
    await servePatterns(page);
    await serveLive(page, [() => journeyLive()]);
    await page.goto('/');
    await page.getByRole('button', {name: 'Buses near me'}).click();
    const stopA = page.locator('.nearby-stop', {hasText: 'Stop A'});
    const stopD = page.locator('.nearby-stop', {hasText: 'Stop D'});
    await expect(stopA).toContainText('eastbound');
    await expect(stopD).toContainText('westbound');
    await expect(stopA).toContainText('256 to Piccadilly Gardens');
    await expect(stopD).toContainText('No timetable coverage for this stop yet');
    await expect(page.locator('.nearby-stop', {hasText: 'Moss Road'}).first()).toContainText('No timetable coverage');
    await shot(page, 'nearby');
  });

  test('your stop leads to its services, the buses coming, and the bus standing there', async ({page}) => {
    await openAtStopA(page);
    // Destination-labelled services from this stop, both branches.
    const services = page.locator('.services');
    await expect(services).toContainText('256');
    await expect(services).toContainText('to Piccadilly Gardens');
    await expect(services).toContainText('to Chester Road (fixture branch)');
    // Buses coming: the one three stops away and the one on an unresolved branch; never the
    // bus already past, and never the route-53 bus that merely stands nearby.
    const waiting = page.locator('.waiting');
    await expect(waiting).toContainText('3 stops before yours');
    await expect(waiting).toContainText('on every possible branch');
    await expect(waiting).not.toContainText('Cheetham Hill');
    await expect(waiting.locator('.follow-row')).toHaveCount(2);
    // The answer card for the nearest confirmed bus.
    const card = page.locator('.bus-card');
    await expect(card.locator('.route-badge')).toHaveText('256');
    await expect(card).toContainText('Timetabled to call at your stop');
    await expect(card).toContainText('Last report nearest Sevenways · 3 stops before yours');
    await expect(card).toContainText('You to your stop');
    await expect(card).toContainText('straight line, not a walking route');
    await expect(card).toContainText('Bus to your stop');
    await expect(card).not.toContainText('Arrival time');
    await expect(card.locator('.stop-progress')).toContainText('your stop');
    await expect(card).not.toContainText(/\bETA\b|arrives in|\bdue\b/i);
    // Shown for them, not chosen by them: a suggestion until they follow it or pick a bus.
    await expect(card.locator('.bus-card-eyebrow')).toHaveText('Suggested bus');
    // The bus reported beside the stop is listed for what it is, not as "at your stop".
    await expect(page.getByText('At your stop now')).toHaveCount(0);
    const nearby = page.locator('.nearby-reports');
    await expect(nearby).toContainText('Last reported nearby');
    await expect(nearby).toContainText('53');
    await expect(nearby).toContainText('not confirmed for your stop');
    await shot(page, 'stop-a');
    // Picked on purpose, it is a selected bus that does not come here, with a way back.
    await nearby.locator('.follow-row').first().click();
    await expect(card.locator('.route-badge')).toHaveText('53');
    await expect(card.locator('.bus-card-eyebrow')).toHaveText('Selected bus');
    await expect(card).toContainText('Not confirmed for your stop');
    await expect(card).toContainText('No timetable pattern is held for BNSM route 53');
    await card.getByRole('button', {name: /Back to buses for your stop/}).click();
    await expect(card.locator('.route-badge')).toHaveText('256');
    // Everything else nearby is kept apart, not offered as a boarding option.
    await expect(page.locator('.exploring summary')).toContainText('More buses near your stop');
    await expect(page.locator('.exploring')).toContainText('Already past your stop');
  });

  test('a shared current stop is not a shared route: branching stays unresolved', async ({page}) => {
    await openAtStopA(page);
    await page.locator('.waiting .follow-row', {hasText: 'every possible branch'}).click();
    const card = page.locator('.bus-card');
    await expect(card).toContainText('Every possible branch calls at your stop');
    await expect(card).toContainText('2 stops before yours on every possible branch');
    await expect(card.locator('.stop-progress')).toContainText('branches part here');
    await card.locator('.bus-evidence-toggle summary').click();
    await expect(card.locator('.bus-evidence')).toContainText('Candidates kept');
    await shot(page, 'shared-stop');

    // A stop only one branch calls at: that is all that can be said.
    await page.getByRole('button', {name: 'Change'}).click();
    const search = page.getByRole('combobox', {name: 'Bus number, stop or area'});
    await search.fill('stretford public hall');
    await page.getByRole('option', {name: /Stop E/}).click();
    await page.locator('.maybe-coming .follow-row', {hasText: 'possible branches'}).click();
    await expect(card).toContainText('May call at your stop (1 of 2 possible branches)');
    await expect(card.locator('.bus-card-eyebrow')).toHaveText('Selected bus');
  });

  test('an explicitly chosen bus that leaves the feed stays chosen, and says so', async ({page}) => {
    await openAtStopA(page, {live: [() => journeyLive(), () => journeyLive({omit: ['FX-COMING']})]});
    await page.locator('.waiting .follow-row', {hasText: '3 stops before yours'}).click();
    const card = page.locator('.bus-card');
    await expect(card).toContainText('Sevenways');
    await expect(card).toHaveClass(/gone/, {timeout: 25_000});
    await expect(card).toContainText('No current report');
    await expect(card).toContainText('Nothing else has been chosen in its place');
    await expect(card.locator('.route-badge')).toHaveText('256');
  });
});

test('a stop without timetable coverage says so plainly', async ({page}) => {
  await servePatterns(page);
  await serveLive(page, [() => journeyLive()]);
  await page.goto('/');
  const search = page.getByRole('combobox', {name: 'Bus number, stop or area'});
  await search.fill('moss road derbyshire');
  await page.getByRole('option').first().click();
  await expect(page.locator('.your-stop-copy strong')).toContainText('Moss Road');
  // Said once, with what can be done next, not three times over.
  const empty = page.locator('.waiting .empty-state');
  await expect(empty).toContainText('No timetable is held for this stop');
  await expect(empty).toContainText('no bus can be confirmed');
  await expect(empty.getByRole('button', {name: 'Choose another stop'})).toBeVisible();
  await expect(page.getByText('No timetable is held for this stop')).toHaveCount(1);
});

test.describe('views and themes', () => {
  test.use({permissions: ['geolocation'], geolocation: LONGFORD_PARK});

  test('day and night repaint the same map instance', async ({page}) => {
    await openAtStopA(page);
    await expect(page.locator('.vector-map')).toHaveAttribute('data-theme', 'day');
    await page.evaluate(() => { window.__lmCanvas = document.querySelector('.maplibregl-canvas'); });
    await page.waitForTimeout(1200);
    await shot(page, 'theme-day');
    const day = await pixelVariety(page, page.locator('.vector-map'));
    await page.getByRole('button', {name: 'Switch to the night map'}).click();
    await expect(page.locator('.vector-map')).toHaveAttribute('data-theme', 'night');
    await page.waitForTimeout(1500);
    await shot(page, 'theme-night');
    const night = await pixelVariety(page, page.locator('.vector-map'));
    expect(await page.evaluate(() => document.querySelector('.maplibregl-canvas') === window.__lmCanvas),
      'the theme is repainted in place, not by rebuilding the map').toBe(true);
    expect(day.distinctColours).toBeGreaterThan(12);
    expect(night.distinctColours).toBeGreaterThan(12);
    const drawn = await markerPixels(page, page.locator('.vector-map'));
    expect(drawn.selectedBus, 'the chosen bus on the night map').toBeGreaterThan(15);
  });

  test('2D, City and the ride-along, and back again', async ({page}) => {
    await openAtStopA(page);
    await page.locator('.vector-map').evaluate(el => el.scrollIntoView({block: 'start'}));
    expect((await camera(page)).pitch).toBe(0);
    await page.getByRole('button', {name: 'City', exact: true}).click();
    await expect(page.locator('.vector-map')).toHaveAttribute('data-view', 'city');
    await expect.poll(async () => (await camera(page)).pitch, {timeout: 15_000}).toBeGreaterThan(40);
    await page.waitForTimeout(1500);
    await shot(page, 'city');

    await page.getByRole('button', {name: 'Ride along with route 256'}).click();
    await expect(page.locator('.vector-map')).toHaveAttribute('data-view', 'ride');
    // A short mode line; what a ride-along is sits behind a summary.
    await expect(page.locator('.ride-mode')).toContainText('Ride-along');
    await page.locator('.ride-about summary').click();
    await expect(page.locator('.ride-about')).toContainText('not a film from on board');
    await page.locator('.ride-about summary').click();
    await expect(page.locator('.vector-map')).toHaveAttribute('data-model', 'ready', {timeout: 15_000});
    // Above and behind the reported bearing (135°): the camera turns to it, the bus does not move.
    await expect.poll(async () => {
      const c = await camera(page);
      return c.zoom > 17.5 && c.pitch > 50 && Math.abs(c.bearing - 135) < 3;
    }, {timeout: 20_000}).toBe(true);
    await expect(page.locator('.ride-card')).toContainText('256');
    await expect(page.locator('.ride-card')).toContainText('3 stops before yours');
    await page.waitForTimeout(1200);
    await shot(page, 'ride');
    const drawn = await markerPixels(page, page.locator('.vector-map'), {model: [0xc6, 0xf3, 0x6a]}, 40);
    expect(drawn.model, 'the 3D bus is drawn').toBeGreaterThan(40);

    await page.getByRole('button', {name: 'Exit ride-along'}).click();
    await expect(page.locator('.vector-map')).toHaveAttribute('data-view', '2d');
    await expect.poll(async () => {const c = await camera(page); return c.pitch === 0 && c.bearing === 0;},
      {timeout: 15_000}).toBe(true);
  });

  test('if the 3D bus cannot load, the map keeps the symbol and says so', async ({page}) => {
    await page.route('**/models/lm-bus.json*', route => route.fulfill({status: 404, body: ''}));
    await openAtStopA(page);
    await page.getByRole('button', {name: 'City', exact: true}).click();
    await expect(page.locator('.vector-map')).toHaveAttribute('data-model', 'failed', {timeout: 15_000});
    await expect(page.locator('.map-notice')).toContainText('The 3D bus could not be loaded');
    await page.getByRole('button', {name: 'Ride along with route 256'}).click();
    await expect(page.locator('.vector-map')).toHaveAttribute('data-view', 'ride');
    await expect(painted(page)).toBeVisible();
    await page.waitForTimeout(2500);
    const drawn = await markerPixels(page, page.locator('.vector-map'));
    expect(drawn.selectedBus, 'the flat symbol stands in for the model').toBeGreaterThan(15);
  });
});

// Everything drawn over the map must leave everything else readable. These collisions came
// back once already, through a phone rule that lost to a later base rule on source order.
const OVER_MAP = ['.map-views', '.map-tools', '.ride-launch', '.map-legend-chips', '.map-credit-line'];
const OVER_RIDE = ['.ride-exit', '.ride-mode', '.ride-about', '.ride-note', '.ride-return', '.map-notice',
                   '.ride-card', '.map-tools', '.map-views', '.map-credit-line'];
async function collisions(page, selectors) {
  return page.evaluate(list => {
    const boxes = list.flatMap(selector => [...document.querySelectorAll(`.vector-map ${selector}`)]
      .map(element => ({selector, box: element.getBoundingClientRect(), style: getComputedStyle(element)}))
      .filter(({box, style}) => box.width && box.height && style.display !== 'none' && style.visibility !== 'hidden'));
    const hits = [];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i].box, b = boxes[j].box;
      if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1)
        hits.push(`${boxes[i].selector} × ${boxes[j].selector}`);
    }
    return hits;
  }, selectors);
}

test.describe('over the map', () => {
  test.use({permissions: ['geolocation'], geolocation: LONGFORD_PARK});

  test('controls, notes and the ride-along card never cover one another', async ({page}) => {
    await page.route('**/routed-foot/**', route => route.fulfill({json: RECORDED_WALK}));
    await openAtStopA(page);
    await page.locator('.vector-map').evaluate(el => el.scrollIntoView({block: 'start'}));
    await expect(page.locator('.ride-launch')).toBeVisible();
    expect(await collisions(page, OVER_MAP), 'controls over the flat map').toEqual([]);
    // A walking route adds a legend chip; the longer legend still leaves the ride button clear.
    await page.getByRole('button', {name: 'Show walking route'}).click();
    await expect(page.locator('.vector-map')).toHaveAttribute('data-walk', 'route');
    await page.locator('.vector-map').evaluate(el => el.scrollIntoView({block: 'start'}));
    await expect(page.locator('.legend-walk')).toBeVisible();
    expect(await collisions(page, OVER_MAP), 'controls over the flat map with a walking route').toEqual([]);
    await page.getByRole('button', {name: 'Ride along with route 256'}).click();
    await expect(page.locator('.ride-card')).toBeVisible();
    expect(await collisions(page, OVER_RIDE), 'ride-along, bus with a bearing').toEqual([]);
    await page.getByRole('button', {name: 'Exit ride-along'}).click();
    // A bus that reported no direction adds a second note under the disclaimer.
    await page.locator('.nearby-reports .follow-row').first().click();
    await page.getByRole('button', {name: 'Ride along with route 53'}).click();
    await expect(page.locator('.ride-note')).toBeVisible();
    expect(await collisions(page, OVER_RIDE), 'ride-along, bus without a bearing').toEqual([]);
  });

  test('a 3D model that fails leaves its notice clear of every control and note', async ({page}) => {
    await page.route('**/models/lm-bus.json*', route => route.fulfill({status: 404, body: 'missing'}));
    await openAtStopA(page);
    await page.locator('.vector-map').evaluate(el => el.scrollIntoView({block: 'start'}));
    await page.getByRole('button', {name: 'City', exact: true}).click();
    await expect(page.locator('.vector-map')).toHaveAttribute('data-model', 'failed', {timeout: 15_000});
    await expect(page.getByText('The 3D bus could not be loaded')).toBeVisible();
    expect(await collisions(page, [...OVER_MAP, '.map-notice']), 'City view with the model notice').toEqual([]);
    await page.getByRole('button', {name: 'Ride along with route 256'}).click();
    await expect(page.locator('.ride-card')).toBeVisible();
    await expect(page.getByText('The 3D bus could not be loaded')).toBeVisible();
    expect(await collisions(page, OVER_RIDE), 'ride-along with the model notice').toEqual([]);
  });
});

test.describe('a publication that has stopped', () => {
  test.use({permissions: ['geolocation'], geolocation: LONGFORD_PARK});

  test('is labelled, not shown as live, and its reports are aged from when they were made', async ({page}) => {
    await openAtStopA(page, {live: [() => journeyLive({publishedAgoSeconds: 600})]});
    await expect(page.locator('.follow-badge')).toContainText('NOT UPDATING');
    // Ten minutes, said as ten minutes. This asserted /updated \d+s ago/ until 18 September 2026,
    // which passed while the bar was reading "updated 94646s ago" after this machine slept — a
    // number nobody reads as "yesterday". The fixture publishes 600 s ago, so the exact wording is
    // asserted rather than a shape that cannot tell 600 s from a day.
    await expect(page.locator('.follow-bar-when')).toContainText('updated 10 min ago');
    // A report inside a file published ten minutes ago is at least ten minutes old, whatever
    // age the publisher wrote beside it at the time. Old reports are not offered as your bus:
    // they are listed apart, aged from when they were made.
    await expect(page.locator('.waiting .empty-state')).toContainText('only old reports');
    await page.locator('.exploring summary').click();
    await expect(page.locator('.exploring .board-group', {hasText: 'Old reports'})).toBeVisible();
    await expect(page.locator('.exploring .fresh-chip').first()).toContainText(/1[01] min ago/);
    await shot(page, 'stale');
  });
});

test('the stop progress fixture is consistent with the real stop catalogue', async ({page}) => {
  // Guards the fixture itself: every stop it uses must exist in the served stops.json.
  const stops = await (await page.request.get('/data/stops.json')).json();
  const ids = new Set(stops.stops.map(s => s.id));
  for (const [atco] of FX.main) expect(ids.has(atco), atco).toBe(true);
  for (const atco of FX.branchTail) expect(ids.has(atco), atco).toBe(true);
});
