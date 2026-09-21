// The passenger's own screens at phone and desktop sizes, with FIXTURE data on the built site:
//   - the first visit on a slow network (the recording held back 5 s), and once the map has drawn;
//   - a search with the on-screen keyboard up (a shortened viewport stands in for the keyboard);
//   - a stop chosen and saved; a bus chosen; the map made bigger; the outside ride-along and the
//     street preview;
//   - a visit to the engineering views and back: the stop, the bus and the ride must be the same;
//   - a return visit, as a new page on the same device.
// Every screen lists touch targets under 24 px (and under 44 px) that are not links inside a
// sentence, controls over the map that overlap or leave it, and sideways scroll. A control that
// cannot be pressed is reported with what covers it, and the rest of the flow goes on. Emulation in
// Chromium on this machine, not a phone.
//
//   node scripts/probes/passenger-layouts.mjs --base http://127.0.0.1:8098/ [--label name] [--only phone-390]
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {arg, fixtures, launch, outDir, site} from './common.mjs';

const out = outDir('passenger-layouts', arg('label', 'latest'));
const only = arg('only');
const {servePatterns, serveMotion, serveLive, movingLive, waitForPaint} = await fixtures();
const LONGFORD_PARK = {latitude: 53.4487, longitude: -2.3095, accuracy: 40};
const SIZES = [
  {name: 'phone-360', viewport: {width: 360, height: 800}, phone: true, keyboard: 300},
  {name: 'phone-390', viewport: {width: 390, height: 844}, phone: true, keyboard: 336},
  {name: 'landscape-800', viewport: {width: 800, height: 360}, phone: true},
  {name: 'landscape-844', viewport: {width: 844, height: 390}, phone: true},
  {name: 'desktop', viewport: {width: 1280, height: 900}, phone: false},
].filter(size => !only || size.name === only);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = {when: new Date().toISOString(), sizes: []};

/** What a passenger would have trouble with on this screen. */
function audit(page) {
  return page.evaluate(() => {
    const shown = el => {
      const r = el.getBoundingClientRect(), s = getComputedStyle(el);
      return r.width > 1 && r.height > 1 && s.visibility !== 'hidden' && s.display !== 'none'
        && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
    };
    const name = el => `${(el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || el.tagName)
      .trim().replace(/\s+/g, ' ').slice(0, 34)}`;
    const tiny = [], small = [], overlaps = [];
    for (const el of document.querySelectorAll('button, a[href], input, select, summary, [role=tab], [role=option]')) {
      if (!shown(el) || el.closest('p, li.stop-search-empty, [inert]')) continue;   // a link inside a sentence is exempt
      const r = el.getBoundingClientRect(), size = `${Math.round(r.width)}×${Math.round(r.height)}`;
      if (r.width < 24 || r.height < 24) tiny.push(`${name(el)} ${size}`);
      else if (r.width < 44 || r.height < 44) small.push(`${name(el)} ${size}`);
    }
    const root = document.querySelector('.vector-map');
    if (root && shown(root) && !root.closest('[inert]')) {
      const box = root.getBoundingClientRect();
      const els = [...root.querySelectorAll('button, a, .ride-mode, .ride-card, .map-loading')].filter(shown);
      for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
        const a = els[i], b = els[j];
        if (a.contains(b) || b.contains(a)) continue;
        const r = a.getBoundingClientRect(), q = b.getBoundingClientRect();
        const w = Math.min(r.right, q.right) - Math.max(r.left, q.left), h = Math.min(r.bottom, q.bottom) - Math.max(r.top, q.top);
        if (w > 2 && h > 2) overlaps.push(`${name(a)} / ${name(b)} ${Math.round(w)}×${Math.round(h)}`);
      }
      for (const el of els) {
        const r = el.getBoundingClientRect();
        if (r.left < box.left - 1 || r.right > box.right + 1 || r.top < box.top - 1 || r.bottom > box.bottom + 1)
          overlaps.push(`outside the map: ${name(el)}`);
        // Anything drawn over the middle of a map control, from inside the map or not (a strip
        // stuck to the top of the screen had covered the ride's way out, unseen by the pairs above).
        if (el.matches('button, a')) {
          const x = r.left + r.width / 2, y = r.top + r.height / 2;
          if (x >= 0 && y >= 0 && x <= innerWidth && y <= innerHeight) {
            const top = document.elementFromPoint(x, y);
            if (top && !el.contains(top) && !top.contains(el)) overlaps.push(`covered: ${name(el)} by ${name(top.closest('button, a, [role=status], div') ?? top)}`);
          }
        }
      }
    }
    const h1 = [...document.querySelectorAll('h1')].find(el => !el.closest('[inert]'));
    return {sideways: document.documentElement.scrollWidth > innerWidth + 1, tiny, small, overlaps,
      heading: h1?.textContent?.trim() ?? null};
  });
}

/** What is drawn over the middle of a control, if not the control itself. */
async function coveredBy(page, locator) {
  await locator.scrollIntoViewIfNeeded({timeout: 3000}).catch(() => {});
  const box = await locator.boundingBox().catch(() => null);
  if (!box) return 'not laid out';
  return page.evaluate(({x, y, w, h}) => {
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return `off screen (${Math.round(x)},${Math.round(y)})`;
    const el = document.elementFromPoint(x, y);
    if (!el) return 'nothing at its centre';
    const pressed = el.closest('button, a');
    const r = pressed?.getBoundingClientRect();
    if (pressed && r && Math.abs(r.x - (x - w / 2)) < 2 && Math.abs(r.y - (y - h / 2)) < 2) return null;
    return `covered by ${el.tagName.toLowerCase()}.${(typeof el.className === 'string' ? el.className : '').split(' ')[0]} "${(el.textContent || '').trim().slice(0, 30)}"`;
  }, {x: box.x + box.width / 2, y: box.y + box.height / 2, w: box.width, h: box.height});
}

async function flow(browser, base, size, status) {
  const ctx = await browser.newContext({viewport: size.viewport, deviceScaleFactor: 2, isMobile: size.phone,
    hasTouch: size.phone, permissions: ['geolocation'], geolocation: LONGFORD_PARK, serviceWorkers: 'block'});
  const page = await ctx.newPage();
  status.page = page;
  const step = name => { status.step = name; };
  const result = {size: size.name, screens: [], context: {}, errors: []};
  const shot = async (name, extra = {}) => {
    const file = `${size.name}-${name}.png`;
    await page.screenshot({path: join(out, file)});
    result.screens.push({name, file, ...(await audit(page)), ...extra});
  };
  page.on('pageerror', error => result.errors.push(error.message.slice(0, 160)));
  await servePatterns(page);
  await serveMotion(page);
  const startMs = Date.now() - 90_000;
  await serveLive(page, [() => movingLive({startMs, startS: 150, speed: 7})]);
  await page.route('**/data/replay.json', async route => { await wait(5000); await route.continue().catch(() => {}); });

  step('first visit');
  await page.goto(base);
  await wait(2000);
  await shot('first-visit-slow-network');
  await waitForPaint(page, {timeout: 60_000, note: size.name});
  await page.evaluate(() => scrollTo(0, 0));
  await wait(800);
  await shot('first-visit');

  step('search');
  const search = page.getByRole('combobox', {name: 'Bus number, stop or area'});
  if (size.keyboard) {
    await page.setViewportSize({width: size.viewport.width, height: size.viewport.height - size.keyboard});
    await search.click();
    await search.fill('stretford mall');
    await wait(600);
    const inView = await page.evaluate(() => [...document.querySelectorAll('.stop-search-option')].slice(0, 3)
      .map(o => { const r = o.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }));
    await shot('search-with-keyboard', {firstThreeOptionsInView: inView});
    await page.setViewportSize(size.viewport);
  } else {
    await search.fill('stretford mall');
  }
  step('choose and save the stop');
  await page.getByRole('option', {name: /Stop A/}).first().click();
  await page.locator('.your-stop-copy strong').waitFor();
  await page.getByRole('button', {name: 'Save this stop'}).click();
  await page.evaluate(() => scrollTo(0, 0));
  await wait(1000);
  await shot('stop-chosen');

  step('choose a bus');
  await page.getByRole('region', {name: 'Buses coming to your stop'}).locator('.follow-row').first().click();
  const card = page.locator('article.bus-card');
  await card.waitFor();
  const chosen = {vehicle: await card.getAttribute('data-vehicle'), selection: await card.getAttribute('data-selection')};
  step('bigger map');
  await page.getByRole('button', {name: 'Make the map bigger'}).click();
  await wait(1500);
  await shot('bigger-map');
  await page.getByRole('button', {name: 'Make the map smaller'}).click();
  await wait(800);
  result.context.afterBiggerMap = {vehicle: await card.getAttribute('data-vehicle')};

  step('ride along');
  await page.locator('.vector-map').evaluate(el => el.scrollIntoView({block: 'start'}));
  await page.getByRole('button', {name: /^Ride along with route/}).click();
  await page.waitForFunction(() => document.querySelector('.vector-map')?.getAttribute('data-ride') === 'following', null, {timeout: 20_000});
  await wait(2500);
  await shot('outside-ride');
  step('street preview');
  const front = page.getByRole('button', {name: 'Front view'});
  const frontBlocked = await coveredBy(page, front);
  if (frontBlocked) result.context.frontViewButton = frontBlocked;
  try {
    await front.click({timeout: 8000});
    await page.waitForFunction(() => document.querySelector('.vector-map')?.getAttribute('data-ride-camera') === 'front', null, {timeout: 10_000});
    await wait(2500);
    await shot('street-preview');
    await page.getByRole('button', {name: 'Outside view'}).click({timeout: 8000});
    await wait(1000);
  } catch (error) {
    result.context.streetPreview = `could not be opened: ${error.message.split('\n')[0]}`;
    await shot('street-preview-blocked');
  }

  // The engineering views and back again: nothing the passenger chose may change. On a phone the
  // ride-along is the whole screen, so it is left first, exactly as a passenger would.
  step('engineering and back');
  if (size.viewport.width <= 860 && await page.locator('.vector-map').getAttribute('data-ride') !== 'off') {
    await page.getByRole('button', {name: 'Exit ride-along'}).click({timeout: 8000});
    await wait(800);
  }
  await page.evaluate(() => { window.__lmCanvas = document.querySelector('.maplibregl-canvas'); });
  const before = {stop: await page.locator('.your-stop-copy strong').innerText(), vehicle: await card.getAttribute('data-vehicle'),
    ride: await page.locator('.vector-map').getAttribute('data-ride')};
  await page.getByRole('link', {name: /^Behind the (data|numbers)/}).first().click();
  await wait(1500);
  await page.evaluate(() => scrollTo(0, 0));
  await shot('engineering');
  await page.getByRole('link', {name: /Back to buses/}).or(page.getByRole('tab', {name: 'Follow'})).first().click({timeout: 10_000});
  await wait(2500);
  const after = {stop: await page.locator('.your-stop-copy strong').innerText({timeout: 3000}).catch(() => null),
    vehicle: await card.getAttribute('data-vehicle', {timeout: 3000}).catch(() => null),
    ride: await page.locator('.vector-map').getAttribute('data-ride', {timeout: 3000}).catch(() => null),
    sameMap: await page.evaluate(() => document.querySelector('.maplibregl-canvas') === window.__lmCanvas)};
  result.context.engineeringRoundTrip = {chosen, before, after};
  await shot('back-from-engineering');

  step('return visit');
  const again = await ctx.newPage();
  await servePatterns(again);
  await serveMotion(again);
  await serveLive(again, [() => movingLive({startMs, startS: 150, speed: 7})]);
  await again.goto(base.split('?')[0]);
  await waitForPaint(again, {timeout: 60_000, note: `${size.name} return`}).catch(() => {});
  await again.evaluate(() => scrollTo(0, 0));
  await wait(1500);
  const file = `${size.name}-return-visit.png`;
  await again.screenshot({path: join(out, file)});
  result.screens.push({name: 'return-visit', file, ...(await audit(again)),
    restoredStop: await again.locator('.your-stop-copy strong').innerText({timeout: 3000}).catch(() => null),
    restoredVehicle: await again.locator('article.bus-card').getAttribute('data-vehicle', {timeout: 3000}).catch(() => null)});
  await ctx.close();
  return result;
}

const browser = await launch();
const {base, stop} = await site();
for (const size of SIZES) {
  const status = {step: 'start', page: null};
  try { report.sizes.push(await flow(browser, base, size, status)); }
  catch (error) {
    const file = `${size.name}-FAILED.png`;
    await status.page?.screenshot({path: join(out, file)}).catch(() => {});
    report.sizes.push({size: size.name, failed: `${status.step}: ${error.message.split('\n')[0]}`, file});
  }
}
await browser.close();
stop();
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 1));
for (const s of report.sizes) {
  console.log(`\n== ${s.size}${s.failed ? `  FAILED at ${s.failed}` : ''}`);
  for (const screen of s.screens ?? []) console.log(`  ${screen.name}: h1 "${screen.heading}"${screen.sideways ? ' · SIDEWAYS SCROLL' : ''}`
    + `${screen.tiny.length ? ` · under 24 px: ${screen.tiny.join('; ')}` : ''}`
    + `${screen.small.length ? ` · under 44 px: ${screen.small.length}` : ''}`
    + `${screen.overlaps.length ? ` · overlaps: ${screen.overlaps.join('; ')}` : ''}`
    + `${screen.firstThreeOptionsInView ? ` · first options in view: ${screen.firstThreeOptionsInView.join(',')}` : ''}`
    + `${screen.restoredStop !== undefined ? ` · restored stop "${screen.restoredStop}", bus ${screen.restoredVehicle}` : ''}`);
  if (s.context && Object.keys(s.context).length) console.log('  context:', JSON.stringify(s.context));
  if (s.errors?.length) console.log('  page errors:', s.errors.join(' | '));
}
console.log(`\nframes and report.json in ${out}`);
