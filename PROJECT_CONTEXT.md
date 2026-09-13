# Lost Minutes — project context

Working context for anyone (or any assistant) picking this up. Status words are used
strictly: **Implemented** exists in the code, **Verified** has an executed check behind it,
**Planned** does not exist yet, **Unknown** has not been established.

Last updated: 13 September 2026 (stop-first passenger view, original cartography, 3D
ride-along, Bearing, and identity-first timetable matching).

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
                       ├─> public/data/operations.json  pipeline truth
                       └─> public/data/config.json      runtime pointers
                                     │
                    Next.js static export ──> phones poll the published objects only
```

Phones never contact BODS. One collector reads the feed for everyone.

**Implemented and verified.** Archive import, live collector, DuckDB history, validate-then-
swap publication for both snapshot kinds, Operations view, Evidence view, the stop-first
Follow view, PWA shell, service-pattern matching with identity checks, Bearing capture.

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
- **Nothing is interpolated.** Every published position carries `positionKind: "observed"`.
  The camera may glide between reports (City view, ride-along); a bus marker or model never
  moves except to a new reported fix.
- **A route number is not a service.** Operator, timetable version, operating day and
  direction are checked before position; a shared current stop is not a shared route.
- **Three distances, three labels.** You to your stop (straight line), the bus to your stop
  (straight line, plus the declared stop-sequence distance where it exists), and arrival,
  which is not predicted.
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

- **This milestone (13 September 2026):** 73 Python tests (identity-first matching, the
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
  nothing about the real vehicle. The camera frames the reported bearing; a bus without one
  is shown from above as a round token.
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
today. Choosing a stop shows the services from it as destination-labelled choices, the buses
**at the stop now** (last report within 150 m, whatever their service), the buses **coming to
your stop** by the timetable's stop order, and, kept apart, other buses nearby that are not
confirmed for it. An explicitly chosen bus stays chosen if it leaves the feed, and says so.

The answer card: which bus and destination; which boarding point; whether it is timetabled
to call there (or on how many of its possible branches); its progress in stops from its last
report; how old that report is; the three distances; and "How we know this", the source
report, bearing, match inputs, timetable version, verdict and the SHA-256 of the file the
page received. A schematic of named stops shows the order, labelled as not the road.

**The map** is an original MapLibre style over OpenFreeMap's OpenMapTiles vector tiles
(`lib/map-style.ts`), inspired by the elevated inked city maps of historical games: a paper
day theme and an ink night theme, cased roads, district names in spaced capitals, landmarks,
detail admitted by zoom. **2D** is north up and flat; **City** tilts it and raises the
buildings; **Fit journey** frames you, your stop and your bus without letting distant buses
widen it. Buses with a reported bearing carry a nose pointing where they are heading.
**Ride along** follows the chosen bus from above and behind its reported bearing with a
stylised 3D bus (`public/models/lm-bus.json`, loaded only when needed), labelled as a map
visualisation, with the route, report age, stop progress and an Exit. If the model cannot
load the flat symbol stays; if WebGL or the basemap fails, the drawn SVG map takes over.

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
   real outage, and storage growth.
5. One look on a real phone, in sunshine and at night.

See also: `docs/HOSTING.md`, `docs/PIPELINE.md`, `docs/BACKLOG.md`,
`docs/LOCAL_VERIFICATION.md` (measured results), `docs/REVIEW.md`,
`docs/MAP_REPAIR_VERIFICATION.md`, `docs/INSPIRATION_RESEARCH.md`.
