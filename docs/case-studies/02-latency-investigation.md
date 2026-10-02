# Case study 2: where a report's age went, measured before anything was changed

**Symptom.** Between 22 and 30 September the age of a bus's report on reaching a phone roughly doubled (24 s → 44 s
at the median, two recordings), the drawing began repositioning buses, and healthy buses were called "gone quiet"
(backlog 47, 48). Nothing recorded how long the collector's own publication took, so nothing said the pipeline had
slowed (opportunity 76).

**Constraint.** The collector is the only writer to a production warehouse; profiling meant either a planned restart
with instrumentation or copying a 1.5 GB warehouse off the server. The owner approved a brief, planned restart, asked
for the four parts of a report's age to be kept apart, and for only a demonstrated bottleneck to be optimised.

## 1. Instrument (commit `03a61df`)

One extra JSON line a cycle in the collector's own journal; nothing stored, nothing published:
- wall time of each stage (fetch, store, parse, database load, publication) and of each part of the publication;
- the feed's own `ResponseTimestamp`, which splits a report's age into "before the feed answered" and "network";
- how old every report the payload brought *for the first time* was when it reached us, counted per whole second;
- when the file a phone reads was written.

`scripts/stage-timings.py` summarises any window, pooled over reports. The browser side is
`scripts/probes/delivery.mjs`: one emulated phone on the served site, recording when each publication arrived and,
once a second, how far behind real time the chosen bus was drawn; `scripts/delivery-summary.py` joins the two
on each publication's own stamp. The server's clock was measured 769 ms ahead of the probe's (±29 ms) and corrected.

## 2. Measure (REAL feed, 2 October 2026, 17:54–18:32 UTC, 72 cycles)

| A report's age (per new report, n = 26,832) | median | p95 |
|---|---|---|
| when the feed answered (upstream) | 11.2 s | 18.4 s |
| when we received it | 11.5 s | 18.5 s |
| when the file a phone reads was written | **43.0 s** | **51.1 s** |
| when an emulated phone received it (n = 13,386) | 51.9 s | 63.8 s |

| Our processing (per cycle, n = 72) | median | p95 |
|---|---|---|
| receipt → file written | **32.0 s** | **35.3 s** |
| — freshness measurements | 20.0 s | 22.2 s |
| — latest report per bus | 7.55 s | 8.50 s |
| — database load | 3.42 s | 4.16 s |
| — matching | 0.41 s | 0.58 s |

**Conclusion: most of the delay was ours, not upstream's.** Measured separately, at the median: a report was 11.5 s
old when we received it, our receipt-to-written time was 32.0 s, and a report was 51.9 s old when the emulated phone
received it. Two statements read the whole warehouse (12.8 million stored live observations) at every publication:
- percentiles for freshness figures that no screen displays;
- a ranking of every report ever made, to find each bus's latest.

Locally, over a 1.4-million-row copy, the same statements took 0.6 and 0.2 s. On the server, with the database held
to 1 GB and the collector's cgroup crossing its soft memory limit 45,823 times in 22 minutes, they were read through
the page cache each time. A cycle took longer than the 20 s interval, so the feed was read every 33 s.

## 3. Change one thing (commit `1155e2f`)

Each statement reads only the window it needs:
- the latest report per bus from reports **received in the last 24 hours**. A published report is at most 900 s old,
  so it was received inside the window: **the buses published are unchanged**, and a test holds the windowed and
  whole-history results equal;
- the freshness measurements over **the last hour**, each figure saying its window in the published file.

What did change, and is said: the freshness figures' window, and the scope of the "expired positions withheld" count
(positions received in the last 24 hours). The animation was not touched.

## 4. Measure again (18:34–19:17 UTC, 131 cycles, the same server and warehouse)

| | before | after |
|---|---|---|
| receipt → file written, per cycle (median / p95) | 32.0 / 35.3 s | **4.8 / 5.6 s** |
| a report's age when the file was written (median / p95) | 43.0 / 51.1 s | **15.6 / 22.9 s** |
| a report's age on reaching an emulated phone (median) | 51.9 s | 19.2 s and 22.6 s (two runs) |
| a chosen bus drawn behind real time (median) | 61.9 s | 35.6 s |
| feed read every | ~33 s | 20 s, as configured |
| collector CPU time per wall-clock second (2 vCPUs) | 1.66 | 0.31 |

**Limits of the comparison.** Consecutive live windows on the same server, not a controlled same-input benchmark;
both early evening, not daytime (the day's daytime cycles, 34.6 s at the median over 824, matched the "before"
window). The process's own resident memory did not fall; the cgroup's page cache and memory pressure did. Browser
figures come from one emulated phone, not a phone in hand.

## 5. What is left, and why it was not changed here

- **The page's poll.** A page asks every 20 s on its own clock; its wait after each write is 0–20 s, fixed per page
  by when it was opened. Asking just after the next expected write could take about 10 s off the median, but it
  changes every phone's polling and needs its own check.
- **The database load, 3.4 s and growing**: its classification joins each payload to all stored observations.
  Bounding the join by the payload's own observation times would give the same classification.
- **Upstream**, about 10.5 s at the median, is the operators' and the feed's.

## Evidence

- Code: `pipeline/collect.py` (`Laps`, `arrival_ages`, `response_timestamp_ms`), `pipeline/live.py` (`LATEST_WINDOW`,
  `MEASURE_WINDOW`), `pipeline/freshness.py` (`measure(..., window_seconds)`).
- Tests: `tests/test_live_collection.py` (a timing line a cycle, published nowhere; the windows publish the same
  buses and say what they cover; a run's first payload counts no ages; the feed's response time read only where it
  says one).
- Records: `docs/BACKLOG.md` 48, `docs/RELEASE.md` (2 October).
- Not in a fresh clone: the server's journal lines and the probe outputs (`outputs/probes/delivery/`, git-ignored). The
  scripts that produced them are in the repository and rerun against any window.
