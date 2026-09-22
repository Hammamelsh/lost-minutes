# 22 September 2026, evening: one workspace — a map beside a panel, a map under a sheet

Status words as in `PROJECT_CONTEXT.md`: **Implemented** exists in the code, **Verified** has an
executed check behind it, **Planned** does not exist, **Unknown** has not been established. Every
browser figure here is Chromium with software WebGL on this laptop, at 1366 × 768, 1280 × 900,
390 × 844, 360 × 740, 844 × 390 (a phone on its side) and 390 × 844 at 125% zoom. **No physical
phone.** "REAL" means real publications from the server through the local proxy; "FIXTURE" means
the recorded route-256 road and synthetic buses on the real stop catalogue.

The complaint this answers: *the latest functionality is useful, but the page is cluttered and
takes too much scrolling.*

## 1. What the page is now

**A workspace, not a scroll.** The stop, the board, the bus and the planner are one panel beside
the map on a computer, and one sheet over the map on a phone. The page's own scroll is the foot of
the page and nothing else: the map and the panel are the first screen, whole.

| At a stop, page height ÷ viewport | before | after |
|---|---|---|
| 1366 × 768 | 2147 px (2.8 screens) | 976 px (1.27) |
| 390 × 844 | 2669 px (3.2 screens) | 1145 px (1.36) |
| 360 × 740 | 2630 px (3.6 screens) | 1041 px (1.41) |
| 844 × 390, on its side | 2201 px (5.6 screens) | 954 px (2.4) |

Both columns were measured the same way, by the same probe against the local proxy
(`outputs/probes/repro/layout-before-after.mjs`), as `document.documentElement.scrollHeight`. That
number also counts content a collapsed disclosure lays out and clips, so it is a comparison rather
than a count of what a passenger scrolls: on the live site the same page reads 1,667 px on a
computer with the workspace unchanged. **The claim that matters is the workspace's own box**, which
`layout.spec` checks on every run and which the measurements below give.

The workspace itself ends within the first screen at every size: on a phone the masthead is 68 px,
the heading one line of 33 px, and the workspace the remaining 740 px of an 844 px screen. Held
sideways it is 58 + 31 + 312 of a 390 px screen, 11 px over, with the map and the panel side by
side. What is still below the fold there is the foot of the page, not the workspace. On the served
site: 88 + 61 + 608 of 768 on a computer, and 68 + 33 + 740 of 844 on a phone.

**What the panel is about follows the task**, and each change has a way back:

| Mode | What the panel leads with | The way back |
|---|---|---|
| `home` | Buses near me, the search, saved and recent stops, Explore a bus | — |
| `stop` | the stop, its services, the board, the walk | Change, New journey |
| `bus` | the chosen bus's card, **with the board still under it** | Back to the board |
| `plan` | the planner | Back to *the stop's name* |

`data-panel` on the workspace names the mode, and `data-sheet` the sheet's state, so a check can
say which of the four is open rather than infer it.

**Choosing a bus does not take the board away.** The card leads and the board follows, so another
bus is one tap away and the pinned row stays visible in the list. This was a deliberate reversal:
the first build of bus mode replaced the board, which broke both the passenger's ability to compare
and 28 checks that read the pinned row. Keeping both was the better answer, not the cheaper one.

**On a phone the panel is a sheet** with three heights — the handle alone (92 px), a little under
half the screen (46 dvh), and nearly full — **moved by its button as well as by a drag**. The
handle is the panel's title: it names the stop, carries the feed's state (`LIVE · 17s ago`) and the
button that asks for newer positions, and points up or down. Because the handle names the stop, the
block under it no longer prints the name a second time, which a check requires.

**The search and the planner are always in reach**, above the panel on a computer and over the map
on a phone. Focusing the search folds the sheet to its handle, so the matches have the screen, and
pressing **Fit journey** folds it too: the passenger asked to see the journey, and the band a sheet
leaves cannot hold one. **The ride takes the whole screen on a phone** — the sheet and the top bar
go, and the ride's own bar, card and Exit carry it — rather than leaving a handle whose chevron
would do nothing.

## 2. Map clarity

**Every boarding point is on the map** as a sign on a post — ink on paper by day, paper on ink by
night — from zoom 13.5, growing with the zoom, each one drawn (a stop hidden by collision would be
a stop that cannot be tapped). Names appear from 15.6, and give way to each other by distance from
the chosen stop. The chosen stop keeps its orange ring and is **excluded** from the sign layer, so
it is drawn once, not twice. `data-stop-points` on the map reports which boarding points are on the
screen and where, as `data-bus-points` already did for buses.

**A fit nobody can read is not a fit.** Fitting You and a half-mile walk into the band a phone's
sheet leaves took the camera to **zoom 13.25** — below the zoom at which any boarding point is
drawn, and where no street is named. Measured, at the same stop: **0 boarding points on screen**.
Two faults were behind it. The padding a fit reserves is room taken out of the map, and it could
ask for more than the map has: the controls and the covered part came to 640 px of a 740 px map,
and MapLibre fitted the journey into what was left — which also put a chosen stop outside the
canvas entirely, as `ride.spec` reported. Padding is now clamped to leave at least a quarter of
each side, or 120 px. And an automatic fit now stops at zoom 14.2 and frames the stop's own
surroundings, offset into the visible band: **31 boarding points on screen**, the stop at y = 190
with the sheet's top at 301. Pressing **Fit journey** still fits the whole journey, at whatever
zoom that needs: the passenger asked for it.

**Two boarding points under one finger** open the same chooser the two buses do, saying which is
which.

## 3. Defects found by this work, each reproduced before it was fixed
1. **The home screen lost "Buses near me" whenever no stop was near.** The block holding it was
   gated on the nearby list already being non-empty — which is the one case a newcomer is in.
   (`explore.spec`, FIXTURE.)
2. **The sheet's handle repeated a heading word for word**, so `Stops near you` matched two
   elements and 20 checks failed on the ambiguity rather than on the page. The handle now says
   what the panel is *for* ("Find your stop").
3. **The search's matches were under the sheet.** A z-index inside the top bar cannot lift them
   past a sibling that sits higher; the top bar itself now stands above the sheet. Reproduced as a
   click that Playwright retried for 150 s against "sheet-toggle intercepts pointer events".
4. **The simple map's notice began behind the top bar**, so "Use the detailed map" could not be
   clicked on a phone.
5. **A tap on the sheet's handle did nothing.** The drag captured the pointer on every
   `pointerdown`, which took the click away from the button inside it. The pointer is now captured
   only once the finger has moved 8 px, and a tap that never moved is left to the button.
6. **The grip read as a scrollbar**: it spanned the sheet's width. It is a 40 px bar now.
7. **The planner's label crowded the search** until the placeholder was cut ("Bus number, stop
   or"). Narrow columns show **Plan**; the accessible name stays "Plan a journey".
8. **The map's tool column ran into the Ride along button** on a phone once the tools moved down
   to clear the search: the button took the taps meant for the night-map control. Caught by
   `journey.spec`'s overlap check, which reported `.map-tools × .ride-launch`; the map's foot now
   stops before that column.
9. **The refresh control vanished from phones.** It lived in the feed bar, which the phone layout
   replaced with the search and the planner. Three specs failed on it —`selection.spec`,
   `passenger.spec`, `empty-states.spec` — each waiting for "Check for newer positions". It is a
   button in the sheet's handle now, beside the feed's state.
10. **A reloaded plan was invisible.** The planner had always been rendered below the fold, so a
   reload that restored a destination from the address showed it. As a mode of the panel it was
   closed, and the plan was remembered but not shown until the planner was opened again. A
   destination now shows its plan under the board, and only the planner's own mode takes the
   whole panel. Caught by `plan.spec` on both widths.
11. **Entering the ride framed the bus for a map that no longer existed.** On a phone the ride
   takes the screen — the sheet and the top bar go — but the class that does that is added by a
   different effect, so the camera measured the old container and the drawn bus slid off the
   canvas for a frame (`ride.spec`: "the bus never leaves the map while the camera glides", one
   sample at 199 ms, 69 px outside). Entering now waits for the browser to lay the ride out.
12. **The fit's padding could ask for more room than the map has** (640 px of a 740 px map), and
   MapLibre then fitted the journey into what was left: a camera at zoom 13.25, and in one case
   the chosen stop outside the canvas. Clamped to leave at least a quarter of each side.

## 4. Verification

- **New checks:** `layout.spec` — the page does not scroll and the workspace is the first screen;
  map and panel side by side on a computer; the sheet's states, its button and its one name on a
  phone; the card leading with the board under it and Back putting the board first; planning
  replacing the panel and giving the stop back; a fresh visitor offered both ways in. 10 passed,
  2 skipped by design (each is for one width).
- **Restated, not loosened**, each because the design deliberately changed, and each still
  asserting the same substance:
  - `board.spec` asked for the sentence "No arrival minutes here yet"; the board now carries it as
    "(no arrival minutes here yet)" inside one shorter line, so the check asks for the words,
    case-insensitively.
  - `plan.spec` opened a planner that used to be rendered below the fold; it now presses the entry
    in the top bar, as a passenger does.
  - `chooser.spec`, `location.spec` and `search.spec` tapped and dragged the map at its centre,
    which on a phone is under the sheet. They pull the sheet down first — a passenger action, by a
    real drag of the handle — and a new shared helper, `mapBand`, gives the part of the map
    nothing covers. Nothing became more permissive: the tap must still land on the map, and the
    check still fails if something covers it.
  - `replay.spec` read `data-display`'s empty "distance along the road" as the number 0, which put
    the drawn bus at the start of the route for one frame and read as a 6,794 m jump. It was the
    check's parse, not the page: replaying the same journey through the model offline
    (`outputs/probes/repro/replay-offline.mjs`, the published settings) gives one 231 m snap and no
    jump at all. Empty now means "not on a road", and every sample is kept for diagnosis.
  - `selection.spec` and `chooser.spec` looked for "empty map" by avoiding the drawn buses. Every
    boarding point is drawn now, and a tap on one chooses that stop, so empty means clear of the
    signs as well — which the map's own `data-stop-points` says.
  - `ride.spec` required the drawn bus to be inside the canvas at *every* sample while the camera
    glides into the ride. Since the readable-zoom floor the framing before a ride is the stop's
    surroundings, so a bus further off can start outside the frame with the camera on its way to
    it. The check now requires that once the bus is on the map it never leaves — which is what the
    entering glide was built to guarantee.
  - `walking.spec` chose a starting point by clicking the middle of the canvas, which the sheet
    covers; it pulls the sheet down, taps in the band, and puts the sheet back.
- **Real defects the suite caught, not the checks' fault:** the map's tool column overlapping the
  Ride along button on a phone (`journey.spec`'s "controls, notes and the ride-along card never
  cover one another"), the refresh control missing from phones (`selection.spec`, `passenger.spec`,
  `empty-states.spec` — three specs, one cause), and the fit padding exceeding the map's height
  (`ride.spec`'s "before riding, a fitted map keeps your stop and its name clear", which reported
  the stop's position outside the canvas).
- **A phone-only pass over the fourteen specs the layout touches**, on the candidate before the
  last fixes: **91 passed, 11 failed, 2 skipped** in 17 minutes. Every failure was traced — five
  to the checks tapping a map that the sheet now covers, three to real defects (the refresh, the
  tool column, the fit's padding), one to the planner's entry, one to the ride's resize, one to a
  phone-speed budget — and each was fixed or restated before the gate below.
- **The whole browser suite on the deployed build: 302 passed, 26 skipped by design, none
  failing**, in 41.6 minutes (Chromium with SwiftShader, desktop 1280 × 900 and phone 390 × 844).
  A one-line stylesheet tidy followed it — the refresh button had been pushed onto a line of its
  own under the sheet's title — and `layout.spec`, `access.spec`, `passenger.spec` and
  `empty-states.spec` passed 49 on the build that carries it.
- **The run before it, on the candidate: 297 passed, 5 failed, 26 skipped by design** in 42.6
  minutes (Chromium with SwiftShader, desktop 1280 × 900 and phone 390 × 844).
  The five, each then fixed and the specs re-run: three were the new `layout.spec` itself (a sign
  it tapped had a bus within a finger's reach; the sheet's height read while it was still
  animating; on a phone the same sign test), one was `selection.spec` calling a patch of map
  "empty" that had a boarding point 26 px below it — a sign stands on its point and is drawn
  above it, so it reached up into the tap's margin — and one was `ride.spec`'s front-view bound of
  28 m/s reading **28.05**, a 0.2% overshoot of a threshold whose own comment allows "room for
  sampling".
- Node tests 202, Python 131, typecheck (clean) and lint (0 errors, 5 pre-existing warnings) on
  the same commit.
- **Frames** at five viewports, REAL data through the proxy, before and after:
  `outputs/probes/milestone/layout/before` and `.../after`, taken by
  `outputs/probes/repro/layout-before-after.mjs`. `outputs/` is not in Git.

## 4a. The brief, requirement by requirement

Each is **implemented and verified** (with the check), **implemented but unverified** (with what
would verify it), or **blocked** (with the reason).

| Requirement | Status |
|---|---|
| Desktop: map beside one focused panel; search and planning easy to find | verified — `layout.spec` "on a computer the map and the panel are side by side" |
| Selecting a stop opens its board; selecting a bus opens details; planning replaces the panel | verified — `layout.spec` mode checks, `data-panel` |
| Obvious Back / Change stop / New journey | verified — `layout.spec` Back, `journey-state.spec` for Change and New journey |
| The panel scrolls, not the page | verified — `layout.spec` "the page itself does not scroll" at both sizes |
| Phone: search above the map; a sheet with compact and expanded states | verified — `layout.spec` sheet states and `data-sheet` |
| Expansion by button as well as gesture | verified — the button in `layout.spec`; the drag by `foldSheet` in `chooser.spec`, `location.spec` and `search.spec`, which is a real pointer drag of the handle |
| Selected stop, direction and next action visible without scrolling | verified — the frames at 390 × 844 and 360 × 740: the stop, its side of the road, the services and the board's first answer are on the first screen |
| Keyboard, browser bars, landscape, larger text | **unverified on a phone.** Landscape and 125% zoom are in the frames; a real on-screen keyboard and real browser bars need a device (`docs/PHYSICAL_DEVICE_CHECKLIST.md`) |
| No competing scroll areas | verified — one scrolling element (`layout.spec` reads the computed overflow) |
| A list alternative to the map | kept — Buses near me, the search and the board are all lists; the simple map is still offered (`access.spec`) |
| Recognisable stop symbols at neighbourhood zooms | verified — `data-stop-points`: 31 on a phone and 26–68 on a computer at zooms 14.2–15.2; frames show the sign |
| Route-number vehicle markers with direction | already so, unchanged: the flat marker carries the number and the reported bearing points it |
| Selected stop and bus distinct; My location, starting point and past reports distinct | already so (orange ring, lime, hollow blue ring, hollow half-size rings), unchanged |
| Zoom-dependent labels, the chosen stop's neighbours first | implemented — `symbol-sort-key` by distance from the chosen stop; **unverified** beyond the frames |
| A chooser for overlapping targets | verified — `chooser.spec` for buses; stops share the code, and `layout.spec` taps a single sign |
| Opposite sides of a road distinguishable | verified — `search.spec` "tapping a stop ring on the map chooses that stop; the other side of the road is its own ring" |
| Board: stop, services, tracked buses, a clear Bee Network action, one short unavailable explanation | verified — `board.spec`, `empty-states.spec` |
| Methodology out of the board | implemented — the when-line is one sentence and the evidence stays under "How we know this" |
| Walking easy to open, not dominating | unchanged from 21 September: it is a disclosure under the board |
| List ↔ marker identity; nearby list consistency; riding shows no stale list | verified — `selection.spec`, `ride-quality.spec` |
| Map instance and chosen bus stable | verified — `journey.spec` "day and night repaint the same map instance", `selection.spec` |
| Back, saved stops, Continue, New journey, moving device location, fixed origins, shared plans, Google Maps return | verified — `journey-state.spec`, `journey-context.spec`, `location.spec`, `plan.spec`, `head-turn-moving.spec` |
| The standing-bus fallback kept | untouched: no change to `lib/motion.ts` in this milestone |
| Comparable before/after at five viewports | verified — `outputs/probes/milestone/layout/before` and `after` (Git ignores `outputs/`) |
| A fresh visitor can find a stop; a stop can be chosen without knowing its name | verified — `layout.spec` "a fresh visitor is offered the two ways in" and "a boarding point is chosen by tapping its sign on the map" |
| Planning for someone else does not overwrite the device's location | verified — `plan.spec` and `location.spec` (a fixed start is never overwritten) |
| Opening details does not reset the map or the chosen bus | verified — `navigation.spec` round trip behind the data |

## 4b. Deployment and what is served

- `deploy/publish.sh lost-minutes`: **RELEASE `0061efe`**, the previous release kept for
  `deploy/rollback.sh`. The served page chunk is the local build's
  (`page-70a6d33a70aebad2.js`), the live publication was current at deploy, the shape index and
  the 654 KB stop catalogue are served, and the collector, health timer and refresh timer are all
  active.
- **The passenger's journey walked on the live site**, desktop and phone, REAL data
  (`outputs/probes/repro/passenger-walkthrough.mjs`, frames in
  `outputs/probes/milestone/layout/served`): a stop found by name, its board, a bus chosen, the
  ride, the way back, the board again, the night map, a reload and a shared link.
- **One defect that only the served frames showed**: on a phone the ride sat inside the 740 px
  workspace with the page's foot under it, because the workspace's `position:absolute` for the map
  has the same specificity as the ride's own `position:fixed` and came later in the stylesheet. The
  ride takes the screen again (`0061efe`); `ride.spec`, `navigation.spec`, `motion.spec` and
  `layout.spec` passed 92 with 6 skipped on the build that carries it.

## 5. Limitations

- Emulation only. `docs/PHYSICAL_DEVICE_CHECKLIST.md` still has every item unchecked: a real
  phone's keyboard, its browser bars, a real drag on a real sheet and a real GPS are untested here.
- **The app's type is in pixels**, so a browser's font-size setting does not enlarge it. The
  enlarged-text frame is page zoom at 125%, which is what a reader actually reaches for, and the
  layout holds. Moving the type scale to rem is a separate piece of work.
- With no stop chosen the map draws the browsed route's buses, not every bus in the city. That
  keeps the map and the list saying the same thing; whether a newcomer would rather see the whole
  fleet is untested (backlog 18).
- **Two things are shown in one place rather than two, by judgement, not by measurement**: on a
  phone the stop's name is the sheet's handle and not also a heading under it, and the planner's
  own title gives way to the handle's. Both keep the words in the page for anything that reads
  them. Nobody has been watched using either.
- **Pressing Fit journey on a phone folds the sheet**, because the passenger asked to see the
  journey and the band the sheet leaves cannot hold one. Nothing is lost — the handle brings the
  panel back — but it is a camera action that changes the layout, which is unusual, and it has
  been checked in emulation only.
- The heading above the workspace is one small line on a phone and on a short screen. No body
  text was shrunk and no action was hidden to make room; the feed's state and the refresh moved
  into the sheet's handle, where they are larger than they were.
