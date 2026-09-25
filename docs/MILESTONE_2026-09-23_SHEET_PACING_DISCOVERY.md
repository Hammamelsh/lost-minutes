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

## 9. Backlog 23 fixed: a publication landing during the hand-over

The owner's brief (24 September, afternoon): finish backlog 23 as a bounded camera-exit fix, from
the actual failing sequence and the competing camera updates, with the assertion kept intact, the
hand-over verified on both layouts and under reduced motion, and the required gates reported
exactly on the final candidate.

**The failing sequence, logged.** The flat-return check was copied with every MapLibre camera call
and every publication after Exit recorded, and run under the runner on the deployed build: 20 runs.
Every failing run had a publication fetched within 400 ms of Exit; every passing run had none, or
one after 700 ms. The exit's own calls are always the same — the view effect's ease to flat, then
the ride effect's stop, resize, padding, pitch limit and the fit's 500 ms ease to pitch 0 — and in
each failing run one more followed while the map was moving: `easeTo({center, duration: 450})` from
the effect that brings the frame to a new report outside it. That ease carries no pitch, so the map
kept the tilt it had reached (68.4°, 44.9° in the logs), which is why the residue was anything from
5° to 69°. The morning's probe had passed 32 of 32 only because its own five-second wait moved Exit
away from the ten-second poll, and the midday note's two readings of it — a return-to-bus glide on
the Exit tap, and the runner's polling — are withdrawn in backlog 23.

**The fix**, in that one effect (`components/city-map.tsx`): a new report never starts a camera move
while the camera is already moving, because that move was asked for — the hand-over, a fit, City's
tilt, a gesture — and is judged once the camera is at rest; and on leaving the ride it does not
chase at all, because the hand-over's fit frames the bus. The same effect could stop City's 0.9 s
tilt partway, and did on the phone. Nothing else on the camera path was changed; *Follow on the
map*, which re-centres on each report by a separate effect, has the same shape and is recorded in
backlog 23 for its own fix.

**Checks that hit the case every time.** Four checks in `ride.spec.mjs` land a publication inside
the camera move on purpose, by pressing the page's own *Check for newer positions* from script 60 ms
after Exit, with each publication carrying a report a second newer than the last:
- leaving the front view, and leaving the outside view, each on desktop and phone: the ride off,
  flat and north up, the phone's full-screen ride layout gone, the Ride along button back, and your
  stop and your bus on the map. **On the deployed build all four failed** (flatness);
- City's tilt with a report landing mid-tilt on the phone: it reaches 58° and then the frame goes to
  the report. **On the deployed build it stopped at 6–7°.** On the desktop frame the far end of the
  fixture road lies inside City's tilted view, so nothing is chased and the check is skipped there
  with that reason;
- leaving the front view under reduced motion, both profiles: flat within two seconds, the same
  hand-over assertions. There is no ease to interrupt, so this checks the hand-over rather than the
  fault, and it passed on the deployed build too.

A first version of the hand-over checks put the bus a kilometre from the stop; the fit then frames
the stop's surroundings, and the next report rightly brings the frame to the bus, which failed the
"stop and bus on the map" assertion for a reason that is not this defect. The checks now use a bus
400 m before the stop, and say why. The original flat-return check is unchanged.

**The hand-over on the served site, and one more gap it showed.** The fix was deployed as
`f964c7d` (after a full gate of 357 passed, 37 skipped, none failed) and the hand-over was then
driven on the real site with the real feed: a Try Ride-along ride, the front view where offered,
Exit, and a publication landed 60 ms later, on the phone and the desktop, with and without reduced
motion (`outputs/probes/milestone/handover-live.mjs`, git-ignored). The map was flat and north up
every time — 433 ms after Exit with the ease on the desktop, 9–12 ms under reduced motion, where
there is no glide. But on the phone Exit came back to the **full list**: Try Ride-along opens the
sheet to full and the ride starts from one of its rows, so the map the camera had just returned to
flat was behind the list (`outputs/probes/milestone/finished-flow/handover-phone-no-preference.png`).
Leaving the ride now brings a full sheet back to half, so the passenger returns to the map with the
bus's card under it (one line in `changeView`, `components/follow-view.tsx`); the ride card's
*Details*, which leaves the ride in order to open the card, is a different path and is unchanged. A
phone check in `try-ride.spec.mjs` starts the ride from the full list and holds that Exit lands on
the half sheet with the Ride along button on screen.

**One check that raced, found on the way.** The focused run on that change failed the sheet's
"showing the map and coming back keeps the place in the list" once. Logged, the check's fixed 400 ms
wait after choosing a bus did not see the list's smooth scroll end — it was still moving at 300–462 px
— so the passenger's scroll to 220 px was overtaken and the sheet's toggle then stopped the list at
89–156 px, against the assertion's 150. The same log on `f964c7d`, which does not have the sheet
change, showed the same race (3 of 4 below 150), so it predates it. The check now waits for the list
to come to rest and confirms the passenger's place took before going on; the assertion is unchanged
(6 of 6 on the phone profile). Opportunity 53 records the pattern.

**Verified on the final candidate** (`2c00759`): 225 Node tests; 131 Python tests; typecheck; lint with no errors (12 warnings, all in files this work did not touch); the build; CI's built-site and deployment-syntax checks; and the full browser suite, **358 passed, 38 skipped by design, none failed, in 56.2 minutes**, desktop and phone emulation in Chromium with SwiftShader. The five hand-over checks and the
original flat-return check, repeated five times each per profile on the fix before the sheet change:
45 passed, 5 skipped (the City check on the desktop), none failing. **Deployed as `2c00759`** (16:42
UTC; the served page chunk identical to the gated build's, `f964c7d` kept for `deploy/rollback.sh`,
the collector and three timers active) and driven on the served site with the real feed: on the
phone and the desktop, with and without reduced motion, a Try Ride-along ride in the front view,
Exit, and a publication landed 60 ms later — flat and north up **429 ms and 435 ms** after Exit with
the ease, **3 ms and 6 ms** under reduced motion, the ride layout gone, the sheet at half, the Ride
along button on screen, four of four. The demonstration's stop step on the phone: Trafford Bar (by)
listed a tracked 250 "14 stops before yours" and scheduled 250s at 17:44 and 17:53. The desktop page
itself did not scroll at any step (measured, 0 px). Emulation against the real site; no phone in
hand. One thing seen and not changed: on the phone, after the big zoom of the hand-over, the map's
*The detailed map is slow to arrive* offer can show over a map already drawn while the live tile
host is slow to send the rest — the slow-tile allowance working as designed, on this network.

## 10. The route-43 incident: a ride that appeared to teleport and sat across its road

**Reported** (24 September, evening, from the served site): an ordinary route-43 ride —
`?bus=BNML|LV74KNG|43|outbound|1147`, Portland Street, Nicholas Street and New York Street —
appeared to teleport and to be misplaced and misaligned; the owner's screenshots show the bus facing
across its road, the bus as a round token, and the card reading *drawn about 55 s* and *75 s behind*.
Treated as a failed passenger acceptance check: presentation work and readiness claims paused.

**What the browser had.** The server's own request log (Caddy, read on the server for times and paths
only): the owner's browser had loaded the page at 16:52:52 UTC with `page-3b4e38cab8b5c5a5.js` — the
deployed `2c00759`, the same file served and built here, not a stale cache. The tab holding the 43
link fetched `BNML_43_outbound_c4a0b4208e.json` at 17:51:03 and polled the live publication at
17:52:07, 17:52:38, 17:52:40 and 17:53:03, then stopped (hidden or closed).

**The data.** The collector's 83 retained captures for 17:30–17:58 were rebuilt on the server into the
publications it served (`pipeline/replay_publications.py`) against its own catalogue — the nightly
warehouse snapshot of 03:15, since the collector holds the live warehouse — none corrupt or undated.
LV74KNG is on journey 1147 in every one, placed on `BNML:43:outbound:c4a0b4208e`, an accepted road
(15,151 reports, 95% within 18.2 m). Its publications for 17:48–17:57 are the committed fixture
`tests/recorded/incident-43-lv74kng.json`.

**The four questions, separately.**
- *A — the reports:* in order, no duplicates or conflicts, 12–33 s apart, 4–26 s old on arrival; two
  with no bearing (17:50:51, 17:51:03); from 17:52:30 to 17:53:32 four in a row 26–44 m to one side
  of the road, easing to 4 m by 17:55.
- *B — the road:* the accepted road is the 43's road there. Two other 43s crossed the same stretch in
  the same half hour — MJ74JPY (17:44–17:47) and YN61BGV (17:33–17:37) — 0.2–20 m from it, bearings
  matching Whitworth Street (241°) and Oxford Street (151°), in the same order; LV74KNG's own bearings
  matched the road at every report. So its offset is GPS pushed to one side, not another street.
  The report on the corner of Whitworth Street and Oxford Street, facing 150°, was 43.5 m from the
  Whitworth Street arm — just past the 40 m tolerance, and 92° from its bearing — and was drawn where
  it was made. What this cannot establish: the lane, or that the bus used no service road; "0 m from
  our road" is a statement about the drawing, not proof of where the bus was.
- *C — the drawing:* the model is sound (centred on the drawn point, 12 m, rotated by the bearing it is
  given). The bearing it was given was the *next report's* reported bearing, not the direction of the
  path where the bus is drawn: on the Portland Street–Princess Street corner the bus faced Princess
  Street while drawn on Portland Street, 90–100° across its road; a report with no bearing made it the
  token for a quarter of the ride. Shown again after a hidden minute, the bus was put 125 m on in one
  frame, unsaid. With publications irregular, the clock waited at the end of its reports and made the
  time up at 5%, so the drawing sat 50–90 s behind for minutes (a 90 s gap: 87 s behind a minute
  after publications resumed); the card measured the clock, not the drawn place.
- *D — the camera:* the ride camera takes the drawn heading every frame. Through the page, on the
  incident's own publications, it turned **140°, 92°, 81°, 80° and 77° in single frames** as the
  heading jumped at each report — the whole map swinging round, which reads as the bus jumping —
  and on a repositioning frame it glided across the gap rather than cutting.

**Which of them it was.** The misalignment is C; the "teleport" in a visible ride is D driven by C —
the drawn bus itself never exceeded 7.6 m/s in that replay; the 125 m jump is C on a tab shown again;
the bus crossing the block is B's 43.5 m report handled by C.

**What changed** (`lib/motion.ts`, `components/city-map.tsx`; `docs/MOTION_MODEL.md` has the rules):
the drawn bus faces the way it is drawn travelling, turning at a bus's rate; a report within 20 m of its
road is on it whatever its bearing, and one further off is placed where its own bearing agrees with the
road, up to 50 m off; the road joins two reports round a corner at a bus's pace; a pause in drawing is said as one and the camera cuts; the clock
repositions (said) beyond 15 s behind and makes up time only where the bus stood; the frame loop's
own rest is not a pause; the card's delay is measured from the drawn place. Four older faults the fleet
check found on the way are fixed with it (§ below). **Withdrawn on the way:** a first version read the
four offset reports as another street and drew them where they were made; the renderer's stills
showed the bus inside a building block, and the other 43s' reports showed the reading wrong. A second
let a report's bearing refuse a report lying on its road; the gate's new facing check caught it (a
stale bearing turned the road into straight chords and the heading lagged each kink by up to 100°).

**Before and after, identical inputs.**
- *The regression* (`tests/incident-43.test.mjs`, the incident's publications in four arrival timings —
  polled every 20 s, the owner's logged timing, a 90 s gap, and the frame loop resting): six assertions,
  **all six failing on `2c00759`** (a 14 m unsaid frame; no heading; heading 103° off its movement at
  the 95th percentile; 43.8 m off its road through the run; the return from the background unsaid; a
  203 m unsaid jump after the loop rested) and all six passing now.
- *Through the page* (`scripts/probes/movement-replay.mjs`, the same publications served at the site's
  20 s poll against the server's own catalogue, 17:49:30–17:56:30, every drawn frame traced; ride-along
  and a top-down view, deployed build against the fix):

| | before, `2c00759` | after |
|---|---|---|
| heading off its movement, p95 | 97° | 8° |
| frames facing more than 45° off its movement | 491 | 9 |
| frames drawn as the round token | 579 | 0 |
| largest mid-ride camera turn in one 0.2 s frame | 92° (also 81°, 80°, 77°) | 15° |
| furthest from the checked road | 44 m | 0 m |
| drawn speed, greatest | 7.6 m/s | 8 m/s |
| delay drawn at | 32–35 s | 32–34 s |

  The ride's entrance still turns the camera 133° from north-up to the bus's heading over its 1.1 s
  glide, as designed. Side by side, the same 190 s at three times speed:
  `outputs/probes/incident-43/incident-43-ride-before-after.webm` and `…-topdown-before-after.webm`
  (git-ignored; recorded on the candidate before a gesture change that was then withdrawn, so the
  drawing is the final one). At 137 s the deployed build draws the bus across Portland Street, as in
  the owner's screenshot, and the fix along it; at 249 s the deployed build has the bus inside the
  block on the Whitworth Street–Oxford Street corner and the fix has it on the corner, turning.
- *Every bus* (`scripts/evaluate-fleet-playback.mjs`, polled every 20 s, bus by bus), before → after:

| | incident reel, 767 journeys (220 on a checked road) | 22 Sep evening reel, 334 (118) |
|---|---|---|
| heading off its movement, p95, median bus | 39.6° → 0.6° | 42.3° → 0.7° |
| buses misaligned over 30° for more than 1.5 s | 550 → 10 | 226 → 5 |
| buses turning more than 10° in one frame | 716 → 0 | 278 → 0 |
| buses shown as a token after having a heading | 663 → 0 | 235 → 0 |
| furthest a bus said to be on its road is drawn from it | 51 m → 37 m (one eased correction) | 50 m → 7 m |
| moves over a bus length unsaid | 1 → 0 | 0 → 0 |
| repositionings, all said | 117 → 117 | 66 → 52 |
| drawn delay, median bus | 48 s → 48 s | 56 s → 55 s |
| buses ever drawn over 75 s behind with reports in reach | 15 → 0 | 12 → 9 |
| moving share, median bus | 0.69 → 0.70 | 0.68 → 0.70 |

**Remaining.** On the evening reel nine buses still read over 75 s behind at some moment: their
reports reached the page 40–60 s late, and the drawing waits at the newest report until the next
arrives; one (BNSM 11912, route 197, no checked road) reads up to 146 s for a few seconds early in its
ride, after a stated correction re-anchored it at the start of its trail; the 163 on the incident reel
is eased up to 37 m off its road for about four seconds at its first stop, a stated correction when a
report near the stand moved its path. *Follow on the map* in 2D
re-centres on each report by its own effect and was not changed. A bus whose reports sit well off its road
is still drawn where it reported and travels a straight
line, said on the card, once it lies more than 40 m off (50 m with a bearing that agrees with the road).
Lane-level position is not known anywhere. All of it is Chromium with
SwiftShader against the real publications; not a phone.

**Verified on the final candidate.** 231 Node tests; 131 Python tests; typecheck; lint with no
errors; CI's built-site checks; and the full browser suite, **362 passed, 38 skipped by design, none
failed, in 59.8 minutes** (Chromium, SwiftShader, desktop and phone emulation). **Deployed as
`5c00509`** on 24 September, the served page chunk identical to the local build's, `2c00759` kept for
`deploy/rollback.sh`, collector and timers active.

**The served check found one more, and it was not the last word.** Two live buses were ridden on the
served site for a minute each, sampled five times a second, just after midnight on 25 September. A
192 on its road was right: facing within 3.5° of its movement at the 95th percentile, the camera
turning at most 3.4° between samples, "drawn about 60 s behind". A **216 standing at Piccadilly
Gardens** (BNML BU25YVP, journey 1191) was not: no heading in 138 of 300 samples, so shown from above
with the note "did not report a direction", the camera swinging **69°** between two samples when a
heading appeared, and the card reading **"Off its checked road"**.

- *Its reports*, read from the server's raw captures: one at 00:02:51 with a bearing (109°), then
  every report from 00:03:29 to 00:09:44 from one spot, **3.4 m from its checked road**, with no
  bearing; it moved off at 00:10:11. The page met it after the report with a bearing had left its
  75 s trail.
- *The cause*, reproduced offline from those reports: two reports at one spot make a stretch of no
  length. The road only drew a stretch that went forward along it, so this one was drawn as a
  straight line off the road with no direction. The bus was "off its checked road" everywhere except
  at its newest report, and faced nowhere until a heading turned up; the camera then took it in one
  frame. The note about being shown from above read the *report's* bearing, not the drawing's.
- *The same family across the fleet*, once the fleet check met buses halfway through their runs as a
  passenger can, and measured turning while standing still: the short lines between scattered reports
  at a stand (3–5 m, any direction) were taken as directions, and standing buses turned round on the
  spot, up to 180° within 5 s. Traced on a 143 and a 142 at Piccadilly Gardens.
- *What changed* (`lib/motion.ts`, `components/city-map.tsx`; the rules are in `docs/MOTION_MODEL.md`,
  "A standing bus"): two reports on the road within a bus's length are one place on it, drawn on the
  road facing along it (only where the reports themselves are that close, see below); a line shorter
  than a bus's length gives no heading; a bus turns only as it is drawn moving — at most 15° a metre
  while creeping under 0.5 m/s, up to 60° a metre from 1 m/s, never over 90° a second; the ride camera
  turns at most 120° a second except at a stated repositioning or under reduced motion; the
  from-above note reads what is drawn.
- *Before and after* (`scripts/evaluate-fleet-playback.mjs --poll 20`, `5c00509` against the fix, the
  same reels; "met halfway" starts each bus at the middle of its publications):

| | evening reel, 334 buses | met halfway | incident reel, 767 buses | met halfway |
|---|---|---|---|---|
| buses drawn on their road with no heading | 33 → 0 | 12 → 0 | 49 → 0 | 16 → 1 |
| buses turning over 20° within 5 s while standing still | 110 → 20 | 62 → 6 | 378 → 67 | 199 → 29 |
| the most any bus turned so | 180° → 37° | 180° → 28° | 180° → 36° | 180° → 35° |
| buses called off their road while drawn within 10 m of it | 90 → 47 | 57 → 23 | 193 → 122 | 147 → 81 |
| buses facing over 30° off their movement for over 1.5 s | 5 → 5 | 1 → 1 | 10 → 10 | 3 → 3 |
| moves over a bus length unsaid; repositionings | 0 → 0; 52 → 52 | 0 → 0; 24 → 24 | 0 → 0; 117 → 117 | 0 → 0; 66 → 66 |

  Position, delay and moving share are identical in every run: the change is to which way the bus
  faces and what the card calls it.
- *Regressions that fail on `5c00509`*: `tests/standing-on-road.test.mjs` — the 216's own reports met
  at four moments (800 of 901 frames called off its road), scatter a few metres back along a road
  (turned 180° from it), and scatter with no road (turned 161° within 5 s); a fourth, the 263 below,
  fails on `cd711a3` (3.2 s facing the wrong way) and passes on `5c00509` and the fix — and two browser checks
  in `tests/browser/ride-quality.spec.mjs`: a bus met standing on its road with no bearing (no heading
  in the samples, on both profiles) and a heading first appearing in the ride (the camera turned 145°
  in 239–300 ms). All pass on the fix.
- *Still so:* a bus called "off its checked road" while drawn along it, where two reports on the road
  go backwards along it, at termini and on loop routes, where the stretch between them is drawn
  straight (42 of 334 and 115 of 767 buses at some moment). A bus with no checked road and no
  reported bearing that has not moved a bus's length is shown from above, and says so. A creeping bus
  can still turn up to about 37° in 5 s.

**Deployed as `cd711a3`, and the served ride found a fault of my own in it.** Verified first: 233
Node tests; 131 Python tests; typecheck; lint with no errors; CI's built-site checks; the full browser
suite **363 passed, 38 skipped, 3 failed in 60 minutes** — three consecutive phone checks in one
40-second window in which no map tile arrived from the tile host, so each page drew its simple map
before the check began; the same three passed 6 of 6 on both profiles on the same build. The served
page chunk was identical to the local build's, `5c00509` kept for rollback. Ridden on the served site
at 02:06 UTC, a minute each:

| live bus | on `5c00509` (01:05 UTC) | on `cd711a3` |
|---|---|---|
| 216 BU25YVP, the incident's own vehicle, standing again at Piccadilly Gardens | — | faces 106.5° throughout; no "off its road"; no from-above note |
| V1 at Manchester Royal Infirmary, standing on The Boulevard | no heading in 300 of 300 samples, "Off its checked road", shown from above (vehicle 2336) | faces 322.4° throughout; neither said (vehicle 2314) |
| 263 at its stand | faced 130.5° while the note said it was shown from above (MF74NSJ) | **faced over 100° off its movement** at the 95th percentile (MJ74JMX) |
| 142 with no checked road, standing | — | faces a held 214–225°, no token |
| 192 moving | heading p95 3.5° | heading p95 4°, camera at most 8.7° a sample |

The 263 was not standing: from its server captures, it drove 60 m north-west off its route round the
terminus loop and back through a U-turn. Two faults, both from this change: its first two moving
reports, 20 m apart and leaving the road, measured onto the road 9 m apart, so the new one-place rule
drew them on the road, backing along it facing forwards, for 2.6 s; and at 15° a metre the U-turn
lagged its path by a second. Fixed: the one-place rule needs the reports themselves within a bus's
length, and the per-metre limit is strict only while creeping (15° a metre under 0.5 m/s, 60° from
1 m/s). Replayed offline from its captures: 0 samples over 30° off its movement, where `cd711a3` had
18 and `5c00509` 0. The fleet figures above are for this final rule; the fourth Node regression is
the 263's own reports.

**Deployed as `1a53e48`.** 235 Node tests; typecheck; lint with no errors; the full browser suite
**365 passed, 38 skipped, 1 failed**: the front view's check that a 60 m correction to an *estimate*
is absorbed without a jump. Run six times on each build, it fails 2 of 6 on this one, on `cd711a3` and
on `5c00509` alike, with the eye at 28–29 m/s: an intermittent fault in the estimated front view, older
than this work, and part of backlog 31 below. The served page chunk was identical to the local build's,
`cd711a3` kept for rollback.

**Suggested rides, made clean (the owner's request: "make sure any suggested ride along is 100% clean
and working cleanly and smoothly").** A new replay, `scripts/evaluate-ride-offers.mjs`, takes every
publication of a recorded reel, asks which buses Try Ride-along would have offered at that moment, and
rides each for the next three minutes through the drawing at the site's 20 s poll. It calls a ride clean
only with no repositioning, no step unsaid, no spell over 1 s facing more than 30° off its movement,
never off its road or without a heading, no turning while standing, no stand over 45 s, never over
75 s behind, and its reports not ending.

- *The list as it was* offered estimated-movement buses first, and on both reels every offer was one.
  **3 of 159 and 4 of 219 of those rides were clean.** Traced on a 250: a 230 m repositioning after
  20 s, 181 m after 40 s, then 90–134 m eased corrections every 20 s, because the estimate predicts from
  reports that reach a phone 32–45 s old. It also offered buses standing at a terminus, buses with under
  a kilometre of journey left, and a vehicle called **TEST_BUS**.
- *The body heading.* Riding every bus the list could offer (5,066 rides over the two reels) showed slow
  buses turning their nose into a corner seconds before reaching it: the drawn heading pointed a bus's
  length ahead. It now lies along the road from half a bus behind to half a bus ahead
  (`docs/MOTION_MODEL.md`). Rides passing the new rule, clean: 61.5% → 77.8%.
- *The new rule* (`lib/explore.ts`, `rideSuitability` and `cleanRideCandidates`): a bus is offered only
  if it is on a checked road the model was not scored on (so it is drawn between its own reports), is
  not an operator's test vehicle, and its reports over the last two minutes lie within 12 m of that
  road, go forward along it by at least 80 m, come no more than 40 s apart, and leave at least 1.5 km of
  road. Each bound was chosen from the replay, not by eye. Try Ride-along loads the candidates' roads
  to judge them; with nothing that qualifies it says so and offers the recording.

| | before | after |
|---|---|---|
| offered rides clean over three minutes, 22 Sep evening reel | 3 of 159 (2%) | **125 of 159 (79%)** |
| the same, 24 Sep incident reel | 4 of 219 (2%) | **182 of 213 (85%)** |
| moments with at least one ride offered | 53 of 53; 73 of 73 | 53 of 53; 71 of 73 |
| rides with a repositioning | 119; 120 | 2; 2 |
| rides with a step over a bus length unsaid | 40; 58 | 0; 0 |
| rides with no heading at some moment | 55; 93 | 0; 0 |

  What is left in the offered rides: on the evening reel 12 drawn over 75 s behind (their reports
  reached the collector late; the card says how far behind) and 8 standing over 45 s at a stop, both the
  bus's own behaviour, and 9 facing off their movement for over a second, 6 briefly off their road and
  2 said repositionings; on the incident reel 15, 10, 6 and 2 of the same. **Not 100%**, and on a live
  feed it cannot be promised: what a bus does in the next three minutes is not in its last two.
- *Checks.* `tests/ride-offers.test.mjs` (each refusal, the offer list, the test vehicle); the Try
  Ride-along checks restated for the rule (an estimated bus, a standing bus and a bus with no checked
  road are not offered, each said), the recording's order with a live ride, and three ride-quality
  checks that reached a no-road bus through the list now reach it through its link, their assertions
  unchanged. Focused run on the candidate: 53 passed, 1 skipped by design.
- *Not changed, and the owner's decision* (backlog 31): a passenger who chooses a 15, 250 or 256 at its
  stop and rides it still gets estimated movement, and its jumps.

**Deployed as `a82abfb`, verified on the final candidate.** 238 Node tests; 131 Python tests; typecheck; lint with no errors; CI's built-site and deployment-syntax checks; the full browser suite **367 passed, 38 skipped, 1 failed in 60 minutes**, the failure backlog 29's drag-during-entrance race, which then passed 6 of 6 on the same build (desktop and phone emulation in Chromium with SwiftShader). The served page chunk was identical to the local build's, `1a53e48` kept for rollback, collector, web server and timers active. On the served site at 05:23–05:30 UTC, Try Ride-along offered three rides (a 50, a 142 and a 248, all on checked roads), and the three rides offered at the moments they were tapped were ridden for 90 s each: a 30 to Piccadilly Gardens, a 163 to Bury and a 197 to Chorlton Street. None lost its heading or was repositioned; the longest spell facing over 30° off its movement was 0.5 s; the camera turned at most 10.9° between samples; each said "drawn about 45–60 s behind". The frames show each bus on its road and facing along it. Emulation only; nothing on a phone in hand.

## 11. Limitations

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
