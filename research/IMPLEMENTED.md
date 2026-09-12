# First working release

The initial release implements a real-data Manchester archive replay and a separate
bounded live-capture command. No continuous collection is currently deployed.

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

## Current sample
11 snapshots from 11 September 2026, approximately 07:00–07:10 UTC, selected at roughly
one-minute intervals. These are historic real observations, not a synthetic demo or a live
feed. The retained geographic sample covers [-2.30, 53.42, -2.18, 53.51].

The publisher's original archive may contain more frequent observations. The current
replay is deliberately sampled and cannot be used to estimate original feed cadence or
full journey coverage. It reconstructs positions by observation time, not a complete
record of what a real-time subscriber knew at that moment.

## Open work
- Authenticate the live BODS endpoint with the owner's key and verify its current filters.
- Match dated journey identities to the corresponding timetable snapshot and calendars.
- Validate stop passage inference and interval uncertainty before publishing delay metrics.
- Add durable scheduled collection, retention and freshness/coverage/calculation monitoring.
- Add journey-time comparison and roadworks context after the core measurements are valid.

## Verification scope
Python failure-case tests, replay-contract tests, TypeScript checking and production build
are run during delivery. No browser or supported WebMCP runtime was available under the
current Sites preview policy; WebMCP registration is feature-detected and optional.
