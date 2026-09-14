// Estimated movement, on a FIXTURE bus that moves along a real, recorded bus road.
//
// Every check reads the map's own diagnostic attributes (data-motion, data-display,
// data-camera, data-correction), sampled while the page receives several publications, so
// continuity, zoom and turning are measured rather than assumed. Screenshots are FIXTURES.
import {test, expect} from '@playwright/test';
import {movingLive, servePatterns, serveLive, serveMotion, waitForPaint} from './fixtures.mjs';

const LONGFORD_PARK = {latitude: 53.4487, longitude: -2.3095, accuracy: 40};
test.use({permissions: ['geolocation'], geolocation: LONGFORD_PARK});

const map = page => page.locator('.vector-map');
const shot = async (page, name) =>
  page.screenshot({path: test.info().outputPath(`${test.info().project.name}-${name}.png`)});
// lat, lon, metres along the road, heading, presentation time and real page time of one frame.
async function display(page) {
  const [lat, lon, s, bearing, frame, wall] = ((await map(page).getAttribute('data-display')) || ',,,,,').split(',').map(Number);
  return {lat, lon, s, bearing, frame, wall};
}
async function camera(page) {
  const [zoom, lat, lon, pitch, bearing] = ((await map(page).getAttribute('data-camera')) || '0,0,0,0,0').split(',').map(Number);
  return {zoom, lat, lon, pitch, bearing};
}
async function sample(page, seconds, read) {
  const out = [], end = Date.now() + seconds * 1000;
  while (Date.now() < end) { out.push(await read(page)); await page.waitForTimeout(150); }
  return out;
}
const metresApart = (a, b) =>
  Math.hypot((a.lon - b.lon) * Math.cos(a.lat * Math.PI / 180), a.lat - b.lat) * 111195;

async function openAtStopA(page, live = {}, motion = {}) {
  await servePatterns(page);
  await serveMotion(page, motion);
  const startMs = Date.now();
  await serveLive(page, [() => movingLive({startMs, ...live})]);
  await page.goto('/');
  await waitForPaint(page);
  await page.getByRole('button', {name: 'Buses near me'}).click();
  await page.locator('.nearby-stop', {hasText: 'Stop A'}).first().click();
  return startMs;
}

test('a moving bus is drawn at a labelled estimate that moves on, and each report corrects it smoothly', async ({page}) => {
  test.setTimeout(120_000);
  await openAtStopA(page, {wobble: 5});
  const card = page.locator('.bus-card');
  await expect(card.locator('.route-badge')).toHaveText('256');
  await expect(map(page)).toHaveAttribute('data-motion', 'estimated', {timeout: 20_000});
  await expect(card.locator('.bus-card-motion')).toContainText('Estimated position · last report');
  await expect(card.locator('.bus-card-motion')).toContainText('km/h by its recent reports');
  await expect(card.locator('.bus-card-motion')).toContainText('held-out estimates');
  // A bounded run on one machine says so; it is never presented as an always-on service.
  await expect(page.locator('.follow-bar-run')).toContainText('local run · until');
  const seen = await sample(page, 26, display);           // at least two further publications
  const valid = seen.filter(v => Number.isFinite(v.s) && Number.isFinite(v.frame) && Number.isFinite(v.wall));
  const pairs = valid.slice(1).map((v, i) => ({ds: v.s - valid[i].s, dt: (v.wall - valid[i].wall) / 1000,
    dp: (v.frame - valid[i].frame) / 1000})).filter(pair => pair.dt > 0);
  expect(pairs.length, 'enough distinct frames were sampled').toBeGreaterThan(60);
  expect(valid.at(-1).s - valid[0].s, 'it moved on between reports').toBeGreaterThan(100);
  expect(Math.min(...pairs.map(p => p.ds)), 'never drawn backwards while it moves').toBeGreaterThan(-0.5);
  // Each publication re-measures the server's clock only to the second; the page absorbs that
  // at no more than a tenth of a second per second, so the drawn time never steps.
  expect(Math.max(...pairs.map(p => Math.abs(p.dp - p.dt) - 0.1 * p.dt)), 'the presentation clock is never stepped')
    .toBeLessThan(0.02);
  // No jump: every step is explained, over the real time between the two frames, by the bus's
  // 8 m/s (on a clock at most a tenth fast) plus the 15 m/s at which a correction is caught up.
  // A slow software-rendered frame is not a jump; a move without time is.
  const excess = p => p.ds - 25 * p.dt;
  const worst = pairs.reduce((a, p) => (excess(p) > excess(a) ? p : a));
  expect(excess(worst), `no jump between drawn frames (${JSON.stringify(worst)})`).toBeLessThan(3);
  expect(await map(page).getAttribute('data-correction')).toMatch(/^(smooth|hold|none)/);
  await shot(page, 'estimate');
});

test.describe('riding along', () => {
  test.use({reducedMotion: 'reduce'});

  test('the camera follows the drawn bus at a zoom set once, turning the short way', async ({page}) => {
    test.setTimeout(120_000);
    await openAtStopA(page, {wobble: 5});
    await expect(map(page)).toHaveAttribute('data-motion', 'estimated', {timeout: 20_000});
    await page.getByRole('button', {name: 'Ride along with route 256'}).click();
    await expect(map(page)).toHaveAttribute('data-view', 'ride');
    await page.waitForTimeout(800);
    const cams = await sample(page, 22, camera);
    expect(new Set(cams.map(c => c.zoom.toFixed(1))).size, 'the ride framing zoom is set once').toBe(1);
    const turns = cams.slice(1).map((c, i) => Math.abs(((c.bearing - cams[i].bearing + 540) % 360) - 180));
    expect(Math.max(...turns), 'it turns the short way, a little at a time').toBeLessThan(40);
    const [c, d] = [await camera(page), await display(page)];
    expect(metresApart(c, d), 'the camera is on the drawn bus').toBeLessThan(40);
    // The passenger's own zoom is kept through later reports.
    await page.getByRole('button', {name: 'Zoom out'}).click();
    await page.waitForTimeout(1200);
    const chosen = (await camera(page)).zoom;
    await page.waitForTimeout(12_000);
    expect((await camera(page)).zoom, 'the passenger’s zoom survives a new report').toBeCloseTo(chosen, 1);
    await shot(page, 'ride-estimate');
  });
});

test('entering the ride-along goes straight to the bus', async ({page}) => {
  test.setTimeout(90_000);
  await openAtStopA(page);
  await expect(map(page)).toHaveAttribute('data-motion', 'estimated', {timeout: 20_000});
  await page.getByRole('button', {name: 'Ride along with route 256'}).click();
  await expect(map(page)).toHaveAttribute('data-ride', /entering|following/);
  // While riding, nothing invites you to start riding; the card says you are, with a way out.
  await expect(page.getByRole('button', {name: 'Ride along with route 256'})).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Leave the ride-along'})).toHaveCount(1);
  await expect(page.getByRole('button', {name: 'Skip to the bus'})).toHaveCount(0);
  await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 5000});
  await page.waitForTimeout(1200);
  const [c, d] = [await camera(page), await display(page)];
  expect(c.zoom, 'the ride framing is close enough to see the bus').toBeCloseTo(20, 0);
  expect(metresApart(c, d)).toBeLessThan(40);
});

test('a standing bus stays where it reported', async ({page}) => {
  test.setTimeout(90_000);
  await openAtStopA(page, {standing: true});
  await expect(map(page)).toHaveAttribute('data-motion', 'estimated', {timeout: 20_000});
  await expect(map(page)).toHaveAttribute('data-motion-reason', /standing/);
  const seen = await sample(page, 6, display);
  expect(Math.max(...seen.map(v => v.s)) - Math.min(...seen.map(v => v.s)), 'no drift').toBeLessThan(0.5);
  await expect(page.locator('.bus-card-motion')).toContainText('standing at its last reports');
  // Nothing moves, so nothing is redrawn: only the page's own clock, a publication and the
  // card's own re-render prompt the odd frame (a continuous loop would draw about 180).
  const before = Number(await map(page).getAttribute('data-frames'));
  await page.waitForTimeout(3000);
  expect(Number(await map(page).getAttribute('data-frames')) - before, 'no continuous rendering').toBeLessThan(10);
});

test('an estimate is held at its bound once the report is older than it', async ({page}) => {
  test.setTimeout(90_000);
  await openAtStopA(page, {extraAge: 40});
  await expect(page.locator('.bus-card-motion')).toContainText('the most we extrapolate', {timeout: 20_000});
});

test('a report too old to estimate from is shown where it was made, and says why', async ({page}) => {
  test.setTimeout(90_000);
  await openAtStopA(page, {extraAge: 180});
  await page.locator('.exploring summary').click();
  await page.locator('.exploring .board-group', {hasText: 'Old reports'}).locator('.follow-row').first().click();
  await expect(map(page)).toHaveAttribute('data-motion', 'observed', {timeout: 15_000});
  await expect(map(page)).toHaveAttribute('data-motion-reason', /too old/);
  await expect(page.locator('.bus-card-motion')).toContainText('Last reported position');
});

test('a large correction snaps to the new report and says by how much', async ({page}) => {
  test.setTimeout(120_000);
  await openAtStopA(page, {jump: {atMs: Date.now() + 16_000, metres: 450}});
  await expect(map(page)).toHaveAttribute('data-motion', 'estimated', {timeout: 20_000});
  // The jump is not read as speed: the new report is shown where it was made, and the card
  // says the drawn bus was moved by roughly the size of the jump.
  await expect(map(page)).toHaveAttribute('data-correction', /^snap:[3-5]\d\d/, {timeout: 45_000});
  await expect(map(page)).toHaveAttribute('data-motion-reason', /jumped further than a bus travels/);
  await expect(page.locator('.bus-card-motion')).toContainText(/moved [3-5]\d\d m to that report/);
  // Once another report follows, speed is read from after the jump only: its own 29 km/h.
  await expect(map(page)).toHaveAttribute('data-motion', 'estimated', {timeout: 30_000});
  await expect(page.locator('.bus-card-motion')).toContainText(/moving about (2\d|3[0-4]) km\/h/);
});

test('a bus on an unsettled branch stays usable at its reports, with the reason', async ({page}) => {
  test.setTimeout(90_000);
  await openAtStopA(page);
  await expect(map(page)).toHaveAttribute('data-motion', 'estimated', {timeout: 20_000});
  await page.locator('.waiting .follow-row', {hasText: 'every possible branch'}).click();
  await expect(map(page)).toHaveAttribute('data-motion', 'observed', {timeout: 15_000});
  await expect(map(page)).toHaveAttribute('data-motion-reason', /branch is not settled/);
  await expect(page.locator('.bus-card-motion')).toContainText('Last reported position');
  // Choosing another bus is a new drawing: nothing is said to have moved between the two.
  await expect(map(page)).toHaveAttribute('data-correction', 'none');
  await expect(page.locator('.bus-card-motion')).not.toContainText('moved');
});

test('without a published evaluation, nothing is estimated', async ({page}) => {
  test.setTimeout(90_000);
  await openAtStopA(page, {}, {evaluation: null});
  await expect(map(page)).toHaveAttribute('data-motion', 'observed', {timeout: 15_000});
  await expect(map(page)).toHaveAttribute('data-motion-reason', /not been evaluated/);
});

test('reported positions only is the passenger’s choice, and can be undone', async ({page}) => {
  test.setTimeout(90_000);
  await openAtStopA(page);
  await expect(map(page)).toHaveAttribute('data-motion', 'estimated', {timeout: 20_000});
  await page.getByRole('button', {name: 'Show reported positions only'}).click();
  await expect(map(page)).toHaveAttribute('data-motion', 'observed');
  await expect(map(page)).toHaveAttribute('data-motion-reason', /you chose reported positions only/);
  await page.getByRole('button', {name: 'Show estimated movement'}).click();
  await expect(map(page)).toHaveAttribute('data-motion', 'estimated');
});
