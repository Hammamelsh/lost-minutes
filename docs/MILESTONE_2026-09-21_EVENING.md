# 21 September 2026, evening: the ride said before it is entered, four live defects, and the roads never built

Status words as in `PROJECT_CONTEXT.md`: **Implemented** exists in the code, **Verified** has an
executed check behind it, **Planned** does not exist, **Unknown** has not been established. Every
browser figure here is Chromium with software WebGL on this laptop, desktop (1280 × 900) and phone
emulation (390 × 844); no physical phone. "REAL" means real publications from the server, through
a local proxy or the served site; "FIXTURE" means the recorded route-256 road and synthetic buses.

## 1. Root causes found this milestone, each traced before anything was changed

1. **The route-15 snap (187 m).** Reproduced from the raw captures on the served track: BU25YWF
   reported the same position at 13:36:10 and 13:36:29 (standing); motion-3, reading speed over
   75 s with `standingHold: 0`, carried the drawn bus 81 and 103 m past it, snapped back 179 m when
   it read "standing", and forward 177 m when the bus moved off. Not matching, identity or
   geometry. The candidate fix is the model's own `standingHold` parameter; its criteria were fixed
   in `docs/MOTION_MODEL.md` (82a3605) before any result was read, and the result is in §6.
2. **Two shape-build batches failed on 20 September and were never re-run** (`exception:TypeError`
   after 24 patterns each), so 36 named lines had no road at all — 192, 50, 52, 41, 43, 53, 86,
   203 among them — while the index looked complete and the claim "every line with a timetable
   and reports" stood for a day. Found by joining `pipeline_run` notes against `pattern_shape`
   rows. On the served publication of 17:13 UTC (623 vehicles) that was **337 vehicles (54%)**:
   171 placed with no road built, 132 on an unsettled branch with no candidate road.
3. **The deploy overwrote the server's nightly catalogue.** The 02:45 refresh wrote a catalogue
   from the server's own first day (400 patterns, 94 services); the 16:15 deploy put this
   machine's 18 September copy (576, 175) over it. `/srv/lost-minutes/previous` holds the
   overwritten file. rsync preserved the old mtime, so nothing looked wrong.
4. **The served Operations view showed no record at all**, since the first deploy: `parseOperations`
   refused any record with a live run — a guard from the archive-only release — and the local
   file, from an archive-only status run, passed every check. Behind it, two reconciliation rows
   about the archive replay read UNBALANCED on the server because it never ran the archive import
   (its `replay.json` arrived with the deploy).
5. **A bus on an unsettled branch read "no bus on them has a current report"** at a stop only some
   of its candidates call at; and **two reports in one publication were drawn at double speed**
   (the travel between reports was timed from the newest two, not from the report the bus was
   drawn at).

## 2. What changed, by the brief's sections

**§1 Before entry.** One line beside Ride along from the ride's own facts, three things told
apart: `Estimated movement`, or `Reported positions · may pause`, or `Last report is old · may
pause`, with ` · Front view` only where the street preview is there; the button's accessible name
carries the same words. After entry the ride card keeps one mode label with the report age
("Estimated position · last report 27 s ago"; "Moving between its reports · latest 31 s ago"; "Last
reported position · 40 s ago"). The front view's refusal is on the button's face ("Front view · not
on this route"), pressing it explains once, nothing exits. A correction over 150 m is drawn as a
dashed trace from where the bus was to its report for six seconds and the card says "Moved N m to
its latest report", then both go. *Verified:* `ride-offer.spec` (10 checks, FIXTURE), frames on
REAL data at both widths (`outputs/probes/milestone/offer`, `ride`).

**§2 Newcomer.** "Explore a bus with the front view" on the home screen, under the stop search:
up to three buses from the latest publication with a recent report on an accepted road, each
saying which kind of movement its ride is, freshest first and estimated first; choosing one pins it
and leaves the stop unchosen; nothing qualifying is said with the count; absent without a live
feed. No showcase, no fixture, no substitution. *Verified:* `explore.spec` (4 checks), REAL frames
at both widths listing 15 and 250 that minute, the choice pinned and the ride estimated.

**§3 Movement.** Root cause of the snap in §1; the snap acknowledged as above; the travel between
reports retimed from the report the bus was drawn at. Re-measured over 27 recorded journeys at
60 fps (`scripts/evaluate-glide.mjs`): moving in 63% of frames, steps over a bus length 0.3 an
hour (was 2.2), p99.9 step 0.67 m, behind the newest report in 66% of frames by a median 55 m,
never ahead. The observed bus keeps its *reported* bearing; the line between two reports is never
claimed as road; the label's age is the newest report's and says "latest" while the bus is drawn
between reports.

**§4 Coverage.** The 33 unbuilt lines built under the unchanged rule: 198 patterns routed, 70
accepted on 29 lines. The index: 560 patterns on 171 lines, 184 accepted on 106. On the same served
publication, front view eligibility 97 (16%) → **191 (31%)**; "placed, no road built" 171 → 18;
estimated movement 14 (2%) unchanged by its second gate. Every refusal is now counted by cause
(`scripts/coverage-breakdown.mjs`): build not attempted, routing failed, rejected for too few
matched reports, rejected for reports too far from the road, catalogue/index mismatch, no timetable,
unsettled with all/some/no candidate roads, too far, not running, not evaluated; and the catalogue
and the index are compared by pattern id (0 accepted entries name a pattern the catalogue lacks).
`docs/COVERAGE.md` §4 and §6 carry the reconciliation and the ownership rule. Route 263 and the
standing-hold candidate: §6.

**§5 Selection.** Two buses under one finger, neither nearer by 8 px: a chooser at the tap (route,
destination, age), first choice focused, Enter/Escape/Neither, pointer and touch, flat and tilted;
a tap on one bus still takes it; a tap on empty map chooses nothing. Historical report dots stay
hollow half-size rings. Empty states browser-checked: no current report on a timetabled service,
a bus already past the stop, a bus on the other side of the road, an unsettled branch only,
unavailable feed, offline, no service today — none reads "no buses running". *Verified:*
`chooser.spec` (4), `empty-states.spec` (12), `selection.spec` (46) on the final build.

**§6 Visual.** Frames by day and night, outside and front, desktop and phone
(`outputs/probes/milestone/ride`): the model with its route number, ring and ESTIMATE caption;
night buildings in grey against the ochre road; street names upright. Sparse scenery at Trafford
Boulevard is OSM's sparseness (few buildings carry a height there), stated, not invented. The
Operations view's reconciliation rows say "not checked here" with the reason where the premise
is absent, instead of UNBALANCED.

**§7 First use.** The home page's first screen, read as text on REAL data: "Follow your bus. The
last position each bus reported, and how long ago it reported it." / LIVE · updated 21 s ago /
Buses near me / search / Explore a bus with the front view / Or follow a route. A newcomer's
questions — what is this, is it live, what can I do without a stop, what will the ride be — each
have one answer on that screen or on the button that offers the action.

## 3. Operations and deployment

- Catalogue ownership: `public/data/patterns.json` is the server's; excluded from deploys, sent
  only to a server with none.
- The pipeline record is read with live runs; inapplicable identities are marked, not failed.
- Evaluation, publication, collection, nightly rebuild and rollback paths untouched except as
  stated; the nightly refresh regenerates `operations.json` with the new marking.

## 4. Verification

- **Focused checks while building**, each on a build with the change: `ride-offer.spec` 10,
  `empty-states.spec` 12, `chooser.spec` 4, `explore.spec` 8, `selection.spec` 46, `motion.spec`,
  `ride-quality.spec`, `head-turn-moving.spec` (54 in one run with the chooser and offer specs),
  `navigation.spec` for the Operations view. Three checks failed on the way, all in my
  expectations, not the page: the aside "does not mean no bus is running" matched my own
  "no buses running" pattern; "2 more near your stop" where I had counted 1; and a wording the
  page had better than I wrote it ("In the timetable's stop order its last report is already past
  Stretford Mall (Stop A)"). Two chooser failures were the check's: the chosen bus is listed in
  `data-bus-screen`, not `data-bus-points`, and a second tap inside MapLibre's double-tap window is
  a zoom. Each was restated from the product, none loosened.
- **The whole browser suite, in one run, on the deployed commit dbdf2e3: 264 passed, 24 skipped
  by design, none failing** (39 minutes, Chromium with SwiftShader, desktop and phone emulation).
  194 Node tests, 131 Python tests, typecheck and lint on the same commit.
- **Re-measured drawing** (`scripts/evaluate-glide.mjs`, 27 recorded journeys, 2,107 reports,
  60 fps): moving in 63% of frames; steps over a bus length 0.3 an hour; p99.9 step 0.67 m;
  behind the newest report in 66% of frames by a median 55 m, largest lag 393 m at the instant a
  distant report lands.

## 4a. Deployment and what is served

- `deploy/publish.sh lost-minutes`: RELEASE `commit=dbdf2e3`, the previous release kept for
  `deploy/rollback.sh`; the served page chunk (`page-c035b01c0d91ad8f.js`) is the local build's.
- Served: the 560-pattern shape index (184 accepted), 561 shape files, a shape built that afternoon
  fetched (200); the live publication (450 vehicles at 18:30 UTC); the Operations view rendering
  five cards where the previous release showed "No pipeline record is published".
- **The normal update path**: a persistent Chromium profile primed on the old release with its
  service worker in control was reopened after the deploy — the first load already ran the new
  page chunk and showed the explore section, and a reload agreed; the page reads the 560-entry
  index. The page is network-first in `sw.js`; only `/_next/static/` is immutable.
- **The nightly refresh, run once by hand after the deploy** (collector paused 3 min 57 s, active
  again after): the server's own catalogue now served — 590 patterns, 184 services, from what the
  server itself has observed since 20 September — and `operations.json` regenerated by the new
  code. Against that catalogue, 0 accepted shape entries name a pattern it lacks; 30 of its
  patterns (variants seen only on the server) have no shape entry yet. On the 18:31 UTC
  publication (446 vehicles): front view **150 (34%)**, estimated movement 11 (2%), placed on a
  timetable 256 (57%).
- The Operations view on the live site then read "Every check this warehouse can make balances;
  2 about the archive replay cannot be made here, and say so", with the two rows chipped "not
  checked here". The card above it still said "The file on disk does not match the last recorded
  publication. Treat the served data as unverified" from the same absent premise; that verdict is
  now three-way (matches / does not match / no archive publication recorded here), a wording
  follow-up deployed after the batch's suite (commit named in the closing note).

## 5. Limitations and the physical-device checklist

`docs/PHYSICAL_DEVICE_CHECKLIST.md`: every item unchecked on a phone. Emulation says nothing
about a real GPU's frame rate, battery, sunlight legibility or a real GPS fix.

## 6. Route 263 and the standing hold (filled when the evaluation has run)

_Criteria: `docs/MOTION_MODEL.md`, fixed in 82a3605 before any result._
