# Coverage: what Lost Minutes can say, and where it stops

Measured on **Thursday 17 September 2026**, with the counts refreshed on **Friday 18 September** against the catalogue published at
`2026-09-17T14:29:50Z` and a live publication of 587 vehicles taken the same afternoon.
Every figure here is reproducible: the in-product version of this audit is the coverage ledger
under **Behind the data → Operations**, computed in the browser from the same two published files.

Coverage is four different things. Rolled into one number they mislead, so they are kept apart
here and on screen.

| | What it means | Where it stands today |
|---|---|---|
| **Positions** | the bus's own reports reach the page | 587 vehicles in one publication; near-total inside the service area |
| **Timetable** | a registration valid today, with journeys today, in the reported direction | **109 of 159** observed services; **285 of 587** vehicles placed on a pattern |
| **Road geometry** | a road path through a pattern's stops, accepted against that pattern's own reports | **6 accepted shapes** on 3 routes; **4 of them run on a weekday** |
| **Estimated movement** | where a bus has probably got to since its last report | the same 4 patterns: **routes 15 and 250, both directions, Monday to Sunday** |
| **Walking directions** | a pedestrian route to the boarding point | anywhere OpenStreetMap has footways, on request only |

## 1. Observed vehicle positions

One collector reads the DfT Bus Open Data Service SIRI-VM feed about every 20 seconds for the
whole site. In the publication measured, **587 vehicles** were inside `core.SERVICE_AREA`.
Positions are the one thing that is nearly always available, and the page never withholds one
because the timetable could not explain it: an unplaced bus is still drawn where it reported,
with its age.

Limits: a bus that is not reporting is invisible, and that is not evidence it is not running.
Positions older than 15 minutes are withheld rather than drawn (`pipeline/freshness.py`).

## 2. Timetable and stop matching

**3,498 active bus stops** (NaPTAN ATCO area 180) with indicator, street and, where NaPTAN has
one, the direction of travel.

**Timetables: three TfGM TransXChange datasets** (BNML, BNSM, BNFM). The catalogue published on
17 September read 575 service files — every file whose declared validity touches the fortnight
from the build day — and rejected 538 that had already expired. It published **524 patterns
across 157 services**, selected from the 163 observed services for which a valid file is held.

Of 587 vehicles, **285 were placed** on a pattern. The 302 that were not, with the reason the
publisher recorded:

| Reason | Vehicles | What it means |
|---|---|---|
| `ambiguous_branch` | 139 | two or more branches fit the position equally well; every candidate is kept and none is claimed |
| `no_pattern_for_route` | 127 | no timetable is held for that operator-and-line at all |
| `loop_pattern` | 3 | the pattern calls at one stop twice, so a position is not a single point of progress |
| `no_pattern_for_direction_today` | 2 | the direction is in the timetable, but has no journeys on this day |
| `too_far_from_pattern` | 2 | more than the threshold from every stop on the route |
| `no_pattern_for_operator` | 1 | the line is held, for a different operator, so it is a different service |

`no_pattern_for_route` is one operator group, not a scatter: on 18 September **130 observed
services have no timetable here**, led by BNGN's 10, 37, 36, 8 and V1 (20,000–27,500 observations
each in the warehouse).

### The dataset that would close most of it — identified 18 September 2026

Looked up read-only through the BODS dataset API. Six TfGM timetable datasets list NOC `BNGN`;
**dataset 12769** is the one that carries its services:

| | |
|---|---|
| `https://data.bus-data.dft.gov.uk/timetable/dataset/12769/download/` | |
| Contents | **273 files, 100% BNGN**, 119 distinct line labels |
| Size | **4.4 MB** — well inside the collector's 40 MB limit |
| Effect on the snapshot rule | its dominant operator is BNGN, so it becomes a clean fourth group and cannot supersede the BNML or BNSM snapshots |
| Would cover | **36, 37 and V1** among the five largest gaps, plus about 116 other lines |
| Would **not** cover | **10 and 8**. They appear in that dataset as **`10B`** and **`8B`**, and the live feed reports the line as `10` and `8`. A route label is matched exactly, by design, so these would still be refused. Where their registrations live is not yet established |

### Imported 18 September 2026, and what it changed

Validated first: 273 files, **256 valid that day**, 100% BNGN, so it becomes a clean fourth snapshot
group and cannot supersede BNML or BNSM. It covered **9 of the 11 BNGN lines then reporting**.

| | Before | After |
|---|---|---|
| Timetable datasets read | BNFM, BNML, BNSM | **+ BNGN** |
| Services published | 157 | **175** |
| Patterns published | 524 | **576** |
| Observed services with no timetable | 130 | **114** |
| `patterns.json`, fetched once | 2.04 MB / 139 KB gz | **2.16 MB / 154 KB gz** |
| Nightly rebuild peak | 853 MB, 3 min 05 s | **845 MB, 3 min 55 s** |

Measured against a live publication the same night:

| | Before | After |
|---|---|---|
| `no_pattern_for_route` — no registration held at all | **48** | **21** |
| BNGN vehicles placed on a pattern | **0 of 27** | **11 of 26** |
| Matched, all operators | 86 of 218 (39%) | 93 of 197 (47%) |

**What it did not fix, and was never going to.**

* **Lines 10 and 8 are still refused.** The dataset registers them as **`10B`** and **`8B`**, and the
  feed reports `10` and `8`. A route label is matched exactly; treating them as the same service
  would be asserting an equivalence nothing here evidences. Where their registrations live is still
  not established.
* **Route 256 is unchanged.** It is a BNML service and this is a BNGN dataset; the four published
  256 patterns are the same four, still Sat–Sun, Sat, Fri–Sun and Mon–Thu school. The weekday gap
  traced above is untouched by this import, as expected.
* The counts above were taken late on a Friday evening, when fewer services run. The proportions are
  honest for that publication and are not a daytime figure.

`ambiguous_branch` at 139 is the honest cost of coverage: more patterns mean more paths that fit
a position equally well. It is a refusal, not an error.

## 3. Route 256 on a weekday: traced, and not what it looked like

The standing note said route 256 inbound was unmatched on weekdays and suggested the catalogue
had been built on a Sunday. **That hypothesis is wrong.** Traced from source:

* TfGM's BNML dataset holds **12 files for line 256**: 7 from the registration that expired on
  **29 August 2026**, and 5 from the one in force from **30 August 2026 to 19 July 2031**.
* The expired registration had a full **Monday–Friday** file (`…2390029`, 101 journeys, both
  directions).
* The registration **in force** has a Saturday file, a Sunday file, and three single-journey
  school files (`…2416004` and `…2416006`, Mon–Thu, outbound only; `…2416005`, Friday, outbound
  only). There is **no Monday-to-Friday inbound 256 in the data TfGM publishes for this
  operator**.

Rebuilding on a Thursday confirmed it: the four published 256 patterns run Sat–Sun, Sat, Fri–Sun
and Mon–Thu (outbound, school), and every weekday inbound 256 is refused.

This is an upstream registration gap, not a build-day artefact and not a bug here. What changed
in response:

* the refusal now says the true thing. `no_pattern_for_direction` ("not for the direction the
  operator reported") read as *this bus does not go that way*; a direction held for other days of
  the week now returns **`no_pattern_for_direction_today`**, whose words are "the timetable held
  for this route has journeys in this direction, but none on this day of the week, so which stops
  this bus calls at cannot be said";
* the bus is still shown, still followable, still ridden with. Only the stop-by-stop claim is
  withheld.

**For the beta:** use **route 15** for any demonstration or trial. It has both directions
Monday–Sunday, accepted road geometry in both directions, and estimated movement.

## 4. Checked road geometry and the street preview

A road shape is built by routing a bus through a pattern's stops (Valhalla, FOSSGIS) and is
**accepted only when at least 30 matched reports lie within 35 m of it at the 95th percentile**.

Nine were built; **six were accepted**, and their measured fit:

| Pattern | Reports checked | 95th-percentile offset | Runs today (Thu) |
|---|---|---|---|
| 15 inbound | 756 | 11.7 m | yes |
| 15 outbound | 752 | 13.8 m | yes |
| 250 inbound | 3,408 | 23.2 m | yes |
| 250 outbound | 3,393 | 20.9 m | yes |
| 256 inbound | 1,300 | 28.4 m | **no** (Sat–Sun) |
| 256 outbound | 1,578 | 11.3 m | **no** (Fri–Sun) |

The three rejected shapes were rejected for having too few matched reports to check against, not
for being wrong; the rule refuses to accept what it cannot test.

Every accepted shape's pattern id survived the 17 September rebuild unchanged, because a pattern
id is a hash of its stop sequence. That was checked, not assumed.

The **street preview** is offered only on these patterns. Everywhere else the button says why and
the ride stays outside.

## 5. Walking routing

A pedestrian route from the passenger to the boarding point, from an OSRM foot profile at
`routing.openstreetmap.de` (FOSSGIS e.V.), **asked for only when the passenger presses Locate
me**, and carrying only the position rounded to about 10 m and the stop's position. Coverage is
wherever OpenStreetMap has footway data, which is effectively all of Greater Manchester. It is a
free community service with no availability guarantee; with no route the page says why and any
straight-line distance is labelled as one.

## 6. How coverage stays current

Not by a one-time import.

* The **collector re-downloads the timetable datasets while it runs** and stores each distinct
  version by content hash (`pipeline/collect.py`, `collect_timetables`).
* The **nightly rebuild** (`lost-minutes-refresh.timer`, 03:40) rebuilds the pattern catalogue
  from whatever is newest, pausing collection for a few minutes because the warehouse has one
  writer.
* The build reads **only the newest snapshot of each dataset**. Reading all of them counted the
  same service twice — on 17 September, with a second BNML snapshot on disk, route 15's published
  journey count doubled from 280 to 560 without a single new journey existing — and would have
  kept alive registrations the operator had withdrawn.
* The build takes every file whose validity touches the **next fortnight**, so a registration
  starting in a few days is already published, marked not yet in force. Both the matcher and the
  page check a pattern's own `validFrom`/`validTo` against the day in question before using it,
  so nothing is claimed early.
* A refresh that would publish **less than half** of the catalogue already published is
  **refused**, leaving the last good file in place and exiting non-zero. A truncated download and
  a withdrawn service look identical from inside; the wrong reading would tell passengers their
  bus does not run. `--allow-shrink` is the deliberate override.
* Whatever is published carries its own `generatedAt`, so an old catalogue is visibly old.

Regression tests for the last three: `tests/test_timetable_catalogue.py`.

## 7. The supported beta scope, stated plainly

* **Buses only.** No Metrolink: no official source gives tram positions and TfGM's real-time
  portal is closed to new users.
* **Positions, for practically every bus in the area**, with an honest age, or withheld.
* **Timetable claims** — "coming to your stop", "N stops before yours" — for the 109 services in
  6 above that have a registration running today.
* **Estimated movement and the street preview** for **routes 15 and 250 on any day, and 256 at
  weekends**.
* **Arrival times are never predicted**, on any route.
