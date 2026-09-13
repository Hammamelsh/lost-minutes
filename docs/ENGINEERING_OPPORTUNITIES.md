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
