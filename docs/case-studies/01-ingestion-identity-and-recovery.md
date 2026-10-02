# Case study 1: what counts as one observation, where it came from, and what survives a crash

**Problem.** The Bus Open Data Service (BODS) publishes every bus's latest position as a SIRI-VM document. Polled every
20 seconds, most of each response repeats what the last one said; some positions are hours old; occasionally one
vehicle reports two different places for the same moment. A pipeline that appends rows, or keeps "the latest", will
double-count, draw yesterday's bus as traffic today, or pick a winner it cannot justify.

**Constraint.** One small server (2 vCPUs, 4 GB) running one collector, a DuckDB file as the warehouse, and a rule
for the whole project: nothing published may claim more than the data supports.

## Decisions, and why

| Decision | Implementation | Why this and not the obvious alternative |
|---|---|---|
| Keep every response's raw bytes, named by their SHA-256 | `store_payload` in `pipeline/collect.py`: gzip with a fixed mtime, written to a temporary name and renamed into place under `data/live-capture/positions/<sha256>.bin.gz` | Identical bytes are stored once, a file can be verified against its own name, and the warehouse can be rebuilt from them (`pipeline/restore.py`) |
| A byte-identical response is a *repeat*, not news | `repeat_payload` cycle outcome | A successful request must never make the data look newer than it is |
| One observation = (operator, vehicle, route, direction, journey reference, observation time in ms) | the `observation` primary key, `pipeline/warehouse.py` | A bus that reports again from the same spot at a new time is a new observation; it is *not* evidence that it stood still |
| Same identity, same coordinates: a repeat. Same identity, different coordinates: a **conflict** | `CLASSIFY_SQL` (`new`, `repeat`, `conflict_within_batch`, `conflict_with_stored`), `observation_conflict` | Both readings are kept and the identity is withheld from publication (`v_publishable_observation`); no winner is chosen |
| Questionable records are quarantined with a reason, verbatim | `parse_source` in `pipeline/core.py`, `quarantined_record` | Unreadable coordinates, timestamps without an offset or more than 120 s ahead of retrieval, and missing identities are kept as text, never repaired |
| Three clocks, never merged | `observed_at` (with the source's own string in `recorded_at_text`), `retrieved_at`, `publishedAt` | The age a passenger sees is always the observation's age |
| Positions older than 900 s are withheld and counted | `EXPIRY` in `pipeline/freshness.py` | The feed carries positions up to about a day old (23.1 hours in the archive sample) |
| One writer | `SingleWriter` (an exclusive, non-blocking `flock`) in `pipeline/collect.py` | A second collector refuses to start (`CollectorBusy`) rather than interleave writes |
| A publication is built, validated, then swapped into place | `publish_live` and `validate_live` in `pipeline/live.py`; `atomic_json` writes a temporary file and `os.replace`s it | A failed check leaves the last good file serving; the checks and their result are recorded in `publication` and `validation_check` |

## What survives what, precisely

- **A stop signal** (a deploy, the nightly rebuild): the run is recorded as `interrupted` with the signal, the lock is
  released, and the process exits 0. A stop that DuckDB swallows during a batch insert is recorded first and acted
  on afterwards (case study 4).
- **A kill** (SIGKILL, power, the kernel's OOM killer): no cause can be recorded. The next collector, holding the
  lock, closes the run as `interrupted`/`abandoned` at its last recorded cycle and guesses no cause. Verified twice:
  publishing again within 45 s (18 September, local) and 25 s (20 September, on the server).
- **Mid-load**: a load is a sequence of statements, not one transaction. Each source is checkpointed `pending`
  before its load and `succeeded` after, so an interrupted load is visible, and loading the same bytes again adds no
  row (the identity key and `ON CONFLICT DO NOTHING`). The archive importer resumes an interrupted run to the same
  result; the live collector does not replay an interrupted cycle's payload by itself, but the bytes are on disk.
- **A lost warehouse**: `pipeline/restore.py` reads preserved captures back, checking each file against the SHA-256
  in its name. Performed on 18 September: 60 captures → 25,232 observations, 1,396 vehicles, into an empty
  warehouse; a second run added nothing.
- **A lost server**: not covered. There is no off-server backup (a decision, not an oversight); the warehouse and
  the raw captures are on one disk. The 14-day capture retention job is installed but disabled, so every capture
  since 20 September is kept (47,485 files, 2.5 GB on 2 October).

## What it is not

- Not exactly-once delivery across processes, and not distributed: one process, one file, idempotent loading.
- An atomic replacement of **one** published file. `live.json`, `config.json` and `operations.json` are each replaced
  atomically and independently, and a deploy (`deploy/publish.sh`, rsync) is not atomic. The live publication is
  renamed into place without an `fsync` (the archive publisher does sync), so a reader never sees a half-written file,
  but the newest write may not survive a power cut.
- The writer lock is advisory (`flock`): it stops a second collector, not other programs.
- Conflicts are withheld, not resolved.

## Evidence

- Tests: `tests/test_pipeline.py` (identity, repeats, conflicts, rejected entities, credentials not logged),
  `tests/test_pipeline_history.py` (repeated import adds nothing, an interrupted run resumed to the same result,
  conflicts withheld, failed validation leaves the previous publication serving),
  `tests/test_live_collection.py` (repeat payloads, out-of-order reports, future timestamps quarantined, expired
  positions withheld, the lock, abandoned runs, stop signals), `tests/test_restore.py` (restoring twice doubles
  nothing; a capture with no stated time is refused).
- Records: `docs/PIPELINE.md` (table grain and recovery), `PROJECT_CONTEXT.md` ("Data definitions",
  18 September for the restore and the kill).
- Not in a fresh clone: the server's warehouse and captures; the restore was performed on this machine's copies.
