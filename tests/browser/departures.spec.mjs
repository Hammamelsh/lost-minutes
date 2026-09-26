// The stop's own answer to "when is the next bus?", from the timetable rather than from any bus.
//
// The board and our vehicle matching are separate capabilities and this check keeps them apart:
// a departure is listed whether or not a bus is tracked on it, a tracked bus is named beside a row
// only where it reports that journey's own departure time, and no row ever carries a predicted
// minute. FIXTURE throughout.
import {test, expect} from '@playwright/test';
import {FX, departureBoard, journeyLive, serveDepartures, serveLive, servePatterns,
  waitForPaint} from './fixtures.mjs';

const board = page => page.locator('.departures');
const rows = page => page.locator('.departure-row');

async function openStop(page, {departures = {}} = {}) {
  await servePatterns(page);
  await serveDepartures(page, departures);
  await serveLive(page, [() => journeyLive()]);
  await page.goto(`/?stop=${FX.stopA}`);
  await waitForPaint(page);
  await expect(board(page)).toBeVisible({timeout: 15_000});
}

test('the stop leads with what is timetabled to leave it, each row a scheduled claim', async ({page}) => {
  await openStop(page);
  await expect.poll(() => rows(page).count(), {timeout: 10_000}).toBeGreaterThan(0);
  const first = rows(page).first();
  // Route, destination, the time it is due and how far off that is: the four things asked for.
  await expect(first.locator('.route-pill')).toHaveText('256');
  await expect(first.locator('.departure-copy strong')).toContainText('Piccadilly Gardens');
  await expect(first.locator('.departure-when strong')).toHaveText(/^\d{2}:\d{2}$/);
  await expect(first.locator('.departure-when small')).toHaveText(/in \d+ min|due/);
  // And what kind of claim it is, on every row, not once at the top. Restated 26 September 2026:
  // the row's claim is a word beside its time ("timetabled · in 7 min") rather than a boxed badge,
  // which wrapped every row onto three lines on a phone; the board's heading keeps the badge.
  for (const row of await rows(page).all()) await expect(row.locator('.departure-kind')).toContainText('timetabled');
  await expect(board(page).locator('[data-board-kind]')).toHaveText('Scheduled · not live');
  // Never a prediction, and never adjusted for a bus.
  await expect(board(page)).toContainText('not predictions');
  await expect(board(page)).toContainText('registered timetable');
  await expect(board(page).locator('[data-official-departures]')).toBeVisible();
});

test('the countdown comes from the departure’s own instant, and the rows are in order', async ({page}) => {
  const nowMs = Date.now();
  await openStop(page, {departures: {board: departureBoard({nowMs, atMinutes: [3, 17, 41]})}});
  await expect.poll(() => rows(page).count(), {timeout: 10_000}).toBe(3);
  const at = await rows(page).evaluateAll(list => list.map(el => Number(el.getAttribute('data-at'))));
  expect(at, 'in order, soonest first').toEqual([...at].sort((a, b) => a - b));
  const minutes = at.map(ms => Math.round((ms - nowMs) / 60_000));
  expect(minutes, 'the instants are the ones the timetable implies').toEqual([3, 17, 41]);
});

test('the rows are spaced by the timetable, not by the order they were read in', async ({page}) => {
  // Midnight and the clock changes are settled deterministically in tests/departures.test.mjs,
  // where the moment can be chosen; this is the page doing the same arithmetic on its own clock.
  const nowMs = Date.now();
  await openStop(page, {departures: {board: departureBoard({nowMs, atMinutes: [5, 15, 30]})}});
  await expect.poll(() => rows(page).count(), {timeout: 10_000}).toBe(3);
  const at = await rows(page).evaluateAll(list => list.map(el => Number(el.getAttribute('data-at'))));
  expect(at[2] - at[0], 'twenty-five minutes apart, whichever side of midnight they fall').toBe(25 * 60_000);
});

test('a stop with no published board says so, and does not pretend the timetable is empty', async ({page}) => {
  await openStop(page, {departures: {board: null}});
  await expect(board(page).locator('[data-departures-missing]')).toBeVisible();
  await expect(rows(page)).toHaveCount(0);
  await expect(board(page), 'not "nothing is timetabled", which would be a claim').not.toContainText('Nothing more is timetabled');
  // The official board is still one tap away, and is labelled as the official one.
  await expect(board(page).locator('[data-official-departures]')).toContainText('official');
});

test('operating rules that could not be read are said, not read as an empty timetable', async ({page}) => {
  await servePatterns(page);
  await serveLive(page, [() => journeyLive()]);
  await page.route('**/data/departure-rules.json*', route => route.fulfill({status: 500, body: 'no'}));
  await page.route('**/data/departures/*.json*', route => route.fulfill({json: departureBoard()}));
  await page.goto(`/?stop=${FX.stopA}`);
  await waitForPaint(page);
  await expect(board(page).locator('[data-departures-unreadable]')).toBeVisible({timeout: 15_000});
  await expect(board(page)).not.toContainText('Nothing more is timetabled');
  await expect(rows(page)).toHaveCount(0);
});

test('a departure is listed with no bus on it, and no bus is given a time it did not report', async ({page}) => {
  // The fixture's live buses are on FX-* journeys with no scheduled departure published, so none
  // of them can be tied to a row. The rows are still there: a timetable does not need a bus.
  await openStop(page);
  await expect.poll(() => rows(page).count(), {timeout: 10_000}).toBeGreaterThan(0);
  await expect(page.locator('.departure-bus'), 'no row claims a vehicle it cannot name').toHaveCount(0);
  // And nothing on the tracked-bus board below has grown a departure time.
  const waiting = page.locator('.waiting');
  await expect(waiting).toContainText('by their last report');
  await expect(waiting.locator('.departure-when')).toHaveCount(0);
});
