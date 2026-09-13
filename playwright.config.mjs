// Browser checks for the built site: pnpm build && pnpm test:browser
//
// These drive the real static export in a real Chromium with WebGL, so they can see what a
// passenger sees: whether the vector map painted, whether it survives clock updates, and
// whether the fallback takes over when it cannot. Run scripts/setup-browser.sh once first.
import {defineConfig} from '@playwright/test';
import {existsSync, readdirSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';

const port = Number(process.env.LM_PORT || 4173);
// Point at another build to compare, e.g. LM_SERVE_DIR=/path/to/before-out
const serveDir = process.env.LM_SERVE_DIR || 'out';
// Or at a server that is already running, e.g. LM_BASE_URL=http://localhost:3000 while
// `pnpm dev:live` publishes real positions. The real-feed checks need this.
const baseURL = process.env.LM_BASE_URL || `http://127.0.0.1:${port}`;

/** Use a cached Playwright Chromium if one exists, rather than downloading another. */
function cachedChromium() {
  if (process.env.LM_CHROME_PATH) return process.env.LM_CHROME_PATH;
  const cache = join(homedir(), '.cache/ms-playwright');
  if (!existsSync(cache)) return undefined;
  return readdirSync(cache)
    .filter(name => /^chromium-\d+$/.test(name))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
    .map(name => join(cache, name, 'chrome-linux64', 'chrome'))
    .find(existsSync);
}

const libs = process.env.LM_BROWSER_LIBS
  || join(homedir(), '.cache/lost-minutes/browser-libs/root/usr/lib/x86_64-linux-gnu');
const env = {...process.env};
if (existsSync(libs)) env.LD_LIBRARY_PATH = [libs, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');

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
    launchOptions: {
      executablePath: cachedChromium(),
      env,
      // SwiftShader gives a genuine software WebGL context, so MapLibre can paint here.
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
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
