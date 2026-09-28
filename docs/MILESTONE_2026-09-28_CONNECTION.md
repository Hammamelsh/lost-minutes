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
- **Candidates from straight lines only.** A first pattern boarded at the origin stop nearest the
  start; every stop after it as a place to get off; every boarding point within 350 m of it in a
  straight line (a grid over the 3,498 stops); every second pattern of another line calling there
  before a stop within 900 m of the destination. One option per pair of services, best first, at
  most four.
- **Refusals**, each one found on real data before it was written: two patterns of one line are
  never a change (a U-turn, or the same bus); a first bus that itself passes within 450 m of the
  destination is a direct journey, not a change (`lib/plan.ts` offers it); a second bus that passes
  within about 450 m of the start is boarded there, not reached by another bus (Stretford Mall,
  the 245 one stop back to catch the 255, which calls at Stretford Mall); a pair whose walks add up
  to more than the straight line between the places is a detour. Two second buses of one operator
  to one destination between the same stops are one instruction — "take the 25 (or the 23)" — and
  timed as whichever leaves first.
- **Restoring**: a chosen journey travels in the address as public identifiers
  (`plan=c:<pattern>|<stop>|<stop>|<pattern>|<stop>|<stop>`), and in this tab's store with the
  stage; it is rebuilt from the key against today's catalogue, and said to be gone if it no longer
  runs. Real data: 9–15 ms per plan.

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
- **The walk is provisional until checked.** The straight line, lengthened 1.3× for the streets,
  times the candidates; once chosen, the walk between the two boarding points is asked of
  routing.openstreetmap.de once (two public stop positions, nothing about the passenger) and the
  rows recompute. If the second bus the straight line allowed can no longer be reached, the card
  says so and names the next: "The walk between the stops is 12 min by a checked route, so the
  01:20 53 cannot be reached by the timetable; the next is the 01:33."
- **Tracked buses**: a bus is *on this journey* only where its operator reports that journey's own
  departure on that service day (one journey, or one shared timing). Otherwise a tracked bus of
  the line is said to be one, "which journey it is on is not identified"; with none, "no tracked
  bus … yet · that is not ‘no bus’". Positions are last reports in stops and an age; the card never
  turns them into minutes or into "you’ll make it".

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

## 3. Real data

*[filled after the daytime check on the served site]*

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

`tests/connections.test.mjs` (10) covers the planner's refusals, the merge, the key, the timing
across midnight and into the next day, undeclared running times, the walk's recalculation, the
quality verdicts and the binding rule.

## 5. Verification

*[filled: Node, lint, typecheck, the full browser gate on the candidate, the served checks]*

## 6. Found on the way

- A restore before the page clock's first tick judged "today" as 1970 and refused every journey as
  not running; the restore now waits for the clock.
- A road shape's `stopOffsets` skip the stops it could not place, so they cannot be read by the
  pattern's stop index; the legs measure their stops onto the road instead. `lib/arrival.ts` reads
  `track.stops[stopIndex]` the same way (backlog 38): withheld as "does not place your stop" where
  the index is off, never wrong, but worth a fix of its own.
- Fixture buses need an ISO instant as `aimedDeparture`, as the feed gives, or the evidence panel
  throws.

## 7. Limitations, plainly

- Times are the operators' timetables. Nothing says a change will be made, and 574 of 576
  patterns' clocks have never been checked against their buses; the card says so.
- Two changes are not planned. Journeys on the operators not held (114 observed services) are
  not found, and the card says that is not "no journey".
- Boarding and alighting restrictions and the accessibility of a change are not known.
- The transfer allowance (2 min, 7 with more time) is a chosen default, stated on the card, not a
  measurement.
- Watch both is not built (§8).

## 8. Watch both

*[filled: what was tried, measured, and decided]*
