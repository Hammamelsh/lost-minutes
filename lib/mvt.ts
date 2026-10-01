/**
 * The drivable streets in one of the map's own vector tiles (Mapbox Vector Tile, protobuf), read without the map.
 *
 * Street tracks (lib/streets.ts) need every street round a bus's reports, a few hundred metres either way. Read from
 * the map (querySourceFeatures), they were what the map had drawn: in the ride, at zoom 20 on a phone, 30 pieces of
 * street round the screen, and no track at all (the browser check at Charlestown, 30 September 2026). The page now
 * reads the same z14 tiles the map draws (usually already in the browser's cache) and decodes their `transportation`
 * layer here: only what a street track needs, its lines, `class` and `oneway`. The format is protobuf; a line's
 * geometry is commands (MoveTo, LineTo) with zigzag deltas in tile units (`extent`, 4096). Held against the standard
 * decoder on a real tile in tests/mvt.test.mjs.
 *
 * Each line is cut at the tile's own edge. A tile carries its roads a little past its edge, each tile simplifying its
 * own copy, so a road crossing an edge was two copies overlapping without meeting, and whether the streets joined
 * there depended on which tile was read first: of a night's fleet, 16 more reports joined in one order than the other
 * (30 September 2026). Cut at the edge, the copies end together (2,393 of 2,398 ends within 1.5 m across 141 pairs of
 * tiles), and the order no longer matters.
 */
import {DRIVABLE, type StreetLine} from '@/lib/streets';

class Reader {
 pos = 0;
 readonly buf: Uint8Array;
 readonly end: number;
 constructor(buf: Uint8Array, end = buf.length) { this.buf = buf; this.end = end; }
 varint(): number {
  let result = 0, shift = 0, b = 0;
  do {
   b = this.buf[this.pos++];
   result += (b & 0x7f) * 2 ** shift;
   shift += 7;
  } while (b >= 0x80 && shift < 64);
  return result;
 }
 sub(): Reader { const len = this.varint(), r = new Reader(this.buf, this.pos + len); r.pos = this.pos; this.pos += len; return r; }
 skip(wire: number) {
  if (wire === 0) this.varint();
  else if (wire === 1) this.pos += 8;
  else if (wire === 2) this.pos += this.varint();
  else if (wire === 5) this.pos += 4;
  else throw new Error(`protobuf wire type ${wire}`);
 }
 packed(): number[] { const r = this.sub(), out: number[] = []; while (r.pos < r.end) out.push(r.varint()); return out; }
}
const text = new TextDecoder();
const zigzag = (n: number) => (n % 2 === 1 ? -(n + 1) / 2 : n / 2);

/** A tile's value: a string, a number or a boolean (MVT Value message). */
function value(r: Reader): string | number | boolean | null {
 let v: string | number | boolean | null = null;
 while (r.pos < r.end) {
  const tag = r.varint(), field = tag >> 3, wire = tag & 7;
  if (field === 1 && wire === 2) { const s = r.sub(); v = text.decode(r.buf.subarray(s.pos, s.end)); }
  else if (field === 2 && wire === 5) { v = new DataView(r.buf.buffer, r.buf.byteOffset + r.pos, 4).getFloat32(0, true); r.pos += 4; }
  else if (field === 3 && wire === 1) { v = new DataView(r.buf.buffer, r.buf.byteOffset + r.pos, 8).getFloat64(0, true); r.pos += 8; }
  else if ((field === 4 || field === 5) && wire === 0) v = r.varint();
  else if (field === 6 && wire === 0) v = zigzag(r.varint());
  else if (field === 7 && wire === 0) v = r.varint() !== 0;
  else r.skip(wire);
 }
 return v;
}

/** The part of the segment (x0, y0)–(x1, y1) inside the tile, [0, extent] each way, as fractions [t0, t1] along it;
 *  null where none is (Liang–Barsky). */
function within(x0: number, y0: number, x1: number, y1: number, extent: number): [number, number] | null {
 let t0 = 0, t1 = 1;
 const dx = x1 - x0, dy = y1 - y0;
 for (const [p, q] of [[-dx, x0], [dx, extent - x0], [-dy, y0], [dy, extent - y0]]) {
  if (p === 0) { if (q < 0) return null; continue; }
  const r = q / p;
  if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
 }
 return t1 > t0 ? [t0, t1] : null;
}

/** The drivable streets in the `transportation` layer of tile z/x/y, as [lon, lat] lines, cut at the tile's edge. */
export function tileStreets(data: ArrayBuffer | Uint8Array, z: number, x: number, y: number, {clip = true}: {clip?: boolean} = {}): StreetLine[] {
 const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
 const tile = new Reader(buf), lines: StreetLine[] = [];
 while (tile.pos < tile.end) {
  const tag = tile.varint();
  if (tag >> 3 !== 3 || (tag & 7) !== 2) { tile.skip(tag & 7); continue; }
  const layer = tile.sub();
  let name = '', extent = 4096;
  const keys: string[] = [], values: (string | number | boolean | null)[] = [], features: Reader[] = [];
  while (layer.pos < layer.end) {
   const t = layer.varint(), field = t >> 3, wire = t & 7;
   if (field === 1 && wire === 2) { const s = layer.sub(); name = text.decode(buf.subarray(s.pos, s.end)); }
   else if (field === 2 && wire === 2) features.push(layer.sub());
   else if (field === 3 && wire === 2) { const s = layer.sub(); keys.push(text.decode(buf.subarray(s.pos, s.end))); }
   else if (field === 4 && wire === 2) values.push(value(layer.sub()));
   else if (field === 5 && wire === 0) extent = layer.varint();
   else layer.skip(wire);
  }
  if (name !== 'transportation') continue;
  const n = 2 ** z;
  const lonOf = (px: number) => (x + px / extent) / n * 360 - 180;
  const latOf = (py: number) => Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + py / extent) / n))) * 180 / Math.PI;
  for (const f of features) {
   let type = 0, tags: number[] = [], geometry: number[] = [];
   while (f.pos < f.end) {
    const t = f.varint(), field = t >> 3, wire = t & 7;
    if (field === 2 && wire === 2) tags = f.packed();
    else if (field === 3 && wire === 0) type = f.varint();
    else if (field === 4 && wire === 2) geometry = f.packed();
    else f.skip(wire);
   }
   if (type !== 2) continue;
   const props: Record<string, unknown> = {};
   for (let i = 0; i + 1 < tags.length; i += 2) props[keys[tags[i]]] = values[tags[i + 1]];
   const cls = String(props.class ?? '');
   if (!DRIVABLE.has(cls)) continue;
   const oneway = Number(props.oneway ?? 0);
   // Cut at the tile's own edge. Each tile carries a road a little past its edge, simplified its own way, so the two
   // copies of a road crossing it overlap and need not meet; cut at the edge, both end on it, together.
   let part: [number, number][] = [];
   const flush = () => { if (part.length > 1) lines.push({coords: part, cls, oneway}); part = []; };
   const put = (x0: number, y0: number) => {
    const p: [number, number] = [lonOf(x0), latOf(y0)], last = part[part.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) part.push(p);
   };
   let px = 0, py = 0, qx = 0, qy = 0, started = false;
   for (let i = 0; i < geometry.length;) {
    const cmd = geometry[i] & 7, count = geometry[i] >> 3;
    i++;
    if (cmd === 1 || cmd === 2) {
     for (let k = 0; k < count; k++) {
      px += zigzag(geometry[i++]); py += zigzag(geometry[i++]);
      if (cmd === 1) { flush(); started = true; qx = px; qy = py; continue; }
      if (!started) continue;
      const seg = clip ? within(qx, qy, px, py, extent) : [0, 1] as [number, number];
      if (seg) {
       const [t0, t1] = seg;
       if (t0 > 0) flush();
       put(qx + (px - qx) * t0, qy + (py - qy) * t0);
       put(qx + (px - qx) * t1, qy + (py - qy) * t1);
       if (t1 < 1) flush();
      } else flush();
      qx = px; qy = py;
     }
    }
   }
   flush();
  }
 }
 return lines;
}

/** The z14 tiles, [x, y], covering a box [south, west, north, east]. */
export function tilesCovering([s, w, n, e]: [number, number, number, number], z = 14): [number, number][] {
 const count = 2 ** z;
 const tx = (lon: number) => Math.floor((lon + 180) / 360 * count);
 const ty = (lat: number) => { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * count); };
 const out: [number, number][] = [];
 for (let x = tx(w); x <= tx(e); x++) for (let y = ty(n); y <= ty(s); y++) out.push([x, y]);
 return out;
}
