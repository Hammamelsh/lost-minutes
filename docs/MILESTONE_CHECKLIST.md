# Milestone checklist: walking guidance and credible bus tracking

13 September 2026. One row per requirement in the owner's brief: what was built, the check or
inspection behind it, and what still stands in the way. **Done** means implemented and
verified. **Partial** means implemented with a stated limit. **Not done** means a named
dependency outside this repository. FIXTURE evidence uses test data on real stops and real
recorded road and walking geometry. LIVE evidence names its run. Measured details are in
`docs/LOCAL_VERIFICATION.md`.

## 1. Walking guidance

| Requirement | Implemented behaviour | Evidence | Status |
|---|---|---|---|
| Genuine pedestrian routing, configurable | OSRM foot profile at routing.openstreetmap.de (FOSSGIS e.V.) by default. `LM_WALKING_ROUTER` accepts an https URL, localhost or `none`, and is written into `config.json` at each publication (`lib/walking.ts`, `pipeline/live.py`). | `tests/test_walking_config.py` (3); `tests/walking.test.mjs` "only a rounded origin and the stop are sent, to the configured foot router"; LIVE: three requests answered 200 on 13 Sep | Done |
| Provider terms and limits verified | Follows the limits the service's own pages state: attribution, a "fix the map" link, at most one request a second, no heavy use; requests are logged. The page asks once per tap, at least 10 s apart. | Consent text names the operator and links its privacy statement; `minSecondsBetweenRequests: 10` | Partial: the German usage-policy page sat behind a bot check and could not be read in full |
| Working local path, no paid infrastructure | The free public service; no key, nothing provisioned | n/a | Done |
| Path, distance and time to the correct boarding point | Routes to the chosen stop's own NaPTAN point, so the right side of the road. Drawn dotted blue on the map, with short connectors where the router snaps. "N min walk · X m to Stop" in the stop panel and on the card. | FIXTURE with a recorded real answer: `walking.spec` "nothing is sent until asked; then a real walking route is on the map and the card" (desktop, phone). Real: `walking-real.spec` passed (one request: 340 m, "5 min walk" to Stretford Mall (Stop A)). LIVE: "3 min walk · 220 m to St Modwen Road (nr)" | Done |
| Locate me after a stop is chosen | Locate button in the stop row, and in each location problem state | `walking.spec` "without a location, walking directions say what they need" | Done |
| Denied or inaccurate location, unreachable stop, route failure, outside coverage | Each is a stated problem with a next step:<br>• no location: Locate me<br>• accuracy worse than 200 m: not routed<br>• more than 3 km: "too far to walk", said before any request<br>• NoRoute / NoSegment: no path / not reachable on foot<br>• 429, timeout, network: stated, with Try again | `walking.spec`: router failure; no path and unreachable stop; inaccurate fix; too far; no location. `walking.test.mjs`: failures; no request without a usable location | Done |
| No rerouting on jitter | A new request only after the fix moves more than max(40 m, twice its accuracy), capped at 300 m, and at least 10 s after the last | `walking.test.mjs` "location jitter does not re-route; real movement does, but not more than the policy allows" | Done |
| Never a driving route or silent straight line | Foot profile only. Without a route, a straight-line distance reads "in a straight line, not a walking route". | `walking.spec` router-failure test; `journey.test.mjs` distance lines | Done |
| Say when coordinates are sent | Before the first request the page says what is sent (location rounded to about 10 m, and the stop), to whom, that the service logs requests, and that nothing is sent until asked. "Stop sending my location" withdraws consent. | `walking.spec` first test: no request before the tap | Done |
| Precise location out of links and logs | Origin rounded to 4 decimal places; `credentials: 'omit'`, origin-only referrer | `walking.spec` asserts the router URL lacks the precise fix, the page address holds no location, and the page's console shows none; `walking.test.mjs` | Done |
| Guidance on map and card | Route on the map with a "Walk" legend chip; "You: N min walk" on the card | `walking.spec`; LIVE screenshots | Done |

## 2. Estimated movement

| Requirement | Implemented behaviour | Evidence | Status |
|---|---|---|---|
| Reports, estimate and visual kept apart | `lib/motion.ts`:<br>• Fix: immutable reports<br>• `estimate()`: state at a presentation time<br>• `stepVisual()`: drawn position with a decaying offset<br>Nothing estimated is stored or published. | `tests/motion.test.mjs` (19); `live.json` validation `trail_is_earlier_observed_history`; every published position is `observed` | Done |
| Road geometry, not stop coordinates | A bus route through each pattern's stops (FOSSGIS Valhalla, NaPTAN headings). Accepted only when ≥ 30 matched reports lie within 35 m at p95. | `tests/test_shapes.py` (6); 9 built, 6 accepted (p95 11.3–28.4 m), 3 rejected for no reports; TfGM files carry no `Track` geometry (0 of 1,390) | Done for routes 15, 250 and 256 |
| Evaluated corridor first; other buses at reports | Estimates only on the six evaluated patterns; everything else at its last report, with the reason | `motion.spec`: unsettled branch; no published evaluation. LIVE: 14 of 349 buses on the corridor at 16:42 BST | Done |
| Continuous presentation clock | The server offset is re-measured each publication to the second. It is approached at ≤ 0.1 s per s and never runs backwards; only a change over 5 s is taken at once. | `motion.test.mjs` "the presentation clock is never stepped"; `motion.spec` asserts drawn time stays within 10% of real time across publications | Done |
| Late report reconciled at its time, brought forward | The estimate runs from the newest report's observation time to the presentation time. A late report is filed, never made the basis. | `motion.test.mjs` reports test; evaluation uses only reports fetched by then | Done |
| Smooth corrections: no overshoot, no back-and-forth | Offset decays over 0.9 s and never faster than 15 m/s on top of the bus's own speed. A step back of ≤ 35 m while moving is held, not reversed. Speed eases off with report age (decay 45 s, fitted to reduce steps back). | `motion.test.mjs`: no jump; no sign change; catch-up limit; hold. `motion.spec`: ≥ 2 publications, never backwards, no step beyond 25 m/s × real time + 3 m. Held out: steps back > 35 m down from 33% to 21% | Partial: 21% of real updates still step back more than 35 m and 10% snap; each is drawn and said, not hidden |
| Large errors, uncertain turns, standing, out-of-order, duplicates, service changes, gaps | • Over 150 m snaps; the card says how far<br>• A jump is never read as speed<br>• Standing: no drift, no frames<br>• Duplicates ignored; late reports filed<br>• A new journey starts a new history<br>• Over 120 s apart: no speed<br>• Over 40 m from the road: at the report<br>• An unsettled branch: at the report | `motion.test.mjs` (reports, jump, standing, fallbacks); `motion.spec` (large correction, standing, stale, capped, unsettled branch) | Done |
| Never force forward to hide an error | Larger steps back are drawn back or snapped and labelled | `motion.test.mjs` withdrawing and snap tests | Done |
| Model, marker and camera in sync; identity kept | One drawn state per frame drives marker, model and camera. Choosing another bus starts a new drawing, not a "correction" between two buses. | `motion.spec`: camera within 40 m of the drawn bus; switching buses leaves `data-correction` at `none` | Done |
| Ride framing set once; user controls respected | Zoom 20 set once on entry; frames set only centre and heading. A drag pauses following (Recentre); the passenger's zoom is kept. | `motion.spec` "…zoom set once, turning the short way": one zoom over 22 s, and the passenger's zoom survives a report | Done |
| Shortest rotation | `turnToward` via `shortestTurn` | `motion.test.mjs`; `motion.spec` (each sampled turn < 40°) | Done |
| "Estimated position" and the real report age | "Estimated position · last report N s ago", using the same age as the card's chip | `motion.spec` first test; LIVE screenshots | Done |
| Extrapolation bounded by measured behaviour | Top speed 15.7 m/s (training p99); horizon 120 s; decay 45 s; nothing past 150 s | `public/data/motion-evaluation.json`, `fitted` section | Done |
| Clear fallback when unsupported or stale | "Last reported position · N s ago" plus the reason. Withdrawing an estimate says how far the drawn bus moved. | `motion.spec`: stale; no evaluation; branch; reported-only toggle | Done |
| Uncertainty graphic with a defined basis | Pale band of ± the training 8-in-10 error at this report age, drawn only for bins with ≥ 30 cases. Held-out coverage 74–83%. | Evidence table, "Band held it"; `uncertaintyAt` test | Done |
| Delay shown if interpolation is buffered | No buffering (extrapolation from the newest report), so no display delay | n/a | Not applicable |

## 3. Cinematic presentation

| Requirement | Implemented behaviour | Evidence | Status |
|---|---|---|---|
| Daylight kept; night readable | Day unchanged. Night: lighter ground and buildings, amber arterials, brighter labels. | LIVE night screenshots; `journey.spec` day and night on one map instance | Done on screen; a real phone at night not checked |
| Bus silhouette and materials | 23-part generic model: pillars, waist stripe, door, lamps, brake lights, destination display, roof pod | Ride screenshots at zoom 20 (FIXTURE and LIVE) | Done |
| Camera framing | Above and behind the heading at zoom 20 (the 12 m bus about 135 px long). Kept in the band between the notes and the card, re-padded on resize. | `journey.spec` ride screenshot and model pixels; `motion.spec` | Done |
| Restrained observed trail, reports distinct from estimates | Up to six earlier reports as small dots, the newest ringed. The estimate is a dashed line from its report to the drawn bus, captioned ESTIMATE. | LIVE screenshots; trail validation check | Done |
| Walk, stop and bus understandable together | Legend (You · Walk · Your stop · Your bus); Fit journey frames all three and the path | `walking.spec`; `journey.spec` | Done |
| Interruptible overview → stop → bus, and a clear way back | Tour with "Skip to the bus"; a drag or zoom ends it. Exit or Escape returns to the practical map with its own tilt. | `motion.spec` tour test; `journey.spec` "2D, City and the ride-along, and back again" | Done |
| Less repeated prose; prominent answer | Answer first on the card. The ride card shows route, one status line with the age, and progress. The age is shown once. | Screenshots before and after (see LOCAL_VERIFICATION) | Done |
| Consistent ride state | No "Ride along" while riding; the card shows "Riding along · exit" | `motion.spec` tour test | Done |
| Accessible on mobile; reduced motion; no continuous rendering | 44 px controls. On a phone the ride map is taller and the card compact. Reduced motion skips the tour. Frames run only while something moves. | `journey.spec` overlay collisions (desktop and phone, with and without a walking route); `motion.spec` reduced-motion ride; standing bus < 4 frames in 3 s | Done in the browser; a real phone not checked |

## 4. Wording and selection

| Requirement | Implemented behaviour | Evidence | Status |
|---|---|---|---|
| Replace "At your stop now" | "Last reported nearby — within 150 m, not coming to your stop" | `journey.spec` | Done |
| Rank relevant buses apart from the rest | Coming · Maybe coming · Last reported nearby · More buses near your stop (Already past · Not for your stop · Old reports) | `journey.test.mjs` stop board; `journey.spec` | Done |
| Never auto-promote a bus that does not call | Automatic choice only from "Coming" | `journey.spec`; stop-board test | Done |
| An explored bus is labelled, with a way back | "Selected bus"; "It does not serve…"; "Back to buses for your stop (n coming)" | `journey.spec` | Done |
| Walking distance and time; progress with its basis; arrival only if supported | Walk line on the card. Progress in stops, with how it was counted. No arrival line. | `journey.test.mjs` distance lines (no Arrival) | Done |
| The animated position is never proof | Progress, stop association and service come from reports and the timetable, never the drawn position | `lib/journey.ts` reads the match and the report only | Done |

## 5. Evidence

| Requirement | Implemented behaviour | Evidence | Status |
|---|---|---|---|
| Held out against the last report, with only what was known at prediction time | 109 journeys split at 12:50 UTC: 71 to fit, 38 held out. Each prediction uses only reports fetched by then. | `public/data/motion-evaluation.json`; Evidence tab; `evidence-motion.spec` | Partial: one Sunday, held out by later journeys rather than later days |
| Error by horizon; abstentions | Seven report-age bins: median, 8-in-10, share closer than the last report, band coverage. Abstentions by reason. | Evidence tab | Done |
| Traceability | A row per prediction with vehicle, journey, times and both source files' SHA-256 (`data/evaluation/`, not in Git). The reports file's SHA-256 is published. | Evaluation files | Done |
| Predicted-versus-reported replay; say what sparse GPS cannot show | Four held-out journeys with a scrubber and replay. The note says sparse reports cannot check a drawn position between two of them. | `evidence-motion.spec` | Done |
| Matching changes on one frozen capture | Four moments, the old 60% rule against every held pattern, on the same capture | `data/evaluation/matching-assessment.json`; LOCAL_VERIFICATION table | Done |
| Patterns differing only behind the bus | `sharedOnward`: they may share the road ahead for an estimate but stay unresolved | `tests/test_matching.py`; 41 such buses at 16:42 BST | Done |
| Abandoned runs; exit reasons; no inferred cause | Abandoned runs are closed after the lock is held. `exit_reason` recorded. SIGTERM and SIGHUP handled. | Tests (abandoned run, bounded kind, a real SIGTERM); three abandoned runs closed; the 16:17 run ended `time_limit_reached` | Done |
| Bounded development, not always-on | `collector_kind: bounded_development`, planned minutes, end time. The page shows "local run · until HH:MM". | `motion.spec` first test asserts the chip | Done |

## 6. Proof

| Requirement | Evidence | Status |
|---|---|---|
| Reusable browser suite and targeted tests, on the final build | `pnpm test:browser` on the final build: 77 passed, 13 skipped by design, 0 failed, at desktop and phone size. The real-feed (2/2) and real-walking (1/1, run twice) checks passed separately. Also 87 Python and 95 Node tests, typecheck, lint and the build. | Done |
| Moving demonstration over several updates | LIVE video, 74 s, on the built app with a real 256 to Towns Gate: walking route, City view, the ride-along's tour then zoom 20, and three reports reconciled while riding (eased 91, 65 and 72 m). FIXTURE video, 52 s, the same flow on a recorded real bus road. Both checked frame by frame through contact sheets played back in Chromium. | Done |
| Continuity, stable zoom, shortest rotation, standing, stale fallback, large correction | `motion.spec` (10 checks per viewport) | Done |
| A real pedestrian path to a real boarding point, distance and time on screen | `walking-real.spec`; LIVE passes (220 m, 3 minutes, St Modwen Road (nr)) | Done |
| Route failure, opposite-side stops, location denial, unsupported buses | `walking.spec`; `journey.spec` (both sides of a road, refused location); `motion.spec` | Done |
| Both themes on desktop and phone, inspected | LIVE and FIXTURE screenshots, looked at frame by frame; defects found this way are in LOCAL_VERIFICATION | Done |
| Screenshots and a short video, labelled fixture, replay or live | Labels burned into every frame | Done |
| Physical-phone checks | Not performed: touch and gestures on a real screen, real GPS (accuracy, denial prompt, walking along a route), sunlight and night legibility, ride-along frame rate on a real GPU, battery and heat | Not done: no physical phone from this environment |

## Remaining blockers

- **Real phone.** Everything in the last row.
- **Provider policy in full.** The FOSSGIS usage-policy page could not be read past its bot
  check.
- **Always-on collection.** Needs hosting, which is the owner's decision (`docs/HOSTING.md`).
  Only bounded local runs exist.
- **More capture days.** Weekday traffic, and an evaluation held out by day, before estimates
  extend beyond routes 15, 250 and 256. Road shapes for more routes: opportunity log, entry 10.

---

# Milestone: ride-along visibility, dark-map readability, motion continuity, window-seat journey

13 September 2026, evening. Same status words as above. FIXTURE evidence uses fixture buses on
real recorded road and stop geometry; RECORDED evidence replays real reports from the day's
captures; LIVE evidence names its run. Continuous behaviour was measured by sampling the map's
own diagnostic attributes every 120–250 ms during the interactions (not by watching video);
the recorded videos were reviewed as contact sheets of sampled frames.

## 1. Ride-along

| Requirement | Implemented behaviour | Evidence | Status |
|---|---|---|---|
| Reproduce the screenshot scenario first | Reproduced on 83053c7 with FIXTURES: a drag while following left "Recentre on the bus" with the bus drifting out of frame; a wheel zoom to 17.6 left a 20 px sliver with no flat marker; Recentre re-centred at that zoom; the zoom buttons did nothing while following (per-frame `jumpTo` cancelled them); a drag during the introduction was swallowed by the next chained glide and never paused anything; in the introduction's stop step (zoom 17) the bus was invisible. | Probe log and frames in the verification notes | Done |
| Immediate recognisable bus on entry | Introduction (first ride of a visit only; skippable by button or tap; none under reduced motion): the journey centred on the drawn bus, then down to it, so the bus stays in the middle while the camera zooms, tilts and turns. Every later entry goes straight to the ride framing at zoom 20 with the model, a lime ground ring and the route number; below zoom 18 the flat marker with its number. Symbols are drawn over buildings. Found and fixed on the phone: the map's own resize just after entry re-applied the padding, which is a jump, so the introduction's first glide was cancelled and a second ride was left flat at zoom 13.6 while saying "following the bus". | `ride.spec` "entering": once the first glide is under way the bus is on the map at every sampled moment, clear of every control in at least half of them and never hidden two samples running, then following at zoom 20. "Repeated entry" now also asserts zoom 20 and a tilt over 50°. | Done |
| One explicit "Return to bus" restoring framing and following | `returnToBus()` brings the bus to the middle at the zoom shown, then glides around it to zoom 20, pitch 60 and the bus's heading, then follows. One ease doing both swung an off-centre bus to about three times its offset, off a phone's screen. | `ride.spec` drag-during-introduction and drag-while-following tests | Done |
| Deliberate zoom preserved; programmatic moves never gestures | The loop moves the camera only when the map is not already moving; gestures are MapLibre's own events with `originalEvent`, plus raw pointer/wheel during transitions | `ride.spec` "the passenger's zoom is kept": two zoom-outs take effect and survive a publication | Done |
| Consistent state on map and card; predictable pausing; cancelled transitions | `data-ride`: entering · following · exploring · returning · off; HUD mode line and card status read the same state; every transition has a token; another bus or leaving cancels it | `ride.spec` change-of-bus, exit and repeated entry; `data-correction` stays `none` across a change of bus | Done |
| Readable symbol wherever the model is small or hidden | Flat marker below zoom 18; ring + badge (symbols) from 18 | `ride.spec` at zoom 20, 18 and 17; night; model failed | Done |
| Route 142 with reported positions only | A bus with no evaluation is followed at each report; nothing hides it | `ride.spec` "no predictions (as route 142 today)"; LIVE: the publication of 19:18 BST in `public/data/live.json` held 10 route-142 buses, every one placed on a 142 pattern, none on an evaluated road shape (the 142 has none), so all are drawn at their reports; 3 of them reported no bearing | Done |

## 2. Dark map and simplification

| Requirement | Implemented behaviour | Evidence | Status |
|---|---|---|---|
| Legible essential labels | Street names 11–15 px (major) and 11.5–14 px (minor) with a 2–2.2 px halo; landmark 11.5–14 px; stop label 13.5 px, halo 2.4; night text lifted (`#e4edf2`) on a darker halo | Frames at normal zoom, desktop and phone, day and night (verification notes) | Done, judged by eye on screen |
| Viewport-aligned labels in pitched views | Line-placed labels keep `text-rotation-alignment: map` (along the street) with `text-pitch-alignment: viewport` (upright), a combination the MapLibre v8 specification allows; `text-keep-upright` stays on | `tests/map-style.test.mjs` validates both themes against the specification | Done |
| Less competing building contrast | Night buildings and extrusions moved towards the ground tone; night extrusion opacity 0.78 | Night frames | Done |
| Daylight preserved | Day palette unchanged; only label sizes and pitch alignment changed | Day frames | Done |
| Short mode label; long text behind details | "Ride-along · following the bus" etc.; "What is this?" holds the explanation | `journey.spec` | Done |
| Walking, bus-to-stop and any estimated time kept distinct | Unchanged from the previous milestone | `walking.spec`, `journey.test.mjs` | Done |

## 3. Motion

| Requirement | Implemented behaviour | Evidence | Status |
|---|---|---|---|
| Audit the causes of backward corrections and snaps | On held-out captures: 21% of report arrivals pulled the estimate back over 35 m; of those, 45% were reports that showed the bus had not moved (a stop or lights), 50% within 40 m of a timetabled stop; 41% of arrivals pushed it forward, the blanket speed decay's cost at steady speed | `visibleCorrections` in the published evaluation; audit script in the verification notes | Done |
| Improve them honestly | The estimate now pauses 10 s at each timetabled stop it reaches, reads speed from the stretches where the reports show the bus moving, and eases slightly with report age (decay 120 s): motion-3. Chosen by a rule fixed before any held-out figure was read (accuracy within 2% of the best, then the smallest mean visible move) | Held-out (3,826 report arrivals): mean visible move 65.5 m (previous model 68.0, constant speed 70.7); back over 35 m 26.2% (20.9%, 32.6%); forward over 35 m 35.2% (40.8%, 32.1%); snaps 8.9% (10.0%, 10.3%); error up to a minute median 62.6 m (64.9, 69.3), mean 86.4 m (92.5, 94.0). The residual is stated in `docs/LOCAL_VERIFICATION.md` | Done, with the residual stated |
| Observation, prediction and display times apart; reconciliation at comparable times | Report time, presentation time and the page's clock are kept separately; a new report is reconciled at the presentation time the estimate was drawn for; `data-display` carries all three | `motion.test.mjs`, `motion.spec` | Done |
| Bounded corrections; explicit large ones; no forward-only suppression; stop when stale or unsupported | Catch-up ≤ 15 m/s on the road; ≤ 35 m back held; > 150 m snaps and is said; the trail shows every report; stale, off-road, jumps and unsupported buses fall back to the report | `motion.test.mjs`, `motion.spec` | Done |
| Evaluate in the rendering loop as well as offline | A real recorded journey (BNML 256, SK74BNB, 20 reports) replayed through the built page, every frame sampled | `replay.spec` (desktop): 1,481 frames sampled over 276 s; 13 report arrivals reconciled by eased corrections (22–133 m, median 53 m, as the offline evaluation's median visible move); no snap (the offline evaluation expected one for this slice; the check allows two); the largest step between frames outside a snap 4.3 m in 0.2 s; drawn backwards only while a labelled correction settled (44 frames); following throughout. Run on the build before the final camera repair, which changed only the ride's entry glides and padding, not the motion | Done |

## 4. Window-seat journey

> **Removed later the same evening at the owner's request.** The owner wanted a virtual view
> from the bus moving through the mapped streets, not an embedded film; the card, its metadata,
> tests and styles were deleted. The rows below record what was built and checked before that.

| Requirement | Implemented behaviour | Evidence | Status |
|---|---|---|---|
| Verified recorded video, official embed, attribution | Travel wow's 142 film, embeddable (checked 13 September), credited and linked; the description gives the direction (Piccadilly to East Didsbury), the filming date (3 June 2022, 18:35) and the stop list | `public/data/window-seat.json`; `tests/window-seat.test.mjs` | Done |
| Journey card with play, pause, full screen, original link; works without location or a collector | Facade loads nothing until tapped; then the player's message API drives play and pause; full screen on the wrapper; the original link always present; a timeout or player error shows the fallback | `window-seat.spec`, against the real service: the card loads nothing from YouTube until tapped; after the tap the player reported ready, Play made the film advance (the `<video>` in the player's own frame past 1 s and not paused), Pause stopped it, and the original link is always present; with the player's host blocked the fallback appeared within the timeout (desktop and phone; the playback check runs on desktop only) | Done |
| "Recorded journey" visible and separate from live | Badge, wording, and the Explore tab; never linked to a live vehicle | `window-seat.spec` | Done |
| Companion context only where verified; today's route apart | Creator's stop list and highlights drawn from it; no chapters (none published); today's 142 pattern in its own section, labelled as not the recorded route | `window-seat.spec` | Done |
| Structured, validated metadata | zod schema with date certainty and verified-only chapters | `tests/window-seat.test.mjs` | Done |

## 5. Verification

On 13 September 2026, evening. FIXTURE: fixture buses and timetable on the real NaPTAN stops, a
real recorded bus road and the real basemap. RECORDED: real reports re-timed to the test's clock.
LIVE: the real service.

| Check | Result | Build |
|---|---|---|
| `pnpm typecheck && pnpm lint && pnpm build` | Pass | Final |
| `pnpm test` (Node contract tests) | 102 passed | Final |
| Python (`.venv/bin/python -m unittest discover -s tests`) | 87 passed earlier the same day; no Python changed in this milestone | — |
| Every browser check that enters the ride-along: all 12 in `ride.spec`, the two ride tests in `motion.spec`, the four view and overlay tests in `journey.spec`, at desktop 1280×900 and phone 390×844 (FIXTURE) | 36 passed, none failed (5.7 min) | Final |
| `window-seat.spec` (LIVE: YouTube's own player) | 5 passed; 1 skipped by design (real playback runs on desktop only) | Final |
| `replay.spec` (RECORDED: BNML 256, vehicle SK74BNB) | Passed; figures in §3 | The build before the last camera repair, which changed only the ride's entry glides and padding |
| Full browser suite | 104 passed, 3 failed, 15 skipped by design (20.1 min), on an earlier build that evening. The failures were the replay's backward-drawing check (too strict for a correction still settling) and the entering check on desktop and phone (the introduction lost the bus). All three were repaired and pass on the final build | Earlier |

Where the brief's regression list is checked: entry, the introduction completed, interrupted by
a drag and by a tap, Return to bus, exit and repeated entry (`ride.spec`); route 142 with
reported positions only, and an estimated route (`ride.spec`, `motion.spec`); a missing bearing
and a failed model (`ride.spec`, `journey.spec`); a theme change and new publications while
riding (`ride.spec`); the bus identifiable in the usable area (projection plus pixels,
`ride.spec`); desktop and phone; reduced motion (`ride.spec`); walking (`walking.spec`, in the
full suite); real video playback and its fallback (`window-seat.spec`). Negative controls: a bus
dragged off screen must fail the identifiability measure, and does; a blocked player must show
the fallback, and does; the replay rejects backward drawing outside a labelled correction.

The last phone defect was diagnosed with a probe that takes no screenshots (`data-ride` and
`data-camera` every 40 ms). On the final build the phone's introduction reached its overview at
1.26 s and following at zoom 20 at 2.67 s, and a repeated entry reached zoom 20 and a 60° tilt in
1.25 s (desktop 1.28 s). Before the repair the phone skipped the overview, and its second ride
stayed at zoom 13.6.

Frames and recordings were reviewed as sampled frames and contact sheets, not by watching
continuous playback: the FIXTURE demo recorded from the final build (desktop day with a 32 s
video, phone night, desktop night; ten steps each), the browser checks' own screenshots, and the
window-seat card with the real film paused after the playback check.

# Milestone: ready for a first passenger comparison

13 September 2026, late evening. Same status words and evidence labels as above. Measurements are
in `docs/LOCAL_VERIFICATION.md` under the same heading.

## 1. The ride-along works, and goes straight to the bus

| Requirement | Implemented behaviour | Evidence | Status |
|---|---|---|---|
| "Ride along doesn't seem to be doing anything" | Only under `next dev`: React's Strict Mode double mount left the frame loop's id behind, so no frame was drawn and the bus never appeared; the cleanup now clears it | Reproduced, then checked on the owner's running `pnpm dev:live` with the real feed (route 15: estimated, following at zoom 20, pitch 60) | Done |
| Phone: the Ride along button no longer covers the stop label; stop, bus and controls readable in both themes | The fitted view measures the view buttons, the tools and the legend, and keeps the stop, its name (40 px of room) and the bus clear of them | `ride.spec` "before riding, a fitted map keeps your stop, its name and your bus clear of the Ride along button, the legend and the tools, by day and by night", desktop and phone | Done |
| No automatic introduction; an overview only when asked for | Entering goes straight to the bus: centred at the zoom shown, then zoom 20, pitch 60 and its heading; Fit journey is the overview | `ride.spec` "entering goes straight to the bus"; `motion.spec` "entering the ride-along goes straight to the bus" | Done |

## 2. The stop's answer

| Requirement | Implemented behaviour | Evidence | Status |
|---|---|---|---|
| Boarding point and direction, suitable services, the chosen bus's progress, report age, walking route, other buses; uncertain relationships clear; no arrival prediction | The stop (side of the road, street, direction of travel); its services today; buses coming, maybe coming and near it, before the chosen bus's card; progress in stops from the last report with its age, estimated or reported; walking on request; unsettled branches stay "may be coming"; "arrival time not predicted" | `journey.spec` (the two sides of a road, services and buses coming, branching unresolved, a chosen bus leaving the feed); frames at both sizes | Done |

## 3. The journey kept

| Requirement | Implemented behaviour | Evidence | Status |
|---|---|---|---|
| Keep and restore stop, service, direction and destination; refresh; expired buses and changed services never silently replaced; no location in share links | `lib/journey-context.ts`: kept on the device for 12 hours and in the address (stop, service and bus keys only); a bus that has gone, or is now on another journey, is said so, with a choice to follow it anyway or show the first bus coming; a service missing from today's timetable is reported | 8 Node tests; `journey-context.spec` (3 checks, desktop and phone) | Done |

## 4. The tester's route

| Requirement | Implemented behaviour | Evidence | Status |
|---|---|---|---|
| Report missing patterns, geometry and live observations separately; no wider prediction just to make the map move | `python -m pipeline.route_coverage --line … --stop …` (5 tests) | Routes 15 and 245 at Marston Road (verification notes) | Tool done; the tester's route not yet supplied |

## 5. The motion model frozen and scored fresh

| Requirement | Implemented behaviour | Evidence | Status |
|---|---|---|---|
| Freeze it; reproducible fresh-capture evaluation; the Sunday data as development evidence; error, corrections, abstention and uncertainty coverage; no replacement on one aggregate | `docs/MOTION_MODEL.md` (version, settings hash, data hash, a five-condition replacement rule); `scripts/evaluate-motion.mjs` refuses to overwrite the published model without `--replace-frozen yes`; `scripts/evaluate-frozen.mjs`; `pipeline.motion_data export --since/--until` | Fresh window, 30 journeys: median error up to a minute 65.0 m (last report 143.0, constant speed 71.7); band held 75–82%; 22.9% of reports back over 35 m, 40.0% forward, 10.1% snapped; 3.2% abstained | Done; a weekday test is still outstanding |

## 6. Deployment prepared, not provisioned

| Requirement | Implemented behaviour | Evidence | Status |
|---|---|---|---|
| HTTPS and continuous collection; configuration, validation and costs before any paid provisioning | `deploy/`: Caddyfile, systemd units (collector, nightly rebuild, watchdog, optional retention), install and upload scripts, `deploy/README.md`; costs in `docs/HOSTING.md` (CX23, about £4 a month with VAT, £5–6 with backups and a domain; to be confirmed in Hetzner's console) | `deploy/validate.sh`: 4 scripts' syntax, 7 units verified, the Caddyfile run locally with 19 route and header checks, all passing | Ready; awaiting approval and a domain |

## 7. Front view (the correction)

| Requirement | Implemented behaviour | Evidence | Status |
|---|---|---|---|
| Remove the embedded film; keep the recorded GPS replay | Component, metadata, tests and styles deleted; the replay and the evaluation kept; the distinction recorded in `PROJECT_CONTEXT.md` | Five files removed; what mentions the film now is history, marked as such | Done |
| An optional front view from the current renderer, reusing the map and motion, no paid imagery; validated road geometry only; no stop-to-stop lines; never a silent change of bus | The eye 3.5 m above the road at the front of the drawn bus, looking 30 m ahead along its accepted road shape; offered only with one, otherwise a note and the same bus | `ride.spec` "front view needs a road checked against the bus's own reports", desktop and phone, final build | Done |
| Hide the bus's outside; keep route, destination, report age, status and Outside view; restore it on switching back | Model, ring, number, caption and trail hidden; the HUD kept; Outside view restores them | `ride.spec` "front view: a passenger's eye along the checked road…" (no lime in the middle of the view; identifiable again outside), desktop and phone, final build | Done |
| Camera and bus from the displayed state; bounded prediction, standing and stale behaviour and reconciliation kept; nothing invented | The front camera is computed from the drawn state every frame; a standing bus holds the view; a 60 m correction is absorbed without a jump | `ride.spec` standing and correction checks, and the reduced-motion check (a handful of stills in 6 s), desktop and phone, final build | Done |
| Verified over time, desktop and phone, day and night, reduced motion and failures; continuous playback reviewed | FIXTURE probes at desktop by day and phone by night; the ride video frame by frame | 33 and 32 samples over 8 s: zoom steady, pitch 83.3°, the eye moving 69 and 62 m along the road, no page errors; no lime in any video frame once the front view began; the heading's turn acceleration at most 33°/s² (80°/s² before it was eased); the browser checks cover standing, a 60 m correction, reduced motion and a bus with no checked road | Done; the video reviewed as measured frames, not watched in playback |
| Remove it if empty, unstable or misleading | Kept: it reads as the road ahead with buildings towards the horizon; its limits are stated (stylised, sparse where OSM is, shows an estimate) | Frames (verification notes) | Kept, with limits |

## 8. A smooth ride (the owner's report of twitching)

| Requirement | Implemented behaviour | Evidence | Status |
|---|---|---|---|
| No twitch; use prediction where it helps; easy to follow | The drawn bus's speed changes gradually (at most 3 m/s each second) and never steps; it follows the estimate's own path averaged over the few seconds of it already known, so it eases into and out of stops; within the estimate's measured error it waits instead of reversing; no leap after a pause in drawing | Every captured journey: speed steps 267 and 292 an hour to 0 and 0.1; a real recorded journey: 34 steps and 26 hard changes to none; in the page (the recorded replay, final build): 1,325 frames over 281 s, 13 reports eased, no snap, the largest step outside a snap 3.7 m in 0.21 s, 32 frames drawn backwards, each while a labelled correction settled | Done |

## 9. Verification

| Check | Result | Build |
|---|---|---|
| `pnpm typecheck && pnpm lint && pnpm build` | Pass | Final |
| `pnpm test` (Node) | 111 passed | Final |
| Python (`.venv/bin/python -m unittest discover -s tests`) | 92 passed | Final code |
| Browser: `ride` and `replay` (FIXTURE and RECORDED) | 37 passed, 1 skipped by design (the replay runs on desktop only), 11.2 min | Final |
| Browser: the same with `motion`, `journey` and `journey-context` | 84 passed, 3 failed, 1 skipped by design (15.5 min). The three failures were browser contexts that got no WebGL: the page's own SVG fallback, 45 s before any riding (opportunity log, entry 17). All three pass on the final build | The build before the final, which differs only in when the map writes its diagnostics |
| Full browser suite | 120 passed, 16 skipped by design, none failed: the `ride` and `replay` specs (37 passed, 11.2 min) and every other spec (83 passed, 9.5 min) | Final |
| Real feed (LIVE: the owner's running `pnpm dev:live`, the collector publishing from BODS) | 4 passed, desktop and phone: the live badge, a painted basemap, buses drawn and a genuine refresh; the ride-along goes to the chosen bus, draws it and follows it | Final code, under `next dev` |
| A real phone | Not done | — |

**Version, address and commands.** The version is the commit that adds this section. The built
site: `pnpm install --frozen-lockfile && pnpm build && pnpm start`, then http://localhost:3000
(it shows the last publication in `public/data/`, so without a collector it says the feed is not
updating). With the real feed: `pnpm dev:live`, then http://localhost:3000. A phone on the same
Wi-Fi cannot reach a WSL port until Windows forwards it; that was not set up here. The checks:
`pnpm typecheck && pnpm lint && pnpm test`, `.venv/bin/python -m unittest discover -s tests`,
`pnpm test:browser`, and, with `pnpm dev:live` running,
`LM_REAL_LIVE=1 LM_BASE_URL=http://localhost:3000 pnpm test:browser tests/browser/real-feed.spec.mjs`.
