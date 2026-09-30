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

## 35. The front view's roads are half the width they are said to be — fixed 27 September 2026

Found 26 September 2026 while correcting a probe's metres. `components/city-map.tsx` converts metres to
pixels with `METRES_PER_PIXEL_Z0 = 156543.03 × cos(lat)`, the scale of a 256-pixel tile. MapLibre's world
is 512 pixels at zoom 0, so the true figure is half that. Every road class in the front view is drawn at
half the width `ROAD_METRES` names: a primary road meant as 9 m is 4.5 m.

**Fixed**, with the owner's permission: "my approval of the previous appearance was not a request to
preserve a calculation error". One function, `metresPerPixel` in `lib/scale.ts`, serves every caller,
the camera-eye diagnostic and the probes included. It is checked against what the map draws in
`fleet.spec`, to within 2%. The before-and-after frames, matched by the bus's place on the road, are in
`docs/MILESTONE_2026-09-27_ROADS_MEMORY_REASONS.md` §1.

## 36. Small things seen on the phone, left for now

Seen on 26 September 2026 reviewing the everyday screens at 390 px
(`outputs/probes/everyday-flows/after-preview/`):
- the sheet handle truncates "Stretford Mall (Stop A) · 2 coming" to "· 2…";
- the chosen bus's progress appears both in the card's sticky head and in the answer block below it;
- departure rows name the operator by its code ("BNML"), which means nothing to a passenger;
- in the front view, now that the kerb has its real width, its outer edge steps in by about 2.5 CSS px at
  one place on the fixture road (27 September 2026, `outputs/probes/front-view/roads-compare/`). It moves
  with the ground, and it is not a vector-tile edge or a change of road class. Most likely it is a joint
  between two OpenStreetMap features of the road; the cause is not established.

## 37. A phone on its side at 667 px: controls over controls

Seen on 27 September 2026 while checking the map's credit on its side: at 667 × 375 (an iPhone SE) the
two-column layout leaves the map a 250 px column. There, the legend chips ("Suggested bus", "5 buses")
and Ride along overlap the tool column, and the ride-offer chip ("Reported positions · may pause ·
Front view") is cut short at the column's edge. The credit itself is clear of them (it takes two lines
there, with the foot a line higher), and 740 px and wider are clear. Not changed: it is the layout of
the whole column, not the credit.

## 37a. A journey with a change: what is left open (28 September 2026)

- Two changes are not planned; journeys needing an operator not held are not found (said so).
- The transfer allowance (2 min; 7 with *More time to change*) is a stated default, not measured.
- Accessibility of a change (crossings, steps, a station's layout) is not in the data and is said to
  be unknown.
- The card's rows are the timetable's; a tracked first bus's own lateness is not used to shift its
  arrival, because no per-bus timetabled time is trusted where the clock is unverified (574 of 576
  patterns). A verified clock with a bound bus could offer "running about N min late": an evaluation
  first, never a release by default.
- ~~Direct buses in the list carry no time~~ — done the same afternoon: timed from the boards, every
  bus between the two stops, ordered by arrival with the last walk; one pair of stops per pattern, so
  no variant is lost before timing (`docs/MILESTONE_2026-09-28_RELIABILITY.md`).
- **The connection search keeps one first bus per pair of services before timing.** Keyed per pattern
  it would find a further first-bus variant in 22 of 393 sampled pairs of places, and narrow the
  services among the timed candidates in 26: a trade-off, left as it is until the candidates are
  chosen some other way than by distance.
- **Beyond the 48 connections timed**, 1–2 of 194 sampled pairs of places still had a sooner one
  (`scripts/audit-planner-candidates.mjs --cut 48`). The cut was 8 until 28 September (34–48 of 194).
- **An overshoot is not refused**: a first bus carried past the destination and a second bringing the
  passenger back (Piccadilly Gardens → Withington Golf Club: the 103 to Moor End, then the 43). Ranked
  by arrival it falls behind the direct buses and is folded beside them; a rule would refuse a second
  leg that heads back towards the first leg's route.
- ~~The list's times use the provisional walk~~ — done the same afternoon: the listed options' walks
  between stops are checked before the list is shown (up to 6 s, a second apart), and an answer after
  the choice is offered with *Use this*, never substituted.
- **The walks to the first stop and from the last are estimates** (the straight line × 1.3); a bus
  under 2 min after the walk is marked tight. Checking them would send the passenger's start to the
  router, which this page does only for the walk guide, on request.
- Watch both: see the milestone record.

## 38. A road shape's stop offsets are read by the pattern's stop index — fixed 28 September 2026 (evening)

`lib/arrival.ts` read `track.stops[stopIndex]`; `makeTrack` drops the offsets a shape could not
place (and any at or beyond its length), so from the first missing stop on, the index named the
wrong stop. Found 28 September 2026 while drawing a journey's legs; the legs measure their stops onto
the road instead.

**The same fault was in the evaluation pipeline, and it mattered there.** A shape's offsets cover only
the stops inside the service area; inbound 15 starts 14 stops outside it, and `pipeline/passages.py`
read its 47 offsets as the pattern's stops 0–46. Every inbound passage was named after the stop 14
earlier, so the inbound arrival evaluation was invalid and the schedule anchor judged inbound 15's
timetable 15 minutes early: its timetabled times were withheld on it from 20 September, and the
planners said so to passengers on 28 September. Fixed on both
sides with one rule, the offsets put on the pattern's own indices and a road that does not line up
refused (`arrivalTrack` on the page, `placed_offsets` in the pipeline), and held by the parity check
on both route-15 patterns (`docs/MILESTONE_2026-09-28_ARRIVAL_PILOT.md`, sections 1 and 6).

**Replaced the same night by an explicit mapping** (`docs/STOP_MAPPING.md`): each shape names every stop it
was built through by its index, code and offset (version 2), recovered for the 560 published shapes from
their stored routing requests and checked against their geometry (all 15,960 stops within 15.7 m). No
reader infers from list position or from today's stop list any more; old and new files are refused rather
than mixed.

## 39. The nightly rebuild's memory peak is growing with the warehouse — fixed 29 September 2026

**Measured and fixed.** Sampled by phase on the server's own inputs, the peak was DuckDB's buffer pool
filled to its 1 GB limit by the scan of every observation for the services seen, and held through the
build: 1,107–1,117 MB resident. At `LM_DB_MEMORY_LIMIT=512MB` the same inputs peak at 654 MB and build a
byte-identical catalogue, 5 s sooner; capping glibc's arenas made no difference. The unit's ceiling is
unchanged, and the peak no longer grows with the warehouse. Each step's resident peak is now recorded and
shown in Operations beside the unit's total, which counts page cache
(`docs/MILESTONE_2026-09-29_CORRECTIONS.md` §4).

**The first scheduled run on it (29 September):** no OOM event in its journal. Its largest single process, the
timetable build, peaked at 599 MB resident. The whole job, with the page cache the 1.15 GB warehouse copy
filled, reached its 1,500 MB ceiling; the kernel takes that cache back first. The 599 MB is one process, not the
job's use.

How much the job waited on memory then is unknown: a unit's counters go with its cgroup. From 30 September
each run records them (`memory.events`, `memory.pressure`), and Operations says both figures by name
(`docs/MILESTONE_2026-09-29_CLOSEOUT.md` §3). Kept below for the record:


The server's journal gives the rebuild of 27 September a **1.4G memory peak** over 4 min 12 s, against
the unit's `MemoryMax=1500M` (systemd's figure for the unit's cgroup, which counts page cache: the
unit also copies the 0.9 GB warehouse for the evaluation). The rebuild's own resident peak, measured
here on a copy of that warehouse with the server's settings (`LM_DB_MEMORY_LIMIT=1GB`, two threads,
`MALLOC_ARENA_MAX=2`), is **1.12 GB**; it was 853 MB on 18 September. Page cache is reclaimed before
the ceiling kills anything; resident memory is not, and it grows with the warehouse. A kill would fail
the rebuild safely (the last catalogue stays, Operations says so), but nightly. The likely costs are
the selection of observed services, which scans every observation, and the parse of 662 TransXChange
files; not yet separated. Measure them apart, and if it is the scan, keep a small table of observed
services the collector maintains. Until then read the peak after each run
(`journalctl -u lost-minutes-refresh | grep 'memory peak'`).

## 40. Arrival minutes: a display band and a criterion on predicted minutes — settled as a frozen protocol, 29 September 2026

**Settled differently from the step below:** the thresholds are kept and read on the exact moments a page
would show an estimate (`docs/ARRIVAL_DISPLAY_PROTOCOL.md`, protocol `display-1`, frozen before the first
confirmation day). On the revision days both directions fail (outbound 1.70/4.00 min; inbound coverage
2.1%). The confirmation, 29 September to 5 October, is collected nightly and read once; nothing is shown
without the owner's exact approval. What would change the outcome is a revised model or display, judged by
a new confirmation after it. Kept below for the record:


The release criteria are read by the actual minutes before a bus passed the stop, known only
afterwards; a page can choose what to show only by its own predicted minutes. On outbound 15's held-out
days (21–27 September) the criteria pass (median 1.20, p80 2.48 min) but the moments a page would show,
predicted 2–10 min, read median 1.57 and p80 3.79; predicted 2–5 min passes (1.20, 2.94). So the
outbound pilot was not enabled on 28 September. Choosing a band now would be choosing it on the
held-out days. To settle it: write down a display band and a criterion on predicted minutes, measured
as the page shows them (from the page's clock, the report some seconds old), and judge it only on
nights from 29 September; the nightly verdict already reports `shownBand`. Inbound 15, validly
evaluated from 28 September (entry 38), passes both ways (1.10 and 2.19; shown band 1.27 and 2.76) and
is withheld on the owner's instruction. `docs/MILESTONE_2026-09-28_ARRIVAL_PILOT.md`, sections 2–3.

## 41. A schedule anchor for a pattern whose first stops are outside the area

The anchor checks a timetable's clock at a pattern's first ten stops. Inbound 15's first fourteen are
outside the area we collect, so since the fix in entry 38 it is unchecked: its timetabled time is
withheld and the planner times it as an unchecked service. Read at its first ten *observed* stops it is
+2.61 min on 1,461 passages (21–27 September), inside the 3-minute tolerance, as outbound's are at its
first stops (+2.59). Whether that may count as the check is the owner's decision; it would show inbound
15's timetabled time at stops and in the planner's wording. `scripts/schedule-anchor.py`.

## 42. The nightly evaluation re-scores the whole warehouse every night, and grows toward its ceiling — solved 29 September 2026

**Solved:** the nightly unit now scores each complete day once, under the display protocol, from at most 14
days of extracted inputs, and keeps each day's per-journey histograms (the evidence a release needs, in
full); the server's anchor reads a 14-day window. The old full re-scoring is gone from the unit. Kept below:


`lost-minutes-arrival-eval` scores every day the warehouse holds, each night, and the release check
reads every night's stored errors. Measured here on the server's copy (resident memory, one process):
scoring 2 days 404 MB, 4 days 433 MB; the nightly run over 8 days 598 MB (684.5M for the unit's cgroup on
the server, 28 September). The nightly file adds about 1.5–2 MB of stored errors a day (four arrays a
direction since 28 September, for the criteria and the shown band); the release check reads 8 days in
96 MB. At roughly 20–26 MB more for each day of data, the unit's `MemoryMax=1500M` is reached in about six
weeks, early November 2026. A kill would fail the evaluation safely (nothing is released without an
approval) and Operations would show it, but nightly. Fix when next worked on: score only the days not
yet scored by the current model (the nightly file is already keyed by day and model), and store the
pooled errors compactly (a fine histogram per direction keeps the quantiles to 0.01 min). Until then,
Operations shows each night's peak against its ceiling.

## 43. Failures with DuckDB and heavy Python computation in one process: not reproduced, cause unresolved

**Seen (28 September 2026).** The display evaluation read a warehouse copy with DuckDB 1.5.5 on Python 3.14.4 and
scored in the same process. It failed at random in 4 of 17 runs: a float where a range iterator was expected,
"'float' object is not an iterator", `max` not found as a builtin, and a segmentation fault. With DuckDB never
loaded, 12 of 12 ran identically.

**Investigated (29 September; `docs/MILESTONE_2026-09-29_CLOSEOUT.md` §2).**
- **Not reproduced with the recovered code and the available fixed inputs; the cause is unresolved.** The
  warehouse snapshot the failures ran on is not available: the same file was rewritten later that evening.
- The recovered failing code, on the inputs still held and the same interpreter build and extension, ran in
  131 fresh-process trials across seven configurations without one failure or wrong result:
  - as it ran;
  - under the debug allocator;
  - with the CPUs saturated;
  - on DuckDB 1.5.6;
  - on Python 3.12.
- The results were byte-identical everywhere.
- DuckDB remains suspected, from one evening's runs (failures only with it loaded, 4 of 17 against 0 of 12), not
  shown to be the cause.

**Kept:** the evaluation's two processes (`scripts/extract-arrival-inputs.py`, `scripts/evaluate-arrival-display.py`
behind a guard). No dependency change, since there is no failure to verify one against.

**Still exposed:** the jobs that compute with DuckDB loaded (the collector, the rebuild, the passage audit, the
anchor). Their crashes are loud and recorded; a silent wrong value would not be caught, and none has been seen.

**Next:** run `scripts/probes/duckdb-inprocess.py` before any Python or DuckDB change, and again if a nightly job
ever fails without a cause.

## 44. A shared bus link sometimes says "Drawing the map…" for 25 s over a drawn map — fixed 29 September 2026

**The fault (28 September 2026, the served site, 390 px emulation, one route-42 bus by link).**
- **How often:** of 21 loads, 6 counted the map as painted at 26.9–27.1 s, one at 8.2 s, and 14 at 2.8–3.4 s.
- **Where the 26.9 s comes from:** "ready" at about 2.7 s, plus the 25 s fallback that stands in for MapLibre's
  first `idle`.
- **What the passenger saw meanwhile:** a pill saying the detailed map was slow, offering the simple map, over a
  map already drawn and working.
- **Stop links** painted in about 3 s every time.
- **What it was not:**
  - aborted tiles: the slow loads had none or two, like the fast ones;
  - slow requests: none took over 3 s;
  - this release: the map's code had not changed.
- **The cause:** `idle` also waits on every bus source and every label fade, and the fleet's buses update many
  times a second.

**Fixed** (`components/city-map.tsx`). The map now also counts as drawn at the first rendered frame at which all
of these hold, whatever the buses and labels are doing:
- the page's first framing has been made;
- the camera is at rest;
- the basemap's own tiles for that view are all in, with at least one arrived.

The failures and fallbacks are unchanged, and the diagnostics a check reads are written at that frame, as they
are at idle.

**A first version was wrong and was caught by the browser gate.** It counted the map as drawn by its basemap
alone, at the opening city view, before the page framed the chosen stop:
- two fleet checks read a camera still on its way and failed;
- on a slow network it would have taken away the note, and its offer of the simple map, while the stop's own
  tiles were still coming.

**Measured on the refined rule:**
- *Fixture, 120 moving buses in view:* drawn in 2.3–2.4 s, against 3.0–3.2 s at the first `idle`
  (`tests/browser/paint.spec.mjs`).
- *Map-start, access, paint and fleet specs:* 42 passed, 12 skipped by design.
- *Real data* (`scripts/probes/paint-compare.mjs`), two live bus links, 25 loads each way:

  | build | not drawn within 20 s | drawn in |
  |---|---|---|
  | served build | 3 of 25 | 2.1–2.8 s otherwise |
  | this build, fed the served site's own data | 0 of 25 | 1.2–2.1 s |

After the deploy the served count is in `docs/MILESTONE_2026-09-29_CORRECTIONS.md`.

## 45. The ride's bus hidden inside a building — fixed 29 September 2026 (evening)

**Reported from the owner's phone, on the served site (`b507302`).** A screenshot on the night map:
- an X41 "to Arrival Stand" ridden near Victoria Station Approach and Long Millgate;
- "Front view · this bus is not placed" and "Last reported position · 60 s ago";
- the lime ring and the route number were drawn, but no bus inside the ring, only a sliver under a dark block.

The owner's words: "Bus is riding under buildings".

**The cause, measured in the map's own tiles** (`outputs/probes/x41/`, not in Git):
- *Where the camera stands.* The ride frames the bus at zoom 20 and pitch 60. At the phone's canvas height that
  puts the camera about 49 m behind the bus and 28 m up.
- *What was there.* On Victoria Station Approach, heading south-west, that point is inside or behind the 30 m
  station building for the last 40 m of the approach. The buildings came from the OpenFreeMap vector tiles
  themselves, decoded with rings classified by winding.
- *Why the ring and number still showed.* The bus's body is a fill-extrusion, and shares the depth test with the
  buildings, so a building in front of it hides it. Its ring and number are symbols, which are drawn over
  everything.
- *Why this bus.* A bus with no checked road (LNUD has no timetable here, so it is not placed) is drawn between
  its reports, and nothing keeps the camera out of buildings on any bus.

**Fixed** (`components/city-map.tsx`):
- *Detection.* While the body is shown (zoom 18 or more, tilted, outside view), the page asks MapLibre every
  250 ms, and whenever the camera comes to rest, whether a building is drawn over the bus's own ground point.
  The check is `queryRenderedFeatures` in a 6 px box on the building layer.
- *The fade.* While one is, every building fades to 0.3 opacity. The theme's own opacity (0.88 by day, 0.78 at
  night) returns once the bus has been clear for 800 ms, so the edge of a building does not flicker the city.
- *Drawing order.* The buses' bodies are now drawn beneath the building layer, so the faded building shows them.
  Opaque, the buildings hide what is behind them as before.
- *Why the whole layer.* OpenFreeMap's buildings carry no ids and are merged into multi-polygons, so a single
  building cannot be faded on its own.
- *The front view is unchanged:* its buildings stay at full opacity, and the bus's own body is hidden there.
- *Diagnostics:* `data-bus-occluded` and `data-buildings-opacity`.

**Verified** (`tests/browser/occlusion.spec.mjs`; FIXTURE publication, real basemap tiles and buildings). An X41
approaches B (53.48731, −2.24354) at heading 237°:

| check | before the fix (`b507302`) | after the fix |
|---|---|---|
| lime pixels of the body in a 40 px box at its ground point, day | 0 in all 4 runs | 190–200 desktop, 756–800 phone |
| the same, night map, switched while hidden | — | 178 desktop, 549 phone |
| a bus on the fixture's open road | not occluded | not occluded, theme opacity kept (0.88 / 0.78) |

The frames are in `outputs/probes/x41/frames/`:
- before, the whole map is the building's tint;
- after, the bus, Hunts Bank and the station's outline are readable through it.

**Not measured:** how often a real ride's camera stands in a building across the fleet. Emulation only; the
owner's phone is the check that matters.

## 46. Both nightly runs recorded as "by hand", and Operations calling both jobs overdue — fixed 30 September 2026

**Found** on 30 September, checking that night's scheduled runs. Both succeeded on their timers, and both were
recorded as `manual`; "last scheduled run" stayed on 29 September, so from 05:44 UTC (the rebuild) and 06:12 UTC
(the evaluation), 27 hours after the last run recorded as scheduled, the served Operations view marked both jobs
**overdue**, falsely. Judged with the page's own function on the served file at 14:36 UTC: `overdue: true` for
both.

**The cause: the check of `b507302` read a value that is stale by design.** That fix (29 September) had judged a
run the timer's only if the elapse systemd hands the service, `TRIGGER_TIMER_REALTIME_USEC`, fell in the ten
minutes before the run started, because a run started by hand had carried the timer's old elapse. On systemd 259
a timer's *later* firings carry the elapse **before** this one:

| run, 30 September | started (journal) | the timer's own `LastTriggerUSec` | elapse handed to the service | recorded |
|---|---|---|---|---|
| rebuild | 02:43:07.600 UTC | 02:43:07.388 UTC | 1790649865599264 = **29 Sept** 02:44:25.599 | manual |
| evaluation | 03:12:46.771 UTC | 03:12:46 UTC | 1790651522178785 = **29 Sept** 03:12:02.179 | manual |

The handed values were read from the services' `ActivationDetails` over D-Bus after the runs. Reproduced with
transient timers on the server, each running `date; env | grep TRIGGER`:
- a timer's **first** firing carries its own moment (an `OnActiveSec` timer, and a persistent calendar timer:
  43 ms and 27 ms before the shell's clock);
- a persistent calendar timer firing every minute: the first firing at 14:34:01.4 was handed 14:34:01.385; the
  **second**, at 14:35:01.9, was handed 14:34:01.385 again, the first's.

So the elapse in the environment can never tell a timer's second night from a run by hand the day after, and the
test written on 29 September ("the timer, as it fires") encoded the first firing only.

**Fixed** (`pipeline/jobs.py`): the timer itself is asked. Its `LastTriggerUSec` is the moment it last fired, which
a run by hand does not move, and `systemctl show --timestamp=unix` gives it to the service's own user without
privileges (verified as `lostminutes` on the server). A run is the timer's only if `TRIGGER_UNIT` names a timer and
that timer fired between 60 s after and 600 s before the run started. The environment's elapse decides only where
the timer cannot be asked, and `TRIGGER_UNIT` alone where there is no elapse either. What each judgement rested on
is now kept with the attempt (`triggerEvidence`: the unit, the elapse handed, when the timer last fired), because
this fault could not be traced from the record and took four probes on the server.
- `tests/test_jobs.py`: the 30 September case (yesterday's elapse handed, the timer fired now: `timer`; the same
  details thirteen hours on: `manual`; the timer unaskable: as before) and the reading of `LastTriggerUSec`.
  13 of 13; the full Python suite 187.

**The server's records of 30 September are not corrected.** The same correction as on 29 September (the timers'
own last-fired moments written into the two records under the lock, with a dated note) was refused by the
assistant's permission rule for writes on the server, and is left for the owner; the exact command is in the
release record. Until then, or until the next scheduled runs (1 October, about 02:43 and 03:12 UTC) record
themselves under the deployed fix and move "last scheduled run", Operations reads **overdue** on both jobs.

## Explicitly not doing
- Spark, Kafka, a warehouse cluster or an orchestration platform for a dataset this size.
- An AI feature added to claim AI engineering. A model earns its place or stays out.
- Background location tracking, or any promise of continuous coverage.
- A second hosted prototype. One repository, one site.
