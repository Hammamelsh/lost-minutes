# Ride-along made legible, the jumps traced to their causes, and the stop answers "when?"

Begun 22 September 2026, evening. Three passenger problems were reported against the deployed
build `1214db6`, with two screenshots. Both screenshots were reproduced from retained evidence
before anything was changed, and every fault below was reproduced before it was fixed.

Unless a line says otherwise, everything here was measured in Chromium with SwiftShader on this
machine, at desktop (1280–1366 px) and phone (390 px) sizes. **No physical phone was used.**

---

## 1. The two reported moments, reproduced

The server keeps every position capture it has fetched. `pipeline/replay_publications.py` is new:
it loads those captures in the order they arrived and, after each one, assembles the live state
exactly as the collector assembles it — the same matcher, the same trails, the same freshness
policy — at that capture's own `ResponseTimestamp`. The result is the sequence of publications a
phone was actually served over a past window, rebuilt from the raw bytes.

**300 publications were rebuilt for 19:20–21:00 UTC on 22 September 2026** from 300 retained
captures, none corrupt, undated or malformed.

### Screenshot A — MF74NNL at Westwood Avenue (opp), `1800SJ01251`

What the retained reports say, vehicle by vehicle and timestamp by timestamp:

| leg | line | direction | journey | destination | first report | last report | reports |
|---|---|---|---|---|---|---|---|
| A1 | 15 | inbound | 1186 | Piccadilly Gardens | 19:26:40 | 20:06:49 | 122 |
| A2 | 256 | outbound | 1087 | Towns Gate | 20:07:19 | 20:44:48 | 114 |

**Working as intended, and verified against the reports rather than inferred from an identifier.**
The journey change is genuine: the line, the direction, the operator's journey reference *and* the
destination all changed, thirty seconds apart, with 114 further reports on the new leg. It is not
a relabelling. The pin was kept, nothing was substituted, and the ride paused. That is the design
working.

**Working as intended: the six-minute-old report is true.** The vehicle's last report was 20:44:48
and it then went quiet; the upstream feed repeats a vehicle's last position, and our publication
keeps it until the 900 s cut-off. At about 20:51 the page was correctly showing a report six
minutes old.

**Defect 1 — "Front view · checking" that never resolves.** From 20:37:05 the matcher published
`unresolved: too_far_from_pattern` for this bus: no pattern, and no candidate set. `frontState`
read "still loading" straight off `trackFor === null`, which is also true when there is no pattern
to load a road *for*, so the button said "checking" for ever while the reason underneath correctly
said the service had none. Two different conditions written as one test.

*Fixed:* "checking" now means something is actually being waited for, and waiting ends — after
8 seconds it becomes "could not load its road", with the reason. A bus the matcher could not place
gets its own state, "this bus is not placed", and its own sentence.

**Defect 2 — an old report that looks like a fresh one.** The age chip changed colour; nothing else
did. A vehicle gone quiet while the feed is perfectly well is now its own state: the card is marked,
and one line says "No report for 6 min — live positions are arriving normally, so it is this
vehicle that has gone quiet."

**Defect 3 — the journey change said three times.** The sticky strip, the card and the ride card
each carried a version of it. The card now leads with one sentence and two choices — **Follow the
new journey** or **Back to buses for my stop** — with the vehicle, the journey references and what
the drawing is doing behind **Details**. The ride card keeps one line and the same primary action.

**Noted, not fixed here:** on its first 256 publication the matcher placed this bus on
`BNML:256:outbound:cde495c44d`, whose destination is Stretford Mall, while the feed's own
destination was Towns Gate and `BNML:256:outbound:7d555419a1` is the Towns Gate pattern; from
20:37 it could not place it at all. Neither pattern has an accepted road, so nothing was drawn on
a wrong road, but the choice is worth tracing. Backlog 21.

### Screenshot B — BNSM 11907, route 25 inbound, journey 60

This journey was still running while the work was done, so **63 successive publications were
recorded live** from the deployed site (`scripts/probes/record-publications.mjs`), with our own
match objects in them, and the vehicle is in all 63.

**Working as intended, and the presentation is the problem.**
`BNSM:25:inbound:41a94b3cb0` has an accepted road shape — 95% of 8,918 matched reports within
10.3 m — so the front view is offered. Route 25 is not one of the patterns the frozen estimator was
scored on, so no prediction is released and the bus travels between its own reports. Both
statements are true, and set side by side they read as a contradiction.

*Fixed:* the five things that decide what a passenger sees are named and kept apart in the code
(`components/city-map.tsx`), and the one line that says what the ride will be before it is entered
is the only place they are read together: camera following, road and front view, travel between
reports, prediction, report freshness.

---

## 2. The movement: what actually jumps, and why

### The raw reports are not the problem

Measured on the retained captures for all three legs above: consecutive reports a **median 21–22 s**
apart, p95 27–29 s, maximum 36 s; the newest report moves a **median 86–97 m**, p95 236–266 m,
maximum 318 m. Every publication carried exactly one new report. **Nothing in these journeys would
defeat the travel-between-reports rule** (a gap over 400 m, or a span over 45 s).

So the jumps are ours.

### Three silent teleports in the code, reproduced against the model

A bus drawn at its reports travels to each new one. Three conditions refuse that travel, and until
this milestone all three returned the bus at its new report with `lastCorrection` untouched — so
the map drew no repositioning trace and the card said nothing. Reproduced directly against
`lib/motion.ts`:

| condition | the bus moved, in one frame | said anything? |
|---|---|---|
| no earlier report to travel from (an empty trail — every new journey's first publication) | **92.7 m** | no |
| a gap beyond 400 m | **864.8 m** | no |
| a span beyond 45 s of report time | **270.7 m** | no |

The estimated path had always reported its snaps. The observed path — most of the fleet, and both
reported cases — had no such treatment at all.

*Fixed:* each is a **repositioning** now. Over 25 m (below that it is scatter around a standing
bus) the page records a correction with the reason, the map draws the trace from where the bus was
to where it is, and the card says "Moved N m to its latest report · too far to have been followed
between reports" — or "there was no earlier report to travel from", or "too long passed between its
reports". The ground in between is not drawn, because it is not known.

### The dart: an estimate pulled back at 269 km/h

The visible jump on a service that *does* have prediction was not a teleport at all. When an
estimate has rolled on past a bus the reports now show standing, the drawn bus is eased back to the
report. That ease was timed at 25 ms a metre, so the bigger the mistake the faster the bus flew: a
110 m correction was taken back in 2.5 s, peaking at **3.74 m per 50 ms frame — 75 m/s, 269 km/h**.
The check that guarded it allowed 8 m a frame, so it passed.

*Fixed:* the ease is timed from a speed, not a budget — 100 ms a metre, about 10 m/s, the speed of
the bus itself, to a ceiling of 12 s. The same correction is now **under 1 m a frame**, and the
check says so.

**Measured on the page, on the same reels, before and after** (`scripts/probes/movement-replay.mjs`,
which plays a recorded run of publications back through the built site and records the map's own
diagnostics every frame it draws — about five samples a second, which is the rate the page writes
them at):

The honest measure is the *speed* the drawn bus moves at, because the diagnostics are written at
their own rate and a step read over a longer interval is bigger without being faster. A bus is a
bus: anything far above about 20 m/s is the drawing, not the traffic.

| case | fastest drawn movement | largest step | steps over 10 m |
|---|---|---|---|
| route 15, evaluated, map view — **before** | **59.2 m/s (213 km/h)** | 12.07 m | 4 |
| route 15, evaluated, map view — **after** | **21.6 m/s (78 km/h)** | 4.68 m | **0** |
| route 15, evaluated, ride-along — **before** | — | 13.42 m | 4 |
| route 15, evaluated, ride-along — **after** | 20.4 m/s (74 km/h) | 4.40 m | **0** |
| route 25, accepted road, no prediction — before | 21.8 m/s (78 km/h) | 4.67 m | 0 |
| route 25, accepted road, no prediction — after | 22.0 m/s (79 km/h) | 5.11 m | 0 |

Route 25 was already smooth and stays so; its steps are marginally longer because it now travels
down the road rather than across the chord, which is a longer way round at the same speed.

**One fault this measurement found in the fix itself.** The first road-following build ended each
travel *on the road* and then placed the bus at its report, which is near the road rather than on
it: measured at **5.46 m in one 48 ms frame — 115 m/s** on the route-25 journey and 165 m/s in the
ride, a small teleport at the end of every twenty seconds. The road now gives the *shape* of the
travel while each end's own offset from it is carried across, so the path leaves the drawn position
exactly and arrives at the report exactly. After that, no frame shorter than 120 ms moves the bus
at all, and the fastest drawn movement is 22.0 m/s.

### The invented path between two reports

Travel between two reports was a straight line, whatever road was known. Measured on one real
route-25 journey, 60 consecutive report pairs, against that pattern's own accepted shape: the chord
leaves the checked road by a **median 5.3 m, 28.5 m at the 95th percentile and 34.4 m at worst**,
and in 5 of 60 pairs by more than 15 m. At 34 m the drawn bus is a street away — through buildings.

*Fixed:* where both reports can be measured onto the same accepted road shape, in order along it,
and the road between them is close to the straight line between them, the bus **goes down that
road**. Where any of that fails it travels the chord as before, and the card says which it did.
Verified in a browser on the fixture road: 95% of drawn positions within **6 m** of the checked
road, none beyond 15 m.

### Where the drawing is *not* reset

The owner asked whether the drawing resets on publication, panel changes, resizing or capability
changes. Traced with the replay probe on real reels:

- **across publications:** no reset. Route 25, 13 publications over 236 s: median step 1.13 m,
  largest 4.67 m, no corrections.
- **a backgrounded tab:** the run that was meant to background the tab did not — headless Chromium
  kept drawing — so **this remains untested and is not claimed**. What the code does is stated:
  animation frames stop, polling stops, and on return a report too far or too old to travel to is
  repositioned and said, which is the treatment added above.
- **a genuine journey change:** the drawing *is* restarted, deliberately, and must be: the other
  journey's reports say nothing about where this one is going.

### What was preserved

Reduced motion is untouched: it governs the camera, not whether the bus is drawn between its
reports, and a bus that jumped instead would be worse for the same reader. **Added lag, measured**:
on 30 held-out journeys and 2,063 held-out reports, the drawn bus's error against where the bus next
reported is **p50 60.3 m before and after**, lag **p50 3.4 s, p80 16 s before and after**. The
slower ease-back costs nothing at the median because it only fires when an estimate is withdrawn;
where it does fire, the correction takes about 11 s instead of 2.5 s by construction, and the bus is
visibly being corrected for that long instead of darting.

---

## 3. "When is the next bus?" — the stop's own answer

`docs/DEPARTURE_DATA.md` has the research in full. In short:

- **TfGM's real-time portal is closed to new keys**, for every stop. Their own page says so.
- **BODS publishes positions, not stop departures.** It is what we already collect.
- **The Bee Network app's endpoints are undocumented and are not scraped.** The official board
  stays one tap away, labelled as the official one.
- **NextBuses, now operated by TransportAPI under agreement with Traveline, is the one practical
  source** of live bus departures for Manchester. Free tier 30 requests a day; Home plan £5 a month
  plus a £10 setup fee, both inclusive of VAT, for 300 a day; business plans above that. Its terms
  explicitly permit caching for any period and public display, with attribution. **No account was
  created, no key requested, and no charge incurred.** The decision is the owner's, and
  `docs/DEPARTURE_DATA.md` §2 states exactly what is needed from them.

**What shipped, with no provider and no cost:** a scheduled departure board at every boarding
point, from the operators' own registered timetables, which this project already parses.

`pipeline/patterns.py` now keeps *which operating profile each departure runs on*, so a board can be
asked for a particular day instead of only for a pattern. `pipeline/departures.py` publishes one
board per boarding point: **2,682 stops, 958,438 departures**, with the 200 distinct operating rules
they share in one file. It runs nightly on the server beside the catalogue rebuild and is excluded
from deploys, because it is the server's own.

What the board refuses rather than filling in:

- no declared running time at a stop publishes **no** time there, never a zero;
- a journey whose operating profile could not be read is listed and **marked** — dropping it would
  hide a bus that does run, and listing it silently would claim a day we cannot check;
- a pattern that *ends* at a stop is not a departure from it;
- a row names a tracked vehicle only where that vehicle reports **this journey's own origin
  departure time**, on this pattern, on this service day, with one journey at that time. A departure
  is never given the nearest bus, and a bus is never given a departure time it did not report.

Every row is labelled **Scheduled**, on the row itself rather than once at the top. Countdowns are
computed from real instants, not from clock-face arithmetic: `tests/departures.test.mjs` fixes the
behaviour at local midnight, on the morning the clocks go forward (a 23-hour day) and on the morning
they go back (a 25-hour day), and for journeys timed past midnight that still belong to the day they
set out on.

---

## 4. The rest of the confusion

- **One summary, not two.** The chosen bus had a sticky strip *and* the card's own head a few lines
  below it, carrying the same route, destination and status — which reads as two claims about one
  bus. They are one sticky card head now. It still sticks, so the bus stays in view while the board
  below is browsed, which is what the strip was for.
- **"Does not serve this stop" and "we cannot confirm" are different claims** and are now said
  differently, in the card and in the ride card alike.
- **Page zoom beyond 125%.** A browser's zoom shrinks the CSS viewport: 1366 × 768 at 150% is about
  911 × 512, at 200% about 683 × 384. New checks hold the workspace to no horizontal scrolling at
  either, with the stop, **Change**, the search and the departures all reachable and none of them
  squeezed to nothing, and the panel scrolling to its end. (The type is in pixels, so a browser's
  own larger-text setting still does nothing: backlog 19.)

---

## 5. Verification

**New checks, and what they are for**

- `tests/departures.test.mjs` (9): seconds from local midnight into real instants in GMT and BST;
  the morning the clocks go forward (a 23-hour day) and the morning they go back (a 25-hour day); a
  journey timed past midnight keeping its place; just after midnight, yesterday's late journeys
  still being the ones running; a departure already gone dropped with a minute of grace; a day the
  service does not run publishing nothing; a journey whose profile could not be read listed and
  marked; two journeys at one time never pinned to one vehicle; the origin departure carried, which
  is what a vehicle reports.
- `tests/browser/departures.spec.mjs` (5): the stop leads with what is timetabled to leave it, each
  row a scheduled claim with route, destination, time and countdown; the countdowns coming from the
  departures' own instants and in order; a stop with no published board saying so rather than
  pretending the timetable is empty; a departure listed with no bus on it, and no bus given a time
  it did not report.
- `tests/browser/ride-quality.spec.mjs` (2 new): a bus travelling between its reports goes down the
  checked road — 95% of drawn positions within 6 m of it, none beyond 15 m — and says which it did;
  a move too far to have been followed is repositioned and said, with the reason on the card and a
  `snap` recorded on the map, never a silent teleport.
- `tests/browser/layout.spec.mjs` (2 new): at 150% and 200% page zoom, no horizontal scrolling, and
  the stop, **Change**, the search and the departures all reachable, none squeezed to nothing, with
  the panel scrolling to its end.
- `tests/motion.test.mjs`, restated: the withdrawal check now asks its question *with* the reports
  to travel by, and separately asserts that without them the move is a reposition with a reason and
  no pretence of travel — it had been passing because it asked without the history. The ease-back
  check ran to 84 s and allowed 8 m a frame, which is how a 75 m/s correction passed; it runs to
  93 s and allows 1 m.
- `tests/browser/access.spec.mjs` and `selection.spec.mjs`, restated: the sticky strip's "Details"
  button is gone with the strip, so the keyboard route from the ride to the card is the ride card's
  own Details. `real-feed.spec.mjs` now checks there is exactly *one* summary of the chosen bus.
- `tests/test_matching.py`, restated: a pattern's departures now carry the operating rule of their
  own journey, by index into the pattern's rules.

**Run so far, and what is outstanding.** Node 211 of 211, Python 131 of 131, typecheck clean, lint
0 errors. Focused browser runs during the work: `departures.spec` 6 of 6, `ride-quality.spec` 12 of
12 (including the two new movement checks), `layout.spec` 9 of 9 (including the two zoom checks),
`board.spec`, `access.spec` 8 of 8, `motion.spec` 12 of 12, `ride-offer.spec` 5 of 5,
`selection.spec` and `journey-context.spec`.

**The full gate has not yet been completed on the final candidate.** A diagnostic run was stopped
at 101 of 348 on the night of 22–23 September with two failures, and both are open:

1. `journey.spec.mjs:100 › with location › a shared customer…` — the card no longer contained
   "May call at your stop (1 of 2 possible branches)", because the reworded "we cannot confirm"
   sentence had replaced `assoc.text` instead of following it. **Fixed in source; not yet re-run.**
2. `map.spec.mjs:130 › fallback › takes over when everything fails after the style loads` — the
   simple map's `svg[role="img"]` was not found within 25 s. **Not yet diagnosed.** It must be
   traced rather than re-run: it is either a real regression or contention from the probes that
   were running, and an isolated re-run would not tell the two apart.

Still to do before this milestone can be called done:
- rebuild, and run `pnpm test:browser` in full on the final candidate with nothing else running;
- the four movement recordings the brief asks for that have not been made: a bus with no usable
  geometry (BNML BU25YXM, route 150 inbound, is in all 63 publications of
  `data/evaluation/reel-live-evening.json`), the journey change as continuous playback
  (`reel-a-transition.json`), and `--disturb resize` and `--disturb panel` on route 25;
- deploy, then on the server install the updated `lost-minutes-refresh.service` and run it once so
  the catalogue is rebuilt with the new departure format **before** the boards are published — a
  board built from the old format marks every journey's day as unknown;
- verify the served build: RELEASE, the page chunk hash, `/data/departures/1800SJ01251.json`, and a
  walk of the passenger's journey at both widths.

*(gate result to be filled in on the deployed candidate)*

## 6. Limitations

- **Emulation only. No physical phone.** `docs/PHYSICAL_DEVICE_CHECKLIST.md` has the items only a
  phone in hand can answer.
- **A genuinely backgrounded tab was not tested.** The probe's attempt did not stop the page
  drawing, so no claim is made about what a real phone does on return.
- **The drawn bus is sampled at the rate the page writes its diagnostics**, about five times a
  second. That is ample to catch a teleport, which shows as one very large step, but it does not
  measure anything that happens inside 200 ms.
- **No live departure minutes.** Everything on the board is scheduled, and says so.
- **The scheduled board covers 2,682 boarding points**, which is the stops in the service area that
  a held timetable calls at. The 114 observed services with no timetable here have no board.
- **Bank-holiday operation is declared in the files and still not evaluated**, so a board on a bank
  holiday may list journeys that do not run.
