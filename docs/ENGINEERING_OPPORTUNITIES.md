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

**Status:** observed.

---

## 2. Headless WebGL cannot render the vector map, so the main visual change is unverifiable here

**Problem and evidence.** MapLibre never completes a first paint in this headless Chrome.
Measured: a plain CDN MapLibre page reached `constructed`, `styledata` and `sourcedata` but
never `load` or `idle`, under `--headless=new`, `--use-gl=angle --use-angle=swiftshader`,
`--use-gl=swiftshader` and `--enable-unsafe-swiftshader`. The style, TileJSON and sprite
requests all returned 200, so it is not a network or integration fault. The consequence is
that the headline visual deliverable of this milestone could only be verified indirectly.

**Who hits it and the current workaround.** Anyone verifying map work without a desktop
browser. The workaround is to verify the non-WebGL fallback, check the resource requests, and
ask the repository owner to confirm the rendered map by eye.

**Recurrence and effort.** First occurrence, but it will recur on every future map change.

**Right answer.** An integration: a browser with working GPU or software GL in the
verification path. Either a system WebGL stack that swiftshader can drive, or running the
check on the Windows side where a real GPU exists.

**Existing tools.** Playwright's bundled Chromium, `@playwright/test` screenshot comparison,
or a container image with mesa/llvmpipe. Not researched; no novelty claimed.

**Smallest reusable capability.** A single "can this environment render WebGL" probe that the
verification script runs first, so a map check either runs properly or is reported as skipped
rather than silently producing a black rectangle.

**Next cheap validation.** Try `--use-gl=egl` with mesa installed, or run the same probe page
through the Windows browser with a real GPU and compare.

**Status:** measured.

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
