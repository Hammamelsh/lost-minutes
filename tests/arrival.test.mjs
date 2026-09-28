// Estimated minutes on the device (lib/arrival.ts): the evaluated estimator, ported exactly, and the page's
// own gates around it, none of which changes its answer.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {ARRIVAL_DISPLAY,ARRIVAL_MODEL,ARRIVAL_PARAMS,TRAIL_POINTS,TRAIL_SECONDS,arrivalEstimate,arrivalTrack,arrivalWords,blendedEta,
 cruiseFor,observedSpeed,placeReports,releasedScope,scheduledSecondsAt,withPublication} from '../lib/arrival.ts';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url));

test('the parameters and the model name are exactly the frozen file’s', () => {
 const bytes = read('scripts/arrival-params-frozen.json'), frozen = JSON.parse(bytes);
 assert.equal(ARRIVAL_MODEL, `blended@${createHash('sha256').update(bytes).digest('hex').slice(0, 12)}`);
 assert.deepEqual({dwell_s: ARRIVAL_PARAMS.dwellS, window_s: ARRIVAL_PARAMS.windowS, standing_below: ARRIVAL_PARAMS.standingBelow,
  near_m: ARRIVAL_PARAMS.nearM}, frozen.params);
 assert.deepEqual(ARRIVAL_PARAMS.cruise, frozen.cruise, 'the cruise speeds to the last digit, not rounded');
 assert.equal(cruiseFor('BNML:99:outbound:x'), 8.0, 'a pattern not listed takes 8.0, as score() does');
 // The trail a publication carries, as pipeline/live.py writes it: the page's completeness rule reads these.
 const live = read('pipeline/live.py').toString();
 assert.match(live, new RegExp(`^TRAIL_SECONDS = ${TRAIL_SECONDS}$`, 'm'));
 assert.match(live, new RegExp(`^TRAIL_POINTS = ${TRAIL_POINTS}$`, 'm'));
});

// ------------------------------------------------------------------ against the evaluator, on real reports

const sample = JSON.parse(read('tests/fixtures/arrival-parity-sample.json'));
const index = JSON.parse(read('public/data/shapes/index.json'));
const shape = JSON.parse(read(`public/data/shapes/${index.patterns[sample.pattern].file}`));
const TRACK = arrivalTrack(shape.polyline6, shape.stopMapping, {id: sample.pattern, stops: sample.patternStops});

test('the road is measured as the evaluation measures it, its stops on the pattern’s own indices', () => {
 assert.ok(TRACK);
 sample.stopOffsets.forEach((offset, j) => assert.equal(TRACK.stopOffsets[j], offset));
 assert.ok(TRACK.stopOffsets.slice(sample.stopOffsets.length).every(o => o === null), 'the stops outside the area have none');
 // A shape with no stop mapping, or one for another pattern, gives no track: nothing is paired by position.
 assert.equal(arrivalTrack(shape.polyline6, undefined, {id: sample.pattern, stops: sample.patternStops}), null);
 assert.equal(arrivalTrack(shape.polyline6, shape.stopMapping, {id: 'BNML:15:outbound:0000000000', stops: sample.patternStops}), null);
});

test('on held-out real journeys the page answers as the evaluator did, from the reports up to each moment only', () => {
 let compared = 0, worst = 0;
 for (const journey of sample.journeys) {
  const reports = journey.reports.map(([at, lat, lon]) => ({at, lat, lon}));
  const placedAll = placeReports(TRACK, reports);
  const byMoment = new Map();
  for (const [i, j, eta] of journey.cases) { if (!byMoment.has(i)) byMoment.set(i, []); byMoment.get(i).push([j, eta]); }
  for (const [i, targets] of byMoment) {
   const upTo = reports.filter(r => r.at <= placedAll[i][0]);
   const placed = placeReports(TRACK, upTo);
   for (const [j, eta] of targets) {
    const page = blendedEta(placed, placed.length - 1, j, TRACK.stopOffsets, journey.timing, cruiseFor(sample.pattern));
    assert.notEqual(page, null, 'the evaluator answered, so must the page');
    worst = Math.max(worst, Math.abs(page - eta));
    compared++;
   }
  }
 }
 assert.ok(compared > 6000, `${compared} answers compared`);
 assert.ok(worst <= 1, `worst difference ${worst} ms: floating-point at the millisecond cut, the page shows minutes`);
});

// ------------------------------------------------------------------ the pieces, by hand

test('speed is read from the reports since the latest jump within the window, and refused on too little', () => {
 const T = 1_800_000_000_000;
 const placed = [[T, 0], [T + 20_000, 100], [T + 40_000, 200], [T + 60_000, 300]];
 assert.equal(observedSpeed(placed, 3, 180), 5);
 assert.equal(observedSpeed(placed, 0, 180), null, 'one report: no speed');
 assert.equal(observedSpeed([[T, 0], [T + 10_000, 50]], 1, 180), null, 'under 20 s: no speed');
 assert.equal(observedSpeed([[T, 0], [T + 20_000, 100], [T + 40_000, 2000], [T + 60_000, 2100]], 3, 180), 5, 'from after the jump');
});

test('the timetable’s seconds interpolate between the stops the road places, skipping the rest', () => {
 const offsets = [0, 500, null, 1500], timing = [0, 60, 90, 200];
 assert.equal(scheduledSecondsAt(offsets, timing, 250), 30);
 assert.equal(scheduledSecondsAt(offsets, timing, 1000), 60 + 140 * 0.5, 'the stop with no offset is skipped');
 assert.equal(scheduledSecondsAt([0, null], [0, 1], 0), null);
});

// ------------------------------------------------------------------ what a release covers

const PATTERN = {id: 'BNML:15:outbound:c9291c1aea', operator: 'BNML', line: '15', direction: 'outbound'};
const SCOPE = {operator: 'BNML', line: '15', direction: 'outbound', patternIds: [PATTERN.id], model: ARRIVAL_MODEL, p80Abs: 2.48};

test('only a scope that names the operator, line, direction, pattern and model releases a pattern', () => {
 assert.ok(releasedScope({released: [], scopes: [SCOPE]}, PATTERN));
 assert.equal(releasedScope({released: ['outbound']}, PATTERN), null, 'a direction alone, the old form, releases nothing');
 for (const [field, value] of [['operator', 'BNSM'], ['line', '15A'], ['direction', 'inbound'], ['model', 'blended@000000000000']])
  assert.equal(releasedScope({released: [], scopes: [{...SCOPE, [field]: value}]}, PATTERN), null, `another ${field}`);
 assert.equal(releasedScope({released: [], scopes: [SCOPE]}, {...PATTERN, id: 'BNML:15:outbound:ffffffffff'}), null, 'another variant of the line');
 assert.equal(releasedScope({released: [], scopes: [SCOPE]}, {id: 'BNML:250:outbound:aaaa', operator: 'BNML', line: '250', direction: 'outbound'}), null,
  'another outbound service');
 assert.equal(releasedScope({released: [], scopes: [SCOPE]}, {...PATTERN, id: 'BNML:15:inbound:9c10700c6c', direction: 'inbound'}), null);
});

// ------------------------------------------------------------------ the journey as the page reads it

const at0 = 1_800_000_000_000;
const r = (s, lat = 53.44, lon = -2.3) => ({at: at0 + s * 1000, lat, lon});

test('a journey is held complete from where publications reach back unbroken, and starts again after a gap', () => {
 const trail = s => Array.from({length: TRAIL_POINTS}, (_, k) => r(s - (TRAIL_POINTS - k) * 20));
 let h = withPublication(null, 'J', r(200), trail(200));
 assert.equal(h.completeFrom, at0 + 80_000, 'a full trail: complete from its oldest report');
 h = withPublication(h, 'J', r(220), trail(220));
 assert.equal(h.completeFrom, at0 + 80_000, 'overlapping: still complete from there');
 assert.equal(withPublication(h, 'J', r(200), trail(200)), h, 'an older publication changes nothing');
 const gap = withPublication(h, 'J', r(600), trail(600));
 assert.equal(gap.completeFrom, at0 + 480_000, 'a gap: complete only from the new publication');
 assert.equal(withPublication(h, 'K', r(240), trail(240)).key, 'K', 'another journey starts afresh');
 const short = withPublication(null, 'J', r(100), [r(80), r(60)]);
 assert.equal(short.completeFrom, at0 + 100_000 - TRAIL_SECONDS * 1000, 'fewer than six: every report of the window is there');
});

test('the estimate is the evaluator’s answer, and every refusal around it is said', () => {
 // A real journey from the sample, read as the page would hold it at one of its moments.
 const journey = sample.journeys[0];
 const reports = journey.reports.map(([at, lat, lon]) => ({at, lat, lon}));
 const placedAll = placeReports(TRACK, reports);
 // A moment with a stop under 1.5 min, one about five and one over twelve minutes ahead, by the evaluator's own answers.
 const lead = ([k, , e2]) => (e2 - placedAll[k][0]) / 60000;
 const moments = [...new Set(journey.cases.map(c => c[0]))];
 const i = moments.find(k => { const cs = journey.cases.filter(c => c[0] === k);
  return cs.some(c => lead(c) < 1.5) && cs.some(c => lead(c) > 4 && lead(c) < 6) && cs.some(c => lead(c) > 12); });
 const [, j, eta] = journey.cases.find(c => c[0] === i && lead(c) > 4 && lead(c) < 6);
 const tNow = placedAll[i][0];
 const held = reports.filter(x => x.at <= tNow);
 const history = {key: 'J', reports: held, completeFrom: held[0].at, latest: tNow};
 const release = {released: [], scopes: [SCOPE]};
 const ask = (over = {}) => arrivalEstimate({release, pattern: PATTERN, track: TRACK, timing: journey.timing, stopIndex: j, history,
  nowMs: tNow + 10_000, ...over});
 const e = ask();
 assert.equal(e.kind, 'estimate');
 assert.equal(e.atMs, eta, 'the evaluator’s own millisecond');
 assert.equal(e.model, ARRIVAL_MODEL);
 assert.match(arrivalWords(e), /^\d+–\d+ min$/, 'a range: the direction’s 80th-percentile error is over 2 min');
 const reason = over => ask(over).reason;
 assert.match(reason({release: {released: ['outbound']}}), /not released/);
 assert.match(reason({journeyChanged: true}), /another journey/);
 assert.match(reason({track: null}), /road is not loaded/);
 assert.match(reason({history: {...history, completeFrom: tNow - 60_000}}), /recent pace/);
 assert.match(reason({nowMs: tNow + (ARRIVAL_DISPLAY.staleS + 5) * 1000}), /too old/);
 const offRoad = {...history, reports: [...held.slice(0, -1), {...held[held.length - 1], lat: held[held.length - 1].lat + 0.01}]};
 assert.match(reason({history: offRoad}), /off its checked road/);
 // Under two minutes: the same moment, a stop just ahead.
 const near = journey.cases.find(([k, , e2]) => k === i && (e2 - tNow) / 60000 < 1.5);
 if (near) assert.match(ask({stopIndex: near[1]}).reason, /under 2 minutes/);
 // Far enough ahead to be out of range: the same moment, a stop much further on.
 const far = journey.cases.find(([k, , e2]) => k === i && (e2 - tNow) / 60000 > 12);
 if (far) assert.match(ask({stopIndex: far[1]}).reason, /more than 10 minutes/);
 assert.ok(near && far, 'the moment has a stop on each side of the band');
});

test('minutes are worded to whole minutes: a point within 2 min of error, else a range', () => {
 const point = {kind: 'estimate', atMs: 0, minutes: 6.4, lowMinutes: 4.4, highMinutes: 8.4, method: 'blended', model: ARRIVAL_MODEL, reportAgeS: 9, remainingM: 1500};
 assert.equal(arrivalWords(point), 'about 6 min');
 assert.equal(arrivalWords({...point, lowMinutes: 3.9, highMinutes: 8.9}), '4–9 min');
 assert.equal(arrivalWords({...point, minutes: 2.1, lowMinutes: 0, highMinutes: 4.6}), '1–5 min', 'never below 1');
});
