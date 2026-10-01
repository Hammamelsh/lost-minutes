/**
 * The map's own streets and buildings, for measuring where buses are drawn (30 September 2026): the same
 * OpenFreeMap vector tiles the page draws (z14, the planet the page's TileJSON names today), fetched once and
 * cached under data/evaluation/osm-tiles/, decoded here, and indexed on a ~20 m grid.
 *
 *   const osm = await loadOsm(points)       // every tile the points touch, and its neighbours
 *   osm.nearestRoad(lat, lon)               // {metres, cls, name} to the nearest drivable road, or null past 80 m
 *   osm.building(lat, lon)                  // {height, base} of a building whose footprint holds the point, or null
 *   osm.roadLines(bbox)                     // every drivable road line crossing a box, for routing between reports
 *
 * Drivable is what a bus can use in OpenMapTiles' `transportation` layer: motorway to minor, service, busway and
 * bus guideway (their link roads too). Buildings are the rendered ones (not `hide_3d`), each merged feature split
 * into its polygons by ring winding, holes kept.
 */
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {VectorTile} from '../node_modules/.pnpm/@mapbox+vector-tile@3.0.0/node_modules/@mapbox/vector-tile/index.js';
import * as PbfModule from '../node_modules/.pnpm/pbf@5.1.2/node_modules/pbf/index.js';

const Pbf = PbfModule.PbfReader;
const Z = 14, CACHE = 'data/evaluation/osm-tiles';
export const DRIVABLE = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service', 'busway', 'bus_guideway']);
const CELL_LAT = 0.00018, CELL_LON = 0.0003;               // about 20 m either way at Manchester
const cellKey = (lat, lon) => `${Math.floor(lat / CELL_LAT)},${Math.floor(lon / CELL_LON)}`;
const M = 111195;

const tileXY = (lat, lon) => {
  const n = 2 ** Z, r = lat * Math.PI / 180;
  return [Math.floor((lon + 180) / 360 * n), Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n)];
};
const toLonLat = (x, y, px, py, extent) => {
  const n = 2 ** Z, lon = (x + px / extent) / n * 360 - 180;
  const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + py / extent) / n))) * 180 / Math.PI;
  return [lon, lat];
};
const ringArea = ring => { let a = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j].x - ring[i].x) * (ring[j].y + ring[i].y); return a; };

/** Metres from a point to a segment, on a local flat projection. */
export function pointSegment(lat, lon, a, b) {
  const kx = M * Math.cos(lat * Math.PI / 180);
  const ax = (a[0] - lon) * kx, ay = (a[1] - lat) * M, bx = (b[0] - lon) * kx, by = (b[1] - lat) * M;
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}
function inRing(lat, lon, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}

export async function loadOsm(points, {margin = 1} = {}) {
  mkdirSync(CACHE, {recursive: true});
  const tilejson = await (await fetch('https://tiles.openfreemap.org/planet')).json();
  const template = tilejson.tiles[0], version = template.split('/').at(-4);
  const wanted = new Set();
  for (const [lat, lon] of points) {
    const [x, y] = tileXY(lat, lon);
    for (let dx = -margin; dx <= margin; dx++) for (let dy = -margin; dy <= margin; dy++) wanted.add(`${x + dx}/${y + dy}`);
  }
  const roadCells = new Map(), buildingCells = new Map(), lines = [];
  let fetched = 0, cached = 0, bytes = 0;
  const add = (map, key, item) => { let a = map.get(key); if (!a) map.set(key, a = []); a.push(item); };
  for (const xy of wanted) {
    const [x, y] = xy.split('/').map(Number), file = join(CACHE, `${version}-${Z}-${x}-${y}.pbf`);
    let buf;
    if (existsSync(file)) { buf = readFileSync(file); cached++; }
    else {
      const r = await fetch(template.replace('{z}', Z).replace('{x}', x).replace('{y}', y));
      buf = r.ok ? Buffer.from(await r.arrayBuffer()) : Buffer.alloc(0);
      writeFileSync(file, buf); fetched++;
    }
    bytes += buf.length;
    if (!buf.length) continue;
    const tile = new VectorTile(new Pbf(buf));
    const roads = tile.layers.transportation;
    for (let i = 0; roads && i < roads.length; i++) {
      const f = roads.feature(i), cls = f.properties.class;
      if (!DRIVABLE.has(cls) || f.type !== 2) continue;
      for (const part of f.loadGeometry()) {
        const coords = part.map(p => toLonLat(x, y, p.x, p.y, roads.extent));
        const line = {cls, name: f.properties.name ?? null, oneway: f.properties.oneway ?? 0, coords};
        lines.push(line);
        for (let k = 0; k + 1 < coords.length; k++) {
          const a = coords[k], b = coords[k + 1];
          const seg = {a, b, line};
          const la0 = Math.min(a[1], b[1]), la1 = Math.max(a[1], b[1]), lo0 = Math.min(a[0], b[0]), lo1 = Math.max(a[0], b[0]);
          for (let la = Math.floor(la0 / CELL_LAT); la <= Math.floor(la1 / CELL_LAT); la++)
            for (let lo = Math.floor(lo0 / CELL_LON); lo <= Math.floor(lo1 / CELL_LON); lo++) add(roadCells, `${la},${lo}`, seg);
        }
      }
    }
    const blds = tile.layers.building;
    for (let i = 0; blds && i < blds.length; i++) {
      const f = blds.feature(i);
      if (f.type !== 3 || f.properties.hide_3d === true) continue;
      const height = Number(f.properties.render_height ?? 10), base = Number(f.properties.render_min_height ?? 0);
      // Polygons of a merged feature: an outer ring and the holes after it, told apart by winding.
      const rings = f.loadGeometry(); if (!rings.length) continue;
      const outerSign = Math.sign(ringArea(rings[0]));
      let poly = null;
      const flush = () => {
        if (!poly) return;
        const all = poly.flat(), la0 = Math.min(...all.map(p => p[1])), la1 = Math.max(...all.map(p => p[1]));
        const lo0 = Math.min(...all.map(p => p[0])), lo1 = Math.max(...all.map(p => p[0]));
        const item = {rings: poly, height, base};
        for (let la = Math.floor(la0 / CELL_LAT); la <= Math.floor(la1 / CELL_LAT); la++)
          for (let lo = Math.floor(lo0 / CELL_LON); lo <= Math.floor(lo1 / CELL_LON); lo++) add(buildingCells, `${la},${lo}`, item);
      };
      for (const ring of rings) {
        const ll = ring.map(p => toLonLat(x, y, p.x, p.y, blds.extent));
        if (Math.sign(ringArea(ring)) === outerSign) { flush(); poly = [ll]; } else if (poly) poly.push(ll);
      }
      flush();
    }
  }
  const nearestRoad = (lat, lon, reach = 80) => {
    let best = null;
    const rLat = Math.ceil(reach / M / CELL_LAT), rLon = Math.ceil(reach / (M * Math.cos(lat * Math.PI / 180)) / CELL_LON);
    const cl = Math.floor(lat / CELL_LAT), co = Math.floor(lon / CELL_LON);
    for (let a = cl - rLat; a <= cl + rLat; a++) for (let b = co - rLon; b <= co + rLon; b++)
      for (const s of roadCells.get(`${a},${b}`) ?? []) {
        const d = pointSegment(lat, lon, s.a, s.b);
        if (d <= reach && (!best || d < best.metres)) best = {metres: d, cls: s.line.cls, name: s.line.name};
      }
    return best;
  };
  const building = (lat, lon) => {
    for (const item of buildingCells.get(cellKey(lat, lon)) ?? []) {
      let inside = false;
      for (const ring of item.rings) if (inRing(lat, lon, ring)) inside = !inside;
      if (inside) return {height: item.height, base: item.base};
    }
    return null;
  };
  const roadLines = ([s, w, n, e]) => {
    const seen = new Set();
    for (let a = Math.floor(s / CELL_LAT); a <= Math.floor(n / CELL_LAT); a++)
      for (let b = Math.floor(w / CELL_LON); b <= Math.floor(e / CELL_LON); b++)
        for (const seg of roadCells.get(`${a},${b}`) ?? []) seen.add(seg.line);
    return [...seen];
  };
  return {version, tiles: wanted.size, fetched, cached, bytes, lines: lines.length, nearestRoad, building, roadLines};
}
