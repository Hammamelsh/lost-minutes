// The served page's own drawing timings, on real data, at a city zoom and in a ride: median frame interval
// (data-frame-ms, last 90 frames) and the fleet's tick cost (data-fleet-ms). SwiftShader, not a phone: a
// before/after comparison on the same machine, not an absolute figure.
import {chromium} from '@playwright/test';
import {launchOptions} from '../../tests/browser/browser-env.mjs';
const base = process.argv[2] ?? 'https://lost-minutes.duckdns.org';
const label = process.argv[3] ?? 'served';
const b = await chromium.launch(launchOptions());
const ctx = await b.newContext({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
  serviceWorkers: 'block', timezoneId: 'Europe/London'});
const page = await ctx.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
const t0 = Date.now();
const stopId = process.argv[4] ?? "1800SJ32261";
const busKey = process.argv[5];
await page.goto(busKey ? `${base}/?bus=${encodeURIComponent(busKey)}` : `${base}/?stop=${stopId}`, {waitUntil: 'load'});
const map = page.locator('.vector-map');
await page.locator('.vector-map[data-map-state="painted"]').waitFor({timeout: 90_000});
const paintedS = (Date.now() - t0) / 1000;
await page.waitForTimeout(8000);
const read = async () => map.evaluate(el => ({frameMs: Number(el.dataset.frameMs), fleetMs: Number(el.dataset.fleetMs), fleet: el.dataset.fleet}));
const samples = [];
for (let k = 0; k < 10; k++) { samples.push(await read()); await page.waitForTimeout(1000); }
const med = xs => { const v = xs.filter(Number.isFinite).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };
const ride = page.getByRole('button', {name: /Ride along/}).first();
let rideFrame = null;
if (await ride.count()) {
  await ride.click().catch(() => {});
  await page.waitForTimeout(12000);
  const r = []; for (let k = 0; k < 8; k++) { r.push(await read()); await page.waitForTimeout(1000); }
  rideFrame = med(r.map(x => x.frameMs));
}
console.log(JSON.stringify({label, paintedS, frameMsMedian: med(samples.map(s => s.frameMs)), fleetMsMedian: med(samples.map(s => s.fleetMs)),
  fleet: samples.at(-1).fleet, rideFrameMsMedian: rideFrame, errors}));
await b.close();
