/**
 * A passenger planning a journey and then making it, as the owner asked on 4 October 2026 ("when I plan a journey can
 * it be easier, similar to Google Maps, where their walking help to the bus stop, then when you're in the bus you can
 * follow it"): a phone (390 x 844, touch, location allowed) somewhere in the city, a destination by name, and then
 * every step a passenger would take to walk to the stop, board and follow the bus. Each step is recorded with what is
 * on the screen, where the controls that matter are, and how many taps and scrolls it took.
 * REAL data and real place providers. Chromium, emulation; not a phone in hand.
 *
 *   node scripts/probes/journey-study.mjs [label] [base] [destination] [lat,lon]
 * Writes outputs/probes/journey-study/<label>/ (steps.json and frames).
 */
import {chromium} from '@playwright/test';
import {writeFileSync, mkdirSync} from 'node:fs';
import {launchOptions} from '../../tests/browser/browser-env.mjs';
const [label = 'served', base = 'https://lost-minutes.duckdns.org', destination = 'Didsbury', at = '53.4740,-2.2420'] = process.argv.slice(2);
const served = 'https://lost-minutes.duckdns.org';
const [lat, lon] = at.split(',').map(Number);
const out = `outputs/probes/journey-study/${label}`; mkdirSync(out, {recursive: true});
const b = await chromium.launch(launchOptions());
const ctx = await b.newContext({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
  geolocation: {latitude: lat, longitude: lon, accuracy: 15}, permissions: ['geolocation'], timezoneId: 'Europe/London',
  ...(base !== served ? {serviceWorkers: 'block'} : {})});
const page = await ctx.newPage();
if (base !== served) await page.route(`${base}/data/**`, async r => {
  const u = new URL(r.request().url());
  const res = await r.fetch({url: `${served}${u.pathname}${u.search}`}).catch(() => null);
  if (!res) return r.abort();
  await r.fulfill({response: res});
});
const steps = [];
let taps = 0, scrolls = 0;
// What the passenger can see without scrolling: the panel's visible text, the sheet's height, and the controls.
const view = () => page.evaluate(() => {
  const vis = el => { const r = el.getBoundingClientRect(); return r.height > 0 && r.bottom > 0 && r.top < innerHeight; };
  const panel = document.querySelector('.follow > .panel');
  const body = panel?.querySelector('.panel-body');
  const pr = panel?.getBoundingClientRect();
  const buttons = [...(panel?.querySelectorAll('button, a') ?? [])].filter(vis).map(e => (e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 50)).filter(Boolean);
  const text = body ? [...body.querySelectorAll('*')].filter(e => e.children.length === 0 && vis(e)).map(e => e.textContent.trim()).filter(Boolean).join(' · ') : '';
  const map = document.querySelector('.vector-map');
  return {panel: document.querySelector('.follow')?.getAttribute('data-panel'), sheetTop: pr ? Math.round(pr.top) : null,
    visibleWords: text.split(/\s+/).filter(Boolean).length, visibleText: text.slice(0, 600), buttons: buttons.slice(0, 30),
    bodyScrollHeight: body?.scrollHeight ?? null, bodyHeight: body ? Math.round(body.getBoundingClientRect().height) : null,
    walk: document.querySelector('[data-walk]')?.getAttribute('data-walk') ?? null,
    walkTop: (() => { const w = document.querySelector('.walk-guide'); return w ? Math.round(w.getBoundingClientRect().top) : null; })(),
    ride: map?.getAttribute('data-ride') ?? null};
});
async function record(name, note) {
  const v = await view();
  const n = String(steps.length).padStart(2, '0');
  await page.screenshot({path: `${out}/${n}-${name}.png`}).catch(() => {});
  steps.push({n, name, note, taps, scrolls, ...v});
  console.log(`${n} ${name} (taps ${taps}, scrolls ${scrolls}): ${note}\n   panel=${v.panel} sheetTop=${v.sheetTop} words=${v.visibleWords} walk=${v.walk}@${v.walkTop} ride=${v.ride}\n   buttons: ${v.buttons.join(' | ')}`);
}
const tap = async loc => { await loc.scrollIntoViewIfNeeded().catch(() => {}); await loc.tap(); taps++; };

await page.goto(`${base}/`, {waitUntil: 'load'});
await page.locator('.vector-map[data-map-state="painted"]').waitFor({timeout: 90_000}).catch(() => {});
await page.waitForTimeout(2500);
await record('home', 'the first screen');

const search = page.locator('.follow-search input');
await tap(search); await search.fill(destination);
const place = page.locator('.follow-search [data-place]').first();
await place.waitFor({timeout: 12_000}).catch(() => {});
await record('search', `typed "${destination}"`);
await tap(place);
await page.locator('[data-plan-option], [data-plan-connection]').first().waitFor({timeout: 40_000}).catch(() => {});
await page.waitForTimeout(3000);
await record('options', 'the planner\'s options');
const optionInfo = await page.evaluate(() => [...document.querySelectorAll('.plan-option')].slice(0, 3).map(o => ({
  height: Math.round(o.getBoundingClientRect().height), words: o.innerText.split(/\s+/).length, text: o.innerText.replace(/\s+/g, ' ').slice(0, 300)})));
console.log('   first options:', JSON.stringify(optionInfo, null, 1));
steps.at(-1).options = optionInfo;

const choose = page.locator('[data-choose-plan], [data-choose-connection]').first();
if (await choose.count()) {
  await tap(choose);
  await page.waitForTimeout(3500);
  await record('chosen', 'after choosing the first option');
  const whole = await page.evaluate(() => {
    const body = document.querySelector('.follow > .panel .panel-body');
    return body ? [...body.children].map(c => ({cls: c.className.toString().slice(0, 40), height: Math.round(c.getBoundingClientRect().height),
      text: c.innerText.replace(/\s+/g, ' ').slice(0, 160)})) : [];
  });
  console.log('   the panel, top to bottom:'); for (const w of whole) console.log(`     [${w.height}px] ${w.cls}: ${w.text}`);
  steps.at(-1).sections = whole;
  // Where the next action is, and whether it is on the screen as it stands (no scrolling).
  const actionAt = sel => page.locator(sel).first().evaluate(e => { const r = e.getBoundingClientRect(); return {top: Math.round(r.top), bottom: Math.round(r.bottom), seen: r.top >= 0 && r.bottom <= innerHeight}; }).catch(() => null);
  if (await page.locator('.trip').count()) {
    // The trip (4 October 2026): walk, wait, board, ride.
    steps.at(-1).action = await actionAt('.trip [data-trip-next]');
    console.log('   "I’m at the stop":', JSON.stringify(steps.at(-1).action));
    const route = page.locator('.trip [data-show-route]');
    if (await route.count()) {
      await tap(route);
      await page.locator('.trip [data-trip-walk="route"]').waitFor({timeout: 15_000}).catch(() => {});
      await page.waitForTimeout(1500);
      await record('walk-route', 'asked for the walking route from the trip’s own card');
    }
    await tap(page.locator('.trip [data-trip-next]'));
    await page.waitForTimeout(2500);
    await record('wait', 'said “I’m at the stop”');
    steps.at(-1).action = await actionAt('.trip [data-trip-board]');
    console.log('   "I’m on the bus":', JSON.stringify(steps.at(-1).action));
    await tap(page.locator('.trip [data-trip-board]'));
    await page.waitForTimeout(1500);
    const ask = page.locator('.trip [data-trip-ask] [data-trip-candidate]').first();
    if (await page.locator('.trip [data-trip-ask]').count() && await page.locator('.trip').getAttribute('data-trip-step') === 'wait') {
      await record('which-bus', 'asked which bus');
      await tap(ask);
      await page.waitForTimeout(2000);
    }
    await record('ride', 'on the bus');
    const ride = page.locator('.trip [data-trip-ride]');
    if (await ride.count()) {
      await tap(ride);
      await page.locator('.vector-map[data-ride="following"]').waitFor({timeout: 15_000}).catch(() => {});
      await page.waitForTimeout(3000);
      await record('riding', 'Ride along from the trip');
    }
  } else {
    // Before 4 October: the boarding stop's whole board.
    const walkButton = page.locator('[data-show-route]').first();
    if (await walkButton.count()) {
      const before = await walkButton.evaluate(e => Math.round(e.getBoundingClientRect().top));
      if (before > 844 || before < 0) scrolls++;
      await tap(walkButton);
      await page.locator('[data-walk="route"]').waitFor({timeout: 15_000}).catch(() => {});
      await page.waitForTimeout(1500);
      await record('walk-route', `asked for the walking route (its button was at y=${before})`);
    } else await record('walk-route', 'no "Walking route" button offered');
    const row = page.locator('.waiting .follow-row').first();
    if (await row.count()) {
      const y = await row.evaluate(e => Math.round(e.getBoundingClientRect().top));
      if (y > 844 || y < 0) scrolls++;
      await tap(row);
      await page.waitForTimeout(2000);
      await record('bus', `tapped the first bus coming (its row was at y=${y})`);
      const ride = page.getByRole('button', {name: /^Ride along/}).first();
      if (await ride.count()) {
        await tap(ride);
        await page.locator('.vector-map[data-ride="following"]').waitFor({timeout: 15_000}).catch(() => {});
        await page.waitForTimeout(3000);
        await record('riding', 'pressed Ride along');
      } else await record('riding', 'no Ride along button');
    } else await record('bus', 'no bus listed as coming to the stop');
  }
} else await record('chosen', 'no option to choose');

writeFileSync(`${out}/steps.json`, JSON.stringify(steps, null, 1));
console.log(`total: ${taps} taps, ${scrolls} scrolls`);
await b.close();
