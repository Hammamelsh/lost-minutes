# Implementation record

A real-data Manchester archive replay, a restartable local pipeline with a queryable
history, and an Operations view built from that history. No continuous collection is
deployed: the pipeline runs in one local WSL process and stops when that process stops.

## Implemented
- A read-only, responsive map built from an OpenStreetMap road extract.
- Operator/route and direction filters; selectable vehicle journey tracks.
- Play, pause, restart and scrub controls over an approximately ten-minute recording.
- Discrete last-observed markers; source-age display; old markers expire after two minutes.
- An evidence view with original observation sequence, archive URL and source SHA-256.
- Python source capture, gzip preservation, request-key redaction and bounded retries.
- Namespace-aware SIRI-VM parsing, timezone checks, non-finite coordinate rejection,
  repeated-observation deduplication and conflict suppression.
- Runtime validation of the frontend dataset.

## Implemented in the pipeline milestone (12 September 2026)
- Raw responses preserved outside Git and identified by SHA-256 in `raw_source`.
- A DuckDB history with a stated grain per table: sources, runs, per-source processing
  attempts, observations, conflicts, rejections, publications and named validation checks.
- Observation identity as the primary key, so a repeated report inserts nothing and a new
  timestamp on unchanged coordinates is preserved as its own observation.
- Observation time, retrieval time and upstream capture time kept in separate columns.
- Per-source checkpoints written before the work, so an interrupted run is visible
  afterwards, is marked `interrupted`, names its unfinished sources and is repeated safely.
- Conflicting coordinates recorded with both readings and withheld from publication rather
  than resolved by guesswork.
- Validate-then-swap publication with `os.replace`, a rejected-candidate archive, and
  guards that stop a partial rerun or an older backfill replacing the served snapshot.
- Processing outcome and publication outcome recorded separately.
- Rerun-stable totals with five reconciliation identities checked in the interface,
  including the served file's SHA-256 against the recorded publication.
- An Operations tab beside Explore and Evidence, populated only from those records.

## Implemented on 13 September 2026
- Bounded live collection with the owner's key; each run records why it ended, and runs left
  `running` by an abrupt stop are closed as abandoned, with no cause guessed.
- A stop-first passenger view and an original map style with a 3D ride-along, and
  identity-first timetable matching (`docs/LOCAL_VERIFICATION.md`, "Passenger redesign").
- Walking directions to the boarding point from a real pedestrian router, asked for only when
  the passenger chooses to.
- Estimated movement between reports on routes 15, 250 and 256, along validated road shapes,
  scored on held-out captures against the last report itself. Every requirement and its
  evidence is in `docs/MILESTONE_CHECKLIST.md`.

## Current sample
11 snapshots from 11 September 2026, approximately 07:00–07:10 UTC, selected at roughly
one-minute intervals. These are historic real observations, not a synthetic demo or a live
feed. The retained geographic sample covers [-2.30, 53.42, -2.18, 53.51].

The publisher's original archive may contain more frequent observations. The current
replay is deliberately sampled and cannot be used to estimate original feed cadence or
full journey coverage. It reconstructs positions by observation time, not a complete
record of what a real-time subscriber knew at that moment.

## Verified behaviours
Seven pipeline tests use controlled SIRI-VM fixtures and a throwaway warehouse: repeated
import, interruption and restart, conflicting coordinates, a stationary bus with a new
timestamp, late/backfilled data, a failed validation that leaves the previous publication
serving, and the separation of processing from publication outcome. The end-to-end
demonstration uses the real archived inputs: a second import of the same eleven files
reported 4,236 in-area records, 0 new observations and 4,236 repeats.

## Open work
- Schedule collection somewhere that keeps running when this machine does not.
- Match dated journey identities to the corresponding timetable snapshot and calendars.
- Validate stop passage inference and interval uncertainty before publishing delay metrics.
- Add durable scheduled collection, retention and freshness/coverage/calculation monitoring.
- Add journey-time comparison and roadworks context after the core measurements are valid.

## Verification scope
Python parser and pipeline-history tests, replay and operations contract tests, TypeScript
checking, lint and the production build are run during delivery, and the interface is
inspected in a browser. Automated success is not a visual-quality or accessibility
judgement. WebMCP registration is feature-detected and optional.
