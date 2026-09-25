# Lost Minutes — project context

Working context for anyone (or any assistant) picking this up. Status words are used
strictly: **Implemented** exists in the code, **Verified** has an executed check behind it,
**Planned** does not exist yet, **Unknown** has not been established.

Last updated: 25 September 2026, morning (the route-43 incident fixed and deployed as `5c00509`; a
standing 216 called off its road, standing buses turning on the spot and a terminus loop drawn backwards,
each found by riding the served site and fixed; and Try Ride-along made to offer only clean rides, after
a replay of every offer found 2% of them clean: deployed as `a82abfb`).

**23 September, late evening — the sheet, the pacing, and a way in to Ride-along.** Detail and
evidence: `docs/MILESTONE_2026-09-23_SHEET_PACING_DISCOVERY.md`. Three reports from the owner's own
phone, each reproduced before it was changed.
- **The sheet had two clocks for one threshold.** Its expanded height was `100dvh − 200px` in CSS
  and the drag's snap to it `72% of innerHeight` in code; with Safari's bars on a 390 × 844 phone
  those are **464 px and 478 px**, so no upward drag could ever register as expanded, and every one
  fell back to half. Emulation has no bars (644 and 608) and every check passed. Reproduced at
  390 × 664 with real touch events, then fixed with one source: `lib/use-sheet-viewport.ts` measures
  the visual viewport and writes the three rest heights for both the stylesheet and the drag; the
  sheet is fixed to the visual viewport (above the keyboard on iOS), a flick goes to the next state,
  and a labelled control — **Open full list** / **Show map** — does what the drag does.
  `tests/browser/sheet.spec.mjs`, 8 of 8 on the phone profile: the drag reaches full and stays,
  through list scrolling, three publications, a location update, a fit, and the keyboard.
- **The ride was paced by arrival, not by the bus.** A phone gets reports 10–40 s after they are
  made and often two in one publication, so the drawn bus sprinted through the pair and stood until
  the next poll: on 27 recorded journeys replayed with a phone's arrival jitter, **moving in 57% of
  frames with 59.7 stalls over 5 s an hour**. `PLAYBACK` draws the bus where its reports put it a
  bounded **20–40 s** ago on a steady clock (the median observed lag + 8 s; 0.8–1.2× by buffer
  depth; never backwards): **73% moving, 18.6 stalls an hour, 3 steps over a bus length against 33**,
  all three refused gaps and said; the cost, stated on the card, is a median **113 m** behind the
  newest report. The 163 in the owner's screenshot (BNGN 3426, journey 1147, 20:48–21:15 UTC),
  rebuilt from the server's captures and played through the page: ride-along **88% → 92%** of frames
  moving, longest pause 20.4 → 15.5 s, largest step 3.47 → 1.97 m; the two pauses left are the bus
  standing (a new report arrived at the same coordinates). Reduced motion unchanged.
- **Try Ride-along** (`components/try-ride.tsx`) replaces the explore section: what the ride is in
  one line, up to three buses whose ride is certain now in order of what it can be — *Estimated
  movement · Front view*, *Reported positions · may pause · Front view*, *Reported positions · may
  pause* — and choosing one starts the ride at once, with no stop. **A recorded ride, dated**, when
  nothing live suits: the 163 journey above, cut from the reel by `scripts/make-recorded-ride.mjs`
  (46 publications as published, hashes and matches intact, 82 KB / 13 KB compressed, cut to the
  moving 15 minutes of the journey and saying so), replayed in
  place of the feed by `lib/recorded-ride.ts`, badged RECORDED RIDE on the bar, the handle, the panel
  and the ride card, never written into the journey stores, shared as `?ride=<id>`, left by one
  action. `try-ride.spec` 10/10, `recorded-ride.spec` 6/6.
- **Less friction on the phone:** the board's heading carries **Scheduled · not live** in the same
  badge as its rows and the bar says *LIVE · positions updated*; a bus with no current report is
  *Last seen 21:17*, **Stop following**, Details; one age on the card; the handle's controls and two
  21 px links are 44 px; the map-drawing notice no longer sits under the view buttons.
- **Found on the way:** a raw NUL byte in `lib/journey-context.ts` since 20 September (grep called
  the file binary); fixed. Backlog 23 (return to flat on leaving the front view): see the record.
- **The gate found one real defect in the new drawing** — an 877 m shift under the bus eased as a
  "smooth" correction in two seconds — now a said repositioning past the drawing's 150 m snap
  distance, and an ease at about 10 m/s under it, with a Node test.
- **24 September, from the deployed site: the bus beside its road, and the pace.** Two screenshots
  (the recorded 163 on Rochdale Road, a live 142 on Wilmslow Road) showed the bus drawn 15–35 m
  beside its road — the road travel carried each report's own offset across the stretch — and the
  owner still saw "too fast, not really fast". The playback is now a **path** through the reports,
  on the checked road where both ends of a stretch measure onto it (the bus drawn *on* the road,
  headed along it; the recorded 163 within 0.4 m of it in every frame), a **causal cubic** whose
  stretches never change once played, the place shown **averaged over the previous 24 s** because
  the reports' own timing is jerky (a real 219: 207 m in 24 s, 16 m in 17 s, 345 m in 28 s), and a
  **follower at a bus's pace** (1.0 m/s² accelerating, 1.5 braking, never over 22 m/s, at most 12%
  over the reports' speed) on a clock at real time, 30–60 s behind. Three wrong versions on the way
  were each caught by a measurement, not by eye. Against the glide, same reports and jitter:
  **79% of frames moving** (57%), **19.1** stalls an hour (59.7), speed p95 12.3 m/s (16.2), 3 said
  repositionings (33 unsaid steps), 65 m behind the newest report at the median. Every bus in the
  22 September evening reel replayed with its own road (`scripts/evaluate-fleet-playback.mjs`,
  334 vehicle-journeys, 118 with a checked road): the 20 s speed swing a passenger sees down from
  8.7 to **6.0 m/s** at the median bus, none drawn over 21.8 m/s, a bus on a checked road never off
  it, **65 repositionings all said and no unsaid step over a bus length** — the fleet check is
  what found four of the faults, each on one bus among the 334. `docs/MOTION_MODEL.md` has the
  rules; backlog 26–28 hold the imagery decision, the road-ahead idea and the slow reporters.
  **Verified:** 219 Node; the drawing's nine browser specs 134 passed / 4 skipped; the full gate
  **335 passed, 36 skipped, 3 failed in 52.5 min** — the tile host once (passed alone), and two
  checks whose fixtures stood still until the test began (restated), one of which exposed that a
  stray tap on a boarding-point sign during the ride chose the stop and ended the ride: **signs
  now stand down while riding**. The walk on the deployed site then found the recorded ride paused
  because its own vehicle was live that morning on another journey and had been pinned first: the
  live feed is cleared when a recording starts and the ride is pinned from the recording only.
  **Deployed as `103e4a8`** and walked on the served site with that vehicle still live: the
  recording follows from its first frame, 0.0 m off its road at the 95th percentile, *drawn 30 s
  behind*. Emulation only. **Verified:** 219 Node tests, typecheck and lint; the full browser gate on the
  final build **344 passed, 46 skipped by design, 4 failed in 51.9 minutes** — the four being two
  checks on both profiles that encoded arrival-timed drawing and the uncompacted card, restated
  with the reason beside each and re-run on the same build (`docs/MILESTONE_2026-09-23_SHEET_PACING_DISCOVERY.md`
  §6 has the account, including a first gate thrown away by a second run of my own). Emulation
  only; the physical-device checklist has the sheet, the keyboard, Try Ride-along and the recording.

- **24 September, night — the route-43 incident** (`docs/MILESTONE_2026-09-23_SHEET_PACING_DISCOVERY.md`
  §10). A route-43 ride on the served site appeared to teleport and sat across its road. Reproduced
  from what that browser had (the request log: the deployed build, the 43's road, four polls) and the
  collector's captures rebuilt on the server with its own catalogue. Separated: the reports were sound
  but four ran 26–44 m to one side for two minutes (GPS pushed aside — two other 43s crossed the
  stretch within 20 m of the road, every bearing agreed with it); the drawn bus faced the *next*
  report's bearing, 90–100° across its road, or none (a token); the ride camera took that heading every
  frame and turned 77–140° in single frames — the "teleport"; a tab shown again moved the bus 125 m
  unsaid; the delay crept to 75–90 s. Fixed in `lib/motion.ts`: the drawn bus faces its path and turns
  at a bus's rate, a report is placed on the road its bearing agrees with, a pause is said and the
  camera cuts, the clock is bounded, the card's delay is measured from the drawn place — and four older
  faults the fleet check found with it. `tests/incident-43.test.mjs`: six assertions on the incident's
  own publications, all failing on `2c00759`. Fleet, two reels: misaligned buses 550 → 10 and 226 → 5,
  one-frame spins 716 → 0 and 278 → 0, unsaid moves 1 → 0. A first reading (another street) was wrong
  and is withdrawn in the record. **Verified:** 231 Node, 131 Python, the full browser gate 362 passed,
  38 skipped, none failed; **deployed as `5c00509`**.
- **25 September, early morning — a standing bus** (same record, §10, "The served check"). Riding two
  live buses on the served site after that deploy: a 192 was right; a 216 standing at Piccadilly
  Gardens 3.4 m from its road read "Off its checked road", faced nowhere (shown from above) and the
  camera swung 69° when a heading appeared. Cause: two reports at one spot on the road were drawn as a
  line off it with no direction. The fleet check, now meeting buses halfway and measuring turning while
  standing still, found scatter at stands turning buses round on the spot, up to 180° in 5 s, and 33–49
  buses on their road with no heading. Fixed: two reports a bus's length apart on the road are one
  place on it; a shorter line gives no heading; a bus turns only as it moves (15° a metre while
  creeping, up to 60° from 1 m/s); the ride camera turns at most 120° a second; the from-above note
  reads what is drawn. Fleet: buses on their road with no heading 33 → 0 and 49 → 0; turning over 20°
  while still 110 → 20 and 378 → 67, worst 180° → 37°; corners, positions, delays and repositionings
  unchanged. **Deployed as `cd711a3`**, then ridden on the served site: the incident's own 216,
  standing again, faced along its road; a V1 that had been a token called off its road was right; a
  263 on its terminus loop faced over 100° off its movement — my own one-place rule drew two reports
  leaving the road as backing along it, and 15° a metre lagged its U-turn. Both fixed and replayed
  from its captures. Four Node and two browser regressions, each failing on the build before.
  **Deployed as `1a53e48`** (365 passed; the one failure an estimated front-view check that fails 2 in 6
  on `5c00509` too).
- **25 September, morning — suggested rides made clean** (same record, §10). The owner asked that any
  suggested ride be clean. `scripts/evaluate-ride-offers.mjs` rides every offer Try Ride-along would have
  made, at every publication of two reels, for three minutes: **3 of 159 and 4 of 219 were clean**. The
  list led with estimated movement, which jumps (a 250: 230 m after 20 s, 181 m after 40 s), and offered
  standing buses, near-finished journeys and a vehicle called TEST_BUS. Now it offers only a bus drawn
  between its own reports on a checked road, whose last two minutes of reports lie within 12 m of it, go
  forward 80 m or more, come at most 40 s apart and leave 1.5 km: **125 of 159 and 182 of 213 clean**, an
  offer at 124 of 126 moments. The drawn heading now lies along the bus's own length rather than a bus's
  length ahead (a slow bus had faced 114° off its movement into a corner). Estimated movement in the ride
  is backlog 31, the owner's decision. **Verified:** 238 Node, 131 Python, the full browser gate 367
  passed, 38 skipped, 1 failed (backlog 29's race, then 6 of 6); **deployed as `a82abfb`** and three offered
  rides ridden 90 s each on the served site with no repositioning, no lost heading and at most 0.5 s
  facing off their movement. Emulation only.
- **24 September, afternoon — backlog 23 found and fixed** (`docs/MILESTONE_2026-09-23_SHEET_PACING_DISCOVERY.md`
  §9). The failing check itself, with every camera call and publication after Exit logged under the
  runner, showed the cause: a publication fetched within 400 ms of Exit in every failing run, and
  then the effect that brings the frame to a new report easing by centre alone *while the map was
  moving*, which stopped the ease to flat where it stood (68.4°, 44.9°). A new report now never
  starts a camera move while one is running — it is judged once the camera is at rest — and does not
  chase at all on leaving the ride. Four checks land a publication inside the move on purpose (both
  exits on both profiles, and City's tilt on the phone, which stopped at 6–7° of 58°): all failed on
  the deployed build; plus the hand-over under reduced motion. The original check is unchanged. Two
  readings of the morning's probe were wrong and are withdrawn in backlog 23. Driving the hand-over on
  the served site then showed Exit on a phone landing on the full list (Try Ride-along opens it
  there); leaving the ride now brings the sheet back to half. A sheet check that raced a smooth
  scroll (on the build before too) waits for the list to settle; its assertion is unchanged.
  **Verified on the final candidate `2c00759`:** 225 Node, 131 Python, typecheck, lint (no errors),
  the build, CI's built-site checks, and the full browser suite **358 passed, 38 skipped, none
  failed, 56.2 min**. **Deployed as `2c00759`**; on the served site the map was flat after Exit with
  a publication landed, 4 of 4 (desktop and phone, with and without reduced motion). Emulation only.
- **24 September, midday — the finished flow** (`docs/MILESTONE_2026-09-23_SHEET_PACING_DISCOVERY.md`
  §8). Try Ride-along's three rows had been three 250s with every title cut short on a phone; the
  first bus of each service now leads, titles wrap, the recording reads *Recorded ride · to Bury
  Interchange*, and one quiet line under **Buses near me** — *Or try Ride-along* — opens the section
  from the first screen (the sheet opens to it on a phone). In the ride: **the road ahead lit** —
  the next 320 m of the checked road from the drawn bus, only where the drawn bus is on it (backlog
  27, built); the next stops named outside as well as in the front view; the bus three-fifths down
  the clear band so the road ahead has the frame; an entrance that settles (ease-out, 1.1 s) with
  the controls fading in, nothing under reduced motion; Locate me stands down while riding. **The
  delay cannot reach a decision**: coming, near or past is `relateToStop` on the publication's
  newest report, and the drawing is never an input (a Node test and a browser check that holds
  *past your stop* said while the drawn bus is still short of the stop); the card's figure is the
  map's own measurement, now said to five seconds as *drawn about 30 s behind*, held against
  `data-shown` in the same check. The panel's second **Exit** beside the map's is gone. **Verified:** 225 Node, typecheck, lint; the full gate **344 passed, 36 skipped, 6 failed in
  55.8 min**, the six being three older checks on both profiles that read the label's earlier
  *drawn N s behind*, restated and re-run (6 passed). Emulation only. The ribbon was then lifted to half opacity (invisible on an orange primary road at a third) and
  backlog 23's flat-return check, failing intermittently on the way, was measured across builds
  rather than re-run: the previous deploy 4 of 10, this build 1 of 10, under the same runner. Final
  focused run 81 passed / 2 skipped / 1 failed (that check). **Deployed as `4b67dfc`** and walked on
  the served site: three services in Try Ride-along, the recording named, the road ahead lit on
  Rochdale Road, *drawn about 30 s behind* against a measured 30.0 s. Emulation only.

Before that, 23 September 2026 (the ride-along made legible, three silent teleports and a 269 km/h
correction traced and fixed, and the stop answering "when is the next bus?" from the timetable).

**23 September — the ride, the jumps, and the departure board.** Detail and evidence:
`docs/MILESTONE_2026-09-23_RIDE_AND_DEPARTURES.md`; the departure-data research is
`docs/DEPARTURE_DATA.md`.
- **Both reported moments were reproduced from retained evidence before anything was changed.**
  `pipeline/replay_publications.py` loads the collector's own position captures in order and
  republishes after each one, so the sequence of `live.json` payloads a phone was served over a past
  window is rebuilt from the raw bytes: **300 publications for 19:20–21:00 UTC on 22 September**,
  none corrupt or undated. MF74NNL's journey change is **genuine and was verified against the
  reports**, not inferred from an identifier: line, direction, journey reference and destination all
  changed thirty seconds apart, with 114 further reports on the new leg. Its six-minute-old report
  was also true — the vehicle went quiet at 20:44:48 while the feed stayed healthy.
- **"Front view · checking" that never ended.** The state was read from `trackFor === null`, which
  is true both while a road is loading *and* when there is no pattern to load one for. A bus the
  matcher published as `too_far_from_pattern` sat on "checking" for ever while the reason text
  correctly said the service had no road. Waiting now ends — after 8 s it becomes "could not load
  its road" — and a bus with no pattern gets its own state and its own sentence.
- **Three silent teleports, reproduced against the model.** A bus drawn at its reports that cannot
  travel to the new one moved **92.7 m** (no earlier report), **864.8 m** (a gap past 400 m) or
  **270.7 m** (a span past 45 s) in a single frame with no correction recorded at all — so the map
  drew no trace and the card said nothing. Each is a **repositioning** now, over 25 m, with the
  reason said: the bus was moved, not followed, and the ground between was not drawn because it is
  not known.
- **The visible jump on an evaluated route was a correction at 269 km/h.** An estimate pulled back
  to a standing report was eased at 25 ms a metre, so a 110 m correction peaked at **3.74 m per
  50 ms frame**; the check allowed 8 m a frame and passed. Timed from a speed instead — 100 ms a
  metre, about 10 m/s — it is under 1 m a frame. Measured on the page against the same recorded
  publications: the fastest the drawn bus moves on route 15 falls from **59.2 m/s (213 km/h) to
  21.6 m/s (78 km/h)**, its largest 200 ms step from 12.07 m to 4.68 m in the map view and from
  13.42 m to 4.40 m in the ride-along, with steps over 10 m going from 4 to **0**. The same
  measurement caught a fault in the first version of the road-following fix — the travel ended on
  the road and then hopped to the report, 5.46 m in one 48 ms frame — which is fixed by carrying
  each end's own offset from the road across the travel.
- **Travel between two reports now goes down the road, where one is checked.** The straight line
  between consecutive reports left route 25's accepted shape by a median 5.3 m, 28.5 m at the 95th
  percentile and **34.4 m** at worst — a street away, through buildings. Where both reports measure
  onto the same accepted shape in order, the bus travels that shape; otherwise the chord, and the
  card says which. Verified in a browser: 95% of drawn positions within **6 m** of the checked road.
- **The stop answers "when is the next bus?" from the timetable.** A scheduled departure board at
  every boarding point, from the operators' own registered TransXChange files, which this project
  already parses: **2,682 stops, 958,438 departures**, rebuilt nightly on the server beside the
  catalogue. Every row is labelled **Scheduled**; countdowns come from real instants, fixed by tests
  at local midnight and on both clock-change mornings. A row names a tracked vehicle only where that
  vehicle reports **that journey's own origin departure time**, and a bus is never given a departure
  time it did not report. **No live departure minutes**: TfGM's real-time portal is closed to new
  keys, BODS publishes positions rather than stop departures, and NextBuses (now TransportAPI) is
  the one practical source — £5 a month plus a £10 setup fee for 300 requests a day, waiting on the
  owner's decision. Nothing was signed up for and no charge was incurred.
- **One summary of the chosen bus, not two**: the sticky strip and the card's own head carried the
  same three facts a few lines apart, and are now one sticky card head. A journey change leads with
  one sentence and two choices, with the identity behind Details. A vehicle gone quiet while the
  feed is healthy is its own state. "Does not serve this stop" and "we cannot confirm" are said
  differently. The workspace holds at **150% and 200% page zoom** with no sideways scrolling and
  everything still reachable.
- **Deployed as `b9cbe88`**, the served page chunk identical to the local build's, the previous
  release kept for `deploy/rollback.sh`. The server rebuilt its own catalogue in the new departure
  format and published **2,682 boards, 958,699 departures, 204 operating rules**; the board for
  Westwood Avenue (opp) carries real rule indices rather than −1, which is how that order is known
  to have been kept. **322 browser checks passed, 28 skipped by design, none failing, in 45.4
  minutes** on that candidate; 211 Node, 131 Python, typecheck and lint. Three earlier gate runs
  each found something real and none of them is described as clean. The passenger's journey was
  then walked on the live site at both widths: 8 scheduled departures, one summary of the chosen
  bus, the ride offering its three capabilities apart, and the map back to pitch 0 on leaving.
- **Limitations:** emulation only, no physical phone. **A genuinely backgrounded tab was not
  tested** — the probe's attempt did not stop the page drawing — so no claim is made about what a
  real phone does on return. The drawn bus is sampled at the rate the page writes its diagnostics,
  about five times a second. Bank-holiday operation is declared in the files and still not
  evaluated.

Before that, 22 September 2026, evening (one workspace: a map beside a panel on a computer, a map
under a sheet on a phone; every boarding point on the map; and the page's own scrolling gone).

**22 September, evening — the workspace.** Detail and evidence:
`docs/MILESTONE_2026-09-22_WORKSPACE.md`.
- **The page does not scroll any more; the panel does.** The map and one panel are the first
  screen, whole, at every size. At a stop, page height against the viewport: 1366 × 768
  **2147 → 976 px**; 390 × 844 **2669 → 1145**; 360 × 740 **2630 → 1041**; 844 × 390 on its side
  **2201 → 984**. What is left below is the foot of the page.
- **The panel is about one thing at a time** — `home`, `stop`, `bus`, `plan` (`data-panel` says
  which) — and each has a way back. **Choosing a bus does not take the board away**: the card
  leads and the board follows, so another bus is one tap away. On a phone the panel is a sheet
  with three heights, **moved by its button as well as by a drag**, whose handle is its title: it
  names the stop, carries `LIVE · 17s ago` and the way to ask for newer positions, and because it
  names the stop the block under it does not name it again.
- **Every boarding point is on the map** as a sign on a post from zoom 13.5, names from 15.6,
  labels giving way by distance from the chosen stop, and the chosen stop excluded so it is drawn
  once. Two signs under one finger open the same chooser two buses do.
- **A fit nobody can read is not a fit.** On a phone, fitting You and a half-mile walk into the
  band the sheet leaves took the camera to **zoom 13.25, with no boarding point drawn at all**
  (measured: 0 on screen). Two faults behind it: padding that could exceed the map's own height,
  now clamped to leave at least a quarter of each side, and no floor on the zoom. An automatic fit
  now stops at 14.2 and frames the stop's surroundings (**31 boarding points on screen**, the stop
  in the visible band); **Fit journey** still fits the whole journey, because the passenger asked.
- **Found by this work:** the home screen lost "Buses near me" wherever no stop was near; the
  sheet's handle repeated a heading word for word, which failed 20 checks on the ambiguity rather
  than the page; the search's matches sat under the sheet; a tap on the handle was swallowed by its
  own drag; the map's tool column ran into the Ride along button; and the refresh control vanished
  from phones with the old top bar (it is in the handle now).
- **Deployed as `0061efe`**, the served page chunk identical to the local build's, the previous
  release kept for `deploy/rollback.sh`, collector and both timers active. The passenger's journey
  was then walked on the live site at both widths — a stop by name, its board, a bus, the ride, the
  way back, the night map, a reload and a shared link — and **that walk found the last defect**: on
  a phone the ride sat inside the workspace with the page's foot under it, because the workspace's
  rule for the map outranked the ride's own full-screen rule by source order. Fixed and re-deployed.
- **Limitations:** emulation only, no physical phone (`docs/PHYSICAL_DEVICE_CHECKLIST.md` gained
  seven sheet and keyboard items, all unchecked). The type is in pixels, so a browser's larger-text
  setting does nothing; page zoom at 125% holds, and a rem scale is backlog 19. Pressing Fit
  journey on a phone folds the sheet, which is a camera action that changes the layout.

Before that, 22 September 2026 (a journey, not only a stop: search by bus number, stops on the
map, a board that answers "when?" honestly, a followed position kept apart from a fixed starting
point, a direct-bus planner with sharing, and the standing bus no longer projected).

**22 September — the passenger's journey.** Detail and evidence: `docs/MILESTONE_2026-09-22_JOURNEYS.md`.
- **"My location stays the same after I move" was reproduced from the code**: one
  `getCurrentPosition` per press of Locate me and no `watchPosition`; one value held the last start
  set. Now three things are kept apart — the device's latest measured position, the journey's
  starting point (the device, or a fixed place, labelled "Starting point" and drawn as a hollow
  ring beside You), and where the map is being browsed. The device is followed while the page is in
  front, a fix taken up only past half its accuracy radius (≥ 15 m), when clearly better or after a
  minute; the walk re-routes only past max(40 m, 2 × accuracy); a position update never moves the
  camera (the frame goes to an explicit choice of start); a fixed start is never overwritten by a
  late fix. Emulated movement in Chromium (`location.spec`), not a phone.
- **One search: "Bus number, stop or area."** Routes from the timetable catalogue (exact number
  first), stops with their side of the road, in reach with a stop chosen. A route opens its
  directions and stops. Every boarding point is on the map from neighbourhood zooms, tappable;
  "Find stops around here" after a drag; "Back to my location".
- **The board answers "when?" with what is true**: tracked buses by last report in stops and age,
  no arrival minutes until an evaluation passes (the nightly one has "released nothing"), and the
  official Bee Network live board for that very stop by ATCO code (verified). The walk guide comes
  after the board.
- **Plan a journey**: From (My location, a postcode via postcodes.io, an address or landmark via
  Photon/OpenStreetMap, a stop, a map point) and To; results listed with what tells namesakes
  apart, nothing chosen until picked, late answers dropped. Direct buses from our own catalogue on
  one valid pattern, boarding before alighting, walks bounded and shorter than the direct line;
  tracked buses by stops away; no times promised; a caution when the nearest bus is too close for
  the walk. Choosing opens the boarding stop filtered to the service. The return is recomputed.
  Hand-offs: Google Maps transit with both places; the Bee Network planner (takes no places).
  Sharing: text and a link with the destination and, only if fixed, the start — never the device's
  position, and the preview says so. **No journeys with changes are planned here, and no
  provider was paid or contacted**: NextBuses by TransportAPI (free 30 requests/day) needs an
  account and a server-side key — the owner's decision (backlog 15).
- **The standing bus, the authorised fallback**: a bus whose last two reports stand still while its
  window still reads movement is not projected; it stands at its report in observed mode and
  estimation resumes at its first moving report; an overshoot eases back. Re-scored on both
  held-out Mondays: pull-backs over 35 m fall from 25–26% to 15–16% of corrections; the move-off
  catch-up remains and is stated: forward corrections 41–44%, snaps 9.7–10.8% (from 8.8–10.3%).
- **Found on the way**: a page-wide crash from an untested address reader (fixed, tested); a
  deploy deleting the server's nightly arrival artefact (excluded now); route directions that
  share a compass word (keyed by destination too).

Before that, 21 September 2026, evening (the ride said before it is entered, the roads two failed
batches never built, and four defects on the live site).

**21 September, evening — deployed as `dbdf2e3`.** A short batch; the detail is in
`docs/MILESTONE_2026-09-21_EVENING.md`.
- **Before Ride along is pressed, one line says what the ride will be**: `Estimated movement`, or
  `Reported positions · may pause`, or `Last report is old · may pause`, with `· Front view` only
  where the street preview is there; the button's accessible name says the same. Inside the ride
  the card keeps one label with the report's age. A correction over 150 m is drawn as a dashed
  trace to the new report for six seconds and the card says "Moved N m to its latest report".
- **Two of the nine shape-build batches of 20 September had failed after 24 patterns and were never
  re-run**, so 36 named lines (192, 50, 52, 41, 53, 86, 203 among them) had no road at all while the
  index looked complete and the claim "every line with a timetable and reports" stood for a day;
  found by joining `pipeline_run` notes against `pattern_shape` rows. Built now under the unchanged
  rule: 198 patterns routed, 70 accepted on 29 of 33 lines; the index holds **560 patterns on 171
  lines, 184 accepted on 106**. On one served publication (17:13 UTC, 623 vehicles) the front view
  goes from **97 (16%) to 191 (31%)**; estimated movement stays 14 (2%) by its second gate;
  "placed, no road built" falls from 171 to 18. `scripts/coverage-breakdown.mjs` now counts every
  refusal by its cause. `docs/COVERAGE.md` §4.
- **Two buses under one finger** open a small chooser at the tap (pointer, touch, keyboard, flat
  and tilted); **Explore a bus with the front view** on the home screen lists up to three buses
  from the latest publication's own eligibility, saying which kind of ride each is; a stop whose
  only candidates are on an unsettled branch no longer reads "no bus has a current report"; a
  backlog of two reports is no longer drawn at double speed (timed from the report the bus was
  drawn at; moving in 63% of frames, steps over a bus length 0.3 an hour).
- **Four defects on the live site, none found by a local check:** the served Operations view had
  shown "No pipeline record is published" since the first deploy (`parseOperations` refused any
  record with a live run — a guard from the archive-only release; the local file passed); two
  reconciliation rows about the archive replay read UNBALANCED on a server that never ran the
  archive import (now "not checked here", with the reason); the 16:15 deploy had overwritten the
  server's 02:45 nightly catalogue with this machine's 18 September copy (the catalogue is now the
  server's own, excluded from deploys, sent only to a server with none); and the empty state
  above.
- **The route-15 snap of 187 m, reproduced from the raw captures**: BU25YWF reported the same
  position twice, 19 s apart; motion-3 (`standingHold: 0`) carried the drawn bus 81–103 m past it
  and snapped back 179 m, then forward 177 m. The candidate is the model's own `standingHold`;
  its criteria were fixed in `docs/MOTION_MODEL.md` (82a3605) before any result, and it is not
  scored yet (the restore of the day's captures was still running at deploy). Nothing is released
  without the owner's agreement.
- **Verified:** 264 browser checks passed, 24 skipped by design, none failing, in one 39-minute run
  on the deployed commit (Chromium, SwiftShader, desktop and phone emulation; no physical phone);
  194 Node, 131 Python, typecheck and lint. Served after deploy: RELEASE `dbdf2e3`, the page chunk
  identical to the local build's, the 560-pattern index and a shape built that day, a browser
  profile primed on the old release taking the new one on its first load, the offer line and the
  explore entry on real data at both widths. `docs/PHYSICAL_DEVICE_CHECKLIST.md` lists what only a
  phone in hand can answer.

Before that, 21 September, afternoon (the ride made to move, the road geometry the app had never
built, and the map made answerable).

**21 September: why the bus jumped, why the front view was never offered, and why green dots did
nothing.** Three reported faults, each traced to a cause and fixed, with the fleet's coverage
measured before and after on one publication rather than asserted.
- **The jump was observed-only mode, and it was most of the fleet.** A bus with no accepted road
  geometry was *placed at its latest report every frame*: it stood still for twenty seconds and
  then teleported. Measured on the deployed build against the real feed, 70 s of riding one bus:
  median drawn step **0 m**, maximum **217 m**, three jumps. A bus now **travels** from the report
  it was drawn at to the report that has arrived, **taking the time the bus itself took between
  them**, and waits there if the next is late (`GLIDE` in `lib/motion.ts`). Both ends are observed
  positions; the line between them is not claimed to be road, no bearing is taken from it, and the
  bus is never carried past the newest report. A gap over 400 m, or longer than 30 s, is left as
  the step it is.
  - **A first attempt travelled the whole way in 900 ms and then waited, and that was not enough.**
    It removed the teleport and left a hop every twenty seconds: measured, the bus was still
    standing in **96%** of frames. Taking the reports' own interval is what makes it a ride.
  - Replaying 27 recorded journeys (2,107 reports) through both drawings at 60 fps on identical
    frames (`scripts/evaluate-glide.mjs`): the drawn bus is **moving in 62% of frames, against 0%**;
    single-frame steps longer than a bus fall from **138.5 an hour to 2.2**; the 99.9th-percentile
    step is **0.66 m**.
  - **What it costs, plainly:** the drawn position is behind the newest report in **65% of frames**,
    by a **median 54 m** while it is, and by up to 393 m in the instant a distant report lands
    before the travel starts. It is never ahead. That is the price of not teleporting on a service
    whose road we have not checked, and the card states the age of the latest report beside it.
  - **On the real feed, watched rather than replayed** (the new build with the server's live
    publication passed through, Chromium, SwiftShader): a route-263 bus ridden for four minutes
    on desktop moved in **80% of its steady state** (231 s between the first and last report to
    arrive); on a 390 px phone, **55%**, in a watch that included a genuine **135 s** gap in that
    vehicle's reporting, during which it stood at its newest report, as it should. Reports reach
    the page further apart than they were made, so the bus travels at the speed its two reports
    imply and then waits — a short watch is dominated by that first wait (a 110 s watch read 26%).
    The fleet's own cadence, measured the same day: consecutive reports a median **21 s** apart,
    30 s at the 95th percentile, 0.6% over 45 s, which is where the travel's time cap now sits.
  - **The estimated path, on the real feed, is not the same thing and is not claimed to be:** a
    route-15 bus watched for 200 s produced 924 distinct drawn positions with one 8 s pause, and a
    150 s watch caught **one snap of 187 m** and a 146 m eased correction among nine publications —
    the documented behaviour at and below the 150 m threshold, said on the card, and no smoother
    than that.
- **Follow on the map did nothing on most services.** It required an estimate, so on a service with
  no accepted geometry the camera never followed at all. Following is about the camera, and now
  follows whatever is drawn.
- **The front view was never refused by the code; the data had simply never been built.** There is
  no route allowlist: `loadTrack` reads `public/data/shapes/index.json`, which held **9 patterns on
  3 routes**, built on 13 September with `--lines 15,250,256` and never extended. Every other
  service was told "this service has none yet" for ever. Road geometry has now been built and
  validated for **every line that has both a timetable and live reports**: 175 lines, **362
  patterns routed, 114 accepted** on **77 lines**, against the unchanged rule (at least 30 matched
  reports, 95% within 35 m). **Route 263, the one the owner tried, was accepted both
  ways at the first attempt** — 10,328 and 11,573 matched reports, 95% within 17.1 m and 17.0 m,
  13.6 km each way. It had never been unsupported; nobody had asked the router for it.
- **Geometry released the front view, not prediction, and the difference matters.** Estimated
  movement has a **second gate**: the pattern must be one the published evaluation actually scored
  the frozen model on (`motion-evaluation.json`, six patterns on routes 15, 250 and 256). Building
  a road does not release prediction, and it should not: the model was fitted and scored on three
  routes, and predicting elsewhere would claim an accuracy nobody has measured. Measured on one
  **weekday publication of 569 vehicles** (Monday 21 September, 12:11 UTC, 126 distinct
  services), asked of the old shape index and the new one: accepted road geometry and front-view
  eligibility go from **11 (2%) to 92 (16%)**, while **estimated movement stays at 11 (2%)**. (An
  evening publication of 171 vehicles gives 8 → 48, 5% → 28%: the share depends on which services
  are running, so the denominator is always stated.) What would release prediction more widely is a
  measurement, not a code change: score the frozen model on those routes' own held-out captures
  against the same bar (`scripts/evaluate-frozen.mjs`), and publish the result.
- **What is still refused, and why**: 248 patterns were routed and **rejected**, 136 of them because
  no report in the warehouse was ever matched to that variant (a school journey, a short working);
  a handful because the road does not fit its own reports (71–99 m at the 95th percentile) and is
  therefore not that bus's road. On the 569-vehicle weekday publication the rest divides, each bus
  counted once under the first thing that stops it:
  - **156 (27%) an unsettled branch** — two patterns still fit the position. Not a gap in our data:
    the evidence does not say which road it is on. This is now the largest single reason.
  - **153 (27%) no road built for that variant** — the pattern is published but was not among those
    routed. Ours to close.
  - **97 (17%) no timetable held for the route at all** — an operator dataset we do not download.
    Upstream.
  - **81 (14%) road accepted, movement not evaluated** — these buses *do* get the front view; only
    prediction is withheld.
  - **about 60 the road was built and refused**, because that pattern's own reports lie 36–286 m
    from it at the 95th percentile. Several miss by a metre or two, and the threshold has not been
    moved to let them in.
  - 6 too far from any pattern stop, 3 with no journeys in that direction today, 3 loop patterns.
- **The green dots were the chosen bus's own past.** `lm-trail-report` drew each recent report as a
  filled lime disc — the same colour and nearly the size of a bus marker — and the tap handler
  tested only two layers, so they did nothing. They are now **hollow rings at half the size**, and
  the tap tests every layer that draws a bus: its marker, **its route number**, and, from zoom 18,
  **the 3D model itself**, which is most of the screen in a ride-along and could not be tapped at
  all. A shape hit is measured from the bus it belongs to, so a flat marker nearer the finger
  still wins.
- **The sidebar now follows the passenger.** Riding a 263 from a route-15 stop, the page still led
  with the stop, its walk guide and its empty route-15 board, and said "does not serve your stop"
  on four surfaces. While a chosen bus is not one of the stop's, the bus leads, the map follows,
  and the stop stays as one compact block with the way back; the mismatch is said **once**.
- **The home page no longer suggests a bus nobody asked for** (it offered the latest report
  anywhere in Manchester), and **a link no longer claims which trip it named**: it carries a
  vehicle, a route and a direction, so the journey is learned from that vehicle's next report
  rather than assumed, and the same vehicle's next trip on the same line is noticed as a change.
- **Three faults found by this work, not reported.** A router answer with no usable geometry
  raised out of validation and ended a whole build batch, leaving every later service unbuilt (now
  refused per pattern, with a test). A full-page screenshot of this layout captures the sticky map
  wherever the scroll left it, which had me chasing a grid regression that did not exist. And
  **camera competition**: the effect that brings the frame to a report outside it re-ran on every
  re-render that gave the chosen bus a new object identity — a poll, or a theme switch — with the
  *same* report, and after a Fit that report sat a few pixels outside the padding the fit had placed
  it on, so it panned the bus to the exact centre of the canvas and the stop off the map. Found
  because the full suite failed the fitted-map check, and settled only when the check was made to
  report the camera's recorded stops. The frame is now brought only to a *new* report, and a fit
  marks the report it framed as seen. A re-fit-after-resize handler, added on a wrong diagnosis of
  the same failure and kept as harmless, was then caught by the next full suite fighting the ride's
  exit (which resizes the map on purpose) and was removed.
- **Deployed as `509ae40`**, byte-identical to the local build (`sha256 b42a6d13…` on both), the
  previous release kept for `deploy/rollback.sh`; 363 shape files and the 362-pattern index are
  served, the 263 shape among them; collector, health, refresh and arrival units all active. **The
  unattended nightly rebuild has now fired on its own** — the refresh timer's last run is Monday
  21 September, 02:42 UTC — which closes the item the 20 September record left open.
- **The whole browser suite, in one run, on the deployed candidate: 230 passed, 24 skipped by
  design, none failing** (35 minutes, SwiftShader, desktop and phone). Four earlier full runs on
  the way each found real things — the stale caption, the camera competition, the resize handler —
  and none of those runs is described here as clean. 194 Node tests, 131 Python tests, typecheck
  and lint on the same commit.
- **Coverage on the publication the site was serving at deploy** (16:16 UTC, the evening peak,
  650 vehicles, 136 services): accepted road geometry and front view **105 (16%)**, estimated
  movement 15 (2%), 635 (98%) drawn travelling between their reports; refused as missing coverage
  348 (54%), genuine uncertainty 191 (29%), accepted-but-unevaluated 90 (14%), not running 6.

Before that, 20 September 2026, evening (journey state put on a footing, and a stop that showed no
buses explained).

**20 September, evening: journey state, and why a saved stop would not let go.** Two defects seen on
the live site were traced and fixed, and the page's remembered state was written down before it was
rewritten (`docs/JOURNEY_STATE.md`).
- **The cause of the stop that would not let go.** The page restored the device's last journey and
  then wrote it into the address bar with `replaceState`; the next open of that address was a *link*,
  and a link won over everything. Observed live: `/` became `/?stop=1800SJ32251&bus=BNML%7CMF74NPO`
  on its own. And the link's bus key named a *vehicle*, so MF74NPO, by then a 142 near Parrs Wood,
  was adopted as the passenger's bus on a stop it did not serve, twice on one screen.
- **Three layers now, each in its own store, with a precedence:** a link wins; the tab's own journey
  (sessionStorage) restores silently on refresh, on return from Google Maps and from the background;
  the device's last journey (localStorage, 12 h) is only **offered**, one "Continue · Hillingdon Road
  (opp)" chip on the home screen, and never written to the address. A bus in a link or a store is
  `operator|vehicle|route|direction`: a vehicle on a journey. **New journey** clears the stop, the
  filter, the bus, both stores and the address, and a reload cannot bring any of it back. Choosing a
  stop pushes the address, so Back returns to the previous stop, and Forward goes on; it clears the
  filter and keeps the chosen bus only where it calls, else lets it go and says why. Recent stops
  (six, thirty days) are deliberate choices only.
- **Hillingdon Road (opp), route 15, "no buses".** Traced on the frozen publication of 16:51:36
  (`scripts/trace-stop.mjs`): the stop has one timetabled service, the 15 inbound; the only inbound
  15 in the publication was six stops past it; the outbound one does not call. The data was right and
  the message was useless. The empty state now tells five situations apart — no reports on a
  service timetabled today (with "a missing report does not mean no bus is running"), a filter
  hiding N buses (with "Show all services"), only old reports, no feed, no timetable held — and a
  filter never hides a bus silently: the count of buses it hides is stated under the list. The
  timetabled line, the estimate and the street preview are read from the board's rows and never
  remove one (`stopBoard` in `lib/journey.ts` does not read them).
- **Compaction.** A chosen bus that is not coming to the stop gets a short card (route, destination,
  "Does not serve your stop", the way back), not the full answer. The walk section is the answer,
  the hand-off and one disclosure; the ways to fix the start are in the open only while the start is
  missing or in doubt, where the caveat that names them is. On a 360 px phone the stop page is
  1,818 CSS px tall where the baseline capture was about 2,800.
- **Deployed as `5701dae`** (RELEASE on the server; collector and health timer active). Checked on
  the live site in Chromium's phone emulation, REAL data, no physical phone: a fresh `/` stays bare
  through publications; the Hillingdon Road link applies; a reload keeps the tab's stop with no
  notice; New journey empties both stores and the address, and a reload brings nothing back; a
  fresh tab only offers "Continue · Hillingdon Road (opp)", and Continue takes it up. On the served
  publication of 21:48:45 the only inbound 15 was ten stops past the stop, so the page's "15 to
  Piccadilly Gardens is timetabled here today, but no bus on it has a current report" was true.
- **The browser suite, run in full once** (201 passed, 24 skipped, 19 failed on the first build),
  then every failure re-run on a build with its fix, none failing at the end. Eight of the nineteen
  predated this milestone and had never been re-run: six `access.spec` checks encoded the
  location rule from before ba7d995 (the walk guide owns location once a stop is chosen), and two
  front-view bounds in `ride.spec` encoded the fixed 32 m look-ahead from before 963633a (now 32 m
  at rest to 80 m at speed, so the zoom reads 19.785 and the eye rests 54.5 m ahead on the fixture).
  They are restated from the current design, with the reason beside each. Found on the way: "Change"
  (no stop yet) must be an intermediate history entry that the next stop choice replaces, or Back
  from a stop lands on nothing; and a link's four-part bus key must not borrow a remembered bus on
  another journey.
- **Still open from the brief:** with nothing chosen the home still suggests a bus on an arbitrary
  route below the fold (the old route-browse mode); the five empty-state kinds other than
  "filtered" are checked by wording, not in a browser; Google Maps return and backgrounding were
  exercised as a reload in Chromium, not on a phone; the "Update my location" control folds into
  the disclosure once the start is confident, which a passenger walking may want in the open.

**20 September, later: the arrival estimate evaluated and not released, and a deployed line
withdrawn by the evaluation that scored it.** Criteria were written first
(`docs/ARRIVAL_RELEASE_CRITERIA.md`). Ground truth is inferred stop passages — crossings between two
reports, timed by interpolation, uncertainty half the gap — **4,014 scoreable on route 15 at ±10 s**,
not "reports within 40 m". Fit on 11–14 Sep, scored once on 17–20 Sep (63,397 moments, 1,436
passages, two weekdays): the progress baseline reads 0.59 min at 1–2 min ahead and 4.96 at 10–20;
the delay-adjusted timetable 0.96 and 2.51 on the same moments, at under half the coverage. Median
and p80 at 2–10 min fail the criteria; **nothing is shown**, and a nightly server unit re-scores on
the server's own reports. The scheduled comparator's 15-minute error was real: **every inbound
route-15 schedule is a constant +15 to +17 min early** against its own buses' passages, on all days
held; the journey key first appears in the feed 14.5 min after its registered departure. The deployed
"Timetabled at your stop" line was ~16 min early in the passenger's own direction and is now gated per
pattern on a published **schedule anchor** (inbound 15 withheld, outbound 15 verified, all else
unchecked and withheld). The "zero risk" claim on shared departures is withdrawn for the precise one:
all retained candidate journeys agree on the scheduled time, subject to the match and the timetable;
agreement names a time, not a journey. The controlled comparison on one publication: 117 → 156
groups named, 0 lost.

**20 September, hosted, and the first day it could be wrong in public.** The site is at
**https://lost-minutes.duckdns.org**: Hetzner CX23 in Helsinki (€7.19 a month, the CX line being
out of stock in Falkenstein), Ubuntu 26.04.1, a Let's Encrypt certificate on the first attempt, the
collector under systemd. Everything below was checked on that server or in Chromium on the built
export; nothing on a physical phone.
- **Five defects the first real deployment exposed, none findable locally** because `validate.sh`
  checks configuration and never runs on a server: the upload excluded `public/data` (an unanchored
  `data/` pattern), so the site would have gone live with no stops, patterns or road shapes; the
  upload was 1.75 GB of package cache and probe video; no `deploy` user existed though every document
  addressed one; a fresh warehouse had no stop table and no patterns, so **0 of 307** buses matched
  until the nightly rebuild; and a clean SIGTERM exit returned 130, so systemd called every nightly
  pause a failure. All fixed and re-checked on the server. A sixth, my own: the installer's first-run
  probe could not tell a locked warehouse from an empty one.
- **The watchdog fought the nightly rebuild.** Its guard used `systemctl is-active --quiet`, which
  exits 3 for a running `Type=oneshot`; reproduced as **4 collector restarts in 3 minutes** during a
  rebuild. Fixed and re-tested against a real rebuild. Recovery from `SIGKILL`: publishing again in
  **25 s**, the abandoned run closed with `cause: "not recorded"`. Stall, unreadable file and healthy
  branches each verified. **The unattended 03:40 rebuild has not yet fired; it is left open.**
  External alerting (a dead man's switch) is prepared and **off pending the owner's approval**.
- **BNFM's timetable was in the catalogue but in no configuration.** Its snapshot had been read from
  a stored file no configuration could fetch again; a fresh server would have rebuilt without it and
  said nothing. Identified by SHA-256 against the stored snapshot: **dataset 14241**. Four datasets
  now, all four fetched by the server with hashes identical to the local catalogue.
- **The walk's starting point is now judged, not assumed.** The page had discarded the fix's accuracy
  and timestamp, so the Kenwood Road / Norwood Road discrepancy was undiagnosable after the fact;
  `enableHighAccuracy:false` requested nothing better, but is a hint, not a cause, and this does not
  claim what the cause was. Now: a fresh fix at best accuracy, never cached; confidence in bands
  (under 40 m stated plainly, to 150 m hedged as "about" with the doubt beside it, beyond that not
  routed; a tight fix over five minutes old is stale); **Update my location**, **Choose starting
  point** on the map (kept for the session, outranking the device until given up), and **Walk to
  stop in Google Maps** by the boarding point's coordinates, never its name (Hillingdon Road has two
  stops 40 m apart facing opposite ways). 18 browser checks, desktop and phone, FIXTURE.
- **Front view at Hillingdon Road (opp), traced.** Not missing geometry: two inbound 15 variants
  serve the stop to the same destination, the 140-journey pattern (accepted shape, 756 reports) and a
  5-journey Mon–Sat short working (shape built, **rejected: 0 reports to check it against**). On a
  weekday the destination cannot separate them, the bus is left unresolved, and an unresolved bus
  had no road. The stop-list inference that stood in (`sharedOnward`) was wrong in principle: shared
  stops do not prove a shared road, and convergence after the boarding stop says nothing about the
  road before it. **Replaced by measurement:** every vertex of the accepted track is tested against
  every other candidate's shape; shared road is where all lie within 10 m. On route 15 that is
  **387 → 13,611 m** of the accepted shape, with Hillingdon Road at 8,715 m and **8,320 m of shared
  road before it**; a bus is placed on it only if its last report and its whole look-ahead (542 m:
  17 m/s × 30 s + the camera's 32 m) are inside, else left at its report with the reason. The first
  version fragmented on a 136 m straight and was caught by its own browser check.
- **Arrival times: the timetabled journey is identifiable, and estimates are evaluable.** The feed's
  journey reference matches **0 of 114** timetable journey codes. But `OriginAimedDepartureTime`,
  on 99% of observations across every operator, matches a current `DepartureTime` for **all 161
  distinct route-15 times (16,310 of 16,310 observations)**. Every timing link carries a `RunTime`
  (1,994 of 1,994 on route 15); they are read now, and **all 576 patterns publish fully-declared
  scheduled seconds** per stop. The page shows **"Timetabled at your stop 07:11 · from the operator's
  timetable, not a prediction"** only for a bus on one pattern, on one journey at that departure,
  with running times declared to both stops, and still before the stop in the timetabled order.
  Ground truth for a real estimator exists: **2,025 (journey, stop) pairs with a report within 40 m of
  the stop** across 91 route-15 journeys, arrival known to about ±20 s; Hillingdon Road passed on 41.
  **No estimated minutes are shown yet**: the estimator and its held-out evaluation are the next
  step, and the scheduled time is the honest fallback in place now.
- **The street preview, from data it already holds:** façades graded by OSM `render_height`, a
  footway and a broken centre line at the road class's real widths, a look-ahead that lengthens
  with the drawn speed, and a sky that follows the sun — `lib/daylight.ts` works civil twilight out
  from the date and Manchester's latitude, held by tests to the equinox's twelve hours. **Not yet
  judged by eye**: the frames are being taken.
- **The BODS key seen in a screenshot has not been rotated** (server and local hashes match it).
  The DuckDNS token seen in another should be recycled too. Neither blocks anything.

**18 September, the claims this project had not earned.** The hosting decision is made — Hetzner
CX23, no paid backups, a free subdomain — and `docs/PROVISIONING.md` is the runbook for it. Nothing
is provisioned; nothing has been bought.
- **Two claims withdrawn.** "The collector's memory is steady, so not a leak risk" rested on three
  samples over a minute; measured properly it rose 1,148 → 1,466 MB in three minutes, because
  DuckDB's default limit is 80% of the machine's RAM. It is now bounded (`LM_DB_MEMORY_LIMIT`,
  1 GB). Left running it kept climbing — **+300 MB an hour over 63 minutes, no plateau** — which
  looked like a leak and would have met the collector unit's old 1500M ceiling within the hour.
  It is not a leak: DuckDB takes a thread per core and glibc scales its arenas with threads, so this
  16-core laptop ran 32 where a CX23 gives 2. **At two threads the same collector is flat: median
  376 MB across 26 readings over 19 minutes.** The unit now pins `LM_DB_THREADS=2` and
  `MALLOC_ARENA_MAX=2`, and `MemoryHigh`/`MemoryMax` are sized from measurement rather than hope.
  And "the warehouse is rebuilt from the raw captures" was **false in practice**: nothing could read
  live captures back.
- **`pipeline/restore.py`** now reads them back, and the restore was performed rather than
  described: 60 copied captures → **25,232 observations, 1,396 vehicles** into an empty warehouse,
  every file verified against the SHA-256 in its own name, and a second run adding nothing.
- **The nightly timetable refresh** peaks at **853 MB** in 3 min 05 s, and rebuilt identically to
  the previous day apart from the date — evidence the snapshot fix holds. That figure, not the
  collector's, is what rules out a small host.
- **Restart recovery, tested twice:** the run the sleeping laptop abandoned was resolved to
  `interrupted / abandoned` by the next collector unprompted, and a deliberate `SIGKILL` was
  publishing again within 45 seconds. A second collector is refused with `collector_busy`.
- **A 26-hour-old publication that still called itself live** was refused by the page entirely:
  NOT UPDATING, no buses listed, none drawn. It also exposed "updated 94646s ago", so ages now read
  in minutes, hours and days.
- **167 phone touch targets under 44 px became 43**, and on a phone only the wordmark link remains.
- **A 30-second recording of the actual app** on the real feed
  (`scripts/probes/demo-recording.mjs`), which judges its own take: the bus it caught had reported
  no bearing, so it says the take is fair but not representative.
- **Drafts for approaching TfGM** in `docs/TFGM_APPROACH.md`, sent to nobody.

**17 September, towards a public beta.** Everything here is checked in Chromium on this machine
unless it says otherwise; no physical phone has been used, and the app is still served only from a
temporary Cloudflare Quick Tunnel.
- **Route 256's weekday gap was traced to source, and the standing explanation was wrong.** It was
  not a catalogue built on a Sunday. TfGM's registration for the 256 that took effect on 30 August
  2026 contains a Saturday file, a Sunday file and three single-journey school files, and **no
  Monday-to-Friday inbound service at all**; the previous registration, which expired on 29 August,
  had one with 101 journeys. Rebuilding on a Thursday confirmed it. The refusal now says the true
  thing: a direction held for other days returns `no_pattern_for_direction_today`, "the timetable
  held for this route has journeys in this direction, but none on this day of the week".
  `docs/COVERAGE.md` traces it file by file.
- **Two ways the timetable catalogue could go wrong, both fixed.** The collector re-downloads the
  datasets while it runs, and the build read every snapshot it found: route 15's published journey
  count doubled from 280 to 560 without a single new journey existing, and a withdrawn registration
  would have been kept alive. Only the newest snapshot of each dataset is read now. And a build that
  would publish less than half of the catalogue already published is **refused**, leaving the last
  good file in place: a failed download and a withdrawn service look identical from inside.
  Files valid at any point in the coming fortnight are now parsed, so a timetable change no longer
  waits for a rebuild to happen that morning, and both the matcher and the page check a pattern's
  own validity before using it.
- **The coverage ledger** under Behind the data says, service by service, what can and cannot be
  said: positions, a timetable running today, checked road geometry, estimated movement — four
  answers, never rolled into one. On 17 September: 285 of 587 buses placed, 109 of 159 services with
  a registration running today, 2 services with an accepted road shape running that day.
- **The ride-along is the screen on a phone**, not a card in a scrolling page: the map is fixed to
  the viewport, the page behind it stops scrolling and its position is restored on the way out, and
  the four stacked chips became one bar (leave, what the camera is doing, what this is) with the two
  actions above the card. It is a mode you leave, so the header is out of reach while it runs.
- **Two typefaces, served from this site**: Inter for the interface, Space Grotesk for the wordmark,
  headings, route numbers and the HUD. Both SIL OFL, copied out of node_modules at build time, never
  from a font CDN.
- **The daylight street preview has depth.** Road, ground and buildings sat within a few per cent of
  each other; the ground is now dropped away from the road surface, blocks are deepened and lit from
  one side, and the haze is stronger. The drawn bus has a contact shadow, so it no longer floats on
  the paper map.
- **How fast the map is actually drawing is measured** (`data-frame-ms`, the median of the last 90
  frame intervals) and carried in the feedback report, because "the street preview froze" cannot be
  settled by eye and has never been reproduced here.
- **A feedback route and a plain account of location use** sit at the foot of the page. Nothing is
  sent from the page; the report is copied to the clipboard.
- **Operations:** the watchdog tells four failures apart (collector down, publication stalled,
  upstream not live, upstream reports old) and restarts only the two that are ours; a dead man's
  switch is prepared and **off** until the owner names a destination. `deploy/rollback.sh` puts the
  previous release back in one command. CI runs the deterministic checks
  (`.github/workflows/checks.yml`); the browser suite, the real feed and the real router stay out of
  it.
- Hosting is costed, re-checked and **still not provisioned**: `docs/HOSTING.md` ends with the exact
  decision needed.

Before that, 14 September 2026, evening (passenger feedback: navigation, phones, returning).
Changes that evening, each answering reported feedback (listed in `docs/PASSENGER_TEST.md`):
- the passenger's page is the whole page, with no tabs. Explore (the archive replay), Evidence and
  Operations moved under **Behind the data**, a secondary area with a short account of the pipeline
  and direct addresses (`/#operations`, `/#evidence`, `/#recorded-journeys`). Explore is now
  **Recorded journeys**, dated and labelled as a recording;
- the passenger's page stays mounted while those views are open, so the stop, the chosen bus, a
  ride-along and the map come back unchanged. It no longer waits for the 1.6 MB recording, whose
  failure had blocked it;
- one malformed engineering file no longer takes the whole page down; the Operations view no
  longer claims that no live collection is configured;
- on a phone: the "your bus" strip is above the map, so the answer shares the first screen with
  the stop; the walk guide asks for a location in one quiet line; search matches stay above the
  keyboard; in landscape the ride card no longer covers "Front view"; safe-area gutters; 44 px
  header and chip targets;
- returning: saved stops and routes come first, PNG icons exist for installing, fresh positions
  are fetched on coming back to the page or back online (polling pauses while it is hidden), the
  service worker keeps road shapes and other files fresh, and install advice is given only on a
  lasting address;
- a native app and Metrolink researched, not built (`docs/LOST_MINUTES_REDESIGN_RESEARCH.md`,
  section 11a); the hosting cost corrected for Hetzner's June 2026 price rise (`docs/HOSTING.md`).

Afternoon, a temporary HTTPS preview for the phone trial:
- `scripts/preview.sh` serves the latest build and the live data through Caddy on 127.0.0.1 and a
  free Cloudflare Quick Tunnel. It reuses a running collector or starts a bounded one, and stops only
  what it started;
- a pinch in the outside ride-along now zooms and keeps following (on touch it did nothing before),
  and a one-finger drag pauses following;
- the street preview's mode line no longer splits "Ride-along";
- `scripts/probes/public-preview.mjs` checks such a link as a phone reaches it (emulation).

Early afternoon, one visual refinement before the passenger trial:
- the optional front view is a raised, stylised street preview: lighter buildings and kerbs, a
  night sky graded to a horizon, upright street names from the map's own data, and up to three
  stops of the bus's pattern named; the outside ride-along stays the default;
- in the front view a wheel or a pinch pauses following, as a drag does, instead of being undone;
- while the detailed map is slow, the simple map is offered beside the bus information, and the
  detailed map can be brought back;
- the map can be made bigger, as the same map;
- one Locate me at a time: the walk guide's while it asks for your location, otherwise the map's
  own, or the stop's beside the simple map;
- leaving the ride by keyboard no longer leaves focus on the page itself for a moment.

Late morning, before the first passenger test:
- a chosen bus that starts another journey is kept, drawn at its reports, and neither predicted
  nor followed until the passenger continues;
- a bus is chosen by tapping its drawn map marker, overlaps and phone taps included;
- a keyboard-only journey works;
- slow tiles and slow live data get honest status, and a slow network no longer forces the
  fallback map;
- Monday's captures were scored, and route 256 was found unmatched on weekdays.

Earlier that morning: one bus, kept (a chosen bus is pinned by every way of
choosing it and never substituted, through new reports, reordering, filters, gestures, theme
changes, absence and a new journey; stop activity worded only from the bus's own reports; the
drawn bus waits at a crawl rather than standing, and is scored against held-out reports; a map
start that no longer gives up on a slow tile; a persistent passenger-review rule in
`.claude/rules/`. Before that, 13 September, late evening: ready for a first passenger comparison, with the
ride-along entering straight to the bus and working under `next dev`, an optional front view, smoother
drawn movement, the selected-stop answer reordered, the journey kept across visits and shared
without location, a route coverage check, the motion model frozen and scored on fresh captures, a
passenger worksheet, and a deployment configuration validated but not provisioned; the embedded
window-seat film was removed. Earlier the same day: the ride-along's camera and visibility, the
night map, stop-aware estimated movement, walking guidance, collector run records, the stop-first
passenger view, original cartography, Bearing, and identity-first timetable matching). The
requirement-by-requirement evidence for each milestone is in `docs/MILESTONE_CHECKLIST.md`.

## Product goal

An independently hosted, mobile-first Manchester bus companion, whose source lives in the
owner's own GitHub repository. The everyday job is small and concrete: find your stop, see
which buses call there and how far their last reports put them, and follow one.

It is also portfolio evidence for Data Engineer, Analytics Engineer, Data Scientist and AI
Engineer work. That means the engineering has to be visible and checkable, not decorative.
No AI feature will be added merely to claim AI engineering.

**The evidence rule.** Nothing on screen may claim more than the data supports. Every
published observation keeps its original timestamp, its raw source file and that file's
SHA-256. Counts are reconciled from different tables rather than asserted. Anything we
cannot justify is shown as unknown, withheld or refused — never filled in.

## Architecture

```
BODS SIRI-VM feed ─┐                        one shared collector, single writer
public archive ────┤
NaPTAN (ATCO 180) ─┤
TfGM TransXChange ─┴─> data/raw, data/live-capture   raw bytes, content-addressed, not in Git
                       │
                       ├─> DuckDB (data/warehouse)  sources, runs, cycles, observations (with
                       │      Bearing), conflicts, quarantine, publications, stops, patterns
                       │
                       ├─> public/data/replay.json      archive snapshot (validated, atomic)
                       ├─> public/data/live.json        live state, per-bus match and evidence
                       ├─> public/data/stops.json       3,498 boarding points
                       ├─> public/data/patterns.json    service patterns: operator, version,
                       │                                operating days, stops, declared distances
                       ├─> public/data/shapes/          road shapes for evaluated patterns
                       │                                (Valhalla, accepted against reports)
                       ├─> public/data/motion-evaluation.json  estimator settings, held-out errors
                       ├─> public/data/operations.json  pipeline truth
                       └─> public/data/config.json      runtime pointers, walking router
                                     │
                    Next.js static export ──> phones poll the published objects only
```

Phones never contact BODS. One collector reads the feed for everyone. A phone contacts one
other service, and only when the passenger asks for walking directions: the pedestrian router
at routing.openstreetmap.de, sent the passenger's location rounded to about 10 m.

**Implemented and verified.** Archive import, live collector, DuckDB history, validate-then-
swap publication for both snapshot kinds, Operations view, Evidence view, the stop-first
Follow view, PWA shell, service-pattern matching with identity checks, Bearing capture,
walking guidance to the boarding point, estimated movement between reports on evaluated
routes (15, 250 and 256), and run records that say how each collection ended.

**Planned.** Hosting the published objects somewhere that keeps running; a scheduler;
identifying a bus's timetabled journey (not just its pattern); stop passage inference;
travel-time measurement.

## Commands

```bash
pnpm install --frozen-lockfile
pnpm dev                    # frontend only, http://localhost:3000
pnpm dev:live               # frontend + collector together, Ctrl-C stops both
pnpm dev:live -- --minutes 20
pnpm build                  # static export to out/
pnpm start                  # serve out/ with Python
pnpm test                   # Node contract tests, including MapLibre style validation
pnpm typecheck && pnpm lint
scripts/setup-browser.sh    # once: the browser's missing libraries, without root
pnpm test:browser           # the built out/ in a real Chromium with WebGL, desktop and phone
LM_REAL_LIVE=1 LM_BASE_URL=http://localhost:3000 pnpm test:browser tests/browser/real-feed.spec.mjs
                            # the same suite against a running pnpm dev:live, no fixtures
LM_REAL_ROUTING=1 pnpm test:browser tests/browser/walking-real.spec.mjs
                            # one request to the real walking router

python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m pipeline.run import        # archive: fetch, load, publish
.venv/bin/python -m pipeline.run status        # refresh and print Operations
.venv/bin/python -m pipeline.live init         # write an honest "unavailable" live state
.venv/bin/python -m pipeline.collect --minutes 10   # live collection alone
.venv/bin/python -m pipeline.stops import           # NaPTAN -> stops.json
.venv/bin/python -m pipeline.patterns build         # TransXChange -> patterns.json, every
                                                    # observed service with a valid file
.venv/bin/python -m pipeline.patterns build --coverage all      # every file valid today
.venv/bin/python -m pipeline.patterns build --lines 15,50       # named lines
.venv/bin/python -m pipeline.patterns build --max-lines 10      # quick development build
.venv/bin/python -m unittest discover -s tests      # full Python suite
python3 -m unittest discover -s tests               # parser and matching tests, skips DuckDB
.venv/bin/python -m pipeline.shapes build --lines 15,250,256        # road shapes, then `publish`
.venv/bin/python -m pipeline.motion_data export --lines 15,250,256  # reports for the evaluation
node --experimental-strip-types --import ./tests/alias-loader.mjs scripts/evaluate-motion.mjs
                            # writes a candidate; the published model is frozen (docs/MOTION_MODEL.md)
node --experimental-strip-types --import ./tests/alias-loader.mjs scripts/evaluate-frozen.mjs \
  --reports data/evaluation/motion-reports-fresh.json --label <name>   # the frozen model, fresh captures
node --experimental-strip-types --import ./tests/alias-loader.mjs scripts/evaluate-drawing.mjs \
  --reports data/evaluation/motion-reports-fresh.json --label <name>   # how smoothly it is drawn,
                            # and how far from later held-out reports
node scripts/probes/webgl-paint.mjs --loads 40 [--city] [--tile-delay 9000 --slow-tiles 1]
                            # repeated map starts on out/: painted or fallen back, and why
node scripts/probes/selection-playback.mjs [--base http://localhost:3100/]
                            # the selection scenario as frames, diagnostics, video, contact sheet
                            # (probes write to outputs/probes/, which Git ignores)
.venv/bin/python -m pipeline.route_coverage --line 15 --stop 1800SJ32231  # one route: patterns,
                            # road shapes, estimates and live buses, each reported separately
CADDY=/path/to/caddy deploy/validate.sh    # the server configuration, checked on this machine
scripts/preview.sh start|status|stop       # a temporary HTTPS link for a phone: out/ and the live
                            # /data through Caddy on 127.0.0.1, and a Cloudflare Quick Tunnel
.venv/bin/python -m pipeline.restore [--captures DIR] [--db PATH] [--limit N]
                            # read preserved position captures back into a warehouse: what makes
                            # deploy/backup.sh a backup rather than a pile of files
node scripts/probes/demo-recording.mjs --base http://127.0.0.1:8098/ [--label name]
                            # ~30 s of the actual app on whatever the base serves, as WebM and as
                            # labelled stills, with the take judged in recording.json
node scripts/probes/public-preview.mjs --base https://….trycloudflare.com
                            # that link checked as a phone reaches it (emulation), and 360/390 px layouts
node scripts/probes/passenger-layouts.mjs --base http://127.0.0.1:8098/ [--label name]
                            # the passenger's flow at 360/390 px portrait, landscape and desktop: frames,
                            # touch targets, covered controls, and a round trip behind the data
node scripts/probes/camera-switch.mjs --base http://127.0.0.1:8098/ [--real]
                            # outside and street preview in turn: no restart, reset, jump or frozen camera
node scripts/make-icons.mjs # the PNG icons (Apple 180 px, 192, 512, maskable 512) from the SVGs
.venv/bin/python -m pipeline.assess_matching --at 2026-09-13T13:16:22Z   # matching on a frozen moment
.venv/bin/python -m pipeline.replay_publications --captures DIR --db PATH --vehicle 3426 --out reel.json
                            # the publications a phone was served over a past window, rebuilt from captures
node scripts/probes/movement-replay.mjs --reel reel.json --vehicle 3426 --label name [--ride] [--phone]
                            # that reel through the built page, tracing every frame it draws
node scripts/make-recorded-ride.mjs --reel reel.json --operator BNGN --vehicle 3426 --journey 1147 --id <id>
                            # one vehicle on one journey as a published recorded ride (public/data/rides/)
node --experimental-strip-types --import ./tests/alias-loader.mjs scripts/evaluate-playback.mjs \
  --reports data/evaluation/motion-reports-fresh.json --jitter 8000,38000 [--baseline b9cbe88]
                            # the drawing between reports against the glide it replaced, same frames
node --experimental-strip-types --import ./tests/alias-loader.mjs scripts/evaluate-fleet-playback.mjs \
  --reel data/evaluation/reel-live-evening.json   # every bus in a reel through the drawing with its own
                            # road: movement, speed, swing, off-road distance, every repositioning, by bus
```

The warehouse is single-writer: a pattern build waits for a running collector to finish.

## Data definitions

**Observation identity** — `(operator, vehicle, route, direction, journey_ref,
observed_at_ms)`. Same identity and same coordinates is a repeat. Same identity and
different coordinates is a conflict. **A new timestamp is always a new identity**, so a bus
that reported again without moving is preserved. That is not evidence it stood still.

**Three clocks, never merged.** `observed_at` is when the vehicle reported (the source's own
string is kept verbatim in `recorded_at_text`). `retrieved_at` is when we fetched the
response. `published_at` is when we wrote the file. The age shown to a passenger is always
the age of the observation.

**Bearing** — SIRI-VM `Bearing`, the compass direction the vehicle is heading, stored with a
status: `reported` (a number from 0 to 360, where **0 is north, not missing**), `absent`,
`invalid` (unreadable or out of range, kept verbatim in `bearing_raw` and never repaired), or
`not_captured` (stored before bearings were recorded, which is unknown rather than absent).
A bearing is never derived from movement, and a bad one never costs the position. (Which way the
*drawn* bus faces is not a bearing and is not stored or published: since 24 September 2026 it faces
the way it is drawn travelling — its road's direction, or the straight stretch's — because a report's
own bearing belongs to that report's moment, and drawing another moment's put a route-43 bus across
its road. Since 25 September it turns only as it is drawn moving (15° a metre while creeping, up to
60° from 1 m/s), and a line
shorter than a bus's length gives it no direction, because scatter round a stand turned standing
buses round on the spot. `HEADING` in `lib/motion.ts`.)

**Stop identity** — a stop is a physical boarding point with an ATCO code. Two stops can
share a name and face opposite ways; NaPTAN's indicator ("Stop A", "opp") and bearing (the
direction a bus travels there) are what tell them apart.

**Service pattern** — one ordered list of stops a service calls at, from TransXChange,
identified by operator, line, direction and stops. It records the timetable file, revision
and validity, the operating profiles of the journeys that run it (weekdays, school terms,
special days; bank holidays recorded but not evaluated), and declared link distances. A
distance the file does not declare is **null, never zero**. A pattern no journey runs is not
published. A pattern that ends at a stop cannot be boarded there.

**A match** places a bus on a pattern, or refuses with a reason. Identity comes first: the
same operator, a timetable version valid on the report's day, journeys running that day, the
reported direction. Only then does position choose. Two different paths within 60 m of the
position stay **unresolved**, with every candidate kept; the operator's reported destination
may settle it and nothing else may. The published match carries its inputs as evidence.

**Progress** is stated against the pattern stop the report was *nearest* to: "last report
nearest Sevenways, 3 stops before yours". That stop may or may not have been called at yet,
so nearest-your-stop is never "at your stop" and a nearest stop after yours is "past your
stop in the stop order", not a measured departure. No error bound is claimed.

**Chosen bus** — the bus a passenger has chosen is a *pin*: a vehicle (operator and vehicle) and
the journey it was on when chosen (route, direction, journey reference), in `lib/selection.ts`.
Tapping a bus in a list, on the card or on the map pins it, and so does starting Follow or Ride
along on the bus shown; a journey restored from this device or a link is a pin too. The page's own
pick for someone who has not chosen, the first bus coming to their stop or the latest report on a
route, is only a *suggestion*, labelled as one and kept while it stays a candidate rather than
re-taken each time the lists reorder; with no stop chosen, the route it comes from is kept the same
way, while that route still has buses. A pin is never replaced by another bus. New reports, list
order, filters, gestures and theme changes leave it alone. Missing from the latest publication, it
is drawn hollow at its last report, never moved on, with "No current report" and other buses
offered, never chosen. The same vehicle reporting another journey stays the chosen bus and is said so
on the card, the strip, the ride card and the map (ANOTHER JOURNEY). Until the passenger chooses
to go on with that journey it is drawn at each report it makes, never estimated. It is neither
followed nor ridden with: the ride-along waits, paused, with the camera still.

**Stop activity** — what a bus's own reports say about it and a stop, in `lib/stop-activity.ts`.
*Last reported near X*: its latest report is no more than 150 s old and within 50 m of X, a stop
on the pattern it is matched to (so the stop across the road is never named), and where both give
a direction it agrees with the direction of travel at X. *Appears stopped near X*: in addition, at
least two distinct reports of the journey, at least 20 s apart, the latest no more than 60 s old,
lie within 40 m of X and within 15 m of each other. Never from the estimate, the drawn bus, the
timetable's assumed pause, a repeated report or a single position. Near is not at, and nothing
says doors are open or that anyone can board. The evidence (each report read, its distance from
the stop, and whether it counted) is under "How we know this".

**Travelling between reports** — a bus that is not being estimated (no accepted road geometry, or a
service the motion evaluation has not scored) is drawn at its reports, and since 21 September 2026
it *travels* from the report it was drawn at to the report that has arrived, taking the time the bus
itself took between them, then waits there (`GLIDE` in `lib/motion.ts`). Both ends are observed
positions. The straight line between them is not claimed to be the road, the drawn bus faces along
the line it travels (no bearing is recorded from it), and the drawn bus is never carried past the newest report: what is shown is
always between two positions the bus really reported, and always older than the newest of them.
Measured over 27 recorded journeys, it is behind the newest report in 65% of frames, by a median
54 m while it is — that is the cost, and it is stated on the card, which reads "Moving between its
reports · latest N s ago" and says plainly that the bus is not tracked continuously. A gap over
400 m, or longer than 30 s, is left as the step it is. This is not an estimate, is never stored or
published, and "reported positions only" still means the newest report and nothing between.

**Estimated position** — where a selected bus has probably got to since its last report,
computed on the device (`lib/motion.ts`) and never stored, published or treated as a report.
Three clocks and three things are kept apart: the reports (immutable, each at its observation
time), the estimate (the bus's state at the presentation time, re-derived from the reports
available by then; a new report is reconciled at the same presentation time as the estimate it
replaces, so the difference between them is a correction, never a mixture of times) and the
drawn position (which follows the estimate's own path on the road with a speed that changes
gradually; while the bus moves, a step back no larger than the estimate's measured error at
that report age, and at least 35 m, is waited for at half the path's speed rather than reversed,
and not by standing, which would look like a stop the reports never showed; when the estimate
stops, so does the drawn bus; over 150 m it snaps to the new report and says so; `DRAWING` in
`lib/motion.ts`, measured by `scripts/evaluate-drawing.mjs`). An estimate moves only along an accepted road shape, at the speed the bus's own recent
reports show while moving, pausing 10 s at each timetabled stop it reaches and eased off slightly as the report
ages (motion-3, fitted on the earlier captures by a rule set before any held-out figure was
read), for at most the measured horizon of 120 s. Anything
else falls back to the last reported position, with the reason: no shape, an unsettled branch,
a report off the road, too old, too few reports, a jump, the feed not live, or the passenger's
choice of reported positions only. It is labelled "Estimated position" with the real report
age.

**Road shape** — the road a service pattern follows, built by routing a bus through its stops
(FOSSGIS Valhalla, NaPTAN bearings as headings) and **accepted only when at least 30 matched
reports lie within 35 m of it at the 95th percentile**. Stop coordinates alone never stand in
for the road.

**Walking route** — a pedestrian route from the passenger to the chosen boarding point, from an
OSRM foot profile, asked for only when the passenger chooses to. With no route the page says
why; a straight-line distance is always labelled as one.

**Freshness policy** (`pipeline/freshness.py`), derived from measurement, not taste:
fresh ≤ 60s, ageing ≤ 150s, stale ≤ 900s, expired > 900s. The last shown band ends exactly
where the withheld band begins, so a position is either drawn with an honest age or not drawn
at all. Our own publication is stale after 120s; a timestamp more than 120s ahead of
retrieval is refused.

**Reconciliation identities**, each side computed from a different table:

```
activitiesTotal  = activitiesInArea + outsideArea + rejectedRecords
activitiesInArea = retainedObservations + repeatObservations + conflictingInputRows
publishableObservations = retainedObservations - suppressedObservations
observationsInServedFile + outsideCaptureWindow = publishableObservations
servedFileSha256 = recordedPublicationSha256
```

## Design decisions worth knowing

- **Expiry is a correctness control, not decoration.** The feed carries positions up to a
  day old. Without an expiry threshold a naive app draws yesterday's bus as traffic today.
- **A repeated payload is not new information.** Identical bytes are recorded as
  `repeat_payload` and do not advance the payload-change time.
- **Conflicts are withheld, not resolved.** We do not pick a winner.
- **Observed and estimated positions are kept apart.** Every published report is an
  observation (`positionKind: "observed"`) with its own timestamp, kept exactly as received.
  Since 13 September 2026 the owner has approved clearly labelled estimated movement: bounded
  prediction from a bus's recent reports, reconciled as each new report arrives, drawn and
  worded as an estimate with the actual report age beside it, and limited by measured
  behaviour. An estimate is never stored, published or counted as an observation, never
  proves that a bus reached, left or served a stop, and an observed-position mode remains.
- **A route number is not a service.** Operator, timetable version, operating day and
  direction are checked before position; a shared current stop is not a shared route.
- **A chosen bus is never substituted.** Up to d2e8702 the page showed whichever bus was first in
  lists ordered partly by report age, so following or riding along with the bus shown jumped to
  another as soon as the other reported more recently (reproduced by `tests/browser/selection.spec.mjs`
  on that build). What the page suggests and what the passenger chose are now kept apart, and every
  way of choosing pins the vehicle.
- **Three distances, three labels.** You to your stop (a walking route with its source when
  asked for, otherwise a straight line labelled as one), the bus to your stop (straight line,
  plus the declared stop-sequence distance where it exists), and arrival, which is not
  predicted.
- **An estimate is judged by what a passenger sees.** Its settings are fitted on earlier
  captures and scored on later ones against the last report itself, and the evaluation also
  measures how far the drawn bus would move when each report arrives. The speed's easing with
  report age was chosen to cut how often a new report pulls the bus backwards, without losing
  accuracy.
- **Five feed states** — live, not updating, offline, not collecting, archive replay — never
  collapsed into one "last updated".
- **Colours carry meaning.** Blue is You, orange is your stop, lime is your chosen bus; none
  appears in either basemap theme (a Node test enforces it).
- **The map is created once.** Themes repaint it in place; views change its camera; its
  creation depends only on stable callbacks. `pnpm test:browser` checks the canvas identity
  through clock ticks, publications and a theme switch.
- **The passenger's page has no engineering in it.** A passenger said Explore, Evidence and
  Operations made no sense, so they sit behind one secondary link. The evidence is kept, not
  hidden: every figure is there, one step away, with its own address for reviewers.
- **Runtime config over rebuilds**, and **a 10 s polling floor** (operators publish every
  10–30 s).

## Verified capabilities

Executed, with the check in the repository. Numbers from earlier milestones are in
`docs/LOCAL_VERIFICATION.md`.

- **Passenger feedback: navigation, phones and returning (14 September 2026, evening,
  latest):** checked in Chromium, not on a physical phone; FIXTURE unless marked REAL.
  - **Navigation.** The passenger's page has no tabs and does not wait for the recording. Behind
    the data holds Operations, Evidence and Recorded journeys at their own addresses. A round trip
    there keeps the stop, the chosen bus, the ride-along and the very map (`navigation.spec` at
    both sizes; the layout probe at five sizes).
  - **The old build's problems, reproduced first by the new layout probe:**
    - the recording gated the page;
    - search matches were hidden behind the keyboard;
    - the answer was below the fold;
    - in landscape the ride card covered "Front view";
    - a malformed file took the page down.

    Each is gone on the final build. A sticky strip covering the ride's controls, introduced on the
    way, was found by a new covered-control check and fixed.
  - **Camera switching,** FIXTURE and REAL (route 15, MF74NPD): no restart, reset, change of bus or
    jump, and the street preview's camera was never still while the bus moved. The reported freeze
    was not reproduced.
  - **REAL, through the public link:** publications arrived through the service worker from the
    network, the chosen bus was kept, and a pinch zoomed the outside ride-along.

  Typecheck, lint, the build and 137 Node tests pass. The full browser suite: 182 passed, 24
  skipped by design and 2 failed.
  - One was a wrong test locator; corrected, `navigation.spec` then passed 18.
  - The other was a check that failed identically on the previous build; its helper now brings the
    bus into view, and `selection.spec` then passed 23.
- **A temporary HTTPS preview for the phone trial (14 September 2026, afternoon):** the
  build and the live data served through Caddy on 127.0.0.1 and a Cloudflare Quick Tunnel. It was
  checked through the public address, with REAL data, in Chromium's emulation, not on a physical
  phone:
  - the page, MapLibre's worker, 81 tiles and the runtime configuration load; the service worker
    controls the page; `Permissions-Policy: geolocation=(self)` permits location;
  - a chosen bus (SK74BMZ, route 15) stayed chosen through two further real publications, with no
    rebuild;
  - 15 private paths return 404, and the BODS key is in nothing served;
  - at Marston Road (nr), route 15's outbound pattern to Roedean Gardens calls there, with an
    accepted road shape and estimates, and the page listed the buses coming;
  - at 360 and 390 px no control overlapped another or was clipped;
  - a pinch in the outside ride-along did nothing on touch. It now zooms and keeps following, with a
    new phone check in `ride.spec`.

  Typecheck, lint, the build and 134 Node tests pass. The focused browser run (ride, access,
  selection, journey and the ride-entering motion checks) passed 104, with 4 skipped by design and
  none failing.
- **Front view as a street preview, and a slow map (14 September 2026, early
  afternoon):** one visual refinement, checked on FIXTURE data.
  - **Before and after, on the same road.** The same 40 s were recorded on each build
    (`scripts/probes/front-view.mjs`): a straight, a turn and a 40 m correction, at night, on
    desktop and phone.
    - The eye moves by the same median step, 0.74–0.75 m per 100 ms, and turns through the corner
      at the same rate (p95 17.5°/s, against 17.7–18.1°/s).
    - The ride stays following throughout.
    - The pitch falls from 83° to 77°.
    - At the turn, the frames gain street names, a named stop, lighter buildings and kerbs, and a
      graded sky.
  - **A slow map.** With every tile 8 s late, the stop, the walk guide, the bus card and the lists
    all work, and **Use the simple map** is offered whole on the first screen at both sizes.
  - **Found and fixed on the way:**
    - a wheel in the front view neither zoomed nor paused following;
    - leaving the ride by keyboard left focus on the page itself for a moment;
    - a stop found by name showed two Locate me buttons.
  - **Checks.** Typecheck, lint, the build and 134 Node tests pass. On the final build the whole
    browser suite passed 169, with 21 skipped by design and none failing.
- **Before the first passenger test (14 September 2026, late morning):** four gaps from an
  outside review. Each was reproduced on a build without its fix, then fixed and checked on the
  final build (FIXTURE):
  - **a moving chosen bus that starts another journey** is kept and drawn at each report, never
    estimated; the map stops following it and the ride pauses until Continue (`selection.spec`,
    ridden and followed, desktop and phone). Before the fix, the new journey was estimated and
    followed;
  - **choosing a bus on the map:** clicking or tapping its drawn MapLibre marker chooses it,
    including a phone tap 20 px off centre and a bus 14 px from the chosen one. Before, the
    chosen bus's layer always won the tap;
  - **a keyboard-only journey** from stop search to leaving the ride works. Before, focus fell to
    nothing when the ride began;
  - **slow live data** says CHECKING instead of NOT COLLECTING;
  - **slow tiles** no longer force the fallback map. The first whole tile needs two slow round
    trips, the tile and then its glyphs. With every tile 9 s late the map now paints at 21–26 s,
    where it fell back at 12.5–13.9 s.

  Monday's own captures (86 journeys, 00:00–11:49 BST) were scored, nothing refitted, where they
  could be. On routes 15 and 250 the frozen model's median error up to a minute was 62.7 m (the
  last report 118.3 m), and the drawn bus's 60.7 m. Route 256 could not be scored (see Known
  limitations). Typecheck, lint, the build and 134 Node tests pass. `selection.spec` passed 23, with 1 skipped
  by design; `access.spec` 5 of 5; `map.spec` every desktop check. On the build before the final
  one (differing only in the tile allowance), the ride, motion, journey, journey-context and replay
  specs all passed.
- **One bus, kept (14 September 2026, morning):** 134 Node tests (among them the pin and
  the suggestion, stop activity case by case, and the drawing's crawl, which stops when the
  estimate does), 92 Python tests, typecheck, lint and the static build. On the final build the
  full browser suite passed 142, with 18 skipped by design and none failing. It includes
  `selection.spec`, which failed 6 of 6 on d2e8702 and now covers:
  - reports taking turns between two buses, and two routes taking turns;
  - a theme change, a filter to another service and a drag of the map;
  - the bus missing and back, and on a new journey;
  - the keyboard and a tap;
  - live positions stopping;
  - a tap on another bus on the map. This check was added with the last fix, and run on the
    rebuilt app with `map.spec`: 23 passed, 9 skipped by design.

  Under `next dev` the same kind of checks passed once two stop-activity checks were corrected
  (the faults were theirs, not the page's). LIVE, during a bounded 30-minute collection (89
  cycles, 88 succeeded), the real-feed checks passed 6 of 6, twice: a real bus followed and then
  ridden through five real publications without being replaced (BNML 245 and BNGN 37 on the
  final code). RECORDED, the drawing against held-out reports:
  - median error 61 m on fresh captures and 59 m on development ones (the estimate 55 and 52 m,
    the last report 113 and 86 m);
  - display lag 2.5 and −0.5 s;
  - stands the reports contradict, down from 11.9 to 3.2 an hour.

  The map start: one tile 9 s late had forced the fallback at 7.5–7.8 s; on the final build that
  load paints at 10.6–11.3 s, and 100 ordinary loads all painted. Details are in
  `docs/LOCAL_VERIFICATION.md` and `docs/MILESTONE_CHECKLIST.md`.
- **Ready for a first passenger comparison (13 September 2026, late evening):** 111 Node
  tests (among them the drawing's rules: the drawn speed never steps, a pause at a stop is eased
  into and out of, a report within the estimate's measured error is waited for rather than
  reversed, a frame after a pause does not leap) and 92 Python tests (with the route coverage
  check), typecheck, lint and the static build on the final code. In a real Chromium on the final
  build, every browser check: 120 passed and 16 skipped by design, none failing (the ride and
  replay specs, then everything else); the real-feed checks against a running `pnpm dev:live`,
  desktop and phone, 4 passed, the ride-along following a real bus among them; and the real
  recorded 256 journey through the page, 1,325 frames over 281 s, 13 reports eased, no snap, the
  largest step outside a correction 3.7 m. The drawing, measured over every captured journey with the frozen estimate:
  speed steps 267 an hour to none (development, 109 journeys) and 292 to 0.1 (fresh, 30
  journeys); reversing 1,198 to 405 and 1,048 to 302 m an hour; at the cost of the drawn bus
  straying further from the estimate (95th percentile 84–87 m, against 49–53 m; a distance
  between two computed positions, not an error against where the bus was, and not GPS accuracy;
  the held-out comparison came the next day, below). The frozen
  model on fresh captures from the same evening: median error up to a minute 65 m, against 143 m
  for the last report. The deployment configuration validated locally (seven systemd units; the
  Caddyfile run with 19 route and header checks). Details in `docs/LOCAL_VERIFICATION.md` and
  `docs/MILESTONE_CHECKLIST.md`.
- **Ride-along, night map, motion and the window-seat journey (13 September 2026, evening; the
  film and its checks were removed later that evening):** 102 Node tests, typecheck, lint and the static build on the final code (87 Python
  tests earlier the same day; no Python changed). In a real Chromium on the final build: the 36
  browser checks that enter the ride-along, at desktop and phone size, all passing, and the
  window-seat checks, which play the real film through YouTube's embed and show the fallback when
  the player is blocked (5 passed, 1 skipped by design). The evening's last full browser run, on
  an earlier build, passed 104 of 107; its three failures were repaired and pass on the final
  build. A real recorded 256 journey replayed through the page: 1,481 frames over 276 s, 13
  reports reconciled by eased corrections (median 53 m), no snap, backward drawing only while a
  correction settled. Held out, the stop-aware estimate (motion-3) against the previous model and
  constant speed: error up to a minute, median 62.6 m (64.9, 69.3); mean visible move per
  arriving report 65.5 m (68.0, 70.7); reports pulling the bus back over 35 m 26.2% (20.9%,
  32.6%); snaps 8.9% (10.0%, 10.3%). Details in `docs/LOCAL_VERIFICATION.md` and
  `docs/MILESTONE_CHECKLIST.md`.
- **Walking guidance and estimated movement (13 September 2026, afternoon):** 87 Python tests, 95
  Node tests (the motion model's rules, the presentation clock, walking requests, failures and
  jitter), typecheck, lint, the static build, and 77 browser checks on the final build at
  desktop and phone size, none failing. Thirteen are skipped by design: the real-feed and
  real-walking checks, which need a live run or a real request and passed separately, and
  nine map checks that run on desktop only. Real captures: 109 journeys on
  routes 15, 250 and 256 (11,367 reports), split in time. On the 38 held-out journeys, within
  30 s of a report the estimate's median distance from the next report was **45.7 m against
  61.1 m** for the last report itself (3,907 cases). When a new report arrived, the drawn
  estimate moved a median of 51 m; 21% of those moves went backwards by more than 35 m (33% at
  constant speed) and 10% were over 150 m and snap. Real walking routes from
  routing.openstreetmap.de, for example 220 m and 3 minutes to St Modwen Road (nr). Details are
  in `docs/LOCAL_VERIFICATION.md` and `docs/MILESTONE_CHECKLIST.md`.
- **Earlier the same day:** 73 Python tests (identity-first matching, the
  shared-stop branch regression, operating days and school calendars, unknown link distances,
  coverage selection without a cap, publication by any stop inside the area, and matching
  against every held pattern, Bearing from 0 to 360 through storage, migration and
  publication), 70 Node tests (progress and association wording, the stop schematic,
  operating days in the browser, MapLibre validation of both themes, reserved colours),
  typecheck, lint, the static build, and 43 browser checks on desktop and a 390 px
  phone: stop-first discovery with location granted and refused, opposite-side and uncovered
  stops, shared-stop branching, day and night themes on one map instance, 2D, City and the
  ride-along and back, a failed 3D model, live, stale (report ages include the publication's
  own age), offline, unavailable and replay, no control, note or card over the map covering
  another in any view, the map lifecycle through clock ticks and publications, and four
  fallback modes.
- **Real feed:** bounded `pnpm dev:live` runs on 13 September on this machine. On the
  corrected code the publication of 14:16:22 BST held 342 buses: 267 with a reported bearing,
  75 without, none invalid; 201 placed on a timetable pattern, 57 kept unresolved between
  branches, 78 on routes with no timetable held, 4 too far from any pattern stop, and 2 on a
  service whose valid timetable has no journeys that day. The real-feed browser check passed
  on desktop and phone. One supported example, as the page showed it: BNML 250 (vehicle
  BU25YVB) to The Trafford Centre, bearing 242°, reported 14:16:27, one fitting path, revision
  20 of its timetable; at Matt Busby Way (westbound, Wharfside Way) the page read "Timetabled
  to call at your stop", last report nearest Trafford Bar, one stop before yours, 940 m in a
  straight line and 1.2 km along the stop sequence, arrival time not predicted.
- Earlier: real BODS collection runs (12 and 13 September), archive import reconciliation,
  the live collector's failure handling, the map lifecycle and worker repairs.

## Known limitations

- **Local only.** One WSL process, no scheduler, no hosted worker. When the machine stops,
  collection stops. Nothing is labelled continuously live. A server configuration is written
  and checked locally (`deploy/`), but nothing is provisioned: the certificate, the collector
  under systemd and the nightly rebuild have only been validated, not run. A temporary public
  preview (`scripts/preview.sh`) serves this machine's build and data through a Cloudflare Quick
  Tunnel. It lasts only while this machine and WSL stay up, gets a new address at each start, and
  has no uptime guarantee.
- **Along-route distance is a stop-to-stop chain, not road geometry**, and is null where the
  timetable omits a link (about 1.6% of links across the three datasets).
- **Progress has no measured error bound.** It is counted from the nearest pattern stop.
- **Stop activity says less than it might seem to.** "Appears stopped near" rests on reports about
  20 s apart: a bus standing at lights within 40 m of a stop reads the same as one at it, and a
  short call between two reports is missed. The thresholds (50 m, 40 m, 15 m, 20 s) are reasoned
  from GPS noise and report spacing; they have not been measured against observed calls.
- **Route 256 on a weekday cannot be placed, and that is upstream.** Traced to source on
  17 September and rebuilt on a weekday to confirm it: the TfGM registration in force for the 256
  from 30 August 2026 holds a Saturday file, a Sunday file and three single-journey school files,
  and **no Monday-to-Friday inbound service**. The registration that expired on 29 August had one,
  with 101 journeys. So a weekday 256 towards Piccadilly Gardens is refused with
  `no_pattern_for_direction_today` and its position is still shown. Not a build-day artefact, and
  not fixable here. Route 15 is the route to use for a trial. `docs/COVERAGE.md`.
- **A vehicle and its current journey are identified; the *timetabled* journey it is running is
  not.** These are different things and the difference matters. Every report carries the operator's
  own vehicle reference and journey reference, and a chosen bus is pinned by
  (operator, vehicle, route, direction, journeyRef) and never substituted — so "the same bus" is
  never a guess. What is missing is the link from that journey to a *scheduled* journey in the
  timetable: the feed's journey references matched none of the timetable's journey codes in the 10
  checked, so branches are settled only by the reported destination, and **no scheduled time at a
  stop is ever shown**. Identifying the timetabled journey is the next priority (2 below).
- **Bank-holiday operation is recorded, not evaluated.**
- **Coverage is limited to the timetables held:** four TfGM operator datasets (BNML, BNSM, BNFM and,
  since 19 September 2026, Go North West's **BNGN**). **114 observed services still have no timetable
  here** (18 September 2026), and their buses are refused with that reason. What is left is a
  scatter across several operator groups rather than one gap: Diamond (**BNDB**: 66, 87, 79, 151, 29,
  70, 74), **BPTR** X43, **LNUD**, **NATX**, **HIPK** — and, oddly, **BNML 38 and 150** and **BNSM 1
  and 2**, lines whose own operator's dataset we hold, which is a separate thing to trace. Ambiguity grew with
  coverage: more patterns mean more paths that fit a position equally well, and those stay
  unresolved — 139 of 587 vehicles in one publication.
- **The ride-along bus is a stylised generic model** at true scale (12 m); it identifies
  nothing about the real vehicle. The camera frames the drawn heading; a bus without one (no
  checked road, no reported bearing, not yet drawn moving a bus's length) is shown from above as a
  round token, and the ride says so.
- **Estimated movement still covers 6 patterns on 3 routes** (15, 250 and 256), unchanged. Road
  geometry now covers 114 accepted patterns on 77 lines, which releases the **front view** and
  nothing else: prediction is gated separately on the published evaluation having scored the frozen
  model on that very pattern. Every other bus is drawn travelling between its own reports, which is
  movement without prediction. The model is frozen
  (`docs/MOTION_MODEL.md`). It was fitted on one Sunday's captures, and scored on fresh captures
  from that Sunday evening (median error up to a minute 65 m, against 143 m for the last report)
  and from one Monday morning on routes 15 and 250 (62.7 m against 118.3 m, with no peak hour and no
  afternoon). Weekday traffic is barely tested. Real corrections remain: about 1
  arriving report in 4 finds the estimate more than 35 m ahead of the bus, 2 in 5 more than
  35 m behind, and 1 in 10 over 150 m away, which snaps with the card saying so. The cause is
  measured, not guessed: buses stand at stops and lights while any estimate rolls on, and the
  reports are 20 s apart. The drawing absorbs corrections by speeding up or slowing rather than
  jumping, so the drawn bus can trail or lead the estimate for several seconds after a report,
  and smoothness costs position: held out against where each bus next reported, the drawn bus
  was 59 and 61 m from it at the median (development and fresh captures), the estimate 52 and
  55 m, the last report 86 and 113 m. Near a stop the drawn bus was 40 and 44 m from it.
- **The front view is a stylised preview, not a street view or the view from on board.** It is
  drawn from OpenStreetMap vector tiles: extruded, untextured building blocks at OSM's heights,
  road ribbons at typical widths, a plain graded sky; no lane markings, signals, trees, street
  furniture or other traffic. The eye is 7.5 m above the road shape, higher than a passenger's,
  and on the shape, not in any lane. Where OSM has few buildings mapped it is sparse, and a street
  with no name in OSM gets none. It shows the estimated position, so it can look more certain than
  it is; the HUD keeps the report age and "estimated position" in view. Its value is modest: after
  the refinement it reads as the street ahead, with names and the next stops, but it adds little
  the outside view does not, so it stays secondary and outside is the default. Offered on the 6
  patterns with accepted road shapes only; judged in a software renderer, not on a phone. On a
  phone the ride's buttons and the map's tools cover the view's upper part, and the ride card its
  lower part, so a street name can be hidden. That was so before the refinement too.
- **The ride-along's identifiability was judged in a software-rendered browser** on a 1280 px
  desktop and a 390 px phone, by projection and pixel measurement and by eye on the frames;
  a real phone, a real GPU and sunlight are still unchecked.
- **Walking routes depend on a free community service** (FOSSGIS e.V.) with no service
  guarantee. Its usage-policy page, in German, was behind a bot check and could not be read in
  full here; the limits followed are the ones its own pages state (attribution, a "fix the map"
  link, at most one request a second, no heavy use, requests logged).
- **Returning depends on a lasting address.** Saved stops, routes and the journey are kept in this
  browser for this address. A home-screen icon for the temporary trial tunnel would stop working
  when the tunnel ends, and the page says so there. No physical iPhone or Android installation, no
  real screen lock or backgrounding, and no real connectivity change has been tried: those were
  exercised in Chromium only.
- **"Moves outside, freezes in the street preview" was not reproduced.** It was reported, then
  checked on FIXTURE and REAL data in Chromium: the camera moved in every sample where the bus did,
  across every switch. The cases where the street preview holds still by design:
  - after any gesture on it, until **Return to bus**;
  - under reduced motion, where it steps every 3 s;
  - when the drawn bus itself has stopped.

  A low frame rate on a real phone's GPU (the view is pitched to 77°, with extruded buildings)
  could also look like a freeze and is untested. A missed finger lift would have held the camera
  still; the count is now ignored after 8 s without change.
- **No Metrolink.** The app covers buses only. No official source gives tram positions, and
  TfGM's real-time portal is closed to new users (section 11a of the redesign research).
- **The browser checks render with SwiftShader**, a software WebGL. They prove the map paints,
  survives updates, switches views and falls back correctly; they say nothing about real-GPU
  performance or battery. A check on a real phone is still outstanding.

## Two areas, deliberately different

`core.BBOX` is the box the retained **archive** sample was collected under and is fixed.
`core.SERVICE_AREA` is wider and is what **live collection and stop discovery** use, so
Longford Park and Stretford are inside it.

## The passenger view

**The passenger's page is the whole page.** It has no tabs: the header's one link, **Behind the
data**, opens the engineering area. That area holds a four-step account of the pipeline (collect,
check, publish, freshness), a "right now" line from the live publication, and three views:
Operations, Evidence and Recorded journeys (the archive replay, dated and badged, never live). Each
view has an address: `#behind-the-data`, `#operations`, `#evidence`, `#recorded-journeys`. The
browser's Back returns to the buses, as does **Back to buses** in the header. While the area is
open, the passenger's page stays mounted, hidden and `inert`, so its state is kept and restored
exactly: the stop, the chosen bus, a ride-along, the map instance, the scroll position and the
focused control. A view there that throws is contained in place (`SectionBoundary`). The
passenger's page never waits for the recording.

Stop-first. **Buses near me** and **search** find a boarding point; each nearby stop shows
its side of the road (NaPTAN bearing), its street, and the timetabled services leaving it
today. Choosing a stop shows the walk there (on request), the buses **coming to your stop** by
the timetable's stop order, those that **may be coming** (a branch not yet settled), buses
**last reported nearby** (within 150 m, not coming to your stop), and, folded away, **more
buses near your stop**: already past it, not for it, and old reports. With nothing chosen, the
card shows a **Suggested bus**, only ever one coming to the stop; following it, riding along with
it or tapping any bus chooses it (see *Chosen bus*). A bus chosen from the other groups is labelled
**Selected bus**, says it does not serve the stop, and offers the way back. A strip under the map
keeps the chosen bus and its status in view while the lists below are browsed. When no bus is
coming, one message says so, with what can be done next (the buses that may call, those nearby,
another stop), instead of the same news in three places. Before the first publication arrives, the
page says CHECKING, waiting for the first positions, and a chosen stop says its buses will appear
once they arrive, not that none has a current report.

The answer card: which bus and destination; the answer first (its progress in stops from its
last report); whether it is drawn at an estimate or at its last report, with the report's
age and the reason; your walk; which boarding point; whether it is timetabled to call there
(or on how many of its possible branches); the three distances; and "How we know this", the source
report, bearing, match inputs, timetable version, verdict and the SHA-256 of the file the
page received. A schematic of named stops shows the order, labelled as not the road.

**The map** is an original MapLibre style over OpenFreeMap's OpenMapTiles vector tiles
(`lib/map-style.ts`), inspired by the elevated inked city maps of historical games: a paper
day theme and an ink night theme, cased roads, district names in spaced capitals, landmarks,
detail admitted by zoom. **2D** is north up and flat; **City** tilts it and raises the
buildings; **Fit journey** frames you, your stop and your bus without letting distant buses
widen it. Buses with a reported bearing carry a nose pointing where they are heading.
**Ride along** is one camera state at a time, shared by the map's frame loop, its HUD and the
passenger card (`data-ride`): *entering* (straight to the bus, with no introduction: the camera
first brings the drawn bus to the middle at the zoom shown, then zooms, tilts and turns around it,
so the bus never swings out of the frame), *following* (the camera is put on the drawn bus every
frame, but never while the map is already moving or fingers are on it, so an animated zoom, a wheel
or a pinch runs to its end and the camera glides back, at the passenger's zoom), *exploring* (a drag pauses following; the bus goes on without
the camera and one button, **Return to bus**, glides back to the ride framing) and *returning*.
A gesture during entry or a return ends it; a transition made obsolete by another bus or by
leaving is cancelled by its token. The framing is zoom 20, above and behind the drawn heading.
The map's padding changes only while the camera is still: setting it is a jump, which would
cancel a glide. The passenger's own zoom is kept through updates. **Front view**, optional and
secondary, is a raised stylised preview of the street ahead: the eye 7.5 m above the road shape
where the bus is drawn, looking 32 m ahead (a pitch of about 77°), with the bus's own outside
hidden and the route, destination, report age and estimated-or-reported status kept in the HUD
(mode line "street preview · following the bus") beside an **Outside view** button. It is offered
only for a bus on an accepted road shape (one checked against that service's own reports);
otherwise the button says why and the bus is left as it is. In it the heading is eased, so each
corner of the road shape turns the view smoothly. Buildings and kerbs are lightened against the
road, and the night sky is graded to a horizon. Street names laid along the road give way to
upright names from the map's own `transportation_name` data. Up to three stops of the bus's
pattern are labelled with their NaPTAN names. Because the camera sets its own height every
frame, a wheel or a pinch there pauses following, as a drag does, and Return to bus resumes it.
Both views follow the same drawn state, and the drawn bus follows the estimate smoothly: along
the estimate's own path averaged over the few seconds of it already known, so a pause at a stop
is eased into and out of, with a speed that changes gradually and never steps; a report that
finds the drawn bus ahead of a moving estimate, by no more than the estimate's measured error at
that report age, slows it to half the path's speed until the estimate catches up rather than
reversing it or standing it still (`DRAWING` and `drawingFor` in `lib/motion.ts`). The chosen bus is identifiable at every zoom: below 18 the flat lime marker with its
route number; from 18 the stylised 3D bus (`public/models/lm-bus.json`) inside a lime ground
ring with the route number floating above it, both symbols, which MapLibre draws over every
building, so a model behind one is still found. The HUD carries a short mode line ("Ride-along
· following the bus") with the explanation behind "What is this?". The chosen bus's recent
reports are drawn as **hollow rings at half a marker's size** — its own past, not other buses, and
not selectable — and an estimate as a dashed line from its report to the drawn bus, captioned
ESTIMATE. A tap tests **every layer that draws a bus**: the flat marker, the route number beside it
and, from zoom 18, the 3D model, the ground ring and the badge; a hit on a shape is measured from
the bus it belongs to, so a marker nearer the finger still wins. The walking route is dotted blue. If the model cannot load the flat
symbol stays; if WebGL or the basemap fails, the drawn SVG map takes over, and says why. A slow
tile is not a failure: the start (the module, the map and its first frame) has 7 s. The tiles
then have their own allowance:
- 12 s for the tile service to answer at all, counted from the camera last coming to rest (each
  move asks for new tiles);
- once it has answered, 40 s for a first whole tile. On a slow network that takes round trips in
  turn: the tile, then the glyphs for its labels;
- with some tiles in, a late one is waited for up to 25 s.

While it waits, the map says "Drawing the map…". After 3 s it offers **Use the simple map**,
because the bus information is already there. The simple map then says it was chosen and offers
the detailed map back. There is one location control at a time: with no stop chosen, the map's
own **Locate me**; with a stop chosen, the walk guide owns it (**Locate me** while it asks, then
**Update my location**, since ba7d995), and the map's own stays out. **Make the map bigger** gives the same map most of the screen.

A tap chooses the bus drawn nearest to it within a finger's reach (14 px beyond its marker), so a
bus beside the chosen one can be tapped. Keyboard focus is never dropped by the ride's controls
coming and going: the ride's region takes it when the ride begins, and Ride along gets it back
afterwards. Details under the map moves focus to the card.

**No embedded film.** An embedded "window-seat journey" (an independent creator's upper-deck
video of a 142, played through YouTube's embed on the Explore tab) was added on 13 September and
removed the same evening at the owner's request, with its component, metadata, tests and
styles. What the owner wants from a window seat is a virtual view from the bus moving through
the mapped streets, drawn by this app from its own map and motion state, not someone else's
recording. The recorded GPS replay (real reports re-timed through the page) and the motion
evaluation are a different thing and remain: they replay observations, not video. The
ride-along's **Front view** is that virtual view, drawn from the map's own vector tiles and the
displayed motion state, with its limits stated below.

MapLibre's own modules are served unbundled from `public/vendor/maplibre-gl/<version>/`
(`scripts/vendor-maplibre.mjs`), because bundling them rewrote the worker URL to a
build-machine path and no tile ever loaded.

## Stop and timetable coverage

- **3,498 active bus stops** in the service area, from NaPTAN ATCO area 180, each with its
  indicator, street and, where NaPTAN has one, the direction a bus travels there.
- **Timetables:** four TfGM TransXChange datasets are preserved, one per operator group
  (**BNML, BNSM, BNFM, BNGN**). The collector re-downloads them while it runs and stores each distinct
  version by content hash; **only the newest snapshot of each is read**, because reading them all
  counted the same service twice. On 18 September 2026, **633 files** were read — every file whose
  declared validity touches the fortnight ahead — and 555 expired ones were not.
- **Selection:** every operator-and-line pair seen in the collected positions that has a valid
  file: **183 services, 576 patterns, 574 distinct stop sequences published** (BNML 259, BNSM 255,
  BNGN 52, BNFM 10). A pattern is
  published when it calls at a stop inside the area and has at least five stops. `--coverage all`,
  `--lines` and `--max-lines` are explicit alternatives, and whichever is used is written into
  `patterns.json` under `coverage`, with the observed services that have no timetable.
- **114 observed services still have no timetable here.** Adding Go North West closed the single
  largest gap; measured on **one fixed capture of 653 weekday-afternoon reports asked of both
  catalogues**, reports with no registration held fell from **174 to 109**, all of it 13 services
  that gained one. The remainder is a scatter of operator groups whose datasets are not downloaded
  (BNDB, BPTR, LNUD, NATX, HIPK), plus a handful of lines — **BNML 38** (20,808 observations),
  BNML 150, BNSM 1 and 2 — whose own operator's dataset we do hold and which therefore need tracing
  rather than downloading.
- `patterns.json` is 2.06 MB (160 KB gzipped), fetched once. `docs/COVERAGE.md` audits all of this
  service by service, and the same ledger is in the app under Behind the data.

## Next priorities

0. **Before the passenger trial:** check the tester's own route on a weekday with
   `.venv/bin/python -m pipeline.route_coverage --line <line> --stop <ATCO code>`. Route 256
   inbound had no weekday timetable pattern here. If the route is not covered, rebuild the patterns
   on a weekday (`.venv/bin/python -m pipeline.patterns build`, with no collector running) and
   check again.
1. **Provision the hosting that is already decided** — Hetzner CX23, no paid backups, a free
   subdomain — so collection runs when this machine does not. `docs/PROVISIONING.md` is the
   step-by-step and names the only three things that need the owner: creating the server (reading
   the console's own total before paying, because the documented €5.99 net may have moved again),
   pointing a free subdomain at it, and putting the BODS key on it by hand. Everything after that
   is scripted and validated locally by `deploy/validate.sh`. It is also what a phone trial needs:
   a phone lets a page use its location only over HTTPS. Until then, `scripts/preview.sh` gives a
   temporary link (`docs/PASSENGER_TEST.md`).
2. **Identify the timetabled journey**, not just the pattern: match the operator's reported
   origin departure time against journeys on the same line, direction and day, and measure
   the hit rate before any scheduled time is shown (opportunity log, entry 7).
3. **Show the coverage ledger** in Operations: every observed service and why it is or is not
   covered (opportunity log, entry 6).
4. Run collection for a sustained period and measure overnight reliability, recovery from a
   real outage, and storage growth. Weekday captures would also let the motion evaluation be
   held out by day rather than by later journeys, before estimates extend beyond three routes.
5. One look on a real phone, in sunshine and at night: legibility, the ride-along's frame
   rate and battery, and walking directions with a real GPS.
6. Road shapes for more routes (opportunity log, entry 10).

See also: `docs/HOSTING.md`, `docs/PIPELINE.md`, `docs/BACKLOG.md`,
`docs/LOCAL_VERIFICATION.md` (measured results), `docs/REVIEW.md`,
`docs/MAP_REPAIR_VERIFICATION.md`, `docs/INSPIRATION_RESEARCH.md`.
