// The real pedestrian router, no recorded answer: one walking route from Longford Park to
// Stretford Mall (Stop A) from routing.openstreetmap.de, shown in the built page.
//
//   LM_REAL_ROUTING=1 pnpm test:browser tests/browser/walking-real.spec.mjs
//
// It asks the FOSSGIS service once (desktop only), within its one-request-a-second policy. The
// bus positions on the page are FIXTURES; the walking route and the stop are real.
import {test, expect} from '@playwright/test';
import {journeyLive, servePatterns, serveLive, waitForPaint} from './fixtures.mjs';

test.skip(!process.env.LM_REAL_ROUTING, 'set LM_REAL_ROUTING=1 to ask the real walking router once');
test.use({permissions: ['geolocation'], geolocation: {latitude: 53.448712, longitude: -2.309487, accuracy: 30}});

test('a real pedestrian route to a real boarding point, its distance and time in the page', async ({page}, info) => {
  test.skip(info.project.name !== 'desktop', 'one request is enough');
  const answers = [];
  page.on('response', response => {
    if (response.url().includes('routing.openstreetmap.de')) answers.push({url: response.url(), status: response.status()});
  });
  await servePatterns(page);
  await serveLive(page, [() => journeyLive()]);
  await page.goto('/');
  await waitForPaint(page);
  await page.getByRole('button', {name: 'Buses near me'}).click();
  await page.locator('.nearby-stop', {hasText: 'Stop A'}).first().click();
  await page.getByRole('button', {name: 'Show walking route'}).click();
  const guide = page.locator('.walk-guide');
  await expect(guide).toContainText(/\d+ min walk/, {timeout: 20_000});
  await expect(guide).toContainText(/\d+ m to Stretford Mall \(Stop A\)/);
  await expect(page.locator('.vector-map')).toHaveAttribute('data-walk', 'route');
  expect(answers).toHaveLength(1);
  expect(answers[0].status).toBe(200);
  expect(answers[0].url).toContain('-2.3095,53.4487');
  console.log(`real walking route: ${await guide.locator('.walk-answer').innerText()}`);
  await page.screenshot({path: info.outputPath('desktop-real-walking.png')});
});
