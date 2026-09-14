// Shared by the probes: the repository root, where a probe writes (outputs/probes/, not in Git),
// Chromium launched exactly as the browser checks launch it, and the built site served locally.
import {spawn} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
import {launchOptions} from '../../tests/browser/browser-env.mjs';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};

export function outDir(probe, label) {
  const dir = join(root, 'outputs/probes', probe, label);
  mkdirSync(dir, {recursive: true});
  return dir;
}

export const launch = () => chromium.launch(launchOptions());

/** The page at --base, or else out/ served on --port (default 4198) until stop() is called. */
export async function site() {
  const base = arg('base');
  if (base) return {base, stop: () => {}};
  const port = Number(arg('port', 4198));
  const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', join(root, 'out')],
    {stdio: 'ignore'});
  await new Promise(r => setTimeout(r, 1200));
  return {base: `http://127.0.0.1:${port}/`, stop: () => server.kill()};
}

export const fixtures = () => import('../../tests/browser/fixtures.mjs');
