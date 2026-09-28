# 28 September 2026, afternoon: the planner's correctness and the nightly jobs' reliability

The owner's brief, before the connection planner is promoted, as a bounded pass:
1. time direct buses as journeys with one change are timed, by the day's operating calendar and each
   journey's variant, so that a route merely serving both stops never outranks a usable departure,
   with school services handled by their own rules rather than hidden;
2. count the walk to the first stop in what can be caught and the last walk in when the destination
   is reached, keep the three walks apart, and never present an impossible departure as ready;
3. check the walk between the stops before the choice is confirmed where possible, and where the check
   changes a chosen journey, show the change and let the passenger accept it;
4. a small regression set on the faults actually found, each outcome worked out independently;
5. validate the repaired nightly jobs safely, show each job's last attempt, last success and failure or
   overdue state in Operations, and never let an invalid timetable response replace the last valid
   catalogue; no new alerting account.

And: correct the description of software-renderer performance. No estimator, no second map, no
redesign.

Status words as in `PROJECT_CONTEXT.md`. Browser checks are Chromium with software WebGL, desktop and
phone emulation, on fixtures unless marked REAL. Nothing was checked on a phone in hand.

## 1. Direct buses, timed

**Before.** A direct option carried no time and kept its order by walking and riding distance. With
every stop within the walk searched, a school service could come first: from Hillingdon Road to
Withington Community Hospital, the school 734 above the 23, both from Norwood Road (nr), because its
ride is shorter, whatever either's next bus was (the 734's next, on a Tuesday morning, is at 16:36).

**Now** (`lib/plan.ts`, `components/plan-panel.tsx`, `components/follow-view.tsx`):
- An option is a pair of stops and **every bus between them**: every pattern open to the public,
  valid and running on the day, that calls at the first and later at the second, whatever its line or
  variant ("Board the 23 (or the 23 to Mersey Road)").
- It is **timed from the boarding stop's own board**: each journey by its own operating rule for the
  service day (school terms are per journey, `serviced` ranges), from the moment the passenger could
  be at the stop, with its time at the stop to get off at.
- The list is **ordered by arrival at the destination, the last walk included**; of two that arrive
  together, the one the passenger can set off for later leads; the same bus is offered once, from
  whichever stop is better.
- The line reads, on the served site on 28 September: "Next: 23 15:49 from Norwood Road (nr) · at
  Mersey Road 16:12 · then about 7 min on foot · by the timetable, not live". A timetable known to
  run ahead of its buses gives no time, as before.
- **Variants.** Until this pass one pair of stops was chosen per line and destination, by distance,
  before any time was read, and a variant that does not call at that pair was lost. Measured on the
  served catalogue over 1,500 random pairs of places (773 with a direct bus): 5 lost a usable variant
  that way, two BNML 86 variants inbound from Chorlton Bus Station among them. Each pattern now takes
  its own best pair; patterns between the same two stops are one option. Checked with the production
  code over 5,000 pairs (2,573 with a direct bus): **no usable pattern is missing from the
  candidates** (`scripts/audit-planner-candidates.mjs`).
- **Every candidate is timed.** Candidates per search: median 2, 9 at the 99th percentile, 21 at
  most (16 from Charlotte Street in the centre); the cap is 24, and none reached it.
- **School services** are offered when their journeys run, by their own rules: on a school-day
  morning the 734 leads where it is sooner, in half-term it is not there. **A service closed to the
  public** is never offered: TransXChange `PublicUse` is `false` in 17 of 1,753 files (10 services:
  BNGN 817A and 914; BNML 700B, 716A, 725A, 732, 743B, 761A, 856A; BNSM 949A), and BNML 732 is in
  the served catalogue. It is now read into the catalogue and the boards (`publicUse`), still matched
  and drawn on the map, and left out of both planners. Boarding restrictions in the data
  (`Activity` pick-up or set-down only) occur only at the first and last stops of a pattern (10,483
  journey patterns scanned), which the planners already respect by never boarding at a last stop.

**The same fault in the connection planner.** Journeys with one change were found in order of
distance and only the first 8 were timed. Measured with every candidate timed from the boards
(rebuilt from the server's own inputs, below), for Tuesday 29 September:

| | 08:00 | 14:00 | 20:30 |
|---|---|---|---|
| pairs of places with a change | 194 | 194 | 194 |
| a sooner connection beyond the first 8 | 37 | 34 | 48 |
| … 5 min or more sooner | 27 | 22 | 37 |
| a sooner connection beyond the first 48 | 2 | 1 | 1 |
| … 5 min or more sooner | 0 | 1 | 1 |

48 are timed now (`CONNECTION_RULES.candidates`), reading a median of 17 boards, 45 at most, against
8 and 14. That was affordable only after the timing was made cheaper: every call to `departuresOn`
rebuilt a pattern's departures for three service days, converting each to an instant with two calls
to the London time formatter, once per first bus per second-bus variant. London's offset is now worked
out once per UTC hour (it changes only on the hour) and a service's departures once per day and rule
set. Timing one journey with a change: **0.55 ms at the median and 2.2 ms at the 99th percentile,
from 32 ms and 143 ms**, with identical results; every test at local midnight and on both
clock-change mornings passes.

Not changed, measured: the connection search still keeps one first bus per pair of services before
timing. Keyed per pattern instead, it would have found a further first-bus variant in 22 of 393 pairs
of places but narrowed the services among the timed candidates in 26, so it was left as it is (backlog
37a).

## 2. The three walks

- **To the first stop**: the straight line × 1.3 at 80 m a minute, said to be an estimate. A bus that
  leaves before the walk is done is not offered as one to take (a bus due in the last minute is still
  shown to someone within a minute of the stop, as the stop's board shows it). A bus that leaves
  **under 2 min after the walk would be done is marked "tight: under 2 min to spare on an estimated
  walk"** in the list, and "tight for the walk there" on the card: an estimated walk can be longer
  than its estimate, and this is where that would lose the bus.
- **Between the stops**: checked by the router before the list is shown (next section), else the
  straight line × 1.3, said to be unchecked.
- **From the last stop**: estimated as the first, counted in the arrival every list is ordered by and
  in each folded group's "soonest there".

Each option and the card name the three separately. Only stop positions go to the router; the
passenger's start never does for these walks.

## 3. The walk between the stops, before the choice

- **Before the list is shown** the walks between the stops of the journeys it would list are asked
  of the router, one request per pair of stops, a second apart (the router's usage policy), shared
  by the list and the card and never asked twice. The list waits up to 6 s for them; a walk not back
  by then is shown as the straight line and "not checked". At Trafford Bar (50 m in a straight line,
  230 m and 3 min by the router) the list now shows the connection the checked walk allows, where it
  showed one the walk then broke.
- **After a choice, a later answer never replaces it.** The card waits for the walk before giving
  times ("Checking the walk between the stops before giving times…"). If the checked walk breaks the
  chosen connection, the card says so and offers the replacement:
  > Your 256 at 10:33 no longer makes the 53 at 10:46. By the timetable, with the walk between the
  > stops checked at 12 min and 2 min to change. It makes the 53 at 10:59 instead, at Trafford Bar
  > 11:05. **[Use this]** Other journeys
  Until the passenger accepts, nothing of the offer is theirs: no row leads, the page ties no bus to
  the offer's journeys, and the ride's header points to the card. The same holds when a first bus can
  no longer be caught.
- **A chosen connection holds while its second bus can still be reached**, not only while it is the
  soonest. Found by the new browser check: after a reload the walk is asked again, and while it is
  unanswered the estimated walk allowed an earlier second bus, which read as "no longer makes".
- Asking for *More time to change* chooses again, as before, and says so.

## 4. The regression set

`tests/planner-regression.test.mjs`, ten cases on small worlds written as journeys (stops, minutes,
departures, the days each runs). For direct buses a brute-force oracle reads the journeys as written
and tries every pair of stops within the walk; the planner reads the same journeys only as the app
does, as a catalogue and boards. Each case also shows that it is a real case: the old cut, the old
order or the old rule gets it wrong.

1. A public 23 from a stop 418 m away against a school 734 from 120 m away and a closed 732: at 07:00
   on a school day the 23 leads (07:20, there 07:39 against 07:42); 1b at 07:15 the 734 leads; 1c in
   half-term the 734 does not run.
2. A variant carrying the only departures between two stops is timed; 2b a variant that boards at a
   stop the line's usual pattern does not call at is timed on its own; 2c the same bus from two stops
   is one choice, the one set off for later.
3. A stop beyond the 14 nearest is found.
4. A bus leaving before the walk to its stop is done is not offered; one with 42 s to spare is tight.
5. A connection a checked walk breaks is said to be broken and a replacement offered, not substituted;
   one a shorter checked walk leaves reachable is still held.
6. A connection that is the only one with buses, behind 16 by distance, is timed and leads.

The expected outcomes were worked out by hand as well and are written beside each assertion. Two
first drafts of mine were wrong and the checks said so: 2c's first version put no second stop in
reach, and a rule I wrote to drop "the same buses from a worse pair of stops" judged *worse* by
distance and dropped the nearer stop where the bus is caught sooner (removed; the time-based rule
above replaced it).

## 5. The nightly jobs

**What had failed.** The timetable rebuild on 28 September, on a BODS error page stored as a
timetable ("Problem with the service - GOV.UK", 3,729 bytes gzipped, HTTP 200), and the arrival
evaluation on every night since 21 September: on the 22nd and 23rd it ran past its 20-minute limit,
and from the 24th it failed on the stored departures' new shape (fixed in `ee3f4d0`). Nothing said
so anywhere a person would look.

**The timeouts had a cause of their own, found in this pass.** After scoring, the script labelled
each scoring moment weekday or weekend by scanning every passage for it, then split the moments with
a list-membership test: quadratic in the moments. On 21 September (742 passages) it took seconds; on
the 22nd (4,786) it did not finish in 20 minutes. It re-scores every day in the night's copy of the
warehouse, so the copy of 27 September (23,517 passages, 1,133,843 moments) would have failed tonight
with the earlier fix alone. Each moment's day is now looked up once: the scoring step takes **1 min
14 s** on that copy here, 576 MB at most; the whole unit's four steps about 1.5 min.

**Each job now records itself** (`pipeline/jobs.py`): its start as it begins (`ExecStartPre`), its
result as it stops (`ExecStopPost`, which systemd runs whatever the outcome and hands the result),
and whether the timer or a person started it (`TRIGGER_UNIT`, verified on the server's systemd 259
with a throwaway transient timer: set for the pre-start, main and post-stop commands). The record is
`public/data/jobs.json`, kept out of deploys. **Operations** shows each job's last attempt (when, by
the schedule or by hand, and how it ended as systemd said it), its last success, and its last
scheduled run; a job whose scheduled run is more than a day and three hours old is **overdue**, so a
timer that stops firing shows, and a run by hand never stands in for the schedule. A start with no
result long past the job's time limit is "no result recorded", not "running". A failure to record
never fails the job. If the collector's restart itself fails after a rebuild, the attempt stays
without a result and shows as that.

**Invalid timetable responses never replace the last valid catalogue:**
- the collector keeps a body that is not a zip apart (`timetables-rejected`), whatever the status;
- the rebuild skips a snapshot it cannot read, now including a corrupt gzip, and names it;
- a readable snapshot holding under half the files of the dataset's previous one is not taken in its
  place (`snapshotsRefusedAsShrunk`) unless a withdrawal is expected;
- a build that would publish under half the catalogue already published is refused **before anything
  is written**: it used to replace the warehouse's pattern tables first, so the live matcher worked
  from the shrunken set while the old catalogue stayed published. The replace is one transaction.

**Controlled validation, and what it is not.**
- **The rebuild**, run here on copies of the server's own inputs, with the server's memory settings,
  because on the server it pauses collection: the seven timetable snapshots (each checked against the
  SHA-256 in its name, the error page among them) and the warehouse copy the last good rebuild took
  (27 September, 02:44 UTC). It succeeded in 52 s at a peak of 1.12 GB, named the error page as
  unreadable, read all four datasets and refused none. **The catalogue is identical to the one the
  server published on 27 September in all 587 patterns and every field**, with the new flag added
  (585 open, 2 closed: BNML 732). The boards: 2,682 stops, 958,699 departures and 204 rules, as served;
  8 of 8 sampled boards identical apart from the flag.
- **The evaluation**, on the same copy here with the server's settings: the passage audit 13 s
  (374 MB), the scoring 1 min 14 s (576 MB), the schedule check 0.9 s (inbound 15 still 15.4 min
  early, withheld; outbound verified). Then **by hand on the server** after the deploy, beside the
  collector, 14:34:57–14:37:41 UTC: succeeded in 2 min 44 s at a 684.5M peak (the unit's own figure,
  against `MemoryMax=1500M` and a 20-minute limit), the same 1,133,843 moments, outbound published as
  *passed, awaiting approval*. The collector was the same process before and after, publishing
  throughout, and the jobs' record reads "by hand · succeeded".
- **The next unattended runs** are the test that matters: the rebuild at 02:40 UTC (03:40 BST, up to
  5 min later) and the evaluation at 03:10 UTC on 29 September. Operations will show each as
  *scheduled*, with its result.
- No external alerting was set up (not authorised); the prepared dead man's switch stays off.

**The first full scoring passes a direction, and the release is held for the owner.** Pooled over
the eight nights, **outbound 15 meets the release criteria** (median 1.19 min, p80 2.46 at 2–10 min
ahead; 263 journeys, 11,293 passages, five weekday nights; 1.20 and 2.48 without 20 September, which
the development evaluation also drew on), and inbound does not (1.77, 3.37). Under the rule agreed on
20 September the nightly job would then show outbound 15's arrival minutes to passengers, from the
first unattended run after this deploy. The page has never shown an estimate, this pass was asked to
add none, and the page's estimator has not been compared with the evaluated one on the same real
moments. So the nightly unit now reads `deploy/arrival-release-approval.json`, which approves nothing:
a passing direction is published as *passed, awaiting approval* and nothing is shown until the owner
lists it (`docs/ARRIVAL_RELEASE_CRITERIA.md`, 28 September).

## 6. Performance on the software renderer is not a bound on a phone

The connection record said a second full map "is an upper bound for two full MapLibre maps". That
was wrong and is corrected there. The browser checks draw with SwiftShader, on this machine's CPU. A
phone's GPU may draw faster than that; its slower CPU, a device pixel ratio of 2 or 3, heat and power
saving may make each frame slower. So the measured frame times (one map 16.7–18.7 ms, two maps 33–39 ms
each) show the relative cost of a second map on this renderer, about double, and bound nothing on a
phone in either direction. What a phone does is unmeasured.

## 7. Verification

- Node: 306 tests (10 in the regression set; 5 on the jobs' judgement; the deploy never replacing or
  deleting a file the server writes). Python: 155 (the jobs' record; `PublicUse` read and carried; a
  refused build leaving the warehouse; unreadable and shrunken snapshots; the release held without
  approval). Typecheck; lint with no errors.
- Browser:
  - the full gate on `ab98f8c`'s build: **443 passed, 50 skipped by design, 1 failed** (1.4 h of
    testing). The failure, `motion.spec` "an estimate is held at its bound once the report is older
    than it" on the phone profile, started within a second of this machine waking from a 61-minute
    sleep: the page read a report as 3,765 s old. `motion.spec` then passed 24 of 24 on the same build;
  - `connection.spec` and `plan.spec`, 26 of 26, and `operations-jobs.spec`, 6 of 6, on their final
    builds; `journey.spec` with them, 56 of 56 before the connection cut changed;
  - the planner's age wording, fixed after the first deploy: `plan.spec` and `connection.spec` 26 of 26
    on `53f2232`.
- The frames of each new state were looked at, at both sizes: the planner leading with a direct bus
  and with a change, each fold, the walk being checked, the change and its acceptance, Operations.
- `deploy/validate.sh`: 44 checks.
- Served, REAL data, `ab98f8c` then `53f2232` (`e3c760b` kept first, then `ab98f8c`):
  - the page and all 9 of its scripts and stylesheets byte-identical to the deployed build; `/preview/`
    401; no imagery key in the configuration;
  - the units installed and reloaded, the job records seeded from the journal, the collector's process
    unchanged through both deploys; a rollback, dry-run, would change 4,241 release files and none of
    the files the server writes; the kept release is 111 MB (it was 4.1 GB);
  - Operations at both sizes: the rebuild *failed* (scheduled, exit status 1, last success
    27 September), the evaluation *succeeded* (by hand);
  - Hillingdon Road (nr) → Withington Community Hospital, phone and desktop (15:4x and 15:5x BST): the
    list said it was checking and appeared in 1.3–2.3 s; the 23 leads (15:49, and 16:09 once the 15:49
    could no longer be walked to), the school 734 below it (16:36), the four journeys with a change
    folded ("soonest there 16:36"); choosing the 23 opens Norwood Road (nr) filtered to it;
  - Hillingdon Road → MediaCityUK, phone: the Trafford Bar walk *checked* in the list before any
    choice ("3 min, about 230 m, a checked route"); the chosen connection held as "Your connection:
    255 15:50 → 16:00 at Trafford Bar · 250 16:08 · 8 min to change", the first bus *tracked on this
    journey*; the stages, a reload, the ride and its switch to the next bus; the frame unmoved across
    two publications; no page errors on any walk.

## 8. Found on the way

- **The deploy would have deleted the jobs' record** on every upload (`rsync --delete`, the file not
  excluded), as it once deleted `arrival-release.json`. Excluded, with a test that every file the
  server writes is.
- **A rollback would have done the same, and more.** `deploy/rollback.sh` protected only the
  collector's three files, so it would have deleted the jobs' record and put back the catalogue,
  boards and verdict of the deploy's day over a later nightly rebuild. It now reads the deploy's own
  exclude list, with a test that it does. And the kept previous release was the whole directory,
  3.9 GB of it the live warehouse and captures, copied on every deploy though rollback never restores
  them (the deploy script said they were never copied); it now leaves out `data/` and the virtualenv.
- **A rule I wrote dropped the better stop** (section 4).
- **The evaluation's timeouts were quadratic**, not slow data (section 5).
- **Repairing the evaluation would have released an estimate unattended** (section 5): held.
- **The rebuild's memory is near its ceiling.** Its resident peak here was 1.12 GB on the 27 September
  warehouse (0.9 GB), from 853 MB on 18 September; the server's journal gives that night's run a
  1.4G peak for the whole unit, page cache included, against `MemoryMax=1500M` (backlog 39).
- **The planner's folds had no sign that they open** (a flex summary loses the browser's marker): a
  chevron now, as elsewhere on the page.

## 9. Limitations, plainly

- The walk to the first stop and from the last are estimates; the router is not asked for them,
  because that would send the passenger's start (the walk guide asks, on request, for the stop the
  passenger chooses).
- The closed-service exclusion needs the flag in the served catalogue, which the server's own rebuild
  writes: from the first rebuild after this deploy (29 September, 02:40 UTC). Until then the served
  catalogue carries no flag and BNML 732 can still be offered.
- Beyond the 48 connections timed, 1–2 of 194 pairs of places still had a sooner one.
- Times are the operators' timetables; a change is not promised; emulation only.

## 10. To try

- **A direct bus: Hillingdon Road → Withington Community Hospital.** The 23 from Norwood Road (nr),
  about 390 m away, to Mersey Road (opp), then about 440 m on foot; the school 734 is listed below it
  (and leads only when it is the sooner), the journeys with one change folded under one line.
- **A connection: Hillingdon Road → MediaCityUK.** The 263 (or the 255) from Davyhulme Road East (nr)
  to Trafford Bar, the checked 3-minute walk, then the 250 to John Gilbert Way or the 53 to MediaCityUK,
  whichever gets there first.
