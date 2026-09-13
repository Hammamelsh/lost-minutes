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
                metres: FX.metres, stopCount: mainStops.length, stopsInArea: mainStops.length, lengthMetres: 2644};
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
    vehicle('FX-COMING', {position: at(3), bearing: 135, age: 14, match: matched(3)}),
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
