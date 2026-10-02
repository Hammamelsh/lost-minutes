# Evidence: each claim, where it is implemented, what checks it, and what you can rerun

Checked against the repository at the commit that last changed this page; measurements are dated. **Fresh clone** says
whether the evidence can be reproduced from a clone alone (`yes`), needs a free download or key first (`setup`), or
exists only on the production server or this author's machine (`no`), in which case the record is cited instead.

## Data collection and history

| Claim | Implementation | Checked by | Fresh clone |
|---|---|---|---|
| One collector reads the BODS feed for everyone; a browser only ever reads published JSON | `pipeline/collect.py`; the page fetches `/data/*.json` (`app/page.tsx`) | `tests/test_live_collection.py` (the published state leaks no credential); CI's scan of the built site for credential values | yes |
| Every response is kept byte for byte, named by its SHA-256; identical bytes are a repeat and add nothing | `store_payload`, `repeat_payload` (`pipeline/collect.py`) | `test_a_repeated_payload_is_not_new_information` | yes |
| Observation identity is (operator, vehicle, route, direction, journey, observation ms); a new time is a new observation | `observation` primary key (`pipeline/warehouse.py`) | `tests/test_pipeline.py`, `test_stationary_bus_with_a_new_timestamp_is_a_new_observation` | yes |
| Same identity, different coordinates: both kept, neither published | `CLASSIFY_SQL`, `observation_conflict`, `v_publishable_observation` | `test_conflicting_coordinates_are_recorded_and_withheld_from_publication` | yes |
| Bad records are quarantined with a reason, never repaired | `parse_source` (`pipeline/core.py`) | `test_a_position_from_the_future_is_quarantined_with_its_reason`, `tests/test_pipeline.py` | yes |
| Positions over 900 s old are withheld and counted | `EXPIRY` (`pipeline/freshness.py`), `build_live` | `test_an_expired_position_is_withheld_and_counted_not_drawn`; on real archive bytes, `test_real_archive_payloads_flow_through_the_live_path_and_all_expire` | yes; the archive test needs `python3 -m pipeline.import_archive` first (setup) |
| One writer at a time | `SingleWriter` (`flock`) | `test_a_second_collector_refuses_to_run_while_one_holds_the_lock` | yes |
| A publication is validated before it replaces the last good file; a failure is recorded and the old file keeps serving | `publish_live`, `validate_live`, `atomic_json` | `test_the_published_state_is_validated_and_a_failure_keeps_the_previous_file`, `test_failed_validation_leaves_the_previous_publication_serving` | yes |
| A run records how it ended; a killed run is closed as abandoned by the next, with no cause guessed | `finish_run`, `close_abandoned_live_runs` | `test_a_run_left_running_is_closed_as_abandoned_by_the_next_collector`, the stop-signal tests | yes |
| The warehouse can be rebuilt from the captures | `pipeline/restore.py` | `tests/test_restore.py`; performed 18 Sep 2026 (60 captures → 25,232 observations), `PROJECT_CONTEXT.md` | tests yes; the performed restore no |

## Matching and timetables

| Claim | Implementation | Checked by | Fresh clone |
|---|---|---|---|
| A bus is placed on a timetable pattern only after operator, version, operating day and direction agree; otherwise refused with a reason | `pipeline/match.py` | `tests/test_matching.py` (no timetable, opposite direction, loops, two branches fitting equally) | yes |
| A failed or shrunken timetable download never replaces the last valid catalogue | `pipeline/patterns.py`, `collect_timetables` | `tests/test_timetable_catalogue.py`, `test_a_page_that_is_not_a_zip_is_kept_apart_not_stored_as_a_timetable` | yes |
| Coverage, 2 October 2026: 4 TfGM operator datasets, 206 observed services with a valid timetable, 585 patterns on 183 lines, 133 observed services with no timetable held | the server's nightly `pipeline.patterns build` | `coverage` in the served `/data/patterns.json` (built 02:43 UTC) | no: the clone's `patterns.json` is the 22 September build (576 patterns) |
| Journey planning uses timetables and published boards only, and says when a timetable is unchecked | `lib/connections.ts`, `lib/plan.ts` | `tests/connections.test.mjs`, `tests/planner-regression.test.mjs` (ten cases with an independent oracle) | yes |

## Measurements

| Claim | Basis | Rerun with | Fresh clone |
|---|---|---|---|
| Receipt-to-written median fell from 32.0 s (72 cycles) to 4.8 s (131 cycles) | the server's journal, 2 Oct 2026, 17:54–18:32 and 18:34–19:17 UTC; consecutive live windows, not a same-input benchmark (`docs/case-studies/02-latency-investigation.md`) | `scripts/stage-timings.py` over any journal window | no (the journal); the script yes |
| After the change, the buses published are exactly those of the whole history | windowed and whole-history queries compared on fixture data | `test_the_publication_reads_only_its_windows_and_publishes_the_same_buses` | yes |
| A report reached an emulated phone 51.9 s old at the median before, 19.2 s and 22.6 s after | one emulated phone on the served site, 20 minutes a run | `scripts/probes/delivery.mjs`, `scripts/delivery-summary.py` | no (outputs are git-ignored); the probe yes, against the live site |
| 12.8 million stored live observations | the published freshness measurement's sample count, about 17:45 UTC, 2 Oct 2026 | — | no |
| 630–658 vehicle activity records inside the service area per feed response | the collector's journal, 203 responses, 17:54–19:17 UTC, 2 Oct 2026 (a count per response, not buses in service and not a throughput) | `scripts/stage-timings.py` input lines (`inArea`) | no |
| The drawn bus stays on its road: frames more than 10 m from any road, for buses with no checked road, 10.0% → 0.82% and 9.1% → 1.4% on two recordings | every bus in a recording replayed through the drawing and measured against the map (1 Oct 2026) | `scripts/evaluate-fleet-playback.mjs --osm --streets` | no (the recordings are not committed) |

## Arrival estimate (withheld)

| Claim | Basis | Checked by | Fresh clone |
|---|---|---|---|
| Release criteria were written before any held-out result | `docs/ARRIVAL_RELEASE_CRITERIA.md` (20 Sep 2026) | Git history of that file | yes |
| The evaluation is frozen and pinned to the code that defines it | `pipeline/arrival_protocol.py` (`sourceDigest`) | `tests/test_arrival_protocol.py`, in CI | yes |
| The page's estimator gives the evaluator's answers | `lib/arrival.ts` | `tests/arrival.test.mjs` against `tests/fixtures/arrival-parity-sample.json` | yes |
| It fails the criteria on the moments a page would show it, and is off in both directions | revision days 21–26 Sep 2026 (`docs/ARRIVAL_DISPLAY_PROTOCOL.md`); the owner's decision | the nightly job's record on the server | no |

## The interface

| Claim | Basis | Checked by | Fresh clone |
|---|---|---|---|
| A chosen bus is never swapped for another | `lib/selection.ts` | `tests/selection.test.mjs`; `tests/browser/selection.spec.mjs` | setup (browser suite) |
| Every screen is a step the phone's Back undoes | `lib/nav.ts`, `components/follow-view.tsx` | `tests/nav.test.mjs`; `tests/browser/finding-the-way.spec.mjs` | setup |
| Search matches and places are chosen only as a passenger can: on screen, uncovered, tapped or clicked | `chooseOption` (`tests/browser/fixtures.mjs`) | the plan, connection, search, location and finding-the-way specs | setup |
| The browser suite: 534 checks; 483 passed, 51 skipped by design, 0 failed on `11eebf5` (2 Oct 2026; and on `95d1df6`, 1 Oct) | Chromium with SwiftShader (software WebGL), desktop and phone **emulation**; not run in CI | `scripts/setup-browser.sh` then `pnpm test:browser` (about 1.4 h) | setup |

**Physical devices.** No check in this repository was made on a phone in hand. `docs/PHYSICAL_DEVICE_CHECKLIST.md`
lists what only a phone can answer.

## What CI runs on every push (`.github/workflows/checks.yml`)

Types, lint, the Node tests and the static build, with a scan of the built site for credential values and
build-machine paths; the Python tests; the deployment scripts' shell syntax; and the systemd units
(`deploy/verify-units.sh --require`: an unknown directive fails, and so does a runner without `systemd-analyze`).
It does not run the browser suite, the real feed, the real walking router, or the Caddyfile check in
`deploy/validate.sh`.
