// The workspace: a map beside one panel on a computer, a map under a sheet on a phone. What the
// panel is about follows the passenger's task — find a stop, read its board, look at a bus, plan a
// journey — and each change has a way back. The page itself does not scroll; the panel does.
// FIXTURE timetable on the real stop catalogue, in Chromium at desktop (1280 x 900) and phone
// (390 x 844) size. No physical phone.
import {test, expect} from '@playwright/test';
import {foldSheet, journeyLive, mapBand, servePatterns, serveLive, waitForPaint} from './fixtures.mjs';

const LONGFORD_PARK = {latitude: 53.4487, longitude: -2.3095, accuracy: 40};
test.use({permissions: ['geolocation'], geolocation: LONGFORD_PARK});

const box = locator => locator.boundingBox();
const pageScroll = page => page.evaluate(() =>
  ({height: document.documentElement.scrollHeight, viewport: window.innerHeight}));

async function openStop(page) {
  await servePatterns(page);
  await serveLive(page, [() => journeyLive()]);
  await page.goto('/');
  await waitForPaint(page);
  await page.getByRole('button', {name: 'Buses near me'}).click();
  await page.locator('.nearby-stop', {hasText: 'Stop A'}).first().click();
  await expect(page.locator('.your-stop-copy strong')).toContainText('Stretford Mall');
}

test('the page itself does not scroll: the map stays put and the panel carries the reading', async ({page}) => {
  await openStop(page);
  const {height, viewport} = await pageScroll(page);
  // The workspace — map and panel — is the first screen, whole: the masthead and a one-line
  // heading sit above it and nothing of it is below the fold. What is left to scroll is the
  // foot of the page. The old stacked layout ran to three screens with a stop chosen.
  const follow = await box(page.locator('.follow'));
  expect(follow.y + follow.height).toBeLessThanOrEqual(viewport + 8);
  expect(height).toBeLessThan(viewport * 1.5);
  // The reading scrolls inside the workspace: on a wide screen the panel column, on a phone its body.
  const scrolls = await page.locator('.follow > .panel').evaluate(el => [el, el.querySelector('.panel-body')]
    .filter(Boolean).map(node => getComputedStyle(node).overflowY));
  expect(scrolls.some(value => value === 'auto' || value === 'scroll')).toBe(true);
  // The map is in the workspace and holds its own height rather than scrolling away.
  const map = await box(page.locator('.vector-map, .map-fallback-wrap').first());
  expect(map.height).toBeGreaterThan(viewport * 0.3);
});

test('on a computer the map and the panel are side by side, and the search is above the panel', async ({page}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'the two-column workspace is for wide screens');
  await openStop(page);
  const map = await box(page.locator('.vector-map'));
  const panel = await box(page.locator('.follow > .panel'));
  const top = await box(page.locator('.follow-top'));
  // Beside, not above: the panel starts after the map ends, and they overlap vertically.
  expect(panel.x).toBeGreaterThanOrEqual(map.x + map.width - 2);
  expect(panel.y).toBeLessThan(map.y + map.height);
  // The search and the way into planning are at the top of the same column.
  expect(top.y).toBeLessThanOrEqual(panel.y + 2);
  await expect(page.locator('[data-plan-entry]')).toBeVisible();
  await expect(page.locator('.follow-search input')).toBeVisible();
});

test('on a phone the sheet folds and opens by its button, and the map is never fully covered', async ({page}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'the sheet is the phone layout');
  await openStop(page);
  const follow = page.locator('.follow');
  const panel = page.locator('.follow > .panel');
  const toggle = page.locator('[data-sheet-toggle]');
  const viewport = page.viewportSize().height;

  // It opens on the stop at half height: the answer is there, the map is there.
  await expect(follow).toHaveAttribute('data-sheet', 'half');
  const half = await box(panel);
  expect(half.height).toBeGreaterThan(viewport * 0.35);
  expect(half.height).toBeLessThan(viewport * 0.75);

  // The button is the way, not only the drag. Every state keeps a strip of map in view.
  await toggle.click();
  await expect(follow).toHaveAttribute('data-sheet', 'full');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(async () => Math.round((await box(panel)).height), {timeout: 5000})
    .toBeGreaterThan(Math.round(half.height) + 8);
  const full = await box(panel);
  expect(full.y).toBeGreaterThan(40);

  await toggle.click();
  await expect(follow).toHaveAttribute('data-sheet', 'half');
  await expect.poll(async () => Math.round((await box(panel)).height), {timeout: 5000})
    .toBeLessThan(Math.round(full.height) - 8);
  // The handle says what the panel is about, so a folded sheet is still readable — and it is the
  // only place the name is shown, because the panel under it would otherwise repeat it at once.
  await expect(page.locator('.sheet-words')).toContainText('Stretford Mall');
  const shown = await page.locator('.your-stop-copy > strong').evaluate(el => {
    const box = el.getBoundingClientRect();
    return {width: Math.round(box.width), height: Math.round(box.height)};
  });
  expect(shown.width, 'the panel does not print the stop name under the handle that names it').toBeLessThan(2);
  // Touch targets: the handle is a real target, not a hairline.
  const hit = await box(toggle);
  expect(hit.height).toBeGreaterThanOrEqual(40);
});

test('choosing a bus leads with its card and keeps the board under it; Back puts the board first again', async ({page}) => {
  await openStop(page);
  const follow = page.locator('.follow');
  await expect(follow).toHaveAttribute('data-panel', 'stop');
  await page.locator('.waiting .follow-row').first().click();
  await expect(follow).toHaveAttribute('data-panel', 'bus');
  const card = page.locator('article.bus-card');
  await expect(card).toBeVisible();
  // The board did not go away: another bus is still one tap away, under the card.
  const waiting = page.locator('.waiting');
  await expect(waiting).toBeVisible();
  const order = () => page.evaluate(() => {
    const at = selector => {
      const el = document.querySelector(selector);
      return el ? el.getBoundingClientRect().top + (document.querySelector('.panel-body')?.scrollTop ?? 0) : null;
    };
    return {card: at('article.bus-card'), waiting: at('.waiting')};
  });
  const before = await order();
  expect(before.card, 'the card leads and the board follows').toBeLessThan(before.waiting);

  await page.locator('[data-panel-back]').click();
  await expect(follow).toHaveAttribute('data-panel', 'stop');
  await expect.poll(async () => {
    const now = await order();
    return now.waiting !== null && now.card !== null && now.waiting < now.card;
  }, {timeout: 5000, message: 'Back puts the board first again'}).toBe(true);
  // The bus is still the chosen one: Back changed what leads, not what was chosen.
  await expect(page.locator('.waiting .follow-row[aria-pressed="true"]')).toHaveCount(1);
});

test('planning replaces the panel and gives the stop back', async ({page}) => {
  await openStop(page);
  const follow = page.locator('.follow');
  await page.locator('[data-plan-entry]').click();
  await expect(follow).toHaveAttribute('data-panel', 'plan');
  await expect(page.locator('.plan-panel')).toBeVisible();
  // While planning, the stop's board is out of the way rather than under the planner.
  await expect(page.locator('.waiting')).toHaveCount(0);
  const back = page.locator('[data-panel-back]');
  await expect(back).toContainText('Stretford Mall');
  await back.click();
  await expect(follow).toHaveAttribute('data-panel', 'stop');
  await expect(page.locator('.waiting')).toBeVisible();
});

test('a fresh visitor is offered the two ways in, before any stop is chosen', async ({page}) => {
  await servePatterns(page);
  await serveLive(page, [() => journeyLive()]);
  await page.goto('/');
  await waitForPaint(page);
  await expect(page.locator('.follow')).toHaveAttribute('data-panel', 'home');
  await expect(page.getByRole('button', {name: 'Buses near me'})).toBeVisible();
  await expect(page.locator('.follow-search input')).toBeVisible();
  await expect(page.locator('[data-plan-entry]')).toBeVisible();
  // The search says it takes a bus number as well as a place.
  await expect(page.locator('.follow-search input')).toHaveAttribute('placeholder', /number/i);
});

test('a boarding point is chosen by tapping its sign on the map, without knowing its name', async ({page}) => {
  await servePatterns(page);
  await serveLive(page, [() => journeyLive()]);
  await page.goto('/');
  await waitForPaint(page);
  await page.getByRole('button', {name: 'Buses near me'}).click();
  await page.locator('.nearby-stop', {hasText: 'Stop A'}).first().click();
  const map = page.locator('.vector-map');
  await foldSheet(page);
  // The map says which boarding points are on the screen and where; a passenger sees their signs.
  await expect(map).toHaveAttribute('data-stop-points', /"id"/);
  await expect.poll(async () => {
    const first = await map.getAttribute('data-camera');
    await page.waitForTimeout(350);
    return (await map.getAttribute('data-camera')) === first;
  }, {timeout: 15_000, message: 'the camera comes to rest before the signs are read'}).toBe(true);
  const canvas = await box(page.locator('.vector-map-canvas'));
  const band = await mapBand(page);
  // The signs' points are refreshed as the camera rests and again at idle; read them once they
  // have held still for a moment, so the tap goes where a sign is, not where it was.
  let points = [];
  await expect.poll(async () => {
    const first = await map.getAttribute('data-stop-points');
    await page.waitForTimeout(600);
    const again = await map.getAttribute('data-stop-points');
    if (again === first) { points = JSON.parse(again || '[]'); return true; }
    return false;
  }, {timeout: 15_000, message: 'the signs’ points settle'}).toBe(true);
  expect(points.length).toBeGreaterThan(1);
  // A sign the passenger could actually put a finger on: inside the band the sheet leaves, with
  // nothing of the map's own over it, and clear of its neighbours so this is a tap on one stop
  // and not the chooser (which has its own check).
  const aim = p => ({x: p.x, y: p.y - 10});
  const spot = async p => page.evaluate(([x, y]) => {
    const el = document.elementFromPoint(x, y);
    return el?.classList.contains('maplibregl-canvas') ? null : (el?.className?.toString() || el?.tagName || 'nothing');
  }, [canvas.x + aim(p).x, canvas.y + aim(p).y]);
  const buses = JSON.parse(await map.getAttribute('data-bus-points') || '[]');
  // The suggested bus is drawn from its own source and is not among the other buses' points: a sign
  // within reach of its marker takes the bus, as a tap should (26 September 2026: the one run in
  // six that failed had tapped 1800SJ32291 beside FX-COMING and chosen the bus).
  const [sx, sy] = (await map.getAttribute('data-bus-screen') || '-999,-999').split(',').map(Number);
  buses.push({key: 'suggested', x: sx, y: sy});
  const [cx, cy] = (await map.getAttribute('data-stop-screen') || '-999,-999').split(',').map(Number);
  const ranked = points
    .filter(p => canvas.y + p.y > band.y + 60 && canvas.y + p.y < band.y + band.height - 40)
    .filter(p => p.x > 60 && p.x < canvas.width - 60)
    .filter(p => Math.hypot(p.x - cx, p.y - cy) > 45)
    .filter(p => buses.every(b => Math.hypot(b.x - p.x, b.y - p.y) > 45))
    .map(p => ({p, near: Math.min(...points.filter(o => o.id !== p.id).map(o => Math.hypot(o.x - p.x, o.y - p.y)))}))
    .sort((a, b) => b.near - a.near);
  let lonely = null;
  for (const candidate of ranked) if (!lonely && candidate.near > 30 && await spot(candidate.p) === null) lonely = candidate;
  expect(lonely, 'a sign in reach, clear of its neighbours and of every control').not.toBeNull();
  const before = (await page.locator('.your-stop-copy strong').textContent())?.trim();
  const at = {x: canvas.x + aim(lonely.p).x, y: canvas.y + aim(lonely.p).y};
  test.info().annotations.push({type: 'tap', description: JSON.stringify({
    at: {x: Math.round(at.x), y: Math.round(at.y)}, sign: lonely.p, near: Math.round(lonely.near),
    camera: await map.getAttribute('data-camera')})});
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(500);
  console.log(`sign tap at ${Math.round(at.x)},${Math.round(at.y)} (${lonely.p.id}): chooser ${await page.locator('.bus-chooser').count()}, `
    + `selected '${await map.getAttribute('data-selected-key')}', panel ${await page.locator('.follow').getAttribute('data-panel')}, `
    + `stop now '${(await page.locator('.your-stop-copy strong').textContent())?.trim()}', buses ${JSON.stringify(buses.map(b => `${b.key.split('|')[1]}@${b.x},${b.y}`))}`);
  await expect(page.locator('.follow')).toHaveAttribute('data-panel', 'stop');
  // It is a different stop, and the panel is about it now.
  await expect.poll(async () => (await page.locator('.your-stop-copy strong').textContent())?.trim())
    .not.toBe(before);
  await expect(page.locator('.follow')).toHaveAttribute('data-sheet', /half|full/);
  await expect(page.locator('.waiting, .empty-copy, .stop-empty').first()).toBeVisible();
});

// A browser's page zoom shrinks the CSS viewport: 1366 x 768 at 150% is about 911 x 512 CSS px,
// and at 200% about 683 x 384. A workspace that fixes the map and the panel to the screen has to
// keep working there, because that is what a passenger who needs larger text actually does (our
// type is in pixels, so the browser's own larger-text setting does nothing — backlog 19).
for (const {zoom, width, height} of [{zoom: '150%', width: 911, height: 512},
                                     {zoom: '200%', width: 683, height: 384}]) {
  test(`at ${zoom} page zoom the stop, Change, search and the departures are all still reachable`, async ({page}) => {
    test.skip(test.info().project.name === 'mobile', 'page zoom is measured against the desktop size');
    await page.setViewportSize({width, height});
    await openStop(page);
    // Nothing is pushed off the side: a fixed workspace must not make the page scroll sideways.
    const sideways = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(sideways, `no horizontal scrolling at ${zoom}`).toBeLessThanOrEqual(1);
    // Everything the passenger needs to get somewhere else is reachable — on screen already, or
    // by scrolling the panel, which is what the panel is for. None of it may be clipped away.
    const panel = page.locator('.follow > .panel');
    for (const {name, locator} of [
      // Whichever of the two carries the stop's name at this width: the sheet's handle on a phone
      // layout, the block in the panel on a wide one. Both are in the DOM; one of them is shown.
      {name: 'the stop', locator: page.locator('.your-stop-copy strong:visible, .sheet-words:visible').first()},
      {name: 'Change stop', locator: page.getByRole('button', {name: 'Change stop', exact: true}).first()},
      {name: 'the search', locator: page.getByRole('combobox', {name: /Bus number, stop or area/i}).first()},
      {name: 'the departures', locator: page.locator('.departures .section-head').first()},
    ]) {
      await expect(locator, `${name} at ${zoom}`).toBeVisible();
      await locator.scrollIntoViewIfNeeded({timeout: 10_000})
        .catch(error => { throw new Error(`${name} could not be scrolled to at ${zoom}: ${error.message.split('\n')[0]}`) });
      await expect(locator, `${name} at ${zoom}`).toBeVisible();
      const box = await locator.boundingBox();
      expect(box.width, `${name} is not squeezed to nothing at ${zoom}`).toBeGreaterThan(24);
      expect(box.height, `${name} has height at ${zoom}`).toBeGreaterThan(8);
    }
    // And the panel can actually be read to its end: its content is taller than its box, and
    // scrolling it reaches the bottom rather than stopping short.
    const reach = await panel.evaluate(el => {
      const node = el.scrollHeight > el.clientHeight ? el : el.querySelector('.panel-body') ?? el;
      node.scrollTop = node.scrollHeight;
      return {scrolled: node.scrollTop, reachable: node.scrollHeight - node.clientHeight};
    });
    expect(reach.scrolled, `the panel scrolls to its end at ${zoom}`).toBeGreaterThanOrEqual(reach.reachable - 2);
  });
}
