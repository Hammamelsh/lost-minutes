/**
 * Serve CesiumJS from this site, as MapLibre is served: copied out of node_modules into a folder
 * named by version, never from a CDN, and never in Git. Cesium finds its workers, assets and
 * third-party decoders relative to CESIUM_BASE_URL, which the page sets to this folder before it
 * loads the script. Nothing here is loaded until a passenger opens the view from above.
 *
 *   node scripts/vendor-cesium.mjs     (run by pnpm dev, pnpm build and pnpm dev:live)
 */
import {cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const PROJECT = join(dirname(fileURLToPath(import.meta.url)), '..');
/** The parts of Cesium's build the viewer can reach: the library, its workers and decoders, the
 *  assets it loads on demand (approximation textures, the IAU data), and the widget stylesheet. */
export const CESIUM_PARTS = ['Cesium.js', 'Workers', 'ThirdParty', 'Assets', 'Widgets'];

export function vendorCesium({root = PROJECT} = {}) {
  const pkg = join(root, 'node_modules/cesium');
  if (!existsSync(pkg)) return null;
  const {version} = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8'));
  const base = join(root, 'public/vendor/cesium');
  const target = join(base, version);
  mkdirSync(target, {recursive: true});
  for (const entry of readdirSync(base)) {
    if (entry !== version) rmSync(join(base, entry), {recursive: true, force: true});
  }
  for (const part of CESIUM_PARTS) {
    const source = join(pkg, 'Build/Cesium', part);
    if (!existsSync(source)) throw new Error(`cesium ${version} has no Build/Cesium/${part}; its layout changed`);
    cpSync(source, join(target, part), {recursive: true});
  }
  // The page reads the version from here at runtime (a JSON import in lib/ would need a build-time
  // attribute Node's test runner and the bundler disagree on), so the folder named by version is found.
  writeFileSync(join(base, 'version.json'), JSON.stringify({version}));
  return {version, target};
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const done = vendorCesium();
  if (done) console.log(`cesium ${done.version} -> ${done.target}`);
  else console.log('cesium not installed; the view from above is not vendored');
}
