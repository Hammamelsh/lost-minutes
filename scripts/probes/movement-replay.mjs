/**
 * Play a recorded run of publications back through the built page, and trace what it draws.
 *
 *   node scripts/probes/movement-replay.mjs --reel data/evaluation/reel-A.json \
 *     --vehicle MF74NNL --label a-before [--phone] [--ride] [--speed 4]
 *
 * The reel is served as `live.json`, one publication at a time, with every timestamp moved onto
 * the current clock so the page treats the reports as it treated them on the day. Inside the
 * page a MutationObserver records the map's own diagnostics on every frame it draws — the drawn
 * position, the estimate's mode and reason, the report age, the last correction — and the camera
 * centre beside them. Nothing is sampled from outside, so no frame is missed and none is counted
 * twice.
 *
 * What it reports is deliberately separated, because one average hides all of it:
 *   - the step the drawn bus takes between consecutive frames (a teleport is one big step);
 *   - how long it stands still;
 *   - how far behind the newest report it is drawn (visual lag);
 *   - every moment the drawing was restarted rather than continued.
 * `--speed` runs the reel faster than life; the page's own clock is moved with it, so the
 * reports keep their spacing. Software-rendered unless this machine has a GPU.
 */
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {arg, launch, outDir, root, site} from './common.mjs';

const has = k => process.argv.includes('--' + k);
const reelPath = arg('reel', 'data/evaluation/reel.json');
const wanted = arg('vehicle', null);
const label = arg('label', 'replay');
const speed = Number(arg('speed', 1));
const maxPubs = Number(arg('publications', 0));
const phone = has('phone');
const out = outDir('movement', label);
const reel = JSON.parse(await (await import('node:fs/promises'))
  .readFile(reelPath.startsWith('/') ? reelPath : join(root, reelPath), 'utf8'));

let publications = reel.publications;
if (wanted) publications = publications.filter(p => p.live.vehicles?.some(v => v.vehicle === wanted));
if (maxPubs) publications = publications.slice(0, maxPubs);
if (!publications.length) { console.error('no publications carry that vehicle'); process.exit(1); }

const base0 = publications[0].receivedAtMs;
const metres = (a, b) => Math.hypot((b[0] - a[0]) * 111195, (b[1] - a[1]) * 111195 * Math.cos(a[0] * Math.PI / 180));
const pct = (xs, q) => {if (!xs.length) return null; const s = [...xs].sort((x, y) => x - y);
 const i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo)};

/** The reel's timestamps moved onto this run's clock, so the page sees the reports as fresh. */
function rebase(entry, startedAtMs) {
  const shift = startedAtMs - base0;
  const live = structuredClone(entry.live);
  const at = ms => Math.round(shift + (ms - base0) / speed + base0 - base0 + base0) ;
  const move = ms => Math.round(startedAtMs + (ms - base0) / speed);
  live.publishedAtMs = move(Date.parse(live.publishedAt));
  live.publishedAt = new Date(live.publishedAtMs).toISOString();
  for (const v of live.vehicles ?? []) {
    v.observedAtMs = move(v.observedAtMs);
    v.recordedAt = new Date(v.observedAtMs).toISOString().replace('.000Z', '+00:00');
    if (v.retrievedAtMs) v.retrievedAtMs = move(v.retrievedAtMs);
    v.ageSeconds = Math.round(((live.publishedAtMs - v.observedAtMs) / 1000) * 10) / 10;
    // The trail carries ages, not times: they compress with the reel.
    if (Array.isArray(v.trail)) v.trail = v.trail.map(t => [Math.round(t[0] / speed), ...t.slice(1)]);
  }
  void at;
  return live;
}

const {base, stop} = await site();
const browser = await launch();
const size = phone ? {width: 390, height: 844} : {width: 1280, height: 860};
const context = await browser.newContext({viewport: size, isMobile: phone, hasTouch: phone,
  timezoneId: 'Europe/London', serviceWorkers: 'block', recordVideo: {dir: out, size}});
const page = await context.newPage();

const startedAtMs = Date.now();
const served = [];
await page.route('**/data/config.json*', r => r.fulfill({json: {schemaVersion: 1, liveUrl: '/data/live.json',
  replayUrl: '/data/replay.json', operationsUrl: '/data/operations.json', pollSeconds: 5}}));
await page.route('**/data/live.json*', r => {
  const elapsed = (Date.now() - startedAtMs) * speed;
  let i = 0;
  while (i + 1 < publications.length && publications[i + 1].receivedAtMs - base0 <= elapsed) i += 1;
  const body = rebase(publications[i], startedAtMs);
  served.push({index: i, at: Date.now() - startedAtMs, publishedAt: body.publishedAt});
  return r.fulfill({json: body, headers: {date: new Date().toUTCString()}});
});

const first = publications[0].live.vehicles.find(v => !wanted || v.vehicle === wanted);
// The link pins the vehicle on the journey it was on when the reel starts, exactly as a shared
// link or a restored journey does: operator|vehicle|route|direction|journeyRef.
const pin = arg('pin', `${first.operator}|${first.vehicle}|${first.route}|${first.direction}|${first.journeyRef}`);
const stopId = arg('stop', null);
const link = `${base}?${stopId ? `stop=${stopId}&` : ''}bus=${encodeURIComponent(pin)}`;
await page.goto(link, {waitUntil: 'load'});
await page.waitForTimeout(4000);

// Every frame the map draws, recorded inside the page: nothing is sampled across the wire.
await page.evaluate(() => {
  const el = document.querySelector('.vector-map');
  if (!el) return;
  window.__trace = [];
  const read = () => {
    const d = el.getAttribute('data-display');
    window.__trace.push({t: performance.now(), display: d, motion: el.getAttribute('data-motion'),
      reason: el.getAttribute('data-motion-reason'), age: el.getAttribute('data-report-age'),
      correction: el.getAttribute('data-correction'), camera: el.getAttribute('data-camera'),
      ride: el.getAttribute('data-ride'), screen: el.getAttribute('data-bus-screen')});
  };
  read();
  new MutationObserver(read).observe(el, {attributes: true, attributeFilter: ['data-display']});
});

if (has('ride')) {
  await page.getByRole('button', {name: /Ride along/i}).first().click({timeout: 8000}).catch(() => {});
  await page.waitForTimeout(2000);
}

// One disturbance, halfway through, so its effect on the drawing can be seen against the same
// reports either side of it: the conditions a passenger actually creates.
const disturb = arg('disturb', null), disturbFor = Number(arg('disturb-seconds', 60));
const events = [];
async function disturbance() {
  const at = Date.now() - startedAtMs;
  if (disturb === 'background') {
    // Really backgrounded: another tab in front stops this one's animation frames, which
    // dispatching an event by hand does not.
    const other = await context.newPage();
    await other.goto('about:blank');
    await other.bringToFront();
    await new Promise(r => setTimeout(r, disturbFor * 1000));
    await page.bringToFront();
    await other.close();
  } else if (disturb === 'resize') {
    await page.setViewportSize({width: size.width, height: Math.round(size.height * 0.6)});
    await new Promise(r => setTimeout(r, 4000));
    await page.setViewportSize(size);
  } else if (disturb === 'sheet') {
    await page.locator('.sheet-toggle').first().click({timeout: 5000}).catch(() => {});
    await new Promise(r => setTimeout(r, 4000));
    await page.locator('.sheet-toggle').first().click({timeout: 5000}).catch(() => {});
  } else if (disturb === 'panel') {
    await page.getByRole('link', {name: /Behind the data/i}).first().click({timeout: 5000}).catch(() => {});
    await new Promise(r => setTimeout(r, disturbFor * 1000));
    await page.getByRole('button', {name: /Back to buses/i}).first().click({timeout: 5000}).catch(() => {});
  }
  events.push({kind: disturb, atMs: at, forSeconds: disturbFor});
}

const seconds = Number(arg('seconds', Math.min(240, (publications.at(-1).receivedAtMs - base0) / 1000 / speed)));
const steps = Math.ceil(seconds / 10);
for (let k = 0; k < steps; k++) {
  await page.waitForTimeout(10_000);
  if (k === Math.floor(steps / 2)) {
    await page.screenshot({path: join(out, 'middle.png')}).catch(() => {});
    if (disturb) await disturbance();
  }
}
await page.screenshot({path: join(out, 'end.png')}).catch(() => {});

const trace = await page.evaluate(() => window.__trace ?? []);
const frames = trace.filter(f => f.display).map(f => {
  const [lat, lon, s, bearing, presentation, wall] = f.display.split(',');
  return {...f, lat: +lat, lon: +lon, s: s === '' ? null : +s, bearing: bearing === '' ? null : +bearing,
    presentation: +presentation, wall: +wall};
});

const stepsM = [], pauses = [];
let standingSince = null;
for (let i = 1; i < frames.length; i++) {
  const d = metres([frames[i - 1].lat, frames[i - 1].lon], [frames[i].lat, frames[i].lon]);
  const dt = frames[i].t - frames[i - 1].t;
  stepsM.push({d, dt, at: frames[i].t, motion: frames[i].motion, correction: frames[i].correction});
  if (d < 0.05) { standingSince ??= frames[i - 1].t; }
  else if (standingSince !== null) { pauses.push((frames[i].t - standingSince) / 1000); standingSince = null; }
}
if (standingSince !== null && frames.length) pauses.push((frames.at(-1).t - standingSince) / 1000);

const restarts = [];
for (let i = 1; i < frames.length; i++)
  if (frames[i].correction !== frames[i - 1].correction && /snap/.test(frames[i].correction ?? ''))
    restarts.push({at: frames[i].t, correction: frames[i].correction, motion: frames[i].motion});

const big = stepsM.filter(s => s.d > 25).sort((a, b) => b.d - a.d).slice(0, 12);
const summary = {
  label, reel: reelPath, vehicle: wanted, phone, speed, ride: has('ride'),
  publicationsServed: served.length, distinctPublications: new Set(served.map(s => s.index)).size,
  frames: frames.length, seconds: frames.length ? (frames.at(-1).t - frames[0].t) / 1000 : 0,
  modes: Object.fromEntries(Object.entries(frames.reduce((a, f) => (a[f.motion ?? '?'] = (a[f.motion ?? '?'] ?? 0) + 1, a), {}))),
  reasons: [...new Set(frames.map(f => f.reason).filter(Boolean))],
  step: {median: pct(stepsM.map(s => s.d), 0.5), p95: pct(stepsM.map(s => s.d), 0.95),
    p999: pct(stepsM.map(s => s.d), 0.999), max: Math.max(0, ...stepsM.map(s => s.d)),
    over10m: stepsM.filter(s => s.d > 10).length, over25m: stepsM.filter(s => s.d > 25).length,
    over100m: stepsM.filter(s => s.d > 100).length},
  movingFrames: stepsM.filter(s => s.d > 0.05).length,
  longestPauseSeconds: Math.max(0, ...pauses), pausesOver5s: pauses.filter(p => p > 5).length,
  snaps: restarts, biggestSteps: big, events,
};
writeFileSync(join(out, 'trace.json'), JSON.stringify({summary, served, frames}, null, 1));
console.log(JSON.stringify(summary, null, 1));
await context.close(); await browser.close(); stop();
