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

## Drawing is not part of the model

How the drawn bus follows the estimate is separate from where the estimate is, and changing it
changes no number above. The page draws with `DRAWING` and `drawingFor` in `lib/motion.ts`: the
estimate's own path averaged over ±3 s of what is already known of it, so a pause at a stop is eased
into and out of; a drawn speed that changes by at most 3 m/s each second and never steps; a
correction closed no faster than 12 m/s beyond the path's speed; and, while the bus moves, a drawn
bus found ahead of the estimate by no more than the estimate's own measured error at that report age
(the band above) stands and waits instead of reversing. The `settle`, `catchUp` and `turnSettle`
values recorded in the frozen settings are the drawing the evaluation was published with. They are
kept, so the settings hash still matches, but the page no longer draws with them.

How smoothly the page draws is measured separately, over the same captures and with the same
frozen estimate:

```bash
node --experimental-strip-types --import ./tests/alias-loader.mjs scripts/evaluate-drawing.mjs \
  --reports data/evaluation/motion-reports-fresh.json --label fresh-2026-09-13-evening
# add --before <file> to compare an earlier lib/motion.ts, e.g. `git show ad0c1cd:lib/motion.ts`
```

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
