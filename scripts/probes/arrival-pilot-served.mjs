// What a served site says about arrival minutes, inbound 15's timetable and the nightly jobs' memory, as a
// phone reaches it (emulation). Written for the arrival pilot of 28 September 2026 and run before and after
// its deploy:
//   node scripts/probes/arrival-pilot-served.mjs --base https://lost-minutes.duckdns.org --label before
// Frames and a summary go to outputs/probes/arrival-pilot/ (Git-ignored).
import {chromium} from '@playwright/test';
import {mkdirSync, writeFileSync} from 'node:fs';
import {launchOptions} from '../../tests/browser/browser-env.mjs';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const base = arg('base', 'https://lost-minutes.duckdns.org').replace(/\/$/, '');
const label = arg('label', 'served');
const out = 'outputs/probes/arrival-pilot';
mkdirSync(out, {recursive: true});
const json = async path => { const r = await fetch(`${base}${path}`, {cache: 'no-store'}); return r.ok ? r.json() : {status: r.status}; };
const summary = {base, label, at: new Date().toISOString()};

// The published files, as served.
const release = await json('/data/arrival-release.json');
summary.release = {schemaVersion: release.schemaVersion, generatedAt: release.generatedAt, scopes: release.scopes, released: release.released,
 awaiting: (release.awaitingApproval ?? []).map(p => `${p.operator} ${p.line} ${p.direction} ${p.patternIds}`),
 directions: Object.fromEntries(Object.entries(release.directions ?? {}).map(([d, x]) => [d, {passed: x.passed, released: x.released,
  medianAbs: x.medianAbs, p80Abs: x.p80Abs, shownBand: x.shownBand, journeys: x.journeys, nights: x.nights}]))};
const anchor = await json('/data/schedule-anchor.json');
summary.anchor = Object.fromEntries(Object.entries(anchor.patterns ?? {}).map(([k, v]) => [k, {verified: v.verified, median: v.medianOffsetMinutes, reason: v.reason}]));
const jobs = await json('/data/jobs.json');
summary.jobs = (jobs.jobs ?? []).map(j => ({name: j.name, lastAttempt: j.lastAttempt && {trigger: j.lastAttempt.trigger, result: j.lastAttempt.result,
 finishedAt: j.lastAttempt.finishedAt, memoryPeakBytes: j.lastAttempt.memoryPeakBytes}, lastSuccess: j.lastSuccess}));

const browser = await chromium.launch(launchOptions());
const context = await browser.newContext({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
 serviceWorkers: 'block', timezoneId: 'Europe/London'});
const page = await context.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
const painted = () => page.locator('.vector-map[data-map-state="painted"]').waitFor({timeout: 90_000});

// 1. Inbound 15, then the 53: the journey whose first leg was said to run 15 min early until 28 September.
const key = 'c:BNML:15:inbound:9c10700c6c|1800SJ32251|1800SB30681|BNSM:53:outbound:a05164133e|1800SB18691|1800NF09811';
await page.goto(`${base}/?to=53.47192%2C-2.29555&toLabel=MediaCityUK+%28at%29&plan=${encodeURIComponent(key)}`, {waitUntil: 'load'});
await painted();
const card = page.locator('.journey-card');
await card.waitFor({timeout: 30_000});
await page.waitForTimeout(8000);
await page.screenshot({path: `${out}/${label}-inbound15-journey.png`});
summary.inbound15Journey = {timing: await card.getAttribute('data-timing'),
 withheld: (await card.locator('[data-times-withheld]').innerText().catch(() => '')).replace(/\s+/g, ' ') || null,
 basis: (await card.locator('[data-basis]').innerText().catch(() => '')).replace(/\s+/g, ' ') || null,
 details: (await card.locator('.journey-details').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 500),
 says15MinEarly: /15 min early/.test(await card.innerText())};

// 2. A live outbound 15 bus, from a stop a few ahead of its last report: no minutes on its card.
const live = await json('/data/live.json');
const patterns = await json('/data/patterns.json');
const outbound = (patterns.patterns ?? []).find(p => p.id === 'BNML:15:outbound:c9291c1aea');
const stops = new Set(((await json('/data/stops.json')).stops ?? []).map(s => s.id));
const bus = (live.vehicles ?? []).filter(v => v.match?.patternId === outbound?.id && typeof v.match.patternIndex === 'number')
 .sort((a, b) => (b.observedAtMs ?? 0) - (a.observedAtMs ?? 0))
 .find(v => outbound.stops.slice(v.match.patternIndex + 4, v.match.patternIndex + 9).some(id => stops.has(id)));
if (bus) {
 const stopId = outbound.stops.slice(bus.match.patternIndex + 4, bus.match.patternIndex + 9).find(id => stops.has(id));
 const busKey = `${bus.operator}|${bus.vehicle}|${bus.route}|${bus.direction}`;
 const url = `${base}/?stop=${stopId}&bus=${encodeURIComponent(busKey)}`;
 await page.goto(url, {waitUntil: 'load'});
 await painted();
 await page.locator('.bus-card .route-badge').first().waitFor({timeout: 30_000}).catch(() => {});
 await page.waitForTimeout(6000);
 await page.screenshot({path: `${out}/${label}-outbound15-card.png`});
 summary.outbound15Card = {url, vehicle: bus.vehicle, stopId, arrivalLines: await page.locator('.bus-card-arrival').count(),
  boardWhen: (await page.locator('[data-board-when]').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300),
  timetabled: (await page.locator('.bus-card').first().innerText().catch(() => '')).match(/Timetabled[^\n]*/)?.[0] ?? null};
} else summary.outbound15Card = {note: 'no outbound 15 bus with stops ahead in this publication'};

// 3. Operations: each nightly job's memory row.
await page.goto(`${base}/#operations`, {waitUntil: 'load'});
await page.locator('[data-memory]').first().waitFor({timeout: 30_000}).catch(() => {});
summary.memoryRows = await page.locator('[data-memory]').evaluateAll(rows => rows.map(r => ({state: r.getAttribute('data-memory'), text: r.innerText.replace(/\s+/g, ' ')})));
await page.locator('[data-memory]').first().scrollIntoViewIfNeeded().catch(() => {});
await page.screenshot({path: `${out}/${label}-operations-memory.png`});

summary.errors = errors;
await browser.close();
writeFileSync(`${out}/${label}.json`, JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary, null, 1));
