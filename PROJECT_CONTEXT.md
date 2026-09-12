# Lost Minutes — project context

Working context for anyone (or any assistant) picking this up. Status words are used
strictly: **Implemented** exists in the code, **Verified** has an executed check behind it,
**Planned** does not exist yet, **Unknown** has not been established.

Last updated: 12 September 2026 (after the first real BODS capture).

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
public archive ────┴─> data/raw, data/live-capture   raw bytes, content-addressed, not in Git
                       │
                       ├─> DuckDB (data/warehouse)  sources, runs, cycles, observations,
                       │                            conflicts, quarantine, publications
                       │
                       ├─> public/data/replay.json      archive snapshot (validated, atomic)
                       ├─> public/data/live.json        live state  (validated, atomic)
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
pnpm dev                    # http://localhost:3000
pnpm build                  # static export to out/
pnpm start                  # serve out/ with Python
pnpm test                   # Node contract tests
pnpm typecheck && pnpm lint

python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m pipeline.run import        # archive: fetch, load, publish
.venv/bin/python -m pipeline.run status        # refresh and print Operations
.venv/bin/python -m pipeline.live init         # write an honest "unavailable" live state
.venv/bin/python -m pipeline.collect --minutes 10   # live collection (needs a key)
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
- **No timetable matching.** Three TfGM timetable versions are preserved alongside the
  position captures (datasets 17472 and 14928 are configured; both declare windows covering
  the capture date). Measured coverage is partial: dataset 17472 (operator BNML) shares 18 of
  the 114 route labels we observe, 14928 (BNSM) shares 7. Holding a timetable is not evidence
  of a valid journey match, so there are still no ETAs, nearby stops, approaching-bus claims,
  punctuality figures or travel times.
- **Unknown:** the operator's true publication cadence (our measurements are bounded by our
  own sampling), and whether route labels correspond to registered services.
- The service worker caches published JSON for offline use. It has no background sync and
  does no background location tracking.

## Next priorities

1. **Decide on hosting** so collection runs when this machine does not. A costed proposal is
   in `docs/HOSTING.md`: one Hetzner CX22 with systemd and Cloudflare, about £3–5 a month.
   Needs your approval before anything is provisioned.
2. Run collection for a sustained period and measure what a bounded ten minutes cannot:
   overnight reliability, recovery from a real outage, and storage growth against the
   estimate of 0.13 GB/day.
3. Validate route and stop relationships, which unlocks the first honest measurement.

See also: `docs/HOSTING.md` (costed hosting proposal), `docs/PIPELINE.md` (data model and recovery), `docs/BACKLOG.md` (what is not being
built yet and why), `docs/LOCAL_VERIFICATION.md` (measured results), `docs/REVIEW.md`
(critique and visual direction).
