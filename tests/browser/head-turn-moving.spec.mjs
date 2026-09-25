// The head-turn while the bus moves and while a report corrects it: following holds, the bearing
// turns with the finger and never jumps, the chosen bus is unchanged. And leaving for Google
// Maps and coming back: same bus, same stop, same ride, positions refreshed, camera not thrown.
import {test, expect} from '@playwright/test';
import {movingLive, servePatterns, serveLive, serveMotion, waitForPaint} from './fixtures.mjs';

test.use({permissions: ['geolocation'], geolocation: {latitude: 53.4487, longitude: -2.3095, accuracy: 40}});
const map = page => page.locator('.vector-map');
const cam = async page => ((await map(page).getAttribute('data-camera')) || '0,0,0,0,0').split(',').map(Number);
const turn = (a, b) => ((b - a + 540) % 360) - 180;

async function enterFront(page, live) {
  await servePatterns(page); await serveMotion(page);
  await serveLive(page, live);
  await page.goto('/'); await waitForPaint(page);
  await page.getByRole('button', {name: 'Buses near me'}).click();
  await page.locator('.nearby-stop', {hasText: 'Stop A'}).first().click();
  await map(page).evaluate(el => el.scrollIntoView({block: 'start'}));
  await page.getByRole('button', {name: 'Ride along with route 256'}).click();
  await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 10_000});
  await page.getByRole('button', {name: 'Front view'}).click();
  await expect(map(page)).toHaveAttribute('data-ride-camera', 'front');
  await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 5000});
  await page.waitForTimeout(1500);
}

async function dragHold(page, share) {
  const box = await page.locator('.vector-map-canvas').boundingBox();
  const x = box.x + box.width * 0.4, y = box.y + box.height * 0.5;
  await page.mouse.move(x, y); await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(x + box.width * share * i / 10, y); await page.waitForTimeout(25); }
}

test('a moving bus: the turn holds against the road’s own bearing, and no frame jumps', async ({page}) => {
  test.setTimeout(90_000);
  const startMs = Date.now();
  await enterFront(page, [() => movingLive({startMs, speed: 8})]);
  const busBefore = await page.locator('.bus-card .route-badge').textContent();
  const [, , , , ahead0] = await cam(page);
  await dragHold(page, 0.33);
  // Sample the bearing while held: it must stay turned, and move only smoothly (no frame > 12°).
  const samples = [];
  for (let i = 0; i < 12; i++) { samples.push((await cam(page))[4]); await page.waitForTimeout(120); }
  const held = samples[samples.length - 1];
  expect(Math.abs(turn(ahead0, held)), `turned by ${turn(ahead0, held).toFixed(0)}°`).toBeGreaterThan(20);
  const steps = samples.slice(1).map((b, i) => Math.abs(turn(samples[i], b)));
  expect(Math.max(...steps), `largest per-sample bearing step ${Math.max(...steps).toFixed(1)}°`).toBeLessThan(12);
  await expect(map(page)).toHaveAttribute('data-ride', 'following');
  await page.mouse.up();
  await expect.poll(async () => Math.abs(turn((await cam(page))[4], (await cam(page))[4])), {timeout: 4000}).toBeLessThan(1);
  await expect(page.locator('.bus-card .route-badge'), 'the chosen bus is unchanged').toHaveText(busBefore);
  await expect(map(page)).toHaveAttribute('data-ride', 'following');
});

test('a report that corrects the bus mid-turn: the turn survives the correction, following holds, nothing snaps', async ({page}) => {
  test.setTimeout(90_000);
  const startMs = Date.now();
  // The second publication moves the bus 60 m along the road: a correction, not a snap (>150 m).
  await enterFront(page, [() => movingLive({startMs, speed: 8}), () => movingLive({startMs, speed: 8, jump: {atMs: Date.now(), metres: 60}})]);
  const [, , , , ahead0] = await cam(page);
  await dragHold(page, 0.3);
  await page.waitForTimeout(300);
  const before = (await cam(page))[4];
  // Bring the correcting publication in while the finger is down, the way a phone does: by the
  // page's own poll. On a phone the ride-along is the screen and the header's refresh button is
  // behind it by design, so it cannot be clicked there, and the poll is what a passenger gets.
  // Restated 25 September 2026 (backlog 31): in the ride the bus is drawn from its reports, so a report
  // 60 m further on is not an estimate's correction to absorb but a stretch the drawing travels a bounded
  // time later. What this checks is unchanged: the head-turn survives the publication that moves the bus,
  // following holds, and nothing snaps. The publication is known by its newer report.
  const ageBefore = Number(await map(page).getAttribute('data-report-age'));
  await expect.poll(async () => Number(await map(page).getAttribute('data-report-age')),
    {timeout: 30_000, message: 'the publication that moves the bus arrives'}).toBeLessThan(ageBefore);
  await page.waitForTimeout(1500);
  const after = (await cam(page))[4];
  expect(Math.abs(turn(ahead0, after)), 'still turned after the correction').toBeGreaterThan(15);
  expect(Math.abs(turn(before, after)), `the correction moved the view by ${turn(before, after).toFixed(0)}°, not a snap`).toBeLessThan(25);
  await expect(map(page)).toHaveAttribute('data-ride', 'following');
  // data-correction is kind:metres:at. A 60 m step is absorbed by the smooth path, never snapped.
  await expect(map(page)).toHaveAttribute('data-correction', /^(smooth:|none$)/);
  await expect(map(page)).not.toHaveAttribute('data-correction', /^snap:/);
  await page.mouse.up();
});

test('leaving for Google Maps and coming back keeps the bus, the stop and the ride, and refreshes positions', async ({page, context}) => {
  test.setTimeout(90_000);
  const startMs = Date.now();
  let served = 0;
  await enterFront(page, [() => { served++; return movingLive({startMs, speed: 8}); }]);
  await page.getByRole('button', {name: 'Outside view'}).click();
  await expect(map(page)).toHaveAttribute('data-ride-camera', 'outside');
  const busBefore = await page.locator('.bus-card .route-badge').textContent();
  const stopBefore = await page.locator('.your-stop-copy strong').textContent();
  const servedBefore = served;
  // The hand-off opens a new tab; the page goes hidden, as it does when Maps takes over on a phone.
  const href = await page.locator('[data-maps-link]').first().getAttribute('href');
  expect(href).toContain('google.com/maps/dir/');
  const popup = await context.newPage();
  await popup.goto('about:blank');
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', {value: 'hidden', configurable: true}); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(800);
  await popup.close();
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', {value: 'visible', configurable: true}); document.dispatchEvent(new Event('visibilitychange')); });
  await expect.poll(() => served, {timeout: 8000, message: 'positions are fetched again on return'}).toBeGreaterThan(servedBefore);
  await expect(page.locator('.bus-card .route-badge')).toHaveText(busBefore);
  await expect(page.locator('.your-stop-copy strong')).toHaveText(stopBefore);
  await expect(map(page)).toHaveAttribute('data-ride', 'following');
  await expect(map(page)).toHaveAttribute('data-ride-camera', 'outside');
});
