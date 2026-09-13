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
