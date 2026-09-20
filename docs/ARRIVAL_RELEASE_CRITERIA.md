# Arrival estimate: release criteria, fixed before the held-out results are read

Written 20 September 2026, before any held-out evaluation of an arrival estimator has been run.
The point of writing it first is that a threshold chosen after seeing the numbers is not a
threshold. These are not to be moved to fit a result; if a result misses them, the estimator
stays out of the passenger's view and runs in the background instead.

## What is being estimated

Minutes from *now* until the chosen bus reaches the passenger's chosen boarding stop, for a bus
matched to one pattern on route 15, still before the stop in the timetabled order, with an
accepted road shape. Nothing else: not "arrival" in any door-open sense, and not for buses on
unsettled branches, on other routes, or past the stop.

## What it is scored against

An **inferred stop passage**: the moment the bus's along-road position, projected onto the
accepted shape from its own reports, crossed the stop's offset. It is inferred from a report
before and a report after the stop, and carries an uncertainty of half the gap between them.
A passage is used for scoring only when that gap is at most 60 s (so the uncertainty is at most
30 s); wider gaps are counted but not scored. A report within 40 m of a stop is *not* by itself an
arrival, and is not used as one.

## Held-out protocol

- Split **by date**, never by journey within a day: all journeys on the fitting days fit; all
  journeys on later days test. The test days are the most recent ones held, so the test is "would
  this have worked yesterday".
- At each scoring moment, the estimator may use only reports with `observed_at` at or before that
  moment, the timetable in force on that day, and the accepted shape. Nothing from later.
- Scoring moments are taken at report times, so they are the moments a passenger could actually
  have been shown something.
- Errors are in minutes, signed (positive: the bus arrived later than estimated).

## Comparators, on the same passages and moments

1. **Scheduled time**: the named journey's departure plus the pattern's scheduled seconds to the
   stop. Available only where the journey is named.
2. **Delay-adjusted timetable**: scheduled time at the stop, shifted by the bus's observed delay
   at its most recent inferred passage. Available only where a passage behind the bus exists.
3. **Progress baseline** (the candidate): remaining road distance at the observed recent speed,
   plus a dwell per intermediate timetabled stop.

## Criteria for showing an estimate to passengers

All of the following, on the held-out days, at horizons of 2–10 minutes before the inferred
passage:

| | Threshold |
|---|---|
| Median absolute error | **≤ 1.5 min** |
| 80th percentile absolute error | **≤ 3.0 min** |
| Against the scheduled time | median absolute error at least **0.5 min lower** than scheduled, where both exist |
| Coverage | an estimate available at **≥ 50 %** of scoring moments where the bus is matched, before the stop, on an accepted shape |
| Scored passages | **≥ 150** on the held-out days, from **≥ 20 journeys**, so the medians are not a handful of buses |
| Weekday evidence | at least one held-out **weekday**; if none, the estimate is not released for weekdays and the page says so |

Failing any one keeps the estimate off the page. A range is shown rather than a point when the
80th-percentile error at that horizon exceeds 2 minutes.

## Withdrawal rules, regardless of the numbers

An estimate is withdrawn, and the card falls back to the scheduled time or to nothing, when:
the latest report is older than 150 s; the bus's last report is at or past the stop; the bus is
not on an accepted shape; its recent reports give no speed (too few, a jump, or backwards); or
the remaining route crosses a stretch the shape does not cover.

## What "independent of the drawing" means

The arrival calculation reads raw reports and the road shape. It does not read the drawn bus,
the eased speed, the estimate the map animates, or anything in `DRAWING`. Two passengers with
different frame rates get the same minutes.

## Amendment, 20 September 2026, after the development evaluation — applies only to data unseen then

The development evaluation (17–20 September, 44 journeys) showed the blended candidate meeting both
error thresholds **outbound** (median 1.29, p80 2.76 at 2–10 min) and missing them **inbound**
(1.86, 3.57). Per-direction release was not a criterion above, and adopting it *because* one
direction passed would be choosing the threshold to fit the result. So:

- **The criteria are applied per direction (per pattern) from here on**, exactly as the schedule
  anchor is, since the two directions are different roads with different behaviour.
- **This applies only to journeys and dates not seen by 20 September 2026.** The development set
  does not count towards any direction's release, whatever it shows.
- The floors hold per direction: ≥ 20 journeys and ≥ 150 scored passages of unseen data, with at
  least one weekday night among them.
- The nightly unit scores each night's snapshot with the frozen parameters
  (`scripts/arrival-params-frozen.json`, fixed from the development set) and appends the release-band
  errors per direction to `data/evaluation/arrival-nightly.jsonl`; `scripts/arrival-release-check.py`
  pools every night and writes `public/data/arrival-release.json`. **A direction is shown to
  passengers only when that file says it passed**, and the page reads nothing else.

Nothing else above is changed.

