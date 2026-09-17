# Lost Minutes — release record

One page, kept current. What is running, what is verified, what is not, and what it costs.

| | |
|---|---|
| **Commit** | *Prepare a public beta: trace the coverage to its source, make the ride-along the screen on a phone, and write the release down* — the commit this file was released with. A hash written here can only ever be the previous commit's, so `git log -1` is the record, and the running site carries its own stamp (below) |
| **Build stamp on the page** | commit + build minute, in the feedback report and `lib/build.ts` |
| **Public address** | **temporary**, from a Cloudflare Quick Tunnel: it changes at every restart and lives only while this laptop and WSL are up. `scripts/preview.sh status` prints the one in force. The link used for the checks below was `nations-environment-grown-emerald.trycloudflare.com` on 17 September 2026 |
| **Deployment status** | **not provisioned.** `deploy/` is complete and validated on this machine; no server exists, nothing has been bought |
| **Collection** | one bounded run on this laptop; nothing runs when it is off |
| **Verdict** | **ready for invited testing. Not ready for public beta** — see "What stands between this and a public beta" |

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
6. **127 of 587 buses have no timetable held at all**, almost all one operator group (BNGN's 10, 37,
   36, 8, V1). One configuration line and a rebuild would close most of it; the dataset has not been
   identified.
7. **139 of 587 are held unresolved between branches.** A refusal, not an error, and the honest cost
   of wider coverage.
8. **A phone downloads 119 KB (gzipped) every 20 seconds**, about 21 MB an hour, because the live
   publication carries full match evidence for all 587 vehicles when the page needs it for one. Not
   broken, but more data than the job needs; the split is described in the opportunity log,
   entry 25. Worth fixing before the beta is advertised widely.
9. **A bus's *timetabled* journey is still not identified** — see the distinction in
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
| 1 | Decide the hosting spend and give account access (`docs/HOSTING.md`, last section) | **Hammam** | a yes, a server or an API token, and the address to use |
| 2 | Provision and deploy: `deploy/publish.sh`, `deploy/install.sh` | assistant, after 1 | `curl -sI https://<address>/` returns 200 with HSTS, and `/data/live.json` is seconds old |
| 3 | The 12-minute phone trial on a real device (`docs/PASSENGER_TEST.md`) | **Hammam** | nine written answers and one copied feedback report, including the drawing rate in ms a frame |
| 4 | Name where a stalled-publication alert should go | **Hammam** | an address in `/etc/lost-minutes/health.env`, and one test ping received |
| 5 | The 48-hour observation, with a controlled restart and a failure/recovery check | assistant, after 2 | `docs/OBSERVATION.md` filled in, after the period has actually elapsed |

Optional polish, in the order I would take it.

| Action | Why | Owner |
|---|---|---|
| Split the live publication (opportunity 25) | 119 KB every 20 s on mobile data is more than the job needs | assistant |
| Add the missing operator's timetable dataset to `BODS_TIMETABLE_URL` | would move most of the 127 "no timetable held" buses into coverage; one line and a rebuild | **Hammam** to identify the dataset, assistant to add and verify |
| Road shapes for more routes | extends estimated movement past 15, 250 and 256 | assistant |
| Identify the timetabled journey | the last claim the app deliberately does not make | assistant |

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
