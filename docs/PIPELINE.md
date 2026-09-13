# The pipeline: inputs, history, publication

One local process, one DuckDB file. Raw bytes are preserved outside Git, every run is
recorded, and only a validated snapshot is ever served.

```
archive / feed  ->  data/raw/*.zip          bytes preserved, identified by SHA-256
                ->  raw_source              one row per distinct source content
                ->  source_processing        per-run checkpoint, written before the work
                ->  observation              one row per observation identity
                ->  v_publishable_observation  conflicted identities withheld
                ->  candidate snapshot       built by SQL, validated as a whole
                ->  public/data/replay.json  swapped in atomically, only if valid
                ->  public/data/operations.json  what actually happened
```

## Running it

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m pipeline.run import      # fetch what is missing, load, publish
.venv/bin/python -m pipeline.run reprocess   # reload the cached sources, then publish
.venv/bin/python -m pipeline.run publish     # rebuild and republish from the warehouse
.venv/bin/python -m pipeline.run status      # refresh and print the Operations payload
```

`import` is safe to run repeatedly and safe to interrupt. The frontend needs none of this:
it reads the two published JSON files, so the site runs with no Python and no API key.

**This is not continuous operation.** There is no scheduler, no service and no hosted
worker. The pipeline runs while this WSL process runs; when the machine sleeps, the
terminal closes or the environment stops, collection stops with it. Nothing in the
interface is labelled continuously live: a time-limited run is shown as a local run with its
end time, and the Operations view states the mode explicitly.

## Table grain and identifiers

| Table | One row per | Key |
| --- | --- | --- |
| `raw_source` | distinct raw response **content** | `source_sha256` |
| `pipeline_run` | pipeline run | `run_id` |
| `source_processing` | (run, source) attempt — the restart checkpoint | `(run_id, source_sha256)` |
| `observation` | accepted observation identity | `(operator, vehicle, route, direction, journey_ref, observed_at_ms)` |
| `observation_conflict` | identity/source pair that disagreed on coordinates | identity + `incoming_source` |
| `rejection` | (run, source, reason) | `(run_id, source_sha256, reason)` |
| `publication` | publication attempt, successful or not | `publication_id` |
| `validation_check` | named check on one publication | `(publication_id, check_name)` |
| `pattern_shape` | service pattern with a built road shape, accepted or not | `pattern_id` |

The observation identity is the whole design. Two reports sharing it are the same
observation; a **new timestamp is a different identity**, so a bus that reported again
without moving is preserved as a distinct observation. That is not evidence that the bus
stood still between samples — only that it reported twice.

Time is kept in three separate columns, never collapsed: `recorded_at_text` is the exact
source string with its original offset, `observed_at` is that instant, and `retrieved_at`
is when we fetched the file. `raw_source.captured_at` is when the archive published it.

## Reruns, conflicts and recovery

- **Reruns are idempotent.** Loading a source again inserts no analytical row. Proven on
  the real archive: the second import of the same eleven files reported 4,236 in-area
  records, 0 new observations and 4,236 repeats, leaving 3,496 stored.
- **Restart is safe.** `claim_source` writes the checkpoint *before* parsing, so a killed
  process leaves a `pending` row and a run still marked `running`. The next run reports
  that run as `interrupted`, names its unfinished sources and repeats the work.
- **Conflicts are deliberate, not silent.** When two sources give different coordinates
  for one identity, the first reading stays in `observation` as evidence, the disagreement
  is recorded in `observation_conflict`, and the identity is withheld from everything
  published. We do not pick a winner.
- **Backfill enriches, it never replaces.** An older source imported after a newer one
  extends the window backwards and adds observations. Validation refuses any candidate
  whose window end moves earlier than the snapshot already being served, or that does not
  account for the whole warehouse.

## Counts, and why they reconcile

Per-source facts are taken from the first successful pass over each distinct source, and
repeats are derived, so reprocessing cannot inflate a total. Every identity below is
computed twice from different tables and compared in the Operations view:

```
activitiesTotal    = activitiesInArea + outsideArea + rejectedRecords
activitiesInArea   = retainedObservations + repeatObservations + conflictingInputRows
publishableObservations = retainedObservations - suppressedObservations
observationsInServedFile + outsideCaptureWindow = publishableObservations
servedFileSha256   = recordedPublicationSha256
```

`outsideArea` counts real buses outside the selected box. They are not errors and not
rejections. `rejectedRecords` counts records refused by validation, by reason: a missing
operator or vehicle identity, or a coordinate or timestamp that could not be trusted. A
timestamp without an offset is always refused.

## Publication

A candidate is built from the warehouse, written to `data/published/`, and validated as a
whole before anything is swapped. Checks cover schema shape, window ordering, non-empty
journeys, point/quality reconciliation, source resolution for every point, coordinates
inside the declared bounds, the absence of any timetable claim, that the candidate accounts
for the full warehouse, and the two backfill guards above.

Only if every check passes is the file written to a temporary path, fsynced and moved into
place with `os.replace`, which is atomic: a reader sees the old file or the new one, never
half of either. **A failed candidate is kept as `data/published/rejected-*.json` and the
snapshot already being served is left exactly where it is.**

Processing success and publication success are recorded separately, in `pipeline_run.status`
and `publication.status`. A run can read every input perfectly and still publish nothing.
`operations.json` re-reads the served file from disk and compares its SHA-256 against the
recorded publication, so the metadata describes the snapshot actually being served rather
than the one we believe we wrote.

## Live collection

One shared collector reads the feed for everyone; no device contacts BODS. It is a single
writer by construction: `SingleWriter` holds an advisory `flock` on
`data/warehouse/collector.lock`, and a second collector refuses to start rather than
interleave writes.

Each poll is one row in `collection_cycle`, with an outcome that is never flattened:

| outcome | meaning |
| --- | --- |
| `succeeded` | new bytes, parsed and loaded |
| `repeat_payload` | the feed republished bytes we already hold; **no new information** |
| `http_error` | upstream returned a status; 401/403 stops collection |
| `transport_error` | the request never completed |
| `malformed` | bytes arrived but could not be parsed |

A repeated payload is the important one. It is a *successful request* that must not make
anything look newer: `lastPayloadChangeAt` only advances when the bytes actually change, and
the age on screen always comes from the observation, never from the request.

### How a run ended

Every run records why it ended in `pipeline_run.exit_reason`: `time_limit_reached`;
`signal:SIGINT`, `signal:SIGTERM` or `signal:SIGHUP` (status `interrupted`);
`credentials_rejected`; or `exception:<type>` (status `failed`). A live run also records
`planned_minutes` and `collector_kind` (`bounded_development` for `pipeline.collect
--minutes`). A process killed outright can write nothing. Once the next collector holds the
lock, it closes any live run still marked `running` as `interrupted`, with `error_class`
`AbandonedRun` and `exit_reason` `abandoned`, finishing at that run's last completed cycle. No
cause is inferred. The published live state carries the current run as
`collection.collector`.

### Freshness, measured

`pipeline/freshness.py` holds the policy and the evidence for it. Measured on the retained
sample (3,496 observations, 11 responses over ten minutes):

- publication delay p50 **30s**, p95 **40s** — an observation is already this old when the
  response carrying it is built, before we poll at all;
- report interval p50 60s, p95 73s, but **bounded by our own 45–75s sampling**, so it
  describes our cadence and not the operator's;
- **56 of 3,496 positions were more than ten minutes old on arrival**, 34 between one and 24
  hours, the worst **23.1 hours**.

That last line is why `EXPIRY` exists. A position older than 15 minutes is withheld from the
published state and counted, because otherwise a bus that last reported yesterday is drawn
as traffic today. Verified on real payloads: replaying three archived responses through the
live path loads 999 observations and withholds **all 392 vehicles** as expired.

### Source quality versus our failures

These are different things and are reported separately. `quarantined_record` holds records
the *source* gave us that we could not publish, with the raw field text kept verbatim —
never rounded, repaired or nudged into a plausible position:

`unreadable_coordinate`, `coordinate_out_of_range`, `timestamp_without_offset`,
`unreadable_timestamp`, `future_timestamp` (more than 120s ahead of retrieval, which is how
clock skew is handled), `missing_vehicle_identity`.

`collection_cycle.outcome` and `pipeline_run.status` hold *our* failures. A run can read
every input perfectly and still publish nothing.

### Out-of-order and conflicting reports

Observation identity includes the observation time, so a late-arriving older report is
stored, not dropped — it simply does not win. The published state takes the greatest
observation time per vehicle, whenever it arrived. Conflicting coordinates for one identity
are recorded in `observation_conflict` and the identity is withheld entirely.

### The published live state

`public/data/live.json` is small and is replaced atomically only after its own validation:
state is known, every position carries an observation time and is inside the declared area,
nothing older than expiry is published, every position is an observed fix, a `live` state
carries at least one position, and publication time never moves backwards. A failure leaves
the previous state serving. Each vehicle may carry a short trail of its own earlier reports: up
to six from the previous four minutes, each pointing to its source, and checked to be earlier
observed history (`trail_is_earlier_observed_history`). The page draws them as reports, never
as a new position. Nothing estimated is ever published. `public/data/config.json` names the live URL and poll interval,
so the state can be served from another origin without rebuilding the site.

## Road shapes and the motion evaluation

```bash
.venv/bin/python -m pipeline.shapes build --lines 15,250,256        # a bus route through each pattern's stops
.venv/bin/python -m pipeline.shapes publish                         # accepted shapes -> public/data/shapes/
.venv/bin/python -m pipeline.motion_data export --lines 15,250,256  # -> data/evaluation/motion-reports.json
node --experimental-strip-types --import ./tests/alias-loader.mjs scripts/evaluate-motion.mjs
.venv/bin/python -m pipeline.assess_matching --at 2026-09-13T13:16:22Z   # matching rules on one frozen moment
```

A shape is the FOSSGIS Valhalla bus route through a pattern's stops: at most 10 stops per
request, windows overlapping by one, NaPTAN bearings as headings. It is stored with its raw
responses (`data/raw/shapes`, gzipped and named by SHA-256) and its stop offsets. It is
accepted only when at least 30 matched reports lie within 35 m of it at the 95th percentile.
Otherwise it is kept with the reason and not published.

The evaluation replays the exported reports as the page would have received them: each
prediction uses only the reports fetched by that moment. It fits its settings on captures
before 12:50 UTC on 13 September and scores the later ones. A traceable row per prediction goes
to `data/evaluation/` (not in Git) and a summary to `public/data/motion-evaluation.json`.
Without that file the page draws no estimates.

## Credentials

Live capture needs a BODS key in `BODS_API_KEY`, in the environment only — never in Git,
never in the browser, never in a log. `redact_url` strips credential query parameters from
anything recorded, and error details are passed through it before being stored. No key is
required for the archive replay or for the website.
