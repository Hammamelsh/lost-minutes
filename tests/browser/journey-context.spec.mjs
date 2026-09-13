// The active journey (stop, service, bus) survives a reload and travels in a link. FIXTURE buses
// and timetable on real NaPTAN stops around Stretford Mall. A restored bus is chosen again only as
// the same vehicle on the same journey; otherwise the page says so and chooses nothing in its
// place. Neither the address nor the device's record ever holds where the passenger is.
import {test, expect} from '@playwright/test';
import {journeyLive, servePatterns, serveLive} from './fixtures.mjs';

const LONGFORD_PARK = {latitude: 53.4487, longitude: -2.3095, accuracy: 40};
const STOP_A = '1800SJ00811';
const MAIN = 'BNML|256|inbound|Piccadilly Gardens';
const STORE = 'lost-minutes.journey.v1';
const pressedRow = page => page.locator('.waiting .follow-row[aria-pressed="true"]');

async function open(page, path = '/') {
  await servePatterns(page);
  await serveLive(page, [() => journeyLive()]);
  await page.goto(path);
  await expect(page.locator('.vector-map[data-map-state="painted"]')).toBeVisible({timeout: 45_000});
}

test.describe('with location', () => {
  test.use({permissions: ['geolocation'], geolocation: LONGFORD_PARK});

  test('the chosen stop, service and bus survive a reload; the address names them, never your location', async ({page}) => {
    await open(page);
    await page.getByRole('button', {name: 'Buses near me'}).click();
    await page.locator('.nearby-stop', {hasText: 'Stop A'}).first().click();
    await page.locator('.service-chip', {hasText: 'Piccadilly Gardens'}).click();
    await page.locator('.waiting .follow-row', {hasText: '3 stops before yours'}).click();
    await expect(pressedRow(page)).toContainText('3 stops before yours');
    await expect.poll(() => new URL(page.url()).searchParams.get('bus')).toBe('BNML|FX-COMING');
    const url = new URL(page.url());
    expect(url.searchParams.get('stop')).toBe(STOP_A);
    expect(url.searchParams.get('service')).toBe(MAIN);
    expect(url.search, 'no location in the address').not.toMatch(/lat|lon|here|53\.44|2\.309/);
    const kept = await page.evaluate(key => localStorage.getItem(key), STORE);
    expect(kept, 'the device keeps the journey').toContain('FX-COMING');
    expect(kept, 'and no coordinates at all').not.toMatch(/"lat"|"lon"|53\.4|-2\.3/);

    await page.reload();
    await expect(page.locator('.vector-map[data-map-state="painted"]')).toBeVisible({timeout: 45_000});
    await expect(page.locator('.your-stop')).toContainText('Stop A');
    await expect(page.locator('.service-chip[aria-pressed="true"]')).toContainText('Piccadilly Gardens');
    await expect(pressedRow(page)).toContainText('3 stops before yours', {timeout: 15_000});
    await expect(page.locator('.restore-notice')).toHaveCount(0);
    await page.screenshot({path: test.info().outputPath(`${test.info().project.name}-journey-restored.png`)});
  });
});

test('a shared link opens its stop and service; a bus it names that has gone is said so, and no other bus is chosen for it', async ({page}) => {
  await open(page, `/?stop=${STOP_A}&service=${encodeURIComponent(MAIN)}&bus=${encodeURIComponent('BNML|FX-GONE')}`);
  await expect(page.locator('.your-stop')).toContainText('Stop A');
  await expect(page.locator('.service-chip[aria-pressed="true"]')).toContainText('Piccadilly Gardens');
  const notice = page.locator('.restore-notice');
  await expect(notice).toContainText('is not in the latest positions', {timeout: 15_000});
  await expect(notice).toContainText('No other bus has been chosen in its place');
  // Buses are coming, and listed; none is chosen until the passenger says so.
  await expect(page.locator('.waiting .follow-row')).not.toHaveCount(0);
  await expect(pressedRow(page)).toHaveCount(0);
  await expect(page.locator('article.bus-card')).toHaveCount(0);
  await page.screenshot({path: test.info().outputPath(`${test.info().project.name}-journey-gone.png`), fullPage: true});
  await page.getByRole('button', {name: 'Show the first bus coming to your stop'}).click();
  await expect(pressedRow(page)).toContainText('3 stops before yours');
  await expect(notice).toHaveCount(0);
});

test('a bus this device remembers, now on another journey, is not chosen again unless the passenger asks', async ({page}) => {
  const saved = {v: 1, stopId: STOP_A, serviceKey: null, savedAt: Date.now(),
    bus: {key: 'BNML|FX-COMING', operator: 'BNML', vehicle: 'FX-COMING', route: '256', direction: 'outbound',
      journeyRef: 'FX-EARLIER', destination: 'Stretford', observedAtMs: Date.now() - 600_000}};
  await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [STORE, JSON.stringify(saved)]);
  await open(page);
  await expect(page.locator('.your-stop')).toContainText('Stop A');
  await expect(page.locator('.restore-notice')).toContainText('is now reporting another journey', {timeout: 15_000});
  await expect(pressedRow(page)).toHaveCount(0);
  await page.getByRole('button', {name: 'Follow it on its new journey'}).click();
  await expect(pressedRow(page)).toContainText('3 stops before yours');
});
