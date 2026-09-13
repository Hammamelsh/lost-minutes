// The ride-along, state by state, on FIXTURE buses over a real recorded bus road.
//
// "Identifiable" is measured, not inferred from a DOM flag or a loaded model: the drawn bus's
// canvas position (data-bus-screen) must lie inside the map and clear of every control drawn
// over it, and lime marker pixels must be found around that point in a screenshot. The same
// measurement is shown failing on a bus that has been left off screen (the negative control),
// so it cannot be satisfied by stray lime elsewhere on the page.
import {test, expect} from '@playwright/test';
import {journeyLive, movingLive, servePatterns, serveLive, serveMotion} from './fixtures.mjs';

const LONGFORD_PARK = {latitude: 53.4487, longitude: -2.3095, accuracy: 40};
test.use({permissions: ['geolocation'], geolocation: LONGFORD_PARK});

const map = page => page.locator('.vector-map');
const shot = async (page, name) =>
  page.screenshot({path: test.info().outputPath(`${test.info().project.name}-${name}.png`)});
async function camera(page) {
  const [zoom, lat, lon, pitch, bearing] = ((await map(page).getAttribute('data-camera')) || '0,0,0,0,0').split(',').map(Number);
  return {zoom, lat, lon, pitch, bearing};
}

/** Where the drawn bus is, whether that is in the usable map area, and how much of the chosen
 *  bus's lime is painted around it. `hud` lists the overlay that covers it, if one does. */
async function identify(page, radius = 70) {
  const root = map(page);
  const geometry = await root.evaluate((el, radius) => {
    const canvas = el.querySelector('.vector-map-canvas').getBoundingClientRect();
    const box = el.getBoundingClientRect();
    const raw = el.getAttribute('data-bus-screen');
    if (!raw) return {drawn: false};
    const [x, y] = raw.split(',').map(Number);
    const inside = x >= 0 && y >= 0 && x <= canvas.width && y <= canvas.height;
    const px = canvas.left + x, py = canvas.top + y;
    const covering = [...el.querySelectorAll('.ride-exit,.ride-notes,.ride-card,.map-tools,.map-views,.vector-map-foot')]
      .map(node => ({name: node.className.split(' ')[0], r: node.getBoundingClientRect()}))
      .filter(({r}) => r.width && r.height && px >= r.left - 4 && px <= r.right + 4 && py >= r.top - 4 && py <= r.bottom + 4)
      .map(({name}) => name);
    return {drawn: true, x, y, inside, covering, clip: {x: Math.max(0, px - box.left - radius), y: Math.max(0, py - box.top - radius),
      width: radius * 2, height: radius * 2}};
  }, radius);
  if (!geometry.drawn || !geometry.inside) return {...geometry, lime: 0, identifiable: false};
  const png = await root.screenshot({clip: geometry.clip});
  const lime = await page.evaluate(async b64 => {
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const dr = d[i] - 0xc6, dg = d[i + 1] - 0xf3, db = d[i + 2] - 0x6a;
      if (dr * dr + dg * dg + db * db <= 30 * 30) n++;
    }
    return n;
  }, png.toString('base64'));
  return {...geometry, lime, identifiable: geometry.covering.length === 0 && lime >= 40};
}
const expectIdentifiable = async (page, what) => {
  const seen = await identify(page);
  expect(seen.identifiable, `${what}: ${JSON.stringify(seen)}`).toBe(true);
  return seen;
};

async function openAtStopA(page, live = {}, motion = {}) {
  await servePatterns(page);
  await serveMotion(page, motion);
  const startMs = Date.now();
  await serveLive(page, [() => movingLive({startMs, ...live})]);
  await page.goto('/');
  await expect(page.locator('.vector-map[data-map-state="painted"]')).toBeVisible({timeout: 45_000});
  await page.getByRole('button', {name: 'Buses near me'}).click();
  await page.locator('.nearby-stop', {hasText: 'Stop A'}).first().click();
  await expect(page.locator('.bus-card .route-badge')).toHaveText('256');
  await map(page).evaluate(el => el.scrollIntoView({block: 'start'}));
}
async function dragMap(page, dx, dy) {
  const box = await page.locator('.vector-map-canvas').boundingBox();
  const x = box.x + box.width * 0.55, y = box.y + box.height * 0.5;
  await page.mouse.move(x, y); await page.mouse.down();
  for (let i = 1; i <= 8; i++) { await page.mouse.move(x + dx * i / 8, y + dy * i / 8); await page.waitForTimeout(30); }
  await page.mouse.up();
}
const ride = page => page.getByRole('button', {name: 'Ride along with route 256'});

test('entering: the introduction plays with the bus identifiable throughout, then following begins', async ({page}) => {
  test.setTimeout(90_000);
  await openAtStopA(page, {wobble: 5});
  await expect(map(page)).toHaveAttribute('data-motion', 'estimated', {timeout: 20_000});
  await ride(page).click();
  await expect(map(page)).toHaveAttribute('data-ride', 'entering');
  await expect(page.locator('.ride-mode')).toContainText('entering');
  const started = Date.now(), during = [];
  while ((await map(page).getAttribute('data-ride')) === 'entering' && during.length < 40) {
    during.push({...await identify(page), at: Date.now() - started}); await page.waitForTimeout(100);
  }
  await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 8000});
  expect(during.length, 'the introduction was sampled').toBeGreaterThan(3);
  // The first glide (1.2 s) starts from wherever the flat map was and brings the bus into the
  // frame; from then on the bus is on the map at every sampled moment. While the camera glides
  // between framings it may pass behind a control for a moment, never for two samples running;
  // for at least half of the way, and at rest, it is clear of every control with its lime
  // marker painted around it.
  const underWay = during.filter(s => s.at >= 1300);
  const offCanvas = underWay.filter(s => !s.inside);
  expect(offCanvas, 'the bus never leaves the map once the introduction is under way').toEqual([]);
  const clear = during.filter(s => s.identifiable).length;
  expect(clear / during.length, `identifiable in at least half the sampled moments (${clear} of ${during.length})`).toBeGreaterThanOrEqual(0.5);
  let run = 0, longest = 0;
  for (const s of underWay) { run = s.identifiable ? 0 : run + 1; longest = Math.max(longest, run); }
  expect(longest, `never hidden behind a control for two samples running (${JSON.stringify(underWay.map(s => s.identifiable ? 1 : s.covering.join('+') || 'off'))})`).toBeLessThanOrEqual(1);
  await page.waitForTimeout(800);
  await expectIdentifiable(page, 'following after the introduction');
  expect((await camera(page)).zoom).toBeCloseTo(20, 0);
  await expect(page.locator('.ride-mode')).toContainText('following the bus');
  await expect(page.locator('.ride-status')).toContainText('following the bus');
  await shot(page, 'ride-following');
});

test('a drag during the introduction ends it, exploring; Return to bus restores the framing and following', async ({page}) => {
  test.setTimeout(90_000);
  await openAtStopA(page, {wobble: 5});
  await expect(map(page)).toHaveAttribute('data-motion', 'estimated', {timeout: 20_000});
  await ride(page).click();
  await expect(map(page)).toHaveAttribute('data-ride', 'entering');
  await page.waitForTimeout(500);
  await dragMap(page, -180, 90);
  await expect(map(page)).toHaveAttribute('data-ride', 'exploring');
  await expect(page.getByRole('button', {name: 'Skip to the bus'})).toHaveCount(0);
  await expect(page.locator('.ride-status')).toContainText('you moved the map');
  const before = await camera(page);
  await page.waitForTimeout(1500);
  expect((await camera(page)).zoom, 'exploring: the camera is left alone').toBeCloseTo(before.zoom, 1);
  await page.getByRole('button', {name: 'Return to bus'}).click();
  await expect(map(page)).toHaveAttribute('data-ride', 'returning');
  await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 5000});
  await page.waitForTimeout(600);
  expect((await camera(page)).zoom, 'useful framing restored').toBeCloseTo(20, 0);
  expect((await camera(page)).pitch).toBeGreaterThan(50);
  await expectIdentifiable(page, 'after Return to bus');
});

test('a tap during the introduction skips to the bus', async ({page}) => {
  test.setTimeout(60_000);
  await openAtStopA(page);
  await ride(page).click();
  await expect(map(page)).toHaveAttribute('data-ride', 'entering');
  await page.waitForTimeout(400);
  const box = await page.locator('.vector-map-canvas').boundingBox();
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.55);
  await expect(map(page)).toHaveAttribute('data-ride', /returning|following/);
  await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 5000});
  await page.waitForTimeout(500);
  expect((await camera(page)).zoom).toBeCloseTo(20, 0);
});

test('dragging while following pauses it predictably, and the negative control: a bus left off screen is not identifiable', async ({page}) => {
  test.setTimeout(90_000);
  await openAtStopA(page, {wobble: 5});
  await ride(page).click();
  await page.getByRole('button', {name: 'Skip to the bus'}).click();
  await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 5000});
  await page.waitForTimeout(600);
  await expectIdentifiable(page, 'following');
  await dragMap(page, 300, 200);
  await expect(map(page)).toHaveAttribute('data-ride', 'exploring');
  await expect(page.getByRole('button', {name: 'Return to bus'})).toBeVisible();
  // The negative control: drag the bus right out of the frame. The same measurement must fail.
  for (let i = 0; i < 3; i++) await dragMap(page, 380, 260);
  await page.waitForTimeout(400);
  const gone = await identify(page);
  expect(gone.identifiable, `off screen: ${JSON.stringify(gone)}`).toBe(false);
  expect(gone.inside, 'the drawn bus is outside the canvas').toBe(false);
  await shot(page, 'ride-exploring-off-screen');
  await page.getByRole('button', {name: 'Return to bus'}).click();
  await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 5000});
  await page.waitForTimeout(600);
  await expectIdentifiable(page, 'back on the bus');
});

test('the passenger’s zoom is kept while following, through new publications, and the bus stays identifiable', async ({page}) => {
  test.setTimeout(90_000);
  await openAtStopA(page, {wobble: 5});
  await ride(page).click();
  await page.getByRole('button', {name: 'Skip to the bus'}).click();
  await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 5000});
  await page.waitForTimeout(500);
  // Two animated zoom-outs: they used to be cancelled by the per-frame jump.
  await page.getByRole('button', {name: 'Zoom out'}).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', {name: 'Zoom out'}).click();
  await page.waitForTimeout(900);
  expect((await camera(page)).zoom, 'both zoom-outs took effect').toBeCloseTo(18, 0);
  await expect(map(page)).toHaveAttribute('data-ride', 'following');
  await page.waitForTimeout(12_000);           // at least one further publication
  expect((await camera(page)).zoom, 'the zoom survives a new report').toBeCloseTo(18, 0);
  await expectIdentifiable(page, 'following at zoom 18');
  await page.getByRole('button', {name: 'Zoom out'}).click();
  await page.waitForTimeout(900);
  expect((await camera(page)).zoom).toBeCloseTo(17, 0);
  await expectIdentifiable(page, 'following at zoom 17, below the model: the flat symbol');
  await shot(page, 'ride-zoomed-out');
});

test('exit returns to the flat map; a repeated entry goes straight to the bus', async ({page}) => {
  test.setTimeout(90_000);
  await openAtStopA(page);
  await ride(page).click();
  await page.getByRole('button', {name: 'Skip to the bus'}).click();
  await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 5000});
  await page.getByRole('button', {name: 'Exit ride-along'}).click();
  await expect(map(page)).toHaveAttribute('data-ride', 'off');
  await expect(map(page)).toHaveAttribute('data-view', '2d');
  await expect.poll(async () => { const c = await camera(page); return c.pitch === 0 && c.bearing === 0; }, {timeout: 10_000}).toBe(true);
  await ride(page).click();
  const states = [];
  for (let i = 0; i < 30; i++) { states.push(await map(page).getAttribute('data-ride')); if (states.at(-1) === 'following') break; await page.waitForTimeout(150); }
  expect(states, 'no second introduction').not.toContain('entering');
  expect(states.at(-1)).toBe('following');
  await page.waitForTimeout(500);
  // On a phone the map grows as the ride starts; applying the new padding at once used to cancel
  // this glide and leave the second ride "following" on the flat street map.
  const second = await camera(page);
  expect(second.zoom, 'the second ride reaches the ride framing').toBeCloseTo(20, 0);
  expect(second.pitch, 'tilted behind the bus').toBeGreaterThan(50);
  await expectIdentifiable(page, 'second ride');
});

test('a bus with no predictions (as route 142 today) is followed at its reports and never hidden', async ({page}) => {
  test.setTimeout(90_000);
  await openAtStopA(page, {wobble: 5}, {evaluation: null});
  await expect(map(page)).toHaveAttribute('data-motion', 'observed', {timeout: 15_000});
  await ride(page).click();
  await page.getByRole('button', {name: 'Skip to the bus'}).click();
  await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 5000});
  await page.waitForTimeout(600);
  await expectIdentifiable(page, 'observed-only bus, following');
  await expect(page.locator('.ride-motion')).toContainText('Last reported position');
  const before = await camera(page);
  await page.waitForTimeout(12_000);           // a new report: the camera goes to it
  const after = await camera(page);
  expect(Math.hypot(after.lat - before.lat, after.lon - before.lon) * 111195, 'the camera moved to the new report').toBeGreaterThan(20);
  await expectIdentifiable(page, 'observed-only bus after a new report');
  await shot(page, 'ride-observed-only');
});

test('a bus without a bearing is shown from above with its number, and a failed model keeps the symbol', async ({page}) => {
  test.setTimeout(90_000);
  await servePatterns(page);
  await serveMotion(page, {});
  await serveLive(page, [() => journeyLive()]);
  await page.goto('/');
  await expect(page.locator('.vector-map[data-map-state="painted"]')).toBeVisible({timeout: 45_000});
  await page.getByRole('button', {name: 'Buses near me'}).click();
  await page.locator('.nearby-stop', {hasText: 'Stop A'}).first().click();
  await page.locator('.nearby-reports .follow-row').first().click();
  await page.getByRole('button', {name: 'Ride along with route 53'}).click();
  await page.getByRole('button', {name: 'Skip to the bus'}).click();
  await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 5000});
  await expect(page.locator('.ride-note')).toContainText('did not report a direction');
  await page.waitForTimeout(800);
  await expectIdentifiable(page, 'no bearing');
  expect((await camera(page)).pitch, 'from above').toBeLessThan(55);
  await shot(page, 'ride-no-bearing');
});

test('a 3D model that fails to load leaves the flat symbol, identifiable at the ride zoom', async ({page}) => {
  test.setTimeout(90_000);
  await page.route('**/models/lm-bus.json*', route => route.fulfill({status: 404, body: ''}));
  await openAtStopA(page, {wobble: 5});
  await ride(page).click();
  await page.getByRole('button', {name: 'Skip to the bus'}).click();
  await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 5000});
  await expect(map(page)).toHaveAttribute('data-model', 'failed', {timeout: 15_000});
  await page.waitForTimeout(800);
  await expectIdentifiable(page, 'model failed');
});

test('a theme change and new publications while riding keep following, with the bus identifiable by night', async ({page}) => {
  test.setTimeout(90_000);
  await openAtStopA(page, {wobble: 5});
  await ride(page).click();
  await page.getByRole('button', {name: 'Skip to the bus'}).click();
  await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 5000});
  await page.getByRole('button', {name: 'Switch to the night map'}).click();
  await expect(map(page)).toHaveAttribute('data-theme', 'night');
  await page.waitForTimeout(12_000);
  await expect(map(page)).toHaveAttribute('data-ride', 'following');
  expect((await camera(page)).zoom).toBeCloseTo(20, 0);
  await expectIdentifiable(page, 'night, after a publication');
  await shot(page, 'ride-night');
});

test('choosing another bus mid-ride re-frames on it; nothing is said to have moved between the two', async ({page}) => {
  test.setTimeout(90_000);
  await openAtStopA(page, {wobble: 5});
  await ride(page).click();
  await page.getByRole('button', {name: 'Skip to the bus'}).click();
  await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 5000});
  await page.locator('.waiting .follow-row', {hasText: 'every possible branch'}).click();
  await expect(map(page)).toHaveAttribute('data-ride', /returning|following/);
  await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 5000});
  await page.waitForTimeout(700);
  await expect(map(page)).toHaveAttribute('data-correction', 'none');
  await expectIdentifiable(page, 'the other bus');
});

test.describe('reduced motion', () => {
  test.use({reducedMotion: 'reduce'});
  test('goes straight to the bus, and Return to bus is a jump', async ({page}) => {
    test.setTimeout(60_000);
    await openAtStopA(page, {wobble: 5});
    await ride(page).click();
    await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 3000});
    expect((await camera(page)).zoom).toBeCloseTo(20, 0);
    await dragMap(page, 200, 120);
    await expect(map(page)).toHaveAttribute('data-ride', 'exploring');
    await page.getByRole('button', {name: 'Return to bus'}).click();
    await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 1500});
    await page.waitForTimeout(400);
    await expectIdentifiable(page, 'reduced motion, returned');
  });
});
