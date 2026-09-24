// The ride-along, state by state, on FIXTURE buses over a real recorded bus road.
//
// "Identifiable" is measured, not inferred from a DOM flag or a loaded model: the drawn bus's
// canvas position (data-bus-screen) must lie inside the map and clear of every control drawn
// over it, and lime marker pixels must be found around that point in a screenshot. The same
// measurement is shown failing on a bus that has been left off screen (the negative control),
// so it cannot be satisfied by stray lime elsewhere on the page.
import {test, expect} from '@playwright/test';
import {journeyLive, movingLive, servePatterns, serveLive, serveMotion, waitForPaint} from './fixtures.mjs';

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
    const covering = [...el.querySelectorAll('.ride-bar,.ride-exit,.ride-notes,.ride-actions,.ride-card,.map-tools,.map-views,.vector-map-foot')]
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
  // `live` is read at every publication, so a check can change what the next one carries.
  // `newEachTime` makes each publication's newest report a second newer than the last: the
  // fixture's reports are otherwise new only once per whole second, and a publication landed on
  // purpose must carry a new report or it proves nothing.
  let calls = 0;
  await serveLive(page, [() => {
    const {newEachTime, ...rest} = live;
    return movingLive({startMs, ...rest, ...(newEachTime ? {delay: Math.max(2, 24 - calls++)} : {})});
  }]);
  await page.goto('/');
  await waitForPaint(page);
  await page.getByRole('button', {name: 'Buses near me'}).click();
  await page.locator('.nearby-stop', {hasText: 'Stop A'}).first().click();
  await expect(page.locator('.bus-card .route-badge')).toHaveText('256');
  await map(page).evaluate(el => el.scrollIntoView({block: 'start'}));
}
/** The fit's camera at rest: neither the camera nor where the stop and the bus are drawn changes
 *  between two looks half a second apart (the idiom of selection.spec's settledMap). */
async function fitSettled(page) {
  let last;
  await expect.poll(async () => {
    const now = await map(page).evaluate(el => `${el.getAttribute('data-camera')}|${el.getAttribute('data-stop-screen')}|${el.getAttribute('data-bus-screen')}`);
    const still = now === last;
    last = now;
    return still;
  }, {intervals: [500], timeout: 15_000, message: 'the fitted camera comes to rest'}).toBe(true);
  await page.waitForTimeout(300);
}
async function dragMap(page, dx, dy) {
  const box = await page.locator('.vector-map-canvas').boundingBox();
  const x = box.x + box.width * 0.55, y = box.y + box.height * 0.5;
  await page.mouse.move(x, y); await page.mouse.down();
  for (let i = 1; i <= 8; i++) { await page.mouse.move(x + dx * i / 8, y + dy * i / 8); await page.waitForTimeout(30); }
  await page.mouse.up();
}
const ride = page => page.getByRole('button', {name: 'Ride along with route 256'});
const metresApart = (a, b) => Math.hypot((b.lon - a.lon) * Math.cos(a.lat * Math.PI / 180), b.lat - a.lat) * 111195;
const drawn = async page => {
  const [lat, lon, s] = ((await map(page).getAttribute('data-display')) || ',,').split(',').map(Number);
  return {lat, lon, s};
};
/** Lime in the middle of the map, below the ride's notes and buttons and above its card, in CSS
 *  pixels: where the bus's own marks would be if they were drawn. (The notes and buttons are
 *  outlined in lime themselves, so the area must stay clear of them.) */
async function limeInMiddle(page) {
  const area = await map(page).evaluate(el => {
    const canvas = el.querySelector('.vector-map-canvas').getBoundingClientRect();
    const edge = (selector, side) => { const r = el.querySelector(selector)?.getBoundingClientRect(); return r && r.height ? r[side] : null; };
    const top = Math.max(canvas.top + canvas.height * 0.3, (edge('.ride-bar', 'bottom') ?? 0) + 8);
    const bottom = Math.min(canvas.top + canvas.height * 0.62, (edge('.ride-card', 'top') ?? Infinity) - 8);
    return {x: canvas.left + canvas.width * 0.25, y: top, width: canvas.width * 0.5, height: Math.max(20, bottom - top),
      scale: window.devicePixelRatio};
  });
  const png = await page.screenshot({clip: {x: area.x, y: area.y, width: area.width, height: area.height}});
  const devicePixels = await page.evaluate(async b64 => {
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
  return devicePixels / (area.scale * area.scale);
}
/** A publication that lands now, as the 10 s poll does: the page's own "Check for newer positions",
 *  pressed from script so that it lands inside a camera move rather than a hand's reach after it. */
async function landPublication(page) {
  const pressed = await page.evaluate(() => {
    const button = [...document.querySelectorAll('button[aria-label="Check for newer positions"]')]
      .find(b => b.offsetParent !== null && !b.disabled);
    button?.click();
    return Boolean(button);
  });
  expect(pressed, 'a refresh control was there to press').toBe(true);
}
/** The hand-over back to the normal map, measured rather than assumed: the ride off, flat and
 *  north up, the phone's full-screen ride layout gone, the Ride along button back, and your stop
 *  and your bus on the map. */
async function expectHandedBack(page, what, timeout = 10_000) {
  await expect(map(page)).toHaveAttribute('data-ride', 'off');
  await expect(map(page)).toHaveAttribute('data-view', '2d');
  await expect.poll(async () => { const c = await camera(page); return c.pitch === 0 && c.bearing === 0; },
    {timeout, message: `${what}: flat and north up`}).toBe(true);
  await expect(map(page)).not.toHaveClass(/view-ride/);
  await expect(page.locator('body')).not.toHaveClass(/riding/);
  await expect(ride(page)).toBeVisible();
  const on = await map(page).evaluate(el => {
    const c = el.querySelector('.vector-map-canvas').getBoundingClientRect();
    const inside = name => { const [x, y] = (el.getAttribute(name) || '').split(',').map(Number);
      return Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0 && x <= c.width && y <= c.height; };
    return {stop: inside('data-stop-screen'), bus: inside('data-bus-screen')};
  });
  expect(on, `${what}: your stop and your bus are on the map`).toEqual({stop: true, bus: true});
}
async function frontView(page) {
  await page.getByRole('button', {name: 'Front view'}).click();
  await expect(map(page)).toHaveAttribute('data-ride-camera', 'front');
  await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 5000});
}

test('entering goes straight to the bus: identifiable while the camera glides, then following at zoom 20', async ({page}) => {
  test.setTimeout(90_000);
  await openAtStopA(page, {wobble: 5});
  await expect(map(page)).toHaveAttribute('data-motion', 'estimated', {timeout: 20_000});
  const clicked = Date.now();
  await ride(page).click();
  // No tour and nothing to skip: the camera goes to the drawn bus at once.
  await expect(map(page)).toHaveAttribute('data-ride', /entering|following/);
  await expect(page.getByRole('button', {name: 'Skip to the bus'})).toHaveCount(0);
  const during = [];
  while ((await map(page).getAttribute('data-ride')) === 'entering' && during.length < 40) {
    during.push({...await identify(page), at: Date.now() - clicked}); await page.waitForTimeout(80);
  }
  await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 5000});
  expect(Date.now() - clicked, 'following within a few seconds, even in a software renderer').toBeLessThan(5000);
  // The glide brings the bus to the middle at the zoom shown, then zooms, tilts and turns around
  // it: the bus is on the map at every sampled moment, and never behind a control for two
  // samples running.
  const arrived = during.findIndex(s => s.inside);
  expect(arrived, 'the bus is on the map while the camera glides').toBeGreaterThanOrEqual(0);
  expect(during.slice(arrived).filter(s => !s.inside),
    'once on the map the bus never leaves it while the camera glides').toEqual([]);
  let run = 0, longest = 0;
  for (const s of during) { run = s.identifiable ? 0 : run + 1; longest = Math.max(longest, run); }
  expect(longest, `never unidentifiable for two samples running (${JSON.stringify(during.map(s => s.identifiable ? 1 : s.covering.join('+') || 'off'))})`).toBeLessThanOrEqual(1);
  await page.waitForTimeout(800);
  await expectIdentifiable(page, 'following');
  expect((await camera(page)).zoom).toBeCloseTo(20, 0);
  await expect(page.locator('.ride-mode')).toContainText('following the bus');
  await expect(page.locator('.ride-status')).toContainText('following the bus');
  await shot(page, 'ride-following');
});

test('a drag as the camera goes to the bus ends the glide, exploring; Return to bus restores the framing and following', async ({page}) => {
  test.setTimeout(90_000);
  await openAtStopA(page, {wobble: 5});
  await expect(map(page)).toHaveAttribute('data-motion', 'estimated', {timeout: 20_000});
  await ride(page).click();
  await expect(map(page)).toHaveAttribute('data-ride', /entering|following/);
  await page.waitForTimeout(200);
  await dragMap(page, -180, 90);
  await expect(map(page)).toHaveAttribute('data-ride', 'exploring');
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

test('a tap as the camera goes to the bus finishes the glide quickly, not stranded mid-way', async ({page}) => {
  test.setTimeout(60_000);
  await openAtStopA(page);
  await ride(page).click();
  await expect(map(page)).toHaveAttribute('data-ride', /entering|following/);
  await page.waitForTimeout(150);
  // A tap anywhere ends the glide. In one run of the gate (24 September 2026) this point fell on a
  // boarding-point sign — the bus is drawn on its road now, 30–60 s behind its reports, so what
  // lies under a fixed point differs run to run — and a tapped sign chose that stop and ended the
  // ride. In the ride a sign now does nothing (the ride is about the bus), so the tap is a tap.
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
  await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 5000});
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
  await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 5000});
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
  await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 5000});
  await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 5000});
  await page.getByRole('button', {name: 'Exit ride-along'}).click();
  await expect(map(page)).toHaveAttribute('data-ride', 'off');
  await expect(map(page)).toHaveAttribute('data-view', '2d');
  await expect.poll(async () => { const c = await camera(page); return c.pitch === 0 && c.bearing === 0; }, {timeout: 10_000}).toBe(true);
  await ride(page).click();
  const states = [];
  for (let i = 0; i < 30; i++) { states.push(await map(page).getAttribute('data-ride')); if (states.at(-1) === 'following') break; await page.waitForTimeout(150); }
  expect(states.filter(s => !['off', 'entering', 'following'].includes(s)), 'straight to the bus, as the first time').toEqual([]);
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
  // The fixture's bus stands at its start until `startMs` and moves from then; since 23 September
  // 2026 a bus at its reports is played back 20–40 s behind them, so with `startMs` at the test's
  // own start the first twenty seconds of the ride would honestly show that standing. A minute of
  // moving history puts the ride in motion from its first frame, which is what this checks.
  await openAtStopA(page, {wobble: 5, startMs: Date.now() - 60_000}, {evaluation: null});
  await expect(map(page)).toHaveAttribute('data-motion', 'observed', {timeout: 15_000});
  await ride(page).click();
  await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 5000});
  await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 5000});
  await page.waitForTimeout(600);
  await expectIdentifiable(page, 'observed-only bus, following');
  // Its wording changed on 21 September 2026: a bus with no checked road is now drawn moving
  // between two of its own reports, so the card states the age of what is shown and says plainly
  // that it is neither estimated nor followed continuously. Since 23 September it is played back
  // on a clock and the label says how far behind its reports it is drawn — to the nearest five
  // seconds, as "about", since 24 September ("drawn about 30 s behind").
  await expect(page.locator('.ride-motion')).toContainText(/Moving between its reports · drawn about \d+ s behind|Last reported position/);
  await expect(page.locator('.ride-motion')).not.toContainText('Estimated position');
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
  await waitForPaint(page);
  await page.getByRole('button', {name: 'Buses near me'}).click();
  await page.locator('.nearby-stop', {hasText: 'Stop A'}).first().click();
  await page.locator('.nearby-reports .follow-row').first().click();
  await page.getByRole('button', {name: 'Ride along with route 53'}).click();
  await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 5000});
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
  await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 5000});
  await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 5000});
  await expect(map(page)).toHaveAttribute('data-model', 'failed', {timeout: 15_000});
  await page.waitForTimeout(800);
  await expectIdentifiable(page, 'model failed');
});

test('a theme change and new publications while riding keep following, with the bus identifiable by night', async ({page}) => {
  test.setTimeout(90_000);
  await openAtStopA(page, {wobble: 5});
  await ride(page).click();
  await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 5000});
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
  await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 5000});
  await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 5000});
  // On a phone the ride-along is the whole screen, so the list behind it is deliberately out of
  // reach: choosing another bus there means leaving the ride, as a passenger would. What is being
  // checked is the same either way — the new bus is framed, and neither bus is said to have moved
  // between the two.
  const onAPhone = test.info().project.name === 'mobile';
  if (onAPhone) {
    await page.getByRole('button', {name: 'Exit ride-along'}).click();
    await expect(map(page)).toHaveAttribute('data-ride', 'off');
  }
  await page.locator('.waiting .follow-row', {hasText: 'every possible branch'}).click();
  if (onAPhone) {
    await map(page).evaluate(el => el.scrollIntoView({block: 'start'}));
    await ride(page).click();
  }
  await expect(map(page)).toHaveAttribute('data-ride', /returning|following/);
  await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 8000});
  await page.waitForTimeout(700);
  await expect(map(page)).toHaveAttribute('data-correction', 'none');
  await expectIdentifiable(page, 'the other bus');
});

test('before riding, a fitted map keeps your stop, its name and your bus clear of the Ride along button, the legend and the tools, by day and by night', async ({page}) => {
  test.setTimeout(90_000);
  // This scenario put Stretford Mall's name under the Ride along button on a phone.
  await openAtStopA(page);
  for (const theme of ['day', 'night']) {
    if (theme === 'night') await page.getByRole('button', {name: 'Switch to the night map'}).click();
    await page.getByRole('button', {name: 'Fit journey'}).click();
    // Measure the *settled* fit. A fixed 1.2 s read the stop's position while the 500 ms glide
    // was still running under SwiftShader, later still after the night repaint, and reported the
    // stop under the chip when the settled layout was 24 px clear (21 September 2026: failed twice
    // on one build, passed once; the trace's last frame was clear). The requirement is unchanged —
    // the fitted layout must keep the stop, its name and the bus clear — it is now read at rest.
    await fitSettled(page);
    const seen = await map(page).evaluate(el => {
      const canvas = el.querySelector('.vector-map-canvas').getBoundingClientRect();
      const point = name => { const raw = el.getAttribute(name); if (!raw) return null; const [x, y] = raw.split(',').map(Number); return {x: canvas.left + x, y: canvas.top + y}; };
      const controls = [...el.querySelectorAll('.ride-launch,.map-legend-chips span,.map-views,.map-tools,.map-credit-line')]
        .map(n => ({name: n.className.split(' ')[0], r: n.getBoundingClientRect()})).filter(c => c.r.width && c.r.height);
      // A name can sit on any side of its dot (variable anchors), so a box around the dot stays clear.
      const clear = (p, w, h) => controls.filter(c => p.x - w < c.r.right && p.x + w > c.r.left && p.y - h < c.r.bottom && p.y + h > c.r.top).map(c => c.name);
      const inside = p => p.x >= canvas.left && p.x <= canvas.right && p.y >= canvas.top && p.y <= canvas.bottom;
      const stop = point('data-stop-screen'), bus = point('data-bus-screen');
      // The numbers travel with the verdict, so a failure says where things were, not only that they met.
      const at = p => p && [Math.round(p.x), Math.round(p.y)];
      const chip = el.querySelector('.ride-launch')?.getBoundingClientRect();
      return {stop: stop && {inside: inside(stop), under: clear(stop, 60, 36), at: at(stop)},
              bus: bus && {inside: inside(bus), under: clear(bus, 26, 30), at: at(bus)},
              chip: chip && [Math.round(chip.left), Math.round(chip.top), Math.round(chip.right), Math.round(chip.bottom)],
              canvas: [Math.round(canvas.left), Math.round(canvas.top), Math.round(canvas.right), Math.round(canvas.bottom)],
              zoom: el.getAttribute('data-camera')?.split(',')[0],
              // The fit's own inputs, so a wrong fit says which input was wrong.
              camera: el.getAttribute('data-camera'), padding: el.getAttribute('data-padding'), moves: el.getAttribute('data-moves'),
              pads: Object.fromEntries(['.map-views', '.map-tools', '.vector-map-foot', '.map-legend-chips'].map(sel => {
                const q = el.querySelector(sel)?.getBoundingClientRect();
                return [sel, q && q.width ? [Math.round(q.left), Math.round(q.top), Math.round(q.right), Math.round(q.bottom)] : null];
              })),
              box: (() => {const b = el.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)]})()};
    });
    console.log(`fit ${theme}: ${JSON.stringify(seen)}`);
    expect(seen.stop?.inside && seen.stop.under.length === 0, `${theme}: your stop and its name are clear (${JSON.stringify(seen)})`).toBe(true);
    expect(seen.bus?.inside && seen.bus.under.length === 0, `${theme}: your bus is clear (${JSON.stringify(seen)})`).toBe(true);
    await shot(page, `fit-${theme}`);
  }
});

// Already moving for 90 s when the page opens, so its trail shows it moving and it is estimated
// at its speed (a bus that has just set off is read as standing until its trail shows otherwise).
const underWay = (extra = {}) => ({startMs: Date.now() - 90_000, startS: 150, speed: 7, ...extra});

test('front view: a raised preview along the checked road, the bus’s outside hidden, and Outside view brings it back', async ({page}) => {
  test.setTimeout(90_000);
  await openAtStopA(page, underWay({wobble: 3}));
  await expect(map(page)).toHaveAttribute('data-motion', 'estimated', {timeout: 20_000});
  await ride(page).click();
  await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 5000});
  await frontView(page);
  await page.waitForTimeout(600);
  const c = await camera(page), d = await drawn(page);
  // From above the road rather than a seat: the street, not the sky, fills most of the frame.
  expect(c.pitch, 'looking along the road ahead from above it').toBeGreaterThan(70);
  expect(c.pitch, 'with the street filling most of the frame').toBeLessThan(82);
  // The eye is 7.5 m up and looks 32 m ahead at a standstill, lengthening to 80 m with the drawn
  // speed (963633a). MapLibre derives the zoom from that reach, so at speed it reads below the 19.8
  // of a standstill (19.785 measured on the fixture). 18.5 is the reach cap's zoom at 7.5 m; a
  // street-map zoom is 16 and the outside ride 20, so the bound still tells the views apart.
  expect(c.zoom, 'close to the road').toBeGreaterThan(18.5);
  expect(Number(await map(page).getAttribute('data-stops-ahead')), 'the next stops on its pattern, named').toBeGreaterThan(0);
  const ahead = metresApart(c, d);
  expect(ahead, `the eye rests on the road ahead of the drawn bus (${ahead.toFixed(1)} m)`).toBeGreaterThan(15);
  // 32 m at a standstill, 2.5 m more per m/s of drawn speed, capped at 80 m (963633a), plus the
  // 4 m the eye sits forward of the drawn position: 54.5 m measured on this fixture at about 8 m/s.
  expect(ahead).toBeLessThan(85);
  expect(await limeInMiddle(page), 'nothing of the bus’s outside is drawn in the view').toBeLessThan(20);
  // What stays: route, destination, report age, whether it is estimated, and the way back out.
  await expect(page.locator('.ride-card')).toContainText('256');
  await expect(page.locator('.ride-card')).toContainText('Piccadilly Gardens');
  await expect(page.locator('.ride-card .ride-motion')).toContainText(/Estimated position · last report \d+ s ago/);
  await expect(page.locator('.ride-mode')).toContainText('street preview');
  await expect(page.getByRole('button', {name: 'Zoom in'})).toBeDisabled();
  await shot(page, 'front-view');
  // Over time the eye moves with the drawn bus, and only as far as it does.
  const first = {c: await camera(page), d: await drawn(page)};
  await page.waitForTimeout(3000);
  const last = {c: await camera(page), d: await drawn(page)};
  const eyeMoved = metresApart(first.c, last.c), busMoved = last.d.s - first.d.s;
  expect(busMoved, 'the bus moved').toBeGreaterThan(5);
  expect(Math.abs(eyeMoved - busMoved), `the eye moved as the bus did (${eyeMoved.toFixed(1)} m against ${busMoved.toFixed(1)} m)`).toBeLessThan(6);
  await page.getByRole('button', {name: 'Outside view'}).click();
  await expect(map(page)).toHaveAttribute('data-ride-camera', 'outside');
  await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 5000});
  await page.waitForTimeout(700);
  expect((await camera(page)).zoom).toBeCloseTo(20, 0);
  await expectIdentifiable(page, 'outside again: the bus is back');
});

test('in the front view a zoom is the passenger taking over: following pauses rather than undoing it, and Return to bus resumes', async ({page}) => {
  test.skip(test.info().project.name !== 'desktop', 'a wheel is a desktop gesture');
  test.setTimeout(90_000);
  await openAtStopA(page, underWay());
  await expect(map(page)).toHaveAttribute('data-motion', 'estimated', {timeout: 20_000});
  await ride(page).click();
  await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 5000});
  await frontView(page);
  await page.waitForTimeout(600);
  const box = await page.locator('.vector-map-canvas').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.6);
  await page.mouse.wheel(0, -400);
  await expect(map(page), 'a zoom in the front view pauses following').toHaveAttribute('data-ride', 'exploring', {timeout: 5000});
  await page.waitForTimeout(800);
  const zoomed = (await camera(page)).zoom;
  await page.waitForTimeout(1500);
  expect((await camera(page)).zoom, 'the passenger’s zoom is left alone, not undone').toBeCloseTo(zoomed, 1);
  await page.getByRole('button', {name: 'Return to bus'}).click();
  await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 10_000});
  await expect(map(page)).toHaveAttribute('data-ride-camera', 'front');
});

test('on a phone, fingers on the map are the passenger’s: a pinch zooms the outside ride-along and it keeps following; a drag, or a pinch in the front view, pauses it', async ({page, context}) => {
  test.skip(test.info().project.name !== 'mobile', 'touch gestures are a phone’s');
  test.setTimeout(120_000);
  // Chromium's own input pipeline, as a finger's would be: touch events, not mouse ones.
  const cdp = await context.newCDPSession(page);
  const centre = async () => {
    const box = await page.locator('.vector-map-canvas').boundingBox();
    return {x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height * 0.45)};
  };
  const pinch = async scaleFactor => cdp.send('Input.synthesizePinchGesture',
    {...await centre(), scaleFactor, relativeSpeed: 600, gestureSourceType: 'touch'});
  await openAtStopA(page, underWay());
  await ride(page).click();
  await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 8000});
  await page.waitForTimeout(800);

  const before = (await camera(page)).zoom;
  await pinch(1.6);
  await page.waitForTimeout(600);
  const pinched = (await camera(page)).zoom;
  expect(pinched - before, 'the pinch zoomed the map').toBeGreaterThan(0.3);
  await page.waitForTimeout(2500);
  expect((await camera(page)).zoom, 'the pinched zoom is kept while following').toBeCloseTo(pinched, 1);
  await expect(map(page)).toHaveAttribute('data-ride', 'following');

  const {x, y} = await centre();
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x, y}]});
  for (let i = 1; i <= 10; i++) {
    await page.waitForTimeout(30);
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: x + i * 8, y: y + i * 5}]});
  }
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
  await expect(map(page), 'a one-finger drag pauses following').toHaveAttribute('data-ride', 'exploring', {timeout: 5000});
  await page.getByRole('button', {name: 'Return to bus'}).click();
  await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 10_000});

  await frontView(page);
  await page.waitForTimeout(600);
  await pinch(1.6);
  await expect(map(page), 'a pinch in the front view pauses following').toHaveAttribute('data-ride', 'exploring', {timeout: 5000});
  await page.getByRole('button', {name: 'Return to bus'}).click();
  await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 10_000});
  await expect(map(page)).toHaveAttribute('data-ride-camera', 'front');
});

test('front view needs a road checked against the bus’s own reports: without one it says why, and the bus stays the same', async ({page}) => {
  test.setTimeout(90_000);
  await openAtStopA(page);
  // Route 53 has no timetable pattern here, so it has no checked road shape either.
  await page.locator('.nearby-reports .follow-row', {hasText: '53'}).first().click();
  await expect(page.locator('.bus-card .route-badge')).toHaveText('53');
  await page.getByRole('button', {name: 'Ride along with route 53'}).click();
  await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 5000});
  // Until 21 September 2026 this button was marked aria-disabled and said only "Front view", so a
  // passenger learned it could not be used by pressing it. It now names the reason on its face and
  // stays pressable, which is why the check is on the label first and the press second.
  const front = page.getByRole('button', {name: /Front view/});
  await expect(front).toHaveClass(/unavailable/);
  // "this bus is not placed" joined the states on 23 September 2026. Route 53 is not placed on a
  // timetable pattern at all, which is a different thing from a pattern whose road has not been
  // built, and until then both read "not on this route" — and a bus with no pattern could get
  // stuck on "checking" for ever, because that state was read from the same null.
  await expect(front, 'the reason is on the button, before it is pressed')
    .toContainText(/not on this route|not here yet|not placed|checking/);
  await front.click();
  // The reason names which of the two is missing: a road that was never built for this service,
  // or — as here — no timetable pattern to have a road for at all.
  await expect(page.locator('.ride-note', {hasText: /Front view needs (the|to know which) road this bus is on/}))
    .toBeVisible();
  await expect(map(page)).toHaveAttribute('data-ride-camera', 'outside');
  await expect(page.locator('.bus-card .route-badge'), 'the selected bus is not changed').toHaveText('53');
  await expectIdentifiable(page, 'still outside, the same bus');
});

test('front view: a standing bus holds the view still', async ({page}) => {
  test.setTimeout(90_000);
  await openAtStopA(page, {standing: true});
  await expect(map(page)).toHaveAttribute('data-motion-reason', /standing/, {timeout: 20_000});
  await ride(page).click();
  await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 5000});
  await frontView(page);
  await page.waitForTimeout(800);
  const still = await map(page).getAttribute('data-camera');
  await page.waitForTimeout(3000);
  expect(await map(page).getAttribute('data-camera'), 'nothing moves the view while the bus stands').toBe(still);
});

/**
 * Split out of the check above on 23 September 2026, because it fails intermittently against a
 * defect that is older than this milestone and is not fixed.
 *
 * Leaving the ride asks for a fit that returns the map to flat. `fitBounds` works the camera out
 * from the bounds and does not carry a pitch with it, so whenever two or more things were framed
 * the map kept the ride's tilt: measured 2 of 3 runs on a phone at 21.2° and 35.9°, on this build
 * *and on its parent*, so it was passing in the gate by luck rather than working. The fit now eases
 * to a camera worked out with `cameraForBounds`, which does carry the pitch, and the ride's heading
 * is no longer applied for the frame or two after the ride ends while `input.view` is still stale.
 * Together those take the residue from 21–39° to **2.5–3.0°**, which is flat to the eye and is not
 * flat. The last few degrees are an interrupted ease on leaving the *front* view specifically — the
 * outside view returns to 0 immediately, measured 3 runs of 3 — and are backlog 23.
 *
 * The assertion is left as it should be. It is a red line that names an open defect, not a flake.
 */
test('leaving the ride returns the map to flat (backlog 23: the last few degrees remain)', async ({page}) => {
  test.setTimeout(90_000);
  await openAtStopA(page, {standing: true});
  await expect(map(page)).toHaveAttribute('data-motion-reason', /standing/, {timeout: 20_000});
  await ride(page).click();
  await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 5000});
  await frontView(page);
  // The same four seconds in the front view the check above spends, because that is the situation
  // the residue appears in: leaving after about a second returns to flat every time.
  await page.waitForTimeout(3800);
  await page.getByRole('button', {name: 'Exit ride-along'}).click();
  await expect(map(page)).toHaveAttribute('data-ride', 'off');
  await expect.poll(async () => (await camera(page)).pitch, {timeout: 10_000}).toBe(0);
});

// Backlog 23, found (24 September 2026). The check above failed now and then because a publication
// happened to land within half a second of Exit: the effect that brings the frame to a new report
// outside it eased the camera by its centre alone while the hand-over's ease to flat was running,
// which stopped that ease and kept whatever tilt the map had reached (logged: 68.4° and 44.9°, the
// interrupting call made while the map was moving). These land a publication inside the hand-over
// on purpose, so the case the poll hit by chance is hit every time. The bus is 400 m before your
// stop, where the hand-over's fit frames both: a bus a kilometre off is framed by the stop's
// surroundings instead, and the next report then brings the frame to it — the ordinary rule for a
// new report outside the frame, which these checks are not about.
const NEAR_STOP = 1100;                          // metres along the fixture road; Stop A is at 1499
test('leaving the front view hands back to the flat map even when a publication lands during the hand-over', async ({page}) => {
  test.setTimeout(90_000);
  await openAtStopA(page, {standing: true, startS: NEAR_STOP, newEachTime: true});
  await expect(map(page)).toHaveAttribute('data-motion-reason', /standing/, {timeout: 20_000});
  await ride(page).click();
  await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 5000});
  await frontView(page);
  await page.waitForTimeout(1500);
  await page.getByRole('button', {name: 'Exit ride-along'}).click();
  await page.waitForTimeout(60);
  await landPublication(page);
  await expectHandedBack(page, 'front view, a publication in the hand-over');
});

test('leaving the outside view hands back to the flat map even when a publication lands during the hand-over', async ({page}) => {
  test.setTimeout(90_000);
  await openAtStopA(page, {startS: NEAR_STOP, speed: 4, newEachTime: true});
  await ride(page).click();
  await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 5000});
  await page.waitForTimeout(1500);
  await page.getByRole('button', {name: 'Exit ride-along'}).click();
  await page.waitForTimeout(60);
  await landPublication(page);
  await expectHandedBack(page, 'outside view, a publication in the hand-over');
});

test('a new report outside the frame waits for a camera move to finish, then brings the frame to it', async ({page}) => {
  test.setTimeout(90_000);
  // Measured on the deployed build (24 September 2026): on the desktop frame even the far end of
  // the fixture road lies inside City's tilted view, so no report is chased and the check would
  // prove nothing there; on the phone it is chased, and City stopped at 6-7° of its 58°.
  test.skip(test.info().project.name !== 'mobile', 'the desktop frame holds the whole fixture road in City');
  // The same effect, the other way it showed: pressing City starts a 0.9 s tilt, and a report
  // landing during it would have left the map part-tilted. It must still do its job afterwards.
  const live = {newEachTime: true};
  await openAtStopA(page, live);
  await fitSettled(page);
  // The next publication puts the bus at the far end of its road, about a kilometre past your stop
  // and well outside the frame on either screen (a 1.4 km jump fell inside the desktop frame).
  live.jump = {atMs: 0, metres: 2400};
  await page.getByRole('button', {name: 'City', exact: true}).click();
  await page.waitForTimeout(60);
  await landPublication(page);
  await expect.poll(async () => { const c = await camera(page); return Math.round(c.pitch); },
    {timeout: 10_000, message: 'City reaches its tilt'}).toBe(58);
  await expect.poll(async () => map(page).evaluate(el => {
    const c = el.querySelector('.vector-map-canvas').getBoundingClientRect();
    const [x, y] = (el.getAttribute('data-bus-screen') || '').split(',').map(Number);
    return x >= 0 && y >= 0 && x <= c.width && y <= c.height;
  }), {timeout: 10_000, message: 'and then the frame goes to the new report'}).toBe(true);
  expect(Math.round((await camera(page)).pitch), 'at the tilt City asked for').toBe(58);
});

test('front view: a report that corrects the estimate by 60 m is absorbed smoothly, never as a jump', async ({page}) => {
  test.setTimeout(150_000);
  await openAtStopA(page, underWay({wobble: 0, jump: {atMs: Date.now() + 30_000, metres: 60}}));
  await expect(map(page)).toHaveAttribute('data-motion', 'estimated', {timeout: 20_000});
  await ride(page).click();
  await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 5000});
  await frontView(page);
  const seen = [];
  const until = Date.now() + 45_000;
  while (Date.now() < until) {
    seen.push({t: Date.now(), c: await camera(page), correction: await map(page).getAttribute('data-correction')});
    if (/^smooth:(4|5|6|7)\d:/.test(seen.at(-1).correction) && seen.length > 20
        && Date.now() - Number(seen.at(-1).correction.split(':')[2]) > 8000) break;
    await page.waitForTimeout(200);
  }
  const corrections = [...new Set(seen.map(s => s.correction).filter(c => c && c !== 'none'))];
  expect(corrections.some(c => /^smooth:(4|5|6|7)\d:/.test(c)), `the 60 m report was a smooth correction (${corrections})`).toBe(true);
  let fastest = 0;
  for (let i = 1; i < seen.length; i++) {
    const dt = (seen[i].t - seen[i - 1].t) / 1000;
    if (dt > 0) fastest = Math.max(fastest, metresApart(seen[i - 1].c, seen[i].c) / dt);
  }
  // At most the bus's own speed plus the catch-up limit (15 m/s), with room for sampling.
  expect(fastest, `the eye never jumped (fastest ${fastest.toFixed(1)} m/s)`).toBeLessThan(28);
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

  test('leaving the front view hands back to the flat map at once, a publication landing or not', async ({page}) => {
    test.setTimeout(60_000);
    await openAtStopA(page, {standing: true, startS: NEAR_STOP, newEachTime: true});
    await expect(map(page)).toHaveAttribute('data-motion-reason', /standing/, {timeout: 20_000});
    await ride(page).click();
    await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 3000});
    await frontView(page);
    await page.waitForTimeout(1000);
    await page.getByRole('button', {name: 'Exit ride-along'}).click();
    await landPublication(page);
    // No glide under reduced motion: flat within a moment, not after an ease.
    await expectHandedBack(page, 'reduced motion, front view', 2000);
  });

  test('the front view steps every few seconds instead of flowing', async ({page}) => {
    test.setTimeout(60_000);
    await openAtStopA(page, underWay({wobble: 3}));
    await expect(map(page)).toHaveAttribute('data-motion', 'estimated', {timeout: 20_000});
    await ride(page).click();
    await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 3000});
    await frontView(page);
    await page.waitForTimeout(500);
    const views = new Set();
    for (let i = 0; i < 24; i++) { views.add(await map(page).getAttribute('data-camera')); await page.waitForTimeout(250); }
    expect(views.size, `a handful of still views in 6 s, not a flow (${views.size})`).toBeLessThanOrEqual(4);
  });
});
