# 29 September 2026, afternoon: a bounded reliability close-out

The owner accepted the corrections pass and kept arrival predictions disabled in both directions. They asked
for four things, then a stop:
1. the daytime shared-link check with a representative fleet;
2. backlog 43 investigated without a version choice put to them;
3. both memory figures visible, and a check for OOM events or memory pressure;
4. confirmation results unable to approve anything, and any change to the model or the display a new version
   with an untouched window.

**6 October is when the confirmation results are read, not a release date.** Nothing is enabled.

## 1. The daytime shared-link check

The fault of 28 September was a shared bus link left saying "Drawing the map…" over a drawn map, 6 times in 21
(backlog 44, fixed in `af9a959`). It was checked on the served site at 15:06 London time with 602 buses in the
publication, 493 of them fresh. REAL data, Chromium phone emulation, `scripts/probes/paint-compare.mjs`.

| bus link | loads | drawn in | not drawn within 10 s | note up at 5 s |
|---|---|---|---|---|
| 42 outbound | 12 | 2.1–2.8 s | 0 | 0 |
| 192 outbound | 12 | 2.1–2.9 s | 0 | 0 |
| 142 outbound | 12 | 2.1–3.1 s | 0 | 0 |
| 15 outbound | 12 | 2.3–3.1 s | 0 | 0 |

No failure, so nothing to fix.

## 2. Backlog 43: DuckDB and the scoring in one process

**The claim under test.** On 28 September the display scoring, run in the same process as DuckDB, failed at
random: 4 of 17 runs, with a builtin not found, objects of the wrong type, and a segmentation fault. With DuckDB
never loaded, 0 of 12 failed. The evaluation has run in two processes since.

**Reproduced on a fixed input, one trial per fresh process** (`scripts/probes/duckdb-inprocess.py`). Each trial's
result is judged by its exit and by the SHA-256 of what it scored, so a silent wrong answer counts as a failure too.
- **The input:**
  - the warehouse copy the failures ran on, its SHA-256 `8df90238…` as held since 20:37 UTC on 28 September
    (the evening's later runs rewrote it, so its state at 19:09 cannot be recovered);
  - the extracted inputs `339e1710…`, the passages the evaluator then read, the catalogue `31d5453e…`, and the
    frozen parameters `9a626129…`;
  - seven service days, 20–26 September.
- **The code that failed:** the single-process evaluator exactly as it ran at 19:09 UTC, recovered from the session
  record (`scripts/probes/evaluate-arrival-display-inprocess-2026-09-28.py`).
- **The versions:** this machine and the server run the same interpreter, CPython 3.14.4 (Ubuntu's build of
  20 August, GCC 15.2.0, GIL on, JIT off), DuckDB 1.5.5 and glibc 2.43. This machine runs the WSL2 6.6 kernel on
  32 logical CPUs, the server the 7.0 kernel on 2.

| arrangement | runtime | condition | trials | failed | wrong result |
|---|---|---|---|---|---|
| the failing single-process evaluator | 3.14.4, DuckDB 1.5.5 | as run | 40 | 0 | 0 |
| the same | 3.14.4, DuckDB 1.5.5 | the debug allocator (`PYTHONMALLOC=debug`), as when it failed | 20 | 0 | 0 |
| the same | 3.14.4, DuckDB 1.5.5 | 16 busy loops saturating half the CPUs | 20 | 0 | 0 |
| the same | 3.14.4, DuckDB **1.5.6** (28 September) | as run | 10 | 0 | 0 |
| the same | **3.12.14** (uv), DuckDB 1.5.5 | as run | 10 | 0 | 0 |
| today's extraction then scoring, in one process | 3.14.4, DuckDB 1.5.5 | as run | 20 | 0 | 0 |
| split, DuckDB never loaded (production) | 3.14.4, DuckDB 1.5.5 | as run | 11 | 0 | 0 |

All 131 scored the same, byte for byte, on every runtime.

**What the evidence says.**
- **Not reproduced.** The code, the interpreter, the extension and the input that failed on 28 September, run
  131 times, did not fail once, loaded or contended.
- **The association was weak in itself.** 4 failures in 17 with DuckDB against 0 in 12 without would fall that
  way by chance about 1 time in 10 (p ≈ 0.10).
- **So DuckDB is implicated by association on one evening, not shown to be the cause.** The symptoms (a builtin
  not found, a wrong type, a segmentation fault) are those of memory corrupted by native code. Which code did it,
  and what that evening had that today does not, is unknown.
- **DuckDB 1.5.6's release notes** have nothing on Python 3.14, reference counting or memory: its Python notes
  name a numpy deprecation and an alias.

**Decided: no dependency or interpreter change**, because there is no failure to verify a fix against. **The
containment stays.** Extraction and scoring stay in separate processes, the scoring behind a guard that refuses
DuckDB, at a nightly cost of 2.0 s and 21.3 s.

**The operational risk that remains.** Other jobs still compute with DuckDB loaded: the collector, the rebuild,
the passage audit and the schedule anchor. A crash in any of them fails loudly:
- it is recorded in its job's record and shown in Operations;
- the collector's publication is validated before it is swapped in;
- the rebuild refuses a catalogue much smaller than the last.

What would not be caught is a silent wrong value in a job that does not crash. None has been seen, their repeated
outputs have matched, and the anchor's verdict reaches the planners' timing. It is not excluded.

The probe is the check to run before any Python or DuckDB change (backlog 43).

## 3. Memory: the whole job and its largest process, and what the kernel did

**What the figures are.**
- **599 MB** (the rebuild of 29 September) is the largest resident set of any single process of its steps
  (`pipeline/jobs.py step`). Here that was the timetable build. It is not the job's use: steps run one after
  another, and a step's other processes are not counted in it.
- **The whole job**, every process and the page cache it filled, reached its 1,500 MB ceiling as the 1.15 GB
  warehouse was copied.
- **The evaluation:** the whole job peaked at 598 MB, its largest single process at 418 MB.
- The records that had given the resident figure alone are corrected: the corrections record, the release
  notes, the project context.

**OOM events and memory pressure, from the server's journals since 20 September** (read only):
- **None in the rebuild or the evaluation**, the scheduled runs of 29 September included: both succeeded, and
  no kernel OOM message touches them.
- **The OOM kills in the journal are the two already on record:**
  - the collector, twice, on 26 September at 12:36 and 12:37 UTC: the replay run with its scratch in RAM
    (`docs/MILESTONE_2026-09-26_PREVIEW_AND_JUMPS.md`);
  - the deliberate ceiling tests of 27 September, 01:17 and 01:53 UTC.
- **The server has no swap**, and the whole machine's memory pressure was low when read (PSI 0.06% over five
  minutes).
- **What could not be checked:** how much the jobs waited on memory during those runs. A nightly unit's cgroup,
  and its counters with it, is gone when the unit stops, and nothing recorded them. So: no OOM, and pressure
  during those runs unknown.

**Now recorded.** At the end of every run, `pipeline/jobs.py` reads from the unit's own cgroup, beside the peak it
already read:
- `memory.events`: how often it was held at its ceiling, its OOM events, and its OOM kills;
- `memory.pressure`: seconds any of its processes waited on memory, and seconds all of them did.

Operations names both figures and never merges them, as a person reads it: *"Whole job 1,500 MB of its
1,500 MB ceiling (100%), page cache included; largest single process 599 MB resident (40%) · last attempt;
held at its ceiling 37 times, the kernel taking back page cache, no OOM, waited on memory 0.4 s"* (the fixture of
`tests/browser/operations-jobs.spec.mjs`).
- "Close to its ceiling" is judged on the process figure where it is known.
- An OOM is always said: *"out of memory: 1 process killed"*.

The runs of 30 September, 02:44 and 03:12 UTC, are the first to record it.

## 4. Results approve nothing; a change is a new version

The check already refused a bare direction and released only an exact scope. Two gaps remained:
- **Early approval:** an approval written ahead of the results would have released a pass the moment it came.
- **Silent change:** nothing stopped the model or the display changing under the same name, and a changed
  version could re-score days already seen.

Both are closed (`pipeline/arrival_protocol.py`):
- **A version is its code.** `display-1` pins its model, stop mapping, window, and a SHA-256 of the files that
  define the model and what a page would show:
  - the frozen parameters and the estimator;
  - the scoring and the protocol;
  - the live match, the passages and the stop mapping;
  - the page's `lib/arrival.ts`.

  None of those files had changed since `a5e43cc`, deployed before the window's first day began, until this
  close-out gave the scoring its own record (the digest, and a record per version). That was before any window
  day was scored, and the digest is pinned after it. `tests/test_arrival_protocol.py` fails in CI on any change to them under the same name, and on any window that
  opens before its version was frozen or before an earlier window ends.
- **The window is untouched.** The nightly scoring:
  - records the digest of the code it ran;
  - keeps a day once per version, never replacing another version's record;
  - scores a confirmation day once.

  The release check calls the verdict invalid, and proposes nothing, in either case:
  - the code here is not the frozen code;
  - a day of the window was scored under anything else.
- **Results approve nothing.** A passing direction is proposed with `confirmationDigest`, the SHA-256 of its
  window's own results. The approval file must cite it, field for field with the scope. The digest exists only
  once the results do, so an approval written beforehand, guessed, or citing other results approves nothing.
  The approval file's own note says so, and that 6 October is a results date.
- **Held by:** `tests/test_arrival_release.py` (10, three new) and `tests/test_arrival_protocol.py` (5, new).
- **Run on the server's own nightly file (16 days):** the same revision figures as the served verdict, nothing
  invalid, nothing proposed.
- **Nothing that decides a number changed:** with the scoring's new record, the fixed revision input scores to
  the same digest as before, the new field aside. That held in 13 of 13 trials run after the change (section 2).

## 5. Verification

Chromium emulation, fixtures, the served site and the server's own records; nothing on a phone in hand.

- **Suites:**
  - Node 320;
  - Python 185, of them 9 new: the release check 3, the frozen versions 5, and the trigger 1;
  - typecheck, lint (no errors, the same 16 warnings) and `deploy/validate.sh`.
- **The full browser gate on `9d77718`'s build:** 462 passed, 50 skipped by design, none failed (1.3 h).
  `b507302` changes only `pipeline/jobs.py` and its test.
- **Deployed as `9d77718` (16:16 UTC), then `b507302` (16:20 UTC)**, with `9d77718` kept for rollback:
  - each served build was byte-identical to its local build (9 of 9 scripts and stylesheets, and the page);
  - the deployed code was the gated build's but for its build stamp, whose swap matched the gated chunk's
    SHA-256;
  - `/preview/` returned 401;
  - the collector was untouched (PID 309167, since the nightly rebuild restarted it at 02:47:01 UTC).
- **On the server, the deployed defining files' digest is the pinned one** (`c44d743a…`), with nothing invalid.
- **Two evaluation runs by hand** (16:17 and 16:21 UTC) succeeded, with nothing new to score.
  - The verdict: nothing invalid, nothing proposed, 0 of 7 confirmation days.
  - The first account of the kernel's side: the whole job 578 MB and its largest process 417 MB. It was never
    held at its ceiling, had no OOM, and never waited on memory.

**Found on the way, fixed: a run started by hand was recorded as the timer's.**
- systemd 259 keeps a unit's last activation details, so the 16:17 run carried `TRIGGER_UNIT` naming the timer
  and was recorded as scheduled. That moved "last scheduled run" to 16:17, which could have hidden a missed night.
- A run now counts as the timer's only if the timer elapsed in the ten minutes before it (`b507302`, with a
  test). The 16:21 run recorded as manual.
- The record's last scheduled run is restored to the timer's 03:12:02 UTC, with a note in the record saying why.

**Next unattended runs:** 30 September, about 02:43 and 03:11 UTC. They are the first to score a confirmation day
(29 September) with the code's digest, and the first scheduled runs to record the kernel's account of memory.

## A five-minute check on a phone

On mobile data, in daylight, on the served site (also in `docs/PHYSICAL_DEVICE_CHECKLIST.md`):
1. **A shared bus link.** Choose a moving bus, Share, and open the link in a new tab. The map is drawn within
   about 3 s, with no "Drawing the map…" note left over it.
2. **The ride.** Ride along for a minute, with no hops. Drag, then Return to bus: it glides back.
3. **The front view**, where offered. It settles into the street without a lurch at the end of its glide.
   Then Outside view.
4. **The sheet.** Drag it to full and back. Search with the keyboard open: the matches sit above it. Turn the
   phone on its side and back.
5. **Operations.** Both nightly jobs read *scheduled · succeeded*, each with its whole job and its largest
   process. Back returns you to your bus.
