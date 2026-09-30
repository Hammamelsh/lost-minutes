// A building between the ride's camera and the chosen bus (29 September 2026). On a phone, an X41 with no checked
// road rode past Manchester Victoria heading south-west: the ride's camera, 49 m behind it and 28 m up, stood inside
// the 30 m station building, whose walls hid the bus's body while its ring and number stayed on top ("riding under
// buildings"). Measured in the map's own tiles, that camera is inside or behind that building for the last 40 m of
// the bus's approach along Victoria Station Approach. The buildings now fade while one stands in front of the chosen
// bus, and the bus's body, drawn beneath them, shows through. FIXTURE publication, real basemap tiles and buildings.
import {test, expect} from '@playwright/test';
import {movingLive, servePatterns, serveLive, waitForPaint} from './fixtures.mjs';

const map = page => page.locator('.vector-map').first();
const B = {lat: 53.48731, lon: -2.24354};            // Victoria Station Approach; the camera behind it is in the station
const HEADING = 237, SPEED = 1.0;                     // south-west, slowly: drawn about 30 s behind, it stays in the stretch

function victoriaLive(nowMs) {
  const base = movingLive({nowMs});
  const now = Math.floor(nowMs / 1000) * 1000, newest = now - 8000, back = (HEADING + 180) * Math.PI / 180;
  const at = t => {                                   // metres before B at time t, at SPEED
    const m = Math.max(0, (newest - t) / 1000 * SPEED);
    return {t, lat: B.lat + m * Math.cos(back) / 111195, lon: B.lon + m * Math.sin(back) / (111195 * Math.cos(B.lat * Math.PI / 180))};
  };
  const fixes = [];
  for (let t = newest - 150_000; t <= newest; t += 10_000) fixes.push(at(t));
  const latest = fixes.at(-1), age = (now - latest.t) / 1000;
  base.vehicles.push({operator: 'LNUD', vehicle: 'FX-X41', route: 'X41', direction: 'inbound', journeyRef: 'FX-X41-J',
    destination: 'Arrival_Stand', origin: 'Shudehill_Interchange', observedAtMs: latest.t,
    recordedAt: new Date(latest.t).toISOString().replace('.000Z', '+00:00'), lat: latest.lat, lon: latest.lon,
    ageSeconds: age, freshness: 'fresh', positionKind: 'observed', sourceHash: 'f'.repeat(64), bearing: HEADING,
    bearingStatus: 'reported', aimedDeparture: null, retrievedAtMs: latest.t + 3000,
    trail: fixes.slice(0, -1).map(f => [latest.t - f.t, f.lat, f.lon, HEADING, 0]),
    match: {unresolved: 'no_pattern_for_route', explanation: 'FIXTURE: no timetable pattern is held for this route label.'}});
  return base;
}

/** Lime-green pixels of the chosen bus's body at its own ground point: the ring and the number lie outside the box. */
async function bodyPixels(page) {
  const [x, y] = ((await map(page).getAttribute('data-bus-screen')) || '').split(',').map(Number);
  const box = await page.locator('.vector-map-canvas').boundingBox();
  const png = await page.screenshot({clip: {x: box.x + x - 20, y: box.y + y - 20, width: 40, height: 40}});
  return page.evaluate(async b64 => {
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 1] > 140 && d[i + 1] > d[i] + 15 && d[i + 1] > d[i + 2] + 60) n++;
    return n;
  }, png.toString('base64'));
}

async function ride(page, key, route) {
  await page.goto(`/?bus=${encodeURIComponent(key)}`);
  await waitForPaint(page);
  await page.getByRole('button', {name: new RegExp(`^Ride along with route ${route}`)}).click({timeout: 20_000});
  await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 20_000});
}

test('a building between the ride\'s camera and the bus fades, and the bus shows through it', async ({page}) => {
  test.setTimeout(120_000);
  await servePatterns(page);
  const now = Date.now();
  await serveLive(page, [() => victoriaLive(now)]);
  await ride(page, 'LNUD|FX-X41|X41|inbound', 'X41');
  await expect(map(page)).toHaveAttribute('data-bus-occluded', 'yes', {timeout: 20_000});
  await expect(map(page)).toHaveAttribute('data-buildings-opacity', '0.3');
  await page.waitForTimeout(600);                    // the fade's own transition
  const shown = await bodyPixels(page);
  console.log(`behind the station: the body's lime pixels at its ground point ${shown}, camera ${await map(page).getAttribute('data-camera')}`);
  await page.screenshot({path: test.info().outputPath(`${test.info().project.name}-victoria.png`)});
  expect(shown, 'the bus\'s body shows through the faded building').toBeGreaterThan(40);
});

test('on the night map, and through a change of theme, the building stays faded while it hides the bus', async ({page}) => {
  // The owner's screenshot was of the night map. A theme change restyles the buildings; it must not put them back
  // in front of a bus they hide.
  test.setTimeout(120_000);
  await servePatterns(page);
  const now = Date.now();
  await serveLive(page, [() => victoriaLive(now)]);
  await ride(page, 'LNUD|FX-X41|X41|inbound', 'X41');
  await expect(map(page)).toHaveAttribute('data-bus-occluded', 'yes', {timeout: 20_000});
  if (await map(page).getAttribute('data-theme') !== 'night')
    await page.getByRole('button', {name: 'Switch to the night map'}).click();
  await expect(map(page)).toHaveAttribute('data-theme', 'night');
  await expect(map(page)).toHaveAttribute('data-bus-occluded', 'yes');
  await expect(map(page)).toHaveAttribute('data-buildings-opacity', '0.3');
  await page.waitForTimeout(600);
  const shown = await bodyPixels(page);
  console.log(`behind the station, night: the body's lime pixels at its ground point ${shown}`);
  await page.screenshot({path: test.info().outputPath(`${test.info().project.name}-victoria-night.png`)});
  expect(shown, 'the bus\'s body shows through the faded building at night').toBeGreaterThan(40);
});

test('with nothing between the camera and the bus, the buildings keep their look', async ({page}) => {
  test.setTimeout(120_000);
  await servePatterns(page);
  await serveLive(page, [() => movingLive({nowMs: Date.now()})]);
  await ride(page, 'BNML|FX-MOVING|256|inbound', '256');
  await page.waitForTimeout(3000);
  await expect(map(page)).toHaveAttribute('data-bus-occluded', 'no');
  const opacity = Number(await map(page).getAttribute('data-buildings-opacity'));
  expect([0.78, 0.88], 'the theme\'s own opacity').toContain(opacity);
});
