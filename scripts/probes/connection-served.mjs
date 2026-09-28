// The served site, one journey with a change, as a passenger would make it: planned, chosen, the
// card and the map read back, the stages walked, a reload, and the ride with the other leg in view.
// Real data, read-only, phone emulation. Frames and a record go to outputs/probes/connection-served/.
//
//   node scripts/probes/connection-served.mjs [--base https://lost-minutes.duckdns.org/] [--from "hillingdon road"] [--to mediacityuk] [--label name]
import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {chromium} from '@playwright/test';
import {launchOptions} from '../../tests/browser/browser-env.mjs';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const BASE = arg('base', 'https://lost-minutes.duckdns.org/');
const FROM = arg('from', 'hillingdon road'), TO = arg('to', 'mediacityuk');
const OUT = join('outputs', 'probes', 'connection-served', arg('label', new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')));
mkdirSync(OUT, {recursive: true});
const record = {base: BASE, from: FROM, to: TO, at: new Date().toISOString(), steps: []};
const note = (what, extra = {}) => { record.steps.push({what, at: new Date().toISOString(), ...extra}); console.log(what, JSON.stringify(extra).slice(0, 400)); };

const browser = await chromium.launch(launchOptions());
const ctx = await browser.newContext({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
  serviceWorkers: 'block', timezoneId: 'Europe/London', locale: 'en-GB'});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const shot = async name => { await page.screenshot({path: join(OUT, `${name}.png`)}); };
const text = async sel => (await page.locator(sel).first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();

await page.goto(BASE, {waitUntil: 'load'});
await page.locator('.vector-map[data-map-state="painted"]').waitFor({timeout: 90_000});
note('opened', {release: await page.evaluate(() => fetch('/RELEASE').then(r => r.ok ? r.text() : '').then(t => t.split('\n')[0]).catch(() => ''))});
await page.locator('[data-plan-entry]').click();
await page.locator('.plan-panel [data-plan-from]').click();
await page.getByRole('combobox', {name: 'Starting point'}).fill(FROM);
await page.locator('.place-search [role=option]').first().dispatchEvent('mousedown');
await page.getByRole('combobox', {name: 'Destination'}).fill(TO);
await page.locator('.place-search [role=option]').first().dispatchEvent('mousedown');
await page.locator('.plan-option').first().waitFor({timeout: 20_000}).catch(() => {});
await page.waitForTimeout(800);
await shot('1-options');
const options = await page.locator('.plan-option').allInnerTexts();
note('options', {direct: await page.locator('.plan-option:not(.connection)').count(), connections: await page.locator('.plan-option.connection').count(),
  first: options[0]?.replace(/\s+/g, ' ').slice(0, 300)});
if (!(await page.locator('[data-choose-connection]').count())) { note('no connection offered'); await browser.close(); process.exit(0); }
await page.locator('[data-choose-connection]').first().click();
await page.locator('.journey-card').waitFor();
// Let the boards, the roads and the walk arrive, and a couple of publications land.
await page.waitForTimeout(12_000);
await shot('2-card');
const readCard = async () => ({stage: await page.locator('.journey-card').getAttribute('data-stage'), timing: await page.locator('.journey-card').getAttribute('data-timing'),
  transfer: await page.locator('.journey-card [data-transfer]').getAttribute('data-transfer'),
  tracked: await page.locator('.journey-card [data-tracked]').evaluateAll(list => list.map(e => `${e.dataset.tracked}: ${e.textContent.trim()}`)),
  rows: await page.locator('.journey-card .journey-row').allInnerTexts().then(r => r.map(x => x.replace(/\s+/g, ' '))),
  basis: await text('.journey-card [data-basis]'), withheld: await text('.journey-card [data-times-withheld]'), walkNote: await text('[data-walk-note]'),
  stop: await text('.your-stop-copy strong'), map: await page.locator('.vector-map').getAttribute('data-journey'), focus: await page.locator('.vector-map').getAttribute('data-journey-focus'),
  fleet: await page.locator('.vector-map').getAttribute('data-fleet'), camera: await page.locator('.vector-map').getAttribute('data-camera')});
const before = await readCard();
note('card', before);
await page.waitForTimeout(10_000);
const later = await readCard();
note('after two more publications', {cameraMoved: later.camera !== before.camera, camera: later.camera, tracked: later.tracked});
// Focus each part, then the whole.
for (const f of ['first', 'second', 'whole']) {
  await page.locator(`.journey-card [data-focus="${f}"]`).click();
  await page.waitForTimeout(1500);
  note(`focus ${f}`, {focus: await page.locator('.vector-map').getAttribute('data-journey-focus'), camera: await page.locator('.vector-map').getAttribute('data-camera')});
}
// The map with the sheet folded, whole journey.
const handle = await page.locator('.follow > .panel .sheet-handle').boundingBox();
const cdp = await ctx.newCDPSession(page);
const t = (type, x, y) => cdp.send('Input.dispatchTouchEvent', {type, touchPoints: type === 'touchEnd' ? [] : [{x, y}]});
await t('touchStart', handle.x + handle.width / 2, handle.y + handle.height / 2);
for (let i = 1; i <= 12; i++) { await t('touchMove', handle.x + handle.width / 2, handle.y + handle.height / 2 + 500 * i / 12); await page.waitForTimeout(20); }
await t('touchEnd', 0, 0);
await page.waitForTimeout(1500);
await shot('3-map');
await page.locator('[data-sheet-toggle]').click();
await page.waitForTimeout(600);
// The stages.
await page.locator('.journey-card [data-stage-to="first"]').click();
await page.waitForTimeout(2500);
note('stage first', {stop: await text('.your-stop-copy strong'), stage: await page.locator('.journey-card').getAttribute('data-stage')});
await shot('4-stage-first');
await page.locator('.journey-card [data-stage-to="second"]').click();
await page.waitForTimeout(2500);
note('stage second', {stop: await text('.your-stop-copy strong'), stage: await page.locator('.journey-card').getAttribute('data-stage')});
await shot('5-stage-second');
await page.locator('.journey-card [data-stage-to="first"]').click();
await page.waitForTimeout(1000);
// A reload keeps it.
await page.reload({waitUntil: 'load'});
await page.locator('.vector-map[data-map-state="painted"]').waitFor({timeout: 90_000});
await page.locator('.journey-card').waitFor({timeout: 20_000}).catch(() => {});
await page.waitForTimeout(3000);
note('after reload', {card: await page.locator('.journey-card').count(), stage: await page.locator('.journey-card').getAttribute('data-stage').catch(() => null), stop: await text('.your-stop-copy strong')});
await page.locator('.journey-card [data-stage-to="before"]').click().catch(() => {});
await page.waitForTimeout(1500);
// The ride, if a bus is offered, with the other leg in view.
const ride = page.getByRole('button', {name: /Ride along/}).first();
if (await ride.isVisible().catch(() => false)) {
  await ride.click();
  await page.locator('.vector-map[data-ride="following"]').waitFor({timeout: 20_000}).catch(() => {});
  await page.waitForTimeout(2500);
  await shot('6-ride');
  note('ride', {ride: await page.locator('.vector-map').getAttribute('data-ride'), vehicle: await page.locator('.ride-card').getAttribute('data-vehicle'),
    nextLeg: await text('.ride-card .ride-next-leg'), switch: await text('.ride-card [data-switch-leg]')});
  const sw = page.locator('.ride-card [data-switch-leg]');
  if (await sw.count()) {
    await sw.click(); await page.waitForTimeout(4000);
    await shot('7-after-switch');
    note('after switch', {ride: await page.locator('.vector-map').getAttribute('data-ride'), vehicle: await page.locator('.ride-card').getAttribute('data-vehicle').catch(() => null),
      focus: await page.locator('.vector-map').getAttribute('data-journey-focus'), card: await page.locator('.journey-card').count()});
  }
  await page.getByRole('button', {name: /Exit/}).first().click().catch(() => {});
  await page.waitForTimeout(1500);
} else note('no ride offered (no tracked bus on the first leg now)');
note('page errors', {errors});
await page.locator('.journey-card [data-end-journey]').click().catch(() => {});
await browser.close();
writeFileSync(join(OUT, 'record.json'), JSON.stringify(record, null, 1));
console.log(`written ${OUT}`);
