// Journey state (docs/JOURNEY_STATE.md), on FIXTURE buses and timetable at real NaPTAN stops
// around Stretford Mall: a link wins, the tab restores, the device only offers; New journey clears
// and nothing cleared comes back; Back and Forward apply the address; a stop change lets go of a
// bus that does not serve the new stop and says so; a filter never hides buses silently; and a
// chosen bus that is not coming to the stop gets a compact card, not the full answer.
import {test, expect} from '@playwright/test';
import {journeyLive, servePatterns, serveLive, waitForPaint} from './fixtures.mjs';

const LONGFORD_PARK = {latitude: 53.4487, longitude: -2.3095, accuracy: 40};
const STOP_A = '1800SJ00811', STOP_E = '1800SJ00081';
const MAIN = 'BNML|256|inbound|Piccadilly Gardens';
const STORE = 'lost-minutes.journey.v1', SESSION = 'lost-minutes.journey.session.v1', RECENTS = 'lost-minutes.recents.v1';
const pressedRow = page => page.locator('.waiting .follow-row[aria-pressed="true"]');
const search = page => new URL(page.url()).search;

async function open(page, path = '/') {
  await servePatterns(page);
  await serveLive(page, [() => journeyLive()]);
  await page.goto(path);
  await waitForPaint(page);
}
const stores = page => page.evaluate(([a, b, c]) => ({local: localStorage.getItem(a), session: sessionStorage.getItem(b), recents: localStorage.getItem(c)}), [STORE, SESSION, RECENTS]);
const nearby = (page, text) => page.locator('.nearby-stop', {hasText: text}).first();

test.describe('with location', () => {
  test.use({permissions: ['geolocation'], geolocation: LONGFORD_PARK});

  test('a stop chosen is pushed, remembered as recent, and kept by the tab; New journey clears everything and nothing comes back', async ({page}) => {
    await open(page);
    await page.getByRole('button', {name: 'Buses near me'}).click();
    await nearby(page, 'Stop A').click();
    await expect(page.locator('.your-stop')).toContainText('Stop A');
    expect(search(page)).toBe(`?stop=${STOP_A}`);
    await page.locator('.waiting .follow-row', {hasText: '3 stops before yours'}).click();
    await expect.poll(() => new URL(page.url()).searchParams.get('bus')).toBe('BNML|FX-COMING|256|inbound|FX-FX-COMING');
    let kept = await stores(page);
    expect(kept.session, 'the tab holds the journey').toContain('FX-COMING');
    expect(kept.local, 'and so does the device').toContain('FX-COMING');
    expect(kept.recents, 'a deliberate choice is a recent').toContain(STOP_A);

    // The same tab, reloaded: restored silently, the address unchanged, no chip and no note.
    await page.reload();
    await waitForPaint(page);
    await expect(page.locator('.your-stop')).toContainText('Stop A');
    await expect(pressedRow(page)).toContainText('3 stops before yours', {timeout: 15_000});
    await expect(page.locator('[data-continue]')).toHaveCount(0);
    await expect(page.locator('.restore-notice')).toHaveCount(0);

    // New journey: home, bare address, both journey stores empty; recents stay.
    await page.locator('[data-new-journey]').click();
    await expect(page.locator('.your-stop.unset')).toBeVisible();
    expect(search(page)).toBe('');
    kept = await stores(page);
    expect(kept.local).toBeNull();
    expect(kept.session).toBeNull();
    expect(kept.recents).toContain(STOP_A);
    await expect(page.locator('[data-recents]')).toContainText('Stretford Mall');
    await expect(page.locator('[data-continue]')).toHaveCount(0);
    await page.screenshot({path: test.info().outputPath(`${test.info().project.name}-home-after-new-journey.png`), fullPage: true});
    // Nothing cleared resurrects: a reload and three publications later the address is still bare.
    await page.reload();
    await waitForPaint(page);
    await page.waitForTimeout(3500);
    expect(search(page)).toBe('');
    await expect(page.locator('.your-stop.unset')).toBeVisible();
    await expect(page.locator('[data-continue]')).toHaveCount(0);
    // The home may suggest a bus on a route; nothing is chosen.
    await expect(page.locator('article.bus-card[data-selection="active"]')).toHaveCount(0);
    await expect(page.locator('article.bus-card[data-selection="absent"]')).toHaveCount(0);
  });

  test('a fresh tab only offers the device’s journey; Continue takes it up with its filter and bus', async ({page}) => {
    const saved = {v: 1, stopId: STOP_A, serviceKey: MAIN, savedAt: Date.now() - 30 * 60_000,
      bus: {key: 'BNML|FX-COMING', operator: 'BNML', vehicle: 'FX-COMING', route: '256', direction: 'inbound',
        journeyRef: 'FX-FX-COMING', destination: 'Piccadilly_Gardens', observedAtMs: Date.now() - 600_000}};
    // Planted once for this tab, so that after New journey a reload cannot re-plant it.
    await page.addInitScript(([key, value]) => {
      if (!sessionStorage.getItem('planted')) {localStorage.setItem(key, value); sessionStorage.setItem('planted', '1')}
    }, [STORE, JSON.stringify(saved)]);
    await open(page);
    await expect(page.locator('.your-stop.unset')).toBeVisible();
    await expect(page.locator('[data-continue]')).toContainText('Continue · Stretford Mall (Stop A)');
    await expect(page.locator('[data-continue]')).toContainText('256 to Piccadilly Gardens');
    await page.waitForTimeout(2500);
    expect(search(page), 'an offer is never written to the address').toBe('');
    expect((await stores(page)).session, 'nor to the tab').toBeNull();
    await page.screenshot({path: test.info().outputPath(`${test.info().project.name}-home-offer.png`), fullPage: true});
    await page.locator('.continue-chip').click();
    await expect(page.locator('.your-stop')).toContainText('Stop A');
    await expect(page.locator('.service-chip[aria-pressed="true"]')).toContainText('Piccadilly Gardens');
    await expect(pressedRow(page)).toContainText('3 stops before yours', {timeout: 15_000});
    await expect(page.locator('.restore-notice')).toHaveCount(0);
    expect(new URL(page.url()).searchParams.get('stop')).toBe(STOP_A);
    // Forgetting the offer from the home screen is New journey.
    await page.locator('[data-new-journey]').click();
    await page.reload();
    await waitForPaint(page);
    await expect(page.locator('[data-continue]')).toHaveCount(0);
    expect((await stores(page)).local).toBeNull();
  });

  test('changing stop keeps the chosen bus only where it calls, says so where it does not, and Back and Forward apply the address', async ({page}) => {
    await open(page);
    await page.getByRole('button', {name: 'Buses near me'}).click();
    await nearby(page, 'Stop A').click();
    await page.locator('.waiting .follow-row', {hasText: '3 stops before yours'}).click();
    await expect(pressedRow(page)).toContainText('3 stops before yours');
    // Stop E is on the same pattern, one stop on: the bus is kept, the filter cleared.
    await page.getByRole('button', {name: 'Change'}).click();
    await nearby(page, 'Stop E').click();
    await expect(page.locator('.your-stop')).toContainText('Stop E');
    await expect(pressedRow(page)).toContainText('4 stops before yours');
    await expect(page.locator('.restore-notice')).toHaveCount(0);
    expect(new URL(page.url()).searchParams.get('bus')).toBe('BNML|FX-COMING|256|inbound|FX-FX-COMING');
    // Stop F is on the branch only: the bus does not call there, so it is let go, and the reason said.
    await page.getByRole('button', {name: 'Change'}).click();
    await nearby(page, 'Stop F').click();
    await expect(page.locator('.your-stop')).toContainText('Stop F');
    await expect(page.locator('.restore-notice')).toContainText('does not call at Stretford Public Hall (Stop F), so it is no longer chosen');
    await expect(pressedRow(page)).toHaveCount(0);
    await expect(page.locator('article.bus-card[data-vehicle="FX-COMING"]')).toHaveCount(0);
    expect(new URL(page.url()).searchParams.get('bus')).toBeNull();
    await page.screenshot({path: test.info().outputPath(`${test.info().project.name}-stop-change-released.png`), fullPage: true});
    // Back: Stop E with the bus, as the address had it. Back again: Stop A. Forward: Stop E.
    await page.goBack();
    await expect(page.locator('.your-stop')).toContainText('Stop E');
    await expect(pressedRow(page)).toContainText('4 stops before yours', {timeout: 15_000});
    await page.goBack();
    await expect(page.locator('.your-stop')).toContainText('Stop A');
    await page.goForward();
    await expect(page.locator('.your-stop')).toContainText('Stop E');
    await expect(pressedRow(page)).toContainText('4 stops before yours', {timeout: 15_000});
    const recents = JSON.parse((await stores(page)).recents);
    expect(recents.map(r => r.stopId).slice(0, 3), 'recents are deliberate choices, latest first').toEqual(['1800SJ00091', STOP_E, STOP_A]);
  });

  test('a filter never hides buses silently, and a chosen bus that is not coming gets a compact card', async ({page}) => {
    await open(page);
    await page.getByRole('button', {name: 'Buses near me'}).click();
    await nearby(page, 'Stop A').click();
    await expect(page.locator('.waiting .follow-row')).not.toHaveCount(0);
    // The branch filter keeps the unresolved bus (coming on every branch) and hides the one placed
    // on the main pattern; the count hidden is said under the list, never dropped silently.
    await page.locator('.service-chip', {hasText: 'Chester Road'}).click();
    await expect(page.locator('.service-chip[aria-pressed="true"]')).toHaveAccessibleName(/^Clear filter: 256/);
    await expect(page.locator('.waiting .follow-row', {hasText: '3 stops before yours'})).toHaveCount(0);
    const more = page.locator('.waiting [data-clear-filter]');
    await expect(more).toContainText('Show all services · 1 more coming or possibly coming on other services');
    await page.screenshot({path: test.info().outputPath(`${test.info().project.name}-filter-hides.png`), fullPage: true});
    await more.click();
    await expect(page.locator('.service-chip[aria-pressed="true"]')).toHaveCount(0);
    await expect(page.locator('.waiting .follow-row', {hasText: '3 stops before yours'})).toBeVisible();
    // A filter that empties the list says so in the empty state itself, with the same way out.
    await page.locator('.service-chip', {hasText: 'Chester Road'}).click();
    await page.locator('.waiting .follow-row').first().click();
    await expect(page.locator('.service-chip[aria-pressed="true"]')).toHaveCount(1);
    await page.locator('.service-chip[aria-pressed="true"]').click();
    await expect(page.locator('.service-chip[aria-pressed="true"]')).toHaveCount(0);
    // A bus reported nearby that does not serve the stop: chosen, it is said so in a short card.
    await page.locator('.nearby-reports .follow-row').first().click();
    const card = page.locator('article.bus-card');
    await expect(card).toHaveClass(/explored/);
    // The fixture's nearby bus has no timetable held, so its standing is "unknown", not "not for stop".
    await expect(card).toContainText(/Does not serve your stop|Not confirmed for your stop/);
    await expect(card.locator('.distance-lines')).toHaveCount(0);
    await expect(card.locator('.claims')).toHaveCount(0);
    await expect(card.locator('.stop-progress')).toHaveCount(0);
    await expect(card.getByRole('button', {name: /Back to buses for your stop/})).toBeVisible();
    const height = await card.evaluate(e => e.getBoundingClientRect().height);
    expect(height, 'a compact card, under 420 px').toBeLessThan(420);
    await page.screenshot({path: test.info().outputPath(`${test.info().project.name}-not-serving-compact.png`), fullPage: true});
  });
});

test('a link names a journey, not a vehicle: an older four-part link still opens, its filter is a chip, and a filter no service has is said', async ({page}) => {
  await open(page, `/?stop=${STOP_A}&service=${encodeURIComponent(MAIN)}&bus=${encodeURIComponent('BNML|FX-COMING|256|inbound')}`);
  await expect(page.locator('.your-stop')).toContainText('Stop A');
  await expect(page.locator('.service-chip[aria-pressed="true"]')).toContainText('Piccadilly Gardens');
  await expect(page.locator('article.bus-card')).toHaveAttribute('data-selection', 'active', {timeout: 15_000});
  await expect(pressedRow(page)).toContainText('3 stops before yours');
  await expect(page.locator('.restore-notice')).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get('bus')).toBe('BNML|FX-COMING|256|inbound|FX-FX-COMING');
  // The same vehicle named on a journey it is not on: kept as asked, said so, nothing chosen instead.
  await open(page, `/?stop=${STOP_A}&bus=${encodeURIComponent('BNML|FX-COMING|256|outbound')}`);
  await expect(page.locator('article.bus-card')).toContainText('This bus has started another journey', {timeout: 15_000});
  await expect(pressedRow(page)).toHaveCount(0);
  // A filter the stop does not have today: every service listed, and the link's filter said.
  await open(page, `/?stop=${STOP_A}&service=${encodeURIComponent('BNML|999|inbound|Nowhere_Special')}`);
  await expect(page.locator('.restore-notice')).toContainText('999 to Nowhere Special is not in today’s timetable for this stop, so every service is listed');
  await expect(page.locator('.waiting .follow-row')).not.toHaveCount(0);
  await expect(page.locator('.service-chip[aria-pressed="true"]')).toHaveCount(0);
});
