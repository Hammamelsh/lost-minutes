// In the street preview a one-finger drag is a head-turn, not a pan: following never stops, the
// bearing turns with the finger and eases back to the road ahead on release. FIXTURE data.
import {test, expect} from '@playwright/test';
import {movingLive, servePatterns, serveLive, serveMotion, waitForPaint} from './fixtures.mjs';

test.use({permissions: ['geolocation'], geolocation: {latitude: 53.4487, longitude: -2.3095, accuracy: 40}});
const map = page => page.locator('.vector-map');
const bearing = async page => Number(((await map(page).getAttribute('data-camera')) || '0,0,0,0,0').split(',')[4]);
const turn = (a, b) => ((b - a + 540) % 360) - 180;   // signed degrees from a to b

test('a drag in the street preview turns the head, keeps following, and eases back', async ({page}) => {
  test.setTimeout(90_000);
  await servePatterns(page); await serveMotion(page);
  const startMs = Date.now();
  await serveLive(page, [() => movingLive({startMs, standing: true})]);   // standing: the road bearing holds still
  await page.goto('/'); await waitForPaint(page);
  await page.getByRole('button', {name: 'Buses near me'}).click();
  await page.locator('.nearby-stop', {hasText: 'Stop A'}).first().click();
  await map(page).evaluate(el => el.scrollIntoView({block: 'start'}));
  await page.getByRole('button', {name: 'Ride along with route 256'}).click();
  await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 10_000});
  await page.getByRole('button', {name: 'Front view'}).click();
  await expect(map(page)).toHaveAttribute('data-ride-camera', 'front');
  await expect(map(page)).toHaveAttribute('data-ride', 'following', {timeout: 5000});
  await page.waitForTimeout(1500);
  const ahead = await bearing(page);

  // Drag a third of the canvas to the right, and hold.
  const box = await page.locator('.vector-map-canvas').boundingBox();
  const x = box.x + box.width * 0.4, y = box.y + box.height * 0.5;
  await page.mouse.move(x, y); await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(x + box.width * 0.33 * i / 10, y); await page.waitForTimeout(25); }
  await page.waitForTimeout(400);
  const held = await bearing(page);
  const look = await map(page).getAttribute('data-look');
  await expect(map(page), 'a head-turn is not exploring: following continues').toHaveAttribute('data-ride', 'following');
  expect(Math.abs(turn(ahead, held)), `turned by ${turn(ahead, held).toFixed(0)}° `).toBeGreaterThan(25);
  await page.screenshot({path: test.info().outputPath(`${test.info().project.name}-head-turn-held.png`)});

  // Release: the view eases back to the road ahead within a couple of seconds.
  await page.mouse.up();
  await expect.poll(async () => Math.abs(turn(ahead, await bearing(page))), {timeout: 4000}).toBeLessThan(6);
  await expect(map(page)).toHaveAttribute('data-ride', 'following');
});
