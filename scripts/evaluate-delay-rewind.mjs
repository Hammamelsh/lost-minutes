/**
 * The two things the ride's card and the release record say about playback, measured on every bus in
 * a reel, ridden as the page rides it (the site's 20 s poll, a frame every 100 ms, met at each bus's
 * first publication):
 *
 *   1. The figure. The card states now less the moment the drawn place stands for (`represented`), so
 *      it includes the latest report's own age. How often it is less than that age (a moment drawn
 *      said to be newer than the newest report), while moving between reports and while waiting at
 *      the newest; and how far it runs behind the report — the playback's own addition.
 *   2. The rewind. Every time the clock is set back, and whether the drawn bus goes backwards: along
 *      its own path (same path, `sd` falling), and on the map against the way it faces, each frame
 *      told apart by cause (an eased correction onto a changed path; a hop at a joint between two
 *      stretches; the facing still turning while it moves along its path; against the path itself),
 *      with how many fall in the 5 s after a rewind.
 *
 *   node --experimental-strip-types --import ./tests/alias-loader.mjs scripts/evaluate-delay-rewind.mjs \
 *     data/evaluation/reel-live-evening.json
 *
 * Written 25 September 2026 to answer the owner's two questions about the one-ride release; the
 * figures are in docs/RELEASE.md.
 */
import {readFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {historyFrom, observedAt, stepVisual, drawingFor, makeTrack, decodePolyline} from '@/lib/motion';

const reelPath = process.argv[2] ?? 'data/evaluation/reel-live-evening.json';
const reel = JSON.parse(readFileSync(reelPath, 'utf8'));
const index = JSON.parse(readFileSync('public/data/shapes/index.json', 'utf8')).patterns;
const tracks = new Map();
const trackFor = id => {
  if (!id || index[id]?.status !== 'accepted') return null;
  if (!tracks.has(id)) {
    const f = join('public/data/shapes', index[id].file);
    tracks.set(id, existsSync(f) ? (() => { const s = JSON.parse(readFileSync(f, 'utf8')); return makeTrack(id, decodePolyline(s.polyline6, 6), s.stopOffsets ?? []); })() : null);
  }
  return tracks.get(id);
};
const by = new Map();
for (const p of reel.publications) for (const v of p.live.vehicles ?? []) {
  const k = `${v.operator}|${v.vehicle}|${v.route}|${v.direction}|${v.journeyRef}`;
  if (!by.has(k)) by.set(k, []);
  by.get(k).push({at: p.receivedAtMs, v});
}
const turn = (a, b) => ((b - a) % 360 + 540) % 360 - 180;
const metres = (a, b) => Math.hypot((b.lat - a.lat) * 111195, (b.lon - a.lon) * 111195 * Math.cos(a.lat * Math.PI / 180));
const dirOf = (a, b) => (Math.atan2((b.lon - a.lon) * Math.cos(a.lat * Math.PI / 180), b.lat - a.lat) * 180 / Math.PI + 360) % 360;

const t = {rides: 0, frames: 0, moving: 0, movingBelowAge: 0, waiting: 0, waitingBelowAge: 0, figure: [], age: [], extra: [],
  rewinds: 0, pathBack: 0, pathBackAfterRewind: 0, largestPathBack: 0, facingBack: 0, facingBackMetres: 0, causes: {}, eases: new Map()};
for (const [key, pubs] of by) {
  if (pubs.length < 6) continue;
  const road = trackFor(pubs.at(-1).v.match?.patternId);
  let vis = null, i = -1, prev = null, lastRewindAt = -Infinity;
  t.rides++;
  const t0 = pubs[0].at, end = pubs.at(-1).at + 20_000;
  for (let wall = t0; wall <= end; wall += 100) {
    const polled = t0 + Math.floor((wall - t0) / 20_000) * 20_000;
    while (i + 1 < pubs.length && pubs[i + 1].at + 2500 <= polled) i++;
    if (i < 0) continue;
    const v = pubs[i].v;
    const fixes = (v.trail ?? []).map(q => ({at: v.observedAtMs - q[0], lat: q[1], lon: q[2], bearing: q[3], service: 's', source: 'h'}));
    fixes.push({at: v.observedAtMs, lat: v.lat, lon: v.lon, bearing: v.bearing, availableAt: v.retrievedAtMs ?? null, service: 's', source: 'h'});
    const h = historyFrom(fixes), e = observedAt(h, wall, 'x');
    vis = stepVisual(vis, e, wall, null, drawingFor(e, null), h, road);
    const b = vis.buffer;
    if (!b) { prev = null; continue; }
    t.frames++;
    // 1. The figure, against the report's own age.
    const figure = (wall - (b.represented ?? b.shown)) / 1000, age = (wall - e.basis.at) / 1000;
    if (b.shown < e.basis.at) {
      t.moving++;
      if (figure < age - 0.5) t.movingBelowAge++;
      if (t.frames % 50 === 0) { t.figure.push(figure); t.age.push(age); t.extra.push(figure - age); }
    } else { t.waiting++; if (figure < age - 0.5) t.waitingBelowAge++; }
    // 2. Rewinds, and any movement backwards.
    if (prev) {
      if (b.shown < prev.shown - 500) { t.rewinds++; lastRewindAt = wall; }
      const said = vis.lastCorrection?.kind === 'snap' && vis.lastCorrection.at === wall;
      const nearRewind = wall - lastRewindAt <= 5000;
      if (b.pathKey === prev.pathKey && b.sd < prev.sd - 0.05) {
        t.pathBack++; if (nearRewind) t.pathBackAfterRewind++;
        t.largestPathBack = Math.max(t.largestPathBack, prev.sd - b.sd);
      }
      const step = metres(prev.pos, vis);
      if (step > 0.3 && !said && vis.bearing != null && Math.abs(turn(vis.bearing, dirOf(prev.pos, vis))) > 120) {
        t.facingBack++; t.facingBackMetres += step;
        const eased = b.ease && wall < b.ease.at + b.ease.ms;
        const along = b.pathKey === prev.pathKey ? b.sd - prev.sd : null;
        const withPath = vis.heading != null && Math.abs(turn(vis.heading, dirOf(prev.pos, vis))) <= 60;
        const cause = eased ? 'easedCorrection' : along !== null && step > Math.abs(along) * 2 + 0.5 ? 'hopAtAJoint'
          : withPath ? 'facingStillTurning' : 'againstItsPath';
        const c = t.causes[cause] ??= {frames: 0, metres: 0, largestStep: 0, within5sOfARewind: 0, examples: []};
        c.frames++; c.metres += step; c.largestStep = Math.max(c.largestStep, step); if (nearRewind) c.within5sOfARewind++;
        if (c.examples.length < 3 || step > c.examples.at(-1).step) {
          c.examples.push({key, at: +((wall - t0) / 1000).toFixed(1), step: +step.toFixed(2)});
          c.examples.sort((x, y) => y.step - x.step); c.examples.length = Math.min(3, c.examples.length);
        }
        if (eased) {
          const id = `${key}@${b.ease.at}`;
          const ev = t.eases.get(id) ?? {key, at: +((b.ease.at - t0) / 1000).toFixed(1), shift: +(b.ease.ms / 100).toFixed(1), back: 0,
            withARewind: Math.abs(b.ease.at - lastRewindAt) <= 100};
          ev.back += step; t.eases.set(id, ev);
        }
      }
    }
    prev = {shown: b.shown, pathKey: b.pathKey, sd: b.sd, pos: {lat: vis.lat, lon: vis.lon}};
  }
}
const sorted = a => [...a].sort((x, y) => x - y);
const q = (a, p) => { const s = sorted(a); return s.length ? +s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(1) : null; };
const spread = a => ({p10: q(a, 0.1), p50: q(a, 0.5), p90: q(a, 0.9)});
const eases = [...t.eases.values()].map(e => ({...e, back: +e.back.toFixed(1)})).sort((x, y) => y.back - x.back);
for (const c of Object.values(t.causes)) { c.metres = +c.metres.toFixed(1); c.largestStep = +c.largestStep.toFixed(2); }
console.log(JSON.stringify({reel: reelPath.split('/').pop(), rides: t.rides, frames: t.frames,
  figure: {
    movingBetweenReports: {frames: t.moving, belowTheReportsAge: t.movingBelowAge, seconds: spread(t.figure),
      reportAge: spread(t.age), addedByThePlayback: spread(t.extra)},
    waitingAtTheNewest: {frames: t.waiting, belowTheReportsAge: t.waitingBelowAge},
  },
  rewind: {
    clockSetBack: t.rewinds,
    backAlongItsOwnPath: {frames: t.pathBack, within5sOfARewind: t.pathBackAfterRewind, largestMetres: +t.largestPathBack.toFixed(2)},
    againstItsFacingOnTheMap: {frames: t.facingBack, metres: +t.facingBackMetres.toFixed(1), byCause: t.causes},
    easedCorrectionsWithABackwardPart: {events: eases.length, startedWithARewind: eases.filter(e => e.withARewind).length,
      backMetresP50: q(eases.map(e => e.back), 0.5), over5m: eases.filter(e => e.back > 5).length, largest: eases.slice(0, 5)},
  }}, null, 1));
