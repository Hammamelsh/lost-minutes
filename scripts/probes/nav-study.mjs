/**
 * A passenger finding their way somewhere new, as the owner did on 1 October 2026 ("parked a bit further and wanted
 * to see the buses and how to get to the place … when you click on something it's hard to go back"): a phone
 * (390 x 844, touch, location allowed) at a car park on the edge of the centre, wanting a destination by name. The
 * same flow on any build, with each step judged and a frame kept:
 *  1. the search's matches opened, then the phone's Back: still on the page, the matches closed;
 *  2. the destination by name, the way the build offers it (the main search's places, else Plan → Destination):
 *     can the places be seen at all (the first one inside the screen), and is the start filled in;
 *  3. a journey chosen: is the plan in view on the stop it boards at;
 *  4. Back: the options again, with the places kept; Back again: the start;
 *  5. a bus from a stop's board, then Back: the board, with the bus still chosen (where a bus is reporting).
 * REAL data and real place providers. Chromium, emulation; not a phone in hand.
 *
 *   node scripts/probes/nav-study.mjs served
 *   node scripts/probes/nav-study.mjs local http://127.0.0.1:8099
 * Writes outputs/probes/nav-study/<label>/ (steps.json and frames) and prints each step's verdict.
 */
import {chromium} from '@playwright/test';
import {writeFileSync, mkdirSync} from 'node:fs';
import {launchOptions} from '../../tests/browser/browser-env.mjs';
const [label = 'served', base = 'https://lost-minutes.duckdns.org', destination = 'Manchester Central Convention'] = process.argv.slice(2);
const served = 'https://lost-minutes.duckdns.org';
const out = `outputs/probes/nav-study/${label}`; mkdirSync(out, {recursive: true});
const START = {latitude: 53.4782, longitude: -2.2712, accuracy: 15};
const b = await chromium.launch(launchOptions());
const steps = [];

async function fresh() {
  const ctx = await b.newContext({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
    geolocation: START, permissions: ['geolocation'], timezoneId: 'Europe/London', ...(base !== served ? {serviceWorkers: 'block'} : {})});
  const page = await ctx.newPage();
  if (base !== served) await page.route(`${base}/data/**`, async r => {
    const u = new URL(r.request().url());
    const res = await r.fetch({url: `${served}${u.pathname}${u.search}`}).catch(() => null);
    if (!res) return r.abort();
    await r.fulfill({response: res});
  });
  await page.goto(`${base}/`, {waitUntil: 'load'});
  await page.locator('.vector-map[data-map-state="painted"]').waitFor({timeout: 90_000}).catch(() => {});
  await page.waitForTimeout(1500);
  return {ctx, page};
}
const where = page => page.evaluate(() => ({url: location.pathname + location.search, history: history.length,
  panel: document.querySelector('.follow')?.getAttribute('data-panel') ?? null, list: !!document.querySelector('.follow-search .stop-search-list'),
  back: document.querySelector('[data-panel-back]')?.textContent?.trim() ?? null, to: document.querySelector('[data-plan-to] strong')?.textContent ?? null,
  from: document.querySelector('[data-plan-from] strong')?.textContent ?? null, options: document.querySelectorAll('[data-plan-option], [data-plan-connection]').length}))
  .then(at => at.url.startsWith('/') ? at : {...at, url: 'left the site'}, () => ({url: 'left the site'}));
async function judge(page, name, ok, detail) {
  const at = await where(page);
  const n = String(steps.length).padStart(2, '0');
  await page.screenshot({path: `${out}/${n}-${name}.png`}).catch(() => {});
  steps.push({n, name, ok, detail, ...at});
  console.log(`${n} ${ok ? 'PASS' : 'FAIL'} ${name}: ${detail} ${JSON.stringify(at)}`);
}
async function back(page) { await page.goBack({waitUntil: 'commit', timeout: 5000}).catch(() => {}); await page.waitForTimeout(1500); }
// Seen: inside the screen, and what is drawn at its middle is it (not a panel scrolled over it, or the sheet's edge).
const inScreen = loc => loc.evaluate(el => { const r = el.getBoundingClientRect(); if (!(r.height > 0 && r.top >= 0 && r.bottom <= innerHeight)) return false;
  const at = document.elementFromPoint(r.left + Math.min(40, r.width / 2), r.top + Math.min(20, r.height / 2)); return !!at && (el === at || el.contains(at)); }).catch(() => false);

// 1. The search's matches, then the phone's Back.
{
  const {ctx, page} = await fresh();
  const search = page.locator('.follow-search input');
  await search.click(); await search.fill('Deansgate'); await page.waitForTimeout(1200);
  await back(page);
  const at = await where(page);
  await judge(page, 'search-then-back', at.url !== 'left the site' && !at.list, at.url === 'left the site' ? 'the phone\'s Back left the site' : at.list ? 'the matches are still open' : 'the matches closed, still on the page');
  await ctx.close();
}
// 2–4. The destination by name, a journey, and Back.
{
  const {ctx, page} = await fresh();
  const search = page.locator('.follow-search input');
  await search.click(); await search.fill(destination);
  const place = page.locator('.follow-search .stop-search-option[data-place]').filter({hasText: /conference centre|Convention Complex$/}).first();
  const found = await place.waitFor({timeout: 9000}).then(() => true, () => false);
  if (found) {
    await judge(page, 'place-in-main-search', await inScreen(place), 'the venue is offered in the main search');
    await place.click();
  } else {
    await judge(page, 'place-in-main-search', false, 'the main search offers no places');
    await search.fill('');
    await page.locator('[data-plan-entry]').click(); await page.waitForTimeout(800);
    const to = page.getByRole('combobox', {name: 'Destination'});
    await to.click(); await to.fill(destination);
    const option = page.locator('.place-search [role=option]').filter({hasText: 'conference centre'}).first();
    await option.waitFor({state: 'attached', timeout: 9000}).catch(() => {});
    const seen = await inScreen(option);
    await judge(page, 'planner-places-visible', seen, seen ? 'the places are on screen' : 'the places are listed but drawn off the screen');
    if (seen) await option.click(); else await option.dispatchEvent('mousedown');
  }
  await page.waitForTimeout(3000);
  let at = await where(page);
  await judge(page, 'start-filled', Boolean(at.from && at.from !== 'Choose a starting point'),
    at.from && at.from !== 'Choose a starting point' ? `starts from ${at.from}` : (await page.locator('[data-plan-needs-start]').count()) ? 'asks where to start from' : 'no start, and nothing says so');
  if (!at.from || at.from === 'Choose a starting point') {
    const use = page.locator('[data-plan-use-location]');
    if (await use.count()) await use.click();
    else { await page.locator('[data-plan-from]').click(); await page.locator('.place-search [role=option]', {hasText: 'My location'}).first().dispatchEvent('mousedown'); }
  }
  await page.locator('[data-plan-option], [data-plan-connection]').first().waitFor({timeout: 30_000}).catch(() => {});
  await page.waitForTimeout(4000);
  const choose = page.locator('[data-choose-plan], [data-choose-connection]').first();
  if (await choose.count()) {
    await choose.click(); await page.waitForTimeout(3500);
    const summary = page.locator('[data-plan-summary], .journey-card').first();
    await judge(page, 'plan-in-view', await inScreen(summary), 'the chosen plan is in view on the stop it boards at');
    await back(page);
    at = await where(page);
    await judge(page, 'back-to-options', at.panel === 'plan' && at.options > 0, `Back from the chosen plan: ${at.panel === 'plan' ? `the planner, ${at.options} options` : at.panel}`);
    await back(page);
    at = await where(page);
    await judge(page, 'back-to-start', at.panel === 'home' && at.url !== 'left the site', `Back again: ${at.panel ?? at.url}`);
  } else await judge(page, 'options', false, 'no journey was offered');
  await ctx.close();
}
// 5. A bus from a stop's board, then Back.
{
  const {ctx, page} = await fresh();
  await page.goto(`${base}/?stop=1800SB45141`, {waitUntil: 'load'}); await page.waitForTimeout(6000);
  const row = page.locator('.panel-body button.follow-row:visible').first();
  if (await row.count()) {
    await row.click(); await page.waitForTimeout(2000);
    await back(page);
    const at = await where(page);
    const still = await page.locator('.follow-row[aria-pressed="true"]').count();
    await judge(page, 'bus-then-back', at.panel === 'stop' && still > 0, `Back from a bus: ${at.panel}, ${still ? 'the bus still chosen' : 'no bus chosen'}`);
  } else console.log('-- no bus reporting at the stop just now; step 5 not judged');
  await ctx.close();
}
writeFileSync(`${out}/steps.json`, JSON.stringify(steps, null, 1));
console.log(`${steps.filter(s => s.ok).length} of ${steps.length} steps pass`);
await b.close();
