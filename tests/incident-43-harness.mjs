// The route-43 incident of 24 September 2026, through the drawing as the page runs it: the
// publications a browser was served for BNML LV74KNG (43 outbound, journey 1147), polled on a
// given schedule, and the drawing stepped every 100 ms of wall time while the page is visible.
import {readFileSync} from 'node:fs';
import {historyFrom, observedAt, stepVisual, makeTrack, decodePolyline, drawingFor, needsFrames} from '../lib/motion.ts';

export const incident = JSON.parse(readFileSync(new URL('./recorded/incident-43-lv74kng.json', import.meta.url), 'utf8'));
const shape = JSON.parse(readFileSync(new URL('../' + incident.shape, import.meta.url), 'utf8'));
export const road = makeTrack('BNML:43:outbound:c4a0b4208e', decodePolyline(shape.polyline6, 6), shape.stopOffsets ?? []);
export const T = s => Date.parse(`2026-09-24T${s}Z`);
const WRITE_MS = 2500;   // the collector publishes a moment after its capture's timestamp
const servedAt = t => { let best = null; for (const p of incident.publications) if (p.receivedAtMs + WRITE_MS <= t) best = p; return best; };
const fixesOf = v => { const fx = (v.trail ?? []).map(t => ({at: v.observedAtMs - t[0], lat: t[1], lon: t[2], bearing: t[3], service: 's', source: 'h'}));
 fx.push({at: v.observedAtMs, lat: v.lat, lon: v.lon, bearing: v.bearing, availableAt: v.retrievedAtMs ?? null, service: 's', source: 'h'}); return fx; };
export const metres = (a, b) => Math.hypot((b.lat - a.lat) * 111195, (b.lon - a.lon) * 111195 * Math.cos(a.lat * Math.PI / 180));
export const direction = (a, b) => (Math.atan2((b.lon - a.lon) * Math.cos(a.lat * Math.PI / 180), b.lat - a.lat) * 180 / Math.PI + 360) % 360;
export const turn = (a, b) => ((b - a) % 360 + 540) % 360 - 180;

/** Schedules: when the page asks for a publication, and when it draws. */
export function schedule(name) {
 const every = (from, to, ms) => { const out = []; for (let t = T(from); t <= T(to); t += ms) out.push(t); return out; };
 if (name === 'visible') return {polls: every('17:49:00', '17:56:40', 20_000), visible: [[T('17:49:00'), T('17:56:40')]]};
 // As the page's frame loop runs: it draws while something moves and rests otherwise, and a
 // publication arriving wakes it.
 if (name === 'resting') return {...schedule('stall'), gated: true};
 if (name === 'owner') return {
  // As the server's request log has it: the tab loaded at 17:51:03, was not drawn until 17:52:07,
  // and its first frame then ran before that moment's publication had arrived.
  polls: [T('17:51:03'), T('17:52:07') + 300, T('17:52:38'), T('17:52:40'), T('17:53:03'), ...every('17:53:23', '17:56:40', 20_000)],
  visible: [[T('17:51:03'), T('17:51:03')], [T('17:52:07'), T('17:56:40')]]};
 if (name === 'stall') return {
  // Drawing all the while; no publication between 17:52:00 and 17:53:30 (a poll held up).
  polls: [...every('17:49:00', '17:52:00', 20_000), ...every('17:53:30', '17:56:40', 20_000)], visible: [[T('17:49:00'), T('17:56:40')]]};
 throw Error(name);
}

export function ride(name) {
 const {polls, visible, gated} = schedule(name);
 let awake = true;
 const walls = [];
 for (const [a, b] of visible) for (let w = a; w <= b; w += 100) walls.push(w);
 let vis = null, current = null, pi = 0;
 const frames = [];
 for (const wall of walls) {
  while (pi < polls.length && polls[pi] <= wall) { const p = servedAt(polls[pi]); if (p && p !== current) { current = p; awake = true; } pi++; }
  if (!current) continue;
  if (gated && !awake) continue;
  const h = historyFrom(fixesOf(current.vehicle)), e = observedAt(h, wall, 'movement on this service has not been evaluated');
  const before = vis;
  vis = stepVisual(vis, e, wall, null, drawingFor(e, null), h, road);
  const b = vis.buffer;
  if (gated) awake = needsFrames(e, vis);
  frames.push({wall, lat: vis.lat, lon: vis.lon, bearing: vis.bearing, onRoad: b?.onRoad ?? null,
   step: before ? metres(before, vis) : 0, dir: before && metres(before, vis) > 0.3 ? direction(before, vis) : null,
   said: vis.lastCorrection?.kind === 'snap' && vis.lastCorrection.at === wall ? vis.lastCorrection.why ?? 'unsaid' : null,
   represented: b ? (b.represented ?? b.shown) : null, delay: b ? (wall - (b.represented ?? b.shown)) / 1000 : null,
   newest: e.basis.at});
 }
 return frames;
}
