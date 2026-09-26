// The private preview of the view from above (docs/PHOTO_3D_PREVIEW.md): the same app at /preview/,
// which the server serves only behind a password (deploy/Caddyfile; deploy/validate.sh checks the
// lock), with the server's offer read from /preview/photo3d.json. Here the static server has no
// password, so what is checked is the page's side: the public page never asks for the offer, and the
// preview says what it is and offers the view only where the offer exists. FIXTURE data throughout.
import {test, expect} from '@playwright/test';
import {fleetLive, servePatterns, serveLive, serveMotion, waitForPaint} from './fixtures.mjs';

const OFFER = '**/preview/photo3d.json*';
const offer = {schemaVersion: 1, public: false, note: 'FIXTURE',
  photo3d: {provider: 'sample', tilesetUrl: 'https://fixture.invalid/tileset.json', attribution: 'FIXTURE: a sample tileset', note: 'FIXTURE'}};

async function serve(page) {
  await servePatterns(page);
  await serveMotion(page, {evaluation: null});
  const start = Date.now() - 90_000;
  await serveLive(page, [() => fleetLive({nowMs: Date.now(), startMs: start, count: 3, spacing: 120, roads: true})]);
}

async function openExplore(page) {
  const link = page.locator('[data-try-ride-link]');
  if (await link.isVisible()) await link.click();
  await expect(page.locator('.try-ride')).toBeVisible();
}

test('the public page never asks for the private offer, and offers no view from above without it', async ({page}) => {
  await serve(page);
  const asked = [];
  page.on('request', request => { if (request.url().includes('/preview/')) asked.push(request.url()); });
  await page.route(OFFER, route => route.fulfill({json: offer}));
  await page.goto('/');
  await waitForPaint(page);
  await openExplore(page);
  await page.waitForTimeout(1500);
  expect(asked, 'no request under /preview/ from the public page').toEqual([]);
  await expect(page.locator('.preview-banner')).toHaveCount(0);
  await expect(page.locator('[data-above-entry]')).toHaveCount(0);
});

test('the preview says it is private, reads the offer, and offers the view from above', async ({page}) => {
  await serve(page);
  await page.route(OFFER, route => route.fulfill({json: offer, headers: {'cache-control': 'no-store'}}));
  await page.goto('/preview/');
  await waitForPaint(page);
  const banner = page.locator('.preview-banner');
  await expect(banner).toContainText('Private preview');
  await expect(banner).toHaveAttribute('data-preview', 'sample');
  await expect(banner).toContainText('It is not public');
  // The wordmark keeps the passenger in the preview; leaving is its own link.
  await expect(page.locator('.masthead .brand')).toHaveAttribute('href', '/preview/');
  await expect(banner.getByRole('link', {name: 'Leave the preview'})).toHaveAttribute('href', '/');
  await openExplore(page);
  await expect(page.locator('[data-above-entry]')).toBeVisible();
  await page.screenshot({path: test.info().outputPath(`${test.info().project.name}-preview.png`)});
});

test('the preview with no offer on the server says so, and offers nothing', async ({page}) => {
  await serve(page);
  await page.route(OFFER, route => route.fulfill({status: 404, body: 'not found'}));
  await page.goto('/preview/');
  await waitForPaint(page);
  const banner = page.locator('.preview-banner');
  await expect(banner).toHaveAttribute('data-preview', 'none');
  await expect(banner).toContainText('No 3D imagery is configured');
  await openExplore(page);
  await expect(page.locator('[data-above-entry]')).toHaveCount(0);
});
