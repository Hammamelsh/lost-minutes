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

---

# Passenger redesign — 13 September 2026

Stop-first passenger view, an original map style in daylight and night themes, 2D / City /
Fit journey, a 3D ride-along, Bearing carried from the feed to the screen, identity-first
timetable matching, a stop-order schematic and per-bus evidence. Fixture screens are labelled
FIXTURE and built on real NaPTAN stops; the real-feed figures below come from bounded
`pnpm dev:live` runs on this machine and prove those runs only.

## Bearing, source to screen

`core.read_bearing` keeps 0° as a reported north (it is not "missing"), marks an empty element
`absent` and anything unparseable, non-finite or outside 0–360 `invalid` with the raw text
kept; the warehouse migrates additively (old rows read `not_captured`) and backfills repeats;
`live.json` publishes `bearing` only when reported. Tested end to end in `tests/test_bearing.py`.
Real run, publication of 13:57:56 BST: **338 vehicles, 225 bearings reported, 84 absent,
0 invalid, 29 not captured** (their newest row predates the column).

## Coverage, deliberately

The 14-line cap is gone: the build selects every observed operator-and-line pair with a
timetable file valid on the day (`--coverage observed`, the default), or every valid file
(`--coverage all`), or named lines, with an optional explicit `--max-lines`; the choice, the
date and every observed service without a timetable are published in `patterns.json`
`coverage`. First real build: 443 files valid on the day parsed, **89 observed services
selected, 49 observed without a timetable held** (largest by reports: BNGN 10, 36, 37 and 8;
BNSM 2 and 1), 9,331 journey patterns → 404 distinct.

**A defect found in the real Sunday output, not by the tests.** Patterns were published and
matched against only when 60% of their stops lay inside the collected area. At 13:58 BST
**32 of 338 buses** were refused with "the timetable held for this service has no journeys on
this day". The raw TransXChange says otherwise: route 219's Sunday pattern carries 56
journeys to Ashton with 45% of its stops inside; route 203's Sunday patterns are 45–54%
inside; 42B 49%. The matcher now checks operator, version, day and direction against every
held pattern, and a pattern is published when it calls at any stop inside the area. The three
`PublicationRuleTests` fail on a copy of the old rule (`[10] != [5, 10]`,
`no_pattern_operating_today`, `no_pattern_for_route`) and pass now. The extraction minimum of
five stops hides nothing of the same kind: **0 of the 121 services with journeys today** run
only on shorter patterns.

**A wording defect found the same way.** "Mon–Sun, term days only" was attached to route 50,
whose calendars include TfGM's holiday calendars (`SchOffUniOff`); a serviced-organisation
calendar is a list of dates, so it now reads "on listed calendar dates only".

**After both fixes** (patterns rebuilt 14:14 BST): **387 patterns across all 89 selected
services** (was 221 across 58), 166 of which the old rule would have hidden; `patterns.json`
grew from 853 KB to 1.47 MB (60 KB to 105 KB gzipped). The first run (13:56–14:12 BST) had
45 cycles and the corrected run (14:15–14:27) 36, none failed. The publication of 14:16:22 BST, from the corrected code:

| Outcome | 13:58, old rule (338 buses) | 14:16, corrected (342 buses) |
|---|---|---|
| Placed on a pattern | 153 | **201** |
| No timetable held for the route | 117 | 78 |
| Branches unresolved | 25 | 57 |
| No journeys that day | 32 | **2** |
| Wrong direction for every pattern | 9 | 0 |
| Too far from any pattern stop | 2 | 4 |

"No timetable held" fell because 31 of the services we hold had been left out of the matcher
entirely, so their buses were told none was held. The two remaining "no journeys that day"
are BNSM route 33: both of its files valid today carry one operating profile each with no
Sunday, Weekend or MondayToSunday element, while an expired August version did run on
Sundays, so the refusal is literally true. Unresolved branches grew with coverage; of the 59
at 14:18, 42 have identical stops from the nearest stop on and differ only behind the bus.
The passenger view already says "every possible branch calls at your stop" for those, and the
evidence panel now says the stops ahead are the same on each. Bearings in the same
publication: 267 reported, 75 absent, none invalid. The real-feed browser check passed 2/2
against both runs.

### One supported example, real

BNML route 250, vehicle BU25YVB, to The Trafford Centre; reported 14:16:27 BST at 53.46341,
−2.28177 with a bearing of 242°; published 14:16:42. Checked against its operator, a timetable
version valid that day (`BNML_250_…_2390038.xml`, revision 20, valid 19 July 2026 to 19 July
2031), journeys that run on Sundays, and the reported direction; one path fits the position,
so the position alone placed it on `BNML:250:outbound:7930c3c3b8`, stop 18 of 36, 307 m from
Trafford Bar. Standing at Matt Busby Way (westbound, Wharfside Way), the page said
"Timetabled to call at your stop" and "Last report nearest Trafford Bar · 1 stop before
yours", adding that it may or may not have called there yet; the bus was 940 m away in a
straight line and 1.2 km along the stop sequence; the arrival time was not predicted.

## Browser checks

`pnpm test:browser` on the built `out/`, desktop 1280×900 and a 390×844 phone: **43 passed,
11 skipped by design**. New in `tests/browser/journey.spec.mjs`: nearby stops on opposite
sides of the road with their services and an uncovered stop; stop first, then its services,
then a bus; shared-stop branching with both branches kept; a chosen bus that leaves the feed
stays chosen and says so; an unsupported stop found by search; day and night themes on one
map instance; 2D → City → ride-along → 2D with the model's pixels counted; a model that fails
to load leaves the symbol and says so; a stale publication, whose report ages must include
the publication's own age; and no control, note or card drawn over the map covering another,
in each view. The lifecycle, worker and fallback checks from the map repair all still pass.

**Layout defects found by looking, now held by a check.** The screenshots showed the phone's
"Ride along" button over the legend (a phone rule that lost to a later base rule on source
order), the ride-along disclaimer under its Exit button, the progress card over the 3D bus, a
no-direction note touching the disclaimer, and the Operations tab cut off at 390 px. The
notes now stack in one column under the exit, the camera centres the bus in the measured gap
between them and the card, and `collisions()` fails on any intersection. With the source-order
bug put back, the phone check fails with `.ride-launch × .map-legend-chips` and the desktop
check passes, as it should. The stale-publication fixture had reports seconds old inside a
file published ten minutes earlier, which cannot happen; it now dates reports before the
publication, and the page shows them as ten minutes old.

## Not verified here

A real phone and GPU (the suite renders with SwiftShader), legibility in sunlight and at
night on a device, battery cost, collection beyond bounded runs, bank-holiday operation (it
is recorded, not evaluated), and any arrival time: none is predicted.

## Also observed

The owner's own `pnpm dev:live` stopped publishing at 13:44:56 BST (238 cycles); its
`pipeline_run` row was left `running` with no finish time, which is what an abrupt stop
leaves. The kernel log shows no out-of-memory kill and WSL had not restarted. A dependency
install in this repository (13:41) and hot-reloaded component edits happened shortly before;
the cause is not established. Its run record still reads `running` after three later bounded
runs started and finished normally (45, 36 and 18 cycles, none failed): nothing marks an abandoned
live run as interrupted, so that record will read as running until something does.

# Walking guidance and estimated movement — 13 September 2026

This milestone adds four things:
- walking directions to the boarding point;
- estimated movement between reports on the evaluated routes;
- run records that say how each collection ended;
- a ride-along, stop board and card reworked around them.

The owner approved clearly labelled interpolation and bounded prediction for this milestone,
and `PROJECT_CONTEXT.md` now says so where it used to say nothing is interpolated. Fixture
screens are labelled FIXTURE. The real figures come from bounded runs on this machine and
prove those runs only. The requirement-by-requirement evidence is in
`docs/MILESTONE_CHECKLIST.md`.

## Walking guidance

The router is the OSRM foot profile at routing.openstreetmap.de, run by FOSSGIS e.V. It is
free, needs no key, and is used within the limits its own pages state: attribution, a "fix the
map" link, at most one request a second, no heavy use, and requests are logged. Its German
usage-policy page sat behind a bot check and could not be read in full here.

The page:
- asks only after the passenger taps "Show walking route", having said what is sent and to
  whom;
- sends the location rounded to four decimal places (about 10 m) and the stop's position, with
  no credentials and an origin-only referrer, and puts neither in its own address or console;
- refuses before asking when there is no location, when the fix is worse than 200 m, or when
  the stop is more than 3 km away in a straight line;
- re-routes only after a move larger than max(40 m, twice the fix's accuracy), and never more
  often than every 10 s;
- on NoRoute, NoSegment, a 429, a timeout or a network failure, says what happened and offers
  Try again;
- never shows a driving route or passes a straight line off as a route.

The router is runtime configuration: `LM_WALKING_ROUTER` takes an https URL, localhost or
`none`, and is written into `config.json` at each publication.

Real answers:
- the recorded route the browser checks replay: Longford Park to Stretford Mall (Stop A),
  340.8 m and 272.7 s, 21 points, captured once;
- `walking-real.spec`, one request from the built app at 17:21 BST: passed, with 340 m and a
  5-minute walk from Longford Park to Stretford Mall (Stop A), shown on the map and in the
  page;
- three live requests during the recorded passes, at 16:37:32, 16:38:40 and 16:39:23 BST, all
  answered 200: 220 m and 3 minutes to St Modwen Road (nr), north-westbound on Barton Dock
  Road.

## Road shapes

TfGM's timetables hold no road geometry. Of 802 files in the BNML dataset and 588 in BNSM,
none has a `Track` or `Mapping` element, only stop-to-stop `RouteLink`s. So
`pipeline/shapes.py` asks the FOSSGIS Valhalla service for a bus route through each pattern's
stops, with NaPTAN bearings as headings, and keeps the raw answers. It accepts a shape only
when at least 30 matched reports lie within 35 m of it at the 95th percentile. Shape build run
`20260913T151402`, 16:14–16:15 BST:

| Pattern | Matched reports | 95th-percentile offset | Result |
|---|---|---|---|
| BNML 15 inbound `9c10700c6c` | 756 | 11.7 m | accepted |
| BNML 15 outbound `c9291c1aea` | 752 | 13.8 m | accepted |
| BNML 250 inbound `0d524464ad` | 3,408 | 23.2 m | accepted |
| BNML 250 outbound `7930c3c3b8` | 3,393 | 20.9 m | accepted |
| BNML 256 inbound `c19df3beac` | 1,300 | 28.4 m | accepted |
| BNML 256 outbound `7d555419a1` | 1,578 | 11.3 m | accepted |
| BNML 15 inbound `1d743b5dae`, 256 inbound `331b1971c9`, 256 outbound `cde495c44d` | 0 | — | rejected: no matched reports |

## Estimated movement

**Reports.** 109 journeys on routes 15, 250 and 256, 11,367 reports (11,216 placed on a
pattern), exported from the warehouse. They are split in time at 12:50 UTC: 71 journeys to fit
the settings (36,076 predictions) and 38 held out (20,708). Each prediction uses only the
reports fetched by its moment, and is scored against where the bus next reported. The baseline
is the last report itself, which is what the page draws without estimates.

**Settings**, fitted on the training journeys:
- top speed 15.7 m/s (the 99th percentile);
- speed read over 75 s;
- horizon 120 s;
- decay time 45 s.

Version `motion-2 · 2026-09-13 · window 75s · decay 45s · horizon 120s`.

**Held out**, distance from the next report:

| Report age up to | Cases | Estimate, median | Last report, median | Band held it |
|---|---|---|---|---|
| 10 s | 70 | 34.6 m | 56.3 m | 74% |
| 20 s | 1,625 | 40.6 m | 52.1 m | 81% |
| 30 s | 2,212 | 50.8 m | 71.4 m | 82% |
| 45 s | 3,041 | 77.1 m | 137.5 m | 82% |
| 60 s | 2,937 | 96.3 m | 181.7 m | 82% |
| 90 s | 5,247 | 152.0 m | 272.0 m | 82% |
| 120 s | 5,576 | 237.4 m | 375.9 m | 83% |

Within 30 s of a report: **45.7 m against 61.1 m** (3,907 cases). Estimates were withheld (the
bus was shown at its report) when:
- the report was off the road geometry: 664;
- the bus was not placed on a pattern: 547;
- only one report of the journey had arrived: 184;
- the reports were too far apart: 99;
- the reports went backwards: 64;
- a report jumped further than a bus travels: 5.

**What a passenger sees.** This was measured separately: at each moment a new report reached
the page, how far the estimate moved. The first version extrapolated at constant speed. On
held-out captures, 32.6% of report arrivals pulled it back by more than 35 m, because buses
stop at stops and lights. Easing speed off with report age was fitted by a rule set before
looking at held-out data: among decay times no less accurate on training than constant speed,
the one whose corrections least often go backwards.

| Decay (training) | Median error ≤ 60 s | Mean error | Back > 35 m | Over 150 m |
|---|---|---|---|---|
| none | 69.1 m | 95.4 m | 32.5% | 11.3% |
| 120 s | 67.3 m | 92.2 m | 28.0% | 10.3% |
| 90 s | 67.0 m | 92.3 m | 26.4% | 10.3% |
| 60 s | 67.1 m | 93.2 m | 23.4% | 10.7% |
| **45 s** | 67.7 m | 94.9 m | **21.1%** | 10.9% |
| 30 s | 68.6 m | 99.4 m | 16.6% | 12.3% |

30 s was excluded as less accurate than constant speed.

Held out (3,826 report arrivals):

| | Median move | 8 in 10 under | Back > 35 m | Forward > 35 m | Over 150 m |
|---|---|---|---|---|---|
| Decay 45 s | 50.8 m | 111.5 m | 20.9% | 40.8% | 10.0% |
| Constant speed | 56.3 m | 113.5 m | 32.6% | 32.1% | 10.3% |

The cost is that past 90 s the eased estimate under-runs: 152 m and 237 m, against 134 m and
177 m at constant speed. It still beats the last report.

**On screen:**
- a move is caught up no faster than 15 m/s on top of the bus's speed;
- a step back of up to 35 m while moving is held rather than drawn;
- a move over 150 m snaps, and the card says by how much.

## Defects found by this milestone's own checks, and fixed

- The presentation clock could step at each publication, because the server offset came from
  the one-second `Date` header. It is now slewed at no more than 0.1 s per s.
- Correction glides had no speed limit: a 90 m correction slid at about 100 m/s. They are now
  limited to 15 m/s on top of the bus's speed.
- After a jump, speed was read across it: a FIXTURE bus at 29 km/h was estimated at 61 km/h.
  Speed is now read only from reports after the latest jump.
- The first estimate after loading glided from the report as if correcting it. It is now simply
  drawn.
- Choosing another bus was drawn as a correction between two buses. It is now a new drawing.
- The card gave two ages for one report (33 s and 35 s). It now gives one, the page's own.
- Looking at the real frames:
  - the ride-along bus was about 9 px wide at zoom 18.3; the framing is now zoom 20;
  - on a phone the ride card covered the bus; the ride map is now taller and the card compact;
  - the legend's new Walk chip ran into the ride button; they now share one foot bar, and the
    overlay check runs with a walking route too.
- Leaving the ride-along kept its tilt, because stopping the ride's camera also cancelled the
  flat 2D ease. The exit's fit now carries the view's own tilt and heading.
- On a phone, starting a second ride crashed the page: MapLibre threw `Invalid LngLat object:
  (NaN, NaN)` framing an overview for a map whose size had just changed. The camera now takes
  the new size first. A frame that cannot fit is skipped, and no camera move can take the page
  down.

## Matching on one frozen capture

For each moment, both columns take the vehicles as a publication would have carried them. The
old rule held 221 patterns (60% of stops inside the area); the new rule holds all 404.

| Moment (BST) | Vehicles | Matched | No journeys that day | No timetable for the route | Unresolved, same stops ahead |
|---|---|---|---|---|---|
| 13:58:55 | 338 | 153 → 199 | 32 → 2 | 117 → 77 | 43 |
| 14:16:22 | 342 | 148 → 201 | 35 → 2 | 124 → 78 | 41 |
| 15:30:00 | 350 | 152 → 208 | 35 → 1 | 125 → 78 | 43 |
| 16:05:00 | 353 | 148 → 206 | 39 → 2 | 126 → 80 | 40 |

A bus whose candidate branches differ only in stops behind it is marked `sharedOnward`. It
may follow the road ahead for an estimate, but stays unresolved and is never counted as
matched.

## Collector run records

On the new code, a starting collector closed three live runs left `running` by abrupt stops
(started 00:57, 10:42 and 12:25 BST) as `interrupted`, exit reason `abandoned`, each finishing
at its last cycle, with no cause inferred. The owner's earlier 13:44 stop is one of them. The
shape build ended `completed`. The bounded run `20260913T151718`, 16:17:18–16:42:18 BST, 25
planned minutes, ended `time_limit_reached` with kind `bounded_development`: 75 cycles, all
succeeded. A real SIGTERM is tested: status `interrupted`, exit reason `signal:SIGTERM`.

## Real feed

The last publication of that run (16:42:18 BST) held 349 buses:
- bearing: 258 reported, 91 absent;
- 208 placed on a pattern;
- 59 unresolved between branches, 41 of them with the same stops ahead;
- 74 on routes with no timetable held;
- 6 too far from any pattern stop;
- 1 with no journeys that day, and 1 whose operator has no timetable held;
- 14 on the evaluated routes;
- 322 carrying a full six-report trail.

The real-feed browser check passed on desktop and phone against that run.

Recorded passes on the built app, with the collector's `live.json` read fresh on every poll:
- walking route: 220 m, 3 minutes to St Modwen Road (nr);
- the chosen bus, BNML 250 to The Trafford Centre, drawn as ESTIMATE;
- City view, then the ride-along, with reconciled reports logged: one snap of 317 m in City
  view, then eased corrections of 4 m and 68 m while riding.

That first recording framed the ride at zoom 18.3, where the bus was barely visible; the
framing fix came from it.

The final build was recorded again from 17:23 BST: a real BNML 256 to Towns Gate (vehicle
SK63AVB), with the boarding point five stops ahead, Cavendish Road (opp).
- Walking: 180 m and 2 minutes, answered 200.
- The ride framing was zoom 20 in every pass.
- Reconciled while riding: eased 91, 65 and 72 m (desktop, day); a 223 m snap (phone, day);
  eased 108 m (desktop, night).
- The phone night pass was the fourth browser context in one session, and it fell back to the
  drawn SVG map. The fallback behaved as designed: no City view, no estimates, and "Last
  reported positions · not continuous tracking". Why that context lost the vector map was not
  established.
- Run again alone in a fresh browser at 17:31 BST, the phone night pass completed every step:
  a real 256 to Piccadilly Gardens, and a 160 m, 2-minute walk to Mallow Street (nr).

## Browser checks

`pnpm test:browser` on the final build (`out/`), desktop 1280×900 and a 390×844 phone: **77
passed, 13 skipped by design, 0 failed** (9.4 minutes). The skipped checks:
- the real-feed and real-walking checks, which ran separately against the live run and passed
  (real feed 2/2; real walking 1/1, run twice);
- nine map lifecycle and fallback checks that run on desktop only.

New or reworked this milestone:
- `motion.spec` (10 per viewport): the moving estimate, measured against real time and across
  publications; the ride camera; the tour; standing; capped; stale; a large correction; an
  unsettled branch; no evaluation; and the reported-only choice;
- `walking.spec` (6 per viewport): consent, and a recorded real route on the map and the card,
  with no location in the page address or console; router failure; no path; an inaccurate
  fix; too far; no location;
- `evidence-motion.spec`: the published evaluation, its visible corrections, and the replay;
- `journey.spec`: the stop-board groups, Selected bus, and overlay collisions, now also with a
  walking route shown.

The first full run on this code caught two defects that the targeted runs had missed:
leaving the ride-along kept its tilt, and starting a second ride on a phone crashed the page.
Both were fixed before the final run.

## Not verified here

- a physical phone: touch, real GPS, sunlight and night legibility, frame rate on a real GPU,
  battery and heat;
- weekday traffic for the estimator;
- the FOSSGIS usage-policy page in full;
- walking routes beyond the areas tried;
- any arrival time: none is predicted.

# Ride-along visibility, night map, motion continuity and a window-seat journey — 13 September 2026, evening

(The window-seat film card recorded below was removed later that evening at the owner's request:
the window seat wanted is a virtual view from the bus through the mapped streets. The checks of
it are kept here as a record.)

Everything here was measured on this machine in a software-rendered Chromium (SwiftShader) at
1280×900 and at 390×844 with touch emulation, on the built site (`out/`). FIXTURE means fixture
buses on real recorded road and stop geometry; RECORDED means real reports of one journey
re-timed to the test clock; LIVE names its run. Continuous behaviour was measured by sampling
the map's own diagnostic attributes (`data-display`, `data-camera`, `data-ride`,
`data-bus-screen`, `data-correction`) every 120–250 ms during the interaction; the recorded
videos were reviewed as contact sheets of sampled frames, not watched end to end.

## The reported ride-along state, reproduced first

On 83053c7, with FIXTURES (`scratchpad` probe, 13 September 18:10 BST):

- Drag while following: "Recentre on the bus" appeared; 12 s later the estimate had moved
  65 m out of the frame. Wheel-zoom to 17.59 while paused: the model was a 20 px sliver, the
  flat marker hidden (it hid from zoom 17), the badge the only mark. Recentre re-centred at
  zoom 17.59: the bus a speck in the middle.
- Three "Zoom out" taps while following: the zoom stayed 20.00. Per-frame `jumpTo` begins
  with `stop()`, which cancels an animated zoom; in isolation the same loop cut a wheel zoom
  to a fraction and would reset a pinch every frame.
- A drag during the introduction: the camera reached the introduction's stop step regardless,
  "Skip to the bus" stayed up, and the introduction finished 10 s later. In isolation MapLibre
  does report a drag that interrupts an ease, but the introduction chained its next glide on
  the interrupted glide's `moveend`, and that glide's `stop()` reset the drag before it was
  reported. At that step (zoom 17) the bus was not visible at all.
- A bus with no estimates (as route 142) and a bus without a bearing both framed correctly at
  zoom 20; the problem was not confined to either.

The two findings named in the brief were both true (`recentre()` kept the zoom; the flat
marker hid at the model's zoom regardless of size), and the cancelled zooms and the swallowed
drag were the further causes.

## What changed

- One ride state (`entering`, `following`, `exploring`, `returning`, `off`) shared by the
  frame loop, the HUD and the card. The loop moves the camera only when the map is not
  already moving; a camera left more than 40 px from the bus glides back. Every transition has
  a token; raw pointer and wheel events end an introduction or a return; a tap during the
  introduction skips to the bus. "Return to bus" brings the bus to the middle at the zoom
  shown, then glides around it to zoom 20, pitch 60 and the bus's heading, then follows. The
  introduction plays once per visit: the journey centred on the bus, then down to it.
- Found on the phone, by the entering check and then a probe without screenshots (`data-ride`
  and `data-camera` every 40 ms, 40 s to run): a phone's ride map finishes growing just after
  the ride starts, MapLibre fires `resize`, and the handler re-applied the clear band with
  `setPadding`, which in 6.7.0 is `jumpTo({padding})` and so stops any glide. The introduction's
  first glide ended after about 80 ms, and a second ride was left "following the bus" at zoom
  13.6, flat. The band now waits for the camera to be still. Separately, one ease that zooms in
  six levels while moving the centre swings an off-centre bus out to about three times its
  offset before it lands (MapLibre moves the centre in world space while the zoom changes),
  which took the bus off a 390 px screen mid-introduction; every glide to the bus now centres
  it first.
- Identification at every zoom: the flat marker below zoom 18 (the model is not drawn there
  at all); from 18 the model inside a lime ground ring with the route number above it, both
  symbols, which MapLibre draws over buildings. The stale-projection defect the new check
  itself found (a standing bus draws no frames, so its canvas position was not refreshed while
  the camera moved) is fixed by projecting on every camera move.
- Night: buildings and extrusions nearer the ground tone, extrusion opacity 0.78, street
  names 11–15 px with a 2–2.2 px halo, landmark names 11.5–14 px, brighter text on a darker
  halo; line labels pitch-aligned to the viewport (upright when tilted) while following their
  street. The day palette is unchanged; `tests/map-style.test.mjs` validates both themes
  against the MapLibre v8 specification and the reserved-colour rule.
- The HUD's mode line ("Ride-along · following the bus") replaces the long disclaimer, which
  sits behind "What is this?". The card's ride status reads the same state.

## Motion: the audit and the new model

Visible corrections on the held-out captures (3,826 report arrivals; the moment each new
report reached the page, how far the estimate moved before any smoothing), with the model
published that afternoon (motion-2, constant speed eased off with a 45 s decay):

| Kind | Share | What was true of those |
|---|---|---|
| Back by more than 35 m | 20.9% | 45% were reports showing the bus had not moved (under 10 m); 50% were within 40 m of a timetabled stop; 32% had slowed to under 60% of the earlier speed |
| Forward by more than 35 m | 40.8% | median 99 m; 0% standing: the blanket decay's cost at steady speed |
| Over 150 m (snap) | 10.0% | median 186 m, mostly forward |

The cause of backward corrections is buses standing at stops and lights while the estimate
rolls on; the cause of forward corrections was the blanket decay. So the estimator gained
stops: it can pause at each timetabled stop it reaches (the shapes carry the stops' offsets),
read speed from the stretches where the reports show the bus moving, hold a bus shown
standing, and still ease with report age. Two hundred candidates (dwell 0–20 s × window or
cruise speed × standing hold 0 or 15 s × decay 0–120 s) were scored on training by a rule
fixed before any held-out figure was read: within 2% of the best mean error up to a minute,
the smallest mean visible move. Chosen: dwell 10 s, cruise speed, no standing hold, decay
120 s (`motion-3 · 2026-09-13 · window 75s · dwell 10s · cruise speed · decay 120s · horizon 120s`).

Held out (38 journeys, 20,708 predictions):

| | motion-3 (chosen) | motion-2 (previous) | constant speed |
|---|---|---|---|
| Error up to a minute, median | 62.6 m | 64.9 m | 69.3 m |
| Error up to a minute, mean | 86.4 m | 92.5 m | 94.0 m |
| Within 30 s of a report, median vs the last report | 44.5 m vs 61.1 m | 45.7 m vs 61.1 m | — |
| Mean visible move per arriving report | 65.5 m | 68.0 m | 70.7 m |
| Back by more than 35 m | 26.2% | 20.9% | 32.6% |
| Forward by more than 35 m | 35.2% | 40.8% | 32.1% |
| Over 150 m (snap) | 8.9% | 10.0% | 10.3% |

By report age, held out (estimate median vs the last report's): 10 s 32.8 vs 56.3; 20 s
39.5 vs 52.1; 30 s 50.7 vs 71.4; 45 s 72.9 vs 137.5; 60 s 88.8 vs 181.7; 90 s 118.9 vs 272;
120 s 166.3 vs 375.9 (motion-2 at 120 s: 237.4). The training band held 74–82% of held-out
cases per bin. The residual stands: a quarter of arriving reports still put the bus back more
than 35 m, because the reports are 20 s apart and a bus at a stop is standing or not. Those
are drawn (held up to 35 m, eased along the road above that, snapped and said above 150 m),
never hidden. The standing hold was tried and rejected by the rule: it raised snaps.

## Verification

On the final build unless stated:

    pnpm typecheck && pnpm lint && pnpm build
    pnpm test                                              # 102 passed
    pnpm test:browser tests/browser/ride.spec.mjs tests/browser/motion.spec.mjs:79 \
      tests/browser/motion.spec.mjs:102 tests/browser/journey.spec.mjs:166 \
      tests/browser/journey.spec.mjs:202 tests/browser/journey.spec.mjs:240 \
      tests/browser/journey.spec.mjs:263                   # 36 passed, desktop and phone, 5.7 min
    pnpm test:browser tests/browser/window-seat.spec.mjs   # 5 passed, 1 skipped by design
    pnpm test:browser tests/browser/replay.spec.mjs        # passed, on the build before the last camera repair
    node --experimental-strip-types --import ./tests/alias-loader.mjs scripts/evaluate-motion.mjs

- Python: 87 tests passed earlier on 13 September; no Python changed in this milestone.
- The last full browser run (`pnpm test:browser`, 20.1 min, an earlier build that evening):
  104 passed, 3 failed, 15 skipped by design. `replay.spec` flagged backward drawing 5 s after
  a correction, which was the correction settling (the check now allows the correction's size
  at 15 m/s plus 3 s: the catch-up rate and the decay's tail), and the entering check failed on
  desktop and phone because the introduction lost the bus. Both were repaired; both pass on the
  final build.
- The real recorded journey through the page (desktop, the published motion-3 settings and
  road shape): 1,481 frames over 276 s; 13 report arrivals, each eased (22–133 m, median 53 m);
  no snap (the offline evaluation expected one for this slice); the largest step between frames
  outside a snap 4.3 m in 0.2 s; drawn backwards only while a labelled correction settled (44
  frames); following throughout.
- The ride-along probe on the final build (no screenshots, attributes every 40 ms): the phone's
  introduction reached its overview at 1.26 s (zoom 12.85, tilt 35°, the bus in the middle of the
  clear band) and following at zoom 20 at 2.67 s; a repeated entry reached zoom 20 and 60° in
  1.25 s (desktop 1.28 s). Before the repair the phone skipped the overview (the same probe) and
  its second ride stayed at zoom 13.6 (the recorded frames).
- The FIXTURE demo, recorded from the final build: desktop day (a 32 s video and ten frames),
  phone night and desktop night (ten frames each), reviewed as frames and contact sheets. In
  every run each step reported the expected state: entering; following at zoom 20 and 60°;
  exploring after a drag; following after Return to bus; zoom 18 kept through a new report and a
  theme change; off after exit; following at zoom 20 on re-entry.
- LIVE window-seat: YouTube's player loaded only on request, played the film (the `<video>` in
  its own frame past 1 s and not paused) and paused on command; with its host blocked, the
  fallback appeared.

Seen in the FIXTURE frames, and not a defect: the fixture bus stands still for the first minute
of its trail, and the FIXTURE motion evaluation reads speed over the whole 45 s window, so the
card's "moving about … km/h" starts at 2–3 km/h and rises as the standing reports leave the
window, while each new fixture report eases the drawn bus forward. The published motion-3
settings read speed from the stretches where the bus moved; the recorded replay uses them.

# Ready for a first passenger comparison — 13 September 2026, late evening

Same conventions as the section above. The final build is the commit that adds this section.

## "Ride along doesn't seem to be doing anything"

Reproduced on the owner's own setup (`pnpm dev:live`, `localhost:3000`): entering the ride-along
glided to an empty map. It happened only under `next dev`. React's Strict Mode mounts each
component twice, and the frame loop's cleanup cancelled its animation frame but kept the id, so no
frame was asked for again and the chosen bus was never drawn. The cleanup now clears the ids.
Checked on the running dev server with the real feed: route 15, estimated, following at zoom 20,
pitch 60, bearing 158°. The automatic introduction is gone; entering goes straight to the bus.

## Why the ride twitched, and what changed

Four measurements, from the camera to every captured journey.

1. **The camera, frame by frame** (FIXTURE: 7 m/s, reports every 10 s with a ±6 m wobble; the
   camera diagnostic read on every animation frame for 24 s outside and 24 s in the front view,
   resampled to 50 ms; speed over 100 ms, acceleration over 200 ms):

| Build | Outside: speed, 5th–95th percentile | Outside: acceleration p95; windows over 3 m/s² | Front: acceleration p95; over 3 m/s² |
|---|---|---|---|
| Committed | 5.3–8.5 m/s | 4.7 m/s²; 40 of 474 | 5.3; 54 |
| First repair (catch-up limited to 6 m/s²) | 6.4–10.3 m/s | 5.1; 40 | 6.1; 80 |
| Final | 6.1–9.1 m/s | 2.6 m/s²; 15 of 474 | 4.8; 75 (see below) |

   The first repair measured no better, which sent the search to real data. On the final build
   the outside view's acceleration fell to 2.6 m/s² at the 95th percentile, with 15 windows over
   3 m/s² instead of 40. In the front view the measured point is the spot 30 m ahead that the eye
   looks at, which also swings sideways as the heading turns, so its speed is not the bus's; what
   matters there is the heading, whose turn acceleration fell from up to 80°/s² to 33°/s² (95th
   percentile 28 to 15°/s²; windows over 60°/s² from 6 to none).

2. **On screen** (the chosen bus's lime marks located in every frame of the recorded ride video,
   25 a second, while it was in view): the bus moved on screen from frame to frame by 0.96 px at
   the median and 2.5 px at the 90th percentile (committed), 0.62 and 1.9 px (first repair),
   0.97 and 2.5 px (final). The camera is set in step with the drawn state, and the bus is drawn
   through a GeoJSON source a frame or so later. That movement, about a pixel, is the same before
   and after (the first repair's lower figure is within the software renderer's run-to-run
   variation), and it is not what read as twitching.

3. **One real journey, frame by frame** (RECORDED: BNML 256 outbound, SK74BNB, 14 reports over
   4.75 min; the published road shape and motion-3 settings; the page polling every 10 s; offline
   at 60 frames a second; the estimate identical, frame for frame, in both):

| | Committed drawing | Final drawing |
|---|---|---|
| Speed stepping by over 1 m/s in one frame | 34 times | never |
| Hard speed changes (over 4 m/s²) | 26, 5.5 a minute | none |
| Largest change of speed in one frame | 1,214 m/s² (a step) | 3.25 m/s² |
| Drawn speed, 95th percentile | 19.2 m/s | 13.5 m/s |
| Frames drawn backwards | 601 | 504 |
| Drawn bus from the estimate, median; 95th percentile | 0.0; 65.5 m | 5.2; 102.5 m |

   The two backward stretches left both follow reports that put the bus 117–119 m behind where it
   was drawn, beyond the estimate's measured error.

4. **Every captured journey** (`scripts/evaluate-drawing.mjs`, 10 frames a second, polling every
   10 s; outputs in `data/evaluation/`, not in Git):

| | Development: committed | Development: final | Fresh: committed | Fresh: final |
|---|---|---|---|---|
| Journeys; hours drawn | 109; 62.0 | 109; 62.0 | 30; 11.2 | 30; 11.2 |
| Speed steps per hour | 267 | 0 | 292 | 0.1 |
| Hard changes, share of frames | 3.5% | 0 | 4.0% | 0 |
| Reversing: share of time; metres an hour | 3.2%; 1,198 | 2.6%; 405 | 2.8%; 1,048 | 2.1%; 302 |
| Drawn speed, 95th percentile | 17.4 m/s | 12.9 m/s | 18.7 m/s | 14.0 m/s |
| From the estimate: median; 80th; 95th percentile | 0; 10.8; 48.7 m | 1.5; 35.4; 84.2 m | 0; 9.6; 52.6 m | 1.8; 35.4; 86.8 m |
| Snaps per hour | 23.3 | 22.9 | 25.5 | 25.2 |

   Also tried on both sets: the same drawing with only the fixed 35 m hold (no steps, but it
   reversed far more: 6.8% and 6.0% of the time); an 8 m/s catch-up (less reversing, 320 and
   247 m an hour, but further from the estimate: 95th percentile 88.5 and 90.8 m); 4 m/s² with a
   1.5 s settle (nearer the estimate, 80.7 and 83.1 m, but 2.6–2.9% of frames changing speed at
   over 4 m/s²). The final drawing was the best balance on both sets.

**The cause.** The estimate's own speed changes instantly: it pauses 10 s at each timetabled stop,
stops at the end of its horizon, and a new report can change its speed reading. The drawing passed
each change straight through, so the drawn bus stopped dead, leapt away or changed pace within a
frame, and a correction started at full rate.

**The change** (`lib/motion.ts`: `DRAWING`, `drawingFor`, `stepVisual`; the estimate is untouched,
and identical frame for frame):
- the drawn bus has its own speed, which changes by at most 3 m/s each second;
- it heads for the estimate's own path averaged over ±3 s of what is already known of it, so it
  slows before a timetabled stop, stands at it, and pulls away just before the estimate does.
  Nothing is invented: the average is of the estimate's path, read at nearby moments;
- a correction is closed at up to 12 m/s beyond the path's speed, along a braking curve that
  lands softly;
- while the bus moves, a report that finds the drawn bus ahead by no more than the estimate's
  measured error at that report age (the published 80% band: 49 m for a fresh report, 110 m at
  30 s) stands it and lets the estimate catch up instead of reversing it; beyond that it glides
  back, and past 150 m it snaps, as before;
- a frame after the page stopped drawing (a standing bus) starts from where the bus stood. The
  in-page replay found this on the first build of the change: after a pause a bus leapt 157 m in
  0.2 s, unlabelled. A unit test now covers it;
- a standing bus at a bend no longer keeps the clock running (the drawn heading was compared with
  the estimate's, which differ at a bend).

The stated cost: after each report the drawn bus trails or leads the estimate for longer (95th
percentile 84–87 m from it, against 49–53 m before). The estimate's own error up to a minute is
65 m at the median, and while the drawn bus waits the estimate stays inside the band drawn
around it.

## Front view

Assessed with a bounded prototype and kept, with the limits stated in `PROJECT_CONTEXT.md`.
FIXTURE bus at 7 m/s on the route-256 road shape (the published shape was accepted against 1,578
reports, 95th percentile 11.3 m):
- the eye 3.5 m above the road at the front of the drawn bus, looking 30 m ahead: pitch 83.3°,
  zoom 20.3 on the desktop and 20.5 on the phone. The camera is set from the displayed state, so
  it holds when the drawn bus holds;
- first frames: the roads were hairlines at eye height. They now have typical widths (a 4 m
  service road to an 11 m motorway, casings 1.5 m wider), the buildings are solid, and there is a
  sky by day and by night;
- second frames: the view read as a road ahead with buildings towards the horizon, but the name of
  the road ahead stood on end and overlapped itself, and the heading turned with a jolt at each
  corner of the road shape (turn acceleration up to 77°/s²). Line labels are now hidden in the
  front view and the heading is eased with a 0.4 s time constant;
- final frames: the road ahead reads cleanly by day and by night, with no name standing on end.
  Continuity: sampled every 250 ms for 8 s at desktop by day and phone by night (33 and 32
  samples, each with a new camera), zoom steady at 20.27 and 20.46, pitch 83.3°, the eye moving
  69 m and 62 m along the road, no page errors. The recorded video was reviewed through its
  per-frame measurements and as frames, not by watching it play;
- the bus's own model, ring, number, caption and trail are hidden: no lime was found in any frame
  of the recorded ride once the front view began. Outside view restores them; the HUD keeps the
  route, destination, report age and "Estimated position";
- offered only on an accepted road shape. A bus without one (route 53 in the fixtures) gets a
  button that says why, and stays selected. A latest position more than 40 m off its road leaves
  the front view with a note. Under reduced motion the view is a still every 3 s.

## The rest of the milestone

- **The stop's answer, reordered:** the stop's services and the buses coming, maybe coming and
  near it come before the chosen bus's card, and how the estimate is made is folded away
  (`journey.spec` "your stop leads to its services, the buses coming, and the bus standing
  there"; reviewed in frames at both sizes).
- **The journey kept and shared:** `lib/journey-context.ts` keeps the stop, service, bus and
  destination on the device for 12 hours and in the page's address, never a position (8 Node
  tests). `journey-context.spec`, desktop and phone: the chosen stop, service and bus survive a
  reload and the address names them, never the location; a shared link opens its stop and
  service, and a bus it names that has gone is said so, with no other bus chosen for it; a
  remembered bus now on another journey is not chosen again unless the passenger asks.
- **Coverage for a route** (`python -m pipeline.route_coverage`, 5 tests), reporting timetable
  patterns, road shapes, estimate coverage and live buses separately. Route 15 at Marston Road
  (1800SJ32231): 3 patterns, 1 calling there; 2 accepted shapes (756 reports, 95th percentile
  11.7 m; 752, 13.8 m); estimates evaluated; 2 live buses at the time. Route 245 at the same
  stop: 6 patterns, none calling there; no shapes; reports only. The tester's route has not been
  supplied.
- **The motion model frozen** (`docs/MOTION_MODEL.md`), with a guard in
  `scripts/evaluate-motion.mjs` and `scripts/evaluate-frozen.mjs` for fresh captures. First fresh
  window (30 journeys, 19:15–22:37 BST, the same Sunday): median error up to a minute 65.0 m,
  against 143.0 m for the last report and 71.7 m at constant speed; the band held 75–82% bin by
  bin; 3.2% abstained.
- **Deployment configuration** (`deploy/`): `deploy/validate.sh` with Caddy 2.11.4, its archive
  checked against the published SHA-512: four scripts' syntax; seven systemd units verified with
  `systemd-analyze verify`; the Caddyfile validated, then run on 127.0.0.1:8099 against this
  checkout with 19 route and header checks, all passing. The certificate, the collector under
  systemd with the real key, and the timers can only be exercised on a server.
- **Passenger worksheet:** `docs/PASSENGER_TEST.md`.
- **The embedded window-seat film removed:** component, metadata, tests, styles and docs.

## Checks on the final build

    pnpm typecheck && pnpm lint && pnpm build        # pass
    pnpm test                                       # 111 passed
    .venv/bin/python -m unittest discover -s tests  # 92 passed
    pnpm test:browser tests/browser/ride.spec.mjs tests/browser/replay.spec.mjs
                                                    # 37 passed, 1 skipped by design (11.2 min)
    pnpm test:browser <every other spec file>       # 83 passed, 15 skipped by design (9.5 min)

On the build before the final (which differs only in when the map writes its diagnostics), the
ride, replay, motion, journey and journey-context specs gave 84 passed, 3 failed, 1 skipped by
design. The three failures were browser contexts that got no WebGL, so the page drew its own SVG
fallback 45 s before any riding (opportunity log, entry 17); all three pass on the final build.

The recorded journey through the page on the final build (desktop; the published motion-3
settings and road shape): 1,325 frames over 281 s; 13 reports eased (22–133 m); no snap (the
offline evaluation expected one for this slice); the largest step between frames outside a snap
3.7 m in 0.21 s; 32 frames drawn backwards, each while a labelled correction settled; following
throughout. On the previous milestone's build: 1,481 frames, 13 eased, the largest step 4.3 m,
44 backward frames.

LIVE, against the owner's own running `pnpm dev:live` (14 September, 00:32 BST: `next dev` serving
the final code, the collector publishing from BODS), which the check only reads:
`LM_REAL_LIVE=1 LM_BASE_URL=http://localhost:3000 pnpm test:browser tests/browser/real-feed.spec.mjs`
passed 4 of 4 on desktop and phone: the live badge, a painted basemap, buses drawn and a genuine
refresh; and the ride-along going to the chosen real bus, drawing it and following it.

## Not verified here

- A real phone and GPU: legibility in sunlight, frame rate, battery, and the front view on a real
  device.
- Weekday traffic: the fresh window is the same Sunday.
- The tester's own route.
- Anything on a server.

# One bus, kept — 14 September 2026, morning

Same conventions as above, with FIXTURE, RECORDED and LIVE evidence kept apart. Nothing here was
checked on a physical phone. The final build is the commit that adds this section.

## The switching, reproduced first

The owner could not keep one bus followed. In d2e8702 `components/follow-view.tsx` showed the bus
the passenger had tapped, and otherwise `onRoute[0]` (with a route chosen) or `board.coming[0]`
(with a stop chosen). Both lists are ordered partly by report age: the route list by it, and the
stop's "coming" list to break ties between buses the same number of stops away. Follow and Ride
along chose nothing of their own; they followed whatever was shown. So whenever another bus
reported more recently, the card, the lime bus on the map and the ride-along camera moved to it.

`tests/browser/selection.spec.mjs` (FIXTURE) sets that up: two route-256 buses three stops before
Stretford Mall (Stop A) taking turns to report last, then the chosen one missing from a
publication, back, and reporting another journey. On d2e8702's build all 6 checks (3 scenarios,
desktop and phone) failed at the first publication, for example "publication 1: the card still
describes the bus being followed", expected FX-ALPHA, received FX-BRAVO; the ride card read "to
Manchester Piccadilly", the other bus's destination.

The real feed then showed the same fault one level up. With no route chosen, the page offered the
route of the latest report and re-took it at every publication, so the route list and its
suggested bus jumped to whichever route reported last. A bus followed from it stayed chosen, but
was left under a list of another route (the LIVE check below followed a 192 and ended above a
list of route 8), and the strip did not say the bus was not in that list. A fifth FIXTURE check
has routes 256 and 53 take turns to report last. On the build before the fix it failed at the
first publication on desktop and phone: the route offered became `BNSM|53` where `BNML|256` had
been.

## What changed

- **A choice is a pin** (`lib/selection.ts`): the vehicle, and the journey it was on when chosen.
  A list row, a card, a map marker, Follow or Ride along on the bus shown, a journey restored from
  this device or a link: each pins. What the page picks for someone who has not chosen is a
  labelled suggestion, kept while it stays a candidate. A pin is either seen on its journey, seen
  on another journey, or missing (its last report shown if not expired, never moved on); nothing
  replaces it.
- **The page** (`components/follow-view.tsx`, `components/city-map.tsx`):
  - the card and the ride card say "Suggested bus", "Your bus", "Your bus · no current report" or
    "Your bus · another journey", and offer the alternatives as buttons;
  - a strip under the map keeps the chosen bus, its status and Details in view while the lists
    scroll, and says when the bus is not in the list below;
  - a missing bus is drawn hollow with NO NEW REPORT, with no model and no estimated movement;
  - the map's draw key includes the journey, so another journey starts a fresh trail and motion;
  - filters no longer clear the choice;
  - a list row reads "your bus · another journey" where that applies;
  - with no route chosen, the route offered is kept while it still has buses;
  - the card, the strip and the map's legend share one name for the bus: Suggested bus, Your bus
    (chosen for your stop, or chosen and now missing or on another journey), or Selected bus;
  - Details in the strip moves focus to the card as well as scrolling to it, so a keyboard user's
    next Tab goes on from the card rather than from the lists above it.
- **Stop activity** (`lib/stop-activity.ts`; on the card and the ride card, with its evidence in
  "How we know this"). The rules and their limits are in `PROJECT_CONTEXT.md`.
- **Screens:**
  - the day marker has an ink rim, and the ring round the 3D bus is smaller and fainter;
  - the stop's actions sit on their own row, so its name fits;
  - one empty-state message with next actions replaces three;
  - the fallback map says why it is shown, and names each bus for a screen reader with its
    destination as the card writes it, not the operator's raw code ("Manchester_Piccadilly").
- **Drawing:** it waits at half the path's speed instead of standing (below).
- **Map start:** the watchdog no longer times the network's tiles (below).
- **Checks and probes:**
  - `waitForPaint` in the browser fixtures;
  - `tests/browser/browser-env.mjs`, shared by the Playwright config and the probes;
  - `scripts/probes/`;
  - a real-feed check that follows, then rides, a real bus through five publications.

## FIXTURE evidence

- `selection.spec`, desktop and phone: 7 checks, all passing on the final build. Besides the
  reports taking turns, absence, return and a new journey, it has:
  - a theme change, a filter to another service, and a drag of the map with Return to bus;
  - two routes taking turns with no route chosen;
  - keeping the bus from the keyboard or with a tap on the phone;
  - a followed bus when live positions stop;
  - a tap on another bus on the map. This runs on the drawn fallback map, whose markers are
    elements; the vector map calls the same selection. Under `next dev` (a separate server on port 3100, the
  final code), the selection, journey-context, stop-activity and ride checks first passed 56 of
  60. The 4 failures were two stop-activity checks at both sizes, faults in the checks rather
  than the page:
  - one asserted that the whole card never says "Appears stopped", although the evidence's rule
    text names it;
  - the other published a trail entry at the same time as its report, which the page's schema
    refuses, so the bus was dropped.

  Corrected, the stop-activity and selection checks passed 22 of 22 under `next dev` (2.1 min).
- Stop activity: 14 Node tests, one per case:
  - a single report is near, never stopped;
  - standing 20 s or more appears stopped;
  - a passing bus with two reports 40 m apart is near;
  - the stop across the road is never named;
  - a heading against the stop's direction says nothing;
  - an old report says nothing, and an ageing one is near at most;
  - a repeated report is one observation;
  - a position within 150 m but beyond 50 m names nothing;
  - jitter up to 15 m keeps a stand, and more breaks it;
  - standing under 20 s is not yet stopped;
  - 35 m before a stop, as at lights, is near;
  - with no single pattern, or from a recording, nothing is said;
  - the evidence lists every report read.

  `stop-activity.spec` puts five of these through the page, desktop and phone: 10 passed on the
  final build in the full suite, and 10 under `next dev` once two of its checks were corrected.
- **Playback** (`scripts/probes/selection-playback.mjs`, final build): the ridden bus and another
  taking turns, the ridden one missing, back, on another journey, then the ride left. Desktop by
  day and phone by night, 9 frames each, reviewed as frames and contact sheets with the video's
  per-phase diagnostics:
  - the map drew FX-ALPHA in every phase, as suggested, active, missing or on another journey;
  - the card described FX-ALPHA throughout;
  - while riding, the camera was 0 m from it and 212 m from the other bus;
  - there were no page errors.

  On the phone at 390 px, the ride HUD, the ride card with its status line and the strip under
  the map were all readable, with nothing overlapping. The missing bus's hollow marker is small on
  the night map; its NO NEW REPORT caption and the cards carry the message.

## RECORDED evidence: the drawing against held-out reports

`scripts/evaluate-drawing.mjs`, the page's frame loop run offline over the captured journeys at 10
frames a second, polling every 10 s. Each report is held out from what came before it. Distances
are along the road from the later report, not GPS accuracy (full table in `docs/MOTION_MODEL.md`):

| | Fresh: 30 journeys, 2,063 reports | Development: 109 journeys, 11,055 reports |
|---|---|---|
| Drawn bus, median; near a stop; display lag | 61.3 m; 43.7 m; 2.5 s | 59.0 m; 40.3 m; −0.5 s |
| The estimate it follows | 54.8 m; 38.6 m; 0.6 s | 52.5 m; 37.5 m; −3 s |
| The last report the page had | 112.8 m; 97.3 m; 17.6 s | 86.0 m; 52.7 m; 15.7 s |
| Drawn stands the reports contradict, an hour: now; if standing while waiting | 3.2; 11.9 | 2.8; 10.9 |

The drawn bus trails the estimate it follows by 6–7 m at the median, the price of never jumping.
The 84–91 m 95th-percentile distance between the drawn bus and the estimate measures that lag
between two computed positions; it is not an error against where the bus was, and not GPS accuracy.

## LIVE evidence

The collector ran for 30 minutes from 08:57 BST on 14 September (`pipeline.collect --minutes 30`).
It recorded 89 cycles: 88 succeeded, and one request failed with a network error (cycle 56, a
`URLError`), after which the next succeeded. It loaded 41,469 observations. Its first cycles held
609–611 buses in the area, and the publication of 08:58:54 BST carried 543. On starting, it closed
the run of 13 September begun at 23:36, left open with 11 cycles and no record of how it ended.
`next dev` on port 3100 served the final code; the check only reads it:
`LM_REAL_LIVE=1 LM_BASE_URL=http://localhost:3100 pnpm test:browser tests/browser/real-feed.spec.mjs`
passed 6 of 6 on the final code (4.7 min), and 6 of 6 on the code before the route fix (4.4 min).
In each run, with no stop chosen, the check followed the bus the page suggested, then rode along
with it, through five real publications. After each one, the card, the strip, the map and the ride
card named the same vehicle, with the ridden bus in view. On the final code the route offered also
stayed the one the bus was chosen from, and the card and the strip gave the bus one name.

The buses were the page's own suggestions, each shown at its reported position (movement on their
services has not been evaluated):
- before the fix: BNSM 192 to Stepping Hill Hospital (desktop) and BNDB 79 to Salford Shopping
  Centre (phone);
- on the final code: BNML 245 to The Trafford Centre Bus Station (desktop) and BNGN 37 to Bolton
  Interchange (phone).

The first run's desktop frame exposed the route flip described above: the 192 was still followed,
but above a list of route 8.

## The map that fell back: investigated, not rerun

A few browser checks had failed in earlier runs because the page drew its fallback map (entry 17
of the opportunity log). `scripts/probes/webgl-paint.mjs` loads the built page repeatedly in one
Chromium, a fresh context each time, as the suite does:

| Build | Loads | Outcome |
|---|---|---|
| Before the fix | 120 ordinary | all painted; median 1.6 s, slowest 2.9 s; no WebGL or GPU message |
| Before the fix | 4, one tile held back 9 s | all fell back at 7.5–7.8 s with `startup_timeout`, although WebGL worked |
| Before the fix | 4, every tile held back 9 s | all fell back at 7.6–7.7 s, `startup_timeout` |
| Final | 4, one tile held back 9 s | all painted, at 10.6–11.3 s |
| Final | 4, every tile held back 9 s | all fell back at 12.6–13.1 s, `tiles_failed` |
| Final | 2, no tile for 30 s | fell back at 12.5–13.1 s, `tiles_failed` |
| Final | 60 ordinary; 40 tilted to City | all painted; medians 1.5 s, slowest 2.6 and 2.9 s |

The cause: the 7 s watchdog was cleared only by MapLibre's first `idle`, which waits for every tile
in view from the real tile server, so one slow tile replaced a working map with the fallback for the
rest of the visit, in the checks and for a passenger on a weak signal. The watchdog now ends at the
first frame; the tiles have their own allowance. Earlier failures left no record, so they cannot
be shown to be this case, though their evidence fits it.

## Checks on the final build

    pnpm typecheck && pnpm lint && pnpm build        # pass
    pnpm test                                       # 134 passed
    .venv/bin/python -m unittest discover -s tests  # 92 passed (no Python changed)
    pnpm test:browser                               # 142 passed, 18 skipped by design (22.6 min),
                                                    # before the fallback map's bus names were fixed
    pnpm test:browser tests/browser/selection.spec.mjs tests/browser/map.spec.mjs
                                                    # after it: 23 passed, 9 skipped by design (3.3 min)

## Not verified here

- A physical phone: sunlight, frame rate, battery, and whether a passenger reads "Appears stopped
  near" as intended.
- The stop-activity thresholds against observed calls: there is no record of when a bus called.
- Weekday traffic, for the drawing as for the model.
- Whether full browser runs stop needing reruns: one clean run is not a trend.

# Before the first passenger test — 14 September 2026, late morning

Four gaps named in an outside review. Each was first reproduced on a build without the fixes: the
code of commit 5d13674, plus one diagnostic, `data-bus-points`, which records where the map draws
each other bus. Then each was fixed. Evidence is FIXTURE unless marked otherwise.

## 1. A chosen bus that starts another journey

**Reproduced.** FX-MOVING runs at 7 m/s along the fixture road with estimated movement on. It was
ridden, or followed on the map, and then its reports carried another journey reference while it
kept moving. Before the fix, on desktop and phone, riding and following alike, the new journey was
predicted: `data-motion` read `estimated` where `observed` was required. The camera went on
following it, and the ride card said only "see the card".

**Now.**
- The vehicle stays the chosen bus. The card, the strip (with the report's age), the ride card
  and the map's caption ANOTHER JOURNEY all say it is on another journey.
- It is drawn at each report it makes, never estimated. The checks require it within 5 m of the
  latest report, and more than 20 m on after the next one: moving, not frozen.
- The map stops following it: the camera stays within 3 m across a report.
- The ride-along pauses (`data-ride` = `paused`), and a drag cannot turn the pause into "Return to
  bus".
- "Keep following it on this journey", in the ride card or on the card, resumes estimated movement
  and following, gliding back to the bus.

Both checks, ridden and followed, passed on desktop and phone on the final build. They passed on
the build before it too, which differed only in the tile allowance. The ride, motion, journey,
journey-context, map and replay specs all passed with the new paused state (120 of the 136 checks
run on that build; the others were the slow-tile checks and two phone checks discussed below).

## 2. A real, rendered MapLibre marker

The checks now click or tap the spot where the map draws a bus, and MapLibre's own hit-testing
decides what that spot meets.
- **A click on a drawn marker (desktop)** chose it, before the fix and after.
- **A bus about 14 px from the chosen one** (as buses bunch at a stop), tapped where it shows. Before
  the fix the chosen bus won, on desktop and phone. Each marker layer had its own click handler, so
  every layer under the pointer fired, and the chosen bus's layer, registered last, won; its marker
  is 59 px across. Now one handler takes the bus drawn nearest the tap, within 14 px of it.
- **Phone:** a tap on a drawn marker, one 20 px off its centre (outside the 13 px disc, inside a
  44 px finger target), and one on empty map. Before the fix all three phone checks failed.

  A probe of the same build showed that a touch tap produces pointer, touch, mouse and click events,
  none cancelled, and chooses the bus tapped. So touch reaches the map, and the checks were at
  fault: they had not waited for the camera to come to rest, nor made sure no control covered the
  spot. They now do both, and drag a covered bus into the clear first.

  On the rebuild the two phone taps still missed, though nothing covered the spot. The helper's
  "at rest" was wrong: `data-camera` is written only when a move ends, so it stays put mid-glide,
  for instance while the page re-centres its bus after a publication. The tap then landed where the
  bus had been. "At rest" now also needs the chosen bus's position on screen (written on every
  move) to stay put. With that, all three phone marker checks passed. The screenshot saved at each
  tap shows it on target:
  - the exact tap on the other bus's dark marker, at (182, 230) CSS px;
  - the finger tap 20 px to its right, on the marker's "256" label, which still chose that bus;
  - the chosen bus's lime marker well away, at about (235, 302).

On the final build, `selection.spec` passed 23, with 1 skipped by design (the finger check runs on
the phone only), and none failed, in 3.1 min. That includes every marker check at both sizes and
the earlier tap on the fallback map.

## 3. Keyboard only, slow tiles, slow live positions

- **Keyboard only (desktop):** search for the stop, pick Stretford Mall (Stop A) with the arrow
  keys, choose the bus from the list, Follow, Ride along, Details, leave.

  Before the fix, focus fell to nothing when the ride began, because Ride along is removed then.
  Now the ride's region takes focus, and Ride along gets it back when the ride ends. Details moves
  focus to the card, and a focus ring shows on each control reached.
- **Slow live positions** (the first publication held back 9 s): before the fix, the bar read "NOT
  COLLECTING · not published yet". Now it reads "CHECKING · waiting for the first positions", with
  no unavailable message, and a chosen stop says its buses will appear, not that none has a current
  report. Search and "Buses near me" work meanwhile.
- **Slow tiles** (every vector tile held back 6 s): before this fix, the page drew its fallback map
  (`tiles_failed`) on both sizes, even with the previous watchdog fix. The 12 s allowance for the
  first tile ran from the first frame, and each camera move during startup asked for new tiles:
  fitting the buses, going to the passenger, going to the stop. Now the allowance restarts each
  time the camera comes to rest. The tile host that never answers still falls back.

  That was not enough. On the build with it, the check still fell back on desktop, and the probe
  with every tile 9 s late still did so at 12.5–13.9 s. The check's own network trace showed all
  six tile requests answered after 6.07 s. A tile counts as loaded only once its labels are laid
  out, and the glyphs they need are fetched after the tile, from the same host: on a slow network,
  two slow round trips in turn. The allowance is now 12 s for the tile service to answer at all
  (its TileJSON), restarted when the camera comes to rest, and 40 s for a first whole tile once it
  has answered. Under `next dev` (the owner's running server, only read): the check passed on
  desktop and phone, and with every tile 9 s late all 4 loads painted, at 26.2–27.5 s.

On the final build, `access.spec` passed all five checks:
- the keyboard-only journey (desktop);
- slow live positions, desktop and phone;
- slow tiles, desktop and phone.

`map.spec` passed every desktop check (its phone copies are skipped by design). That includes the
three failures that must still fall back:
- the tile service never answering;
- the tile service refusing every request;
- every tile failing after the style loads.

The probe on the final build (`scripts/probes/webgl-paint.mjs`) held back every `.pbf` from the
tile host, tiles and glyphs alike, as a slow network would:

| Held back | Loads | Outcome |
|---|---|---|
| One tile, 9 s | 4 | All painted, at 10.6–11.6 s |
| Every tile, 9 s | 4 | All painted, at 21.3–26.0 s. On the build before, all had fallen back, at 12.5–13.9 s |
| Every tile, 60 s, after the tile service had answered | 2 | Fell back at 40.8–41.3 s (`tiles_failed`): the allowance ran out, as intended |

## 4. Monday captures

Exported once the owner's collection had ended, since the collector is the warehouse's only writer.
Scored with nothing refitted; details in `docs/MOTION_MODEL.md`.
- **The capture:** 86 journeys and 6,745 reports on routes 15, 250 and 256, from three bounded
  runs: 00:00–00:22, 08:57–09:27 and 09:45–11:49 BST. There is almost nothing from the morning peak
  and nothing after midday.
- **Eligible:** routes 15 and 250, on their four patterns with accepted road shapes (4,937
  reports), gave 11,668 cases up to a minute old. Six of the seven report-age bins have 100 or more;
  the youngest (≤10 s) has 98. Route 256 gave none:
  - all 965 reports of its 12 inbound journeys were placed on no timetable pattern. Every 256
    inbound pattern held here runs only at weekends (Saturday, or Saturday and Sunday), and no
    weekday one is published. Why is not established: the patterns were built on Sunday
    13 September, and a rebuild on a weekday is the next check;
  - its outbound reports were on a school-day variant whose road shape had been rejected for lack
    of Sunday reports (628), or on no pattern (182).
- **The frozen model:** median error up to a minute 62.7 m, against 118.3 m for the last report
  and 71.4 m at constant speed.
  - It beat the last report in every age bin, and constant speed in all but the youngest (33.5
    against 34.0 m, from 98 cases).
  - The band held 79.2–81.1% (nominally 80%).
  - It abstained on 30.5% of moments, nearly all on route 256.
- **The final drawing** (62 journeys, 4,853 held-out reports), at the median from where the bus next
  reported:
  - the drawn bus 60.7 m (42.8 m near a stop), the estimate 59.8 m, the last report 98.3 m;
  - display lag −0.1 s;
  - stands the reports contradict: 3.1 an hour.

This is one weekday morning on two routes. It agrees with the Sunday evening window, but it is not
an evaluation of weekday performance:
- route 256 could not be scored;
- the peak and the afternoon were not captured;
- the model's replacement rule asks for two whole weekdays.

## Checks on the final build

    pnpm typecheck && pnpm lint && pnpm build        # pass
    pnpm test                                       # 134 passed (no library code changed)
    pnpm test:browser tests/browser/selection.spec.mjs
                                                    # 23 passed, 1 skipped by design (3.1 min)
    pnpm test:browser tests/browser/access.spec.mjs tests/browser/map.spec.mjs
                                                    # access 5 of 5; map all desktop checks,
                                                    # the phone copies skipped by design

Python was not rerun: no Python changed. The build before the final one differed only in the tile
allowance. On it, `selection`, `access`, `journey-context`, `journey`, `map`, `motion`, `ride` and
`replay` gave 120 passed, 12 skipped by design and 4 failed:
- the slow-tile check at both sizes, fixed since (above);
- two phone marker checks, whose own helper was at fault (above).

Every check the camera change could reach passed on it: the ride-along, motion, journey and
replay specs.

# Front view as a street preview, and what a slow map shows — 14 September 2026, early afternoon

The owner asked for one focused visual refinement before the passenger trial. The outside
ride-along, its camera and the chosen-bus behaviour were left as they were. Evidence is FIXTURE
unless marked otherwise: the fixture journey on route 256's real accepted road shape, over real
OpenFreeMap tiles.

## Before and after, on the same stretch of road

`scripts/probes/front-view.mjs` records the same 40 s on each build:
- the fixture's moving bus (estimated, 7 m/s), from about 120 m before the first clear turn in its
  road shape, 960 m along it;
- a report 24 s in that corrects the estimate by 40 m;
- the night theme, at desktop (1280 × 900) and phone (390 × 844) size;
- a frame each second, the camera every 100 ms, a video and a contact sheet.

The outputs are in `outputs/probes/front-view/{before,after}/{desktop,phone}-night/`, not in Git.

| Night | Pitch | Zoom | Eye step per 100 ms, p50 / p95 / max | Turn rate p95 | Turn acceleration p95 / max | Ride state | Corrections |
|---|---|---|---|---|---|---|---|
| Desktop, before | 83.3° | 20.52 | 0.75 / 1.63 / 2.47 m | 18.1°/s | 28.3 / 58.7°/s² | following throughout | 1 |
| Desktop, after | 76.8° | 20.39 | 0.74 / 1.70 / 2.40 m | 17.5°/s | 28.4 / 57.2°/s² | following throughout | 1 |
| Phone, before | 83.3° | 20.46 | 0.75 / 2.30 / 2.96 m | 17.7°/s | 26.5 / 96.2°/s² | following throughout | 1 |
| Phone, after | 76.8° | 20.34 | 0.74 / 2.37 / 3.79 m | 17.5°/s | 20.0 / 58.8°/s² | following throughout | 1 |

**Movement is as smooth as before.** The straight, the turn and the correction all move the eye
by the same median step, and the heading turns through the corner at the same rate. On the phone
the largest single step grew from 3.0 to 3.8 m, and the hardest heading change fell from 96 to
59°/s². The ride stayed "following" in every sample, and the one correction was absorbed without
a snap. No run showed an automatic bus change, a repeated entry or a camera move against a gesture.

**The camera changed only in height and aim.** The eye is now 7.5 m above the road shape (it was
3.5 m) and looks 32 m ahead (it was 30 m). So the pitch falls from 83° to 77°, and the view holds
more street and less sky.

**At the turn (18 s), same theme and viewport:**
- before: dark blocks against a near-black sky, the road a broad plain ribbon, and no names;
- after: lighter slate buildings and kerbs that separate the road from the blocks, and a sky
  graded to a horizon;
- after: upright "Barton Road" and "School Road", from the tiles' own names, and the stop label
  "Moss Park Road (adj)" at its NaPTAN position;
- after: the mode line reads "street preview · following the bus", and the ride card keeps
  "Estimated position · last report N s ago".

**By day, after only.** No day run was made on the earlier build.
- **Movement, desktop and phone:** following in every sample, pitch 76.8°, median eye step
  0.74–0.75 m, turn rate p95 16.5 and 17.9°/s. The 46 m correction was absorbed smoothly.
- **The hardest single heading change** was 88°/s² on the desktop, above its night run's 57°/s²,
  while its p95 was lower (22.5 against 28.4°/s²). The camera's code does not depend on the theme;
  the frame timing does.
- **At the turn:** tan blocks against a pale sky, the road cream with dark kerbs, and "Barton Road"
  and "School Road" upright.
- **On the phone the HUD covers much of the view.** The ride's controls (the exit, the mode line
  on two lines, "What is this?" and Outside view) and the map's tools cover the view's upper part,
  and the ride card its lower part. "School Road" sits partly behind Outside view. This holds by
  day and by night, and it was the same before: the mode line wrapped the same way with "front
  view" in it.

**Verdict: better, and still secondary.** It now reads as a street, with names and the stops
ahead. But it tells a passenger little that the outside view does not, and its height and
position are nobody's real view. The outside view stays the default. Front view stays one button
away and is not among the passenger trial's tasks.

## What a slow map shows

In `access.spec` every tile was held 8 s, with a stop chosen, at desktop and phone size:
- first, "Drawing the map…" appears over a blank map, and the stop, the walk guide, the bus card
  and the lists work meanwhile;
- after 3 s it says "The detailed map is slow to arrive. The bus information is ready, and the
  simple map can show it now.", with **Use the simple map**;
- chosen, the simple map shows the same bus and says "The simple map, as you chose.";
- **Use the detailed map** brings the detailed map back, and it then paints.

**The phone's offer had been cut off.** At first **Use the simple map** sat at the bottom edge of
the phone's first screen. The box was centred in a map that starts partway down the page, and
`left:50%` gave it only half the map's width to wrap in, so it grew to five lines. It now sits
under the view buttons, at a width that keeps clear of the map's tools. The check requires it to
be whole on the first screen (`toBeInViewport({ratio: 1})`). On a phone the bus's strip is below
the map, as it always is; the stop and the walk guide are above it.

## Location, the bigger map, and two defects found on the way

- **One Locate me at a time.** Up to three could appear: the map's, the stop panel's and, with no
  location yet, the walk guide's.
  - The rule now: the walk guide's while it asks for the location; otherwise the map's; or the
    stop panel's when the simple map stands in.
  - The first check took the "Buses near me" path, which never shows the walk guide's button. It
    passed while the search path still showed two. It now takes both paths.
- **Make the map bigger** gives the same map, with the canvas kept, most of the screen, and back.
- **A wheel in the front view.** The camera there sets its own height every frame, so a
  passenger's zoom could not last. Pausing on MapLibre's `zoomstart` was tried first. `ride.spec`
  found the ride still following after a wheel. Now the raw wheel or a two-finger touch pauses
  following, and Return to bus resumes it.
- **Keyboard focus on leaving the ride.** Leaving the ride by keyboard left focus on the page
  itself for a moment. It was restored on the next animation frame, after the map's own effects
  had run, and `access.spec` found it on `<body>`. It is now restored in the same commit.

## Checks on the final build

    pnpm typecheck && pnpm lint && pnpm build        # pass
    pnpm test                                       # 134 passed
    pnpm test:browser                               # 169 passed, 21 skipped by design, none
                                                    # failing (27.0 min, desktop and phone)
    node scripts/probes/front-view.mjs --label before|after --theme night --viewport both

The 21 skipped checks:
- 8 need a live run or a real request: the real-feed and real-walking checks;
- 9 are map checks that run only on desktop;
- 4 run at one size only: on the phone, the keyboard journey, the front-view wheel and one replay
  check; on desktop, one selection check.

The build before the final one ran the ride and access specs: 49 passed, 2 skipped by design and
1 failed. That build lacked three fixes: the focus restore, the walk guide's Locate me rule and
the loading box's new place. The failure was the keyboard journey on leaving the ride, described
above. Python was not rerun, because no Python changed.

The frames were looked at, not only counted. That covers the turn at 18 s in each run, and the
phone and desktop screenshots of the slow-map offer before and after it moved.

Not verified here:
- a real phone: its GPU, frame rate, battery, sunlight, and a real finger's pinch in the front
  view;
- a screen reader.

# A temporary HTTPS link for a phone — 14 September 2026, afternoon

The owner authorised a temporary public preview for a phone trial, through a free Cloudflare Quick
Tunnel: no paid hosting and no domain. Evidence is REAL unless marked FIXTURE: through the public
address, with live collection running. All of it is emulation in this machine's Chromium, not a
physical phone.

## What serves it

- **Not `pnpm start`.** It serves `out/` with Python, so `/data/live.json` would be the copy taken at
  build time, and the phone would never see a new publication.
- **Caddy, as deployed.** `scripts/preview.sh start` runs `deploy/Caddyfile` unchanged, through a
  generated wrapper:
  - `admin off` and `default_bind 127.0.0.1`, with the site address `http://:8098`, so it answers
    only on this machine, and to the tunnel's host name;
  - `/data/*` comes from `public/data` and everything else from `out/`. No other part of the
    repository is reachable.
- **The tunnel.** It then opens a Quick Tunnel: `cloudflared tunnel --url http://127.0.0.1:8098`.
- **The collector.** It reuses a collector holding the writer lock, or starts one bounded run.
  `stop` signals only the processes it recorded.
- **The binaries.** Caddy 2.11.4 and cloudflared 2026.9.1 come from their official GitHub releases;
  cloudflared's is the binary Cloudflare's downloads page links. Each was checked against its
  published SHA-256, and Caddy's tarball also against the SHA-512 in its release's checksum file.
  Both are in `~/.local/bin`.
- **`CADDY=~/.local/bin/caddy deploy/validate.sh`.** Every check passed: shell syntax, 7 units, and
  19 routes and headers, including `/data/../.env` and `../pipeline` returning 404 and `/data/`
  listing nothing. The deploy scripts had been tracked without the executable bit, so running
  `deploy/validate.sh` as documented failed; that is fixed.
- **The collection run.** No other collector held the lock, so one was started at 14:49:29 BST for 60
  minutes. Its first 22 cycles all succeeded, with about 640 buses in the area and a publication every
  20 s. The tunnel connected over QUIC, through London (lhr16).

## Through the public address

- **Loading.** The page returned 200 over HTTP/2. So did `sw.js`, the manifest, `/data/config.json`,
  `/data/live.json`, the MapLibre module and its worker, and the bus model.
- **Headers on `/`.**
  - `Permissions-Policy: geolocation=(self), camera=(), microphone=(), payment=()`;
  - HSTS, `nosniff`, `strict-origin-when-cross-origin` and `no-cache`;
  - `/data/live.json` passes through Cloudflare uncached (`cf-cache-status: DYNAMIC`), with the
    Caddyfile's `max-age=10`;
  - Cloudflare adds its own `Server: cloudflare` header where Caddy removes its one.
- **Private paths.** All 15 returned 404, including traversal spellings: `/.env`, `/data/../.env`,
  `/data/%2e%2e/.env`, `/.git/config`, `/package.json`, `/pipeline/collect.py`,
  `/data/warehouse/collector.lock`, `/scripts/preview.sh`, `/outputs/preview/url`, `/deploy/Caddyfile`,
  `/public/data/live.json`, `/node_modules/…`, `/.venv/…`, `/data/live-capture/` and `/data/`.
- **Credentials.** The BODS key was read inside the check and never printed. It appears nowhere:
  - not in the 76 files the server can serve;
  - not in the page, its 10 scripts and stylesheets, `sw.js`, the manifest or the 8 `/data/*.json`
    files, each fetched through the tunnel.

  None of them contains a `/home/` path either.

`node scripts/probes/public-preview.mjs --base <link>` then ran at 390 × 844, with touch and the
service worker allowed:
- **The map.** It painted. The MapLibre worker returned 200, 78 tiles came from OpenFreeMap with
  none failing, the runtime configuration was read, and there were no page errors.
- **The service worker.** It activated and, after a reload, controlled the page. The live
  publications then came through it from the network, and none came from the device's cache.
- **Location.** The page is a secure context whose policy allows geolocation, and with permission
  granted (emulated) a position was obtained. Emulation does not show a real phone's permission
  prompt.
- **A chosen bus kept across real publications, with no rebuild.** SK74BMZ, route 15 to Roedean
  Gardens, was chosen from the stop's list at the publication of 14:56:11 BST. It was still the
  chosen bus (`data-selection="active"`) through the publications of 14:56:31 and 14:56:52.

## Marston Road (nr), route 15 towards Roedean Gardens

`pipeline.route_coverage --line 15 --stop 1800SJ32231` ran before the collector started:
- **Patterns.** 1 of route 15's 3 patterns calls there: BNML outbound to Roedean Gardens, 57 stops,
  Monday to Sunday, 141 journeys, valid to July 2031. The two inbound patterns do not.
- **Road shape.** Accepted (752 reports, 95% within 13.8 m), and estimated movement is evaluated on
  it.

**Live, in the publication of 14:52:51 BST,** three buses were on that pattern:
- BU25YWF, 3 stops before Marston Road (nr);
- SK74BMZ, 20 stops before it;
- MF74NPE, past it.

**The page's check, 4 minutes later.** BU25YWF had gone past. The page said "15 to Roedean Gardens ·
1 coming or here", and that one was SK74BMZ, "17 stops before yours · 35s ago". A current bus was
reported, so the "no current bus" case did not arise at the time. On the rerun at 15:05 BST, the
page listed two: 11 and 24 stops before the stop.

## Portrait layouts, 360 and 390 px, and gestures

The probe took frames at 360 × 800 and 390 × 844, with touch and a device pixel ratio of 2:
- the first screen: REAL at Marston Road (nr) at both widths, and FIXTURE at Stretford Mall;
- the map made bigger;
- the outside ride-along and the street preview: REAL with SK74BMZ at 390 px, and FIXTURE at both
  widths.

No control over the map overlapped another, left the map or cut its own text off, and no page
scrolled sideways. The frames were also looked at by eye.

Two things were found and fixed:
- **A pinch in the outside ride-along did nothing.**
  - A two-finger pinch, synthesized by Chromium's own input pipeline (`Input.synthesizePinchGesture`,
    touch), left the zoom at 20. That held on REAL and FIXTURE data, at both widths. The same pinch
    zoomed the street preview.
  - The cause: the frame loop placed the camera whenever the map counted as still, and it counts as
    still between the fingers landing and MapLibre taking them as a pinch. Placing the camera
    stopped MapLibre's touch handlers, so the gesture was lost.
  - No check had used touch: the ride checks drag with the mouse, and zoom with buttons and a wheel.
    A new phone check reproduced the fault on the previous build, where the pinch changed the zoom
    by 0.
  - Now the camera is left alone while fingers are on the map. The pinch zooms (20 → 20.9, REAL and
    FIXTURE), the ride keeps following at the passenger's zoom, and a one-finger drag pauses
    following, as a mouse drag does.
  - How a one-finger drag behaved before the fix was not measured, because the check stopped at the
    pinch. All of this is emulated touch; a real finger on a real phone is still to be tried.
- **The street preview's mode line split "Ride-along" across two lines** ("Ride-" / "along") at
  both widths. It no longer breaks, although the rest of the line still wraps onto a second line
  there.

Left as they were: in the street preview the ride's buttons cover the upper part of the view, and a
street name can sit behind "Outside view", as before.

## The stop command, exercised without ending the trial link

A second instance ran with its own record folder and port 8097.
- It reused the running collector, because that collector held the writer lock, and started only
  Caddy and a tunnel.
- `scripts/preview.sh stop` for that instance stopped those two.
- The trial preview's three processes kept their PIDs, and its link kept answering 200.
- The second link had not answered within 25 s of being created: a new Quick Tunnel name can take a
  minute to resolve.

## Checks on the final build

    pnpm typecheck && pnpm lint && pnpm build        # pass
    pnpm test                                       # 134 passed
    pnpm test:browser tests/browser/ride.spec.mjs tests/browser/access.spec.mjs \
      tests/browser/selection.spec.mjs tests/browser/journey.spec.mjs \
      tests/browser/motion.spec.mjs:79 tests/browser/motion.spec.mjs:102
                                                    # 104 passed, 4 skipped by design (checks for
                                                    # one size only), none failing (15.1 min)
    node scripts/probes/public-preview.mjs --base <link>   # through the tunnel, above
    CADDY=~/.local/bin/caddy deploy/validate.sh    # all passed

The whole suite was not rerun. Since its last full pass, the only change is that the camera waits
while fingers are on the map. Only the ride-along and the follow camera reach that, and the checks
above cover them at both sizes, including the new phone check. Python was not rerun, because no
Python changed.

# Passenger feedback: navigation, phones and returning — 14 September 2026, evening

The owner reported the feedback; it was not independently validated.
- A desktop tester called the app a "premium Bee Network".
- Explore, Evidence and Operations made no sense to that passenger.
- They would use a mobile app (stated interest).
- Someone asked about Metrolink.

Evidence below is FIXTURE unless marked REAL. All browser evidence is Chromium emulation on this
machine, not a physical phone.

## What inspection found first (the build of 1bb5320)

`scripts/probes/passenger-layouts.mjs` (new) ran the passenger's own flow, on FIXTURE data with the
recording held back 5 s, at five sizes: 360 × 800 and 390 × 844 portrait, 800 × 360 and 844 × 390
landscape, and 1280 × 900. It found:
- **The passenger's page waited for the recording.** The whole app, the passenger's page included,
  waited for the 1.6 MB archive recording. For 5 s a passenger saw only "Loading the Manchester
  recording…". A recording that failed to load would have left no passenger page at all.
- **Labels and tabs.** The skip link said "Skip to recorded journeys", and on a phone the tab bar
  took a row of the first screen.
- **Search with the keyboard up.** A shortened viewport stood in for the on-screen keyboard. Of
  nine matches, one was partly visible above it.
- **The answer was below the fold.** After a stop was chosen, the walk guide's amber location prompt
  and the map pushed the answer ("3 stops before yours · 11 s ago") off the first screen.
- **Landscape ride-along.** The ride card covered "What is this?" and "Front view", so the street
  preview could not be opened.
- **The footer.** At 360 px its caption ran past the edge.
- **An engineering view took the page down.** Opening Evidence replaced the whole page with the
  framework's "This page couldn't load". The motion evidence read `replay[pick]` before its own
  check, and the FIXTURE evaluation has no replay. The real file renders, but one malformed file
  could take the passenger's page down with it.
- **A false label.** The Operations view said "NO LIVE COLLECTION CONFIGURED".
- **In the code, not reproduced:**
  - the tabs unmounted the passenger's view, and on return it was rebuilt from the journey read at
    page load, so a bus chosen since then was lost;
  - the round trip could not be run on that build, because Evidence crashed first with the fixture;
  - the service worker served `/data/shapes/*.json` and other non-hashed files from its cache
    forever, and iOS was given an SVG home-screen icon, which it does not use.

## After, on the new build

The same probe, on the same FIXTURE data:
- **Every step completed at all five sizes**, including the street preview in landscape.
- **A slow network.** The passenger's page appears at once; the recording no longer gates it.
- **Search with the keyboard up.** The first three matches are in view at 360 and 390 px.
- **After choosing a stop,** the answer is on the first screen.
- **A return visit** restores the stop and the bus.
- **Behind the data and back.** At every size the stop, the chosen bus (`active`), the ride-along
  (`following`) and the map canvas itself were the same afterwards.
- **Found and fixed on the way:**
  - The "your bus" strip, once above the map, was sticky and covered the ride's controls at the top
    of the map, in portrait and landscape. Below the two-column width it is now static, and hidden
    during a phone ride-along. The probe's audit now also checks what is drawn at the centre of each
    map control; its pairwise check had missed this.
  - The header link was 18 px tall; it is now a 44 px target.

**Camera switching** (`scripts/probes/camera-switch.mjs`, new) went outside, then street preview,
then outside, then street preview, at 8 s each, sampled every 100 ms, on a 390 × 844 phone:

| Run | Bus | Drawn bus at each switch | Report age across switches | Camera still while the bus moved |
|---|---|---|---|---|
| FIXTURE, old build | FX-MOVING | 1.5–1.7 m (about one sample's travel) | continuous (e.g. 9.2 → 9.4 s) | 0–1 of 30 samples in each phase |
| FIXTURE, new build | FX-MOVING | 0–1.5 m | continuous; once 15.9 → 6.2 s, when a new report arrived at that moment | 0–1 of 30 |
| **REAL**, new build, through the public link | route 15, MF74NPD, heading for Marston Road (nr) | 0.7–2.1 m | continuous (45.3 → 45.5 s, 30.5 → 30.7 s, 38.7 → 38.9 s) | 0 of 29–31 in the street preview (27.2 m of bus movement, 28.6 m of camera; then 22.8 m and 22.9 m) |

No restart of the estimate, no reset of the report age, no change of bus and no jump. The reported
"moves outside, freezes in the street preview" was not reproduced.

**The public link, REAL** (the public-preview probe, 390 px, service worker allowed):
- the page returned 200, and after a reload the service worker controlled it;
- `Permissions-Policy` allowed location;
- at Marston Road (nr) two route 15 buses were coming (2 and 15 stops before, 31–32 s old);
- MF74NPD stayed chosen through the publications of 17:20:28 and 17:21:08 BST, both through the
  service worker from the network;
- a pinch outside zoomed 20 → 20.87 and kept following, and a pinch in the street preview paused
  it;
- 71 tiles arrived with none failed, and there were no page errors.

**Research checks, 14 September.** Details are in section 11a of the redesign research and in
`docs/HOSTING.md`:
- the MapLibre React Native documentation;
- TfGM's open data page (the real-time portal is closed to new keys);
- the TfGM schedules dataset, and a HEAD request for its GTFS (41.8 MB, modified that day);
- Hetzner's June 2026 prices (CX23 €5.49 net plus €0.50 for IPv4);
- Healthchecks.io's free tier.

## Checks on the final build

    pnpm typecheck && pnpm lint && pnpm build        # pass
    pnpm test                                       # 137 passed (3 new service-worker cases)
    pnpm test:browser                               # 208 checks: 182 passed, 24 skipped by design,
                                                    # 2 failed (31.0 min, desktop and phone); both below
    pnpm test:browser tests/browser/navigation.spec.mjs   # then 18 passed, 2 skipped by design
    pnpm test:browser tests/browser/selection.spec.mjs    # then 23 passed, 1 skipped by design

The two failures in the full run:
- **`navigation.spec`, phone, "within reach": the test was wrong.**
  - It looked for "What is this?" as a button; it is a disclosure's summary.
  - Once corrected, the spec passed at both sizes. That run also included two checks added after
    the full run began: a saved route first on return, and a fetch within 3 s of reconnecting.
- **`selection.spec`, desktop, "a bus clicked where it is drawn": not caused by this milestone.**
  - The check waits for a second bus, FX-BRAVO, to be drawn on the canvas, and it was not. The first
    framing fits you, your stop and the bus shown, and FX-BRAVO sits one stop beyond that edge.
  - The previous build, 1bb5320, was built in a temporary worktree. It failed identically in the
    same hour, at a byte-identical framing (camera `15.458,53.4481881,-2.3136453`), although it had
    passed the same check at about 15:10.
  - What changed between those hours was not found.
  - The check now zooms out until the bus is drawn before clicking it, as it already dragged a bus
    clear of a covering control. The spec then passed at both sizes.

Python was not rerun, because no Python changed. No physical phone was used: installing, GPS, a
real screen lock, sunlight, battery and a screen reader remain unchecked.

---

# Beta readiness — 17 September 2026 (VS Code / WSL)

Everything below ran on this machine. **No physical phone was used at any point**, and the app was
served only from this laptop: through Caddy on 127.0.0.1:8098 for the probes, and through a
temporary Cloudflare Quick Tunnel for the public checks. Where a figure comes from a fixture, a
recording or the real feed, it says so.

## Tracing route 256, from source

Read directly out of the preserved TfGM BNML dataset (`data/live-capture/timetables/`, git-ignored)
with `pipeline.patterns.extract_patterns`:

| File | Operating days | Directions | Journeys |
|---|---|---|---|
| `…_20260719_20260829_2390029.xml` (expired 29 Aug) | Mon–Fri | inbound and outbound | 101 |
| `…_20260719_20260829_2390035.xml` (expired 29 Aug) | Mon–Fri | inbound and outbound | 101 |
| `…_20260830_20310719_2416002.xml` (in force) | Sat | inbound and outbound | 90 |
| `…_20260830_20310719_2416003.xml` (in force) | Sun | inbound and outbound | — |
| `…_20260830_20310719_2416004/6.xml` (in force) | Mon–Thu, school | outbound only | 1 each |
| `…_20260830_20310719_2416005.xml` (in force) | Fri, school | outbound only | 1 |

Rebuilt on Thursday 17 September: the four published 256 patterns run Sat–Sun, Sat, Fri–Sun and
Mon–Thu (outbound, school). **The registration in force has no Monday-to-Friday inbound service.**
The live publication the same afternoon refused every weekday inbound 256 with
`no_pattern_for_direction_today`. Conclusion: an upstream registration gap, not a build-day
artefact. Full trace in `docs/COVERAGE.md`.

## The catalogue rebuild, and a double count it exposed

- First rebuild (all snapshots read): 1,143 files parsed, 533 patterns, and **route 15 inbound
  published with 560 journeys**. Route 256 inbound: 150.
- Cause: the collector had stored a second BNML snapshot and a second BNSM snapshot that morning,
  so every service file was parsed twice and the journey counts summed.
- Second rebuild (newest snapshot of each dataset only): **575 files parsed, 524 patterns across
  157 services**, route 15 inbound back to **140 journeys**, route 256 inbound to **75**.
- `snapshotsSuperseded: 2`, `datasetsRead: [BNFM, BNML, BNSM]`, `filesExpiredBeforeDate: 538`,
  `filesBeyondHorizon: 0`.
- Checked afterwards: **all 9 road-shape pattern ids survive the rebuild**, and all 6 accepted
  shapes are still in the catalogue, because a pattern id is a hash of its stop sequence.
  Estimated movement was not silently broken.

## Coverage, on a real publication

Rendered from `live.json` and `patterns.json` in the browser, 17 September, ~15:55 BST:
**587 vehicles, 285 placed (48.6%), 109 of 159 services with a registration running that day, 2
services with an accepted road shape running that day (15 and 250).**
Refusals: `ambiguous_branch` 139, `no_pattern_for_route` 127, `loop_pattern` 3,
`no_pattern_for_direction_today` 2, `too_far_from_pattern` 2, `no_pattern_for_operator` 1.

Before the rebuild the same measure read 261 matched / 330 unmatched with
`no_pattern_for_route` 161, so widening the catalogue from 89 to 157 services moved 34 fewer buses
into "no timetable held".

## A map nobody can see, measured

The passenger's page stays mounted behind the engineering area. Frames drawn by the map, counted
from `data-frames` over 5-second windows against the real feed:

| | Before | After |
|---|---|---|
| Passenger's page in front | 17.2 a second | unchanged (frames only while something moves) |
| Behind the data, hidden | **27.6 a second** | **0.0 a second** |

It drew *more* while hidden, because the view over it is lighter. Script:
`hidden-work.mjs` in the session scratchpad; the fix is `paused` in `components/city-map.tsx`.

## Payload a phone actually downloads

Measured through the public link: `live.json` **807 KB raw, 119 KB gzipped** for 587 vehicles,
polled every 20 s (~21 MB an hour). `patterns.json` 2.0 MB raw, 149 KB gzipped, fetched once.
Both typefaces 70 KB, fetched once and cached by the service worker. Recorded as opportunity 25.

## Layout probe, five sizes, three builds

`node scripts/probes/passenger-layouts.mjs --base http://127.0.0.1:8098/` at 360, 390, 800×?,
844×390 and 1280 px. On the final pass (`beta-3`): **no problems at any size** — nothing covered,
nothing clipped, no sideways scroll, no touch target under 24 px — and the round trip behind the
data kept the stop, the chosen bus and the same map instance at every size.

On the way, the probe caught a real consequence of the immersive ride: with the map fixed to the
viewport, the header is deliberately out of reach, so the probe and `navigation.spec` now leave the
ride first on a phone and re-enter it afterwards, which checks resumption as well.

## Deployment configuration

`CADDY=~/.local/bin/caddy deploy/validate.sh` — every check passed, including the two added for the
vendored MapLibre modules (immutable) and the typefaces (`max-age=86400`, `font/woff2`).

## Checks

- `pnpm typecheck`, `pnpm lint` — pass.
- `pnpm test` — **137 Node tests**, 0 failures.
- `.venv/bin/python -m unittest discover -s tests` — **97 Python tests**, 0 failures
  (92 before, plus 4 for the catalogue's snapshot, horizon and shrink rules and 1 for the
  direction-not-today refusal).
- `pnpm build` — passes, and the built site carries the typefaces and no build-machine path.
- `pnpm test:browser` on the final build, one worker, SwiftShader: **188 passed, 24 skipped by
  design, 0 failed, 30.2 minutes.** The 24 skips are the checks that need something this run does
  not have: 6 real-feed (a BODS key and a running collector), 2 real-walking (a request to FOSSGIS),
  9 desktop-only map checks skipped on the phone project, and 7 size-specific checks
  (`map.spec` on mobile, `access`, `navigation`, `ride`, `selection`, `replay`).

  **The run before it found 7 failures, all mine, all in the ride-along.** They are worth recording
  rather than smoothing over:
  - two were defects I had introduced: the map's tools and the ride's notes shared a height on the
    immersive phone ride, so a note ran under the tools;
  - one was a framing margin my own type change used up: the camera reserved 40 px around a stop
    for its name where the check demands 60, so a fitted stop cleared the Ride along button by about
    four pixels and had been passing on luck. `NAME_ROOM` is now 60, which is the honest fix;
  - four were checks reaching controls a passenger no longer can. With the ride filling the phone's
    screen, the list and the refresh button behind it are deliberately out of reach. The checks now
    do what a passenger would: leave the ride to choose another bus from the list, and let
    publications arrive through the page's own poll, which is what someone riding along relies on.

## Through the public link, on the final build

`node scripts/probes/public-preview.mjs --base https://….trycloudflare.com --label beta-final`,
17 September 2026 17:14 BST, REAL data, in Chromium's phone emulation:
- the page returns 200; the service worker is activated and controlling it; the secure context and
  `Permissions-Policy: geolocation=(self)` let it ask for a location, and it obtained one;
- at **Marston Road (nr)**, route **15** bus **MX62GKV** was chosen and **kept through two further
  real publications** (16:14:11Z and 16:14:31Z), both fetched from the network through the service
  worker, **none from the device cache**;
- a pinch zoomed the outside ride-along from 20 to 20.9 and it went on following; in the street
  preview it zoomed 20.77 to 21.7 and paused following, and Return to bus resumed it;
- 71 tiles, 0 tile errors, 0 page errors; no layout problem at 360 or 390 px.
