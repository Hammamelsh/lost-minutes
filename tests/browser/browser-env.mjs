// How the browser checks and the probes in scripts/probes find and launch Chromium: a cached
// Playwright Chromium, the libraries scripts/setup-browser.sh installs without root, and
// SwiftShader, which gives a genuine software WebGL context so MapLibre can paint.
import {existsSync, readdirSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';

/** Use a cached Playwright Chromium if one exists, rather than downloading another. */
export function cachedChromium() {
  if (process.env.LM_CHROME_PATH) return process.env.LM_CHROME_PATH;
  const cache = join(homedir(), '.cache/ms-playwright');
  if (!existsSync(cache)) return undefined;
  return readdirSync(cache)
    .filter(name => /^chromium-\d+$/.test(name))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
    .map(name => join(cache, name, 'chrome-linux64', 'chrome'))
    .find(existsSync);
}

/** The environment Chromium needs: the rootless libraries first on the library path. */
export function browserEnv() {
  const libs = process.env.LM_BROWSER_LIBS
    || join(homedir(), '.cache/lost-minutes/browser-libs/root/usr/lib/x86_64-linux-gnu');
  const env = {...process.env};
  if (existsSync(libs)) env.LD_LIBRARY_PATH = [libs, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');
  return env;
}

export const launchOptions = () => ({
  executablePath: cachedChromium(),
  env: browserEnv(),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
