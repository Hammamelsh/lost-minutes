// Test data for the browser checks.
//
// liveFromArchive() is a FIXTURE, and says so in its own payload: real positions from the
// committed archive sample, re-timed to the current clock so the page treats them as fresh.
// It exists because a test needs live state that changes on demand. Checks against the real
// feed are run separately, with the collector running, and are labelled as such.
import {readFileSync} from 'node:fs';

const replay = JSON.parse(readFileSync(new URL('../../public/data/replay.json', import.meta.url), 'utf8'));

const POLICY = {observationFreshSeconds: 60, observationAgeingSeconds: 150,
  observationExpirySeconds: 900, publicationStaleSeconds: 120, futureToleranceSeconds: 120,
  pollIntervalSeconds: 10, basis: 'Browser-test fixture.'};

const envelope = (nowMs, extra) => ({
  schemaVersion: 1, mode: 'live_bods',
  area: {bbox: [-2.36, 53.40, -2.16, 53.53], label: 'Manchester and Trafford'},
  publishedAt: new Date(nowMs).toISOString(), publishedAtMs: nowMs,
  collection: {lastRequestAt: null, lastSuccessAt: null, lastPayloadChangeAt: null, cycles: 0,
    succeeded: 0, repeatPayloads: 0, failed: 0, consecutiveFailures: 0, sharedCollector: true},
  freshness: {policy: POLICY, measured: null},
  withheld: {expiredPositions: 0, positionsAheadOfClock: 0, conflictingIdentities: 0,
    quarantinedRecords: 0, quarantineReasons: []},
  sourceQuality: {quarantineReasons: [], note: 'Browser-test fixture.'},
  pipelineFailures: {cycles: [], note: 'Browser-test fixture.'},
  attribution: 'Fixture built from the committed archive sample (Open Government Licence v3.0).',
  notes: ['FIXTURE: archive positions re-timed to the current clock for a browser test.'],
  ...extra,
});

/** A live state from real archive positions on the current clock. `nudgeMetres` moves every
 *  bus north, so successive payloads genuinely differ. */
export function liveFromArchive({nudgeMetres = 0, nowMs = Date.now(), limit = 80} = {}) {
  const latest = new Map();
  for (const journey of replay.journeys) {
    const point = journey.points.at(-1);
    const key = `${journey.operator}|${journey.vehicle}`;
    const previous = latest.get(key);
    if (!previous || previous.point.time < point.time) latest.set(key, {journey, point});
  }
  const now = Math.floor(nowMs / 1000) * 1000;
  const vehicles = [...latest.values()]
    .sort((a, b) => b.point.time - a.point.time)
    .slice(0, limit)
    .map(({journey, point}, index) => {
      const ageSeconds = 8 + (index % 50);
      const observedAtMs = now - ageSeconds * 1000;
      return {
        operator: journey.operator, vehicle: journey.vehicle, route: journey.route,
        direction: journey.direction, journeyRef: journey.journeyRef,
        destination: journey.destination || null, origin: journey.origin || null,
        observedAtMs, recordedAt: new Date(observedAtMs).toISOString().replace('.000Z', '+00:00'),
        lat: point.lat + nudgeMetres / 111320, lon: point.lon,
        ageSeconds, freshness: ageSeconds <= 60 ? 'fresh' : 'ageing',
        positionKind: 'observed', sourceHash: point.sourceHash,
      };
    });
  return envelope(now, {state: 'live', vehicles});
}

export function unavailableState(nowMs = Date.now()) {
  return envelope(nowMs, {state: 'unavailable', vehicles: [],
    unavailableReason: 'collector_not_running'});
}

export const fastConfig = () => ({schemaVersion: 1, liveUrl: '/data/live.json',
  replayUrl: '/data/replay.json', operationsUrl: '/data/operations.json', pollSeconds: 10});

/** Answer the page's live requests from a list of payload builders, one per request. */
export async function serveLive(page, builders) {
  const served = {count: 0, publishedAt: []};
  await page.route('**/data/config.json*', route => route.fulfill({json: fastConfig()}));
  await page.route('**/data/live.json*', route => {
    const build = builders[Math.min(served.count, builders.length - 1)];
    served.count += 1;
    const body = build();
    served.publishedAt.push(body.publishedAt);
    return route.fulfill({json: body, headers: {date: new Date().toUTCString()}});
  });
  return served;
}

/** Wait for the vector map to paint. If the page gives up on it and draws its fallback map instead,
 *  fail at once with the reason the page gives (data-map-fallback: no_webgl, startup_timeout, …)
 *  rather than waiting out the timeout as if the map were only slow. */
export async function waitForPaint(page, {timeout = 45_000, note = ''} = {}) {
  const fallback = page.locator('.map-fallback-wrap');
  const outcome = await Promise.race([
    page.locator('.vector-map[data-map-state="painted"]').waitFor({state: 'visible', timeout}).then(() => 'painted'),
    fallback.waitFor({state: 'attached', timeout}).then(() => 'fallback'),
  ]).catch(error => {
    throw new Error(`The vector map did not paint within ${timeout / 1000} s${note ? ` (${note})` : ''}: ${error.message.split('\n')[0]}`);
  });
  if (outcome === 'fallback') {
    const reason = await fallback.getAttribute('data-map-fallback');
    throw new Error(`The page drew its fallback map (${reason ?? 'no reason given'}) instead of the vector map${note ? ` (${note})` : ''}`);
  }
}

/** Count what the basemap actually fetched, by kind. The style is our own and inline, so its
 *  network half is the TileJSON that names the tile set. */
export function watchBasemap(page) {
  const seen = {style: 0, tiles: 0, tileFailures: 0, glyphs: 0};
  page.context().on('response', response => {
    const url = response.url();
    if (!url.includes('tiles.openfreemap.org')) return;
    if (/\/planet(\?|$)/.test(url) || url.includes('/styles/')) seen.style += 1;
    else if (url.includes('/fonts/')) { if (response.ok()) seen.glyphs += 1; }
    else if (/\.pbf(\?|$)/.test(url)) { if (response.ok()) seen.tiles += 1; else seen.tileFailures += 1; }
  });
  return seen;
}

/** Colour variety inside an element's screenshot, decoded in the page itself. A map that has
 *  not painted is one flat colour; a rendered basemap has streets, water and labels. */
export async function pixelVariety(page, locator) {
  const png = await locator.screenshot();
  return page.evaluate(async b64 => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width; canvas.height = img.height;
    const g = canvas.getContext('2d');
    g.drawImage(img, 0, 0);
    const data = g.getImageData(0, 0, canvas.width, canvas.height).data;
    const counts = new Map();
    for (let i = 0; i < data.length; i += 16) {
      const key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const total = data.length / 16;
    return {distinctColours: counts.size,
            nonDominantFraction: +(1 - Math.max(...counts.values()) / total).toFixed(3)};
  }, png.toString('base64'));
}

/** The three symbols a passenger must tell apart, by their fill colours in components/city-map.tsx.
 *  Counting their pixels shows each one was drawn, and drawn distinctly, in the rendered map. */
export const MARKER_COLOURS = {you: [0x5a, 0xa9, 0xe6], yourStop: [0xff, 0xd9, 0xa5], selectedBus: [0xc6, 0xf3, 0x6a]};

export async function markerPixels(page, locator, colours = MARKER_COLOURS, tolerance = 24) {
  const png = await locator.screenshot();
  return page.evaluate(async ({b64, colours, tolerance}) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width; canvas.height = img.height;
    const g = canvas.getContext('2d');
    g.drawImage(img, 0, 0);
    const data = g.getImageData(0, 0, canvas.width, canvas.height).data;
    const found = Object.fromEntries(Object.keys(colours).map(name => [name, 0]));
    const limit = tolerance * tolerance;
    for (let i = 0; i < data.length; i += 4) {
      for (const [name, [r, gg, b]] of Object.entries(colours)) {
        const dr = data[i] - r, dg = data[i + 1] - gg, db = data[i + 2] - b;
        if (dr * dr + dg * dg + db * db <= limit) found[name] += 1;
      }
    }
    return found;
  }, {b64: png.toString('base64'), colours, tolerance});
}

// ------------------------------------------------------------------ journey FIXTURE
// A labelled FIXTURE timetable on real NaPTAN stops: route 256 inbound through Stretford, as
// published, and one invented branch that leaves it after Stretford Mall (Stop A). The stop
// names come from the real stops.json; the patterns, vehicles and matches are fixtures.
export const FX = {
  main: [['1800SJ00991', 53.45422, -2.32465], ['1800SJ04661', 53.4534, -2.32178],
         ['1800SJ01001', 53.45173, -2.31982], ['1800SJ08901', 53.4502, -2.3179],
         ['1800SJ01431', 53.4483, -2.31579], ['1800SJ01021', 53.44632, -2.31381],
         ['1800SJ00811', 53.44629, -2.31056], ['1800SJ00081', 53.44669, -2.30651],
         ['1800SJ00101', 53.44888, -2.30404], ['1800SJ00111', 53.45021, -2.30272],
         ['1800SJ00121', 53.45303, -2.30002]],
  metres: [0, 209, 434, 657, 910, 1198, 1496, 1817, 2111, 2283, 2644],
  // Scheduled seconds from the first stop, as a timetable's RunTimes would give: about 8 m/s
  // between stops plus a 10 s call at each. Stop A is index 6, 247 s in.
  seconds: [0, 36, 74, 112, 154, 200, 247, 297, 344, 375, 430],
  branchTail: ['1800SJ00091', '1800SJ00431', '1800SJ00891'],
  stopA: '1800SJ00811', stopE: '1800SJ00081',
};

export function fixtureCatalogue() {
  const common = {operator: 'BNML', line: '256', serviceCode: 'FIXTURE', direction: 'inbound',
    hasRepeatedStop: false, distancesKnown: true, runs: 'Mon–Sun', journeys: 40,
    operatingRules: [{days: [0, 1, 2, 3, 4, 5, 6]}],
    timetable: {datasetSha256: 'f'.repeat(64), file: 'FIXTURE_256.xml', validFrom: '2026-01-01',
                validTo: '2031-12-31', modified: '2026-09-01T00:00:00', revision: 'fixture'}};
  const mainStops = FX.main.map(s => s[0]);
  const branchStops = [...mainStops.slice(0, 7), ...FX.branchTail];
  const main = {...common, id: 'FX:256:main', destination: 'Piccadilly Gardens', stops: mainStops,
                metres: FX.metres, seconds: FX.seconds, stopCount: mainStops.length, stopsInArea: mainStops.length, lengthMetres: 2644};
  const branch = {...common, id: 'FX:256:branch', destination: 'Chester Road (fixture branch)',
                  stops: branchStops, metres: [...FX.metres.slice(0, 7), 1800, 2150, 2600],
                  stopCount: branchStops.length, stopsInArea: branchStops.length, lengthMetres: 2600};
  return {schemaVersion: 2, generatedAt: new Date().toISOString(), supportedLines: ['256'],
          supportedServices: ['BNML|256'], coverage: {selection: 'FIXTURE'}, patterns: [main, branch],
          rules: {minimumStopsInArea: 1, minimumStops: 5},
          attribution: 'FIXTURE timetable on real NaPTAN stops, for browser tests only.',
          notes: ['FIXTURE']};
}

const EVIDENCE = {serviceDay: '2026-09-13', weekday: 'Sunday', operatorChecked: true,
  directionReported: true, operatingDayChecked: true, plausiblePaths: 1, resolvedBy: 'position'};

/** FIXTURE live state for the stop-first flow around Stretford Mall (Stop A). */
export function journeyLive({nowMs = Date.now(), omit = [], publishedAgoSeconds = 0} = {}) {
  const now = Math.floor(nowMs / 1000) * 1000;
  // A publication from some time ago holds reports from before it, never after it.
  const published = now - publishedAgoSeconds * 1000;
  const at = i => [FX.main[i][1], FX.main[i][2]];
  const matched = (index, extra = {}) => ({patternId: 'FX:256:main', patternIndex: index,
    nearestStop: FX.main[index][0], metresAlongPattern: FX.metres[index], metresFromPatternStop: 12,
    patternDirection: 'inbound', patternDestination: 'Piccadilly Gardens', evidence: EVIDENCE, ...extra});
  const vehicle = (id, {route = '256', operator = 'BNML', destination = 'Piccadilly_Gardens', position,
                        offset = [0.0001, 0], bearing = null, age = 18, match}) => {
    const observedAtMs = published - age * 1000;
    return {operator, vehicle: id, route, direction: 'inbound', journeyRef: `FX-${id}`, destination,
      origin: 'Fixture', observedAtMs, recordedAt: new Date(observedAtMs).toISOString().replace('.000Z', '+00:00'),
      lat: position[0] + offset[0], lon: position[1] + offset[1], ageSeconds: age,
      freshness: age <= 60 ? 'fresh' : 'ageing', positionKind: 'observed', sourceHash: 'e'.repeat(64),
      bearing, bearingStatus: bearing === null ? 'absent' : 'reported', aimedDeparture: null, match};
  };
  const vehicles = [
    // On one named scheduled journey: the 06:49 departure, the only one at that time.
    vehicle('FX-COMING', {position: at(3), bearing: 135, age: 14,
      match: matched(3, {scheduled: {departure: '06:49:00', journeys: 1, serviceDay: '2026-09-13'}})}),
    vehicle('FX-SHARED', {destination: '', position: at(4), bearing: 150, age: 22, match: {
      unresolved: 'ambiguous_branch',
      explanation: 'More than one branch of this route fits the position, so which one the bus is on cannot be settled from the position alone.',
      candidates: [{patternId: 'FX:256:main', patternIndex: 4}, {patternId: 'FX:256:branch', patternIndex: 4}],
      nearestStop: FX.main[4][0], sharedNext: [FX.main[5][0], FX.main[6][0]], metresFromPatternStop: 10,
      // As the matcher publishes an unresolved branch: two paths, and nothing that resolved them.
      evidence: {serviceDay: '2026-09-13', weekday: 'Sunday', operatorChecked: true,
                 directionReported: true, operatingDayChecked: true, plausiblePaths: 2}}}),
    vehicle('FX-PASSED', {position: at(9), bearing: 45, age: 31, match: matched(9)}),
    vehicle('FX-ATSTOP', {route: '53', operator: 'BNSM', destination: 'Cheetham_Hill',
      position: [53.44619, -2.31039], offset: [0.0002, 0.0003], age: 9,
      match: {unresolved: 'no_pattern_for_route', explanation: 'No timetable pattern is held for this route label.'}}),
    vehicle('FX-NEARBY', {route: '15', destination: 'Roedean_Gardens', position: [53.4535, -2.3040],
      bearing: 200, age: 40,
      match: {unresolved: 'no_pattern_for_route', explanation: 'No timetable pattern is held for this route label.'}}),
  ].filter(v => !omit.includes(v.vehicle));
  return envelope(published, {state: 'live', vehicles});
}

export async function servePatterns(page, catalogue = fixtureCatalogue()) {
  await page.route('**/data/patterns.json*', route => route.fulfill({json: catalogue}));
}

// ------------------------------------------------------------------ estimated movement
// A FIXTURE bus moving along a real road: the path is Valhalla's bus route through the eleven
// real NaPTAN stops of the fixture's route-256 pattern, recorded once (tests/browser/recorded).
const SHAPE = JSON.parse(readFileSync(new URL('./recorded/shape-fixture-256-main.json', import.meta.url), 'utf8'));

function decodePolyline6(text) {
  const points = [];
  let index = 0, lat = 0, lon = 0;
  const next = () => {
    let result = 0, shift = 0, byte;
    do { byte = text.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < text.length) { lat += next(); lon += next(); points.push([lon / 1e6, lat / 1e6]); }
  return points;
}

const TRACK = (() => {
  const points = decodePolyline6(SHAPE.polyline6), cum = [0];
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1], [bx, by] = points[i];
    cum.push(cum[i - 1] + Math.hypot((bx - ax) * Math.cos(ay * Math.PI / 180), by - ay) * 111195);
  }
  return {points, cum, length: cum.at(-1)};
})();
export const FIXTURE_TRACK_LENGTH = TRACK.length;

/** Google's encoded polyline at precision 6: the inverse of decodePolyline6, for served fixtures. */
function encodePolyline6(points) {
  let out = '', lastLat = 0, lastLon = 0;
  const chunk = value => {
    let v = value < 0 ? ~(value << 1) : value << 1;
    while (v >= 0x20) { out += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; }
    out += String.fromCharCode(v + 63);
  };
  for (const [lon, lat] of points) {
    const la = Math.round(lat * 1e6), lo = Math.round(lon * 1e6);
    chunk(la - lastLat); chunk(lo - lastLon); lastLat = la; lastLon = lo;
  }
  return out;
}

/** Where the fixture's branch road leaves the main road, as a share of the main road's length. */
export const FIXTURE_BRANCH_LEAVES_AT = 0.6;

/**
 * A FIXTURE branch shape: the main road for the first 60% of its length, then the same
 * heading 60 m to the north — a different street that a stop list alone could never reveal.
 */
function branchShape() {
  const leave = TRACK.length * FIXTURE_BRANCH_LEAVES_AT;
  const points = TRACK.points.map(([lon, lat], i) => TRACK.cum[i] <= leave ? [lon, lat] : [lon, lat + 60 / 111195]);
  return {id: 'FX:256:branch', polyline6: encodePolyline6(points), stopOffsets: SHAPE.stopOffsets};
}

/** A point, and the road's heading there, s metres along the fixture road. */
export function alongFixture(s) {
  const at = Math.max(0, Math.min(TRACK.length, s));
  let i = TRACK.cum.findIndex((c, k) => k > 0 && c >= at);
  if (i < 1) i = TRACK.points.length - 1;
  const [ax, ay] = TRACK.points[i - 1], [bx, by] = TRACK.points[i];
  const span = TRACK.cum[i] - TRACK.cum[i - 1], t = span > 0 ? (at - TRACK.cum[i - 1]) / span : 0;
  const heading = (Math.atan2((bx - ax) * Math.cos(ay * Math.PI / 180), by - ay) * 180 / Math.PI + 360) % 360;
  return {lon: ax + (bx - ax) * t, lat: ay + (by - ay) * t, bearing: Math.round(heading)};
}

export const FIXTURE_MOTION = {schemaVersion: 1, version: 'FIXTURE motion evaluation', method: 'FIXTURE',
  supported: true, params: {horizon: 30, maxSpeed: 17, speedWindow: 45, stale: 150},
  errorProfile: {version: 'FIXTURE', basis: 'FIXTURE numbers for browser tests only',
    bins: [{upTo: 10, n: 100, p50: 9, p80: 18}, {upTo: 20, n: 100, p50: 15, p80: 30},
           {upTo: 30, n: 100, p50: 22, p80: 44}, {upTo: 45, n: 100, p50: 34, p80: 66},
           {upTo: 60, n: 60, p50: 45, p80: 90}]},
  corridor: {lines: ['256'], patterns: ['FX:256:main']}};

/** Serve the fixture road geometry and, unless given null, a FIXTURE motion evaluation. */
export async function serveMotion(page, {evaluation = FIXTURE_MOTION, branch = 'none'} = {}) {
  // branch: 'none' (no geometry was built for it) or 'shared-until' (built, never accepted, and
  // on the main road for the first 60% of the way). Neither is ever accepted: only main's road
  // has been checked against reports, so shared road is judged against main.
  const branchEntry = branch === 'shared-until'
    ? {status: 'rejected', reason: 'FIXTURE: only 0 reports on this pattern to check the shape against', file: 'FX_256_branch.json'}
    : {status: 'rejected', reason: 'FIXTURE: no geometry built for the branch'};
  await page.route('**/data/shapes/index.json*', route => route.fulfill({json: {schemaVersion: 1,
    patterns: {'FX:256:main': {status: 'accepted', reason: null, file: 'FX_256_main.json',
      lengthMetres: Math.round(TRACK.length), validation: {reports: 120, offsetP50Metres: 6, offsetP95Metres: 18}},
      'FX:256:branch': branchEntry}}}));
  await page.route('**/data/shapes/FX_256_main.json*', route => route.fulfill({json: {id: 'FX:256:main',
    polyline6: SHAPE.polyline6, stopOffsets: SHAPE.stopOffsets}}));
  await page.route('**/data/shapes/FX_256_branch.json*', route => route.fulfill({json: branchShape()}));
  await page.route('**/data/motion-evaluation.json*', route => evaluation
    ? route.fulfill({json: evaluation}) : route.fulfill({status: 404, body: 'no evaluation'}));
}

const nearestFixtureStop = s => SHAPE.stopOffsets.reduce((best, offset, i) =>
  Math.abs(offset - s) < Math.abs(SHAPE.stopOffsets[best] - s) ? i : best, 0);

/**
 * A FIXTURE publication in which bus FX-MOVING runs along the recorded road at `speed` m/s
 * from `startS` metres at `startMs`. Reports come every `cadence` s and the newest is `delay` s
 * old when published, as in the real feed. `wobble` adds a deterministic along-road error of up
 * to that many metres, so corrections happen both ways; `jump` moves it suddenly; `standing`
 * keeps it still; `extraAge` makes every report that much older.
 */
export function movingLive({nowMs = Date.now(), startMs = nowMs, startS = 300, speed = 8, cadence = 10,
                            delay = 6, wobble = 0, jump = null, standing = false, extraAge = 0,
                            sharedAt = null} = {}) {
  const base = journeyLive({nowMs, omit: ['FX-COMING']});
  // The unsettled bus (FX-SHARED) sits at stop 4 by default. `sharedAt` puts its last report at
  // that many metres along the fixture road instead, so a test can place it inside or short of
  // the stretch its two candidate roads are measured to share.
  if (sharedAt !== null) {
    const shared = base.vehicles.find(v => v.vehicle === 'FX-SHARED');
    if (shared) {
      // A moving bus, not a single report: the estimator needs a span of reports to read a speed
      // from, so five fixes at 8 m/s every 10 s end at sharedAt, the newest `delay` seconds old.
      const now = Math.floor(nowMs / 1000) * 1000, newestT = now - delay * 1000;
      const fixes = [4, 3, 2, 1, 0].map(k => ({t: newestT - k * 10_000, ...alongFixture(sharedAt - k * 80)}));
      const latest = fixes.at(-1);
      shared.lat = latest.lat; shared.lon = latest.lon; shared.bearing = latest.bearing; shared.bearingStatus = 'reported';
      shared.observedAtMs = latest.t; shared.recordedAt = new Date(latest.t).toISOString().replace('.000Z', '+00:00');
      shared.ageSeconds = (now - latest.t) / 1000; shared.freshness = 'fresh'; shared.retrievedAtMs = latest.t + 3000;
      shared.trail = fixes.slice(0, -1).map(f => [latest.t - f.t, f.lat, f.lon, f.bearing, 0]);
      shared.match = {...shared.match, metresFromPatternStop: 40};
    }
  }
  base.trailSources = base.trailSources ?? [];
  const now = Math.floor(nowMs / 1000) * 1000;
  const sAt = t => Math.min(TRACK.length - 30, startS
    + (standing ? 0 : speed * Math.max(0, (t - startMs) / 1000))
    + (wobble ? wobble * Math.sin(t / 6100) : 0)
    + (jump && t >= jump.atMs ? jump.metres : 0));
  const newest = now - (delay + extraAge) * 1000, times = [];
  for (let t = newest; times.length < 7 && newest - t <= 240_000; t -= cadence * 1000) times.unshift(t);
  const fixes = times.map(t => ({t, ...alongFixture(sAt(t))}));
  const latest = fixes.at(-1), index = nearestFixtureStop(sAt(latest.t)), age = (now - latest.t) / 1000;
  base.trailSources = ['f'.repeat(64)];
  base.collection = {...base.collection, collector: {runId: 'FIXTURE', status: 'running', kind: 'bounded_development',
    startedAt: new Date(now - 300_000).toISOString(), finishedAt: null, plannedMinutes: 15,
    endsBy: new Date(now + 600_000).toISOString(), exitReason: null}};
  base.vehicles.unshift({operator: 'BNML', vehicle: 'FX-MOVING', route: '256', direction: 'inbound',
    journeyRef: 'FX-MOVING-J', destination: 'Piccadilly_Gardens', origin: 'Fixture',
    observedAtMs: latest.t, recordedAt: new Date(latest.t).toISOString().replace('.000Z', '+00:00'),
    lat: latest.lat, lon: latest.lon, ageSeconds: age,
    freshness: age <= 60 ? 'fresh' : age <= 150 ? 'ageing' : 'stale',
    positionKind: 'observed', sourceHash: 'f'.repeat(64), bearing: latest.bearing, bearingStatus: 'reported',
    aimedDeparture: null, retrievedAtMs: latest.t + 3000,
    trail: fixes.slice(0, -1).map(f => [latest.t - f.t, f.lat, f.lon, f.bearing, 0]),
    match: {patternId: 'FX:256:main', patternIndex: index, nearestStop: FX.main[index][0],
      metresAlongPattern: FX.metres[index], metresFromPatternStop: 12, patternDirection: 'inbound',
      patternDestination: 'Piccadilly Gardens', evidence: EVIDENCE}});
  return base;
}
