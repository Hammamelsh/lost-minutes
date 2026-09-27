// The basemap's credit, wherever the map is on screen.
//
// OpenStreetMap's attribution guidelines ask for a credit in a corner of the map, readable without
// any interaction, with "OpenStreetMap" linked to its copyright page; OpenMapTiles asks for
// "© OpenMapTiles" beside it, and OpenFreeMap to be named (osmfoundation.org/wiki/Licence/
// Attribution_Guidelines, github.com/openmaptiles/openmaptiles/blob/master/LICENSE.md and
// openfreemap.org/quick_start, read 27 September 2026).
//
// From 22 to 27 September 2026 an upright phone showed no credit at all: the phone workspace hid it
// (`display:none`) rather than place it above the sheet, and that rule also reached the ride, whose
// own rule still kept room for it under the card. The overlap checks elsewhere skip hidden elements,
// so they passed. A computer and a phone on its side showed it without the © OpenMapTiles asks for;
// on its side it ran 11 px past the screen, cut short at 667 px, and in the ride under the panel,
// because the ride stayed in the map's column. Every check here failed on that build (bf33c80).
// Here the credit must be shown, whole, readable and linked, on the map and above
// the sheet at each of its heights, in City, in the ride and the front view, on its side and on a
// computer, with a notch and a home bar emulated, and nothing may cover it or be covered by it.
import {test, expect} from '@playwright/test';
import {foldSheet, movingLive, serveLive, serveMotion, servePatterns, waitForPaint} from './fixtures.mjs';

// Buses near me, from the fixture's own place: Stop A and the moving 256 are there.
const LONGFORD_PARK = {latitude: 53.4487, longitude: -2.3095, accuracy: 40};
test.use({permissions: ['geolocation'], geolocation: LONGFORD_PARK});

const map = page => page.locator('.vector-map');
const follow = page => page.locator('.follow');
const rideButton = page => page.getByRole('button', {name: 'Ride along with route 256'});
const NO_INSETS = {top: 0, right: 0, bottom: 0, left: 0};
// An iPhone's notch and home bar, upright and on its side (CSS pixels).
const UPRIGHT_INSETS = {top: 47, right: 0, bottom: 34, left: 0};
const SIDEWAYS_INSETS = {top: 0, right: 47, bottom: 21, left: 47};

const EXPECTED_LINKS = [
  {text: /OpenStreetMap/, href: 'https://www.openstreetmap.org/copyright'},
  {text: /OpenFreeMap/, href: 'https://openfreemap.org/'},
  {text: /OpenMapTiles/, href: 'https://www.openmaptiles.org/'},
];
// What may never sit on the credit, nor the credit on it: every control and card drawn over the map.
const CONTROLS = ['.map-views', '.map-tools', '.vector-map-foot', '.map-legend-chips', '.ride-launch', '.map-find-here',
  '.map-notice', '.ride-bar', '.ride-notes', '.ride-note', '.ride-return', '.ride-card', '.ride-actions',
  '.follow > .panel', '.follow > .follow-top'];

async function openAtStopA(page, {insets = null} = {}) {
  if (insets) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setSafeAreaInsetsOverride', {insets});
  }
  await servePatterns(page);
  await serveMotion(page);
  const startMs = Date.now();
  await serveLive(page, [() => movingLive({startMs})]);
  await page.goto('/');
  await waitForPaint(page);
  await page.getByRole('button', {name: 'Buses near me'}).click();
  await page.locator('.nearby-stop', {hasText: 'Stop A'}).first().click();
  await expect(page.locator('.bus-card .route-badge')).toHaveText('256');
}

/** Everything the checks need about the credit, read in one pass from the page as it is drawn. */
function readCredit(page) {
  return page.evaluate(controls => {
    const el = document.querySelector('.vector-map .map-credit-line');
    if (!el) return {present: false};
    const describe = node => node
      ? `${node.tagName.toLowerCase()}${typeof node.className === 'string' && node.className.trim() ? '.' + node.className.trim().split(/\s+/).join('.') : ''}`
      : 'nothing';
    const shown = node => { const s = getComputedStyle(node), r = node.getBoundingClientRect();
      return s.display !== 'none' && s.visibility === 'visible' && Number(s.opacity) > 0 && r.width > 0 && r.height > 0; };
    const style = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    let opacity = 1;
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
    const links = [...el.querySelectorAll('a')].map(a => {
      const r = a.getBoundingClientRect();
      // The link is on top where a finger or a pointer would meet it: at both ends and the middle.
      const covered = [0.1, 0.5, 0.9].map(f => {
        const hit = document.elementFromPoint(r.left + r.width * f, r.top + r.height / 2);
        return hit && (hit === a || a.contains(hit)) ? null : describe(hit);
      }).filter(Boolean);
      return {text: a.textContent.trim(), href: a.href, target: a.target, rel: a.rel, covered,
        inside: r.left >= box.left - 0.5 && r.right <= box.right + 0.5};
    });
    const overlaps = [];
    for (const selector of controls) for (const other of document.querySelectorAll(selector)) {
      if (other === el || other.contains(el) || !shown(other)) continue;
      const o = other.getBoundingClientRect();
      if (box.left < o.right - 1 && o.left < box.right - 1 && box.top < o.bottom - 1 && o.top < box.bottom - 1)
        overlaps.push(`${selector} (${Math.round(o.left)},${Math.round(o.top)} ${Math.round(o.width)}×${Math.round(o.height)})`);
    }
    // The links' colour over the credit's own ground laid over black and over white: the map under a
    // translucent ground can be either, so the worse of the two is the one that counts.
    const rgba = text => (text.match(/[\d.]+/g) || []).map(Number);
    const lum = ([r, g, b]) => { const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    const [br, bg, bb, ba = 1] = rgba(style.backgroundColor);
    const over = base => [br, bg, bb].map((c, i) => c * ba + base[i] * (1 - ba));
    const ink = rgba(getComputedStyle(el.querySelector('a') ?? el).color).slice(0, 3);
    const contrast = Math.min(ratio(ink, over([0, 0, 0])), ratio(ink, over([255, 255, 255])));
    const mapBox = el.closest('.vector-map').getBoundingClientRect();
    return {present: true, display: style.display, visibility: style.visibility, opacity: +opacity.toFixed(2),
      fontSize: parseFloat(style.fontSize), text: el.innerText.replace(/\s+/g, ' ').trim(),
      box: {left: +box.left.toFixed(1), top: +box.top.toFixed(1), right: +box.right.toFixed(1), bottom: +box.bottom.toFixed(1),
        height: +box.height.toFixed(1)},
      clipped: el.scrollWidth > el.clientWidth + 1, links, overlaps, contrast: +contrast.toFixed(2),
      hiddenFromAssistiveTech: el.closest('[aria-hidden="true"],[inert]') !== null,
      viewport: {width: innerWidth, height: innerHeight},
      onMap: box.left >= mapBox.left - 0.5 && box.right <= mapBox.right + 0.5 && box.top >= mapBox.top - 0.5 && box.bottom <= mapBox.bottom + 0.5};
  }, CONTROLS);
}

/** Waits for the credit to stop moving (a sheet or a camera settling), then checks all of it. */
async function expectCredit(page, what, insets = NO_INSETS, {lines = 1} = {}) {
  let last = null;
  await expect.poll(async () => {
    const now = await page.evaluate(() => { const r = document.querySelector('.vector-map .map-credit-line')?.getBoundingClientRect();
      return r ? `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}` : 'none'; });
    const still = now === last; last = now; return still;
  }, {intervals: [350], timeout: 10_000, message: `${what}: the credit comes to rest`}).toBe(true);
  const credit = await readCredit(page);
  const where = `${what}: ${JSON.stringify({...credit, links: credit.links?.map(l => l.text + (l.covered.length ? ` covered by ${l.covered.join('/')}` : ''))})}`;
  expect(credit.present, where).toBe(true);
  expect(credit.display, where).not.toBe('none');
  expect(credit.visibility, where).toBe('visible');
  expect(credit.opacity, where).toBeGreaterThanOrEqual(0.95);
  expect(credit.hiddenFromAssistiveTech, where).toBe(false);
  expect(credit.fontSize, `${where}: readable`).toBeGreaterThanOrEqual(10);
  expect(credit.contrast, `${where}: contrast`).toBeGreaterThanOrEqual(4.5);
  expect(credit.clipped, `${where}: one whole line, nothing cut off`).toBe(false);
  expect(credit.box.height, `${where}: ${lines === 1 ? 'one line' : `at most ${lines} lines`}`).toBeLessThan(credit.fontSize * (lines * 1.3 + 1.1));
  expect(credit.onMap, `${where}: on the map`).toBe(true);
  expect(credit.box.left, `${where}: clear of the left edge and a notch`).toBeGreaterThanOrEqual(insets.left + 4);
  expect(credit.box.right, `${where}: clear of the right edge and a notch`).toBeLessThanOrEqual(credit.viewport.width - insets.right - 4);
  expect(credit.box.top, `${where}: clear of the top`).toBeGreaterThanOrEqual(insets.top);
  expect(credit.box.bottom, `${where}: clear of the home bar`).toBeLessThanOrEqual(credit.viewport.height - insets.bottom - 2);
  expect(credit.overlaps, `${where}: nothing drawn over the map overlaps it`).toEqual([]);
  expect(credit.links.map(l => l.href), where).toEqual(EXPECTED_LINKS.map(l => l.href));
  credit.links.forEach((link, i) => {
    expect(link.text, where).toMatch(EXPECTED_LINKS[i].text);
    expect(link.target, `${where}: opens beside the map`).toBe('_blank');
    expect(link.rel, where).toContain('noopener');
    expect(link.inside, `${where}: ${link.text} inside the line`).toBe(true);
    expect(link.covered, `${where}: ${link.text} is on top`).toEqual([]);
  });
  expect(credit.text, `${where}: the credits the providers ask for`).toMatch(/© OpenStreetMap.*OpenFreeMap.*© OpenMapTiles/);
  return credit;
}

/** The sheet to one of its three heights: its own labelled toggle goes to full from either of the
 *  others and from full back to half; folding to the handle is a drag, as a passenger does it. */
async function sheetTo(page, state) {
  const toggle = page.locator('[data-sheet-toggle]');
  const now = await follow(page).getAttribute('data-sheet');
  if (now === state) return;
  if (state === 'full') await toggle.click();
  else if (state === 'half') {
    if (now === 'peek') { await toggle.click(); await expect(follow(page)).toHaveAttribute('data-sheet', 'full'); }
    await toggle.click();
  } else {
    if (now === 'full') { await toggle.click(); await expect(follow(page)).toHaveAttribute('data-sheet', 'half'); }
    await foldSheet(page);
  }
  await expect(follow(page)).toHaveAttribute('data-sheet', state);
}
async function rideAndFront(page, what, insets) {
  await rideButton(page).click();
  await expect(map(page)).toHaveAttribute('data-view', 'ride');
  await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 15_000});
  await page.waitForTimeout(1300);   // the ride's controls fade in as the entrance settles
  await expectCredit(page, `${what}, ride-along`, insets);
  await page.getByRole('button', {name: 'Front view'}).click();
  await expect(map(page)).toHaveAttribute('data-ride-camera', 'front');
  await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 5000});
  await expectCredit(page, `${what}, front view`, insets);
  await page.getByRole('button', {name: /Exit/}).first().click();
  await expect(map(page)).toHaveAttribute('data-ride', 'off');
}

test.describe('the basemap credit', () => {
  test('an upright phone: above the sheet at every height, in City, in the ride and the front view, clear of the notch and home bar', async ({page}) => {
    test.skip(test.info().project.name !== 'mobile', 'the sheet exists on phones only');
    test.setTimeout(150_000);
    await openAtStopA(page, {insets: UPRIGHT_INSETS});
    await expect(follow(page)).toHaveAttribute('data-sheet', 'half');
    await expectCredit(page, 'sheet at half', UPRIGHT_INSETS);
    await sheetTo(page, 'peek');
    await expectCredit(page, 'sheet folded to its handle', UPRIGHT_INSETS);
    await sheetTo(page, 'full');
    await expectCredit(page, 'sheet expanded', UPRIGHT_INSETS);
    await sheetTo(page, 'half');
    await page.getByRole('button', {name: 'City', exact: true}).click();
    await expect(map(page)).toHaveAttribute('data-view', 'city');
    await expectCredit(page, 'City, sheet at half', UPRIGHT_INSETS);
    await sheetTo(page, 'peek');
    await expectCredit(page, 'City, sheet folded', UPRIGHT_INSETS);
    await rideAndFront(page, 'upright', UPRIGHT_INSETS);
    await expectCredit(page, 'back from the ride', UPRIGHT_INSETS);
  });

  // A 360 px Android, a 375 px iPhone (SE, mini) and a 390 px iPhone with Safari's bars showing.
  for (const size of [{width: 360, height: 740}, {width: 375, height: 667}, {width: 390, height: 664}]) {
    test(`an upright phone at ${size.width} × ${size.height}: one whole line above the sheet, expanded too, and in the ride`, async ({page}) => {
      test.skip(test.info().project.name !== 'mobile', 'the sheet exists on phones only');
      test.setTimeout(120_000);
      await page.setViewportSize(size);
      await openAtStopA(page);
      await expectCredit(page, 'sheet at half');
      await sheetTo(page, 'full');
      await expectCredit(page, 'sheet expanded');
      await sheetTo(page, 'half');
      await rideAndFront(page, 'upright', NO_INSETS);
    });
  }

  // On its side the map is a column beside the panel, as the page first opens (not scrolled to): a
  // 667 px iPhone SE leaves it 250 px, where the credit takes two lines; the others, one.
  for (const {width, height, insets, lines} of [
    {width: 667, height: 375, insets: NO_INSETS, lines: 2},
    {width: 740, height: 360, insets: NO_INSETS, lines: 1},
    {width: 844, height: 390, insets: SIDEWAYS_INSETS, lines: 1},
    {width: 932, height: 430, insets: {top: 0, right: 59, bottom: 21, left: 59}, lines: 1},
  ]) {
    test(`a phone on its side at ${width} × ${height}: on the first screen, in City, the ride and the front view, clear of the notch and home bar`, async ({page}) => {
      test.skip(test.info().project.name !== 'mobile', 'a phone turned on its side');
      test.setTimeout(120_000);
      await page.setViewportSize({width, height});
      await openAtStopA(page, {insets: insets === NO_INSETS ? null : insets});
      await page.evaluate(() => scrollTo(0, 0));
      await expectCredit(page, 'the map', insets, {lines});
      await page.getByRole('button', {name: 'City', exact: true}).click();
      await expect(map(page)).toHaveAttribute('data-view', 'city');
      await expectCredit(page, 'City', insets, {lines});
      await rideAndFront(page, 'on its side', insets);
    });
  }

  test('a computer: on the map, in City, the ride and the front view', async ({page}) => {
    test.skip(test.info().project.name !== 'desktop', 'the wide layout');
    test.setTimeout(120_000);
    await openAtStopA(page);
    await expectCredit(page, 'the map');
    await page.getByRole('button', {name: 'City', exact: true}).click();
    await expect(map(page)).toHaveAttribute('data-view', 'city');
    await expectCredit(page, 'City');
    await rideAndFront(page, 'computer', NO_INSETS);
  });
});
