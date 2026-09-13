# Lost Minutes — project context

Working context for anyone (or any assistant) picking this up. Status words are used
strictly: **Implemented** exists in the code, **Verified** has an executed check behind it,
**Planned** does not exist yet, **Unknown** has not been established.

Last updated: 13 September 2026, evening (the ride-along's camera and visibility repaired, the
night map made legible, stop-aware estimated movement, and a recorded window-seat journey on
the Explore tab; earlier the same day: walking guidance, estimated movement, collector run
records, the stop-first passenger view, original cartography, Bearing, and identity-first
timetable matching). The requirement-by-requirement evidence for each milestone is in
`docs/MILESTONE_CHECKLIST.md`.

## Product goal

An independently hosted, mobile-first Manchester bus companion, whose source lives in the
owner's own GitHub repository. The everyday job is small and concrete: find your stop, see
which buses call there and how far their last reports put them, and follow one.

It is also portfolio evidence for Data Engineer, Analytics Engineer, Data Scientist and AI
Engineer work. That means the engineering has to be visible and checkable, not decorative.
No AI feature will be added merely to claim AI engineering.

**The evidence rule.** Nothing on screen may claim more than the data supports. Every
published observation keeps its original timestamp, its raw source file and that file's
SHA-256. Counts are reconciled from different tables rather than asserted. Anything we
cannot justify is shown as unknown, withheld or refused — never filled in.

## Architecture

```
BODS SIRI-VM feed ─┐                        one shared collector, single writer
public archive ────┤
NaPTAN (ATCO 180) ─┤
TfGM TransXChange ─┴─> data/raw, data/live-capture   raw bytes, content-addressed, not in Git
                       │
                       ├─> DuckDB (data/warehouse)  sources, runs, cycles, observations (with
                       │      Bearing), conflicts, quarantine, publications, stops, patterns
                       │
                       ├─> public/data/replay.json      archive snapshot (validated, atomic)
                       ├─> public/data/live.json        live state, per-bus match and evidence
                       ├─> public/data/stops.json       3,498 boarding points
                       ├─> public/data/patterns.json    service patterns: operator, version,
                       │                                operating days, stops, declared distances
                       ├─> public/data/shapes/          road shapes for evaluated patterns
                       │                                (Valhalla, accepted against reports)
                       ├─> public/data/motion-evaluation.json  estimator settings, held-out errors
                       ├─> public/data/operations.json  pipeline truth
                       └─> public/data/config.json      runtime pointers, walking router
                                     │
                    Next.js static export ──> phones poll the published objects only
```

Phones never contact BODS. One collector reads the feed for everyone. A phone contacts one
other service, and only when the passenger asks for walking directions: the pedestrian router
at routing.openstreetmap.de, sent the passenger's location rounded to about 10 m.

**Implemented and verified.** Archive import, live collector, DuckDB history, validate-then-
swap publication for both snapshot kinds, Operations view, Evidence view, the stop-first
Follow view, PWA shell, service-pattern matching with identity checks, Bearing capture,
walking guidance to the boarding point, estimated movement between reports on evaluated
routes (15, 250 and 256), and run records that say how each collection ended.

**Planned.** Hosting the published objects somewhere that keeps running; a scheduler;
identifying a bus's timetabled journey (not just its pattern); stop passage inference;
travel-time measurement.

## Commands

```bash
pnpm install --frozen-lockfile
pnpm dev                    # frontend only, http://localhost:3000
pnpm dev:live               # frontend + collector together, Ctrl-C stops both
pnpm dev:live -- --minutes 20
pnpm build                  # static export to out/
pnpm start                  # serve out/ with Python
pnpm test                   # Node contract tests, including MapLibre style validation
pnpm typecheck && pnpm lint
scripts/setup-browser.sh    # once: the browser's missing libraries, without root
pnpm test:browser           # the built out/ in a real Chromium with WebGL, desktop and phone
LM_REAL_LIVE=1 LM_BASE_URL=http://localhost:3000 pnpm test:browser tests/browser/real-feed.spec.mjs
                            # the same suite against a running pnpm dev:live, no fixtures
LM_REAL_ROUTING=1 pnpm test:browser tests/browser/walking-real.spec.mjs
                            # one request to the real walking router

python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m pipeline.run import        # archive: fetch, load, publish
.venv/bin/python -m pipeline.run status        # refresh and print Operations
.venv/bin/python -m pipeline.live init         # write an honest "unavailable" live state
.venv/bin/python -m pipeline.collect --minutes 10   # live collection alone
.venv/bin/python -m pipeline.stops import           # NaPTAN -> stops.json
.venv/bin/python -m pipeline.patterns build         # TransXChange -> patterns.json, every
                                                    # observed service with a valid file
.venv/bin/python -m pipeline.patterns build --coverage all      # every file valid today
.venv/bin/python -m pipeline.patterns build --lines 15,50       # named lines
.venv/bin/python -m pipeline.patterns build --max-lines 10      # quick development build
.venv/bin/python -m unittest discover -s tests      # full Python suite
python3 -m unittest discover -s tests               # parser and matching tests, skips DuckDB
.venv/bin/python -m pipeline.shapes build --lines 15,250,256        # road shapes, then `publish`
.venv/bin/python -m pipeline.motion_data export --lines 15,250,256  # reports for the evaluation
node --experimental-strip-types --import ./tests/alias-loader.mjs scripts/evaluate-motion.mjs
.venv/bin/python -m pipeline.assess_matching --at 2026-09-13T13:16:22Z   # matching on a frozen moment
```

The warehouse is single-writer: a pattern build waits for a running collector to finish.

## Data definitions

**Observation identity** — `(operator, vehicle, route, direction, journey_ref,
observed_at_ms)`. Same identity and same coordinates is a repeat. Same identity and
different coordinates is a conflict. **A new timestamp is always a new identity**, so a bus
that reported again without moving is preserved. That is not evidence it stood still.

**Three clocks, never merged.** `observed_at` is when the vehicle reported (the source's own
string is kept verbatim in `recorded_at_text`). `retrieved_at` is when we fetched the
response. `published_at` is when we wrote the file. The age shown to a passenger is always
the age of the observation.

**Bearing** — SIRI-VM `Bearing`, the compass direction the vehicle is heading, stored with a
status: `reported` (a number from 0 to 360, where **0 is north, not missing**), `absent`,
`invalid` (unreadable or out of range, kept verbatim in `bearing_raw` and never repaired), or
`not_captured` (stored before bearings were recorded, which is unknown rather than absent).
A bearing is never derived from movement, and a bad one never costs the position.

**Stop identity** — a stop is a physical boarding point with an ATCO code. Two stops can
share a name and face opposite ways; NaPTAN's indicator ("Stop A", "opp") and bearing (the
direction a bus travels there) are what tell them apart.

**Service pattern** — one ordered list of stops a service calls at, from TransXChange,
identified by operator, line, direction and stops. It records the timetable file, revision
and validity, the operating profiles of the journeys that run it (weekdays, school terms,
special days; bank holidays recorded but not evaluated), and declared link distances. A
distance the file does not declare is **null, never zero**. A pattern no journey runs is not
published. A pattern that ends at a stop cannot be boarded there.

**A match** places a bus on a pattern, or refuses with a reason. Identity comes first: the
same operator, a timetable version valid on the report's day, journeys running that day, the
reported direction. Only then does position choose. Two different paths within 60 m of the
position stay **unresolved**, with every candidate kept; the operator's reported destination
may settle it and nothing else may. The published match carries its inputs as evidence.

**Progress** is stated against the pattern stop the report was *nearest* to: "last report
nearest Sevenways, 3 stops before yours". That stop may or may not have been called at yet,
so nearest-your-stop is never "at your stop" and a nearest stop after yours is "past your
stop in the stop order", not a measured departure. No error bound is claimed.

**Estimated position** — where a selected bus has probably got to since its last report,
computed on the device (`lib/motion.ts`) and never stored, published or treated as a report.
Three clocks and three things are kept apart: the reports (immutable, each at its observation
time), the estimate (the bus's state at the presentation time, re-derived from the reports
available by then; a new report is reconciled at the same presentation time as the estimate it
replaces, so the difference between them is a correction, never a mixture of times) and the
drawn position (which follows the estimate at a bounded rate, on the road; a step back of up
to 35 m is held while the estimate catches up; over 150 m it snaps to the new report and says
so). An estimate moves only along an accepted road shape, at the speed the bus's own recent
reports show while moving, pausing 10 s at each timetabled stop it reaches and eased off slightly as the report
ages (motion-3, fitted on the earlier captures by a rule set before any held-out figure was
read), for at most the measured horizon of 120 s. Anything
else falls back to the last reported position, with the reason: no shape, an unsettled branch,
a report off the road, too old, too few reports, a jump, the feed not live, or the passenger's
choice of reported positions only. It is labelled "Estimated position" with the real report
age.

**Road shape** — the road a service pattern follows, built by routing a bus through its stops
(FOSSGIS Valhalla, NaPTAN bearings as headings) and **accepted only when at least 30 matched
reports lie within 35 m of it at the 95th percentile**. Stop coordinates alone never stand in
for the road.

**Walking route** — a pedestrian route from the passenger to the chosen boarding point, from an
OSRM foot profile, asked for only when the passenger chooses to. With no route the page says
why; a straight-line distance is always labelled as one.

**Freshness policy** (`pipeline/freshness.py`), derived from measurement, not taste:
fresh ≤ 60s, ageing ≤ 150s, stale ≤ 900s, expired > 900s. The last shown band ends exactly
where the withheld band begins, so a position is either drawn with an honest age or not drawn
at all. Our own publication is stale after 120s; a timestamp more than 120s ahead of
retrieval is refused.

**Reconciliation identities**, each side computed from a different table:

```
activitiesTotal  = activitiesInArea + outsideArea + rejectedRecords
activitiesInArea = retainedObservations + repeatObservations + conflictingInputRows
publishableObservations = retainedObservations - suppressedObservations
observationsInServedFile + outsideCaptureWindow = publishableObservations
servedFileSha256 = recordedPublicationSha256
```

## Design decisions worth knowing

- **Expiry is a correctness control, not decoration.** The feed carries positions up to a
  day old. Without an expiry threshold a naive app draws yesterday's bus as traffic today.
- **A repeated payload is not new information.** Identical bytes are recorded as
  `repeat_payload` and do not advance the payload-change time.
- **Conflicts are withheld, not resolved.** We do not pick a winner.
- **Observed and estimated positions are kept apart.** Every published report is an
  observation (`positionKind: "observed"`) with its own timestamp, kept exactly as received.
  Since 13 September 2026 the owner has approved clearly labelled estimated movement: bounded
  prediction from a bus's recent reports, reconciled as each new report arrives, drawn and
  worded as an estimate with the actual report age beside it, and limited by measured
  behaviour. An estimate is never stored, published or counted as an observation, never
  proves that a bus reached, left or served a stop, and an observed-position mode remains.
- **A route number is not a service.** Operator, timetable version, operating day and
  direction are checked before position; a shared current stop is not a shared route.
- **Three distances, three labels.** You to your stop (a walking route with its source when
  asked for, otherwise a straight line labelled as one), the bus to your stop (straight line,
  plus the declared stop-sequence distance where it exists), and arrival, which is not
  predicted.
- **An estimate is judged by what a passenger sees.** Its settings are fitted on earlier
  captures and scored on later ones against the last report itself, and the evaluation also
  measures how far the drawn bus would move when each report arrives. The speed's easing with
  report age was chosen to cut how often a new report pulls the bus backwards, without losing
  accuracy.
- **Five feed states** — live, not updating, offline, not collecting, archive replay — never
  collapsed into one "last updated".
- **Colours carry meaning.** Blue is You, orange is your stop, lime is your chosen bus; none
  appears in either basemap theme (a Node test enforces it).
- **The map is created once.** Themes repaint it in place; views change its camera; its
  creation depends only on stable callbacks. `pnpm test:browser` checks the canvas identity
  through clock ticks, publications and a theme switch.
- **Runtime config over rebuilds**, and **a 10 s polling floor** (operators publish every
  10–30 s).

## Verified capabilities

Executed, with the check in the repository. Numbers from earlier milestones are in
`docs/LOCAL_VERIFICATION.md`.

- **Ride-along, night map, motion and the window-seat journey (13 September 2026, evening,
  latest):** 102 Node tests, typecheck, lint and the static build on the final code (87 Python
  tests earlier the same day; no Python changed). In a real Chromium on the final build: the 36
  browser checks that enter the ride-along, at desktop and phone size, all passing, and the
  window-seat checks, which play the real film through YouTube's embed and show the fallback when
  the player is blocked (5 passed, 1 skipped by design). The evening's last full browser run, on
  an earlier build, passed 104 of 107; its three failures were repaired and pass on the final
  build. A real recorded 256 journey replayed through the page: 1,481 frames over 276 s, 13
  reports reconciled by eased corrections (median 53 m), no snap, backward drawing only while a
  correction settled. Held out, the stop-aware estimate (motion-3) against the previous model and
  constant speed: error up to a minute, median 62.6 m (64.9, 69.3); mean visible move per
  arriving report 65.5 m (68.0, 70.7); reports pulling the bus back over 35 m 26.2% (20.9%,
  32.6%); snaps 8.9% (10.0%, 10.3%). Details in `docs/LOCAL_VERIFICATION.md` and
  `docs/MILESTONE_CHECKLIST.md`.
- **Walking guidance and estimated movement (13 September 2026, afternoon):** 87 Python tests, 95
  Node tests (the motion model's rules, the presentation clock, walking requests, failures and
  jitter), typecheck, lint, the static build, and 77 browser checks on the final build at
  desktop and phone size, none failing. Thirteen are skipped by design: the real-feed and
  real-walking checks, which need a live run or a real request and passed separately, and
  nine map checks that run on desktop only. Real captures: 109 journeys on
  routes 15, 250 and 256 (11,367 reports), split in time. On the 38 held-out journeys, within
  30 s of a report the estimate's median distance from the next report was **45.7 m against
  61.1 m** for the last report itself (3,907 cases). When a new report arrived, the drawn
  estimate moved a median of 51 m; 21% of those moves went backwards by more than 35 m (33% at
  constant speed) and 10% were over 150 m and snap. Real walking routes from
  routing.openstreetmap.de, for example 220 m and 3 minutes to St Modwen Road (nr). Details are
  in `docs/LOCAL_VERIFICATION.md` and `docs/MILESTONE_CHECKLIST.md`.
- **Earlier the same day:** 73 Python tests (identity-first matching, the
  shared-stop branch regression, operating days and school calendars, unknown link distances,
  coverage selection without a cap, publication by any stop inside the area, and matching
  against every held pattern, Bearing from 0 to 360 through storage, migration and
  publication), 70 Node tests (progress and association wording, the stop schematic,
  operating days in the browser, MapLibre validation of both themes, reserved colours),
  typecheck, lint, the static build, and 43 browser checks on desktop and a 390 px
  phone: stop-first discovery with location granted and refused, opposite-side and uncovered
  stops, shared-stop branching, day and night themes on one map instance, 2D, City and the
  ride-along and back, a failed 3D model, live, stale (report ages include the publication's
  own age), offline, unavailable and replay, no control, note or card over the map covering
  another in any view, the map lifecycle through clock ticks and publications, and four
  fallback modes.
- **Real feed:** bounded `pnpm dev:live` runs on 13 September on this machine. On the
  corrected code the publication of 14:16:22 BST held 342 buses: 267 with a reported bearing,
  75 without, none invalid; 201 placed on a timetable pattern, 57 kept unresolved between
  branches, 78 on routes with no timetable held, 4 too far from any pattern stop, and 2 on a
  service whose valid timetable has no journeys that day. The real-feed browser check passed
  on desktop and phone. One supported example, as the page showed it: BNML 250 (vehicle
  BU25YVB) to The Trafford Centre, bearing 242°, reported 14:16:27, one fitting path, revision
  20 of its timetable; at Matt Busby Way (westbound, Wharfside Way) the page read "Timetabled
  to call at your stop", last report nearest Trafford Bar, one stop before yours, 940 m in a
  straight line and 1.2 km along the stop sequence, arrival time not predicted.
- Earlier: real BODS collection runs (12 and 13 September), archive import reconciliation,
  the live collector's failure handling, the map lifecycle and worker repairs.

## Known limitations

- **Local only.** One WSL process, no scheduler, no hosted worker. When the machine stops,
  collection stops. Nothing is labelled continuously live.
- **Along-route distance is a stop-to-stop chain, not road geometry**, and is null where the
  timetable omits a link (about 1.6% of links across the three datasets).
- **Progress has no measured error bound.** It is counted from the nearest pattern stop.
- **No bus is tied to one timetabled journey.** The feed's journey references matched none of
  the timetable's journey codes in the 10 checked, so branches are settled only by the
  reported destination, and no scheduled time at a stop is shown.
- **Bank-holiday operation is recorded, not evaluated.**
- **Coverage is limited to the timetables held:** two TfGM operator datasets (BNML and BNSM).
  49 observed services have no timetable here, the largest by reports being BNGN's 10, 36, 37
  and 8, and their buses are refused with that reason. Ambiguity grew with coverage: more
  patterns mean more paths that fit a position equally well, and those stay unresolved.
- **The ride-along bus is a stylised generic model** at true scale (12 m); it identifies
  nothing about the real vehicle. The camera frames the drawn heading; a bus without one is
  shown from above as a round token.
- **Estimated movement covers 6 patterns on 3 routes** (15, 250 and 256), and was fitted and
  scored on one Sunday's captures, held out by later journeys rather than later days. Weekday
  traffic is untested. Real corrections remain visible: on the held-out captures about 1
  report in 4 pulls the drawn bus back by more than 35 m (the previous, eased-speed model:
  1 in 5, but it pushed the bus forward by more than 35 m on 41% of reports, against 35% now),
  and 1 in 11 moves it over 150 m
  and snaps, with the card saying so. The cause is measured, not guessed: buses stand at
  stops and lights while any estimate rolls on, and the reports are 20 s apart.
- **The ride-along's identifiability was judged in a software-rendered browser** on a 1280 px
  desktop and a 390 px phone, by projection and pixel measurement and by eye on the frames;
  a real phone, a real GPU and sunlight are still unchecked.
- **The window-seat journey depends on YouTube** honouring the creator's embed permission and
  on the creator keeping the video up; both were true on 13 September 2026 and are checked
  by a browser test that talks to the real service. Only one film is offered.
- **Walking routes depend on a free community service** (FOSSGIS e.V.) with no service
  guarantee. Its usage-policy page, in German, was behind a bot check and could not be read in
  full here; the limits followed are the ones its own pages state (attribution, a "fix the map"
  link, at most one request a second, no heavy use, requests logged).
- **The browser checks render with SwiftShader**, a software WebGL. They prove the map paints,
  survives updates, switches views and falls back correctly; they say nothing about real-GPU
  performance or battery. A check on a real phone is still outstanding.

## Two areas, deliberately different

`core.BBOX` is the box the retained **archive** sample was collected under and is fixed.
`core.SERVICE_AREA` is wider and is what **live collection and stop discovery** use, so
Longford Park and Stretford are inside it.

## The passenger view

Stop-first. **Buses near me** and **search** find a boarding point; each nearby stop shows
its side of the road (NaPTAN bearing), its street, and the timetabled services leaving it
today. Choosing a stop shows the walk there (on request), the buses **coming to your stop** by
the timetable's stop order, those that **may be coming** (a branch not yet settled), buses
**last reported nearby** (within 150 m, not coming to your stop), and, folded away, **more
buses near your stop**: already past it, not for it, and old reports. Only a bus coming to
the stop is chosen automatically. A bus explored from the other groups is labelled
**Selected bus**, says it does not serve the stop, and offers the way back. An explicitly
chosen bus stays chosen if it leaves the feed, and says so.

The answer card: which bus and destination; the answer first (its progress in stops from its
last report); whether it is drawn at an estimate or at its last report, with the report's
age and the reason; your walk; which boarding point; whether it is timetabled to call there
(or on how many of its possible branches); the three distances; and "How we know this", the source
report, bearing, match inputs, timetable version, verdict and the SHA-256 of the file the
page received. A schematic of named stops shows the order, labelled as not the road.

**The map** is an original MapLibre style over OpenFreeMap's OpenMapTiles vector tiles
(`lib/map-style.ts`), inspired by the elevated inked city maps of historical games: a paper
day theme and an ink night theme, cased roads, district names in spaced capitals, landmarks,
detail admitted by zoom. **2D** is north up and flat; **City** tilts it and raises the
buildings; **Fit journey** frames you, your stop and your bus without letting distant buses
widen it. Buses with a reported bearing carry a nose pointing where they are heading.
**Ride along** is one camera state at a time, shared by the map's frame loop, its HUD and the
passenger card (`data-ride`): *entering* (the first ride of a visit plays a short introduction,
the journey, you, your stop and the bus, centred on the bus, then down to it, skippable by button
or by a tap; later rides and reduced motion go straight to the bus), *following* (the camera is put on the drawn bus every frame, but never
while the map is already moving, so an animated zoom, a wheel or a pinch runs to its end and
the camera glides back), *exploring* (a drag pauses following; the bus goes on without the
camera and one button, **Return to bus**, glides back to the ride framing) and *returning*.
A gesture during an introduction or a return ends it; a transition made obsolete by another
bus or by leaving is cancelled by its token. The framing (zoom 20, above and behind the drawn
heading) is set on entry and by Return to bus, each of which first brings the bus to the middle
at the zoom shown and then zooms, tilts and turns around it, so the bus never swings out of the
frame. The map's padding changes only while the camera is still: setting it is a jump, which
would cancel a glide. The passenger's own zoom is kept through updates. The chosen bus is identifiable at every zoom: below 18 the flat lime marker with its
route number; from 18 the stylised 3D bus (`public/models/lm-bus.json`) inside a lime ground
ring with the route number floating above it, both symbols, which MapLibre draws over every
building, so a model behind one is still found. The HUD carries a short mode line ("Ride-along
· following the bus") with the explanation behind "What is this?". The chosen bus's recent
reports are drawn as small dots, and an estimate as a dashed line from its report to the drawn
bus, captioned ESTIMATE. The walking route is dotted blue. If the model cannot load the flat
symbol stays; if WebGL or the basemap fails, the drawn SVG map takes over.

**The Explore tab** also carries a **window-seat journey**: an independent creator's film from
the upper deck of a real 142, shown through YouTube's own embed only after the passenger asks,
with play, pause, full screen and the original video one tap away, and labelled as a recording
from 2022 that is tied to no live bus. Its facts (`public/data/window-seat.json`, validated by
`lib/window-seat.ts`) are each stated by the creator or read from the service; the film has no
timestamped chapters, so the map is not moved with it, and today's timetable for the line is
shown apart as orientation, never as the recorded route.

MapLibre's own modules are served unbundled from `public/vendor/maplibre-gl/<version>/`
(`scripts/vendor-maplibre.mjs`), because bundling them rewrote the worker URL to a
build-machine path and no tile ever loaded.

## Stop and timetable coverage

- **3,498 active bus stops** in the service area, from NaPTAN ATCO area 180, each with its
  indicator, street and, where NaPTAN has one, the direction a bus travels there.
- **Timetables:** three TfGM TransXChange datasets are preserved (the current BNML and BNSM
  datasets and an earlier version); 443 of their files are valid on 13 September.
- **Selection:** every operator-and-line pair seen in the collected positions that has a valid
  file: 89 services, 9,331 journey patterns, 404 distinct stop sequences, **387 published**.
  A pattern is published when it calls at a stop inside the area and has at least five stops;
  166 of the 387 would have been hidden by the earlier 60% rule. `--coverage all`, `--lines`
  and `--max-lines` are explicit alternatives, and whichever is used is written into
  `patterns.json` under `coverage`, with the observed services that have no timetable.
- `patterns.json` is 1.47 MB (105 KB gzipped).

## Next priorities

1. **Decide on hosting** so collection runs when this machine does not. A costed proposal is
   in `docs/HOSTING.md`: one Hetzner CX22 with systemd and Cloudflare, about £3–5 a month.
   Needs your approval before anything is provisioned.
2. **Identify the timetabled journey**, not just the pattern: match the operator's reported
   origin departure time against journeys on the same line, direction and day, and measure
   the hit rate before any scheduled time is shown (opportunity log, entry 7).
3. **Show the coverage ledger** in Operations: every observed service and why it is or is not
   covered (opportunity log, entry 6).
4. Run collection for a sustained period and measure overnight reliability, recovery from a
   real outage, and storage growth. Weekday captures would also let the motion evaluation be
   held out by day rather than by later journeys, before estimates extend beyond three routes.
5. One look on a real phone, in sunshine and at night: legibility, the ride-along's frame
   rate and battery, and walking directions with a real GPS.
6. Road shapes for more routes (opportunity log, entry 10).

See also: `docs/HOSTING.md`, `docs/PIPELINE.md`, `docs/BACKLOG.md`,
`docs/LOCAL_VERIFICATION.md` (measured results), `docs/REVIEW.md`,
`docs/MAP_REPAIR_VERIFICATION.md`, `docs/INSPIRATION_RESEARCH.md`.
