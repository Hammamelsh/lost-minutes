// The phone's sheet, as a passenger uses it: dragged open, kept open, and the map given back.
//
// The failure this guards was found on a physical phone on 23 September 2026 and reproduced here
// at a Safari-sized viewport: an upward drag to the very top of the screen snapped back to half,
// because the expanded height was capped in CSS at a size the drag's own threshold could not
// reach once the browser's bars took their share. Real touch events through CDP; the small
// (390 × 664) viewport is what Safari leaves a 390 × 844 phone with its bars showing.
import {test, expect} from '@playwright/test';
import {FX, departureBoard, dragBy, journeyLive, serveDepartures, serveLive, servePatterns,
  waitForPaint} from './fixtures.mjs';

test.describe('the sheet', () => {
  test.beforeEach(async () => {
    test.skip(test.info().project.name !== 'mobile', 'the sheet exists on phones only');
  });

  const follow = page => page.locator('.follow');
  const panel = page => page.locator('.follow > .panel');
  const body = page => page.locator('.panel-body');
  const handleCentre = async page => {
    const box = await page.locator('.sheet-handle').boundingBox();
    return {x: box.x + box.width / 2, y: box.y + box.height / 2};
  };

  async function openStop(page, {height = 664} = {}) {
    await page.setViewportSize({width: 390, height});
    await servePatterns(page);
    await serveDepartures(page, {board: departureBoard({atMinutes: [3, 9, 15, 24, 31, 44, 58, 71]})});
    const feed = await serveLive(page, [() => journeyLive()]);
    await page.goto(`/?stop=${FX.stopA}`);
    await waitForPaint(page);
    await expect(follow(page)).toHaveAttribute('data-sheet', 'half');
    return feed;
  }

  test('an upward drag reaches the expanded state at a Safari-sized viewport, and stays there', async ({page}) => {
    await openStop(page, {height: 664});
    const {x, y} = await handleCentre(page);
    await dragBy(page, x, y, 0, -(y - 30));
    await expect(follow(page)).toHaveAttribute('data-sheet', 'full');
    // Genuinely expanded: taller than three quarters of the screen, which the old cap never allowed.
    const box = await panel(page).boundingBox();
    expect(box.height, `${box.height}px of a 664px screen`).toBeGreaterThan(664 * 0.75);
    // And the one control that has to stay reachable from it, the search, is still above it.
    const search = await page.getByRole('combobox', {name: /Bus number, stop or area/i}).boundingBox();
    expect(search.y + search.height, 'the search bar is above the sheet').toBeLessThanOrEqual(box.y + 1);
    await page.waitForTimeout(1500);
    await expect(follow(page), 'and it stays there').toHaveAttribute('data-sheet', 'full');
  });

  test('a flick upwards from half goes to full; a flick down from full goes to half; a slow drag snaps to the nearest', async ({page}) => {
    await openStop(page);
    // The handle is read where it *is*: for the 280 ms after a state change it is still on its
    // way there, and a touch aimed at where it was lands on the list below it instead (which is
    // what a finger following it would never do).
    const settled = async () => { await page.waitForTimeout(350); return handleCentre(page); };
    let {x, y} = await settled();
    await dragBy(page, x, y, 0, -140, 4);                    // short but fast: a flick
    await expect(follow(page)).toHaveAttribute('data-sheet', 'full');
    ({x, y} = await settled());
    await dragBy(page, x, y, 0, 140, 4);
    await expect(follow(page)).toHaveAttribute('data-sheet', 'half');
    ({x, y} = await settled());
    await dragBy(page, x, y, 0, 60, 30);                     // slow, and not far: stays put
    await expect(follow(page)).toHaveAttribute('data-sheet', 'half');
  });

  test('the labelled control opens the full list and gives the map back, without dragging', async ({page}) => {
    await openStop(page);
    const toggle = page.locator('[data-sheet-toggle]');
    await expect(toggle).toHaveText(/Open full list/);
    await toggle.click();
    await expect(follow(page)).toHaveAttribute('data-sheet', 'full');
    await expect(toggle).toHaveText(/Show map/);
    await toggle.click();
    await expect(follow(page)).toHaveAttribute('data-sheet', 'half');
    await expect(toggle).toHaveText(/Open full list/);
  });

  test('scrolling the list does not collapse the sheet or move the page under the map', async ({page}) => {
    await openStop(page);
    await page.locator('[data-sheet-toggle]').click();
    await expect(follow(page)).toHaveAttribute('data-sheet', 'full');
    const list = await body(page).boundingBox();
    const pageYBefore = await page.evaluate(() => window.scrollY);
    // Scroll the list by touch, well past its end, three times.
    for (let i = 0; i < 3; i++) await dragBy(page, list.x + list.width / 2, list.y + list.height - 40, 0, -(list.height - 80), 10);
    const scrolled = await body(page).evaluate(el => el.scrollTop);
    expect(scrolled, 'the list itself scrolled').toBeGreaterThan(0);
    await expect(follow(page), 'the sheet is where it was').toHaveAttribute('data-sheet', 'full');
    expect(await page.evaluate(() => window.scrollY), 'the page did not move').toBe(pageYBefore);
  });

  test('three publications, a location update and a fit leave the sheet where the passenger put it', async ({page}) => {
    const feed = await openStop(page);
    await page.locator('[data-sheet-toggle]').click();
    await expect(follow(page)).toHaveAttribute('data-sheet', 'full');
    const served = feed.count;
    await expect.poll(() => feed.count, {timeout: 40_000}).toBeGreaterThanOrEqual(served + 3);
    await expect(follow(page), 'after three more publications').toHaveAttribute('data-sheet', 'full');
    await page.context().setGeolocation({latitude: 53.4490, longitude: -2.3100, accuracy: 30});
    await page.waitForTimeout(1200);
    await expect(follow(page), 'after the device moved').toHaveAttribute('data-sheet', 'full');
    await page.locator('.sheet-toggle').click();
    await expect(follow(page)).toHaveAttribute('data-sheet', 'half');
    await page.getByRole('button', {name: 'Fit journey'}).click();
    await page.waitForTimeout(800);
    // Fit journey asks for the map, which folds the sheet: a camera action that changes the
    // layout, on purpose (docs/MILESTONE_2026-09-22_WORKSPACE.md). Then the list comes back.
    await expect(follow(page)).toHaveAttribute('data-sheet', 'peek');
    await page.locator('[data-sheet-toggle]').click();
    await expect(follow(page)).toHaveAttribute('data-sheet', 'full');
  });

  test('the keyboard: the search folds the sheet for its matches and gives it back when the search is left', async ({page}) => {
    await openStop(page);
    await page.locator('[data-sheet-toggle]').click();
    await expect(follow(page)).toHaveAttribute('data-sheet', 'full');
    const search = page.getByRole('combobox', {name: /Bus number, stop or area/i});
    await search.focus();
    await expect(follow(page), 'folded for the keyboard and the matches').toHaveAttribute('data-sheet', 'peek');
    await page.keyboard.press('Escape');
    await search.blur();
    await expect(follow(page), 'given back as it was').toHaveAttribute('data-sheet', 'full');
  });

  test('showing the map and coming back keeps the stop, the chosen bus and the place in the list', async ({page}) => {
    await openStop(page);
    await page.locator('[data-sheet-toggle]').click();
    await expect(follow(page)).toHaveAttribute('data-sheet', 'full');
    await page.locator('.follow-row').first().click();
    await expect(page.locator('article.bus-card')).toHaveAttribute('data-vehicle', /FX-/);
    const vehicle = await page.locator('article.bus-card').getAttribute('data-vehicle');
    // Choosing a bus scrolls the list to its top for the new task, a moment later; the place in
    // the list being kept is the one the passenger then reads to. That scroll is smooth, and a
    // fixed 400 ms did not always see it end: logged on 24 September 2026 (on f964c7d and on the
    // build after it alike) the list was still moving at 300–462 px at 400 ms, overtook the 220
    // set here, and the sheet's toggle then stopped it at 89–156 px — so the check failed or
    // passed on timing. It now waits for the list to come to rest, as a reader's thumb would.
    let last = -1;
    await expect.poll(async () => { const now = await body(page).evaluate(el => el.scrollTop); const still = now === last; last = now; return still; },
      {intervals: [150], timeout: 5000, message: 'the list comes to rest after the bus is chosen'}).toBe(true);
    await body(page).evaluate(el => { el.scrollTop = 220; });
    expect(await body(page).evaluate(el => el.scrollTop), 'the passenger’s place is taken').toBe(220);
    await page.locator('[data-sheet-toggle]').click();
    await expect(follow(page)).toHaveAttribute('data-sheet', 'half');
    await page.locator('[data-sheet-toggle]').click();
    await expect(follow(page)).toHaveAttribute('data-sheet', 'full');
    await expect(page.locator('article.bus-card')).toHaveAttribute('data-vehicle', vehicle);
    // The panel is about the bus now, so the handle names the bus; the stop is still in the panel.
    await expect(follow(page)).toHaveAttribute('data-panel', 'bus');
    await expect(page.locator('.your-stop-copy strong').first()).toContainText('Stretford Mall');
    expect(await body(page).evaluate(el => el.scrollTop), 'the place in the list').toBeGreaterThan(150);
  });

  test('every row and control of the full list is reachable, including the last', async ({page}) => {
    await openStop(page);
    await page.locator('[data-sheet-toggle]').click();
    await expect(follow(page)).toHaveAttribute('data-sheet', 'full');
    const last = page.locator('.panel-body > *').last();
    await last.scrollIntoViewIfNeeded();
    const box = await last.boundingBox();
    const sheet = await panel(page).boundingBox();
    expect(box.y + box.height, 'the last thing in the list is inside the sheet').toBeLessThanOrEqual(sheet.y + sheet.height + 1);
    expect(box.y, 'and not under the handle').toBeGreaterThanOrEqual(sheet.y);
  });
});
