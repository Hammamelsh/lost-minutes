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
interface is labelled live, and the Operations view states the mode explicitly.

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

## Credentials

Live capture needs a BODS key in `BODS_API_KEY`, in the environment only — never in Git,
never in the browser, never in a log. `redact_url` strips credential query parameters from
anything recorded, and error details are passed through it before being stored. No key is
required for the archive replay or for the website.
