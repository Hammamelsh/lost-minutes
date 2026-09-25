// Nothing from the tests reaches what the site publishes (25 September 2026). A vehicle called
// TEST_BUS was offered as a ride; traced to source it was upstream — BNML's own feed, VehicleRef
// TEST_BUS and VehicleUniqueId TEST on scheduled journey 3117, in the raw capture whose SHA-256 the
// publication carried — not our fixtures. This holds the boundary it could have crossed: the browser
// fixtures (FX-… vehicles, FX:256 patterns, "FIXTURE" timetables) live only in tests/ and are served
// by the test runner's network stubs, never written where the site is built from or deployed.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync, readFileSync, statSync, existsSync} from 'node:fs';
import {join, extname} from 'node:path';

const MARKERS = [/"FX[-:_][A-Za-z0-9]/, /FIXTURE timetable|FIXTURE motion|"runId":\s*"FIXTURE"/, /FX_256_(main|branch)/];
const TEXT = new Set(['.json', '.js', '.mjs', '.html', '.txt', '.webmanifest', '.css', '.svg']);
function* files(dir) {
 for (const name of readdirSync(dir)) {
  const path = join(dir, name);
  if (statSync(path).isDirectory()) yield* files(path);
  else if (TEXT.has(extname(name))) yield path;
 }
}
const scan = dir => [...files(dir)].flatMap(path => {
 const text = readFileSync(path, 'utf8');
 return MARKERS.filter(m => m.test(text)).map(m => `${path}: ${m}`);
});

test('the fixtures carry the markers this check looks for, so it would see them', () => {
 const fixtures = readFileSync(new URL('./browser/fixtures.mjs', import.meta.url), 'utf8');
 assert.ok(/'FX-MOVING'/.test(fixtures) && /FX:256:main/.test(fixtures) && /FIXTURE/.test(fixtures));
});

test('nothing the site is built from carries a fixture', () => {
 assert.deepEqual(scan('public'), []);
});

test('nothing built for deployment carries a fixture', { skip: !existsSync('out') && 'no build here' }, () => {
 assert.deepEqual(scan('out').filter(hit => !hit.startsWith(join('out', 'vendor'))), []);
});

test('a deploy never sends the tests, the probes or local evidence', () => {
 const exclude = readFileSync('deploy/rsync-exclude.txt', 'utf8').split('\n').map(l => l.trim());
 for (const path of ['/outputs/', '/data/', 'test-results/', 'playwright-report/', '/tests/'])
  assert.ok(exclude.includes(path), `deploy/rsync-exclude.txt leaves out ${path}`);
});
