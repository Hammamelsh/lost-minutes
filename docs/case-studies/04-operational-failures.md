# Case study 4: running it — failures found in production, reproduced, and fixed

The collector has run under systemd on one Hetzner server (2 vCPUs, 4 GB, Helsinki) since 20 September 2026, with a
nightly timetable rebuild, a nightly evaluation job and a five-minute health check. Uptime is not measured, and there
is no external alerting: a dead man's switch is prepared and off, because no alerting account is authorised. What
follows is what went wrong, how each fault was shown to be the cause, and what changed. Each item links to its dated
record.

| When | What happened | How it was shown | What changed |
|---|---|---|---|
| 20 Sep | The first deployment: the upload excluded `public/data` (an unanchored pattern), a fresh warehouse had no stops or patterns (0 of 307 buses matched), and a clean SIGTERM exited 130, so systemd called each nightly pause a failure | on the server; none was findable by local checks | anchored excludes, a first-run bootstrap in `deploy/install.sh`, exit 0 on a polite stop |
| 20 Sep | The health check fought the nightly rebuild: `systemctl is-active --quiet` exits 3 for a running one-shot unit, read as "down" | 4 collector restarts in 3 minutes, reproduced during a real rebuild | the guard reads the state `is-active` prints (`activating`), not its exit code; re-tested against a real rebuild; recovery from a SIGKILL measured at 25 s |
| 26 Sep | A replay run on the server put its scratch copy in `/tmp`, which is RAM there; the kernel killed the **collector** twice | the kernel log (12:36 and 12:37 UTC, about four cycles lost) | heavy work runs on this machine; on the server, login sessions are held to 900 MB and deliberate jobs go through `deploy/server-job.sh` (own memory ceiling, disk scratch) |
| 26–27 Sep | A deploy's stop landed inside DuckDB: during a query it came back as DuckDB's own "Query interrupted" (exit 1); during a batch insert it vanished, and systemd killed the collector 30 s later | `scripts/probes/stop-sweep.py` against a warehouse copy: 8 and 9 of 19 stops lost in the batch insert | the signal handler records the stop and the loop acts on it once DuckDB returns; 0 of 19 lost; two clean restarts on the server |
| 27–28 Sep | BODS answered a timetable download with its "Sorry, there is a problem" page under HTTP 200; it was stored as a snapshot and the next nightly rebuild failed on it | the stored bytes | a non-zip response is kept apart, never stored as a timetable; a rebuild that would shrink the catalogue badly is refused, and the last valid catalogue keeps serving |
| 28 Sep | The nightly evaluation had failed five nights unnoticed on a changed departure format | the job's own logs | each nightly job records its attempts (`pipeline/jobs.py`), and Operations shows last attempt, last success, failure and overdue |
| 29–30 Sep | Both nightly runs were recorded as "by hand" and Operations called them overdue: systemd 259 hands a timer's later firings the previous elapse | probe timers on the server | a run is judged by the timer's own `LastTriggerUSec`, and each record keeps what that judgement rested on |
| 29 Sep (open) | Four of 17 evaluation runs with DuckDB loaded failed at random, 0 of 12 without | 131 later trials in seven configurations reproduced nothing | **cause unresolved**; containment kept: the scoring runs in a process that does not load DuckDB (backlog 43) |
| 2 Oct | Two planned restarts to measure and fix publication latency (case study 2) | the collector's journal | both stopped as `interrupted` by SIGTERM, exited 0, and published again within 9 s; the last good file served meanwhile |

## Patterns that held

- **Reproduce before fixing.** Every fault above except the unresolved one was reproduced (a probe, a copy of the
  warehouse, a real rebuild) before the fix, and the fix was checked against the same reproduction.
- **Tell failures apart.** The health check distinguishes four states (collector down, publication stalled, upstream
  not live, upstream reports old) and restarts only the two that are ours.
- **Protect the one writer.** The kernel is told to choose the collector last among ordinary processes (`OOMScoreAdjust=-500`), the nightly rebuild
  stops it rather than competing for the warehouse (collection paused 2 min 33 s on 29 September), and server-side
  experiments are capped.
- **Record what happened, not what was meant to.** Runs, cycles, publications and nightly jobs each record their own
  outcome, and a record that cannot be written is said, never raised into the job.

## Boundaries

- One server, one disk, no off-server backup (a decision); the restore path is a manual command.
- No measured uptime or SLA; no external alerting.
- A deploy is an rsync of files, not an atomic switch; `deploy/rollback.sh` puts back exactly one previous release.

## Evidence

- Records: `docs/RELEASE.md` (20 September and later), `docs/MILESTONE_2026-09-26_PREVIEW_AND_JUMPS.md`,
  `docs/MILESTONE_2026-09-27_ROADS_MEMORY_REASONS.md`, `docs/MILESTONE_2026-09-28_RELIABILITY.md`,
  `docs/MILESTONE_2026-09-29_CLOSEOUT.md`, `docs/BACKLOG.md` (43, 46, 48).
- Code: `pipeline/collect.py` (stop handling), `pipeline/jobs.py`, `deploy/check-health.sh`, `deploy/server-job.sh`,
  `deploy/systemd/`, `deploy/validate.sh` (run on this machine before a deploy; CI checks only the shell scripts'
  syntax, and runs `systemd-analyze verify` without failing on it).
- Tests: `tests/test_live_collection.py` (a stop during a query, during matching, swallowed by the warehouse; exit
  codes), `tests/test_jobs.py`, `tests/test_timetable_catalogue.py` (a non-timetable snapshot skipped; a shrunken
  build refused).
- Not in a fresh clone: the server's journals, kernel logs and job records.
