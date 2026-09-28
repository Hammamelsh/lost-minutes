# Which stop of a pattern each point on its road is: the stop mapping

**Version 2, since 28 September 2026.** Written by `pipeline/stop_mapping.py` and `pipeline/shapes.py`,
read by `lib/stop-mapping.ts` on the page and `pipeline/stop_mapping.aligned_offsets` in the pipeline.

## The fault it replaces

A road shape is built by routing a bus through a pattern's stops **inside the service area only**. A
pattern can start outside the area, end outside it, leave and re-enter it, or call at a stop twice. Until
28 September 2026 a shape carried a bare list, `stopOffsets`, with one offset per stop it was built
through, and its readers paired the k-th offset with the pattern's k-th stop.

Of the 560 published shapes, that pairing was right for 276, whose stops inside the area come first. It
was wrong for the other 284:

| Shapes | How they are laid out |
|---|---|
| 174 | start outside the area |
| 110 | leave the area and come back |

Eight of the 560 call at a stop twice.

On inbound 15, which starts 14 stops outside the area, each stop was read as the one 14 places on.
Hillingdon Road (opp), pattern stop 30, was read at 8,715 m instead of its 5,495 m. That is how inbound
15's timetable came to look 15 minutes early (`docs/MILESTONE_2026-09-28_ARRIVAL_PILOT.md` §6).

## Every consumer, traced (28 September 2026)

"By position" means the consumer paired a road's offsets with a pattern's stops by list index. It is the
only way the fault could act.

| Consumer | What it reads | By position? | Affected | Now |
|---|---|---|---|---|
| Passage inference (`pipeline/passages.py`), and through it the arrival evaluation, the schedule anchor and the parity cases | a shape's offsets by pattern stop index | **yes** | **inbound 15**, the only evaluated or anchored pattern that does not start inside the area: its passages named after the stop 14 earlier, its evaluation invalid, and its anchor verdict "15 min early", which withheld its timetabled times at stops from 20 September and made the planners say so on 28 September | the mapping |
| Arrival estimate on the page (`lib/arrival.ts`) | offsets by stop index (re-indexed in road order until 28 September) | **yes** | never shown: no scope was ever released | the mapping |
| Schedule anchor's consumers: the timetabled time at your stop (`lib/scheduled.ts`) and both planners (`lib/plan.ts`, `lib/connections.ts`) | the anchor's verdict per pattern | no, but they trusted the verdict | inbound 15 withheld and called unreliable (above) | the anchor regenerated: inbound 15 unchecked |
| The drawing's pauses at stops (`lib/motion.ts`, `track.stops`) | offsets as positions only | no | no | unchanged: `stopOffsets` remains, as positions in road order |
| Stop progress, "N stops before yours" (`lib/patterns.ts`, `lib/journey.ts`) | the match's `patternIndex`, from `pipeline/match.py`, which numbers stops in the full list before keeping those with coordinates | no | no | unchanged |
| Upcoming-stop labels in the ride and the front view (`components/follow-view.tsx`, `stopsAhead`) | the pattern's stop codes after the match's `patternIndex`, placed by their own coordinates | no | no | unchanged |
| Timetabled seconds and departures (`patterns.json` `seconds`, `timings`; the stop boards) | per stop of the full list, or by stop code | no: TransXChange's own sequence | no | unchanged |
| Shared road for an unsettled branch (`lib/motion-view.ts`, `sharedRoad`) | geometry only | no | no; its documented example put Hillingdon Road at 8,715 m, the positional reading | comment and `tests/shared-road.test.mjs` corrected to 5,495 m |
| Route geometry on the map: the ride's road ahead, the fleet's roads, a journey's legs | polylines; a leg measures its stops onto the road by projection | no | no | unchanged |
| Shape acceptance (`pipeline/shapes.py`, reports against the polyline) and the motion evaluations (`scripts/evaluate-*.mjs`) | polylines, and offsets as positions | no | no | unchanged |

## The format

The shape file keeps `stopOffsets` (positions in road order, for the drawing) and gains:

```json
"stopMapping": {"version": 2, "patternId": "BNML:15:inbound:9c10700c6c", "patternStopCount": 61,
                "source": "router requests",
                "occurrences": [{"index": 14, "stop": "1800SJ03131", "offset": 0.0}, …]},
"stopMappingCheck": {"version": 2, "source": "router requests", "worstStopMetres": 9.0}
```

- **An occurrence is one visit.** A stop called at twice has two occurrences, each on its own index. BNSM
  56 outbound loops through six stops twice (stops 20–25 and 37–42).
- **Clipped routes are exact.** Stops outside the area simply have no occurrence, at either end or in
  between.
- **`index.json`** has `schemaVersion` 2, `stopMappingVersion` 2 and a note, and is otherwise unchanged.
  Every page reads it, so the checks stay in the shape files: it grew by 278 bytes compressed. A shape file
  grew by about 400 bytes compressed, and is fetched one bus at a time.

## The rules a reader applies

A mapping is used only when **all** of these hold, and is otherwise refused:
- its version is 2;
- its pattern is the pattern held;
- its stop count is the pattern's;
- every occurrence's stop code is the pattern's at that index;
- the indices strictly increase;
- the offsets do not go backwards and lie on the road.

Nothing is ever paired by list position again, and nothing is inferred from which stops are in the area
today.

**Old and new files cannot be combined silently:**
- **A shape published before version 2** has no mapping, and readers refuse it (no arrival track, no
  passages).
- **Passage files** carry `stopMapping: 2`. The evaluator refuses one without it
  (`scripts/evaluate-arrival.py`, `passages_from`).
- **Nightly entries** carry `stopMapping: 2`. The release check counts no night without it; those are
  listed in `skippedNights`.
- **A page from before this change** reads `stopOffsets` exactly as before. It paired nothing by position
  that anyone saw, because its arrival estimate was never released.

## Where a mapping comes from, and the independent check

- **A build since 28 September 2026** records each routed stop's index as it routes (`corridor_patterns`
  ranks the pattern's full stop list; `from_placed`).
- **The 560 shapes published before then** were given theirs from their own stored routing requests
  (`python -m pipeline.shapes map`). Each request's locations are the routed stops' coordinates, in
  order. All 1,977 requests are kept in `data/raw/shapes` by SHA-256.

Either way, a mapping is published only if it survives a check on geometry it did not come from. Each
mapped stop's own published coordinates must lie within 30 m of the road at the offset the mapping gives
it.

**The migration, 28 September 2026:**

| Measure | Result |
|---|---|
| Shapes mapped | 560 of 560, none refused |
| Stops checked | 15,960 |
| Distance from the road at the mapped offset | median 6.5 m, 99th percentile 12.7 m, worst 15.7 m |
| Shapes whose mapping differs from list position | 284 |
| Their worst stop, read by position instead | a median 1,047 m away |

Each shape file changed only by the two added keys. The arrival evaluation re-run on the server's copy
with the mapping gave identical passages and identical results on all 8 days to the correctly paired run.
It also showed that the page and the evaluator read the same stops (`docs/MILESTONE_2026-09-28_ARRIVAL_PILOT.md`
§1).

**Checks:**
- `tests/test_stop_mapping.py`:
  - recovery from requests with a clipped start, a gap and a loop;
  - every refusal;
  - the build's indices on a small warehouse;
  - the real inbound 15 shape, including the check that refutes its old reading;
  - the evaluator refusing an old passage file.
- `tests/stop-mapping.test.mjs`:
  - every published shape against its pattern;
  - the geometry re-checked in TypeScript;
  - inbound 15;
  - BNSM 56's loop;
  - BNFM 708's gap;
  - every refusal.
