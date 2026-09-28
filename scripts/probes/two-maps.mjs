// What a second map costs on this renderer: the built site in one frame riding a bus, then two frames
// side by side each riding a bus, and the frame interval each map measures for itself (data-frame-ms,
// the median of its last 90 frames). An upper bound for "Watch both" as two full maps; SwiftShader on
// this machine, which says nothing about a phone's GPU, and is said to.
//
//   node scripts/probes/two-maps.mjs [--port 4181]
import {spawn} from 'node:child_process';
import {chromium} from '@playwright/test';
import {launchOptions} from '../../tests/browser/browser-env.mjs';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const port = arg('port', '4181');
const server = spawn('python3', ['-m', 'http.server', port, '--bind', '127.0.0.1', '--directory', 'out'], {stdio: 'ignore'});
await new Promise(r => setTimeout(r, 1200));
const {movingLive, serveLive, serveMotion, servePatterns} = await import('../../tests/browser/fixtures.mjs');
try {
  const browser = await chromium.launch(launchOptions());
  const measure = async (frames, size) => {
    const ctx = await browser.newContext({viewport: size, serviceWorkers: 'block'});
    const page = await ctx.newPage();
    const startMs = Date.now();
    await servePatterns(page); await serveMotion(page);
    await serveLive(page, [() => movingLive({startMs, nowMs: Date.now()})]);
    // Each frame is the site itself; the fixture routes above apply to every frame's requests.
    await page.setContent(`<body style="margin:0;display:flex;height:100vh">${Array.from({length: frames}, () =>
      `<iframe src="http://127.0.0.1:${port}/?stop=1800SJ00811" style="flex:1;border:0;height:100%"></iframe>`).join('')}</body>`);
    const readings = [];
    for (let i = 0; i < frames; i++) {
      const f = page.frames()[i + 1];
      await f.locator('.vector-map[data-map-state="painted"]').waitFor({timeout: 90_000});
      await f.getByRole('button', {name: /Ride along/}).first().click();
      await f.locator('.vector-map[data-ride="following"]').waitFor({timeout: 20_000});
    }
    await page.waitForTimeout(12_000);
    for (let i = 0; i < frames; i++) {
      const f = page.frames()[i + 1];
      readings.push({frameMs: Number(await f.locator('.vector-map').getAttribute('data-frame-ms')), fleet: await f.locator('.vector-map').getAttribute('data-fleet'),
        ride: await f.locator('.vector-map').getAttribute('data-ride')});
    }
    await ctx.close();
    return readings;
  };
  const one = await measure(1, {width: 1280, height: 900});
  const two = await measure(2, {width: 1280, height: 900});
  const phoneOne = await measure(1, {width: 390, height: 844});
  const phoneTwo = await measure(2, {width: 390, height: 844});
  console.log(JSON.stringify({desktop: {one, two}, phoneWidth: {one: phoneOne, twoStacked: phoneTwo}}, null, 1));
  await browser.close();
} finally { server.kill(); }
