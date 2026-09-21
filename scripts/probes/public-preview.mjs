// The public preview, reached as a phone would reach it, in this machine's Chromium (emulation, not
// a physical phone):
//   REAL    the page as served at --base, with the service worker allowed: the page, MapLibre's
//           worker, map tiles and runtime configuration load; the service worker registers and takes
//           control; location is permitted by the page's headers; a stop's services and buses as the
//           page words them; a chosen bus kept while real publications arrive, with no rebuild; the
//           outside ride-along and, where the bus has a checked road, the street preview, each with a
//           synthesized two-finger pinch.
//   FIXTURE the same page and server with its data answered by the test fixtures (the service worker
//           blocked so the routes apply), for layouts that need a particular bus: the first screen, a
//           bigger map, the outside ride-along and the street preview at 360 and 390 px portrait.
// Every screen lists controls over the map that overlap one another, leave the map, or cut their
// own text off, and whether the page scrolls sideways.
//
//   node scripts/probes/public-preview.mjs --base https://….trycloudflare.com [--label name]
//        [--stop "Marston Road"] [--indicator nr]
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {arg, fixtures, launch, outDir} from './common.mjs';

const base = arg('base');
if (!base) { console.error('--base https://… is required'); process.exit(2); }
const out = outDir('public-preview', arg('label', 'latest'));
const stopName = arg('stop', 'Marston Road'), indicator = arg('indicator', 'nr');
const {servePatterns, serveMotion, serveLive, movingLive, waitForPaint} = await fixtures();

const NEAR_STOP = {latitude: 53.4503, longitude: -2.2945, accuracy: 30};
const LONGFORD_PARK = {latitude: 53.4487, longitude: -2.3095, accuracy: 40};
const PHONES = {360: {width: 360, height: 800}, 390: {width: 390, height: 844}};
const report = {base, when: new Date().toISOString(), real: {}, layouts: [], errors: []};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const map = page => page.locator('.vector-map');
const phone = (browser, width, extra = {}) => browser.newContext({viewport: PHONES[width], deviceScaleFactor: 2,
  isMobile: true, hasTouch: true, ...extra});
const rideIs = (page, state, timeout = 20_000) => page.waitForFunction(
  s => document.querySelector('.vector-map')?.getAttribute('data-ride') === s, state, {timeout});

async function camera(page) {
  const [zoom, , , pitch] = ((await map(page).getAttribute('data-camera')) || '0,0,0,0,0').split(',').map(Number);
  return {zoom: Number(zoom.toFixed(2)), pitch: Number(pitch.toFixed(1))};
}

/** Controls and notes over the map that overlap, leave the map or cut their text; sideways scroll. */
function layoutProblems(page) {
  return page.evaluate(() => {
    const problems = [];
    if (document.documentElement.scrollWidth > innerWidth + 1)
      problems.push(`page scrolls sideways: ${document.documentElement.scrollWidth} px in ${innerWidth} px`);
    const root = document.querySelector('.vector-map');
    if (!root) return problems;
    const box = root.getBoundingClientRect();
    const shown = el => {
      const r = el.getBoundingClientRect(), s = getComputedStyle(el);
      return r.width > 1 && r.height > 1 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
    };
    const name = el => `${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className.trim()
      ? '.' + el.className.trim().split(/\s+/)[0] : ''} "${(el.getAttribute('aria-label') || el.textContent || '')
      .trim().replace(/\s+/g, ' ').slice(0, 30)}"`;
    const els = [...root.querySelectorAll('button, a, .ride-mode, .ride-card, .map-loading')].filter(shown);
    for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
      const a = els[i], b = els[j];
      if (a.contains(b) || b.contains(a)) continue;
      const r = a.getBoundingClientRect(), q = b.getBoundingClientRect();
      const w = Math.min(r.right, q.right) - Math.max(r.left, q.left), h = Math.min(r.bottom, q.bottom) - Math.max(r.top, q.top);
      if (w > 2 && h > 2) problems.push(`overlap ${Math.round(w)}×${Math.round(h)} px: ${name(a)} / ${name(b)}`);
    }
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.left < box.left - 1 || r.right > box.right + 1 || r.top < box.top - 1 || r.bottom > box.bottom + 1)
        problems.push(`outside the map: ${name(el)}`);
      if (el.tagName === 'BUTTON' && el.scrollWidth > el.clientWidth + 2) problems.push(`text cut off: ${name(el)}`);
    }
    return problems;
  });
}

async function capture(page, width, name, data) {
  const file = `${data.toLowerCase()}-${width}-${name}.png`;
  await page.screenshot({path: join(out, file)});
  const entry = {width, name, data, file, problems: await layoutProblems(page)};
  report.layouts.push(entry);
  return entry;
}

/** A two-finger pinch synthesized by Chromium's own input pipeline, over the middle of the map. */
async function pinch(page, cdp, scaleFactor = 1.5) {
  const box = await page.locator('.vector-map-canvas').boundingBox();
  const before = await camera(page);
  await cdp.send('Input.synthesizePinchGesture', {x: Math.round(box.x + box.width / 2),
    y: Math.round(box.y + box.height * 0.45), scaleFactor, relativeSpeed: 600, gestureSourceType: 'touch'});
  await wait(1500);
  return {zoomBefore: before.zoom, zoomAfter: (await camera(page)).zoom, ride: await map(page).getAttribute('data-ride')};
}

async function chooseStop(page) {
  await page.getByRole('combobox', {name: 'Bus number, stop or area'}).fill(stopName.toLowerCase());
  await page.getByRole('option', {name: new RegExp(`${stopName}.*\\b${indicator}\\b`, 'i')}).first().click();
  await page.locator('.your-stop-copy strong').waitFor();
  return page.locator('.your-stop-copy strong').innerText();
}

async function realPart(browser) {
  const r = report.real;
  const ctx = await phone(browser, 390, {permissions: ['geolocation'], geolocation: NEAR_STOP});
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const seen = {worker: null, tiles: 0, tileErrors: 0, config: 0, live: [], pageErrors: []};
  page.on('pageerror', error => seen.pageErrors.push(error.message.slice(0, 160)));
  page.on('response', async response => {
    const url = response.url();
    if (/maplibre-gl-worker\.mjs/.test(url)) seen.worker = response.status();
    if (/tiles\.openfreemap\.org\/.*\.pbf/.test(url)) { if (response.ok()) seen.tiles++; else seen.tileErrors++; }
    if (/\/data\/config\.json/.test(url) && response.ok()) seen.config++;
    if (/\/data\/live\.json/.test(url) && response.ok()) {
      try {
        const body = await response.json(), headers = await response.allHeaders();
        seen.live.push({publishedAt: body.publishedAt, at: Date.now(), viaServiceWorker: response.fromServiceWorker(),
          fromCache: headers['x-lost-minutes-from-cache'] === '1'});
      } catch { /* a response the page abandoned */ }
    }
  });
  const nav = await page.goto(base);
  r.pageStatus = nav?.status();
  await waitForPaint(page, {timeout: 60_000, note: 'public address'});
  r.serviceWorker = await page.evaluate(() => Promise.race([
    navigator.serviceWorker.ready.then(reg => ({state: reg.active?.state ?? null, scope: reg.scope})),
    new Promise(resolve => setTimeout(() => resolve({state: 'not ready after 20 s'}), 20_000))]));
  await page.reload();
  await waitForPaint(page, {timeout: 60_000, note: 'after reload, under the service worker'});
  r.serviceWorker.controlsPage = await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null);
  r.location = await page.evaluate(async () => ({
    secureContext: isSecureContext,
    policyAllows: document.featurePolicy ? document.featurePolicy.allowsFeature('geolocation') : 'not reported',
    permission: (await navigator.permissions.query({name: 'geolocation'})).state,
    position: await new Promise(resolve => navigator.geolocation.getCurrentPosition(() => resolve('obtained'),
      error => resolve(`refused: ${error.message}`), {timeout: 10_000})),
  }));

  r.stop = await chooseStop(page);
  await page.evaluate(() => scrollTo(0, 0));
  await wait(1500);
  r.services = (await page.getByRole('region', {name: 'Services from your stop'}).innerText().catch(() => ''))
    .replace(/\s+/g, ' ').trim();
  const coming = page.getByRole('region', {name: 'Buses coming to your stop'}).locator('.follow-row');
  r.comingToStop = (await coming.allInnerTexts()).map(t => t.replace(/\s+/g, ' ').trim());
  if (!r.comingToStop.length) r.noBusMessage = await page.locator('.follow-empty').first().innerText().catch(() => null);
  await capture(page, 390, 'first-screen-stop', 'REAL');

  // Choose a bus: the first one coming to the stop, or, with none, the one the page suggests.
  if (r.comingToStop.length) await coming.first().click();
  else { await page.getByRole('button', {name: 'Change'}).click(); }
  const card = page.locator('article.bus-card');
  await card.waitFor();
  await page.locator('.follow-toggle').first().click();
  const pinnedAt = Date.now();
  r.chosen = {vehicle: await card.getAttribute('data-vehicle'), selection: await card.getAttribute('data-selection'),
    route: (await card.locator('.route-badge').first().innerText()).trim(),
    words: (await card.innerText()).replace(/\s+/g, ' ').slice(0, 160)};
  const current = seen.live.length ? seen.live[seen.live.length - 1].publishedAt : null;
  const newer = new Set(), samples = [];
  for (const deadline = Date.now() + 180_000; Date.now() < deadline && newer.size < 2;) {
    await wait(3000);
    for (const l of seen.live) if (l.at > pinnedAt && l.publishedAt !== current) newer.add(l.publishedAt);
    samples.push(`${await card.getAttribute('data-vehicle')}/${await card.getAttribute('data-selection')}`);
  }
  r.publications = {atChoice: current, newer: [...newer], viaServiceWorker: seen.live.filter(l => l.at > pinnedAt).every(l => l.viaServiceWorker),
    anyFromDeviceCache: seen.live.some(l => l.fromCache)};
  r.keptThroughout = samples.every(s => s === `${r.chosen.vehicle}/${samples[0].split('/')[1]}`) ? 'yes' : `no: ${[...new Set(samples)].join(', ')}`;
  r.selectionStates = [...new Set(samples.map(s => s.split('/')[1]))];

  // The outside ride-along with that bus, a pinch in it, and the street preview where offered.
  await map(page).evaluate(el => el.scrollIntoView({block: 'start'}));
  await page.getByRole('button', {name: /^Ride along with route/}).click();
  await rideIs(page, 'following');
  await wait(2500);
  await capture(page, 390, 'outside-ride', 'REAL');
  r.outsidePinch = await pinch(page, cdp);
  const front = page.getByRole('button', {name: 'Front view'});
  if (await front.count() && (await front.getAttribute('aria-disabled')) !== 'true' && await front.isEnabled()) {
    await front.click();
    await page.waitForFunction(() => document.querySelector('.vector-map')?.getAttribute('data-ride-camera') === 'front');
    await rideIs(page, 'following').catch(() => {});
    await wait(2500);
    await capture(page, 390, 'street-preview', 'REAL');
    r.streetPreviewPinch = await pinch(page, cdp);
  } else r.streetPreview = 'not offered for this bus (no checked road shape)';
  r.still = {vehicle: await card.getAttribute('data-vehicle'), selection: await card.getAttribute('data-selection')};
  r.loads = {mapLibreWorker: seen.worker, tiles: seen.tiles, tileErrors: seen.tileErrors, configResponses: seen.config,
    liveResponses: seen.live.length, pageErrors: seen.pageErrors};
  await ctx.close();

  // The first screen at 360 px, real data.
  const narrow = await phone(browser, 360, {permissions: ['geolocation'], geolocation: NEAR_STOP});
  const small = await narrow.newPage();
  await small.goto(base);
  await waitForPaint(small, {timeout: 60_000, note: '360 px'});
  await chooseStop(small);
  await small.evaluate(() => scrollTo(0, 0));
  await wait(1500);
  await capture(small, 360, 'first-screen-stop', 'REAL');
  await narrow.close();
}

async function fixtureLayouts(browser, width) {
  const ctx = await phone(browser, width, {permissions: ['geolocation'], geolocation: LONGFORD_PARK, serviceWorkers: 'block'});
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await servePatterns(page);
  await serveMotion(page);
  const startMs = Date.now() - 90_000;
  await serveLive(page, [() => movingLive({startMs, startS: 150, speed: 7})]);
  await page.goto(base);
  await waitForPaint(page, {timeout: 60_000, note: `FIXTURE ${width} px`});
  await page.getByRole('button', {name: 'Buses near me'}).click();
  await page.locator('.nearby-stop', {hasText: 'Stop A'}).first().click();
  await page.locator('.bus-card .route-badge').first().waitFor();
  await page.evaluate(() => scrollTo(0, 0));
  await wait(1500);
  await capture(page, width, 'first-screen', 'FIXTURE');
  await page.getByRole('button', {name: 'Make the map bigger'}).click();
  await wait(1500);
  await capture(page, width, 'bigger-map', 'FIXTURE');
  await page.getByRole('button', {name: 'Make the map smaller'}).click();
  await wait(1000);
  await map(page).evaluate(el => el.scrollIntoView({block: 'start'}));
  await page.getByRole('button', {name: /^Ride along with route/}).click();
  await rideIs(page, 'following');
  await wait(2500);
  await capture(page, width, 'outside-ride', 'FIXTURE');
  const outsidePinch = await pinch(page, cdp);
  await rideIs(page, 'following', 8000).catch(() => {});
  await page.getByRole('button', {name: 'Front view'}).click();
  await page.waitForFunction(() => document.querySelector('.vector-map')?.getAttribute('data-ride-camera') === 'front');
  await rideIs(page, 'following');
  await wait(2500);
  await capture(page, width, 'street-preview', 'FIXTURE');
  const frontPinch = await pinch(page, cdp);
  let returned = null;
  if (frontPinch.ride === 'exploring') {
    await page.getByRole('button', {name: 'Return to bus'}).click();
    returned = await rideIs(page, 'following', 10_000).then(() => 'following again').catch(() => 'did not return');
  }
  report.layouts.push({width, name: 'pinches', data: 'FIXTURE', outsidePinch, frontPinch, afterReturnToBus: returned});
  await ctx.close();
}

const browser = await launch();
for (const [name, run] of [['real', () => realPart(browser)], ['fixture 360', () => fixtureLayouts(browser, 360)],
  ['fixture 390', () => fixtureLayouts(browser, 390)]]) {
  try { await run(); } catch (error) { report.errors.push(`${name}: ${error.message.split('\n')[0]}`); }
}
await browser.close();
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
console.log(`\nframes and report.json in ${out}`);
