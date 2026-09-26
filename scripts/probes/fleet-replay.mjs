/**
 * A reel of publications played through a built page with nothing chosen, as the served probe that
 * first saw the fleet's unexplained jumps did (26 September 2026): the page opened at its home view,
 * zoomed in twice to a neighbourhood zoom, and every bus it draws read from the map's own diagnostics.
 * Written to reproduce those jumps before and after the fix, on the same publications.
 *
 *   node scripts/probes/fleet-replay.mjs --reel reel.json --patterns patterns.json --label after \
 *     [--base https://lost-minutes.duckdns.org/] [--from 12:01:30] [--seconds 200] [--vehicle 11930,11918]
 *
 * Without `--base` it serves this build's out/. With it, the named site is loaded and only its data is
 * replaced, in this browser alone: config.json (polling as the site's own, every 20 s), live.json (the
 * reel, every timestamp moved onto this run's clock) and patterns.json (the catalogue the reel was
 * matched against). Recorded inside the page on every change of `data-bus-points` (at most every
 * 250 ms): each named vehicle's drawn place and screen point, the camera, the zoom, and the marked
 * repositionings (`data-fleet-moved`). Steps are measured in metres from the drawn places over the
 * time that really passed; the first probe measured screen pixels with a 256-pixel tile's scale on a
 * map of 512-pixel tiles, which doubled every distance it reported.
 */
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {arg, launch, outDir, root, site} from './common.mjs';

const reelPath = arg('reel');
const reel = JSON.parse(await (await import('node:fs/promises')).readFile(reelPath.startsWith('/') ? reelPath : join(root, reelPath), 'utf8'));
const patternsFile = arg('patterns', null);
const label = arg('label', 'fleet');
const wanted = (arg('vehicle', '11930,11918')).split(',');
const out = outDir('fleet-replay', label);
const day = new Date(reel.publications[0].receivedAtMs).toISOString().slice(0, 10);
const from = Date.parse(`${day}T${arg('from', '12:01:30')}Z`);
const publications = reel.publications.filter(p => p.receivedAtMs >= from - 20_000);
const base0 = publications[0].receivedAtMs;
const seconds = Number(arg('seconds', 200));

function rebase(entry, startedAtMs) {
  const move = ms => Math.round(startedAtMs + (ms - base0));
  const live = structuredClone(entry.live);
  live.publishedAtMs = move(Date.parse(live.publishedAt));
  live.publishedAt = new Date(live.publishedAtMs).toISOString();
  for (const v of live.vehicles ?? []) {
    v.observedAtMs = move(v.observedAtMs);
    v.recordedAt = new Date(v.observedAtMs).toISOString().replace('.000Z', '+00:00');
    if (v.retrievedAtMs) v.retrievedAtMs = move(v.retrievedAtMs);
    v.ageSeconds = Math.round(((live.publishedAtMs - v.observedAtMs) / 1000) * 10) / 10;
  }
  return live;
}

const remote = arg('base', null);
const local = remote ? null : await site();
const base = remote ?? local.base;
const browser = await launch();
const size = {width: 1366, height: 768};
const context = await browser.newContext({viewport: size, timezoneId: 'Europe/London', serviceWorkers: 'block', recordVideo: {dir: out, size}});
const page = await context.newPage();
const startedAtMs = Date.now();
const served = [];
await page.route('**/data/config.json*', async r => {
  const real = await (await r.fetch()).json().catch(() => ({}));
  // The site's own configuration, without anything that would take the page elsewhere.
  return r.fulfill({json: {...real, schemaVersion: 1, liveUrl: '/data/live.json', pollSeconds: 20, photo3d: undefined}});
});
if (patternsFile) await page.route('**/data/patterns.json*', r => r.fulfill({path: patternsFile, contentType: 'application/json'}));
await page.route('**/data/live.json*', r => {
  // The publication the collector had written by now, as the page would have been served it.
  const elapsed = Date.now() - startedAtMs + (from - base0) - 2500;
  let i = 0;
  while (i + 1 < publications.length && publications[i + 1].receivedAtMs - base0 <= elapsed) i += 1;
  served.push({index: i, at: Date.now() - startedAtMs, madeAt: new Date(publications[i].receivedAtMs).toISOString()});
  return r.fulfill({json: rebase(publications[i], startedAtMs - (from - base0)), headers: {date: new Date().toUTCString(), 'cache-control': 'no-store'}});
});
await page.goto(base, {waitUntil: 'domcontentloaded'});
const map = page.locator('.vector-map').first();
await page.locator('.vector-map[data-map-state="painted"]').waitFor({timeout: 90_000});
// As the served probe: from the home view, a neighbourhood zoom by the map's own buttons.
for (let i = 0; i < 2; i++) { await page.getByRole('button', {name: 'Zoom in'}).click(); await page.waitForTimeout(400); }
await page.evaluate(names => {
  const el = document.querySelector('.vector-map');
  window.__fleet = [];
  const read = () => {
    const points = JSON.parse(el.getAttribute('data-bus-points') || '[]');
    window.__fleet.push({t: performance.now(), wall: Date.now(), zoom: el.getAttribute('data-zoom'), camera: el.getAttribute('data-camera'),
      moved: el.getAttribute('data-fleet-moved') ?? null, fleet: el.getAttribute('data-fleet'),
      buses: points.filter(p => names.some(n => p.key.endsWith('|' + n)))});
  };
  read();
  new MutationObserver(read).observe(el, {attributes: true, attributeFilter: ['data-bus-points', 'data-fleet-moved']});
}, wanted);
const shots = [];
for (let s = 0; s < seconds; s += 1) {
  await page.waitForTimeout(1000);
  const moved = await map.getAttribute('data-fleet-moved');
  if (moved && wanted.some(n => moved.includes('|' + n + ':')) && shots.length < 4) {
    const file = join(out, `moved-${shots.length + 1}.png`);
    await page.screenshot({path: file});
    shots.push({at: Date.now() - startedAtMs, moved, file});
  }
}
await page.screenshot({path: join(out, 'end.png')});
const trace = await page.evaluate(() => window.__fleet);
const metres = (a, b) => Math.hypot((b.lat - a.lat) * 111195, (b.lon - a.lon) * 111195 * Math.cos(a.lat * Math.PI / 180));
const summary = {label, base, reel: reelPath, from: new Date(from).toISOString(), samples: trace.length, publicationsServed: new Set(served.map(s => s.index)).size,
  zooms: [...new Set(trace.map(s => s.zoom))], cameras: [...new Set(trace.map(s => s.camera))], shots, vehicles: {}};
for (const name of wanted) {
  const rows = trace.map(s => ({...s, bus: s.buses.find(b => b.key.endsWith('|' + name))})).filter(s => s.bus && Number.isFinite(s.bus.lat));
  const steps = [];
  for (let i = 1; i < rows.length; i++) {
    const d = metres(rows[i - 1].bus, rows[i].bus), dt = (rows[i].wall - rows[i - 1].wall) / 1000;
    steps.push({at: new Date(rows[i].wall - startedAtMs + from).toISOString().slice(11, 21), metres: +d.toFixed(1), seconds: +dt.toFixed(2),
      mps: dt > 0 ? +(d / dt).toFixed(1) : null, marked: Boolean(rows[i].moved && rows[i].moved.includes('|' + name + ':'))});
  }
  const big = steps.filter(s => s.mps !== null && s.mps > 25 && s.metres > 5);
  summary.vehicles[name] = {samples: rows.length, largest: [...steps].sort((a, b) => b.metres - a.metres).slice(0, 4),
    cutsOver25mps: big.length, unmarkedCuts: big.filter(s => !s.marked)};
}
writeFileSync(join(out, 'trace.json'), JSON.stringify({summary, served, trace}, null, 1));
console.log(JSON.stringify(summary, null, 1));
await context.close(); await browser.close(); local?.stop();
