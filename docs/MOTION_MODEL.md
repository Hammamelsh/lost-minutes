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

