// The passenger flows in the built site, on desktop and a 390 px phone.
import {test, expect} from '@playwright/test';
import {journeyLive, liveFromArchive, markerPixels, serveLive, servePatterns, unavailableState} from './fixtures.mjs';

const LONGFORD_PARK = {latitude: 53.4487, longitude: -2.3095, accuracy: 40};
// The vector map must actually settle here; the drawn fallback has its own tests in map.spec.
const mapPainted = page => page.locator('.vector-map[data-map-state="painted"]');
const shot = async (page, name, options = {}) =>
  page.screenshot({path: test.info().outputPath(`${test.info().project.name}-${name}.png`), ...options});

test('live: the map, the status and the stop search are all present', async ({page}) => {
  await serveLive(page, [() => liveFromArchive()]);
  await page.goto('/');
  await expect(page.locator('.follow-badge')).toContainText('LIVE');
  await expect(mapPainted(page)).toBeVisible({timeout: 45_000});
  await expect(page.getByRole('combobox', {name: 'Stop name, street or area'})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Buses near me'})).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/credential/i);
  await expect(page.locator('body')).not.toContainText('nearby stops or waiting times are shown');
  await page.waitForTimeout(1200);
  await shot(page, 'live');
});

test('unavailable: honest copy, the map stays, and the recording is a choice', async ({page}) => {
  await serveLive(page, [() => unavailableState()]);
  await page.goto('/');
  await expect(page.locator('.follow-badge')).toContainText('NOT COLLECTING');
  await expect(page.getByRole('heading', {name: 'Live bus positions are unavailable'})).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/credential/i);
  // Geography stays available even with no vehicles at all.
  await expect(mapPainted(page)).toBeVisible({timeout: 45_000});
  await expect(page.getByRole('combobox', {name: 'Stop name, street or area'})).toBeVisible();
  await page.waitForTimeout(1000);
  await shot(page, 'unavailable');

  await page.getByRole('button', {name: 'Follow a bus in the recording'}).click();
  await expect(page.locator('.follow-badge')).toContainText('ARCHIVE REPLAY');
  await expect(mapPainted(page)).toBeVisible({timeout: 45_000});
  await page.waitForTimeout(1500);
  await shot(page, 'replay');
});

test('offline: the page says so rather than implying the data is current', async ({page}) => {
  await serveLive(page, [() => liveFromArchive()]);
  await page.goto('/');
  await expect(page.locator('.follow-badge')).toContainText('LIVE');
  await page.context().setOffline(true);
  await page.getByRole('button', {name: 'Check for newer positions'}).click();
  await expect(page.locator('.follow-badge')).toContainText('OFFLINE');
  await page.context().setOffline(false);
});

test.describe('location granted', () => {
  // Night map: its road colours are far from the three marker fills, so counting marker pixels
  // cannot be fooled by a paper-coloured road. The day map is checked by eye in the screenshots.
  test.use({permissions: ['geolocation'], geolocation: LONGFORD_PARK, colorScheme: 'dark'});

  test('finds the nearby stops, then You, your stop and a bus are all on the map', async ({page}) => {
    await servePatterns(page);
    await serveLive(page, [() => journeyLive()]);
    await page.goto('/');
    await expect(mapPainted(page)).toBeVisible({timeout: 45_000});
    await page.getByRole('button', {name: 'Buses near me'}).click();
    await expect(page.getByText('Stops near you')).toBeVisible();
    await expect(page.getByText(/accurate to about 40 m/)).toBeVisible();
    const first = page.locator('.nearby-stop').first();
    await expect(first).toContainText(/Moss Road|Stretford/);
    await expect(first).toContainText('straight line');
    await page.waitForTimeout(1500);
    await shot(page, 'nearby-granted', {fullPage: true});

    await page.locator('.nearby-stop', {hasText: 'Stop A'}).first().click();
    await expect(page.locator('.your-stop-copy strong')).toContainText('Stretford Mall');
    await expect(page.locator('.bus-card .route-badge')).toHaveText('256');
    // Look at the map the way a passenger would: with it on screen, then ask for the fit.
    await page.locator('.vector-map').evaluate(el => el.scrollIntoView({block: 'start'}));
    await page.getByRole('button', {name: /Fit journey/}).click({timeout: 10_000});
    await page.waitForTimeout(2000);
    await shot(page, 'your-stop');
    // All three symbols drawn on the rendered map, each in its own colour.
    const drawn = await markerPixels(page, page.locator('.vector-map'));
    test.info().annotations.push({type: 'marker pixels', description: JSON.stringify(drawn)});
    expect(drawn.you, 'You').toBeGreaterThan(15);
    expect(drawn.yourStop, 'Your stop').toBeGreaterThan(15);
    expect(drawn.selectedBus, 'the selected bus').toBeGreaterThan(15);
  });
});

test.describe('location denied', () => {
  test.use({permissions: []});

  test('says so plainly, and the search completes the task by keyboard', async ({page}) => {
    await serveLive(page, [() => liveFromArchive()]);
    await page.goto('/');
    await page.getByRole('button', {name: 'Buses near me'}).click();
    await expect(page.getByText(/Search for your stop instead/)).toBeVisible();

    const search = page.getByRole('combobox', {name: 'Stop name, street or area'});
    await search.focus();
    await search.pressSequentially('stretford mall');
    await expect(page.getByRole('listbox')).toBeVisible();
    await expect(search).toHaveAttribute('aria-expanded', 'true');
    await search.press('ArrowDown');
    await expect(search).toHaveAttribute('aria-activedescendant', /.+/);
    await search.press('Enter');
    await expect(page.locator('.your-stop-copy strong')).toContainText('Stretford Mall');
    await page.waitForTimeout(1500);
    await shot(page, 'denied-search');
  });
});
