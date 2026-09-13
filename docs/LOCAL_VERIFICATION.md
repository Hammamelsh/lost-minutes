# First local session — 12 September 2026 (VS Code / WSL)

The existing export was installed and run in place. Nothing was rebuilt from scratch and no
hosting platform was provisioned. This file records what was actually executed and observed.

## Environment measured on this machine
- Node v22.23.2 (WSL-native, `~/.local/bin/node`), npm 10.9.8.
- pnpm 11.25.0, installed in this session to match `packageManager`.
- Python 3.14.4 (`/usr/bin/python3`, WSL-native), git 2.53.0, GitHub CLI 2.100.0.
- `corepack` on PATH resolves to the Windows install and fails under WSL with
  `/bin/sh^M: bad interpreter` (CRLF shebang). pnpm was installed with
  `npm install -g pnpm@11.25.0` and symlinked into `~/.local/bin` instead.

## Commands run and results
- `pnpm install --frozen-lockfile` — passed from a clean tree, 43.7s. The lockfile was
  accepted unchanged; no dependency was upgraded.
- `pnpm test` (Node replay tests) — 5 passed, 0 failed, on Node 22.23.2.
- `python3 -m unittest discover -s tests -v` — 8 passed.
- `pnpm typecheck` (`tsc --noEmit`) — passed.
- `pnpm build` (`next build --webpack`) — passed; static export written to `out/` (35 files,
  3.7 MB), routes `/` and `/_not-found` prerendered.
- `pnpm lint` — failed initially on one real error; fixed in this session, now passes.
- `pnpm start` (Python static server on `out/`) — `/` 200, `/data/replay.json` 200,
  unknown path 404, heading present in served HTML.

## Browser inspection actually performed
Headless Chromium in WSL could not start (`libnspr4.so` missing; would need a system
package install). The Windows Chrome binary was driven from WSL instead.
- Desktop 1440px: map, roads, route/direction filters, journey list, per-bus panel and
  replay controls all render from `public/data/replay.json`. Clock shows `08:05:01 BST`.
- Mobile 390px: single-column layout, heading wraps, map card and panels stack.
- Layout was measured, not eyeballed: `documentElement.scrollWidth` equals `clientWidth`
  at 360, 390, 768 and 1440 px, and no element extends past the viewport. There is no
  horizontal overflow. An early screenshot that appeared clipped was an artifact of the
  Windows headless screenshot crop, not a layout defect.
- Evidence view was opened by dispatching real pointer events and its rendered text read
  back: 11 source snapshots, 3,426 accepted, 740 repeats, 0 conflicts, the raw
  `2026-09-11T07:04:38+00:00` observation string, a separate archive capture time, the
  SHA-256 source fingerprint and the full observation sequence for MF74NRL.

## Fixes made in this session
1. `next.config.ts`: `agentRules: false`. Next.js 16.3.4 `next dev` appends a vendor block
   to `AGENTS.md` on every start, which overwrites part of the owner's instruction file and
   dirties the working tree. Confirmed the option exists in
   `node_modules/next/dist/server/config-schema.js`; after the change `next dev` leaves
   `AGENTS.md` untouched.
2. `app/page.tsx`: the masthead brand link now uses `next/link` instead of a raw `<a
   href="/">`. This clears the only `pnpm lint` error and, unlike a raw anchor, respects a
   future `basePath` if the site is ever served from a repository subpath.

## Repository state
- Remote `origin` is `https://github.com/Hammamelsh/lost-minutes.git`, owned by the
  authenticated account `Hammamelsh`. It is **public** and was created before this session.
  It is not a ChatGPT Sites remote and no Sites deployment was touched.
- 100 tracked files, 1.4 MB of Git history. No `.env`, no API key, no raw archive ZIP and no
  build output is tracked; `.env.example` is tracked and empty of values.
- `out/`, `.next/`, `node_modules/`, `.pnpm-store/`, `data/raw/`, `data/live-capture/` and
  `__pycache__/` are all ignored and were confirmed ignored in the working tree.

## Not done, and still true
- No website was deployed and no cloud resource was created.
- Live authenticated BODS collection was not exercised; no BODS key exists here.
- Automated checks passing is not a visual-quality or accessibility judgement, and the two
  screenshots above cover two widths in one browser engine only.

---

# Pipeline milestone verification — 12 September 2026

Added: raw-input preservation with a DuckDB history, restart-safe reruns, validate-then-swap
publication and an Operations view. Everything below was executed, not estimated.

## Environment additions
- `duckdb==1.5.5` and `pytz==2026.3.post1` in `.venv` (`requirements.txt`). System Python is
  externally managed, so a virtual environment is required; `python3 -m venv .venv`.
- DuckDB raises `Required module 'pytz' failed to import` when returning a TIMESTAMPTZ to
  Python, which is why pytz is pinned rather than left implicit.

## Commands run and results
- `.venv/bin/python -m pipeline.run import` — 11 sources, 312,123 vehicle reports parsed,
  4,236 in area, 3,496 new observations, 740 repeats, 0 conflicts, 0 refused. Published
  3,426 observations across 419 journeys with all 10 validation checks passing.
- `.venv/bin/python -m pipeline.run import` **a second time** — 4,236 in-area records,
  **0 new observations, 4,236 repeats**, stored total unchanged at 3,496. Reruns add no
  analytical rows.
- `.venv/bin/python -m unittest discover -s tests` — 15 passed (8 parser, 7 pipeline history).
- `python3 -m unittest discover -s tests` — 15 run, 8 passed, **7 skipped**: the documented
  system-Python command still works without DuckDB installed.
- `pnpm test` — 11 passed (5 replay contract, 6 operations contract).
- `pnpm typecheck`, `pnpm lint`, `pnpm build` — all passed.

## Behaviours demonstrated
Controlled SIRI-VM fixtures in a throwaway warehouse, one test each:
- repeated import adds no analytical observation;
- a crash *mid-source* leaves the run `running` with a `pending` checkpoint and publishes
  nothing; the next run marks it `interrupted`, names the unfinished source and completes
  the work to the same result;
- conflicting coordinates for one identity are recorded with both readings, the first
  reading stays stored, and the identity is withheld from the published file;
- a stationary bus reporting again with a new timestamp is kept as a second observation;
- an older snapshot imported after a newer one extends the window backwards and adds
  observations without moving the served window end earlier;
- a candidate built from part of the warehouse fails `built_from_full_warehouse`, the served
  file is byte-identical afterwards, and the rejected candidate is kept as `rejected-*.json`;
- a run records `succeeded` processing while its publication records `failed_validation`.

## Reconciliation measured on the real sample
All five identities balanced, each side computed from different tables:
`312,123 = 4,236 + 307,887 + 0`; `4,236 = 3,496 + 740 + 0`; `3,496 = 3,496 - 0`;
`3,426 + 70 = 3,496`; and the served file's SHA-256 equals the recorded publication's.

## Browser inspection
Windows Chrome driven from WSL against the static export. The Operations tab renders the
four freshness measures, the served-snapshot card, the reconciliation table, run history
with per-run outcomes, the definitions and the notes. The map, filters, journey list and
Evidence view are unchanged. `documentElement.scrollWidth` equals `clientWidth` at 390px
and 768px with the Operations tab active; the wide tables scroll inside their own
containers rather than the page.

Two defects found by that inspection and fixed: the served-file path was published as an
absolute path containing the local username, and the definitions list inherited the
right-aligned value styling.

## Still requires credentials or deployment
- `BODS_API_KEY` is not set and no `.env` exists, so **no live capture was exercised** and
  `data/live-capture/` has never been written. The archive replay needs no key.
- There is no scheduler and no hosted worker. The pipeline runs in one local WSL process
  and stops when that process, the terminal or the machine stops. Nothing is labelled live.

---

# Live path and mobile milestone — 12 September 2026

Added: a single-writer live collector, an evidence-led freshness policy, a validated live
state object, quarantine of questionable records, and the mobile Follow view with PWA
support. **No live capture has been run**: no BODS credential exists in this checkout.

## BODS requirements, checked rather than assumed
- Consumers of the location API must register for an account and use an API key
  (DfT Bus Open Data implementation guide).
- Operators must supply vehicle locations every **10–30 seconds**, so the poll floor was set
  to 10s and the default left at 20s. A faster poll mostly returns bytes we already hold.
- No consumer rate limit is published for the datafeed; the documented 1 request/second
  limit applies to archive downloads. The archive importer already respects it.

## Freshness measured on the retained sample
| measure | p50 | p95 | samples | window |
| --- | --- | --- | --- | --- |
| publication delay (observation age when its response was built) | 30.0s | 40.0s | 3,496 | 11 responses, 07:00–07:10 UTC |
| report interval per vehicle | 60.0s | 73.0s | 3,058 | same |
| response cadence (our sampling, not the operator's) | 60.5s | — | 10 | min 45s, max 75s |

**The finding that shaped the design:** 56 of 3,496 positions were already more than ten
minutes old when their response was built; 34 were between one and 24 hours old; the worst
was **23.1 hours**. One vehicle reference in the real feed is `QS_TRAINING_1`. An app that
simply drew the latest position per vehicle would put yesterday's bus on today's map, so
expiry (900s) is a correctness control and is enforced in the publisher and in the contract.

## Commands run and results
- `.venv/bin/python -m unittest discover -s tests` — **29 passed** (8 parser, 7 pipeline
  history, 14 live collection).
- `python3 -m unittest discover -s tests` — 29 run, 8 passed, **21 skipped** without DuckDB.
- `pnpm test` — **21 passed** (5 replay, 6 operations, 10 live/geo contracts).
- `pnpm typecheck`, `pnpm lint`, `pnpm build` — all passed.
- `.venv/bin/python -m pipeline.live init` — wrote an honest `unavailable` live state.

## Behaviours demonstrated
Fixtures (clearly labelled synthetic SIRI-VM), one test each: a repeated payload adds no
observation and does not advance the payload-change time; an older report arriving later
does not move the bus back but is still stored; a timestamp 10 minutes ahead of retrieval is
quarantined as `future_timestamp` with the raw text kept; an expired position is withheld and
counted while staying in history; an upstream transport failure and a malformed body each
leave the last good state serving with its original timestamps; rejected credentials stop
collection and mark the run failed; a second collector refuses the lock; an interrupted
collection records the failure and releases the lock; a live publication that would move
publication time backwards is refused and the served file is untouched; no key appears in
any published file and stored URLs read `api_key=[REDACTED]`.

**Real payloads through the live code path:** three archived BODS responses replayed through
the collector loaded 999 observations and published **zero** vehicles — all 392 withheld as
expired, state `stale`. That is the expiry control working on real data.

## Browser verification
Windows Chrome driven from WSL against the static export.
- Follow at 390px: the honest "not collecting" state; the archive-replay path with its own
  badge and absolute observation times; selection, follow mode and the freshness ramp
  (green 23s / green 46s / amber 2 min) using a clearly-labelled fixture live state.
- Follow at 1280px: two-column layout, route-fitted map with orientation labels.
- The status banner flipped to **NOT UPDATING** by itself once the fixture aged past the
  120s publication threshold — the staleness policy observed working end to end.
- Explore and Operations unchanged; `scrollWidth == clientWidth` at 390px and 1280px on
  every tab.

Defects found by that inspection and fixed: four tabs overflowed the page at 390px; the
hero pushed passenger content 330px down the phone screen; the header's ARCHIVE REPLAY badge
contradicted the live banner; the saved-routes label ran into its hint; the desktop grid left
a void beside the map; the default route was whichever sorted first rather than the one with
the freshest report; map labels clipped at the edges.

## Still requires credentials or deployment
- **No live BODS capture has been exercised.** Set `BODS_API_KEY` in `.env` (loaded by
  `pipeline/env.py`) and run `.venv/bin/python -m pipeline.collect --minutes 10`.
- No scheduler and no host. The collector runs in one local WSL process and stops when that
  process, the terminal or the machine stops.

---

# Real-feed and mobile milestone — 12 September 2026

The first genuine BODS capture, plus the production data path and the reworked passenger
view. A key was configured in a local `.env` during this session.

## BODS access, checked against the official documentation
Fetched `data.bus-data.dft.gov.uk/guidance/requirements/` directly (the site returns 403 to
some tooling; a normal user agent works):
- An API key is required and comes from Account Settings after free registration.
- **No consumer rate limit is published** for `/api/v1/datafeed`. The documented 1 req/s
  limit applies to archive downloads. Operator publication frequency (10–30s) is a different
  thing and is not a consumer limit; the 20s default poll is a courtesy chosen against it.

## The bounded live run
`\.venv/bin/python -m pipeline.collect --minutes 10 --interval 20`, 21:42:37–21:52:37 UTC.

| measure | value |
| --- | --- |
| requests | 30 issued, **30 succeeded, 0 failed**, 0 repeated payloads |
| retrieved | 13.6 MB across 30 responses, 30 KB each gzipped on disk |
| observations | 3,752 across **376 distinct vehicles**; 0 quarantined, 0 conflicts |
| published | 155 vehicles in the final state, 8/8 validation checks passed |

Freshness, measured on the live run and labelled as live (not borrowed from the archive):

| measure | p50 | p95 | min | max | samples |
| --- | --- | --- | --- | --- | --- |
| observation age when received (theirs) | 9.9s | 4,165.9s | 0.9s | 86,047.9s | 3,752 |
| our cycle: request → published (ours) | 0.7s | 1.1s | 0.7s | 4.4s | 30 |
| report interval per vehicle | 21.0s | 28.0s | 5.0s | 8,526.0s | 3,376 |
| our poll cadence | 20.0s | 20.0s | 20.0s | 20.0s | 29 |

**The live feed carries positions up to 23.9 hours old**, confirming on live data what the
archive first showed. 221 positions were withheld as expired in one published state. Ten
minutes proves this run; it establishes nothing about long-term reliability.

## One observation, end to end
Vehicle 66074, route 2, operator BNSM:
1. **Raw response** `4de2134e…22bd.bin.gz`, 456,134 bytes, retrieved 21:52:17 UTC, containing
   `<RecordedAtTime>2026-09-12T21:52:12+00:00</RecordedAtTime>` — **5.9 seconds old**.
2. **Stored** under identity `('BNSM','66074','2','outbound','151',1789249932000)` with the
   source string untouched and `source_sha256` lineage.
3. **Published** in `live-04f6511243ce507b-215237`, 155 vehicles, **8/8 checks passed**.
4. **Served** over HTTP from the built `out/` with identical coordinates and matching hash.
5. **Rendered** as a marker in the built application, with its destination, direction and age.

## Production data path
- A new publication reaches the built site **without a rebuild**: the `out/_next` fingerprint
  was byte-identical (`035fb40e3c4aeb0d`) before and after, while the rendered page changed
  from publication A (2 buses to Manchester Piccadilly) to publication B (3 buses to
  Shudehill Interchange).
- **Runtime repointing works**: setting `config.json.liveUrl` to `/data/live-alt.json` made
  the built app read from there, no rebuild.
- **Collector stop**: a state published 10 minutes earlier renders as `NOT UPDATING`,
  "updated 741s ago", with its buses aged to "reported 12 min ago" rather than frozen.
- **Every position expired**: the view now explains "Every position we hold has passed its
  cut-off" instead of rendering nothing.
- **Service worker**: registered and created its cache store in a real browser profile. Its
  rules are verified directly in `tests/sw.test.mjs` — network-first for published data, a
  cached copy served byte-identical with `X-Lost-Minutes-From-Cache`, a 503 when nothing is
  cached, and a shell fallback for navigations. Rendering the page offline in headless Chrome
  could not be confirmed and is **not** claimed.

## Timetables preserved
Configured in `.env` as `BODS_TIMETABLE_URL`, which the collector now reads (it previously
advertised the variable and ignored it). Both need no API key.

| dataset | size | declared window | overlap with observed routes |
| --- | --- | --- | --- |
| TfGM 17472 (BNML) | 11.55 MB | 2026-03-16 → 2026-10-25 | 18 of 114 |
| TfGM 14928 (BNSM) | 9.81 MB | 2026-01-02 → 2031-08-30 | 7 of 114 |

The national bulk archive (1.66 GB) is correctly skipped by the size guard. Declared windows
are derived from 60 scanned TransXChange files per dataset and recorded as such.

## Bugs this session found and fixed
- `reportIntervalSeconds` was computed across **all** source kinds, so a live measurement
  would have silently included archive observations.
- Observation ages were measured against the payload's `publishedAt`, which **froze every age
  the moment the collector stopped**. They now use the HTTP `Date` header as the server-clock
  reference, so a stale state ages correctly.
- The freshness bands left a gap: positions between 600s and the 900s cut-off were labelled
  expired by the frontend and dropped, though the publisher had included them.
- `timetable_dates` reported one service's operating period as the whole dataset's validity.
- The collector's log was block-buffered, so a backgrounded run showed nothing until it exited.
- With zero buses and a stale collector the Follow view rendered nothing at all.

## Test counts
29 Python tests, 34 Node tests (replay, operations, live, service worker, follow helpers),
typecheck, lint and the static build all pass.

---

# Redesign stages 9A–9C — 13 September 2026

Implemented against `docs/LOST_MINUTES_REDESIGN_RESEARCH.md`. Three commits: `f56cfa0`,
`b0e3a1b`, `98c3e47`.

## 9A — the two reported defects, diagnosed rather than restyled
- **Dropdown.** No `color-scheme` was declared anywhere, so the browser drew the native
  select popup in the light scheme while it inherited our light text. `color-scheme: dark`
  on `:root` fixes the popup; explicit option colours cover engines that ignore it. Measured
  **14.50:1** for option text and 9.41:1 for the highlighted option.
- **"updated 111s ago / reported 24s ago".** Reproduced exactly: with an observation 24s old
  at publication and a fetch 111s later, the old formula returns 111 and 24 because the
  observation age was measured against the payload's own `publishedAt` and never grew. True
  age was 135s. Fixed in `f00a1ec`; hardened here to RFC 9111 `Date` + `Age`, with a
  device-clock fallback that can over-report an age but never under-report one. Corrected an
  earlier wrong comment: neither header is CORS-safelisted, so a cross-origin host must send
  `Access-Control-Expose-Headers: Date, Age`.
- **The two ports were different builds:** 3000 is the dev server reading `public/`, 3001 a
  static export of `out/`. All reproductions here used one port.

## 9B — discovery by stop, not by bare number
- NaPTAN ATCO area 180: 21,526 rows in, **1,709 active bus stops** inside the collected area,
  1,672 with a bearing. Published at 338 KB, **41 KB gzipped**, with 121 observed route labels.
- ARIA combobox verified in the built app: `aria-expanded` toggles, `aria-autocomplete=list`,
  `aria-controls`, `aria-activedescendant` tracks the active option, the listbox is labelled,
  and the count is announced ("12 stops found"). Arrow keys, Home, End, Enter and Escape work.
- Searching "piccadilly gard" returns Stop Q north-eastbound (Portland Street), Stop R
  north-westbound and Stop S south-eastbound (Piccadilly) — the opposite-side problem solved
  from real data.
- Location is optional. Denial, an unavailable API and a position outside the area each fall
  back to the same search box with an explanation.

## 9C — a bus placed on a service pattern
- 859 timetable files valid today across two preserved TfGM datasets; selection by the
  validity dates in the filenames rather than parsing all of them. 3,278 journey patterns →
  **78 distinct stop sequences** → **44 publishable** across **13 route labels**.
- On the real capture, **113 of 376 vehicles matched**, 22–61 m from their nearest pattern
  stop. Refusals carry reasons: 250 `no_pattern_for_route`, 6 `no_pattern_for_direction`,
  5 `too_far_from_pattern`, 2 `ambiguous_branch`.
- **One real result traced end to end:** vehicle SL63FZZ, route 111 inbound, recorded
  `2026-09-12T21:52:10+00:00` in response `4de2134e…22bd` (456,134 bytes); stored under its
  identity; matched 38 m from stop `1800SB30631`, index 26 of a 33-stop pattern from
  `BNML_111_…_20260830_20310830_2411731.xml` (dataset `9ed671b2…`, valid 2026-08-30 to
  2031-08-30); passenger stop Dickinson Street (`1800SB18301`, nr, NE-bound, Portland Street)
  at index 30 — **about 4 stops away, 1,267 m along the route**.
- All four passenger cases exercised in the built app against real positions on a current
  clock: approaching ("about 10 stops away along the route · 3.0 km along the route"), at the
  stop, already passed ("about 10 stops ago"), and a branch that does not call there.

## Checks
40 Python tests, 45 Node tests, typecheck, lint and the static build pass. `python3 -m
unittest` still works without DuckDB (23 skip). Desktop 1280px: no page overflow, relation
text contrast **12.53:1**. The repository ships the honest `unavailable` live state; the UI
verification used real captured positions replayed on a current clock, labelled as such.

## Not done in this milestone
MapLibre and the optional 3D city view. The map has roads, place labels, the stop marker,
pan and zoom, but no street names or landmarks. Deferred deliberately in favour of the
timetable matching, which was the harder and more defensible work.

# Map repair — 13 September 2026

The vector map was black in the owner's own browser, in live and replay modes. The 12
September note above blamed headless WebGL; that was wrong. Two defects were confirmed, each
with a regression check that fails on the pre-repair build (`59b6249`) and passes now.

## The two defects

1. **The map was destroyed and recreated every five seconds.** `FollowView` passed fresh
   inline `onManualMove` and `onUnavailable` callbacks to `CityMap`, whose creation effect
   depended on them, so each clock tick tore the map down; the effect cleanup cancelled the
   seven-second fallback timer before it could fire. Measured on the pre-repair build with the
   suite's fixture: **18 MapLibre instances created in 22 seconds** (2, 4, 10, 12, 18 at five-
   second steps). After the repair: **1** instance, the same canvas, still attached.
2. **No vector tile could ever load, in any browser.** webpack bundled MapLibre's ES module
   and rewrote `import.meta.url` to `file:///home/…/node_modules/…/maplibre-gl.mjs`. MapLibre
   derives its worker URL from that, got nothing usable, and started its worker from the
   page's own URL (`worker started: http://127.0.0.1:4179/`), so every tile request died with
   it while the style and sprites returned 200. The same rewrite put a private machine path in
   the shipped JavaScript. `scripts/vendor-maplibre.mjs` now copies MapLibre's three modules
   to `public/vendor/maplibre-gl/<version>/` at dev and build time and the page imports them
   unbundled; the worker now starts from `/vendor/maplibre-gl/6.7.0/maplibre-gl-worker.mjs`.

## The browser setup

`scripts/setup-browser.sh` unpacks `libnspr4`, `libnss3` and `libasound2` under
`~/.cache/lost-minutes/browser-libs` with `apt-get download` and `dpkg-deb -x`, no root.
`playwright.config.mjs` launches the cached Chromium 151 with
`--use-angle=swiftshader --enable-unsafe-swiftshader`. Renderer probe on this machine:
SwiftShader gives WebGL2 and paints the map; `--use-angle=vulkan` (llvmpipe) never created
the app's map; `gl-egl`, `gl` and the default give no WebGL2 at all. Real-app first settled
frame with SwiftShader: **1.8 s, 1.6 s, 1.7 s** over three runs (states `starting` at 0.3 s,
`ready` at 1.1–1.3 s, `painted` at 1.6–1.8 s; 6 tiles fetched).

## What `pnpm test:browser` asserts, and the measured values

Run against the built `out/` (desktop 1280×900 and a 390×844 phone at 2×), 19 checks run and
11 skipped by design (the lifecycle and fallback checks do not depend on viewport; the
real-feed check needs a live server). All 19 pass.

- **Created once through clock updates and live refreshes.** 22 s of sampling: the displayed
  age changed ≥3 times, ≥2 live payloads were served, one canvas, the same canvas, still
  attached, state `painted`, no fallback.
- **Camera kept where the passenger put it.** Two zoom-ins, then three clock ticks and a live
  refresh: `data-camera` unchanged.
- **A real basemap painted.** Style, vector tiles and glyphs fetched; the map's pixels held
  **178 distinct quantised colours with 50.8 % of pixels off the background** (a flat rectangle
  measures 1 colour and 0 %; the calibration threshold is >12 and >15 %).
- **Fallback in four failure modes** — WebGL absent (immediately), the style never answered
  (after the 7 s watchdog), the tile host refusing everything, and only the `.pbf` tiles
  failing after a good style — and the drawn map stays usable with its markers and controls
  through two further clock ticks.
- **Shipped modules.** The only workers started come from `/vendor/maplibre-gl/<ver>/`; no
  `file:///`, `/home/` or `/Users/` string anywhere in `out/`.
- **Passenger flows, desktop and phone.** LIVE badge, painted map, stop search and "Buses
  near me" present; no credential wording; the stale footer gone. NOT COLLECTING keeps the
  map and the search, then "Follow a bus in the recording" reaches ARCHIVE REPLAY with the map
  painted. OFFLINE after a refresh with the network cut. Location granted at Longford Park
  (accuracy 40 m): "Stops near you", "accurate to about 40 m", Moss Road / Stretford Mall first
  with "straight line"; choosing Stretford Mall and fitting puts **You (blue), Your stop
  (orange) and the selected bus (lime)** on the map, each verified by counting its pixels.
  Location denied: "Search for your stop instead", then the search completes by keyboard.

## The real feed, no fixtures

`LM_REAL_LIVE=1 LM_BASE_URL=http://localhost:3000 pnpm test:browser tests/browser/real-feed.spec.mjs`
against `pnpm dev:live` (bounded 20-minute collections, 12:01–12:21 BST): on desktop and
phone the LIVE badge shows, the map paints, **two distinct publications** arrive while the
page is open, the canvas is the same one afterwards, the latest publication carries vehicles,
and the selected bus is drawn. Screenshots: `test-results/*/desktop-real-live.png` and
`mobile-real-live.png` when run.

## Passenger experience changes made while verifying

Each came from a screenshot, not a guess: the phone map now comes first (status, pickers,
map, your bus, then the stop finder) and is 52 vh tall; the bus card is no longer sticky, so
it cannot cover the map; the zoom buttons are hidden on phones (pinch) so the tool column no
longer covers a third of the map; MapLibre's attribution control, which repeated the style's
own credit and ran to three lines, is replaced by one linked credit line; labels are drawn
above every dot and choose the side with room; "You" is drawn under the stop marker so the
stop stays visible when they coincide; every other bus is near-white so blue means "You"
alone; the camera goes to what the passenger asked for (first buses, a new route, a bus from
the list, a chosen stop, a found location) at a street scale with room to move, keeps the
selected bus in frame until the passenger drags, pinches or zooms, and never moves on a
clock tick. The reported location accuracy is now a geographic ring of the reported radius
(`accuracyRing`, 64 vertices, tested at 15, 250 and 1,500 m), not a pixel radius clamped at
8–180 px and frozen at one zoom.

## Also found

The SIRI-VM feed carries `<Bearing>`: 334 of 539 vehicle activities in one capture, 213
distinct values. The collector does not store it. Direction-of-travel arrows are therefore
available from reported data; see `docs/INSPIRATION_RESEARCH.md`.

## Checks

Node contract tests 52/52 (one new: `accuracyRing`); `pnpm typecheck`; `pnpm lint` (the
vendored MapLibre copies excluded); `pnpm build`; `pnpm test:browser` 19/19 with 11 skipped
by design; real-feed check 2/2.
