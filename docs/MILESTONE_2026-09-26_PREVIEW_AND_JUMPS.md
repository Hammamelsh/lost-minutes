# 26 September 2026, afternoon: the fleet's two jumps, a private preview, and the view made ready for real imagery

The owner's brief had six parts:
1. keep configuration, preview and public release apart;
2. settle Google's terms question;
3. bound a trial by its real billing unit;
4. validate the view on real Manchester imagery once access exists;
5. explain and fix the fleet's two unexplained jumps;
6. finish the everyday usability work.

Everything here ran in Chromium with SwiftShader, on fixtures, recorded publications or the served site.
Nothing was tried on a phone in hand, no user test was run, and no Google account, key or billing
exists.

## 0. An incident I caused: the collector was killed twice

To rebuild the noon publications I first ran the replay on the server. I copied a 797 MB warehouse
snapshot into `/tmp`, which on that server is RAM (tmpfs), and replayed there. That drove the 4 GB
machine into a global out-of-memory condition. The kernel killed:
- my first replay attempt at 12:34:36 UTC;
- **the collector at 12:36:24 and again at 12:37:15**;
- my second replay at 12:38:36.

systemd restarted the collector each time. The abandoned runs were closed as the design intends, with
`cause: "not recorded"`. Publishing resumed at 12:37:39 and has not stopped since.

- **What was lost:** gaps of 60 s and 51 s between cycles, about four cycles (roughly two minutes of
  positions). Those positions cannot be fetched again.
- **What was not:** no data was corrupted and the served site never went down.
- **A correction:** the first attempt's death was earlier misread as an ssh timeout. It was an
  out-of-memory kill.
- **Since then:** the scratch copy was deleted at once, restoring about 2.4 GB free, and the replay was
  done on this machine instead. The only server work afterwards was a read of three catalogue tables,
  about 1.3 MB, under a hard 400 MB memory cap:

  ```bash
  sudo systemd-run --scope -p MemoryMax=400M -p MemorySwapMax=0 …
  ```

The rule is written down for next time (engineering opportunities, entry 60).

## 1. The two jumps, reproduced and fixed

**What was seen.** On the served build `b849bbf`, at a neighbourhood zoom, between 12:03:32 and 12:03:52
UTC, two grey buses stepped in one 250 ms sample. The probe reported 107.5 m and 216.8 m. **Both figures
were double the truth.** The probe converted screen pixels with a 256-pixel tile's scale, but MapLibre's
world is 512 pixels at zoom 0. The steps were 54 m and 108 m, and the release record is corrected.

**The same mistake is in the app.** `METRES_PER_PIXEL_Z0` in `components/city-map.tsx` sizes the front
view's roads, so they are drawn at half their stated real width. It is recorded, not changed here
(backlog 35).

**The evidence, rebuilt.**
- The collector's 37 position captures for 11:54–12:06 UTC were copied down and checked against their
  SHA-256 names.
- `pipeline.replay_publications` replayed them against the server's own catalogue of that morning
  (three tables read under the memory cap above), giving 37 publications.
- The two buses are **BNSM route 192 vehicles at the Piccadilly terminus**.

| | BNSM 11930 | BNSM 11918 |
|---|---|---|
| Last inbound report | journey 204, 11:55:58 | journey 202, 12:02:25 |
| Before the change | **silent for seven minutes** (the feed repeated its last report) | reporting normally |
| First outbound report | journey 223, 12:03:00 | journey 221, 12:03:06 |
| Gap and distance | 422 s, 108 m | 41 s, 54 m |
| New pattern's road | `434045882c`, accepted | `638530d3c3`, rejected |

Both changes arrived in the 12:03:18 publication. Before it, both inbound journeys were unresolved
between branches, so neither bus had a road.

**Source data or drawing?**
- **11930 is a gap in the source.** Nothing can say when in those seven minutes it moved.
- **11918 is not.** Its reports allow movement: 54 m in 41 s. The cut there was the drawing's fault.
- **Not the camera.** The camera state was constant throughout the page replay: zoom 16.2, pitch 0.

**The cause.** `reconcileFleet` gave a vehicle on another journey a new drawing, which began at its new
report. So the bus left where it was drawn with nothing between and nothing said. The chosen bus never
had this problem, because its drawing is kept across a journey change.

**The fix** (`lib/fleet.ts`):
- A drawn vehicle on another journey keeps its drawing.
- Its previous journey's reports stay in front of the new journey's until the drawing has crossed to
  them. The move between journeys is then judged as any two reports are: travelled at the bus's pace
  where they allow it, a repositioning where they do not.
- **Every fleet repositioning is now marked**: a dashed trace in the fleet's grey for 6 s, as the
  chosen bus's has always been, and the hover tip says "Moved N m to its latest report · not followed".
  That closes backlog 33.
- A first version carried only the newest report. A bus still short of it, as it is within a smoothing
  window, was then eased 26 m. Carrying the journey's recent reports fixed that.

**Before and after, the same publications:**

*Through the fleet code at 20 poll phases* (`tests/fleet-journey-change.test.mjs`, which uses the
publications of both buses):
- **Before:** at every phase, one 100 ms step of 54–55 m for 11918 and 108.3 m for 11930, unmarked.
- **After, 11918:** travels in 15 of 20 phases (at most 0.8 m per 100 ms). In the other 5, its next
  report arrived late enough that the playback's standard late-report rule repositions it 25 m, and
  that is marked.
- **After, 11930:** one marked repositioning of 108–131 m in all 20 phases, at 12:04:00, as the moment
  shown reaches its new report. The new journey's road places it slightly past that report.
- No unmarked step over 3 m anywhere.

*Through the page* (`scripts/probes/fleet-replay.mjs`, frames and video in `outputs/probes/fleet-replay/`):
- **Served build:** both buses cut in one 0.21 s sample at 12:03:31.7, by 54.1 m and 108.3 m, unmarked.
- **This build:** 11918 does not cut. 11930 cuts 130.9 m once, at 12:04:00.6, with its trace drawn.

*Every bus* (`scripts/evaluate-fleet-steps.mjs`): steps of more than 3 m in 100 ms.

| Reel | Buses | Journey changes | Before | After |
|---|---|---|---|---|
| 26 September, noon, 13 min | 504 | 61 | 141, all unmarked | 108, all marked |
| 22 September, evening, 20 min | 226 | 65 | 130, all unmarked | 88: 87 marked, 1 not |

- The before figures include the silent repositionings of backlog 33, not only journey changes.
- The one unmarked step left is BNSM 11902, 6 m: the hop at a path joint, open since 25 September.

## 2. Configuration, private preview and public release (`docs/PHOTO_3D_PREVIEW.md`)

- **The key alone no longer publishes the view.** `LM_PHOTO3D_PUBLIC=1` is the public switch and is
  off by default. With the key alone, the collector writes a private offer under `data/private/`.
- **The preview is behind a password.** It is served only at `/preview/`, with basic authentication in
  `deploy/Caddyfile`, locked by default with a hash of a password nobody holds. The owner sets one with
  `deploy/set-preview-password.sh`, which asks at a hidden prompt and keeps only a bcrypt hash in a
  root-only file.
- **The preview is the same app** with a banner. The public page never asks for the offer, and the
  service worker stores nothing from `/preview/`.
- **Found and fixed on the way:**
  - the config writer used `POLL_DEFAULT` without importing it, which would have stopped every live
    publication on the server; the full Python suite caught it (16 errors) before any deploy;
  - `deploy/validate.sh` had been failing its systemd check since 23 September, because the refresh
    unit's `/bin/cp` was missing from its scratch root;
  - `deploy/validate.sh` had been checking a leftover repro server on its port instead of Caddy; it now
    refuses a busy port.

**Verified:**
- 138 Python tests;
- `deploy/validate.sh`, 43 checks, the preview's lock among them;
- `preview.spec`, 3 checks on 2 profiles.

The server's own check is in §7.

## 3. The view from above, ready for real imagery

- **Failures said by their cause**, from the answer to the one request that opens the imagery:
  - HTTP 429: today's allowance used up;
  - 401 or 403: the provider refused the request;
  - no answer at all.

  Each gives one message, "The map works as before", and one tap back. Tiles failing after opening are
  said. Past about three hours the view says the imagery session has ended and asks for a reopen; it
  never asks Google again by itself.
- **Closer or higher.** The elevated follow is the default; *Closer* is offered, not forced. The camera
  eases between the two over a second without leaving the follow.
- **Two ages.** The imagery is "captured at an earlier date, which the provider does not publish: not a
  live view". Each bus card reads "report 15 s old · drawn a little behind it".
- **Attribution and notices** (`docs/PHOTO_3D_TERMS.md` §5):
  - Google's official outlined logo at 18 px, with the required clear space, labelled "Google Maps";
  - Cesium's logo placed after Google's data attributions, at least 10 px clear;
  - our own data on a separate line;
  - Google's terms and privacy links in the view;
  - a site note, *The view from above*, only where Google imagery is offered.
- **Same bus, same moment.** The view writes the chosen bus it draws and the frame's time. The check
  finds it under 5 m and 400 ms from the map's own drawing.
- **Cost of drawing.** Only buses within the view's reach are sent to it, and only buses that moved are
  rewritten. On the recorded noon fleet the tick fell from **10–12 ms with about 480 buses to 0.8–1.1 ms
  with 62–66**.
- **Verified:** `above.spec`, 8 checks on 2 profiles, 16 passed. They cover the journey, the distance
  choice, refusal, quota, no answer, failing tiles, visibility emulated, and Google's logo, terms and
  zero requests before the tap.
- **The imagery harness** (`scripts/probes/above-imagery.mjs`) is ready for the day access exists. Run
  on the fixture with the real noon reel:

| Measure | Phone | Desktop |
|---|---|---|
| Renderer ready | 526 ms | 430 ms |
| Usable | 639 ms | 570 ms |
| Root requests per opening | 1 | 1 |
| Heap before, open, after exit (MB) | 48, 111, 111 | 107, 87, 82 |

It recovered after 30 s hidden, and the same bus was still chosen after exit. The heap figures depend
on when garbage is collected and are not a finding.

**Blocked: real imagery.** Building quality, bus fit, bridges, occlusion, frame rate, memory and tile
bytes on Manchester's tiles all need the key (`docs/PHOTO_3D_PREVIEW.md` §2).

## 4. Everyday usability

Reviewed on the current build at 390 px and on desktop (`outputs/probes/everyday-flows/after-preview/`).

- **The bus card's motion explanation folds away.** It had run to five sentences under every bus. It
  now shows its one-line label, a *How it is drawn* link, and, only after a repositioning, the sentence
  saying so.
- **The phone handle's status line is cut short** rather than running under the refresh button:
  "Positions not collecting · 13d 14h ago" now ends at x = 194, where the button starts at x = 202.
- **Scheduled times stay unmistakable:** the board's "Scheduled · not live" badge, "timetabled · in N
  min" on each row, and its basis line are unchanged. The phone panel is unchanged.

**Seen and left:**
- the handle truncates "Stretford Mall (Stop A) · 2 coming" to "· 2…";
- the chosen bus's progress appears both in its sticky head and in the answer block;
- departure rows name the operator by its code (BNML).

**Usability remains unvalidated.** No fresh user tried the app. Two short tasks for the first people who
do:
1. Standing at Stretford Mall, find the stop for a bus towards Piccadilly Gardens, the right side of
   the road, and say when the next one leaves and whether it is tracked.
2. Plan a trip from a friend's address (not your own location) to the Trafford Centre, and send them
   the plan.

## 5. The terms, and a bounded trial

- `docs/PHOTO_3D_TERMS.md` has the clause verbatim and separates what the Map Tiles policies allow from
  what they leave open. It gives the draft question for the owner to send, and the attribution,
  privacy and promotional-video rules that apply. Nothing was sent.
- `docs/PHOTO_3D_PREVIEW.md` §3 gives the billing unit: one root tileset request per opening. It
  recommends a daily quota of 25, which bounds a month at 775 requests, within the free 1,000, so $0.00
  at most. At 50 a day the most is $3.30.

## 6. The gate's two failures, and a collector stop that was recorded as a failure

The owner asked for these to be fixed rather than classified.

**Return to bus ending "following" short of the framing.** In the gate, on the phone profile, the ride
said "following" at zoom 14.2 instead of 20 after *Return to bus*. The same symptom was believed fixed
in backlog 29.
- **The mechanism.** The return glide resolved on the next `moveend`. A glide that another camera move
  stops part way ends with `moveend` too, just as an arrival does. That other move might be MapLibre
  acting on a late drag, or its inertia. The passenger's own gestures change the ride's state, so they
  were never the problem. Anything else left the ride settled wherever the glide had stopped.
- **Reproduced on demand.** An arrow-key pan from MapLibre's keyboard handler during the glide stood in
  for the late move. It ended "following" at zoom 14.7–17.4 in 6 of 6 runs. Slowing the CPU alone did
  not reproduce it (12 of 12 passed).
- **The fix** (`arrive()` and `returnToBus()` in `components/city-map.tsx`). How a glide ended is read
  from the camera: no longer wanted, arrived, or short of the framing's zoom and pitch. A short glide
  ends with a cut to the framing, then "following". This covers every ride entry and return, outside
  and in the front view.
- **A first version retried the glide instead**, and made things worse on the phone profile. Logging
  every arrival showed why: in two checks MapLibre held the glide still for 1.1–1.8 s while reporting
  itself moving (the bearing-less ride's entry, and the return after a drag). Each retry stopped the
  held move and started another, so the ride ran past the checks' 5 s. The cut ends it at once. Why
  MapLibre holds the camera there is not known (backlog 29).
- **Checked by** a new check in `ride.spec`, which keeps the gate's assertions unchanged.

**The front-view check measured the wrong point.** It failed in the gate with "the eye moved as the bus
did (26.5 m against 20.3 m)". It compared how far the point the camera looks at moved with how far the
bus moved. That point runs 32 m ahead of the bus plus 2.5 m for every m/s it is drawn going, so a change
of speed moves it more or less than the bus, by design. The map now writes the camera's own position
(`data-eye`), and the check measures that against the bus. The tolerance is unchanged. The position is
computed from MapLibre's public values: field of view, pitch, bearing, zoom and canvas height. The
transform that holds it directly is typed but not exposed at run time in MapLibre 6.7, and a first
version that read it wrote nothing; the check caught that as 0.0 m.

**A stop during a warehouse query recorded as a failure.** Restarting the collector after the deploy,
the stopping process exited 1, and systemd marked the unit failed. Its SIGTERM had arrived during a
publication's query.
- **Confirmed with DuckDB 1.5.5:** the collector's stop, raised by its signal handler, comes back as
  DuckDB's own `RuntimeError('Query interrupted')`, with the stop as its cause.
- **The fix** (`pipeline/collect.py`). The collector finds its stop behind the error and records the
  run as interrupted by that signal, which then exits 0 like any other stop.
- **Found on the way:** DuckDB hands control back but lets the interrupted query run on, and the next
  statement waited for it, 60 s in the test's long query. The query is now cancelled with
  `con.interrupt()` before the run is recorded.
- **Checked by** a new Python test that sends a real SIGTERM during a real query on the collector's
  connection. It fails without the fix and passes with it.
- **A second path, found on the server.** Restarting after `c7179c8`'s deploy, the old process ran
  on for 30 s after its SIGTERM and was killed. The stop had landed in the timetable matching, whose
  handler for "patterns not built yet" caught DuckDB's interruption. That publication went out with
  every bus unmatched, and collection carried on.
  - `core.stopped_by_signal` now recognises an error that only stands for a stop, and the two broad
    handlers around warehouse queries in `pipeline/live.py` re-raise it (`4d1f586`).
  - A second test sends the stop during the matching's query. Without the fix the stop is swallowed
    and the run carries on; with it the run is recorded as stopped.

## 7. Verification

All in Chromium with SwiftShader, desktop and phone emulation. Nothing on a phone in hand.

| Check | On | Result |
|---|---|---|
| Node tests | `4d1f586` | 266 passed |
| Python tests | `4d1f586` | 140 passed |
| Typecheck and lint | `c7179c8` | clean; lint 0 errors |
| `deploy/validate.sh` | `c7179c8`'s Caddyfile | 43 checks passed |
| Full browser gate | `d35001d` | 403 passed, 41 skipped by design, 2 failed, in 1.2 hours |
| `ride.spec`, both profiles | `c7179c8` | 51 passed, 3 skipped by design, none failed |
| The four checks that failed on the way, 5 times each on both profiles | `c7179c8` | 40 of 40 |
| The 16 other specs that enter, leave or draw a ride, the view from above and the preview among them | `c7179c8` | 221 passed, 9 skipped by design, none failed, in 51 minutes |

The gate's two failures are §6. The last two rows are a targeted recheck, not a second full gate. The
rest of the suite passed on the gate build, and nothing they exercise changed after it.

## 8. Deploy and served checks

**Deployed three times:** `d35001d`; then `c7179c8` with §6's ride and first collector fixes; then
`4d1f586` with the second collector fix, a change to the collector alone. `c7179c8` is kept for
`deploy/rollback.sh`. The Caddyfile was installed by hand after `caddy validate` passed on the server.
`sudo deploy/set-preview-password.sh --lock` was run there once. It works: it kept the domain and root
lines, made the file root-only, reloaded Caddy, and the preview answered 401.

**On the served site, after `c7179c8`:**
- **The same build:** the page chunk (`cff61ab8…`) and the map's chunk (`d7617795…`) are byte for byte
  the local build's.
- **The lock:** `/preview/` and `/preview/photo3d.json` answer 401, with and without a wrong password,
  with `no-store` and `noindex`. `/data/private/photo3d.json` is 404, and the public `config.json` has no
  `photo3d`.
- **The jumps:** the noon publications through the served site draw 11918 with no cut, and 11930 cut
  131 m once with its trace drawn.
- **The fleet on real data:** 437 buses, 29 in view, 23 moving at a neighbourhood zoom. In one minute on
  the phone one real repositioning was marked: BNSM 11911, 156 m.
- **A real ride from Try Ride-along, both profiles:** "following" at zoom 20. A drag switches to
  exploring, and *Return to bus* comes back to "following" at zoom 20, pitch 60. The card reads, for
  example, "Moving between its reports · as it was about 50 s ago · report 34 s old".

**Collector restarts:**

| Stopped | Its code | Result |
|---|---|---|
| 15:26 UTC | the older release's | exited 1 with "Query interrupted", the fault in §6 |
| 17:43 | `d35001d`'s | ran on for 30 s and was killed: the stop was swallowed in the matching, §6's second path |
| 17:46 | `c7179c8`'s | stopped cleanly and exited 0 ("Deactivated successfully"); publishing 6 s later |
| 17:57 | `c7179c8`'s, to load `4d1f586` | stopped cleanly and exited 0; publishing 7 s later |

Each restart left a gap of seconds to half a minute in collection. The collector has published every
cycle since.
