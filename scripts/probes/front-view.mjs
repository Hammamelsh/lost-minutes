// FIXTURE probe of the ride-along's front view, for comparing one build with another on the same
// stretch of road, theme and viewport. FX-MOVING runs at 7 m/s along the fixture road (the real
// recorded route-256 shape) with estimated movement on. The recording covers a straight, the first
// clear turn on the shape, and then a report correction (its reports jump 40 m back). It keeps:
// - a frame every second;
// - the map's camera and drawn position every 100 ms, with the road distance of each;
// - the ride card's words (report age and estimated-or-reported);
// - a video, and a contact sheet of every third frame.
// Continuity is measured from the camera samples: the eye's step and the heading's turn rate and
// acceleration, sample by sample.
//
// node scripts/probes/front-view.mjs [--label name] [--theme night|day] [--viewport desktop|phone|both]
//   [--seconds 40] [--base http://localhost:3100/] [--port 4198]
// Without --base it serves out/ itself. Writes outputs/probes/front-view/<label>/<viewport>-<theme>/.
import {mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import {arg, fixtures, launch, outDir, site} from './common.mjs';

const label = arg('label', 'build'), theme = arg('theme', 'night'), seconds = Number(arg('seconds', 40));
const viewports = arg('viewport', 'both') === 'both' ? ['desktop', 'phone'] : [arg('viewport')];
const F = await fixtures();
const metres = (a, b) => Math.hypot((b.lon - a.lon) * Math.cos(a.lat * Math.PI / 180), b.lat - a.lat) * 111195;
const bearing = (a, b) => (Math.atan2((b.lon - a.lon) * Math.cos(a.lat * Math.PI / 180), b.lat - a.lat) * 180 / Math.PI + 360) % 360;
const turnOf = (x, y) => ((y - x + 540) % 360) - 180;

// The first clear turn: the heading over the next 40 m differs from the heading over the last 40 m
// by more than 35°, far enough along that the recording can begin on a straight before it.
const length = F.FIXTURE_TRACK_LENGTH;
const headingAt = s => bearing(F.alongFixture(s), F.alongFixture(Math.min(length, s + 15)));
let turnS = null;
for (let s = 960; s < length - 300 && turnS === null; s += 5)
  if (Math.abs(turnOf(headingAt(s - 40), headingAt(s + 40))) > 35) turnS = s;
if (turnS === null) throw new Error('no clear turn found on the fixture road');
// Along the road for any drawn point: the nearest of 2 m steps.
const steps = Array.from({length: Math.floor(length / 2)}, (_, i) => ({s: i * 2, ...F.alongFixture(i * 2)}));
const along = p => steps.reduce((best, q) => (metres(p, q) < best.d ? {s: q.s, d: metres(p, q)} : best), {s: 0, d: Infinity}).s;

const {base, stop} = await site();
const browser = await launch();
const summary = {turnS, theme, seconds};
try {
  for (const viewport of viewports) {
    const phone = viewport === 'phone';
    const dir = outDir('front-view', `${label}/${viewport}-${theme}`);
    mkdirSync(`${dir}/raw`, {recursive: true});
    const size = phone ? {width: 390, height: 844} : {width: 1280, height: 900};
    const ctx = await browser.newContext({...(phone ? {viewport: size, isMobile: true, hasTouch: true, deviceScaleFactor: 2}
      : {viewport: size}), colorScheme: theme === 'night' ? 'dark' : 'light', permissions: ['geolocation'],
      geolocation: {latitude: 53.4487, longitude: -2.3095, accuracy: 40}, serviceWorkers: 'block',
      recordVideo: {dir: `${dir}/raw`, size}});
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message.slice(0, 160)));
    // Timed so the recording starts about 120 m before the turn: the page takes some 12 s to get
    // to the front view, and the bus has been under way for 90 s when the page opens.
    const startMs = Date.now() - 90_000, recordFrom = Date.now() + 12_000;
    const startS = turnS - 120 - 7 * (90 + 12);
    if (startS < 0) throw new Error(`the turn at ${turnS} m is too early on the road for this timing`);
    const jump = {atMs: recordFrom + 24_000, metres: -40};
    await F.servePatterns(page);
    await F.serveMotion(page);
    await F.serveLive(page, [() => F.movingLive({startMs, startS, speed: 7, jump})]);
    await page.goto(base);
    await F.waitForPaint(page, {timeout: 60_000});
    await page.getByRole('button', {name: 'Buses near me'}).click();
    await page.locator('.nearby-stop', {hasText: 'Stop A'}).first().click();
    await page.locator('article.bus-card[data-vehicle="FX-MOVING"]').waitFor({timeout: 20_000});
    await page.locator('.vector-map').evaluate(el => el.scrollIntoView({block: 'start'}));
    await page.getByRole('button', {name: 'Ride along with route 256'}).click();
    await page.locator('.vector-map[data-ride="following"]').waitFor({timeout: 20_000});
    await page.getByRole('button', {name: 'Front view'}).click();
    await page.locator('.vector-map[data-ride-camera="front"]').waitFor({timeout: 10_000});
    await page.waitForTimeout(Math.max(0, recordFrom - Date.now()));
    const t0 = Date.now(), samples = [], frames = [];
    let nextFrame = 0;
    while (Date.now() - t0 < seconds * 1000) {
      const read = await page.evaluate(() => {
        const m = document.querySelector('.vector-map');
        return {camera: m?.getAttribute('data-camera'), display: m?.getAttribute('data-display'),
          ride: m?.getAttribute('data-ride'), rideCamera: m?.getAttribute('data-ride-camera'),
          correction: m?.getAttribute('data-correction'), motion: m?.getAttribute('data-motion'),
          card: document.querySelector('.ride-card')?.innerText?.replace(/\s+/g, ' ').slice(0, 160) ?? null};
      });
      const t = (Date.now() - t0) / 1000;
      const [zoom, lat, lon, pitch, heading] = (read.camera ?? '').split(',').map(Number);
      const [dlat, dlon] = (read.display ?? '').split(',').map(Number);
      samples.push({t, zoom, lat, lon, pitch, heading, drawnS: Number.isFinite(dlat) ? along({lat: dlat, lon: dlon}) : null,
        ride: read.ride, rideCamera: read.rideCamera, correction: read.correction, motion: read.motion});
      if (t >= nextFrame) {
        const name = `${String(frames.length).padStart(2, '0')}-${t.toFixed(0)}s.png`;
        await page.screenshot({path: `${dir}/${name}`});
        frames.push({name, t, card: read.card, drawnS: samples.at(-1).drawnS});
        nextFrame += 1;
      }
      await page.waitForTimeout(100);
    }
    // Continuity, sample by sample: the eye's step, and the heading's turn rate and its change.
    const steps2 = [], rates = [], accels = [];
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1], b = samples[i], dt = b.t - a.t;
      if (!(dt > 0) || !Number.isFinite(a.lat) || !Number.isFinite(b.lat)) continue;
      steps2.push(metres(a, b));
      const rate = turnOf(a.heading, b.heading) / dt;
      if (rates.length) accels.push(Math.abs(rate - rates.at(-1)) / dt);
      rates.push(rate);
    }
    const q = (xs, p) => { const s = [...xs].sort((x, y) => x - y); return s.length ? +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(2) : null; };
    const metrics = {samples: samples.length, eyeStepP50: q(steps2, 0.5), eyeStepP95: q(steps2, 0.95), eyeStepMax: q(steps2, 1),
      turnRateP95: q(rates.map(Math.abs), 0.95), turnAccelP95: q(accels, 0.95), turnAccelMax: q(accels, 1),
      pitch: [...new Set(samples.map(s => s.pitch))].slice(0, 4), zoom: [...new Set(samples.map(s => s.zoom))].slice(0, 4),
      leftFront: samples.some(s => s.rideCamera !== 'front'), rideStates: [...new Set(samples.map(s => s.ride))],
      corrections: [...new Set(samples.map(s => s.correction).filter(Boolean))], drawnFrom: samples[0]?.drawnS, drawnTo: samples.at(-1)?.drawnS};
    writeFileSync(`${dir}/samples.json`, JSON.stringify({turnS, jump: {afterSeconds: 24, metres: -40}, errors, metrics, frames, samples}, null, 1));
    summary[viewport] = {errors, metrics, cards: [frames[0]?.card, frames.at(-1)?.card]};
    const video = page.video();
    await ctx.close();
    if (video) renameSync(await video.path(), `${dir}/ride.webm`);
    // A contact sheet of every third frame, each captioned with its time and road distance.
    const chosen = frames.filter((_, i) => i % 3 === 0);
    const sheet = await browser.newPage({viewport: {width: 1600, height: 1000}});
    await sheet.setContent(`<body style="margin:0;background:#111;display:grid;grid-template-columns:repeat(${phone ? 7 : 4},1fr);gap:6px">`
      + chosen.map(f => `<figure style="margin:0;color:#ddd;font:13px sans-serif"><img src="data:image/png;base64,${readFileSync(`${dir}/${f.name}`).toString('base64')}" style="width:100%">`
        + `<figcaption>${f.t.toFixed(0)} s · ${f.drawnS ?? '?'} m${f.drawnS !== null && Math.abs(f.drawnS - turnS) < 40 ? ' · turn' : ''}</figcaption></figure>`).join('') + '</body>');
    await sheet.waitForTimeout(500);
    await sheet.screenshot({path: `${dir}/sheet.png`, fullPage: true});
    await sheet.close();
  }
} finally {
  await browser.close();
  stop();
}
console.log(JSON.stringify(summary, null, 1));
