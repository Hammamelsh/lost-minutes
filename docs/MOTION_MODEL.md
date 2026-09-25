# The motion model: frozen

**Frozen:** motion-3, as published in `public/data/motion-evaluation.json` since commit `ad0c1cd`
(13 September 2026, 21:04 BST). The page estimates movement with exactly these settings until the
replacement rule below is met.

| | |
|---|---|
| Version | `motion-3 · 2026-09-13 · window 75s · dwell 10s · cruise speed · decay 120s · horizon 120s` |
| Generated | 2026-09-13T18:14:48.969Z (19:14 BST) |
| Settings | SHA-256 of the published `params` object: `0a1fae2b29b8399afc72a043adbbaf2ba70c051efc873b1b6f515df95cd0a4c7` |
| Corridor | 6 patterns on routes 15, 250 and 256 (BNML), each with an accepted road shape |
| Fitted on | 71 journeys, 7,162 reports that began before 12:50 UTC on 13 September |
| Scored on | 38 later journeys of the same afternoon, 4,205 reports |
| Reports file | `data/evaluation/motion-reports.json` (not in Git), SHA-256 `a80d3798cd0136e35c96a18955ab8d6402d5ff5d0308620d985318e29c35b02b` |

`scripts/evaluate-motion.mjs` reproduces it exactly from that file (checked on 13 September after
the scoring code moved into `scripts/motion-scoring.mjs`). It now writes a candidate by default and
refuses to overwrite the published model unless run with
`--out public/data/motion-evaluation.json --replace-frozen yes`.

## Development evidence, not a test

The 13 September captures (runs from 12:00 to 16:13 BST) were read and re-read while motion-2 and
motion-3 were designed. The audit of corrections, the choice of the candidate family and the fitting
rule were all shaped by looking at them, the held-out half included. They are **development
evidence**: they show the method works on the data it was built around. They cannot show how the
model does on a day it has not seen, so no claim about the model rests on them alone. Weekday
traffic has not been seen at all.

## Scoring the frozen model on fresh captures

Fresh means journeys that began after the model was generated (18:14:48 UTC on 13 September). The
evaluation refits nothing, publishes nothing and flags any window that overlaps development.

```bash
# after the collector has stopped: the warehouse is single-writer
.venv/bin/python -m pipeline.motion_data export --lines 15,250,256 \
  --since 2026-09-13T18:14:49Z --out data/evaluation/motion-reports-fresh.json
node --experimental-strip-types --import ./tests/alias-loader.mjs scripts/evaluate-frozen.mjs \
  --reports data/evaluation/motion-reports-fresh.json --label fresh-2026-09-13-evening
```

It reports, beside the last report itself (what the page draws without estimates) and beside
constant speed, on the same journeys:

- **positional error** by report age: median, mean, 80th and 95th percentile;
- **corrections**: how often and how far each arriving report moves the drawn estimate (back and
  forward beyond 35 m, snaps beyond 150 m, mean and 95th percentile size);
- **abstention**: how often the model declined to estimate, and each reason;
- **uncertainty coverage**: how often the published band (the distance 8 in 10 training estimates
  came within, by report age) actually held the bus. It should be near 80%.

### First fresh window: 13 September, evening (still a Sunday)

30 journeys, 2,116 reports, observed 19:15 to 22:37 BST, after the model was frozen; exported with
`--since 2026-09-13T18:14:49Z` once the collector had stopped, and scored with nothing refitted
(`data/evaluation/frozen-fresh-2026-09-13-evening.json`, not in Git).

| Up to a minute old | Median error | Mean |
|---|---|---|
| **Frozen motion-3** | **65.0 m** | 91.8 m |
| Constant speed | 71.7 m | 98.6 m |
| The last report itself (no estimate) | 143.0 m | 171.5 m |

- By report age the model's median beat the last report in every bin, and constant speed in five of
  seven; constant speed was better when the report was under 10 s old (27.2 m against 30.5 m, only
  46 cases) and at 90 s (145.7 m against 146.3 m).
- The published band held 75–82% of errors, bin by bin (nominally 80%): about right up to 30 s,
  slightly narrow beyond.
- Corrections, 1,980 arriving reports: mean 67.9 m; 22.9% pulled the estimate back more than
  35 m, 40.0% forward more than 35 m, 10.1% over 150 m (constant speed: 72.8 m, 32.2%, 11.7%).
- Abstained on 3.2% of moments: off the road geometry 151, only one report so far 130, not on a
  timetable pattern 55, reports jumping 17, too far apart 6.

It holds up on journeys it has not seen, and much like the development figures (median 62.6 m).
It is the same Sunday, so this is not the weekday, held-out-by-day test the rule below asks for.

### Second fresh window: Monday 14 September, the first weekday

Exported once the collector had stopped, with `--since 2026-09-13T23:00:00Z` (Monday 00:00 BST),
and scored with nothing refitted. The outputs, `data/evaluation/frozen-monday-2026-09-14.json`
and `drawing-monday-2026-09-14.json`, are not in Git.

**What the capture holds.** 86 journeys and 6,745 reports on routes 15, 250 and 256, from three
bounded collection runs: 00:00–00:22, 08:57–09:27 and 09:45–11:49 BST. There is almost nothing
from the morning peak (only from 08:57) and nothing after midday.

**What could be scored.** Only routes 15 and 250. Their four patterns with accepted road shapes
carry 4,937 of the reports. Route 256 gave nothing to score:
- its 12 inbound journeys (965 reports) were placed on no timetable pattern;
- its outbound reports were placed on a variant whose road shape had been rejected for lack of
  Sunday reports (628), or on no pattern at all (182).

| Up to a minute old (11,668 cases) | Median error | Mean |
|---|---|---|
| **Frozen motion-3** | **62.7 m** | 87.7 m |
| Constant speed | 71.4 m | 95.5 m |
| The last report itself (no estimate) | 118.3 m | 148.5 m |

- **By report age:** the model's median beat the last report in every bin. It beat constant speed
  in all but the youngest (≤10 s: 33.5 m against 34.0 m, from 98 cases, the only bin under 100).
- **Band coverage:** the published band held 79.2–81.1% of errors, bin by bin (nominally 80%).
- **Corrections** (4,546 arriving reports): mean 67.9 m, 95th percentile 181 m. 25.2% pulled the
  estimate back more than 35 m, 36.5% forward, 10.3% snapped. Constant speed: mean 73.4 m, 33.2%
  back, 11.5% snapped.
- **Abstention:** 30.5% of moments, against 3.2% on Sunday evening, nearly all on route 256:
  - not placed on a timetable pattern: 6,065;
  - no accepted road shape: 3,369;
  - off the road geometry: 859;
  - only one report so far: 302;
  - reports going backwards: 84.

**The drawing** (`scripts/evaluate-drawing.mjs`, 62 journeys, 4,853 held-out reports):

| At the median, from where the bus next reported | Distance | Near a stop | Between stops | Display lag |
|---|---|---|---|---|
| The drawn bus | 60.7 m (80th percentile 141.7, 95th 232.9) | 42.8 m | 79.4 m | −0.1 s (80th percentile 16.1 s) |
| The estimate | 59.8 m | 45.9 m | — | — |
| The last report | 98.3 m | 74.3 m | — | — |

Stands the reports contradict: 3.1 an hour, against 12.9 had the drawn bus stood still while
waiting.

**What this is and is not.** It is one weekday morning, on two of the three routes, with no peak
and no afternoon. It agrees with the Sunday evening window (median 65.0 m then). It is not the
held-out-by-day test on two weekdays that the rule below asks for, and not an evaluation of weekday
performance: route 256 was not scored at all, and the busiest hours were not captured.

## Drawing is not part of the model

How the drawn bus follows the estimate is separate from where the estimate is, and changing it
changes no number above. The page draws with `DRAWING` and `drawingFor` in `lib/motion.ts`: the
estimate's own path averaged over ±3 s of what is already known of it, so a pause at a stop is eased
into and out of; a drawn speed that changes by at most 3 m/s each second and never steps; a
correction closed no faster than 12 m/s beyond the path's speed; and, while the bus moves, a drawn
bus found ahead of the estimate by no more than the estimate's own measured error at that report age
(the band above) slows to half the path's speed until the estimate catches up, instead of reversing,
and instead of standing: a drawn bus standing while its estimate moves looks like a stop that never
happened. When the estimate stops (a pause at a stop, a report too old, the end of the horizon) the
drawn bus stops with it. The `settle`, `catchUp` and `turnSettle`
values recorded in the frozen settings are the drawing the evaluation was published with. They are
kept, so the settings hash still matches, but the page no longer draws with them.

How smoothly the page draws is measured separately, over the same captures and with the same
frozen estimate:

```bash
node --experimental-strip-types --import ./tests/alias-loader.mjs scripts/evaluate-drawing.mjs \
  --reports data/evaluation/motion-reports-fresh.json --label fresh-2026-09-13-evening
# add --before <file> to compare an earlier lib/motion.ts, e.g. `git show ad0c1cd:lib/motion.ts`
```

### What the page draws, held out (14 September)

Each report is held out from what came before it: at the moment the bus made it, how far along the
road from it were the drawn bus, the estimate and the last report the page had, none of which could
yet have known it? Display lag is how long after the bus reached a reported point each of them
reached it (negative: before the bus reported being there). These are distances along the road from
a later report, not GPS accuracy; the reports carry the vehicles' own GPS error in every figure alike.

| | Fresh: 30 journeys, 2,063 reports | Development: 109 journeys, 11,055 reports |
|---|---|---|
| **Drawn now**, median; 80th; 95th percentile | 61.3; 137.4; 223.3 m | 59.0; 131.9; 216.5 m |
| … within 50 m of a stop; between stops (median) | 43.7; 80.7 m | 40.3; 75.9 m |
| … display lag, median; 80th percentile | 2.5; 15.6 s | −0.5; 15.0 s |
| The estimate it follows (median; near a stop; lag) | 54.8 m; 38.6 m; 0.6 s | 52.5 m; 37.5 m; −3 s |
| The last report (median; near a stop; lag) | 112.8 m; 97.3 m; 17.6 s | 86.0 m; 52.7 m; 15.7 s |
| The drawing before 13 September's smoothing (ad0c1cd) | 57.7 m; 40.1 m; 2.5 s | 55.3 m; 38.7 m; −0.5 s |
| Drawn stands the reports contradict, an hour (of all stands) | 3.2 (of 32.7) | 2.8 (of 27.0) |
| … if it stood still while waiting, as on 13 September | 11.9 (of 64.5) | 10.9 (of 64.2) |
| … the drawing before the smoothing | 10.6 (of 81.6) | 9.2 (of 80.3) |

A stand is the drawn bus still for 3 s or more; the reports contradict it when those around it span
30 m or more. Smoothness costs position: the drawn bus is 6–7 m further from where the bus next
reported than the estimate it follows, and 3–4 m further than the unsmoothed drawing, most of it
between stops; it is 27–51 m nearer than the last report. The drawn bus's distance from the
estimate (95th percentile 88 and 91 m) is a distance between two computed positions, not an error.

**Waiting at a crawl** (half the path's speed) rather than standing was adopted on 14 September:
stands the reports contradict fell from 11.9 to 3.2 an hour on the fresh captures and from 10.9 to
2.8 on the development ones, the median error changed by under 2 m (61.3 against 62.9; 59.0
against 58.5) and near a stop by 1–2 m the other way (43.7 against 42.0; 40.3 against 39.2), and
the median lag shortened (2.5 against 3.6 s; −0.5 against 1 s). A 30% crawl measured almost the
same. The drawn bus still stops when the estimate does, so the crawl never carries travel past a
stale report (`tests/motion.test.mjs`).

## What would replace it

Not one aggregate. A candidate replaces the frozen model only when, on fresh captures from at least
two weekdays that were not used to fit it (held out by day, not by later journeys on the same day):

1. its median and 80th-percentile error are no more than 5% worse than the frozen model's in any
   report-age bin up to 60 s with at least 100 cases, and better overall up to a minute;
2. it pulls the drawn bus back by more than 35 m, and snaps, no more often;
3. its band holds between 75% and 85% of errors in every bin with at least 100 cases;
4. it abstains no more often, or the side-by-side report says why a larger abstention is worth it;
5. the owner has read that report and agreed.

Then the fit is published with `--replace-frozen yes` under a new version, and this file records
the new settings hash, the data it was fitted and scored on, and the report that justified it.

## Candidate motion-4: a standing hold — criteria fixed on 21 September 2026, before any result

**Why a candidate at all.** The route-15 correction of 13:31:03 UTC on 21 September was reproduced
from the raw captures (`outputs/probes/repro/replay-snap.mjs`): BU25YWF reported the same position
at 13:36:10 and 13:36:29 — 0 m in 20 s, standing — and the frozen model, reading speed over 75 s
with `standingHold: 0`, still carried the drawn bus 81 m and 103 m past it; when it read
"standing" it snapped back 179 m, and when the bus moved off it snapped forward 177 m. Two large
jumps around one stop. Not matching, identity or geometry: the journey was 1158 throughout, the
shared road is the accepted pattern's own track, and the served polyline is byte-identical to the
evaluated one.

**The candidate.** `standingHold` > 0 — a parameter the model already has, switched off in
motion-3 — with nothing else changed: when the last reports show the bus standing (steps under
`standingMetres`, 8 m), it is held at its report for that many seconds before being moved on.
Values to score: 15, 20 and 30 s. No other parameter is touched.

**The data.** The replacement rule above asks for at least two weekdays not used to fit the model,
held out by day. They are Monday 14 September (`motion-reports-monday.json`, used once to *score*
motion-3, never to fit it) and Monday 21 September, 12:00–17:10 UTC, restored from the server's raw
captures into `data/evaluation/scratch-2026-09-21.duckdb` and exported for routes 15, 250 and 256.

**The criteria are the replacement rule's, unchanged**, applied per age bin up to 60 s with at
least 100 cases: error (median and p80) within 5% of motion-3's in every bin and better overall
up to a minute; pull-backs over 35 m and snaps no more often; band coverage 75–85% in every bin;
abstention no more often. Plus one that the reproduction makes specific: **corrections over 150 m
per hour must fall**, since that is the fault being addressed, and a candidate that cuts them by
worsening error elsewhere has moved the problem, not solved it.

**What happens on the result.** If a value qualifies on both weekdays, the side-by-side report is
written here and put to the owner; rule 5 says the owner agrees before anything replaces motion-3,
so nothing is released in the milestone that ran the evaluation. If none qualifies, the reason is
recorded (evidence, matching, geometry or the model) and motion-3 stays.

### Result, 21 September 2026, evening: no hold value qualifies

Scored exactly as fixed above, on Monday 14 September (86 journeys, 6,745 reports, the set that
scored motion-3 on the day) and Monday 21 September 12:00–16:55 UTC (109 journeys, 16,205 reports,
restored from the server's raw captures into a scratch warehouse), nothing refitted. The 14
September rerun reproduces that day's published figures to the decimal (median 62.7 m, snaps
10.3%, same params hash), so the two runs are comparable.

| candidate | day | median ≤60 s | mean | pull-backs >35 m | forward >35 m | snaps >150 m | verdict |
|---|---|---|---|---|---|---|---|
| motion-3 (frozen) | 14 Sep | 62.7 m | 87.7 m | 25.2% | 36.5% | 10.3% | — |
| standingHold 15 s | 14 Sep | 61.6 m | 86.6 m | 25.6% | 38.1% | **11.1%** | fails: pull-backs and snaps more often |
| standingHold 20 s | 14 Sep | 61.8 m | 86.7 m | 24.2% | 39.2% | **11.2%** | fails: snaps more often |
| standingHold 30 s | 14 Sep | 62.6 m | 87.4 m | 21.4% | 40.8% | **12.1%** | fails: snaps more often |
| motion-3 (frozen) | 21 Sep | 59.2 m | 82.6 m | 26.2% | 33.8% | 8.8% | — |
| standingHold 15 s | 21 Sep | 58.1 m | 81.7 m | 26.8% | 35.7% | **9.9%** | fails: pull-backs and snaps more often |
| standingHold 20 s | 21 Sep | 58.4 m | 81.8 m | 25.3% | 36.8% | **10.1%** | fails: snaps more often |
| standingHold 30 s | 21 Sep | 59.0 m | 82.8 m | 22.4% | 38.6% | **10.9%** | fails: not better overall; snaps more often |

Per age bin up to 60 s every candidate stays within 5% of motion-3's median and p80 and keeps
band coverage between 75% and 85%; abstention is identical (the hold changes no eligibility).
What fails is the criterion the fault itself named: **corrections over 150 m do not fall, they
rise**. Holding a standing bus removes the backward snap when the estimate had rolled past it,
and adds a forward snap when the bus moves off and the held estimate is now behind it; the
longer the hold, the more of them (12.1% at 30 s). The reproduction of 21 September showed both
jumps around one stop — the hold trades the first for more of the second. **motion-3 stays.**

Two things are kept apart. The *prediction* in the affected case is wrong in the same way as
before: a bus its own reports show standing is estimated as moving, for up to 75 s of speed
window. The *presentation* of the correction is new since d1cf253: when the estimate is put right
by more than 150 m the map draws a dashed trace from where the bus was drawn to its report for six
seconds and the card says "Moved N m to its latest report · it had stopped"; that explains the
jump, it does not remove it.

**The smallest safe way to withhold the faulty prediction** (backlog item 10, not done — the
owner decides): when `speed.standingNow` is true and no hold is configured, `estimate()` returns
the last report in observed mode with the reason "its last reports show it standing". The bus is
then drawn as every observed bus is — travelling between its own reports, labelled "Reported
positions", never ahead of the newest — and the estimate resumes at the first report that shows
movement, about one report (20 s) late. That is an abstention the evaluator already counts, a
one-clause change plus a Node test and `motion.spec`'s standing check, and no threshold moves.

## Route 263: scoring the frozen model where it has never run

Route 263's road geometry was accepted in both directions on 21 September (10,328 and 11,573
reports, 95% within 17 m). Geometry agreement is not evidence about predicted movement, so
motion-3 is scored on 263's own journeys **exactly as it was on the corridor**, with nothing
refitted and these criteria fixed first:

- **Data:** every 263 journey in the 21 September afternoon captures, and the verified 17 September
  journey of YX74OKP (`tests/browser/recorded/journey-263.json`, 263 reports, each present in the
  warehouse with identical time and position; its exporter was not recorded).
- **Comparators on the same moments:** the last report itself, and constant speed.
- **Release per direction** only if, on at least 20 journeys and 1,000 held-out cases per direction:
  median error up to a minute at least 20% better than the last report's; p80 no worse than the
  corridor's p80 by more than 10%; band coverage 75–85%; snaps no more frequent per hour than the
  corridor's. A direction that misses is recorded with which criterion it missed and why.
- **Separate from arrival minutes:** `docs/ARRIVAL_RELEASE_CRITERIA.md` is untouched; releasing
  movement on 263 releases no arrival estimate.

### Result, 21 September 2026, evening: not released in either direction

Scored on every 263 journey the scratch warehouse holds (13–21 September; inbound 148 journeys,
18,900 reports, 46,406 cases up to a minute; outbound 150, 19,591, 48,861), comparators on the
same moments:

| direction | median ≤60 s (last report) | p80 (corridor 21 Sep 134.9 m) | band coverage per bin | snaps (corridor 8.8%) | missed |
|---|---|---|---|---|---|
| inbound | 69.8 m (127.1 m, 45% better) | **149.5 m, 10.8% worse** | 79/78/78/80/78% | **10.0%** | p80; snaps |
| outbound | 63.3 m (118.2 m, 46% better) | 143.9 m, 6.7% worse | **74.8**/80/80/81/80% | **9.4%** | ≤10 s band by 0.2 points; snaps |

The model is as much better than the last report on 263 as on the corridor, and constant speed
is worse than it in both directions (77.6 and 71.0 m). What it misses is the corridor's own
correction rate, by 0.6–1.2 points, and inbound the corridor's p80 by 0.8 points over the
allowance. Against the 14 September corridor figures (p80 143.5 m, snaps 10.3%) both directions
would pass; the same-day comparator is the fair one and is the one used. Route 263 keeps the
front view and travels between its reports; no arrival estimate is touched.

## Drawing between reports: playback on a clock (23–24 September 2026)

Not part of the model, and not an estimate: how a bus *outside* the evaluated patterns is drawn
between its own reports. Until 23 September the drawn bus travelled from the report it was drawn
at to the report that had just arrived, taking the time the bus itself took, then waited (`GLIDE`).
Honest, but paced by *arrival*: a phone receives reports 10–40 s after they are made and often two
in one publication, so the bus sprinted through the pair and stood until the next poll.

`PLAYBACK` in `lib/motion.ts` (24 September, the second version, after the first was watched on a
real 142 and a real 219):

- **A path through the reports.** Each report is projected onto the checked road where it lies on
  it (within `offTrack`, 40 m); consecutive reports are joined by the road between them where both
  are on it, in order and not the long way round, and by the chord otherwise; a pair GLIDE refuses
  (over 400 m, or a silence over 45 s that ends more than scatter away) is not joined at all. On the
  road, the bus is drawn *on* the road with the road's heading — the first version carried each
  report's own offset across the stretch and drew a bus 15–35 m beside Rochdale Road.
- **Distance against time**: on each stretch a cubic that leaves the earlier report at the pace the
  stretch before implied and arrives at the pace this stretch implies, held monotone; each stretch
  depends only on reports at or before its end, so a later report never reshapes a stretch being
  played (Fritsch–Carlson tangents looked ahead and bent the current stretch by 10–24 m at every
  publication).
- **A smoothed place.** The reports' own timing is jerky — a real 219 reported 207 m in 24 s, 16 m
  in 17 s, 345 m in 28 s, 67 m in 16 s along open road — and a drawing that reaches every report at
  its exact moment must surge like that. The place shown is the path's average over the previous
  24 s (`PACE.smoothMs`): a causal box filter, monotone, never ahead of any report, never reshaped
  by a later one, at the cost of about 12 s of added lag, said on the card. The clock may run one
  window past the newest report on the reading that the bus then stood; when the next report says
  it moved on, the place moves ahead and the drawn bus catches it up at its own pace.
- **A bus's pace.** The drawn bus follows that place with acceleration held to 1.0 m/s² and braking
  to 1.5 m/s² (`PACE`; the fleet's own 20 s segments imply accelerations under 0.82 m/s², p99 0.53;
  real buses measured peak at 1.4 accelerating and 1.8 braking), never faster than 22 m/s, at most
  12% over the reports' own speed while catching up, braking to a stand at the newest report when
  nothing newer is known. It is never drawn ahead of the newest report.
- **The clock** runs `delay` behind the presentation clock: the median arrival lag seen plus a
  report interval (20 s), bounded 30–60 s (a delay of lag + 8 s ran dry at every late report on the
  219), at real time, or 5% over while behind — the old 0.8–1.2× band was the "too fast, not really
  fast" the owner saw. A refused pair is crossed as a repositioning, said with its reason, read from
  the stretch the drawn bus is on (reading the clock's stretch missed two of three in the A/B).

**Measured**, `scripts/evaluate-playback.mjs` (27 recorded journeys, 2,107 reports, 60 fps, 8–38 s
of arrival jitter, against the glide read from `b9cbe88`) and `scripts/evaluate-fleet-playback.mjs`
(every vehicle in the 63-publication evening reel of 22 September, 334 vehicle-journeys, 118 with a
checked road, each replayed with its own road and judged bus by bus): see
`docs/MILESTONE_2026-09-23_SHEET_PACING_DISCOVERY.md` §2b for the numbers. Nothing here changes the
estimator, its parameters, its release gate or its scores above.

### After the route-43 incident (24 September 2026, evening)

A passenger-acceptance failure on the served site — a route-43 ride that appeared to teleport and sat
across its road — was reproduced from the server's own captures and request log
(`docs/MILESTONE_2026-09-23_SHEET_PACING_DISCOVERY.md` §10). What changed, rule by rule:

- **Which way the drawn bus faces.** Until then a played-back bus faced the *reported* bearing of the
  next report the clock was heading for — another moment — and a report with no bearing made it a
  round token; the ride camera takes the drawn heading every frame, so it spun 77–140° in one frame
  at each new report. The drawn bus now faces the way it is drawn travelling: the road's direction
  a bus's length ahead on a road stretch, the stretch's own direction on a straight one, held while
  it stands; turned into at no more than 90° a second, eased over 0.45 s (`HEADING`), and taken at
  once only across a stated repositioning. A report's own bearing is untouched: it stays what the
  report said, in the evidence.
- **Which road place a report stands for.** Within 20 m of its road a report is on it whatever its
  bearing says (a bearing can be stale or noisy; a first version let a disagreeing bearing refuse a
  report lying on the road, which turned a bus's road into chords that cut its corners). Further off,
  a report with a bearing is placed at the nearest point of its road facing the same way (within 45°),
  up to 50 m off (`BEARING_AGREED_METRES`); otherwise within `offTrack` as before. The incident bus's reports ran 18–44 m to one side of its
  road for two minutes in the city centre, every bearing agreeing with the road, while two other 43s
  crossed the same stretch within 20 m of it: GPS pushed aside, not another street. The road joins two
  reports round a corner when it is up to three times the line between them at no more than 15 m/s —
  reports to the inside of a turn make the road look long — and not when it is far longer at an
  impossible pace (a 250's road looping 1,353 m where it drove 302 m in 27 s).
- **The clock's bounds.** Behind the delay by more than 15 s (`resyncMs`, from 45 s) with newer reports
  to go to, it is repositioned and says so rather than crawling back; while the reports say the bus
  stood, the clock makes up time four times faster, which nothing on screen shows. A pause in drawing
  (a tab put away) goes to the delay's moment on return, once fresh reports are there, and a move
  worth mentioning is said ("the page was in the background"); a small one is eased. The frame loop's
  own rest at the end of the reports is not a pause. The delay the card states is measured from the
  last moment the reports had the bus at the drawn place, not from the clock.
- **Four older faults found by the fleet check on the way**, each on one bus: a guard meant for two
  reports a metre apart pinned every later report of a 250 to one place (a 1,181 m jump); a rebuilt
  path re-anchored a bus that had stood at its terminus to its first pass; a re-anchor measured a road
  stretch along its chord; and two reports from one spot were drawn as different kinds of place.

The checks: `tests/incident-43.test.mjs` (the incident's own publications, four arrival timings, six
assertions that each failed on `2c00759`) and `scripts/evaluate-fleet-playback.mjs`, which now also
judges heading against movement, one-frame turns, a lost heading and the delay, bus by bus.

### A standing bus (25 September 2026, the served site after `5c00509`)

Ridden on the served site after the incident fix, a 216 standing at Piccadilly Gardens read "Off its
checked road" 3.4 m from it, was shown from above, and the camera swung 69° when a heading appeared.
The fleet check, which had met every bus from its first report, was taught to meet them halfway and
to measure turning while standing still; it found the same fault family across the fleet. Rules:

- **Two reports on the road within a bus's length (12 m) are one place on it**, where both the reports
  and their places on the road are that close. The stretch between them is drawn on the road, facing
  along it. It had been a straight line off the road with no direction, so a standing bus was "off its
  checked road" except at its newest report. (The first version asked only that the road places be
  close: a 263 leaving its road at a terminus had two reports 20 m apart measure onto it 9 m apart,
  and was drawn backing along the road facing forwards for 2.6 s. Found riding it on the served site.)
- **A line between reports shorter than a bus's length gives no heading.** Scatter round a stand is
  3–5 m in any direction; taken as a direction, it turned standing buses round.
- **A bus turns only as it is drawn moving**: at most 15° a metre while it creeps under 0.5 m/s,
  rising to 60° a metre from 1 m/s, and never over 90° a second (`HEADING`). One figure could not do
  both jobs: 9.5° a metre (a bus's own ~6 m radius) left buses on straight lines between reports
  facing sideways past a corner for up to 3 s; 15° lagged a terminus U-turn driven at 1–2 m/s by a
  second; 30° let a creeping bus swing 69° in 5 s. With the rate tied to the drawn speed, corners and
  U-turns are as they were before any limit, and the worst turn within 5 s while standing still is
  37°, where it was 180°.
- **The ride camera turns at most 120° a second** (`RIDE_TURN` in `components/city-map.tsx`), more
  than a drawn bus does, so it keeps up; it cuts only at a stated repositioning, and under reduced
  motion takes the heading at once.
- **"Shown from above" reads the drawing**, not the report: a bus with no reported bearing that is
  drawn facing along its road is not shown from above and is not said to be.

- **The body faces along the road it covers, not a bus's length ahead.** On a checked road the drawn
  heading is the direction from half a bus behind to half a bus ahead (`bodyHeading`), its rear to its
  front; it had been towards the road a whole bus's length ahead (`headingAhead`), which turned a slow
  bus's nose into a corner seconds before it reached it — a route 85 at 2 m/s faced up to 114° off its
  movement for 3.6 s. Replaying every ride Try Ride-along could have offered on two reels, rides the
  clean-ride rule accepts were clean over three minutes 61.5% of the time with the look-ahead and
  77.8% with the body; the fleet's buses facing over 30° off their movement for over 1.5 s went 10, 3,
  5, 1 → 9, 3, 2, 0. The estimate's own heading and the front view's aim are unchanged.

Checks: `tests/standing-on-road.test.mjs` (the 216's own reports met at four moments, scatter back
along a road, and scatter with no road, all three failing on `5c00509`; and the 263's terminus loop,
failing on `cd711a3`), two browser checks in
`tests/browser/ride-quality.spec.mjs` (both fail on `5c00509`, on both profiles), and the fleet check's
`--meet` option with its turning-while-still, heading-on-road and off-road-label measures.

### One ride everywhere, and uncertainty without invented motion (25 September 2026)

The owner approved report-based playback for every ride (backlog 31). What changed in the drawing,
each found by `scripts/evaluate-ride-faults.mjs` (every bus in a reel, ridden, its faults told apart by
cause) and traced to a frame before it was changed:

- **Ride-along draws every bus by playback**; the estimate is drawn only on the map. Entering or leaving
  the ride restarts the drawing (a change of what is shown, not a movement); the bus is not drawn during
  the entrance glide after such a restart. An estimate falling back to its reports on the map is still a
  said correction.
- **Contradicted reports are held** (`supportedReports`): on a checked road, a report off the road or
  back along it, between two reports the road joins at a bus's pace, is not travelled to; the newest such
  report waits for the next. Two off the road together are drawn where they were made.
- **Late reports rewind the clock, not chase** (`PLAYBACK.rewindMetres`): after a rebuild that puts the
  moment shown over 15 m ahead of the drawn bus, the clock goes back to the moment the drawn place stands
  for, within the resync allowance; beyond it, a said repositioning. `PACE.closingMps` 4 → 2.
- **The delay shortens no faster than the clock makes time up** (5% of real time), so a smaller target
  never resyncs and steps the bus.
- **Repositionings are cuts** (a running ease is dropped), and a resync under a repositioning's worth
  is eased.
- **Playback starts without a step**: a lone report measured onto its road is eased across; a start well
  behind the delay's moment is one eased correction, not a chase.
- **A bus near its road faces along it** where nothing else gives a direction (`roadHeadingNear`).
- **A drawing begun afresh starts at the pace its reports show** for the moment shown; only a bus that
  waited at a lone report pulls away from rest.

Measured on two reels (the 22 September evening reel, 335 bus-journeys, 79 hours ridden; the 24
September incident reel, 810, 257 hours), met from their first publication, the deployed `a82abfb` with
its estimate in the ride against this: the milestone record has the table.
