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

## 23. Leaving the front view can leave the map a few degrees off flat
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

## Explicitly not doing
- Spark, Kafka, a warehouse cluster or an orchestration platform for a dataset this size.
- An AI feature added to claim AI engineering. A model earns its place or stays out.
- Background location tracking, or any promise of continuous coverage.
- A second hosted prototype. One repository, one site.
