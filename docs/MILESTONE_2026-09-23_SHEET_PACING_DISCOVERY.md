# The sheet that would not stay up, the ride paced by its reports, and a way in to Ride-along

Begun 23 September 2026, late evening, from the deployed build `b9cbe88`. Three problems came from
the owner's own phone, with three screenshots: the phone panel was hard to raise and kept dropping
back; Ride-along still felt unnaturally paced, most of all on services outside the three evaluated
routes; and there was no clear way to find and enjoy Ride-along without knowing how the data works.

Unless a line says otherwise, everything here was measured in Chromium with SwiftShader on this
machine, at desktop (1280 px) and phone (390 px) sizes. **No physical phone was used.** Where a
figure comes from a recording of real reports, the line says so.

---

## 1. The sheet: two clocks for one threshold

**Reproduced first.** The sheet's expanded height was `100dvh − 200px` in the stylesheet and the
drag's snap to it was `72% of window.innerHeight` in code. On a 390 × 844 phone with Safari's
address bar and toolbar showing, the page is about 664 px tall: the cap came to **464 px (70%)**
and the threshold to **478 px**, so an upward drag could never register as expanded, and every one
snapped back to half. Chromium's emulation has no browser bars, so the same numbers were 644 and
608, and every existing check passed. Reproduced deterministically at a 390 × 664 viewport with
real touch events through CDP (`outputs/probes/repro/sheet-drag.mjs`): a drag to the top of the
screen ended at **half** on `b9cbe88`.

**Fixed by one source of truth.** `lib/use-sheet-viewport.ts` measures the *visual* viewport —
the part a passenger can see with the bars and the keyboard taken into account — and writes the
three rest heights (`--sheet-half`, `--sheet-full`, and the keyboard gap `--vv-gap`) onto the
workspace element; the stylesheet draws from them and the drag snaps to them, so the targets are
reachable by construction. The expanded height is everything beneath the search bar, measured
(the bar's own bottom edge plus 8 px), and the sheet is `position: fixed` to the visual viewport,
so it sits above the keyboard on iOS rather than under it. A flick (over 0.35 px/ms over the last
120 ms) goes to the next state in its direction; a slow drag snaps to the nearest. A labelled
control does what the drag does — **Open full list** / **Open details** / **Open planner**, and
**Show map** — so nobody has to discover the gesture.

Two faults found on the way, both by the checks written for the fix: the bar's height read as
0 px at mount, so the expanded sheet rose under the search bar (a `ResizeObserver` on the bar
now re-measures); and a later phone rule re-added the compact heading's padding, leaving 13 px of
dead heading (it is screen-reader-only now).

**Verified** (`tests/browser/sheet.spec.mjs`, phone profile, 8 of 8): a drag to the top at 390 × 664
reaches `full`, taller than three quarters of the screen, with the search bar above it, and stays
there; a flick up from half → full, a flick down from full → half, a slow short drag stays; the
labelled control opens and closes it; scrolling the list to its end three times neither collapses
the sheet nor moves the page; three further publications, a device position update and a
**Fit journey** leave it where it was put (Fit journey folds it to the map on purpose, and the
control brings the list back); the search folds it for the keyboard and gives it back when the
search is left without a choice; showing the map and coming back keeps the chosen bus, the stop
and the place in the list; the last row is reachable. `layout.spec.mjs`'s phone checks pass on the
same build. **What this does not prove**: Safari's own behaviour with its bars, which is why the
physical-device checklist has the exact sequence to try.

## 2. Ride-along pacing: reports played back on a clock, not chased as they arrive

**What was wrong, measured.** Outside the evaluated routes a bus travelled from the report it was
drawn at to the report that had just arrived, taking the time the bus itself took — and then
waited. That is honest, but a phone does not receive reports at the spacing they were made:
a report is 10–20 s old when published, the page polls every 20 s, and two reports often land in
one publication. The drawn bus then sprinted through the pair and stood until the next poll. On
27 recorded journeys (2,107 real reports on routes 15, 250 and 256) replayed through both drawings
on identical 60 fps frames with the arrival jitter a phone sees (each report reaching the page a
seeded 8–38 s after it was made; `scripts/evaluate-playback.mjs`), the old drawing had the bus
**moving in 57% of frames with 59.7 stalls over five seconds an hour**.

**The change.** `PLAYBACK` in `lib/motion.ts`: a bus with two or more reports is drawn where its
reports put it a fixed delay ago, and that display clock advances steadily. The delay is the
median arrival lag the page has itself observed plus 8 s, bounded to **20–40 s**; the clock runs at
0.8× when the buffer is thin and up to 1.2× when it is deep, and never runs backwards. Between two
reports the bus travels the checked road where both measure onto it, else the chord. A pair the
rules refuse (over 400 m, or a silence over 45 s with more than scatter between) is not travelled:
the bus waits at the earlier report and is **repositioned**, and the card says so. A report filed
late, in order, between two already being played moves the path under the bus: under the drawing's
snap distance (150 m) that is eased at about 10 m/s and said as a correction; beyond it the ground
between is not known and it is a repositioning, said with its reason. Two versions got this wrong
and were caught: the first eased every fast pair (the clock's own advance is not a correction,
however fast the reports say the bus went — a Node test), and the second eased an 877 m shift in
two seconds and called it smooth (`ride-quality.spec.mjs`'s repositioning check, in the gate, and
then reproduced frame by frame with a diagnostic).

**Against the old drawing, same reports, same frames, same jitter:** moving in **73%** of frames
(the rest is the bus genuinely standing, which no delay can move: 30, 40, 50 and 60 s delays all
gave 73–74%), **18.6** stalls over five seconds an hour, drawn speed p95 14.7 m/s against 16.2,
and **3 steps over a bus length against 33** — all three the refused gaps (404 m, 434 m and a
4.9 km silence), each said on the card. The price, stated: the drawn bus is behind the newest
report by a median **113 m** (p95 380 m) where the old drawing was 12 m behind, because it is
drawing the bus as it was 20–40 s ago. The card now says exactly that: *Moving between its
reports · drawn N s behind*, with the sentence that it is never ahead of a report.

**On the reported bus, through the built page.** BNGN 3426's journey 1147 on the 163 towards Bury
Interchange (20:48–21:15 UTC on 23 September, the ride in the owner's screenshot) was rebuilt from
the server's retained captures (`pipeline/replay_publications.py`, 99 publications) and played
through the page at real speed by `scripts/probes/movement-replay.mjs`, in the map view and in the
ride-along, on `b9cbe88` and on this build:

| | map before | map after | ride before | ride after |
|---|---|---|---|---|
| frames moving | 89% | **92%** | 88% | **92%** |
| pauses over 5 s | 3 | **2** | 3 | **2** |
| longest pause | 20.4 s | **17.1 s** | 20.4 s | **15.5 s** |
| largest single-frame step | 2.89 m | **2.07 m** | 3.47 m | **1.97 m** |
| snaps | 0 | 0 | 0 | 0 |

The two pauses that remain are the bus standing: in each, a new report arrived (the report age fell
from 10.7 s to 4.5 s, and from 16.9 to 14.1) at the same coordinates as the one before. That is
what a bus at a stop looks like, and the drawing does not invent movement to hide it. The reel is
in `data/evaluation/reel-163-3426.json` (not in Git); the traces and frames are under
`outputs/probes/movement/163-*`.

**Reduced motion** is unchanged: the ride's camera jumps instead of gliding and the front view
steps every 3 s; the playback clock is the same either way, because it is what makes the position
honest, not a decoration.

### 2b. The second version, from the deployed site (24 September)

Two screenshots from the deployed build — the recorded 163 on Rochdale Road and a live 142 on
Wilmslow Road — showed the bus drawn *beside* its road, headed roughly along it, and the owner
described the pace as "too fast, not really fast" from time to time. Both were traced.

- **Beside the road.** The road travel carried each report's own offset from the road across the
  stretch, so a bus whose reports sat 15–35 m off the road was drawn there, with the report's
  bearing rather than the road's. The reports of the recorded 163 lie 1.6 m from its accepted road
  at the median and 5.3 m at the 95th percentile, so the offset was the wrong thing to keep. The
  playback now builds one **path** through the reports — on the road where both ends of a stretch
  measure onto it in order and not the long way round, the chord otherwise, nothing across a pair
  GLIDE refuses — and draws the bus **on** the road with the road's heading. Replayed with its real
  road, the recorded 163 is now within **0.4 m** of it in every frame (it had been up to 40 m off).
- **Fits and starts, three causes found in order, each by tracing one real bus.** (1) The clock's
  rate band, 0.8–1.2×, was itself the visible speed change; the clock now runs at real time, or 5%
  over while behind. (2) The delay, median arrival lag + 8 s, ran dry at every late report on a
  real 219 (reports every 20 s, arriving 16–23 s later), so the bus braked to a stand and set off
  again at each one; the delay now covers the lag and a report interval, bounded **30–60 s**.
  (3) The reports' own timing is jerky — that 219 reported 207 m in 24 s, 16 m in 17 s, 345 m in
  28 s, 67 m in 16 s along open road — and any drawing that reaches every report at its exact
  moment must surge like that. The place shown is now the path's **average over the previous
  24 s**: causal, monotone, never ahead of a report, never reshaped by a later one, at about 12 s
  of added lag, said on the card. On top of it a **follower at a bus's pace**: acceleration held to
  1.0 m/s² and braking to 1.5 m/s² (real buses measured peak at 1.4 and 1.8; the fleet's own 20 s
  segments imply under 0.82), never over 22 m/s, at most 12% over the reports' speed while catching
  up, braking to a stand at the newest report when nothing newer is known.
- **Two versions were wrong on the way, and the measurement said so.** Fritsch–Carlson tangents
  looked ahead, so every new report bent the stretch being played by 10–24 m and the follower
  chased it; each stretch now depends only on reports up to its end. And reading a crossed
  refused pair from the *clock's* stretch missed the repositioning when the follower lagged the
  clock — two of the A/B's three big steps went unsaid; it is read from the drawn bus's own
  stretch now.

**Measured, the same A/B as §2** (27 recorded journeys, 8–38 s arrival jitter, against the glide):
moving in **79%** of frames (57% glide, 73% the first playback), **19.1** stalls over 5 s an hour
(59.7; 18.6), drawn speed p95 **12.3 m/s** (16.2; 14.7), **3** steps over a bus length (33; 3), all
three refused gaps and said, and the drawn bus **65 m** behind the newest report at the median
(12; 113), 291 m at the 95th percentile.

**Measured, every bus.** `scripts/evaluate-fleet-playback.mjs` replays every vehicle in a reel of
rebuilt publications with its own road and judges each: the 63-publication evening window of
22 September holds **334 vehicle-journeys, 118 on a checked road**. Across them: the median bus
moving in **69%** of its frames (45 stood the whole window, by their reports); the 20-second speed
swing a passenger would see (p95 per bus) **6.0 m/s** at the median bus and **8.1** at the 90th
percentile, against 8.7 and 11.7 before the smoothing; no bus drawn faster than **21.8 m/s**; a
bus on a checked road never off it by more than 0.1 m at its 95th percentile (one 51 m excursion,
an eased correction across a bend, said as one); **65 repositionings, every one said** with its
reason, and **no single-frame step over a bus length left unsaid** — the check that found the four
faults above, each of which had been unsaid on one bus among the 334. 23 buses are drawn standing
while their reports moved more than 150 m: almost all report 9–16 times in twenty minutes, so every
pair is a silence over 45 s and refused (backlog 28).

**Verified in the browser** (the same build as the gate below unless said): the ride, ride-quality,
ride-offer, motion, recorded-ride, try-ride, replay, selection and journey-context specs — **134
passed, 4 skipped by design, none failing** — and then the full gate: **335 passed, 36 skipped, 3
failed in 52.5 minutes**. The three: a saved-route check whose map fell back with `tiles_failed`
(the tile host, not the page; it passed alone, twice); the phone ride-quality check, whose fixture
stands until the test's own start so a drawing 30–60 s behind honestly shows that standing for most
of the check's window (it passed and failed on page-load timing alone; restated with ninety seconds
of moving history, and passing); and the phone entry-tap check, whose fixed tap point fell on a
boarding-point sign in that run — the bus is drawn on its road now, so what lies under a fixed
point differs run to run — and the tapped sign chose the stop and ended the ride. That last one is
a real finding about the map, not the check: in the ride a stray tap on a sign threw the passenger
out of it. **Signs now stand down while riding** (a one-line change in the tap handler), the check
keeps its tap, and the ride, ride-quality, map, layout, selection and navigation specs were re-run
on that build: **118 passed, 18 skipped by design, none failing** (21.6 minutes), the entry-tap
check on both profiles among them, and the layout check that taps a sign *outside* the ride still
choosing the stop. That build was deployed as `a2cd913` — and the walk on it found one more thing,
visible only in the morning: **the recorded 163's own vehicle was live on today's journey**, the
page pinned the live one before the recording's first publication replaced the feed, read the
recording as a change of journey, and paused the ride. The live feed is now cleared the moment a
recording starts and the ride is pinned only from the recording's own publications, with a check
that serves the same vehicle live on another journey (`recorded-ride.spec`, `try-ride.spec` and
`journey-context.spec` on that build: 24 passed, none failing). **Deployed as `103e4a8`** (05:30 UTC,
the served page chunk identical to the local build's, `a2cd913` kept for `deploy/rollback.sh`, the
collector and three timers active) and walked again on the served site at 05:36 UTC, with its own
vehicle still live: the recorded ride **following** from its first frame on the phone and the
desktop, 69 → 550 m in its first minute, the card reading *drawn 30 s behind*; a sample of 200
frames over 41 s put the drawn bus **0.0 m off the road at the median and the 95th percentile, 0.1 m
at worst**, moving in 97% of them, no 200 ms step over 2.01 m; the sheet dragged to full at
390 × 664 and stayed; Try Ride-along offered three live estimated rides and the recording; a live
desktop ride (SL63GAO, a 250) was followed at an estimated position and left the map at pitch 0.
Emulation against the real site, not a phone in hand.

**Measured, the recorded 163 with its road:** on the road in every frame (**0.0 m** off it at the
median, the 95th percentile and at worst; it had been up to 40 m off), moving in **87%** of frames, drawn
speed 5.6 m/s at the median and 12.2 at the 95th percentile (13.8 at most), acceleration **0.50 m/s²**
at the 95th percentile, and the largest step between two frames 100 ms apart **1.38 m**.

## 3. A way in: Try Ride-along, and a recorded ride when nothing live suits

**Try Ride-along** replaces the "Explore a bus with the front view" section on the home screen
(`components/try-ride.tsx`, `lib/explore.ts`). It says in one line what the ride is — the map
follows one bus, not a film — and lists up to three buses whose ride is certain *now*, in order
of what the ride can be, with that said on each row: **Estimated movement · Front view** (a road
the published evaluation scored the model on), **Reported positions · may pause · Front view** (a
road accepted against that service's own reports), or **Reported positions · may pause** (a bus
placed on its timetable pattern with a fresh report, outside view only). Choosing a row pins that
bus and starts the ride at once; no stop is chosen by it and the card says so. Exit is the one
button at the top left; on a phone it is the whole screen's one way out.

**A recorded ride, dated.** When no live bus suits — at night, or with the feed down — the section
leads with **Watch a recorded ride · 23 September 2026, 21:59 · 15 min**, and otherwise lists it
after the live rides. `scripts/make-recorded-ride.mjs` cuts one vehicle on one journey out of a
reel of rebuilt publications: every report exactly as it was published on the day, with its
recorded time text, its source capture's SHA-256, its match and its trail, and the publication
envelope stored once (46 publications, 82 KB, 13 KB compressed; the trail's source hashes are
listed once and indexed). **It is cut, and says so.** The first walk on the deployed site found the
recorded bus standing: the vehicle had waited at its origin for five minutes (20:48–20:53) and
crawled through the city centre for six more, and a recording that begins there is honest and
dull. `--from` / `--to` cut the ride by the reports' own recorded times to 20:59:47–21:14:46 UTC,
the moving part (5.0 km), publications that only repeat the last report are dropped, and the
file's `basis` and `cut` fields record the bounds, so nobody can take it for the whole journey. The page (`lib/recorded-ride.ts`, `app/page.tsx`) replays it in place of
the feed: once a second the publication a phone would have been served that far in is put where
the live one goes, with the publication, observation and retrieval times moved onto the page's
clock so the ages read as they did, while the report's own time text, hash and match are left as
evidence of when it really happened. The feed is not polled meanwhile, and a fetch already in
flight is dropped, so nothing live is drawn under the recording's badge. It is badged
**RECORDED RIDE** on the bar, *Recorded ride · 23 September 2026* on the sheet's handle, said at the
top of the panel with **Back to live buses** (and **Play it again** once it ends), and
*Recording · 23 September 2026* on the ride card, which on a phone is the only text on screen.
Nothing from it is written into the journey stores or the address as a journey; the address is
`?ride=<id>`, and the share button inside it copies that link, which reopens the recording and says
it is one — never a vehicle that stopped reporting on the day. Leaving lets the recorded bus go.

The one recording published is the 163 journey above, on its accepted road, so the front view is
offered in it. The archive replay under Behind the data is a different thing (eleven snapshots a
minute apart) and is not offered as a ride.

**Sharing a live ride** without a stop: the card gains **Share** when no stop is chosen; the link
names the bus and its journey, never the device's position, and the copied-link note says that
once the journey has ended the link will say so (the existing "never seen since" handling).

**Verified** (`tests/browser/try-ride.spec.mjs`, 10 of 10 desktop and phone; `recorded-ride.spec.mjs`,
6 of 6): the three tiers in order with their words, the unsettled bus never offered, nothing
qualifying said with the count, the section absent with no feed and no recording; choosing a row
starts the ride on that bus with no stop, and Exit keeps the bus; with no feed the recording is
offered and leads, starts straight into the ride, is badged on the bar, the panel and the ride
card, the drawn bus moves more than 20 m within 25 s, the stores stay empty, the address names the
recording, and one action brings the feed back with the recorded bus gone; a `?ride=` link opens
the recording, its share copies that link, and the feed is not polled under it; a link to a
recording that does not exist says so and the live rides are still offered.

## 4. Visual friction on the phone

- The masthead is 58 px on a phone (88 on desktop) and the compact heading is screen-reader-only;
  the refresh control is in the sheet's handle beside the labelled control, not on its own row.
- **Scheduled against live, unmistakable:** the feed's bar reads *LIVE · positions updated 5 s ago*,
  the handle reads *Live positions · 5 s ago*, and the departure board's heading carries the same
  badge shape as its rows — **Scheduled · not live** — because the owner read LIVE above a board
  of scheduled rows as one claim.
- **A bus with no current report** is a short status — *Last seen 21:17 · drawn where it last
  reported, not moved on* — with **Stop following** and the rest behind **Details**; the card had
  said "no current report" four times.
- **One age on the card**: the chip; the summary line and the "Reported 14 s ago" hint no longer
  repeat it.
- **Targets**: the layout probe measured the handle's refresh and toggle at 40 px and two links at
  21 px (the ride card's Details, the panel head's New journey); all are 44 px now, the links by hit
  area rather than by moving anything. The *Drawing the map…* notice sat under the 2D / City / Fit
  journey row on a slow network once the search bar moved over the map; it sits below the row now.
- Still covered, by design: while the search's matches are open they lie over the map's view
  buttons (3 controls, down from 8 on the deploy before), and a tap outside or Escape clears them.
- Page zoom at 150% and 200% was verified in the previous milestone; the sheet's heights come
  from the visual viewport, which page zoom changes, so nothing here is in pixels of the layout
  viewport. **Desktop** (1280 × 900) and a **short desktop window** (1280 × 620, now one of the
  layout probe's sizes) were recorded on this build: no overlaps and no sideways scroll on any of
  the nine screens at either height; the small targets the probe lists there are the pointer-sized
  ones it has always listed (the wordmark, the search field, the selects, "What is this?"). At
  620 px the map keeps its minimum height, so the page scrolls by about 350 px; everything stays
  reachable, and that minimum is deliberate. Landscape phones are in the same probe's sizes and
  were not re-run for this build.

## 5. A defect found by accident: a raw NUL byte in a source file

`lib/journey-context.ts` carried a literal NUL and a literal 0x1F inside a regular expression's
character class since 20 September (`[^|\x00-\x1f]` had been written with the bytes themselves).
TypeScript accepted it and the regex worked, but `grep`, `file` and any diff tool treated the file
as binary, which is how it was noticed: a search for a function it exports returned nothing. The
bytes are escapes now. Entry 49 in the opportunities log.

## 6. What was checked, and how

- **Node**: 211 → 218 tests (`pnpm test`): the playback rules (the clock never runs backwards, a
  late report is eased and said, a refused pair is a repositioning with its reason, the newest
  report is never passed), the recorded ride (order, sources, the moment served, every clock moved
  by the same amount and the evidence untouched), the three candidate tiers.
- **Browser, focused while iterating**: sheet 8/8 and layout (phone) on the sheet build; try-ride
  10/10 and recorded-ride 6/6 on the discovery build; ride 22/23 on the phone profile, the one
  failure a check that named the old label (*latest N s ago*) and is restated to the new one
  (*drawn N s behind*), as are two in `ride-offer.spec.mjs` — restatements of wording, with the
  reason beside each, not weakened assertions.
- **Browser, the full gate on the completed candidate.** Two full runs. The first, on the build
  before the repositioning fix, was thrown away at check 126 of ~370 by my own mistake — a second
  Playwright run started for a diagnostic cleaned `test-results/` under it, and every later check
  failed on a missing trace file (now in the browser-suite notes as a rule: never a second run
  while a gate runs, on any port). Before it was invalid it had found the one real defect of this
  milestone, the 877 m shift eased as smooth (§2), and four wording or flow restatements. The
  second, on the final build with nothing else running: **344 passed, 46 skipped by design, 4
  failed, 51.9 minutes** (the tally includes a temporary exit diagnostic's 10 phone runs and 10
  desktop skips, deleted before commit). The four failures were two checks on both profiles:
  `selection.spec.mjs`'s missing-bus check, which looked for the alternative bus in the open where
  the compacted card now keeps it behind Details (restated to open Details, like
  `journey-context.spec.mjs`), and `ride.spec.mjs`'s "followed at its reports" check, whose camera
  moved 9 m and 2 m in 12 s. That one was traced with a frame-by-frame diagnostic: the fixture's
  bus stands at its start until the test's own `startMs` and moves from then, and a drawing 20 s
  behind its reports honestly shows that standing for the first twenty seconds of the ride before
  moving at full speed (movement picked up at +17 s in the trace, with the card reading *drawn
  20 s behind* throughout). The check is restated with a minute of moving history, which is what
  it means to check. Both restated files were then re-run on the same, unchanged build: **63 passed,
  3 skipped by design, none failing** (11.9 minutes, desktop and phone). The build the gate ran on
  and the build deployed are the same export.
- **Frames**: `outputs/probes/passenger-layouts/polish` (390 px, ten screens) — the sheet with its
  handle, the board's badge, Try Ride-along, the ride's bar and card; the 163 reel's frames under
  `outputs/probes/movement/163-*`.

## 7. Return to flat on leaving the front view (backlog 23)

The defect as recorded: after about four seconds in the front view, leaving the ride left the map
0.6–3° off flat, and once in four runs 24.9°, on `b9cbe88` and its parent. A temporary diagnostic
(not a check, removed before commit) reproduced the recorded sequence on this build's phone
profile — a standing bus, Ride along, Front view, 3.8 s, Exit — and sampled the camera's pitch
every 100 ms for 2.5 s while recording every camera stop the map made:

- **3 of 3 runs on the first build of this milestone: 70° → 0° within 300–400 ms of Exit, and 0°
  for every later sample.** The camera stops were the same in all three: four at zoom 20.77 on the
  bus, then the fit's two at 14.20.
- **10 of 10 runs on the final build: 70° → 0° within 300–400 ms of Exit, 0° in every later
  sample**, the same six camera stops each time. Thirteen consecutive returns to flat where the
  entry recorded two residues in three runs.
- `ride.spec.mjs`'s full-strength check, *leaving the ride returns the map to flat*, passed on the
  phone profile in the same run.

What changed that could bear on it is the drawing, not the camera: a standing bus outside the
evaluated routes no longer asks for a frame every animation tick once its playback clock has
reached its newest report (`needsFrames` in `lib/motion.ts`), so the front view's per-frame camera
is not still being set in the frames after Exit. That is a plausible cause and is not proved:
nothing here reproduced the residue on this build, and it was intermittent before. The entry is
recorded as **not reproduced in 13 runs on this build, cause plausible but not established**; the
check keeps its full strength, and the physical-device checklist keeps its item, because a real
GPU's frame timing is the one variable emulation cannot vary.

## 8. The finished flow: the way in, the ride's presentation, the delay and the decisions

The owner's brief of 24 September (midday): finish the Try Ride-along experience with finding a
bus still the primary task; improve the ride's presentation by framing, a brief entrance, readable
road and stop context and compact controls, and evaluate the road-ahead ribbon; verify that the
30–60 s playback delay cannot affect whether a bus is judged approaching or past a stop, and state
the delay accurately; review the finished flow for duplicated information, confusing labels and
unnecessary actions. No change to the movement rules, which stand on §2b's measurements.

**Try Ride-along, finished.** Two things were wrong on the served site and both are visible in the
frames the walk kept (`outputs/probes/try-ride-walk/deployed-4/`). The three rows were three 250s —
two to The Trafford Centre and one to Piccadilly Gardens — because the ranking was by tier and then
age alone, which is one choice dressed as three; `rideCandidates` now ranks the first bus of each
service (operator, route, direction, destination) ahead of a second bus of a service already
listed, which fills the list only where fewer services than places qualify (a Node test holds the
order and the fill). And every title was cut short on a 390 px phone — *Ride along · to The
Trafford …*, *Watch a recorded ride · to Bu…* — losing the destination, the one thing that tells
rows apart. The section is the verb now: a row reads *to The Trafford Centre* with its kind of ride
under it, a recording *Recorded ride · to Bury Interchange*, titles wrap rather than clip, and the
accessible names keep the whole sentence. The way in from the first screen is one quiet line under
**Buses near me** — *Or try Ride-along · the map rides with one bus* — a text action, smaller and
below the primary button; on a phone it opens the sheet and brings the section into view with its
first row focused. The live choices and the labelled recording are the same ones as before.

**The ride's presentation.** Four changes, each small:
- **The road ahead, lit** (backlog 27, built). In the ride's outside view the next 320 m of the
  checked road from where the bus is drawn is a soft lime ribbon about a lane wide at the ride's
  zoom (`lm-road-ahead`, from the trail source, per frame). It is drawn only where the drawn bus is
  *on* that road — an estimate's place along its track, or a playback whose stretch was measured
  onto the road — so a bus travelling a chord, or one with no checked road, gets no ribbon: nothing
  is lit that is not known to be its road. Hidden in the front view (the road is the ground there)
  and outside the ride. `data-road-ahead` carries the metres drawn.
- **The next stops named, outside too.** The next three stops on the bus's pattern were labelled in
  the front view only; they are now labelled on the road ahead in the outside view as well, so a
  passenger reads where the bus is going, not only where it is.
- **Framing.** The camera looks along the bus's heading, so what is ahead of it is up the screen and
  what is behind it has been seen. Centred in the clear band between the bar and the card, the bus
  gave half the frame to the road behind it; it now sits about three-fifths of the way down the
  band and the road ahead has the rest (`ridePadding`, 24% of the band added above).
- **The entrance.** The glide's last leg settles — fast away from the flat map, slowing into the
  framing behind the bus (an ease-out cubic, 1.1 s on entering, 0.9 s on a return) — where MapLibre's
  symmetrical ease arrived at speed; the ride's controls fade in over 0.45 s as the glide begins,
  and nothing animates under reduced motion. **Locate me** stands down while riding: the camera is
  on the bus, and the button sat over the road ahead on a phone. Zoom and the theme stay.

**The delay cannot reach a decision, and the figure stated is the measured one.** Whether a bus is
coming to a stop, near it or past it is decided by `relateToStop` from the publication's match of
the *newest* report (`patternIndex` against the stop's index in the pattern), and by `stopBoard`
from that relation; *appears stopped near* reads the reports themselves. Nothing about where the
bus is drawn — the playback's moment, its place on the road — is an input to any of them: the
drawing reads the publication, never the other way round. A Node test holds that a bus's
coordinates and trail change nothing in `relateToStop`; a browser check rides a fixture bus toward
Stop A and holds that the ride card says *past your stop* at the publication whose newest report
passed it, at which moment the drawn bus — played back half a minute or more behind — is still short
of the stop on the same road. The delay the card states was the map's own measurement already
(this frame's presentation time less the moment being shown, never the setting), emitted to the
card in five-second steps; it is now *said* to the nearest five seconds with "about" — *drawn
about 30 s behind* — so the figure is honest to what the reader can use and does not flicker as
the clock runs at real time, and under three seconds it is not a delay and the report's own age is
given instead. The same browser check holds the stated figure against the measured one from the
map's `data-shown` and `data-display` diagnostics, within six seconds.

**Duplicates, labels and actions.** On a computer the ride's map carries **Exit ride-along**, the
mode pill and **What is this?**, and the panel's card beside it carried *Riding along · following
the bus* with a second **Exit**: the same action twice, a hand's width apart, and nothing on a phone
(where the ride is the whole screen and the card is not on it). The panel keeps the sentence, so the
map and the card still say the same thing, and loses the button. The Try Ride-along titles above
were the other duplication of a kind — one service three times. Left alone on purpose: the ride
card over the map on a computer repeats the route and destination the panel shows, because on a
phone that card is the only summary and the checks read it on both profiles; the panel's *No stop
chosen* hint under a Try Ride-along ride, which is true and a way on.

**Verified.** 225 Node tests (four new: the delay words; a bus's coordinates and trail change nothing
in `relateToStop`; distinct services first and the fill), typecheck and lint. The full browser gate
on the candidate build: **344 passed, 36 skipped by design, 6 failed in 55.8 minutes** — the six
being three older checks on both profiles (`motion.spec`, and two in `ride-offer.spec`) whose
patterns read the label's earlier form *drawn N s behind*; restated for *drawn about N s behind*
with the reason beside each and re-run on the same build, 6 passed. Before the gate, the focused run
of the specs this pass touched (92 passed, 3 skipped, 5 failed) found five of the same kind — one
more of those patterns, a new check that read the sheet's state from the panel rather than the
workspace root, and the new stop check waiting for a progress line the card rightly drops once a
bus is past the stop (its eyebrow says *Selected bus · past your stop* instead) — each restated and
re-run, 6 passed; none was a defect in the page. New browser checks: three services first and
titles whole; the way in from the first screen on both profiles, the sheet opened to full on the
phone; coming-or-past judged by the newest report with the drawn bus measured still short of the
stop at that moment and the stated delay within six seconds of the measured one; the road ahead
present on entering the ride and gone on leaving; no road ahead for a bus with no checked road.
Emulation only; the physical checklist gained four items.

**Deployed once, looked at, and changed twice more.** The build above went out as `110428d` and
the walk on the served site (`outputs/probes/try-ride-walk/deployed-5/`) showed the ribbon plainly
on a pale side street in a desktop ride and not at all, by eye, on Rochdale Road in the recorded
163 — an orange primary road under a lime at a third of opacity. The map's own diagnostics said it
was drawn (320 m, three stops named, the measured delay exactly 30 s on both profiles), so the
change was to its paint alone: half opacity. Its re-run then failed the flat-return check once
(backlog 23, 19.8°), which was investigated rather than re-run: the one change of mine on the exit
path — the front-view effect depending on the view — was undone by moving the ride layers'
visibility into the ride effect, which did not help (5 of 10); a probe logging every MapLibre
camera call after Exit could not make the same build fail (32 of 32) but showed the exit sequence
in full; and the **previously deployed build, rebuilt and run under the same runner back to back,
failed 4 of 10 against this build's 1 of 10**. The residue predates this pass; backlog 23 has the
detail and the next step. On this final build the ride, ride-quality, recorded-ride and try-ride specs: **81 passed,
2 skipped by design, 1 failed in 18.2 minutes** — the one being that flat-return check on the phone
profile, which is backlog 23 and is left at full strength. **Deployed as `4b67dfc`** (13:08 UTC; the served page chunk identical to the local build's,
`110428d` kept for `deploy/rollback.sh`, the collector and three timers active) and walked on the
served site (`outputs/probes/try-ride-walk/deployed-6/`): on the phone the sheet dragged to full and
stayed; Try Ride-along offered three estimated rides on three services — a 250 to Piccadilly
Gardens, a 15 to Roedean Gardens, a 250 to The Trafford Centre — and *Recorded ride · to Bury
Interchange*; the recording followed from its first frame, 69 → 552 m in its first minute, the card
*drawn about 30 s behind*, and leaving it brought the live feed back with a clean address; on the
desktop a live 250 was followed at an estimated position and left the map at pitch 0. The map's own
diagnostics on the served recording, both profiles: 320 m of road ahead drawn, three stops named,
and the measured delay (presentation time less the moment shown) exactly 30.0 s against the stated
*about 30 s*. The before-and-after sheet, first and final served frames side by side, is
`outputs/probes/milestone/finished-flow/before-after.png` (git-ignored, with the frames it is made
from). Emulation against the real site; no phone in hand.

## 9. Limitations

- Emulation only. The sheet's fix is reasoned from Safari's geometry and verified at Safari's
  viewport size in Chromium; Safari itself, and iOS's keyboard, are on the physical checklist.
- The playback's delay is a cost: the drawn bus is 30–60 s behind its newest report and the card
  says so, to five seconds. A passenger who wants the newest report itself still has *Show reported
  positions only*. The delay never enters a decision about a stop (§8).
- The road ahead is the accepted shape and nothing more: it does not say the bus will keep to it,
  only that this is the road checked against this service's reports.
- One recorded ride, on one line. Adding another is one command from a reel; the index carries any
  number. The archive replay is not a ride.
- The 163 comparison is one journey, at one time of day, through a software renderer; the A/B on
  27 journeys is where the pacing claim rests.
