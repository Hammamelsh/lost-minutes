# 27 September 2026: the front view's roads at their width, the server's memory held, and every repositioning's reason made true

The owner's brief had four parts:
1. fix the half-width roads, their conversion and every affected caller, and show comparable frames;
2. close the server-memory gap, and say which jobs were held and whether manual jobs were;
3. explain the marked 131 m repositioning from the reports, fix any drawing defect, and make the
   correction's words reachable on touch;
4. stop the obsolete preview tunnel once nothing depends on it.

Photographic imagery stays disabled and its public switch off. No Google key exists, and nothing was
bought, enabled or sent to a provider. The browser checks ran in Chromium with SwiftShader, on fixtures,
recorded publications or the served site; the memory and collector checks ran on the server itself.
Nothing was tried on a phone in hand, and no user test was run.

## What a passenger sees differently

- **The front view's roads are as wide as they are said to be**, twice what they were: a secondary road
  7.5 m, with a 0.75 m kerb and a 1.45 m footway each side.
- **A bus moved rather than followed says why, truly.** The reasons are *too long passed between its
  reports*, *it is too far to have been followed*, *its reports arrived late* and, where the passenger
  asked for it, *you chose to see reported positions only*.
- **On a touch screen, a tap on a repositioned bus's dashed trace chooses that bus**, and its card says
  why on a line of its own.
- **A bus back from a long silence stands where it was drawn** until the drawing reaches its new report,
  and only then is moved. The deployed code moved it within seconds of the report arriving, ahead of the
  moment the drawing showed.

## 1. The roads at their width

**Cause.** `components/city-map.tsx` turned metres into pixels with `156543.03 × cos(lat)` metres per
pixel at zoom 0. That is the scale of a 256-pixel tile. MapLibre's world is 512 pixels at zoom 0, so the
true figure is 78,271.517 × cos(lat), and every width in the front view was drawn at half its value:
- the carriageway of each class (`ROAD_METRES`);
- its kerb (the casing);
- the footway (`lm-front-pavement`);
- the centre line.

**Fix.** One function, `metresPerPixel(zoom, lat)` in `lib/scale.ts`, used by every caller:
- the front view's widths (`metresWide`);
- the camera-eye diagnostic, `data-eye`, which had the right figure written out by hand and now shares
  the function;
- the served-site probe that first mismeasured the fleet's jumps (`outputs/`, not in Git), corrected to
  the same figure. `scripts/probes/fleet-replay.mjs` measures from drawn positions over measured time
  and never used a pixel scale.

The browser checks that compute a scale inside the page (`search.spec`, `selection.spec`, `fleet.spec`)
already used the 512-pixel figure. A search of the repository finds no other conversion.

**Checked against the map itself.** MapLibre 6.7 does not expose its transform at runtime, so the check
compares what it draws:
- `tests/scale.test.mjs`: 78,271.517 m at zoom 0 on the equator, 1.4215 m at zoom 15 in Manchester.
- `fleet.spec` *the metres a pixel covers are the map's own*: on a flat map under reduced motion, buses
  standing at their reports at least 150 m apart are as far apart on screen, in metres, as their
  reports, to within 2%. The 256-pixel figure would read double. It passes on both profiles.

**Before and after.** The same ride on the same fixture road, captured by `scripts/probes/front-view.mjs`
on the deployed build (`4d1f586`) and on this one, desktop and phone, day. At each second the bus stood
within 0–4 m of the same place on the road in both runs, so the frames compare like for like. Full sets
are in `outputs/probes/front-view/roads-before/`, `roads-after/` and `roads-compare/` (not in Git).

![The ride-along's front view on the same stretch of Barton Road, before and after, side by side. On
the left the carriageway is a narrow strip with the dashed centre line near its middle; on the right it
is about twice as wide, with the kerb and footway at their stated widths and the centre line down its
middle. The ride card, the controls and the buildings are the same in both.](images/front-view-roads-before-after.png)

**One detail seen in the new frames, left as it is.** At one place on the fixture road the kerb's outer
edge steps in by about 2.5 CSS px for a metre or so, then out again. The step moves with the ground from
frame to frame, so it is a place on the map, and it only shows now that the kerb has its real width.
What it is not:
- a vector-tile edge: none is crossed on that stretch of road;
- a change of road class: the kerb's inner edge runs straight through it.

It is most likely a joint between two of the road's OpenStreetMap features. The cause is not
established. It is cosmetic and recorded in backlog 36.

## 2. The server's memory

**Which jobs had an enforced limit**, read on the server on 26 September at about 23:35 UTC:

| What runs | Limit before | Now |
|---|---|---|
| The collector | MemoryHigh 1800M, MemoryMax 2400M; out-of-memory priority 0 | the same ceiling, and `OOMScoreAdjust=-500`, so a machine-wide shortage takes something else first |
| The nightly refresh | MemoryMax 1500M (it runs while the collector is stopped) | unchanged |
| The arrival evaluation | MemoryMax 1500M | the same, and `OOMScoreAdjust=300`: the first to go |
| **Anything run from a login, sudo included** | **none**: the slice's `memory.max` read `max` | MemoryMax 900M per user, across all of that user's sessions; a runaway is killed at it |
| A deliberate diagnostic job | not possible | `deploy/server-job.sh`: its own scope, 400M by default, 800M at most |

**Were manual diagnostic jobs covered? No.** A command typed over ssh, the replay that took the collector
down on 26 September among them, ran with no ceiling at all. It is covered now in two ways:
- **Every login is held.** A drop-in for every `user-UID.slice` (`deploy/systemd/user-.slice.d/`) caps
  everything a login runs. That includes `sudo`, which stays in the session.
- **A deliberate job gets its own ceiling** through `deploy/server-job.sh`, which:
  - runs it in a transient scope with `MemoryMax`, no swap, the lowest CPU and I/O priority;
  - gives it scratch on disk under `/var/tmp/lost-minutes-jobs` rather than in `/tmp`, which is RAM on
    that server;
  - refuses any `/tmp` or `/dev/shm` path in the command;
  - reports afterwards whether the ceiling was hit and any machine-wide out-of-memory line since the job
    began.

**Heavy replays stay local**, as `deploy/README.md` now says under "Memory".

**Nothing in a deploy needs more than the login ceiling.** Checked before deploying:
- The catalogue build runs as its own service (1500M), and only on a first install.
- The release copy and the upload are file transfers. Their page cache is reclaimed under the ceiling;
  it is not killed.
- `pip` stays well under it.

A deliberate way to lift the ceiling for recovery work, with the collector stopped, is in the README.

**Two things found on the way:**
- **The deployment check could not see a misspelt directive.** `systemd-analyze verify` exits 0 when it
  meets a directive it does not know: it prints "Unknown key … ignoring" and carries on. A misspelt
  `MemoryMax` or `OOMScoreAdjust` would have passed `deploy/validate.sh` and been silently ignored on
  the server, the protection absent while the record said otherwise. The check now fails on any such
  line, and verifies the login drop-in with the units. A deliberate `OOMScoreAdjst` in the collector's
  unit failed it.
- **Leftovers of my own were holding memory.** About 175 MB of extracts from the investigations of
  22–23 September were still in the server's `/tmp`. All were derived from captures that are preserved.
  Removing those twelve files, and nothing else, raised available memory from 2,512 to 2,759 MB.

**One design change, from checking it on the server.** The login ceiling was first installed as a soft
`MemoryHigh` of 700M beside the hard 900M. A 1,000 MB allocation typed at a prompt was held under the
ceiling, but it was not stopped: it was slowed to a crawl, still holding its memory, until my 90 s
timeout ended it. That looks like a job that has hung. The login slice and the wrapper now have the hard
ceiling alone (`bf33c80`). The kernel still reclaims file cache before it kills, so copies and uploads
work, and a runaway is killed at the ceiling and says so. The collector keeps its own soft limit: for
the one process that must not die, being slowed is better than being killed.

**On the server, after the deploy** (read from the running system, not from the files):
- **Login ceiling:** the login slice's `memory.max` is 943718400 (900M), with no soft limit and no swap.
  It came from the new drop-in, and applied to the running slice without a new login.
- **Collector priority:** the running collector's `oom_score_adj` is −500; its 1800M/2400M ceiling is
  unchanged. The arrival evaluation carries `OOMScoreAdjust=300` for its next run.
- **Wrapper, a normal job:** it ran with `TMPDIR` under `/var/tmp/lost-minutes-jobs`, exited 0, and its
  empty scratch was removed.
- **Wrapper, a `/tmp` path:** refused, exit 2.
- **Wrapper, 64M ceiling:** a job asking for 200 MB was killed in its own scope (`CONSTRAINT_MEMCG`,
  `oom_memcg=/system.slice/lm-job-ceiling-….scope`), twice, before and after the change above.
- **A runaway at a prompt:** asking for 1,000 MB, it was killed in 1 s at the login ceiling
  (`CONSTRAINT_MEMCG`, `oom_memcg=/user.slice/user-1000.slice`).
- **A 1.2 GB file written under the same ceiling** completed in 2 s. A deploy's 3.4 GB release copy
  also ran under it and completed.
- **Throughout:** the collector kept its process, stayed active, and published; there was no machine-wide
  out-of-memory line, and at least 2.5 GB stayed available.

Nothing was done to exhaust the machine's memory: each test was bounded by the ceiling it tested.
The previous unit files are kept at `/srv/lost-minutes/units-before-1419704/` on the server.

## 3. The movement evidence

### 3.1 "No unmarked jumps" is not "no jumps"

A cut is a drawn step of more than 3 m in 100 ms. `scripts/evaluate-fleet-steps.mjs` runs every bus in a
reel through the fleet's drawing as the map runs it: polled every 20 s, stepped every 100 ms, roads
loaded as the map loads them.

| Reel | Buses | Cuts over 3 m | Marked | Unmarked |
|---|---|---|---|---|
| Noon, 26 September, 11:54–12:06 UTC, deployed code | 485 | 108 | 108 | 0 |
| Noon, this build | 485 | 103 | 103 | 0 |
| Evening, 22 September, 21:15–21:35 UTC, deployed code | 224 | 89 | 88 | 1 (the same 6 m hop) |
| Evening, this build | 224 | 90 | 89 | 1 (the open 6 m hop at a path joint) |

Every marked cut is a real repositioning: the bus is moved rather than travelled, a dashed trace is
drawn for 6 s, and its reason is said. The reels' marked moves have a median of 154 m (noon) and 181 m
(evening) and reach 2.3 km and 4.2 km. They are buses that went unseen or reported far from where they
were. The jumps are still there; what changed is that each is shown as a jump and explained.

### 3.2 The 131 m repositioning, from the reports

BNSM 11930, a route-192 at the Piccadilly terminus, rebuilt from the collector's own captures
(`tests/recorded/fleet-journey-change-192.json`):
- It reported on its inbound journey at 11:55:58 UTC, then nothing new for 422 s.
- Its first outbound report was at 12:03:00, 108.3 m away.

The deployed drawing marked the move at the right moment: at 12:04:00, when the moment it shows reached
12:03:00 (130.9 m, marked, in the previous milestone's replay of these publications through the served
site). It started exactly at the old report. But it ended 23.5 m from where the new report was made.
That report lay behind the start of its checked road, at the stand. It was clamped onto the road's first
point, within the allowance meant for a report *beside* its road.

**So the 131 m was 108 m of necessary recovery from a seven-minute data gap, and 23.5 m of drawing
defect.** A report now counts as on its road only if it lies no more than a bus's length (12 m) past
either end (`ROAD_END_SLACK`). The mark is one move of 108 m, labelled *too long*, to the report
itself, at every one of 20 poll phases (`tests/fleet-journey-change.test.mjs`).

### 3.3 The journey change, redone

- **The deployed journey change blended two journeys.** The fix for the Piccadilly jumps carried the old
  journey's reports into the new journey's history, so they were placed on the new journey's road. Now:
  1. the drawing first finishes the old journey's reports, on the old road;
  2. the new journey takes over from where that left the bus, a place kept exactly as drawn and never
     measured onto a road;
  3. the step from there to the new journey's first report is judged as any two reports are.
- **An index carried across a rebuilt path.** When the clock resynced, the drawing kept the old path's
  report number, which in a renumbered path can point at a later report. It was latent in the deployed
  code. The two-report path the new journey change builds exposed it: before this fix, in 5 of 20 poll
  phases BNSM 11918 was drawn at its new journey's first report 20 s early, a 25 m cut. The report is now
  found by its own time (`sameReport`), and 11918 has no cut at any phase.

### 3.4 Every reason made true

The deployed drawing gave five kinds of wrong reason:
- the first two were found tracing single buses;
- the next two by tagging every repositioning on both reels with the branch of the drawing that made it,
  in a scratch copy of the code;
- the fifth by reading the branch behind the fourth.

1. **A resync was said to be "too long".** When the clock falls too far behind to catch up, the bus is
   moved to the delay's moment. The route-43 incident's own publications (24 September) are played in
   `tests/incident-43.test.mjs` with a 90 s gap in their arrival. When reports made every 20 s then
   arrived together, the deployed code said "too long passed between its reports", which was not true
   of them. That is now its own reason: *its reports arrived late*. The card adds that the stretch was
   skipped rather than drawn faster than the bus went. Where the move also crosses a pair of reports that
   could not be travelled between, the pair's own reason is said instead.
2. **A silence longer than the trail lost its first report.** The published trail reaches back 240 s. A
   bus silent for longer came back with no report from before its silence, so its path began at the
   report after it, and the move there was judged afresh rather than from where the bus stood. On the
   deployed code:
   - the route-65 (BNDB YY73OYL, 445 s unseen, 172 m) was said to have had *no earlier report*, seven
     minutes after its last one;
   - it and the route-370 (BNML YX74OJM, 853 s unseen, 3,969 m) were moved 3–22 s after their report
     arrived, as the page took it up. The drawing reaches that report 33–56 s after it arrives, so the
     move came about half a minute early, ahead of everything else the drawing showed. The 370's reason,
     *too far*, was right at 19 of 20 poll phases.

   On the two reels, 12 buses came back from such silences, of 4–14 minutes. A move under 150 m would
   have been eased across the silence as if travelled. Now the drawn place is kept in front of the
   reports, at the moment it stood for (`continuity` in `lib/motion.ts`). The move is judged by the pair
   rule, and made when the drawing reaches the report after the silence. Both buses are regression
   fixtures from the published data (`tests/fleet-silence.test.mjs`).
3. **A playback starting away from a lone report always said "too long".** Nine such moves on the reels:
   - three were right;
   - two were too far (455 m after 191 s; 2,282 m after 204 s);
   - four could have been travelled, 22–43 s apart, and were skipped only because playback starts its
     delay behind the newest report.

   Each is now judged by the pair rule, or said as *late*.
4. **"There was no earlier report to travel from" was said of a bus drawn at an earlier report.**
   MF74NRN (route 203) was drawn at a lone report of 11:50:22, which had fallen out of the trail when it
   next reported, 392 m on, at 11:55:02. The pair is now judged: *too long*. Had it been close enough
   in time and distance, the bus would travel between the two reports as between any two.
5. **The same words were said of every move in *reported positions only*.** In that mode the page
   withholds a trail it has. It now says *you chose to see reported positions only*.

**Each fix has a test that fails on the deployed code for the reason it describes:**
- the four in `tests/reposition-reasons.test.mjs` (3, 4 and the travel case, 5);
- the two drawing tests in `tests/fleet-silence.test.mjs` (2): the route-65 on its reason, the route-370
  on its timing;
- the route-43 incident's two assertions, restated to *late* with the reason beside them (1).

At all 20 poll phases the two silent buses are now moved exactly when the drawing's moment reaches the
report after the silence.

Reasons on the reels now (noon; evening):
- too long 44; 30;
- too far 27; 32;
- late 32; 27;
- no earlier report: none on either.

Every one agrees with the pair rule, or with the resync that made it. On the deployed code the same
reels gave:
- too long 85; 65;
- too far 20; 22;
- no earlier report 3; 1;
- late: none. The reason did not exist.

### 3.5 On touch

- **The trace answers a tap.** A tap on the dashed trace chooses its bus, as a tap on the bus does
  (`SELECTABLE` includes `lm-fleet-moved`).
- **The card says why, on a line of its own.** For a bus not coming to the passenger's stop, which is
  most buses tapped on the map, the reason is a line under the card's head, dashed like the trace.
  Inside the stop's note it had read as part of whether the bus serves the stop, and a bus past the stop,
  which has no note, never said it. A bus coming to the stop says it in its motion block, as before.
- **Checked on both profiles, by touch on the phone**, in `fleet.spec` *a bus moved rather than followed
  is marked…*:
  - the trace is tapped at a point clear of every marker;
  - the tap's own diagnostic (`data-tap`) confirms it was the line that was hit;
  - the mark's reason is *too long*;
  - the card reads "It was moved 309 m to its latest report rather than travelled there, because too
    long passed between its reports."
- **The check's fixture is now realistic.** It had re-timed every report at each poll, which moved the
  reports either side of the silence 40 m back and forth, marks a real feed never makes. Report times
  are now fixed, as a feed's are.

## 4. The preview tunnel, stopped

`scripts/preview.sh` had left a Caddy (on 127.0.0.1:8098) and a Cloudflare quick tunnel running since
22 September. They were serving this machine's publication of 12 September at a temporary public
address. Checked before stopping:
- no connection to the port;
- nothing in the repository referring to that address;
- no collector of this script's or the owner's running;
- both pid files naming exactly those two programs; the script's stale collector pid was not running and
  was left alone.

`scripts/preview.sh stop` stopped both. The tunnel exited after a 24 s drain, the port is free and the
address no longer answers. Nothing else was touched. The script's policy removed the Caddy request log,
which held the forwarded addresses of whoever had opened the link.

## 5. A collector stop that was lost, found while deploying

Restarting the collector for `1419704` at 01:16:24 UTC, systemd sent SIGTERM and the collector ignored
it. It logged cycles 1272 and 1273 as if nothing had happened, and was killed with SIGKILL 30 s later
("State 'stop-sigterm' timed out"). The next start closed the abandoned run ("cause: not recorded") and
published within seconds. Nothing was lost beyond a clean stop, but the stop had been swallowed, not
merely slow. That was `4d1f586`'s collector code, which this release had not changed, so the previous
record's "the collector stops cleanly mid-query" was too broad.

**Reproduced, not guessed.** `scripts/probes/stop-sweep.py` runs the real `collect()` in a child
process, against a copy of the warehouse (never the one in use), fed the collector's own stored
captures. It sends SIGTERM at a chosen moment, in 20 ms steps, and waits as systemd does. Each step
of the run, and each statement of the warehouse load, is timed, so every signal is placed.

**Where the stop is lost.** Every hung run had the signal land in one statement: the batch insert of a
cycle's parsed positions (`executemany('INSERT INTO staging_obs …')` in `load_observations`). Landing
there, the stop sometimes came back as itself or as DuckDB's "Query interrupted", which the collector
already handled. In two sweeps of 19 stops, 8 and 9 times the insert finished as if nothing had happened
and the exception the signal handler raised was simply gone.

**Fixed without depending on DuckDB** (`7753031`). The handler records that a stop was asked for as well
as raising it. The loop acts on the record once the warehouse has handed control back: after the cycle
is recorded whole, and after the publication. The same sweep then: 0 of 19 hung, and the stops DuckDB
swallows now end within 0.18–0.53 s.

A Python test lets the signal's handler run inside the load and swallows what it raises, as
`executemany` did. Without the change the collector runs on to its time limit, which it did on the
current code before the fix. On the server, the restart that loaded the fix and one more to check it
both stopped cleanly ("Deactivated successfully", in 2.1 s and 3.8 s).

## 6. Verification

- **Node:** 276 tests, including `scale`, `fleet-silence` and `reposition-reasons`.
- **Python:** 141 tests, including the lost stop; typecheck; lint with no errors (16 warnings, none in a
  changed file).
- **`deploy/validate.sh`:** shell syntax, the nine units and the login drop-in, now failing on any
  directive systemd would ignore; every Caddy route and header, the preview locked by default.
- **The full browser gate** on the build of `1419704`'s sources: 409 passed, 41 skipped by design,
  2 failed, in 1.4 h.
  - The two failures were one check on both profiles, *a bus beside the chosen one, tapped where it
    shows, is chosen*. Its setup moves one bus 212 m next to another between two reports a few
    seconds apart. It then measured the moment the map settled, relying on the old instant move and its
    untrue "no earlier report".
  - The bus now travels there in the pair's own time, so the check waits for it to arrive and stop,
    reading the map's diagnostics without moving the camera, then measures and taps as before. Its
    assertions are unchanged; it passed 6 of 6, three runs on each profile.
  - The sources the gate built were checked by checksum against the commit afterwards.
- **Changed since the gate:** only that check, a script's comment, the collector's stop (Python, with its
  tests), the login drop-in and the wrapper with their README section, and the new stop-sweep probe. Each
  is verified by its own checks above. None of it is in the built site.
- **The repository's CI had been red since the push of 26 September at 17:59 UTC**, and the last
  record did not say so. Every step passed except "no secret reached the built site". Its test for a
  build-machine path matched any `/home/` in the shipped JavaScript, and the vendored Cesium bundle
  carries ArcGIS URLs (`arcgis.com/home/item.html`) and an emulated `HOME` of `/home/web_user`. The check
  now looks for the building machine's own checkout and home paths. Locally, the clean build passes it,
  and a planted path is caught. The run for the push carrying the fix is the confirmation.
- Emulation only; nothing on a phone in hand.

## 7. Deploy and served checks

**Deployed three times the same night**, each keeping the running release at `/srv/lost-minutes/previous`
for `deploy/rollback.sh`:
1. `1419704`, this record's code;
2. `7753031`, the collector's stop;
3. `bf33c80`, the hard memory ceiling.

`7753031` is the release kept for rollback. The draft records were set aside for each upload, so the
server matches its commit exactly. The unit files and the login drop-in were installed by the same
commands `deploy/install.sh` uses, after a diff showed that only the two changed units differed from
what was installed. The previous units are kept at `/srv/lost-minutes/units-before-1419704/`.
`rollback.sh` restores the app, not units; the new unit lines work with either release.

**On the served site:**
- **The same build:** the page and all 22 JS chunks are byte for byte this build's, the chunk carrying
  the new code among them.
- **The lock:** `/preview/` and `/preview/photo3d.json` answer 401, `/data/private/photo3d.json` 404,
  and the public `config.json` has no `photo3d`. Photographic imagery stays disabled.
- **The 131 m move:** the noon publications of 26 September, replayed through the served site as the
  previous milestone did, move BNSM 11930 once by **108.3 m**, marked, "too long", at 12:04:00 (130.9 m
  on the previous release). BNSM 11918 has no cut; its largest step is 4.9 m. The frame shows the
  dashed trace from where the 11930 was drawn to its report.
- **The roads:** the front view on the served build (the fixture ride through it) draws them at the
  corrected width, frame for frame as the local build does.
- **On touch:** the trace-tap check and the metres-per-pixel check pass against the served site on both
  profiles, 4 of 4.
- **Live:** the collector publishes; 36 buses at 01:39 UTC, and 471 at noon in the replay.
- Emulation only.

## 8. What needs the owner

- **Google.** The key and the preview password, once the licensing enquiry is answered. The steps are
  prepared and not executed.
- **Backlog 36.** The small things seen on the phone, and the kerb step above. None is a fault.
- Nothing else in this milestone waits on a decision.
