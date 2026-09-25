# 25 September 2026, night — every bus on the map, and the delay said straight

Two pieces of work in one evening, after the one-ride milestone (`docs/MILESTONE_2026-09-25_ONE_RIDE.md`)
was deployed as `a63006b`. First the owner asked two questions about that release — what the card's
delay measures, and whether a late report rewinds the bus — and each answer was measured, found a
defect, and fixed. Then, riding the deployed site from a bus link, the owner saw one bus on the whole map
and asked for all of them, moving and tappable: built as the fleet. Everything below is Chromium with
SwiftShader (desktop and phone emulation), Node, or offline replays of recorded publications; nothing was
checked on a phone in hand.

## 1. The two questions (`docs/RELEASE.md`, "what the card's delay measures")

Measured on every bus in both reels ridden as the page rides it (`scripts/evaluate-delay-rewind.mjs`:
335 and 810 bus-journeys, 11.7 million frames):

- **The figure is now less the moment the drawn place stands for**, so it includes the report's age.
  While moving: the figure 53/57/61 s and 47/51/54 s at the 10th/50th/90th percentile, the report 46
  and 40 s old at the median, the playback adding about 10 s. The record's "30–60 s behind the newest
  report" was wrong and is corrected everywhere it was said.
- **Defect:** while a bus waited at its newest report the figure followed the clock past that report,
  under the report's own age in 96–97% of waiting frames. Fixed: the moment drawn is capped at the newest
  report (0 frames now). The label says the two ages apart: *as it was about 45 s ago · report 18 s old*.
- **A rewind moves the clock, never the bus**: 307 and 669 rewinds; 0 frames back along the bus's own
  path. Looking for anything else that moves a bus against its facing found two faults, both fixed: a
  rebuilt path re-anchored on the wrong pass of a road used twice (a V2 eased 36 m back, a 21 48 m, with
  nothing said; now projected onto its own stretch: 19 → 13 eased corrections with a backward part, the
  largest 40.3 → 6.6 m), and a standing-goal rule that stepped a bus back up to 0.44 m. What remains is
  backlog 32 (the nose lagging round tight bends, small eased corrections, a 6 m hop at a path joint,
  reports that step back), with the 25 sprints and the heading lags kept explicitly open.
- **Clips at normal speed and 2×** of the 250 before and after, `outputs/probes/incident-43/`.

Verified: `tests/delay-and-rewind.test.mjs` (2 of 3 fail on `a63006b`), the wording tests restated,
46 + 82 targeted browser checks passed on that build (the label's readers, the drawing's specs).

## 2. The fleet: every bus on the map

**Before.** `mapBuses` in `components/follow-view.tsx` gave the map only the chosen route's buses (no
stop) or the stop's board; each other bus was a flat disc at its newest report, redrawn at every poll,
so it stood for twenty seconds and stepped. The owner's screenshot: a 216 chosen from a link, and no
other bus in the city centre at 21:40.

**Now** (`lib/fleet.ts`, `components/city-map.tsx`, `lib/map-overlay.ts`, `lib/bus-model.ts`):

- **Every bus in the publication is drawn, each from its own reports, by the same PLAYBACK the chosen
  bus uses.** `reconcileFleet` keeps a drawing per vehicle-journey across publications (rebuilding its
  history when its reports change, starting afresh on another journey, dropping what is no longer
  published); `stepFleet` steps the buses inside the map's bounds (a quarter's margin each side) at
  presentation time on the same clock and leaves the rest at their newest report. Ten ticks a second at
  map zooms, every frame from zoom 17. Nothing more is fetched; nothing is predicted; nothing is stored.
- **Tiers.** The buses coming to the stop, that may be, or last reported beside it (with no stop, the
  route being browsed) keep the stronger marker; every other bus is muted and a size smaller, scaled
  down further below zoom 13.5 so a city of buses reads as a city. Stale reports keep their grey. Route
  numbers: the passenger's own buses from 13.5, the rest from 14.5, giving way where they crowd.
- **A tap chooses any bus, without moving it.** `takeFromFleet`/`handToFleet` pass the `Visual` between
  the fleet and the chosen drawing, so the bus carries on from where it was drawn: measured 2.1, 5.3 and
  6.1 m between the fleet's last drawn place and the chosen drawing's first, which is the bus's own
  movement in the moment between (7 m/s). One desktop run chose the bus only after 28 s, before the tap
  was logged; the full gate and the focused re-run passed the check on both profiles since.
- **Roads and models.** From zoom 15 the checked roads of the buses in view are loaded, at most four at
  a time (each shape a few KB; the index is already loaded), and a bus is drawn down its road once its
  reports next change. From zoom 18 the nearest twelve other buses with a heading are 3D buses in a
  muted livery (`FLEET_LIVERY`; the lime bus stays the only lime thing), their flat markers stepping
  aside; the layer shows in the City view and the ride, so in the ride the buses passing are buses.
- **Said once.** The legend counts them (*234 buses*, on wide screens; on a phone the chip wrapped into the
  map's notices and is hidden, the count kept in the map's accessible name); the heading reads *Every bus reporting in the
  area, drawn from its own reports a little behind them, and how long ago it last reported. Tap one to
  follow it.*; the map's accessible name says the same; a mouse over a bus gives its route, destination
  and report age. Under reduced motion every bus stands at its newest report.
- **Diagnostics.** `data-fleet` (total, in view, moving, animating, modelled), `data-fleet-ms` (the
  tick's median cost), and `data-bus-points` now carries each drawn bus's position as well as its pixel.

**Measured.**
- Node (`tests/fleet.test.mjs`): a bus in view moves between its reports, never past the newest, never
  back, no step over 2 m in 100 ms; out of view it stands at its report and keeps no drawing; the chosen
  bus is left out; tiers and icons; a publication keeps drawings and starts a new journey afresh; models
  go to the nearest, bounded; 200 buses stepped in under 25 ms a tick.
- Chromium (`tests/browser/fleet.spec.mjs`, 12 checks on both profiles, 2 desktop-only): every bus on
  the map from a bus link (10 of 11 drawn, one chosen, the legend *11 buses*); buses in view moving 42 m
  in 6 s at 7–11 m/s between samples, never faster than a bus (a teleport would read hundreds of metres a
  second); the tap hand-over; the ride with grey 3D buses (2 and 1 modelled);
  124 fixture buses with 91 in view and 89 moving at a median tick of **0.6 ms**; reduced motion; the
  hover tip. Frames: `desktop-fleet-moving.png`, `desktop-ride-with-fleet.png`, `mobile-ride-with-fleet.png`.
- The served site (`7dd79be`): On the served site at 22:52–23:00 UTC (`outputs/probes/incident-43/served-fleet.mjs`, the live publication of 156–159 buses, emulation): at a city zoom (12.2) on a desktop **158 buses on the map, 109 in view, 79 drawn moving**, the fleet's tick 1.1 ms at the median and 1.6 at most; at a neighbourhood zoom (15.2) 29 in view, 16 moving, 0.5 ms; 59 of 80 buses tracked over 20 s moved more than 5 m, the largest movement between two samples a quarter of a second apart one or two pixels (28 m at 20 m a pixel), where a step to a newest report would be seven. On a phone at the city zoom 156 buses, 46 in view, 29 moving, 0.6 ms (the probe's zoom presses did not take on the phone, so only the city zoom was measured there). A grey bus tapped on the desktop (YN61BFV, a 143) became the chosen bus, its card reading *Off its checked road · as it was about 60 s ago · report 44 s old* — the new label, live. The served page chunk was identical to the local build's (`fb26e93d…`), `a63006b` kept for rollback. Try Ride-along's three offers at 22:55 UTC (a 143, a 250 and a 192), ridden 60 s each on the served site (`served-offers.mjs`): none lost its heading or was repositioned, each moving in 84–100% of samples with no step over 4 m between them, the camera turning at most 28° a second, the cards reading *Moving between its reports · as it was about 60 s ago · report 55 s old*, *Standing · as it was about 40 s ago · report 39 s old* and, for one drawn within a few seconds of its report, *Moving between its reports · latest 42 s ago*.

**Verified:** 258 Node tests; typecheck; lint with no errors; the full browser gate on the fleet build
**380 passed, 41 skipped by design, 3 failed in 1.2 hours**. The failures: (1) my own new movement check
judged a step in pixels at a wide zoom (5 m a pixel), and now measures metres from the drawn position over
the sample's real time; (2) the *N buses* legend chip wrapped the phone's legend into the failed-model
notice, now hidden on phones; (3) a sign tapped on the map did not change the stop once, on desktop — with
the tap logged it passed every re-run (4 of 4: no chooser, no bus chosen, the new stop shown), so the cause
is unknown and it stays open as intermittent. After the gate three small changes were made (the fleet
labels restyled on a theme switch, the tap diagnostic carrying positions, the phone chip), covered by
a focused run of the specs they touch: 111 passed, 17 skipped by design, none failed, 14.8 minutes, on the
deployed build. Emulation only.

## 3. Limits

- SwiftShader measures the JavaScript, not a phone's GPU: a hundred moving markers and their labels
  are re-tiled by MapLibre's worker ten times a second, and what that costs a phone's battery and frame
  rate is the first thing to check in hand.
- The other buses' small eased corrections are not said anywhere; only the chosen bus's card says its own.
- No trails, no route lines for the other buses; their roads are loaded for movement only.
- A bus out of view starts afresh when it comes into view: it appears at the moment shown, not where a
  drawing of it would have been, and its road is loaded only from zoom 15.
- Backlog 32 and the 25 sprints stand as recorded; nothing on a phone in hand.
