# 28 September 2026: follow both legs of your journey

The owner's brief: a journey with one change, planned from what the app already holds, shown on
the one map with one compact card, followed leg by leg, timed only as far as the evidence allows,
and simple: *enter From and To → choose a journey → follow clear instructions*. No new estimator;
"Watch both" left as an optional prototype after the core.

Status words as in `PROJECT_CONTEXT.md`. Browser checks are Chromium with software WebGL, desktop
and phone emulation, on fixtures unless marked REAL; nothing on a phone in hand, and no real
passenger has tried it (`docs/CONNECTION_WALKTHROUGH.md` is for that).

## 1. What was reviewed first, and what it settled

- **The planner** (`lib/plan.ts`) offered direct buses only and handed changes to Google Maps and
  the Bee Network planner. Its rules (one pattern valid and running on the day, walks under 900 m,
  a detour refused) are kept for the direct case and extended, not replaced.
- **The timetable data** already published everything a change needs: every pattern's per-stop
  scheduled seconds and timings (`patterns.json`), and per-stop boards with each journey's origin
  departure, timing index and operating rule (`departures/<ATCO>.json`, 2,682 stops). No pipeline
  change was needed, and none was made.
- **Binding a bus to a dated journey** existed: the matcher writes `match.scheduled` (departure,
  service day, timing) where the operator's reported origin departure names one journey or one
  shared timing, and the departure board already used it. In the served publication at 23:20 UTC
  on 27 September, 12 of 19 matched buses named their journey; 7 reported a departure shared by
  journeys with different timings.
- **Timing evidence**: no provider predictions exist (BODS publishes positions; NextBuses is not
  subscribed); the arrival estimator has released nothing (`arrival-release.json` is empty on the
  server); the timetable clock is checked against buses for 2 of 576 patterns, and one of those —
  **inbound 15** — is known to run about 15 minutes ahead of its buses
  (`schedule-anchor.json`). So a connection can be timed from the timetable and shown with tracked
  positions, and nothing more.
- **Absent data**: the catalogue carries no boarding/alighting restrictions and no interchange
  accessibility; both are said to be unknown rather than inferred.

## 2. What was built

### The planner: one change (`lib/connections.ts`)
- **Candidates from straight lines only.** A first pattern boarded at the stop nearest the start
  that it calls at, among **every stop within 900 m** (not the 14 nearest: §6); every stop after it
  as a place to get off; every boarding point within 350 m of it in a straight line (a grid over the
  3,498 stops); every second pattern of another line calling there before a stop within 900 m of
  the destination. One option per pair of services; up to eight candidates, each timed, and the
  four soonest at the destination listed (below).
- **Refusals**, each one found on real data before it was written: two patterns of one line are
  never a change (a U-turn, or the same bus); a first bus that itself passes within 450 m of the
  destination is a direct journey, not a change (`lib/plan.ts` offers it); a second bus that passes
  within about 450 m of the start before the passenger would leave it is boarded there, not reached
  by another bus (Stretford Mall, the 245 one stop back to catch the 255, which calls at Stretford
  Mall); a pair whose walks add up to more than the straight line between the places is a detour.
  The two distance rules are measured stop by stop against the places themselves, not against the
  few candidate stops, which in the centre missed most of them (§6).
- **A leg is every bus between its two stops.** Each leg carries every other pattern running that
  day that calls at its boarding stop and later at its alighting stop — other lines, other variants
  of the same line, wherever they go on to — except the other leg's line (a U-turn), a first bus
  that goes on to within 450 m of where the second is left (a direct bus) and a second bus that
  passes within 450 m of where the first is boarded before the change (a loop). Timing, tracked
  buses, the words and a restored link all read the whole family, and options it makes identical
  are one: "Take the 263 (or the 255) towards Piccadilly Gardens"; "the 85 towards Chorlton Bus
  Station (or the 85A towards Wintermans Road)"; "the 41 towards Middleton Bus Station, Piccadilly
  Gardens or North Manchester General Hospital". A sibling whose timetable is known to mislead is
  left out of a leg rather than timed.
- **Restoring**: a chosen journey travels in the address as public identifiers
  (`plan=c:<pattern>|<stop>|<stop>|<pattern>|<stop>|<stop>`), and in this tab's store with the
  stage; it is rebuilt from the key against today's catalogue, with the same family of buses, and
  said to be gone if it no longer runs. Real data: 9–32 ms per plan (Piccadilly Gardens, with 159
  stops within 900 m, the slowest).

### The timing: the timetable, said to be the timetable
- **Suitability first.** Each leg's timetable is judged from `schedule-anchor.json`: *verified*
  (checked against its buses), *unverified* (never checked; said so under the times) or
  *unreliable* (checked and wrong). An unreliable leg gives **no times**, and the card says why —
  "schedule runs 15 min early against the bus’s own reports" — rather than a "Scheduled" label
  over the gap. Unverified is not unreliable, and is not treated as it.
- **The rows**: each first bus in the next three hours (else the next day's, said to be), when it
  is timetabled to reach the change, when the passenger could be at the second boarding point
  (arrival + walk + 2 min to change, 7 with *More time to change*), and the first second bus
  timetabled after that. A running time the file does not declare gives no arrival and no second
  bus, never a nearest. Midnight and both clock changes are handled by the boards' own instants.
  An earlier first bus that only waits longer for the same second bus is not another connection:
  it is folded into the later row, which names it ("→ 06:55 at Trafford Bar · or the 255 at 06:42,
  for the same 53"), so the rows show different arrivals rather than three ways to one bus.
- **The list is timed before anything is chosen.** Each candidate is timed from its two boarding
  points' boards (read once, cached) with the provisional walk, ordered by arrival at the
  destination — the second bus's arrival at its stop plus the walk from it — then by the later
  departure, and the four soonest listed, each with one line: "Next: 255 06:42 from Davyhulme Road
  East (nr) · at MediaCityUK 07:03 · by the timetable, not live". The order is taken once, when the
  boards arrive, and holds while the list is open; the times follow the clock.
- **On the first bus** the card gives the second bus's times from the change, from the soonest the
  passenger could walk there ("The next 53 from Trafford Bar (by), by the timetable: 06:56 → 07:03
  at MediaCityUK · 07:16 · 07:53"): which first bus they are on is not assumed. On the second bus
  there is nothing more to catch, and no times are shown.
- **The walk is provisional until checked.** The straight line, lengthened 1.3× for the streets,
  times the candidates; once chosen, the walk between the two boarding points is asked of
  routing.openstreetmap.de once (two public stop positions, nothing about the passenger) and the
  rows recompute. If the second bus the straight line allowed can no longer be reached, the card
  says so and names the next: "The walk between the stops is 12 min by a checked route, so the
  01:20 53 cannot be reached by the timetable; the next is the 01:33."
- **Tracked buses**: a bus is *on this journey* only where its operator reports that journey's own
  departure on that service day (one journey, or one shared timing). Otherwise a tracked bus of
  the line is said to be one, "which journey it is on is not identified"; with none, "no tracked
  bus … yet · that is not ‘no bus’". A tracked bus whose report names another journey of the leg is
  said to be that journey, by its own timetabled time at the stop: "A 255 is tracked 1 stop before
  Davyhulme Road East (nr) · the 06:19 by the timetable" — not left "unidentified" when it is known.
  Positions are last reports in stops and an age; the card never turns them into minutes or into
  "you’ll make it".

### The card, the map, the stages (`components/journey-card.tsx`, `city-map.tsx`, `follow-view.tsx`)
- **One card**: the steps in the order they happen — take the first bus (from where, get off
  where), walk to the second boarding point, take the second bus (get off where) — the next step
  marked *now*, done steps struck through; the timed rows with their basis on one line;
  **I’m on the first bus** / **I’ve changed buses** with a correction each; *Show whole journey* /
  *First bus* / *Next bus*; *Other journeys*; *Share*; *End*; and *Details* holding the technical
  account and the optional extra time.
- **The page's stop follows the stage**: the first boarding point (board filtered to the first
  bus), then the stop to get off at, then the second bus's alighting stop. So the everyday board,
  the walk guide and "buses coming" are about the stop the passenger needs next, and the page
  suggests the first bus coming exactly as it does at any stop. No vehicle has to be chosen; a tap
  on any bus still chooses it as before.
- **One map**: leg 1 solid, leg 2 dashed, each on its checked road between its two stops where one
  is accepted (the stops measured onto it) and stop to stop where none is, thinner; numbered discs
  "1" and "2" where each bus is boarded and smaller ones where it is left; the walk dotted like
  the passenger's own walk, a thin dashed straight line until the router has answered. Framed on
  request only: a report arriving never moves the frame.
- **Ride-along**: the ride's card keeps the other leg in one line ("Next bus: the 53 towards … ·
  53 at 08:27 by the timetable · a 53 is tracked, journey not identified") with **Focus on the
  next bus**, which rides that leg's bus and leaves the stage — where the passenger said they are —
  alone; with no tracked bus, **Show the next bus’s stop on the map**.
- **Kept**: the plan survives a reload, a look at another bus, the ride and back, and the walking
  hand-off (this tab's store); *New journey* and *End* clear it.
- **Beside a direct bus**, the journeys with one change are the second choice and fold away under
  one line, "Journeys with one change (4)", opened on request; with no direct bus they are the
  answer and stand open, after "No direct bus within a 900 m walk of both places today".

## 3. Real data

All on the served site (`scripts/probes/connection-served.mjs`, `outputs/connection/*.mjs`), phone
emulation, read-only, the server's own catalogue and boards.

- **The journey to try: Hillingdon Road (Stretford) → MediaCityUK.** No direct bus within 900 m
  of both places. At 06:55 on Monday 28 September, on this release's build with the server's own
  data (every `/data` file fetched from the served site, `outputs/connection/after2.mjs`, phone and
  desktop), the list leads with **the 263 (or the 255) towards Piccadilly Gardens** from Davyhulme
  Road East (nr) to Trafford Bar (opp), a walk to Trafford Bar (by), and **the 53** to MediaCityUK
  (at) — "Next: 255 06:42 from Davyhulme Road East (nr) · at MediaCityUK 07:03" — then the same
  change onto the 250 (its stop 680 m from MediaCityUK, so 07:06 there and a walk), then two by
  the city centre. Chosen, the router checked the walk between the two Trafford Bar stops at
  **3 min and 230 m** (50 m apart in a straight line, across the junction), so the 06:42 could no
  longer make the 06:56 by the timetable: the card's first row became the 263 at 06:46 → 06:55 at
  Trafford Bar (or the 255 at 06:42, for the same 53), the 53 at 07:16, at MediaCityUK 07:26, with
  the buses of both legs *tracked on this journey*. On the first bus the card gave the 53s from
  Trafford Bar (by): 06:56, 07:16, 07:53. No page errors at either size.
- **What the previous release did at the same hour** (served, 06:00, `outputs/probes/connection-served/day-0600`):
  the list led with the 253 from Sydney Street (nr), whose first connection was 07:55, at
  MediaCityUK 08:37, while 263s and 255s were running and the option under it reached MediaCityUK
  at 07:03: a newcomer choosing the first journey would have waited two hours. A 53 whose report
  named an earlier journey was called "which journey it is on is not identified". Everything else
  held: the stages moved the stop, a reload kept the journey at its stage, the frame stood still
  across publications and moved on each focus, no page errors. Those two, and the faults behind
  them (§6), are what the second half of this release corrects.
- **The same journey at night** (served, 03:35, the first release): four journeys, timed from the
  next day's first buses, the walk checked, the stages and a reload kept, no tracked bus at that
  hour and said so.
- **Served, on real morning buses** (`scripts/probes/connection-served.mjs`, phone emulation,
  `outputs/probes/connection-served/day-0830` on `ee3f4d0` and `day-0850` on `3c81756`): four journeys
  listed, each with its next connection; the card timed, the walk at Trafford Bar checked (3 min);
  a 263 tied to its journey on the first leg and a 53 on the second; a 255 on another journey named
  by its own time ("the 08:37 by the timetable"); the frame unchanged across publications and moved
  by each focus; on the first bus the 53s from Trafford Bar (09:08, 09:37, 10:06) and no walk note;
  on the second bus no times; a reload keeping the stage; **Ride along** on the 263 (YX74OKD, then
  YX74OJZ) with the next bus in view, and **Focus on the next bus** riding the 53 tied to its journey
  (27936, then 21432) without moving the stage; no page errors. The first of those walks found the
  list ranked on one clock and drawn on another, and the card naming a 255 already past the stop;
  the second walk, after the fix, found both right. The showcase capture at 08:56 then found the
  ride calling the second bus "Selected bus · does not serve your stop"; `e3c760b` reads "Your second
  bus · from Trafford Bar (by)" on the served site (§6).
- **A known timing-quality exclusion, real:** the inbound 15 from Hillingdon Road (opp) to
  Manchester Royal Infirmary (Stop D), then the 53 to MediaCityUK, opened by link
  (`outputs/connection/served-inbound15.png`). The card gives the steps and the stop, and "No
  times for the 15: schedule runs 15 min early against the bus’s own reports at its first stops. A
  time from this timetable would mislead, so none is shown; its stops and order still hold", with
  the official board for the stop below.
- **Outside the timetables held, real:** Hillingdon Road → Bolton Interchange gives "No bus journey
  found within a 900 m walk of both places on today’s timetable, direct or with one change. That is
  what our timetables hold (four operators), not proof that no journey exists", and the two
  external planners (`outputs/connection/served-outside.png`). Inside the stop area every one of the
  816 stops with no held pattern lies within 900 m of one that has, so a real destination inside
  it is never refused outright for coverage alone; the fixture covers that case.
- **Before:** the same journey on the previous release read "No direct bus found … Journeys with a
  change are not planned here" (`outputs/connection/before-planner.png`).

## 4. Fixtures, and what each failure case shows

`tests/browser/connection.spec.mjs` (desktop and phone), on a second FIXTURE line — the 53 along
Talbot Road from Talbot Court, 113 m from the 256's Thomas Street — with boards timed from the
moment the check starts and the router mocked:
- **A working scheduled connection**: the 256 at +4 min reaches Thomas Street at +7:03; ready at
  +10:53 with a 110 s walk and 2 min; the 53 at +9 is gone, the +17 is the one, "10 min to change";
  the moving 256, reporting that journey's departure, is "Tracked on this journey · N stops before
  Stretford Mall (Stop A)"; nothing on the 53 is claimed.
- **A transfer that fails after walking validation**: the router answers 900 m / 12 min; the +17 can
  no longer be reached, the card says so and names the +30 ("23 min to change"); *Other journeys*
  lists the alternative.
- **Missing second-bus tracking**: "No tracked bus on the 53 … yet · that is not ‘no bus’"; and with a
  53 tracked but unnamed, "A 53 is tracked 1 stop before … · which journey it is on is not identified".
- **Incomplete coverage**: a destination none of the held timetables reaches gives "No bus journey
  found … direct or with one change. That is what our timetables hold (four operators), not proof
  that no journey exists", with the external planners kept.
- **A known timing-quality exclusion**: the 256's clock marked 15 min early gives the journey with
  no times and the reason in view.
- Also: the stages move the stop and survive a reload and a look at another bus; the frame does
  not move across three publications; the ride keeps the other leg and switches focus without
  moving the stage.
- **The list's own times**: before anything is chosen the option reads "Next: 256 at +4 from
  Stretford Mall (Stop A) · at Trafford Bar" at the 53's timetabled arrival, "by the timetable, not
  live".
- **On the first bus** the card's times are the 53's from Talbot Court, three of them, the first at
  +9, and none of the first bus's rows; **on the second bus**, no times.
- **Beside a direct bus** (a fixture 99 from Stretford Mall straight to Trafford Bar): one direct
  option, and the journey with one change folded under "Journeys with one change (1)", hidden until
  opened, with its next time inside.

`tests/connections.test.mjs` (14) covers the planner's refusals, including the loop measured with
only the nearest stop a candidate (the deployed planner offered the loop there), the family of a leg
(a 9A and a short working of the 9 between the same two stops, a 9 that goes on to the destination
and a 7B that has passed the start refused), its restoration from a key, a tracked bus on a sibling
named by its own journey, folding an earlier first bus into the later row, ranking by arrival at the
destination including the last walk, the onward times on the first bus, leaving out a sibling on a
timetable known to mislead, the key, midnight and the next day, undeclared running times, the
walk's recalculation, the quality verdicts and the binding rule.

## 5. Verification

- Node 290 (14 connection tests, 4 of them new with the second half), typecheck, lint (no errors,
  the 16 warnings unchanged), the build.
- `connection.spec` 14 and `plan.spec` 8: 22 of 22 on the final build (7 and 4 checks × desktop and
  phone). Earlier: 12 of 12 on the first release.
- The full browser gate on the candidate `f27d6ea`, before two cosmetic edits (a doubled stop label
  on the map, *Share* on the card): **432 passed, 50 skipped by design, none failed, 1.4 h**. After
  the edits, the four specs they touch (connection, journey, attribution, map): 54 passed, 18
  skipped, none failed; after the card's tones were corrected (§6), `connection.spec` 12 of 12.
- Deployed as `f27d6ea`, then `d0ad985`, then `cbceb2e` (the roads line on the card); on `cbceb2e`
  `connection.spec` and `plan.spec` 20 passed, none failed, on both profiles. The served page chunk
  and stylesheet byte-identical to the local build's; `/preview/` still 401; no `photo3d` in the
  served config. CI green on all three.
- The served checks in §3.
- The second half: the full browser gate on `7d4862c`, **434 passed, 50 skipped by design, none
  failed, 1.4 h**. The changes after it, each with `connection.spec` and `plan.spec` 22 of 22 on its
  final build and each deployed: `bb563ea` (the walk note before boarding only), `3c81756` (one clock
  for the list, the last walk on each line, the coming bus before boarding), `e3c760b` (the journey's
  own buses named as such), with new checks in `connection.spec` for the walk note and the ride's
  header. Node 290, Python 144 (three new: the unreadable snapshot, the refused error page, the
  evaluation's departures), typecheck, lint (no errors, the 16 warnings unchanged).
- Deployed as `bb563ea`, `ee3f4d0` (the nightly fixes, §6, with the collector restarted cleanly for
  them), `3c81756` and `e3c760b`; each served build's scripts and stylesheet byte-identical to the
  local build's, `/preview/` 401, no `photo3d` in the served config, the previous release kept for
  `deploy/rollback.sh` (`3c81756` behind `e3c760b`).
- Emulation only; no real passenger has tried it; `docs/CONNECTION_WALKTHROUGH.md` is the test.

## 6. Found on the way

- A restore before the page clock's first tick judged "today" as 1970 and refused every journey as
  not running; the restore now waits for the clock.
- A road shape's `stopOffsets` skip the stops it could not place, so they cannot be read by the
  pattern's stop index; the legs measure their stops onto the road instead. `lib/arrival.ts` reads
  `track.stops[stopIndex]` the same way (backlog 38): withheld as "does not place your stop" where
  the index is off, never wrong, but worth a fix of its own.
- Fixture buses need an ISO instant as `aimedDeparture`, as the feed gives, or the evidence panel
  throws.
- The starting-point search lists "My location" first, so a probe that took the first option asked
  for the device's position and left the start empty; the probes pick the place by name.
- On the served site, at the stage "on the first bus", the card struck through the whole first step
  (including "get off at Trafford Bar") and marked two steps *now*; the ridden leg now reads "On the
  253 …" with getting off as the next action, and only a finished leg is struck through.

Found by the morning's real buses, after the first release (each reproduced from the served boards
before it was changed, `scripts/probes/connection-real.mjs`):
- **The timing read one pattern.** Each leg was timed from the one pattern the planner happened to
  pick. Brook's Bar → The Trafford Centre was offered on an 86 variant with **no** departures that
  morning, while the 86 itself called at the same two stops **24 times in four hours**: the card
  would have said no 86 for hours. Across five real journeys, most legs had siblings the timing
  missed (the 255 beside the 263, the 85A beside the 85, the 25 beside the 23). Now every bus
  between a leg's two stops is part of it (§2).
- **The same journey listed twice.** The 263 → 53 and the 255 → 53 from the same stops at the same
  change were two options, and a stop along (Sydney Street against Davyhulme Road East) for the
  same buses and change a third; now one.
- **The list's order was the planner's, not the clock's**, so the first option could be two hours
  out while the next ran now (§3). Options are now timed and ordered by arrival at the destination.
  Ordered first by arrival at the *stop*, a 250 whose stop is 680 m from MediaCityUK led; the walk
  from the last stop now counts.
- **Both planners searched the 14 nearest stops**, 130–460 m in practice (the 14th nearest to
  Piccadilly Gardens is 131 m away; 159 stops lie within 900 m), while the page said "within a 900 m
  walk". Hillingdon Road → Withington Community Hospital read "no direct bus", though the 23 leaves
  from Norwood Road (nr), 418 m away. In the direct planner this dates from 22 September. Both now
  search every stop within the walk; the direct 23 is found, and a 25 and a 250 on two other
  journeys.
- **The loop refusal leaned on the same few stops**, so in the centre it offered "ride one stop from
  Piccadilly Gardens (Stop R), walk 330 m back to Piccadilly Gardens (Stop H) for the 43". It is now
  measured against the start itself, up to where the passenger would get off.
- **A tracked bus on another journey was "unidentified"** though its report named it; it is now
  said to be that journey, by its time at the stop.
- On the way, from the frames: the folded note said "or the 06:42" under a 263 when the 06:42 was a
  255 (it now names the line), and the phone handle clipped "Your journey · 263/255 then 53" before
  its second bus (it keeps the short form).

Found by the served walks on real buses, after the second half was deployed:
- **Two clocks.** The list was ranked the moment its boards arrived and drawn on the page's
  15-second tick, so a 263 leaving in between was ranked gone and shown still to come: a journey
  reaching MediaCityUK at 09:16 sat above one whose line read 08:56 at John Gilbert Way. One clock
  now; and a line whose last stop is more than a short walk away says so ("then about 11 min on
  foot"), so two lines can be compared as they stand.
- **A bus already past the stop, named first.** Before boarding, the first leg's tracked line led
  with a 255 already past Davyhulme Road East, because buses already on a leg sort first (right on
  the bus, wrong at the stop). Before a leg is boarded the bus coming leads, and is the one offered
  to ride.
- **"Does not serve your stop"**, said by the ride of the passenger's own second bus, measured
  against the first boarding point the page was on. A bus on either leg is "Your first bus" or
  "Your second bus · from …" on the ride's card, its name and the handle.
- **The walk note beside the onward times.** On the first bus the note ("the 06:56 53 cannot be
  reached") sat beside onward times that could list that same 06:56, answering another question; it
  is said before boarding only.

Found on the server during the deploys, not by this feature (`ee3f4d0`; opportunity entry 68):
- **The nightly timetable rebuild failed** at 02:40 UTC on 28 September: BODS had answered a
  timetable download at 17:47 the evening before with its "Sorry, there is a problem with the
  service" page under HTTP 200, the collector stored it as a snapshot, and the rebuild, which opens
  every snapshot, stopped on it (`BadZipFile`), leaving the catalogue of the 27th in place (valid
  for the fortnight, so nothing shown was wrong). The collector now keeps a body that is not a zip
  apart (`timetables-rejected`, content-addressed, logged with status and hash); the reader skips
  and names an unreadable snapshot. On the server the fixed reader picks the four operator datasets
  and names the page as unreadable. The rebuild itself was not re-run by day (it pauses the
  collector for about four minutes); its next run is 02:41 UTC on 29 September.
- **The nightly arrival evaluation had failed on five nights**, 24 to 28 September: the stored
  departures became `[time, timing, rule]` on the 23rd and the evaluation unpacked pairs. It now
  reads by position, as the matcher does, and a night with nothing scored says so instead of
  failing on an empty median. Run locally on a copy of the warehouse, with its own passage audit:
  170,079 moments from 135 journeys, 3,963 passages, 2 min 34 s, still not released. Its next run is
  03:10 UTC on 29 September.
- **CI failed once on the records' push**: a Python test aged its fixture report from the module's
  import, leaving every earlier test fifteen seconds (45 s against the 60 s "fresh" limit); the
  evaluation's new test in the module before it used them up on CI's slower runner. The report is
  now aged from when the test runs, and passes twenty seconds after import; CI green on `35949cb`.

## 7. Limitations, plainly

- Times are the operators' timetables. Nothing says a change will be made, and 574 of 576
  patterns' clocks have never been checked against their buses; the card says so.
- Two changes are not planned. Journeys on the operators not held (114 observed services) are
  not found, and the card says that is not "no journey".
- Boarding and alighting restrictions and the accessibility of a change are not known.
- The transfer allowance (2 min, 7 with more time) is a chosen default, stated on the card, not a
  measurement.
- The list's times use the provisional walk; the walk is checked once a journey is chosen, and the
  card then says what changed. At Trafford Bar the straight 50 m was 230 m by the router, which moved
  the first connection from the 06:56 53 to the 07:16 (§3).
- Direct buses in the list carry no time and keep their order by walking and riding distance, so
  the wider search can put a school service first (the 734 before the 23 at Norwood Road). Backlog
  37a.
- A first bus that overshoots and a second that brings the passenger back (the 103 past Withington
  to Moor End, then the 43) is not refused; ranked by arrival it falls behind the direct buses and
  is folded away beside them. Backlog 37a.
- Watch both is not built (§8).

## 8. Watch both

Two simultaneous ride views were not built. What was measured instead, so the decision rests on a
number rather than an assumption: the built site itself in one frame riding a bus, then two such
frames side by side, each map reporting its own frame interval (`data-frame-ms`, the median of its
last 90 frames; `scripts/probes/two-maps.mjs`, SwiftShader on this machine).

| | one map | two maps, each |
|---|---|---|
| desktop 1280 × 900 | 18.7 ms | 38.5 and 38.3 ms |
| phone width 390 × 844, stacked | 16.7 ms | 33.2 and 32.9 ms |

A second full map halves the frame rate of both on this renderer, and on a phone each view would
also have half the screen. That is an upper bound for two full MapLibre maps, not a measurement of
any phone's GPU, which remains unmeasured. A cheaper second view (the fleet's drawn frames redrawn
on a canvas, as the view from above does) was not tried. The single map with the ride's focus
switch is what shipped; Watch both stays optional and unbuilt.

## 9. The showcase

A film of the journey on the served site, captured read-only on Monday 28 September at 08:56 BST
(`outputs/showcase/capture-journey.mjs`), composed with the first film's compositor
(`outputs/showcase/compose.mjs --spec outputs/showcase/journey-spec.json`) and verified as a player
sees it (`verify.mjs`): `outputs/showcase/final-journey/lost-minutes-connection.mp4`, 35.1 s,
1080 × 1920, H.264, 30 fps encoded from a capture of 14.6–22.1 frames a second, each frame held as long
as it was on screen (at most 0.26 s past its time), 19 frames checked against their composition
(34.1–43.1 dB), and 1× playback in step with the clock. Its caption, credits and alt text are in
`caption.txt` beside it; nothing was published. Outputs are not in Git.

The first capture showed two things fixed before the film was made again: City tilting about the
canvas left both legs out of frame until **Fit journey** (the capture now presses it, and the film
shows the tap), and the ride's header calling the second bus one that "does not serve your stop"
(§6).
