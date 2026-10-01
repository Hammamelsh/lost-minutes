// The page's own reader of the map's vector tiles (lib/mvt.ts) against the standard decoder (@mapbox/vector-tile, in
// node_modules through MapLibre), on a real OpenFreeMap tile kept from the fleet check (data/evaluation/osm-tiles).
// Skipped where no tile has been fetched on this machine (data/ is not in Git).
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {tileStreets, tilesCovering} from '../lib/mvt.ts';
import {DRIVABLE} from '../lib/streets.ts';

const dir = 'data/evaluation/osm-tiles';
const files = existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.pbf')) : [];
const standard = async () => {
  const {VectorTile} = await import('../node_modules/.pnpm/@mapbox+vector-tile@3.0.0/node_modules/@mapbox/vector-tile/index.js');
  const {PbfReader} = await import('../node_modules/.pnpm/pbf@5.1.2/node_modules/pbf/index.js');
  return (buf, z, x, y) => {
    const layer = new VectorTile(new PbfReader(buf)).layers.transportation, out = [];
    for (let i = 0; layer && i < layer.length; i++) {
      const f = layer.feature(i);
      if (f.type !== 2 || !DRIVABLE.has(f.properties.class)) continue;
      const gj = f.toGeoJSON(x, y, z).geometry;
      for (const c of gj.type === 'LineString' ? [gj.coordinates] : gj.coordinates) out.push({coords: c, cls: f.properties.class, oneway: Number(f.properties.oneway ?? 0)});
    }
    return out;
  };
};

test('the drivable streets of a real tile read as the standard decoder reads them', {skip: !files.length && 'no tile fetched here'}, async () => {
  const read = await standard();
  // The tile at Charlestown (the owner's 74), else any.
  const charlestown = tilesCovering([53.4964, -2.2943, 53.4964, -2.2943])[0];
  const name = files.find(f => f.endsWith(`-14-${charlestown[0]}-${charlestown[1]}.pbf`)) ?? files.find(f => readFileSync(`${dir}/${f}`).length > 50_000) ?? files[0];
  const [zz, xx, yy] = name.replace('.pbf', '').split('-').slice(-3).map(Number);
  const buf = readFileSync(`${dir}/${name}`);
  const mine = tileStreets(buf, zz, xx, yy, {clip: false}), theirs = read(buf, zz, xx, yy);
  assert.ok(theirs.length > 50, `a tile with streets (${theirs.length})`);
  assert.equal(mine.length, theirs.length, 'the same lines');
  for (let i = 0; i < mine.length; i++) {
    assert.equal(mine[i].cls, theirs[i].cls);
    assert.equal(mine[i].oneway, theirs[i].oneway);
    assert.equal(mine[i].coords.length, theirs[i].coords.length);
    for (let k = 0; k < mine[i].coords.length; k++) {
      assert.ok(Math.abs(mine[i].coords[k][0] - theirs[i].coords[k][0]) < 1e-9 && Math.abs(mine[i].coords[k][1] - theirs[i].coords[k][1]) < 1e-9);
    }
  }
});

test('cut at the tile\'s edge, the two copies of a road crossing it end together', {skip: !files.length && 'no tile fetched here'}, () => {
  // Each tile carries a road a little past its edge, simplified its own way, so the copies overlapped without meeting,
  // and whether they were joined depended on which tile the page read first (30 September 2026). Cut at the edge,
  // across every pair of side-by-side tiles fetched here, 2,393 of 2,398 ends met within 1.5 m.
  const have = new Map(files.map(f => [f.replace('.pbf', '').split('-').slice(-2).join('/'), f]));
  const pair = [...have.keys()].map(k => k.split('/').map(Number)).find(([x, y]) => have.has(`${x + 1}/${y}`));
  if (!pair) return;
  const [x, y] = pair, read = (tx, clip) => tileStreets(readFileSync(`${dir}/${have.get(`${tx}/${y}`)}`), 14, tx, y, {clip});
  const edge = (x + 1) / 16384 * 360 - 180, KX = 111195 * Math.cos(53.48 * Math.PI / 180);
  assert.ok(read(x, false).some(l => l.coords.some(p => p[0] > edge + 1e-6)), 'uncut, a copy runs past the edge');
  assert.ok(read(x, true).every(l => l.coords.every(p => p[0] <= edge + 1e-9)), 'cut, none does');
  const ends = lines => lines.flatMap(l => [l.coords[0], l.coords.at(-1)]).filter(p => Math.abs(p[0] - edge) < 1e-9);
  const west = ends(read(x, true)), east = ends(read(x + 1, true));
  const met = west.filter(p => east.some(q => Math.hypot((p[0] - q[0]) * KX, (p[1] - q[1]) * 111195) < 1.5));
  assert.ok(west.length === 0 || met.length / west.length > 0.9, `${met.length} of ${west.length} ends met`);
});

test('the tiles covering a box', () => {
  // One point is one tile; a box across a tile's edge is both. z14 tile x of 2.2943 W: (180 - 2.2943) / 360 * 16384.
  const [[x, y]] = tilesCovering([53.4964, -2.2943, 53.4964, -2.2943]);
  assert.equal(x, Math.floor((180 - 2.2943) / 360 * 16384));
  const r = 53.4964 * Math.PI / 180;
  assert.equal(y, Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 16384));
  const lonEdge = (x + 1) / 16384 * 360 - 180;
  assert.equal(tilesCovering([53.4964, lonEdge - 0.001, 53.4964, lonEdge + 0.001]).length, 2);
});
