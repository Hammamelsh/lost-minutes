// The outside ride-along and the street preview on one drawn bus. Switching between them must not
// restart the estimate, reset the report age, change the bus or make the drawn bus jump, and the
// street preview's camera must move whenever the drawn bus moves (its own outside is hidden there,
// so a still camera is a frozen picture). Samples every 100 ms through four phases: outside, street
// preview, outside, street preview. FIXTURE by default: an estimated bus moving on route 256's
// checked road. With --real, the first bus coming to --stop on the page at --base.
//
//   node scripts/probes/camera-switch.mjs [--label name] [--viewport 390x844] [--seconds 8]
//   node scripts/probes/camera-switch.mjs --real --base https://… [--stop "Marston Road"] [--indicator nr]
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {arg, fixtures, launch, outDir, site} from './common.mjs';

const real = process.argv.includes('--real');
const out = outDir('camera-switch', arg('label', real ? 'real' : 'fixture'));
const [width, height] = arg('viewport', '390x844').split('x').map(Number);
const seconds = Number(arg('seconds', 8));
const {servePatterns, serveMotion, serveLive, movingLive, waitForPaint} = await fixtures();
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const metres = (a, b) => {
  const k = Math.PI / 180, x = (b.lon - a.lon) * k * Math.cos((a.lat + b.lat) / 2 * k), y = (b.lat - a.lat) * k;
  return Math.hypot(x, y) * 6_371_000;
};

const browser = await launch();
const served = real ? {base: arg('base'), stop: () => {}} : await site();
const ctx = await browser.newContext({viewport: {width, height}, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  permissions: ['geolocation'], geolocation: {latitude: 53.4487, longitude: -2.3095, accuracy: 40},
  serviceWorkers: real ? 'allow' : 'block'});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message.slice(0, 160)));
if (!real) {
  await servePatterns(page);
  await serveMotion(page);
  const startMs = Date.now() - 90_000;
  await serveLive(page, [() => movingLive({startMs, startS: 150, speed: 7})]);
}
await page.goto(served.base);
await waitForPaint(page, {timeout: 60_000});
if (real) {
  await page.getByRole('combobox', {name: 'Bus number, stop or area'}).fill(arg('stop', 'Marston Road').toLowerCase());
  await page.getByRole('option', {name: new RegExp(`${arg('stop', 'Marston Road')}.*\\b${arg('indicator', 'nr')}\\b`, 'i')}).first().click();
  const coming = page.getByRole('region', {name: 'Buses coming to your stop'}).locator('.follow-row');
  await coming.first().waitFor({timeout: 30_000});
  await coming.first().click();
} else {
  await page.getByRole('button', {name: 'Buses near me'}).click();
  await page.locator('.nearby-stop', {hasText: 'Stop A'}).first().click();
  await page.getByRole('region', {name: 'Buses coming to your stop'}).locator('.follow-row').first().click();
}
await page.locator('.vector-map').evaluate(el => el.scrollIntoView({block: 'start'}));
await page.getByRole('button', {name: /^Ride along with route/}).click();
await page.waitForFunction(() => document.querySelector('.vector-map')?.getAttribute('data-ride') === 'following', null, {timeout: 20_000});
await wait(2000);

const samples = [];
const sample = phase => page.evaluate(phase => {
  const m = document.querySelector('.vector-map'), card = document.querySelector('article.bus-card');
  const [lat, lon, s] = (m.getAttribute('data-display') || ',,').split(',');
  const [zoom, clat, clon, pitch, bearing] = (m.getAttribute('data-camera') || '0,0,0,0,0').split(',').map(Number);
  return {t: performance.now(), phase, s: s === '' ? null : Number(s), drawn: {lat: Number(lat), lon: Number(lon)},
    camera: {lat: clat, lon: clon, zoom, pitch, bearing}, reportAge: Number(m.getAttribute('data-report-age') || NaN),
    motion: m.getAttribute('data-motion'), correction: m.getAttribute('data-correction'), ride: m.getAttribute('data-ride'),
    rideCamera: m.getAttribute('data-ride-camera'), vehicle: card?.getAttribute('data-vehicle')};
}, phase);
async function phase(name) {
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until) { samples.push(await sample(name)); await wait(100); }
}
await phase('outside-1');
await page.getByRole('button', {name: 'Front view'}).click();
await phase('front-1');
await page.getByRole('button', {name: 'Outside view'}).click();
await phase('outside-2');
await page.getByRole('button', {name: 'Front view'}).click();
await phase('front-2');
await page.screenshot({path: join(out, 'end-street-preview.png')});
await browser.close();
served.stop();

// Per phase: how far the drawn bus went, how far the camera went, and how often the camera stood
// still while the bus moved (after the first 1.5 s of a phase, which is the camera's own settling).
const phases = {};
for (const name of ['outside-1', 'front-1', 'outside-2', 'front-2']) {
  const list = samples.filter(x => x.phase === name);
  const settled = list.filter(x => x.t - list[0].t > 1500);
  let busMoved = 0, cameraMoved = 0, frozen = 0, moving = 0;
  for (let i = 1; i < settled.length; i++) {
    const a = settled[i - 1], b = settled[i];
    const bus = a.s !== null && b.s !== null ? Math.abs(b.s - a.s) : metres(a.drawn, b.drawn);
    const cam = metres(a.camera, b.camera);
    busMoved += bus; cameraMoved += cam;
    if (bus > 0.3) { moving++; if (cam < 0.05) frozen++; }
  }
  phases[name] = {samples: list.length, busMetres: Number(busMoved.toFixed(1)), cameraMetres: Number(cameraMoved.toFixed(1)),
    samplesWithBusMoving: moving, ofThoseCameraStill: frozen, rides: [...new Set(list.map(x => x.ride))],
    cameras: [...new Set(list.map(x => x.rideCamera))], motion: [...new Set(list.map(x => x.motion))],
    pitch: [...new Set(list.map(x => Math.round(x.camera.pitch)))]};
}
// At each switch: the last sample before and the first after.
const switches = [];
for (let i = 1; i < samples.length; i++) if (samples[i].phase !== samples[i - 1].phase) {
  const a = samples[i - 1], b = samples[i];
  switches.push({from: a.phase, to: b.phase, drawnStep: a.s !== null && b.s !== null ? Number((b.s - a.s).toFixed(2)) : null,
    drawnStepMetres: Number(metres(a.drawn, b.drawn).toFixed(2)), reportAgeBefore: a.reportAge, reportAgeAfter: b.reportAge,
    sameVehicle: a.vehicle === b.vehicle, vehicle: b.vehicle});
}
const vehicles = [...new Set(samples.map(x => x.vehicle))];
const report = {real, viewport: `${width}x${height}`, seconds, vehicles, phases, switches, errors};
writeFileSync(join(out, 'report.json'), JSON.stringify({...report, samples}, null, 1));
console.log(JSON.stringify(report, null, 1));
