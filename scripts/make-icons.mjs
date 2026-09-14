// PNG icons drawn from the two SVGs, for the places that will not take an SVG: iOS's home screen
// (apple-touch-icon, 180 px, opaque, since iOS rounds the corners itself) and the install sizes
// browsers ask for (192 and 512 px, and a maskable 512 px with its mark inside the safe zone).
// Drawn by the same Chromium the browser checks use.
//
//   node scripts/make-icons.mjs
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
import {launchOptions} from '../tests/browser/browser-env.mjs';

const file = name => fileURLToPath(new URL(`../public/${name}`, import.meta.url));
const svg = name => `data:image/svg+xml;base64,${readFileSync(file(name)).toString('base64')}`;
const targets = [
  {out: 'apple-touch-icon.png', from: 'icon-maskable.svg', size: 180, opaque: true},
  {out: 'icon-192.png', from: 'favicon.svg', size: 192},
  {out: 'icon-512.png', from: 'favicon.svg', size: 512},
  {out: 'icon-maskable-512.png', from: 'icon-maskable.svg', size: 512, opaque: true},
];

const browser = await chromium.launch(launchOptions());
const page = await browser.newPage();
for (const target of targets) {
  await page.setViewportSize({width: target.size, height: target.size});
  await page.setContent(`<html><body style="margin:0;background:${target.opaque ? '#0d1721' : 'transparent'}">`
    + `<img src="${svg(target.from)}" width="${target.size}" height="${target.size}" style="display:block"></body></html>`);
  await page.locator('img').evaluate(img => img.decode());
  await page.screenshot({path: file(target.out), omitBackground: !target.opaque});
  console.log(`public/${target.out}  ${target.size}×${target.size}${target.opaque ? ', opaque' : ''}`);
}
await browser.close();
