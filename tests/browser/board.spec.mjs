// The stop board answers "when?" with what is true: tracked buses by their last report, in stops
// and an age; no arrival minutes until an evaluation passes; the operator's own live board one
// tap away, addressed by the stop's ATCO code. Getting there comes after what leaves from here.
// FIXTURE timetable on the real stop catalogue, in Chromium at desktop and phone size.
import {test, expect} from '@playwright/test';
import {journeyLive, servePatterns, serveLive, waitForPaint} from './fixtures.mjs';

const LONGFORD_PARK = {latitude: 53.4487, longitude: -2.3095, accuracy: 40};
test.use({permissions: ['geolocation'], geolocation: LONGFORD_PARK});

test('the board says how a tracked bus is placed, links the official live board for this very stop, and puts the walk after it', async ({page}) => {
  await servePatterns(page);
  await serveLive(page, [() => journeyLive()]);
  await page.goto('/');
  await waitForPaint(page);
  await page.getByRole('button', {name: 'Buses near me'}).click();
  await page.locator('.nearby-stop', {hasText: 'Stop A'}).first().click();
  const when = page.locator('.waiting [data-board-when]');
  await expect(when).toContainText('Tracked buses are shown by their last report');
  await expect(when).toContainText(/no arrival minutes here yet/i);
  const official = when.locator('[data-official-departures]');
  await expect(official).toHaveAttribute('href', 'https://tfgm.com/public-transport/bus/stops/1800SJ00811');
  await expect(official).toHaveAttribute('target', '_blank');
  await expect(official).toContainText('official');
  // A coming bus is a tracked bus, placed in stops and an age: never minutes.
  const row = page.locator('.waiting .follow-row').first();
  await expect(row).toContainText('tracked ·');
  await expect(row).toContainText(/stops? before yours|near your stop/);
  await expect(row).not.toContainText(/\d+ min\b/);
  // The service chips count tracked buses, not "buses".
  await expect(page.locator('.service-chip').first()).toContainText(/tracked bus/);
  // Getting there follows the board, with the walk guide's hand-offs still there.
  const order = await page.evaluate(() => {
    const all = [...document.querySelectorAll('*')];
    return {waiting: all.indexOf(document.querySelector('.waiting')), walk: all.indexOf(document.querySelector('.getting-there .walk-guide')), card: all.indexOf(document.querySelector('#lm-bus-card'))};
  });
  expect(order.walk, 'the walk guide is rendered').toBeGreaterThan(0);
  expect(order.walk).toBeGreaterThan(order.waiting);
  expect(order.card).toBeGreaterThan(order.walk);
  await expect(page.locator('.getting-there .walk-guide')).toContainText(/Walk there|Walking directions/);
  await expect(page.locator('.getting-there').getByRole('link', {name: /Google Maps/})).toBeVisible();
});
