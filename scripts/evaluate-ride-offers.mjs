/**
 * Are the rides Try Ride-along offers clean? For every publication in a reel, the buses the offer
 * list would show, each ridden for the next three minutes through the drawing as the page draws it
 * (the site's 20 s poll, a frame every 100 ms), and judged on what a passenger sees:
 *   - a jump, said or not; the bus facing over 30° off its movement for more than a second;
 *   - drawn off its checked road, or with no heading (a round token); turning while standing;
 *   - standing still for over 45 s; drawn over 75 s behind; the journey's reports ending.
 * Two offer rules side by side: the list as it was (`rideCandidates`) and the list with the
 * clean-ride rule (`rideSuitability`), so a change to the rule is judged on the same moments.
 *
 *   node --experimental-strip-types --import ./tests/alias-loader.mjs scripts/evaluate-ride-offers.mjs \
 *     --reel data/evaluation/reel-2026-09-22-evening-300-publications.json [--every 2] [--seconds 180]
 */
import {readFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {historyFrom, observedAt, estimate, stepVisual, drawingFor, makeTrack, decodePolyline, DEFAULT_PARAMS} from '@/lib/motion';
import {busesFromLive} from '@/lib/follow';
import {rideCandidates, rideSuitability, cleanRideCandidates, CLEAN_RIDE} from '@/lib/explore';

const arg = (k, d) => {const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d};
const reelPath = arg('reel', 'data/evaluation/reel-2026-09-22-evening-300-publications.json');
const every = Number(arg('every', 1)), seconds = Number(arg('seconds', 180)), pollMs = 20_000;
// How a bus on an evaluated road is drawn in the ride: 'estimate' (as the page did until 25 September
// 2026) or 'playback' (between its own reports, as every other bus on a checked road).
const evaluatedAs = arg('evaluated', 'estimate');
const reel = JSON.parse(readFileSync(reelPath, 'utf8'));
const index = JSON.parse(readFileSync('public/data/shapes/index.json', 'utf8')).patterns;
const accepted = new Set(Object.entries(index).filter(([, e]) => e.status === 'accepted' && e.file).map(([id]) => id));
const evaluation = JSON.parse(readFileSync('public/data/motion-evaluation.json', 'utf8'));
const params = {...DEFAULT_PARAMS};
for (const [k, v] of Object.entries(evaluation.params ?? {})) if (k in params && typeof v === typeof params[k]) params[k] = v;
const model = {version: evaluation.version, params, profile: evaluation.errorProfile ?? null, patterns: new Set(evaluation.corridor.patterns), lines: evaluation.corridor.lines};
const tracks = new Map();
const trackFor = id => {
  if (!id || !accepted.has(id)) return null;
  if (!tracks.has(id)) {
    const file = join('public/data/shapes', index[id].file);
    tracks.set(id, existsSync(file) ? (() => {const s = JSON.parse(readFileSync(file, 'utf8')); return makeTrack(id, decodePolyline(s.polyline6, 6), s.stopOffsets ?? [])})() : null);
  }
  return tracks.get(id);
};
const metres = (a, b) => Math.hypot((b.lat - a.lat) * 111195, (b.lon - a.lon) * 111195 * Math.cos(a.lat * Math.PI / 180));
const dirOf = (a, b) => (Math.atan2((b.lon - a.lon) * Math.cos(a.lat * Math.PI / 180), b.lat - a.lat) * 180 / Math.PI + 360) % 360;
const turnOf = (a, b) => ((b - a) % 360 + 540) % 360 - 180;

// Every publication of each vehicle-journey, for riding it on.
const journeyKey = v => `${v.operator}|${v.vehicle}|${v.route}|${v.direction}|${v.journeyRef}`;
const byJourney = new Map();
for (const p of reel.publications) for (const v of p.live.vehicles ?? []) {
  const k = journeyKey(v);
  if (!byJourney.has(k)) byJourney.set(k, []);
  byJourney.get(k).push({receivedAtMs: p.receivedAtMs, live: p.live, v});
}
const reelEnd = reel.publications.at(-1).receivedAtMs;

/** One ride from the moment it was offered, judged. */
function ride(key, tier, fromMs) {
  const pubs = byJourney.get(key), track = trackFor(pubs.at(-1).v.match?.patternId);
  const start = fromMs + 3000, end = start + seconds * 1000;
  let vis = null, prev = null, i = -1, jumps = 0, unsaid = 0, offRoad = 0, blind = 0, frames = 0, moving = 0;
  let mis = 0, misMax = 0, stand = 0, standMax = 0, delayMax = 0, still = [], stillTurn = 0, lastSeen = 0;
  for (let wall = start; wall <= end; wall += 100) {
    const visibleAt = start + Math.floor((wall - start) / pollMs) * pollMs;
    while (i + 1 < pubs.length && pubs[i + 1].receivedAtMs + 2500 <= visibleAt) i++;
    if (i < 0) continue;
    lastSeen = pubs[i].receivedAtMs;
    const v = pubs[i].v;
    const fixes = (v.trail ?? []).map(t => ({at: v.observedAtMs - t[0], lat: t[1], lon: t[2], bearing: t[3], service: 's', source: 'h'}));
    fixes.push({at: v.observedAtMs, lat: v.lat, lon: v.lon, bearing: v.bearing, availableAt: v.retrievedAtMs ?? null, service: 's', source: 'h'});
    const h = historyFrom(fixes);
    const e = tier === 'estimated' && track && evaluatedAs === 'estimate' ? estimate(h, track, wall, model.params) : observedAt(h, wall, 'not evaluated');
    vis = stepVisual(vis, e, wall, e.mode === 'estimated' ? track : null, drawingFor(e, model.profile), h, track);
    frames++;
    const said = vis.lastCorrection?.kind === 'snap' && vis.lastCorrection.at === wall;
    if (said) jumps++;
    if (vis.buffer && track && vis.buffer.onRoad === false) offRoad++;
    if (vis.bearing == null) blind++;
    if (vis.buffer) delayMax = Math.max(delayMax, (wall - (vis.buffer.represented ?? vis.buffer.shown)) / 1000);
    if (prev) {
      const step = metres(prev, vis);
      if (step > 12 && !said) unsaid++;
      if (step >= 0.02) { moving++; stand = 0; } else { stand += 0.1; standMax = Math.max(standMax, stand); }
      if (step >= 0.05 && vis.bearing != null && !said) {
        mis = Math.abs(turnOf(vis.bearing, dirOf(prev, vis))) > 30 ? mis + 0.1 : 0; misMax = Math.max(misMax, mis);
      }
      if (step < 0.05 && !said && prev.bearing != null && vis.bearing != null) {
        if (!still.length) still.push({wall: wall - 100, b: prev.bearing});
        still.push({wall, b: vis.bearing});
        while (still[0].wall < wall - 5000) still.shift();
        for (const s of still) stillTurn = Math.max(stillTurn, Math.abs(turnOf(s.b, vis.bearing)));
      } else still = [];
    }
    prev = {lat: vis.lat, lon: vis.lon, bearing: vis.bearing};
  }
  // Its reports ended: the journey's last publication in the reel came well before the ride did,
  // with the reel itself running on past it.
  const ended = lastSeen < end - 60_000 && reelEnd > end;
  const faults = [];
  if (jumps) faults.push('jump');
  if (unsaid) faults.push('unsaid');
  if (misMax > 1.0) faults.push('misaligned');
  if (offRoad) faults.push('off_road');
  if (blind) faults.push('no_heading');
  if (stillTurn > 20) faults.push('turns_standing');
  if (standMax > 45) faults.push('stands');
  if (delayMax > 75) faults.push('late');
  if (ended) faults.push('ended');
  return {faults, moving: frames ? moving / frames : 0, standMax, misMax};
}

// --features: every bus on a checked road with a recent report, ridden (by playback) and described by
// what its reports said when it would have been offered — to learn which facts predict a clean ride.
if (process.argv.includes('--features')) {
  const {project} = await import('@/lib/motion');
  const rows = [];
  for (let p = 0; p < reel.publications.length; p += every) {
    const pub = reel.publications[p];
    if (pub.receivedAtMs + (seconds + 3) * 1000 > reelEnd) break;
    const buses = busesFromLive(pub.live, pub.receivedAtMs, pub.receivedAtMs, pub.receivedAtMs);
    for (const c of rideCandidates(buses, accepted, model, Infinity)) {
      if (c.tier === 'placed') continue;
      const id = c.bus.match?.patternId, track = trackFor(id), key = journeyKey(c.bus);
      if (!track || !byJourney.has(key)) continue;
      const reps = [...(c.bus.trail ?? []), {at: c.bus.observedAtMs, lat: c.bus.lat, lon: c.bus.lon}].sort((a, b) => a.at - b.at)
        .filter(r => c.bus.observedAtMs - r.at <= 120_000);
      let near, first = null, last = 0, maxOff = 0, back = 0, maxGap = 0;
      for (let i = 0; i < reps.length; i++) {
        const q = project(track, reps[i], near);
        maxOff = Math.max(maxOff, q.offset);
        if (near !== undefined) back = Math.max(back, near - q.s);
        if (i) maxGap = Math.max(maxGap, (reps[i].at - reps[i - 1].at) / 1000);
        first ??= q.s; last = q.s; near = Math.max(near ?? q.s, q.s);
      }
      const n = reps.length, lastStep = n > 1 ? metres(reps[n - 2], reps[n - 1]) : 0;
      const r = ride(key, 'road', pub.receivedAtMs);
      rows.push({key, tier: c.tier, route: c.bus.route, at: new Date(pub.receivedAtMs).toISOString().slice(11, 19),
        age: c.bus.ageSeconds, n, maxGap, maxOff: +maxOff.toFixed(1), back: +back.toFixed(1), advance: +(last - first).toFixed(0),
        remaining: +(track.length - last).toFixed(0), lastStep: +lastStep.toFixed(1),
        suitable: rideSuitability(c.bus, track).ok, faults: r.faults, misMax: +r.misMax.toFixed(1), standMax: +r.standMax.toFixed(1)});
    }
  }
  console.log(JSON.stringify(rows));
  process.exit(0);
}

const rules = {
  before: buses => rideCandidates(buses, accepted, model),
  clean: buses => cleanRideCandidates(buses, accepted, model, id => trackFor(id)),
  ...(process.argv.includes('--variants') ? {
    clean12: buses => cleanRideCandidates(buses, accepted, model, id => trackFor(id), 3, {...CLEAN_RIDE, onRoadMetres: 12}),
  } : {}),
};
const out = {};
for (const [name, offer] of Object.entries(rules)) {
  const tally = {moments: 0, withOffer: 0, offers: 0, clean: 0, faults: {}, byTier: {}, examples: []};
  for (let p = 0; p < reel.publications.length; p += every) {
    const pub = reel.publications[p];
    if (pub.receivedAtMs + (seconds + 3) * 1000 > reelEnd) break;   // the reel must cover the ride
    tally.moments++;
    const buses = busesFromLive(pub.live, pub.receivedAtMs, pub.receivedAtMs, pub.receivedAtMs);
    const offers = offer(buses);
    if (offers.length) tally.withOffer++;
    for (const c of offers) {
      const key = journeyKey(c.bus);
      if (!byJourney.has(key)) continue;
      const r = ride(key, c.tier, pub.receivedAtMs);
      tally.offers++;
      tally.byTier[c.tier] ??= {offers: 0, clean: 0};
      tally.byTier[c.tier].offers++;
      if (!r.faults.length) { tally.clean++; tally.byTier[c.tier].clean++; }
      for (const f of r.faults) tally.faults[f] = (tally.faults[f] ?? 0) + 1;
      if (r.faults.length && tally.examples.length < 12 && !tally.examples.some(x => x.key === key))
        tally.examples.push({key, tier: c.tier, at: new Date(pub.receivedAtMs).toISOString().slice(11, 19), faults: r.faults,
          standMax: +r.standMax.toFixed(1), misMax: +r.misMax.toFixed(1)});
    }
  }
  out[name] = {...tally, cleanShare: tally.offers ? +(tally.clean / tally.offers).toFixed(3) : null,
    availability: tally.moments ? +(tally.withOffer / tally.moments).toFixed(3) : null};
}
console.log(JSON.stringify({reel: reelPath, publications: reel.publications.length, every, seconds, evaluatedAs, ...out}, null, 1));
