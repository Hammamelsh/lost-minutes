# What to build next: a short decision note

Written 17 September 2026, after the Lost Minutes beta work. Two candidates were compared. The
recommendation is neither of them as a separate product.

## The evidence, from both opportunity logs

The "Data Release Inspector" question — *is what is being served the thing the checks validated,
and if not, how does it differ?* — is not one project's irritation. It appears five times across
two unrelated stacks:

| Where | Entry | The instance |
|---|---|---|
| Energy Reconciliation (dbt, DuckDB, Streamlit) | EO-01 | a build record that no longer described the tables it certified: three ways a candidate could be sealed on a success record that did not describe it |
| Energy Reconciliation | EO-02 | an application reading an output other than the one it believed it was reading — one of them a runtime incident |
| Energy Reconciliation | EO-03 | proving two builds agree, or explaining exactly how they differ, when logic moved from Python to dbt |
| Lost Minutes (Python, DuckDB, static JSON) | 22 | a content-addressed snapshot store with no head pointer: route 15's published journeys doubled from 280 to 560 with no new journey existing |
| Lost Minutes | 23 | a published artefact could shrink to almost nothing and be served, because a failed download and a withdrawn service are indistinguishable from inside |

Two different shapes of system, the same question. That is a stronger signal than five instances in
one repository would be.

## Does something already answer it?

Read from primary documentation, 17 September 2026:

* **dbt artifacts** (`manifest.json`, `run_results.json`, `freshness.json`) describe *the run*.
  dbt's own documentation lists their uses — docs, state comparison, freshness visualisation, test
  coverage — and offers nothing that compares them with what a downstream consumer is actually
  serving. <https://docs.getdbt.com/reference/artifacts/dbt-artifacts>
* **Elementary** monitors a warehouse through dbt: volume and freshness anomalies, schema changes,
  test results, column lineage. It requires dbt and a supported warehouse, and states it never
  accesses raw data. A static JSON file a web page fetches is outside it.
  <https://docs.elementary-data.com/>
* **Dagster asset checks** can gate: with `blocking=True`, a failed check stops the downstream
  asset materialising. That is the strongest existing answer — *inside Dagster*. It says nothing
  about what a web server is serving an hour later.
  <https://docs.dagster.io/guides/test/asset-checks>
* **SLSA provenance / in-toto attestations** are exactly this shape — "verify that the artifact was
  built according to expectations" — and are specified for software builds, not data artefacts.
  <https://slsa.dev/spec/v1.0/provenance>
* **Datafold** and **Great Expectations** were not read in full. Datafold's data diff answers EO-03
  (do two builds agree) and is the closest commercial answer to that row alone.

**Conclusion: the gap is real but narrow.** It is not a new category. It is the observation that
data artefacts do not get the build-provenance treatment software already has, and that the
existing data-quality tools all assume a warehouse rather than a served file. Nothing here would
justify claiming novelty.

## Candidate A: a Data Release Inspector

*Intended user:* someone publishing artefacts from a pipeline to something that serves them —
a static site, an API cache, a file drop.

*Portfolio value:* moderate. It shows judgement and packaging, which two finished projects already
show. It shows none of the skills a Data Engineer job advertisement names.

*Verdict:* **do not build it as a product.** Build it as a function. `publish_guard(target,
candidate, floors)` already exists in embryo in `pipeline/patterns.py` (the shrink refusal). Apply
it to `live.json`, `stops.json` and the road shapes, record each refusal as a run, and the itch is
scratched for about a hundred lines. If a third project meets the same problem, extract it then,
with three instances behind it instead of an argument.

## Candidate B: Spark, backfill and orchestration

*The actual gap.* Job advertisements name Airflow or Dagster, Spark, partitioning and backfills.
Neither project has any of them. Both were built as single-process Python, correctly, because
nothing needed more.

*What makes it honest here, rather than decorative.* Lost Minutes now has the dataset and the
requirement:

* raw captures accumulate at a measured **0.13 GB a day, about 540,000 observations a day**. A year
  is roughly 47 GB and 200 million rows — past comfortable single-process reprocessing, which is a
  real boundary rather than an excuse to import PySpark;
* **a genuine backfill requirement appeared today.** The matcher changed: a refusal that used to
  read `no_pattern_for_direction` now reads `no_pattern_for_direction_today`, and the pattern
  catalogue was rebuilt. Every historical match in the warehouse is now stale. Re-deriving them from
  the preserved raw captures is a partitioned, idempotent, day-by-day backfill of exactly the kind
  orchestration exists for;
* the dependency graph is real and already documented: timetable rebuild → re-match → publish, with
  one writer.

`docs/REVIEW.md` warns against adding Spark to a tiny sample for appearance. This is not that. The
test to hold it to: **if a partitioned reprocess of a month is not meaningfully faster or simpler
than a loop, do not keep Spark.**

## Recommendation

**Candidate B, as an extension of Lost Minutes, not a third product.** Turn the existing raw-capture
archive into a partitioned Parquet lake and re-derive matches from it under an orchestrator, with
backfill. Take Candidate A as a hundred-line guard inside the same work.

*First milestone, bounded:* one Dagster (or Airflow) asset graph with **day partitions** over
`data/live-capture/`, re-deriving observations and matches for a chosen day into Parquet, with a
blocking asset check for row-count and reconciliation, runnable as a backfill over a week of real
captures. No new product, no new repository, no hosting.

*Smallest validation experiment, before any of that:* reprocess **one day** of preserved captures
with the current Python, time it, and record peak memory. If a day takes minutes and a month takes
hours, the partitioned lake is justified and Spark can be argued for on the month. If a month takes
minutes, say so, drop Spark, and do the orchestration and backfill parts anyway — they are the
skills most often asked for, and they are honest at any scale.

*What would change this recommendation:* a third instance of the Candidate A problem in a system
neither of these two resembles, or a job offer that names data-quality tooling rather than
pipelines.
