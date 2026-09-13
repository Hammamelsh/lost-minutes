// The vector map's lifecycle, in the real built site and a real WebGL browser.
//
// Regression: FollowView once passed fresh inline callbacks to CityMap, whose creation
// effect depended on them. The page re-renders every five seconds to advance displayed ages,
// so every re-render destroyed and recreated the map, and effect cleanup cancelled the
// seven-second fallback before it could fire. These tests fail on that build.
import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {test, expect} from '@playwright/test';
import {liveFromArchive, pixelVariety, serveLive, watchBasemap} from './fixtures.mjs';

const CLOCK_TICK_MS = 5000;     // app/page.tsx advances every displayed age on this interval
const map = page => page.locator('.vector-map');
const canvases = page => page.locator('.maplibregl-canvas');
// The drawn fallback map itself, not the icons inside its zoom buttons.
const fallbackMap = page => page.locator('.follow-map svg[role="img"]');

test.describe('vector map lifecycle', () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== 'desktop', 'lifecycle does not depend on viewport');
  });

  test('is created once and survives clock updates and live refreshes', async ({page}) => {
    const served = await serveLive(page, [
      () => liveFromArchive(), () => liveFromArchive({nudgeMetres: 60}),
      () => liveFromArchive({nudgeMetres: 120}), () => liveFromArchive({nudgeMetres: 180}),
    ]);
    await page.goto('/');
    await expect(canvases(page)).toHaveCount(1, {timeout: 30_000});
    await page.evaluate(() => { window.__lmFirstCanvas = document.querySelector('.maplibregl-canvas'); });
    // Four clock updates and at least one live refresh (the fixture config polls every 10 s),
    // sampled each second. A refresh resets the displayed age, so it alternates between a few
    // values: the evidence that the page kept re-rendering is how often it changed.
    const when = page.locator('.follow-bar-when');
    let changes = 0, previous = await when.innerText();
    for (let second = 0; second < 22; second += 1) {
      await page.waitForTimeout(1000);
      const current = await when.innerText();
      if (current !== previous) changes += 1;
      previous = current;
    }

    const identity = await page.evaluate(() => {
      const all = document.querySelectorAll('.maplibregl-canvas');
      return {count: all.length, sameCanvas: all[0] === window.__lmFirstCanvas,
              stillAttached: Boolean(window.__lmFirstCanvas?.isConnected)};
    });
    expect(identity, 'the map must not be torn down and rebuilt by clock updates')
      .toEqual({count: 1, sameCanvas: true, stillAttached: true});
    expect(changes, 'the displayed age kept changing, so the page re-rendered throughout').toBeGreaterThanOrEqual(3);
    expect(served.count, 'live state was refreshed during the window').toBeGreaterThanOrEqual(2);
    await expect(fallbackMap(page), 'no fallback on a healthy map').toHaveCount(0);
    await expect(map(page), 'and that one map settled').toHaveAttribute('data-map-state', 'painted');
  });

  test('keeps the camera where the passenger put it through clock updates', async ({page}) => {
    await serveLive(page, [() => liveFromArchive(), () => liveFromArchive({nudgeMetres: 60})]);
    await page.goto('/');
    await expect(map(page)).toHaveAttribute('data-map-state', 'painted', {timeout: 45_000});
    await page.getByRole('button', {name: 'Zoom in'}).click();
    await page.getByRole('button', {name: 'Zoom in'}).click();
    await expect(map(page)).not.toHaveAttribute('data-camera', '');
    await page.waitForTimeout(700);
    const placed = await map(page).getAttribute('data-camera');
    await page.waitForTimeout(CLOCK_TICK_MS * 3 + 1000);
    await expect(map(page)).toHaveAttribute('data-camera', placed);
  });

  test('paints a real basemap: vector tiles, glyphs and visible geography', async ({page}) => {
    const fetched = watchBasemap(page);
    await serveLive(page, [() => liveFromArchive()]);
    await page.goto('/');
    await expect(map(page)).toHaveAttribute('data-map-state', 'painted', {timeout: 45_000});
    await page.waitForTimeout(1500);
    const variety = await pixelVariety(page, map(page));
    test.info().annotations.push({type: 'basemap', description: JSON.stringify({fetched, variety})});
    expect(fetched.style, 'style fetched').toBeGreaterThan(0);
    expect(fetched.tiles, 'vector tiles fetched').toBeGreaterThan(0);
    expect(fetched.glyphs, 'label glyphs fetched').toBeGreaterThan(0);
    // Calibrated in this browser: a painted dark basemap measured 28 quantised colours with
    // 52.6% of pixels off the background; the same map with its tiles blocked measured 1 and 0.
    expect(variety.distinctColours, 'not a flat rectangle').toBeGreaterThan(12);
    expect(variety.nonDominantFraction, 'geography covers the map').toBeGreaterThan(0.15);
  });
});

test.describe('fallback', () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== 'desktop', 'fallback does not depend on viewport');
  });

  async function expectFallbackThatLasts(page) {
    await expect(fallbackMap(page)).toBeVisible({timeout: 15_000});
    await expect(canvases(page)).toHaveCount(0);
    // It must stay usable while the clock keeps updating.
    await page.waitForTimeout(CLOCK_TICK_MS * 2 + 1000);
    await expect(fallbackMap(page)).toBeVisible();
    expect(await page.locator('.follow-map .bus-marker').count()).toBeGreaterThan(0);
    await expect(page.getByRole('button', {name: 'Zoom in'})).toBeVisible();
  }

  test('takes over at once when WebGL is absent', async ({page}) => {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
        return /webgl/i.test(String(type)) ? null : original.call(this, type, ...rest);
      };
    });
    await serveLive(page, [() => liveFromArchive()]);
    await page.goto('/');
    await expectFallbackThatLasts(page);
  });

  test('takes over when the basemap metadata never arrives', async ({page}) => {
    // Our style is inline; what can stall is the TileJSON naming the tile set.
    await page.context().route(/tiles\.openfreemap\.org\/planet(\?|$)/, () => { /* never answered */ });
    await serveLive(page, [() => liveFromArchive()]);
    await page.goto('/');
    await expectFallbackThatLasts(page);
  });

  test('takes over when the tile host refuses every request', async ({page}) => {
    await page.context().route(/tiles\.openfreemap\.org\//, route => route.abort());
    await serveLive(page, [() => liveFromArchive()]);
    await page.goto('/');
    await expectFallbackThatLasts(page);
  });

  test('takes over when every vector tile fails after the style loads', async ({page}) => {
    await page.context().route(/tiles\.openfreemap\.org\/planet\/.+\.pbf/, route => route.abort());
    await serveLive(page, [() => liveFromArchive()]);
    await page.goto('/');
    await expectFallbackThatLasts(page);
  });
});

// Regression: bundled, MapLibre's worker URL came out empty (webpack rewrote import.meta.url to
// a build-machine file path), so its worker was started from the page itself and every tile
// request died with it, in any browser. The same rewrite shipped that private path.
test.describe('shipped map modules', () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== 'desktop', 'the shipped files do not depend on viewport');
  });

  test('MapLibre starts its worker from its own module folder, never from the page', async ({page}) => {
    const workers = [];
    page.on('worker', worker => workers.push(new URL(worker.url()).pathname));
    await serveLive(page, [() => liveFromArchive()]);
    await page.goto('/');
    await expect(map(page)).toHaveAttribute('data-map-state', 'painted', {timeout: 45_000});
    expect(workers.length, 'at least one map worker started').toBeGreaterThan(0);
    for (const path of workers) expect(path).toMatch(/^\/vendor\/maplibre-gl\/\d+\.\d+\.\d+\/maplibre-gl-worker\.mjs$/);
  });

  test('the built site carries no build-machine paths', () => {
    const root = process.env.LM_SERVE_DIR || 'out';
    const leaks = [];
    const walk = dir => {
      for (const entry of readdirSync(dir, {withFileTypes: true})) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.(m?js|html|css|json|txt|webmanifest)$/.test(entry.name)) {
          const found = readFileSync(path, 'utf8').match(/file:\/\/\/|\/(?:home|Users)\/[\w.-]+\//);
          if (found) leaks.push(`${path}: ${found[0]}`);
        }
      }
    };
    walk(root);
    expect(leaks).toEqual([]);
  });
});
