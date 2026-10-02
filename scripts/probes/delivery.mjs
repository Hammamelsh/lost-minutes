/**
 * What the browser adds to a report's age, and what the drawing adds on purpose (backlog 48): one phone on the served
 * site, as a passenger has it, for a bounded time. The page is left to poll as it does (every 20 s, not aligned to the
 * collector), and a bus is chosen at a stop as a passenger chooses one, so the drawing runs as it does for them.
 *
 * Recorded, as they happen:
 *  - each live.json the page receives: when (on the server's clock, corrected by --offset-ms, the server's clock minus
 *    this machine's), its publishedAtMs (the collector's log joins it to the moment the file was written: the
 *    browser's polling and delivery delay), and every new report in it with its age on arrival at the page;
 *  - once a second, the chosen bus's drawing: how far behind real time the place drawn stands (frame − shown, from the
 *    map's diagnostics, on the page's own server-corrected clock), and the age of the newest report it is drawn from.
 *    The difference is the delay the drawing keeps on purpose (PLAYBACK in lib/motion.ts).
 * REAL data; Chromium, phone emulation; not a phone in hand. One page, one poll every 20 s: a single passenger's load.
 *
 *   node scripts/probes/delivery.mjs --minutes 40 --offset-ms 1100 [--stop 1800SB45141] [--label name]
 * Writes outputs/probes/delivery/<label>.json; summarise with scripts/delivery-summary.py beside the collector's log.
 */
import {chromium} from '@playwright/test';
import {writeFileSync, mkdirSync} from 'node:fs';
import {launchOptions} from '../../tests/browser/browser-env.mjs';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const BASE = arg('base', 'https://lost-minutes.duckdns.org');
const MINUTES = Number(arg('minutes', '30'));
const OFFSET = Number(arg('offset-ms', '0'));
const STOP = arg('stop', '1800SB45141');
const LABEL = arg('label', new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-'));
const out = 'outputs/probes/delivery'; mkdirSync(out, {recursive: true});
const serverNow = () => Date.now() + OFFSET;

const browser = await chromium.launch(launchOptions());
const context = await browser.newContext({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
  timezoneId: 'Europe/London'});
const page = await context.newPage();
const responses = [], drawing = [], notes = [];
const newest = new Map();
let first = true;
page.on('response', async response => {
  const url = new URL(response.url());
  if (!url.pathname.endsWith('/data/live.json') || !response.ok()) return;
  const at = serverNow();
  try {
    const body = await response.json();
    const fresh = [];
    for (const v of body.vehicles ?? []) {
      const key = `${v.operator}|${v.vehicle}`;
      const before = newest.get(key);
      if (before == null || v.observedAtMs > before) {
        newest.set(key, v.observedAtMs);
        if (!first) fresh.push(Math.round((at - v.observedAtMs) / 100) / 10);
      }
    }
    responses.push({at, publishedAtMs: body.publishedAtMs, lastModified: response.headers()['last-modified'] ?? null,
      vehicles: (body.vehicles ?? []).length, newReportAges: first ? null : fresh});
    first = false;
  } catch (error) { notes.push({at, note: `unreadable live.json: ${error.message}`}); }
});

async function chooseBus() {
  await page.goto(`${BASE}/?stop=${STOP}`, {waitUntil: 'load'});
  await page.locator('.vector-map[data-map-state="painted"]').waitFor({timeout: 90_000}).catch(() => {});
  await page.waitForTimeout(4000);
  const row = page.locator('.waiting .follow-row:visible, .panel-body button.follow-row:visible').first();
  if (!(await row.count())) { notes.push({at: serverNow(), note: 'no bus listed at the stop'}); return false; }
  await row.click();
  notes.push({at: serverNow(), note: `chose ${(await row.innerText()).split('\n').slice(0, 2).join(' · ')}`});
  return true;
}

await chooseBus();
const end = Date.now() + MINUTES * 60_000;
let empty = 0;
while (Date.now() < end) {
  await page.waitForTimeout(1000);
  const d = await page.locator('.vector-map').evaluate(el => ({display: el.getAttribute('data-display'), shown: el.getAttribute('data-shown'),
    age: el.getAttribute('data-report-age'), motion: el.getAttribute('data-motion')})).catch(() => null);
  const frame = d?.display ? Number(d.display.split(',')[4]) : NaN;
  const shown = d?.shown ? Number(d.shown) : NaN;
  if (Number.isFinite(frame) && Number.isFinite(shown) && d.age) {
    empty = 0;
    drawing.push({at: serverNow(), behindS: Math.round(frame - shown) / 1000, reportAgeS: Number(d.age), motion: d.motion});
  } else if (++empty >= 60) {
    // The chosen bus has gone (its journey ended, or it is no longer drawn): choose another, as a passenger would.
    empty = 0;
    await chooseBus();
  }
}
await browser.close();

const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); if (!s.length) return null; const k = (s.length - 1) * p, f = Math.floor(k), c = Math.min(f + 1, s.length - 1); return Math.round((s[f] + (s[c] - s[f]) * (k - f)) * 10) / 10; };
const ages = responses.flatMap(r => r.newReportAges ?? []).filter(a => a <= 900);
const deliberate = drawing.map(d => d.behindS - d.reportAgeS);
const summary = {base: BASE, minutes: MINUTES, offsetMs: OFFSET, stop: STOP,
  responses: responses.length, repeatedPublications: responses.filter((r, i) => i && r.publishedAtMs === responses[i - 1].publishedAtMs).length,
  newReportAgeAtPageS: {n: ages.length, p50: q(ages, 0.5), p95: q(ages, 0.95)},
  drawnBehindRealTimeS: {n: drawing.length, p50: q(drawing.map(d => d.behindS), 0.5), p95: q(drawing.map(d => d.behindS), 0.95)},
  newestReportAgeS: {n: drawing.length, p50: q(drawing.map(d => d.reportAgeS), 0.5), p95: q(drawing.map(d => d.reportAgeS), 0.95)},
  deliberateS: {n: deliberate.length, p50: q(deliberate, 0.5), p95: q(deliberate, 0.95)}};
writeFileSync(`${out}/${LABEL}.json`, JSON.stringify({summary, responses, drawing, notes}, null, 1));
console.log(JSON.stringify(summary, null, 1));
