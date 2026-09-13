// The Evidence tab's motion evaluation, read from the published held-out evaluation
// (public/data/motion-evaluation.json, built from real captures by scripts/evaluate-motion.mjs).
import {test, expect} from '@playwright/test';

test('the motion evaluation shows held-out errors beside the baseline and replays real journeys', async ({page}) => {
  await page.goto('/');
  await page.getByRole('tab', {name: 'Evidence'}).click();
  const section = page.locator('.motion-evidence');
  await expect(section).toContainText('checked against the reports that followed', {timeout: 20_000});
  await expect(section).toContainText('Scored on (held out)');
  await expect(section.locator('.motion-table tbody tr')).toHaveCount(7);
  // What a passenger sees when a report arrives: how often the estimate went back, and snapped.
  await expect(section.locator('.motion-visible')).toContainText(/went back by more than 35 m \(\d+% at constant speed, \d+% with the earlier eased-speed model\)/);
  await expect(section.locator('.motion-visible')).toContainText(/m on average \(\d+ m at constant speed/);
  await expect(section.locator('.motion-visible')).toContainText(/were over 150 m \(\d+% at constant speed/);
  await expect(section.locator('.motion-notes')).toContainText('cannot check a drawn position between two of them');
  const slider = section.locator('.motion-scrub input');
  await expect(slider).toBeVisible();
  await slider.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(section.locator('.motion-replay-caption')).toContainText('from the report that then arrived');
  await section.scrollIntoViewIfNeeded();
  await page.screenshot({path: test.info().outputPath(`${test.info().project.name}-evidence-motion.png`), fullPage: false});
});
