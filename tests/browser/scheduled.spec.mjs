// A timetabled time at your stop: the operator's timetable read out, shown only when every
// premise holds, and labelled as not a prediction. FIXTURE data throughout.
import {test, expect} from '@playwright/test';
import {journeyLive, servePatterns, serveLive, waitForPaint} from './fixtures.mjs';

async function openAtStopA(page) {
  await servePatterns(page);
  await serveLive(page, [() => journeyLive()]);
  await page.goto('/');
  await waitForPaint(page);
  await page.getByRole('button', {name: 'Buses near me'}).click();
  await page.locator('.nearby-stop', {hasText: 'Stop A'}).first().click();
  await expect(page.locator('.your-stop-copy strong')).toContainText('Stretford Mall (Stop A)');
}

test('a bus before your stop on one named journey shows the timetabled time there, labelled as the timetable’s', async ({page}) => {
  await openAtStopA(page);
  // FX-COMING is the suggested bus: index 3, before Stop A at index 4, on the 06:49 departure.
  const line = page.locator('.bus-card-scheduled');
  await expect(line).toBeVisible();
  // 06:49:00 BST on 13 September 2026 plus the fixture's 154 s to Stop A is 06:51.
  await expect(line).toHaveAttribute('data-scheduled', '06:51');
  await expect(line).toContainText('Timetabled at your stop 06:51');
  await expect(line).toContainText('not a prediction');
  await expect(line).toContainText('not adjusted for where the bus is');
  await page.getByRole('button', {name: 'Details'}).click();
  await expect(page.locator('.bus-evidence, .bus-card')).toContainText('the 06:49 departure');
  await page.screenshot({path: test.info().outputPath(`${test.info().project.name}-timetabled.png`)});
});

test('a bus already past your stop shows no timetabled time: the schedule there is history', async ({page}) => {
  await openAtStopA(page);
  // FX-PASSED sits at index 9, past Stop A in the timetabled order.
  await page.getByRole('button', {name: /more buses near your stop/i}).click().catch(() => {});
  await page.locator('.follow-row', {hasText: 'FX-PASSED'}).first().click();
  await expect(page.locator('.bus-card')).toContainText('FX-PASSED');
  await expect(page.locator('.bus-card-scheduled')).toHaveCount(0);
});
