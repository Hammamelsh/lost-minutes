/**
 * A short recording of the actual app, for showing people what it does.
 *
 *   node scripts/probes/demo-recording.mjs --base http://127.0.0.1:8098/ [--label name]
 *   node scripts/probes/demo-recording.mjs --base https://….trycloudflare.com
 *
 * One pass through the passenger's own journey, on a 390 px phone, against whatever the base is
 * serving: with a collector running that is the real feed, and the recording says which it was.
 * Nothing is staged — no fixtures, no scripted positions — so the bus moves as the bus moved.
 *
 * It asks for no location: the stop is found by typing, which is the path that needs no
 * permission, and it keeps anyone's real position out of a file meant to be shown to others.
 *
 * Playwright writes WebM. There is no ffmpeg on this machine, so nothing converts it; every
 * browser plays WebM, and stills are written beside it for anywhere that will not.
 */
import {existsSync, mkdirSync, renameSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {arg, launch, outDir} from './common.mjs';

const base = arg('base', 'http://127.0.0.1:8098/');
const out = outDir('demo-recording', arg('label', 'demo'));
const size = {width: 390, height: 844};
const beats = [];
const browser = await launch();
const ctx = await browser.newContext({viewport: size, deviceScaleFactor: 2, isMobile: true,
  hasTouch: true, recordVideo: {dir: join(out, 'raw'), size}});
const page = await ctx.newPage();
const beat = async (what, ms = 0) => {
  if (ms) await page.waitForTimeout(ms);
  const file = `${String(beats.length + 1).padStart(2, '0')}-${what.replace(/\W+/g, '-')}.png`;
  await page.screenshot({path: join(out, file)});
  beats.push({beat: beats.length + 1, what, at: new Date().toISOString(), file});
  console.log(`  ${beats.length}. ${what}`);
};

await page.goto(base, {waitUntil: 'load'});
await page.waitForSelector('.vector-map[data-map-state="painted"]', {timeout: 60_000});
const feed = await page.evaluate(async () => {
  const d = await (await fetch('/data/live.json?demo=1', {cache: 'no-store'})).json();
  return {state: d.state, vehicles: (d.vehicles || []).length, publishedAt: d.publishedAt,
    collector: d.collection?.collector?.kind ?? null};
});
await beat('the first screen', 2500);

await page.getByRole('combobox', {name: 'Bus number, stop or area'}).fill('marston road');
await beat('searching for a stop by name', 1400);
await page.getByRole('option').first().click();
await page.evaluate(() => scrollTo(0, 0));
await beat('the stop, and what is coming', 3500);

// Choose a bus worth filming, and say that it was chosen. A bus that reported no bearing is drawn
// from above as a round token rather than the 3D bus — correct, and not what the ride-along looks
// like most of the time, since 78% of vehicles report one. So the rows are tried in turn until one
// of those is on the card, and the recording records both the choice and the reason for it. Nothing
// is staged: the bus is a real bus, at its real position, and if none of the rows offers a bearing
// the page's own suggestion is filmed and the recording says so.
const bearings = await page.evaluate(async () => {
  const live = await (await fetch('/data/live.json?demo=1', {cache: 'no-store'})).json();
  return Object.fromEntries((live.vehicles || []).map(v => [`${v.operator}|${v.vehicle}`, v.bearing ?? null]));
});
const rows = page.locator('.waiting .follow-row');
let chosen = null;
for (let i = 0; i < Math.min(await rows.count(), 6); i++) {
  await rows.nth(i).click();
  const key = await page.locator('.vector-map').getAttribute('data-selected-key');
  if (typeof bearings[key] === 'number') { chosen = {key, bearing: bearings[key], row: i}; break; }
}
if (chosen) console.log(`  chose row ${chosen.row}: ${chosen.key}, bearing ${chosen.bearing}`);
else console.log('  no bus coming to this stop reported a bearing; filming the page\'s own suggestion');

const ridden = await page.evaluate(async () => {
  const card = document.querySelector('.active-bus, article.bus-card');
  const key = document.querySelector('.vector-map')?.getAttribute('data-selected-key') ?? null;
  // The chosen bus is drawn from its own source, so it is not in data-bus-points. Its bearing is
  // read from the publication itself, which is where the honest answer lives anyway.
  const live = await (await fetch('/data/live.json?demo=1', {cache: 'no-store'})).json();
  const vehicle = (live.vehicles || []).find(v => key === `${v.operator}|${v.vehicle}`);
  return {bus: key, bearing: vehicle ? vehicle.bearing ?? null : 'not in this publication',
    bearingStatus: vehicle ? vehicle.bearingStatus ?? null : null,
    says: (card?.innerText || '').replace(/\s+/g, ' ').slice(0, 140)};
});
console.log(`  ridden: ${ridden.bus}, bearing ${ridden.bearing} (${ridden.bearingStatus})`);
await page.locator('.vector-map').evaluate(el => el.scrollIntoView({block: 'start'}));
await page.getByRole('button', {name: /^Ride along with route/}).click();
await page.waitForFunction(() => document.querySelector('.vector-map')?.getAttribute('data-ride') === 'following',
  null, {timeout: 25_000});
await beat('riding along, the whole screen', 6000);

const front = page.getByRole('button', {name: 'Front view', exact: true});
if (await front.count()) {
  await front.click().catch(() => {});
  await page.waitForFunction(() => document.querySelector('.vector-map')?.getAttribute('data-ride-camera') === 'front',
    null, {timeout: 12_000}).catch(() => {});
  await beat('the street ahead, drawn from the map', 6000);
  await page.getByRole('button', {name: 'Outside view', exact: true}).click().catch(() => {});
  await page.waitForTimeout(2500);
}
await page.getByRole('button', {name: 'Exit ride-along'}).click();
await beat('back at the stop', 2200);

await page.getByRole('link', {name: /^Behind the data/}).first().click();
await page.evaluate(() => scrollTo(0, 0));
await beat('behind the data', 2500);
await page.locator('.coverage').scrollIntoViewIfNeeded().catch(() => {});
await beat('what can be said, service by service', 2500);

const video = page.video();
await ctx.close();
if (video) {
  const from = await video.path();
  if (existsSync(from)) renameSync(from, join(out, 'lost-minutes.webm'));
}
await browser.close();
mkdirSync(out, {recursive: true});
writeFileSync(join(out, 'recording.json'), JSON.stringify(
  {base, when: new Date().toISOString(), size, data: feed.state === 'live' ? 'REAL' : `feed state ${feed.state}`,
   feed, ridden, beats,
   chosen,
   judge: typeof ridden.bearing !== 'number'
     ? 'this bus reported no bearing, so it is drawn as a round token rather than the 3D bus: '
       + 'a fair take, but not a representative one — 78% of vehicles report one'
     : `the ridden bus reported a bearing (${ridden.bearing}), so the 3D bus and its heading are `
       + `shown${chosen ? ', and it was chosen from the buses coming to this stop for that reason' : ''}`},
  null, 1));
console.log(`\n${feed.state === 'live' ? 'REAL feed' : `feed state ${feed.state}`}, ${feed.vehicles} vehicles`);
console.log(`video and stills in ${out}`);
