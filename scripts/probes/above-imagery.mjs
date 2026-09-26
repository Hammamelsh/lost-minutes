/**
 * The view from above on real imagery, measured: what docs/PHOTO_3D_PREVIEW.md §4 asks of the first
 * look at Google's Photorealistic 3D Tiles over Manchester. Written before any key exists; run with
 * `--fixture` it checks itself against the fixture tileset, so the day access is authorised it is a
 * command, not a plan.
 *
 *   # the private preview on the server (the password from the environment, never an argument):
 *   LM_PREVIEW_USER=preview LM_PREVIEW_PASS=... node scripts/probes/above-imagery.mjs \
 *     --base https://lost-minutes.duckdns.org/preview/ --label first-look
 *   # or this build with a key of your own, never logged (the probe answers /data/config.json):
 *   LM_PHOTO3D_GOOGLE_KEY=... node scripts/probes/above-imagery.mjs --label local-key
 *   # the harness itself, no imagery:
 *   node scripts/probes/above-imagery.mjs --fixture --label harness
 *
 * Each corridor is a recorded reel played as live.json (so the same buses at the same moments on
 * every run), a bus pinned by its link, and the view opened on it. Measured: the renderer's and the
 * imagery's ready times; opening requests (the billed unit) and tile requests with their bytes; frames
 * drawn and the tick's cost; the JavaScript heap before, during and after; a turn and a stop seen at
 * the elevated and the closer distance; the page hidden and shown; and exit. Frames go to
 * outputs/probes/above-imagery/<label>/. Every URL written anywhere has its key removed.
 */
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {arg, launch, outDir, root, site} from './common.mjs';

const has = k => process.argv.includes('--' + k);
const label = arg('label', 'imagery');
const out = outDir('above-imagery', label);
const redact = text => String(text).replace(/key=[^&"'\s]+/g, 'key=REDACTED');
const fixture = has('fixture');
const key = process.env.LM_PHOTO3D_GOOGLE_KEY ?? '';
const remote = arg('base', null);
if (!fixture && !remote && !key) { console.error('give --base (the preview), LM_PHOTO3D_GOOGLE_KEY, or --fixture'); process.exit(1); }

// The corridors: a reel, a vehicle on it, and the moment to start. City centre: the 192s' terminus and
// Piccadilly (26 September 2026, noon). Suburban: whatever reel `--suburban` names, else skipped.
const corridors = [
  {name: 'city-centre', reel: arg('reel', 'outputs/probes/above-imagery/reel-noon.json'), vehicle: arg('vehicle', '11918'), from: arg('from', '12:02:00')},
  ...(arg('suburban', null) ? [{name: 'suburban', reel: arg('suburban'), vehicle: arg('suburban-vehicle'), from: arg('suburban-from', null)}] : []),
];
const rad = d => d * Math.PI / 180;
const FIXTURE_TILESET = {asset: {version: '1.1', copyright: 'FIXTURE imagery credit'}, geometricError: 2000,
  root: {boundingVolume: {region: [rad(-2.34), rad(53.44), rad(-2.20), rad(53.52), 0, 400]}, geometricError: 0, refine: 'ADD'}};

const local = remote ? null : await site();
const base = remote ?? local.base;
const browser = await launch();
const results = {label, base: redact(base), fixture, at: new Date().toISOString(), corridors: []};
const {readFile} = await import('node:fs/promises');

for (const corridor of corridors) {
  let reel;
  try { reel = JSON.parse(await readFile(corridor.reel.startsWith('/') ? corridor.reel : join(root, corridor.reel), 'utf8')); }
  catch { results.corridors.push({name: corridor.name, skipped: `no reel at ${corridor.reel}`}); continue; }
  const day = new Date(reel.publications[0].receivedAtMs).toISOString().slice(0, 10);
  const from = corridor.from ? Date.parse(`${day}T${corridor.from}Z`) : reel.publications[0].receivedAtMs;
  const pubs = reel.publications.filter(p => p.receivedAtMs >= from - 60_000);
  const bus = pubs.map(p => p.live.vehicles.find(v => v.vehicle === corridor.vehicle)).find(Boolean);
  if (!bus) { results.corridors.push({name: corridor.name, skipped: `vehicle ${corridor.vehicle} not in the reel`}); continue; }
  for (const size of [{name: 'phone', viewport: {width: 390, height: 844}, mobile: true}, {name: 'desktop', viewport: {width: 1366, height: 768}, mobile: false}]) {
    const credentials = process.env.LM_PREVIEW_USER && process.env.LM_PREVIEW_PASS
      ? {username: process.env.LM_PREVIEW_USER, password: process.env.LM_PREVIEW_PASS} : undefined;
    const context = await browser.newContext({viewport: size.viewport, isMobile: size.mobile, hasTouch: size.mobile, deviceScaleFactor: size.mobile ? 3 : 1,
      timezoneId: 'Europe/London', serviceWorkers: 'block', httpCredentials: credentials});
    const page = await context.newPage();
    const startedAtMs = Date.now();
    const net = {root: 0, tiles: 0, tileBytes: 0, failed: 0, statuses: {}};
    page.on('response', async r => {
      const u = r.url();
      if (!/tile\.googleapis\.com|fixture\.invalid/.test(u)) return;
      const isRoot = /root\.json|tileset\.json/.test(u);
      if (isRoot) net.root += 1; else net.tiles += 1;
      net.statuses[r.status()] = (net.statuses[r.status()] ?? 0) + 1;
      const length = Number((await r.allHeaders().catch(() => ({})))['content-length'] ?? 0);
      if (!isRoot) net.tileBytes += length;
    });
    page.on('requestfailed', r => { if (/tile\.googleapis\.com|fixture\.invalid/.test(r.url())) net.failed += 1; });
    const move = ms => Math.round(startedAtMs + (ms - from));
    await page.route('**/data/live.json*', r => {
      const elapsed = Date.now() - startedAtMs - 2500;
      let i = 0;
      while (i + 1 < pubs.length && pubs[i + 1].receivedAtMs - from <= elapsed) i += 1;
      const live = structuredClone(pubs[i].live);
      live.publishedAtMs = move(Date.parse(live.publishedAt)); live.publishedAt = new Date(live.publishedAtMs).toISOString();
      for (const v of live.vehicles) { v.observedAtMs = move(v.observedAtMs); v.recordedAt = new Date(v.observedAtMs).toISOString().replace('.000Z', '+00:00');
        if (v.retrievedAtMs) v.retrievedAtMs = move(v.retrievedAtMs); v.ageSeconds = Math.round((live.publishedAtMs - v.observedAtMs) / 100) / 10; }
      return r.fulfill({json: live, headers: {date: new Date().toUTCString()}});
    });
    if (fixture || (!remote && key)) {
      const tilesetUrl = fixture ? 'https://fixture.invalid/tileset.json' : `https://tile.googleapis.com/v1/3dtiles/root.json?key=${key}`;
      await page.route('**/data/config.json*', async r => {
        const real = await (await r.fetch()).json().catch(() => ({}));
        return r.fulfill({json: {...real, pollSeconds: 20, photo3d: {provider: fixture ? 'sample' : 'google', tilesetUrl,
          attribution: fixture ? 'FIXTURE' : 'Google', note: 'probe'}}});
      });
      if (fixture) await page.route('https://fixture.invalid/**', r => r.fulfill({json: FIXTURE_TILESET}));
    }
    const link = `${base}?bus=${encodeURIComponent(`${bus.operator}|${bus.vehicle}|${bus.route}|${bus.direction}|${bus.journeyRef}`)}`;
    const heap = () => page.evaluate(() => Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1048576));
    const row = {name: corridor.name, size: size.name, vehicle: `${bus.operator} ${bus.vehicle} (${bus.route})`, frames: []};
    try {
      await page.goto(link, {waitUntil: 'domcontentloaded'});
      await page.locator('.vector-map[data-map-state="painted"]').waitFor({timeout: 90_000});
      await page.waitForTimeout(3000);
      row.heapBeforeMB = await heap();
      const tryLink = page.locator('[data-try-ride-link]');
      if (await tryLink.isVisible()) await tryLink.click();
      const entry = page.locator('[data-above-entry]');
      await entry.scrollIntoViewIfNeeded({timeout: 20_000});
      const opened = Date.now();
      await entry.click();
      const view = page.locator('.gods-eye');
      await view.and(page.locator('[data-above="ready"], [data-above="failed"]')).waitFor({timeout: 90_000});
      row.status = await view.getAttribute('data-above');
      row.failure = await view.getAttribute('data-above-failure');
      if (row.status !== 'ready') throw new Error(`the view did not open: ${row.failure}`);
      await page.locator('.gods-eye[data-above-imagery="loaded"]').waitFor({timeout: 90_000}).catch(() => {});
      row.readyMs = Number(await view.getAttribute('data-above-ready-ms'));
      row.usableMs = Number(await view.getAttribute('data-above-usable-ms')) || null;
      row.openToUsableMs = Date.now() - opened;
      const shoot = async what => { const file = join(out, `${corridor.name}-${size.name}-${what}.png`); await page.screenshot({path: file}); row.frames.push(file); };
      await shoot('1-city');
      await page.locator('.gods-eye[data-above-mode="following"]').waitFor({timeout: 30_000}).catch(() => {});
      await page.waitForTimeout(4000);
      await shoot('2-elevated');
      // A minute following at the elevated distance, a frame every 15 s: a turn, a stop, pulling away,
      // wherever the reel has them.
      for (let k = 0; k < 4; k++) { await page.waitForTimeout(15_000); await shoot(`3-elevated-${k + 1}`); }
      await page.getByRole('button', {name: 'Closer'}).click().catch(() => {});
      await page.waitForTimeout(3000);
      for (let k = 0; k < 4; k++) { await page.waitForTimeout(15_000); await shoot(`4-closer-${k + 1}`); }
      const stats = ((await view.getAttribute('data-above-stats')) ?? '').split(',').map(Number);
      row.busesDrawn = stats[0]; row.tickMs = stats[1]; row.framesDrawn = stats[2]; row.heapOpenMB = stats[3] ?? await heap();
      row.tileTrouble = await page.locator('[data-above-trouble]').getAttribute('data-above-trouble').catch(() => null);
      // Hidden for thirty seconds and shown again (emulated in this browser; a real phone may differ).
      const hide = h => page.evaluate(hidden => { Object.defineProperty(document, 'hidden', {configurable: true, get: () => hidden});
        Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => hidden ? 'hidden' : 'visible'}); document.dispatchEvent(new Event('visibilitychange')); }, h);
      const frameBefore = Number(await view.getAttribute('data-above-frame'));
      await hide(true); await page.waitForTimeout(30_000); await hide(false); await page.waitForTimeout(3000);
      row.resumedAfterHidden = Number(await view.getAttribute('data-above-frame')) > frameBefore + 30_000;
      await shoot('5-after-hidden');
      await page.getByRole('button', {name: 'Exit the view from above'}).click();
      await page.waitForTimeout(3000);
      row.heapAfterExitMB = await heap();
      row.viewGone = (await page.locator('.gods-eye').count()) === 0;
      row.stillChosen = await page.locator('.vector-map').first().getAttribute('data-selected-key');
    } catch (error) { row.error = redact(error.message); }
    row.network = net;
    results.corridors.push(row);
    await context.close();
  }
}
await browser.close(); local?.stop();
writeFileSync(join(out, 'imagery.json'), redact(JSON.stringify(results, null, 1)));
console.log(redact(JSON.stringify(results, null, 1)));
