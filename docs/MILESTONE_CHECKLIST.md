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

# Milestone: one bus, kept

14 September 2026, morning. The status words for this milestone are those of
`.claude/rules/passenger-review.md`: **implemented and verified**, **implemented but unverified**,
**blocked**. Evidence is labelled FIXTURE (test data on real stops), RECORDED (captured journeys
replayed offline), LIVE (the real feed, with its run) or a physical phone (none yet).
Measurements are in `docs/LOCAL_VERIFICATION.md` under the same heading.

## 1. One bus, chosen and kept

| Requirement | Implemented behaviour | Evidence | Status |
|---|---|---|---|
| Reproduce the switching in d2e8702 | With nothing chosen the page showed `onRoute[0]` or `board.coming[0]`, lists ordered partly by report age; Follow and Ride along pinned nothing, so they followed whichever bus was first | `selection.spec` on d2e8702's build: 6 of 6 failed at the first publication, e.g. "the card still describes the bus being followed": FX-BRAVO where FX-ALPHA was followed | Implemented and verified |
| Follow and Ride along pin the bus displayed; the same for map markers, cards, lists and restored journeys; suggestion kept apart from choice | `lib/selection.ts`: a pin is a vehicle and the journey it was on, made by every way of choosing; the page's own pick is a labelled "Suggested bus", kept while it is still a candidate | 8 Node tests; `selection.spec`, desktop and phone, including a tap on another bus on the map (on the drawn fallback map, whose markers are elements; the vector map calls the same selection); `journey-context.spec` (restored and linked journeys) | Implemented and verified |
| Kept through new reports, reordering, camera gestures, theme changes and temporary absence; never substituted | A pin is resolved by vehicle, never by list position | `selection.spec`: reports alternating between two buses, a theme change, a filter to another service, a drag and Return to bus, the bus missing and back; card, strip, map and camera asserted after every publication (final build: all 7 selection checks, desktop and phone). FIXTURE playback frames, desktop by day and phone by night | Implemented and verified |
| Missing reports: an honest unavailable state, alternatives for explicit selection | Drawn hollow at its last report with "NO NEW REPORT", no model, no estimated movement; "It is not in the latest publication … Nothing else has been chosen in its place"; "Follow 256 to … instead" buttons | `selection.spec`, `journey.spec`, `journey-context.spec` | Implemented and verified |
| Journey changes during the session and after reload; vehicle apart from journey; motion and history reset; explicit continuation | Same journey: route, direction and reference where both give one. Another journey is said so on the card, the ride card, the strip and the list ("your bus · another journey"); the map's draw key includes the journey, so trail and motion start afresh; "Keep following it on this journey" | `selection.spec` (during the session); `journey-context.spec` (after reload) | Implemented and verified |
| Filters and map visibility cannot hide a pinned bus | Choosing a service, route or stop leaves the pin alone; the map draws the chosen bus from its own source whatever the lists hold; the strip says "not in the list below", with a stop chosen or not | `selection.spec` filter phase (final build) | Implemented and verified |
| Found on the real feed: with no route chosen, the route offered and its suggestion jumped to whichever route reported last | The route offered is kept while it still has buses; the card, the strip and the map's legend share one name for the bus (Suggested bus, Your bus, Selected bus) | `selection.spec` "with no route chosen…": failed at the first publication on the build before the fix (`BNSM|53` offered for `BNML|256`), desktop and phone; passes on the final build, which also checks that the card and the strip use one name | Implemented and verified |

## 2. Stop activity from evidence

| Requirement | Implemented behaviour | Evidence | Status |
|---|---|---|---|
| Fresh, distinct reports matched to stop, route and direction, with observed movement; "Last reported near" first, "Appears stopped near" only with support | `lib/stop-activity.ts`: near needs one report ≤ 150 s old within 50 m of a stop on its pattern, agreeing with the stop's direction of travel; stopped needs two or more distinct reports ≥ 20 s apart, the latest ≤ 60 s old, within 40 m of the stop and 15 m of each other | 14 Node tests; `stop-activity.spec` (5 checks, desktop and phone) | Implemented and verified |
| Never from the model's pause, the drawing, duplicates, or one point within 150 m | Reads only the journey's own reports; a report repeated with the same time counts once; the 150 m nearby group names no stop | Node tests; `stop-activity.spec` repeated-report check | Implemented and verified |
| Opposite-side stops, passing buses, lights, GPS noise, stale data; no doors or boarding | Only stops on its own pattern; bearing against the stop's direction; reports 40 m apart are near, not stopped; 15 m of jitter tolerated; nothing from an old report; worded near, never at, and nothing about doors | One Node test for each; `stop-activity.spec` heading and old-report checks | Implemented and verified |
| Method and limits documented; evidence shown | `PROJECT_CONTEXT.md` (definition and limitation); "Near a stop?" in "How we know this": each report read, its distance and whether it counted | Node test "the evidence lists every report read"; `stop-activity.spec` first check | Implemented and verified; the thresholds are reasoned from GPS noise and report spacing, not measured against observed calls |

## 3. What the screens show

| Requirement | Implemented behaviour | Evidence | Status |
|---|---|---|---|
| The bus distinguishable by day; a smaller ring | The day marker's rim is ink rather than pale; the ride-along's ground ring is smaller and fainter | Frames: FIXTURE playback, desktop by day | Implemented and verified in a software renderer; sunlight on a phone unverified |
| Room for stop names | The stop's actions wrap onto their own row under its name, which no longer truncates | Frames at 390 px | Implemented and verified by eye on frames |
| Repeated empty states consolidated, with next actions | One message when no bus is coming, with buttons for the buses that may call, those nearby, more near the stop, and another stop | `journey.spec` (the news appears once) | Implemented and verified |
| The active bus and its status easy to find while browsing | A strip kept at the top while the lists scroll: suggested or yours, status or progress, report age, "Details" | `selection.spec` asserts it; frames | Implemented and verified |
| Readable labels, unobstructed controls in 2D, City, Outside and Front, phone and desktop | The new status lines sit inside the ride card, which the overlap checks already cover | `journey.spec` and `ride.spec` overlap checks, desktop and phone, all passing on the final build | Implemented and verified |
| Unsupported Front view keeps the same bus | The button says why; nothing about the pin changes | `ride.spec` "front view needs a road checked against the bus's own reports", desktop and phone, final build | Implemented and verified |

## 4. Smooth, and faithful to the reports

| Requirement | Implemented behaviour | Evidence | Status |
|---|---|---|---|
| Observations, estimates and drawn positions kept distinct | Unchanged in the model; the evaluation reports the three separately | `scripts/evaluate-drawing.mjs` (schema 2) | Implemented and verified |
| The final drawing against later held-out reports, from what was known before them; lag and error, near stops especially | Each report held out; error along the road, near a stop (≤ 50 m) and between; display lag | RECORDED: fresh 30 journeys (2,063 reports), development 109 (11,055); drawn median 61.3 and 59.0 m (near a stop 43.7 and 40.3), lag 2.5 and −0.5 s; the estimate 54.8 and 52.5 m; the last report 112.8 and 86.0 m | Implemented and verified |
| The 84–87 m drawing-to-estimate distance not presented as GPS accuracy | Reworded wherever it appears: a distance between two computed positions | `PROJECT_CONTEXT.md`, `docs/MOTION_MODEL.md`, the evaluation's own output | Implemented and verified |
| No misleading stop activity, no stale travel, no hidden corrections | The drawn bus waits at half the path's speed instead of standing; it stops when the estimate stops; corrections over 150 m snap and are labelled; stop activity reads reports only | Stands the reports contradict: 11.9 to 3.2 an hour (fresh), 10.9 to 2.8 (development); travelling while the estimate is halted 0.03% and 0.07% of frames; a new Node test for both rules | Implemented and verified |
| Camera, model and motion status consistent | Missing: no model, no movement, a hollow marker, and the ride card says so; another journey: drawn afresh | `selection.spec`, `motion.spec`, `ride.spec`, all passing on the final build | Implemented and verified |

## 5. The completion rule

| Requirement | Implemented behaviour | Evidence | Status |
|---|---|---|---|
| A persistent rule under `.claude/rules/`, keeping existing instructions without repeating them | `.claude/rules/passenger-review.md` | Read against `AGENTS.md` and `CLAUDE.md` | Implemented and verified |

## 6. The passenger review the rule asks for

| Rule item | What was done | Evidence | Status |
|---|---|---|---|
| The main journeys, reviewed as a passenger | Find a stop, see what is coming, choose a bus, follow it, ride along, browse the others and come back, reload, open a shared link | FIXTURE playback frames (desktop by day, phone by night); the LIVE follow and ride frames, desktop and phone; `journey-context.spec` (reload, shared links) | Implemented and verified, in a software-rendered browser; not on a phone |
| Selection continuity | Section 1 | `selection.spec`, all 7 checks at both sizes on the final build; the LIVE follow-and-ride check, 6 of 6 | Implemented and verified |
| Clarity: one message per situation, with a next action | One empty-state message with actions; one name for the bus on the card, the strip and the legend; a missing bus or a new journey said on the card, with the alternatives as buttons | `journey.spec` (the news appears once); `selection.spec` (one name); frames | Implemented and verified |
| Readability in 2D, City, Outside and Front, phone and desktop, day and night | Section 3 | The overlap checks in `journey.spec` and `ride.spec`, all passing on the final build; frames by day and by night | Implemented and verified in a software renderer; sunlight on a phone unverified |
| Keyboard and touch access | Every new control is a button with its own name: Details, Follow … instead, Keep following it on this journey, Choose another bus, the empty state's actions. The review found Details left keyboard focus behind (now it moves to the card), and the fallback map named buses by the operator's raw destination code (now as the card writes it) | `selection.spec`: Enter on a focused button on the desktop and a touch tap on the phone keep the bus, and Details takes focus to the card; a tap on another bus on the fallback map, found by its corrected name. Final build and `next dev` | Implemented and verified for these controls; no keyboard-only pass of the whole page was made |
| Camera behaviour | The ride camera stays on the chosen bus through reports, a theme change and a drag; Return to bus goes back to it; a missing bus holds the camera where it was | `selection.spec` camera assertions; playback (0 m from the ridden bus in every riding phase) | Implemented and verified |
| Loading, empty, stale and offline states | Nothing is suggested, or said to be missing, before the first publication; one empty-state message; a chosen bus when live positions stop is said so, with nothing chosen in its place | `journey.spec`, `passenger.spec` (live, stale, offline, unavailable, replay); `selection.spec` "a followed bus when live positions stop", final build and `next dev`. The loading state has no check of its own | Implemented and verified, except the loading state: implemented but unverified |
| Performance | The crawl adds one multiplication to each drawing step; map start measured | Map start on the final build: medians 1.5 s over 100 loads in SwiftShader. A real phone's frame rate and battery are unmeasured | Implemented but unverified on a phone |

## 7. Verification

| Check | Result | Build |
|---|---|---|
| `pnpm typecheck && pnpm lint && pnpm build` | Pass | Final |
| `pnpm test` (Node) | 134 passed | Final |
| Python (`.venv/bin/python -m unittest discover -s tests`) | 92 passed | Final code (no Python changed) |
| `selection.spec` on d2e8702 | 6 of 6 failed, at the first publication | d2e8702 |
| Full browser suite (`pnpm test:browser`) | 142 passed, 18 skipped by design (the real-feed and real-walking checks, which need a live server or a real request; the map and replay checks that run on the desktop only), none failed, 22.6 min | Final, before the fallback map's bus names were corrected |
| After that correction: `selection.spec` and `map.spec` | 23 passed, 9 skipped by design (the map checks that run on the desktop only), 3.3 min, among them a tap on another bus on the map, found by its corrected name | Final |
| The selection, journey-context, stop-activity and ride checks under `next dev` | 56 of 60 on the first run. The 4 failures were two stop-activity checks at both sizes, faults in the checks (an assertion too broad for the evidence's rule text; a trail entry the page's schema refuses). Corrected, the stop-activity and selection checks passed 22 of 22 | Final code |
| Real feed (LIVE: a bounded 30-minute collection from 08:57 BST, 14 September) | 6 passed, desktop and phone: the live badge, a painted basemap and a real refresh; the ride-along on a real bus; and a real bus followed, then ridden, through five real publications with the card, strip, map and ride card on the same vehicle, the route offered unchanged and one name for it (BNML 245, BNGN 37). The same check on the code before the route fix also passed, and its frame showed the route flip | Final code under `next dev` |
| Map start (`scripts/probes/webgl-paint.mjs`) | 120 ordinary loads painted; one tile 9 s late: fallback at 7.5–7.8 s before the fix, painted at 10.6–11.3 s after | Before and after the fix |
| Continuous playback | FIXTURE selection playback (`scripts/probes/selection-playback.mjs`), desktop by day and phone by night, 9 phases each: the map, the card and the camera on the chosen bus in every phase (0 m while riding), no page errors; reviewed as frames, contact sheets and per-phase diagnostics beside the video, not watched in real time | Final |
| A physical phone | Not done | — |

# Before the first passenger test: closing four gaps

14 September 2026, late morning. The gaps come from an outside review. Status words as in the
milestone above, and measurements in `docs/LOCAL_VERIFICATION.md` under the same heading. Each gap
was reproduced first on a build without its fix.

| Requirement | Reproduced before the fix | Implemented behaviour | Evidence on the final build | Status |
|---|---|---|---|---|
| A moving chosen bus that starts another journey: say so, keep the vehicle, pause following and prediction until continued, never freeze a marker described as current | Ridden or followed, desktop and phone: the new journey was estimated, and the camera kept following it | The same vehicle stays chosen; card, strip, ride card and map (ANOTHER JOURNEY) say so; drawn at each report, never estimated; the map stops following it; the ride pauses (`paused`); Continue in the ride card or on the card resumes both | `selection.spec`, ridden and followed, desktop and phone: within 5 m of the latest report, more than 20 m on after the next, camera within 3 m, then estimated and followed after Continue. All passing on the final build; the ride, motion and journey specs unaffected | Implemented and verified |
| Select by clicking a real rendered MapLibre marker, with phone input, overlaps and touch targets; keep the fallback-map check | A bus 14 px from the chosen one could not be tapped on either size: the chosen bus's layer handler, registered last, always won | One handler takes the bus drawn nearest the tap within 14 px; a diagnostic (`data-bus-points`) says where each bus is drawn | `selection.spec`: a click and a tap on the drawn marker; a phone tap 20 px off centre; empty map chooses nothing; the overlap; the fallback-map tap kept. All passing on the final build, each tap's screenshot showing it on the marker. A probe confirmed a touch tap reaches the map (no event cancelled) | Implemented and verified in a software renderer; a real finger on a real phone not tried |
| A keyboard-only passenger journey | Focus dropped to nothing when the ride began | The ride's region takes focus when the ride begins, and Ride along gets it back when it ends; Details moves focus to the card; focus rings | `access.spec`: search, arrow keys, the bus row, Follow, Ride along, Details, leave, the same bus throughout; passing on the final build | Implemented and verified on the desktop; a screen reader not tried |
| Slow live data: useful status, controls available | "NOT COLLECTING · not published yet" while the first publication was on its way | "CHECKING · waiting for the first positions"; a chosen stop says its buses will appear | `access.spec`, the first publication held 9 s, desktop and phone; passing on the final build | Implemented and verified |
| Slow tiles: useful status, controls available | Every tile 6 s late: the fallback map (`tiles_failed`) on both sizes, even after a first fix. The cause: a tile counts as loaded only after its labels' glyphs, fetched after the tile, so two slow round trips | 12 s for the tile service to answer (restarted when the camera comes to rest), then 40 s for a first whole tile | `access.spec`, every tile 6 s late, desktop and phone, passing on the final build; `map.spec`'s three failure cases still fall back; `scripts/probes/webgl-paint.mjs` | Implemented and verified |
| Score the frozen model and the final drawing on Monday 14 September, if enough eligible observations exist; otherwise state the shortfall | — | Nothing refitted | RECORDED: 86 journeys and 6,745 reports (00:00–00:22, 08:57–09:27, 09:45–11:49 BST). Routes 15 and 250 scored: 11,668 cases up to a minute; frozen median 62.7 m (last report 118.3, constant speed 71.4); band 79–81%; the drawn bus 60.7 m, 42.8 m near a stop, lag −0.1 s. Route 256: no eligible observations. Its inbound reports were placed on no pattern, since only weekend inbound patterns are held; its weekday outbound variant has no accepted road shape | Implemented and verified for routes 15 and 250 on one Monday morning. Route 256 blocked: no weekday inbound pattern held, and no road shape for its weekday outbound variant. Not an evaluation of weekday performance |

# Front view as a street preview, before the passenger trial

14 September 2026, early afternoon. One focused visual refinement, at the owner's request. The
outside ride-along and the chosen-bus behaviour are unchanged. Measurements are in
`docs/LOCAL_VERIFICATION.md` under the same heading. All evidence is FIXTURE; nothing here was
tried on a physical phone.

| Requirement | Implemented behaviour | Evidence on the final build | Status |
|---|---|---|---|
| Keep the outside ride-along as the default, as smooth as it is, and the chosen-bus behaviour | Nothing changed in the outside camera, the drawing or selection. The front view is still one button away inside the ride | Whole browser suite: 169 passed, 21 skipped by design, none failing, including `ride.spec` and `selection.spec` | Implemented and verified |
| Clearer night lighting; roads, buildings and sky told apart | In the front view only: lighter slate buildings and kerbs, a lower light, and a sky graded to a horizon (`FRONT` in `lib/map-style.ts`). By day, the paper theme's equivalents | Frames at the same turn: night, desktop and phone, before and after; by day, after only | Implemented and verified at night at both sizes. By day, only the after frames were looked at (no before run) |
| Readable street names; a few real stop labels; nothing invented | Upright names from the tiles' own `transportation_name`; a street with no name gets none. Up to three stops of the bus's pattern, at their NaPTAN names and positions | "Barton Road" and "School Road" upright at the turn; "Moss Park Road (adj)" at night on desktop; `ride.spec` requires the stops to be supplied (`data-stops-ahead`) | Implemented and verified. On a phone the ride's buttons cover the view's upper part, where a name can be hidden, as before |
| Better framing; no repeated introductions, automatic bus changes or camera moves against gestures | The eye 7.5 m above the road shape, looking 32 m ahead (pitch 77°, was 83°). A wheel or a two-finger touch in the front view pauses following, and Return to bus resumes it | Probe: following in every sample, and the same median step, turn rate and correction, day and night. `ride.spec`: "in the front view a zoom is the passenger taking over" | Implemented and verified for the wheel, on desktop. The two-finger touch is exercised by no check, and not tried on a phone |
| Never implied to be the bus's lane or the view from on board; report age and estimated wording kept | The mode line reads "street preview · following the bus". "What is this?" says it is a stylised preview from above the road, neither the view from on board nor the bus's lane. The ride card keeps "Estimated position · last report N s ago" | `ride.spec` front-view check; the frames | Implemented and verified |
| An expanded map, if it fits cleanly | **Make the map bigger** in the map's tools: the same map fills most of the screen, and goes back | `access.spec` "the map can be made bigger…", desktop and phone: the same canvas, drawn at the new size | Implemented and verified |
| No duplicate location actions | One Locate me at a time: the walk guide's while it asks for the location; otherwise the map's, or the stop panel's beside the simple map | `access.spec`, desktop and phone, on three paths: a stop found by name and then located, a stop found near you, and the simple map | Implemented and verified |
| Slow loading: useful bus information and a simple-map option while tiles load | "Drawing the map…"; after 3 s, **Use the simple map**, whole on the first screen. The stop, walk guide, bus card and lists work meanwhile, and the detailed map can come back | `access.spec` with every tile 8 s late, desktop and phone, with screenshots | Implemented and verified |
| Compare before and after on the same segment, theme and viewport, through a straight, a turn and a correction | `scripts/probes/front-view.mjs` | Night, desktop and phone, before and after; day, after only | Done. Playback reviewed as measured samples and frames; the video was not watched |
| Say whether the front view still adds little | — | The frames | It is better, but adds only a little. Kept secondary: outside is the default, and it is not a trial task |

# A temporary HTTPS preview for the phone trial

14 September 2026, afternoon. Authorised by the owner: a free Cloudflare Quick Tunnel, with no paid
hosting and no domain. Measurements are in `docs/LOCAL_VERIFICATION.md` under "A temporary HTTPS
link for a phone". The evidence comes from the public address in this machine's Chromium: emulation,
not a physical phone.

| Requirement | Implemented behaviour | Evidence | Status |
|---|---|---|---|
| Commit and push the completed fixes, without `public/data/live.json`, credentials or unrelated files | 424de5c: 13 named files | Pushed to `main` (25a4a72..424de5c); only `live.json` left modified | Done |
| A free Quick Tunnel from WSL, from the official distribution | cloudflared 2026.9.1, the binary Cloudflare's downloads page links, SHA-256 checked, in `~/.local/bin` | Registered over QUIC through London | Done |
| The latest production build through the existing Caddy arrangement: `out/`, and `/data/*` from `public/data`; neither the repository nor `next dev` exposed | `scripts/preview.sh`: `deploy/Caddyfile` unchanged, bound to 127.0.0.1:8098. `pnpm start` rejected, because it would serve the data copied at build time | `deploy/validate.sh` passed with Caddy 2.11.4. Listening on 127.0.0.1 only. 15 private paths return 404 through the tunnel, traversal spellings included | Implemented and verified |
| Reuse a healthy collector, or start one bounded 60-minute run; keep the single writer | Checks the writer lock first; none was held, so one run was started | Started 14:49:29 BST; every cycle succeeded. A second instance reused it rather than starting another | Implemented and verified |
| Leave other processes alone; record how to stop only the preview's | Each process is recorded in `outputs/preview/` and checked to be the same program before any signal. The collector gets SIGINT, so it records its stop | A throwaway second instance: `stop` ended only its own two processes, and the trial preview kept its PIDs and link | Implemented and verified |
| The page, MapLibre's worker, map tiles and runtime configuration load through the public address | — | The probe: page 200, worker 200, 81 tiles with no failures, configuration read, no page errors | Verified |
| Two distinct real publications through the address, without rebuilding; the chosen bus kept | — | SK74BMZ kept through 15:05:52 and 15:06:12 BST, and through 14:56:31 and 14:56:52 on the first run | Verified |
| Location permitted by the page's security headers | `Permissions-Policy: geolocation=(self)` from the Caddyfile | The header arrives through Cloudflare. A secure context whose policy allows geolocation; emulated permission gave a position | Verified in emulation; a real phone's prompt not seen |
| No credentials or private files served | — | The key is in none of the 76 servable files, nor in the 21 addresses fetched through the tunnel; no `/home/` path | Verified |
| Normal service-worker behaviour | Registered unconditionally; data network-first | Activated, and controlling after a reload; the live publications came through it from the network | Verified |
| 360 and 390 px portrait: first screen, bigger map, outside ride-along, street preview; fix clear overlap or clipping | "Ride-along" no longer splits across lines | The frames, REAL and FIXTURE: no overlap, clipping or sideways scroll listed, and the frames looked at | Implemented and verified in emulation |
| Exercise pinch and zoom where the tooling allows; tell emulation from a phone | The camera is left to the fingers while they are on the map | A synthesized pinch: the outside ride-along went 20 → 20.9 and kept following (before, it did nothing); the street preview pauses; a one-finger drag pauses. New phone check in `ride.spec` | Implemented and verified in emulation; a real finger not tried |
| Marston Road (nr), route 15 towards Roedean Gardens; report honestly if no bus is current | — | The outbound pattern calls there, with an accepted road shape and estimates. The page listed 1, then 2, buses coming | Verified; the "no current bus" case did not arise |
| Focused checks, not the full suite, unless a material change requires it | The touch fix is a camera change, so every check that reaches the camera was run, at both sizes | Typecheck, lint, the build, 134 Node tests. Ride, access, selection and journey specs, and the two ride-entering motion checks: 104 passed, 4 skipped by design, none failing (15.1 min) | Verified; the full suite not rerun |

# Passenger feedback: navigation, phones and returning

14 September 2026, evening. The owner reported the feedback; it was not independently validated.
Measurements are in `docs/LOCAL_VERIFICATION.md` under the same heading.
- Browser evidence is Chromium emulation on this machine: FIXTURE unless marked REAL.
- Nothing was tried on a physical phone.

**Inspection and passenger navigation**

| Requirement | Implemented behaviour | Evidence | Status |
|---|---|---|---|
| Inspect first; choose the smallest effective change | The layout and camera probes captured the old build at five sizes before anything changed | The `before/` frames; the findings in the verification notes | Done |
| Passenger navigation: nearby or search, a boarding point and service, a bus to follow, saved stops and routes, an existing selection | The passenger's page is the whole page, with no tabs. Saved stops and routes come first. The journey (stop, service, bus) is restored for 12 hours, as before | `navigation.spec`: no tabs; saved stop and saved route first on return. The layout probe's return visit restored stop and bus at all five sizes | Implemented and verified |
| Evidence and Operations out of the primary navigation, under a named secondary area; an engineering entry for portfolio visitors, discoverable from the README | **Behind the data**: a four-step account (collect, check, publish, freshness), a "right now" line, and Operations, Evidence and Recorded journeys, each at its own address. The README's "For reviewers" section | `navigation.spec`: entry, focus, three views, direct addresses, Back. `evidence-motion.spec` reaches Evidence through the new entry | Implemented and verified |
| Explore renamed if it is archive replay; its date and replay mode visible; archive never shown as live, and no silent switch to replay | Explore was the 11 September archive replay. It is now **Recorded journeys**, with "ARCHIVE REPLAY · Recorded 11 September 2026, 08:00–08:10 BST · historical observations, not live". The passenger's archive mode stays an explicit, badged choice | `navigation.spec`: the note and its date. `passenger.spec`: the Follow view's archive badge | Implemented and verified |
| Switching between the passenger and engineering views never replaces the bus, stop or journey | The passenger's page stays mounted, hidden and `inert`; its scroll position and focus are restored | `navigation.spec` round trip, after 12 s away: the same stop, the same bus still chosen, still riding, the same map canvas. The layout probe's round trip at all five sizes | Implemented and verified |

**Phone usability**

| Requirement | Implemented behaviour | Evidence | Status |
|---|---|---|---|
| A useful first screen with a clear primary action | The page no longer waits for the recording, and there is no tab row. On phones the "your bus" strip is above the map, the walk guide asks for a location in one quiet line, and the heading stands down on short screens | `navigation.spec`: the search is there before a recording held back 10 s, and the page works with no recording at all. The frames at 360 and 390 px and in landscape | Implemented and verified in emulation |
| Readable stop names, destinations, report ages and service relationships | The wording is unchanged; the answer ("N stops before yours · age") is on the first screen | The frames | Verified by eye on FIXTURE and REAL frames |
| Comfortable touch targets and visible keyboard focus | The header link and saved chips are 44 px targets. Focus moves to the engineering title, and back to the control that had it | The layout probe's audit: no target under 24 px apart from links inside a sentence. `access.spec` keyboard journey. `navigation.spec`: the title takes focus | Implemented and verified in emulation; a screen reader not tried |
| Search usable with the on-screen keyboard | On a touch screen the field rises to the top when it takes focus | `navigation.spec`: the first three matches above a keyboard-sized cut. The probe at 360 and 390 px | Implemented and verified in emulation; a real keyboard not tried |
| Controls reachable around browser bars and safe areas | Side gutters at least the safe-area inset (`viewport-fit=cover`); the footer clears the home bar | CSS only | Implemented; unverified: Chromium here cannot emulate a notch or home bar |
| Entering and leaving the expanded map without losing the selection | Unchanged, now checked | The layout probe: the same bus after bigger and smaller, at all sizes. `access.spec`: the same canvas | Verified |
| Clear loading, unavailable, stale and offline states | The recording no longer blocks the passenger's page. Polling pauses while the page is hidden, and fetches at once on return or reconnection | `navigation.spec`: reconnecting fetches within 3 s. `access.spec`: slow live data and slow tiles. `passenger.spec`: the states | Implemented and verified (suite count below) |
| Saved choices easy to find | "Saved on this phone" at the top of the start panel, for stops and routes | `navigation.spec` | Implemented and verified |
| Fewer redundant panels, repeated explanations or controls | Saved routes are listed once, not twice. The walk guide's second sentence is gone. A malformed file is contained in place instead of crashing the page | The frames. `navigation.spec`: the malformed evaluation | Implemented and verified |
| Landscape layouts: fix clear overlap or clipping | On short screens the ride notes sit in a row and the card is compact; the card had covered "Front view". On phones the "your bus" strip no longer sticks over the map | `navigation.spec`: the ride's controls uncovered, upright and on its side. The probe's centre check at all sizes | Implemented and verified in emulation |

**Ride-along and data honesty**

| Requirement | Implemented behaviour | Evidence | Status |
|---|---|---|---|
| The outside ride-along the default, the street preview optional; one vehicle and one motion state in both; no restart, reset or jump when switching | Unchanged; now checked | Camera-switch probe, FIXTURE before and after, and REAL (MF74NPD): at each switch the drawn bus moved within one sample's travel, the report age carried on, and the bus stayed the same | Verified in emulation |
| Reproduce and fix "moves outside, freezes only in the street preview" | Not reproduced. A missed finger lift can no longer hold the camera still: the count is ignored after 8 s | Camera-switch probe: the street preview's camera was still in 0 of 29–31 moving samples, REAL and FIXTURE | Not reproduced in emulation; a physical phone is needed |
| Observed, estimated and recorded kept apart; report age visible; new-journey confirmation; no automatic replacement; gestures and reduced motion respected; the three distances | Unchanged | `selection.spec`, `ride.spec`, `motion.spec` and `journey.spec` in the full run | Verified (suite count below) |

**Returning on a phone**

| Requirement | Implemented behaviour | Evidence | Status |
|---|---|---|---|
| Manifest, app name, icons, launch address and display mode | `id`, PNG icons at 192 and 512 px plus a maskable 512 px, and a 180 px Apple icon (iOS ignores SVG). Start address `/`, standalone, portrait | The built files; the icon looked at | Implemented; installation on a phone not tried |
| Installation advice suited to the browser, never for an address that will disappear | Beside saved stops: Safari's Share, then Add to Home Screen; or the browser's menu; or an Install button where the browser offers one. On a temporary address, a note that it is not worth installing | `navigation.spec`: the temporary-address note on 127.0.0.1 | Implemented; the stable-address wording and the Install button not exercised, since no stable address exists |
| Service-worker updates and network freshness | Everything under `/data/` is network-first at any depth. Hashed files come from the cache; other files are served from it and refreshed. The cache version was bumped, so the old cache is cleared | `tests/sw.test.mjs`: 3 new cases. The public probe: publications came through the worker from the network, none from the device cache | Implemented and verified |
| Recovery after backgrounding, screen lock and connectivity changes | Fetches on becoming visible, on `pageshow` and on `online`; polling paused while hidden | `navigation.spec`: reconnection | Reconnection verified in emulation; backgrounding and screen lock on a phone not tried |

**Hosting, the preview and research**

| Requirement | Implemented behaviour | Evidence | Status |
|---|---|---|---|
| One concrete hosting recommendation with verified recurring costs, persistent storage, collector supervision and public-feed freshness monitoring; the exact remaining decision | `docs/HOSTING.md`: a CX23 at €5.49 plus IPv4 at €0.50 net, at Hetzner's June 2026 prices. Storage measured. systemd and the watchdog. A Healthchecks.io dead man's switch | Official pages read on 14 September; the backup price could not be read | Done. The decision: approve £6–8 a month, a domain, and the alert account |
| Keep the preview usable; leave other processes and the collector lock alone | The same link throughout; one bounded collector, started through the script, running until about 18:14 | `scripts/preview.sh status` | Done |
| Research React Native and Metrolink without implementing either | Section 11a of the redesign research | The official MapLibre React Native docs; TfGM's open data page and data.gov.uk record | Done; not implemented |

**Verification**

| Requirement | Evidence | Status |
|---|---|---|
| Typecheck, lint and build; targeted checks; broader checks where the change risks regressions | Typecheck, lint, the build and 137 Node tests pass. The whole browser suite (208 checks) ran on the final build: 182 passed, 24 skipped by design, 2 failed. One failure was a wrong test locator; corrected, `navigation.spec` then passed 18. The other failed identically on the previous build, so it predates this milestone; its helper now brings the bus into view, and `selection.spec` then passed 23 | Verified. No physical phone, GPS, screen reader or battery check was done |

# Milestone checklist: journey state, navigation and the stop board (20 September 2026, evening)

One row per requirement in the owner's brief. FIXTURE evidence uses test data on real stops; LIVE
names the deployment (`5701dae`, https://lost-minutes.duckdns.org). The whole browser suite ran once
on the first build (201 passed, 24 skipped, 19 failed); every failure was re-run on a build carrying
its fix and passed (`journey-state`, `journey-context`, `journey`, `walking`, `access` and the
front-view check of `ride`), desktop and phone. Eight of the nineteen predated this milestone
(PROJECT_CONTEXT, 20 September evening).

| Requirement | Implemented behaviour | Evidence | Status |
|---|---|---|---|
| Fresh visit to the base URL shows search, favourites and recents, not a stop | A device journey is an offer chip; the address stays bare through publications | `journey-state.spec` "a fresh tab only offers…" (address `''` after 2.5 s); LIVE `/` checked after deploy | Done |
| Saved stop must not become a permanent selection | Only a link or the tab's session applies a stop | same spec; `journey-state.test` precedence cases | Done |
| Compact "continue previous journey" | One chip with stop, bus or filter, and a forget button | `[data-continue]` assertions; screenshot `home-offer.png` | Done |
| Active journey preserved through refresh, Maps return, backgrounding | sessionStorage per tab; reload restores silently with no note | `journey-state.spec` reload; Maps return and backgrounding are the same tab (not exercised on a phone) | Partial: phone unchecked |
| New journey clears selection and URL, keeps favourites and recents; cleared state must not resurrect | `clearJourney` empties both stores; page sets stop and journey to none; address `/`; reload and 3 publications later still bare | spec "New journey clears everything…" | Done |
| Shared links honoured with filters visibly represented | Filter chip pressed and labelled "Clear filter"; a filter no service has is said in a notice | spec "a link names a journey…" | Done |
| Predictable Back/Forward | Stop choice pushes; popstate applies the address's stop, filter and bus; hash moves leave the journey alone | spec Back/Back/Forward sequence | Done |
| Changing stop removes incompatible filters; old bus must not dominate; never silently substitute | Filter cleared; pin kept only where it calls, else released with a notice; nothing chosen instead | spec Stop E kept / Stop F released | Done |
| Bus in a link is a journey, not a vehicle | Four-part key `operator|vehicle|route|direction`; two-part still read | `journey-state.test`; spec outbound-link case reads "another journey" | Done |
| Diagnose Hillingdon Road (opp) route 15 on a frozen publication | `scripts/trace-stop.mjs`: one timetabled service, the only inbound 15 six stops past | trace output in PROJECT_CONTEXT (20 Sep evening) | Done |
| Unavailable predictions, withheld scheduled time, missing preview never remove buses | `stopBoard` reads relations only; those features read rows | by construction (`lib/journey.ts`), `journey.test` | Done |
| All serving services by default; filters obvious and removable; hidden count stated | Chip with × and "Clear filter" name; "Show all services · N more" under the list; empty state names the filter | spec filter case; screenshot `filter-hides.png` | Done |
| Distinguish empty states with next actions | five kinds: no reports / filtered / old / feed / no coverage, each with an aside and actions | `emptyKind` in `follow-view.tsx`; spec covers filtered; others by inspection of wording | Partial: only "filtered" browser-checked |
| Compact hierarchy; non-serving bus not a giant card | Card for a non-serving bus drops motion, walk, claims, schematic and distances | spec: card under 420 px, `not-serving-compact.png` | Done |
| Walk info compact; keep Update my location, sticky manual origin, Maps by coordinates | Answer, actions row (route button only with a location, "Google Maps" by coordinates), one disclosure; start controls open only while the start is missing or in doubt | `walking.spec` 18 passed on the final build (opening the disclosure where the start is confident); `access.spec` slow-map offer whole on the first phone screen | Done |
| Predictable Back after "Change" | Change pushes an entry marked intermediate; the next stop choice replaces it | `journey-state.spec` Back/Back/Forward; reproduction log `outputs/probes/repro/repro-back.mjs` | Done |
| No "leave in X minutes" | none added | — | Done |
| No new paid services; collection, watchdog, nightly, rollback untouched | no pipeline or deploy change in this milestone | `git diff --stat` | Done |

