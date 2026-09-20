# Engineering friction and automation opportunities

A running log of friction met while building Lost Minutes. An entry here is an observation,
not a commitment to build anything. Implementation bugs belong in the code and the commit
that fixes them; this file is for work that keeps coming back.

Status values: `observed` (seen, not yet measured), `measured`, `mitigated`, `closed`.

---

## 1. Browser verification of the built app is rebuilt from scratch every session

**Problem and evidence.** Every milestone has needed "does the built app actually render and
behave", and each time a throwaway harness was written: iframe wrapper pages, a polling
`setInterval`, synthetic pointer events, and `--dump-dom` scraping. Concretely, this session
alone produced `_map.html`, `_mapdbg.html`, `_fb.html`, `_e2e.html`, `_final.html`, `_opts.html`
and `_ss.html` in `out/`, plus scratch scripts `shot.py`, `render.py` and `trace_render.py`.
Several attempts failed on harness bugs rather than product bugs: a click loop that returned
forever when its target was missing, a route-option matcher that never completed, and a
server whose request counter was shared across two browser invocations.

**Who hits it and the current workaround.** Whoever is verifying a UI change here. The
workaround is to write another bespoke page and parse the DOM out of `--dump-dom`.

**Recurrence and effort.** Recurred in four of four UI milestones. Effort per milestone:
unknown precisely; the artefact count above is the measured part.

**Right answer.** An existing tool, not a new product. Playwright covers exactly this
(real clicks, waiting on selectors, screenshots, offline emulation, geolocation mocking,
`prefers-reduced-motion`). It was not adopted earlier because its browser download failed on
this machine: the cached Chromium at `~/.cache/ms-playwright/chromium-1234` cannot start for
want of `libnspr4.so`, which needs a root package install.

**Existing tools.** Playwright, Puppeteer, Cypress. Not researched for this entry beyond
prior knowledge; no novelty is claimed.

**Smallest reusable capability.** One committed script that boots the built `out/`, drives a
named flow, and writes a screenshot plus a JSON summary of asserted selectors. A visual
interface would not help; the output is read in a terminal or a diff.

**Next cheap validation.** Install the missing system libraries and try Playwright against
the existing static server for one flow. If it works, delete the bespoke harness.

**Status:** mitigated, 13 September 2026. `scripts/setup-browser.sh` unpacks the three
missing libraries without root; `playwright.config.mjs` launches the cached Chromium with
SwiftShader, which gives a real WebGL2 context; `pnpm test:browser` runs `tests/browser/`
against the built `out/`, and `LM_BASE_URL` points the same suite at a running `pnpm dev:live`
for real-feed checks. The bespoke harness pages are gone.

---

## 2. The vector map did not render, and the first diagnosis blamed the wrong thing

**Problem and evidence.** The 12 September entry here said headless WebGL could not paint
MapLibre, on the strength of Windows headless probes. That was wrong, and the owner's own
screenshots in a normal browser showed the black map in live and replay modes. The confirmed
causes were two defects in the application, found on 13 September:

1. `FollowView` passed fresh inline `onManualMove` and `onUnavailable` callbacks to `CityMap`,
   whose creation effect depended on them, so the page's five-second clock destroyed and
   recreated the map on every tick and its cleanup cancelled the seven-second fallback timer
   first. Measured on the pre-repair build: 18 map instances created in 22 seconds.
2. webpack bundled MapLibre's ES module and rewrote `import.meta.url` to the build machine's
   `file:///home/...` path, so MapLibre's worker URL resolved to nothing, the worker was
   started from the page's own URL, and no vector tile ever loaded, in any browser. The same
   rewrite shipped a private path in the public JavaScript.

The Linux Playwright Chromium with SwiftShader paints the same map in about 1.7 seconds, so
"headless cannot render WebGL" was never true here.

**Who hits it and the current workaround.** Anyone changing the map. There is now no
workaround needed: `pnpm test:browser` asserts that the map is created once across clock
updates, that vector tiles, glyphs and visible geography were painted, that the worker starts
from the vendored module folder, and that the built site carries no build-machine paths.

**Recurrence and effort.** Two occurrences of "the map is black" with different causes, each
costing a session. The wrong diagnosis cost a further session and an incorrect entry here.

**Right answer.** Already taken: a regression test for each mechanism, and a rule for this
log — a rendering diagnosis needs a browser that is known to render (the "paints a real
basemap" check is that probe) before the environment can be blamed.

**Existing tools.** Playwright, SwiftShader. `scripts/vendor-maplibre.mjs` serves MapLibre's
three modules unbundled, which is the layout its worker discovery expects.

**Smallest reusable capability.** The two tests above, plus the build-output scan, which any
future dependency that spawns a worker or reads `import.meta.url` will also trip.

**Next cheap validation.** None outstanding.

**Status:** closed, 13 September 2026.

---

## 3. The published data contract is maintained twice, by hand, in two languages

**Problem and evidence.** Every published field exists once in Python (`pipeline/live.py`,
`pipeline/stops.py`, `pipeline/patterns.py`, `pipeline/operations.py`) and again as a zod
schema in TypeScript (`lib/live.ts`, `lib/stops.ts`, `lib/patterns.ts`, `lib/operations.ts`).
They drift, and the drift is only caught at runtime or by a test that happens to parse a real
file. Measured instances in this project: adding `snapshotId`, `match`, `matching`,
`unavailableDetail` and the renamed freshness measurements each required a matching hand edit,
and removing `observationStaleSeconds` required edits in four places across both languages.

**Who hits it and the current workaround.** Whoever adds a published field. The workaround is
to remember, and to rely on a contract test parsing the real published file.

**Recurrence and effort.** At least six times across three milestones. Effort each time is
small; the risk is that a mismatch ships silently because the frontend's zod `.optional()`
hides it.

**Right answer.** A small generator, not a new product: derive the TypeScript types (or the
zod schemas) from one declaration. Alternatively keep the hand-written schemas and add a
single test that asserts every key the publisher writes is known to the parser, which is
cheaper and catches the same class of drift.

**Existing tools.** quicktype, datamodel-code-generator, JSON Schema with codegen on both
sides. Not researched for this entry; no novelty claimed.

**Smallest reusable capability.** A test that loads each published JSON file and asserts the
parsed object retains every top-level and per-item key present in the file, so a field the
publisher adds and the parser silently strips fails the build.

**Next cheap validation.** Write that one test for `live.json` and see whether it would have
caught any of the six historical drifts.

**Status:** observed.

---

## 4. A scripted text replacement that finds nothing succeeds silently

**Problem and evidence.** The stale Follow footer ("No arrival times, nearby stops or waiting
times are shown…") survived a milestone that had removed it, because the edit was a Python
`str.replace` with no check that the old text was present. Found on 13 September 2026 when the
patch review listed the footer as still incorrect. The same mechanism produced a half-applied
CSS rename in this session: an expected three matches were four, the guarded script aborted
correctly, but the source file had already been changed by a separate edit, so a build ran
with an unstyled map until the mismatch was noticed.

**Who hits it and the current workaround.** Whoever edits by script rather than by hand. The
workaround, now habitual in this repository, is to count matches and abort unless the count
is exactly what was expected, then write.

**Recurrence and effort.** Two instances across two milestones; each cost a rebuild and a
review round.

**Right answer.** A small fix, already in use: assert the match count before writing. Not a
tool.

**Existing tools.** `sed -i` has the same failure mode; `git apply` and the editor's own
replace do not. No research; no novelty claimed.

**Smallest reusable capability.** The count-then-replace pattern used in this session's edits.

**Next cheap validation.** None; the pattern is in use.

**Status:** mitigated.

---

## 5. MapLibre refuses a whole style over one invalid property, and says so only to a listener

**Problem and evidence.** On 13 September 2026 the redesigned map style carried one data
expression in `symbol-placement` (water labels), which MapLibre does not allow. MapLibre
validated the style, emitted an `error` event naming `layers[26].layout.symbol-placement`, and
loaded nothing. Our error listener only escalates messages containing "style", so the page
waited for the seven-second watchdog and then showed the drawn fallback. The browser suite
reported it only as eleven timeouts of 45 seconds each; the cause was found by running
MapLibre's own validator (`@maplibre/maplibre-gl-style-spec`, `validateStyleMin`) in Node.

**Who hits it and the current workaround.** Anyone editing `lib/map-style.ts` or
`lib/map-overlay.ts`. The workaround was reading the spec by hand.

**Recurrence and effort.** One occurrence; one full browser-suite run (about 15 minutes) lost.

**Right answer.** A small fix, already taken: `tests/map-style.test.mjs` validates both themes
with the City buildings and every overlay layer, in the Node suite, in under a second.

**Existing tools.** MapLibre's style-spec package (validator, also a CLI `gl-style-validate`).
No novelty claimed.

**Smallest reusable capability.** The validation test itself; the same pattern applies to any
generated style.

**Next cheap validation.** None; the test is in place.

**Status:** mitigated.

---

## 6. Timetable coverage was narrowed invisibly, three times

**Problem and evidence.** Two defects, fixed in the 13 September commit, hid most of the
timetable data already on disk: `pipeline.patterns.build(limit_lines=14)` kept only the 14
most-observed lines, and the file-name pattern required a numeric suffix, so the 83 First
Manchester files (UUID suffixes) were never read. Measured on one live payload the same day:
112 observed operator-and-line pairs, 78 of them with a same-operator timetable file valid that
day covering 424 of 535 vehicles, while only 93 vehicles were matched. Route 15 read "no
timetable pattern is held" in the owner's screenshot while its file was in the dataset.

A third was found the same afternoon by reading the real Sunday output, not the tests.
Patterns were published, and matched against, only when 60% of their stops lay inside the
collected area. Sunday journeys that run a longer path fell below it (route 219's Sunday
pattern with 56 journeys to Ashton is 45% inside; route 203's Sunday patterns 45–54%), so
32 of 338 live buses at 13:58 BST were told "the timetable held for this service has no
journeys on this day", and a stop served only by them could read "nothing runs today". The
matcher now checks identity against every held pattern and publication needs one stop inside
the area; `PublicationRuleTests` in `tests/test_matching.py` fails on the old rule.

**Who hits it and the current workaround.** The owner reading the passenger view; anyone
judging coverage. There was no workaround: the narrowing did not appear in any output.

**Recurrence and effort.** Three independent narrowings in one module: a cap, a file-name
rule and an area threshold. None raised an error; each showed only when what was held was
compared with what was published.

**Right answer.** The defects are fixed in code. The reusable need is a coverage ledger: every
observed service with its outcome (patterns built, no timetable for this operator, file not
valid today, no journeys today), published and shown in Operations. `patterns.json` now carries
a `coverage` summary with the selection rule, the date, any cap, and the observed services
without a timetable; showing it in the Operations tab is the small next step.

**Existing tools.** None researched; this is specific to the pipeline's own tables.

**Smallest reusable capability.** A per-service coverage table joining observed services to
timetable files and match outcomes, rebuilt with each pattern build.

**Next cheap validation.** Render the published `coverage` block in Operations and check it
against one hand count.

**Status:** observed (defects fixed; the ledger is not built).

---

## 7. The feed's journey references do not identify timetabled journeys

**Problem and evidence.** Checked on 13 September 2026 for BNML routes 15 and 86: 0 of 10 live
`DatedVehicleJourneyRef` values matched either the timetable's `VehicleJourneyCode` or its
ticket-machine `JourneyCode`. A bus can therefore be placed on a pattern by position, but not
tied to one timetabled journey, which is what would settle branches exactly and give a
scheduled time at a stop. The operator does report `OriginAimedDepartureTime`, which with line,
direction and operating day may identify the journey.

**Who hits it and the current workaround.** The matcher, whenever branches compete. The
workaround is to keep the ambiguity and settle it only by the reported destination.

**Recurrence and effort.** Every publication.

**Right answer.** A small, testable matcher extension: candidate journeys whose departure time
equals the reported origin departure, on the same line, direction and day. Needs validation
before any scheduled time is shown.

**Existing tools.** None claimed.

**Smallest reusable capability.** A journey-identity check reported with its hit rate.

**Next cheap validation.** Measure the share of live vehicles for which exactly one timetabled
journey has that departure time.

**Status:** observed.

---

## 8. Controls drawn over the map collide, and only screenshots noticed

**Problem and evidence.** On 13 September the phone map's "Ride along" button covered the
legend although the phone rule that stacks them existed: it sat near the top of
`app/globals.css`, and the base rules for the same selectors further down won on source
order. The same screenshot review found the ride-along disclaimer under its Exit button on a
phone, the progress card over the 3D bus, a no-direction note touching the disclaimer when it
wrapped, and the Operations tab cut off at 390 px. `pnpm test:browser` passed throughout: it
checks that the map renders, survives updates and falls back, not that its overlays leave each
other readable.

**Who hits it and the current workaround.** Anyone changing the map's overlay CSS. The
workaround was to take desktop and phone screenshots after each change and inspect them by eye.

**Recurrence and effort.** The legend and button collision had been fixed once and came back;
five collisions surfaced in one review. Each costs a screenshot pass and a fix; how often
they would otherwise reach the owner is unknown.

**Right answer.** A small check, now in the suite: `collisions()` in
`tests/browser/journey.spec.mjs` measures every control, note and card drawn over the map and
fails on any intersection, in the flat and City views and the ride-along with and without a
bearing and with the model notice, at desktop and phone size. Not a product.

**Existing tools.** Not researched here. Screenshot comparison (Playwright's own
`toHaveScreenshot`) is the obvious candidate, but on a live vector basemap it would flag every
tile or label change as a difference.

**Smallest reusable capability.** A `noOverlap(page, selectors)` assertion any Playwright suite
with overlays can call per view and viewport.

**Next cheap validation.** Done: with the phone rules put back above the base rules, the check
fails on the phone with `.ride-launch × .map-legend-chips` and passes on desktop.

**Status:** mitigated (the check is in the suite and catches the original defect).

## 9. The warehouse cannot be read while the collector runs

**Problem and evidence.** DuckDB lets one process hold the database for writing, and while it
does no other process can open it, read-only included. The collector opens the warehouse when
a run starts and keeps it until the run ends (`pipeline/collect.py`). On 13 September every
warehouse step of the milestone (building road shapes, exporting reports for the motion
evaluation, the frozen-capture matching assessment, reading run records) waited for the
owner's bounded collection of 14:43–16:13 BST to finish, behind a script that polled for the
collector process to exit. `PROJECT_CONTEXT.md` already notes that a pattern build waits for a
running collector.

**Who hits it and the current workaround.** The owner and anyone working alongside a running
`pnpm dev:live`, which the owner often has open. The workaround is to do lock-free work first
and queue warehouse work behind the collector.

**Recurrence and effort.** Once per milestone so far that needed the warehouse during
collection; this time one wait of about 90 minutes. How often it blocks the owner is unknown.

**Right answer.** A small fix first: if a cycle needs the connection only briefly, open it per
cycle and release it between polls, retrying on a held lock; otherwise let analysis read a
per-run export. Not a product.

**Existing tools.** This is DuckDB's documented concurrency model (one read-write process, or
several read-only ones: <https://duckdb.org/docs/connect/concurrency>). Not researched further.

**Smallest reusable capability.** One `warehouse()` context manager used by every entry point,
which waits for the lock with a visible message and a timeout, and a collector that holds the
connection only while it writes a cycle.

**Next cheap validation.** From the cycle records, measure how long each cycle's write phase
takes against its 20 s interval.

**Status:** observed.

## 10. No operator road geometry, so estimated movement needs shapes built and checked

**Problem and evidence.** Moving a bus between reports needs the road it follows, and stop
coordinates alone do not establish it. The TfGM TransXChange files held here carry
`RouteLink` and `RouteSection` elements but no geometry: none of the 802 files in the BNML
dataset (`9ed671b2…`) or the 588 in BNSM (`d9c3f6a4…`) has a `Track` or `Mapping` element
(scanned on 13 September 2026). `pipeline/shapes.py` therefore asks the FOSSGIS Valhalla
service (bus costing) for a route through each pattern's stops, with NaPTAN bearings as
headings, and accepts a shape only when at least 30 matched reports lie within 35 m of it at
the 95th percentile. Of 9 shapes built for routes 15, 250 and 256, 6 were accepted (p95 11.3 to
28.4 m) and 3 rejected, each for having no matched reports.

**Who hits it and the current workaround.** Anyone extending estimated movement beyond those
three routes. The workaround is a per-line build and validation, run by hand.

**Recurrence and effort.** Once so far. Nine shapes took about a minute at the service's
request spacing; the 387 published patterns would take roughly 40 times that, plus enough
reports to validate each. How many would pass is unknown.

**Right answer.** An existing tool or integration, not a product. Candidates, none tried here:
pfaedle, which map-matches schedule data to OpenStreetMap to produce shapes
(<https://github.com/ad-freiburg/pfaedle>); matching the observed reports themselves with
Valhalla's `trace_route`; or operator geometry in other BODS datasets (not checked).

**Smallest reusable capability.** A shape for a stop sequence with its validation against
observed positions kept beside it. The `pattern_shape` table already has that form; batch
coverage and a self-hosted router for volume are what is missing.

**Next cheap validation.** Run pfaedle on a GTFS export of the same three lines (BODS offers
GTFS timetables; not checked for these) and compare its p95 offsets with the accepted shapes.

**Status:** mitigated for three lines.

## 11. An animation check that reads only the drawn clock cannot see that clock step

**Problem and evidence.** The first continuity check in `tests/browser/motion.spec.mjs` measured
the drawn bus against the page's presentation time. It failed on a software-rendering stall (a
13.9 m step when a frame arrived late). Once normalised by that time, it passed while two real
defects remained:
- the presentation clock could step at each publication, because its offset was re-measured
  from the one-second HTTP `Date` header;
- a large correction could glide at over 100 m/s.

The first was found by reading the code. The second showed up when the check failed with
11.3 m and 9.6 m excess steps. The fixes are a slewed clock (`tickClock` in `lib/motion.ts`), a
catch-up limit, and a diagnostic that records every frame's presentation time and the page's
own time. The check now measures against real time and asserts that the drawn clock stays
within 10% of it.

**Who hits it and the current workaround.** Anyone checking animation in a headless browser.
SwiftShader frames arrive irregularly, and a check on one clock cannot see the other clock
step. The workaround is the two-clock diagnostic above.

**Recurrence and effort.** Three rounds of the same check in one milestone, roughly an hour
each.

**Right answer.** A small helper, not a product.

**Existing tools.** Playwright's clock API (<https://playwright.dev/docs/clock>) controls `Date`
and timers in the page. Not tried here, and it would not reveal a clock that the application
itself steps.

**Smallest reusable capability.** `recordFrames(page, attribute, seconds)` returning each
frame's page time, presentation time and value, with `noJump(speed)` and
`clockContinuous(slew)` assertions.

**Next cheap validation.** Reuse it for the ride camera's heading, which is still sampled
every 150 ms without frame times.

**Status:** mitigated.

## 12. A camera that is re-centred every frame cancels everything else the camera does

**Problem and evidence.** MapLibre's `jumpTo` begins with `stop()`, which cancels any running
camera animation and resets the gesture handlers. The ride-along re-centred the camera on the
drawn bus with `jumpTo` on every animation frame, so while following: the animated zoom
buttons did nothing (a probe on 13 September: three "Zoom out" taps left the zoom at 20.00);
a wheel zoom was cut to a fraction of its distance; and a pinch would have been reset every
frame. Separately, the introduction chained each camera glide on the previous one's `moveend`,
so a drag that interrupted a glide started the next glide, whose `stop()` reset the drag
before MapLibre reported it: the passenger could not interrupt the introduction by dragging,
and the app never learned they had tried. Both were found by reproducing the reported
screenshots (`scratchpad` probes against the isolated MapLibre module, then the built page).
A third instance appeared the same evening, on the phone only: `setPadding` is itself a jump
(`setPadding(e,t){return this.jumpTo({padding:e},t),this}` in 6.7.0), and the `resize`
handler applied the ride's clear band at once. A phone's ride map finishes growing just after
the ride starts, so the introduction's first glide was cancelled after about 80 ms and a
second ride was left flat at zoom 13.6 while saying it was following. The handler now waits
for `moveend`. Any camera call made while something else animates the camera (padding
included) has to yield.

**Who hits it and the current workaround.** Anyone animating a camera per frame alongside user
gestures or their own transitions. The fix now in `components/city-map.tsx`: the frame loop
moves the camera only when `map.isMoving()` is false (a gesture, an animated zoom or a glide
of ours then runs to its end and the camera glides back); every transition carries a token so
an obsolete one cannot finish; user intent during a transition is read from the raw
`pointerdown`/`wheel` events before MapLibre decides what the gesture is; and one state
(`entering`, `following`, `exploring`, `returning`) is shared by the loop, the HUD and the card.

**Recurrence and effort.** Two milestones of the ride-along shipped with the first defect and
one with the second; about half a day to reproduce, isolate and repair. A fourth instance came on
14 September, in the front view. There the camera sets its height as well as its centre every
frame, so a passenger's zoom could not last. Pausing on MapLibre's `zoomstart` did not help:
`ride.spec` found the ride still following after a wheel, because no zoom was reported. Where
inside MapLibre the zoom was lost was not isolated. The fix pauses on the raw `wheel` and a
two-finger `touchstart`, the approach this entry already records for transitions. About an hour.
A fifth instance came the same afternoon, on a phone, found through the public preview with a
synthesized pinch. In the outside ride-along a pinch did nothing. Between the fingers landing and
MapLibre taking them as a pinch, the map counts as still, and the frame loop placed the camera in
that gap. No check had used touch. The fix leaves the camera alone while fingers are on the map. The
follow controller this entry proposes would have to own touch as well as the mouse.

**Right answer.** A small reusable piece, not a product: a "follow" controller for MapLibre
that owns the camera while following, yields to gestures and animations, and exposes the state.

**Existing tools.** MapLibre has no built-in follow mode. Not researched further.

**Smallest reusable capability.** `followCamera(map, target(), {settlePx, onState})`: per-frame
centring that never fights an in-progress move, with tokens for transitions.

**Next cheap validation.** The ride-along browser checks (`tests/browser/ride.spec.mjs`) cover
the zoom buttons, a drag during the introduction, a change of bus and a repeated entry.

**Status:** mitigated.

## 13. "The model is loaded" said nothing about whether the passenger could see the bus

**Problem and evidence.** The 3D bus is a fill-extrusion layer, which MapLibre depth-tests
against the buildings' extrusions: a bus behind a building is hidden, and at zoom 17 the 12 m
model was 17 px long. The flat marker was hidden the moment the model was drawable, so between
zoom 17 and about 19, or behind any building, the chosen bus was a sliver or nothing. Browser
checks passed throughout: they counted lime pixels anywhere in the map, or read `data-model`.
The screenshots the owner sent showed the result.

**Who hits it and the current workaround.** Anyone drawing a chosen object in 3D over a city.
The fix: symbols (which MapLibre draws over every building) carry identification at every
zoom, a ring on the ground and the route number above the model, and the flat marker is kept
below zoom 18. The check now projects the drawn bus to canvas pixels (`data-bus-screen`),
requires the point to be inside the map and clear of every control drawn over it, counts the
chosen bus's colour only around that point, and proves the measurement can fail on a bus
dragged off screen.

**Recurrence and effort.** Once, but the failing check design had been in place since the
map was introduced.

**Right answer.** A small helper in the suite, not a product.

**Existing tools.** Playwright's `toHaveScreenshot` would flag every tile change; no
occlusion-aware assertion is known to me. Not researched further.

**Smallest reusable capability.** `identifiable(page, projectedPoint, colour, {hud})`, with a
negative control in the same test.

**Next cheap validation.** Done in `tests/browser/ride.spec.mjs`.

**Status:** mitigated.

## 14. Embedded video cannot be checked from a blank page

**Problem and evidence.** The first probe of the YouTube embed (13 September) failed with the
player's error 153, "Video player configuration error", because the probe page was created
with `page.setContent` and had no origin to send as referrer. Served from a local origin with
the `origin` parameter set, the same embed played, and its message API reported state and
answered play and pause. The checks in `tests/browser/window-seat.spec.mjs` run against the
served build for that reason, and read playback from the player's own frame.

**Who hits it and the current workaround.** Anyone automating an embedded player. The
workaround is simply to serve the page.

**Recurrence and effort.** Once; an hour.

**Right answer.** A note, now in the spec and here. No tool.

**Status:** closed. The embedded film itself was removed later the same evening at the owner's
request (he wanted a view from the bus through the mapped streets, not a film), so the spec is
gone too; the lesson stands for any future embed.

## 15. A frame loop that died only under `next dev`

**Problem and evidence.** The owner's screenshot (13 September, `localhost:3000` under
`pnpm dev:live`) showed the ride-along gliding to an empty map, with no bus drawn. Every browser
check was green, because the suite runs the static build. React's development Strict Mode
unmounts and remounts each component once; the frame loop's cleanup cancelled its pending
animation frame but left the id in a ref, so `kick()` believed a frame was pending and never
asked for another. Under `next dev` the chosen bus was never drawn. Fixed in
`components/city-map.tsx` by clearing the ids in the cleanup, and checked on the running dev
server with the real feed.

**Who hits it and the current workaround.** Whoever reproduces an owner's report, which is made
on the dev server, while the automated checks only see `out/`. The workaround is to reproduce by
hand on `next dev`.

**Recurrence and effort.** Once; about an hour, most of it spent doubting green checks.

**Right answer.** A small addition to the existing suite, not a tool: a smoke project that runs
three checks (map painted, a bus drawn, ride-along following) against `pnpm dev` as well as the
build. Playwright's `webServer` can start either.

**Existing tools.** Playwright projects with their own `webServer`; Strict Mode's double
mounting is documented React behaviour.

**Smallest reusable capability.** A `dev-smoke` Playwright project, run before handing a UI
change to the owner.

**Next cheap validation.** Add the project and run it once against `pnpm dev`.

**Update, 14 September.** Run by hand instead: `LM_BASE_URL=http://localhost:3100 pnpm test:browser`
with the selection, journey-context, stop-activity and ride specs against a separate `next dev`.
The first run passed 56 of 60. The 4 failures were two stop-activity checks at both sizes, and both
faults were in the checks, not the page. One asserted that the whole card never contains "Appears
stopped", although the evidence's rule text names it. The other published a trail entry at the
same time as its report, which the page's schema refuses (a trail is earlier history), so the bus
was dropped. Neither had been run on the build since it was changed, so the dev server was where
they showed. Both checks were corrected, and the stop-activity and selection checks then passed
22 of 22 under `next dev`.

**Status:** mitigated (the dev-server run is a command, not yet a standing Playwright project).

## 16. Smoothness was judged by eye, and the first fix measured no better

**Problem and evidence.** The owner reported that the ride-along "twitches". A first repair
(an acceleration-limited catch-up for corrections, 13 September) passed every unit test, yet a
per-frame camera probe on a FIXTURE ride showed no improvement (40 of 474 windows of 200 ms over
3 m/s², before and after). Replaying the page's drawing frame by frame, offline, over real
captured journeys found the cause: the estimate's own speed changes instantly at each timetabled
stop (a 10 s pause), at the end of its horizon, and whenever a new report changes the speed
reading, and the drawing passed those straight through. On the 30 fresh journeys the committed
drawing stepped its speed by over 1 m/s within a tenth of a second 292 times an hour. The redesign
(the drawn bus has its own speed, follows the estimate's path averaged over the few seconds of it
already known, and waits rather than reversing within the estimate's measured error) brought that
to 0.1 an hour and reversing from 1,048 to 302 m an hour, at a stated cost: the drawn bus strays
further from the estimate (95th percentile 87 m against 53 m). The in-page replay then caught what
the offline replay could not: once a standing bus let the page stop drawing, the next frame
integrated the whole pause and the bus leapt 157 m, unlabelled. The work also showed that the
drawing's settings were stored inside the frozen estimator's settings, so tuning the drawing would
have changed the frozen record's hash; they are now separate (`DRAWING` in `lib/motion.ts`).

**Who hits it and the current workaround.** Anyone changing how estimated movement is drawn. The
workaround was watching recorded videos.

**Recurrence and effort.** Two rounds in one evening; building the measurements took longer than
either fix.

**Right answer.** Scripts in the repository, not a product. `scripts/evaluate-drawing.mjs` runs
the page's frame loop offline over the captured journeys and counts speed steps, hard changes,
reversing and stray, beside the estimate's own evaluation; the recorded replay in the browser
covers what only the page does (pausing and resuming its frames). For what the renderer adds, the
chosen bus's on-screen position in a recorded ride video moved 0.6 px per frame at the median.

**Existing tools.** Browser frame-timing tools (Chrome's performance panel, long-animation-frame
reports) measure dropped frames, not whether a data-driven object moves plausibly; not researched
further.

**Smallest reusable capability.** The script above: drawing variants in, a table out.

**Next cheap validation.** Run it on the first weekday captures, and give the in-page replay a
bus that stands long enough for the page to stop drawing.

**Status:** mitigated.

## 17. A browser context that gets no WebGL fails a check that has nothing to do with WebGL

**Problem and evidence.** In the run of 13–14 September on the final build (88 checks, 15.5 min),
three desktop checks failed at 45–46 s, before any riding: the map never reached
`data-map-state="painted"`. Each page snapshot shows the drawn SVG map that replaces the vector
map when WebGL or the basemap fails, and the trace of one shows all 23 tile requests answered.
The same three checks had passed that point on the build before. The map's own fallback behaved
correctly; the browser context simply had no working WebGL. The suite runs one check at a time
(`workers: 1`) in one browser, each check in a new context, so by the end of a long run that
browser has created many software-rendered (SwiftShader) WebGL contexts, and now and then a new
one fails; a long recording session had shown the same before (a fourth context losing WebGL).
Each occurrence costs a rerun, and a reader of the report cannot tell it from a real failure
without opening the snapshot.

**Who hits it and the current workaround.** Whoever runs `pnpm test:browser`. The workaround is
to read each failure's page snapshot for "Map of …" and rerun.

**Recurrence and effort.** Seen in two sessions; three of 88 checks in the worst run. About ten
minutes each time to confirm and rerun.

**Cause, found on 14 September: the network, not WebGL.** The map's 7 s startup watchdog was
cleared only by MapLibre's first `idle`, which waits for every tile in view, and the tiles come over
the real network from tiles.openfreemap.org. `scripts/probes/webgl-paint.mjs` loaded the built page
120 times in one Chromium, a fresh context each time as the suite does: every load painted (median
1.6 s, slowest 2.9 s) with no WebGL or GPU message. Holding back one tile for 9 s made each of 4
loads, desktop and phone, fall back at 7.5–7.8 s with `startup_timeout` although WebGL worked;
holding back every tile did the same. A slow tile, which a long run meets now and then and a
passenger on a weak phone signal meets more often, replaced a working map with the fallback for
the rest of the visit. The failures of 13–14 September left no record (entry 18), so they cannot
be shown to be this case; their evidence fits it: the fallback drawn, every tile request answered.

**Fix.** `components/city-map.tsx`: the 7 s watchdog now ends at the map's first frame (the module,
the map and its WebGL context); the tiles then have their own allowance, 12 s for the first to
arrive and up to 25 s for a late one before the map counts as painted. On the fixed build: one tile
9 s late, painted at 10.6–11.3 s (4 of 4); no tile for 30 s, the fallback with `tiles_failed` at
12.5–13.1 s; every tile 9 s late still falls back, at 12.6–13.1 s instead of 7.5–7.8 s; 60 ordinary
loads all painted (median 1.5 s, slowest 2.6 s), and 40 more tilted to the City view with its
buildings (median 1.5 s, slowest 2.9 s).

**Update, 14 September, late morning.** That fix was incomplete. A check that held every tile
back 6 s still ended in the fallback, and so did the probe with every tile 9 s late. The check's
network trace showed all six tile requests answered after 6.07 s. The cause:
- a vector tile counts as loaded only once its labels are laid out;
- the glyphs those labels need are asked for only after the tile arrives, from the same host;
- so on a slow network the first whole tile takes two slow round trips.

The allowance now waits 12 s for the tile service to answer at all (its TileJSON), restarted when
the camera comes to rest, and 40 s for a first whole tile once it has. On the final build:
- one tile 9 s late: painted at 10.6–11.6 s;
- every tile 9 s late: painted at 21.3–26.0 s, 4 of 4, where all had fallen back;
- every tile 60 s late after the TileJSON answered: the fallback at 40.8–41.3 s;
- `map.spec`'s three failure cases still fall back.

**Right answer.** A small fix in the product, done, and one in the suite: the shared
`waitForPaint(page)` in `tests/browser/fixtures.mjs` fails at once with the page's own reason
instead of waiting out 45 s, so a fallback is told from a slow map at a glance. No retries were
added; a retry would have hidden this.

**Existing tools.** Playwright's route handlers hold back tiles; no new tool is needed.

**Smallest reusable capability.** The probe's `--tile-delay` and `--slow-tiles`, and `waitForPaint`.

**Next cheap validation.** Watch the next full runs: any fallback now names which allowance ran out.

**Status:** mitigated (cause reproduced and fixed; whether full runs stop needing reruns is to be
seen over the next runs).

## 18. Measurement probes lived only in the session scratchpad, and were lost

**Problem and evidence.** The smoothness work of 13 September was measured with a per-frame
camera probe, a video centroid tracker and a front-view probe, all written in the session's
scratchpad. By the next session the scratchpad had been cleared: the fidelity comparison needed the
earlier drawing code again (regenerated with `git show ad0c1cd:lib/motion.ts`), and the playback
and WebGL probes had to be written afresh. The drawing evaluation survived only because it had been
moved into `scripts/evaluate-drawing.mjs`.

**Who hits it and the current workaround.** Whoever verifies a visual or motion change, and anyone
trying to regenerate a figure in `docs/LOCAL_VERIFICATION.md`. The workaround is to rewrite the probe.

**Recurrence and effort.** Twice in two days; roughly an hour each time.

**Right answer.** A small repository change, not a product: keep each probe that produced recorded
evidence under `scripts/probes/`, named in the verification notes beside its figures.

**Existing tools.** Playwright's own video and trace recording; nothing else is needed.

**Smallest reusable capability.** A playback probe: a scenario (publications and actions) in; frames,
the map's diagnostics and a contact sheet out.

**Next cheap validation.** Run the selection playback probe from a clean checkout.

**Update, 14 September.** The two probes this milestone's evidence rests on are now in the
repository, with no machine paths: `scripts/probes/webgl-paint.mjs` (repeated map loads, optionally
with held-back tiles) and `scripts/probes/selection-playback.mjs` (the selection scenario as frames,
diagnostics, video and a contact sheet). Both launch Chromium exactly as the suite does
(`tests/browser/browser-env.mjs`, now shared with `playwright.config.mjs`) and write to
`outputs/probes/`, which Git ignores. The earlier camera, video and front-view probes were not
rewritten.

**Status:** mitigated (two probes kept; the older ones are still lost).

## 19. No check varied the feed the way the real feed varies it

**Problem and evidence.** On 14 September the owner could not keep one bus followed. The page
showed whichever bus came first in lists ordered partly by report age, so Follow and Ride along
jumped between buses as their reports alternated. Every browser check until then served one fixed
publication or one moving bus: none had two buses taking turns to report last, a chosen bus dropping
out and coming back, or a vehicle starting another journey. `tests/browser/selection.spec.mjs` does
all four, and on d2e8702 it failed at the first publication: the card described FX-BRAVO while
FX-ALPHA was being followed, and the ride card read "to Manchester Piccadilly", BRAVO's destination.

**Who hits it and the current workaround.** Anyone changing selection, the lists or the camera.

**Recurrence and effort.** Once, but it reached the owner before any check.

**Right answer.** A small fixture capability, not a product. The phased feed in
`selection.spec.mjs` (the check sets a phase, then asks the page for it) belongs in
`tests/browser/fixtures.mjs` with its two-bus builder, so other checks can use it.

**Existing tools.** Playwright's route handlers are enough.

**Smallest reusable capability.** `phasedFeed(page, phases)`, returning `publish(phase)`.

**Next cheap validation.** Use it in a ride-along check where the ridden bus reports late.

**Update, 14 September.** The phased feed now also carries a theme change, a filter to another
service and a drag of the map, and `real-feed.spec.mjs` follows, then rides, a real bus through
five real publications, where buses take turns to report last without any arrangement. That real
run found a second case the fixtures had missed, because they had only one route: with no route
chosen, the route offered was re-taken from the latest report at every publication, so the list
and its suggestion jumped between routes. A check with two routes taking turns now covers it (it
failed on the build before the fix). The helper is still local to `selection.spec.mjs` and the
playback probe, which repeats it.

**Status:** mitigated (the checks exist; the helper is not yet shared).

## 20. What the map draws into its canvas cannot be clicked by the checks

**Problem and evidence.** The vector map draws buses into a WebGL canvas, so a browser check has no
element to click. Until 14 September the only check of choosing a bus on the map used the drawn SVG
fallback, whose markers are elements; it could not see MapLibre's hit-testing at all. When the map
began writing where it draws each bus (`data-bus-points`) and the checks tapped those spots:
- on the build without the fix, a bus 14 px from the chosen one could not be tapped on either size,
  because the chosen bus's layer handler, registered last, always won;
- the first phone checks also failed for reasons of their own: they read positions before the
  camera came to rest, and did not make sure no control covered the spot. A probe showed touch
  itself was fine (pointer, touch, mouse and click events, none cancelled).

**Who hits it and the current workaround.** Anyone checking an interaction on the map, or on any
canvas. The workaround before was to test the fallback instead and assume the same code path.

**Recurrence and effort.** Once, found by an outside review; about an hour to build the diagnostic
and the helpers, and another to tell the checks' faults from the product's.

**Right answer.** A fix in this repository, done: the diagnostic, written when the map settles, plus
`busPoint`, `settledMap`, `reachable` and `tapAt` in `tests/browser/selection.spec.mjs`. The general
need (a page publishing where it drew each interactive thing, so checks can target the drawing
itself) could be a small reusable helper for map applications; that is not claimed, and no product
is started on it.

**Existing tools.** Playwright has no locators for canvas content. Map libraries answer "what is
here" from inside the page (MapLibre's `queryRenderedFeatures`, `project`), which needs the map
exposed to the check. Pixel matching finds drawings but is brittle. Not researched further.

**Smallest reusable capability.** `canvasTarget(page, key)`: read the published position, wait for
the camera to rest, bring it clear of controls, and tap with the input the device uses.

**Next cheap validation.** Move the helpers into `tests/browser/fixtures.mjs` and use them for a tap
on another bus during a ride-along.

**Status:** mitigated (this repository's checks tap the drawn markers; the helper is not shared).

## 21. A test fixture drifted from the component it feeds, and the component took the page down

**Problem and evidence.**
- `FIXTURE_MOTION` in `tests/browser/fixtures.mjs` has none of the `replay`, `heldOut` or `data`
  fields that `components/motion-evidence.tsx` reads.
- The component read `evaluation.replay[pick]` before its own check for those fields. With the
  fixture served, the Evidence view threw, and Next replaced the whole page with "This page
  couldn't load", the passenger's view included (frames in
  `outputs/probes/passenger-layouts/before/*-engineering.png`, 14 September 2026).
- The published file has those fields, so no passenger saw it. `evidence-motion.spec` reads the
  real file, so no browser check had opened Evidence with the fixture served. A malformed or older
  published file would have done the same.

**Who hits it, and the current workaround.** Anyone changing a published file's shape, a
component's reading of it, or a fixture. Until a probe happened to combine the two, nothing caught
it. Fixed on 14 September in two ways: the component reads `replay` only after its check, and the
engineering views sit inside `SectionBoundary`.

**Recurrence and effort.** One instance observed, found in about 30 minutes with the frame. Whether
there are others is unknown: the fixtures for `live.json`, the patterns and the road shapes have not
been checked against their readers.

**Right answer.** A small reusable piece in this repository: one schema per published file (zod is
already a dependency). The page would parse each file with it, and a Node test would parse every
fixture, and the committed copy of each published file, with the same schema. The Python
pipeline's checks could later be generated from it (JSON Schema), but that is not needed yet.

**Existing tools.** zod, already used in `lib/journey-context.ts`. A contract shared with Python
through JSON Schema (`zod-to-json-schema`, then Python's `jsonschema`) was not researched further.

**Smallest reusable capability.** `lib/contracts/<file>.ts`, exporting one zod schema per published
file, and `tests/contracts.test.mjs`, parsing the fixtures and `public/data/*.json` with them. No
visual interface is needed.

**Next cheap validation.** Write the schema for `motion-evaluation.json` alone, run it over the
published file and `FIXTURE_MOTION`, and count the mismatches. Then decide whether the other files
merit the same.

**Status:** open. The crash is fixed; the contract check is not built.

## 22. A content-addressed snapshot store has no idea which snapshot is current

**Problem and evidence.**
- The collector re-downloads each TransXChange dataset while it runs and stores it under its
  content hash in `data/live-capture/timetables/` (`pipeline/collect.py`, `collect_timetables`).
  Nothing in that directory says which file supersedes which.
- `pipeline/patterns.py` read every `*.bin.gz` it found. On 17 September 2026, with a second BNML
  snapshot on disk from that morning, every service file was parsed twice and the journey counts
  summed: route 15 inbound was published with **280 journeys before the second snapshot arrived and
  560 after**, without a single new journey existing. Route 256 inbound went 75 → 150.
- The same reading would have kept alive a registration the operator had withdrawn, because the
  older snapshot still contains its file. That is the more dangerous half: it would have shown
  passengers a service that no longer runs, with the evidence rule apparently satisfied.
- Not caught by any test, because the fixtures used one snapshot per operator.

**Who hits it, and the current workaround.** Anyone running the pattern build after collection has
been running for a while — which is the normal case, and would have been the nightly case on the
server. Fixed on 17 September by `newest_snapshots()`: the dataset is identified by the operator
whose files dominate it, and only the newest file is read, chosen by modification time.

**Recurrence and effort.** One instance, found in about 20 minutes because the published journey
counts were being read by eye during an unrelated check. It would have recurred every day the
server ran, silently.

**Right answer.** A small fix here, done. The wider point is real though: **modification time is a
weak stand-in for "which came last"**. The warehouse already records each timetable's `source_url`
and retrieval time (`record_timetable`), so the build could ask the warehouse rather than the
filesystem, and a copied or restored file could not mislead it.

**Existing tools.** Nothing bought. This is the same shape as a content-addressed store with no
head pointer — Git's refs, DVC's `.dvc` files, LakeFS's branches all exist to solve it. None is
worth adding for five files.

**Smallest reusable capability.** `newest_snapshots()` reading `(source_url, retrieved_at)` from
the warehouse, with the filesystem as the fallback for a checkout with no warehouse.

**Next cheap validation.** Run the build with two snapshots of the same dataset whose mtimes are
in the wrong order, and check the published journey counts. `tests/test_timetable_catalogue.py`
covers the mtime path today; the warehouse path is not built.

**Status:** the double count is fixed and tested. The warehouse-backed version is open.

## 23. A published artefact can shrink to almost nothing and nobody is told

**Problem and evidence.**
- `pipeline.patterns build` wrote `public/data/patterns.json` with `atomic_json` whatever it
  produced. A timetable download that failed, returned a truncated zip, or matched no services
  would have published a catalogue with few or no patterns, atomically and successfully.
- The page believes it. With no pattern for a service, the passenger is told the timetable has
  nothing for their bus — which is exactly what a real withdrawal looks like. A failed download
  and a withdrawn service are indistinguishable from inside.
- Near miss on 17 September: the first rebuild of the day published 533 patterns; a build against
  a partial dataset would have been accepted just as readily.

**Who hits it, and the current workaround.** The nightly rebuild on the server, unattended, at
03:40. Fixed on 17 September: a build that would publish less than half of what is already
published is refused, exits non-zero, leaves the last good file in place and names the floor;
`--allow-shrink` is the deliberate override.

**Recurrence and effort.** No instance in production, because there is no production. The class is
common enough to have a name in data engineering — volume anomaly — and the fix took 30 minutes.

**Right answer.** This one generalises, and is the strongest candidate for a separate small tool:
**does what is being served match what the checks validated, and can a drop be explained?** The
same question applies to `live.json` (vehicle count), `stops.json`, the road shapes and the motion
evaluation, and to any other project publishing artefacts from a pipeline.

**Existing tools.** dbt's `source freshness` and generic tests, Elementary's anomaly monitors,
Great Expectations' volume expectations, Datafold's diffs. All assume a warehouse and a dbt-shaped
project; none of them watch a static JSON file that a web page fetches. Researched no further than
their documentation.

**Smallest reusable capability.** A `publish_guard(target, candidate, floors)` helper in this
repository, used by every publisher, that refuses a candidate whose headline counts fall outside a
recorded band and records the refusal as a run. One function, one table.

**Next cheap validation.** Apply the same guard to `live.json`'s vehicle count against a rolling
median of the last 24 hours of publications, and count how often it would have fired during a day
of real collection. If it never fires, the band is too wide; if it fires on a Sunday morning, it
is measuring the city, not the pipeline.

**Status:** done for the pattern catalogue, open for every other published file.

## 24. A check was adjusted to pass, and nothing recorded whether that was honest

**Problem and evidence.**
- `tests/browser/selection.spec.mjs` failed on 14 September because the bus it wanted to tap,
  FX-BRAVO, was not drawn on the canvas. The helper was changed to zoom out until the bus appeared.
- That was very probably right — the opening framing deliberately fits you, your stop and the bus
  being shown, and refuses to let a distant bus widen it — and it was checked against the previous
  build at a byte-identical camera, so it was not a regression.
- But the file recorded a *belief*, in a comment. Nothing distinguished "the bus is legitimately
  off-screen by design" from "the framing is a few pixels too tight and the test was taught to
  look away".

**Who hits it, and the current workaround.** Anyone repairing a failing browser check under time
pressure, which is everyone. On 17 September the helper was changed to measure instead: each
zoom-out step halves the scale, so the bus's distance from the centre after the steps gives its
position before them, and the test now asserts it was more than 24 px clear of the canvas and
annotates by how much.

**Recurrence and effort.** One instance recorded; the pattern is universal. Turning the comment
into a measurement took about 20 minutes.

**Right answer.** A habit rather than a tool: **when a check's setup is relaxed, the relaxation
becomes an assertion.** If the reason cannot be asserted, the check was weakened and should say so.

**Existing tools.** None needed. Playwright's `test.info().annotations` carries the measurement into
the report.

**Smallest reusable capability.** None beyond the habit. A lint rule that flags new `waitForTimeout`
or retry loops in specs would be a cruder version of the same idea.

**Next cheap validation.** Read the annotation the next time the suite runs on a changed camera: if
the margin collapses towards 24 px, the framing has drifted and the test will say so before a
passenger does.

**Status:** done for this check. No other relaxed check has been audited.

## 25. The live publication is one file, and a phone downloads all of it every twenty seconds

**Problem and evidence.**
- `public/data/live.json` on 17 September 2026 carried 587 vehicles at **807 KB raw, 119 KB
  gzipped**, measured through the public link. The page polls it every 20 seconds, so a passenger
  watching one bus for ten minutes downloads about **3.5 MB**, and about **21 MB an hour**.
- Per vehicle it is about 1,250 bytes, most of it the 64-character source hash and the match
  evidence — both of which exist so that any single bus can be traced, and both of which the page
  needs for exactly one bus at a time: the chosen one.
- The catalogue is a second cost, though a one-off: `patterns.json` is 2.0 MB, 149 KB gzipped,
  after the 17 September rebuild widened coverage from 89 to 157 services.

**Who hits it, and the current workaround.** Every phone on mobile data, which is the intended
audience. No workaround: the file is what it is, and the polling floor of 10 s exists because
operators publish every 10–30 s. Nothing is broken; it is simply more data than the job needs.

**Recurrence and effort.** Measured once, on one publication. It grows with coverage: the same file
was 66 KB for 155 vehicles in the earlier measurement recorded in `docs/HOSTING.md`, so it has
roughly doubled per vehicle as match evidence was added.

**Right answer.** A small change to the published contract, not a tool: **split the publication**.
A compact `live.json` with position, age, freshness and the pattern id — enough to draw every bus
and to say what is coming — and the full evidence for one vehicle fetched on demand when a
passenger opens "How we know this". The evidence rule is not weakened: every claim still has its
source, it is simply fetched when it is read.

**Existing tools.** None to buy. This is the ordinary list-and-detail split, and it is what the
Operations and Evidence views already do for the archive.

**Smallest reusable capability.** None beyond this repository. `pipeline/live.py` would publish
`live.json` and `live-evidence/<vehicle>.json`; `lib/live.ts` would parse the compact shape and
`components/bus-evidence.tsx` would fetch the detail.

**Next cheap validation.** Serialise one real publication with the evidence stripped and gzip it. If
the compact file is under about 30 KB, the split is worth doing before the beta is advertised
widely; if it is 90 KB, the evidence is not where the weight is and the measurement should say what
is.

**Status:** open, and stated in `docs/RELEASE.md` as a known cost rather than fixed on beta eve.

## 26. A copy of irreplaceable data that nothing could read back

**Problem and evidence.**
- `deploy/backup.sh` (17 September 2026) copies `data/live-capture/` from the server because the
  BODS feed has no history: a day of raw captures lost is lost.
- **Nothing could read them back.** `pipeline.run reprocess` reloads the *archive selection*, not
  live captures; the collector loads each response in the same pass that fetches it, and there was
  no other entry point. `docs/HOSTING.md` nevertheless said "the warehouse is rebuilt from the raw
  captures it was loaded from", which was untested and, in practice, false.
- The decision not to buy the provider's snapshots was taken partly on the strength of that script.

**Who hits it, and the current workaround.** Whoever loses the server. Fixed on 18 September:
`pipeline/restore.py` reads captures back, verified by restoring 60 copied files into an empty
warehouse — 25,232 observations, 1,396 vehicles, 0 corrupt, and a second run adding nothing.

**Recurrence and effort.** One instance; about ninety minutes including tests. The class is common:
a backup nobody has restored from is a hypothesis.

**Right answer.** Done here, and the general lesson is cheap to state: **a backup procedure is not
finished until a restore has been performed from its output.** The script and the reader belong in
the same change, and the restore belongs in the test suite, not in a runbook nobody executes.

**Existing tools.** Nothing to buy. Content-addressed stores make this easy — the filename is the
checksum, so integrity is provable rather than assumed, which is what the restore relies on.

**Smallest reusable capability.** The pattern rather than the code: name preserved payloads by the
hash of their bytes, and write the reader in the same commit as the writer.

**Next cheap validation.** Restore the *whole* capture store into a scratch warehouse and publish
from it, which is the step still missing: sixty captures into a scratch database proves the
mechanism, not the disaster. At the measured 0.76 s per capture the 3,821 held would take about
fifty minutes.

**Status:** the reader exists and is tested. A full-store restore, and a restore onto a rebuilt
server, are open.

## 27. A measurement taken over one minute, reported as a property

**Problem and evidence.**
- On 17 September this project recorded the collector's memory as "**~1.55 GB, steady** over
  repeated samples — it is not growing, so 24/7 operation is not a leak risk". The evidence was
  three `ps` readings sixty seconds apart.
- On 18 September, sampling every thirty seconds showed it rising: **1,148 → 1,237 → 1,334 → 1,402
  → 1,411 → 1,426 → 1,466 MB** across three minutes. The cause was not a leak — DuckDB's default
  memory limit is 80% of the machine's RAM, so it took what it was offered — but the reported
  property was wrong, and the number would have been used to size a server.
- The same session then bounded it and sampled for twenty minutes, where the median by fifths went
  1,441 → 1,533 → 1,587 → 1,563 → 1,563 MB: rising, then flat. **That is still not proof over
  hours**, and this time the write-up says so.

**Who hits it, and the current workaround.** Anyone sizing infrastructure from a spot check. The
habit that catches it is cheap: a sampler script and a wait.

**Recurrence and effort.** One instance recorded here, caught only because the owner challenged the
claim. The pattern — a snapshot reported as a steady state — is one of the commonest errors in
performance work.

**Right answer.** A habit, plus fifteen lines of shell: **never report a resource figure from fewer
samples than the thing's own time constant.** For a process with a cache, that means minutes at
least, and the write-up should carry the sample count and the window, not just the number.

**Existing tools.** `/usr/bin/time -v` for a peak (it gave the nightly rebuild's 853 MB in one
line), `ps` in a loop for a trajectory. Nothing else is needed at this size.

**Smallest reusable capability.** A `scripts/sample.sh <pid-pattern> <out.csv>` kept in the
repository rather than the scratchpad, so the next measurement starts from a trajectory.

**Next cheap validation.** The 48-hour observation, which is the only thing that can answer the
question the twenty minutes left open.

**Status:** the claim is withdrawn and corrected. The sampler is still a scratchpad script; the
hours-long answer is open.

## 28. A deployment validated on the machine that is not the server

**Problem and evidence.** `deploy/validate.sh` runs the systemd units through `systemd-analyze verify`
and the Caddyfile through a local Caddy, on the development machine. It has never run `install.sh`
on a server. The first real deployment (20 September 2026) then exposed six faults in one afternoon,
none of which that validation could see: `rsync-exclude.txt` excluded `public/data` through an
unanchored `data/`; the upload was 1.75 GB; no `deploy` user existed; a fresh warehouse had no stop
table or patterns, so 0 of 307 buses matched; a clean SIGTERM exit returned 130 and put the unit into
`failed`; and a re-run of the installer aborted on a locked warehouse. Each was found by running the
thing and reading what it did (`git log 9be1a90..d3ce8ba`).

**Who hits it, and the current workaround.** Anyone deploying for the first time, or after changing
`install.sh`, `publish.sh` or the units. The workaround was the one used: deploy, watch it fail,
fix, deploy again, on the live server, six times.

**Recurrence and effort.** Six instances in one deployment. About three hours, most of it
diagnosis rather than repair; each repair was a few lines.

**Right answer.** A script. Run `install.sh` end to end against a throwaway Ubuntu container or VM
with a fixture key, and assert the outcomes that were wrong: the catalogue files present, the upload
under 50 MB, the deploy user able to write, `patterns_unavailable` absent from the first
publication, the unit `inactive` after `systemctl stop`, and a second `install.sh` a no-op.

**Existing tools.** Docker or Podman for the container; the repository already has a CI workflow
(`.github/workflows/checks.yml`) that could carry it. Nothing here is novel.

**Smallest reusable capability.** `deploy/smoke.sh`: build, `publish.sh` into a container, `install.sh`
twice, the six assertions. No visual interface needed; a pass/fail line is the product.

**Next cheap validation.** Write it and run it once locally against Ubuntu 26.04, which is what the
server runs. **Status:** not started; the six faults are fixed individually and each has a check of its
own, but nothing runs the whole sequence.

## 29. Two lists that must agree, and nothing that checks they do

**Problem and evidence.** `.gitignore` and `deploy/rsync-exclude.txt` both say what does not belong,
one to Git and one to the server, and they had drifted: the package cache, the probes' output and the
build info were ignored by Git and shipped by rsync. Separately, the exclude list's `data/` had no
leading slash and so also matched `public/data/`, the published catalogue. Both were found only by
listing the transfer with `--out-format`; two earlier checks with a silent `rsync -an` had "proved"
nothing was wrong because they printed nothing at all (`git log 9be1a90`).

The same shape, elsewhere: `tests/patterns.test.mjs` ended in a literal backslash-n, failed at module
load, and took twelve tests down with it; the aggregate reported one failing *file* and the count of
passing tests quietly fell from 137 to 136. A test that fails before it starts hides every test in it.

**Who hits it, and the current workaround.** Whoever adds a large local directory, or edits either
list, or appends to a test file by script. The workaround is knowing to list the transfer, and to
notice a falling test count.

**Recurrence and effort.** Three instances in one day. Minutes each once seen; the cost is the not
seeing.

**Right answer.** Two small tests. One runs the exact dry-run the deploy uses and asserts the required
files are in the list and the forbidden ones are not (the command is in the commit). The other asserts
each test file parses and exports at least one test, so a module-load failure is named rather than
absorbed.

**Existing tools.** `rsync --out-format='%n'` for the listing; `node --check` for the parse.

**Smallest reusable capability.** `tests/deploy-manifest.test.mjs`, twenty lines, in the Node suite.

**Next cheap validation.** Write the manifest test. **Status:** the exclusions are fixed and were
checked by hand; the test that would keep them fixed is not written.

## 30. A running one-shot service reads as "activating", and a guard that asked "is-active" was silent for weeks

**Problem and evidence.** The watchdog's guard against restarting the collector during the nightly
rebuild was `if systemctl is-active --quiet lost-minutes-refresh.service`. A `Type=oneshot` service
is `activating` for the whole of its `ExecStart` and `is-active --quiet` exits 3 for that, so the
condition was false every time. Reproduced on the server: the watchdog restarted the collector
mid-rebuild, the collector could not take the warehouse lock, and `Restart=always` retried it every
15 s: four restarts in three minutes, and it would have run at 03:40 every night (`git log 240137c`).

**Who hits it, and the current workaround.** Anyone guarding one unit on another oneshot's state.
There was no workaround; nobody knew.

**Recurrence and effort.** One instance, latent since 17 September. Fixed in ten lines once measured.

**Right answer.** A small fix, done: read the state string and accept `activating`, `deactivating`
and `reloading` as running. Reusable as an idiom in `deploy/README.md`, which now says so.

**Existing tools.** `systemctl show -p ActiveState --value` gives the string directly.

**Smallest reusable capability.** None beyond the idiom; it is a fact about systemd worth writing down
where the next unit is written.

**Next cheap validation.** The first unattended 03:40 rebuild: the journal must show no collector
restart during it. **Status:** fixed and re-tested against a hand-started rebuild twice; the
unattended run is still to come.

## 31. A passenger-facing number that no evaluation had ever scored

**Problem and evidence.** "Timetabled at your stop 07:11" went live on 20 September as the feed's
origin departure plus the timetable's link run times. It was reasoned, tested at the unit and
browser level, and deployed. The first held-out evaluation of anything against inferred stop
passages (`scripts/evaluate-arrival.py`) found it **a constant +15 to +17 minutes early for every
inbound route-15 journey** on every day held, while outbound was within two minutes. The cause is
upstream and invisible to the page: the inbound journey key first appears in the feed a median
14.5 min after its registered departure, and the registration holds no `WaitTime` at all
(`git log 02419ee`). Nothing in the unit or browser tests could have caught it, because they
check the arithmetic, not the premise that the feed's clock and the timetable's clock start at
the same place.

**Who hits it, and the current workaround.** Any time a published figure is derived from two
sources whose alignment is assumed. The workaround now is the schedule anchor: a per-pattern
check of that alignment against the service's own reports, published with the site, gating the
line exactly as `motion-evaluation.json` gates estimates. Patterns not checked are withheld.

**Recurrence and effort.** One instance, found the same day, on the passenger's own direction.
About two hours from first suspicious number to withdrawal on the live site.

**Right answer.** A rule, plus the script that already exists: **no figure that depends on
aligning two sources is shown until that alignment has been measured on held data for that
service**, and the measurement is republished nightly. The nightly `lost-minutes-arrival-eval`
unit does the measuring; what is missing is that the anchor file is still built locally and
shipped, rather than produced on the server from the server's own reports and read from there.

**Existing tools.** None needed beyond `scripts/schedule-anchor.py` and the systemd timer.

**Smallest reusable capability.** Move the anchor's production onto the server (it is one more
`ExecStart` line) and have the page read the server's file. Then a service whose alignment
drifts is withdrawn the next morning without anyone noticing it first.

**Next cheap validation.** After the first unattended nightly run, diff the server-built anchor
against the local one for route 15. **Status:** the gate is live and the local anchor is shipped;
the server-built anchor is written to `data/evaluation/` but not yet the one the page reads.

## 32. An estimator whose baseline beats it past five minutes, and criteria that were written first

**Problem and evidence.** The progress baseline (remaining road at observed speed) scored median
0.59 min at 1–2 min ahead and 4.96 min at 10–20; the delay-adjusted timetable scored 0.96 and
2.51 on the same moments. Criteria fixed before the run (`docs/ARRIVAL_RELEASE_CRITERIA.md`) failed
on median and p80 at 2–10 min, so nothing shipped. The better method covers under half of moments
because it needs a named journey and a passage already behind the bus.

**Who hits it, and the current workaround.** The next person to build the estimator. The
workaround is the record: the evaluation JSON, the scripts, and the nightly re-scoring.

**Recurrence and effort.** First evaluation. The scripts run in about four minutes locally.

**Right answer.** Implement the delay-adjusted timetable as the candidate, corrected by observed
progress inside the last two minutes where the progress method wins, and re-run against the same
criteria on the nightly-accumulated weekday passages. Do not lower the criteria.

**Existing tools.** The evaluator and the passage audit. **Smallest reusable capability.** The
evaluator already takes a method as a function; adding one is twenty lines.

**Next cheap validation.** A week of unattended nightly runs, then the blended method scored on
those days. **Status:** evaluated, not released, running nightly.

## 33. Six builds to find that a listener was on the wrong element

**Problem and evidence.** The street preview's head-turn drag did nothing. Each hypothesis
(a pause on held pointers; the listener's phase; a `pointercancel`; the gate's values) cost a
build and a browser run of about four minutes, and each was refuted by the next run's evidence.
The question that would have settled it first — *is the element this listener is on the element
in the page now?* — was only asked on the sixth build.

**Who hits it, and the current workaround.** Anyone attaching DOM listeners to a library's
internal elements from a React effect. The workaround was a spec-only probe that dispatched a
synthetic event, which needs no build and settled "attachment versus delivery" in one minute.

**Recurrence and effort.** One instance; about half an hour of builds that a first probe would
have saved.

**Right answer.** A habit and one helper: before theorising about why a listener does not fire,
dispatch a synthetic event at the target from a spec and read a counter. `data-look` now carries
its counters and its element identity permanently, so the next such question costs one run.

**Existing tools.** Playwright `page.evaluate` with `dispatchEvent`. **Smallest reusable
capability.** A `tests/browser/probe-listener.mjs` helper. **Next cheap validation.** None
needed; recorded so the habit sticks. **Status:** resolved. The listener was attached and firing on
every build; the frame loop re-arms only while there is more to draw, and a held head-turn on a
standing bus drew nothing new, so no frame ever wrote the attribute the test read. The handlers now
wake the loop. The decisive probe was CDP's `DOMDebugger.getEventListeners`, which showed the
listeners in place and forced the question onto what happens *after* they run.

