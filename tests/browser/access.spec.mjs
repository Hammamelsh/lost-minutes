// A passenger using only the keyboard, and a page whose map tiles or live positions are slow to
// arrive. FIXTURE buses on a FIXTURE timetable over real NaPTAN stops around Stretford Mall.
import {test, expect} from '@playwright/test';
import {fastConfig, journeyLive, servePatterns, serveLive, waitForPaint} from './fixtures.mjs';

const LONGFORD_PARK = {latitude: 53.4487, longitude: -2.3095, accuracy: 40};
test.use({permissions: ['geolocation'], geolocation: LONGFORD_PARK});

/** Press Tab until the focused element matches, as a keyboard user would, and fail if it never is. */
async function tabTo(page, what, matches, max = 160) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    if (await page.evaluate(matches)) return;
  }
  throw new Error(`${what} was not reached with the Tab key in ${max} presses`);
}
const dropped = page => page.evaluate(() => !document.activeElement || document.activeElement === document.body);
/** A focus ring, or the search field's own ring around its input. */
const focusShows = page => page.evaluate(() => {
  const el = document.activeElement;
  if (!el || el === document.body) return false;
  const s = getComputedStyle(el);
  const field = el.closest('.stop-search-field');
  return (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || (s.boxShadow && s.boxShadow !== 'none')
    || Boolean(field && getComputedStyle(field).boxShadow !== 'none');
});

test('using only the keyboard: find the stop, choose a bus, follow it, ride along, return to its card and leave', async ({page}) => {
  test.skip(test.info().project.name !== 'desktop', 'a keyboard journey is a desktop journey');
  test.setTimeout(180_000);
  await servePatterns(page);
  await serveLive(page, [() => journeyLive()]);
  await page.goto('/');
  await waitForPaint(page);
  const card = page.locator('article.bus-card'), map = page.locator('.vector-map');

  await tabTo(page, 'the stop search', () => document.activeElement?.getAttribute('role') === 'combobox');
  expect(await focusShows(page), 'focus shows on the search').toBe(true);
  await page.keyboard.type('Stretford Mall');
  await expect(page.locator('.stop-search-option').first()).toBeVisible();
  for (let i = 0; i < 12 && !(await page.locator('.stop-search-option.active').textContent())?.includes('Stop A'); i++)
    await page.keyboard.press('ArrowDown');
  await expect(page.locator('.stop-search-option.active')).toContainText('Stop A');
  await page.keyboard.press('Enter');
  await expect(page.locator('.your-stop-copy strong')).toContainText('Stretford Mall (Stop A)');

  await tabTo(page, 'the bus coming to the stop', () => document.activeElement?.classList.contains('follow-row')
    && document.activeElement.textContent.includes('to Piccadilly Gardens'));
  expect(await focusShows(page), 'focus shows on the bus row').toBe(true);
  await page.keyboard.press('Enter');
  await expect(card).toHaveAttribute('data-selection', 'active');
  const vehicle = await card.getAttribute('data-vehicle');

  await tabTo(page, 'Follow', () => document.activeElement?.classList.contains('follow-toggle'));
  await page.keyboard.press('Enter');
  await expect(page.locator('.follow-toggle')).toHaveAttribute('aria-pressed', 'true');

  await tabTo(page, 'Ride along', () => /^Ride along with route/.test(document.activeElement?.getAttribute('aria-label') ?? ''));
  await page.keyboard.press('Enter');
  await expect(map).toHaveAttribute('data-ride', 'following', {timeout: 15_000});
  expect(await dropped(page), 'focus is kept when the ride begins').toBe(false);

  await tabTo(page, 'Details under the map', () => Boolean(document.activeElement?.closest('.active-bus'))
    && document.activeElement.textContent.trim() === 'Details');
  await page.keyboard.press('Enter');
  await expect(card, 'Details takes focus to the card').toBeFocused();

  await tabTo(page, 'the way out of the ride', () => /Leave the ride-along|Exit ride-along/.test(
    `${document.activeElement?.getAttribute('aria-label') ?? ''} ${document.activeElement?.textContent ?? ''}`));
  await page.keyboard.press('Enter');
  await expect(map).toHaveAttribute('data-ride', 'off');
  expect(await dropped(page), 'focus is kept when the ride ends').toBe(false);
  expect(await card.getAttribute('data-vehicle'), 'the same bus throughout').toBe(vehicle);
});

test('slow map tiles: the map says it is drawing, the rest of the page works meanwhile, and then it draws', async ({page}) => {
  test.setTimeout(90_000);
  await servePatterns(page);
  await serveLive(page, [() => journeyLive()]);
  await page.route(/tiles\.openfreemap\.org\/.*\.pbf/, async route => {
    await new Promise(resolve => setTimeout(resolve, 6000));
    await route.continue().catch(() => {});
  });
  await page.goto('/');
  const map = page.locator('.vector-map');
  await expect(page.locator('.map-loading')).toContainText('Drawing the map');
  await expect(map).not.toHaveAttribute('data-map-state', 'painted');
  await expect(page.locator('.follow-badge')).toContainText('LIVE');
  await page.getByRole('button', {name: 'Buses near me'}).click();
  await page.locator('.nearby-stop', {hasText: 'Stop A'}).first().click();
  await expect(page.locator('article.bus-card')).toHaveAttribute('data-vehicle', 'FX-COMING');
  await waitForPaint(page, {timeout: 40_000});
  await expect(page.locator('.map-loading')).toHaveCount(0);
});

test('while the detailed map is slow, the simple map is offered and works, and the detailed map can come back', async ({page}) => {
  test.setTimeout(120_000);
  await servePatterns(page);
  await serveLive(page, [() => journeyLive()]);
  await page.route(/tiles\.openfreemap\.org\/.*\.pbf/, async route => {
    await new Promise(resolve => setTimeout(resolve, 8000));
    await route.continue().catch(() => {});
  });
  await page.goto('/');
  await page.getByRole('button', {name: 'Buses near me'}).click();
  await page.locator('.nearby-stop', {hasText: 'Stop A'}).first().click();
  const card = page.locator('article.bus-card');
  await expect(card, 'the bus information is there before the map').toHaveAttribute('data-vehicle', 'FX-COMING');
  const simple = page.getByRole('button', {name: 'Use the simple map'});
  await expect(simple, 'offered while the detailed map is slow').toBeVisible({timeout: 8000});
  await expect(simple, 'seen whole on the first screen, not found by scrolling').toBeInViewport({ratio: 1});
  await page.screenshot({path: test.info().outputPath(`${test.info().project.name}-slow-map-offer.png`)});
  await simple.click();
  await expect(page.locator('.map-fallback-wrap')).toHaveAttribute('data-map-fallback', 'chosen');
  await expect(page.locator('.follow-map svg[role="img"]')).toBeVisible();
  await expect(card).toHaveAttribute('data-vehicle', 'FX-COMING');
  await page.getByRole('button', {name: 'Use the detailed map'}).click();
  await expect(page.locator('.map-fallback-wrap')).toHaveCount(0);
  await waitForPaint(page, {timeout: 60_000});
});

test('one Locate me at a time: the walk guide\'s while it asks for the location, then the detailed map\'s own', async ({page}) => {
  await servePatterns(page);
  await serveLive(page, [() => journeyLive()]);
  await page.goto('/');
  await waitForPaint(page);
  const locate = page.getByRole('button', {name: 'Locate me'});
  // Found by name before any location: the walk guide asks for one, and has the only Locate me.
  await page.getByRole('combobox', {name: 'Stop name, street or area'}).fill('stretford mall');
  await page.getByRole('option', {name: /Stop A/}).first().click();
  await expect(page.locator('.walk-guide')).toContainText('Walking directions start from your location');
  await expect(locate).toHaveCount(1);
  await expect(page.locator('.walk-guide').getByRole('button', {name: 'Locate me'})).toBeVisible();
  await locate.click();
  // Located: the walk guide stops asking, and the map's own is the one.
  await expect(page.locator('.walk-guide')).not.toContainText('Walking directions start from your location');
  await expect(locate).toHaveCount(1);
  await expect(page.locator('.vector-map .map-tools').getByRole('button', {name: 'Locate me'})).toBeVisible();
});

test('one Locate me when the stop is found near you: the detailed map\'s own', async ({page}) => {
  await servePatterns(page);
  await serveLive(page, [() => journeyLive()]);
  await page.goto('/');
  await waitForPaint(page);
  await page.getByRole('button', {name: 'Buses near me'}).click();
  await page.locator('.nearby-stop', {hasText: 'Stop A'}).first().click();
  await expect(page.locator('.your-stop-copy strong')).toContainText('Stretford Mall (Stop A)');
  await expect(page.getByRole('button', {name: 'Locate me'})).toHaveCount(1);
  await expect(page.locator('.vector-map .map-tools').getByRole('button', {name: 'Locate me'})).toBeVisible();
});

test('with the simple map in place of the detailed one, Locate me is beside the stop instead', async ({page}) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      return /webgl/i.test(String(type)) ? null : original.call(this, type, ...rest);
    };
  });
  await servePatterns(page);
  await serveLive(page, [() => journeyLive()]);
  await page.goto('/');
  await expect(page.locator('.map-fallback-wrap')).toHaveAttribute('data-map-fallback', 'no_webgl');
  await page.getByRole('button', {name: 'Buses near me'}).click();
  await page.locator('.nearby-stop', {hasText: 'Stop A'}).first().click();
  await expect(page.getByRole('button', {name: 'Locate me'})).toHaveCount(1);
  await expect(page.locator('.your-stop-actions').getByRole('button', {name: 'Locate me'})).toBeVisible();
});

test('the map can be made bigger for following a bus, and smaller again, as the same map', async ({page}) => {
  await servePatterns(page);
  await serveLive(page, [() => journeyLive()]);
  await page.goto('/');
  await waitForPaint(page);
  const map = page.locator('.vector-map'), viewport = page.viewportSize();
  const before = (await map.boundingBox()).height;
  await page.evaluate(() => { window.__lmCanvas = document.querySelector('.maplibregl-canvas'); });
  await page.getByRole('button', {name: 'Make the map bigger'}).click();
  await expect.poll(async () => (await map.boundingBox()).height, {message: 'most of the screen'}).toBeGreaterThan(viewport.height * 0.9);
  await expect.poll(async () => Math.abs((await page.locator('.maplibregl-canvas').boundingBox()).height - (await map.boundingBox()).height),
    {message: 'the map drawn at its new size'}).toBeLessThan(3);
  await expect(page.getByRole('button', {name: 'Make the map smaller'})).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => document.querySelector('.maplibregl-canvas') === window.__lmCanvas), 'the same map').toBe(true);
  await page.getByRole('button', {name: 'Make the map smaller'}).click();
  await expect.poll(async () => Math.round((await map.boundingBox()).height)).toBe(Math.round(before));
});

test('slow live positions: said to be on their way, never "not collecting" or "no bus", and the page stays usable', async ({page}) => {
  test.setTimeout(90_000);
  await servePatterns(page);
  let first = true;
  await page.route('**/data/config.json*', route => route.fulfill({json: fastConfig()}));
  await page.route('**/data/live.json*', async route => {
    if (first) { first = false; await new Promise(resolve => setTimeout(resolve, 9000)); }
    await route.fulfill({json: journeyLive(), headers: {date: new Date().toUTCString()}});
  });
  await page.goto('/');
  const bar = page.locator('.follow-bar');
  await expect(bar).toContainText('CHECKING', {timeout: 4000});
  await expect(bar).toContainText('waiting for the first positions');
  await expect(bar).not.toContainText('NOT COLLECTING');
  await expect(page.locator('.follow-empty')).toHaveCount(0);
  await page.getByRole('button', {name: 'Buses near me'}).click();
  await page.locator('.nearby-stop', {hasText: 'Stop A'}).first().click();
  await expect(page.locator('.your-stop-copy strong')).toContainText('Stretford Mall (Stop A)');
  await expect(page.getByText('Checking for live positions')).toBeVisible();
  await expect(page.getByText('has a current report')).toHaveCount(0);
  await expect(page.locator('.follow-badge')).toContainText('LIVE', {timeout: 20_000});
  await expect(page.locator('article.bus-card')).toHaveAttribute('data-vehicle', 'FX-COMING');
  await expect(page.getByText('Checking for live positions')).toHaveCount(0);
});
