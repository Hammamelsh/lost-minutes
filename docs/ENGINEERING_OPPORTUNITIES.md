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
