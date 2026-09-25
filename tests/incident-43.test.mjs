// The route-43 incident of 24 September 2026, as a regression. BNML LV74KNG on journey 1147 (43
// outbound) was ridden along by the owner on Portland Street and Princess Street and appeared to
// teleport and to sit across its road. Its publications, rebuilt on the server from the retained
// captures, are played through the drawing with three arrival timings: polled every 20 s
// (visible), the owner's own as the server's request log has it (a tab shown after a minute), and
// a 90 s gap in publications while the page drew (stall). Each assertion is one fault found:
// `docs/MILESTONE_2026-09-23_SHEET_PACING_DISCOVERY.md` §10 has the evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ride, T, turn} from './incident-43-harness.mjs';
import {project, PLAYBACK, PACE} from '../lib/motion.ts';
import {road} from './incident-43-harness.mjs';

const runs = Object.fromEntries(['visible', 'owner', 'stall', 'resting'].map(name => [name, ride(name)]));
const said = (frames, i) => frames.slice(Math.max(0, i - 2), i + 1).some(f => f.said);

test('no frame moves the bus faster than a bus unless it is a repositioning, and each is said', () => {
  // The old drawing put the bus 125 m on in one frame, unsaid, when a tab was shown again.
  const limit = (PACE.maxMps + 8) * 0.1;
  for (const [name, f] of Object.entries(runs))
    f.forEach((x, i) => assert.ok(x.step <= limit || said(f, i), `${name} ${new Date(x.wall).toISOString().slice(11, 21)}: ${x.step.toFixed(1)} m in 100 ms, nothing said`));
});

test('it never turns faster than a bus turns, and never loses its heading once it has one', () => {
  // The old drawing turned 92–101° in one frame at each new report, and the ride camera with it,
  // and a report with no bearing made it a round token for a quarter of the ride.
  for (const [name, f] of Object.entries(runs)) {
    const known = f.findIndex(x => x.bearing !== null);
    assert.ok(known >= 0 && known < 5, `${name}: a heading from the first frames`);
    f.slice(known).forEach((x, i, all) => {
      assert.notEqual(x.bearing, null, `${name}: no round token once it has a heading`);
      if (i) assert.ok(Math.abs(turn(all[i - 1].bearing, x.bearing)) <= 9.5 || said(all, i), `${name}: ${Math.abs(turn(all[i - 1].bearing, x.bearing)).toFixed(0)}° in one frame`);
    });
  }
});

test('it faces the way it is drawn moving, turning into corners rather than across the road', () => {
  // The old drawing faced the next report's bearing: 90–100° across Portland Street for the whole
  // twenty seconds between two reports. What is allowed now is the heading leading into a corner
  // of the road, or following a kink where two straight stretches meet at a report, for a moment.
  for (const [name, f] of Object.entries(runs)) {
    const moving = f.filter(x => x.dir !== null && x.step >= 0.5);
    const off = moving.map(x => Math.abs(turn(x.bearing, x.dir))).sort((a, b) => a - b);
    assert.ok(off.length > 200, `${name}: it moves`);
    assert.ok(off[Math.floor(off.length * 0.95)] < 20, `${name}: 95% within 20° of its movement (${off[Math.floor(off.length * 0.95)].toFixed(0)}°)`);
    let run = 0, longest = 0;
    for (const x of f) { if (x.dir === null || x.step < 0.5) continue; run = Math.abs(turn(x.bearing, x.dir)) > 30 ? run + 1 : 0; longest = Math.max(longest, run); }
    assert.ok(longest <= 15, `${name}: never more than 30° off its movement for longer than 1.5 s (${longest / 10} s)`);
  }
});

test('reports pushed to one side of the road, facing along it, are drawn on the road, never across the block', () => {
  // From 17:52:30 to 17:53:32 its reports lay 26–44 m to one side of its accepted road, every one
  // facing along the road there; two other 43s crossed the same stretch within 20 m of it in the
  // same half hour. The old drawing put the one taken on the corner of Whitworth Street and Oxford
  // Street, 43.5 m off, where it was made, and drove the bus across the block to it (and a first
  // attempt at this fix, reading the run as another street, put all four inside the block).
  const window = [T('17:52:15'), T('17:53:48')];
  for (const [name, f] of Object.entries(runs)) {
    const inRun = f.filter(x => x.represented >= window[0] && x.represented <= window[1]);
    assert.ok(inRun.length > 100, `${name}: the run is drawn`);
    const worst = Math.max(...inRun.map(x => project(road, x).offset));
    assert.ok(worst < 3, `${name}: on its road through the run (worst ${worst.toFixed(1)} m off)`);
  }
  // And where it is said to be on its road, it is.
  for (const [name, f] of Object.entries(runs)) for (const x of f.filter(y => y.onRoad))
    assert.ok(project(road, x).offset < 1, `${name}: on its road when it is said to be`);
});

test('the delay it is drawn at is bounded once reports are there, and a gap is repositioned and said', () => {
  const bound = (PLAYBACK.maxDelayMs + PLAYBACK.resyncMs) / 1000;
  for (const name of ['visible', 'owner']) {
    const f = runs[name].filter(x => x.wall - x.newest < PLAYBACK.maxDelayMs);   // reports within reach
    for (const x of f.slice(5)) assert.ok(x.delay <= bound, `${name}: ${x.delay.toFixed(0)} s behind at ${new Date(x.wall).toISOString().slice(11, 19)}`);
  }
  // The owner's tab shown again: the bus goes to its place, said as a repositioning.
  assert.ok(runs.owner.some(x => x.said === 'resumed'), 'the return from the background is said');
  // Ninety seconds without a publication: while none comes it waits at its newest report (and that
  // is what it is: that old); when they come back it is repositioned, said, not driven faster.
  const back = runs.stall.filter(x => x.wall >= T('17:53:30'));
  assert.ok(back.slice(0, 20).some(x => x.said === 'too_long'), 'the lost time is a repositioning, said');
  for (const x of back.slice(20)) assert.ok(x.delay <= bound, `stall: ${x.delay.toFixed(0)} s behind at ${new Date(x.wall).toISOString().slice(11, 19)}`);
});

test('the frame loop resting between publications is not taken for the page being put away', () => {
  // The loop rests once the bus has reached the end of its reports and wakes when a publication
  // arrives: here, the 90 s without one. The first frame after is a continuation — the lost time is
  // a repositioning said as such — not a return from the background, and nothing moves unsaid.
  const f = runs.resting;
  assert.ok(f.length < runs.stall.length, `the loop did rest (${f.length} frames against ${runs.stall.length})`);
  assert.equal(f.filter(x => x.said === 'resumed').length, 0, 'nothing is said about the background');
  const limit = 30 * 0.1;
  f.forEach((x, i) => assert.ok(x.step <= limit || said(f, i), `${x.step.toFixed(1)} m unsaid at ${new Date(x.wall).toISOString().slice(11, 21)}`));
  assert.ok(f.some(x => x.said === 'too_long'), 'the lost time is said');
})
