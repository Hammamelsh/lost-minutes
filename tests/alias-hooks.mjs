/* Resolve the project's "@/..." import alias for the Node test runner.
 * The alias is the codebase convention (tsconfig paths, used throughout components/), so
 * the tests learn it rather than the source being bent to suit the runner. */
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const ROOT = new URL('../', import.meta.url);
const SUFFIXES = ['', '.ts', '.tsx', '.mjs', '.js', '/index.ts'];

export function resolve(specifier, context, next) {
  if (specifier.startsWith('@/')) {
    const base = new URL(specifier.slice(2), ROOT).href;
    for (const suffix of SUFFIXES) {
      const candidate = base + suffix;
      if (existsSync(fileURLToPath(candidate))) return next(candidate, context);
    }
  }
  return next(specifier, context);
}
