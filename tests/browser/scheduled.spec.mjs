// A timetabled time at your stop: the operator's timetable read out, shown only when every
// premise holds, and labelled as not a prediction. FIXTURE data throughout.
import {test, expect} from '@playwright/test';
import {journeyLive, servePatterns, serveLive, waitForPaint} from './fixtures.mjs';

// "Buses near me" needs a position; without one no nearby stop renders and Stop A cannot be
// chosen. The same fix the walking spec uses, in Longford Park.
test.use({permissions: ['geolocation'], geolocation: {latitude: 53.448712, longitude: -2.309487, accuracy: 30}});

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
  // FX-COMING is the suggested bus: index 3, before Stop A at index 6, on the 06:49 departure.
  const line = page.locator('.bus-card-scheduled');
  await expect(line).toBeVisible();
  // 06:49:00 BST on 13 September 2026 plus the fixture's 247 s to Stop A is 06:53:07, shown 06:53.
  // (A first draft said 06:51 from a misread stop index; the page had it right.)
  await expect(line).toHaveAttribute('data-scheduled', '06:53');
  await expect(line).toContainText('Timetabled at your stop 06:53');
  await expect(line).toContainText('not a prediction');
  await expect(line).toContainText('not adjusted for where the bus is');
  // The named journey sits in the evidence, behind "How we know this".
  await page.getByRole('button', {name: 'Details'}).click();
  await page.locator('.bus-evidence-toggle summary').click();
  await expect(page.locator('.bus-evidence')).toContainText('the 06:49 departure');
  await page.screenshot({path: test.info().outputPath(`${test.info().project.name}-timetabled.png`)});
});

test('a bus already past your stop shows no timetabled time: the schedule there is history', async ({page}) => {
  await openAtStopA(page);
  // FX-PASSED sits at index 9, past Stop A in the timetabled order, folded under "More buses".
  // Rows show route and destination, never the vehicle id; a passed bus carries standing-passed.
  await page.locator('details.exploring summary').click();
  await page.locator('.follow-row.standing-passed').first().click();
  await expect(page.locator('.bus-card')).toContainText('already past');
  await expect(page.locator('.bus-card-scheduled')).toHaveCount(0);
});
