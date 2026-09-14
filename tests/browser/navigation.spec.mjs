// The passenger's page and the views behind the data, and coming back to the app. FIXTURE buses on a
// FIXTURE timetable over real NaPTAN stops around Stretford Mall. The passenger's page has no tabs
// and never waits for the recording; the engineering views sit under "Behind the data", open from
// a link or the address, and going there and back changes nothing the passenger chose.
import {test, expect} from '@playwright/test';
import {fastConfig, movingLive, serveLive, serveMotion, servePatterns, waitForPaint} from './fixtures.mjs';

const LONGFORD_PARK = {latitude: 53.4487, longitude: -2.3095, accuracy: 40};
test.use({permissions: ['geolocation'], geolocation: LONGFORD_PARK});
const map = page => page.locator('.vector-map');
const search = page => page.getByRole('combobox', {name: 'Stop name, street or area'});
const dataTitle = page => page.getByRole('heading', {level: 1, name: 'How Lost Minutes is built.'});

async function open(page, {replay} = {}) {
  await servePatterns(page);
  await serveMotion(page);
  const startMs = Date.now() - 90_000;
  await serveLive(page, [() => movingLive({startMs, startS: 150, speed: 7})]);
  if (replay) await page.route('**/data/replay.json', replay);
}

async function atStopA(page) {
  await page.getByRole('button', {name: 'Buses near me'}).click();
  await page.locator('.nearby-stop', {hasText: 'Stop A'}).first().click();
  await expect(page.locator('.your-stop-copy strong')).toContainText('Stretford Mall (Stop A)');
}

test('the passenger’s page has no tabs, and finding a stop does not wait for the recording', async ({page}) => {
  await open(page, {replay: async route => { await new Promise(r => setTimeout(r, 10_000)); await route.continue().catch(() => {}); }});
  await page.goto('/');
  await expect(search(page), 'before the 1.6 MB recording has arrived').toBeVisible({timeout: 5000});
  await expect(page.getByRole('button', {name: 'Buses near me'})).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(0);
  await expect(page.getByText('Loading the Manchester recording')).toHaveCount(0);
  await expect(page.getByRole('link', {name: /^Behind the data/}).first()).toBeVisible();
});

test('with no recording at all the passenger’s page still works, and the recorded view says why it is empty', async ({page}) => {
  await open(page, {replay: route => route.fulfill({status: 404, body: 'missing'})});
  await page.goto('/');
  await waitForPaint(page);
  await atStopA(page);
  await expect(page.locator('article.bus-card')).toHaveAttribute('data-vehicle', 'FX-MOVING');
  await page.goto('/#recorded-journeys');
  await expect(page.locator('#recorded-journeys')).toContainText('The recorded sample could not be loaded');
});

test('behind the data: one entry, three views, links straight to each, and Back returns to the buses', async ({page}) => {
  await open(page);
  await page.goto('/');
  await waitForPaint(page);
  await page.getByRole('link', {name: /^Behind the data/}).first().click();
  await expect(page).toHaveURL(/#behind-the-data$/);
  await expect(dataTitle(page)).toBeFocused();
  await expect(page.locator('.data-steps li')).toHaveCount(4);
  await expect(page.getByRole('tab', {name: 'Operations'})).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', {name: 'Recorded journeys'}).click();
  await expect(page).toHaveURL(/#recorded-journeys$/);
  const note = page.locator('#recorded-journeys .archive-note');
  await expect(note).toContainText('ARCHIVE REPLAY');
  await expect(note).toContainText('not live');
  await expect(note).toContainText('September 2026');
  await page.goBack();
  await expect(page.getByRole('tab', {name: 'Operations'})).toHaveAttribute('aria-selected', 'true');
  await page.goBack();
  await expect(search(page)).toBeVisible();
  await expect(dataTitle(page)).toHaveCount(0);
  await page.goto('/#evidence');
  await expect(page.getByRole('tab', {name: 'Evidence'})).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('link', {name: 'Back to buses'}).click();
  await expect(search(page)).toBeVisible();
});

test('going behind the data and back keeps the stop, the chosen bus, the ride-along and the map itself', async ({page}) => {
  test.setTimeout(90_000);
  await open(page);
  await page.goto('/');
  await waitForPaint(page);
  await atStopA(page);
  await page.getByRole('region', {name: 'Buses coming to your stop'}).locator('.follow-row').first().click();
  const card = page.locator('article.bus-card');
  await expect(card).toHaveAttribute('data-selection', 'active');
  const vehicle = await card.getAttribute('data-vehicle');
  await map(page).evaluate(el => el.scrollIntoView({block: 'start'}));
  await page.getByRole('button', {name: /^Ride along with route/}).click();
  await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 15_000});
  await page.evaluate(() => { window.__lmCanvas = document.querySelector('.maplibregl-canvas'); });
  await page.getByRole('link', {name: /^Behind the data/}).first().click();
  await expect(dataTitle(page)).toBeVisible();
  await expect(page.locator('#follow')).toHaveAttribute('inert', '');
  await page.waitForTimeout(12_000);                  // publications go by while the passenger is away
  await page.getByRole('link', {name: 'Back to buses'}).click();
  await expect(page.locator('.your-stop-copy strong')).toContainText('Stretford Mall (Stop A)');
  await expect(card).toHaveAttribute('data-vehicle', vehicle);
  await expect(card).toHaveAttribute('data-selection', 'active');
  await expect(map(page)).toHaveAttribute('data-ride', 'following');
  expect(await page.evaluate(() => document.querySelector('.maplibregl-canvas') === window.__lmCanvas),
    'the same map, not a new one').toBe(true);
});

test('a view behind the data that cannot read its file says so in place, and the passenger’s page lives on', async ({page}) => {
  // The FIXTURE motion evaluation has no replay of journeys: it used to take the whole page down.
  await open(page);
  await page.goto('/#evidence');
  await expect(page.getByText('could not be read in full')).toBeVisible({timeout: 20_000});
  await expect(page.getByText('This page couldn’t load')).toHaveCount(0);
  await page.getByRole('link', {name: 'Back to buses'}).click();
  await expect(search(page)).toBeVisible();
});

test('saved stops come first when the app is opened again, with an honest word about this address', async ({page, context}) => {
  await open(page);
  await page.goto('/');
  await waitForPaint(page);
  await atStopA(page);
  await page.getByRole('button', {name: 'Save this stop'}).click();
  await page.getByRole('button', {name: 'Change'}).click();
  const saved = page.getByRole('region', {name: 'Saved on this phone'});
  await expect(saved.getByRole('button', {name: /Stretford Mall · Stop A/})).toBeVisible();
  await expect(saved, 'this test runs on 127.0.0.1, an address that will not last').toContainText('temporary');
  expect((await saved.boundingBox()).y, 'above finding a new stop')
    .toBeLessThan((await page.getByRole('button', {name: 'Buses near me'}).boundingBox()).y);
  const again = await context.newPage();
  await open(again);
  await again.goto('/');
  const chip = again.getByRole('region', {name: 'Saved on this phone'}).getByRole('button', {name: /Stretford Mall · Stop A/});
  await expect(chip).toBeVisible({timeout: 20_000});
  await chip.click();
  await expect(again.locator('.your-stop-copy strong')).toContainText('Stretford Mall (Stop A)');
});

test('a saved route is one tap away at the top when the app is opened again', async ({page, context}) => {
  await open(page);
  await page.goto('/');
  await waitForPaint(page);
  await page.getByRole('region', {name: 'Follow a route'}).getByRole('button', {name: 'Save this route on this device'}).click();
  const again = await context.newPage();
  await open(again);
  await again.goto('/');
  await expect(again.getByRole('region', {name: 'Saved on this phone'}).getByRole('button', {name: /^Route \d+/}))
    .toBeVisible({timeout: 20_000});
});

test('coming back online asks for fresh positions at once, not at the next poll', async ({page, context}) => {
  await open(page);
  // A minute between polls, so a request soon after reconnecting can only be the reconnection's.
  await page.route('**/data/config.json*', route => route.fulfill({json: {...fastConfig(), pollSeconds: 60}}));
  const asked = [];
  page.on('request', request => { if (/\/data\/live\.json/.test(request.url())) asked.push(Date.now()); });
  await page.goto('/');
  await waitForPaint(page);
  await context.setOffline(true);
  await page.waitForTimeout(4000);
  const before = asked.length, back = Date.now();
  await context.setOffline(false);
  await expect.poll(() => asked.length, {timeout: 3000, message: 'a request within 3 s of reconnecting'}).toBeGreaterThan(before);
  expect(asked[before] - back).toBeLessThan(3000);
});

test('on a phone, upright or on its side, the ride’s controls are all within reach, the street preview included', async ({page}) => {
  test.skip(test.info().project.name !== 'mobile', 'a phone held both ways');
  test.setTimeout(120_000);
  await open(page);
  await page.goto('/');
  await waitForPaint(page);
  await atStopA(page);
  await map(page).evaluate(el => el.scrollIntoView({block: 'start'}));
  await page.getByRole('button', {name: /^Ride along with route/}).click();
  await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 15_000});
  // What is drawn at the middle of each control is the control itself: nothing on the page covers
  // it (a strip stuck to the top of the screen once covered the way out).
  const reachable = async orientation => {
    await map(page).evaluate(el => el.scrollIntoView({block: 'start'}));
    await page.waitForTimeout(1200);
    // "What is this?" opens a disclosure: a summary, not a button.
    const controls = {'Exit ride-along': page.getByRole('button', {name: 'Exit ride-along', exact: true}),
      'What is this?': page.locator('.ride-about > summary'), 'Front view': page.getByRole('button', {name: 'Front view', exact: true})};
    for (const [name, control] of Object.entries(controls)) {
      const box = await control.boundingBox();
      const hit = await page.evaluate(({x, y}) => document.elementFromPoint(x, y)?.closest('button, summary')?.textContent?.trim() ?? null,
        {x: box.x + box.width / 2, y: box.y + box.height / 2});
      expect(hit, `${orientation}: nothing covers ${name}`).toContain(name.replace('?', ''));
    }
  };
  await reachable('upright');
  await page.setViewportSize({width: 844, height: 390});
  await reachable('on its side');
  await page.getByRole('button', {name: 'Front view', exact: true}).click();
  await expect(map(page)).toHaveAttribute('data-ride-camera', 'front');
});

test('with the keyboard up, the search field rises so that its matches are in view', async ({page}) => {
  test.skip(test.info().project.name !== 'mobile', 'a phone’s on-screen keyboard');
  await open(page);
  await page.goto('/');
  await waitForPaint(page);
  // A shorter viewport stands in for the keyboard: the page cannot see a real one here.
  await page.setViewportSize({width: 390, height: 844 - 336});
  await search(page).tap();
  await search(page).fill('stretford');
  await page.waitForTimeout(1000);
  const inView = await page.evaluate(() => [...document.querySelectorAll('.stop-search-option')].slice(0, 3)
    .map(option => { const r = option.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }));
  expect(inView, 'the first three matches above the keyboard').toEqual([true, true, true]);
});
