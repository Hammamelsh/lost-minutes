/**
 * One live bus ridden as a phone does (390 x 844, touch), for N seconds, on the served site or on a local build
 * fed the served site's own data (service worker blocked there, so the data is forwarded). Every second: what the
 * card says about the bus's reporting, the publication the page last received and the bus's report time in it,
 * the camera, and the sight-line diagnostics (the pitch the buildings ask for, whether the bus is inside one,
 * whether the buildings are faded). A frame every 15 s. Run two at once on the same bus to compare builds.
 * Written for the owner's report of 30 September 2026 (backlog 45 and 47). REAL data; Chromium, emulation.
 *
 *   node scripts/probes/paired-ride.mjs "BNGN|2335|V1|outbound" V1 150 served-v1 night
 *   node scripts/probes/paired-ride.mjs "BNGN|2335|V1|outbound" V1 150 local-v1 night http://127.0.0.1:8099
 * Writes outputs/probes/paired-ride/<label>/ (samples.json and frames); prints a summary.
 */
import {chromium} from '@playwright/test';
import {writeFileSync, mkdirSync} from 'node:fs';
import {launchOptions} from '../../tests/browser/browser-env.mjs';
const [key, route, seconds = '120', label = 'ride', theme = '', base = 'https://lost-minutes.duckdns.org'] = process.argv.slice(2);
const served = 'https://lost-minutes.duckdns.org';
const out = `outputs/probes/paired-ride/${label}`; mkdirSync(out, {recursive: true});
const b = await chromium.launch(launchOptions());
const ctx = await b.newContext({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
  ...(base !== served ? {serviceWorkers: 'block'} : {})});
const page = await ctx.newPage();
if (base !== served) await page.route(`${base}/data/**`, async r => {
  const u = new URL(r.request().url());
  const res = await r.fetch({url: `${served}${u.pathname}${u.search}`}).catch(() => null);
  if (!res) return r.abort();
  await r.fulfill({response: res});
});
const fetches = [];
page.on('response', async r => {
  if (!r.url().includes('/data/live.json')) return;
  try {
    const j = JSON.parse(await r.text());
    const [op, veh] = key.split('|');
    const v = j.vehicles.find(x => x.operator === op && x.vehicle === veh);
    fetches.push({at: new Date().toISOString(), status: r.status(), fromSW: r.fromServiceWorker(), publishedAt: j.publishedAt ?? j.generatedAt,
      busObservedAt: v ? new Date(v.observedAtMs).toISOString() : null, busAgeAtPublication: v?.ageSeconds ?? null});
  } catch {}
});
await page.goto(`${base}/?bus=${encodeURIComponent(key)}`, {waitUntil: 'load'});
const m = page.locator('.vector-map').first();
for (let k = 0; k < 60; k++) { if (await m.getAttribute('data-map-state') === 'painted') break; await page.waitForTimeout(500); }
if (theme) { const now = await m.getAttribute('data-theme'); if (now !== theme) await page.getByRole('button', {name: theme === 'night' ? 'Switch to the night map' : 'Switch to the daylight map'}).click(); }
await page.getByRole('button', {name: new RegExp(`^Ride along with route ${route}`)}).click({timeout: 30000});
const t0 = Date.now(); const samples = [];
for (let s = 0; s < Number(seconds); s++) {
  const card = await page.locator('.ride-status-line.warn').first().textContent({timeout: 200}).catch(() => null);
  const ageLine = await page.locator('.ride-card, .bus-card').first().innerText({timeout: 300}).catch(() => '');
  samples.push({t: Math.round((Date.now() - t0) / 1000), wall: new Date().toISOString().slice(11, 19),
    quiet: card?.trim() ?? null, ageLine: (ageLine.match(/(report|Last reported position)[^\n]*/i) || [null])[0],
    ride: await m.getAttribute('data-ride'), occluded: await m.getAttribute('data-bus-occluded'),
    opacity: await m.getAttribute('data-buildings-opacity'), camera: await m.getAttribute('data-camera'),
    cap: await m.getAttribute('data-ride-pitch-cap'), hidden: await m.getAttribute('data-bus-hidden'),
    inside: await m.getAttribute('data-bus-inside-building'), sightMs: await m.getAttribute('data-sight-ms'),
    lastFetch: fetches.at(-1)?.at?.slice(11, 19) ?? null, busObservedAt: fetches.at(-1)?.busObservedAt?.slice(11, 19) ?? null});
  if (s % 15 === 0) await page.screenshot({path: `${out}/t${String(s).padStart(3, '0')}.png`});
  await page.waitForTimeout(1000 - ((Date.now() - t0) % 1000));
}
writeFileSync(`${out}/samples.json`, JSON.stringify({key, fetches, samples}, null, 1));
const occl = samples.filter(x => x.occluded === 'yes').length, quiet = samples.filter(x => x.quiet).length;
const pitches = samples.filter(x => x.ride === 'following').map(x => Number((x.camera || '').split(',')[3]));
const q = f => pitches.length ? [...pitches].sort((a, b) => a - b)[Math.floor(f * (pitches.length - 1))] : null;
const ms = samples.map(x => Number(x.sightMs)).filter(Number.isFinite).sort((a, b) => a - b);
console.log(JSON.stringify({key, seconds: samples.length, fetches: fetches.length, occludedSeconds: occl, quietSeconds: quiet,
  hiddenSeconds: samples.filter(x => x.hidden === 'yes').length, insideSeconds: samples.filter(x => x.inside === 'yes').length,
  pitch: {min: q(0), p10: q(0.1), median: q(0.5), atFraming: pitches.filter(p => p > 59).length, below45: pitches.filter(p => p < 45).length, n: pitches.length},
  sightMs: {median: ms[Math.floor(ms.length / 2)] ?? null, max: ms.at(-1) ?? null},
  opacities: [...new Set(samples.map(x => x.opacity))], firstQuiet: samples.find(x => x.quiet) ?? null}));
await b.close();
