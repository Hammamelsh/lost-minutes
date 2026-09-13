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
