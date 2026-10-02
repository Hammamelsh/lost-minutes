# Case study 3: an arrival estimate that was built, evaluated, and kept off the page

**Question.** "When will this bus reach my stop?" is what a passenger wants. The BODS feed gives positions, not
predictions. External live-departure data exists: NextBuses, run by TransportAPI since May 2026, has a free evaluation
tier of 30 requests a day, and larger use is paid (`docs/LIVE_DEPARTURES_FEASIBILITY.md`). None is integrated. So the
project asked whether an estimate made here, from the buses' own reports, was good enough to show.

**Status: arrival predictions are disabled in both directions, by the owner's decision.** The page shows timetabled
departures labelled as such, and tracked buses by how many stops away their last report was, never as minutes.

## Criteria first (20 September 2026)

`docs/ARRIVAL_RELEASE_CRITERIA.md` was written before any held-out result was read, for horizons of 2–10 minutes
before the bus passes the stop:

| criterion | threshold |
|---|---|
| median absolute error | ≤ 1.5 min |
| 80th-percentile absolute error | ≤ 3.0 min |
| against the timetable, where both exist | at least 0.5 min better |
| coverage | an estimate at ≥ 50% of eligible moments |
| sample | ≥ 150 passages from ≥ 20 journeys, including a weekday |

Ground truth is an **inferred stop passage**: the moment a bus crossed a stop between two reports, timed by
interpolation, with half the gap as its uncertainty. It is not "a report within 40 m of the stop". Every evaluation
below is on route 15 (operator BNML), from this project's own captures: the development machine's before
20 September, the server's since.

## The evaluations, in order

| | data | read on | result | status |
|---|---|---|---|---|
| **1.** First held-out score (20 Sep) | fitted 11–14 Sep; scored once on 17–20 Sep; 63,397 moments, 1,436 passages | moments grouped by how far the bus truly was, 2–10 min | median and p80 over both thresholds | historical |
| **2.** Outbound pilot reading (28 Sep) | held-out days 21–27 Sep, 253 journeys | (a) grouped by how far the bus truly was; (b) the moments a page would show, chosen by the *predicted* 2–10 min | (a) median 1.20, p80 2.48 min: pass; (b) median 1.57, p80 3.79 min: fail. No-go | historical; superseded by protocol `display-1` |
| **3.** Protocol `display-1`, revision days | 21–26 Sep: outbound 252 journeys, 10,829 passages; inbound 249 journeys, 2,412 passages | the moments a page would show, every 5 s, as a page would compute them | outbound median 1.70 (95% by journey 1.60–1.80), p80 4.00 (3.70–4.30), coverage 84.8%; inbound median 1.65, p80 3.25, coverage 2.1%. Both fail | **current protocol**; revision days decide nothing |
| **4.** Protocol `display-1`, confirmation | 29 Sep–5 Oct, scored nightly | as 3 | not yet read; three of seven days scored by 2 October, all under the pinned digest | **current**; read once, after 6 October |

Reading 2 (b) and protocol `display-1` ask the same question, which moments a passenger would see; `display-1` also
reproduces the page's own timing and stop mapping, and is the one that counts. 6 October is a date for reading the
confirmation results, not a release date.

## Found on the way

- **Inbound 15's stops were numbered 14 out.** A route that starts outside the collected area had its stop offsets
  paired by list position, so the inbound evaluation was invalid. An earlier operational finding, that "inbound 15's
  timetable runs 15 minutes early", was an artefact of the same error: paired correctly, its first observed stops read
  +2.6 min. The finding was **withdrawn everywhere it stood as current**, with dated corrections.
- **Every stop is now named by an explicit, versioned mapping** (`docs/STOP_MAPPING.md`, 29 September): 560 shapes,
  15,960 stops within 15.7 m of the road at their offsets, 284 previously misread.
- **The page's estimator was made identical to the evaluated one** (28 September): on every held-out route-15
  journey, 2,078,969 answers agreed, 5 of them 1 ms apart.
- **`display-1` is pinned to its code.** It was frozen at 19:28 UTC on 28 September. Since 29 September,
  `pipeline/arrival_protocol.py` hashes its defining files: a day scored under any other digest is invalid, and an
  approval must cite a digest of the confirmation results, which exists only once they do.

## What this shows

- A threshold chosen after seeing the numbers is not a threshold; the criteria were never moved.
- The population matters as much as the model: the same estimator passes or fails depending on whether it is
  scored on the moments a passenger would actually see.
- A stop-numbering error produced a confident, wrong operational finding; it was traced and withdrawn rather than
  left in the record.
- Releasing nothing is a valid outcome, and it is the current one.

## Evidence

- Criteria and protocol: `docs/ARRIVAL_RELEASE_CRITERIA.md`, `docs/ARRIVAL_DISPLAY_PROTOCOL.md`.
- Records: `docs/MILESTONE_2026-09-28_ARRIVAL_PILOT.md`, `docs/MILESTONE_2026-09-29_CORRECTIONS.md`.
- Code: `pipeline/passages.py`, `pipeline/arrival_display.py`, `pipeline/arrival_protocol.py`,
  `pipeline/stop_mapping.py`, `lib/arrival.ts`, `scripts/evaluate-arrival-display.py`.
- Tests: `tests/test_passages.py`, `tests/test_arrival_display.py`, `tests/test_arrival_protocol.py` (the pin is
  checked in CI), `tests/test_arrival_release.py`, `tests/test_stop_mapping.py`, `tests/arrival.test.mjs` (the page's
  estimator held to the evaluator's answers).
- Not in a fresh clone: the server's nightly scores (`data/evaluation/arrival-display-nightly.jsonl`) and the
  warehouse snapshot they are computed from.
