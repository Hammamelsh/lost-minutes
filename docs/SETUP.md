# Running Lost Minutes locally

Two separate paths. The first needs no account and shows the interface on committed data; the second collects the
live feed into your own warehouse. Both were run from a fresh clone on 2 October 2026 (see the end of this page).

## Prerequisites

| | Credential-free demo | Live collection |
|---|---|---|
| Git | yes | yes |
| Node.js ≥ 22.13 and pnpm 11.25.0 (`npm install -g pnpm@11.25.0`, or Corepack) | yes | yes |
| Python 3 (the demo uses it only to serve the built files) | 3.x | **3.11+**, with `venv` |
| A free Bus Open Data Service (BODS) API key | no | **yes**: register at <https://data.bus-data.dft.gov.uk/account/signup/> |
| Disk | about 1.2 GB (dependencies 1.1 GB, the build 28 MB) | plus about 0.2 GB a day of raw captures (the server's rate, 20 September–2 October 2026) |

## 1. Credential-free demo

```bash
git clone https://github.com/Hammamelsh/lost-minutes.git
cd lost-minutes
pnpm install --frozen-lockfile
pnpm build          # static export to out/
pnpm start          # serves out/ at http://localhost:3000
```

`pnpm dev` runs the development server instead (also on port 3000).

**What you will see.** The map; search over 3,498 Greater Manchester stops; each stop's routes and the journey
planner, from the timetable catalogue committed on 22 September 2026; Try Ride-along's recorded ride (a 163 on 23
September); and under *How it's built*, the Operations and Evidence views and a replay of the 11 September 2026
archive sample. **What you will not**: live buses (the committed `live.json` says, truthfully, that no credentials are
configured) and stop departure boards (generated nightly on the server, not committed).

**External services the browser contacts.** OpenFreeMap for map tiles, on every load. Only when you use them:
`routing.openstreetmap.de` (walking routes), `photon.komoot.io` and `api.postcodes.io` (place search). No API key is
involved in any of them, and the page never contacts BODS.

## 2. Live collection

Run from the same clone. Do not run two collectors against one warehouse: the second refuses to start.

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt       # duckdb and pytz
cp .env.example .env                            # then set BODS_API_KEY=… in .env (never commit it)

.venv/bin/python -m pipeline.stops import       # NaPTAN stops for ATCO area 180, once
.venv/bin/python -m pipeline.collect --minutes 2   # positions, and the four timetable datasets
.venv/bin/python -m pipeline.patterns build     # the timetable catalogue for the services just observed
pnpm dev:live                                   # the collector and the frontend together; Ctrl-C stops both
```

- `.env.example` already lists the four TfGM timetable datasets in `BODS_TIMETABLE_URL`; their downloads need no key.
- The collector reads the key from `.env` itself. It is never passed on a command line, logged, written to the
  warehouse or published (`pipeline/env.py`, `redact_url`).
- `pnpm dev:live -- --minutes 20` bounds the run; the default is 90 minutes. A run records how it ended.
- The catalogue covers the services **seen so far**: after a two-minute collection on an October evening it held
  106 services and 431 patterns. Collect for longer and run `pipeline.patterns build` again (with no collector
  running: one writer) for more; the server rebuilds it nightly from a day of observations.
- Optional: `.venv/bin/python -m pipeline.departures publish` writes the stop departure boards from the catalogue.

**What it downloads.** NaPTAN for Greater Manchester (`naptan.api.dft.gov.uk`, once); four timetable datasets from
BODS (about 27 MB together, again every hour while the collector runs); the position feed every 20 s
(`data.bus-data.dft.gov.uk`, with your key). Everything it stores goes under `data/`, which Git ignores.

**What you will see.** At <http://localhost:3000>, live buses within about a minute of starting, placed on routes for
the services whose timetables are held.

## Checks

```bash
pnpm test && pnpm typecheck && pnpm lint          # Node tests, types, lint
.venv/bin/python -m unittest discover -s tests    # Python tests (DuckDB tests need the venv)
scripts/setup-browser.sh                          # once: the browser's libraries, no root needed
pnpm build && pnpm test:browser                   # the browser suite, about 1.4 hours
```

## Tested

From a fresh `git clone` of `fead20d` on 2 October 2026, on WSL Ubuntu with Node 22.23.2, pnpm 11.25.0 and Python
3.14.4:
- **Demo.** `pnpm install` 14 s (from a warm package store; a first install downloads the packages), `pnpm build`
  25 s. In Chromium the page painted with the feed reading NOT COLLECTING; a stop found by name showed its routes
  and "No timetable board"; the archive replay and the recorded ride played. Apart from `localhost`, the only host
  contacted was `tiles.openfreemap.org`.
- **Live.** The stop import took 32 s (5.1 MB, 3,499 stops); two minutes of collection ran 6 cycles and stored the four
  timetables; the catalogue took 88 s (106 services, 431 patterns); `pnpm dev:live` then served LIVE with 221
  buses, 100 of them placed on routes, labelled as a local run with its end time.
- **Not tested:** a cold machine with no package cache, macOS, or Windows without WSL.
