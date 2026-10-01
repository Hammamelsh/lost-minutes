// A building between the ride's camera and the chosen bus (29-30 September 2026). On a phone, an X41 with no
// checked road rode past Manchester Victoria heading south-west: the ride's camera, 49 m behind it and 28 m up,
// stood inside the 30 m station building, whose walls hid the bus's body while its ring and number stayed on top
// ("riding under buildings"). The first answer faded every building while one hid the bus, which emptied the
// city for most of a ride in the centre (the owner's V1 and X43, 30 September). Now the camera looks down over
// the buildings just steeply enough to see the bus, and the city keeps its look; the buildings fade only where no
// tilt can show the bus, when it stands inside a footprint. FIXTURE publication, real basemap tiles and buildings.
import {test, expect} from '@playwright/test';
import {movingLive, servePatterns, serveLive, waitForPaint} from './fixtures.mjs';

const map = page => page.locator('.vector-map').first();
const B = {lat: 53.48731, lon: -2.24354};            // Victoria Station Approach; the camera behind it is in the station
// A one-way lane through Stockport Interchange, every point of it under the station's roof (the map's own tiles):
// where a bus on its road is inside a building, and no tilt can show it.
const STOCKPORT_LANE = [[53.408979, -2.162794], [53.408966, -2.162756], [53.408947, -2.162724], [53.408921, -2.162708],
  [53.408864, -2.162724], [53.408652, -2.162949], [53.408585, -2.163057], [53.408288, -2.163706], [53.408205, -2.163904]];

// A bus approaching `end` on `heading` at `speed`, a report every `every` s over `span` s, the newest 8 s old.
function busLive(nowMs, {id, route, end, heading, speed, every = 10, span = 150}) {
  const base = movingLive({nowMs});
  const now = Math.floor(nowMs / 1000) * 1000, newest = now - 8000, back = (heading + 180) * Math.PI / 180;
  const at = t => {
    const m = Math.max(0, (newest - t) / 1000 * speed);
    return {t, lat: end.lat + m * Math.cos(back) / 111195, lon: end.lon + m * Math.sin(back) / (111195 * Math.cos(end.lat * Math.PI / 180))};
  };
  const fixes = [];
  for (let t = newest - span * 1000; t <= newest; t += every * 1000) fixes.push(at(t));
  const latest = fixes.at(-1), age = (now - latest.t) / 1000;
  base.vehicles.push({operator: 'LNUD', vehicle: id, route, direction: 'inbound', journeyRef: `${id}-J`,
    destination: 'Arrival_Stand', origin: 'Shudehill_Interchange', observedAtMs: latest.t,
    recordedAt: new Date(latest.t).toISOString().replace('.000Z', '+00:00'), lat: latest.lat, lon: latest.lon,
    ageSeconds: age, freshness: 'fresh', positionKind: 'observed', sourceHash: 'f'.repeat(64), bearing: heading,
    bearingStatus: 'reported', aimedDeparture: null, retrievedAtMs: latest.t + 3000,
    trail: fixes.slice(0, -1).map(f => [latest.t - f.t, f.lat, f.lon, heading, 0]),
    match: {unresolved: 'no_pattern_for_route', explanation: 'FIXTURE: no timetable pattern is held for this route label.'}});
  return base;
}
const victoria = nowMs => busLive(nowMs, {id: 'FX-X41', route: 'X41', end: B, heading: 237, speed: 1.0});
/** A bus crawling along the lane under the roof, a report every 10 s, the newest 8 s old at its far end. */
function underRoof(nowMs) {
  const base = movingLive({nowMs}), now = Math.floor(nowMs / 1000) * 1000, newest = now - 8000;
  const legs = STOCKPORT_LANE.slice(1).map((p, i) => Math.hypot((p[0] - STOCKPORT_LANE[i][0]) * 111195, (p[1] - STOCKPORT_LANE[i][1]) * 111195 * Math.cos(53.4 * Math.PI / 180)));
  const total = legs.reduce((a, b) => a + b, 0);
  const along = m => { let k = 0; while (k < legs.length - 1 && m > legs[k]) { m -= legs[k]; k++; } const f = Math.min(1, m / legs[k]);
    return [STOCKPORT_LANE[k][0] + (STOCKPORT_LANE[k + 1][0] - STOCKPORT_LANE[k][0]) * f, STOCKPORT_LANE[k][1] + (STOCKPORT_LANE[k + 1][1] - STOCKPORT_LANE[k][1]) * f]; };
  const fixes = [];
  for (let k = 0; k <= 7; k++) { const [lat, lon] = along(total * k / 7); fixes.push({t: newest - (7 - k) * 10_000, lat, lon}); }
  const latest = fixes.at(-1);
  base.vehicles.push({operator: 'LNUD', vehicle: 'FX-X41', route: 'X41', direction: 'inbound', journeyRef: 'FX-X41-J',
    destination: 'Stockport_Interchange', origin: 'Shudehill_Interchange', observedAtMs: latest.t,
    recordedAt: new Date(latest.t).toISOString().replace('.000Z', '+00:00'), lat: latest.lat, lon: latest.lon,
    ageSeconds: 8, freshness: 'fresh', positionKind: 'observed', sourceHash: 'f'.repeat(64), bearing: 225,
    bearingStatus: 'reported', aimedDeparture: null, retrievedAtMs: latest.t + 3000,
    trail: fixes.slice(0, -1).map(f => [latest.t - f.t, f.lat, f.lon, 225, 0]),
    match: {unresolved: 'no_pattern_for_route', explanation: 'FIXTURE: no timetable pattern is held for this route label.'}});
  return base;
}

/** The share of a box along the chosen bus, from its ground point up the screen, in the bus's own colours: its lime
 *  body, or its pale roof, which is most of what a camera looking steeply down sees. Scored on saved frames: the bus
 *  hidden in the station 5.7% (the ring's arc and the number only), seen over it 57%, seen through the faded
 *  station 49%. The map's paper, the station's stone and the night's blue are none of them. */
async function bodyShare(page) {
  const [x, y] = ((await map(page).getAttribute('data-bus-screen')) || '').split(',').map(Number);
  const box = await page.locator('.vector-map-canvas').boundingBox();
  const png = await page.screenshot({clip: {x: box.x + x - 25, y: box.y + y - 170, width: 50, height: 210}});
  return page.evaluate(async b64 => {
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const [r, gg, b] = [d[i], d[i + 1], d[i + 2]];
      const lime = gg > 140 && gg > r + 15 && gg > b + 60;
      const roofByDay = r > 228 && gg > 212 && b < 215 && gg - b > 20;
      const roofByNight = b > 200 && gg > 190 && r > 165 && b >= gg - 5;
      if (lime || roofByDay || roofByNight) n++;
    }
    return n / (d.length / 4);
  }, png.toString('base64'));
}
const pitchOf = async page => Number(((await map(page).getAttribute('data-camera')) || '').split(',')[3]);
const capOf = async page => { const c = await map(page).getAttribute('data-ride-pitch-cap'); return c === null || c === 'none' ? null : Number(c); };

async function ride(page, key, route) {
  await page.goto(`/?bus=${encodeURIComponent(key)}`);
  await waitForPaint(page);
  await page.getByRole('button', {name: new RegExp(`^Ride along with route ${route}`)}).click({timeout: 20_000});
  await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 20_000});
}

/** The camera has risen over the station: a cap below the ride's 60°, the camera at it, the bus not hidden. */
async function risen(page) {
  await expect.poll(() => capOf(page), {timeout: 20_000, message: 'the station asks for a steeper view'}).toBeLessThan(59);
  await expect.poll(async () => (await pitchOf(page)) - (await capOf(page)), {timeout: 15_000, message: 'the camera looks down to it'})
    .toBeLessThan(1.5);
}

test('a building between the ride\'s camera and the bus: the camera looks down over it, and the city keeps its look', async ({page}) => {
  test.setTimeout(120_000);
  await servePatterns(page);
  const now = Date.now();
  await serveLive(page, [() => victoria(now)]);
  await ride(page, 'LNUD|FX-X41|X41|inbound', 'X41');
  await risen(page);
  const theme = await map(page).getAttribute('data-theme');
  await expect(map(page)).toHaveAttribute('data-buildings-opacity', theme === 'night' ? '0.78' : '0.88');
  await expect(map(page)).toHaveAttribute('data-bus-occluded', 'no');
  await expect(map(page)).toHaveAttribute('data-bus-inside-building', 'no');
  const shown = await bodyShare(page), pitch = await pitchOf(page);
  console.log(`behind the station: pitch ${pitch.toFixed(1)} (cap ${await capOf(page)}), bus colours ${(shown * 100).toFixed(0)}% of its box, `
    + `sight check ${await map(page).getAttribute('data-sight-ms')} ms`);
  await page.screenshot({path: test.info().outputPath(`${test.info().project.name}-victoria.png`)});
  expect(shown, 'the bus\'s body is seen over the station').toBeGreaterThan(0.2);
});

test('on the night map, and through a change of theme, the camera stays over the station and the buildings solid', async ({page}) => {
  test.setTimeout(120_000);
  await servePatterns(page);
  const now = Date.now();
  await serveLive(page, [() => victoria(now)]);
  await ride(page, 'LNUD|FX-X41|X41|inbound', 'X41');
  await risen(page);
  if (await map(page).getAttribute('data-theme') !== 'night')
    await page.getByRole('button', {name: 'Switch to the night map'}).click();
  await expect(map(page)).toHaveAttribute('data-theme', 'night');
  await expect(map(page)).toHaveAttribute('data-buildings-opacity', '0.78');
  const shown = await bodyShare(page);
  console.log(`behind the station, night: pitch ${(await pitchOf(page)).toFixed(1)}, bus colours ${(shown * 100).toFixed(0)}% of its box`);
  await page.screenshot({path: test.info().outputPath(`${test.info().project.name}-victoria-night.png`)});
  expect(shown, 'the bus\'s body is seen at night').toBeGreaterThan(0.2);
});

test('a bus under a bus station\'s roof, which no tilt can show, is seen through the faded buildings', async ({page}) => {
  test.setTimeout(120_000);
  await servePatterns(page);
  const now = Date.now();
  await serveLive(page, [() => underRoof(now)]);
  await ride(page, 'LNUD|FX-X41|X41|inbound', 'X41');
  await expect(map(page)).toHaveAttribute('data-bus-inside-building', 'yes', {timeout: 20_000});
  await expect(map(page)).toHaveAttribute('data-buildings-opacity', '0.3', {timeout: 10_000});
  // No tilt would help, so the camera keeps the ride's framing rather than diving as well.
  await expect.poll(() => pitchOf(page), {timeout: 10_000, message: 'the framing is kept'}).toBeGreaterThan(55);
  await page.waitForTimeout(600);                    // the fade's own transition
  const shown = await bodyShare(page);
  console.log(`under Stockport Interchange's roof: pitch ${(await pitchOf(page)).toFixed(1)}, bus colours ${(shown * 100).toFixed(0)}% of its box, `
    + `street ${await map(page).getAttribute('data-street')}`);
  await page.screenshot({path: test.info().outputPath(`${test.info().project.name}-inside.png`)});
  expect(shown, 'the bus\'s body shows through the faded roof').toBeGreaterThan(0.2);
});

test('with nothing between the camera and the bus, the ride keeps its framing and the buildings their look', async ({page}) => {
  test.setTimeout(120_000);
  await servePatterns(page);
  await serveLive(page, [() => movingLive({nowMs: Date.now()})]);
  await ride(page, 'BNML|FX-MOVING|256|inbound', '256');
  await page.waitForTimeout(3000);
  const cap = await capOf(page);
  expect(cap === null || cap >= 60, `nothing asks for a steeper view (cap ${cap})`).toBe(true);
  expect(await pitchOf(page)).toBeGreaterThan(59);
  await expect(map(page)).toHaveAttribute('data-bus-occluded', 'no');
  const opacity = Number(await map(page).getAttribute('data-buildings-opacity'));
  expect([0.78, 0.88], 'the theme\'s own opacity').toContain(opacity);
});
