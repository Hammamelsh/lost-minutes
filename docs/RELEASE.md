# Lost Minutes — release record

One page, kept current. What is running, what is verified, what is not, and what it costs.

| | |
|---|---|
| **Commit** | **`7dd79be`**, deployed 25 September 2026, night (the release sections below); the running site carries its own stamp in `RELEASE` on the server and in the feedback report |
| **Build stamp on the page** | commit + build minute, in the feedback report and `lib/build.ts` |
| **Public address** | **https://lost-minutes.duckdns.org** — a lasting address since 20 September 2026 (a free DuckDNS subdomain, Let's Encrypt) |
| **Deployment status** | **hosted**: Hetzner CX23, Helsinki, no paid backups; `deploy/publish.sh` deploys, `deploy/rollback.sh` puts the previous release back |
| **Collection** | continuous, under systemd on that server, with a watchdog and the nightly timetable and evaluation timers |
| **Verdict** | **Ready for invited beta testing.** Everything is verified in Chromium emulation against fixtures and the real site; nothing yet on a phone in hand, which is the next step |

## 25 September, night: every bus on the map

**Deployed: `7dd79be`**, with `a63006b` kept for `deploy/rollback.sh`. The owner, riding the served
site from a bus link with no stop chosen, saw one bus on the whole map and asked for all of them. The
map had drawn only the chosen bus's route (or, at a stop, that stop's board), each at its newest report,
stepping to the next at every poll. Every phone already receives the whole publication, so nothing
more is fetched: **every bus in the publication is now on the map, each drawn from its own reports**
exactly as the chosen bus is (`lib/fleet.ts`: the same PLAYBACK, one drawing everywhere).

What that is, in the passenger's terms:
- **The city moving.** Each bus moves between its reports at a bus's pace, a little behind its newest
  report, and stands there until the next one. Nothing is predicted. Only the buses in view are played
  back each tick — ten times a second at map zooms, every frame from a street zoom — and the rest
  stand at their newest report until they come into view.
- **Your buses lead the eye.** The buses of your stop or your route are drawn a size larger and darker
  than the rest; the chosen bus is the only lime thing on the map, as before. Route numbers appear
  from neighbourhood zooms (your own buses a zoom sooner), giving way to each other where they crowd.
- **Tap any bus.** It becomes the chosen bus, and its drawing is handed over rather than restarted, so
  the bus does not move when you choose it (and is handed back when you choose another). A mouse
  over a bus names it: route, destination, report age.
- **In the ride, the buses passing are buses.** From the model's zoom the nearest twelve other buses
  are drawn as 3D buses in a muted grey livery, facing the way they are drawn moving. From a street
  zoom the checked roads of the buses in view are loaded a few at a time (each a few KB), so they are
  drawn down their roads rather than the chords between reports.
- **The map says what it is.** The legend counts the buses (*234 buses*; on wide screens — on a phone the
  chip wrapped into the map's notices, so the count lives in the map's accessible name there), the heading reads *Every bus
  reporting in the area, drawn from its own reports a little behind them*, and the map's accessible
  name says the same. Under reduced motion every bus stands at its newest report.

**Measured.** In Node, 200 synthetic buses stepped in under 25 ms a tick; in Chromium, 124 fixture buses
with 91 in view and 89 moving cost 0.5–0.6 ms a tick at the median (MapLibre's re-tiling of the source
runs in its worker and is not in that figure); buses in view travelled 42 m in 6 s at 7–11 m/s between
samples, never faster than a bus; a tapped bus was 2–6 m from where the fleet had drawn it, the bus's own
movement in the moment between; in the ride, 2 and 1 other buses were modelled beside the ridden one.
On the served site at 22:52–23:00 UTC (`outputs/probes/incident-43/served-fleet.mjs`, the live
publication of 156–159 buses, emulation): at a city zoom (12.2) on a desktop **158 buses on the map, 109 in
view, 79 drawn moving**, the fleet's tick 1.1 ms at the median and 1.6 at most; at a neighbourhood zoom
(15.2) 29 in view, 16 moving, 0.5 ms; 59 of 80 buses tracked over 20 s moved more than 5 m, the largest
movement between two samples a quarter of a second apart one or two pixels (28 m at 20 m a pixel), where a
step to a newest report would be seven. On a phone at the city zoom 156 buses, 46 in view, 29 moving,
0.6 ms (the probe's zoom presses did not take on the phone, so only the city zoom was measured there). A
grey bus tapped on the desktop (YN61BFV, a 143) became the chosen bus, its card reading *Off its checked
road · as it was about 60 s ago · report 44 s old* — the new label, live. The served page chunk was
identical to the local build's (`fb26e93d…`), `a63006b` kept for rollback. Try Ride-along's three offers at 22:55 UTC (a 143, a 250 and a 192), ridden 60 s each on the served
site (`served-offers.mjs`): none lost its heading or was repositioned, each moving in 84–100% of samples
with no step over 4 m between them, the camera turning at most 28° a second, the cards reading *Moving
between its reports · as it was about 60 s ago · report 55 s old*, *Standing · as it was about 40 s ago ·
report 39 s old* and, for one drawn within a few seconds of its report, *Moving between its reports ·
latest 42 s ago*.

**Not done, and why.** The other buses' small eased corrections (a rebuilt path moving a bus a few
metres) are not said anywhere: the chosen bus's card says its own, and one line per bus for two hundred
buses is noise. No trails or route lines for the other buses: their roads are loaded for movement, not
drawn. A real phone's frame rate and battery with a hundred buses moving is the first thing to check in
hand (`docs/PHYSICAL_DEVICE_CHECKLIST.md`); SwiftShader measures the JavaScript, not the GPU.

**Verified:** 258 Node tests (`tests/fleet.test.mjs` among them); typecheck; lint with no errors; the
full browser gate on the fleet build **380 passed, 41 skipped by design, 3 failed in 1.2 hours** (Chromium
with SwiftShader, desktop and phone emulation). The three: my own new movement check judged a step by
pixels at a wide zoom (one pixel is five metres there; it now measures metres from the drawn position
over the time the sample took, and reads 7–11 m/s for buses moving at 7); the *N buses* chip wrapped the
phone's legend into the model notice (hidden on phones now; the map's accessible name keeps the count);
and a sign tapped on the map once did not change the stop (desktop) — it passed 4 of 4 re-runs with the
tap logged (chooser closed, a bus not chosen, the new stop shown), so the cause is not known and it is
left open as intermittent. The three small changes after the gate (the fleet labels restyled on a theme
switch, the tap diagnostic carrying positions, the phone chip) were covered by a focused run of the specs they touch (map, journey, layout, fleet, chooser, selection, access,
passenger): **111 passed, 17 skipped by design, none failed, in 14.8 minutes** on the deployed build. Emulation only.

## 25 September, late evening: what the card's delay measures, and what a rewind moves

**Deployed: `7dd79be`**, focused corrections on `a63006b` (kept for `deploy/rollback.sh`); the feature
scope is unchanged. Both questions were measured on every bus in both reels, ridden as the page rides
it (`scripts/evaluate-delay-rewind.mjs`): the 22 September evening reel, 335 bus-journeys and 2.8
million frames; the 24 September incident reel, 810 bus-journeys and 8.8 million frames.

### 1. The card's figure is measured from now, not from the latest report

It is now less the moment the drawn place stands for: the last moment the bus's reports had it at that
place. So it **includes** the latest report's age. While the bus moves between its reports:

| | evening reel | incident reel |
|---|---|---|
| the figure (10th / 50th / 90th percentile) | 53 / 57 / 61 s | 47 / 51 / 54 s |
| the latest report's age | 36 / 46 / 54 s | 32 / 40 / 48 s |
| what the playback adds beyond the report | 2.7 / 10.9 / 21.1 s | 2.4 / 10.1 / 19.4 s |
| frames where the figure was under the report's age | 0 of 1.8 million | 0 of 6.1 million |

**The record said the ride is "30–60 s behind the newest report". That was wrong.** 30–60 s is how far
the clock is set behind *now*; behind the newest report the drawing is about ten seconds at the median.
Corrected here, in the milestone record, the motion model and the phone checklist.

- **A defect, fixed.** While the bus waited at its newest report, the clock runs up to 24 s past it (the
  smoothing window), and the figure followed the clock. It fell under the report's own age in 946,754 of
  979,609 waiting frames on the evening reel and 2,689,171 of 2,798,496 on the incident reel. The label
  then gave the report's age, correctly, but the sentence under it could say *drawn where its reports
  put it about 5 seconds ago* of a report 20 s old. The moment drawn is now never later than the newest
  report: 0 and 0.
- **The wording now gives the two ages separately.** The label reads *Moving between its reports · as it
  was about 45 s ago · report 18 s old* (likewise *Standing · …* and *Off its checked road · …*). The
  sentence reads *It is drawn where its reports put it about 45 seconds ago: its latest report is 18 s
  old, and the playback draws it about 30 s behind that report …*. Where the playback adds under 3 s,
  the label gives only the report's age (*latest 18 s ago*). That way rounding to fives never makes the
  moment drawn look newer than the report (a Node test over every pairing up to 150 s). At its newest
  report the label reads *Last reported position · 18 s ago*.

### 2. A rewind moves the clock, never the bus

A report can arrive saying the bus had got further than it is drawn: a late report filed between two
already drawn, or the next report after a wait. Then the moment the clock shows would be 15 m or more
ahead of the drawn place. The clock is set back, in one step, to the drawn place's own moment. The drawn
bus keeps its place and pulls away at its reports' pace; before this, it raced to catch up (a 119,
135–300 m). **No position is rewound, so none needs a transition.** The only thing that changes at that
instant is the card's figure, which grows, because the drawn place is older than it was taken to be.
The time is then made up at no more than 5% of real time, or at a stand. If the clock would have to go
back further than the 15 s allowance, the bus is instead repositioned forwards, cut, and the card says so.

**Measured:** the clock was set back 307 and 669 times. The drawn bus went back along its own path in
**0 frames**, in the 5 s after a rewind or anywhere else.

That measurement also looked for anything else that moves the bus against the way it faces, and found
two faults, both fixed:
- **A rebuilt path could re-anchor the bus on the wrong pass of a road used twice.** When a publication
  changed the reports (even only by dropping the oldest one), the drawn place was projected onto the
  whole road near it. On a route that runs one street twice, the projection took the other pass. The
  bus then went to its stretch's start and was eased there, with nothing said. A V2 went 36 m back
  along its road, facing forwards, where no report had moved. A 21 at its terminus was eased 48 m with
  its nose already turned to the return leg. 19 eased corrections on the two reels moved the bus against
  the way it faced, the largest 40.3 m (the 21) and 36.8 m (the V2). 9 of them started on the same frame
  as a rewind, because the same publication triggers both. The bus is now measured against its
  own stretch of road: 13 remain, none over 6.6 m. `tests/delay-and-rewind.test.mjs` replays the V2's
  own reports: 35.9 m back on `a63006b`, none now.
- **Arriving at a standing goal took the bus to it even when a path change had left it just ahead**: a
  step back of up to 0.44 m with nothing said (9 and 15 frames), with nothing in the code to bound it.
  It now stands where it is: 0 and 0.

What still moves against the facing after both fixes (frames, metres in all):

| cause | evening | incident | what it is |
|---|---|---|---|
| the nose still turning while it moves forward | 38, 25.6 m | 113, 76.3 m | round a tight bend at speed (a 191 at 14 m/s): it goes forwards and its nose lags |
| an eased correction onto a changed path | 9, 6.9 m | 30, 26.4 m | 4 and 9 corrections with a backward part, largest 3.8 and 6.6 m; not said on the ride card |
| a hop at a joint between two stretches | 2, 6.5 m | 3, 7.0 m | a straight stretch ending at a report, a road stretch starting on the road beside it (a 23: 6 m) |
| following reports that step back, no road | 1, 0.3 m | 20, 7.1 m | the reports themselves go back a few metres (a 281: 6.5 m in 10 s) |

None of these comes from the rewind; they are backlog 32. The one-ride milestone's fault breakdown is
unchanged in group A (0 unsaid steps; the sprints 15 and 10); in B two more stands, and in C what the
corrected figure now counts (the milestone record's footnote).

**Still open, and not touched here:** the **25 sprints** (15 and 10 events, 3–4 s after a stand); the
heading lags pulling out of a stand (6 and 18) and the one spin; the four kinds of movement in the table
above; backlog 30 (*off its checked road* at termini); the round token until a bus with no road and no
bearing has moved; and everything a phone in hand would show.

**The clips**, git-ignored on this machine. Both are the same 230 s of the 250 inbound (MF74NNW,
22 September 21:15 UTC), replayed through the page from the served publications, before (`a82abfb`) and
after (`a63006b`) side by side: **at normal speed**,
`outputs/probes/incident-43/ride-250-before-after-1x.webm` (3 min 53 s), and accelerated,
`ride-250-before-after-2x.webm` (1 min 58 s). Both are the page drawing in real time, recorded at 25 frames a
second and played side by side by one browser. The after side predates these corrections: its
card reads *drawn about 55 s behind*, and its drawing differs from the deployed one only in the two
fixes above.

**Verified:** 252 Node tests at the time (258 with the fleet's); typecheck; lint with no errors; the
46 browser checks that read the label and the drawing's 82 (ride, ride-offer, ride-quality, replay,
head-turn, recorded-ride, try-ride, the motion and front-view checks), 45 + 79 passed and 1 + 3 skipped
by design, on the build with these corrections; then the full gate on the night's build (the next
section). Emulation only.

## 25 September, evening: one Ride-along everywhere

**Deployed: `a63006b`**, with the previous release kept for `deploy/rollback.sh`. With the owner's
approval (backlog 31), every ride is drawn from the bus's own reports, however it is entered; the map
keeps the labelled estimate where the evaluation allows it; arrivals are unchanged. The drawing now holds
reports the evidence contradicts, sets its clock back for a late report instead of chasing, cuts at a
repositioning, and starts without a step. The account and the measurements are
`docs/MILESTONE_2026-09-25_ONE_RIDE.md`.
**Verified on the final candidate:** 247 Node tests; 131 Python tests; typecheck; lint with no errors; CI's built-site and deployment-syntax checks; the full browser suite **371 passed, 39 skipped by design, none failed, in 1.1 hours** on the final build (Chromium with SwiftShader, desktop and phone emulation). The first full run on the candidate before it failed 6 (three checks on both profiles): two were premises restated (the head turn waited for an estimate's correction inside the ride; Try Ride-along asserted a scored-road bus was not offered), and one was a fault of this milestone — a drawing begun afresh started from rest — fixed, not restated. On the served site a 250 and a 15 ridden from their stops, and Try Ride-along's three rides, were continuous: none repositioned, none without a heading, no step unsaid.

**Pushed to GitHub** with the owner's approval, without force: 22 commits, `0f2c719..2a61428`, each
reviewed for credentials, runtime data and recordings first. GitHub CI (`checks`, run 36175741336) passed
on `2a61428`: types, lint, Node tests and the static build; the Python pipeline tests; the deployment
configuration. It warns that the workflow's actions target Node 20, which GitHub is retiring (they ran on
Node 24). The served site runs `a63006b`; `2a61428` adds only this record.

**The demonstration**, one continuous ride, on a phone in its ordinary browser, by day:
1. Open **https://lost-minutes.duckdns.org**, search **Trafford Bar** and choose **Trafford Bar (by)**
   (westbound, Chester Road). The board lists the 250s coming, *N stops before yours* by each one's last
   report, and the scheduled departures.
2. Tap a 250 that is a few stops away, then **Ride along**. The camera goes to the bus; the card says
   *Moving between its reports · drawn about N s behind* (or *Standing* at a stop), and the board's
   answer — how many stops away — comes from its newest report, not from the drawing.
3. Ride it for three minutes: it follows its road, faces the way it goes through corners, stops where
   its reports stopped, and pulls away; a said repositioning, if one comes, is a cut with one line on
   the card. Try **Front view** and back to **Outside view**.
4. **Exit**: the map comes back with the bus estimated again, the same bus and journey.

**What still limits a ride:** it is 30–60 s behind the newest report and says so; a bus with no checked
road and no reported bearing is shown from above until it has moved a bus's length; a turn round on a
terminus loop with no road under it is drawn as it moves off; short heading lags remain pulling out of
a stand. Checked in emulation only.

## 25 September: a standing bus, a terminus loop, and suggested rides made clean

**Deployed: `a82abfb`**, with the previous release kept for `deploy/rollback.sh`. Three deploys in
one night, each found wanting by riding the served site or by a replay, and the account of each is
`docs/MILESTONE_2026-09-23_SHEET_PACING_DISCOVERY.md` §10, "The served check":
- **`cd711a3`**: a 216 standing at Piccadilly Gardens, 3.4 m from its road, had been called "Off its
  checked road", shown from above, and the ride camera swung 69° when its heading appeared; standing
  buses turned round on the spot as their reports scattered. Fixed in the drawing and the ride camera.
- **`1a53e48`**: riding `cd711a3` on the served site found a 263 on its terminus loop drawn backing
  along its road facing forwards, a fault of that change. Fixed, and a moving bus turns at its pace.
- **This release**: Try Ride-along offers only clean rides. A replay of every offer the list would have
  made, at every publication of two reels, found 2% of the offered rides clean over three minutes; the
  list led with estimated movement, which jumps. It now offers a bus drawn between its own reports,
  moving along its checked road, reporting steadily, with road left, and never a test vehicle: 79% and
  85% clean on the same moments, with an offer at 124 of 126. The drawn bus now faces along its own
  length through a corner rather than a bus's length ahead.

**Verified on the final candidate:** 238 Node tests; 131 Python tests; typecheck; lint with no errors; CI's built-site and deployment-syntax checks; the full browser suite **367 passed, 38 skipped, 1 failed in 60 minutes**, the failure backlog 29's drag-during-entrance race, which then passed 6 of 6 on the same build (desktop and phone emulation in Chromium with SwiftShader). The served page chunk was identical to the local build's, `1a53e48` kept for rollback, collector, web server and timers active. On the served site at 05:23–05:30 UTC, Try Ride-along offered three rides (a 50, a 142 and a 248, all on checked roads), and the three rides offered at the moments they were tapped were ridden for 90 s each: a 30 to Piccadilly Gardens, a 163 to Bury and a 197 to Chorlton Street. None lost its heading or was repositioned; the longest spell facing over 30° off its movement was 0.5 s; the camera turned at most 10.9° between samples; each said "drawn about 45–60 s behind". The frames show each bus on its road and facing along it. Emulation only; nothing on a phone in hand.

**Still so:** an offered ride is clean over its first three minutes about four times in five, not
always: a bus may stand at a timing point for over 45 s, its reports may reach us late (the card says
how far behind it is drawn), or a later report may leave its road. A 15, 250 or 256 chosen at its stop
and ridden is still drawn at an estimate, which jumps (backlog 31, a decision for the owner). At termini
and on loop routes the card can call a bus off its road where it is drawn along it (backlog 30). A
creeping bus can still turn up to about 37° in 5 s.

**Also check:** a bus standing at Piccadilly Gardens (a 216, 143 or 142 at its stand, from the map or
a stop there), ridden for a minute. It should face along its road and not turn while it stands, and
the card should not call it off its road. A bus with no checked road that reported no direction and
has not moved is shown from above, and the ride says so; when it moves off, the view turns round to
it over about a second rather than in one jump. And Try Ride-along's rows, each ridden for three
minutes: the bus moves along its road, faces the way it goes through corners, and does not jump.

## 24 September, night: the route-43 incident fixed

**Deployed: `5c00509`**, with the previous release (`2c00759`) kept for `deploy/rollback.sh`. A
passenger-acceptance failure — a route-43 ride that appeared to teleport and sat across its road — was
reproduced from the server's own captures and request log and fixed in the drawing; the account is
`docs/MILESTONE_2026-09-23_SHEET_PACING_DISCOVERY.md` §10. **Verified on the final candidate:** 231 Node tests; 131 Python tests; typecheck; lint with no
errors; CI's built-site checks; the full browser suite, **362 passed, 38 skipped by design, none
failed, in 59.8 minutes**, desktop and phone emulation in Chromium with SwiftShader. The served page
chunk was identical to the local build's. Ridden on the served site, it was right for a moving 192
and wrong for a standing 216 (above).

**What still limits a ride.** Every bus not on routes 15, 250 or 256 is drawn between its own reports
30–60 s behind them, and says so. Where a bus's reports arrive 40–60 s late the drawing waits at the
newest one and the card can read over 75 s for a while. A report more than 40 m off its road (50 m where its bearing
agrees with the road) is drawn where it was made, on a straight line said on the card. No
lane-level position anywhere. *Follow on the map* in 2D re-centres by its own rule, unchanged. None of
it has been seen on a phone in hand yet.

**The ride to check:** a 43 outbound to Manchester Airport from Piccadilly Gardens, ridden along
Portland Street, Princess Street, Whitworth Street and Oxford Street (Try Ride-along, or a 43 chosen
at Piccadilly Gardens (Stop H) or Charlotte Street (Stop CU)). The bus should face along its road
through every turn, the view should never swing round in one jump, and on the Whitworth Street–Oxford
Street corner it should stay on the road. Switch away for a minute and come back: the card says the
bus was moved while the page was in the background. The recorded before-and-after of the incident's
own publications is `outputs/probes/incident-43/incident-43-ride-before-after.webm` (and the top-down
one beside it), git-ignored on this machine.

## 24 September: the beta release

**Deployed: `2c00759`** (16:42 UTC), with the previous release (`f964c7d`) kept for `deploy/rollback.sh`. What
it adds since 23 September is in `docs/MILESTONE_2026-09-23_SHEET_PACING_DISCOVERY.md`: the phone
sheet that stays up, the ride paced at a bus's own pace and drawn on its road, Try Ride-along with
a dated recording, the road ahead lit in the ride, and (§9) the map returning to flat when the ride
is left even if a publication lands at that moment. **Verified on the final candidate:** 225 Node tests; 131 Python tests; typecheck; lint with no errors (12 warnings, all in files this work did not touch); the build; CI's built-site and deployment-syntax checks; and the full browser suite, **358 passed, 38 skipped by design, none failed, in 56.2 minutes**, desktop and phone emulation in Chromium with SwiftShader. On the served site: the map flat after leaving the ride with a publication landed, 4 of 4
(desktop and phone, with and without reduced motion). **Nothing has been checked on a phone in
hand**; `docs/PHYSICAL_DEVICE_CHECKLIST.md` is that check.

**Demonstrating the best supported experience** — on a phone in its ordinary browser, by day (steps
1, 2 and 5 corrected on 25 September 2026: Try Ride-along no longer offers estimated movement, whose
rides jump; see the release section above):
1. Open **https://lost-minutes.duckdns.org**. Under **Buses near me**, tap **Or try Ride-along**:
   the sheet opens on up to three rides, each a bus moving along its checked road now.
2. Tap a row (**Reported positions · may pause · Front view**). The camera settles behind the bus,
   the road ahead is lit under it with its next stops named, and the card says how far behind its
   reports it is drawn.
3. Tap **Front view** for the street ahead, then **Outside view**. Drag the map to look around;
   **Return to bus**. Tap **?** for what this is and is not.
4. Tap **Exit**: the map comes back flat and north up, with the bus.
5. The stop journey: search **Trafford Bar** and choose **Trafford Bar (by)**, on Chester Road,
   westbound (ATCO 1800SJ00311; eight stops share the name) — the 250 towards The Trafford Centre
   boards there 17 stops into its route, so several are usually coming. The board lists the tracked buses coming, "N stops before yours" by each
   one's last report, and the scheduled departures, labelled *Scheduled · not live*. Tap a 250 to show
   its card and progress, then **Ride along** (since the evening of 25 September every ride is drawn
   from its reports, backlog 31: the demonstration at the top of this record).
6. When nothing live suits (late at night): **Recorded ride · to Bury Interchange** in the same
   section, or the link `https://lost-minutes.duckdns.org/?ride=2026-09-23-bngn-3426-163`, badged
   RECORDED RIDE throughout.

What not to promise while demonstrating: an arrival time (none is predicted), a view from on board
(the front view is drawn from the map), or a live position (every drawn bus says how old its
report is, and a bus between its reports is drawn about 30 s behind them).

## 20 September: hosted, and the passenger's two questions answered as far as the data allows

**Deployed.** https://lost-minutes.duckdns.org — Hetzner CX23, Helsinki, Ubuntu 26.04.1, Let's Encrypt
on the first attempt, the collector under systemd. Everything in this section was checked on that
server or in Chromium on the built export. **Nothing on a physical phone.**

**What the first real deployment exposed, all fixed and re-checked on the server:** the upload
excluded `public/data` (an unanchored `data/` in the exclude list) and was 1.75 GB; no `deploy`
user existed; a fresh warehouse had no stops or patterns, so **0 of 307** buses matched until a
rebuild; a clean SIGTERM exit returned 130 and made every nightly pause a `failed` unit; the
watchdog's rebuild guard never fired (`is-active --quiet` exits 3 for a running one-shot) and was
reproduced as **4 collector restarts in 3 minutes**. Recovery from `SIGKILL`: publishing again in
**25 s**. **The unattended 03:40 rebuild has not yet fired and is left open.**

**"How long is my walk?"** — the start is now judged, not assumed. A fresh fix at best accuracy,
never cached, with its accuracy and timestamp kept; confidence in bands (under 40 m stated plainly,
to 150 m hedged as "about" with the doubt beside it, beyond that not routed; a tight fix over five
minutes old is stale); **Update my location**, **Choose starting point** on the map (kept for the
session, outranking the device until given up) and **Walk to stop in Google Maps** by the boarding
point's coordinates, never its name. The Kenwood/Norwood cause is not claimed: the page had recorded
nothing that could establish it. **18 browser checks pass, desktop and phone, FIXTURE.**

**"When will this bus reach my stop?"** — as far as the data allows, honestly labelled.

*Correction, later on 20 September.* An earlier note said naming a journey when several share a
departure carried "zero risk". The precise claim is narrower: **all retained candidate journeys at
that departure agree on the scheduled time at every stop, subject to the match and the timetable
being right.** Timing agreement establishes a time, not a unique journey. And the two live snapshots
quoted earlier (123 of 218 named, then 163 of 224) were different fleets at different moments —
consistent with the change, not evidence for it. The controlled comparison holds one stored
publication (16:51:36, 215 matched vehicles) and one catalogue fixed and changes only the rule:
**old rule 117 departure groups named, new rule 156, +39, 0 lost, 59 still refused** because their
journeys' timings differ. Groups and vehicles coincide in that publication only because each
vehicle's (pattern, departure) was unique there. `scripts/compare-scheduled-rules.py` reproduces it. The feed's
journey reference matches **0 of 114** timetable journey codes; its origin departure time matches a
current timetabled departure for **all 161 distinct route-15 times (16,310 of 16,310 observations)**.
Every timing link carries a `RunTime`, now read, so **all 576 patterns publish scheduled seconds per
stop**. The card shows **"Timetabled at your stop 07:11 · from the operator's timetable, not a
prediction"** only for a bus on one pattern, on one journey at that departure, with running times
declared to both stops, and still before the stop. **No estimated minutes are shown.** Ground truth
for an estimator exists — **2,025 (journey, stop) pairs** with a report within 40 m across 91
route-15 journeys — and the estimator with its held-out evaluation is the next step. Browser check:
**4 of 4 pass, desktop and phone, FIXTURE** — the time renders as 06:53 from a 06:49 departure plus 247 s, labelled not a prediction, the journey named in the evidence; a bus already past the stop shows no time.

**The arrival estimate: built, evaluated, and not released — by criteria fixed before the numbers.**
`docs/ARRIVAL_RELEASE_CRITERIA.md` was written first. Ground truth is **inferred stop passages** — a
crossing between two reports, timed by interpolation, uncertainty half the gap, scoreable only under
60 s and first visit: **4,014 on route 15, median gap 21 s (±10 s)**, against 3,932 within-40 m pairs
on the same journeys, which were never arrivals. Fit on 11–14 Sep; **scored once on 17–20 Sep:
63,397 moments, 44 journeys, 1,436 passages, two weekdays.** Only reports at or before each moment
were used; nothing from the drawing.

| Horizon | Moments | Progress baseline median / p80 / p90 (min) | Delay-adjusted timetable median / p80 (coverage) |
|---|---|---|---|
| 1-2 min | 4,237 | 0.59 / 1.50 / 2.43 | 0.96 / 2.03 (48%) |
| 2-5 min | 12,025 | 1.36 / 3.31 / 5.55 | 1.54 / 2.82 (48%) |
| 5-10 min | 18,275 | 2.69 / 5.87 / 10.36 | 2.13 / 4.05 (46%) |
| 10-20 min | 28,860 | 4.96 / 10.06 / 17.38 | 2.51 / 5.92 (43%) |

At the release band (2–10 min) the progress baseline reads **median 2.08, p80 4.84**
against thresholds of 1.5 and 3.0: **two of six criteria fail; not released.** Weekday alone:
median 2.09, p80 4.85. At Hillingdon Road (opp): median 1.97, p80 2.85 on 334 moments.
**The better approach, with evidence:** beyond five minutes the **delay-adjusted timetable** beats the
progress baseline (2.13 vs 2.69 at 5–10; 2.51 vs 4.96 at 10–20) but covers under half of moments and
misses the p80 bar. The next estimator should be that, corrected by observed progress near the stop.
**Nothing is shown to a passenger.** A nightly unit on the server (`lost-minutes-arrival-eval`, after
the timetable rebuild, collector paused) infers passages and re-scores on the server's own reports,
so weekday evidence accumulates under `data/` where no page reads it. **What is missing:** more
weekday journeys at peak — the held-out set has two weekdays — and the delay-adjusted method
implemented as the candidate.

**The inbound discrepancy, traced end to end (20 September, later).** Three real journeys followed
by *vehicle*, not by journey key, because a key's first appearance is not a departure. `MF74NNG`,
Sunday 13 September: still driving its outbound (aimed 12:18) at 12:53, 6 km from the terminus;
reached the terminus — 15,247 m of the outbound shape, which is the inbound's 0 m — at **13:11:30**,
which is exactly where the registered outbound (12:18 plus running time) puts it: **the outbound
schedule is met to the minute.** Then 22 minutes of silence from the feed, then it appeared as the
inbound "13:18" at **13:34:06**, at the same spot, and moved off at once. Registered stand 7 min;
observed 23. `SL63GDK` (Thu 17) and `MX13FNR` (Mon 14) show the same shape. The current
registration carries no per-journey overrides at all — 0 `VehicleJourneyTimingLink`, 0 `WaitTime`
in all four route-15 files, against 354 `WaitTime` tags elsewhere in the same dataset, so the
operator does use them where they mean them. Time zones are consistent (the same code anchors
outbound correctly), the aimed departure matches a registered inbound departure by label, and the
passage inference places the bus at the origin.

**So the ~16 minutes is neither parsing, nor matching, nor the clock.** It is a consistent gap
between the registered inbound departure and the observed one, on every journey, every day held,
while the same registration's outbound is exact. Whether the registration is out of date for
inbound or the operator's running board departs later by design cannot be decided from the feed,
and this page does not decide it: no correction is applied, and the inbound timetabled line stays
withheld by the schedule anchor. Settling it needs the operator or TfGM; the approach drafts are
in `docs/TFGM_APPROACH.md`.

**An outage I caused, recorded.** Taking a warehouse snapshot by hand on the server, the copy
failed on a missing directory, `set -e` aborted the script before the collector restart, and
**collection was down for 119 s** until I restarted it. That is precisely the failure the nightly
evaluation unit is designed against: the properly taken snapshot then stopped the collector for
**0.16 s** with a fresh publication **10.3 s** after the stop, and the nightly unit now reads that
copy and never touches the collector at all.

**What the evaluation found about the line already deployed.** The scheduled comparator read
~15 min of error, and it was not the comparator: **every inbound route-15 journey's schedule is a
constant +15 to +17 min early from stop 0 to stop 39**, on all days held; outbound drifts +2 → +8
in the ordinary way. The inbound journey key first appears in the feed a median **14.5 min after**
its registered departure, standing at the origin, with no report in between; the registration holds
no `WaitTime` at all. So the feed's origin departure and the registration's do not name the same
moment for inbound, and the deployed "Timetabled at your stop" line was **~16 min early for every
inbound 15 — the passenger's own direction.** It is now gated per pattern on a **schedule anchor**
(`schedule-anchor.json`): verified only where inferred passages at the first ten stops put the
schedule within 3 min on ≥ 20 passages. Inbound 15 withheld (+15.4 min, 290 passages); outbound 15
verified (+2.3, 133); every other pattern unchecked and withheld. Live on the site.

**Head-turn in the street preview:** a one-finger drag turns the head (160° per canvas width, clamped
at 150°), following never stops, and the view eases back to the road ahead on release. **Browser-tested,
2 of 2, desktop and phone, on a standing bus** — the hardest case, because the frame loop parks when
nothing is left to draw and a held turn on a standing bus draws nothing new; the handlers now wake
the loop and keep it running while a turn is held or easing. Six builds to find that; the listener
was attached and firing throughout, and the attribute the test read was simply stale. Physical-phone
check is additional.

**The candidate, evaluated properly (20 September, later still).** Two methods read the timetable
as a *difference* — the scheduled seconds from where the bus is now to your stop, needing no origin
departure and so immune to the inbound discrepancy — and the blended candidate hands over to
observed pace inside the last kilometre. On **identical eligible moments** of the development days
(17–20 Sep, 44 journeys, 1,436 passages) the blended method beats the progress baseline at every
horizon: **0.56 / 1.00 / 2.18 / 3.79** min median at 1–2 / 2–5 / 5–10 / 10–20 against 0.79 / 1.68 /
2.91 / 5.34, at 100% coverage; per journey — 44 journeys are the units, not 63,397 moments — **1.62 /
2.00** against 2.25 / 2.76. Passage uncertainty is ±11 s median, so nothing under 0.2 min is real.
Outbound meets both thresholds (1.29 / 2.76); inbound does not (1.86 / 3.57). Because those days
informed the candidate, its parameters were frozen and the **reserved set** — the server's own
Sunday, 10 journeys, 289 passages, never seen by the fit — scored once: the ranking holds (0.52 /
0.89 / 1.68 / 2.49; per journey 1.39 / 1.67; outbound 1.13 / 2.06, inbound 1.68 / 3.56), both error
thresholds pass, and **the floors fail: 10 journeys against 20, no weekday. Not released.** At
Hillingdon Road (opp), 43 moments: 0.89 / 1.27.

**Per-direction release is pre-registered from here for unseen data only** (criteria amendment):
the page computes the blended estimate from raw reports on the accepted shape and shows it **only
for a direction `arrival-release.json` says has passed on unseen journeys** — a data event, not a
code change. Nightly, the rebuild copies the warehouse while the collector is already stopped
(0.16 s), the evaluation reads the copy, scores every unseen day once, and the release check pools
by day. **Tested on the server with the collector watched each second:** normal, forced-failure and
forced-timeout runs; **collector never not-active, longest publication age 11 s, no restarts.**

**What is needed before any direction shows minutes:** ≥ 20 unseen journeys and ≥ 150 passages in
that direction across distinct days, at least one a weekday, meeting median ≤ 1.5 and p80 ≤ 3.0 at
2–10 min. Monday's snapshot is the first weekday; at ~10 journeys a day per direction, outbound —
which met the thresholds on both sets — could qualify by about Wednesday if the numbers hold, and
the served verdict will say so before anything is shown. **A pooling defect caught on the first
night** (four test runs of one Sunday counted as four nights, landing exactly on the 20-journey floor)
is fixed and tested: days are the unit.

**Front view at Hillingdon Road (opp), traced.** Two inbound 15 variants serve the stop to the same
destination: the 140-journey pattern (accepted shape) and a 5-journey Mon–Sat short working (shape
rejected, 0 reports). On a weekday the bus is left unresolved and an unresolved bus had no road. The
stop-list inference that stood in was wrong in principle and is replaced by **measured shared road**:
**387 → 13,611 m** of the accepted shape, Hillingdon Road at 8,715 m, placed on it only if the bus's
report and its whole 542 m look-ahead lie inside. **24 of 24 motion checks pass**, including a bus on
shared road estimated with no candidate named, and one short of the divergence left at its report.

**The street preview**, from data it already holds: façades graded by OSM height, a footway and a
broken centre line at the class's real widths, a look-ahead that lengthens with speed, a sky that
follows the sun (`lib/daylight.ts`, civil twilight from date and latitude). **Judged by eye on phone
frames, both themes, in SwiftShader**; the day centre line was found near-invisible in the first
frame and darkened. What it cannot show: dusk (the probe's clock is not at dusk), and anything OSM
does not hold — no windows, no signs.

**Still needing the owner:** rotate the BODS key seen in a screenshot (server and local hashes still
match it), recycle the DuckDNS token, and say whether a Healthchecks.io dead man's switch may be
created (off until then). **Still needing a phone:** every phone claim above is emulation.

## What changed on 18 September, and what it corrected

Four claims this document made on 17 September have been tested rather than asserted. Two of them
were wrong.

| Claim on 17 Sep | What testing found |
|---|---|
| The collector's memory is "steady … not a leak risk" | **Withdrawn.** Three samples over sixty seconds cannot tell a plateau from a climb. A longer look showed the resident set rising 1,148 → 1,466 MB in three minutes, because DuckDB's default limit is 80% of the machine's RAM. It is now bounded explicitly (1 GB, `LM_DB_MEMORY_LIMIT`). Whether it is stable over *hours* is still unknown and is no longer claimed |
| "The warehouse is rebuilt from the raw captures it was loaded from" | **Was false in practice.** No code could read live captures back; `reprocess` reloads the archive selection, not them. `pipeline/restore.py` now exists and a restore was actually performed |
| `deploy/backup.sh` presented as settling the backup question | **Qualified.** It is manual, unscheduled, a pull that only runs when this laptop is awake, and not a bare-metal restore. What £1.10 a month buys is not storage but *someone remembering* |
| Nothing said about the nightly timetable rebuild's footprint | **Measured: 853 MB peak**, 3 min 05 s, 34% CPU. That, not the collector, is the number that rules out a 512 MB host |

Also verified on 18 September, none of it previously tested:

* **Stale feed, through the real page.** The laptop slept mid-collection on 17 September, which
  produced a better test than any I would have staged: a publication **26 hours old** that still
  called itself `"state": "live"` with 655 vehicles whose newest report claimed to be 3 seconds old.
  The page refused all of it — *"NOT UPDATING · updated 1d 2h ago"*, **zero buses listed, zero
  suggested, zero drawn on the map**, and the honest line "Every position we hold has passed its
  cut-off".
* **Restart recovery.** The run the sleeping laptop abandoned was left marked `running`. Starting
  the next collector resolved it to **`interrupted`, exit reason `abandoned`**, with no
  intervention. A deliberate `SIGKILL` mid-run repeated it: the writer lock was released by the OS,
  and a fresh collector was publishing again **within 45 seconds**.
* **No second writer.** Starting a collector while one runs is refused:
  `{"error": "collector_busy", "detail": "Another collector holds data/warehouse/collector.lock."}`
  The warehouse itself refuses a second connection too.
* **Restoring from a copied capture.** 60 captures copied out as `backup.sh` would pull them, then
  restored into an **empty** warehouse: **25,232 observations, 1,396 vehicles** recovered, every
  file verified against the SHA-256 in its own name, 0 corrupt. Run twice, it added **0** new
  observations — a restore cannot double history. Details and limits in `docs/HOSTING.md`.
* **A touch-target sweep.** The layout probe measures every control a phone can tap. **167
  occurrences were under the 44 px both Apple and Google ask for** — the feed's refresh at 36×36,
  Save/Share/Change/Locate me at 40 high, the 2D/City switch at 38, the ride's own controls. They
  were raised in the rules themselves rather than with an override the bundler reorders past.
* **A wording defect the stale state exposed.** The status bar read *"updated 94646s ago"*. Ages now
  read in minutes, hours and days.

## Supported beta scope

* **Manchester buses only.** No Metrolink: no official source publishes tram positions.
* **Positions** for practically every bus reporting inside the service area, each with its own
  report age, or withheld once older than 15 minutes.
* **Timetable claims** — "coming to your stop", "N stops before yours" — for the services that have
  a registration running that day: **109 of 159** observed services on 17 September 2026.
* **Estimated movement and the street preview** for **routes 15 and 250, both directions, any day,
  and route 256 at weekends** — the patterns with a road shape accepted against their own reports.
* **Walking directions** to the boarding point, on request, anywhere OpenStreetMap has footways.
* **Never**: an arrival time, on any route. Nothing predicts when a bus will reach a stop.

Full audit, with the method and the counts: `docs/COVERAGE.md`.

## What is implemented and verified

Verified means an executed check is behind it. Where the evidence is a fixture, a recording, the
real feed or a physical device, it says so. **No physical phone has been used at any point.**

| Area | State | Evidence |
|---|---|---|
| Live collection, validation, DuckDB history, validate-then-swap publication | implemented, verified | 97 Python tests; real bounded runs on this machine |
| Identity-first timetable matching, with refusals that carry their reason | implemented, verified | `tests/test_matching.py` (35); the live publication's own `matching` summary |
| Timetable currency: newest snapshot only, a forward validity window, a refusal to shrink | implemented, verified | `tests/test_timetable_catalogue.py` (4); the 17 September rebuild |
| The whole browser suite on this build | verified | **188 passed, 24 skipped by design, 0 failed** (30.2 min, SwiftShader, desktop and 390 px phone) |
| The final build through its public HTTPS address | verified, REAL feed | two further publications from the network, the chosen bus kept, pinch and Return to bus, 0 tile or page errors |
| Ageing data, through the public address | verified, REAL feed | with collection stopped the page read "NOT UPDATING · updated 201s ago" in the warning tone, though the file still called itself live; buses stayed at their last reports and none was estimated forward |
| Chosen bus never substituted | implemented, verified | `selection.spec` (FIXTURE), and REAL through the public link |
| Estimated movement, drawn smoothly, scored against held-out reports | implemented, verified | `docs/MOTION_MODEL.md`, `docs/LOCAL_VERIFICATION.md` (RECORDED) |
| Immersive phone ride-along, and the journey surviving a round trip behind the data | implemented, verified | `navigation.spec`, the layout probe at five sizes (FIXTURE, emulated touch) |
| Coverage ledger | implemented, verified | rendered against a REAL publication, 17 September |
| Feedback route and location note | implemented, unverified on a device | no physical phone has opened it |
| Watchdog telling four failures apart | implemented, verified locally | `deploy/validate.sh`; **never run on a server** |
| Stalled-publication alert | prepared, **off** | needs a destination the owner confirms |
| Hosting | **planned only** | `docs/HOSTING.md` |
| 48-hour observation with a controlled restart and a failure/recovery check | **not started** | cannot start before a server exists |

## Measured figures, with their date and population

| Figure | Value | Population and date |
|---|---|---|
| Buses in one publication | 587 | live publication, 17 Sep 2026, ~15:55 BST |
| Placed on a timetable pattern | 285 (48.6%) | the same publication |
| Services with a registration running that day | 109 of 159 | the same publication |
| Services with an accepted road shape running that day | 2 (routes 15, 250) | the same publication |
| Published patterns | 524 across 157 services | catalogue built 17 Sep 2026 14:29Z |
| Timetable files read / expired | 575 / 538 | three TfGM datasets, newest snapshot of each |
| Accepted road shapes | 6 of 9 built | 95th-percentile offsets 11.3–28.4 m against 752–3,408 matched reports each |
| Estimate error, held out, up to a minute | median 62.7 m (last report 118.3 m) | routes 15 and 250, Monday 14 Sep captures |
| Drawn-bus error against the next report | median 59–61 m | development and fresh captures, 13–14 Sep |
| Stops | 3,498 | NaPTAN ATCO 180, service area |
| Raw capture growth | 0.13 GB/day, ~540,000 observations/day | measured on this machine |
| Captures preserved so far | **3,821**, 220 MB | 18 Sep 2026 |
| Nightly timetable refresh | **853 MB peak**, 3 min 05 s, 34% CPU; output identical to the previous day's apart from the build date | `/usr/bin/time -v`, 18 Sep |
| Collector resident set | median **~1,560 MB** with the 1 GB database limit; rose over the first ten minutes then flattened | 79 samples over 20 min, 18 Sep |
| Publication interval held | max age **20 s**, median 10 s, across the same 20 minutes | |
| Restore from a copied capture | 60 captures → **25,232 observations, 1,396 vehicles**; 0 corrupt; a second run added 0 | `pipeline.restore`, 18 Sep |
| Phone touch targets under 44 px | **167 → 43 occurrences**; on a phone only the wordmark link remains, deliberately | layout probe at five sizes, 18 Sep |
| Live publication a phone polls | 807 KB raw, **119 KB gzipped**, every 20 s | through the public link, 17 Sep 2026 |
| Pattern catalogue, fetched once | 2.0 MB raw, 149 KB gzipped | after the 17 Sep rebuild |
| Typefaces, fetched once and cached | 70 KB for both | Inter 48 KB, Space Grotesk 22 KB |

Nothing here is an uptime, an accuracy claim about the real world, a user count or a comparison
with any other app.

## Unresolved, and what it means in practice

1. **Everything stops when this laptop stops.** The single largest gap, and the reason this is
   invited testing rather than a public beta.
2. **The temporary address changes at every restart**, so saved stops, a saved route and any
   home-screen icon break. The page says so where it matters.
3. **No physical-device evidence at all.** Emulation is not a phone. `docs/PASSENGER_TEST.md` has a
   12-minute script; until it is done, the phone experience is unverified.
4. **The reported street-preview freeze has never been reproduced.** Frame intervals are now
   measured and carried in the feedback report, which will settle it on the first real phone.
5. **Route 256 cannot be placed on a weekday**, because the operator's current registration has no
   Monday-to-Friday inbound service. Upstream; not fixable here. Use route 15 for trials.
6. **Buses with no timetable held at all: fewer, and the remainder is now a scatter.** The missing
   operator group was Go North West, dataset 12769; it is now downloaded and built. Asked of one
   fixed capture of 653 weekday-afternoon reports, the count with no registration held falls from
   **174 to 109** — the whole of that difference is 13 services that gained one. What is left is
   46 services across several operators, led by **BNML 38** (a BNML line absent from the BNML
   dataset, which deserves its own look), BNGN 10 and 8, and BPTR X43. `docs/COVERAGE.md` has the
   method.
7. **139 of 587 are held unresolved between branches.** A refusal, not an error, and the honest cost
   of wider coverage.
8. **The collector's memory over *days* is still unconfirmed.** At the server's thread count it is
   flat at about 376 MB over 19 minutes, and the 300 MB-an-hour climb seen at 32 threads does not
   reproduce — but no run here has lasted longer than about two hours, and the 48-hour observation
   is what settles it.
9. **A phone downloads 119 KB (gzipped) every 20 seconds**, about 21 MB an hour, because the live
   publication carries full match evidence for all 587 vehicles when the page needs it for one. Not
   broken, but more data than the job needs; the split is described in the opportunity log,
   entry 25. Worth fixing before the beta is advertised widely.
10. **A bus's *timetabled* journey is still not identified** — see the distinction in
   `PROJECT_CONTEXT.md` — so no scheduled time is ever shown.

## The 48-hour observation, ready to start

**Not started, and it cannot be: there is no server.** It begins the hour the site is hosted. The
record lives in `docs/OBSERVATION.md`, appended to as it runs, so progress can be inspected at any
time without waiting for a summary.

What is measured, all of it from things that already exist:

1. **Every publication gap.** The watchdog already reads `publishedAt` every five minutes. A gap
   over 600 s is a restart and is journalled; `journalctl -u lost-minutes-health` is the record.
   Target: what actually happened, not a number to hit.
2. **A controlled restart**, at a chosen hour: `systemctl restart lost-minutes-collector`. Measure
   how long until the next publication, and check that no duplicate writer appeared (the flock) and
   that the last good file kept serving throughout.
3. **A safe failure and recovery.** Point `BODS_API_KEY` at nothing for ten minutes. The feed must
   go to "not collecting" on the page, the last good publication must keep serving with an honest
   age, the watchdog must restart but not mask it, and recovery must be automatic when the key
   returns. This exercises the difference the watchdog is built to tell.
4. **Resource use:** `systemd-cgtop` for the collector's CPU and memory, `df -h` for disk, and the
   growth of `data/live-capture/` against the predicted 0.13 GB a day.
5. **The nightly timetable rebuild** at 03:40, twice: that it pauses collection, finishes, publishes
   a catalogue no smaller than the floor, and that collection resumes.

Nothing about this period may be reported before it has elapsed.

## Cost, operation and rollback

* **Recommended: Hetzner CX23 + IPv4 + backups — about £7.25 a month with VAT**, £8 with a domain,
  ~£97 in the first year. Re-checked against Hetzner's own price-adjustment page on 17 Sep 2026.
* **A domain is not needed to start**: a free dynamic-DNS subdomain carries the beta, and the domain
  can be added later by changing one line. Saved stops are tied to the address, so choose the final
  name before inviting many testers.
* **Deploy:** `deploy/publish.sh deploy@<host>`. **Roll back:** `deploy/rollback.sh` on the server —
  one previous release is always kept, and the collector's own published data is never rolled back.
* **Operate:** collector under systemd with `Restart=always`; a watchdog every 5 minutes that tells
  four failures apart; a nightly timetable rebuild at 03:40; raw captures kept 14 days.

## What stands between this and a public beta

Essential. Each has an owner and the evidence that closes it.

| # | Action | Owner | Evidence that closes it |
|---|---|---|---|
| 0 | ~~Understand the collector's memory growth~~ — **done tonight.** It rose ~300 MB an hour at 32 threads and is **flat at about 376 MB at 2**, which is what a CX23 gives. The allocator scaled with cores; the application accumulates nothing. Both variables were changed together, and the flat run was 19 minutes, so the 48-hour observation still confirms it | done | the trajectory above, and the 48 hours |
| 1 | **Decided 17 Sep: Hetzner CX23, no paid backups, free subdomain.** What is left is the doing: create the server (reading the console's own total before paying), point a DuckDNS subdomain at it, and put the BODS key on it yourself. Step by step in `docs/PROVISIONING.md` | **Hammam** | a hostname, a sudo user, and the subdomain |
| 2 | Provision and deploy: `deploy/publish.sh`, `deploy/install.sh` | assistant, after 1 | `curl -sI https://<address>/` returns 200 with HSTS, and `/data/live.json` is seconds old |
| 3 | The 12-minute phone trial on a real device (`docs/PASSENGER_TEST.md`) | **Hammam** | nine written answers and one copied feedback report, including the drawing rate in ms a frame |
| 4 | Name where a stalled-publication alert should go | **Hammam** | an address in `/etc/lost-minutes/health.env`, and one test ping received |
| 5 | The 48-hour observation, with a controlled restart and a failure/recovery check | assistant, after 2 | `docs/OBSERVATION.md` filled in, after the period has actually elapsed |

Optional polish, in the order I would take it.

| Action | Why | Owner |
|---|---|---|
| Split the live publication (opportunity 25) | 119 KB every 20 s on mobile data is more than the job needs | assistant |
| ~~Add the missing operator's timetable dataset~~ | **done** — Go North West, dataset 12769; 174 → 109 uncovered reports on a fixed capture | assistant |
| Trace **BNML 38**, a BNML line missing from the BNML dataset | 12 reports in one capture refused for a reason that should not apply | assistant |
| Road shapes for more routes | extends estimated movement past 15, 250 and 256 | assistant |
| Identify the timetabled journey | the last claim the app deliberately does not make | assistant |

## The recording

**`outputs/probes/demo-recording/beta/lost-minutes.webm`** — about 30 seconds of the actual app on
a 390 px phone, against the real feed, made by `scripts/probes/demo-recording.mjs`. Nothing is
staged: no fixtures, no scripted positions, the bus moves as the bus moved. It asks for no location
— the stop is found by typing — so nobody's position is in it. Eight labelled stills sit beside it
for anywhere that will not play WebM; there is no ffmpeg on this machine, so nothing converts it.

It runs: the first screen → searching for a stop → the stop and what is coming → riding along, full
screen → the street ahead → back at the stop → behind the data → the coverage ledger.

**The take is honest about itself, and it says how the bus was chosen.** The first attempt filmed
the page's own suggestion, which happened to be a bus reporting **no bearing** — correctly drawn as
a round token seen from above rather than as the 3D bus, and 26 stops away through empty streets.
Honest, but not what the ride-along looks like: in **the publication that recording was made
against** (18 September, about 23:39 BST) **154 of 197 vehicles, 78%, reported a bearing**. That is
one late-evening publication, not a general rate. The
probe now tries the buses coming to the stop in turn until one of those is on the card, and
`recording.json` records the choice and the reason:

> `chosen: {"key": "BNML|MF74NPJ", "bearing": 239, "row": 0}`
> `judge: the ridden bus reported a bearing (239), so the 3D bus and its heading are shown, and it
> was chosen from the buses coming to this stop for that reason`

Nothing is staged by that: it is a real bus at its real position, and if no bus coming to the stop
reports a bearing the page's own suggestion is filmed and the recording says so instead.

**What the stills show is the drawn bus, which is an estimate, and they say so.** The ride-along
frames carry the app's own wording — *"Estimated position · last report 43 s ago"* — because between
reports the app draws where the bus has probably got to, on the road shape, bounded and labelled.
The dots behind it are the observations; the dashed line is the gap between the last one and the
drawing. Nothing in the recording is an observation of the bus being where it is drawn, and no
frame should be captioned as one when the recording is used elsewhere.

**Still worth re-recording in daytime service**, when more buses are running and the ride passes
more of the city: same command, and the recording judges itself again.

## The demo sequence

Thirty seconds, in this order, recorded at 390 px and on a 1280 px desktop. The four frames kept
with the documentation are all **the real feed through the public link on the final build**; the
rest are regenerated by the probes into `outputs/` (git-ignored; copy out before re-running).

1. **A stop chosen** — its side of the road, the walk, the answer, the map.
   ![Lost Minutes at 390 px: a LIVE chip reading "updated 5s ago", a card headed YOUR STOP for
   Marston Road (nr), south-westbound on Kings Road in Stretford, with Save, Share and Change, a
   walk prompt, the suggested route 15 to Roedean Gardens with its last report and age, and the
   paper map below showing the stop ringed in orange and the bus in lime.](images/phone-stop.png)
2. **Ride along** — full screen on a phone, the bus drawn at a labelled estimate, the report age
   beside it, leaving and the street preview each one thumb away.
   ![The ride-along filling a 390 px screen: a bar with Exit, "following the bus" and a question
   mark; the lime 3D bus seen from behind on Moss Lane West with a ground ring, a contact shadow
   and the dotted ESTIMATE trail behind it; Front view and a card reading "15 to Roedean Gardens,
   Estimated position, last report 27 s ago, last report nearest Chorlton Road, 9 stops before
   yours".](images/phone-ride-along.png)
3. **Front view** — the street ahead, drawn from the map's own vector data, never a photograph.
   ![The street preview at 390 px: the road running to a hazed horizon with lit and shaded building
   blocks either side, a street name upright on the road, and the same route 15 card at the
   foot.](images/phone-street-preview.png)
4. **Behind the data** — the pipeline in four steps, then the coverage ledger: four separate
   answers per service, never one number.
   ![The coverage ledger: 285 of 587 buses placed on a pattern by the timetable, 109 of 159
   services with a registration running today, 2 services with an accepted road shape; then one row
   per service with ticks for Positions and Timetable today and dashes for Road geometry and
   Estimated movement, and the refusal reasons counted beneath
   each.](images/coverage-ledger.png)

Every frame says whether it is FIXTURE data or the real feed in the probe's own report. No frame
contains anyone's real location: where a "You" dot appears it is the probe's fixed emulated point
(53.4503, −2.2945 near the stop, or Longford Park), never a device's own.

## Announcement draft — not published

Roughly 190 words, for LinkedIn, **after** the app is hosted at a lasting address. The link and the
status line must be corrected before it goes anywhere.

> I've opened my Manchester bus side-project, **Lost Minutes**, for feedback.
>
> The everyday job is small: find your stop, see which buses call there and how far their last
> reports put them, then follow one and watch it move.
>
> Two decisions I'd defend.
>
> A bus is only placed on a timetable pattern when the operator, the timetable version, the
> operating day and the reported direction all agree. When two branches fit a position equally well
> it stays unresolved and says so. Tracing route 256 last week, I found the registration currently
> published for it has no Monday-to-Friday inbound service at all — so the app tells you it cannot
> say, instead of inventing an answer.
>
> Between reports, a bus is drawn moving along a road path that was accepted only after being
> checked against that route's own reports, and the estimate's measured error is published rather
> than hidden.
>
> Honest status: an early beta on one small server. Buses only, no Metrolink. Estimated movement
> covers three routes. It never predicts an arrival time.
>
> It sits alongside **Energy Reconciliation**, my earlier project reconciling smart-meter data with
> Python, DuckDB and dbt.
>
> Feedback welcome — especially where it confuses you.
>
> [app link] · [github.com/Hammamelsh/lost-minutes]

**Checked before drafting:** the Energy Reconciliation repository was read on this machine. Its
README describes Python, SQL, DuckDB, dbt and Streamlit with a React front door, 3 million source
rows from three files across 83 households, and a live analysis page. The post claims nothing
beyond that.

**Do not publish** until: the app is hosted, the address is lasting, and the status line matches
reality.
