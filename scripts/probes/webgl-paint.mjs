// Why does the vector map sometimes not paint in the browser checks? One Chromium, launched as the
// suite launches it, loads the page again and again with the FIXTURE feed, each load in a fresh
// context as each check is (alternately desktop and phone size). For each load: whether it painted
// and how long that took, or that the page fell back to the drawn map and the reason it gives
// (data-map-fallback: no_webgl, startup_timeout, create_failed, style_failed, tiles_failed,
// module_failed), with any WebGL or GPU console messages. `--city` also tilts each painted map to
// the City view, whose buildings many checks draw. `--tile-delay <ms>` holds back the basemap's
// vector tiles (the first `--slow-tiles <n>` of each load, or all of them) as a slow network would.
//
// node scripts/probes/webgl-paint.mjs --loads 120 [--city] [--label name] [--base http://localhost:3100/]
//   [--tile-delay 9000 --slow-tiles 1]
// Without --base it serves out/ itself. Writes outputs/probes/webgl-paint/<label>.json.
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {arg, fixtures, launch, outDir, site} from './common.mjs';

const loads = Number(arg('loads', 40)), city = process.argv.includes('--city');
const tileDelay = Number(arg('tile-delay', 0)), slowTiles = Number(arg('slow-tiles', Infinity));
const label = arg('label', city ? 'city' : 'plain');
const F = await fixtures();
const {base, stop} = await site();
const browser = await launch();
const results = [];
try {
  for (let i = 0; i < loads; i++) {
    const phone = i % 2 === 1;
    const ctx = await browser.newContext(phone
      ? {viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, deviceScaleFactor: 2}
      : {viewport: {width: 1280, height: 900}});
    const page = await ctx.newPage();
    const messages = [];
    page.on('console', m => { const text = m.text(); if (/webgl|context|gpu|swiftshader|angle/i.test(text)) messages.push(`${m.type()}: ${text.slice(0, 180)}`); });
    page.on('pageerror', e => messages.push(`pageerror: ${e.message.slice(0, 180)}`));
    await F.servePatterns(page);
    await F.serveLive(page, [() => F.journeyLive()]);
    if (tileDelay) {
      let slowed = 0;
      await page.route(/tiles\.openfreemap\.org\/.*\.pbf/, async route => {
        if (slowed++ < slowTiles) await new Promise(r => setTimeout(r, tileDelay));
        await route.continue().catch(() => {});
      });
    }
    const t0 = Date.now();
    await page.goto(base);
    const outcome = await Promise.race([
      page.locator('.vector-map[data-map-state="painted"]').waitFor({timeout: 50_000}).then(() => 'painted'),
      page.locator('.map-fallback-wrap').waitFor({state: 'attached', timeout: 50_000}).then(() => 'fallback'),
    ]).catch(() => 'neither');
    const ms = Date.now() - t0;
    const reason = outcome === 'fallback' ? await page.locator('.map-fallback-wrap').getAttribute('data-map-fallback') : null;
    if (city && outcome === 'painted') {
      await page.getByRole('button', {name: 'City', exact: true}).click().catch(() => {});
      await page.waitForTimeout(2500);
    }
    results.push({i, phone, outcome, ms, reason, messages});
    console.log(JSON.stringify(results.at(-1)));
    await ctx.close();
  }
} finally {
  await browser.close();
  stop();
}
const painted = results.filter(r => r.outcome === 'painted').map(r => r.ms).sort((a, b) => a - b);
const pct = p => painted.length ? painted[Math.min(painted.length - 1, Math.floor(p * painted.length))] : null;
const summary = {loads, city, base: arg('base') ? 'a running server' : 'out/ served locally',
  tileDelay: tileDelay ? {ms: tileDelay, tiles: Number.isFinite(slowTiles) ? slowTiles : 'all'} : null,
  painted: painted.length, fellBack: results.filter(r => r.outcome === 'fallback').length,
  neither: results.filter(r => r.outcome === 'neither').length,
  reasons: Object.fromEntries([...new Set(results.map(r => r.reason).filter(Boolean))]
    .map(r => [r, results.filter(x => x.reason === r).length])),
  paintMs: {p50: pct(0.5), p90: pct(0.9), max: painted.at(-1) ?? null},
  messages: [...new Set(results.flatMap(r => r.messages))].slice(0, 12)};
const file = join(outDir('webgl-paint', ''), `${label}.json`);
writeFileSync(file, JSON.stringify({summary, results}, null, 1));
console.log(JSON.stringify(summary, null, 1));
console.log(`written to ${file}`);
