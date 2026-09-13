/**
 * Serve MapLibre's ES modules exactly as they ship.
 *
 * MapLibre's module build is three files that find each other by relative URL: the main
 * module starts its web worker from `maplibre-gl-worker.mjs` beside itself, and both import
 * `maplibre-gl-shared.mjs`. A bundler cannot keep that arrangement. Webpack rewrites
 * `import.meta.url` to the build machine's file path, so MapLibre's worker URL came out empty,
 * the browser started the worker from the page's own address, and no vector tile ever loaded.
 * It also wrote that private path into the shipped JavaScript.
 *
 * The files are copied into a folder named by version, so a cached copy can never mix two
 * releases, and the page imports them natively. Generated from node_modules; not in Git.
 *
 *   node scripts/vendor-maplibre.mjs     (run by pnpm dev, pnpm build and pnpm dev:live)
 */
import {copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const PROJECT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const MAPLIBRE_FILES = ['maplibre-gl.mjs', 'maplibre-gl-shared.mjs', 'maplibre-gl-worker.mjs'];

export function vendorMaplibre({root = PROJECT} = {}) {
  const pkg = join(root, 'node_modules/maplibre-gl');
  const {version} = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8'));
  const base = join(root, 'public/vendor/maplibre-gl');
  const target = join(base, version);
  mkdirSync(target, {recursive: true});
  // Only the installed release is served; an older folder would be dead weight in out/.
  for (const entry of readdirSync(base)) {
    if (entry !== version) rmSync(join(base, entry), {recursive: true, force: true});
  }
  for (const file of MAPLIBRE_FILES) {
    const source = join(pkg, 'dist', file);
    if (!existsSync(source)) throw new Error(`maplibre-gl ${version} has no dist/${file}; its module layout changed`);
    copyFileSync(source, join(target, file));
  }
  return {version, target};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const {version} = vendorMaplibre();
  console.log(`MapLibre ${version} modules ready in public/vendor/maplibre-gl/${version}/`);
}
