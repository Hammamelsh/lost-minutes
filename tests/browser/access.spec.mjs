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
