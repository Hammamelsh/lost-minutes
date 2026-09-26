// The three everyday screens the simplification of 26 September 2026 changed, captured the same way
// on any build so they can be put side by side: a search for a stop with several sides of the road;
// the stop's head and its departure board with a tracked bus; a bus chosen from it; the home with the
// route panel and the Explore block. FIXTURE data on the built site (the served one or a local one), phone and desktop.
//
//   node scripts/probes/everyday-flows.mjs --base http://127.0.0.1:8098/ --label after
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {arg, fixtures, launch, outDir} from './common.mjs';

const out = outDir('everyday-flows', arg('label', 'latest'));
mkdirSync(out, {recursive: true});
const base = arg('base', 'http://127.0.0.1:8098/');
const {servePatterns, serveLive, serveMotion, movingLive, journeyLive, waitForPaint} = await fixtures();
const browser = await launch();
for (const size of [{name: 'phone-390', viewport: {width: 390, height: 844}, phone: true}, {name: 'desktop', viewport: {width: 1280, height: 900}, phone: false}]) {
  const context = await browser.newContext({viewport: size.viewport, deviceScaleFactor: size.phone ? 2 : 1, isMobile: size.phone, hasTouch: size.phone,
    timezoneId: 'Europe/London', baseURL: base,
    // The fixtures answer the page's own requests; a service worker would answer them first with the
    // build's stale data (26 September 2026: a frame of "not collecting · 13 days ago").
    serviceWorkers: 'block'});
  const page = await context.newPage();
  await servePatterns(page);
  await serveMotion(page, {evaluation: null});
  // A moving bus on the 256 and the journey's buses: the board can tie the 256 to its departure.
  const start = Date.now() - 90_000;
  await serveLive(page, [() => movingLive({nowMs: Date.now(), startMs: start, speed: 8, cadence: 10})]);
  await page.goto('/');
  await waitForPaint(page).catch(() => {});
  // 1. The search: three sides of one road.
  const search = page.getByRole('combobox', {name: /Bus number, stop or area/i}).first();
  await search.fill('stretford mall');
  await page.waitForTimeout(700);
  await page.screenshot({path: join(out, `${size.name}-1-search.png`)});
  await page.keyboard.press('Escape').catch(() => {});
  // 2. The stop: its head, the board, the tracked buses.
  await page.goto('/?stop=1800SJ00811');
  await waitForPaint(page).catch(() => {});
  await page.waitForTimeout(2500);
  if (size.phone) { const open = page.getByRole('button', {name: /Open full list/}); if (await open.isVisible()) await open.click(); await page.waitForTimeout(600); }
  await page.screenshot({path: join(out, `${size.name}-2-stop.png`)});
  // 2b. A bus chosen from the stop's board: its card, as a passenger first reads it.
  const row = page.locator('.follow-row[data-bus]').first();
  if (await row.count()) {
    await row.scrollIntoViewIfNeeded().catch(() => {});
    await row.click().catch(() => {});
    await page.waitForTimeout(1500);
    await page.screenshot({path: join(out, `${size.name}-2b-bus.png`)});
  }
  // 3. The home with a route chosen: the route panel and the Explore block.
  await page.goto('/');
  await waitForPaint(page).catch(() => {});
  const routeSelect = page.locator('#follow-route');
  if (await routeSelect.count()) await routeSelect.selectOption('BNML|256').catch(() => {});
  await page.waitForTimeout(800);
  if (size.phone) { const open = page.getByRole('button', {name: /Open full list/}); if (await open.isVisible()) await open.click(); await page.waitForTimeout(600); }
  await page.screenshot({path: join(out, `${size.name}-3-home-route.png`)});
  await context.close();
}
await browser.close();
console.log(`frames in ${out}`);
