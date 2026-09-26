# Backlog

Ideas worth keeping, in priority order, with the reason each is not being built yet. Nothing
here is implemented. The point of this file is to stop good ideas becoming scope creep.

## 1. Real live capture against BODS  — blocked on a credential
Everything is built and tested with fixtures. One registered key turns it on. Until a real
capture has run, no claim about live operation is made anywhere in the interface.

## 2. Somewhere to run the collector — needs a decision
The pipeline is a single local process. To be useful to a passenger it has to run while the
owner's laptop is closed, and the published objects have to be served from a host that is
not GitHub. Options and trade-offs belong in one decision, not in drip-fed infrastructure.
Not started: no paid service should be provisioned before the cost is written down.

## 3. Validated route and stop relationships — the gate for every measurement
Needed before ETAs, nearby stops, approaching-bus claims, headways or travel times can be
honest. Requires matching dated journeys to a timetable version and validating ordered route
geometry. Timetable storage with declared effective dates already exists; matching does not.

## 4. Corridor travel time with an interval, not a point estimate
Two fixed gates on one validated corridor, each crossing bracketed between consecutive
observations, published as a conservative interval with its uncertainty and coverage. Rejects
ambiguous loops, large gaps and unmatched directions. Depends on item 3.

## 5. Time–distance chart beside the map
Once route progress is validated, the geometry of the chart shows bunching and spreading
without a word of explanation. Depends on item 3.

## 6. Retention and storage budget for accumulating raw captures
Raw responses are a few megabytes each. Continuous collection needs a retention policy and a
recorded storage cost before it runs for weeks. Depends on item 2.

## 7. Alerting on freshness and volume
One notification channel fed by the existing run metadata: failed publication, stale source,
observed volume away from a baseline. Deliberately after item 2, because there is nothing to
alert on until collection runs unattended.

## 8. Smaller published state for mobile data
`replay.json` is 1.6 MB. The live state is small, but the archive replay is not. Worth
splitting per route, or serving a compact binary, once there is real traffic to measure.

## 9. Accessibility audit against a checklist
Contrast pairs were checked and touch targets are 44px, but no screen-reader pass, keyboard
trap audit or reduced-motion review against a formal checklist has been done.

## 10. Withhold the estimate while a bus's own reports show it standing — owner's decision
Reproduced on 21 September 2026: motion-3 (`standingHold: 0`) carried a standing route-15 bus
81–103 m past its report and snapped back 179 m, then forward 177 m. The `standingHold`
candidates (15/20/30 s) were scored against the fixed criteria in `docs/MOTION_MODEL.md` and do
not qualify (fewer backward snaps, more forward ones). The smallest safe change is an
*abstention*, not a model: when `speed.standingNow` is true (`lib/motion.ts`) and no hold is
configured, return the last report in observed mode with the reason "its last reports show it
standing", so the bus travels between its reports as any observed bus does and the estimate
resumes at the first moving report. Cost: one report's delay (about 20 s) after a stand. It is a
one-clause change plus a Node test and `motion.spec`'s standing check; measured with
`scripts/evaluate-frozen.mjs` it would count as abstention. Not done: the owner decides.

## 11. Run the archive import on the server once
The Operations view's two archive-replay rows read "not checked here" because the server never
published the replay it serves. One `pipeline.run import` with the collector paused (the refresh
unit's pattern) would make them checkable. Needs the 11-snapshot download on the server.

## 12. Small operational follow-ups from 21 September
- `pipeline.shapes build`: record the lines requested in the run note and the index, and flush
  the per-pattern log line (`print(..., flush=True)`), so a batch that fails part-way is visible.
- `deploy/publish.sh` and the refresh: print the served catalogue's `generatedAt` and service
  count beside the local one's after each.
- "reports too far from the routed road" is now the largest geometry gap (121 vehicles on one
  publication, BNSM 192's main patterns at 100–120 m): a per-line look at whether the router's
  road or the matcher's reports are wrong.

## 13. Build the road shapes where the catalogue is built
The server's nightly catalogue outgrows the locally built shape index (30 patterns without an
entry on 22 September, 16 the day before). A `shapes build` on the server after the refresh, on the
server's own reports, with the same acceptance rule. Router load and memory to be measured first.

## 14. Departure lists per pattern in the catalogue
The board can name a timetabled next departure only from a matched bus. Publishing each pattern's
journey departure times (TransXChange `DepartureTime`, already parsed) would let the board list
the next timetabled departures at any stop — gated, as now, on the schedule anchor being verified
for that pattern, which today is outbound 15 only.

## 15. NextBuses by TransportAPI: an evaluation that needs a key
Free tier 30 requests a day (JSON, `expected_departure_time` and `source` per departure), which is
enough for a quota-aware evaluation at Hillingdon Road both ways and a few other stops, not for a
live board. Needs an account and its `app_id`/`app_key` on the server (never in the browser), a
server-side cache and a bounded budget. Pricing above the free tier could not be verified (the
plans page 404s). Owner's decision.

## 16. A bottom sheet on the phone — **built on 22 September 2026**
Done: three heights (handle, half, nearly full), a drag and a button, the map's controls kept
clear, and the handle as the panel's title. `docs/MILESTONE_2026-09-22_WORKSPACE.md`.

## 17. Score movement per route on the server, nightly
As the arrival evaluation already runs nightly on the server's snapshot, score the frozen motion
model per route on its own captures against the fixed criteria, and publish the result the page
gates on. Coverage would then keep itself current instead of waiting for a manual export.

## 18. Every bus on the map with no stop chosen
The home map draws the buses of the route being browsed, so the map and the list say the same
thing. A newcomer might rather see the whole fleet moving, which is the strongest thing this
project has to show. It needs a rule for what the panel then lists, a measurement of the cost of
drawing 400–600 markers on a phone, and a way to keep tapping a bus meaningful. Not started.

## 19. A type scale in rem, so a browser's larger-text setting works
The interface's type is in pixels, so a reader who enlarges text in their browser's settings gets
nothing; only page zoom works. Moving the scale to rem touches every component and needs its own
pass at every viewport. Not started.

## 20. Alternatives that name the same route three times
When a chosen bus starts another journey the panel offers other buses as "Follow 192 to Piccadilly
Gardens instead", once per vehicle, so the same words can appear three times in a row (seen on the
served site, 22 September 2026). They are different vehicles; the label does not say so. It needs a
line that tells them apart — how far off each is, or how long ago it reported — and probably a cap.
Not started.

## 21. A 256 placed on the wrong pattern, and then on none
Reproduced from the retained captures of 22 September 2026 (`pipeline.replay_publications`). On its
first publication as a 256 outbound to Towns Gate, MF74NNL was matched to
`BNML:256:outbound:cde495c44d`, whose destination display is Stretford Mall, while
`BNML:256:outbound:7d555419a1` is the Towns Gate pattern and the feed's own `DestinationName` said
Towns Gate; from 20:37 the match became `too_far_from_pattern` and stayed there for the rest of the
run. Neither pattern has an accepted road, so nothing was drawn on a wrong road, but a match that
disagrees with the operator's own destination is worth tracing: either the destination is not being
used to separate the two, or the Towns Gate pattern does not reach where the bus actually goes.
Trace it with `pipeline.assess_matching --at` on that window. Not started.

## 22. Live departure minutes, if the owner decides to pay for them
`docs/DEPARTURE_DATA.md` has the research: NextBuses (now TransportAPI) is the only practical
source for Manchester, at £5 a month plus a £10 setup fee for 300 requests a day, with caching and
public display explicitly permitted. The scheduled board shipped on 23 September 2026 needs no
provider; a live one needs an account, a key on the server and a request budget enforced in our own
code. §4 of that document is the serving design. **Waiting on the owner's decision; nothing is
built, nothing is paid for.**

## 23. Leaving the front view can leave the map a few degrees off flat — fixed 24 September 2026
Found on 23 September 2026 by a check that had been passing by luck. Leaving the ride asks for a
fit that returns the map to flat, and `fitBounds` works its camera out from the bounds without
carrying a pitch, so whenever two or more things were framed the map kept the ride's tilt —
measured 2 of 3 runs on a phone at **21.2° and 35.9°**, on that build *and on its parent*, so it
predates this milestone. The fit now eases to a camera from `cameraForBounds`, which does carry the
pitch, and the ride's heading is no longer applied in the frame or two after the ride ends while
`input.view` is still stale. Together those take the residue to **0.6–3.0°**, with one run of four
still at 24.9°.

What is left is specific: it needs about four seconds *in the front view* before leaving. Leaving
after about a second returns to flat every time, and leaving the outside view returns to flat
immediately (3 runs of 3, `outputs/probes/repro/exit-pitch.mjs`). So it is an ease interrupted by
something the front view's own per-frame camera leaves behind, not the fit. `ride.spec.mjs`'s
"leaving the ride returns the map to flat" holds the assertion at full strength and names this
entry; it is a red line that describes an open defect, not a flake. Not fixed.

**24 September 2026:** on the build that plays a bus's reports back on a clock (`PLAYBACK`), the
same sequence — a standing bus, Ride along, Front view for 3.8 s, Exit — returned to flat within
300–400 ms in **13 of 13 runs** on the phone profile (`docs/MILESTONE_2026-09-23_SHEET_PACING_DISCOVERY.md`
§7), and the full-strength check passed. A plausible cause is that a standing bus no longer asks
for a frame every tick once its clock has reached its newest report, so the front view's per-frame
camera is not still being set after Exit; that is not proved. Kept open as *not reproduced on this
build*; the physical-device checklist keeps its item.

**24 September 2026, midday — reproduced again, and measured across builds.** The finished-flow
pass (milestone §8) saw the check fail once in a focused run (19.8°), so it was repeated: 1 of 6,
then on the next build 5 of 10 (residues 5.2°, 8°, 17°, 43.9°, 69.1°). A probe that patches
MapLibre's camera methods in the page and logs every call after Exit
(`outputs/probes/milestone/exit-cam.mjs`, git-ignored) returned to flat in **32 of 32** runs on the
same build — serial, three pages at once, with tracing on — and showed the exit sequence in full:
the Exit tap's own pointer-up starts a fast "return to bus" glide (the map container's handler,
which finishes an entering or returning glide on a tap) a millisecond before React processes the
click; the view effect eases to flat; the ride effect stops the camera, resizes (MapLibre's
`resize` stops the camera again when it is not moving), clears the padding, sets the pitch limit
and starts the fit's ease to pitch 0; MapLibre's own ResizeObserver resizes once more while that
ease runs. Under the test runner (`workers: 1`, serial) the same build then failed 1 of 10, and the
**previously deployed build 103e4a8, rebuilt and run back to back under the same runner, failed
4 of 10** (58.1°, 67.5°, 67.5°, 27.8°). So the residue predates this pass and is not made worse
by it; it appears under `playwright test` and not under a plain Playwright script on the same
build, which points at the runner's polling of the page (the `expect` attribute checks) rather
than at the camera code, and the mechanism is still not proved. The check keeps its full-strength
assertion. Next step, if it is taken up: a `data-camera-calls` diagnostic on the map (the last few
camera actions of our own code, tagged), read by the check on failure, so a failing run under the
runner says which call cut the ease short.

**24 September 2026, afternoon — found and fixed.** Two claims in the paragraph above are
withdrawn. The first camera call after Exit was *not* a return-to-bus glide; and the cause was *not*
the runner's polling. The failing check itself was copied with every MapLibre camera call and every
publication after Exit logged, and run under the runner on the deployed build
(`outputs/probes/milestone/exit-diagnose.spec.mjs` and its log, git-ignored). Every failing run had a
publication fetched within 400 ms of Exit (41, 166, 179, 397 ms); every passing run had none, or
one after 700 ms. In each failing run the call that stopped the hand-over's ease to flat was
`easeTo({center, duration: 450})` from the effect that brings the frame to a new report outside
it, made *while the map was moving* (at 68.4° and 44.9°). An ease by centre alone carries no pitch,
so the map kept whatever tilt it had reached — which is why the residue was anything from 5° to
69°. The earlier probe passed 32 of 32 only because its own five-second wait moved Exit away from
the ten-second poll. Landing a publication inside the hand-over on purpose failed 9 of 10.

The fix is in that effect alone (`components/city-map.tsx`): a new report never starts a camera
move while the camera is already moving — the move was asked for, whether the hand-over, a fit,
City's tilt or a gesture — and is judged once the camera is at rest (`moveend`); and on leaving the
ride it does not chase at all, because the hand-over's fit frames the bus. The same effect could
equally stop City's 0.9 s tilt partway (measured on the phone: 6–7° of 58°). Four checks in
`ride.spec.mjs` land a publication inside the camera move on purpose, so the case the poll hit by
chance is hit every time: leaving the front view and leaving the outside view, each on both
profiles (on the deployed build, all four failed); City's tilt on the phone (failed); and leaving
the front view under reduced motion, where there is no ease to interrupt and which checks the
hand-over itself. Each hand-over check asserts the ride off, flat and north up, the phone's
full-screen ride layout gone, the Ride along button back, and your stop and your bus on the map.
The original check keeps its assertion unchanged. On the final candidate (`2c00759`, deployed) the
full browser suite passed 358, 38 skipped by design, none failing, and on the served site the map was
flat after Exit with a publication landed in four of four runs (desktop and phone, with and without
reduced motion). Closed.

Not changed, and the same shape: *Follow on the map* in 2D or City re-centres on each new report
with an ease by centre and zoom, which a report landing during City's tilt could also cut short
while following. It is a separate path from leaving the ride and was left for its own fix.

## 24. More recorded rides, and one on an evaluated route
One recording is published (the 163 of 23 September 2026, on an accepted road, so the front view is
there but movement is reported positions). A ride on route 15, 250 or 256 would show estimated
movement; cutting one is one command from a reel of that window's captures
(`scripts/make-recorded-ride.mjs`). The index carries any number; the section lists them all, so
more than three or four would need a chooser.

## 25. The search's matches cover the map's view buttons while the keyboard is up
By design the matches lie over the map so the keyboard does not push them off screen, and the
layout probe reports the 2D, City and Fit journey buttons as covered while they are open (three
controls, down from eight before the sheet). Escape or a tap outside clears them. Left as is.

## 26. Street-level imagery in the front view — a decision
The owner asked for actual Manchester street visuals in the front view (24 September 2026).
Researched: **Mapillary** (CC BY-SA 4.0, good coverage in cities; the Graph API needs a client or
user token, and its documentation says a client token in a browser query string is "strongly
discouraged", so the honest design is a small server route on the Caddy host holding the token
and answering "the nearest image ahead of this point on this road" — the same pattern as the BODS
key; search calls are limited to 10,000 a minute per app); **Panoramax** (open, keyless STAC API,
CC BY-SA; the API returned five pictures for central Manchester and one for the wider area, so no
coverage to build on); **Google Street View Static** (paid per image). The design would show one
dated photo from the road ahead beside the front view, labelled with its date and contributor —
not live, not the bus's view. **Needs the owner to create a free Mapillary developer app and put
its token on the server**, like the BODS key; nothing is built until then.

## 27. The road ahead, lit, in the ride-along
With the drawn bus now on its checked road, the stretch of road ahead of it (the next few hundred
metres of the accepted shape) can be drawn as a soft lime ribbon under the ride, with the next
stop's name on it — a cue that this is *its* road, and part of the "wow" the owner asked for. Cheap:
the trail source already carries a per-frame line for the estimate; this is the same for the
observed playback's `buffer.roadS`. Not done in the pacing milestone so the pacing could be gated
on its own.

**24 September 2026, later: built.** `lm-road-ahead` draws the next 320 m of the checked road from
the drawn bus in the ride's outside view, only where the drawn bus is on that road (an estimate's
`s`, or a playback stretch measured onto it); the next three pattern stops are named on it outside
as well as in the front view. Two browser checks: the ribbon appears on entering the ride and goes
on leaving, and a bus with no checked road gets none.
`docs/MILESTONE_2026-09-23_SHEET_PACING_DISCOVERY.md` §8.

## 28. Buses that report every two or three minutes
The fleet check (`scripts/evaluate-fleet-playback.mjs`) lists 23 of 334 vehicle-journeys in the
evening reel drawn standing while their reports moved more than 150 m: almost all report 9–16
times in twenty minutes, so every pair is a silence over 45 s and is refused (a repositioning, said)
rather than travelled. Honest, but such a bus is a poor ride. Whether to travel a silence up to,
say, 90 s along a *checked* road (the road between two on-road reports is known, only the timing
is not) is a question for the drawing's rules, with the fleet check as the judge.

## 29. A quick drag during the ride's entrance glide can be read as a tap — classified and fixed, 25 September 2026

**Classified on evidence, not by re-runs.** Six passing re-runs said nothing about why it failed. With
the browser's CPU slowed six times (Chrome's own throttling) the check failed 3 of 3 on the deployed
build and passed 3 of 3 at normal speed: a product fault on a slow device, not a test race. The drag is
now known from the pointer itself (more than 6 px with one pointer down, outside the front view, where a
finger turns the head), and MapLibre's late report of the same drag is ignored by its event time, so it
can no longer cancel a Return to bus that follows — the second race the first attempt exposed. A pinch
still zooms and keeps following (a first version counted the pinch's moving finger as a drag; the phone's
pinch check caught it). `ride.spec`: the drag with the CPU slowed six times, then Return to bus to the
zoom-20 framing, both profiles; 12 of 12 in the reproduction. What follows is the original entry.

**26 September 2026: a third way to end short, fixed.** The gate on the phone profile ended "following" at
zoom 14.2 again. The glide itself had been stopped part way by a camera move the ride did not start,
MapLibre acting on its own. A stopped glide ends with "moveend" like an arrival, and was taken for one.
A key's pan during the glide reproduces it 6 of 6. A glide now counts as arrived only at its framing,
and a short one ends with a cut to the framing (`returnToBus()` in `components/city-map.tsx`). The new
check in `ride.spec` reproduces it. Still open: on the phone profile MapLibre sometimes holds a ride's
glide still for 1.1–1.8 s while reporting itself moving (seen on a bearing-less ride's entry and on a
return after a drag); the cut now ends those, but the cause is not known.

Seen twice in focused browser runs on 24 September 2026 (`ride.spec.mjs`, "a drag as the camera goes
to the bus ends the glide"), passing in isolation and in the full gates either side. The ride learns
that a pointer gesture was a drag from MapLibre's `dragstart`, which MapLibre fires on its next drawn
frame; during the entrance glide at street level a software-rendered frame can take longer than a
quick drag (the check's is 240 ms), the release arrives first, and the gesture is taken for a tap —
the ride finishes its glide to the bus instead of letting the passenger look around. Reading the drag
from the pointer's own movement fixed that and exposed a second race: MapLibre then processed the late
drag after the ride had gone to *exploring*, and Return to bus ended at zoom 14.9 rather than 20. The
change was withdrawn so the incident fix shipped alone. On a real phone the symptom is mild — a
glance-around at the very start of a ride is ignored — and a fix needs the late drag cancelled too.

## 30. "Off its checked road" said where a bus is drawn along it, at termini and on loops

Where two reports on a bus's road go backwards along it — a stand at a terminus, a loop route whose
start and end share a street — the road does not join them, so the stretch between them is drawn as
a straight line and the card says the bus is off its checked road, even where that line lies within a
few metres of the road. Measured on 25 September 2026 (`scripts/evaluate-fleet-playback.mjs`, the
off-road-label measure): 47 of 334 buses at some moment on the 22 September evening reel and 122 of
767 on the incident reel, down from 90 and 193 before the standing-bus fix. Traced on a 325 at its
terminus (reports 12–21 m off the road going back 20 m along it) and a loop whose road runs 3,730 m
from the same spot. Candidate: say "at its stand" or "moving between its reports" there rather than
"off its road", when both ends are on the road and the line keeps within the road's own tolerance.
Not started; it is wording and a rule, not a position fault.

## 31. Estimated movement in the ride jumps — done, with the owner's approval, 25 September 2026

The owner approved report-based playback for every ride on 25 September 2026. Every ride is drawn from
the bus's own reports however it is entered; the estimate stays on the map, labelled, where the
evaluation allows it; arrivals and their criteria are unchanged. `docs/MILESTONE_2026-09-25_ONE_RIDE.md`
has the account and the measurements. What follows is the original entry.


Found on 25 September 2026 by `scripts/evaluate-ride-offers.mjs`, which rides every bus Try Ride-along
would have offered, at every publication of two recorded reels, for three minutes at the site's 20 s
poll. The list put estimated-movement buses (routes 15, 250, 256) first, and their rides were clean
over those three minutes **3 of 159 and 4 of 219 times**: a stated repositioning in 119 and 120 of
them, a step over a bus length in one frame with nothing said in 40 and 58, no heading in 55 and 93.
Traced on a 250 inbound (MF74NNW, 22 September, 21:15): repositioned 230 m after 20 s and 181 m after
40 s, then eased 90–134 m corrections every 20 s. The estimate predicts from reports that reach a
phone 32–45 s old; every publication pulls it back hard. The same buses drawn between their own
reports, as every other bus on a checked road is, were clean 76 of 159 times, with 15 jumps. And the
front view's check that a 60 m correction to an estimate is absorbed smoothly fails 2 runs in 6 on
`5c00509`, `cd711a3` and `1a53e48` alike (the eye at 28–29 m/s): intermittent, and older than this work.

Try Ride-along no longer offers these buses. A passenger who chooses one at its stop and rides it still
gets the estimate. **Recommended:** in the ride, draw every bus between its own reports, and keep the
estimate for the map at a stop, where it stands nearer to now. The card would say "drawn about N s
behind" rather than "Estimated position". It restates the ride's estimated-movement checks
(`ride-offer.spec`, `motion.spec` and several in `ride.spec`). Not done without the owner's word,
because estimated movement was approved as a feature on 13 September 2026.

## 32. What still moves a ridden bus against the way it faces

Measured on 25 September 2026, late evening, by `scripts/evaluate-delay-rewind.mjs` over every bus in
two reels (11.7 million frames), after the re-anchoring and standing-goal fixes (`docs/RELEASE.md`,
top). None of it comes from the playback's rewind. Frames and metres in all, evening and incident reels:
- **The nose lagging round a tight bend at speed** (38 and 113 frames, 25.6 and 76.3 m): the bus goes
  forwards along its path and its facing turns at a bus's rate behind it (a 191 at 14 m/s round a
  roundabout). A faster turn allowance at speed, bounded by the camera's, would close most of it.
- **Eased corrections onto a changed path with a backward part** (4 and 9 corrections, the largest 3.8
  and 6.6 m): under a bus length, eased at about 10 m/s, and not said on the ride card, where only
  repositionings are said. Either say a correction over 8 m on the ride card, as the estimate's detail
  does, or hold a bus the new path puts behind until the path catches it up.
- **A hop at a joint between two stretches** (2 and 3 frames, up to 6.0 m, unsaid): a straight stretch
  ending at a report and a road stretch starting on the road beside it (a 23 at 15:33, two reports at one
  spot). The stretch that ends at the report should end where the next one starts.
- **Following reports that step back, no road** (1 and 20 frames, up to 0.7 m a frame): a 281's reports
  went back 6.5 m in 10 s and it followed them; the held-report rule applies only on a checked road.

Also still open from the one-ride milestone: the 25 sprints of 3–4 s after a stand (15 and 10 events)
and the heading lags pulling out of a stand (6 and 18).

## 33. Every bus on the map — built, 25 September 2026 (night)

The owner, riding the deployed `a63006b` from a bus link with no stop chosen, saw one bus on the whole
map: the map drew only the chosen bus's route (or, at a stop, that stop's board), each at its newest
report, stepping to the next every poll. Every phone already receives the whole publication (234 buses
on the served site that evening, 229 with a trail to play back), so nothing more is fetched.

Built (`lib/fleet.ts`, `components/city-map.tsx`): every bus in the publication is on the map, each
drawn from its own reports exactly as the chosen bus is (the same PLAYBACK, one drawing everywhere),
only those in view played back each tick, the rest standing at their newest report until they come
into view; the passenger's own buses (the stop's board, the route) drawn a size stronger than the rest;
route numbers from neighbourhood zooms; a tap on any of them chooses it, and the drawing is handed over
so the bus does not move when chosen (and handed back when it is not); from a street zoom their checked
roads are loaded, a few at a time; from the model's zoom the nearest twelve are 3D buses in a muted
livery, so in the ride the buses passing are buses; a mouse over one names it; the legend counts them;
under reduced motion every bus stands at its report. The fleet's tick is timed (`data-fleet-ms`) and its
state written (`data-fleet`). Verified in `tests/fleet.test.mjs` and `tests/browser/fleet.spec.mjs`;
the measurements are in `docs/RELEASE.md`.

Open: a real phone's frame rate and battery with a city of buses moving (SwiftShader measures the
JavaScript, not the GPU); the other buses' eased corrections are not said anywhere (the chosen bus's
card says its own); trails or route lines for the other buses (deliberately not drawn: their roads are
loaded only for movement); Metrolink is still not here.

**26 September 2026, afternoon: the other buses' repositionings are marked, and a journey change is no
longer a cut.** Two route-192 buses at the Piccadilly terminus stepped 54 m and 108 m in one frame on the
served site. The fleet had given each a new drawing when it started its next journey. The drawing is now
carried across, with the previous journey's reports in front of the new ones. Every repositioning of
another bus is drawn as a dashed trace for 6 s, and the hover tip says so. On two recorded reels the
cuts over 3 m in 100 ms went from 141 and 130, all unmarked, to 108 and 88, all but one marked; the one
left is a 6 m hop at a path joint (backlog 32). `docs/MILESTONE_2026-09-26_PREVIEW_AND_JUMPS.md` §1.

## 34. The view from above: what it needs, and what is open

Built 26 September 2026 (`docs/PHOTO_3D_RESEARCH.md`, `components/gods-eye.tsx`): Manchester as
photographic 3D (Google Photorealistic 3D Tiles, rendered by CesiumJS from this site's own copy) with
the map's own buses on it, opened from *Explore Manchester*, offered only where the server's
`config.json` carries a `photo3d` block. Checked against a sample tileset, never against the imagery.

Needs the owner: a Google Maps Platform key with billing (1,000 root tileset requests a month free,
then $6 per 1,000; one request per opening of the view; the daily quota is the bound), and an answer to
the terms' *no use with non-Google maps* question before the view goes public (`docs/PHOTO_3D_TERMS.md`).
Since 26 September 2026 the key alone opens only a password-protected preview; the public page needs
`LM_PHOTO3D_PUBLIC=1` too (`docs/PHOTO_3D_PREVIEW.md`). Built that afternoon and so no longer open:
failures said by cause (quota, refusal, no answer, failing tiles, an ended session), the closer and
higher follow, the imagery's age said apart from each report's, Google's logo, terms and privacy
notices, the frame's identity with the map's, and a harness for the first look
(`scripts/probes/above-imagery.mjs`). Then, in order:
- **Look at the imagery** at the two camera heights in the city centre, at Trafford Bar and in
  Stretford, and at the low follow: if the mesh reads poorly from 95 m up, raise the follow, and keep
  the map's street preview as the low view rather than force this one.
- **Buses on the roads, not in them**: the ground under each bus is measured against the mesh once a
  second; check the clamp on real tiles (bridges, the Mancunian Way, tunnels), and the box's heading
  against the road (the box is 12 m along its y axis, turned by the drawn heading).
- **A phone's frame rate and battery** with the tiles streaming: nothing here was measured on a GPU.
- **Network transfer** of the tiles per minute of following; and the renderer's 6 MB (1.5 MB gzipped)
  on first opening, which the service worker should cache by version.
- **From the ride**: a *From above* button in the ride's bar, so a ride can be switched to the view
  and back without leaving the bus; the map already hands the drawn frame over.
- **Stops and the road ahead** on the imagery: the chosen stop as a marker, the next stops named, as
  the outside ride has them.
- The 3D bus is a box; the map's stylised model (`public/models/lm-bus.json`) could be built as one
  Cesium entity of boxes for the chosen bus.

## 35. The front view's roads are half the width they are said to be

Found 26 September 2026 while correcting a probe's metres. `components/city-map.tsx` converts metres to
pixels with `METRES_PER_PIXEL_Z0 = 156543.03 × cos(lat)`, the scale of a 256-pixel tile. MapLibre's world
is 512 pixels at zoom 0, so the true figure is half that. Every road class in the front view is drawn at
half the width `ROAD_METRES` names: a primary road meant as 9 m is 4.5 m. The widths were judged by eye
at the time, so a fix doubles what was approved. The fix is one constant, but the owner should see the
before-and-after frames first. Not changed yet.

## 36. Small things seen on the phone, left for now

Seen on 26 September 2026 reviewing the everyday screens at 390 px
(`outputs/probes/everyday-flows/after-preview/`):
- the sheet handle truncates "Stretford Mall (Stop A) · 2 coming" to "· 2…";
- the chosen bus's progress appears both in the card's sticky head and in the answer block below it;
- departure rows name the operator by its code ("BNML"), which means nothing to a passenger.

## Explicitly not doing
- Spark, Kafka, a warehouse cluster or an orchestration platform for a dataset this size.
- An AI feature added to claim AI engineering. A model earns its place or stays out.
- Background location tracking, or any promise of continuous coverage.
- A second hosted prototype. One repository, one site.
