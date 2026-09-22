# 22 September 2026: a journey, not only a stop

Status words as in `PROJECT_CONTEXT.md`. Every browser figure is Chromium with software WebGL on
this laptop at desktop (1280 × 900) and phone (390 × 844) emulation; geolocation in tests is
`context.setGeolocation`, which is instant and exact and is not a phone's GPS; no physical phone.
"REAL" means the server's live publication and the real place providers through a local proxy.

## 1. What was found before anything was changed

- **"My displayed location stays the same after I move."** Reproduced from the code path, then in
  the browser: the page read the device's position once per press of Locate me
  (`getCurrentPosition`, `maximumAge: 0`) and never again — no `watchPosition` anywhere. One
  value held whichever start was last set, so a walk changed nothing until "Update my location"
  was pressed. Not a stale-fix or accuracy problem: a design that measured once.
- **The served search found stops only.** Typing a bus number (263) returned nothing; with a stop
  chosen the field disappeared behind "Change"; the walk guide sat above the board.
- **The Bee Network's per-stop live board has a stable address by ATCO code**
  (`tfgm.com/public-transport/bus/stops/1800SJ32251` → "Stretford, Kings Road / opp Hillingdon
  Road", route 15 "19 mins · Live"), verified by fetching it. Its journey planner
  (`tfgm.com/plan-a-journey`) takes no places in its address.
- **Provider facts, checked live on 21–22 September:** postcodes.io (free, MIT, no key, CORS `*`)
  answers `M32 8LZ` and partial postcodes; Photon by komoot (free public instance, "please be fair
  — extensive usage will be throttled", no availability guarantee, no key, CORS `*`, attribution
  to OpenStreetMap) answers addresses and landmarks with street, district, city and postcode, and
  supports typing as you go; NextBuses by TransportAPI covers Manchester with a **free tier of 30
  requests a day** and JSON departures (`/v3/uk/bus/stop/{atcocode}/live.json`, fields
  `aimed_departure_time`, `expected_departure_time`, `best_departure_estimate`, `source`); its
  pricing page 404s, and a journey-planning entitlement could not be verified from its docs
  page. No credentials exist on this project, so no request was made and nothing was bought.
- **Our own arrival estimate** is not released: the server's nightly scoring reads "released
  nothing" (inbound 15: median 1.57 min, 9 journeys; outbound: 0.93 min, 10 journeys; both short
  of 20 journeys and a held-out weekday). Its artefact `arrival-release.json` had been deleted by
  every deploy's `rsync --delete`; it is excluded now.

## 2. Research: adopted, adapted, rejected

Read and used (documented features, not interactions I tested): Transit's home ("nearby lines
with their next departure", a direction swipe, real-time marked with radio waves and scheduled
greyed, "Likely cancelled" when real-time is missing, a "Current location" field above the
destination, Leave now / Leave at / Arrive by), Citymapper's nearby mode "broken down by stop and
direction", TripView's saved trips first and "revert to the scheduled time, as per the timetable"
when live data is absent, W3C Geolocation (`watchPosition`, accuracy, timestamps). The Bee Network
store page and the MyTransport.SG PDF could not be read as text; nothing was taken from them.

- **Adopted:** one search for a bus number, a stop, a street or an area, with an exact number
  first; From above To, "My location" as an offered option never taken by itself; a fixed origin
  labelled "Starting point", never "You"; real-time and timetable told apart in words (here
  "tracked", "timetable", "live" with the official board a tap away); saved places first.
- **Adapted:** Transit's nearby list is stops around a point — the device, or the map's centre
  after a pan ("Find stops around here"), or a chosen starting point; a direct-bus planner from
  our own timetable rather than a routing engine.
- **Rejected:** any "likely cancelled" inference (a missing report is a missing report); a
  destination journey planner with changes (not supported here, said so, and handed off); a
  bottom sheet on the phone (evaluated: the sticky map with the panel scrolling under it already
  behaves as one; rebuilding it would have cost the milestone).

## 3. What changed

**Search and stops (increment 1).** "Bus number, stop or area" finds routes from the timetable
catalogue (exact number first, then numbers beginning with it), stops with their side of the
road, and stays in reach with a stop chosen. A route opens its directions (chips) and the chosen
direction's stops, each a stop to choose, and says how many buses on it are reporting now — with
none it still shows the timetable. Every boarding point is on the map from neighbourhood zooms as a
hollow ring (names from street zooms), tappable; the two sides of Hillingdon Road are two rings.
After a pan, "Find stops around here" lists the eight nearest the map's centre; "Back to my
location" returns. A route searched at a stop it serves filters the board, cleared in one press.

**The board (increment 2).** "When?" answered with what is true: tracked buses are placed by
their last report in stops and an age, never minutes; no arrival minutes until an evaluation
passes; the official live board for this very stop one tap away. The walk guide comes after the
board. Routes served by the stop count "tracked buses", not "buses".

**Location (increment 3).** Three things kept apart: the device's latest measured position, the
journey's starting point (the device, or a fixed place), and where the map is being browsed. With
"My location" the position is followed while the page is in front (`watchPosition`, high
accuracy) and a fix is taken up only when it moved more than half its accuracy radius (at least
15 m), got clearly better, or is over a minute old; the walking route re-requests only past its
jitter band (max(40 m, 2 × accuracy), capped 300 m) and interval. A fixed starting point is not
followed, and a late fix cannot overwrite it: the device is drawn beside it as You, the start as a
hollow ring labelled "Starting point". A position update never moves the camera: the frame goes to
an explicit choice of a start, not to a step. Hidden tab: the watch stops; visible again: it
restarts with a fresh fix. Denied permission: search, planning and browsing all work.

**Plan a journey (increment 4).** From (My location, a postcode, an address, a landmark, a stop,
or a point on the map) and To. Results are listed with what tells namesakes apart; nothing is
chosen until picked; a late answer to an earlier query is dropped. Direct buses from our catalogue:
one pattern valid and running on the day, boarding stop before alighting stop on it, both walks
under 900 m and shorter together than the straight line between the places (a detour is not a
journey). Each option: walk (straight line, labelled) → board the N towards X at Y → get off at Z
after n stops → walk; tracked buses before the boarding stop by stops away and report age; a
caution where the nearest bus is too close for the walk. No times are promised. Choosing an option
opens the boarding stop with the board filtered to that service and keeps a one-line plan. The
return is recomputed from the places. Hand-offs: Google Maps in transit mode with both places
(the documented `api=1` form), and the Bee Network planner (said to take no places). Sharing: a
text summary and a link carrying the destination and, only if fixed, the starting point — never
the device's position; the preview says exactly that; times are looked up afresh on opening.

**The standing bus (authorised fallback).** A bus whose last two reports lie within 8 m along its
road while its speed window still reads movement is no longer projected: it stands at its report
in observed mode ("its last reports show it standing") and estimation resumes at its first moving
report. An estimate that had rolled past eases back over a second or two (a correction under
150 m), and the card says "Moved N m · it had stopped" only for a real snap. Re-scored on both
held-out Mondays with the same evaluator: pull-backs over 35 m fall from 25–26% of corrections to
15–16%; abstention rises by 8–9 points (the standing moments); error on the remaining moments is
unchanged (62.0 / 58.5 m median). **The jump that remains, plainly:** when the bus moves off, its
first moving report is a whole interval of travel away, so forward corrections rise to 41–44% of
corrections and corrections over 150 m to 9.7–10.8% (from 8.8–10.3%); those snap, and are shown as
snaps. Nothing else in the model moved; no threshold moved.

## 4. Three problems the brief did not name

1. **The catalogue and the road shapes are built on different machines.** The server rebuilds
   its catalogue nightly from what it has observed; the shapes are built here and uploaded. After
   the 21 September refresh 30 catalogue patterns had no shape entry (16 before), and that number
   grows with every variant the server sees first. Front view coverage will drift down without a
   shape build where the catalogue is built. Evidence: `coverage-breakdown.mjs`
   `cataloguePatternsWithNoEntry`. Not done here; backlog.
2. **"Reports too far from the routed road" is now the largest geometry gap** — 121 vehicles on
   one publication, BNSM 192's main patterns 100–120 m off — which is either the router's road or
   the matcher's assignment, per line. Evidence: `shapes/index.json` reasons. A per-line trace,
   not a threshold change; backlog.
3. **Prediction covers 2% of the fleet because scoring is a manual, local act.** Route 263 was
   scored once and missed narrowly against the same-day corridor; every other route has never
   been scored. The server already re-scores arrivals nightly; the same unit could score movement
   per route on its own captures, and coverage would then be a measurement that keeps itself
   current. Backlog.

## 5. Verification and what is served

- **Focused batches while building** (each on a build with the change): `search.spec` 12,
  `board.spec` 2, `location.spec` 6, `plan.spec` 8, with `access`, `walking`, `empty-states`,
  `journey` and `journey-state` re-run beside them. Failures on the way and what each was: the
  search field's rename broke eleven files that named it by string (restated); a second
  "Show all services" I had added made a locator ambiguous (removed — the list already has one);
  my map-tap arithmetic used 256-px tiles (MapLibre's are 512); a route's directions keyed by
  compass word alone collided on a branch (keyed by destination too); a raw mouse click and a
  raw mouse drag do not reach MapLibre under touch emulation (a locator click; CDP touch
  events); a "camera not dragged" check read the camera mid-ease; an option for every pair of
  stops instead of one per service; Photon's place type dropped from a suburb's detail; and one
  real fault — "use my location" under an active watch never answered, fixed by answering from
  the watch. Nothing was loosened.
- **Node:** 202 pass (six new for the planner, the place providers read defensively, and the link
  reader with the empty address). **Python:** unchanged, 131.
- **The whole browser suite on the deployed commit 1724660: 289 passed, 24 skipped by design,
  1 failed** — `ride.spec` "front view: a 60 m correction is absorbed smoothly", the eye's
  fastest sampled speed 28.19 m/s against a 28 m/s bound under the suite's two-worker load; it
  passed four of four in isolation on both projects afterwards. Stated here rather than moved.
- **Deployed** by `deploy/publish.sh` as RELEASE 1724660 (previous release kept); the served page
  chunk `page-41ae466a86e5ce2f.js` is the local build's; the server's own catalogue (590 patterns)
  untouched by the deploy; a browser profile primed on the previous release took the new one on
  its first load (network-first page); live publications 20 s apart at 00:33 UTC (16 vehicles: the
  night service).
- **On the served site, REAL data and providers:** M32 8LZ → Piccadilly Gardens gives four direct
  options (255, 253, 263, 15) with boarding stops, walks and stop counts; choosing the 255 opens
  Stretford Mall (Stop A) filtered to it with the one-line plan; a chosen start survives an
  emulated 60 m move of the device, which is drawn as You beside it; "Use my device location"
  moves the start to the device within two seconds. A two-minute ride on a route-15 bus (seven
  publications) drew no snap. Frames: `outputs/probes/milestone/{audit (before), checkpoint1,
  checkpoint2, served-final}`.
- **Not verifiable here:** everything in the phone walk below; real GPS noise and accuracy
  bands; the providers' behaviour under load; Photon's throttling threshold.

**Not verifiable here, for the phone in hand (a ten-minute walk):**
1. Press "Buses near me" standing still; note the accuracy radius drawn and the first stop listed.
2. Walk 100 m along the street with the page in front: You should move within a few seconds of
   each real step of more than about 20 m, the list should re-sort, the camera should not move.
3. Stand still for two minutes: You should not wander (GPS noise is inside the band).
4. Lock the phone for a minute, unlock: the position should refresh once, not replay.
5. In "Plan a journey" set From to a friend's postcode and To to a place; walk 50 m: the Starting
   point must not move while You does.
6. Choose an option, open "Walking directions", come back: the plan and the stop must still be there.
7. Battery: note the level before step 2 and after ten minutes with the page in front.
