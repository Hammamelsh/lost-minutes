/**
 * Try Ride-along and the recorded ride, walked on whatever `--base` serves, at a Safari-sized phone
 * and on a desktop: the sheet dragged to the top and kept there, the section's offer, the recorded
 * ride started and badged, its bus moving, the address it leaves, and the way back to live.
 *
 *   node scripts/probes/try-ride-walk.mjs --base https://lost-minutes.duckdns.org [--label name]
 */
import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {arg, fixtures, launch, outDir, site} from './common.mjs';
const label = arg('label', 'walk');
const out = outDir('try-ride-walk', label);
mkdirSync(out, {recursive: true});
const {dragBy} = await fixtures();
const {base, stop} = await site();
const browser = await launch();
const notes = {base, when: new Date().toISOString(), phone: {}, desktop: {}};
const metres = (a, b) => Math.hypot((b[0] - a[0]) * 111195, (b[1] - a[1]) * 111195 * Math.cos(a[0] * Math.PI / 180));
const shot = (page, name) => page.screenshot({path: join(out, name + '.png')}).catch(() => {});

// --- phone, with the browser's bars taking their share -------------------------------------
{
  const context = await browser.newContext({viewport: {width: 390, height: 664}, isMobile: true, hasTouch: true, timezoneId: 'Europe/London'});
  const page = await context.newPage();
  const n = notes.phone;
  await page.goto(base, {waitUntil: 'domcontentloaded'});
  await page.locator('.follow').waitFor({timeout: 30_000});
  await page.locator('.vector-map[data-map-state="painted"], .map-fallback-wrap').first().waitFor({timeout: 60_000}).catch(() => {});
  n.badge = (await page.locator('.follow-badge').textContent().catch(() => '')).trim();
  n.sheetBefore = await page.locator('.follow').getAttribute('data-sheet');
  const handle = await page.locator('.sheet-handle').boundingBox();
  if (handle) {
    await dragBy(page, handle.x + handle.width / 2, handle.y + handle.height / 2, 0, -(handle.y - 20));
    await page.waitForTimeout(600);
    n.sheetAfterDrag = await page.locator('.follow').getAttribute('data-sheet');
    const panel = await page.locator('.follow > .panel').boundingBox();
    const search = await page.locator('.follow-search input').first().boundingBox().catch(() => null);
    n.panelHeightPx = panel ? Math.round(panel.height) : null;
    n.searchAboveSheet = panel && search ? search.y + search.height <= panel.y + 1 : null;
    await page.waitForTimeout(2500);
    n.sheetStays = await page.locator('.follow').getAttribute('data-sheet');
  }
  await shot(page, 'phone-sheet-full');
  const section = page.locator('.try-ride');
  await section.waitFor({timeout: 20_000}).catch(() => {});
  n.tryRide = {state: await section.getAttribute('data-rides').catch(() => null),
    liveRows: await section.locator('button[data-ride-bus]').count().catch(() => 0),
    liveTiers: await section.locator('button[data-ride-bus]').evaluateAll(els => els.map(e => e.getAttribute('data-ride-tier'))).catch(() => []),
    recordings: await section.locator('button[data-ride-recording]').count().catch(() => 0)};
  await section.scrollIntoViewIfNeeded().catch(() => {});
  await shot(page, 'phone-try-ride');
  const recorded = section.locator('button[data-ride-recording]').first();
  if (await recorded.count()) {
    await recorded.click();
    await page.locator('.follow-badge', {hasText: 'RECORDED RIDE'}).waitFor({timeout: 20_000}).catch(() => {});
    n.recordedBadge = (await page.locator('.follow-badge').textContent().catch(() => '')).trim();
    n.recordedWhen = (await page.locator('.follow-bar-when').textContent().catch(() => '')).trim();
    await page.locator('.vector-map[data-ride="following"]').waitFor({timeout: 30_000}).catch(() => {});
    n.rideState = await page.locator('.vector-map').getAttribute('data-ride');
    n.rideCardLabel = (await page.locator('.ride-card [data-ride-recording-label]').textContent().catch(() => '')).trim();
    n.address = new URL(page.url()).search;
    const at = async () => ((await page.locator('.vector-map').getAttribute('data-display')) || ',').split(',').slice(0, 2).map(Number);
    const first = await at(); await page.waitForTimeout(20_000); const later = await at();
    n.movedMetresIn20s = Number.isFinite(first[0]) && Number.isFinite(later[0]) ? Math.round(metres(first, later)) : null;
    n.rideMotion = (await page.locator('.ride-motion').textContent().catch(() => '')).trim();
    await shot(page, 'phone-recorded-ride');
    await page.getByRole('button', {name: 'Exit ride-along'}).click().catch(() => {});
    await page.locator('[data-leave-recording]').click().catch(() => {});
    await page.waitForTimeout(3000);
    n.badgeAfterLeave = (await page.locator('.follow-badge').textContent().catch(() => '')).trim();
    n.addressAfterLeave = new URL(page.url()).search;
    n.cardAfterLeave = await page.locator('#lm-bus-card').count();
  }
  await context.close();
}

// --- desktop -------------------------------------------------------------------------------
{
  const context = await browser.newContext({viewport: {width: 1366, height: 768}, timezoneId: 'Europe/London'});
  const page = await context.newPage();
  const n = notes.desktop;
  await page.goto(base, {waitUntil: 'domcontentloaded'});
  await page.locator('.follow').waitFor({timeout: 30_000});
  await page.locator('.vector-map[data-map-state="painted"], .map-fallback-wrap').first().waitFor({timeout: 60_000}).catch(() => {});
  n.badge = (await page.locator('.follow-badge').textContent().catch(() => '')).trim();
  n.when = (await page.locator('.follow-bar-when').textContent().catch(() => '')).trim();
  const section = page.locator('.try-ride');
  await section.waitFor({timeout: 20_000}).catch(() => {});
  n.tryRide = {state: await section.getAttribute('data-rides').catch(() => null),
    liveRows: await section.locator('button[data-ride-bus]').count().catch(() => 0),
    rows: await section.locator('button[data-ride-bus], button[data-ride-recording]').evaluateAll(els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim())).catch(() => [])};
  await shot(page, 'desktop-home');
  const live = section.locator('button[data-ride-bus]').first();
  if (await live.count()) {
    await live.click();
    await page.locator('.vector-map[data-ride="following"]').waitFor({timeout: 30_000}).catch(() => {});
    n.liveRide = {state: await page.locator('.vector-map').getAttribute('data-ride'), motion: (await page.locator('.ride-motion').textContent().catch(() => '')).trim(),
      vehicle: await page.locator('#lm-bus-card').getAttribute('data-vehicle').catch(() => null), stopChosen: await page.locator('.follow.has-stop').count()};
    await page.waitForTimeout(8000);
    await shot(page, 'desktop-live-ride');
    await page.getByRole('button', {name: 'Exit ride-along'}).click().catch(() => {});
    n.liveRide.afterExit = await page.locator('.vector-map').getAttribute('data-ride');
    n.liveRide.pitchAfterExit = Number(((await page.locator('.vector-map').getAttribute('data-camera')) || '0,0,0,0').split(',')[3]);
  }
  await context.close();
}
await browser.close();
stop();
writeFileSync(join(out, 'walk.json'), JSON.stringify(notes, null, 1));
console.log(JSON.stringify(notes, null, 1));
