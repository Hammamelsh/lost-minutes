/**
 * The stop's departure board and the chosen bus's card, photographed at both sizes.
 *
 *   node scripts/probes/departures-frames.mjs --stop 1800SJ01251 --label after
 *
 * Real published data from whatever `--base` serves (the built out/ by default), so the frames are
 * of the thing itself and not of a fixture. It photographs the panel, not the whole page, because
 * the panel is where the reading is; the whole workspace is captured beside it for the layout.
 */
import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {arg, launch, outDir, site} from './common.mjs';

const stopId = arg('stop', '1800SJ01251');
const label = arg('label', 'departures');
const out = outDir('departures', label);
mkdirSync(out, {recursive: true});

const {base, stop} = await site();
const browser = await launch();
const notes = [];
for (const size of [{name: 'desktop', width: 1366, height: 768},
                    {name: 'phone', width: 390, height: 844, mobile: true},
                    {name: 'zoom200', width: 683, height: 384}]) {
  const context = await browser.newContext({viewport: {width: size.width, height: size.height},
    isMobile: Boolean(size.mobile), hasTouch: Boolean(size.mobile), timezoneId: 'Europe/London',
    serviceWorkers: 'block'});
  const page = await context.newPage();
  await page.goto(`${base}?stop=${stopId}`, {waitUntil: 'load'});
  await page.waitForTimeout(6000);
  if (size.mobile) await page.locator('.sheet-toggle').first().click({timeout: 4000}).catch(() => {});
  await page.waitForTimeout(1200);
  await page.screenshot({path: join(out, `${size.name}-workspace.png`)});
  const board = page.locator('.departures');
  if (await board.count()) await board.screenshot({path: join(out, `${size.name}-board.png`)}).catch(() => {});
  const read = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.departure-row')].map(row => ({
      line: row.querySelector('.route-pill')?.textContent,
      to: row.querySelector('.departure-copy strong')?.textContent,
      at: row.querySelector('.departure-when strong')?.textContent,
      inWords: row.querySelector('.departure-when small')?.textContent,
      kind: row.querySelector('.departure-kind')?.textContent,
      bus: row.querySelector('.departure-bus')?.getAttribute('data-vehicle') ?? null}));
    const el = document.querySelector('.departures');
    return {rows, state: el?.getAttribute('data-departures') ?? null,
      missing: Boolean(document.querySelector('[data-departures-missing]')),
      stop: document.querySelector('.your-stop-copy strong, .sheet-words')?.textContent ?? null,
      sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth};
  });
  notes.push({size: size.name, ...read});
  console.log(size.name, JSON.stringify(read).slice(0, 700));
  await context.close();
}
writeFileSync(join(out, 'read.json'), JSON.stringify(notes, null, 1));
await browser.close(); stop();
console.log('frames ->', out);
