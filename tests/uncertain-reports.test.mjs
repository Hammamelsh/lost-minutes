// Reports the evidence contradicts, on a checked road (25 September 2026). One GPS fix pushed off the
// road, or a moment's jump backwards along it, is not somewhere the bus went: it is left out when the
// reports either side agree along the road, and the newest such report is held until the next one
// confirms or contradicts it. Two reports off the road together are a real diversion and are drawn
// where they were made: nothing puts a bus on a road its reports do not support.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {historyFrom, observedAt, stepVisual, makeTrack, project, buildPath, drawingFor} from '../lib/motion.ts';

const LAT = 53.47, LON0 = -2.30, M = 111195 * Math.cos(LAT * Math.PI / 180);
const road = makeTrack('P:road', Array.from({length: 41}, (_, i) => [LON0 + (i * 100) / M, LAT]), []);
const T = Date.parse('2026-09-25T08:00:00Z');
/** A report every 20 s at [metres along, metres north of the road]. */
const reports = places => places.map(([s, side = 0], i) => ({at: T + i * 20_000, lat: LAT + side / 111195, lon: LON0 + s / M,
 bearing: null, service: 's', source: 'h'}));
const turn = (a, b) => ((b - a) % 360 + 540) % 360 - 180;

/** Ridden as the page rides it: a publication 12 s after each report, polled every 20 s, 10 frames a second. */
function ride(all, fromS = 20, seconds = 200) {
 const frames = [];
 let vis = null;
 const start = T + fromS * 1000;
 for (let w = start; w <= start + seconds * 1000; w += 100) {
  const polled = start + Math.floor((w - start) / 20_000) * 20_000;
  const fixes = all.filter(r => r.at + 12_000 <= polled).map((f, i, a) => ({...f, availableAt: i === a.length - 1 ? f.at + 12_000 : null}));
  if (!fixes.length) continue;
  const h = historyFrom(fixes), e = observedAt(h, w, 'x');
  vis = stepVisual(vis, e, w, null, drawingFor(e, null), h, road);
  frames.push({w, lat: vis.lat, lon: vis.lon, bearing: vis.bearing, off: project(road, vis).offset,
   said: vis.lastCorrection?.kind === 'snap' && vis.lastCorrection.at === w});
 }
 return frames;
}

test('one report pushed 70 m off the road between two on it is not travelled to', () => {
 const all = reports([[100], [260], [420, 70], [580], [740], [900], [1060], [1220]]);
 assert.equal(buildPath(all, road).held, 1, 'the contradicted report is left out');
 const frames = ride(all);
 const worstOff = Math.max(...frames.map(f => f.off));
 assert.ok(worstOff < 3, `drawn ${worstOff.toFixed(1)} m off the road (it went through the block before)`);
 const worstTurn = Math.max(...frames.filter(f => f.bearing !== null).map(f => Math.abs(turn(f.bearing, 90))));
 assert.ok(worstTurn < 10, `faced ${worstTurn.toFixed(0)}° off the road's direction`);
 assert.equal(frames.filter(f => f.said).length, 0, 'nothing to reposition');
});

test('a report jumping back along the road and forward again is not followed backwards', () => {
 const all = reports([[100], [260], [420], [300], [740], [900], [1060], [1220]]);
 assert.equal(buildPath(all, road).held, 1);
 const frames = ride(all);
 let back = 0;
 for (let i = 1; i < frames.length; i++) back = Math.max(back, (frames[i - 1].lon - frames[i].lon) * M);
 assert.ok(back < 0.5, `drawn ${back.toFixed(1)} m backwards in a frame`);
});

test('the newest report off the road is held until the next one says what it was', () => {
 const early = reports([[100], [260], [420], [580, 70]]);
 assert.equal(buildPath(early, road).held, 1, 'held while nothing confirms it');
 assert.equal(buildPath(early.slice(0, 3), road).nodes.length, buildPath(early, road).nodes.length,
  'the path ends at the last supported report');
});

test('two reports off the road together are a diversion, drawn where they were made', () => {
 const all = reports([[100], [260], [420, 70], [560, 75], [700, 70], [860], [1020], [1180], [1340]]);
 assert.equal(buildPath(all, road).held, 0, 'nothing is left out: the reports agree with each other');
 const frames = ride(all, 20, 220);
 const worstOff = Math.max(...frames.map(f => f.off));
 assert.ok(worstOff > 50, `the drawing follows the diversion (${worstOff.toFixed(0)} m off at most)`);
});
