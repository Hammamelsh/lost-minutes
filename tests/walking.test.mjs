// Walking directions: what is sent, what comes back, and every way it can fail.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DEFAULT_WALKING,fetchWalkingRoute,preflight,readOsrm,rerouteDecision,roundForRouting,
        walkingUrl,walkWords} from '../lib/walking.ts';

const HERE = {lat: 53.448712, lon: -2.309487, accuracyMetres: 40};
const STOP = {id: '1800SJ00811', lat: 53.44629, lon: -2.31056};
const recorded = JSON.parse(readFileSync(new URL('./browser/recorded/osrm-foot-longford-park-to-stretford-mall-stop-a.json', import.meta.url)));
const reply = (status, body) => async () => new Response(typeof body === 'string' ? body : JSON.stringify(body),
 {status, headers: {'content-type': 'application/json'}});

test('only a rounded origin and the stop are sent, to the configured foot router', () => {
 assert.deepEqual(roundForRouting(HERE), {lat: 53.4487, lon: -2.3095});
 const url = walkingUrl(DEFAULT_WALKING, roundForRouting(HERE), STOP);
 assert.equal(url, 'https://routing.openstreetmap.de/routed-foot/route/v1/foot/-2.3095,53.4487;-2.31056,53.44629'
  + '?overview=full&geometries=geojson&alternatives=false&steps=false');
 assert.ok(!url.includes('53.448712'), 'the precise fix never leaves the device');
});

test('a recorded router answer becomes a walking route with its distance, time and path', async () => {
 let seen;
 const route = await fetchWalkingRoute(DEFAULT_WALKING, HERE, STOP, {now: () => 1000,
  fetchImpl: async (url, init) => {seen = {url, init}; return new Response(JSON.stringify(recorded), {status: 200})}});
 assert.equal(route.kind, 'route');
 assert.ok(route.metres > 200 && route.metres < 600, `${route.metres} m`);
 assert.ok(route.seconds > 120 && route.seconds < 600);
 assert.ok(route.path.length >= 2);
 assert.equal(seen.init.credentials, 'omit');
 assert.equal(seen.init.referrerPolicy, 'origin');
 assert.deepEqual(walkWords(route), {time: `${Math.round(route.seconds / 60)} min`, distance: `${Math.round(route.metres / 10) * 10} m`});
});

test('every failure is a stated problem, never a straight line or a driving route', async () => {
 const ctx = [DEFAULT_WALKING, HERE, STOP];
 assert.equal((await fetchWalkingRoute(...ctx, {fetchImpl: reply(400, {code: 'NoRoute', message: 'Impossible route'})})).code, 'no_route');
 assert.equal((await fetchWalkingRoute(...ctx, {fetchImpl: reply(400, {code: 'NoSegment'})})).code, 'unreachable');
 assert.equal((await fetchWalkingRoute(...ctx, {fetchImpl: reply(429, {code: 'TooMany'})})).code, 'rate_limited');
 assert.equal((await fetchWalkingRoute(...ctx, {fetchImpl: reply(502, '<html>bad gateway</html>')})).code, 'failed');
 assert.equal((await fetchWalkingRoute(...ctx, {fetchImpl: async () => {throw new TypeError('network')}})).code, 'failed');
 assert.equal(readOsrm({code: 'Ok', routes: []}, {from: HERE, to: STOP, stopId: STOP.id, at: 0, provider: 'x'}).code, 'failed');
 const slow = await fetchWalkingRoute({...DEFAULT_WALKING, timeoutSeconds: 0.05}, HERE, STOP,
  {fetchImpl: (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))))});
 assert.equal(slow.code, 'timeout');
 assert.ok(slow.retry);
});

test('no request is made without a usable location, near enough to walk', () => {
 assert.equal(preflight(null, STOP, DEFAULT_WALKING).code, 'no_location');
 assert.equal(preflight({...HERE, accuracyMetres: 1500}, STOP, DEFAULT_WALKING).code, 'inaccurate');
 assert.equal(preflight({lat: 53.48, lon: -2.24}, STOP, DEFAULT_WALKING).code, 'too_far');
 assert.equal(preflight(HERE, STOP, {...DEFAULT_WALKING, provider: 'none'}).code, 'disabled');
 assert.equal(preflight(HERE, STOP, DEFAULT_WALKING), null);
});

test('location jitter does not re-route; real movement does, but not more than the policy allows', () => {
 const last = {stopId: STOP.id, from: {lat: 53.4487, lon: -2.3095}, at: 0};
 const moved = (m, t, accuracy = 20) => rerouteDecision(last, {stopId: STOP.id, now: t,
  here: {lat: 53.4487 + m / 111195, lon: -2.3095, accuracyMetres: accuracy}}, DEFAULT_WALKING);
 assert.equal(rerouteDecision(null, {stopId: STOP.id, here: HERE, now: 0}, DEFAULT_WALKING).go, true);
 assert.equal(moved(25, 60_000).go, false, 'a 25 m wobble is jitter');
 assert.equal(moved(70, 60_000, 60).go, false, 'within twice the reported accuracy is jitter too');
 assert.equal(moved(200, 3_000).go, false, 'too soon after the last request');
 assert.equal(moved(200, 30_000).go, true);
 assert.equal(rerouteDecision(last, {stopId: 'other', here: HERE, now: 1}, DEFAULT_WALKING).go, true, 'a new stop always routes');
});
