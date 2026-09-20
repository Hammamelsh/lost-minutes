# Lost Minutes — release record

One page, kept current. What is running, what is verified, what is not, and what it costs.

| | |
|---|---|
| **Commit** | *Prepare a public beta: trace the coverage to its source, make the ride-along the screen on a phone, and write the release down* — the commit this file was released with. A hash written here can only ever be the previous commit's, so `git log -1` is the record, and the running site carries its own stamp (below) |
| **Build stamp on the page** | commit + build minute, in the feedback report and `lib/build.ts` |
| **Public address** | **temporary**, from a Cloudflare Quick Tunnel: it changes at every restart and lives only while this laptop and WSL are up. `scripts/preview.sh status` prints the one in force. It has already changed once — the laptop slept on 17 September and both the link and collection stopped with it |
| **Deployment status** | **not provisioned.** `deploy/` is complete and validated on this machine; no server exists, nothing has been bought |
| **Collection** | one bounded run on this laptop; nothing runs when it is off |
| **Verdict** | **Ready for invited testing, and ready to be hosted.** The one thing that looked like a blocker tonight — the collector's memory rising ~300 MB an hour — **does not reproduce at the thread count the server will run**: flat at about 376 MB over 19 minutes with two threads. Nothing else is blocking except provisioning itself. See "What stands between this and a public beta" |

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
verified (+2.3, 133); every other pattern unchecked and withheld. Live on the site.

**Head-turn in the street preview:** a one-finger drag turns the head (160° per canvas width, clamped
at 150°), following never stops, and the view eases back to the road ahead on release. **Browser-tested,
2 of 2, desktop and phone, on a standing bus** — the hardest case, because the frame loop parks when
nothing is left to draw and a held turn on a standing bus draws nothing new; the handlers now wake
the loop and keep it running while a turn is held or easing. Six builds to find that; the listener
was attached and firing throughout, and the attribute the test read was simply stale. Physical-phone
check is additional.

**Front view at Hillingdon Road (opp), traced.** Two inbound 15 variants serve the stop to the same
destination: the 140-journey pattern (accepted shape) and a 5-journey Mon–Sat short working (shape
rejected, 0 reports). On a weekday the bus is left unresolved and an unresolved bus had no road. The
stop-list inference that stood in was wrong in principle and is replaced by **measured shared road**:
**387 → 13,611 m** of the accepted shape, Hillingdon Road at 8,715 m, placed on it only if the bus's
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
