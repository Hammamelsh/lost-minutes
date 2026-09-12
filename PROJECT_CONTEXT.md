# Lost Minutes — project context

Working context for anyone (or any assistant) picking this up. Status words are used
strictly: **Implemented** exists in the code, **Verified** has an executed check behind it,
**Planned** does not exist yet, **Unknown** has not been established.

Last updated: 13 September 2026 (vector map, nearby stops, and one command for local live operation).

## Product goal

An independently hosted, mobile-first Manchester bus companion, whose source lives in the
owner's own GitHub repository. The everyday job is small and concrete: save a route and
direction, see the last reported positions, follow one bus.

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
                       ├─> DuckDB (data/warehouse)  sources, runs, cycles, observations,
                       │      conflicts, quarantine, publications, stops, service patterns
                       │
                       ├─> public/data/replay.json      archive snapshot (validated, atomic)
                       ├─> public/data/live.json        live state + per-bus pattern match
                       ├─> public/data/stops.json       1,709 boarding points, 121 routes
                       ├─> public/data/patterns.json    44 ordered stop sequences
                       ├─> public/data/operations.json  pipeline truth
                       └─> public/data/config.json      runtime pointers
                                     │
                    Next.js static export ──> phones poll the published objects only
```

Phones never contact BODS. One collector reads the feed for everyone.

**Implemented and verified.** Archive import, live collector, DuckDB history, validate-then-
swap publication for both snapshot kinds, Operations view, Evidence view, Follow view, PWA
shell.

**Planned.** Hosting the published objects somewhere that keeps running; a scheduler;
timetable matching; stop passage inference; travel-time measurement.

## Commands

```bash
pnpm install --frozen-lockfile
pnpm dev                    # frontend only, http://localhost:3000
pnpm dev:live               # frontend + collector together, Ctrl-C stops both
pnpm dev:live -- --minutes 20
pnpm build                  # static export to out/
pnpm start                  # serve out/ with Python
pnpm test                   # Node contract tests
pnpm typecheck && pnpm lint

python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m pipeline.run import        # archive: fetch, load, publish
.venv/bin/python -m pipeline.run status        # refresh and print Operations
.venv/bin/python -m pipeline.live init         # write an honest "unavailable" live state
.venv/bin/python -m pipeline.collect --minutes 10   # live collection alone
.venv/bin/python -m pipeline.stops import           # NaPTAN -> stops.json
.venv/bin/python -m pipeline.patterns               # TransXChange -> patterns.json
.venv/bin/python -m unittest discover -s tests      # full Python suite
python3 -m unittest discover -s tests               # parser tests only, skips DuckDB
```

## Data definitions

**Observation identity** — `(operator, vehicle, route, direction, journey_ref,
observed_at_ms)`. Same identity and same coordinates is a repeat. Same identity and
different coordinates is a conflict. **A new timestamp is always a new identity**, so a bus
that reported again without moving is preserved. That is not evidence it stood still.

**Three clocks, never merged.** `observed_at` is when the vehicle reported (the source's own
string is kept verbatim in `recorded_at_text`). `retrieved_at` is when we fetched the
response. `published_at` is when we wrote the file. The age shown to a passenger is always
the age of the observation.

**Stop identity** — a stop is a physical boarding point with an ATCO code. Two stops can
share a name and face opposite ways; NaPTAN's indicator ("Stop A", "opp") and bearing (the
direction a bus travels there) are what tell them apart.

**Service pattern** — one ordered list of stops a service calls at, from TransXChange. One
route label has several: directions, branches and short workings. A bus is placed *on a
pattern*, never merely near a passenger, and a refusal carries its reason.

**Freshness policy** (`pipeline/freshness.py`), derived from measurement, not taste:
fresh ≤ 60s, ageing ≤ 150s, stale ≤ 900s, expired > 900s. The last shown band ends exactly
where the withheld band begins, so a position is either drawn with an honest age or not drawn
at all. Our own publication is stale after 120s; a timestamp more than 120s ahead of
retrieval is refused.

**Two delays, separately measured.** `observationToSourcePublication` and
`observationToRetrieval` are theirs; `ourCycle` (request → stored, parsed, loaded, published)
is ours. Every measurement is scoped to one source kind and labelled, so archive figures can
never be read as live performance.

**Reconciliation identities**, each side computed from a different table:

```
activitiesTotal  = activitiesInArea + outsideArea + rejectedRecords
activitiesInArea = retainedObservations + repeatObservations + conflictingInputRows
publishableObservations = retainedObservations - suppressedObservations
observationsInServedFile + outsideCaptureWindow = publishableObservations
servedFileSha256 = recordedPublicationSha256
```

`outsideArea` counts real buses outside the chosen box — not errors. Table grain is listed in
`docs/PIPELINE.md`.

## Design decisions worth knowing

- **Expiry is a correctness control, not decoration.** The retained sample proved the feed
  carries positions up to **23.1 hours old** (56 of 3,496 over ten minutes old). Without an
  expiry threshold a naive app draws yesterday's bus as traffic today.
- **A repeated payload is not new information.** Identical bytes are recorded as
  `repeat_payload` and do not advance the payload-change time.
- **Conflicts are withheld, not resolved.** The first reading stays as evidence; the identity
  is excluded from anything published. We do not pick a winner.
- **Nothing is interpolated.** Every published position carries `positionKind: "observed"`.
  Markers never animate between fixes, because an eased move implies a fix we never saw.
  Only the selection halo animates, and only when motion is welcome.
- **Ages survive a wrong device clock.** The publisher's clock measures the age at
  publication; the device only adds locally elapsed time since the fetch.
- **Archive, live, stale, offline and unavailable are five distinct states**, never collapsed
  into one "last updated". Archive mode is an explicit, badged choice and shows absolute
  observation times rather than relative ages.
- **Runtime config over rebuilds.** `public/data/config.json` names the live URL and poll
  interval, so the published state can move host without rebuilding the site.
- **Polling floor of 10s.** Operators must publish every 10–30s (DfT implementation guide),
  so a faster poll only returns bytes we already have. There is no published consumer rate
  limit; the documented 1 request/second limit applies to archive downloads.

## Verified capabilities

Executed, with the check in the repository:

**Real BODS collection, 12 September 2026, 21:42–21:52 UTC** (a bounded 10-minute run; it
proves that run, not long-term reliability):
- 30 requests, **30 succeeded, 0 failed**, 0 repeated payloads, 13.6 MB retrieved.
- 3,752 observations across **376 distinct vehicles**; 0 quarantined, 0 conflicts.
- Observation age when we received it: **p50 9.9s**, p95 4,165.9s, max 86,047.9s (23.9 hours)
  — the live feed carries the same very old positions the archive did, on live data.
- Our own cycle (request → stored, parsed, loaded, published): **p50 0.7s**, p95 1.1s.
- Report interval per vehicle: p50 21.0s, p95 28.0s, at a 20s poll — consistent with the
  published 10–30s operator requirement.
- A second collector was refused the lock while the real run held it.
- One observation traced end to end: vehicle 66074, route 2, recorded 21:52:12 UTC, retrieved
  21:52:17 UTC (**5.9s old**), stored with its identity and lineage, published in a snapshot
  that passed 8/8 checks, served over HTTP with identical coordinates, and rendered as a
  marker in the built application.

- Archive import reproduces 312,123 vehicle reports → 4,236 in area → 3,496 retained, 740
  repeats, 3,426 published across 419 journeys, all five identities balanced.
- A second identical import produces **0 new observations and 4,236 repeats**.
- Real archive payloads through the live collector: 999 observations loaded, **all 392
  vehicles withheld as expired**, state `stale`, nothing drawn.
- Repeated payload, out-of-order report, future timestamp, expired position, malformed body,
  upstream transport failure, rejected credentials, overlapping writer, interrupted run,
  failed validation keeping the previous file, credential redaction.
- 29 Python tests (8 parser, 7 pipeline history, 14 live collection), 21 Node contract
  tests, typecheck, lint and the static build.
- Browser: Follow, Explore, Evidence and Operations at 390px and 1280px; no page-level
  horizontal overflow with the Operations or Follow tab active.

## Known limitations

- **Collection has only ever run for ten minutes.** One bounded run proves the path works; it
  says nothing about overnight reliability, rate limiting under sustained use, or recovery
  from a long outage. `public/data/live.json` ships as an honest `unavailable` placeholder;
  the collector overwrites it at runtime.
- **No consumer rate limit is published by BODS.** The official developer documentation
  states only that an API key is required; it documents no request ceiling for
  `/api/v1/datafeed`. The 1 request/second limit that is documented applies to archive
  downloads. The 20s default poll is therefore a courtesy, chosen against the 10–30s operator
  publication requirement, not a published limit.
- **Local only.** One WSL process, no scheduler, no hosted worker. When the machine stops,
  collection stops. Nothing is labelled continuously live.
- **Along-route distance is a stop-to-stop chain, not road geometry.** Measured on 1,791
  consecutive stop pairs, the operator's declared link distance is the same as the straight
  line for most of them (median 1.01x, mean 1.08x; only 27% exceed it by more than 5%). The
  interface says "along the stop sequence" for that reason.
- **"Out by about a stop" is a stated property, not a measured error bound.** A position
  places a bus near a pattern stop without saying whether it has already called there. No
  measurement of the true error has been made.
- **Timetable matching is partial.** Three TfGM timetable versions are preserved alongside the
  position captures (datasets 17472 and 14928 are configured; both declare windows covering
  the capture date). Measured coverage is partial: dataset 17472 (operator BNML) shares 18 of
  the 114 route labels we observe, 14928 (BNSM) shares 7. Holding a timetable is not evidence
  of a valid journey match, so there are still no ETAs, nearby stops, approaching-bus claims,
  punctuality figures or travel times.
- **Unknown:** the operator's true publication cadence (our measurements are bounded by our
  own sampling), and whether route labels correspond to registered services.
- The service worker caches published JSON for offline use. It has no background sync and
  does no background location tracking.

## Two areas, deliberately different

`core.BBOX` is the box the retained **archive** sample was collected under and is fixed,
because the published archive figures were measured inside it. `core.SERVICE_AREA` is wider
and is what **live collection and stop discovery** use: Longford Park sits 0.6 km outside the
archive box, so the nearest six stops to it were all unreachable. Widening west to Stretford
and Trafford took the catalogue from 1,709 to 3,498 stops and the publishable patterns from
44 to 67.

## Visual priority

The passenger view is the deliverable, not the pipeline behind it. MapLibre renders an
OpenFreeMap dark vector basemap with streets, water and added green space; "You", "Your stop"
and the selected bus are three different symbols with labels; reported location accuracy is
drawn as the circle it actually describes rather than a false point. A fit control puts those
three on screen together. An optional pitched City view adds building extrusions and resets to
flat in one tap. The drawn SVG map is the automatic fallback when WebGL is missing or the
first paint does not complete within seven seconds, so nobody is left looking at a black
rectangle.

## Stop and timetable coverage

- **1,709 active bus stops** inside the collected area, from NaPTAN ATCO area 180 (21,526 rows
  in; the rest are outside the area, inactive, or not bus stops). 1,672 carry a bearing.
- **44 publishable service patterns** across **13 route labels** (111, 135, 142, 143, 18, 192,
  219, 30, 42, 43, 50, 53, 86), from 3,278 journey patterns that collapse to 78 distinct stop
  sequences. A pattern is published only when at least 60% of its stops lie inside the
  collected area and it has at least 5 stops.
- On the real capture, **113 of 376 vehicles** matched a pattern. The rest are refused with a
  reason, overwhelmingly `no_pattern_for_route`: we hold patterns for 13 of the 85 route
  labels observed, and the interface says so rather than guessing.

## Next priorities

1. **Confirm the vector map by eye.** MapLibre is integrated and its style, TileJSON and
   sprites all return 200, but this headless environment cannot complete a WebGL first paint,
   so the rendered basemap could not be verified here. It needs one look in a real browser.
2. **Decide on hosting** so collection runs when this machine does not. A costed proposal is
   in `docs/HOSTING.md`: one Hetzner CX22 with systemd and Cloudflare, about £3–5 a month.
   Needs your approval before anything is provisioned.
3. Run collection for a sustained period and measure what a bounded ten minutes cannot:
   overnight reliability, recovery from a real outage, and storage growth against the
   estimate of 0.13 GB/day.
4. Widen pattern coverage beyond 13 route labels, and use the per-link run times already in
   TransXChange to attempt a scheduled-time comparison.

See also: `docs/HOSTING.md` (costed hosting proposal), `docs/PIPELINE.md` (data model and recovery), `docs/BACKLOG.md` (what is not being
built yet and why), `docs/LOCAL_VERIFICATION.md` (measured results), `docs/REVIEW.md`
(critique and visual direction).
