// A real journey through the real rendering loop. The reports are a recorded slice of a
// held-out journey from the motion evaluation captures (BNML 256 outbound, vehicle SK74BNB,
// 13 September 2026), re-timed to the test's clock with their spacing unchanged, and served as
// the publications the collector would have written. The road shape, the timetable and the
// motion settings are the published ones in the built site. Every frame of the drawn bus is
// sampled while the reports arrive, so continuity and corrections are measured on real data,
// in the page, not only in the offline evaluation.
import {readFileSync, writeFileSync} from 'node:fs';
import {test, expect} from '@playwright/test';
import {fastConfig, waitForPaint} from './fixtures.mjs';

const RECORDED = JSON.parse(readFileSync(new URL('./recorded/reports-256-outbound-SK74BNB-3729.json', import.meta.url), 'utf8'));
const map = page => page.locator('.vector-map');
async function display(page) {
  const raw = ((await map(page).getAttribute('data-display')) || ',,,,,').split(',');
  const num = i => raw[i] === '' || raw[i] === undefined ? null : Number(raw[i]);
  const [lat, lon, s, bearing, frame, wall] = [num(0), num(1), num(2), num(3), num(4), num(5)];
  return {lat, lon, s, bearing, frame, wall, correction: await map(page).getAttribute('data-correction'),
    motion: await map(page).getAttribute('data-motion'), ride: await map(page).getAttribute('data-ride')};
}

async function serveRecorded(page) {
  const clock = {t0: null};
  const stops = await (await page.request.get('/data/stops.json')).json();
  const patterns = await (await page.request.get('/data/patterns.json')).json();
  const pattern = patterns.patterns.find(p => p.id === RECORDED.pattern);
  expect(pattern, 'the recorded pattern is in the published timetable').toBeTruthy();
  const byId = new Map(stops.stops.map(s => [s.id, s]));
  const nearest = point => {
    let best = null;
    pattern.stops.forEach((id, index) => {
      const stop = byId.get(id); if (!stop) return;
      const d = Math.hypot((stop.lon - point.lon) * Math.cos(point.lat * Math.PI / 180), stop.lat - point.lat) * 111195;
      if (!best || d < best.d) best = {id, index, d};
    });
    return best;
  };
  const reports = RECORDED.reports, lead = RECORDED.leadIn;
  // The test clock: the first live report is fetched at the moment the page first asks.
  const r0 = reports[lead].retrievedAtMs;
  const publication = () => {
    const now = Date.now();
    if (clock.t0 === null) clock.t0 = now;
    const shift = clock.t0 - r0;
    const known = reports.filter(r => r.retrievedAtMs + shift <= now);
    const latest = known[known.length - 1];
    const observedAtMs = latest.observedAtMs + shift, age = Math.max(0, (now - observedAtMs) / 1000);
    const near = nearest(latest);
    const trail = known.slice(Math.max(0, known.length - 7), -1);
    return {schemaVersion: 1, mode: 'live_bods', state: 'live',
      area: {bbox: [-2.36, 53.40, -2.16, 53.53], label: 'Manchester and Trafford'},
      publishedAt: new Date(now).toISOString(), publishedAtMs: now,
      collection: {lastRequestAt: null, lastSuccessAt: null, lastPayloadChangeAt: null, cycles: 0, succeeded: 0,
        repeatPayloads: 0, failed: 0, consecutiveFailures: 0, sharedCollector: true},
      freshness: {policy: {observationFreshSeconds: 60, observationAgeingSeconds: 150, observationExpirySeconds: 900,
        publicationStaleSeconds: 120, futureToleranceSeconds: 120, pollIntervalSeconds: 10, basis: 'replay'}, measured: null},
      withheld: {expiredPositions: 0, positionsAheadOfClock: 0, conflictingIdentities: 0, quarantinedRecords: 0, quarantineReasons: []},
      sourceQuality: {quarantineReasons: [], note: 'recorded replay'}, pipelineFailures: {cycles: [], note: 'recorded replay'},
      attribution: 'Recorded reports from the bounded collection of 13 September 2026 (Open Government Licence v3.0), re-timed for a browser check.',
      notes: ['RECORDED REPLAY: real reports of one journey, re-timed to this clock.'],
      trailSources: [...new Set(known.map(r => r.source))],
      vehicles: [{operator: RECORDED.operator, vehicle: RECORDED.vehicle, route: RECORDED.route, direction: RECORDED.direction,
        journeyRef: RECORDED.journeyRef, destination: RECORDED.destination, origin: null,
        observedAtMs, recordedAt: new Date(observedAtMs).toISOString().replace('.000Z', '+00:00'),
        lat: latest.lat, lon: latest.lon, ageSeconds: age, freshness: age <= 60 ? 'fresh' : age <= 150 ? 'ageing' : 'stale',
        positionKind: 'observed', sourceHash: latest.source, bearing: latest.bearing,
        bearingStatus: latest.bearing === null ? 'absent' : 'reported', aimedDeparture: null,
        retrievedAtMs: latest.retrievedAtMs + shift,
        trail: trail.map(r => [observedAtMs - (r.observedAtMs + shift), r.lat, r.lon, r.bearing,
          [...new Set(known.map(k => k.source))].indexOf(r.source)]),
        match: {patternId: RECORDED.pattern, patternIndex: near.index, nearestStop: near.id,
          metresAlongPattern: pattern.metres?.[near.index] ?? null, metresFromPatternStop: Math.round(near.d),
          patternDirection: pattern.direction, patternDestination: pattern.destination,
          evidence: {serviceDay: '2026-09-13', weekday: 'Sunday', operatorChecked: true, directionReported: true,
            operatingDayChecked: true, plausiblePaths: 1, resolvedBy: 'position'}}}]};
  };
  await page.route('**/data/config.json*', route => route.fulfill({json: fastConfig()}));
  await page.route('**/data/live.json*', route => route.fulfill({json: publication(), headers: {date: new Date().toUTCString()}}));
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await page.goto('/');
  await waitForPaint(page, {note: `page errors: ${errors.join(' | ') || 'none'}`});
  return {clock, reports, r0, errors};
}

// Since 25 September 2026 the ride-along draws every bus from its own reports (backlog 31), so this
// check — which measures the *estimate's* drawing, its corrections and a camera that follows it —
// follows the same journey on the map, where the estimate is still drawn. Its assertions are
// unchanged; only the way the camera follows (the map's Follow rather than the ride) is.
test('a real recorded journey is drawn continuously, corrected as its reports arrive, and followed', async ({page}, info) => {
  test.skip(info.project.name !== 'desktop', 'one real replay is enough');
  test.setTimeout(420_000);
  const {clock, reports, r0} = await serveRecorded(page);
  // Since 21 September 2026 the home screen suggests nothing of its own accord, so the route to
  // watch is chosen here as a passenger would choose it. What this test is about — the drawing,
  // its corrections and the camera — is unchanged.
  const routeSelect = page.locator('#follow-route');
  await expect(routeSelect).toBeVisible({timeout: 20_000});
  await routeSelect.selectOption('BNML|256');
  await expect(page.locator('.bus-card .route-badge')).toHaveText('256');
  await expect(map(page)).toHaveAttribute('data-motion', 'estimated', {timeout: 25_000});
  await page.locator('.follow-toggle').click();
  await expect(page.locator('.follow-toggle')).toHaveAttribute('aria-pressed', 'true', {timeout: 5000});

  // Sample every frame until the last recorded report has arrived and settled.
  const lastArrival = () => clock.t0 + (reports.at(-1).retrievedAtMs - r0) + 25_000;
  const seen = [];
  while (Date.now() < lastArrival()) { seen.push(await display(page)); await page.waitForTimeout(120); }
  writeFileSync(info.outputPath('replay-frames.json'), JSON.stringify(seen));
  const valid = seen.filter(v => Number.isFinite(v.s) && Number.isFinite(v.wall) && v.motion === 'estimated');
  expect(valid.length, 'frames sampled').toBeGreaterThan(800);
  const pairs = [];
  for (let i = 1; i < valid.length; i++) {
    const a = valid[i - 1], b = valid[i], dt = (b.wall - a.wall) / 1000;
    if (dt > 0 && dt < 2) pairs.push({ds: b.s - a.s, dt, snap: b.correction !== a.correction && /^snap/.test(b.correction || '')});
  }
  const smooth = pairs.filter(p => !p.snap);
  const worst = smooth.reduce((w, p) => (p.ds - 25 * p.dt > w.ds - 25 * w.dt ? p : w), smooth[0]);
  expect(worst.ds - 25 * worst.dt, `no jump between frames except at a labelled snap (${JSON.stringify(worst)})`).toBeLessThan(3);
  // Drawn backwards only as a labelled correction being absorbed. A report that finds the drawn
  // bus further ahead than it may wait for (the estimate's measured error at that age) first
  // slows it at 3 m/s² from its drawn speed (at most about 6 s), then closes the gap at no more
  // than 12 m/s and lands softly (DRAWING in lib/motion.ts): the settling lasts at most the
  // correction's size over 12 m/s plus about 15 s. Never at a whim between reports.
  const backwards = [];
  for (let i = 1; i < valid.length; i++) {
    const a = valid[i - 1], b = valid[i];
    if (b.s - a.s >= -0.5) continue;
    const [kind, metres, at] = (b.correction || 'none').split(':');
    const since = at ? (b.frame - Number(at)) / 1000 : null;
    backwards.push({ds: +(b.s - a.s).toFixed(1), kind, metres: Number(metres) || 0, since: since === null ? null : +since.toFixed(1)});
  }
  const stray = backwards.filter(m => !(m.kind === 'smooth' || m.kind === 'snap') || m.since === null || m.since > m.metres / 12 + 15);
  expect(stray, `backward drawing only while a labelled correction settles (${backwards.length} backward frames)`).toEqual([]);
  const corrections = [...new Set(valid.map(v => v.correction).filter(c => c && c !== 'none'))];
  const snaps = corrections.filter(c => /^snap/.test(c)).length, smooths = corrections.filter(c => /^smooth/.test(c)).length;
  const expectedSnaps = RECORDED.expected.moves.filter(m => m !== null && Math.abs(m) > 150).length;
  const measured = {frames: valid.length, seconds: Math.round((valid.at(-1).wall - valid[0].wall) / 1000), eased: smooths, snapped: snaps,
    expectedSnaps, backwardFrames: backwards.length, largestNonSnapStep: {metres: +worst.ds.toFixed(1), seconds: +worst.dt.toFixed(2)},
    corrections};
  writeFileSync(info.outputPath('replay-measured.json'), JSON.stringify(measured, null, 1));
  test.info().annotations.push({type: 'measured',
    description: `${valid.length} frames over ${Math.round((valid.at(-1).wall - valid[0].wall) / 1000)} s; corrections seen: ${smooths} eased, ${snaps} snapped; the offline evaluation expected ${expectedSnaps} snap(s) for this slice; the largest non-snap step was ${worst.ds.toFixed(1)} m in ${worst.dt.toFixed(2)} s`});
  expect(snaps, 'snaps are the labelled large corrections, no more than the evaluation expects for this slice').toBeLessThanOrEqual(expectedSnaps + 1);
  expect(smooths, 'reports were reconciled while riding').toBeGreaterThan(4);
  await expect(page.locator('.follow-toggle'), 'following throughout').toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({path: info.outputPath('desktop-replay-real-journey.png')});
});

// The same real journey ridden: in the ride it is drawn from its own reports (backlog 31), a bounded
// time behind them, and must be continuous — no step a bus could not make unless it is said, never a
// round token, turning at a bus's rate with the camera no faster, following throughout, and the card
// saying how far behind it is drawn.
test('a real recorded journey ridden: drawn from its reports, continuous, turning at a bus rate', async ({page}, info) => {
  test.skip(info.project.name !== 'desktop', 'one real replay is enough');
  test.setTimeout(420_000);
  const {clock, reports, r0} = await serveRecorded(page);
  const routeSelect = page.locator('#follow-route');
  await expect(routeSelect).toBeVisible({timeout: 20_000});
  await routeSelect.selectOption('BNML|256');
  await expect(page.locator('.bus-card .route-badge')).toHaveText('256');
  await expect(map(page), 'on the map it is estimated').toHaveAttribute('data-motion', 'estimated', {timeout: 25_000});
  await page.getByRole('button', {name: 'Ride along with route 256'}).click();
  await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 8000});
  await expect(map(page), 'in the ride it is drawn from its reports').toHaveAttribute('data-motion', 'observed');
  const lastArrival = () => clock.t0 + (reports.at(-1).retrievedAtMs - r0) + 25_000;
  const seen = [];
  while (Date.now() < lastArrival()) {
    const d = await display(page);
    d.camera = Number(((await map(page).getAttribute('data-camera')) || '').split(',')[4]);
    d.t = Date.now();
    seen.push(d);
    await page.waitForTimeout(120);
  }
  writeFileSync(info.outputPath('ride-frames.json'), JSON.stringify(seen));
  const valid = seen.filter(v => Number.isFinite(v.lat) && Number.isFinite(v.wall));
  expect(valid.length, 'frames sampled').toBeGreaterThan(800);
  const metres = (a, b) => Math.hypot((b.lon - a.lon) * Math.cos(a.lat * Math.PI / 180), b.lat - a.lat) * 111195;
  const turn = (a, b) => ((b - a) % 360 + 540) % 360 - 180;
  const steps = [], turns = [], swings = [];
  for (let i = 1; i < valid.length; i++) {
    const a = valid[i - 1], b = valid[i], dt = (b.wall - a.wall) / 1000;
    if (!(dt > 0 && dt < 2)) continue;
    const said = b.correction !== a.correction && /^snap/.test(b.correction || '');
    if (!said) steps.push({m: metres(a, b) - 25 * dt, at: i});
    if (a.bearing !== null && b.bearing !== null && !said) turns.push(Math.abs(turn(a.bearing, b.bearing)) - 90 * dt);
    const ct = (b.t - a.t) / 1000;
    if (Number.isFinite(a.camera) && Number.isFinite(b.camera) && !said) swings.push(Math.abs(turn(a.camera, b.camera)) - 120 * (ct + 0.25));
  }
  expect(Math.max(...steps.map(x => x.m)), 'no step a bus could not make, unless said').toBeLessThan(3);
  expect(Math.max(...turns), 'the bus turns at no more than a bus rate').toBeLessThan(3);
  expect(Math.max(...swings), 'the camera turns no faster than it may').toBeLessThan(3);
  const firstHeading = valid.findIndex(v => v.bearing !== null);
  expect(valid.slice(Math.max(0, firstHeading)).filter(v => v.bearing === null).length, 'never a round token once it faces a way').toBe(0);
  expect(new Set(valid.map(v => v.ride)), 'following throughout').toEqual(new Set(['following']));
  await expect(page.locator('.ride-card .ride-motion')).toContainText(/drawn about (3\d|4\d|5\d|6\d|7[05]) s behind|Last reported position/);
  await page.screenshot({path: info.outputPath('desktop-ride-real-journey.png')});
});
