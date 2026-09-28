// A road shape's explicit stop mapping (lib/stop-mapping.ts), on every published shape, checked against geometry
// it did not come from; the real inbound-15 failure; a stop visited twice; a route that leaves the area and comes
// back; and every way an old or foreign mapping is refused rather than paired by position.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {STOP_MAPPING_VERSION, alignedOffsets} from '../lib/stop-mapping.ts';

const read = path => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url)));
const index = read('public/data/shapes/index.json');
const patterns = new Map(read('public/data/patterns.json').patterns.map(p => [p.id, p]));
const coords = new Map(read('public/data/stops.json').stops.map(s => [s.id, [s.lat, s.lon]]));
const shapeOf = id => read(`public/data/shapes/${index.patterns[id].file}`);

// The geometry, independently of pipeline/stop_mapping.py: the polyline decoded here, measured here.
function decode(text) {
 const points = []; let i = 0, lat = 0, lon = 0;
 const next = () => { let r = 0, s = 0, b; do { b = text.charCodeAt(i++) - 63; r |= (b & 0x1f) << s; s += 5; } while (b >= 0x20); return r & 1 ? ~(r >> 1) : r >> 1; };
 while (i < text.length) { lat += next(); lon += next(); points.push([lat / 1e6, lon / 1e6]); }
 return points;
}
const R = 6371008.8, rad = Math.PI / 180;
const metres = (a, b) => Math.hypot((b[1] - a[1]) * rad * Math.cos((a[0] + b[0]) / 2 * rad), (b[0] - a[0]) * rad) * R;
function pointAt(points, cum, s) {
 if (s <= 0) return points[0];
 for (let i = 1; i < points.length; i++) if (cum[i] >= s) {
  const t = cum[i] === cum[i - 1] ? 0 : (s - cum[i - 1]) / (cum[i] - cum[i - 1]);
  return [points[i - 1][0] + t * (points[i][0] - points[i - 1][0]), points[i - 1][1] + t * (points[i][1] - points[i - 1][1])];
 }
 return points[points.length - 1];
}
function road(shape) {
 const points = decode(shape.polyline6), cum = [0];
 for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + metres(points[i - 1], points[i]));
 return {points, cum, length: cum[cum.length - 1]};
}
const offRoad = (r, stop, offset) => metres(pointAt(r.points, r.cum, offset), coords.get(stop));

test('every published shape carries a version-2 mapping that agrees with its pattern', () => {
 assert.equal(index.stopMappingVersion, STOP_MAPPING_VERSION);
 let checked = 0, differ = 0;
 for (const [id, entry] of Object.entries(index.patterns)) {
  if (!entry.file) continue;
  const shape = shapeOf(id), pattern = patterns.get(id);
  assert.ok(pattern, `${id} is in the catalogue`);
  const aligned = alignedOffsets(shape.stopMapping, pattern, road(shape).length);
  assert.ok(!('error' in aligned), `${id}: ${aligned.error}`);
  // The positions-only list is the same offsets, in road order.
  assert.deepEqual(shape.stopMapping.occurrences.map(o => o.offset), shape.stopOffsets, `${id}: stopOffsets in road order`);
  if (shape.stopMapping.occurrences.some((o, k) => o.index !== k)) differ++;
  checked++;
 }
 assert.equal(checked, 560);
 assert.equal(differ, 284, 'the shapes a list-position reading got wrong');
});

test('every mapped stop lies beside its road at the offset the mapping gives it (checked here, not in Python)', () => {
 let worst = 0, stops = 0;
 for (const [id, entry] of Object.entries(index.patterns)) {
  if (!entry.file) continue;
  const shape = shapeOf(id), r = road(shape);
  for (const {stop, offset} of shape.stopMapping.occurrences) {
   if (!coords.has(stop)) continue;
   worst = Math.max(worst, offRoad(r, stop, offset)); stops++;
  }
 }
 assert.ok(stops > 15000, `${stops} stops`);
 assert.ok(worst <= 30, `worst ${worst.toFixed(1)} m`);
});

test('inbound 15, the case that went wrong: Hillingdon Road (opp) is where the mapping says, not 14 stops on', () => {
 const id = 'BNML:15:inbound:9c10700c6c', shape = shapeOf(id), pattern = patterns.get(id), r = road(shape);
 const j = pattern.stops.indexOf('1800SJ32251');
 assert.equal(j, 30);
 const {offsets} = alignedOffsets(shape.stopMapping, pattern, r.length);
 assert.equal(offsets.slice(0, 14).every(o => o === null), true, 'its first 14 stops are outside the area');
 assert.ok(Math.abs(offsets[j] - 5495) < 1, `mapped at ${offsets[j]}`);
 assert.ok(offRoad(r, '1800SJ32251', offsets[j]) < 10, 'beside the road there');
 // Read by list position, as every reader did until 28 September 2026: the offset of the stop 14 places on.
 const byPosition = shape.stopOffsets[j];
 assert.ok(Math.abs(byPosition - 8715) < 1);
 assert.ok(offRoad(r, '1800SJ32251', byPosition) > 1000, 'over a kilometre from the stop: the geometry refutes it');
});

test('a stop visited twice is two occurrences, each at its own place on the road', () => {
 // BNSM 56 outbound runs a loop through six stops twice (stops 20-25 and 37-42 of its pattern).
 const id = 'BNSM:56:outbound:9565daeba7', shape = shapeOf(id), pattern = patterns.get(id), r = road(shape);
 const twice = [...new Set(pattern.stops.filter((s, k) => pattern.stops.indexOf(s) !== k && coords.has(s)))];
 assert.equal(twice.length, 6);
 for (const stop of twice) {
  const occ = shape.stopMapping.occurrences.filter(o => o.stop === stop);
  assert.equal(occ.length, 2, `${stop} twice`);
  assert.deepEqual(occ.map(o => o.index), pattern.stops.flatMap((s, k) => s === stop ? [k] : []), 'each on its own index');
  assert.ok(occ[1].offset - occ[0].offset > 4000, 'a loop apart along the road');
  for (const o of occ) assert.ok(offRoad(r, o.stop, o.offset) <= 30);
 }
});

test('a route that leaves the area and comes back keeps each stop after the gap on its own index', () => {
 const id = 'BNFM:708:outbound:b546703322', shape = shapeOf(id), pattern = patterns.get(id);
 const indices = shape.stopMapping.occurrences.map(o => o.index);
 assert.deepEqual(indices.slice(0, 3), [0, 7, 8], 'stops 1 to 6 are outside the area and have no offset');
 const {offsets} = alignedOffsets(shape.stopMapping, pattern);
 assert.equal(offsets.slice(1, 7).every(o => o === null), true);
});

test('an old, foreign or damaged mapping is refused, never paired by position', () => {
 const id = 'BNML:15:inbound:9c10700c6c', shape = shapeOf(id), pattern = patterns.get(id), m = shape.stopMapping;
 const refused = (mapping, p = pattern) => 'error' in alignedOffsets(mapping, p);
 assert.ok(refused(undefined), 'a file from before version 2');
 assert.ok(refused({...m, version: 1}) && refused({...m, version: 3}), 'another version');
 assert.ok(refused(m, {...pattern, id: 'BNML:15:inbound:1d743b5dae'}), 'another pattern');
 assert.ok(refused(m, {...pattern, stops: pattern.stops.slice(1)}), 'a stop list of another length');
 const occurrences = m.occurrences.map(o => ({...o}));
 occurrences[5].stop = occurrences[6].stop;
 assert.ok(refused({...m, occurrences}), 'a stop code that is not the pattern’s at that index');
 const reordered = [...m.occurrences]; [reordered[3], reordered[4]] = [reordered[4], reordered[3]];
 assert.ok(refused({...m, occurrences: reordered}), 'occurrences out of order');
 assert.ok(refused({...m, occurrences: m.occurrences.map((o, k) => k === 10 ? {...o, offset: 1} : o)}), 'an offset going backwards');
});
