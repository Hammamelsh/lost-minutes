# Case study 3: an arrival estimate that was built, evaluated, and kept off the page

**Question.** "When will this bus reach my stop?" is what a passenger wants. The feed gives positions, not
predictions, and the only live departure products need an account and a fee (`docs/DEPARTURE_DATA.md`). So the
question was whether an estimate made here from the reports was good enough to show.

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
interpolation, with half the gap as its uncertainty. It is not "a report within 40 m of the stop".

## What happened

1. **20 September.** Fitted on 11–14 September, scored once on 17–20 September (63,397 moments, 1,436 passages):
   median and p80 failed at 2–10 minutes. Nothing was shown.
2. **28 September.** The owner authorised a pilot for outbound route 15 on four conditions. On held-out days it met
   the criteria (median 1.20 min, p80 2.48 min, 253 journeys) **when moments were grouped by how far the bus truly
   was**. Read on the moments a page would actually show (the *predicted* 2–10 minutes) it was median 1.57 and p80
   3.79: over both thresholds. **No-go.** The page's estimator was first made identical to the evaluated one: on
   every held-out route-15 journey, 2,078,969 answers agreed (5 of them 1 ms apart).
3. **Found on the way: inbound 15's stops were numbered 14 out.** A route that starts outside the collected area had
   its stop offsets paired by list position. The evaluation of that direction was invalid, and an earlier finding
   that "inbound 15's timetable runs 15 minutes early" was an artefact of the same error: paired correctly, its first
   observed stops read +2.6 min. The finding was **withdrawn everywhere it stood as current**, with dated corrections.
4. **29 September.** Every stop is named by an explicit, versioned stop mapping (`docs/STOP_MAPPING.md`; 560 shapes,
   15,960 stops within 15.7 m of the road at their offsets, 284 previously misread). The evaluation was frozen as
   protocol `display-1` on the moments a page would show, with signed errors, interval coverage and results by
   journey, and **pinned to the code that defines it**: `pipeline/arrival_protocol.py` hashes the defining files, a
   day scored under any other digest is invalid, and an approval must cite a digest that exists only once the
   results do. On the revision days (21–26 September) both directions fail: outbound median 1.70, p80 4.00, the bus
   later than estimated at 72.8% of moments; inbound shown at only 2.1% of moments.
5. **Confirmation, 29 September–5 October**, collected nightly and read once after 6 October. Three days scored so
   far, all under the pinned digest. 6 October is a date for reading results, not a release date.

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
