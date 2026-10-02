# Lost Minutes

Manchester bus tracking and timetable-based journey planning, backed by an auditable Python/DuckDB pipeline and an
interactive 3D map.

**Live: <https://lost-minutes.duckdns.org>**. It has been hosted on one server since 20 September 2026; uptime is not
measured. The interface has been tested in desktop and phone emulation, not yet on a phone in hand. Arrival
predictions were built, evaluated and are **switched off** (they did not meet criteria written before the results).

<img src="docs/images/phone-stop-2026-10-02.png" width="320" alt="A 390 px phone screen: Piccadilly Gardens, Stop L, on
the day map, with nearby buses labelled by route number, and below the map the stop's next departures marked
Scheduled, not live: the 255 to Partington Terminus at 21:55, timetabled, in 10 minutes.">

*The served site at 21:45 on 2 October 2026, real data, in phone emulation.*

## What it does

- **Find a stop** by name, bus number or place, or nearby. A stop shows its timetabled departures (labelled as the
  timetable) and the buses on its routes, each placed by its last report, with the report's age.
- **Follow one bus** on the map, drawn between its own reports, or ride along with it in 3D. On three evaluated routes
  a clearly labelled estimate may run up to two minutes past the last report; nothing is ever stored as a report.
- **Plan a journey**, direct or with one change, from the operators' registered timetables, with the walks.
- **Behind the data**: the pipeline's runs, cycles and publications as it recorded them, the evidence behind the
  figures, and a replay of a recorded archive sample.

It does not predict arrival times, show live departure minutes, or cover Metrolink.

## How it works

```mermaid
flowchart LR
  subgraph sources["Public sources"]
    bods["BODS SIRI-VM feed<br/>every bus's latest position"]
    txc["TfGM TransXChange timetables<br/>4 operator datasets"]
    naptan["NaPTAN stops<br/>Greater Manchester"]
  end

  subgraph server["One server: Ubuntu, systemd"]
    collector["Collector<br/>pipeline/collect.py<br/>one writer lock<br/>feed every 20 s<br/>timetables hourly"]
    raw[("Raw captures<br/>gzip, named by SHA-256")]
    warehouse[("DuckDB warehouse<br/>observations, conflicts, quarantine,<br/>runs, cycles, publications")]
    publish["Build, match to timetable patterns,<br/>validate, replace atomically<br/>pipeline/live.py"]
    nightly["Nightly: timetable catalogue and stop<br/>departure boards (collector paused);<br/>arrival evaluation (nothing released)"]
    files["Published JSON<br/>live.json · patterns.json ·<br/>departures/ · operations.json"]
    caddy["Caddy, HTTPS<br/>static site and /data"]
  end

  subgraph dev["Developer machine"]
    build["Next.js static export,<br/>road shapes (FOSSGIS Valhalla),<br/>tests"]
  end

  subgraph browser["Browser"]
    app["Static app: polls live.json every 20 s,<br/>draws movement, plans journeys"]
  end

  external["On request from the browser:<br/>OpenFreeMap tiles, walking routes,<br/>place search"]

  bods --> collector
  txc --> collector
  naptan -. "imported once" .-> warehouse
  collector --> raw
  collector --> warehouse
  warehouse --> publish --> files
  warehouse --> nightly --> files
  files --> caddy
  build -. "deploy/publish.sh (rsync)" .-> caddy
  caddy --> app
  app -.-> external
```

The boundaries that matter: phones never contact BODS; only the collector writes to the warehouse; a published file
is replaced only after it validates; the browser reads static files and does its own drawing and planning. The
details are in [`docs/PIPELINE.md`](docs/PIPELINE.md) and [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md).

Where to look in the code:
- `pipeline/collect.py`: the collector, its writer lock, per-cycle records and stage timings;
- `pipeline/core.py`: parsing, quarantine reasons and observation identity;
- `pipeline/warehouse.py`: the DuckDB schema and the repeat and conflict classification;
- `pipeline/live.py`: building, validating and atomically publishing the live state;
- `pipeline/match.py`: placing a bus on a timetable pattern, or refusing with a reason;
- `lib/motion.ts`: how a bus is drawn between its reports; `lib/connections.ts`: journey planning;
- `deploy/`: the systemd units, the health check, deploy and rollback.

## Engineering decisions worth reading

1. **One observation, defined.** Identity is (operator, vehicle, route, direction, journey, observation time). The
   same identity at a different place is a conflict: both readings are kept and neither is published. Every response
   is kept byte for byte, named by its SHA-256, and three clocks (observed, retrieved, published) are never merged.
   [Case study 1](docs/case-studies/01-ingestion-identity-and-recovery.md).
2. **Refuse rather than guess.** A bus is placed on a timetable pattern only when operator, timetable version,
   operating day and direction agree; two equally good branches stay unresolved. Positions over 15 minutes old are
   withheld and counted. Conflicts are withheld, not resolved.
3. **Measure before optimising.** The collector times each stage in its own log. That showed two whole-history
   queries taking 27.5 s of a 32 s cycle; bounding them cut the received-to-written median from 32.0 s to 4.8 s.
   [Case study 2](docs/case-studies/02-latency-investigation.md).
4. **Evaluate before releasing, and accept a no.** Arrival criteria were written before the results, the evaluation
   is frozen and pinned to its code by hash, and the estimate stays off because it fails them.
   [Case study 3](docs/case-studies/03-arrival-evaluation.md).
5. **Reproduce production failures before fixing them.** A swallowed stop signal, an out-of-memory kill, a timetable
   that was an error page. [Case study 4](docs/case-studies/04-operational-failures.md).

## Measurements

| What | Value | Basis |
|---|---|---|
| Stored live observations | 12.8 million | the warehouse, about 17:45 UTC, 2 Oct 2026 |
| Vehicle activity records inside the area, per feed response | 630–658 | 203 responses, 17:54–19:17 UTC, 2 Oct 2026; a count per response, not buses in service |
| Receipt to the file being written, per cycle (median) | 32.0 s → **4.8 s** | 72 and 131 cycles, consecutive live windows on 2 Oct 2026, before and after one change; not a same-input benchmark |
| A report's age on reaching an emulated phone (median) | 51.9 s → 19.2 s and 22.6 s | one emulated phone, 20 minutes a run, same day |
| Timetable coverage | 4 datasets, 206 observed services, 585 patterns; 133 observed services with no timetable held | the server's nightly build, 02:43 UTC, 2 Oct 2026 |

Every figure, with its metric, window and sample, is in [`docs/EVIDENCE.md`](docs/EVIDENCE.md).

## Guarantees, and their limits

- **One writer.** An exclusive advisory file lock: a second collector refuses to start (it does not stop other
  programs). This is one process on one machine, not distributed or exactly-once processing: loading is idempotent
  (the same bytes add no rows).
- **Atomic replacement of one file.** Each published file is written aside and renamed into place only after it
  validates, so a reader never sees a half-written file. The live file is not `fsync`ed, so the newest write may not
  survive a power cut. Files are replaced independently, and a deploy (rsync) is not atomic.
- **Recovery.** A stopped run records why; a killed run is closed as abandoned by the next one; the warehouse can be
  rebuilt from the captures (`pipeline/restore.py`). There is no off-server backup and no external alerting.
- **Coverage.** Buses whose operator timetable is not held are shown at their reports but not placed on a route.
- **Planning** uses registered timetables; a timetable not checked against real buses is said to be unchecked.
- **Arrival predictions are disabled** in both directions.

## Run it locally

Credential-free (the map, stops, timetables, a recorded ride and the archive replay; no live buses):

```bash
pnpm install --frozen-lockfile
pnpm build && pnpm start        # http://localhost:3000
```

Live collection needs a free BODS key, Python 3.11+ and a few minutes of first-run downloads. Both paths, with
prerequisites and the external services each one contacts, are in [`docs/SETUP.md`](docs/SETUP.md).

## Tests

- **Python** (the pipeline, matching, the arrival protocol, restore): 191 tests, 190 passed, 1 skipped (it needs the
  downloaded archive sample), 0 failed. **Node** (contracts, drawing, planning, navigation): 349 tests, 346 passed,
  3 skipped, 0 failed. Both in CI on `fead20d` (2 Oct 2026), which runs them on every push with type checking, lint,
  the static build, a scan of the built site for credential values, and a check of the systemd units that fails on
  an unknown directive.
- **Browser**: 534 checks in Chromium with software WebGL, desktop and phone emulation, about 1.4 hours locally; on
  `11eebf5` (2 Oct 2026) 483 passed, 51 skipped by design, 0 failed. Not in CI: it depends on external map tiles.

```bash
pnpm test && pnpm typecheck && pnpm lint
.venv/bin/python -m unittest discover -s tests
scripts/setup-browser.sh && pnpm build && pnpm test:browser
```

## Limitations

- Tested in emulation only; nothing has been checked on a phone in hand.
- A report is about 20 s old when it reaches a page (median, 2 Oct 2026): about 10 s upstream, about 5 s ours, and
  0–20 s waiting for the page's next poll.
- A bus's progress is counted in stops from its nearest pattern stop, with no measured error bound.
- One server, one disk; uptime is not measured.
- The 3D "front view" is a stylised map drawing, not imagery.

## At a larger scale

*Analysis written on 2 October 2026; none of this is built.*
- **Storage**: a single DuckDB file with one writer suits one city on one machine. Many feeds would want
  append-only, date-partitioned columnar files, with deduplication by the existing identity key.
- **Per-cycle work must stay bounded.** The database load still joins each payload to the whole history
  (3.4 s, growing); it should read only the payload's own time range.
- **Delivery**: one static file polled every 20 s by every browser is cheap at this scale. Many viewers would want a
  CDN with a short cache time, or a push channel, and polls aligned to publication.
- **Operations**: stage timings live in the collector's log. A larger service would export them as metrics, alert on
  them, and back captures up to object storage; content addressing already makes that incremental.

## How this was built

Hammam Elshtewi directs this project: he sets its goals and scope, makes the product and release decisions recorded
in these documents (for example keeping arrival predictions off), and reports what he finds using it. Most of the
code, tests and documentation were written with an AI coding assistant (Anthropic's Claude, through Claude Code),
working under the project's written rules ([`AGENTS.md`](AGENTS.md), [`CLAUDE.md`](CLAUDE.md)). The application
itself contains no AI features.

## Documentation

[`docs/README.md`](docs/README.md) is the index: start there for the case studies, the evidence page, the release
record and the design notes; superseded material is labelled as historical.

## Data and licences

- Bus positions and timetables: Department for Transport and contributing operators, via the Bus Open Data Service;
  stops: NaPTAN. Open Government Licence v3.0. The recorded archive sample: Open Innovations / National Data Library
  BODS archive, OGL v3.0.
- Map tiles: OpenFreeMap, © OpenMapTiles, © OpenStreetMap contributors (ODbL). Road shapes for bus routes: generated
  from OpenStreetMap data by the FOSSGIS Valhalla service (ODbL). Walking routes: FOSSGIS e.V.'s OSRM foot profile on
  routing.openstreetmap.de, asked for only when the passenger chooses. Place search: Photon (komoot), © OpenStreetMap
  contributors, and postcodes.io.
- Bundled software: MapLibre GL JS (BSD-3-Clause), CesiumJS (Apache-2.0, private preview only), Inter and Space Grotesk
  (SIL Open Font Licence, `public/fonts/LICENCES.txt`), shadcn/ui styles (MIT, `vendor/`).
- Code: MIT, © 2026 Hammam Elshtewi ([`LICENSE`](LICENSE)).
