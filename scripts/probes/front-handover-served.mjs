// The glide into the front view on the served site, on real buses: the ride entered from a bus link, the front view
// chosen once the bus is drawn moving, and where the glide ended against the first frame after it (data-front-handover).
import {chromium} from '@playwright/test';
import {launchOptions} from '../../tests/browser/browser-env.mjs';
const base = 'https://lost-minutes.duckdns.org';
const keys = process.argv.slice(2);
const b = await chromium.launch(launchOptions());
for (const [profile, opts] of [...(process.env.ONLY_DESKTOP ? [] : [['phone', {viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, deviceScaleFactor: 2}]]), ['desktop', {viewport: {width: 1280, height: 900}}]]) {
  for (const key of keys) {
    const ctx = await b.newContext({...opts, serviceWorkers: 'block', timezoneId: 'Europe/London', locale: 'en-GB'});
    const page = await ctx.newPage();
    const out = {profile, key};
    try {
      await page.goto(`${base}/?bus=${encodeURIComponent(key)}`, {waitUntil: 'load'});
      await page.locator('.vector-map[data-map-state="painted"]').waitFor({timeout: 45_000});
      await page.getByRole('button', {name: /^Ride along with route/}).first().click({timeout: 20_000});
      await page.locator('.vector-map[data-ride="following"]').waitFor({timeout: 20_000});
      await page.waitForTimeout(4000);
      const front = page.getByRole('button', {name: 'Front view', exact: true});
      await front.waitFor({timeout: 15_000});
      out.before = await page.locator('.vector-map').getAttribute('data-display');
      await front.click({timeout: 10_000});
      await page.locator('.vector-map[data-ride-camera="front"]').waitFor({timeout: 10_000});
      await page.waitForTimeout(3000);
      out.rideCamera = await page.locator('.vector-map').getAttribute('data-ride-camera');
      out.handover = await page.locator('.vector-map').getAttribute('data-front-handover');
      out.after = await page.locator('.vector-map').getAttribute('data-display');
      out.note = await page.locator('.ride-front-note, [data-front-note]').first().innerText({timeout: 500}).catch(() => null);
    } catch (error) { out.error = error.message.split('\n')[0]; }
    console.log(JSON.stringify(out));
    await ctx.close();
  }
}
await b.close();
