# 28–29 September 2026: the inbound-15 correction carried through, the stop mapping made explicit, the arrival evaluation frozen on what a page shows

The owner accepted the no-go of 28 September and kept arrival predictions disabled in both directions.
They asked for a bounded follow-up:
1. withdraw the inbound-15 timetable discrepancy wherever it stood as a current finding, keeping the
   history with a correction;
2. trace every consumer of the positional stop mapping, and replace it with an explicit, versioned
   mapping that handles clipped routes and repeated stops, cannot be mixed silently with old files, and is
   checked independently on the real inbound-15 case;
3. correct the uncertainty display, freeze an evaluation protocol on the exact conditions a page shows an
   estimate under, keep untouched data apart, and report inbound separately without approving it;
4. verify the next scheduled rebuild and evaluation, address the rebuild's memory headroom with a measured,
   bounded solution, and propose how the evaluation stops growing.

**Nothing was enabled.** `deploy/arrival-release-approval.json` approves nothing, in either direction.

## 1. The inbound-15 finding, withdrawn where it stood as current

"Inbound 15's timetable runs 15–17 minutes early against its buses" (20 September) was this project's own
fault: the road's stop offsets were paired with the pattern's stops by list position, 14 out on inbound 15
(section 2). Paired correctly, its first observed stops read +2.6 min on 21–27 September, as outbound's do.

Each place that stated it as a finding now carries a dated correction beside the original text:
- the release notes' 20 September sections, including the "traced end to end" account of MF74NNG. Its 22
  minutes without reports were the bus outside the area we collect, and it reappeared about 6 minutes late
  against the timetable at that stop, not 16;
- the project context;
- the reliability and connection records;
- the opportunity log's entry 31;
- the comments in `lib/connections.ts`, `lib/scheduled.ts`, `lib/arrival.ts`, `scripts/evaluate-arrival.py`
  and `scripts/schedule-anchor.py`.

**The TfGM drafts** (`docs/TFGM_APPROACH.md`) held no inbound-15 question. The 20 September record had
pointed there to settle the discrepancy, so the drafts now say plainly that it must not be raised.

**On the page**, since the deploy of `cd14ab3`:
- no reason text says "15 min early";
- inbound 15's timetabled time at stops is withheld as every unchecked service's is;
- both planners time it from the timetable and say it is unchecked.

Checked on the served site before and after that deploy (`scripts/probes/arrival-pilot-served.mjs`).

**Found on the way:**
- "Hillingdon Road (opp) at 8,715 m" in the shared-road comment and test was the positional reading; the stop
  is at 5,495 m. The behaviour was right, since the stop lies in the shared run either way.
- The reserved-set figure "At Hillingdon Road (opp), 43 moments" was about a stop 14 places on.

## 2. Every consumer traced; the stop mapping made explicit and versioned

`docs/STOP_MAPPING.md` has the whole trace, consumer by consumer.

**Only two consumers paired a road's offsets with stops by list position:**
- the passage inference, and through it the arrival evaluation, the schedule anchor and the parity cases;
- the page's arrival estimate.

**The anchor's verdict then reached** the timetabled line at stops and both planners.

**Unaffected, each checked in the code:**
- the drawing's pauses at stops, which use positions only;
- stop progress, upcoming-stop labels and scheduled times, which use the matcher's `patternIndex`, numbered in
  the full stop list before coordinates are consulted;
- shared road and every route drawn on the map, which are geometry only;
- shape acceptance.

Of the 560 published shapes, 284 would have been misread by position:

| Shapes misread | Layout |
|---|---|
| 174 | start outside the area |
| 110 | leave and re-enter it |

**Version 2** (`pipeline/stop_mapping.py`, `lib/stop-mapping.ts`):
- each shape names every stop it was built through as an occurrence: its index in the pattern's full list,
  its code and its offset;
- a stop called twice has two occurrences, as on BNSM 56's six-stop loop;
- a clipped route simply has none for the stops outside, as on BNFM 708's gap.

**A reader refuses a mapping** unless its version, pattern, stop count and every stop code agree.

**Old and new cannot be combined silently:**
- a shape without a mapping is refused;
- passage files and nightly entries carry the version, and the evaluator and the release check refuse or skip
  anything without it;
- old pages read the unchanged `stopOffsets` positions exactly as before.

**The migration.** The 560 shapes were mapped from their build's own stored routing requests, 1,977 of them
kept by SHA-256. A build since then records its mapping as it routes.

Each mapped stop was then checked against geometry it did not come from: its published coordinates against
the road at its offset. All 15,960 lie within 15.7 m (median 6.5 m). Read by position instead, the 284
affected shapes' worst stop was a median 1,047 m away.

Re-running the evaluation on the server's copy with the mapping gave identical passages and identical
results on all 8 days. Every shape file changed only by the two added keys. The shape index grew 278 bytes
compressed, and a shape file about 400 bytes, fetched one bus at a time.

**The real inbound-15 case, checked independently:**
- Hillingdon Road (opp), pattern stop 30, maps to 5,495 m;
- its own coordinates project to 5,501 m, 5.6 m from the road;
- the positional reading, 8,715 m, is over a kilometre from the stop.

Held by `tests/test_stop_mapping.py` (8) and `tests/stop-mapping.test.mjs` (6).

## 3. The uncertainty display corrected; the evaluation frozen on what a page shows

**The display.** The ±2.48 min range, the 80th-percentile absolute error, was never a validated interval
and is withdrawn. A page now shows minutes only from a scope carrying the protocol's own interval:
- the direction's 10th to 90th percentile of signed error, frozen on the revision days;
- each end rounded outwards, so the range shown is never narrower than the one validated, and never below 1;
- a scope without such an interval releases nothing.

Held by `tests/arrival.test.mjs` and `tests/browser/arrival.spec.mjs`.

**The protocol** (`docs/ARRIVAL_DISPLAY_PROTOCOL.md`, `pipeline/arrival_display.py`) was frozen and pushed at
19:28 UTC on 28 September (`fd87d22`), before the first confirmation day had begun:
- **When a page holds a report:** from the first publication after its retrieval plus the page's mean poll
  wait (measured: publications 20.0 s apart, 12.7 s from retrieval to the first), until the next is held or
  the report is 150 s old.
- **A display moment** is each 5-second tick of the page's clock at which it would show minutes:
  - one pattern, by the live matcher;
  - the report's nearest stop before the passenger's;
  - the report on the road, before the stop;
  - 2–10 predicted minutes from that tick.
- **Measured:** signed errors, coverage against every moment the bus is truly 2–10 min away, interval
  coverage, and results by journey with journey-resampled 95% intervals.
- **Thresholds unchanged.** No band narrower than 2–10 min may be chosen.
- **Revision data:** every day to 28 September.
- **Confirmation:** 29 September to 5 October, read once.

**Revision results under the protocol (21–26 September: decide nothing):**

| | outbound 15 | inbound 15 |
|---|---|---|
| median, p80 absolute error | 1.70 (95% 1.60–1.80), 4.00 (3.70–4.30) | 1.65 (1.50–1.85), 3.25 (3.00–3.60) |
| coverage | 84.8% | **2.1%** |
| signed median; later than estimated | +1.40; 72.8% | +0.95; 64.3% |
| journeys, passages | 252, 10,829 | 249, 2,412 |

**Corrected conclusions:**
- Neither direction meets the thresholds on the moments a page would show.
- Outbound's error on those moments is larger than the report-time reading of 28 September (1.57, 3.79),
  because a page shows reports some seconds old.
- The estimate runs early.
- Inbound, reported separately: its evaluation of 28 September at report time (1.10, 2.19) does not survive
  the page's own conditions. On weekdays its buses sit on an unsettled branch between its two variants, so
  a page would almost never show them minutes. It is not approved.

**Collected without enabling anything.** The nightly unit now scores each new complete day under the
protocol, and the release check reports the confirmation as collecting until the window is complete.

**A finding: the DuckDB extension corrupts memory here.** The scoring failed at random in 4 of 17 runs
with DuckDB loaded in the same process: objects swapped between frames, a builtin not found, a
segmentation fault. That held even with the connection closed first. With DuckDB never loaded, it
succeeded in 12 of 12, identical every time.

So the evaluation runs in two processes: `scripts/extract-arrival-inputs.py` reads the warehouse, and
`scripts/evaluate-arrival-display.py` scores behind a guard that stops any use of DuckDB (backlog 43).

## 4. The scheduled jobs, the rebuild's memory, the evaluation's growth

**The rebuild's headroom, measured on the server's own inputs** (resident memory, sampled every 0.1 s by
phase). The peak was not the timetables. It was DuckDB's buffer pool, filled to its 1 GB limit by the scan
of every observation for the services seen, and held through the build.

| DuckDB limit | resident peak | time | catalogue |
|---|---|---|---|
| 1 GB (as deployed) | 1,107–1,117 MB | 52 s | reference |
| **512 MB (now)** | **654 MB** | 47 s | byte-identical |
| 384 MB | 501 MB | 48 s | byte-identical |

The allocator's arena cap made no difference (1,107 against 1,117 MB). The production memory limit is
unchanged at 1500M.

**Operations now shows what can kill a job.** Each step records its own resident peak
(`python -m pipeline.jobs step`), shown first, with the unit's total beside it. That total includes page
cache, which reading or copying the warehouse (1.15 GB on 28 September) fills towards the ceiling whatever the
job needs: the scheduled rebuild of 29 September reached it exactly, at 599 MB resident.

**The evaluation's growth, solved rather than proposed:**
- a day is scored once, and a night costs the new days;
- the extraction looks back at most 14 days, and the server's anchor reads a 14-day window;
- the old re-scoring of every day held (684.5M on 8 days, heading for the ceiling in about six weeks) is gone
  from the nightly unit;
- the evidence a release needs is every confirmation day's per-journey histograms, kept in full.

**What still grows with the history kept is the snapshot the evaluation reads.**
- The nightly rebuild copies the whole warehouse while collection is paused for it: 1.15 GB on 28 September.
  The unit's comment still said "0.16 s to copy 50 MB".
- The rebuild's whole pause was 4 min 10 s to 4 min 29 s on 25–27 September, most of it the rebuild itself.
- The copy is now timed as a step like the others, and every step records its duration beside its resident
  peak, so that growth will be seen night by night.
- If it becomes material, the next step is to copy only the evaluation's 14-day window rather than the whole
  file. No raw history is deleted either way, and the memory ceilings are unchanged.

**The scheduled runs of 29 September**, the first under the new units.

*The timetable rebuild* ran on its timer from 02:44:25 to 02:47:01 UTC, on `af9a959`'s code and units, and
**succeeded**:
- **Its failure mode.** It met one unreadable stored response (`c98663e4…bin.gz`, which is likely the BODS error
  page that stopped the rebuild of 28 September), skipped it, and read all 4 datasets (664 files). None was
  refused as shrunk; 587 patterns on 184 services were published.
- **The public-use flag.** Every one of the 587 patterns carries `publicUse`, and one service is closed: BNML
  732, 2 patterns.
- **The closed service.** On 29 September its 4 trips along its own stops are offered by no planner, and would
  all be offered were it declared open (`scripts/probes/closed-served.mjs`, on the served catalogue).
- **Memory.**
  - 599 MB resident at its peak, in the timetable build, of the 1,500 MB ceiling (40%). By hand on 28
    September at the same DuckDB limit it was 654 MB; the last scheduled success before, on 27 September,
    showed 1.4 GB for the unit's total.
  - The unit's own total, page cache included, reached the ceiling itself (1,500 MB) as the warehouse was
    copied. That is page cache the kernel reclaims, which is why Operations leads with the resident figure;
    nothing was killed.
- **Its steps, timed for the first time:** the timetable build 142.3 s, the departure boards 6.8 s, the status
  1.1 s, the warehouse copy (1.15 GB) 2.3 s.
- **The collection pause:** 2 min 33 s (02:44:28 to 02:47:01), against 4 min 10 s to 4 min 29 s on 25–27
  September.
- **In Operations**, as a person reads it at both sizes: "599 MB resident of its 1,500 MB ceiling (40%) · last
  attempt; the unit's total, page cache included: 1,500 MB".

*The arrival evaluation* ran on its timer from 03:12:02 to 03:13:06 UTC (1 min 4 s), on the two-process pipeline,
and **succeeded**:
- **What it scored.** It extracted the two complete days not yet scored, 27 and 28 September, from the copy the
  rebuild had just made, and scored them as revision days, which decide nothing. The nightly file holds 16
  days.
- **Memory.** 418 MB resident at its peak, in the passage audit, of the 1,500 MB ceiling (28%); the unit's
  total was 598 MB.
- **Its steps:** extraction 2.0 s, scoring 21.3 s (DuckDB never loaded), passage audit 35.6 s, schedule anchor
  2.2 s, release check 1.8 s.
- **The verdict:** collecting, 0 of 7 confirmation days. Nothing is released, and nothing awaits approval.
- **The revision summaries**, now 20–28 September, six weekdays:

  | | outbound | inbound |
  |---|---|---|
  | median, p80 | 1.65, 3.90 | 1.10, 2.10 |
  | coverage | 85% | 7% |
  | journeys, passages | 321, 13,773 | 318, 3,801 |

  Two Sundays are now among them. On a Sunday inbound's Monday-to-Saturday short working does not run, so a
  page could show minutes: 27 September alone gave 62,215 inbound display moments, against 5,756 on the Monday
  after. That moves inbound's error, not its coverage.
- **Next:** the first confirmation day, 29 September, is scored by the run of 30 September.

## 5. Smoothness and ease of use, checked rather than assumed

During this pass the owner asked for no lag, no issues, and the page kept smooth and easy to use.

**Nothing in it changed the drawing:**
- `lib/motion.ts`, `lib/fleet.ts` and the playback are unchanged since `cd14ab3`;
- `lib/motion-view.ts` only passes the shape's stop mapping along;
- `components/follow-view.tsx` only wires the estimate, which shows nothing without a released scope;
- the map's only change is the one below.

**The served site before and after the deploy of `a5e43cc`** (REAL data, Chromium phone emulation,
`outputs/probes/smoothness/served-timings.mjs`):
- the fleet's tick: 0.2 ms at the median before; 0.2–1.1 ms after, 0.5 ms with 37–38 buses in view at Piccadilly
  Gardens;
- the ride's frame interval: 21.8–23.1 ms before, 20.1–21.8 ms after;
- these are a software renderer's figures and bound nothing on a phone. They say the drawing costs what it did.

**Found and fixed: a shared bus link sometimes said "Drawing the map…" for 24 s over a drawn map** (backlog 44).
- **The fault.** Of 21 loads of one route-42 bus link, 6 counted the map as painted only at the 25 s fallback,
  while a pill said the detailed map was slow and offered the simple map. Stop links were not affected.
- **The cause.** The map counted as drawn only at MapLibre's first `idle`. That also waits on every bus source
  and label fade, and the fleet updates many times a second.
- **The fix.** The map now also counts as drawn at the first rendered frame at which all of these hold:
  - the page's first framing has been made;
  - the camera is at rest;
  - the basemap's tiles for that view are in.
- **A first version was wrong, and the browser gate caught it.** It counted the opening city view, before
  the stop was framed. Two fleet checks read a camera still on its way and failed, and on a slow network it
  would have withdrawn the simple-map offer while the stop's tiles were still coming. That gate was stopped
  at 74 passed and 2 failed.
- **Measured on the refined rule.** Real data, two live bus links, 25 loads each way
  (`outputs/probes/smoothness/paint-compare.mjs`):

  | build | not drawn within 20 s | drawn in |
  |---|---|---|
  | served build | 3 of 25 | 2.1–2.8 s otherwise |
  | this build, fed the served site's own data | 0 of 25 | 1.2–2.1 s |

  In the fixture with 120 moving buses it is drawn in 2.3–2.4 s, against 3.0–3.2 s at the first `idle`
  (`tests/browser/paint.spec.mjs`).
- **On the served site after the deploy of `af9a959`** (00:30 UTC, only 14 buses reporting): 20 bus-link loads,
  on a 43 and a 142, were drawn in 2.0–4.0 s. None was stuck, and the note was never up at 5 s. So few buses
  cannot reproduce the busy case, which is why the comparison above was made at 22:30 UTC with 172. **A
  daytime recount on the served site is still to do.**

**Found by the gate, fixed: the front view's entrance stepped about 8–9 m.**
- **What the gate caught.** The front-view check ("a report 60 m further on … never as a jump") failed on the
  phone profile at 31 m/s. What it guards held: past the report 60 m on, the camera never went faster than
  13.6 m/s. The spike was its very first sample after the switch into the front view.
- **Traced in the page.** The glide into the front view was led by an estimate's speed. Since 25 September
  the ride draws every bus from its reports, so the lead was always zero. The glide ended where the bus had
  been as it began, and the first frame after it placed the camera where the bus now was.
- **Measured in the page itself** (`data-front-handover`), since on desktop the step falls in the same frame
  as the glide's end:

  | | before | after |
  |---|---|---|
  | desktop | 7.96–9.01 m | 0.44–0.59 m |
  | phone | 9.00–9.30 m | 0.67–0.82 m |

  A bus drawn at 7 m/s: before, three runs a profile; after, five (three, the focused run and the gate).
- **The fix.** The glide is led by the drawn bus's own speed, which changes gradually by design.
- **Held by** `tests/browser/ride.spec.mjs` ("the glide into it hands over to the frames after it without a
  step"). It failed 6 of 6 before the fix and passes 6 of 6 after, and every front-view and head-turn check
  passes (24, 2 skipped).
- **Not affected:** the outside view already eases its catch-up over 280 ms.
- **On the served site after the deploy of `e86b401`** (02:05–02:08 UTC, REAL data, night buses 142, 43 and 103,
  eight entries into the front view): the first frame after the glide landed 0.29–0.86 m from its end on the
  phone and 0.00–0.77 m on desktop.

**Found by the gate, fixed: a time after midnight said two ways in the planner.**
- The gate reached a planner check at 23:55 London time. The page rightly said the fixture's bus at 00:09 was
  "00:09 tomorrow", and the check expected the bare time. Three connection checks had the same flaw, waiting
  for a gate in the half hour before midnight.
- Looking at it showed the page's own inconsistency. The line a folded list is summed up in ("Direct buses (1)
  · soonest there 00:50") gave the bare time, while the rows under it said "tomorrow".
- **Now** one helper words every planner time against London's date (`clockOn`, `lib/departures.ts`), with a
  Node test at midnight and across the October clock change. The checks expect "tomorrow" exactly when the
  bus's London date is later.

## 6. Verification

Everything here is Chromium emulation, fixtures or the served site. Nothing is from a phone in hand.

**Suites on the final code:**
- **Node:** 320 tests, including `tests/stop-mapping.test.mjs`, the arrival scope and interval, and `clockOn`
  at midnight and across the October clock change.
- **Python:** 176 tests, including the stop mapping, the display protocol, the release check, and each job
  step's label, time and resident peak.
- **Also:** typecheck; lint (no errors, the same 16 warnings); `deploy/validate.sh` (44 checks, the units
  among them).

**The browser gates, each in full, in order:**

| build | result | what it found |
|---|---|---|
| `a5e43cc`'s candidate | 452 passed, 50 skipped, 4 failed | the fixture road had no stop mapping, and the page rightly refused it. With the mapping, `arrival.spec` passed 12 of 12 and the drawing specs 74, 2 skipped |
| the first paint rule | stopped at 74 passed, 2 failed | the opening city view counted as drawn (section 5) |
| the refined paint rule | stopped at 141 passed, 1 failed | the planner check at 23:55 London time (section 5) |
| `af9a959` | 459 passed, 50 skipped, 1 failed | the front view's entrance step, real and older than this pass (section 5) |
| **`e86b401`** | **462 passed, 50 skipped, none failed (1.3 h)** | |

**Deployed three times, the collector untouched throughout** (PID 282438, running since 07:26:55 UTC on
28 September):

| commit | at | units |
|---|---|---|
| `a5e43cc` | about 21:49 UTC, 28 Sept | evaluation and rebuild installed |
| `af9a959` | 00:22 UTC, 29 Sept | rebuild installed |
| `e86b401` | 02:04 UTC, 29 Sept | none changed |

- **Each served build** was byte-identical to its local build: 9 of 9 scripts and stylesheets, and the page.
- **Each deployed build's code was the gated build's.** The one chunk that differs carries the build stamp
  (commit and minute). With the stamp swapped back, it matched the gated chunk's SHA-256.
- **`/preview/`** returned 401 each time.
- **On `a5e43cc`:** the served shape index is schema 2 with stop mapping 2, and inbound 15's shape checks at
  worst 9.0 m.

**The controlled evaluation run** (on the server by hand, 21:49–21:51 UTC on 28 September, recorded as manual):
- succeeded in 1 min 52 s;
- the unit peaked at 478 MB of its 1,500 MB ceiling, the largest resident step at 367 MB;
- the steps: extract 352 MB, score 180, audit 367, anchor 351, release check 30;
- verdict: collecting, 0 of 7 confirmation days; nothing released.

## 7. What remains before a direction could be approved

1. **A model and display that meet every threshold on the revision days**, under a protocol frozen for them.
   The frozen model does not:
   - outbound reads median 1.65 and p80 3.90 on 20–28 September;
   - inbound's coverage is 7%.

   Any change to the model or the display is a new protocol version, frozen before its own confirmation
   window begins.
2. **Its confirmation, read once:** seven service days nobody has scored or looked at, including a weekday,
   meeting every criterion:

   | criterion | threshold |
   |---|---|
   | median | ≤ 1.5 min |
   | 80th percentile | ≤ 3.0 min |
   | better than the timetable | by ≥ 0.5 min |
   | coverage | ≥ 50% |
   | journeys | ≥ 20 |
   | passages | ≥ 150 |
   | the interval's own coverage | ≥ 80% |

   Each result carries its 95% interval by journey, and a pass whose interval crosses a threshold is reported
   as fragile. The frozen model's own confirmation, 29 September to 5 October, is being collected for the
   record.
3. **For inbound, coverage first.** On weekdays its buses sit on an unsettled branch between its two variants,
   and a page would almost never show minutes until the match can settle them.
4. **The owner's approval of the exact scope**, field for field, in `deploy/arrival-release-approval.json`:
   operator, line, direction, patterns, model, protocol, and the validated interval.
