// The ride itself: a bus with no accepted road geometry travels between its reports instead of
// teleporting, every way a bus is drawn answers a tap, the chosen bus's own past is not mistaken
// for other buses, and the front view says what it can do before it is pressed. FIXTURE data on
// real NaPTAN stops; SwiftShader, so the frame times are a software renderer's, not a phone's.
import {test, expect} from '@playwright/test';
import {journeyLive, mapBand, movingLive, serveLive, serveMotion, servePatterns, waitForPaint} from './fixtures.mjs';

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
  const start = Date.now();
  await serveLive(page, [() => movingLive({nowMs: Date.now(), startMs: start, speed: 9, cadence: 10})]);
  await page.goto('/');
  await waitForPaint(page);
  await page.locator('.follow-row').first().click();
  await page.getByRole('button', {name: /Ride along/i}).first().click();
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
  await page.locator('.follow-row').first().click();
  await page.getByRole('button', {name: /Ride along/i}).first().click();
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
