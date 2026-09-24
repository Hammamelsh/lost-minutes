// The ride itself: a bus with no accepted road geometry travels between its reports instead of
// teleporting, every way a bus is drawn answers a tap, the chosen bus's own past is not mistaken
// for other buses, and the front view says what it can do before it is pressed. FIXTURE data on
// real NaPTAN stops; SwiftShader, so the frame times are a software renderer's, not a phone's.
import {test, expect} from '@playwright/test';
import {FIXTURE_STOP_OFFSETS, fixtureOffsetOf, journeyLive, mapBand, metresOffFixtureRoad, movingLive, serveLive, serveMotion,
  servePatterns, waitForPaint} from './fixtures.mjs';

const STOP_A = '1800SJ00811';
const map = page => page.locator('.vector-map').first();
const drawn = async page => {
  const d = await map(page).getAttribute('data-display');
  return d ? d.split(',').slice(0, 2).map(Number) : null;
};
const metresApart = (a, b) => Math.hypot((b[1] - a[1]) * Math.cos(a[0] * Math.PI / 180), b[0] - a[0]) * 111195;

/** The shapes index with nothing accepted: the state most services are still in. */
async function noGeometry(page) {
  await page.route('**/data/shapes/index.json*', route => route.fulfill({json: {schemaVersion: 1,
    patterns: {'FX:256:main': {status: 'rejected', reason: 'FIXTURE: no reports to check a shape against'}}}}));
}

test('a bus with no accepted road geometry travels to each report instead of jumping to it', async ({page}) => {
  await servePatterns(page);
  await serveMotion(page);
  await noGeometry(page);                       // after serveMotion, so this route wins
  // The fixture's bus stands until `startMs` and moves from then; since 24 September 2026 a bus
  // at its reports is played back 30–60 s behind them at a bus's pace, so with `startMs` at the
  // test's own start the check's window would honestly show that standing (it passed or failed
  // on page-load timing alone). A minute and a half of moving history puts the ride in motion
  // from its first frame, which is what this checks.
  const start = Date.now() - 90_000;
  await serveLive(page, [() => movingLive({nowMs: Date.now(), startMs: start, speed: 9, cadence: 10})]);
  await page.goto('/');
  await waitForPaint(page);
  // Try Ride-along's first row is this bus (fresh, placed on its pattern, no checked road) and
  // choosing it starts the ride at once (23 September 2026).
  await page.locator('.try-ride button[data-ride-bus]').first().click();
  await expect(map(page)).toHaveAttribute('data-ride', /entering|following/, {timeout: 15_000});
  await expect(map(page)).toHaveAttribute('data-motion', 'observed', {timeout: 15_000});

  const points = [];
  for (let i = 0; i < 260; i++) {                // about 26 s: two or three reports arrive
    const p = await drawn(page);
    if (p) points.push(p);
    await page.waitForTimeout(100);
  }
  const steps = points.slice(1).map((p, i) => metresApart(points[i], p)).filter(Number.isFinite);
  const moved = steps.filter(d => d > 0.5);
  expect(moved.length, 'the bus is drawn moving, not standing still between reports').toBeGreaterThan(8);
  expect(Math.max(...steps), 'and never covers a report’s worth of road in one frame').toBeLessThan(40);
  await page.screenshot({path: test.info().outputPath(`${test.info().project.name}-observed-ride.png`)});
});

test('the chosen bus’s own past reports are drawn, and are not other buses', async ({page}) => {
  await servePatterns(page);
  await serveLive(page, [() => journeyLive()]);
  await page.goto(`/?stop=${STOP_A}`);
  await waitForPaint(page);
  await page.locator('.follow-row').first().click();
  const chosen = await page.locator('article.bus-card').getAttribute('data-vehicle');
  // The trail is drawn as hollow rings, half a marker's size: not selectable, and not other buses.
  // `data-bus-points` lists every *other* bus that is drawn, so the trail must not appear in it.
  const raw = await map(page).getAttribute('data-bus-points');
  const others = raw ? JSON.parse(raw) : [];
  expect(others.every(p => typeof p.key === 'string' && p.key.includes('|')),
    'only real buses are offered as targets').toBe(true);
  expect(others.some(p => p.key.endsWith(`|${chosen}`)), 'the chosen bus is not also listed as another bus').toBe(false);
  // Tapping empty map space leaves the chosen bus alone.
  const box = await mapBand(page);
  await page.mouse.click(box.x + 12, box.y + box.height - 12);
  await page.waitForTimeout(500);
  expect(await page.locator('article.bus-card').getAttribute('data-vehicle')).toBe(chosen);
});

test('the front view says what it can do before it is pressed, and never becomes a dead button', async ({page}) => {
  await servePatterns(page);
  await serveMotion(page);
  await noGeometry(page);
  await serveLive(page, [() => movingLive({nowMs: Date.now(), startMs: Date.now()})]);
  await page.goto('/');
  await waitForPaint(page);
  // Try Ride-along's first row is this bus (fresh, placed on its pattern, no checked road) and
  // choosing it starts the ride at once (23 September 2026).
  await page.locator('.try-ride button[data-ride-bus]').first().click();
  await expect(map(page)).toHaveAttribute('data-ride', /entering|following/, {timeout: 15_000});
  const button = page.locator('.ride-camera');
  await expect(button).toBeVisible();
  await expect(button, 'it names the reason on its face, before it is pressed').toContainText(/not on this route|checking|not here yet/);
  await expect(button).toHaveClass(/unavailable/);
  const why = await button.getAttribute('title');
  expect(why, 'and carries the whole reason').toMatch(/road/i);
  // Pressing it explains rather than doing nothing, and the ride carries on outside, following.
  await button.click();
  await expect(page.locator('.ride-note')).toContainText(/road/i);
  await expect(map(page)).toHaveAttribute('data-ride', /following|entering|exploring/);
  await expect(map(page)).toHaveAttribute('data-motion', 'observed');
});

test('a fresh home page suggests no bus of its own accord', async ({page}) => {
  await servePatterns(page);
  await serveLive(page, [() => journeyLive()]);
  await page.goto('/');
  await waitForPaint(page);
  await page.waitForTimeout(2500);
  await expect(page.locator('article.bus-card'), 'nothing is chosen for a passenger who has chosen nothing').toHaveCount(0);
  await expect(page.locator('.active-bus')).toHaveCount(0);
  // Choosing a route is choosing: then, and only then, one is shown.
  const select = page.locator('#follow-route');
  if (await select.count()) {
    await select.selectOption({index: 0});
    await expect(page.locator('article.bus-card')).toHaveCount(1, {timeout: 10_000});
  }
});

test('riding a bus that does not serve your stop leads with the bus, and says the mismatch once', async ({page}) => {
  await servePatterns(page);
  await serveLive(page, [() => journeyLive()]);
  await page.goto(`/?stop=${STOP_A}`);
  await waitForPaint(page);
  const more = page.locator('details.exploring');
  if (await more.count()) await more.evaluate(d => {d.open = true});
  const other = page.locator('.nearby-reports .follow-row, details.exploring .follow-row').first();
  await other.click();
  await expect(page.locator('.follow')).toHaveClass(/exploring-bus/);
  const said = await page.evaluate(() => (document.body.innerText.match(/does not serve your stop/gi) || []).length);
  expect(said, 'the mismatch is stated once, not once per surface').toBeLessThanOrEqual(1);
  const card = await page.locator('article.bus-card').boundingBox();
  const stop = await page.locator('.your-stop').boundingBox();
  expect(card.y, 'the bus you chose comes before the stop you left').toBeLessThan(stop.y);
  await expect(page.getByRole('button', {name: /Back to buses for your stop/})).toBeVisible();
  await page.screenshot({path: test.info().outputPath(`${test.info().project.name}-exploring.png`), fullPage: true});
  // And going back restores the ordinary order.
  await page.getByRole('button', {name: /Back to buses for your stop/}).click();
  await expect(page.locator('.follow')).not.toHaveClass(/exploring-bus/);
});

test('a bus travelling between its reports goes down the checked road, not across the corner', async ({page}) => {
  test.setTimeout(120_000);
  // An accepted road shape, and no published evaluation: the road is there, prediction is not, so
  // the bus is drawn at its reports and travels between them. Until 22 September 2026 that travel
  // was a straight line between two reports whatever road was known — measured on one real
  // route-25 journey, the chord left the checked road by a median 5.3 m, 28.5 m at the 95th
  // percentile and 34.4 m at worst, which at that distance is the next street.
  await servePatterns(page);
  await serveMotion(page, {evaluation: null});
  const started = Date.now();
  await serveLive(page, Array.from({length: 40}, () => () =>
    movingLive({startMs: started, startS: 250, speed: 9, cadence: 20, delay: 4})));
  await page.goto('/?bus=BNML%7CFX-MOVING%7C256%7Cinbound%7CFX-MOVING-J');
  await waitForPaint(page);
  const map = page.locator('.vector-map');
  await expect(map).toHaveAttribute('data-motion', 'observed', {timeout: 20_000});
  const seen = [];
  for (let i = 0; i < 90; i++) {
    const display = await map.getAttribute('data-display');
    if (display) {
      const [lat, lon] = display.split(',').map(Number);
      if (Number.isFinite(lat) && Number.isFinite(lon)) seen.push([lat, lon]);
    }
    await page.waitForTimeout(400);
  }
  expect(seen.length, 'the drawn bus was sampled').toBeGreaterThan(40);
  const off = seen.map(([lat, lon]) => metresOffFixtureRoad(lat, lon)).sort((a, b) => a - b);
  const p95 = off[Math.floor(off.length * 0.95)];
  expect(p95, `95% of drawn positions are on the checked road (p95 ${p95.toFixed(1)} m)`).toBeLessThan(6);
  expect(off.at(-1), `and none of them is a street away (max ${off.at(-1).toFixed(1)} m)`).toBeLessThan(15);
  // And the page says which it did, rather than leaving the passenger to guess.
  await page.locator('.bus-card-motion details').first().click({timeout: 5000}).catch(() => {});
  await expect(page.locator('.bus-card-motion')).toContainText('down the road checked against');
});

test('a move too far to have been followed is repositioned and said, never a silent teleport', async ({page}) => {
  test.setTimeout(120_000);
  await servePatterns(page);
  await serveMotion(page, {evaluation: null});
  const started = Date.now();
  // A 900 m step between two reports: further than a bus can be followed between them, so the
  // page must move it and say so. Until 22 September 2026 this path returned the bus at its new
  // report with no correction recorded at all — no trace on the map, no line on the card.
  const jump = {atMs: started + 22_000, metres: 900};
  await serveLive(page, Array.from({length: 40}, () => () =>
    movingLive({startMs: started, startS: 250, speed: 6, cadence: 20, delay: 4, jump})));
  await page.goto('/?bus=BNML%7CFX-MOVING%7C256%7Cinbound%7CFX-MOVING-J');
  await waitForPaint(page);
  const map = page.locator('.vector-map');
  await expect(map).toHaveAttribute('data-motion', 'observed', {timeout: 20_000});
  await page.locator('.ride-launch').click();
  await expect(map).toHaveAttribute('data-ride', 'following', {timeout: 20_000});
  const line = page.locator('.ride-card [data-snap]');
  await expect(line, 'the repositioning is said on the card').toBeVisible({timeout: 60_000});
  await expect(line).toContainText(/Moved \d+ m to its latest report/);
  await expect(line).toHaveAttribute('data-why', 'too_far');
  await expect(line).toContainText('too far to have been followed');
  await expect(map, 'and the map records it as a repositioning, not as travel')
    .toHaveAttribute('data-correction', /^snap:/);
});

test('coming or past is judged by the newest report while the drawn bus is still half a minute behind it, and the stated delay is the measured one', async ({page}) => {
  test.setTimeout(160_000);
  await servePatterns(page);
  await serveMotion(page, {evaluation: null});   // a checked road and no prediction: played back 30–60 s behind
  // Stop A is index 6 on the fixture road, 1499 m along it; the newest report is nearest the stop
  // after it once past 1655 m. At 11 m/s from 500 m a minute ago, the first publication's newest
  // report is about 1120 m in — one stop before yours — and it passes 1655 m about 45 s after the
  // page opens, while the drawn bus, half a minute or more behind, is still short of the stop.
  const started = Date.now() - 60_000;
  await serveLive(page, Array.from({length: 40}, () => () =>
    movingLive({startMs: started, startS: 500, speed: 11, cadence: 10, delay: 4})));
  await page.goto(`/?stop=${STOP_A}&bus=BNML%7CFX-MOVING%7C256%7Cinbound%7CFX-MOVING-J`);
  await waitForPaint(page);
  const card = page.locator('article.bus-card');
  await expect(card).toContainText(/before yours/, {timeout: 20_000});
  await expect(map(page)).toHaveAttribute('data-motion', 'observed', {timeout: 20_000});
  await page.locator('.ride-launch').click();
  await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 20_000});
  const progress = page.locator('.ride-card .ride-progress');
  await expect(progress).toContainText(/before yours|from your stop/);
  // The newest report passes the stop. The card says so at the publication that carried it — not
  // 30–60 s later when the drawn bus gets there — so at that moment the drawn bus is still before
  // the stop. The decision came from the report; the drawing had nothing to do with it.
  // Past the stop the bus is no longer one of the stop's: the card's eyebrow says so ("Selected
  // bus · past your stop") and the progress line goes with the answer it belonged to.
  await expect(page.locator('.ride-card')).toContainText(/past your stop/i, {timeout: 100_000});
  const display = (await map(page).getAttribute('data-display')) || '';
  const [lat, lon] = display.split(',').map(Number);
  const drawnS = fixtureOffsetOf(lat, lon), stopS = FIXTURE_STOP_OFFSETS[6];
  expect(drawnS, `the drawn bus (${drawnS.toFixed(0)} m) is still before the stop (${stopS.toFixed(0)} m) as the card says past`)
    .toBeLessThan(stopS);
  // And the delay the card states is the real one: this frame's presentation time less the moment
  // being shown, said to the nearest five seconds.
  const label = (await page.locator('.ride-card .ride-motion').textContent()) ?? '';
  const said = Number(/drawn about (\d+) s behind/.exec(label)?.[1]);
  const frame = Number(display.split(',')[4]), shown = Number(await map(page).getAttribute('data-shown'));
  const actual = (frame - shown) / 1000;
  expect(said, `the card states the delay (${label})`).toBeGreaterThanOrEqual(25);
  expect(Math.abs(said - actual), `stated ${said} s, measured ${actual.toFixed(1)} s`).toBeLessThanOrEqual(6);
  // Leaving the ride, the panel's card says the same thing as the ride card did.
  await page.getByRole('button', {name: 'Exit ride-along'}).click();
  await expect(card).toContainText(/already past|past your stop/i);
  await page.screenshot({path: test.info().outputPath(`${test.info().project.name}-past-by-report.png`)});
});

test('the road ahead is lit under the ridden bus where it is on its checked road, outside only, and never on a chord', async ({page}) => {
  test.setTimeout(120_000);
  await servePatterns(page);
  await serveMotion(page, {evaluation: null});
  const started = Date.now() - 90_000;
  await serveLive(page, Array.from({length: 40}, () => () =>
    movingLive({startMs: started, startS: 250, speed: 9, cadence: 20, delay: 4})));
  await page.goto('/?bus=BNML%7CFX-MOVING%7C256%7Cinbound%7CFX-MOVING-J');
  await waitForPaint(page);
  await expect(map(page)).toHaveAttribute('data-motion', 'observed', {timeout: 20_000});
  // Not in the ordinary map: the ribbon belongs to the ride.
  await expect(map(page)).toHaveAttribute('data-road-ahead', '');
  await page.locator('.ride-launch').click();
  await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 20_000});
  await expect(map(page)).toHaveAttribute('data-road-ahead', /^\d+$/, {timeout: 20_000});
  const metres = Number(await map(page).getAttribute('data-road-ahead'));
  expect(metres, 'about three hundred metres of the checked road ahead').toBeGreaterThan(200);
  expect(metres).toBeLessThanOrEqual(320);
  // The next stops on its pattern are named on that road, outside as well as in the front view.
  await expect(map(page)).toHaveAttribute('data-stops-ahead', /^[1-3]$/);
  await page.waitForTimeout(600);
  await page.screenshot({path: test.info().outputPath(`${test.info().project.name}-road-ahead.png`)});
  await page.getByRole('button', {name: 'Exit ride-along'}).click();
  await expect(map(page)).toHaveAttribute('data-ride', 'off');
  await expect(map(page)).toHaveAttribute('data-road-ahead', '', {timeout: 5000});
});

test('a bus with no checked road gets no road ahead: nothing is lit that is not known to be its road', async ({page}) => {
  await servePatterns(page);
  await serveMotion(page);
  await noGeometry(page);
  const start = Date.now() - 90_000;
  await serveLive(page, [() => movingLive({nowMs: Date.now(), startMs: start, speed: 9, cadence: 10})]);
  await page.goto('/');
  await waitForPaint(page);
  await page.locator('.try-ride button[data-ride-bus]').first().click();
  await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 20_000});
  await expect(map(page)).toHaveAttribute('data-motion', 'observed', {timeout: 15_000});
  await page.waitForTimeout(1500);
  await expect(map(page)).toHaveAttribute('data-road-ahead', '');
});
