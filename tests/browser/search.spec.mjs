// One search for a bus number, a stop or an area; the route as the timetable knows it; stops on
// the map; browsing stops where the map was moved to. FIXTURE timetable (route 256 on real NaPTAN
// stops) with the real stop catalogue, in Chromium at desktop and phone size.
import {test, expect} from '@playwright/test';
import {FX, foldSheet, journeyLive, mapBand, serveLive, servePatterns, unavailableState, unfoldSheet, waitForPaint} from './fixtures.mjs';

const LONGFORD_PARK = {latitude: 53.4487, longitude: -2.3095, accuracy: 40};
const search = page => page.getByRole('combobox', {name: 'Bus number, stop or area'}).first();
const options = page => page.locator('.stop-search-list [role=option]');
const map = page => page.locator('.vector-map');

/** A one-finger drag across the map: a mouse drag on the desktop, touch events (CDP) on the phone,
 *  where an emulated mouse does not pan MapLibre. */
async function dragMap(page, box, dx, dy, steps = 12) {
  const x0 = box.x + box.width / 2, y0 = box.y + box.height / 2;
  if (test.info().project.name !== 'mobile') {
    await page.mouse.move(x0, y0); await page.mouse.down();
    for (let i = 1; i <= steps; i++) { await page.mouse.move(x0 - dx * i / steps, y0 - dy * i / steps); await page.waitForTimeout(20); }
    await page.mouse.up();
    return;
  }
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', {type, touchPoints: type === 'touchEnd' ? [] : [{x, y}]});
  await touch('touchStart', x0, y0);
  for (let i = 1; i <= steps; i++) { await touch('touchMove', x0 - dx * i / steps, y0 - dy * i / steps); await page.waitForTimeout(20); }
  await touch('touchEnd', 0, 0);
  await cdp.detach();
}

async function open(page, live = () => journeyLive()) {
  await servePatterns(page);
  await serveLive(page, [live]);
  await page.goto('/');
  await waitForPaint(page);
}

test('a bus number finds the route from the timetable, even with no bus reporting on it', async ({page}) => {
  await open(page, () => unavailableState());
  await search(page).fill('256');
  await expect(options(page).first()).toContainText('Route 256');
  await expect(page.locator('.stop-search-group').first()).toHaveText('Routes');
  // An exact number ahead of numbers that begin with it: "25" lists 256 too, but after any exact 25.
  await search(page).fill('25');
  await expect(options(page).first()).toContainText('Route 256');
  await search(page).fill('256');
  await options(page).first().dispatchEvent('mousedown');
  const panel = page.locator('.route-panel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('.route-directions button')).toHaveCount(2);
  await expect(panel.locator('.route-directions button').first()).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.locator('[data-route-buses]')).toContainText('No bus on this route is reporting right now');
  // Its stops, from the timetable, each a stop to choose.
  await expect(panel.locator('.route-stop')).toHaveCount(FX.main.length);
  await panel.locator('.route-directions button').nth(1).click();
  await expect(panel.locator('.route-directions button').nth(1)).toHaveAttribute('aria-pressed', 'true');
  await panel.locator('.route-stop', {hasText: 'Stretford Mall'}).first().click();
  await expect(page.locator('.your-stop-copy strong')).toContainText('Stretford Mall');
  await expect(page.locator('.waiting')).toBeVisible();
  // The search is still there with a stop chosen, compact, and a stop found from it changes stop.
  await expect(page.locator('.stop-search.compact')).toBeVisible();
  await search(page).fill('stretford public hall');
  await options(page).first().dispatchEvent('mousedown');
  await expect(page.locator('.your-stop-copy strong')).toContainText('Stretford Public Hall');
});

test('a route searched at a stop it serves filters the board, and the filter is cleared in one press', async ({page}) => {
  await open(page);
  await search(page).fill('stretford mall');
  await options(page).first().dispatchEvent('mousedown');
  await expect(page.locator('.your-stop-copy strong')).toContainText('Stretford Mall');
  await search(page).fill('256');
  await options(page).first().dispatchEvent('mousedown');
  await expect(page.locator('.waiting .section-head')).toContainText('256 to');
  // The filter is shown as the pressed service chip, and one press of it clears it.
  const pressed = page.locator('.service-chip[aria-pressed="true"]');
  await expect(pressed).toHaveCount(1);
  await expect(pressed).toHaveAccessibleName(/^Clear filter: 256/);
  await pressed.click();
  await expect(page.locator('.waiting .section-head')).toContainText('Coming to your stop');
});

test('a stop name lists both sides of the road, each with its direction; nothing matching says what to try', async ({page}) => {
  await open(page);
  await search(page).fill('hillingdon road');
  await expect(options(page)).toHaveCount(2);
  await expect(options(page).nth(0)).toContainText('south-westbound');
  await expect(options(page).nth(1)).toContainText('north-eastbound');
  await search(page).fill('zzzz');
  await expect(page.locator('.stop-search-empty')).toContainText('Try a bus number');
  // Keyboard: down, down, Enter chooses the second.
  await search(page).fill('hillingdon road');
  await search(page).press('ArrowDown');
  await search(page).press('Enter');
  await expect(page.locator('.your-stop-copy strong')).toContainText('Hillingdon Road (opp)');
});

test.describe('stops on the map', () => {
  test.use({permissions: ['geolocation'], geolocation: LONGFORD_PARK});

  test('tapping a stop ring on the map chooses that stop; the other side of the road is its own ring', async ({page}) => {
    test.setTimeout(90_000);
    await open(page);
    await search(page).fill('hillingdon road');
    await options(page).first().dispatchEvent('mousedown');
    await expect(page.locator('.your-stop-copy strong')).toContainText('Hillingdon Road (nr)');
    await map(page).evaluate(el => el.scrollIntoView({block: 'start'}));
    // The map is the subject here: on a phone the passenger pulls the sheet down to it first.
    await foldSheet(page);
    await page.getByRole('button', {name: 'Fit journey'}).click();
    await page.waitForTimeout(1500);
    // Zoom in around the chosen stop itself, by double-tapping it (a tap on the chosen stop is
    // nothing new, so the double-tap zooms and the map is not re-fitted), until it is a street zoom
    // at which the other side of the road is many pixels away.
    const canvas = page.locator('.vector-map-canvas');
    for (let i = 0; i < 4; i++) {
      const box = await canvas.boundingBox();
      const [sx, sy] = (await map(page).getAttribute('data-stop-screen')).split(',').map(Number);
      const x = box.x + sx, y = box.y + sy;
      if (test.info().project.name === 'mobile') { await page.touchscreen.tap(x, y); await page.waitForTimeout(80); await page.touchscreen.tap(x, y); }
      else await page.mouse.dblclick(x, y);
      await page.waitForTimeout(900);
      const [z] = (await map(page).getAttribute('data-camera')).split(',').map(Number);
      if (z > 16.5) break;
    }
    const [z] = (await map(page).getAttribute('data-camera')).split(',').map(Number);
    expect(z, 'a street zoom').toBeGreaterThan(16.5);
    await expect(page.locator('.your-stop-copy strong'), 'the double-taps changed nothing').toContainText('Hillingdon Road (nr)');
    // The other side of the road (opp: 53.44867, -2.29932) from the chosen one (nr: 53.44836,
    // -2.29962), in pixels at this zoom: north-east, about 43 m, so up and to the right.
    const box = await canvas.boundingBox();
    const [sx, sy] = (await map(page).getAttribute('data-stop-screen')).split(',').map(Number);
    // MapLibre zooms on 512 px tiles: the world is 512·2^z px wide.
    const metresPerPx = 40075016.686 * Math.cos(53.4485 * Math.PI / 180) / (512 * 2 ** z);
    const dx = ((-2.29932) - (-2.29962)) * Math.cos(53.4485 * Math.PI / 180) * 111320 / metresPerPx;
    const dy = -((53.44867 - 53.44836) * 111320) / metresPerPx;
    expect(Math.hypot(dx, dy), 'the two sides are well apart at this zoom').toBeGreaterThan(30);
    const x = box.x + sx + dx, y = box.y + sy + dy;
    if (test.info().project.name === 'mobile') await page.touchscreen.tap(x, y); else await page.mouse.click(x, y);
    await expect(page.locator('.your-stop-copy strong')).toContainText('Hillingdon Road (opp)', {timeout: 5000});
    await unfoldSheet(page);
    await expect(page.locator('.waiting')).toBeVisible();
  });

  test('after the map is moved, stops around its centre are offered, listed, and the way back is one press', async ({page}) => {
    test.setTimeout(90_000);
    await open(page);
    await page.getByRole('button', {name: 'Buses near me'}).click();
    await expect(page.locator('.nearby-head')).toContainText('Stops near you');
    await expect(page.locator('[data-find-here]')).toHaveCount(0);
    await map(page).evaluate(el => el.scrollIntoView({block: 'start'}));
    await foldSheet(page);
    const box = await mapBand(page);
    await dragMap(page, box, 300, 140);
    const offer = page.locator('[data-find-here]');
    await expect(offer).toBeVisible({timeout: 5000});
    await offer.click();
    await expect(page.locator('.nearby-head')).toContainText('Stops around the map’s centre');
    await expect(page.locator('.nearby-stop')).toHaveCount(8);
    await expect(page.locator('.nearby-note')).toContainText('straight lines');
    await page.locator('.nearby-head').getByRole('button', {name: 'Back to my location'}).click();
    await expect(page.locator('.nearby-head')).toContainText('Stops near you');
  });
});
