// Street tracks (lib/streets.ts): a bus with no checked road drawn along the map's streets between its reports. Each
// case is a fault the fleet check found on 30 September 2026 (scripts/evaluate-fleet-playback.mjs --osm --streets).
import test from 'node:test';
import assert from 'node:assert/strict';
import {extendStreets, isStreetTrack, prepareStreets, streetBox, streetTrack, streetsFrom, STREETS} from '../lib/streets.ts';
import {buildPath, metres} from '../lib/motion.ts';

const O = {lat: 53.5, lon: -2.28};
const KX = 111195 * Math.cos(O.lat * Math.PI / 180);
const at = (east, north) => [O.lon + east / KX, O.lat + north / 111195];
const fix = (east, north, s, bearing = null) => { const [lon, lat] = at(east, north); return {lat, lon, at: s * 1000, bearing}; };
const street = (points, extra = {}) => ({coords: points.map(([e, n]) => at(e, n)), cls: 'minor', ...extra});
const offTrack = (track, f) => {
  let best = Infinity;
  for (let i = 0; i + 1 < track.points.length; i++) {
    const [ax, ay] = [(track.points[i][0] - f.lon) * KX, (track.points[i][1] - f.lat) * 111195];
    const [bx, by] = [(track.points[i + 1][0] - f.lon) * KX, (track.points[i + 1][1] - f.lat) * 111195];
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
};

test('round a bend the track follows the street, where the straight line cut the corner', () => {
  // The owner's 74 at Charlestown: reports on an L-shaped street, the line between two of them 40 m inside the bend.
  const L = [street([[0, 0], [0, 100], [100, 100]])];
  const fixes = [fix(0, 20, 0), fix(0, 70, 10), fix(40, 100, 20), fix(90, 100, 30)];
  const track = streetTrack(fixes, L);
  assert.ok(track && isStreetTrack(track));
  const road = {points: L[0].coords};
  // Every point of the track is on the street, the rounded corner within 4 m of it (a bus cuts a corner that much).
  for (const [lon, lat] of track.points) assert.ok(offTrack(road, {lon, lat}) < 4, `on the street (${offTrack(road, {lon, lat}).toFixed(1)} m)`);
  const corner = {lon: at(0, 100)[0], lat: at(0, 100)[1]};
  assert.ok(offTrack(track, corner) < 4, `round the corner (${offTrack(track, corner).toFixed(1)} m from it)`);
  // The straight line between the second and third reports, as the bus was drawn before, is 15 m off the street.
  const chordMiddle = {lon: (fixes[1].lon + fixes[2].lon) / 2, lat: (fixes[1].lat + fixes[2].lat) / 2};
  assert.ok(offTrack(road, chordMiddle) >= 14.9);
});

test('a road cut at a tile edge, its two copies sharing no point, is still one road', () => {
  // Tile A's copy runs to 110 m, tile B's from 90 m: the loose end at 110 m lies on B's line, mid-segment.
  const lines = [street([[0, 0], [110, 0.4]]), street([[90, 0.3], [250, 0]])];
  const track = streetTrack([fix(10, 0, 0), fix(120, 0, 10), fix(230, 0, 20)], lines);
  assert.ok(track, 'joined across the edge');
  assert.ok(track.length > 200 && track.length < 240, `along the road, ${track.length.toFixed(0)} m`);
});

test('a one-way street is driven only its way', () => {
  // A one-way street against the bus, and a two-way street round the block: the bus goes round.
  const lines = [street([[100, 0], [0, 0]], {oneway: 1}), street([[0, 0], [0, 35], [100, 35], [100, 0]])];
  const track = streetTrack([fix(5, 0, 0), fix(95, 0, 20)], lines);
  assert.ok(track, 'joined');
  assert.ok(track.length > 170, `round the block, not along the one-way street (${track.length.toFixed(0)} m)`);
});

test('of a dual carriageway, the carriageway running the bus\'s way is taken, and it never turns back on itself', () => {
  // Two one-way lines 10 m apart, joined at both ends; southbound on the west one. Reports scatter between them.
  const lines = [street([[0, 200], [0, 0]], {oneway: 1}), street([[10, 0], [10, 200]], {oneway: 1}),
    street([[0, 200], [10, 200]]), street([[0, 0], [10, 0]])];
  const fixes = [fix(3, 180, 0, 180), fix(7, 140, 8, 180), fix(2, 100, 16, 180), fix(8, 60, 24, 180)];
  const track = streetTrack(fixes, lines);
  assert.ok(track, 'joined');
  for (const [lon] of track.points) assert.ok(Math.abs((lon - O.lon) * KX) < 2, 'on the southbound line throughout');
});

test('a way between two reports that turns back on itself, even round two corners, is refused', () => {
  // Two-way streets side by side 4 m apart, joined at their north end: a U through a short connector, two right
  // angles 4 m apart. A report on the east one after one on the west, both heading north, is scatter across, not a
  // bus that drove to the end and back down in 10 s.
  const lines = [street([[0, 0], [0, 100]]), street([[0, 100], [4, 100]]), street([[4, 100], [4, 0]])];
  const run = extendStreets(null, [fix(0, 40, 0, 0), fix(0, 70, 10, 0)], () => lines);
  const kept = run.points.slice();
  const next = extendStreets(run, [fix(0, 40, 0, 0), fix(0, 70, 10, 0), fix(4, 80, 20, 0)], () => lines);
  assert.deepEqual(next.points, kept, 'the U is not taken');
});

test('extended as reports arrive, the track never changes what is already drawn', () => {
  const lines = [street([[0, 0], [0, 300], [300, 300]])];
  const all = [fix(0, 10, 0), fix(0, 80, 10), fix(0, 160, 20), fix(0, 240, 30), fix(60, 300, 40), fix(150, 300, 50)];
  let run = null, before = null;
  for (let n = 2; n <= all.length; n++) {
    run = extendStreets(run, all.slice(Math.max(0, n - 4), n), () => lines);
    if (before) for (let k = 0; k < before.length - 1; k++) assert.deepEqual(run.points[k], before[k], `point ${k} kept at report ${n}`);
    before = run.points.slice();
  }
  assert.ok(run.track.length > 350);
});

test('a standing bus\'s scatter back along the track does not turn it round; a creep forward extends it', () => {
  const lines = [street([[0, 0], [0, 200]])];
  let run = extendStreets(null, [fix(0, 50, 0), fix(0, 100, 10)], () => lines);
  const tip = run.points.at(-1);
  run = extendStreets(run, [fix(0, 50, 0), fix(0, 100, 10), fix(0, 95, 20)], () => lines);
  assert.deepEqual(run.points.at(-1), tip, 'scatter 5 m back: the same place');
  run = extendStreets(run, [fix(0, 100, 10), fix(0, 95, 20), fix(0, 106, 30)], () => lines);
  assert.ok(metres({lon: run.points.at(-1)[0], lat: run.points.at(-1)[1]}, {lon: at(0, 106)[0], lat: at(0, 106)[1]}) < 1, 'a 6 m creep: added');
});

test('a way to a later report that does not pass the report passed over is refused', () => {
  // The 52: a report the streets did not join (off the mapped streets, 40 m east), and a later one joined only by a
  // way round the block that report was not on.
  const lines = [street([[0, 0], [0, 100]]), street([[0, 100], [0, 200], [100, 200], [100, 250]])];
  let run = extendStreets(null, [fix(0, 10, 0, 0), fix(0, 90, 10, 0)], () => lines);
  const kept = run.points.slice();
  run = extendStreets(run, [fix(0, 10, 0, 0), fix(0, 90, 10, 0), fix(45, 150, 20, 45), fix(100, 240, 35, 0)], () => lines);
  assert.deepEqual(run.points, kept, 'the track waits at its end');
});

test('a set of streets grown a tile at a time routes as one read at once', () => {
  // The page holds one set, and its graph grows as each tile arrives, so that no frame builds one. Two tiles: a road
  // cut at their edge (x = 100) with a side road in each, and a one-way loop in the second.
  const west = [street([[0, 0], [100, 0]]), street([[40, 0], [40, 80]])];
  const east = [street([[100, 0], [250, 0]]), street([[180, 0], [180, 60], [220, 60], [220, 0]], {oneway: 1})];
  const fixes = [fix(10, 0, 0), fix(90, 0, 8), fix(170, 0, 16), fix(185, 50, 24), fix(220, 30, 32)];
  const grown = [...west];
  prepareStreets(grown, O.lat);
  assert.equal(streetTrack(fixes, grown), null, 'with only the first tile, no way to the reports in the second');
  grown.push(...east);
  prepareStreets(grown, O.lat);
  const once = streetTrack(fixes, [...west, ...east]), grownTrack = streetTrack(fixes, grown);
  assert.ok(once && grownTrack);
  // The same way, to a centimetre (each graph takes its scale from the latitude it was first given).
  assert.equal(grownTrack.points.length, once.points.length);
  grownTrack.points.forEach(([lon, lat], k) => assert.ok(metres({lon, lat}, {lon: once.points[k][0], lat: once.points[k][1]}) < 0.01));
  assert.ok(grownTrack.length > 250, `round the loop, ${grownTrack.length.toFixed(0)} m`);
});

test('streets are asked for round what is joined, and read from the map\'s own features', () => {
  const box = streetBox([{lat: 53.5, lon: -2.28}]);
  assert.ok(box[2] - box[0] > 2 * STREETS.padMetres / 111195 * 0.99);
  const lines = streetsFrom([
    {geometry: {type: 'LineString', coordinates: [[-2.28, 53.5], [-2.279, 53.5]]}, properties: {class: 'minor', oneway: 1}},
    {geometry: {type: 'MultiLineString', coordinates: [[[-2.28, 53.5], [-2.28, 53.501]]]}, properties: {class: 'service'}},
    {geometry: {type: 'LineString', coordinates: [[-2.28, 53.5], [-2.279, 53.501]]}, properties: {class: 'path'}}]);
  assert.equal(lines.length, 2, 'footpaths are not driven');
  assert.equal(lines[0].oneway, 1);
});

test('a report off a street track is never held as a fault, as one off a checked road is', () => {
  // Off a street track a report is more often the map's streets than the report: holding it stood the bus at the
  // track's end while its reports drove on (the fleet check).
  const lines = [street([[0, 0], [0, 200]])];
  const fixes = [fix(0, 20, 0), fix(0, 80, 10), fix(60, 160, 20), fix(0, 190, 30)];
  const track = streetTrack(fixes.slice(0, 2), lines);
  const onStreet = buildPath(fixes, track);
  assert.equal(onStreet.held, 0);
  assert.equal(onStreet.nodes.length, fixes.length);
  const checked = buildPath(fixes, {...track, id: 'BNML:15:outbound:x'});
  assert.ok(checked.held >= 0, 'a checked road keeps its rule');
});
