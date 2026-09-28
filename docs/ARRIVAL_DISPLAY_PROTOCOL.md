# Arrival estimate: the display protocol, frozen before any confirmation day is scored

**Protocol `display-1`, frozen 28 September 2026 (evening, UTC).** It applies to the frozen model
`blended@9a626129f782` on the road shapes' stop mapping version 2 (`docs/STOP_MAPPING.md`).

The thresholds are unchanged from `docs/ARRIVAL_RELEASE_CRITERIA.md`. What changes is the set of moments
they are read on. Nothing in this document may change once the first confirmation day is scored; a change
restarts the confirmation from the day after it.

## Why

The criteria were first read by the actual minutes before a bus passed the stop, which only hindsight
knows. A page chooses what to show by its own predicted minutes, at the moment it shows them, from the
report it holds then.

On 28 September that difference turned outbound 15's pass (median 1.20 min) into a fail (1.57) on the
same days. So the owner asked for an evaluation frozen on the exact conditions under which a page would
show an estimate, including report age and predicted horizon. It must give signed errors, interval
coverage and results by independent journey, and keep the thresholds.

## The moments scored (`pipeline/arrival_display.py`)

Every scoreable inferred passage counts (a bus passing a stop, bracketed by reports at most 60 s apart,
first visit). So does every report of that journey before it, on a stop inside the service area.

**How long a page holds a report.** It holds it from the first live publication after the report's
retrieval, plus 10 s. The page polls every 20 s, so it waits 10 s on average. That was measured on
21–27 September: publications a median 20.0 s apart, reaching a report's first publication a median
12.7 s after retrieval. It holds the report until it holds the journey's next one, or until the report
is 150 s old (`staleS`), whichever comes first.

**A display moment is one tick of the page's 5-second clock while the report is held, at which the page
shows minutes.** That means all of these hold:
- the live matcher (`pipeline/match.py`, the served catalogue's rules) places the report on this one
  pattern, with its nearest stop before the passenger's;
- the report lies on the road before the stop;
- the frozen estimate from that report gives, measured from that tick, between 2 and 10 minutes.

The page's history of the journey is taken to be complete: it has been open for three minutes, which is
the condition under which it shows minutes at all.

**The error of a display moment** is the inferred passage less the estimated instant, in minutes. It is
positive when the bus came later than estimated, and is recorded to 0.05 min (3 s), inside the passages'
own ±10 s.

## What is measured, per direction

- **Accuracy:** the median and the 80th percentile of the absolute error over all display moments. Each
  moment is 5 s of what a passenger sees.
- **Bias:** the signed error's median, 10th and 90th percentiles, and the share of moments when the bus
  came later than estimated.
- **Against the timetable,** where its time exists: both errors' medians on the same moments.
- **Coverage:** of the 5-second moments when the bus is in fact 2–10 min from the stop and a page holds a
  fresh report on its road, the share at which minutes are shown. A bus left on an unsettled branch counts
  here, as a passenger left without minutes.
- **By independent journey:**
  - the journey is the unit;
  - the median and 80th percentile are given with 95% intervals from 1,000 resamples of whole journeys
    (seed 20260929);
  - each journey's own median is given too, with the share of journeys at or under 1.5 min.
- **Interval coverage:** the share of display moments whose actual passage falls within the frozen
  interval below.

## The interval a page would show, frozen here

A page may show the estimate as a range, and only this range. From the estimated minutes it runs from
the direction's 10th to its 90th percentile of signed error on the revision days, and each end is rounded
outwards to whole minutes (never below 1). **Rounding outwards can only widen the range.**

The claim is that the bus comes within the range on at least 80% of the moments it is shown. That claim
is **validated only by the confirmation days**.

| direction | interval, minutes of signed error | measured on |
|---|---|---|
| outbound 15 (`BNML:15:outbound:c9291c1aea`) | **−1.15 to +5.75** | 21–26 September (revision) |
| inbound 15 (`BNML:15:inbound:9c10700c6c`) | **−1.65 to +4.20** | 21–26 September (revision) |

The ±2.48 min of 28 September (the 80th-percentile absolute error) is not an interval and is withdrawn.

## Pass, per direction, on the confirmation days

Every one of these must hold:

| criterion | threshold (unchanged) |
|---|---|
| median absolute error | ≤ 1.5 min |
| 80th-percentile absolute error | ≤ 3.0 min |
| better than the timetable where both exist | by ≥ 0.5 min |
| coverage | ≥ 50% |
| journeys | ≥ 20 |
| passages | ≥ 150 |
| weekday days | ≥ 1 |
| interval coverage | ≥ 80%, the range's own claim |

The 95% intervals are reported beside every result, not gated. A pass whose interval crosses a threshold
is reported as fragile. No band narrower than 2–10 min may be chosen; the 2–5 min band of 28 September is
not an option.

## The data, kept apart

- **Revision: every service day up to 28 September.** Those days were seen while the approach was chosen
  or revised: the parameters were fitted on 11–14 and chosen on 17–20, and 21–27 were read on 28
  September. Their results are reported as revision results and decide nothing.
- **Confirmation: seven service days, 29 September to 5 October 2026.** No one had scored or looked at
  them when this was frozen.
  - The nightly unit scores each once, a day after it ends (`scripts/extract-arrival-inputs.py`, then
    `scripts/evaluate-arrival-display.py` in a process without DuckDB).
  - The verdict is read **once**, after 5 October is scored (the run of 6 October, about 03:12 UTC).
    Until then it is reported as collecting.
  - Nothing is released by a pass: the owner decides (`deploy/arrival-release-approval.json`).

## Revision results under this protocol, for the record (21–26 September)

These decide nothing and are not confirmation. The six full days held on the server's copy (five
weekdays) all fail the thresholds.

| | outbound 15 | inbound 15 |
|---|---|---|
| display moments (5 s each) | 1,391,897 | 33,272 |
| journeys, passages | 252, 10,829 | 249, 2,412 |
| **coverage** | 84.8% | **2.1%** |
| median absolute error (95% by journey) | **1.70** (1.60–1.80) | **1.65** (1.50–1.85) |
| 80th percentile (95%) | **4.00** (3.70–4.30) | **3.25** (3.00–3.60) |
| signed median; later than estimated | +1.40 min; 72.8% | +0.95 min; 64.3% |
| against the timetable where both exist | 1.10 against 2.75 | 0.95 against 3.25 |
| by journey: median of medians (20th–80th) | 1.50 (1.10–2.65) | 1.30 (0.65–3.05) |
| journeys with median ≤ 1.5 | 50.8% | 55.4% |

**What these say:**
- Outbound misses both error thresholds on the moments a page would show them, and more clearly than when
  read at the report's own moment (1.57, 3.79). The page shows reports already some seconds old, so it
  shows them further out.
- The estimate runs early: the bus came later than estimated at 73% of outbound moments.
- Inbound would almost never be shown. On weekdays its buses are left on an unsettled branch between its
  two variants, which serve the same destination, so a page shows no minutes for them.
- Neither direction can be released on this model. A confirmation that passes would be needed after any
  change to the model or the display, and the confirmation of this frozen model is collected all the same,
  for the record.
