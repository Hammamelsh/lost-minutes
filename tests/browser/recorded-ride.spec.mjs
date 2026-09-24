// A recorded ride: offered from Try Ride-along when nothing live suits, badged as a recording on the
// bar, the handle, the panel and the ride card, started straight into the ride on its own bus,
// replayed at its own spacing, shared as a link that reopens the recording, never written into the
// journey stores, and left by one action that brings the live feed back. FIXTURE data: a ride file
// cut the way scripts/make-recorded-ride.mjs cuts one, from the fixture's moving bus.
import {test, expect} from '@playwright/test';
import {journeyLive, movingLive, servePatterns, serveLive, serveMotion, unavailableState, waitForPaint} from './fixtures.mjs';

const RIDE_ID = 'fx-ride';
const summary = {id: RIDE_ID, title: '256 to Piccadilly Gardens', operator: 'BNML', vehicle: 'FX-MOVING', route: '256',
  direction: 'inbound', destination: 'Piccadilly_Gardens', recordedOn: '13 September 2026', from: '2026-09-13T11:00:00.000Z',
  fromLocal: '12:00', toLocal: '12:02', seconds: 120, reports: 13, file: `/data/rides/${RIDE_ID}.json`};

/** Thirteen publications ten seconds apart of the fixture's bus moving at 8 m/s, as a ride file. */
function fixtureRide() {
  const base = Date.parse(summary.from);
  const publications = [];
  for (let i = 0; i < 13; i++) {
    const nowMs = base + i * 10_000;
    const live = movingLive({nowMs, startMs: base - 60_000, delay: 6});
    const vehicle = live.vehicles.find(v => v.vehicle === 'FX-MOVING');
    publications.push({receivedAtMs: nowMs + 300, publishedAt: live.publishedAt, publishedAtMs: live.publishedAtMs,
      trailSources: vehicle.trail?.length ? [0] : [], vehicle});
  }
  const {vehicles, publishedAt, publishedAtMs, trailSources, ...envelope} = journeyLive();
  void vehicles; void publishedAt; void publishedAtMs; void trailSources;
  return {schemaVersion: 1, ...summary, journeyRef: 'FX-MOVING-J', origin: 'Fixture', to: new Date(base + 120_300).toISOString(),
    basis: 'FIXTURE', sources: ['f'.repeat(64)], envelope, publications};
}

async function serveRecording(page) {
  await page.route('**/data/rides/index.json*', route => route.fulfill({json: {schemaVersion: 1, rides: [summary]}}));
  await page.route(`**/data/rides/${RIDE_ID}.json*`, route => route.fulfill({json: fixtureRide()}));
  // Sharing is checked through the clipboard: the share sheet is stood down, the copy is kept.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', {value: undefined, configurable: true});
    Object.defineProperty(navigator, 'clipboard', {value: {writeText: text => {window.__copied = text; return Promise.resolve()}}, configurable: true});
  });
}

const badge = page => page.locator('.follow-badge');
const map = page => page.locator('.vector-map');

test('with no live feed, the recording is offered, rides its own bus, is badged everywhere and is left by one action', async ({page}) => {
  await servePatterns(page);
  await serveMotion(page);
  await serveRecording(page);
  await serveLive(page, [() => unavailableState()]);
  await page.goto('/');
  await waitForPaint(page);
  await expect(badge(page)).toContainText('NOT COLLECTING');
  const section = page.locator('.try-ride');
  await expect(section).toHaveAttribute('data-rides', 'offline');
  await expect(section.locator('button[data-ride-bus]')).toHaveCount(0);
  const offer = section.locator(`button[data-ride-recording="${RIDE_ID}"]`);
  await expect(offer).toContainText('Watch a recorded ride');
  await expect(offer).toContainText('13 September 2026, 12:00 · 2 min');
  await expect(offer).toContainText('a recording, not live');
  await offer.click();
  // Badged as a recording on the bar, said at the top of the panel, and the ride begins on its bus.
  await expect(badge(page)).toContainText('RECORDED RIDE', {timeout: 10_000});
  await expect(page.locator('.follow-bar-when')).toContainText('13 September 2026, 12:00 · not live');
  await expect(page.locator('.recording-note')).toContainText('A recording, not live.');
  await expect(page.locator('#lm-bus-card')).toHaveAttribute('data-vehicle', 'FX-MOVING', {timeout: 10_000});
  await expect(map(page)).toHaveAttribute('data-ride', /entering|following/, {timeout: 15_000});
  await expect(page.locator('.ride-card [data-ride-recording-label]')).toContainText('Recording · 13 September 2026');
  // Replayed: the drawn bus moves as the publications come in at their own spacing.
  const at = async () => (await map(page).getAttribute('data-display')).split(',').slice(0, 2).map(Number);
  const before = await at();
  await expect.poll(async () => {const now = await at(); return Math.hypot(now[0] - before[0], now[1] - before[1]) * 111_195}, {timeout: 25_000})
    .toBeGreaterThan(20);
  // Nothing of it is remembered as a journey, and the address names the recording, not the bus.
  expect(await page.evaluate(() => sessionStorage.getItem('lost-minutes.journey.session.v1'))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('lost-minutes.journey.v1'))).toBeNull();
  expect(new URL(page.url()).search).toBe(`?ride=${RIDE_ID}`);
  // One action brings the live feed back, and the recording's bus is let go rather than left "missing".
  await page.getByRole('button', {name: 'Exit ride-along'}).click();
  await page.locator('[data-leave-recording]').click();
  await expect(badge(page)).toContainText('NOT COLLECTING', {timeout: 10_000});
  await expect(page.locator('#lm-bus-card')).toHaveCount(0);
  await expect(page.locator('.recording-note')).toHaveCount(0);
  expect(new URL(page.url()).search).toBe('');
});

test('a shared link opens the recording itself; the share from inside it copies that link', async ({page}) => {
  await servePatterns(page);
  await serveMotion(page);
  await serveRecording(page);
  await serveLive(page, [() => journeyLive()]);
  await page.goto(`/?ride=${RIDE_ID}`);
  await waitForPaint(page);
  await expect(badge(page)).toContainText('RECORDED RIDE', {timeout: 10_000});
  await expect(page.locator('#lm-bus-card')).toHaveAttribute('data-vehicle', 'FX-MOVING', {timeout: 10_000});
  await expect(map(page)).toHaveAttribute('data-ride', /entering|following/, {timeout: 15_000});
  await page.getByRole('button', {name: 'Exit ride-along'}).click();
  await page.locator('[data-share-bus]').click();
  await expect(page.locator('[data-share-copied]')).toContainText('opens this recording');
  const copied = await page.evaluate(() => window.__copied);
  expect(copied.endsWith(`/?ride=${RIDE_ID}`), copied).toBe(true);
  // The live feed is not polled under a recording: the one publication served was the first load.
  await page.waitForTimeout(4000);
  await expect(badge(page)).toContainText('RECORDED RIDE');
});

test('the recorded vehicle live right now on another journey does not stop the recording being ridden', async ({page}) => {
  await servePatterns(page);
  await serveMotion(page);
  await serveRecording(page);
  // The live feed carries FX-MOVING itself, on a different journey, as the real 163's bus was on
  // the morning of 24 September 2026: the page pinned the live one and paused the ride.
  const startMs = Date.now();
  await serveLive(page, [() => {const live = movingLive({startMs}); for (const v of live.vehicles) if (v.vehicle === 'FX-MOVING') v.journeyRef = 'FX-OTHER-J'; return live;}]);
  await page.goto(`/?ride=${RIDE_ID}`);
  await waitForPaint(page);
  await expect(badge(page)).toContainText('RECORDED RIDE', {timeout: 10_000});
  await expect(page.locator('#lm-bus-card')).toHaveAttribute('data-vehicle', 'FX-MOVING', {timeout: 10_000});
  await expect(map(page)).toHaveAttribute('data-ride', /entering|following/, {timeout: 15_000});
  await page.waitForTimeout(3000);
  await expect(map(page), 'ridden, not paused for a change of journey').toHaveAttribute('data-ride', 'following');
  await expect(page.locator('#lm-bus-card')).not.toContainText('another journey');
});

test('with live buses the recording follows the live rides, and a link to a recording that is not there says so', async ({page}) => {
  await servePatterns(page);
  await serveMotion(page);
  await serveRecording(page);
  await page.route('**/data/rides/no-such-ride.json*', route => route.fulfill({status: 404, body: 'no'}));
  await serveLive(page, [() => journeyLive()]);
  await page.goto('/?ride=no-such-ride');
  await waitForPaint(page);
  await expect(badge(page)).toContainText('LIVE');
  const section = page.locator('.try-ride');
  await expect(section).toHaveAttribute('data-rides', 'ready', {timeout: 15_000});
  await expect(section.locator('.follow-hint.warn')).toContainText('could not be loaded');
  // Order: the live rides first, the recording after them.
  const rows = section.locator('button[data-ride-bus], button[data-ride-recording]');
  await expect(rows).toHaveCount(3);
  await expect(rows.last()).toHaveAttribute('data-ride-recording', RIDE_ID);
});
