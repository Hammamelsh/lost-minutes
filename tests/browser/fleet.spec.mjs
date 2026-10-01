// Every bus in the publication on the map, each drawn from its own reports and moving between them
// as the chosen bus does, tappable where it is drawn (lib/fleet.ts, 25 September 2026). Before this
// the map drew only the buses of the chosen stop or route, each stepping to its newest report at
// every poll. FIXTURE data on the recorded fixture road; SwiftShader, so any timing is a software
// renderer's, not a phone's.
import {test, expect} from '@playwright/test';
import {fleetLive, mapBand, metresOffFixtureRoad, serveLive, serveMotion, servePatterns, waitForPaint} from './fixtures.mjs';

const STOP_A = '1800SJ00811';
const map = page => page.locator('.vector-map').first();
/** data-fleet: total, in view, moving, animating, modelled — written by every tick of the fleet. */
const fleet = async page => {
  const [total, inView, moving, animate, modelled] = ((await map(page).getAttribute('data-fleet')) ?? '').split(',').map(Number);
  return {total, inView, moving, animate, modelled};
};
/** data-fleet-streets: of the buses in view with no checked road, drawn on a street track, tried at their newest
 *  report, and all of them (lib/streets.ts). */
const streets = async page => {
  const [ready, tried, wanted] = ((await map(page).getAttribute('data-fleet-streets')) ?? '').split(',').map(Number);
  return {ready, tried, wanted};
};
/** Until every bus in view with no checked road has had its streets tried, and its move onto them (an eased
 *  correction, 100 ms a metre) has run its course. */
async function streetsSettled(page) {
  await expect.poll(async () => { const s = await streets(page); return s.wanted > 0 && s.tried === s.wanted; }, {timeout: 30_000}).toBe(true);
  await page.waitForTimeout(4000);
}
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
  // At the stop's zoom these buses, with no checked road, are drawn along the map's streets once their tiles are in;
  // the move onto the streets is a correction, eased, and checked on its own below. Their pace is judged after it.
  await streetsSettled(page);
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

test('at a stop\'s own zoom, buses with no checked road are drawn on their street, eased onto it, not over the houses', async ({page}) => {
  // The fixture road is a real road (route 256's), and these buses report along it with no timetable pattern, so no
  // checked road: drawn on straight lines between reports 140 m apart they cut its bends, up to 28–31 m off it for two
  // of them (the same reports through lib/motion.ts in Node). Until 1 October 2026 the fleet drew them so at a stop's
  // zoom (14.2–15): street tracks began at 14, but a bus's road was settled only from 15, and a bus with no road
  // settled was given none. Real tiles from the map's own source.
  test.setTimeout(120_000);
  await servePatterns(page);
  const start = Date.now() - 90_000;
  await serveLive(page, [() => fleetLive({nowMs: Date.now(), startMs: start, count: 6, spacing: 200})]);
  await page.goto(`/?stop=${STOP_A}`);
  await waitForPaint(page);
  // From the first frames to settled: no step a bus could not be drawn making (a jump to a newest report 140 m on
  // would be hundreds of metres a second; the move onto the streets is eased at about 10 m/s on top of the bus's 7,
  // read here at up to twice that, as each sample is of a drawing refreshed every 250 ms).
  const early = await travel(page, 5);
  for (const k of Object.keys(early).filter(key => key.includes('FX-FLEET-'))) expect(early[k].fastest, `${k} settling`).toBeLessThan(60);
  await streetsSettled(page);
  const s = await streets(page);
  expect(s.ready, `on street tracks: ${JSON.stringify(s)}`).toBeGreaterThanOrEqual(3);
  // The stop's own zoom: 14.4 on the phone profile, inside the band that had no streets, and 15.6 on the desktop.
  const zoom = Number(await map(page).getAttribute('data-zoom'));
  const worst = {};
  for (let i = 0; i < 24; i++) {
    for (const p of await points(page)) if (p.key.includes('FX-FLEET-')) worst[p.key] = Math.max(worst[p.key] ?? 0, metresOffFixtureRoad(p.lat, p.lon));
    await page.waitForTimeout(250);
  }
  console.log(`zoom ${zoom.toFixed(2)}, street tracks ${JSON.stringify(s)}, off the road at most: ${Object.entries(worst).map(([k, m]) => `${k.split('|')[1]} ${m.toFixed(1)} m`).join(', ')}`);
  expect(Object.keys(worst).length, 'fleet buses in the frame').toBeGreaterThanOrEqual(3);
  for (const [k, m] of Object.entries(worst)) expect(m, `${k} drawn off its road`).toBeLessThan(8);
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

// The map's scale, as MapLibre draws it (lib/scale.ts): the screen distance between two buses standing
// at their reports, turned into metres with metresPerPixel, is the distance between the reports. With a
// 256-pixel tile's figure, which sized the front view's roads until 26 September 2026, it is double.
test('the metres a pixel covers are the map\'s own: buses standing apart are as far apart on screen as the scale says', async ({page}) => {
  await page.emulateMedia({reducedMotion: 'reduce'});
  await servePatterns(page);
  const start = Date.now() - 90_000;
  await serveLive(page, [() => fleetLive({nowMs: Date.now(), startMs: start, count: 6, spacing: 200})]);
  await page.goto(`/?stop=${STOP_A}`);
  await waitForPaint(page);
  await expect.poll(async () => (await points(page)).length, {timeout: 15_000}).toBeGreaterThanOrEqual(3);
  const [zoom, , , pitch] = ((await map(page).getAttribute('data-camera')) ?? '').split(',').map(Number);
  expect(pitch, 'a flat map, where a pixel is the same everywhere').toBe(0);
  const drawn = await points(page);
  const perPixel = lat => 40075016.686 * Math.cos(lat * Math.PI / 180) / (512 * 2 ** zoom);
  let pairs = 0;
  for (let i = 0; i < drawn.length; i++) for (let j = i + 1; j < drawn.length; j++) {
    const a = drawn[i], b = drawn[j];
    const metres = Math.hypot((b.lat - a.lat) * 111195, (b.lon - a.lon) * 111195 * Math.cos(a.lat * Math.PI / 180));
    if (metres < 150) continue;
    const onScreen = Math.hypot(b.x - a.x, b.y - a.y) * perPixel((a.lat + b.lat) / 2);
    expect(Math.abs(onScreen / metres - 1), `${a.key} to ${b.key}: ${metres.toFixed(0)} m apart, ${onScreen.toFixed(0)} m on screen`).toBeLessThan(0.02);
    pairs += 1;
  }
  expect(pairs, 'pairs of buses far enough apart to measure').toBeGreaterThan(0);
});

// A bus moved to a report it could not be followed to is marked on the map, and on a touch screen, where
// there is no hover, a tap on its trace (or on it) chooses it and its card says what happened
// (26 September 2026). FX-FLEET-0 goes 80 s without a report and reappears 320 m on (309 m in a straight
// line): the pair rule's "too long", which is what the mark and the card must say.
test('a bus moved rather than followed is marked, and a tap on its trace chooses it and its card says why', async ({page}, info) => {
  test.setTimeout(180_000);
  await servePatterns(page);
  const start = Date.now() - 90_000;
  // Silent from 50 s before the page opens to 10 s after it, in real time: no report made in between
  // is ever published. Every report keeps its own time from one publication to the next, as a feed's
  // do: published every 20 s, on times fixed from `start`. (Re-timed at every poll, as fleetLive alone
  // gives them, the reports either side of the silence moved 40 m back and forth between polls, and the
  // one before it dropped out of the trail before the drawing had crossed: marks a feed never makes.)
  const gapFrom = Date.now() - 50_000, gapTo = Date.now() + 10_000;
  await serveLive(page, [() => {
    const live = fleetLive({nowMs: start + Math.floor((Date.now() - start) / 20_000) * 20_000, startMs: start, count: 6, spacing: 200, speed: 4});
    const v = live.vehicles.find(x => x.vehicle === 'FX-FLEET-0');
    const fixes = [...v.trail.map(t => ({t: v.observedAtMs - t[0], lat: t[1], lon: t[2], bearing: t[3]})),
      {t: v.observedAtMs, lat: v.lat, lon: v.lon, bearing: v.bearing}].filter(f => f.t <= gapFrom || f.t >= gapTo);
    const newest = fixes.at(-1), age = (Date.now() - newest.t) / 1000;
    Object.assign(v, {observedAtMs: newest.t, recordedAt: new Date(newest.t).toISOString().replace('.000Z', '+00:00'),
      lat: newest.lat, lon: newest.lon, bearing: newest.bearing, ageSeconds: age, retrievedAtMs: newest.t + 3000,
      freshness: age <= 60 ? 'fresh' : age <= 150 ? 'ageing' : 'stale',
      trail: fixes.slice(0, -1).map(f => [newest.t - f.t, f.lat, f.lon, f.bearing, 0])});
    return live;
  }]);
  await page.goto(`/?stop=${STOP_A}`);
  await waitForPaint(page);
  const markOf = async () => ((await map(page).getAttribute('data-fleet-moved')) ?? '').split(';')
    .find(x => x.startsWith('BNML|FX-FLEET-0:') && Number(x.split(':')[1]) > 100);
  await expect.poll(markOf, {timeout: 100_000, message: 'the move across the silence is marked'}).toBeTruthy();
  const [, metres, from, to, why] = (await markOf()).split(':');
  expect(why, `the reason the move is marked with (${metres} m)`).toBe('too_long');
  const [x1, y1] = from.split(',').map(Number), [x2, y2] = to.split(',').map(Number);
  const canvas = await page.locator('.vector-map-canvas').boundingBox();
  const band = await mapBand(page);
  const inBand = p => canvas.y + p.y > band.y + 20 && canvas.y + p.y < band.y + band.height - 20 && p.x > 20 && p.x < canvas.width - 20;
  // A point of the line itself, where a passenger can reach it and no marker is: a marker nearer the
  // finger rightly wins a tap (on the phone the stop's suggested bus was drawn under the line's middle).
  const [sx, sy] = ((await map(page).getAttribute('data-bus-screen')) || ',').split(',').map(Number);
  const markers = [...(await points(page)), ...(Number.isFinite(sx) ? [{x: sx, y: sy}] : [])];
  const along = [0.5, 0.35, 0.65, 0.25, 0.75, 0.15, 0.85].map(f => ({x: x1 + (x2 - x1) * f, y: y1 + (y2 - y1) * f}));
  const at = along.find(p => inBand(p) && markers.every(q => Math.hypot(q.x - p.x, q.y - p.y) > 30));
  expect(at, `a reachable point of the trace clear of markers (${from} to ${to})`).toBeTruthy();
  if (info.project.name === 'mobile') await page.touchscreen.tap(canvas.x + at.x, canvas.y + at.y);
  else await page.mouse.click(canvas.x + at.x, canvas.y + at.y);
  await expect(map(page), `the tap met: ${await map(page).getAttribute('data-tap')}`).toHaveAttribute('data-selected-key', 'BNML|FX-FLEET-0', {timeout: 10_000});
  expect((await map(page).getAttribute('data-tap')) ?? '', 'it was the line that was tapped').toMatch(/:BNML\|FX-FLEET-0@\d+/);
  await expect(page.locator('[data-moved]').first()).toContainText(/moved \d+ m to its latest report rather than travelled there, because too long passed between its reports\./);
  await page.screenshot({path: info.outputPath(`${info.project.name}-moved-chosen.png`)});
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
