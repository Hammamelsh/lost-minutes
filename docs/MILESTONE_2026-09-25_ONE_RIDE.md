# 25 September 2026 — one Ride-along everywhere, uncertainty without invented motion

The owner approved backlog 31 on 25 September 2026: "report-based playback for ALL Ride-along routes,
including 15, 250 and 256", with labelled estimates kept on the ordinary map where the release
criteria allow them, and arrival predictions and their criteria unchanged. This record is the
milestone that followed. Everything below is Chromium with SwiftShader, desktop and phone emulation,
or offline replays of recorded publications; nothing was checked on a phone in hand.

## 1. One ride, however it is entered

- **In the ride every bus is drawn from its own reports** (`components/city-map.tsx`, the frame loop):
  whether it was entered from Try Ride-along, a stop's board, search, a map marker or a shared link,
  the frame loop draws the chosen bus by playback while the ride is on. The estimate stays on the map,
  labelled, where the published evaluation scored the pattern; the passenger's "reported positions
  only" still wins inside the ride. Nothing about arrivals or their release criteria changed.
- **The change between the two is a change of what is shown, not a movement.** Entering or leaving the
  ride restarts the drawing (no repositioning is said, no trace is drawn from the estimate's place);
  on entering, the bus is not drawn until the camera has arrived, so the estimate's place never hops
  back 300–700 m on screen, and the camera glides straight to where the ride shows it. An estimate that
  falls back to its reports on the map (a report that jumped further than a bus travels) is a
  correction and is still said: the first version of the restart swallowed that, and
  `motion.spec`'s large-correction check caught it.
- **The drawing begun afresh joins the bus at its pace.** It had started from rest, so a bus riding at
  7 m/s was drawn pulling away from a stop it never made, and the front view stretched ahead as it caught
  up; the full gate's front-view check (the eye moved 24 m while the bus moved 18) found it. A bus that
  waited at a lone report still pulls away from it.
- **The chosen bus and journey are untouched**: the pin lives outside the drawing.
- **The words follow.** The offer beside Ride along reads *Reported positions · may pause · Front view*
  on a scored road too; the ride's card says *Moving between its reports*, *Standing* or *Last reported
  position*, with how far behind it is drawn, and why it is not estimated: "in the ride-along every bus
  is drawn from its own reports, so that a report correcting an estimate never makes it jump; on the
  map it is estimated".

## 2. Uncertainty without invented motion (`lib/motion.ts`)

Each rule was found by a replay, traced to a frame, and checked against the build before it:

- **A report the reports either side contradict is not followed.** On a checked road, a report off
  the road, or back along it, is left out when the reports either side lie on the road and the road
  joins them at a bus's pace; the newest such report is held until the next one confirms or
  contradicts it. Two reports off the road together (a diversion, a stand beside the route) are kept
  and drawn where they were made: nothing puts a bus on a road its reports do not support. Before it,
  one report 70 m off the road drew the bus 69.8 m into the block and back.
- **A late report is a pause, not a chase.** When a phone gets a report late, the drawing has already
  come to a stand at the newest report it had; a late report that says the bus had moved on put the
  moment shown 135–300 m ahead of it (a real 119), which the bus then raced to catch. The clock now goes
  back to the moment the drawn place stands for, within the resync allowance, and the bus pulls away at
  its reports' own pace; the time is made up at stands (4×) or 5% at a time, and past the allowance the
  bus is repositioned, cut, and said. The catch-up allowance over the reports' own speed is 2 m/s, from 4.
- **A repositioning is a cut.** An eased correction still running when a repositioning was decided slid
  a said 119 m move across four frames, 41 m a frame, with the camera after it. A resync that moves the
  bus less than a repositioning's worth is eased, not stepped; the delay shortens no faster than the
  clock makes time up, so a report arriving sooner than the last few no longer steps the bus 15–20 m.
- **Starting playback does not step.** A lone report is drawn where it was made; when the second arrives
  it is measured onto its road, and that change is now eased (a 192 at its terminus, 24 m off its road).
- **A standing bus stands and faces its road.** Where nothing else gives it a direction (no reported
  bearing, no line between reports a bus long), a bus drawn within 20 m of its checked road faces along
  it rather than being a round token (42 of 810 rides on the incident reel met a token in their first
  seconds). The body faces along its own length and turns only as it moves (the rules of 24–25
  September, `docs/MOTION_MODEL.md`).

## 3. Recommendation filters are for recommendations

The clean-ride rule (`rideSuitability`: moving, reporting steadily, road left) chooses what Try
Ride-along offers and nothing else. Riding one's own bus — near its destination, standing at a stop,
with no checked road — is never refused by it. With the ride drawn from reports everywhere, a bus on a
scored road is offered like any other. What a ride can and cannot show is said where it applies: the
front view's button names why it is not there, the card says *Standing* or *Last reported position*
while the bus waits, and a bus with no direction is shown from above with one sentence saying why.

## 4. TEST_BUS, traced

Upstream, not ours. The publication that carried it (22 September, 21:14:49) named the raw capture by
SHA-256; that capture on the server (its uncompressed bytes re-hashed to the same value) is BODS's own
SIRI-VM response, `ProducerRef` DepartmentForTransport, with `OperatorRef` BNML, `VehicleRef` TEST_BUS
and `VehicleUniqueId` TEST on scheduled journey 3117 of the 263 (block w128, which YX74OKK had run as
journey 3116 until 21:06). It appears across the capture history, not only that evening. Most likely a
real bus whose ticket machine was logged in as a test unit; either way it is a real report, and it stays
on the map. It is not offered as a ride. The boundary it could have crossed is now checked:
`tests/publication-boundary.test.mjs` finds no fixture marker in anything the site is built from or
deploys, and `deploy/rsync-exclude.txt` no longer sends `tests/` to the server (nothing there ran it,
and it was never served).

## 5. Verified

**Every bus in two reels, ridden as the page rides it** (`scripts/evaluate-ride-faults.mjs`, the site's
20 s poll, a frame every 100 ms; faults told apart by cause, never one "clean" figure). Before is the
deployed `a82abfb` with the estimate in the ride; after is this milestone. Met from each bus's first
publication (22 Sep evening reel: 335 bus-journeys, 79 hours ridden; 24 Sep incident reel: 810, 257 hours):

| | evening, before | evening, after | incident, before | incident, after |
|---|---|---|---|---|
| **A. drawing or camera faults** — rides with any | 60 | 17 | 135 | 24 |
| steps over a bus length, nothing said | 34 | 0 | 57 | 0 |
| turning over 10° in one frame | 32 | 0 | 47 | 1 |
| sprints (over 1.25× and 3 m/s above its reports, 3 s or more) | 61 | 15 | 69 | 10 |
| facing over 30° off where it should face, over 1.5 s, on its road | 4 | 6 | 13 | 18 |
| standing while its reports moved on | 15 | 0 | 6 | 0 |
| a round token on its own road (5 s spans) | 39 | 0 | 666 | 0 |
| over 22.5 m/s | 7 | 0 | 3 | 0 |
| **B. the bus's own stops** — stands of 10 s or more where its reports stood | 632 | 552 | 2,734 | 2,585 |
| **C. missing or uncertain data, the intended fallback** | | | | |
| repositionings, all said (gaps, late path changes) | 159 | 57 | 270 | 142 |
| waiting at the newest report for a late one | 40 | 41 | 108 | 132 |
| drawn over 75 s behind (5 s units) | 63 | 6 | 0 | 0 |
| contradicted reports held | — | 23 | — | 54 |
| turning round on a line between reports with no road under it | 39 | 40 | 101 | 107 |

Met halfway through each run (as a passenger opening a ride mid-journey): A 25 → 2 rides (evening) and
59 → 11 (incident). Routes 15, 250 and 256 alone: A 10 → 1 of 15 rides (evening) and 17 → 2 of 28
(incident); repositionings 92 → 0 and 138 → 2. The remaining A items are short heading lags pulling out
of a stand (a 30–52° spell), sprints of 3–4 s after a stand, and one spin, each listed by the script.
(The categories' "before" for held reports is blank: the deployed build had no such rule. The "facing
off" row compares with where the drawing says the bus should face; the deployed build's lower count is
the look-ahead heading of 24 September, whose own faults showed up as the 32 and 47 spins above.)

**Through the page, entered from a stop** (`scripts/probes/movement-replay.mjs --entry stop --ride
--poll 20`: the stop opened alone, the bus tapped on its board, Ride along; every drawn frame traced),
the same publications through the deployed build and the final one (`a63006b`, recorded after the gate):

| journey | build | unsaid steps | fastest turn, bus / camera | frames as a token | longest facing off | repositionings said | moving |
|---|---|---|---|---|---|---|---|
| 250 inbound MF74NNW (22 Sep 21:15) | a82abfb | 0 | 65 / 65 °/s | 0 | 0.6 s | 3 (213, 188, 153 m) | 81% |
| | final | 0 | 57 / 57 °/s | 0 | 0.6 s | 0 | 100% |
| 43 outbound LV74KNG (the incident, 17:49) | a82abfb | 0 | 54 / 54 | 0 | 0.7 s | 0 | 94% |
| | final | 0 | 55 / 55 | 0 | 1.7 s | 0 | 94% |
| 15 outbound MF74NPC (24 Sep 17:30) | a82abfb | 1 (12 m) | 299 / 120 | 43 | 10.0 s | 1 (209 m) | 77% |
| | final | 0 | 8 / 8 | 0 | 1.3 s | 0 | 68% |
| 256 outbound SK63AVB (no checked road) | a82abfb | 0 | 78 / 124 | 289 | 0 | 0 | 63% |
| | final | 0 | 81 / 125 | 289 | 0.2 s | 0 | 64% |

The 256's pattern has no checked road (its shape was refused: no reports to check it against): standing
at the start with no bearing it is shown from above, and says so, until it has moved a bus's length —
the intended fallback, not a fault. **The continuous before-and-after clip** is the 250:
`outputs/probes/incident-43/ride-250-before-after.webm` (git-ignored; 230 s of each ride side by side at
2×, the same publications, the deployed build's estimate jumping 213, 188 and 153 m, the final build
driving the same stretches), with stills beside it.

**Checks.** Node: 247, among them `tests/uncertain-reports.test.mjs` (a report pushed 70 m off the road
drew the bus 69.8 m into the block on the deployed code; a jump back along the road drew it backwards;
both pass now), `tests/publication-boundary.test.mjs`, `tests/ride-offers.test.mjs`, and the standing
label. Browser checks restated where their premise changed (an estimate in the ride), with the reason
beside each: the scored-road ride offer, the raised front view, the 60 m front-view check (now a report
60 m on, ridden through, the eye never over 28 m/s), a ridden new journey, and the recorded 256 replay,
which now follows the journey on the map for the estimate's checks and has a second check that rides it:
no step a bus could not make unless said, turning at a bus's rate, the camera no faster, never a token,
following throughout. New: a drag with the CPU slowed six times, then Return to bus (backlog 29).

**Gate.** 247 Node tests; 131 Python tests; typecheck; lint with no errors; CI's built-site and deployment-syntax checks; the full browser suite **371 passed, 39 skipped by design, none failed, in 1.1 hours** on the final build (Chromium with SwiftShader, desktop and phone emulation). The first full run on the candidate before it failed 6 (three checks on both profiles): two were premises restated (the head turn waited for an estimate's correction inside the ride; Try Ride-along asserted a scored-road bus was not offered), and one was a fault of this milestone — a drawing begun afresh started from rest — fixed, not restated.

**Deployed as `a63006b`** on 25 September 2026, the served page chunk identical to the local build's, `a82abfb` kept for `deploy/rollback.sh`, collector, web server and timers active; the test folder an earlier deploy had left on the server removed (it was never served). **Ridden on the served site** at 18:17–18:25 UTC, each entered as a passenger enters it, sampled five times a second for 90 s: a 250 (SL63GDA) from Trafford Bar (by) and a 15 (MF74NMZ) from stop 1800SJ32231 — each *estimated* on the map before the ride, drawn from its reports in it (*Moving between its reports · drawn about 55 s behind*), *estimated* again with the same bus after Exit; no step unsaid (largest 2.9 m and 5.1 m between samples), never without a heading, no repositioning, the bus turning at most 20 and 30° a second and the camera 11 and 21. The three rides Try Ride-along offered at that moment (two 50s and a 23) likewise: none repositioned, none without a heading, each *drawn about 50 s behind*. The served live file carries no fixture marker. Emulation only; nothing on a phone in hand.

## 6. Limits

- **The ride is 30–60 s behind the newest report**, and says so to five seconds; a bus whose reports
  come late waits at the newest one (*Last reported position*) and pulls away when the next arrives, and
  one that falls further behind than the resync allowance is repositioned, cut, and said.
- **A bus with no checked road and no reported bearing** that has not moved a bus's length is shown from
  above, with the sentence saying why; a direction is not guessed from the timetable.
- **Where a bus turned round between two reports with no road under them** (a terminus loop), which way
  it turned is not known; the drawing turns it as it moves off, over a second or two.
- **Short heading lags remain** where a bus pulls out slowly from a stand onto its road (spells of
  30–52° for over 1.5 s: 6 on the evening reel, 18 on the incident reel), and a few 3–4 s sprints after a
  stand (15 and 10).
- **At termini and on loop routes the card can say "off its checked road"** where two reports on the road
  go backwards along it (backlog 30).
- **Emulation only.** SwiftShader in Chromium, desktop and phone profiles; the slow-device drag was
  reproduced with Chrome's CPU throttling, not on a slow phone. Nothing here was checked on a phone in hand.
- **Two recorded evenings are not the fleet on every day.** The replays cover 1,145 bus-journeys over 336
  hours of riding on two days; weekday mornings, bad weather and outages are not in them.
