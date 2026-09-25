// A bus standing on its road, as the served site met one on 25 September 2026: BNML BU25YVP, a 216
// at Piccadilly Gardens (journey 1191), reporting from one spot 3.4 m from its checked road for six
// minutes with no bearing. On 5c00509 the drawing called the stretch between two reports at one
// spot an off-road chord: the card read "Off its checked road", the bus had no heading, and the
// ride camera swung 69° when one first appeared. Reports as the server captured them.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {historyFrom, observedAt, stepVisual, makeTrack, decodePolyline, drawingFor, pointAt, headingAhead} from '../lib/motion.ts';

const shape = JSON.parse(readFileSync(new URL('../public/data/shapes/BNML_216_outbound_26b006bf73.json', import.meta.url), 'utf8'));
const road = makeTrack('BNML:216:outbound:26b006bf73', decodePolyline(shape.polyline6, 6), shape.stopOffsets ?? []);
const T = s => Date.parse(`2026-09-25T${s}Z`);
const served = [
 ['00:02:51', 53.481114, -2.235955, 109], ['00:03:05', 53.481114, -2.235955, null],
 ...['00:03:29', '00:03:53', '00:04:05', '00:04:29', '00:04:53', '00:05:05', '00:05:29', '00:05:53', '00:06:05',
  '00:06:32', '00:06:44', '00:07:08', '00:07:32', '00:07:44'].map(t => [t, 53.481159, -2.235869, null]),
].map(([t, lat, lon, bearing]) => ({at: T(t), lat, lon, bearing}));
const turn = (a, b) => ((b - a) % 360 + 540) % 360 - 180;

/** The drawing as the page runs it from `start`: a publication 12.4 s after each report, polled
 *  every 20 s, the trail the last 75 s of reports, a frame every 100 ms. */
function ride(reports, start, seconds = 90) {
 const frames = [];
 let vis = null;
 for (let w = start; w <= start + seconds * 1000; w += 100) {
  const polled = start + Math.floor((w - start) / 20_000) * 20_000;
  const upto = reports.filter(r => r.at + 12_400 <= polled), last = upto.at(-1);
  const fixes = upto.filter(r => last.at - r.at <= 75_000)
   .map((f, i, a) => ({...f, service: 's', source: 'h', availableAt: i === a.length - 1 ? f.at + 12_000 : null}));
  const h = historyFrom(fixes), e = observedAt(h, w, 'movement on this service has not been evaluated');
  vis = stepVisual(vis, e, w, null, drawingFor(e, null), h, road);
  frames.push({w, bearing: vis.bearing, onRoad: vis.buffer?.onRoad ?? null, lat: vis.lat, lon: vis.lon});
 }
 return frames;
}

test('a bus standing on its road is drawn on it and faces along it, however late the page meets it', () => {
 const along = headingAhead(road, 20);
 for (const start of ['00:04:40', '00:05:10', '00:05:40', '00:06:20']) {
  const frames = ride(served, T(start));
  const off = frames.filter(f => f.onRoad !== true).length, blind = frames.filter(f => f.bearing === null).length;
  assert.equal(off, 0, `met at ${start}: ${off} of ${frames.length} frames called off its road, 3.4 m from it`);
  assert.equal(blind, 0, `met at ${start}: ${blind} of ${frames.length} frames with no heading`);
  const worst = Math.max(...frames.map(f => Math.abs(turn(f.bearing, along))));
  assert.ok(worst <= 20, `met at ${start}: faced ${worst.toFixed(0)}° from its road`);
 }
});

test('reports scattered a few metres back along the road do not turn a standing bus round', () => {
 // A stand at 300 m along the 216's road, reports every 20 s: 0, 4 m back, 1 m on, 6 m back, 2 m
 // back, each 2–3 m to one side, as GPS scatters round a standing bus. No bearing reported.
 const at = s => { const p = pointAt(road, s); return {lat: p.lat + 0.00002, lon: p.lon}; };
 const reports = [300, 296, 301, 294, 298, 297, 300].map((s, i) => ({at: T('00:20:00') + i * 20_000, ...at(s), bearing: null}));
 const frames = ride(reports, T('00:21:00'), 100);
 const along = headingAhead(road, 300);
 const worst = Math.max(...frames.filter(f => f.bearing !== null).map(f => Math.abs(turn(f.bearing, along))));
 assert.ok(worst <= 25, `the standing bus turned ${worst.toFixed(0)}° from its road`);
 assert.equal(frames.filter(f => f.onRoad !== true).length, 0, 'called off its road');
});

test('a standing bus with no checked road does not turn on the spot as its reports scatter', () => {
 // As a 143 stood at Piccadilly Gardens on 22 September 2026 (the fleet check): one report with a
 // bearing, then reports scattered 3–5 m round the spot in every direction, a report every 20 s.
 const c = {lat: 53.480585, lon: -2.23825}, off = (n, e) => ({lat: c.lat + n / 111195, lon: c.lon + e / (111195 * Math.cos(c.lat * Math.PI / 180))});
 const scatter = [[0, 0], [0, 0], [-3, 1.3], [-5.8, 2.1], [-6.4, 0.3], [-1.9, -2.8], [2.1, 0.7], [0.1, 0], [-2.3, -2.4], [-4.5, -5.6], [-6.5, -4.8]];
 const reports = scatter.map(([n, e], i) => ({at: T('00:30:00') + i * 20_000, ...off(n, e), bearing: i === 0 ? 129 : null}));
 const frames = [];
 let vis = null;
 for (let w = T('00:30:40'); w <= reports.at(-1).at + 60_000; w += 100) {
  const upto = reports.filter(r => r.at + 12_400 <= w);
  const h = historyFrom(upto.slice(-5).map(f => ({...f, service: 's', source: 'h'}))), e = observedAt(h, w, 'no road');
  vis = stepVisual(vis, e, w, null, drawingFor(e, null), h, null);
  frames.push({w, bearing: vis.bearing, lat: vis.lat, lon: vis.lon});
 }
 const metres = (a, b) => Math.hypot((b.lat - a.lat) * 111195, (b.lon - a.lon) * 111195 * Math.cos(a.lat * Math.PI / 180));
 let worst = 0;
 for (let i = 0; i < frames.length; i++) for (let j = i + 1; j < frames.length && frames[j].w - frames[i].w <= 5000; j++) {
  if (frames[i].bearing === null || frames[j].bearing === null) continue;
  const travelled = frames.slice(i + 1, j + 1).reduce((a, f, k) => a + metres(frames[i + k], f), 0);
  if (travelled < 2) worst = Math.max(worst, Math.abs(turn(frames[i].bearing, frames[j].bearing)));
 }
 assert.ok(worst <= 30, `turned ${worst.toFixed(0)}° within 5 s while drawn moving under 2 m`);
});
