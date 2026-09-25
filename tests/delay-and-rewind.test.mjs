// Two things the release record states about a ride played back from a bus's reports (25 September
// 2026). The card's figure is how long ago the moment is that the drawn place stands for — now less
// that moment — so it includes the latest report's own age and can never be less than it. And when a
// report arrives saying the bus had moved on while it was drawn waiting, the *clock* is set back to
// the drawn place's own moment; the drawn bus is never moved backwards by it. The first failed on
// a63006b: while the bus stood at its newest report the clock ran a smoothing window past it, and
// the card said "drawn where its reports put it about 5 seconds ago" of a report 20 s old. The
// second held on a63006b as well: it keeps the release record's answer true.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {historyFrom, observedAt, stepVisual, drawingFor, makeTrack, decodePolyline} from '../lib/motion.ts';

// A bus on a straight road due north: its progress is its distance north of the start.
const LAT0 = 53.4, M = 111195, T0 = Date.parse('2026-09-25T20:00:00Z');
const at = (s, x) => ({at: T0 + s * 1000, lat: LAT0 + x / M, lon: -2.2, bearing: 0});
const progress = v => (v.lat - LAT0) * M;

/** The drawing as the page runs it: a report reaches a publication 12.4 s after it was made (or at
 *  `arrives`, for one filed late), the page polls every 20 s, the trail is the last 75 s of reports,
 *  and a frame is drawn every 100 ms. */
function ride(reports, seconds, road = null, start = T0) {
 const frames = [];
 let vis = null;
 for (let w = start; w <= start + seconds * 1000; w += 100) {
  const polled = start + Math.floor((w - start) / 20_000) * 20_000;
  const upto = reports.filter(r => (r.arrives ?? r.at + 12_400) <= polled).sort((a, b) => a.at - b.at);
  if (!upto.length) continue;
  const newest = upto.at(-1).at;
  const fixes = upto.filter(r => newest - r.at <= 75_000)
   .map((f, i, a) => ({at: f.at, lat: f.lat, lon: f.lon, bearing: f.bearing, service: 's', source: 'h',
    availableAt: i === a.length - 1 ? f.at + 12_000 : null}));
  const h = historyFrom(fixes), e = observedAt(h, w, 'movement on this service has not been evaluated');
  vis = stepVisual(vis, e, w, null, drawingFor(e, null), h, road);
  if (!vis.buffer) continue;
  frames.push({w, newest: e.basis.at, shown: vis.buffer.shown, represented: vis.buffer.represented, x: progress(vis),
   lat: vis.lat, lon: vis.lon, bearing: vis.bearing, said: vis.lastCorrection?.kind === 'snap' && vis.lastCorrection.at === w});
 }
 return frames;
}

// Moving at 6 m/s with a report every 20 s; standing 60 s at 480 m (three reports there); on again.
const moving = [
 ...[0, 20, 40, 60, 80].map(s => at(s, s * 6)),
 at(100, 480), at(120, 480), at(140, 480),
 ...[160, 180, 200, 220, 240, 260].map(s => at(s, 480 + (s - 140) * 6)),
];
// The same bus, whose first report after the stand is filed late: made at 160 s, it reaches the page
// at 210 s, after the one made at 180 s, and is filed in between two reports already drawn. The path
// under the bus changes, and the moment the clock shows is set back to the drawn place's own.
const late = moving.map(r => (r.at === T0 + 160_000 ? {...r, arrives: T0 + 210_000} : r));

test('the figure is never newer than the newest report, moving or standing at it', () => {
 for (const [name, reports] of [['moving', moving], ['late', late]]) {
  const frames = ride(reports, 360);
  const waiting = frames.filter(f => f.shown >= f.newest);
  assert.ok(waiting.length > 100, `${name}: the ride waits at its newest report for a while`);
  for (const f of frames) {
   assert.ok(f.represented <= f.newest,
    `${name} at ${(f.w - T0) / 1000} s: the drawn place said to stand for ${(f.represented - f.newest) / 1000} s after the newest report`);
  }
 }
});

test('a report saying the bus had moved on sets the clock back, and the drawn bus never goes back', () => {
 const frames = ride(late, 360);
 const rewinds = frames.filter((f, i) => i > 0 && f.shown < frames[i - 1].shown - 500);
 assert.ok(rewinds.length >= 1, 'the late reports set the clock back');
 for (let i = 1; i < frames.length; i++) {
  if (frames[i].said) continue;
  assert.ok(frames[i].x >= frames[i - 1].x - 0.01,
   `at ${(frames[i].w - T0) / 1000} s the drawn bus went back ${(frames[i - 1].x - frames[i].x).toFixed(2)} m`);
 }
 // What the rewind does to the figure: the moment drawn is set back with the clock, so the card's
 // figure grows — the drawn place is older than it was thought to be — and the bus pulls away from
 // where it waited rather than racing to where the late reports put it.
 const r = rewinds[0], before = frames[frames.indexOf(r) - 1];
 assert.ok(r.w - r.represented >= before.w - before.represented, 'the figure does not shrink at a rewind');
});

// A V2 inbound (BNGN 2326, journey 1086) on 24 September 2026, reports as the server captured them.
// Its road runs one street twice. On a63006b, when a publication dropped its oldest report, the drawn
// bus was re-anchored by projecting it onto the whole road: the projection took the other pass, the
// place fell outside its own stretch and went to the stretch's start, 46 m behind, and the bus was
// eased back 36 m along its road facing forwards, with nothing said. No report had moved.
const shape = JSON.parse(readFileSync(new URL('../public/data/shapes/BNGN_V2_inbound_710ebd4dd2.json', import.meta.url), 'utf8'));
const v2Road = makeTrack('BNGN:V2:inbound:710ebd4dd2', decodePolyline(shape.polyline6, 6), shape.stopOffsets ?? []);
const V2 = [
 ['17:30:11', 53.481297, -2.250852, 103], ['17:30:35', 53.481284, -2.250607, 103], ['17:30:42', 53.481134, -2.249806, 111],
 ['17:31:06', 53.480993, -2.248976, 103], ['17:31:29', 53.480911, -2.248372, 102], ['17:31:53', 53.480857, -2.248276, 102],
 ['17:32:07', 53.480546, -2.246809, 109], ['17:32:29', 53.480328, -2.245819, 109], ['17:32:41', 53.480328, -2.245819, null],
 ['17:33:05', 53.480328, -2.245819, null], ['17:33:29', 53.480323, -2.24572, null], ['17:33:53', 53.480152, -2.245093, 129],
 ['17:34:11', 53.479567, -2.243721, 133], ['17:34:32', 53.479496, -2.243629, 133],
].map(([t, lat, lon, bearing]) => ({at: Date.parse(`2026-09-24T${t}Z`), lat, lon, bearing}));
const turn = (a, b) => ((b - a) % 360 + 540) % 360 - 180;
const metres = (a, b) => Math.hypot((b.lat - a.lat) * M, (b.lon - a.lon) * M * Math.cos(a.lat * Math.PI / 180));
const dirOf = (a, b) => (Math.atan2((b.lon - a.lon) * Math.cos(a.lat * Math.PI / 180), b.lat - a.lat) * 180 / Math.PI + 360) % 360;

test('a publication that only drops its oldest report does not move the drawn bus back on a road used twice', () => {
 const frames = ride(V2, 300, v2Road, V2[0].at);
 let back = 0;
 for (let i = 1; i < frames.length; i++) {
  const a = frames[i - 1], b = frames[i], step = metres(a, b);
  if (b.said || step < 0.05 || b.bearing == null) continue;
  if (Math.abs(turn(b.bearing, dirOf(a, b))) > 120) back += step;
 }
 assert.ok(frames.length > 2000, 'the ride was drawn');
 assert.ok(back < 2, `drawn ${back.toFixed(1)} m against the way it faces, nothing said`);
});
