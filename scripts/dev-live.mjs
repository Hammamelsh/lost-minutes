#!/usr/bin/env node
/**
 * Run the frontend and the collector together for local development.
 *
 *   pnpm dev:live              90 minutes of collection alongside next dev
 *   pnpm dev:live -- --minutes 20
 *
 * The collector keeps its own single-writer lock, so a second dev:live refuses rather than
 * interleaving writes. `pnpm dev` still runs the frontend alone. The key is read by the
 * Python side from .env and never passes through this process, the command line or the
 * browser.
 */
import {spawn} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import {createInterface} from 'node:readline';
import {vendorMaplibre} from './vendor-maplibre.mjs';
import {vendorFonts} from './vendor-fonts.mjs';

const root = new URL('..', import.meta.url).pathname;
const args = process.argv.slice(2);
const minutes = Number(args[args.indexOf('--minutes') + 1]) || 90;
const python = existsSync(`${root}.venv/bin/python`) ? `${root}.venv/bin/python` : 'python3';

function hasKey() {
  if (process.env.BODS_API_KEY) return 'environment';
  try {
    const env = readFileSync(`${root}.env`, 'utf8');
    return /^\s*BODS_API_KEY\s*=\s*\S/m.test(env) ? '.env' : null;
  } catch { return null; }
}

const source = hasKey();
if (!source) {
  console.error('\n  No BODS_API_KEY found in the environment or in .env.');
  console.error('  Copy .env.example to .env and add the key, then run this again.');
  console.error('  The frontend alone still works: pnpm dev\n');
  process.exit(1);
}

const children = [];
let shuttingDown = false;

function start(name, command, commandArgs, onLine) {
  const child = spawn(command, commandArgs, {cwd: root, env: process.env,
                                              stdio: ['ignore', 'pipe', 'pipe']});
  children.push({name, child});
  for (const stream of [child.stdout, child.stderr]) {
    createInterface({input: stream}).on('line', line => {
      if (onLine) onLine(line);
      console.log(`  [${name}] ${line}`);
    });
  }
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    // Say which side ended and how, so a stopped collection has a recorded reason.
    console.log(`\n  ${name} exited (${signal ? `signal ${signal}` : `code ${code}`}). `
                + 'Shutting the other side down too.');
    shutdown(code ?? 0);
  });
  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\n  Stopping the collector and the frontend…');
  for (const {name, child} of children) {
    if (child.exitCode === null) {
      child.kill('SIGINT');               // lets the collector record the stop and release its lock
      // `child.killed` only says a signal was sent; escalate if the process is still there.
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }, 4000).unref();
      console.log(`  stopped ${name}`);
    }
  }
  setTimeout(() => process.exit(code), 500).unref();
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
// A closed terminal sends SIGHUP; stop both sides politely rather than vanish mid-run.
process.on('SIGHUP', () => shutdown(0));

console.log(`\n  Lost Minutes — frontend and collector together`);
console.log(`  key source: ${source} (never printed, never sent to the browser)`);
console.log(`  collecting for ${minutes} minutes, publishing to public/data/live.json\n`);

const ready = {frontend: false, collector: false};
function announce() {
  if (ready.frontend && ready.collector) {
    console.log('\n  READY — http://localhost:3000 with live positions.');
    console.log('  Press Ctrl-C to stop both cleanly.\n');
  }
}

start('collector', python, ['-m', 'pipeline.collect', '--minutes', String(minutes)], line => {
  if (!ready.collector && line.includes('"outcome"')) {ready.collector = true; announce();}
  if (line.includes('collector_busy')) {
    console.error('\n  Another collector already holds the writer lock. Stop it first.\n');
  }
});

vendorMaplibre();   // the map's own modules, served unbundled from public/vendor
vendorFonts();      // the two typefaces, served from public/fonts
start('frontend', 'node', ['node_modules/next/dist/bin/next', 'dev'], line => {
  if (!ready.frontend && /Ready in|localhost:3000/.test(line)) {ready.frontend = true; announce();}
});
