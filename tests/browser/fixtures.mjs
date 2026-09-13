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

/** Count what the basemap actually fetched, by kind. */
export function watchBasemap(page) {
  const seen = {style: 0, tiles: 0, tileFailures: 0, glyphs: 0};
  page.context().on('response', response => {
    const url = response.url();
    if (!url.includes('tiles.openfreemap.org')) return;
    if (url.includes('/styles/')) seen.style += 1;
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
