// A bus with no checked road drawn along the map's streets between its reports (lib/streets.ts, 30 September 2026).
// The owner rode a Diamond 74 at Charlestown and saw it "flying and not on the road": every report lay within 3.4 m of
// its road, but the straight line between the reports of 20:53:32 and 20:54:02 UTC ran up to 37 m off every street,
// over the houses. These are those reports (the server's raw captures) and the real streets beside them (the tiles
// the page draws), in tests/browser/recorded/charlestown-74.json. FIXTURE publication of REAL reports; real tiles.
import {readFileSync} from 'node:fs';
import {test, expect} from '@playwright/test';
import {movingLive, servePatterns, serveLive, waitForPaint} from './fixtures.mjs';

const RIDE = JSON.parse(readFileSync(new URL('./recorded/charlestown-74.json', import.meta.url), 'utf8'));
const map = page => page.locator('.vector-map').first();
const M = 111195, KX = M * Math.cos(53.5 * Math.PI / 180);
const toSeg = (p, a, b) => {
  const ax = (a[0] - p.lon) * KX, ay = (a[1] - p.lat) * M, dx = (b[0] - a[0]) * KX, dy = (b[1] - a[1]) * M, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
};
const offStreets = p => Math.min(...RIDE.streets.flatMap(s => s.coords.slice(0, -1).map((c, i) => toSeg(p, c, s.coords[i + 1]))));

/** The 74 as the page would have been served it: its reports at their real spacing, the newest 8 s old. */
function charlestown(nowMs) {
  const base = movingLive({nowMs});
  const t = r => { const [h, m, s] = r.utc.split(':').map(Number); return (h * 3600 + m * 60 + s) * 1000; };
  const last = RIDE.reports.at(-1), newest = Math.floor(nowMs / 1000) * 1000 - 8000;
  base.vehicles.push({operator: 'BNDB', vehicle: 'YY73OYB', route: '74', direction: 'outbound', journeyRef: 'FX-74',
    destination: 'Salford_Shopping_Centre', origin: 'Chorlton_Street', observedAtMs: newest,
    recordedAt: new Date(newest).toISOString().replace('.000Z', '+00:00'), lat: last.lat, lon: last.lon,
    ageSeconds: 8, freshness: 'fresh', positionKind: 'observed', sourceHash: 'e'.repeat(64), bearing: last.bearing,
    bearingStatus: 'reported', aimedDeparture: null, retrievedAtMs: newest + 3000,
    trail: RIDE.reports.slice(0, -1).reverse().map(r => [t(last) - t(r), r.lat, r.lon, r.bearing, 0]),
    match: {unresolved: 'no_pattern_for_route', explanation: 'FIXTURE: no timetable pattern is held for this route label.'}});
  return base;
}

test('a bus with no checked road is drawn along the streets between its reports, not over the houses', async ({page}) => {
  test.setTimeout(150_000);
  await servePatterns(page);
  const now = Date.now();
  await serveLive(page, [() => charlestown(now)]);
  await page.goto(`/?bus=${encodeURIComponent('BNDB|YY73OYB|74|outbound')}`);
  await waitForPaint(page);
  await page.getByRole('button', {name: /^Ride along with route 74/}).click({timeout: 20_000});
  await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 20_000});
  await expect(map(page)).not.toHaveAttribute('data-street', 'none', {timeout: 30_000})
    .catch(async error => { console.log('streets read:', await map(page).getAttribute('data-street-lines'), 'zoom', await map(page).getAttribute('data-zoom')); throw error; });
  const samples = [];
  for (let k = 0; k < 120; k++) {
    const [lat, lon] = ((await map(page).getAttribute('data-display')) || '').split(',').map(Number);
    if (Number.isFinite(lat)) samples.push({lat, lon, on: await map(page).getAttribute('data-street-on')});
    await page.waitForTimeout(250);
  }
  const off = samples.map(offStreets), on = samples.filter(s => s.on === 'yes').length;
  const worst = Math.max(...off), within8 = off.filter(d => d <= 8).length / off.length;
  console.log(`74 at Charlestown: ${samples.length} frames, on its street track ${on}, off the streets at most ${worst.toFixed(1)} m, `
    + `within 8 m ${(within8 * 100).toFixed(0)}%; street track ${await map(page).getAttribute('data-street')}`);
  await page.screenshot({path: test.info().outputPath(`${test.info().project.name}-charlestown.png`)});
  expect(on / samples.length, 'drawn on its street track').toBeGreaterThan(0.8);
  expect(within8, 'on the streets, where the straight line was up to 37 m off them').toBeGreaterThan(0.95);
  expect(worst).toBeLessThan(12);
});
