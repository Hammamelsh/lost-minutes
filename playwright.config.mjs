// Browser checks for the built site: pnpm build && pnpm test:browser
//
// These drive the real static export in a real Chromium with WebGL, so they can see what a
// passenger sees: whether the vector map painted, whether it survives clock updates, and
// whether the fallback takes over when it cannot. Run scripts/setup-browser.sh once first.
import {defineConfig} from '@playwright/test';
import {launchOptions} from './tests/browser/browser-env.mjs';

const port = Number(process.env.LM_PORT || 4173);
// Point at another build to compare, e.g. LM_SERVE_DIR=/path/to/before-out
const serveDir = process.env.LM_SERVE_DIR || 'out';
// Or at a server that is already running, e.g. LM_BASE_URL=http://localhost:3000 while
// `pnpm dev:live` publishes real positions. The real-feed checks need this.
const baseURL = process.env.LM_BASE_URL || `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: 'tests/browser',
  testMatch: '**/*.spec.mjs',
  timeout: 150_000,
  expect: {timeout: 20_000},
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    baseURL,
    // The service worker would answer some requests itself and bypass test routing.
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    // A cached Chromium with SwiftShader, a genuine software WebGL, so MapLibre can paint here.
    launchOptions: launchOptions(),
  },
  projects: [
    {name: 'desktop', use: {viewport: {width: 1280, height: 900}}},
    {name: 'mobile', use: {viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true,
                           deviceScaleFactor: 2}},
  ],
  webServer: process.env.LM_BASE_URL ? undefined : {
    command: `python3 -m http.server ${port} --bind 127.0.0.1 --directory ${serveDir}`,
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: false,
    timeout: 20_000,
  },
});
