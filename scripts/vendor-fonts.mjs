/**
 * Serve the two typefaces from this site, never from a font CDN.
 *
 * A bus app is read at a stop, on a phone, often on a poor connection, and it must not hand a
 * third party a request for every page view. Both families are variable woff2 files under the
 * SIL Open Font Licence 1.1, copied out of node_modules with their licences beside them:
 *
 *   Inter          the interface: stop names, destinations, ages, every small label
 *   Space Grotesk  the display voice: the wordmark, headings, route numbers, the HUD
 *
 * Only the latin subset is taken. The files are content-independent of the build, so they are
 * generated rather than committed, exactly as MapLibre's modules are.
 *
 *   node scripts/vendor-fonts.mjs      (run by pnpm dev, pnpm build and pnpm dev:live)
 */
import {copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const PROJECT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Each family: the package it comes from, the one file we serve, and the name we serve it as. */
export const FONTS = [
  {package: '@fontsource-variable/inter', file: 'inter-latin-wght-normal.woff2',
   served: 'inter-variable.woff2', family: 'Inter Variable'},
  {package: '@fontsource-variable/space-grotesk', file: 'space-grotesk-latin-wght-normal.woff2',
   served: 'space-grotesk-variable.woff2', family: 'Space Grotesk Variable'},
];

export function vendorFonts({root = PROJECT} = {}) {
  const target = join(root, 'public/fonts');
  mkdirSync(target, {recursive: true});
  const written = [];
  const notices = ['Typefaces served by Lost Minutes, each under the SIL Open Font Licence 1.1.',
                   'Copied from node_modules by scripts/vendor-fonts.mjs; not edited.', ''];
  for (const font of FONTS) {
    const pkg = join(root, 'node_modules', font.package);
    const source = join(pkg, 'files', font.file);
    if (!existsSync(source)) throw new Error(`${font.package} is not installed: ${source} is missing`);
    copyFileSync(source, join(target, font.served));
    const {version} = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8'));
    notices.push(`${font.family} (${font.package} ${version}) -> /fonts/${font.served}`,
                 readFileSync(join(pkg, 'LICENSE'), 'utf8').trim(), '');
    written.push(font.served);
  }
  writeFileSync(join(target, 'LICENCES.txt'), notices.join('\n'));
  return {target, written};
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const {target, written} = vendorFonts();
  console.log(`fonts: ${written.join(', ')} -> ${target}`);
}
