/**
 * The passenger's journey walked on whatever `--base` serves, reading the things this milestone
 * changed: one summary of the chosen bus rather than two, what the ride offers before it is
 * entered, what the front view says on its face, and whether a quiet vehicle is marked.
 *
 *   node scripts/probes/passenger-walk.mjs --base https://lost-minutes.duckdns.org --stop 1800SJ01251
 */
import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {arg, launch, outDir, site} from './common.mjs';

const stopId = arg('stop', '1800SJ01251');
const label = arg('label', 'walk');
const out = outDir('passenger-walk', label);
mkdirSync(out, {recursive: true});
const {base, stop} = await site();
const browser = await launch();
const notes = [];

for (const size of [{name: 'desktop', width: 1366, height: 768},
                    {name: 'phone', width: 390, height: 844, mobile: true}]) {
  const context = await browser.newContext({viewport: {width: size.width, height: size.height},
    isMobile: Boolean(size.mobile), hasTouch: Boolean(size.mobile), timezoneId: 'Europe/London'});
  const page = await context.newPage();
  const step = {size: size.name};
  await page.goto(`${base}?stop=${stopId}`, {waitUntil: 'load'});
  await page.waitForTimeout(7000);
  step.departures = await page.locator('.departure-row').count();
  // Choose the first tracked bus the stop offers, whichever group it is in.
  const row = page.locator('.follow-row').first();
  step.busesOffered = await page.locator('.follow-row').count();
  if (await row.count()) {
    await row.click({timeout: 8000}).catch(() => {});
    await page.waitForTimeout(3500);
  }
  step.summaries = await page.locator('.active-bus').count();
  step.card = await page.locator('article.bus-card').getAttribute('data-vehicle').catch(() => null);
  step.quiet = await page.locator('.bus-card-quiet').count();
  step.offer = await page.locator('.ride-offer').first().textContent().catch(() => null);
  if (await page.locator('.ride-launch').count()) {
    await page.locator('.ride-launch').click({timeout: 8000}).catch(() => {});
    await page.waitForTimeout(6000);
    step.ride = await page.locator('.vector-map').getAttribute('data-ride');
    step.frontLabel = await page.locator('.ride-camera').first().textContent().catch(() => null);
    step.rideMotion = await page.locator('.ride-motion').first().textContent().catch(() => null);
    await page.screenshot({path: join(out, `${size.name}-ride.png`)});
    await page.getByRole('button', {name: 'Exit ride-along'}).click({timeout: 8000}).catch(() => {});
    await page.waitForTimeout(2500);
    step.pitchAfterExit = (await page.locator('.vector-map').getAttribute('data-camera') || '').split(',')[3];
    step.rideAfter = await page.locator('.vector-map').getAttribute('data-ride');
  }
  await page.screenshot({path: join(out, `${size.name}-after.png`)});
  notes.push(step);
  console.log(size.name, JSON.stringify(step));
  await context.close();
}
writeFileSync(join(out, 'walk.json'), JSON.stringify(notes, null, 1));
await browser.close(); stop();
