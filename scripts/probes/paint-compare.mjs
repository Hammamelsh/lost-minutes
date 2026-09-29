// A bus link loaded alternately from the served build and from this build (out/ on 127.0.0.1:8099, every /data request
// fetched from the served site, tiles from OpenFreeMap as always): when the map counts as drawn, where the camera is
// then, and whether "Drawing the map…" is still up 5 s in. REAL data both ways; Chromium, phone emulation.
import {chromium} from '@playwright/test';
import {launchOptions} from '../../tests/browser/browser-env.mjs';
const served = 'https://lost-minutes.duckdns.org', local = 'http://127.0.0.1:8099';
const key = process.argv[2], loads = Number(process.argv[3] ?? 10);
const b = await chromium.launch(launchOptions());
async function once(which) {
  const ctx = await b.newContext({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: 'block'});
  const page = await ctx.newPage();
  if (which === 'local') {
    await page.route(`${local}/data/**`, async route => {
      const url = new URL(route.request().url());
      const response = await route.fetch({url: `${served}${url.pathname}${url.search}`}).catch(() => null);
      if (!response) return route.abort();
      await route.fulfill({response});
    });
  }
  const t0 = Date.now();
  await page.goto(`${which === 'local' ? local : served}/?bus=${encodeURIComponent(key)}`, {waitUntil: 'load'});
  let painted = null, camera = null, noteAt5 = null;
  for (let k = 0; k < 80; k++) {
    const st = await page.locator('.vector-map').getAttribute('data-map-state').catch(() => null);
    const t = (Date.now() - t0) / 1000;
    if (noteAt5 === null && t >= 5) noteAt5 = await page.locator('.map-loading').count();
    if (st === 'painted' && painted === null) { painted = t; camera = await page.locator('.vector-map').getAttribute('data-camera'); }
    if (painted !== null && t >= 5) break;
    await page.waitForTimeout(250);
  }
  const moves = await page.locator('.vector-map').getAttribute('data-moves').catch(() => null);
  await ctx.close();
  return {which, painted, camera, moves, noteAt5};
}
const out = [];
const builds = process.argv[4] === 'served-only' ? ['served'] : ['served', 'local'];
for (let i = 0; i < loads; i++) for (const which of builds) {
  const r = await once(which);
  out.push(r);
  console.log(JSON.stringify(r));
}
await b.close();
for (const which of builds) {
  const rs = out.filter(r => r.which === which), times = rs.map(r => r.painted ?? Infinity).sort((x, y) => x - y);
  console.log(`${which}: painted ${times.map(t => t.toFixed(1)).join(' ')} s; over 10 s: ${times.filter(t => t > 10).length} of ${rs.length}; note still up at 5 s: ${rs.filter(r => r.noteAt5).length}`);
}
