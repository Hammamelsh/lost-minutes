/**
 * What drawing the fleet costs the page at the street zoom, where buses with no checked road are drawn along the map's
 * streets (lib/streets.ts): a busy stop opened on real data at a computer's size, the map dragged to a new area every
 * 10 s so new tiles arrive, and every 500 ms the fleet's tick (data-fleet-ms, its median of 20, and data-fleet-ms-max,
 * the worst of them) and the frame interval (data-frame-ms); with every long task the browser reports (over 50 ms,
 * PerformanceObserver). Run against the served site and a local build fed the served site's own data, one after the
 * other, to compare builds on the same machine. SwiftShader, not a phone. REAL data.
 *
 *   node scripts/probes/street-ticks.mjs served
 *   node scripts/probes/street-ticks.mjs local http://127.0.0.1:8099
 * Writes outputs/probes/street-ticks/<label>.json and prints a summary.
 */
import {chromium} from '@playwright/test';
import {writeFileSync, mkdirSync} from 'node:fs';
import {launchOptions} from '../../tests/browser/browser-env.mjs';
const [label = 'served', base = 'https://lost-minutes.duckdns.org', stop = '1800SBE0351', seconds = '90'] = process.argv.slice(2);
const served = 'https://lost-minutes.duckdns.org';
mkdirSync('outputs/probes/street-ticks', {recursive: true});
const b = await chromium.launch(launchOptions());
const ctx = await b.newContext({viewport: {width: 1366, height: 768}, serviceWorkers: 'block', timezoneId: 'Europe/London'});
const page = await ctx.newPage();
if (base !== served) await page.route(`${base}/data/**`, async r => {
  const u = new URL(r.request().url());
  const res = await r.fetch({url: `${served}${u.pathname}${u.search}`}).catch(() => null);
  if (!res) return r.abort();
  await r.fulfill({response: res});
});
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.addInitScript(() => {
  window.__long = [];
  try { new PerformanceObserver(list => { for (const e of list.getEntries()) window.__long.push(Math.round(e.duration)); }).observe({type: 'longtask', buffered: true}); } catch {}
});
await page.goto(`${base}/?stop=${stop}`, {waitUntil: 'load'});
const m = page.locator('.vector-map').first();
await page.locator('.vector-map[data-map-state="painted"]').waitFor({timeout: 90_000});
await page.waitForTimeout(6000);
await page.evaluate(() => { window.__long.length = 0; });
const box = await m.boundingBox();
const drags = [[-260, 0], [0, -200], [260, 0], [0, 200], [-200, -150], [200, 150], [-260, 120], [260, -120], [0, -200]];
const samples = [];
const t0 = Date.now();
for (let s = 0; s < Number(seconds) * 2; s++) {
  if (s > 0 && s % 20 === 0) {
    const [dx, dy] = drags[(s / 20 - 1) % drags.length], cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy); await page.mouse.down();
    await page.mouse.move(cx + dx, cy + dy, {steps: 8}); await page.mouse.up();
  }
  samples.push(await m.evaluate(el => ({fleet: el.dataset.fleet, fleetMs: Number(el.dataset.fleetMs), fleetMsMax: Number(el.dataset.fleetMsMax),
    frameMs: Number(el.dataset.frameMs), zoom: Number(el.dataset.zoom), streetLines: el.dataset.streetLines ?? null})));
  await page.waitForTimeout(500 - ((Date.now() - t0) % 500));
}
const long = await page.evaluate(() => window.__long.slice());
const q = (xs, p) => { const v = xs.filter(Number.isFinite).sort((a, c) => a - c); return v.length ? v[Math.floor((v.length - 1) * p)] : null; };
const summary = {label, base, stop, seconds: Number(seconds), zoom: q(samples.map(x => x.zoom), 0.5),
  buses: samples.at(-1)?.fleet ?? null, streetLines: samples.at(-1)?.streetLines ?? null,
  fleetMs: {median: q(samples.map(x => x.fleetMs), 0.5), p95: q(samples.map(x => x.fleetMs), 0.95)},
  fleetMsMax: {median: q(samples.map(x => x.fleetMsMax), 0.5), p95: q(samples.map(x => x.fleetMsMax), 0.95), max: q(samples.map(x => x.fleetMsMax), 1)},
  frameMs: {median: q(samples.map(x => x.frameMs), 0.5), p95: q(samples.map(x => x.frameMs), 0.95), max: q(samples.map(x => x.frameMs), 1)},
  longTasks: {count: long.length, over100: long.filter(x => x > 100).length, max: long.length ? Math.max(...long) : 0, totalMs: long.reduce((a, c) => a + c, 0)},
  errors};
writeFileSync(`outputs/probes/street-ticks/${label}.json`, JSON.stringify({summary, samples, long}, null, 1));
console.log(JSON.stringify(summary));
await b.close();
