/**
 * How the drawn bus actually moves on the page, sampled from the map's own diagnostics.
 *
 *   node scripts/probes/ride-smoothness.mjs --base https://lost-minutes.duckdns.org --seconds 60 --label before
 *
 * It chooses a bus, rides along, and records `data-display` (the drawn lat/lon each frame) and
 * `data-frame-ms` for the whole run, then reports the distribution of the distance the drawn bus
 * moved between consecutive samples. A teleport shows up as one very large step; smooth movement
 * shows up as many small ones. `--route` picks a route, `--estimated` insists on a bus with an
 * accepted road shape, `--observed` on one without.
 *
 * It also writes a continuous WebM of the map while it runs, so the numbers can be watched as
 * well as read, and stills at the start, middle and end. Software-rendered (SwiftShader) unless
 * run on a machine with a GPU: the frame times are that renderer's, not a phone's.
 */
import {chromium} from '@playwright/test';
import {launchOptions} from '../../tests/browser/browser-env.mjs';
import {mkdirSync, writeFileSync} from 'node:fs';

const arg = (k, d) => {const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d};
const has = k => process.argv.includes('--' + k);
const base = (arg('base', 'http://127.0.0.1:8097')).replace(/\/$/, '');
const seconds = Number(arg('seconds', 60)), label = arg('label', 'ride');
const wantRoute = arg('route', null);
const out = `outputs/probes/milestone/${label}`;
mkdirSync(out, {recursive: true});

const metres = (a, b) => Math.hypot((b[1] - a[1]) * Math.cos(a[0] * Math.PI / 180), b[0] - a[0]) * 111195;
const pct = (xs, q) => {if (!xs.length) return null; const s = [...xs].sort((x, y) => x - y);
 const i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo)};

const phone = has('phone');
const size = phone ? {width: 390, height: 844} : {width: 1280, height: 860};
const browser = await chromium.launch(launchOptions());
const context = await browser.newContext({viewport: size, isMobile: phone, hasTouch: phone,
 timezoneId: 'Europe/London', recordVideo: {dir: out, size}});
const page = await context.newPage();
await page.goto(base + '/', {waitUntil: 'networkidle'});
await page.waitForTimeout(6000);

// Choose a bus. With a stop given, from that stop's lists; otherwise pick a route in the route
// browser and take a bus off it. The home page suggests nothing of its own accord, so a bus is
// always something this probe chose, on either build.
let chosen = null;
const stop = arg('stop', null);
if (stop) {
 await page.goto(`${base}/?stop=${stop}`, {waitUntil: 'networkidle'});
 await page.waitForTimeout(5000);
}
if (wantRoute) {
 const select = page.locator('#follow-route');
 if (await select.count()) {
  const values = await select.locator('option').evaluateAll(os => os.map(o => ({v: o.value, t: o.textContent})));
  const match = values.find(o => o.t?.trim() === wantRoute);
  if (match) {await select.selectOption(match.v); await page.waitForTimeout(1200)}
 }
}
for (const sel of ['.follow-row', '.follow-list button', '.route-browse button.follow-row']) {
 const row = page.locator(sel).first();
 if (await row.count()) {await row.click(); chosen = (await row.textContent())?.replace(/\s+/g, ' ').slice(0, 70); break}
}
if (!chosen) {
 // Nothing listed: the map's own Ride along chip works on whatever the card is showing.
 chosen = 'the bus the card was showing';
}
await page.waitForTimeout(1500);
const ride = page.getByRole('button', {name: /Ride along/i}).first();
if (await ride.count()) await ride.click();
await page.waitForTimeout(3000);

const map = page.locator('.vector-map').first();
const mode = await map.getAttribute('data-motion');
const reason = await map.getAttribute('data-motion-reason');
await page.screenshot({path: `${out}/start.png`});

const samples = [];
const until = Date.now() + seconds * 1000;
while (Date.now() < until) {
 const d = await map.evaluate(el => ({display: el.getAttribute('data-display'),
  frameMs: el.getAttribute('data-frame-ms'), motion: el.getAttribute('data-motion'),
  correction: el.getAttribute('data-correction'), age: el.getAttribute('data-report-age')})).catch(() => null);
 if (d?.display) samples.push({at: Date.now(), ...d});
 if (samples.length === 1) await page.screenshot({path: `${out}/middle.png`});
 await page.waitForTimeout(60);
}
await page.screenshot({path: `${out}/end.png`});

const points = samples.map(s => s.display.split(',').slice(0, 2).map(Number));
const steps = points.slice(1).map((p, i) => metres(points[i], p)).filter(Number.isFinite);
const frameMs = samples.map(s => Number(s.frameMs)).filter(n => Number.isFinite(n) && n > 0);
const result = {base, label, chosen, motion: mode, reason, samples: samples.length, seconds,
 drawnStepMetres: {median: +pct(steps, 0.5)?.toFixed(2), p95: +pct(steps, 0.95)?.toFixed(2),
  max: +Math.max(0, ...steps).toFixed(1), overABusLength: steps.filter(d => d > 12).length,
  over40: steps.filter(d => d > 40).length},
 frameMs: frameMs.length ? {median: +pct(frameMs, 0.5).toFixed(1), p95: +pct(frameMs, 0.95).toFixed(1)} : null,
 layout: phone ? 'phone 390x844' : 'desktop 1280x860',
 // How much of the watch the bus was actually moving, and how many publications arrived during it:
 // a ride is watchable when it moves most of the time, not when its largest step is small.
 movingShare: `${(steps.filter(d => d > 0.02).length / Math.max(1, steps.length) * 100).toFixed(0)}%`,
 publications: new Set(samples.map(s => s.age)).size > 1
  ? samples.reduce((n, s, i) => n + (i > 0 && Number(s.age) < Number(samples[i - 1].age) - 2 ? 1 : 0), 0) + 1 : 1,
 reportAgeSeconds: samples.length ? {median: +pct(samples.map(s => Number(s.age)).filter(Number.isFinite), 0.5).toFixed(0)} : null,
 corrections: [...new Set(samples.map(s => s.correction).filter(c => c && c !== 'none'))].slice(0, 6),
 renderer: 'SwiftShader (software WebGL), not a phone GPU'};
writeFileSync(`${out}/smoothness.json`, JSON.stringify(result, null, 1));
await context.close();
await browser.close();
console.log(JSON.stringify(result, null, 1));
