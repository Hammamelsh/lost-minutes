// Every bus in the publication on the map, each drawn from its own reports and moving between them
// as the chosen bus does, tappable where it is drawn (lib/fleet.ts, 25 September 2026). Before this
// the map drew only the buses of the chosen stop or route, each stepping to its newest report at
// every poll. FIXTURE data on the recorded fixture road; SwiftShader, so any timing is a software
// renderer's, not a phone's.
import {test, expect} from '@playwright/test';
import {fleetLive, mapBand, serveLive, serveMotion, servePatterns, waitForPaint} from './fixtures.mjs';

const STOP_A = '1800SJ00811';
const map = page => page.locator('.vector-map').first();
/** data-fleet: total, in view, moving, animating, modelled — written by every tick of the fleet. */
const fleet = async page => {
  const [total, inView, moving, animate, modelled] = ((await map(page).getAttribute('data-fleet')) ?? '').split(',').map(Number);
  return {total, inView, moving, animate, modelled};
};
/** Where every other bus is drawn on the canvas, refreshed four times a second. */
const points = async page => JSON.parse((await map(page).getAttribute('data-bus-points')) || '[]');
const byKey = list => Object.fromEntries(list.map(p => [p.key, p]));

/** The fleet's screen positions sampled about every 250 ms for `seconds`: per bus, the total travel
 *  in pixels and the fastest movement between two samples in pixels a second (each sample is timed,
 *  because under load a 250 ms wait can stretch to seconds, and a step is judged by the time it took). */
async function travel(page, seconds) {
  const samples = [];
  for (let i = 0; i < seconds * 4; i++) { samples.push({t: Date.now(), at: byKey(await points(page))}); await page.waitForTimeout(250); }
  const keys = new Set(samples.flatMap(s => Object.keys(s.at)));
  const out = {};
  for (const key of keys) {
    let total = 0, fastest = 0, previous = null;
    const trail = [];
    for (const s of samples) {
      const p = s.at[key];
      if (p && previous) {
        // In metres, from the drawn position itself (the pixel is rounded, and at a wide zoom one
        // pixel is five metres); over the time the sample really took.
        const d = Math.hypot((p.lat - previous.p.lat) * 111195, (p.lon - previous.p.lon) * 111195 * Math.cos(p.lat * Math.PI / 180));
        const dt = Math.max(0.05, (s.t - previous.t) / 1000);
        total += d; fastest = Math.max(fastest, d / dt);
      }
      if (p) { previous = {p, t: s.t}; trail.push(`${s.t - samples[0].t}:${p.x},${p.y}`); }
    }
    out[key] = {total, fastest, samples: trail};
  }
  return out;
}

test('every bus in the publication is on the map, not only the chosen route’s, and the map says how many', async ({page}) => {
  await servePatterns(page);
  await serveLive(page, [() => fleetLive({count: 6})]);
  // A chosen bus and no stop: until 25 September 2026 the map showed only its route's buses (route
  // 256: FX-MOVING, FX-SHARED and FX-PASSED), and the six other routes were not drawn at all.
  await page.goto('/?bus=BNML%7CFX-MOVING%7C256%7Cinbound%7CFX-MOVING-J');
  await waitForPaint(page);
  await expect.poll(async () => (await fleet(page)).total, {timeout: 15_000}).toBe(10);   // 11 published, one chosen
  await expect(page.locator('.legend-fleet')).toHaveText('11 buses');
  await expect(page.locator('.vector-map-canvas')).toHaveAttribute('aria-label', /Map of 11 buses, each drawn from its own reports/);
  // Every one of them is a tappable point on the canvas (the camera frames the chosen bus at a
  // street zoom, so not all are inside the frame; the diagnostic lists those that are).
  const drawn = await points(page);
  expect(drawn.some(p => p.key.startsWith('BNML|FX-FLEET-')), 'other routes’ buses are drawn').toBe(true);
});

test('buses in view move between their reports at a bus’s pace, none teleporting to its newest report', async ({page}) => {
  await servePatterns(page);
  // Moving for a minute and a half already, so the playback has a trail to draw from its first frame.
  const start = Date.now() - 90_000;
  await serveLive(page, [() => fleetLive({nowMs: Date.now(), startMs: start, count: 6, spacing: 200})]);
  await page.goto(`/?stop=${STOP_A}`);
  await waitForPaint(page);
  await expect.poll(async () => (await fleet(page)).moving, {timeout: 20_000}).toBeGreaterThanOrEqual(3);
  const zoom = Number(await map(page).getAttribute('data-zoom'));
  const moved = await travel(page, 6);
  const fleetKeys = Object.keys(moved).filter(k => k.includes('FX-FLEET-'));
  expect(fleetKeys.length, 'fleet buses in the frame').toBeGreaterThanOrEqual(3);
  // 7 m/s for 6 s is 42 m. A jump to a new report would be a 140 m step between two samples a
  // quarter of a second apart: hundreds of metres a second, where a bus drawn moving covers under 25.
  const movingKeys = fleetKeys.filter(k => moved[k].total > 20);
  expect(movingKeys.length, `buses drawn moving (zoom ${zoom.toFixed(1)}): ${JSON.stringify(moved)}`).toBeGreaterThanOrEqual(3);
  console.log(`fleet moving at zoom ${zoom.toFixed(2)}: ${fleetKeys.map(k => `${k.split('|')[1]} ${moved[k].total.toFixed(0)} m, fastest ${moved[k].fastest.toFixed(1)} m/s`).join('; ')}`);
  for (const k of fleetKeys) {
    if (moved[k].fastest >= 25) console.log(`${k} samples: ${JSON.stringify(moved[k].samples)}`);
    expect(moved[k].fastest, `${k}: fastest movement between samples, m/s`).toBeLessThan(25);
  }
  await page.screenshot({path: test.info().outputPath(`${test.info().project.name}-fleet-moving.png`)});
});

test('tapping a moving bus chooses it where it is drawn, and its drawing carries on', async ({page}) => {
  await servePatterns(page);
  const start = Date.now() - 90_000;
  await serveLive(page, [() => fleetLive({nowMs: Date.now(), startMs: start, count: 6, spacing: 200})]);
  await page.goto(`/?stop=${STOP_A}`);
  await waitForPaint(page);
  await expect.poll(async () => (await fleet(page)).moving, {timeout: 20_000}).toBeGreaterThanOrEqual(3);
  const band = await mapBand(page);
  // A fleet bus drawn inside the reachable band, away from its edges and from the other markers.
  const drawn = await points(page);
  const canvas = await page.locator('.vector-map-canvas').boundingBox();
  const inBand = drawn.filter(p => p.key.includes('FX-FLEET-')
    && canvas.y + p.y > band.y + 30 && canvas.y + p.y < band.y + band.height - 30 && p.x > 40 && p.x < band.width - 40
    && drawn.every(q => q.key === p.key || Math.hypot(q.x - p.x, q.y - p.y) > 40));
  expect(inBand.length, `a fleet bus clear of the others to tap (${JSON.stringify(drawn)})`).toBeGreaterThan(0);
  const target = inBand[0];
  await page.mouse.click(canvas.x + target.x, canvas.y + target.y);
  await page.waitForTimeout(600);
  // What the tap met, in the log: the chooser (two buses under one finger) or the choice itself.
  const chooser = await page.locator('.bus-chooser').count();
  console.log(`tap at ${target.x},${target.y} (${target.key}): chooser ${chooser}, selected '${await map(page).getAttribute('data-selected-key')}', `
    + `suggested at ${await map(page).getAttribute('data-bus-screen')}, others ${JSON.stringify(drawn.map(p => `${p.key.split('|')[1]}@${p.x},${p.y}`))}`);
  await expect(map(page)).toHaveAttribute('data-selected-key', target.key, {timeout: 10_000});
  await expect(page.locator('article.bus-card').first()).toHaveAttribute('data-vehicle', target.key.split('|')[1]);
  // The chosen bus is drawn from where the fleet had it: the hand-over, not a fresh start. Read at
  // once, in metres, before the next publication: the fleet's last drawn place against the chosen
  // drawing's first (`data-display`), less what the bus moves in the moment between.
  const display = ((await map(page).getAttribute('data-display')) || '').split(',').map(Number);
  const hop = Math.hypot((display[0] - target.lat) * 111195, (display[1] - target.lon) * 111195 * Math.cos(target.lat * Math.PI / 180));
  console.log(`hand-over: ${hop.toFixed(1)} m between the fleet's drawing and the chosen one (${target.key})`);
  test.info().annotations.push({type: 'hand-over', description: `${hop.toFixed(1)} m`});
  expect(hop, 'the bus did not move when it was chosen').toBeLessThan(15);
  await expect(map(page)).toHaveAttribute('data-motion', 'observed');
});

test('in the ride the other buses nearby are drawn as buses, in the fleet’s livery', async ({page}) => {
  await servePatterns(page);
  await serveMotion(page, {evaluation: null});          // a checked road, no prediction
  const start = Date.now() - 90_000;
  await serveLive(page, [() => fleetLive({nowMs: Date.now(), startMs: start, count: 8, spacing: 45, roads: true})]);
  await page.goto('/?bus=BNML%7CFX-MOVING%7C256%7Cinbound%7CFX-MOVING-J');
  await waitForPaint(page);
  await page.locator('.ride-launch').click({timeout: 20_000});
  await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 20_000});
  await expect.poll(async () => (await fleet(page)).modelled, {timeout: 20_000}).toBeGreaterThanOrEqual(1);
  // The frame is kept for the record: the chosen bus lime, the others grey (MapLibre's canvas does
  // not keep its buffer, so the colours are judged from the screenshot, not read back).
  await page.waitForTimeout(1500);
  await page.screenshot({path: test.info().outputPath(`${test.info().project.name}-ride-with-fleet.png`)});
  console.log(`ride with fleet: modelled ${(await fleet(page)).modelled}`);
});

test('with a hundred and twenty buses in view the fleet’s tick stays cheap', async ({page}) => {
  test.skip(test.info().project.name !== 'desktop', 'measured once');
  await servePatterns(page);
  const start = Date.now() - 90_000;
  await serveLive(page, [() => fleetLive({nowMs: Date.now(), startMs: start, count: 120, spacing: 15})]);
  await page.goto(`/?stop=${STOP_A}`);
  await waitForPaint(page);
  // The frame at the stop's zoom holds sixty to eighty of them; the rest stand at their reports.
  await expect.poll(async () => (await fleet(page)).inView, {timeout: 20_000}).toBeGreaterThanOrEqual(60);
  await page.waitForTimeout(4000);
  const ms = Number(await map(page).getAttribute('data-fleet-ms'));
  const state = await fleet(page);
  const note = `${state.total} buses, ${state.inView} in view, ${state.moving} moving, median tick ${ms} ms`;
  test.info().annotations.push({type: 'fleet', description: note});
  console.log(`fleet: ${note}`);
  expect(ms, 'the median tick, in this software renderer').toBeLessThan(40);
});

test('under reduced motion every bus stands at its newest report', async ({page}) => {
  await page.emulateMedia({reducedMotion: 'reduce'});
  await servePatterns(page);
  const start = Date.now() - 90_000;
  await serveLive(page, [() => fleetLive({nowMs: Date.now(), startMs: start, count: 6, spacing: 200})]);
  await page.goto(`/?stop=${STOP_A}`);
  await waitForPaint(page);
  await expect.poll(async () => (await fleet(page)).total, {timeout: 15_000}).toBeGreaterThanOrEqual(10);
  const state = await fleet(page);
  expect(state.animate).toBe(0);
  expect(state.moving).toBe(0);
  const moved = await travel(page, 3);
  for (const [k, m] of Object.entries(moved)) expect(m.total, `${k} stood still`).toBe(0);
});

test('a mouse over a bus names it: route, destination and report age', async ({page}) => {
  test.skip(test.info().project.name !== 'desktop', 'a finger cannot hover');
  await servePatterns(page);
  await serveLive(page, [() => fleetLive({count: 6, spacing: 200})]);
  await page.goto(`/?stop=${STOP_A}`);
  await waitForPaint(page);
  await expect.poll(async () => (await fleet(page)).total, {timeout: 15_000}).toBeGreaterThanOrEqual(10);
  const canvas = await page.locator('.vector-map-canvas').boundingBox();
  const drawn = await points(page);
  const target = drawn.find(p => p.key === 'BNML|FX-FLEET-1') ?? drawn.find(p => p.key.includes('FX-FLEET-'));
  expect(target, `a fleet bus in the frame (${JSON.stringify(drawn)})`).toBeTruthy();
  await page.mouse.move(canvas.x + target.x, canvas.y + target.y);
  await expect(page.locator('.map-hover')).toBeVisible({timeout: 5000});
  await expect(page.locator('.map-hover')).toContainText(target.key.split('|')[1].replace('FX-FLEET-', '10'));
  await expect(page.locator('.map-hover')).toContainText('to Fixture Terminus');
  await expect(page.locator('.map-hover')).toContainText(/ago/);
  await page.mouse.move(canvas.x + 5, canvas.y + 5);
  await page.locator('.vector-map-canvas').dispatchEvent('mouseleave');
  await expect(page.locator('.map-hover')).toHaveCount(0);
});
