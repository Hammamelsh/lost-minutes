# Review of the original first release

Subjective assessment, based on source inspection and the owner's screenshot review:
- Visual/product prototype: 7/10. Coherent styling and an excellent evidence concept, but
  sparse framing, limited visual hierarchy around an outcome, and no core measurement.
- Data engineering implementation: 4/10 as portfolio evidence of an operated system.
  There is real ingestion/normalization code; sustained operation and recovery are absent.
- Overall today: 6/10 against the intended portfolio ambition. Not an external benchmark.
No browser visual inspection was performed during this export. Do not call these scores
an accessibility certification or an assessment of runtime reliability.

## What the other review gets right
Keep Evidence as a first-class view, source fingerprints, separate capture/observation time,
and explicit unknown coverage. A fuller collection and modelling layer is the priority.
Fit the map to the corridor and make every visual encoding explainable. The product name
can stay; subtitle this stage as a bus movement observatory until lost time is measurable.
The private prototype URL is unsuitable as a public CV demo. Privacy is intentional access
control, not a parser defect; this separate export removes the hosting coupling.

## Findings checked against the files
1. Timestamp: the raw ZIP sirivm-20260911T071002.zip contains the exact element
   <RecordedAtTime>2026-09-11T07:09:37+00:00</RecordedAtTime>.
   Its SHA-256 matches the published source fingerprint. The parser retains the text and
   rejects timestamps lacking an offset. All 3,426 retained timestamp strings use +00:00.
   Europe/London correctly renders that example as 08:09:37. The copy was wrong, not this
   conversion. This does not independently prove the operator's clock was correct.
2. Counts: 4,236 inputs = 3,426 retained + 740 repeats + 70 outside the capture window.
   No conflicting keys occurred in this sample. 740 is 17.47% of inputs, not 18% of the
   accepted total. Never generalize this simple accounting to conflict cases without
   representing all records belonging to a conflict group.
3. Deduplication uses (operator, vehicle, route, direction, journeyRef, epoch timestamp),
   then compares latitude/longitude. It is not merely (VehicleRef, RecordedAtTime) or a
   payload hash. Raw source files remain the evidence if other fields change. Equivalent
   coordinates at different observation times survive. Repeated coordinates alone do not
   establish continuous stationarity between samples, or the cause of being stationary.
4. Eleven snapshots were deliberately selected roughly a minute apart (45–75s gaps).
   That is our selection cadence, not proof the upstream archive polls every minute.
   Repeat records are present across the inputs; the review's explanation about operator
   publication frequency is plausible but not established by these gaps alone.
5. Timeline bars were derived from currently visible vehicle counts at capture times,
   with an 8px baseline and a cap. They were not arbitrary, but the unlabeled/capped
   encoding was misleading. Removed from the portable copy pending a meaningful chart.
6. Specified opaque CSS pairs: sample body #aebfc9 on #142430 = 8.38:1; lime links #c6f36a
   on #142430 = 12.40:1; microcopy #94aab8 on #142430 = 6.57:1. These exceed 4.5:1.
   This checks those pairs only, not every rendered element, focus state or device.
7. Schedule-free does not mean validation-free. Traverse times, passage headways, speeds
   and stationary intervals require route/direction handling, GPS quality and temporal
   uncertainty. Distances between observations divided by elapsed time are not verified
   road speeds. Even a headway cannot be read as actual passenger waiting time directly.

## Data engineering that is already present
- Python archive importer: bounded public downloads and a reproducible file selection.
- Raw source cache and SHA-256 provenance.
- XML parsing, explicit timestamp checks, geographic filtering and missing-ID rejection.
- Compound deduplication, conflict suppression and atomic JSON publication.
- Runtime frontend data schema, last-known positions and staleness filtering.
- A separate bounded live collector with redaction/backoff and schedule capture code.
  It has not been exercised against authenticated BODS, scheduled or hosted continuously.
- Eight Python and five TypeScript tests from the initial implementation.

## The data engineering still missing
Durable continuous capture; exercised scheduling; restart/backfill guarantees; immutable
run history and quality tables; queryable accumulating history; SQL/dbt models; measured
monitoring/alerting; timetable validation; passage inference; published measurement history.
Do not add Spark to this tiny sample for appearance. Add tools when workload needs them.

## Visual direction: a Manchester transport observatory
Think of a focused city operations display with editorial clarity.
- The map occupies most of the useful viewport and opens fitted to the chosen corridor.
- A restrained tilted overview is optional later; keep a direct 2D reading mode.
- Clicking a vehicle follows its last recorded observations and reveals one clear story.
- Lime means selection/actions. A separate labelled, accessible sequential ramp encodes
  the chosen measured quantity. Use grey/patterns for unknowns, not a good-performance colour.
- A time-distance chart beside the map makes buses bunching or spreading apart visible,
  once route progress is validated. The geometry of the chart should do the storytelling.
- One measurement card includes its definition, interval/uncertainty and sample coverage.
- Operations displays actual pipeline state; Evidence traces a value back to its source.
- Transitions and subtle trails support orientation; no fake incidents, random density
  bars, scanning effects presented as data, or animated interpolations presented as GPS fixes.
- A later 30-second recorded demo can follow one bus, reveal a measured change, and open
  its lineage. That gives LinkedIn viewers both visual interest and something substantive.

## Export changes
The original source archive is unchanged. The standalone working copy uses Next.js static
export, removes Sites runtime/authentication files and metadata, corrects timestamp copy,
explains deduplication and removes misleading bars. Package versions and the lockfile remain
as originally installed; unused starter dependencies can be pruned after local verification.
Raw archive ZIPs, node_modules and generated build output are excluded. Normalized public
bus data and road geometry are included, so running the UI requires no BODS key.

Sources: retained raw ZIPs and source files; exact checks in research/review-checks.json.
Next.js static export: https://nextjs.org/docs/app/guides/static-exports
Claude Code in VS Code: https://code.claude.com/docs/en/vs-code
