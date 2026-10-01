# Lost Minutes — release record

One page, kept current. What is running, what is verified, what is not, and what it costs.

| | |
|---|---|
| **Commit** | **`4d91c79`**, deployed 1 October 2026, night (the release sections below); the running site carries its own stamp in `RELEASE` on the server and in the feedback report |
| **Build stamp on the page** | commit + build minute, in the feedback report and `lib/build.ts` |
| **Public address** | **https://lost-minutes.duckdns.org** — a lasting address since 20 September 2026 (a free DuckDNS subdomain, Let's Encrypt) |
| **Deployment status** | **hosted**: Hetzner CX23, Helsinki, no paid backups; `deploy/publish.sh` deploys, `deploy/rollback.sh` puts the previous release back |
| **Collection** | continuous, under systemd on that server, with a watchdog and the nightly timetable and evaluation timers |
| **Verdict** | **Ready for invited beta testing.** Everything is verified in Chromium emulation against fixtures and the real site; nothing yet on a phone in hand, which is the next step |

## 1 October, night: every bus drawn on its street, not over the houses

**Deployed: `4d91c79`**, with `a549583` kept for `deploy/rollback.sh`. From the owner's phone on the served site: a
Diamond 74 at Charlestown on the night map, "Another that seems to be flying and not on the road", then "Check that
all busses don't do this". The account is backlog 49.

- **It was the drawing.** The 74 has no timetable here, so no checked road, and a bus with none was drawn on straight
  lines between its reports. Every report lay within 3.4 m of its road; the line between two of them cut the bend by
  37 m, over the houses.
- **All buses, measured against the map they are drawn on** (`scripts/evaluate-fleet-playback.mjs --osm --streets`,
  every bus in two recordings, every drawn frame against the map's own streets and buildings):

  | buses with no checked road | 22 Sept evening (216): before | now | 30 Sept night (186): before | now |
  |---|---|---|---|---|
  | drawn more than 10 m from any road | 10.0% of frames | **0.82%** | 9.1% | **1.4%** |
  | more than 20 m | 1.27% | **0.11%** | 1.41% | **0.14%** |
  | inside a building | 6.9% | **2.6%** | 4.4% | **1.1%** |

  Buses with a checked road were already on it, and are unchanged. What is left inside a building is buses on the
  road under a bus station's roof (Stockport Interchange, the Trafford Centre), which the map draws as a building.
- **Now:** a bus with no checked road is drawn along the map's streets between its reports (`lib/streets.ts`): one-way
  streets only their way, never a way that turns back on itself, a way a bus could have driven in the time, kept and
  only ever extended at its newest end. It is never called a checked road: the front view, the road ahead and the
  arrival estimate still need one, and the card says the streets are the nearest to both reports.
- **And at the zoom a stop opens at.** Checked roads were loaded for the buses in view only from zoom 15, and street
  tracks needed that settled: at a stop's own zoom on a phone (14.2–15) every bus was still on straight lines. Both
  now start at 14.
- **Found and fixed on the way:** the first version built a street graph inside the map's frame loop, up to 0.45 s in
  one frame as a phone panned into a street zoom; the page now holds one graph, grown as each tile arrives, and the
  frame loop only routes (0.07 ms at the median). A median figure had hidden it; `data-fleet-ms-max` now shows the worst.
  And the map's tiles each carry a road past their edge, so whether two copies were joined depended on which tile
  was read first; cut at the edge they meet (2,393 of 2,398).
- **What it costs:** a bus already drawn when its streets arrive is eased onto them, once, at the drawing's usual
  10 m/s; 9 and 5 buses of 334 and 302 face more than 30° off their movement for over 1.5 s, at bus stations and
  turning loops, against 1 on straight lines; on the night recording 56 buses were drawn over 75 s behind at some
  moment against 43, most by 75–78 s. Repositionings fell, 42 to 35 and 305 to 259.
- **Not changed, and the larger problem (backlog 48):** the report on the owner's screenshot was 49 s old. Every
  position now reaches a phone about twice as old as on 22 September (a median 44 s against 24 s): each publication
  reaches the page about 30 s after its own stamp, against 10 s then. Where that time goes is not measured; tracing
  it needs either a collector restart to time each step (a pause of a few seconds), or a copy of the 1.15 GB
  warehouse here, and both are the owner's to approve.

**Verified.**
- Node 346 (street tracks 11, the tile reader 3, the wording 1), Python 187, lint with no errors.
- The full browser gate on the final build: **474 passed, 50 skipped by design, none failed (1.4 h)**. The gate on
  the first version failed only the station check, whose fixture bus the street track now drew on its street; it was
  moved under Stockport Interchange's roof. A focused run on the second version failed the fleet's pace check at a
  stop's zoom, which is how the zoom band was found.
- Served:
  - the index and every script and stylesheet it names byte-identical to the deployed build (10 of 10);
  - that build is the gated one but for its stamp: all 3,703 files equal once the build ID, the stamped chunk's name
    and the stamp are swapped;
  - `/preview/` returns 401;
  - the collector's PID 331046 is unchanged;
  - `RELEASE` reads `4d91c79`.
- The street, fleet and station checks against the served site: 28 passed, 2 skipped by design. The 74 on its street
  track in 120 of 120 frames, at most 1.7 m from the streets; the fixture's fleet within 2.3 m of its road at a
  stop's zoom (14.4 and 15.6).
- Live on the served site, at night (14 buses publishing):
  - a 43 on an unsettled branch, so with no checked road, ridden 150 s over 756 m: on its street track throughout,
    drawn a median 0.4 m from the road and at most 2.4 m, never inside a building, no "gone quiet", the camera at 60°;
  - Piccadilly Gardens at zoom 15.4 with the map dragged into new tiles: the fleet's worst tick 4.1 ms, no long task.
    Ten buses at night says little about cost; the evening fleet is the real test.
- Emulation only; the owner's phone is the check that matters.

## 30 September, evening: the ride keeps its city, and no bus falsely "gone quiet"

**Deployed: `a549583`**, with `2347c6c` kept for `deploy/rollback.sh`. The owner's phone showed the release below
was not done: a V1 on Deansgate and an X43 by the Irwell, each visible, but each in an empty city and each saying
"No report for 62s · the feed is live, this bus has gone quiet". Both are fixed, and both were measured on the
served site before anything was changed (backlog 45 and 47).

- **The city faded for most of a ride (backlog 45).** The morning's fix faded every building whenever MapLibre's
  query found one drawn over the bus's point. That query ignores depth, so it fired for buildings beside or
  beyond the bus: on a live V1 the city was faded for 131 of 150 s.
  - Now the camera looks down over the buildings between it and the bus, just steeply enough to see the bus's
    front half and roof (`lib/sightline.ts`), and settles back once the bus is past.
  - The buildings fade only for a bus inside a footprint (the camera then keeps its framing), or behind a
    building too tall for the steepest view. That is judged by the geometry alone.
  - A first version aimed at the bus's middle and dove to 24° for a bus standing against a shop. The full gate
    caught it (`journey.spec` at Stretford Mall), and the target became the front half.
- **"Gone quiet" said of buses reporting every 20–30 s (backlog 47).** Our publication is stamped as it starts and
  lands 23–25 s later (timed on the server), so a normal report reads 40–75 s old on a phone, and the card called
  it quiet above 60 s. It now judges by how old the report was when the feed was read, and still says the true age.
- **Found, not changed (backlog 48):** that 23–25 s itself. Every position a passenger sees is about 23 s older
  than it need be. Profiling it needs a copy of the 1.15 GB warehouse on this machine, which is for the owner to
  approve.
- **What a passenger sees:**
  - in the ride, the camera sometimes looks down more steeply beside tall buildings, and the city stays;
  - the buildings fade only while the bus is drawn inside one;
  - no "gone quiet" line on a bus that is reporting.

**Verified.**
- Node 331 (the sight line 10, the quiet rule 1), Python 187, lint with no errors.
- The full browser gate on the fixed build: **470 passed, 50 skipped by design, none failed (1.3 h)**. The gate
  before it, on the first version of the rise, failed one check and was stopped and rerun.
- Served:
  - every asset and the index byte-identical to the local build (9 of 9);
  - that build is the gated one but for its stamp: the one stamped chunk's SHA-256 is equal once the stamp is
    swapped, and the other seven chunks and both manifests are identical outright;
  - `/preview/` returns 401;
  - the collector's PID 331046 is unchanged;
  - `RELEASE` reads `a549583`.
- The station checks against the served site, on real tiles, 8 of 8: over the station at 24–25°, the city solid,
  the bus 47–58% of its box; inside it, the framing kept and the bus seen through the fade.
- Live on the served site, 120 s each:
  - a V1 at night was never faded, at 60° throughout, with no "gone quiet";
  - an X43 by day rose to 31–35° for about 30 s by Shudehill, was faded 7 s while drawn inside a building, and
    showed no "gone quiet". Its only warnings were repositionings.
- Emulation only; the owner's phone is the check that matters.

## 30 September: the bus hidden inside a building, and the nightly runs recorded "by hand"

**Deployed: `2347c6c`**, with `b507302` kept for `deploy/rollback.sh`. Two fixes, each with its account in
`docs/BACKLOG.md` (45 and 46). Arrival predictions stay off in both directions; 6 October is when the
confirmation results are read, not a release date.

- **From the owner's phone: "Bus is riding under buildings."** An X41 with no checked road, ridden on the night
  map past Manchester Victoria: the ring and the number drawn, the bus's body a sliver under a dark block. The
  ride's camera, 49 m behind the bus and 28 m up, stood inside the 30 m station building, whose walls hid the
  body (a fill-extrusion, sharing the buildings' depth test) while the symbols stayed on top. Now, while a
  building is drawn over the chosen bus's ground point (asked of MapLibre every 250 ms and at each camera rest),
  every building fades to 0.3, and the buses' bodies, drawn beneath the building layer, show through; the theme's
  own opacity returns 800 ms after the bus is clear. The front view is unchanged.
  `tests/browser/occlusion.spec.mjs`, on the station's own tiles: 0 lime pixels of the body before, 178–800
  after, day and night, both profiles; the frames are in `outputs/probes/x41/frames/`.
- **Found checking the night's runs: both recorded "by hand", and Operations calling both jobs overdue.** Both
  had fired on their timers (each timer's `LastTriggerUSec` equal to its run's start). On systemd 259 a timer's
  later firings hand the service the elapse *before* this one, which the check of `b507302` read as stale, so
  from 05:44 and 06:12 UTC the served Operations view marked both jobs overdue. Proven with transient probe
  timers on the server: a persistent calendar timer's second firing carried its first firing's moment. A run is
  now judged by the timer's own `LastTriggerUSec`, read unprivileged as the service's user, and each attempt keeps
  what its judgement rested on (`triggerEvidence`).
  - **Left for the owner.** The server's two records of 30 September still read `manual`, so Operations reads
    **overdue** until the runs of 1 October (about 02:43 and 03:12 UTC), recorded under this fix, move "last
    scheduled run". Correcting them by hand, as on 29 September, was refused by the assistant's permission rule
    for writes on the server. To correct them now, on the server:

    ```
    sudo -u lostminutes /srv/lost-minutes/app/.venv/bin/python - <<'EOF'
    import sys; sys.path.insert(0, '/srv/lost-minutes/app')
    from pipeline import jobs
    from pipeline.core import atomic_json, utc_now
    root = '/srv/lost-minutes/app'
    for name, fired, handed in (('refresh', '2026-09-30T02:43:07.387675+00:00', '2026-09-29T02:44:25.599264+00:00'),
                                ('arrival-eval', '2026-09-30T03:12:46+00:00', '2026-09-29T03:12:02.178785+00:00')):
        with jobs._locked(root):
            s = jobs._load(root, name); a = s['lastAttempt']
            a['trigger'] = s['lastSuccess']['trigger'] = 'timer'
            a['triggerEvidence'] = {'unit': f'lost-minutes-{name}.timer', 'elapseFromEnvironment': handed, 'timerLastFired': fired}
            s.setdefault('corrections', []).append({'at': utc_now(), 'from': s.get('lastScheduledAttemptAt'),
                'why': f'the timer fired at {fired} (LastTriggerUSec); recorded as manual by the check of b507302 (backlog 46)'})
            s['lastScheduledAttemptAt'] = a['startedAt']
            atomic_json(jobs._state_path(root, name), s); jobs.publish(root)
    EOF
    ```

- **What a passenger sees:** the buildings fade while one hides the chosen bus; nothing else changes.

**Verified.**
- Node 320, Python 187 (two new), lint with no errors; the full browser gate on the fixed build **468 passed,
  50 skipped by design, none failed (1.3 h)**, the six new checks among them; the focused ride, map, fleet and
  paint specs 92 passed, 14 skipped.
- Served: every asset and the index byte-identical to the local build (9 of 9); that build the gated one but for
  its stamp (the one stamped chunk's SHA-256 equal once the stamp is swapped, the other seven chunks and both
  manifests identical outright); `/preview/` 401; the collector's PID 331046 unchanged; `RELEASE` `2347c6c`.
- The occlusion checks against the served site, on real tiles: 6 of 6 (the body 190 and 175 pixels on desktop,
  728 and 476 on the phone profile, day and night).
- Emulation only; the owner's phone at Victoria is the check that matters (`docs/PHYSICAL_DEVICE_CHECKLIST.md`).

## 29 September, afternoon: a bounded reliability close-out

**Deployed: `9d77718`, then `b507302`**, with `9d77718` kept for `deploy/rollback.sh`. The account is
`docs/MILESTONE_2026-09-29_CLOSEOUT.md`. Arrival predictions stay off in both directions; 6 October is when the
confirmation results are read, not a release date.

- **Shared links by day:** 48 served loads of four bus links, with 602 buses in the publication, were drawn in
  2.1–3.1 s. None was stuck.
- **Backlog 43:** not reproduced with the recovered code and the fixed inputs still available (the snapshot it
  failed on is not), across 131 trials in seven configurations, DuckDB 1.5.6 and Python 3.12 among them; the cause
  is unresolved. The two-process containment stays, and no dependency changed.
- **Memory, both figures:**
  - Operations names the whole job, page cache included, and its largest single process, and never merges
    them.
  - From 30 September each run also records how often it was held at its ceiling, its OOM events, and its
    waits on memory.
  - No OOM touched the scheduled runs.
- **Results approve nothing:**
  - an approval must cite the SHA-256 of the confirmation results it approves;
  - a version is pinned to the code that defines it, so a change to the model or the display is a new version
    with its own untouched window;
  - a window scored under anything else is invalid.
- **What a passenger sees:** nothing new; the Operations memory row is reworded.

**Verified.**
- Node 320, Python 185; the full browser gate on `9d77718`'s build 462 passed, 50 skipped, none failed (1.3 h).
- Served byte-identical, the code the gated build's but for its stamp; the preview locked; the collector
  untouched.
- The deployed defining files' digest is the pinned one.
- Two evaluation runs by hand succeeded, the first to record the kernel's side of memory.
- **Found on the way:** a run started by hand was recorded as the timer's, from systemd's stale activation
  details. Fixed (`b507302`) and verified, and the record corrected.
- Emulation only.

## 29 September: the correction carried through, the stop mapping made explicit, the evaluation made honest

**Deployed:**
- `a5e43cc`: the corrections and the evaluation;
- `af9a959`: when the map counts as drawn, "tomorrow" in the planner, and the timed nightly steps;
- `e86b401`: the front view's entrance.

`af9a959` is kept for `deploy/rollback.sh`. The account is `docs/MILESTONE_2026-09-29_CORRECTIONS.md`.

**Arrival predictions stay off in both directions.** The approval file names nothing.

**What a passenger sees.** Three small changes:
- a shared bus link no longer says "Drawing the map…" for 24 s over a map already drawn. That had happened on
  6 of 21 loads of one bus link on the served site (backlog 44);
- entering the front view on a moving bus no longer ends with the camera stepping about 8–9 m. The first frame
  after the glide now lands 0.44–0.82 m from it;
- late at night the planner's summary of a folded list says "tomorrow" for a time after midnight, as its rows
  already did.

Otherwise nothing changes:
- no minutes are shown anywhere;
- the drawing, the ride and the planners are as they were;
- road-shape files are about 400 bytes larger compressed, fetched one bus at a time, and the shape index grew
  278 bytes.

**Behind it:**
- **The inbound-15 finding is withdrawn** wherever it stood as current, and the TfGM drafts say it must not
  be raised.
- **Every road stop is named by an explicit, versioned mapping** (`docs/STOP_MAPPING.md`). It was
  recovered for all 560 shapes from their own routing requests and checked against geometry; 284 shapes had
  been misread by position.
- **The arrival evaluation is frozen on the moments a page would show it**
  (`docs/ARRIVAL_DISPLAY_PROTOCOL.md`). Both directions fail on the revision days:

  | window | outbound median / p80 | inbound shown |
  |---|---|---|
  | 21–26 September | 1.70 / 4.00 min | 2.1% of moments |
  | 20–28 September, by the nightly run | 1.65 / 3.90 min | 7% of moments |

  The confirmation, 29 September to 5 October, is collected nightly, read once, and would still wait for the
  owner.
- **A range, if ever shown, is only the protocol's validated interval.** The ±2.48 min is withdrawn.

**Operations.**
- **The rebuild's memory peak.** It was DuckDB's buffer pool. At a 512 MB DuckDB limit the rebuild peaked at
  654 MB resident in its one process instead of 1.11 GB, with a byte-identical catalogue; the 1500M ceiling is
  unchanged.
- **Each job's steps now record their resident peak**, shown first, with the unit's total (page cache
  included) beside it. Each step is also timed. So is the rebuild's copy of the warehouse for the evaluation:
  1.15 GB now, and the one cost that still grows with the history kept.
- **The nightly evaluation scores a day at a time** from at most 14 days, in a process that never loads
  DuckDB. With DuckDB loaded, 4 of 17 runs failed at random (backlog 43).

**Scheduled and controlled, told apart.** The controlled evaluation (by hand, 21:49 UTC on 28 September) is
recorded as manual. The first scheduled runs under the new units, on 29 September, are recorded as the timer's:
- **the timetable rebuild, 02:44–02:47 UTC:** succeeded.
  - It skipped one unreadable stored response.
  - `publicUse` is on all 587 patterns, and BNML 732 is closed and offered on no trip.
  - The whole job, page cache included, reached its 1,500 MB ceiling; its largest single process peaked at
    599 MB resident. No OOM event (close-out, 29 September); collection paused 2 min 33 s.
- **the arrival evaluation, 03:12–03:13 UTC:** succeeded in 1 min 4 s.
  - It scored 27 and 28 September as revision days.
  - The whole job, page cache included, peaked at 598 MB; its largest single process at 418 MB resident.
  - Still collecting, 0 of 7 confirmation days; nothing released.

**Verified.**
- **Suites:** Node 320, Python 176, typecheck, lint, and `deploy/validate.sh`.
- **The full browser gate on `e86b401`:** 462 passed, 50 skipped by design, none failed (1.3 h). The four gates
  before it each found something; the record's section 6 has them.
- **Each deploy:**
  - served byte-identical to its local build;
  - its code the gated build's, but for the build stamp;
  - `/preview/` locked;
  - the collector untouched (PID 282438).
- Emulation only.

## 28 September, evening: the arrival pilot checked and not enabled; inbound 15 renumbered

**Deployed: `cd14ab3`**, with `53f2232` kept for `deploy/rollback.sh`. The account and the evidence are
in `docs/MILESTONE_2026-09-28_ARRIVAL_PILOT.md`.

**Go/no-go: no-go.** Estimated minutes for outbound 15 are **not enabled**. The page's estimator now
answers exactly as the evaluated one (2,078,969 answers on held-out journeys, 5 of them 1 ms apart), and
outbound 15 meets all six criteria on held-out days (median 1.20, p80 2.48 min). But the criteria group
moments by the actual minutes before the bus passed, and a page can choose only by its predicted
minutes: on predicted 2–10 min the errors read median **1.57** and p80 **3.79**, over both thresholds.
**Scope enabled: none.** The approval file names nothing; the scope a future approval would name is
BNML, line 15, outbound, `BNML:15:outbound:c9291c1aea`, `blended@9a626129f782`. Inbound 15, validly
scored for the first time (section below), passes both ways (1.10/2.19; shown band 1.27/2.76) and stays
withheld on the owner's instruction.

**What a passenger sees.**
- **No estimated minutes anywhere**, as before; the departure board and the timetabled lines are
  unchanged.
- **Inbound 15 is no longer said to run 15 minutes early.** That was the evaluation's fault (its stops
  paired 14 out): the planners said it this morning, and its timetabled times had been withheld on it
  since 20 September. Its timetabled time at stops stays withheld, as every unchecked service's is; in
  the planners it is timed from the timetable and said to be unchecked, like every other unchecked
  service, and its buses are no longer left out of other lines' legs. Outbound 15's check now reads "about 3 min behind it at the first stops" (806 passages).
- **Services closed to the public are left out of both planners by name** (ten, BNML 732 among them)
  until the served catalogue carries the flag; the first rebuild after this deploy writes it.
  **Pending**: verified only after that rebuild (29 September, about 02:43 UTC).

**Operations.** Each nightly job records its own memory peak and ceiling when it stops. The timetable
rebuild's last success (27 September): **1.4G of its 1500M ceiling, 96%, close to it**, page cache
included, from the journal and rounded; tonight's runs are the first to record their own. The limits
are unchanged. The arrival evaluation's headroom is shrinking as the warehouse grows (684.5M of 1500M on
8 days; about six weeks left at the measured rate, backlog 42).

**Scheduled and controlled, told apart.** Tonight's runs are the first scheduled ones with this code:
the rebuild at about 02:43 UTC and the evaluation at about 03:12 UTC, each recorded as *scheduled* in
Operations. The one run of this code so far is a **controlled test**, recorded as *by hand*: the
evaluation at 18:12–18:15 UTC, succeeded in 2 min 47 s at 545 MB of its 1,500 MB ceiling (measured by
the unit itself), releasing nothing, with outbound and inbound 15 awaiting an exact approval.

**Verified.**
- Node: 313 tests. Python: 165. Typecheck; lint with no errors.
- The full browser gate on the final code: **454 passed, 50 skipped by design, none failed** (1.4 h);
  the focused arrival, Operations, planner and journey specs 66 of 66 before it.
- The page against the evaluator on every held-out route-15 journey: 2,078,969 answers, 5 of them
  1 ms apart. The nightly evaluation re-run with the stop numbering fixed: outbound identical on all
  8 days.
- Served: byte-identical build, `/preview/` 401, the collector the same process throughout; the inbound
  15 journey timed and unchecked where it had said "15 min early"; a live outbound 15 with no minutes;
  Operations' memory rows; BNML 732 offered on no trip along its own stops (4 of 4 with the list
  lifted). Emulation only.

## 28 September, afternoon: the planner's correctness and the nightly jobs' reliability

**Deployed: `ab98f8c`, then `53f2232`** (the planner's age wording, and a smaller release kept for
rollback), with `ab98f8c` kept for `deploy/rollback.sh`. The account and the evidence are in
`docs/MILESTONE_2026-09-28_RELIABILITY.md`.

**What a passenger sees.**
- **Direct buses have times**: "Next: 23 08:09 from Norwood Road (nr) · at Mersey Road 08:33 · by the
  timetable, not live", every bus between the two stops counted, and the list in order of arrival at
  the destination, the last walk included. Whichever kind gets there sooner leads, a change counted
  as ten minutes; the other folds under one line with its soonest arrival ("Direct buses (1) ·
  soonest there 11:36"), with a chevron that says it opens.
- **A school service is offered when it runs** and leads only where it is sooner; a service closed to
  the public is never offered (from the first nightly rebuild after this deploy).
- **Walks said apart**: to the first stop (estimated, and "tight" when a bus leaves under 2 min after
  it), between the stops (checked before the list is shown, a few seconds at most, else "not
  checked"), and from the last stop (estimated, counted in the arrival).
- **A choice is never replaced**: if a walk checked after choosing breaks the connection, the card
  says "Your 256 at 10:33 no longer makes the 53 at 10:46 …", offers the one that works, and changes
  nothing until **Use this**.
- **Journeys with one change are found more often**: 48 candidates are timed where 8 were, which had
  hidden a sooner connection in about one sampled pair of places in five.
- **Operations shows the nightly jobs**: each one's last attempt (scheduled or by hand, and how it
  ended), its last success, and whether a scheduled run is overdue.

**Not changed, deliberately:** no estimator shown (the first full scoring passes outbound 15; its
release is held for the owner in `deploy/arrival-release-approval.json`); no second map; no redesign.

**Also in this release:**
- **The nightly jobs record themselves**, and the arrival evaluation's timeouts (a quadratic step since
  22 September) are fixed: by hand on the server it took 2 min 44 s at a 684.5M peak. The timetable
  rebuild, run here on the server's own inputs, reproduced the served catalogue exactly. Both run
  unattended from 29 September, 02:43 and 03:12 UTC; Operations will show each result.
- **A deploy and a rollback leave every file the server writes alone** (the jobs' record and the
  nightly outputs had not been protected by the rollback), and the release kept for rollback no longer
  copies the warehouse (111 MB, from 4.1 GB).

**Verified.**
- Node: 306 tests, 10 of them the planner regression set. Python: 155. Typecheck; lint with no errors.
- The full browser gate: 443 passed, 50 skipped by design, 1 failed, a motion check that started as
  this machine woke from a 61-minute sleep (it read a report as 3,765 s old); `motion.spec` then 24 of
  24 on the same build. `plan.spec` and `connection.spec` 26 of 26 on `53f2232`.
- Served: byte-identical builds, `/preview/` 401, no imagery key; both journeys walked on real buses at
  both sizes (section 7 of the record); Operations read at both sizes; the collector's process
  unchanged through both deploys. Emulation only.

## 28 September: follow both legs of your journey

**Deployed: `e3c760b`**, with `3c81756` kept for `deploy/rollback.sh`. The release before the feature
was `5736b2a`; the feature was first released the same day (`f27d6ea`, `d0ad985`, `cbceb2e`), and the
second half (`7d4862c` to `e3c760b`) corrects what real morning buses showed. The account and the evidence are in
`docs/MILESTONE_2026-09-28_CONNECTION.md`; a first-time tester's walkthrough is
`docs/CONNECTION_WALKTHROUGH.md`.

**What a passenger sees.**
- **Plan a journey offers journeys with one change**, from the timetables held, after any direct
  bus, soonest at the destination first, each with its next connection by the timetable: "263 → 53 ·
  one change at Trafford Bar · Next: 255 06:42 from Davyhulme Road East (nr) · at MediaCityUK 07:03 ·
  by the timetable, not live". Beside a direct bus they fold under "Journeys with one change (N)".
  Before, a two-bus journey read "Journeys with a change are not planned here".
- **A leg is every bus between its two stops**: "Take the 263 (or the 255) towards Piccadilly
  Gardens". Its times, its tracked buses and a restored link read them all.
- **Choosing one gives one card**: take the first bus (from where, get off where) → walk to the
  second boarding point → take the second bus (get off where); the next step marked *now*; the next
  connections by the timetable, an earlier bus that makes the same second bus named on its row;
  **I’m on the first bus** and **I’ve changed buses**, each with a correction; *Show whole journey* /
  *First bus* / *Next bus*; *Other journeys*; *Share*; *End*; *Details*. On the first bus its times
  become the second bus's from the change; on the second, there are none.
- **The page's stop follows the journey**: the first boarding point, the stop to get off at, the
  last. No vehicle has to be chosen.
- **One map**: both legs, the numbered stops, the walk and the tracked buses of both legs, framed on
  request only; a report arriving never moves it.
- **Tracked buses say what they are**: tied to this journey by its operator's own reported
  departure; on another journey, named by its time ("the 06:19 by the timetable"); unidentified; or
  none ("that is not ‘no bus’"). Never minutes, never "you’ll make it".
- **A timetable known to be wrong gives no times**: inbound 15 runs 15 min ahead of its buses
  (`schedule-anchor.json`), and a journey on it shows its steps and the reason instead (withdrawn 28 September 2026, evening: an artefact of the check pairing its stops 14 out; inbound 15 is unchecked now, `docs/MILESTONE_2026-09-28_ARRIVAL_PILOT.md` §6).
- **The walk between the stops is provisional until checked** with one request to the pedestrian
  router (two stop positions, nothing about the passenger); the card then recomputes and says what
  changed (Trafford Bar: 50 m in a straight line, 230 m and 3 min by the router).
- **Ride-along keeps the other leg in view** with a focus switch that never moves the stage.
- **Both planners search every stop within the 900 m walk they state**, where they had searched the
  14 nearest, 130–460 m in practice: Hillingdon Road → Withington Community Hospital now finds the
  direct 23 from Norwood Road, 418 m away, where it said there was none.

**Also in this release, found on the server during the deploys** (`ee3f4d0`): the nightly
timetable rebuild had stopped on a BODS error page the collector stored as a timetable (the
collector now keeps such bytes apart; the rebuild skips an unreadable snapshot and names it), and
the nightly arrival evaluation had failed on five nights since the stored departures gained their
rule (it reads them by position now). Both run again at 02:41 and 03:10 UTC on 29 September.

**Not built, deliberately:** no new estimator (nothing has passed the arrival criteria; nothing
withheld before is shown now); no two-change journeys; no accessibility claims (not in the data);
Watch both (a second map halved both maps' frame rate on this renderer, SwiftShader on this
machine's CPU; that bounds nothing on a phone in either direction: the record has the numbers).

**Verified.**
- Node: 290 tests (14 on connections: the refusals measured stop by stop, a leg's family and its
  restoration, folding, ranking by arrival including the last walk, the onward times, a misleading
  sibling left out, midnight and the next day, the binding rule). Python: 144 (the unreadable
  snapshot, the refused error page, the evaluation's departures). Typecheck and lint clean.
- `connection.spec` (14) and `plan.spec` (8) on the final build: 22 of 22 — a working scheduled
  connection, the list's own times, a transfer that fails once the walk is checked, missing and
  unnamed second-bus tracking, incomplete coverage, a known timing-quality exclusion, the stages with
  their times, a reload, a look at another bus, the ride and its focus switch, folding beside a
  direct bus, no reframing across three publications.
- The full browser gate on `7d4862c`, the second half's first build: 434 passed, 50 skipped by
  design, none failed (1.4 h). Each later change: `connection.spec` and `plan.spec` 22 of 22 on its
  final build.
- The served site: `bb563ea`, `ee3f4d0`, `3c81756` and `e3c760b`, each byte-identical to the local
  build, `/preview/` 401, no imagery key; the journey walked on real morning buses at 08:30 and 08:50
  (the list's next connections, both legs' buses tied to their journeys, the onward 53s on the first
  bus, the ride and its switch to the next bus, no page errors).
- Real data: the morning's journeys through the served boards (`scripts/probes/connection-real.mjs`),
  and this build on the server's own data at both sizes (`outputs/connection/after2.mjs`).
- Emulation only; no real passenger has tried it.

## 27 September, evening: the map's credit back on phones

**Deployed: `5736b2a`**, after `bf33c80`, which is kept for `deploy/rollback.sh`.

**What a passenger sees.**
- **The basemap's credit is on every phone again**, as one readable line of links:
  "© OpenStreetMap · OpenFreeMap · © OpenMapTiles", 10.5 px, at least 5.8:1 against its ground. From
  22 September an upright phone showed no credit at all: the phone workspace hid it (`display:none`)
  rather than place it above the sheet, and that rule reached the ride too.
  - Upright, it is the map's last line, just above the sheet at each of the sheet's three heights.
  - With the sheet expanded, the sheet stops 22 px lower (`CREDIT_STRIP`), so the credit has a strip
    under the search.
  - In the ride and the front view it sits under the card, clear of the home bar.
- **The credit says what each provider asks for** (read 27 September):
  - OpenStreetMap's guidelines: a credit in a corner of the map, readable without interaction, with
    "OpenStreetMap" linked to its copyright page;
  - "© OpenMapTiles", from the OpenMapTiles licence (the © had been missing everywhere);
  - OpenFreeMap, named.

  Computers keep "© OpenStreetMap contributors". Phones say "© OpenStreetMap", which the guidelines
  accept, so the line is whole on a 360 px screen.
- **A phone on its side:**
  - the workspace fits the screen above the home bar (it ran 11 px past the bottom edge, and a heading
    meant to stand down still showed);
  - the ride is full screen, as upright (it had stayed in the map's column, its card over its own Exit at
    667 px);
  - at 667 px the credit takes two lines, with the map's foot a line higher.
- **Moved to make room.** On an upright phone:
  - the map's foot (legend and Ride along) and "Find stops around here" stand 18–20 px higher;
  - the ride's card stands 4 px higher;
  - with the sheet expanded, the view and tool buttons it covered stand down.

**Verified.**
- `tests/browser/attribution.spec.mjs`, 9 checks on desktop and phone:
  - upright at 390 × 844 with a notch and home bar emulated: the sheet at half, folded and expanded,
    City, the ride and the front view;
  - upright at 360 × 740, 375 × 667 and 390 × 664;
  - on its side at 667 × 375, 740 × 360, 844 × 390 and 932 × 430;
  - a computer.
- Each check requires the credit to be:
  - displayed, at least 10 px, and at least 4.5:1 over black and over white;
  - one whole line (two at 667 px), on the map, and clear of the notch and home bar;
  - clear of every control, on top at both ends and the middle of each link, and linked to the three
    providers' pages.
- On the deployed build (`bf33c80`), every one of these checks failed.
- Node: 276 tests.
- The full browser gate on the first candidate: 419 passed, 50 skipped, 1 failed. The legend, then
  lifted 26 px, touched the 3D-model notice by a pixel at 390 × 844. It now lifts 20 px. The 14 specs
  that touch the foot, the credit, the sheet or the notice, re-run on the phone profile: 126 passed,
  7 skipped, none failed.
- The served site:
  - 9 of 9 attribution checks pass against it; all 9 failed there on `bf33c80` an hour before;
  - with real data at Mancunian Way, the credit is whole, on top and linked: upright at half, expanded,
    folded and in the ride, and sideways on the map and in the ride;
  - the build is byte-identical to the local one, `/preview/` is still locked, and no Google imagery
    is offered.
- Emulation only.

**Found and left:** at 667 × 375 on its side, the legend chips and Ride along overlap the tool column,
and the ride-offer chip is cut short at the column's edge, as before this change (backlog 37).

## 27 September: the front view's roads at their width, the server's memory held, every repositioning's reason true

**Deployed: `bf33c80`**, after `1419704` and `7753031` the same night; `7753031` is kept for
`deploy/rollback.sh`. The account and the measurements are in
`docs/MILESTONE_2026-09-27_ROADS_MEMORY_REASONS.md`.

**What a passenger sees.**
- **The front view's roads are drawn at their stated widths**, twice what they were. The conversion used
  a 256-pixel tile's scale on MapLibre's 512-pixel world. One tested function, `lib/scale.ts`, now
  serves every caller. A browser check confirms that on-screen distance matches the reports' metres to
  within 2%.
- **A bus moved rather than followed says truly why.** The deployed drawing gave five kinds of wrong
  reason, found by tracing single buses and then by tagging every repositioning on two reels with the
  branch that made it. Each is fixed, with a test that fails on the deployed code.
- **On touch, a tap on the dashed trace chooses the bus**, and its card says why on a line of its own.
- **A bus back from a silence longer than the published trail stands where it was drawn** until the
  drawing reaches its new report. The deployed code moved it as soon as the report arrived.

**The 131 m repositioning** was 108 m of necessary recovery from a seven-minute gap in the bus's reports,
and 23.5 m of drawing defect: the new report, made at the stand behind its road's start, was clamped onto
the road. It is now one move of 108 m, to the report itself. The deployed journey change blended two
journeys, placing the old journey's reports on the new journey's road; it now finishes the old journey
and bridges from where that left the bus.

**Server memory.**
- **Before:** the collector, the refresh and the evaluation had ceilings; a login session, and so any
  manual diagnostic job, had none.
- **Now:**
  - each user's logins together are held to a 900M hard ceiling. A soft limit beside it was tried first:
    on the server it slowed a runaway to a crawl rather than stopping it, so it was removed;
  - the collector is the last process the kernel would take, and the arrival evaluation the first;
  - `deploy/server-job.sh` gives a deliberate job its own ceiling and disk scratch, refusing `/tmp`.
- **The deployment check** now fails on a misspelt directive, which it had passed silently.
- **Checked on the server, bounded by the ceiling under test:**
  - a 1,000 MB allocation typed at a prompt was killed in 1 s inside the login slice;
  - a 1.2 GB file write completed under the same ceiling;
  - a wrapper job was killed at its 64M ceiling in its own scope;
  - the collector kept its process and priority (−500) throughout, with no machine-wide out-of-memory
    line.

**The collector's stop.** Restarting the collector for this release, its SIGTERM was swallowed, and
systemd killed it 30 s later. Reproduced against a copy of the warehouse
(`scripts/probes/stop-sweep.py`): DuckDB's batch insert of positions lost the stop in 8 and 9 of 19
signals landing there. The handler now records the stop and the loop acts on it (`7753031`). The same
sweep: none of 19 lost. Two restarts on the server then stopped cleanly.

**The preview tunnel** of 22 September is stopped, after checking nothing depended on it.

**Verified:**
- 276 Node and 141 Python tests; typecheck; lint with no errors; `deploy/validate.sh`, now strict on
  unknown directives.
- The full browser gate: 409 passed, 41 skipped by design, 2 failed. The two were one check whose setup
  relied on the old instant move of a bus with no trail; it now waits for the bus to arrive, with its
  assertions unchanged, and passed 6 of 6.
- On the served site:
  - the page and all 22 JS chunks are this build's;
  - the preview answers 401, and the public configuration has no `photo3d`;
  - the noon publications move BNSM 11930 once by 108.3 m, marked, and never cut 11918;
  - the front view's roads are at their width;
  - the trace-tap and scale checks pass on both profiles.
- **CI had been failing since 26 September, 17:59 UTC, unrecorded.** The cause was a false positive:
  the build-path test matched ArcGIS URLs and an emulated home inside the vendored Cesium bundle. It
  now looks for the building machine's own paths. Every other CI step passed throughout.
- Emulation only.

## 26 September, afternoon: the fleet's two jumps fixed, a private preview, the view ready for real imagery

**Deployed: `4d1f586`**, after `d35001d` and `c7179c8` the same afternoon; `c7179c8` is kept for
`deploy/rollback.sh`. The account and the measurements
are in `docs/MILESTONE_2026-09-26_PREVIEW_AND_JUMPS.md`.

**An incident first.** Reproducing the jumps, I ran a replay on the server with a scratch copy in `/tmp`,
which is RAM there. The kernel's out-of-memory killer took the collector twice, at 12:36 and 12:37 UTC,
losing about four cycles (two minutes) before systemd restarted it. Nothing was corrupted. The rule for
server-side work is now a hard memory cap (engineering opportunities, entry 60).

**The two jumps.** Two route-192 buses at the Piccadilly terminus stepped 54 m and 108 m in one frame.
The earlier record said 108 and 217 m, because the probe doubled every distance. Both were starting
their next journeys, and the fleet redrew such a bus from scratch at its new report.
- The drawing now carries across a journey change.
- 11918, which reported 41 s before its new journey, is drawn travelling between its reports.
- 11930, silent for seven minutes, is repositioned once and **marked**.
- Every other bus's repositioning is now marked as the chosen bus's always was: a dashed trace for 6 s,
  and the hover tip says so.
- Reproduced before and after on the same publications, through the fleet code at 20 poll phases,
  through the served and the new page, and for every bus in two reels. Cuts over 3 m in 100 ms went from
  141 and 130, all unmarked, to 108 and 88, all but one marked; the one left is the open 6 m hop at a
  path joint.

**Configuration, private preview, public release.**
- A Google key on the server no longer publishes the view. It opens only a password-protected
  `/preview/` of the same app, locked until the owner sets a password with
  `deploy/set-preview-password.sh`.
- The public page needs `LM_PHOTO3D_PUBLIC=1` as well, which is off.
- The terms question, the draft question for Google, and the attribution, privacy and video rules are
  in `docs/PHOTO_3D_TERMS.md`.
- The trial plan is in `docs/PHOTO_3D_PREVIEW.md`: one root tileset request per opening, a
  recommended daily quota of 25, and $0.00 a month at most.

**The view, ready for real imagery.**
- Failures are said by cause: quota, refusal, no answer, failing tiles, an ended session.
- *Closer* is offered beside the elevated follow.
- The imagery's age is said apart from each report's.
- Google's logo, terms and privacy notices are shown.
- The view draws the map's own bus at the map's own moment.
- Drawing only the buses in reach cut its tick from 10–12 ms to about 1 ms on the recorded noon fleet.
- A harness for the first look is ready (`scripts/probes/above-imagery.mjs`). **Real imagery is not yet
  seen: that needs the key.**

**Everyday.**
- The bus card's five-sentence motion explanation folds behind *How it is drawn*; a repositioning stays
  said in view.
- The phone handle's long status is cut short instead of running under the refresh button.
- Usability remains unvalidated: no fresh user has tried it, and two short tasks for the first testers
  are in the record.

**The gate's failures, fixed rather than classified**, as the owner asked:
- **Return to bus could settle at zoom 14.2.** A glide stopped part way by a camera move the ride did not
  start was taken for an arrival. A short glide now ends with a cut to the framing.
- **The front-view check measured the look-at point.** That point runs ahead of the bus by a
  speed-dependent distance. The check now measures the camera's own position.
- **The collector could not stop cleanly during a warehouse query.** Stopping mid-query exited 1, and a
  stop during the timetable matching was even swallowed until systemd killed it. Both paths now stop
  cleanly, and the server's last two restarts exited 0.

**Verified:**
- 266 Node and 140 Python tests; typecheck; lint with no errors; `deploy/validate.sh`, 43 checks.
- The full browser gate on `d35001d`: 403 passed, 41 skipped by design, 2 failed. Both failures are
  fixed in `c7179c8`.
- On the final build: `ride.spec` 51 passed with none failed; the four once-failing checks 40 of 40
  over five runs on both profiles; the 16 other ride-related specs 221 passed, none failed.
- On the served site: the pages are byte for byte the build's; the preview answers 401; the public
  configuration has no `photo3d`.
- The noon publications replay through the served site with one marked cut and no unmarked one.
- A real ride on both profiles returns to zoom 20 after a drag and *Return to bus*.
- Emulation only.

## 26 September: simpler everyday use, and the view from above

**Deployed: `b849bbf`**, with `7dd79be` kept for `deploy/rollback.sh`. Two purposes in one app, kept
apart on the page: everyday travel first (find the stop, see what is coming, follow a bus), and
exploring Manchester after it (ride along with a bus; and, where the server is set up for it, the city
from above as photographic 3D). The account and the measurements are `docs/MILESTONE_2026-09-26_SIMPLER.md`;
the research and the decision on photographic 3D are `docs/PHOTO_3D_RESEARCH.md`.

**The three points of confusion, and what changed** (walked on the deployed `7dd79be` at phone and
desktop sizes first; frames before and after in `outputs/probes/passenger-layouts/`):
1. **Which side of the road.** A stop said *eastbound · Kingsway*, and a search for "Stretford Mall"
   offered Stops A, B and C with only a compass word to tell them apart. Every offer of a stop — the
   search results, *Stops near you*, and the chosen stop's head — now says where its buses go today:
   *to Piccadilly Gardens (15, 255, 256) · to The Trafford Centre (250)*, the busiest destination first,
   the compass word and the street after it. One helper (`servicesAt`, `towardsWords` in
   `lib/patterns.ts`) gives all three the same words.
2. **Two answers to "when?".** The stop page gave a scheduled board (*11:10 · in 7 min · SCHEDULED*) and,
   further down, a tracked bus (*8 stops before yours · 38 s ago*), with nothing joining them. Where the
   tracked bus is on that very timetabled journey — the one case the board can tie a vehicle to — the
   row now carries it: *Tracked · 8 stops before yours · reported 38 s ago*, in the stop board's own
   words, so the time and the bus's real place are read together. The boxed *SCHEDULED* badge on every
   row, which wrapped each row onto three lines on a phone, is the word *timetabled* beside the time;
   the board's heading keeps its badge, and the basis line is unchanged.
3. **What the home is for.** *Or follow a route* offered a Route dropdown *and* a Direction dropdown
   under a route panel that already had direction chips: two direction controls for one choice. The
   Direction dropdown is gone (the chips choose the direction; the Route dropdown stays for browsing
   every route). The exploration block — *Explore Manchester · ride along with a bus* — now comes
   after the everyday sections rather than between them, and holds the view from above where it is
   offered. *Change* under a stop reads *Change stop*.

**The view from above** (`components/gods-eye.tsx`, loaded only when opened): Manchester as previously
captured photographic 3D imagery — Google's Photorealistic 3D Tiles, rendered by CesiumJS from this
site's own copy — with the same buses on it that the map draws, at the same drawn places. Open on the
city from 1,400 m; tap a bus and the camera descends behind it and follows; look around, *Return to
bus*, *Exit* to the map with the same bus, stop and journey. The bar says what it is in one line:
imagery captured earlier, not a live camera; buses where their reports put them, a little behind.
**It is offered only where the server is configured for it, and this server is not yet**: the tiles need
a Google Maps Platform key with billing, which is the owner's to create, and the terms' *no use with
non-Google maps* clause has to be read before the view goes public. Both are laid out in
`docs/PHOTO_3D_RESEARCH.md` §5, with the cost at the provider's own units (1,000 openings a month free,
then $6 per 1,000; the daily quota is the control that bounds it). Until then the viewer was checked
against a sample tileset, labelled as one, and it passed its checks on both profiles: the renderer ready 0.8 s after the tap on this machine, the
tileset usable at 0.9 s, nine buses drawn at a 0.6–0.9 ms tick, the descent to the chosen bus, the
follow released by a drag and restored by *Return to bus*, and the map as it was on leaving. **Decision:
revise** — sound and cheap, but not judged on the imagery and not to go public before the terms are
read; `docs/MILESTONE_2026-09-26_SIMPLER.md` §5.

**Verified:** 261 Node tests and 134 Python tests; typecheck; lint with no errors; the full browser gate on the
candidate **387 passed, 41 skipped by design, 2 failed in 1.2 hours** (Chromium with SwiftShader, desktop
and phone emulation). The two: the ride's drag-during-glide race (backlog 29's known intermittent; passed
on re-run) and the sign-tap check, whose logging this time showed the cause — the tap chose nothing,
because the signs' on-screen points are refreshed at the map's *idle*, which under load lags the
camera's rest by seconds; the points are now refreshed at `moveend` too, the check waits for them to
settle, and it passed 3 of 3 on both profiles with the view's checks. After that a build with three small
tidy-ups (the view's event handler destroyed on leaving, a lint fix, the probe's audit) was the candidate:
`above.spec` and the sign-tap check passed on it, 24 of 24. **Deployed as `b849bbf`**, the served page
chunk identical to the local build's (`43ebca86…`), `7dd79be` kept for rollback; the served
`config.json` carries no `photo3d`, so the view is not offered on the public site; the renderer's files
are served (`/vendor/cesium/version.json`, `Cesium.js` 6.0 MB). On the served site at 12:03 UTC (corrected: this said 12:50): the three
changed screens captured (`outputs/probes/everyday-flows/served-b849bbf/`), and the fleet still drawing
485 buses, 316 in view and 234 moving at a 1.3 ms tick at a city zoom, a tapped grey bus becoming the
chosen bus with no hop (*Standing · as it was about 60 s ago · report 43 s old*). Seen on the way and
left open: at a neighbourhood zoom two other buses stepped 54 and 108 m between two samples a quarter of
a second apart (corrected: the probe converted pixels with a 256-pixel tile's scale on a map of
512-pixel tiles and reported 108 and 217 m). Traced the same day to two route-192 buses starting their
next journeys at the Piccadilly terminus, which the fleet redrew from scratch; fixed in the release after
this one (`docs/MILESTONE_2026-09-26_PREVIEW_AND_JUMPS.md`). Emulation only.

## 25 September, night: every bus on the map

**Deployed: `7dd79be`**, with `a63006b` kept for `deploy/rollback.sh`. The owner, riding the served
site from a bus link with no stop chosen, saw one bus on the whole map and asked for all of them. The
map had drawn only the chosen bus's route (or, at a stop, that stop's board), each at its newest report,
stepping to the next at every poll. Every phone already receives the whole publication, so nothing
more is fetched: **every bus in the publication is now on the map, each drawn from its own reports**
exactly as the chosen bus is (`lib/fleet.ts`: the same PLAYBACK, one drawing everywhere).

What that is, in the passenger's terms:
- **The city moving.** Each bus moves between its reports at a bus's pace, a little behind its newest
  report, and stands there until the next one. Nothing is predicted. Only the buses in view are played
  back each tick — ten times a second at map zooms, every frame from a street zoom — and the rest
  stand at their newest report until they come into view.
- **Your buses lead the eye.** The buses of your stop or your route are drawn a size larger and darker
  than the rest; the chosen bus is the only lime thing on the map, as before. Route numbers appear
  from neighbourhood zooms (your own buses a zoom sooner), giving way to each other where they crowd.
- **Tap any bus.** It becomes the chosen bus, and its drawing is handed over rather than restarted, so
  the bus does not move when you choose it (and is handed back when you choose another). A mouse
  over a bus names it: route, destination, report age.
- **In the ride, the buses passing are buses.** From the model's zoom the nearest twelve other buses
  are drawn as 3D buses in a muted grey livery, facing the way they are drawn moving. From a street
  zoom the checked roads of the buses in view are loaded a few at a time (each a few KB), so they are
  drawn down their roads rather than the chords between reports.
- **The map says what it is.** The legend counts the buses (*234 buses*; on wide screens — on a phone the
  chip wrapped into the map's notices, so the count lives in the map's accessible name there), the heading reads *Every bus
  reporting in the area, drawn from its own reports a little behind them*, and the map's accessible
  name says the same. Under reduced motion every bus stands at its newest report.

**Measured.** In Node, 200 synthetic buses stepped in under 25 ms a tick; in Chromium, 124 fixture buses
with 91 in view and 89 moving cost 0.5–0.6 ms a tick at the median (MapLibre's re-tiling of the source
runs in its worker and is not in that figure); buses in view travelled 42 m in 6 s at 7–11 m/s between
samples, never faster than a bus; a tapped bus was 2–6 m from where the fleet had drawn it, the bus's own
movement in the moment between; in the ride, 2 and 1 other buses were modelled beside the ridden one.
On the served site at 22:52–23:00 UTC (`outputs/probes/incident-43/served-fleet.mjs`, the live
publication of 156–159 buses, emulation): at a city zoom (12.2) on a desktop **158 buses on the map, 109 in
view, 79 drawn moving**, the fleet's tick 1.1 ms at the median and 1.6 at most; at a neighbourhood zoom
(15.2) 29 in view, 16 moving, 0.5 ms; 59 of 80 buses tracked over 20 s moved more than 5 m, the largest
movement between two samples a quarter of a second apart one or two pixels (28 m at 20 m a pixel), where a
step to a newest report would be seven. On a phone at the city zoom 156 buses, 46 in view, 29 moving,
0.6 ms (the probe's zoom presses did not take on the phone, so only the city zoom was measured there). A
grey bus tapped on the desktop (YN61BFV, a 143) became the chosen bus, its card reading *Off its checked
road · as it was about 60 s ago · report 44 s old* — the new label, live. The served page chunk was
identical to the local build's (`fb26e93d…`), `a63006b` kept for rollback. Try Ride-along's three offers at 22:55 UTC (a 143, a 250 and a 192), ridden 60 s each on the served
site (`served-offers.mjs`): none lost its heading or was repositioned, each moving in 84–100% of samples
with no step over 4 m between them, the camera turning at most 28° a second, the cards reading *Moving
between its reports · as it was about 60 s ago · report 55 s old*, *Standing · as it was about 40 s ago ·
report 39 s old* and, for one drawn within a few seconds of its report, *Moving between its reports ·
latest 42 s ago*.

**Not done, and why.** The other buses' small eased corrections (a rebuilt path moving a bus a few
metres) are not said anywhere: the chosen bus's card says its own, and one line per bus for two hundred
buses is noise. No trails or route lines for the other buses: their roads are loaded for movement, not
drawn. A real phone's frame rate and battery with a hundred buses moving is the first thing to check in
hand (`docs/PHYSICAL_DEVICE_CHECKLIST.md`); SwiftShader measures the JavaScript, not the GPU.

**Verified:** 258 Node tests (`tests/fleet.test.mjs` among them); typecheck; lint with no errors; the
full browser gate on the fleet build **380 passed, 41 skipped by design, 3 failed in 1.2 hours** (Chromium
with SwiftShader, desktop and phone emulation). The three: my own new movement check judged a step by
pixels at a wide zoom (one pixel is five metres there; it now measures metres from the drawn position
over the time the sample took, and reads 7–11 m/s for buses moving at 7); the *N buses* chip wrapped the
phone's legend into the model notice (hidden on phones now; the map's accessible name keeps the count);
and a sign tapped on the map once did not change the stop (desktop) — it passed 4 of 4 re-runs with the
tap logged (chooser closed, a bus not chosen, the new stop shown), so the cause is not known and it is
left open as intermittent. The three small changes after the gate (the fleet labels restyled on a theme
switch, the tap diagnostic carrying positions, the phone chip) were covered by a focused run of the specs they touch (map, journey, layout, fleet, chooser, selection, access,
passenger): **111 passed, 17 skipped by design, none failed, in 14.8 minutes** on the deployed build. Emulation only.

## 25 September, late evening: what the card's delay measures, and what a rewind moves

**Deployed: `7dd79be`**, focused corrections on `a63006b` (kept for `deploy/rollback.sh`); the feature
scope is unchanged. Both questions were measured on every bus in both reels, ridden as the page rides
it (`scripts/evaluate-delay-rewind.mjs`): the 22 September evening reel, 335 bus-journeys and 2.8
million frames; the 24 September incident reel, 810 bus-journeys and 8.8 million frames.

### 1. The card's figure is measured from now, not from the latest report

It is now less the moment the drawn place stands for: the last moment the bus's reports had it at that
place. So it **includes** the latest report's age. While the bus moves between its reports:

| | evening reel | incident reel |
|---|---|---|
| the figure (10th / 50th / 90th percentile) | 53 / 57 / 61 s | 47 / 51 / 54 s |
| the latest report's age | 36 / 46 / 54 s | 32 / 40 / 48 s |
| what the playback adds beyond the report | 2.7 / 10.9 / 21.1 s | 2.4 / 10.1 / 19.4 s |
| frames where the figure was under the report's age | 0 of 1.8 million | 0 of 6.1 million |

**The record said the ride is "30–60 s behind the newest report". That was wrong.** 30–60 s is how far
the clock is set behind *now*; behind the newest report the drawing is about ten seconds at the median.
Corrected here, in the milestone record, the motion model and the phone checklist.

- **A defect, fixed.** While the bus waited at its newest report, the clock runs up to 24 s past it (the
  smoothing window), and the figure followed the clock. It fell under the report's own age in 946,754 of
  979,609 waiting frames on the evening reel and 2,689,171 of 2,798,496 on the incident reel. The label
  then gave the report's age, correctly, but the sentence under it could say *drawn where its reports
  put it about 5 seconds ago* of a report 20 s old. The moment drawn is now never later than the newest
  report: 0 and 0.
- **The wording now gives the two ages separately.** The label reads *Moving between its reports · as it
  was about 45 s ago · report 18 s old* (likewise *Standing · …* and *Off its checked road · …*). The
  sentence reads *It is drawn where its reports put it about 45 seconds ago: its latest report is 18 s
  old, and the playback draws it about 30 s behind that report …*. Where the playback adds under 3 s,
  the label gives only the report's age (*latest 18 s ago*). That way rounding to fives never makes the
  moment drawn look newer than the report (a Node test over every pairing up to 150 s). At its newest
  report the label reads *Last reported position · 18 s ago*.

### 2. A rewind moves the clock, never the bus

A report can arrive saying the bus had got further than it is drawn: a late report filed between two
already drawn, or the next report after a wait. Then the moment the clock shows would be 15 m or more
ahead of the drawn place. The clock is set back, in one step, to the drawn place's own moment. The drawn
bus keeps its place and pulls away at its reports' pace; before this, it raced to catch up (a 119,
135–300 m). **No position is rewound, so none needs a transition.** The only thing that changes at that
instant is the card's figure, which grows, because the drawn place is older than it was taken to be.
The time is then made up at no more than 5% of real time, or at a stand. If the clock would have to go
back further than the 15 s allowance, the bus is instead repositioned forwards, cut, and the card says so.

**Measured:** the clock was set back 307 and 669 times. The drawn bus went back along its own path in
**0 frames**, in the 5 s after a rewind or anywhere else.

That measurement also looked for anything else that moves the bus against the way it faces, and found
two faults, both fixed:
- **A rebuilt path could re-anchor the bus on the wrong pass of a road used twice.** When a publication
  changed the reports (even only by dropping the oldest one), the drawn place was projected onto the
  whole road near it. On a route that runs one street twice, the projection took the other pass. The
  bus then went to its stretch's start and was eased there, with nothing said. A V2 went 36 m back
  along its road, facing forwards, where no report had moved. A 21 at its terminus was eased 48 m with
  its nose already turned to the return leg. 19 eased corrections on the two reels moved the bus against
  the way it faced, the largest 40.3 m (the 21) and 36.8 m (the V2). 9 of them started on the same frame
  as a rewind, because the same publication triggers both. The bus is now measured against its
  own stretch of road: 13 remain, none over 6.6 m. `tests/delay-and-rewind.test.mjs` replays the V2's
  own reports: 35.9 m back on `a63006b`, none now.
- **Arriving at a standing goal took the bus to it even when a path change had left it just ahead**: a
  step back of up to 0.44 m with nothing said (9 and 15 frames), with nothing in the code to bound it.
  It now stands where it is: 0 and 0.

What still moves against the facing after both fixes (frames, metres in all):

| cause | evening | incident | what it is |
|---|---|---|---|
| the nose still turning while it moves forward | 38, 25.6 m | 113, 76.3 m | round a tight bend at speed (a 191 at 14 m/s): it goes forwards and its nose lags |
| an eased correction onto a changed path | 9, 6.9 m | 30, 26.4 m | 4 and 9 corrections with a backward part, largest 3.8 and 6.6 m; not said on the ride card |
| a hop at a joint between two stretches | 2, 6.5 m | 3, 7.0 m | a straight stretch ending at a report, a road stretch starting on the road beside it (a 23: 6 m) |
| following reports that step back, no road | 1, 0.3 m | 20, 7.1 m | the reports themselves go back a few metres (a 281: 6.5 m in 10 s) |

None of these comes from the rewind; they are backlog 32. The one-ride milestone's fault breakdown is
unchanged in group A (0 unsaid steps; the sprints 15 and 10); in B two more stands, and in C what the
corrected figure now counts (the milestone record's footnote).

**Still open, and not touched here:** the **25 sprints** (15 and 10 events, 3–4 s after a stand); the
heading lags pulling out of a stand (6 and 18) and the one spin; the four kinds of movement in the table
above; backlog 30 (*off its checked road* at termini); the round token until a bus with no road and no
bearing has moved; and everything a phone in hand would show.

**The clips**, git-ignored on this machine. Both are the same 230 s of the 250 inbound (MF74NNW,
22 September 21:15 UTC), replayed through the page from the served publications, before (`a82abfb`) and
after (`a63006b`) side by side: **at normal speed**,
`outputs/probes/incident-43/ride-250-before-after-1x.webm` (3 min 53 s), and accelerated,
`ride-250-before-after-2x.webm` (1 min 58 s). Both are the page drawing in real time, recorded at 25 frames a
second and played side by side by one browser. The after side predates these corrections: its
card reads *drawn about 55 s behind*, and its drawing differs from the deployed one only in the two
fixes above.

**Verified:** 252 Node tests at the time (258 with the fleet's); typecheck; lint with no errors; the
46 browser checks that read the label and the drawing's 82 (ride, ride-offer, ride-quality, replay,
head-turn, recorded-ride, try-ride, the motion and front-view checks), 45 + 79 passed and 1 + 3 skipped
by design, on the build with these corrections; then the full gate on the night's build (the next
section). Emulation only.

## 25 September, evening: one Ride-along everywhere

**Deployed: `a63006b`**, with the previous release kept for `deploy/rollback.sh`. With the owner's
approval (backlog 31), every ride is drawn from the bus's own reports, however it is entered; the map
keeps the labelled estimate where the evaluation allows it; arrivals are unchanged. The drawing now holds
reports the evidence contradicts, sets its clock back for a late report instead of chasing, cuts at a
repositioning, and starts without a step. The account and the measurements are
`docs/MILESTONE_2026-09-25_ONE_RIDE.md`.
**Verified on the final candidate:** 247 Node tests; 131 Python tests; typecheck; lint with no errors; CI's built-site and deployment-syntax checks; the full browser suite **371 passed, 39 skipped by design, none failed, in 1.1 hours** on the final build (Chromium with SwiftShader, desktop and phone emulation). The first full run on the candidate before it failed 6 (three checks on both profiles): two were premises restated (the head turn waited for an estimate's correction inside the ride; Try Ride-along asserted a scored-road bus was not offered), and one was a fault of this milestone — a drawing begun afresh started from rest — fixed, not restated. On the served site a 250 and a 15 ridden from their stops, and Try Ride-along's three rides, were continuous: none repositioned, none without a heading, no step unsaid.

**Pushed to GitHub** with the owner's approval, without force: 22 commits, `0f2c719..2a61428`, each
reviewed for credentials, runtime data and recordings first. GitHub CI (`checks`, run 36175741336) passed
on `2a61428`: types, lint, Node tests and the static build; the Python pipeline tests; the deployment
configuration. It warns that the workflow's actions target Node 20, which GitHub is retiring (they ran on
Node 24). The served site runs `a63006b`; `2a61428` adds only this record.

**The demonstration**, one continuous ride, on a phone in its ordinary browser, by day:
1. Open **https://lost-minutes.duckdns.org**, search **Trafford Bar** and choose **Trafford Bar (by)**
   (westbound, Chester Road). The board lists the 250s coming, *N stops before yours* by each one's last
   report, and the scheduled departures.
2. Tap a 250 that is a few stops away, then **Ride along**. The camera goes to the bus; the card says
   *Moving between its reports · drawn about N s behind* (or *Standing* at a stop), and the board's
   answer — how many stops away — comes from its newest report, not from the drawing.
3. Ride it for three minutes: it follows its road, faces the way it goes through corners, stops where
   its reports stopped, and pulls away; a said repositioning, if one comes, is a cut with one line on
   the card. Try **Front view** and back to **Outside view**.
4. **Exit**: the map comes back with the bus estimated again, the same bus and journey.

**What still limits a ride:** it is 30–60 s behind the newest report and says so; a bus with no checked
road and no reported bearing is shown from above until it has moved a bus's length; a turn round on a
terminus loop with no road under it is drawn as it moves off; short heading lags remain pulling out of
a stand. Checked in emulation only.

## 25 September: a standing bus, a terminus loop, and suggested rides made clean

**Deployed: `a82abfb`**, with the previous release kept for `deploy/rollback.sh`. Three deploys in
one night, each found wanting by riding the served site or by a replay, and the account of each is
`docs/MILESTONE_2026-09-23_SHEET_PACING_DISCOVERY.md` §10, "The served check":
- **`cd711a3`**: a 216 standing at Piccadilly Gardens, 3.4 m from its road, had been called "Off its
  checked road", shown from above, and the ride camera swung 69° when its heading appeared; standing
  buses turned round on the spot as their reports scattered. Fixed in the drawing and the ride camera.
- **`1a53e48`**: riding `cd711a3` on the served site found a 263 on its terminus loop drawn backing
  along its road facing forwards, a fault of that change. Fixed, and a moving bus turns at its pace.
- **This release**: Try Ride-along offers only clean rides. A replay of every offer the list would have
  made, at every publication of two reels, found 2% of the offered rides clean over three minutes; the
  list led with estimated movement, which jumps. It now offers a bus drawn between its own reports,
  moving along its checked road, reporting steadily, with road left, and never a test vehicle: 79% and
  85% clean on the same moments, with an offer at 124 of 126. The drawn bus now faces along its own
  length through a corner rather than a bus's length ahead.

**Verified on the final candidate:** 238 Node tests; 131 Python tests; typecheck; lint with no errors; CI's built-site and deployment-syntax checks; the full browser suite **367 passed, 38 skipped, 1 failed in 60 minutes**, the failure backlog 29's drag-during-entrance race, which then passed 6 of 6 on the same build (desktop and phone emulation in Chromium with SwiftShader). The served page chunk was identical to the local build's, `1a53e48` kept for rollback, collector, web server and timers active. On the served site at 05:23–05:30 UTC, Try Ride-along offered three rides (a 50, a 142 and a 248, all on checked roads), and the three rides offered at the moments they were tapped were ridden for 90 s each: a 30 to Piccadilly Gardens, a 163 to Bury and a 197 to Chorlton Street. None lost its heading or was repositioned; the longest spell facing over 30° off its movement was 0.5 s; the camera turned at most 10.9° between samples; each said "drawn about 45–60 s behind". The frames show each bus on its road and facing along it. Emulation only; nothing on a phone in hand.

**Still so:** an offered ride is clean over its first three minutes about four times in five, not
always: a bus may stand at a timing point for over 45 s, its reports may reach us late (the card says
how far behind it is drawn), or a later report may leave its road. A 15, 250 or 256 chosen at its stop
and ridden is still drawn at an estimate, which jumps (backlog 31, a decision for the owner). At termini
and on loop routes the card can call a bus off its road where it is drawn along it (backlog 30). A
creeping bus can still turn up to about 37° in 5 s.

**Also check:** a bus standing at Piccadilly Gardens (a 216, 143 or 142 at its stand, from the map or
a stop there), ridden for a minute. It should face along its road and not turn while it stands, and
the card should not call it off its road. A bus with no checked road that reported no direction and
has not moved is shown from above, and the ride says so; when it moves off, the view turns round to
it over about a second rather than in one jump. And Try Ride-along's rows, each ridden for three
minutes: the bus moves along its road, faces the way it goes through corners, and does not jump.

## 24 September, night: the route-43 incident fixed

**Deployed: `5c00509`**, with the previous release (`2c00759`) kept for `deploy/rollback.sh`. A
passenger-acceptance failure — a route-43 ride that appeared to teleport and sat across its road — was
reproduced from the server's own captures and request log and fixed in the drawing; the account is
`docs/MILESTONE_2026-09-23_SHEET_PACING_DISCOVERY.md` §10. **Verified on the final candidate:** 231 Node tests; 131 Python tests; typecheck; lint with no
errors; CI's built-site checks; the full browser suite, **362 passed, 38 skipped by design, none
failed, in 59.8 minutes**, desktop and phone emulation in Chromium with SwiftShader. The served page
chunk was identical to the local build's. Ridden on the served site, it was right for a moving 192
and wrong for a standing 216 (above).

**What still limits a ride.** Every bus not on routes 15, 250 or 256 is drawn between its own reports
30–60 s behind them, and says so. Where a bus's reports arrive 40–60 s late the drawing waits at the
newest one and the card can read over 75 s for a while. A report more than 40 m off its road (50 m where its bearing
agrees with the road) is drawn where it was made, on a straight line said on the card. No
lane-level position anywhere. *Follow on the map* in 2D re-centres by its own rule, unchanged. None of
it has been seen on a phone in hand yet.

**The ride to check:** a 43 outbound to Manchester Airport from Piccadilly Gardens, ridden along
Portland Street, Princess Street, Whitworth Street and Oxford Street (Try Ride-along, or a 43 chosen
at Piccadilly Gardens (Stop H) or Charlotte Street (Stop CU)). The bus should face along its road
through every turn, the view should never swing round in one jump, and on the Whitworth Street–Oxford
Street corner it should stay on the road. Switch away for a minute and come back: the card says the
bus was moved while the page was in the background. The recorded before-and-after of the incident's
own publications is `outputs/probes/incident-43/incident-43-ride-before-after.webm` (and the top-down
one beside it), git-ignored on this machine.

## 24 September: the beta release

**Deployed: `2c00759`** (16:42 UTC), with the previous release (`f964c7d`) kept for `deploy/rollback.sh`. What
it adds since 23 September is in `docs/MILESTONE_2026-09-23_SHEET_PACING_DISCOVERY.md`: the phone
sheet that stays up, the ride paced at a bus's own pace and drawn on its road, Try Ride-along with
a dated recording, the road ahead lit in the ride, and (§9) the map returning to flat when the ride
is left even if a publication lands at that moment. **Verified on the final candidate:** 225 Node tests; 131 Python tests; typecheck; lint with no errors (12 warnings, all in files this work did not touch); the build; CI's built-site and deployment-syntax checks; and the full browser suite, **358 passed, 38 skipped by design, none failed, in 56.2 minutes**, desktop and phone emulation in Chromium with SwiftShader. On the served site: the map flat after leaving the ride with a publication landed, 4 of 4
(desktop and phone, with and without reduced motion). **Nothing has been checked on a phone in
hand**; `docs/PHYSICAL_DEVICE_CHECKLIST.md` is that check.

**Demonstrating the best supported experience** — on a phone in its ordinary browser, by day (steps
1, 2 and 5 corrected on 25 September 2026: Try Ride-along no longer offers estimated movement, whose
rides jump; see the release section above):
1. Open **https://lost-minutes.duckdns.org**. Under **Buses near me**, tap **Or try Ride-along**:
   the sheet opens on up to three rides, each a bus moving along its checked road now.
2. Tap a row (**Reported positions · may pause · Front view**). The camera settles behind the bus,
   the road ahead is lit under it with its next stops named, and the card says how far behind its
   reports it is drawn.
3. Tap **Front view** for the street ahead, then **Outside view**. Drag the map to look around;
   **Return to bus**. Tap **?** for what this is and is not.
4. Tap **Exit**: the map comes back flat and north up, with the bus.
5. The stop journey: search **Trafford Bar** and choose **Trafford Bar (by)**, on Chester Road,
   westbound (ATCO 1800SJ00311; eight stops share the name) — the 250 towards The Trafford Centre
   boards there 17 stops into its route, so several are usually coming. The board lists the tracked buses coming, "N stops before yours" by each
   one's last report, and the scheduled departures, labelled *Scheduled · not live*. Tap a 250 to show
   its card and progress, then **Ride along** (since the evening of 25 September every ride is drawn
   from its reports, backlog 31: the demonstration at the top of this record).
6. When nothing live suits (late at night): **Recorded ride · to Bury Interchange** in the same
   section, or the link `https://lost-minutes.duckdns.org/?ride=2026-09-23-bngn-3426-163`, badged
   RECORDED RIDE throughout.

What not to promise while demonstrating: an arrival time (none is predicted), a view from on board
(the front view is drawn from the map), or a live position (every drawn bus says how old its
report is, and a bus between its reports is drawn about 30 s behind them).

## 20 September: hosted, and the passenger's two questions answered as far as the data allows

**Deployed.** https://lost-minutes.duckdns.org — Hetzner CX23, Helsinki, Ubuntu 26.04.1, Let's Encrypt
on the first attempt, the collector under systemd. Everything in this section was checked on that
server or in Chromium on the built export. **Nothing on a physical phone.**

**What the first real deployment exposed, all fixed and re-checked on the server:** the upload
excluded `public/data` (an unanchored `data/` in the exclude list) and was 1.75 GB; no `deploy`
user existed; a fresh warehouse had no stops or patterns, so **0 of 307** buses matched until a
rebuild; a clean SIGTERM exit returned 130 and made every nightly pause a `failed` unit; the
watchdog's rebuild guard never fired (`is-active --quiet` exits 3 for a running one-shot) and was
reproduced as **4 collector restarts in 3 minutes**. Recovery from `SIGKILL`: publishing again in
**25 s**. **The unattended 03:40 rebuild has not yet fired and is left open.**

**"How long is my walk?"** — the start is now judged, not assumed. A fresh fix at best accuracy,
never cached, with its accuracy and timestamp kept; confidence in bands (under 40 m stated plainly,
to 150 m hedged as "about" with the doubt beside it, beyond that not routed; a tight fix over five
minutes old is stale); **Update my location**, **Choose starting point** on the map (kept for the
session, outranking the device until given up) and **Walk to stop in Google Maps** by the boarding
point's coordinates, never its name. The Kenwood/Norwood cause is not claimed: the page had recorded
nothing that could establish it. **18 browser checks pass, desktop and phone, FIXTURE.**

**"When will this bus reach my stop?"** — as far as the data allows, honestly labelled.

*Correction, later on 20 September.* An earlier note said naming a journey when several share a
departure carried "zero risk". The precise claim is narrower: **all retained candidate journeys at
that departure agree on the scheduled time at every stop, subject to the match and the timetable
being right.** Timing agreement establishes a time, not a unique journey. And the two live snapshots
quoted earlier (123 of 218 named, then 163 of 224) were different fleets at different moments —
consistent with the change, not evidence for it. The controlled comparison holds one stored
publication (16:51:36, 215 matched vehicles) and one catalogue fixed and changes only the rule:
**old rule 117 departure groups named, new rule 156, +39, 0 lost, 59 still refused** because their
journeys' timings differ. Groups and vehicles coincide in that publication only because each
vehicle's (pattern, departure) was unique there. `scripts/compare-scheduled-rules.py` reproduces it. The feed's
journey reference matches **0 of 114** timetable journey codes; its origin departure time matches a
current timetabled departure for **all 161 distinct route-15 times (16,310 of 16,310 observations)**.
Every timing link carries a `RunTime`, now read, so **all 576 patterns publish scheduled seconds per
stop**. The card shows **"Timetabled at your stop 07:11 · from the operator's timetable, not a
prediction"** only for a bus on one pattern, on one journey at that departure, with running times
declared to both stops, and still before the stop. **No estimated minutes are shown.** Ground truth
for an estimator exists — **2,025 (journey, stop) pairs** with a report within 40 m across 91
route-15 journeys — and the estimator with its held-out evaluation is the next step. Browser check:
**4 of 4 pass, desktop and phone, FIXTURE** — the time renders as 06:53 from a 06:49 departure plus 247 s, labelled not a prediction, the journey named in the evidence; a bus already past the stop shows no time.

**The arrival estimate: built, evaluated, and not released — by criteria fixed before the numbers.**
`docs/ARRIVAL_RELEASE_CRITERIA.md` was written first. Ground truth is **inferred stop passages** — a
crossing between two reports, timed by interpolation, uncertainty half the gap, scoreable only under
60 s and first visit: **4,014 on route 15, median gap 21 s (±10 s)**, against 3,932 within-40 m pairs
on the same journeys, which were never arrivals. Fit on 11–14 Sep; **scored once on 17–20 Sep:
63,397 moments, 44 journeys, 1,436 passages, two weekdays.** Only reports at or before each moment
were used; nothing from the drawing.

| Horizon | Moments | Progress baseline median / p80 / p90 (min) | Delay-adjusted timetable median / p80 (coverage) |
|---|---|---|---|
| 1-2 min | 4,237 | 0.59 / 1.50 / 2.43 | 0.96 / 2.03 (48%) |
| 2-5 min | 12,025 | 1.36 / 3.31 / 5.55 | 1.54 / 2.82 (48%) |
| 5-10 min | 18,275 | 2.69 / 5.87 / 10.36 | 2.13 / 4.05 (46%) |
| 10-20 min | 28,860 | 4.96 / 10.06 / 17.38 | 2.51 / 5.92 (43%) |

At the release band (2–10 min) the progress baseline reads **median 2.08, p80 4.84**
against thresholds of 1.5 and 3.0: **two of six criteria fail; not released.** Weekday alone:
median 2.09, p80 4.85. At Hillingdon Road (opp): median 1.97, p80 2.85 on 334 moments.
**The better approach, with evidence:** beyond five minutes the **delay-adjusted timetable** beats the
progress baseline (2.13 vs 2.69 at 5–10; 2.51 vs 4.96 at 10–20) but covers under half of moments and
misses the p80 bar. The next estimator should be that, corrected by observed progress near the stop.
**Nothing is shown to a passenger.** A nightly unit on the server (`lost-minutes-arrival-eval`, after
the timetable rebuild, collector paused) infers passages and re-scores on the server's own reports,
so weekday evidence accumulates under `data/` where no page reads it. **What is missing:** more
weekday journeys at peak — the held-out set has two weekdays — and the delay-adjusted method
implemented as the candidate.

**The inbound discrepancy, traced end to end (20 September, later).** Three real journeys followed
by *vehicle*, not by journey key, because a key's first appearance is not a departure. `MF74NNG`,
Sunday 13 September: still driving its outbound (aimed 12:18) at 12:53, 6 km from the terminus;
reached the terminus — 15,247 m of the outbound shape, which is the inbound's 0 m — at **13:11:30**,
which is exactly where the registered outbound (12:18 plus running time) puts it: **the outbound
schedule is met to the minute.** Then 22 minutes of silence from the feed, then it appeared as the
inbound "13:18" at **13:34:06**, at the same spot, and moved off at once. Registered stand 7 min;
observed 23. `SL63GDK` (Thu 17) and `MX13FNR` (Mon 14) show the same shape. The current
registration carries no per-journey overrides at all — 0 `VehicleJourneyTimingLink`, 0 `WaitTime`
in all four route-15 files, against 354 `WaitTime` tags elsewhere in the same dataset, so the
operator does use them where they mean them. Time zones are consistent (the same code anchors
outbound correctly), the aimed departure matches a registered inbound departure by label, and the
passage inference places the bus at the origin.

**So the ~16 minutes is neither parsing, nor matching, nor the clock.** It is a consistent gap
between the registered inbound departure and the observed one, on every journey, every day held,
while the same registration's outbound is exact. Whether the registration is out of date for
inbound or the operator's running board departs later by design cannot be decided from the feed,
and this page does not decide it: no correction is applied, and the inbound timetabled line stays
withheld by the schedule anchor. Settling it needs the operator or TfGM; the approach drafts are
in `docs/TFGM_APPROACH.md`.

**Correction, 28 September 2026: the trace above and its conclusion are wrong, and nothing is to be
raised with TfGM or the operator.** A road shape covers only a pattern's stops inside the area we
collect. Outbound 15's road ends at its last stop inside it (stop 44 of 57, about 10 min before the
terminus by the timetable), not at the terminus; inbound 15's begins at its first stop inside it
(stop 14 of 61, 9–10 min after the origin). MF74NNG's 22 minutes without reports were the bus outside
the area: the last 12 outbound stops, its stand and the first 14 inbound stops. It reappeared "at the
same spot" at the inbound's first stop inside the area at 13:34, where the 13:18 is timetabled about
13:28: some 6 minutes late, not 16. The passage inference put it "at the origin" only because the
road's stop offsets were read by list position (the stop-offset bug), and every "+15 to +17 min" in
this record comes from that pairing. Paired with their own stops, inbound 15's first observed stops
read +2.6 min on 21–27 September, as outbound's do. The missing `WaitTime` is not evidence of
anything. `docs/MILESTONE_2026-09-28_ARRIVAL_PILOT.md` §6.

**An outage I caused, recorded.** Taking a warehouse snapshot by hand on the server, the copy
failed on a missing directory, `set -e` aborted the script before the collector restart, and
**collection was down for 119 s** until I restarted it. That is precisely the failure the nightly
evaluation unit is designed against: the properly taken snapshot then stopped the collector for
**0.16 s** with a fresh publication **10.3 s** after the stop, and the nightly unit now reads that
copy and never touches the collector at all.

**What the evaluation found about the line already deployed.** The scheduled comparator read
~15 min of error, and it was not the comparator: **every inbound route-15 journey's schedule is a
constant +15 to +17 min early from stop 0 to stop 39**, on all days held; outbound drifts +2 → +8
in the ordinary way. The inbound journey key first appears in the feed a median **14.5 min after**
its registered departure, standing at the origin, with no report in between; the registration holds
no `WaitTime` at all. So the feed's origin departure and the registration's do not name the same
moment for inbound, and the deployed "Timetabled at your stop" line was **~16 min early for every
inbound 15 — the passenger's own direction.** It is now gated per pattern on a **schedule anchor**
(`schedule-anchor.json`): verified only where inferred passages at the first ten stops put the
schedule within 3 min on ≥ 20 passages. Inbound 15 withheld (+15.4 min, 290 passages); outbound 15
verified (+2.3, 133); every other pattern unchecked and withheld. Live on the site. **The inbound finding
in this paragraph is withdrawn** (28 September 2026, evening): its first 14 stops are outside the area
and its passages were paired with the stops 14 earlier; paired with their own, +2.6 min, and the late
first appearance was the bus reaching the area we collect (`docs/MILESTONE_2026-09-28_ARRIVAL_PILOT.md` §6).

**Head-turn in the street preview:** a one-finger drag turns the head (160° per canvas width, clamped
at 150°), following never stops, and the view eases back to the road ahead on release. **Browser-tested,
2 of 2, desktop and phone, on a standing bus** — the hardest case, because the frame loop parks when
nothing is left to draw and a held turn on a standing bus draws nothing new; the handlers now wake
the loop and keep it running while a turn is held or easing. Six builds to find that; the listener
was attached and firing throughout, and the attribute the test read was simply stale. Physical-phone
check is additional.

**The candidate, evaluated properly (20 September, later still).** Two methods read the timetable
as a *difference* — the scheduled seconds from where the bus is now to your stop, needing no origin
departure and so immune to the inbound discrepancy — and the blended candidate hands over to
observed pace inside the last kilometre. On **identical eligible moments** of the development days
(17–20 Sep, 44 journeys, 1,436 passages) the blended method beats the progress baseline at every
horizon: **0.56 / 1.00 / 2.18 / 3.79** min median at 1–2 / 2–5 / 5–10 / 10–20 against 0.79 / 1.68 /
2.91 / 5.34, at 100% coverage; per journey — 44 journeys are the units, not 63,397 moments — **1.62 /
2.00** against 2.25 / 2.76. Passage uncertainty is ±11 s median, so nothing under 0.2 min is real.
Outbound meets both thresholds (1.29 / 2.76); inbound does not (1.86 / 3.57). Because those days
informed the candidate, its parameters were frozen and the **reserved set** — the server's own
Sunday, 10 journeys, 289 passages, never seen by the fit — scored once: the ranking holds (0.52 /
0.89 / 1.68 / 2.49; per journey 1.39 / 1.67; outbound 1.13 / 2.06, inbound 1.68 / 3.56), both error
thresholds pass, and **the floors fail: 10 journeys against 20, no weekday. Not released.** At
Hillingdon Road (opp), 43 moments: 0.89 / 1.27.

**Correction, 28 September 2026:** every inbound figure in this paragraph came from passages paired
with the stop 14 places earlier in the pattern (the stop-offset bug), so the inbound errors are not
valid, "At Hillingdon Road (opp)" describes a stop 14 places further on, and the "inbound discrepancy"
the timetable-difference methods were said to be immune to did not exist. The outbound figures
stand: outbound's stops inside the area come first, so its pairing was right. `docs/MILESTONE_2026-09-28_ARRIVAL_PILOT.md` §6.

**Per-direction release is pre-registered from here for unseen data only** (criteria amendment):
the page computes the blended estimate from raw reports on the accepted shape and shows it **only
for a direction `arrival-release.json` says has passed on unseen journeys** — a data event, not a
code change. Nightly, the rebuild copies the warehouse while the collector is already stopped
(0.16 s), the evaluation reads the copy, scores every unseen day once, and the release check pools
by day. **Tested on the server with the collector watched each second:** normal, forced-failure and
forced-timeout runs; **collector never not-active, longest publication age 11 s, no restarts.**

**What is needed before any direction shows minutes:** ≥ 20 unseen journeys and ≥ 150 passages in
that direction across distinct days, at least one a weekday, meeting median ≤ 1.5 and p80 ≤ 3.0 at
2–10 min. Monday's snapshot is the first weekday; at ~10 journeys a day per direction, outbound —
which met the thresholds on both sets — could qualify by about Wednesday if the numbers hold, and
the served verdict will say so before anything is shown. **A pooling defect caught on the first
night** (four test runs of one Sunday counted as four nights, landing exactly on the 20-journey floor)
is fixed and tested: days are the unit.

**Front view at Hillingdon Road (opp), traced.** Two inbound 15 variants serve the stop to the same
destination: the 140-journey pattern (accepted shape) and a 5-journey Mon–Sat short working (shape
rejected, 0 reports). On a weekday the bus is left unresolved and an unresolved bus had no road. The
stop-list inference that stood in was wrong in principle and is replaced by **measured shared road**:
**387 → 13,611 m** of the accepted shape, Hillingdon Road at 8,715 m (corrected 28 September: 5,495 m;
8,715 m was the offset of the stop 14 places on, read by list position), placed on it only if the bus's
report and its whole 542 m look-ahead lie inside. **24 of 24 motion checks pass**, including a bus on
shared road estimated with no candidate named, and one short of the divergence left at its report.

**The street preview**, from data it already holds: façades graded by OSM height, a footway and a
broken centre line at the class's real widths, a look-ahead that lengthens with speed, a sky that
follows the sun (`lib/daylight.ts`, civil twilight from date and latitude). **Judged by eye on phone
frames, both themes, in SwiftShader**; the day centre line was found near-invisible in the first
frame and darkened. What it cannot show: dusk (the probe's clock is not at dusk), and anything OSM
does not hold — no windows, no signs.

**Still needing the owner:** rotate the BODS key seen in a screenshot (server and local hashes still
match it), recycle the DuckDNS token, and say whether a Healthchecks.io dead man's switch may be
created (off until then). **Still needing a phone:** every phone claim above is emulation.

## What changed on 18 September, and what it corrected

Four claims this document made on 17 September have been tested rather than asserted. Two of them
were wrong.

| Claim on 17 Sep | What testing found |
|---|---|
| The collector's memory is "steady … not a leak risk" | **Withdrawn.** Three samples over sixty seconds cannot tell a plateau from a climb. A longer look showed the resident set rising 1,148 → 1,466 MB in three minutes, because DuckDB's default limit is 80% of the machine's RAM. It is now bounded explicitly (1 GB, `LM_DB_MEMORY_LIMIT`). Whether it is stable over *hours* is still unknown and is no longer claimed |
| "The warehouse is rebuilt from the raw captures it was loaded from" | **Was false in practice.** No code could read live captures back; `reprocess` reloads the archive selection, not them. `pipeline/restore.py` now exists and a restore was actually performed |
| `deploy/backup.sh` presented as settling the backup question | **Qualified.** It is manual, unscheduled, a pull that only runs when this laptop is awake, and not a bare-metal restore. What £1.10 a month buys is not storage but *someone remembering* |
| Nothing said about the nightly timetable rebuild's footprint | **Measured: 853 MB peak**, 3 min 05 s, 34% CPU. That, not the collector, is the number that rules out a 512 MB host |

Also verified on 18 September, none of it previously tested:

* **Stale feed, through the real page.** The laptop slept mid-collection on 17 September, which
  produced a better test than any I would have staged: a publication **26 hours old** that still
  called itself `"state": "live"` with 655 vehicles whose newest report claimed to be 3 seconds old.
  The page refused all of it — *"NOT UPDATING · updated 1d 2h ago"*, **zero buses listed, zero
  suggested, zero drawn on the map**, and the honest line "Every position we hold has passed its
  cut-off".
* **Restart recovery.** The run the sleeping laptop abandoned was left marked `running`. Starting
  the next collector resolved it to **`interrupted`, exit reason `abandoned`**, with no
  intervention. A deliberate `SIGKILL` mid-run repeated it: the writer lock was released by the OS,
  and a fresh collector was publishing again **within 45 seconds**.
* **No second writer.** Starting a collector while one runs is refused:
  `{"error": "collector_busy", "detail": "Another collector holds data/warehouse/collector.lock."}`
  The warehouse itself refuses a second connection too.
* **Restoring from a copied capture.** 60 captures copied out as `backup.sh` would pull them, then
  restored into an **empty** warehouse: **25,232 observations, 1,396 vehicles** recovered, every
  file verified against the SHA-256 in its own name, 0 corrupt. Run twice, it added **0** new
  observations — a restore cannot double history. Details and limits in `docs/HOSTING.md`.
* **A touch-target sweep.** The layout probe measures every control a phone can tap. **167
  occurrences were under the 44 px both Apple and Google ask for** — the feed's refresh at 36×36,
  Save/Share/Change/Locate me at 40 high, the 2D/City switch at 38, the ride's own controls. They
  were raised in the rules themselves rather than with an override the bundler reorders past.
* **A wording defect the stale state exposed.** The status bar read *"updated 94646s ago"*. Ages now
  read in minutes, hours and days.

## Supported beta scope

* **Manchester buses only.** No Metrolink: no official source publishes tram positions.
* **Positions** for practically every bus reporting inside the service area, each with its own
  report age, or withheld once older than 15 minutes.
* **Timetable claims** — "coming to your stop", "N stops before yours" — for the services that have
  a registration running that day: **109 of 159** observed services on 17 September 2026.
* **Estimated movement and the street preview** for **routes 15 and 250, both directions, any day,
  and route 256 at weekends** — the patterns with a road shape accepted against their own reports.
* **Walking directions** to the boarding point, on request, anywhere OpenStreetMap has footways.
* **Never**: an arrival time, on any route. Nothing predicts when a bus will reach a stop.

Full audit, with the method and the counts: `docs/COVERAGE.md`.

## What is implemented and verified

Verified means an executed check is behind it. Where the evidence is a fixture, a recording, the
real feed or a physical device, it says so. **No physical phone has been used at any point.**

| Area | State | Evidence |
|---|---|---|
| Live collection, validation, DuckDB history, validate-then-swap publication | implemented, verified | 97 Python tests; real bounded runs on this machine |
| Identity-first timetable matching, with refusals that carry their reason | implemented, verified | `tests/test_matching.py` (35); the live publication's own `matching` summary |
| Timetable currency: newest snapshot only, a forward validity window, a refusal to shrink | implemented, verified | `tests/test_timetable_catalogue.py` (4); the 17 September rebuild |
| The whole browser suite on this build | verified | **188 passed, 24 skipped by design, 0 failed** (30.2 min, SwiftShader, desktop and 390 px phone) |
| The final build through its public HTTPS address | verified, REAL feed | two further publications from the network, the chosen bus kept, pinch and Return to bus, 0 tile or page errors |
| Ageing data, through the public address | verified, REAL feed | with collection stopped the page read "NOT UPDATING · updated 201s ago" in the warning tone, though the file still called itself live; buses stayed at their last reports and none was estimated forward |
| Chosen bus never substituted | implemented, verified | `selection.spec` (FIXTURE), and REAL through the public link |
| Estimated movement, drawn smoothly, scored against held-out reports | implemented, verified | `docs/MOTION_MODEL.md`, `docs/LOCAL_VERIFICATION.md` (RECORDED) |
| Immersive phone ride-along, and the journey surviving a round trip behind the data | implemented, verified | `navigation.spec`, the layout probe at five sizes (FIXTURE, emulated touch) |
| Coverage ledger | implemented, verified | rendered against a REAL publication, 17 September |
| Feedback route and location note | implemented, unverified on a device | no physical phone has opened it |
| Watchdog telling four failures apart | implemented, verified locally | `deploy/validate.sh`; **never run on a server** |
| Stalled-publication alert | prepared, **off** | needs a destination the owner confirms |
| Hosting | **planned only** | `docs/HOSTING.md` |
| 48-hour observation with a controlled restart and a failure/recovery check | **not started** | cannot start before a server exists |

## Measured figures, with their date and population

| Figure | Value | Population and date |
|---|---|---|
| Buses in one publication | 587 | live publication, 17 Sep 2026, ~15:55 BST |
| Placed on a timetable pattern | 285 (48.6%) | the same publication |
| Services with a registration running that day | 109 of 159 | the same publication |
| Services with an accepted road shape running that day | 2 (routes 15, 250) | the same publication |
| Published patterns | 524 across 157 services | catalogue built 17 Sep 2026 14:29Z |
| Timetable files read / expired | 575 / 538 | three TfGM datasets, newest snapshot of each |
| Accepted road shapes | 6 of 9 built | 95th-percentile offsets 11.3–28.4 m against 752–3,408 matched reports each |
| Estimate error, held out, up to a minute | median 62.7 m (last report 118.3 m) | routes 15 and 250, Monday 14 Sep captures |
| Drawn-bus error against the next report | median 59–61 m | development and fresh captures, 13–14 Sep |
| Stops | 3,498 | NaPTAN ATCO 180, service area |
| Raw capture growth | 0.13 GB/day, ~540,000 observations/day | measured on this machine |
| Captures preserved so far | **3,821**, 220 MB | 18 Sep 2026 |
| Nightly timetable refresh | **853 MB peak**, 3 min 05 s, 34% CPU; output identical to the previous day's apart from the build date | `/usr/bin/time -v`, 18 Sep |
| Collector resident set | median **~1,560 MB** with the 1 GB database limit; rose over the first ten minutes then flattened | 79 samples over 20 min, 18 Sep |
| Publication interval held | max age **20 s**, median 10 s, across the same 20 minutes | |
| Restore from a copied capture | 60 captures → **25,232 observations, 1,396 vehicles**; 0 corrupt; a second run added 0 | `pipeline.restore`, 18 Sep |
| Phone touch targets under 44 px | **167 → 43 occurrences**; on a phone only the wordmark link remains, deliberately | layout probe at five sizes, 18 Sep |
| Live publication a phone polls | 807 KB raw, **119 KB gzipped**, every 20 s | through the public link, 17 Sep 2026 |
| Pattern catalogue, fetched once | 2.0 MB raw, 149 KB gzipped | after the 17 Sep rebuild |
| Typefaces, fetched once and cached | 70 KB for both | Inter 48 KB, Space Grotesk 22 KB |

Nothing here is an uptime, an accuracy claim about the real world, a user count or a comparison
with any other app.

## Unresolved, and what it means in practice

1. **Everything stops when this laptop stops.** The single largest gap, and the reason this is
   invited testing rather than a public beta.
2. **The temporary address changes at every restart**, so saved stops, a saved route and any
   home-screen icon break. The page says so where it matters.
3. **No physical-device evidence at all.** Emulation is not a phone. `docs/PASSENGER_TEST.md` has a
   12-minute script; until it is done, the phone experience is unverified.
4. **The reported street-preview freeze has never been reproduced.** Frame intervals are now
   measured and carried in the feedback report, which will settle it on the first real phone.
5. **Route 256 cannot be placed on a weekday**, because the operator's current registration has no
   Monday-to-Friday inbound service. Upstream; not fixable here. Use route 15 for trials.
6. **Buses with no timetable held at all: fewer, and the remainder is now a scatter.** The missing
   operator group was Go North West, dataset 12769; it is now downloaded and built. Asked of one
   fixed capture of 653 weekday-afternoon reports, the count with no registration held falls from
   **174 to 109** — the whole of that difference is 13 services that gained one. What is left is
   46 services across several operators, led by **BNML 38** (a BNML line absent from the BNML
   dataset, which deserves its own look), BNGN 10 and 8, and BPTR X43. `docs/COVERAGE.md` has the
   method.
7. **139 of 587 are held unresolved between branches.** A refusal, not an error, and the honest cost
   of wider coverage.
8. **The collector's memory over *days* is still unconfirmed.** At the server's thread count it is
   flat at about 376 MB over 19 minutes, and the 300 MB-an-hour climb seen at 32 threads does not
   reproduce — but no run here has lasted longer than about two hours, and the 48-hour observation
   is what settles it.
9. **A phone downloads 119 KB (gzipped) every 20 seconds**, about 21 MB an hour, because the live
   publication carries full match evidence for all 587 vehicles when the page needs it for one. Not
   broken, but more data than the job needs; the split is described in the opportunity log,
   entry 25. Worth fixing before the beta is advertised widely.
10. **A bus's *timetabled* journey is still not identified** — see the distinction in
   `PROJECT_CONTEXT.md` — so no scheduled time is ever shown.

## The 48-hour observation, ready to start

**Not started, and it cannot be: there is no server.** It begins the hour the site is hosted. The
record lives in `docs/OBSERVATION.md`, appended to as it runs, so progress can be inspected at any
time without waiting for a summary.

What is measured, all of it from things that already exist:

1. **Every publication gap.** The watchdog already reads `publishedAt` every five minutes. A gap
   over 600 s is a restart and is journalled; `journalctl -u lost-minutes-health` is the record.
   Target: what actually happened, not a number to hit.
2. **A controlled restart**, at a chosen hour: `systemctl restart lost-minutes-collector`. Measure
   how long until the next publication, and check that no duplicate writer appeared (the flock) and
   that the last good file kept serving throughout.
3. **A safe failure and recovery.** Point `BODS_API_KEY` at nothing for ten minutes. The feed must
   go to "not collecting" on the page, the last good publication must keep serving with an honest
   age, the watchdog must restart but not mask it, and recovery must be automatic when the key
   returns. This exercises the difference the watchdog is built to tell.
4. **Resource use:** `systemd-cgtop` for the collector's CPU and memory, `df -h` for disk, and the
   growth of `data/live-capture/` against the predicted 0.13 GB a day.
5. **The nightly timetable rebuild** at 03:40, twice: that it pauses collection, finishes, publishes
   a catalogue no smaller than the floor, and that collection resumes.

Nothing about this period may be reported before it has elapsed.

## Cost, operation and rollback

* **Recommended: Hetzner CX23 + IPv4 + backups — about £7.25 a month with VAT**, £8 with a domain,
  ~£97 in the first year. Re-checked against Hetzner's own price-adjustment page on 17 Sep 2026.
* **A domain is not needed to start**: a free dynamic-DNS subdomain carries the beta, and the domain
  can be added later by changing one line. Saved stops are tied to the address, so choose the final
  name before inviting many testers.
* **Deploy:** `deploy/publish.sh deploy@<host>`. **Roll back:** `deploy/rollback.sh` on the server —
  one previous release is always kept, and the collector's own published data is never rolled back.
* **Operate:** collector under systemd with `Restart=always`; a watchdog every 5 minutes that tells
  four failures apart; a nightly timetable rebuild at 03:40; raw captures kept 14 days.

## What stands between this and a public beta

Essential. Each has an owner and the evidence that closes it.

| # | Action | Owner | Evidence that closes it |
|---|---|---|---|
| 0 | ~~Understand the collector's memory growth~~ — **done tonight.** It rose ~300 MB an hour at 32 threads and is **flat at about 376 MB at 2**, which is what a CX23 gives. The allocator scaled with cores; the application accumulates nothing. Both variables were changed together, and the flat run was 19 minutes, so the 48-hour observation still confirms it | done | the trajectory above, and the 48 hours |
| 1 | **Decided 17 Sep: Hetzner CX23, no paid backups, free subdomain.** What is left is the doing: create the server (reading the console's own total before paying), point a DuckDNS subdomain at it, and put the BODS key on it yourself. Step by step in `docs/PROVISIONING.md` | **Hammam** | a hostname, a sudo user, and the subdomain |
| 2 | Provision and deploy: `deploy/publish.sh`, `deploy/install.sh` | assistant, after 1 | `curl -sI https://<address>/` returns 200 with HSTS, and `/data/live.json` is seconds old |
| 3 | The 12-minute phone trial on a real device (`docs/PASSENGER_TEST.md`) | **Hammam** | nine written answers and one copied feedback report, including the drawing rate in ms a frame |
| 4 | Name where a stalled-publication alert should go | **Hammam** | an address in `/etc/lost-minutes/health.env`, and one test ping received |
| 5 | The 48-hour observation, with a controlled restart and a failure/recovery check | assistant, after 2 | `docs/OBSERVATION.md` filled in, after the period has actually elapsed |

Optional polish, in the order I would take it.

| Action | Why | Owner |
|---|---|---|
| Split the live publication (opportunity 25) | 119 KB every 20 s on mobile data is more than the job needs | assistant |
| ~~Add the missing operator's timetable dataset~~ | **done** — Go North West, dataset 12769; 174 → 109 uncovered reports on a fixed capture | assistant |
| Trace **BNML 38**, a BNML line missing from the BNML dataset | 12 reports in one capture refused for a reason that should not apply | assistant |
| Road shapes for more routes | extends estimated movement past 15, 250 and 256 | assistant |
| Identify the timetabled journey | the last claim the app deliberately does not make | assistant |

## The recording

**`outputs/probes/demo-recording/beta/lost-minutes.webm`** — about 30 seconds of the actual app on
a 390 px phone, against the real feed, made by `scripts/probes/demo-recording.mjs`. Nothing is
staged: no fixtures, no scripted positions, the bus moves as the bus moved. It asks for no location
— the stop is found by typing — so nobody's position is in it. Eight labelled stills sit beside it
for anywhere that will not play WebM; there is no ffmpeg on this machine, so nothing converts it.

It runs: the first screen → searching for a stop → the stop and what is coming → riding along, full
screen → the street ahead → back at the stop → behind the data → the coverage ledger.

**The take is honest about itself, and it says how the bus was chosen.** The first attempt filmed
the page's own suggestion, which happened to be a bus reporting **no bearing** — correctly drawn as
a round token seen from above rather than as the 3D bus, and 26 stops away through empty streets.
Honest, but not what the ride-along looks like: in **the publication that recording was made
against** (18 September, about 23:39 BST) **154 of 197 vehicles, 78%, reported a bearing**. That is
one late-evening publication, not a general rate. The
probe now tries the buses coming to the stop in turn until one of those is on the card, and
`recording.json` records the choice and the reason:

> `chosen: {"key": "BNML|MF74NPJ", "bearing": 239, "row": 0}`
> `judge: the ridden bus reported a bearing (239), so the 3D bus and its heading are shown, and it
> was chosen from the buses coming to this stop for that reason`

Nothing is staged by that: it is a real bus at its real position, and if no bus coming to the stop
reports a bearing the page's own suggestion is filmed and the recording says so instead.

**What the stills show is the drawn bus, which is an estimate, and they say so.** The ride-along
frames carry the app's own wording — *"Estimated position · last report 43 s ago"* — because between
reports the app draws where the bus has probably got to, on the road shape, bounded and labelled.
The dots behind it are the observations; the dashed line is the gap between the last one and the
drawing. Nothing in the recording is an observation of the bus being where it is drawn, and no
frame should be captioned as one when the recording is used elsewhere.

**Still worth re-recording in daytime service**, when more buses are running and the ride passes
more of the city: same command, and the recording judges itself again.

## The demo sequence

Thirty seconds, in this order, recorded at 390 px and on a 1280 px desktop. The four frames kept
with the documentation are all **the real feed through the public link on the final build**; the
rest are regenerated by the probes into `outputs/` (git-ignored; copy out before re-running).

1. **A stop chosen** — its side of the road, the walk, the answer, the map.
   ![Lost Minutes at 390 px: a LIVE chip reading "updated 5s ago", a card headed YOUR STOP for
   Marston Road (nr), south-westbound on Kings Road in Stretford, with Save, Share and Change, a
   walk prompt, the suggested route 15 to Roedean Gardens with its last report and age, and the
   paper map below showing the stop ringed in orange and the bus in lime.](images/phone-stop.png)
2. **Ride along** — full screen on a phone, the bus drawn at a labelled estimate, the report age
   beside it, leaving and the street preview each one thumb away.
   ![The ride-along filling a 390 px screen: a bar with Exit, "following the bus" and a question
   mark; the lime 3D bus seen from behind on Moss Lane West with a ground ring, a contact shadow
   and the dotted ESTIMATE trail behind it; Front view and a card reading "15 to Roedean Gardens,
   Estimated position, last report 27 s ago, last report nearest Chorlton Road, 9 stops before
   yours".](images/phone-ride-along.png)
3. **Front view** — the street ahead, drawn from the map's own vector data, never a photograph.
   ![The street preview at 390 px: the road running to a hazed horizon with lit and shaded building
   blocks either side, a street name upright on the road, and the same route 15 card at the
   foot.](images/phone-street-preview.png)
4. **Behind the data** — the pipeline in four steps, then the coverage ledger: four separate
   answers per service, never one number.
   ![The coverage ledger: 285 of 587 buses placed on a pattern by the timetable, 109 of 159
   services with a registration running today, 2 services with an accepted road shape; then one row
   per service with ticks for Positions and Timetable today and dashes for Road geometry and
   Estimated movement, and the refusal reasons counted beneath
   each.](images/coverage-ledger.png)

Every frame says whether it is FIXTURE data or the real feed in the probe's own report. No frame
contains anyone's real location: where a "You" dot appears it is the probe's fixed emulated point
(53.4503, −2.2945 near the stop, or Longford Park), never a device's own.

## Announcement draft — not published

Roughly 190 words, for LinkedIn, **after** the app is hosted at a lasting address. The link and the
status line must be corrected before it goes anywhere.

> I've opened my Manchester bus side-project, **Lost Minutes**, for feedback.
>
> The everyday job is small: find your stop, see which buses call there and how far their last
> reports put them, then follow one and watch it move.
>
> Two decisions I'd defend.
>
> A bus is only placed on a timetable pattern when the operator, the timetable version, the
> operating day and the reported direction all agree. When two branches fit a position equally well
> it stays unresolved and says so. Tracing route 256 last week, I found the registration currently
> published for it has no Monday-to-Friday inbound service at all — so the app tells you it cannot
> say, instead of inventing an answer.
>
> Between reports, a bus is drawn moving along a road path that was accepted only after being
> checked against that route's own reports, and the estimate's measured error is published rather
> than hidden.
>
> Honest status: an early beta on one small server. Buses only, no Metrolink. Estimated movement
> covers three routes. It never predicts an arrival time.
>
> It sits alongside **Energy Reconciliation**, my earlier project reconciling smart-meter data with
> Python, DuckDB and dbt.
>
> Feedback welcome — especially where it confuses you.
>
> [app link] · [github.com/Hammamelsh/lost-minutes]

**Checked before drafting:** the Energy Reconciliation repository was read on this machine. Its
README describes Python, SQL, DuckDB, dbt and Streamlit with a React front door, 3 million source
rows from three files across 83 households, and a live analysis page. The post claims nothing
beyond that.

**Do not publish** until: the app is hosted, the address is lasting, and the status line matches
reality.
