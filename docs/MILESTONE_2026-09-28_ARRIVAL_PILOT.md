# 28 September 2026, evening: the outbound-15 arrival pilot, checked, and not enabled

The owner authorised a limited pilot of estimated arrival minutes for outbound route 15, **only after
four checks succeed**, and otherwise asked that it stay off with the precise mismatch reported:
1. the page's estimator against the evaluated one, on the same retained observations, catalogue and
   moments: the numbers, the refusals, any display rounding, and no future reports or drawn position;
2. the release evidence against the existing criteria on genuinely held-out journeys, the whole
   development history checked for overlap, nothing tuned or relaxed;
3. an approval specific to the evaluated operator, line, direction, pattern and model;
4. the page: labelled minutes, freshness, withholding when a report is stale, a match uncertain, a
   journey changed or a prediction out of range; the timetable kept apart; inbound withheld; no
   connection claims; Ride-along untouched.

Separately: the closed-service exclusion verified after the next rebuild, with a safeguard meanwhile;
the rebuild's memory headroom visible in Operations and the release notes.

**Result: no-go. The pilot is not enabled.** Checks 1 and 3 pass after the fixes below; check 4 passes
in the browser for a released scope; check 2 passes as the criteria are written but not on the minutes
a page would show, which is the mismatch (section 3). **Found on the way, and fixed:** inbound 15's
stops were numbered 14 out in the evaluation pipeline since the first evaluation. That made its arrival
evaluation invalid, and it is where "inbound 15's timetable runs 15 minutes early" came from: since 20
September the page withheld inbound 15's timetabled times on it, and since this morning the planners said
so to passengers. It was not true (section 6).

## 1. The page's estimator and the evaluated one

**As deployed, they disagreed.** The page's estimator (`lib/arrival.ts`) was a near port on the map's
geometry, not the evaluation's:
- distances on a 6,371 km Earth with the midpoint's latitude, against the evaluation's 111,320 m a
  degree with each segment's start (0.11% apart, about 15 m at the far end of the route);
- a different search window for placing a report on the road (400 m back and a best-fit rule, against
  600 m back and a 25 m fall-back);
- stop offsets re-indexed in road order, cruise speeds rounded, a 7 m/s default against 8.0;
- and, above all, only the reports a publication carries (the latest and six earlier within 240 s,
  about two minutes at this route's cadence), where the evaluator reads every report of three minutes
  for its speed.

On a sample of held-out moments (every 50th, 22,304 answers): 1,641 identical, 19,639 different, up to
**205 s** apart on what the page actually had, and 1,024 refused where the evaluator answered.

**Now** the page runs the evaluator's own arithmetic on the evaluator's own geometry
(`arrivalTrack`, `projectOnto`, `placeReports`, `blendedEta`), with the frozen parameters to the last
digit and truncation to the millisecond as Python's `int()` does. It gives minutes only once it holds
every report of the bus's last three minutes: publications are joined as they overlap
(`withPublication`), and until they reach back three minutes the card says it is reading the bus's
pace.

**Held to the evaluator** (`scripts/arrival-parity-cases.py` writes the evaluator's answers,
`scripts/arrival-parity.mjs` asks the page): every held-out journey of each route-15 pattern, 21–27
September, the server's own warehouse copy and the served catalogue, every report as a moment and every
stop ahead as a target.

| pattern | journeys | answers | identical | 1 ms apart | refused by one only |
|---|---|---|---|---|---|
| outbound, every report up to the moment | 252 | 1,133,373 | 1,133,368 | 5 | 0 |
| outbound, only the last 180 s, as the page holds them | 252 | 1,133,373 | 1,133,368 | 5 | 0 |
| inbound, every report up to the moment (after section 6's fix) | 265 | 945,596 | 945,596 | 0 | 0 |
| inbound, only the last 180 s | 265 | 945,596 | 945,596 | 0 | 0 |

- The model name (`blended@9a626129f782`, the frozen file's hash), the parameters and the road's stop
  offsets are identical on both sides.
- Placement agrees to within 4 × 10⁻¹² m, and for every journey a report is placed the same whether or not the
  search starts from the report before, so where a page begins reading a journey cannot move it.
- The 5 differences are floating-point at the millisecond cut; the page shows whole minutes.
- The timetable a journey is timed by is chosen by the same rule on both sides: the departures at the
  operator's reported origin time, their one timing, or the pattern's own (`scheduled_journey` in
  `pipeline/match.py`, which the page reads from the publication; `scheduled_for` in the evaluator).
- **No future reports**: the page's answers were computed from the reports up to each moment only and
  match the evaluator's everywhere, and the evaluator's chain of placement is causal. **No drawn
  position**: the estimator takes reports and a clock; nothing drawn is among its inputs.
- **Display rounding, on purpose**: the minutes are whole. A range is shown because the direction's
  80th-percentile error is over 2 min: the estimate less and plus 2.48 min, each end rounded, never
  below 1 ("Estimated 1–6 min" at 3.5 min). The minutes count down on the page's own clock from the
  estimated instant; the instant itself is the evaluator's.
- A sample of real journeys and their answers is kept as a test (`tests/fixtures/arrival-parity-sample.json`,
  6,178 answers, `tests/arrival.test.mjs`), so the port cannot drift unseen.

## 2. The evidence, on genuinely held-out journeys

**The development history, read in full.** The parameters were fitted on 11–14 September and chosen
on 17–20 September; a reserved Sunday, **20 September**, was scored and read the same evening
(`arrival-evaluation-15-final.json`); a check on 28 September re-scored 11–20 September only. Against
the server's pooled nights, journey by journey: of the 19 journeys it holds for 20 September, **10 are
in the development files**; for 21–27 September, none. So 20 September is not held out, and the pooled
check now begins on 21 September (`UNSEEN_FROM`). No model, parameter or threshold has changed since
20 September. The evaluator's changes since then are a comparator's lookup, today's speed-up and this
evening's stop numbering (section 6): outbound's nightly entries are identical before and after it, on
every day.

**The criteria, all six.** The pooled check had read four of them; it now reads all six per direction.
Outbound 15, 21–27 September, 7 nights, 5 of them weekdays:

| criterion (2–10 min before the bus passed the stop) | threshold | outbound 15 |
|---|---|---|
| median absolute error | ≤ 1.5 min | **1.20** |
| 80th-percentile absolute error | ≤ 3.0 min | **2.48** |
| better than the timetable where both exist (83,660 moments) | ≥ 0.5 min | **1.60** (1.04 against 2.64) |
| coverage | ≥ 50 % | **100 %** (252,980 moments) |
| journeys, passages | ≥ 20, ≥ 150 | **253, 10,891** |
| a weekday | ≥ 1 | **5** |

**Inbound**, read as failing until this evening (1.77, 3.37), was not validly evaluated (section 6).
Read with its stops numbered correctly, on the same days: median **1.10**, p80 **2.19**, 1.64 better than
the timetable (1.02 against 2.66 on 158,492 moments), coverage 100%, 271 journeys, 11,612 passages, 5
weekdays: all six criteria. **It stays withheld**, as the owner directed; the result is for the owner.

## 3. The mismatch: what a page could show is not what was judged

The criteria group moments by how long before the passage they were, which is known only afterwards. A
page can choose what to show only by its own predicted minutes. On the moments it would show
(predicted 2–10 min):

| outbound 15, 21–27 September | moments | median | 80th percentile |
|---|---|---|---|
| as judged (actual 2–10 min) | 252,980 | 1.20 | 2.48 |
| as a page would show (predicted 2–10 min) | 323,582 | **1.57** | **3.79** |
| … predicted 2–5 min | 138,105 | 1.20 | 2.94 |
| … predicted 5–8 min | 109,547 | 1.74 | 3.93 |
| … predicted 8–10 min | 75,930 | 2.24 | 4.97 |

Of the moments a page would show, 26% were 10 minutes or more out in fact (82,746), and at 72% the bus
came later than estimated. Both thresholds are missed on what passengers would see, so **the pilot is
not enabled**. The page measures its minutes from the moment it shows them, when the report is already
some seconds old, so what it shows sits a little further out than this band: that could only raise
these figures.

Choosing a narrower band now (the 2–5 min row passes) would be choosing it on the held-out days, which
the owner ruled out. What would settle it, for the owner to decide: a display band and a criterion on
predicted minutes, measured as the page shows them, written down now and judged only on nights from
29 September. The nightly verdict reports these figures beside the criteria (`shownBand`) so they are
read before any approval. Inbound's, on the same terms: 299,052 moments, median **1.27**, p80 **2.76**,
inside both thresholds (withheld by instruction, not by this).

## 4. The approval is exact

- The verdict publishes **scopes**: operator, line, direction, the patterns scored and the model
  (`scripts/arrival-release-check.py`). A scope is released only when `deploy/arrival-release-approval.json`
  names it field for field; a bare direction approves nothing; a pattern never scored, another line,
  operator, direction or model approves nothing. `released`, the list of directions older pages read,
  is always written empty, so a page from before today shows nothing whatever the verdict.
- The page shows minutes only for a pattern a scope names with its own model
  (`releasedScope`): before today, releasing "outbound" would have shown minutes for every outbound
  service with a checked road.
- The approval file approves nothing, with the reason written in it. The verdict run on the server's
  copy lists outbound and inbound 15 as passing and awaiting an exact approval, and releases nothing.

## 5. The page, and what it withholds

With a released scope (a browser check on the fixture), under the bus card's own lines:
"**Estimated 1–6 min to your stop** · an estimate from its reports, last 7 s ago · 1.2 km of road left ·
a pilot on this service only · not a promise" — apart from the timetable's lines and the departure
board, which the estimate replaces nowhere (the board says arrival minutes come only on the service
that has passed its criteria). On that service a bus with no minutes says why in one line. Withheld,
each with its reason: not released for this service; another journey than the one chosen; the road
not loaded or its stops not lining up; the bus's last three minutes not all held yet; a report over
150 s old (past that the bus is not counted as coming to the stop at all); the latest report off the
road; at or past the stop; under 2 or over 10 minutes; and, as before, a bus whose last report is
nearest the stop or beyond it, a match with no single pattern (an unsettled branch), the recording.
Inbound 15 is named by no scope. Nothing in the connection planner or Ride-along reads the estimate.
`tests/browser/arrival.spec.mjs` (5 checks, both sizes) and `tests/arrival.test.mjs`.

## 6. Found: inbound 15's stops were numbered 14 out, and "15 minutes early" was that

**The fault.** A road shape's stop offsets cover the stops it was built through, those inside the
service area, in order (`pipeline/shapes.py`). Inbound 15 calls at 14 stops outside the area before its
first inside it, so its road carries 47 offsets for a 61-stop pattern. `pipeline/passages.py` read
them as the pattern's stops 0–46: every passage was named after the stop 14 earlier, and the evaluator
and the schedule anchor read the timetable there. Outbound's stops outside the area come last, so it
was never affected.

**The evidence.** The same 1,461 passages at inbound's first ten observed stops (21–27 September):
**+15.41 min** against the timetable as they were paired, **+2.61 min** each against its own stop;
outbound's read +2.59 either way. An inbound bus is first reported a median **12.8 min** after its
departure, at the start of its road, where the timetable puts it at **10.0 min**. The "first appears
14.5 min after its registered departure" of 20 September was the bus reaching the area we collect,
not a timetable starting early.

**What it did.** From 20 September the bus card withheld inbound 15's timetabled time at stops on
this verdict (a withheld time is not shown, so no reason was either). From 28 September the planners
said it to passengers: "No times for the 15: schedule runs 15 min early against the bus's own reports at
its first stops", gave no times for a leg or a direct bus on it, and left its buses out of other lines'
legs. The inbound arrival evaluation was invalid, and so was the 20 September reading that the
timetable comparator's inbound error "was real".

**Fixed.**
- `placed_offsets` (`pipeline/passages.py`) puts a shape's offsets on the pattern's own stop indices,
  and refuses a road whose stops inside the area do not number as its offsets, as the page's
  `arrivalTrack` does. The passage audit, the evaluator and the anchor all read it
  (`tests/test_passages.py`, a pattern starting outside the area).
- The anchor no longer keeps an old verdict for a pattern it re-reads with nothing to check.
- `public/data/schedule-anchor.json` regenerated from the server's warehouse copy (20–28 September):
  outbound 15 verified (+2.67 min, 806 passages); inbound 15 **unchecked**. Its first stops cannot be
  observed, so the rule (the first ten stops) cannot be applied to it.
- On the page: inbound 15's timetabled time at stops stays withheld, as every unchecked service's is;
  the planners treat it as every unchecked service, timed from the timetable and said to be unchecked,
  and its buses are no longer left out of other legs.
- Outbound: every nightly entry is identical before and after the fix (8 days).

**For the owner.** Whether an anchor may be read at a pattern's first *observed* stops (inbound 15
would read +2.6 min, inside the 3-minute tolerance, and would then show its timetabled times); and
inbound arrival minutes (section 2), withheld by instruction.

## 7. The closed services, until the next rebuild

The served catalogue was built on 27 September, before `publicUse` existed, so it cannot say which
services are closed. Until it does, the planners leave out by name the ten services their timetable
files declare closed (`KNOWN_CLOSED`: BNGN 817A, 914; BNML 700B, 716A, 725A, 732, 743B, 761A, 856A;
BNSM 949A), and nothing else; once a catalogue carries the flag, the flag decides. **Pending:** the
first rebuild after this deploy (29 September, about 02:43 UTC) writes the flag; the served catalogue
should then carry `publicUse: false` on BNML 732 and the planners offer it nowhere. Not yet verified.

## 8. Memory headroom

Each nightly job now records its own cgroup's memory peak and ceiling when it stops (`pipeline/jobs.py`,
read inside the unit, verified on the server with a throwaway unit), and Operations shows it: the
rebuild's last success, 27 September, **1.4G of its 1500M ceiling (96%), close to it**, page cache
included (the rebuild's own resident peak was 1.12 GB on a copy; backlog 39). The limits are unchanged.
Tonight's runs are the first to record their own; the 27 September figure is the journal's, rounded.

The evaluation's own headroom is shrinking too: it re-scores every day the warehouse holds, each night
(684.5M of 1500M on the server over 8 days; here 404 MB for 2 days of scoring, 433 MB for 4, 598 MB for
the nightly run over 8). At roughly 20–26 MB more a day of data it would reach its ceiling in about six
weeks. Backlog 42 has the measurements and the fix; Operations shows its peak each night from tonight.

## 9. Verification

**Here.**
- Node 313 tests, Python 165 (among them the parity sample, the exact scopes, the six criteria, the stop
  numbering of a pattern starting outside the area, and the anchor dropping a verdict it cannot read);
  typecheck; lint with no errors.
- The focused browser specs (arrival, Operations' jobs, both planners, the journey), 66 of 66 at both
  sizes; then **the full gate on the final code: 454 passed, 50 skipped by design, none failed, 1.4 h**
  (this machine held awake for it).
- The parity pair on both route-15 patterns (section 1), and the nightly evaluation re-run on the
  server's copy with the stop numbering fixed: outbound's entries identical on all 8 days, inbound's all
  changed.
- The arrival line seen on the fixture at 390 px: the estimate as a range, labelled, beside the
  timetable's lines (`13-arrival-line-mobile.png`, before the distance was worded as the app words it).

**On the server** (`cd14ab3`, with `53f2232` kept for `deploy/rollback.sh`):
- The build byte-identical to this machine's (9 of 9 files and the page); `/preview/` 401; the corrected
  anchor served (outbound 15 only).
- The collector the same process (282438, running since 07:26 UTC) through the deploy and every step
  after it.
- The rebuild's record carries its last success's peak, 1.4G of 1500M, read from the journal
  ("Consumed 3min 38.622s CPU time over 4min 12.034s wall clock time, 1.4G memory peak", 27 September).
- **A controlled run, by hand, recorded as such**: the evaluation unit at 18:12–18:15 UTC, succeeded
  in 2 min 47 s at a 544.7M peak, which the unit recorded itself from its own cgroup (571,207,680 bytes
  of a 1,572,864,000 ceiling). Its verdict: schema 2, released nothing, no scopes, inbound and outbound
  15 each passing and awaiting an exact approval (median 1.10 / p80 2.19 and 1.20 / 2.48; predicted
  2–10 min 1.27 / 2.76 and 1.57 / 3.79), the approval's entries empty.
- **The served page** (`scripts/probes/arrival-pilot-served.mjs`, real data, 390 px emulation, before
  and after the deploy):
  - the inbound 15 then 53 journey from Hillingdon Road (opp): before, "No times for the 15: schedule
    runs 15 min early …"; after, timed (the 15 at 19:39, MediaCityUK 20:31) and "neither timetable has
    been checked against its own buses";
  - a live outbound 15 (YN62BXA) chosen from a stop ahead of it: no arrival line, and the board still
    "no arrival minutes here yet";
  - Operations: the rebuild "1,434 MB of its 1,500 MB ceiling (96%) · close to its ceiling · last
    success, from the journal, rounded", the evaluation "545 MB of its 1,500 MB ceiling (36%)";
  - no page errors.
- **Closed services on the served catalogue** (`scripts/probes/closed-served.mjs`): it carries no
  `publicUse` yet, so the list decides; BNML 732 (the only one of the ten in it) offered on none of 4
  trips along its own stops, and on all 4 with every pattern declared open, the check's control.

**Not yet, and when.** Tonight's scheduled runs, the first on this code: the rebuild at about 02:43 UTC
(the flag written, BNML 732 `publicUse: false`, its own memory peak) and the evaluation at about 03:12
UTC. Emulation only; no phone in hand.
