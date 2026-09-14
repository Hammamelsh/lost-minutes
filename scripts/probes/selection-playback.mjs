// FIXTURE playback of the selection regression scenario (tests/browser/selection.spec.mjs), recorded
// as video and as a frame per phase, for review as a sequence: the bus shown, Ride along started on
// it, publications alternating between two buses, the ridden bus missing, back, and on another
// journey, then leaving the ride. Desktop by day and phone by night. For each phase: the frame, the
// map's own diagnostics (which bus it draws, the selection state, the camera) and the ride card's
// and the active-bus strip's words; then a contact sheet of the frames.
//
// node scripts/probes/selection-playback.mjs [--label name] [--base http://localhost:3100/]
// Without --base it serves out/ itself. Writes outputs/probes/selection-playback/<label>/.
import {mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import {arg, fixtures, launch, outDir, site} from './common.mjs';

const label = arg('label', 'built');
const F = await fixtures();
const EVIDENCE = {serviceDay: '2026-09-13', weekday: 'Sunday', operatorChecked: true, directionReported: true,
  operatingDayChecked: true, plausiblePaths: 1, resolvedBy: 'position'};
const ALPHA = {id: 'FX-ALPHA', lat: F.FX.main[3][1] + 0.0001, lon: F.FX.main[3][2], destination: 'Piccadilly_Gardens'};
const BRAVO = {id: 'FX-BRAVO', lat: F.FX.main[2][1] + 0.0001, lon: F.FX.main[2][2], destination: 'Manchester_Piccadilly'};
function pair({newer = 'ALPHA', alphaGone = false, alphaJourney = null} = {}) {
  const live = F.journeyLive({omit: ['FX-COMING', 'FX-SHARED', 'FX-PASSED']});
  const vehicle = (bus, age, journey = null) => {
    const observedAtMs = live.publishedAtMs - age * 1000;
    return {operator: 'BNML', vehicle: bus.id, route: '256', direction: 'inbound', journeyRef: journey ?? `${bus.id}-J1`,
      destination: journey ? 'Stretford_Mall' : bus.destination, origin: 'Fixture', observedAtMs,
      recordedAt: new Date(observedAtMs).toISOString().replace('.000Z', '+00:00'), lat: bus.lat, lon: bus.lon,
      ageSeconds: age, freshness: 'fresh', positionKind: 'observed', sourceHash: 'e'.repeat(64), bearing: 135,
      bearingStatus: 'reported', aimedDeparture: null,
      match: {patternId: 'FX:256:main', patternIndex: 3, nearestStop: F.FX.main[3][0], metresAlongPattern: F.FX.metres[3],
        metresFromPatternStop: 12, patternDirection: 'inbound', patternDestination: 'Piccadilly Gardens', evidence: EVIDENCE}};
  };
  live.vehicles = [...(alphaGone ? [] : [vehicle(ALPHA, newer === 'ALPHA' ? 6 : 26, alphaJourney)]),
    vehicle(BRAVO, newer === 'BRAVO' ? 6 : 26), ...live.vehicles];
  return live;
}
const PHASES = [
  ['shown', () => pair({newer: 'ALPHA'})], ['bravo newer', () => pair({newer: 'BRAVO'})],
  ['alpha newer', () => pair({newer: 'ALPHA'})], ['bravo newer', () => pair({newer: 'BRAVO'})],
  ['alpha missing', () => pair({newer: 'BRAVO', alphaGone: true})], ['alpha back', () => pair({newer: 'BRAVO'})],
  ['alpha new journey', () => pair({newer: 'BRAVO', alphaJourney: 'FX-ALPHA-J2'})]];
const metres = (a, b) => Math.hypot((b.lon - a.lon) * Math.cos(a.lat * Math.PI / 180), b.lat - a.lat) * 111195;
const frame = (dir, index, name) => `${dir}/${String(index).padStart(2, '0')}-${name.replaceAll(' ', '-')}.png`;

const {base, stop} = await site();
const browser = await launch();
const summary = {};
try {
  for (const variant of ['desktop-day', 'phone-night']) {
    const phone = variant.startsWith('phone'), dir = outDir('selection-playback', `${label}/${variant}`);
    mkdirSync(`${dir}/raw`, {recursive: true});
    const size = phone ? {width: 390, height: 844} : {width: 1280, height: 900};
    const ctx = await browser.newContext({...(phone ? {viewport: size, isMobile: true, hasTouch: true, deviceScaleFactor: 2}
      : {viewport: size}), colorScheme: phone ? 'dark' : 'light', permissions: ['geolocation'],
      geolocation: {latitude: 53.4487, longitude: -2.3095, accuracy: 40}, serviceWorkers: 'block',
      recordVideo: {dir: `${dir}/raw`, size}});
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message.slice(0, 160)));
    const feed = {phase: 0};
    await F.servePatterns(page);
    await F.serveLive(page, [() => PHASES[feed.phase][1]()]);
    await page.goto(base);
    await F.waitForPaint(page, {timeout: 60_000});
    // The page follows the system's dark preference; switch only if it opened by day.
    const toNight = page.getByRole('button', {name: 'Switch to the night map'});
    if (phone && await toNight.count()) await toNight.click();
    await page.getByRole('button', {name: 'Buses near me'}).click();
    await page.locator('.nearby-stop', {hasText: 'Stop A'}).first().click();
    await page.locator('article.bus-card[data-vehicle="FX-ALPHA"]').waitFor({timeout: 20_000});
    const rows = [];
    const record = async (name, index) => {
      const read = await page.evaluate(() => {
        const map = document.querySelector('.vector-map');
        return {selected: map?.getAttribute('data-selected-key'), selection: map?.getAttribute('data-selection'),
          ride: map?.getAttribute('data-ride'), camera: map?.getAttribute('data-camera'), display: map?.getAttribute('data-display'),
          card: document.querySelector('article.bus-card')?.getAttribute('data-vehicle'),
          rideCard: document.querySelector('.ride-card')?.textContent?.slice(0, 140) ?? null,
          strip: document.querySelector('.active-bus')?.textContent?.slice(0, 120) ?? null};
      });
      const [, lat, lon] = (read.camera ?? '0,0,0').split(',').map(Number);
      rows.push({index, name, ...read, cameraToAlpha: Math.round(metres({lat, lon}, ALPHA)), cameraToBravo: Math.round(metres({lat, lon}, BRAVO))});
      await page.screenshot({path: frame(dir, index, name)});
    };
    await record('suggested', 0);
    await page.locator('.vector-map').evaluate(el => el.scrollIntoView({block: 'start'}));
    await page.getByRole('button', {name: 'Ride along with route 256'}).click();
    await page.locator('.vector-map[data-ride="following"]').waitFor({timeout: 15_000});
    await page.waitForTimeout(1200);
    await record('riding', 1);
    for (let k = 1; k < PHASES.length; k++) {
      feed.phase = k;
      const response = page.waitForResponse(r => r.url().includes('/data/live.json'));
      await page.getByRole('button', {name: 'Check for newer positions'}).click();
      await response;
      // The refresh button is at the top of the page; bring the ridden map back into view.
      await page.locator('.vector-map').evaluate(el => el.scrollIntoView({block: 'start'}));
      await page.waitForTimeout(1800);
      await record(PHASES[k][0], k + 1);
    }
    await page.getByRole('button', {name: 'Exit ride-along'}).click();
    await page.waitForTimeout(1200);
    await record('left the ride', PHASES.length + 1);
    writeFileSync(`${dir}/phases.json`, JSON.stringify({errors, rows}, null, 1));
    summary[variant] = {errors, rows: rows.map(r => `${r.index} ${r.name}: map ${r.selected} (${r.selection}), card ${r.card}, `
      + `camera ${r.cameraToAlpha} m from ALPHA, ${r.cameraToBravo} m from BRAVO`)};
    const video = page.video();
    await ctx.close();
    if (video) renameSync(await video.path(), `${dir}/playback.webm`);
  }
  // Contact sheets: every phase's frame in order.
  for (const variant of ['desktop-day', 'phone-night']) {
    const dir = outDir('selection-playback', `${label}/${variant}`);
    const files = JSON.parse(readFileSync(`${dir}/phases.json`, 'utf8')).rows.map(r => frame(dir, r.index, r.name));
    const page = await browser.newPage({viewport: {width: 1600, height: 1000}});
    const images = files.map(f => `data:image/png;base64,${readFileSync(f).toString('base64')}`);
    await page.setContent(`<body style="margin:0;background:#111;display:grid;grid-template-columns:repeat(${variant.startsWith('phone') ? 5 : 3},1fr);gap:6px">`
      + images.map((src, i) => `<figure style="margin:0;color:#ddd;font:14px sans-serif"><img src="${src}" style="width:100%"><figcaption>${i}: ${files[i].split('/').pop()}</figcaption></figure>`).join('') + '</body>');
    await page.waitForTimeout(500);
    await page.screenshot({path: `${dir}/sheet.png`, fullPage: true});
    await page.close();
  }
} finally {
  await browser.close();
  stop();
}
console.log(JSON.stringify(summary, null, 1));
