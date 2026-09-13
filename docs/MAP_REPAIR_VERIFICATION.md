# Map lifecycle repair — 13 September 2026

Reviewed base: `59b6249fba044e96598b44d4fb61a4b6bad2024a` from
`Hammamelsh/lost-minutes`. This repair was prepared in a separate checkout. It has not
been pushed to the owner's repository or exercised in the owner's Windows browser.

## Confirmed failure mechanism

`app/page.tsx` updates `nowMs` every 5,000 ms. `FollowView` passed new inline
`onManualMove` and `onUnavailable` functions to `CityMap` on each render.
`CityMap` included those functions in the dependencies of its map-creation effect.
Every parent update therefore removed the current MapLibre instance and created another.

The old seven-second watchdog closed over `cancelled`. Effect cleanup set that to
true before the timeout expired. With five-second clock updates, a map that never
finished loading could be recreated indefinitely without selecting the fallback.
This is a reproducible React lifecycle defect, independent of whether a particular
browser also has WebGL or network problems.

## Repair

- Stable callbacks prevent ordinary clock updates from recreating the map.
- The startup watchdog now covers the dynamic import as well as map initialization.
  Cleanup clears its timer, and asynchronous startup failures select the fallback.
- The map is mounted even when there are no live vehicles or selected stop, so its
  geography can remain available while the user searches.
- Passenger unavailable copy no longer asserts that the frontend build lacks credentials.
- The footer no longer incorrectly denies that nearby-stop discovery exists.
- The vector toolbar resets inherited `bottom: 71px` to `auto`; otherwise its own
  `top: 11px` and the inherited bottom constraint stretch it down the map.

## Verification

A controlled probe rendered the actual `FollowView` and `CityMap` components with
React 19.2.6, a MapLibre test double and simulated timers. It ran four parent updates
five seconds apart. This verifies lifecycle behaviour, not map pixels or live data.

| Scenario | Before | After |
|---|---|---|
| Loaded map across four parent updates | 5 map instances, 4 removed | 1 instance, 0 removed |
| Map never finishes loading during those updates | 5 instances, no fallback | 1 instance, removed on fallback; fallback rendered |

The probe was kept outside the application source tree so its dependencies and
test globals do not enter the project build. It uses the deprecated
`react-test-renderer` only as a diagnostic tool; it is not a new production or
recommended long-term test dependency.

Existing Node tests: **51/51 passed**. Typecheck and lint passed. The final production
static build passed, including the lifecycle, copy and toolbar CSS changes. No production dependency or
lockfile change was required. Verification runtime: Node 24.19.0, pnpm 11.19.0;
the existing lockfile was accepted unchanged.

Browser installation could not finish because the Playwright Chromium download
timed out. Consequently, this checkout does **not** establish that the real vector
basemap, glyphs, buildings, geolocation or final mobile layout render correctly.
There were no BODS credentials or live capture in this review checkout. Its supplied
recording and published data fixtures were left unchanged.

## Required verification in the owner's working environment

Use the existing project instructions and installed package versions. Add a reusable
browser regression for this lifecycle failure rather than a source-text assertion.

1. Run the actual app and leave the map open through several five-second age updates.
   Check that its canvas/map instance remains stable and camera state is preserved.
2. Exercise a successfully rendered map, absent WebGL, and a request that never finishes
   or fails. The fallback must remain usable despite continuing age updates.
3. Test live, archive and unavailable states, with and without a selected stop. Confirm
   that stop search remains available and old credential/footer messages are absent.
4. Inspect real desktop and mobile screenshots with visible geographic detail and
   markers; controls and attribution alone do not establish that the map rendered.
5. If it still fails, inspect the actual browser's errors, vector-tile and glyph requests,
   worker startup and WebGL context. HTTP 200 for style metadata and sprites is not proof
   that those other stages succeeded.

Also review the location accuracy circle separately: its pixel radius is currently
computed when `here` changes, clamped to 8–180 pixels, and not recomputed on zoom.
That does not establish a faithful geographic accuracy footprint across zoom levels.
This patch does not change that calculation or claim it has been validated.

## Results in the owner's environment — 13 September 2026

The patch applied cleanly to the working tree at `59b6249`. The five required checks were
run with one reusable setup, `pnpm test:browser` (Playwright, the cached Linux Chromium,
SwiftShader WebGL; see `scripts/setup-browser.sh` and `playwright.config.mjs`), against the
built site, and the real feed against `pnpm dev:live`.

1. **Stable through age updates.** One canvas, the same canvas, still attached and `painted`
   after 22 s of five-second updates and two live refreshes; `data-camera` unchanged through
   three ticks after the passenger zoomed. On the pre-repair build the same check counts 18
   instances in 22 s.
2. **Rendered, absent WebGL, never-finishing, failing.** The basemap paints (178 colours,
   50.8 % off-background, tiles and glyphs fetched). The drawn fallback takes over at once
   without WebGL, after the watchdog when the style never answers, and when every tile fails
   after a good style, and stays usable through further ticks.
3. **Live, archive, unavailable, with and without a stop.** All three states, the stop
   search present in each, no credential wording, the old footer gone.
4. **Desktop and phone screenshots with geography and markers.** Named streets, water, green
   space, place labels; You, Your stop and the selected bus verified by pixel colour on both
   layouts; produced on every run under `test-results/`.
5. **The stage that failed.** Item 5 was the decisive one: MapLibre's worker started from the
   page URL because webpack had rewritten `import.meta.url` to a build-machine file path. The
   style and sprites returned 200 throughout. Fixed by serving MapLibre's modules unbundled
   (`scripts/vendor-maplibre.mjs`), with a regression check on the worker URL and a scan of
   `out/` for machine paths.

**Accuracy circle.** Replaced. `accuracyRing(lat, lon, metres)` in `lib/geo.ts` builds a
64-vertex geographic polygon of the reported radius; MapLibre draws it as ground geometry, so
it is the right size at every zoom and flat in the 3D view; the SVG fallback projects it
through its own projector on every render. There is no clamp: a device reporting 1,500 m is
drawn 1,500 m wide. Node test at 15, 250 and 1,500 m.

Owner-side Windows browser: not exercised in this session; the checks above ran in Linux
Chromium with software WebGL. Full measurements in `docs/LOCAL_VERIFICATION.md`.
