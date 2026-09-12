# Claude Code handoff

## Owner and working approach
Hammam is a Manchester data engineer seeking stronger DE/AE/DS and applied AI evidence.
He already has an Energy Reconciliation portfolio project. Lost Minutes should add a
visually compelling, continuously operated public-data system. He uses AI for coding and
learns while working. Do not make learning a gate. Be economical with tokens and tool calls.
The previous assistant incorrectly chose ChatGPT Sites. That site is retained as a prototype;
this standalone repository is where future work belongs.

## First session — do this, then stop and report
1. Read AGENTS.md, README.md, docs/REVIEW.md and the current code.
2. Check Node, pnpm, Python and Git versions. Use the declared package manager and lockfile.
   Install missing local prerequisites only as needed. Do not upgrade all dependencies.
3. Run the frontend, the existing tests and the production build. Inspect it locally in a
   browser at desktop and mobile widths. Fix concrete portability/runtime problems.
4. Check .gitignore and staged content for secrets, raw downloads and generated output.
   Initialize a new local Git repository if needed; make a truthful baseline commit.
   Do not reuse any ChatGPT Site remote or change the deployed prototype.
5. Prepare it for the owner's GitHub repository named lost-minutes. If GitHub authentication
   and account are available, identify them; otherwise state the exact one action needed.
   Do not publish a public repo or website without the owner's instruction about visibility.
6. Explain in plain English which code is ingestion, which is validation and which is UI.
   Report what actually passed and any blocker. No redesign or cloud provisioning yet.

## Implementation sequence after the baseline
A. Operate collection: choose a bounded area/feed, configure the owner's BODS key outside
Git, archive position responses and schedule versions from the start of live collection,
record capture time and observation time separately, track run outcomes and content hashes.
Add restart-safe checkpointing, bounded backoff, retention and cost/maintenance logging.
Start with one scheduled worker and durable storage, not several cloud platforms.

B. Model the history: immutable raw inputs -> validated observations -> analytical tables
-> published product snapshot. Use Python for ingestion/validation and SQL for explicit
models. DuckDB plus dbt is a reasonable local starting point, to be confirmed against
actual needs. Keep observation identity, input lineage, quarantine reasons and run ID.
An ingestion failure must not overwrite the last valid public snapshot. Show stale state.

C. Derive one useful measure: first validate a route/direction and two fixed corridor gates.
Bracket each crossing between consecutive observations. If crossing A is [a0,a1] and B is
[b0,b1], a conservative travel-time interval is [max(0,b0-a1), b1-a0], subject to verified
ordering/route membership. Report uncertainty; reject ambiguous loops, large gaps and
unmatched directions. A 10-minute sample may not contain an eligible complete traversal.
Collect more relevant data rather than inventing a number. Validate headways separately;
missing vehicles can make apparent gaps misleading. Do not call headways passenger waiting
time or excess waiting time without appropriate definitions and assumptions.

D. Make the engineering visible: an Operations view driven by actual run metadata shows
last successful collection, last successful publication, source age, rows in/out, duplicates,
quarantine counts and recovery/backfill outcomes. Collection success and data freshness are
different. Until timetable identity is validated, show volume changes relative to an observed
baseline; do not label them expected-service coverage. Feed freshness, observed volume and
reconciliation checks into one notification channel when that channel is configured.

E. Visual redesign: see REVIEW.md. A carefully composed corridor map, replay and a strong
measurement story should precede optional 3D. Use recorded movement, measured uncertainty
and real operational state for visual drama. Maintain a useful 2D/mobile/reduced-motion view.

F. Publish when reviewable: code on the owner's GitHub; a publicly readable website on a
host he chooses; public data only, no login required for portfolio viewers. The current
frontend builds to out/ and can be hosted statically. Collection runs separately and cannot
be operated continuously by a static host. Do not repeatedly push large raw archives into
Git. A repo-path deployment requires base-path and data URL handling; current paths assume
the site is served at the domain root. Document costs before provisioning paid infrastructure.

## Communication and claims
- Lead with completed work and a runnable result.
- Explain one record end-to-end when useful, without demanding a teach-back.
- Do not advertise streaming, live operation, punctuality, dbt, Spark or AI features before
  they are implemented and exercised. AI-assisted construction is not itself AI engineering.
- The eventual LinkedIn post should include a short actual demo, website/repo links, one
  evidenced engineering challenge, honest status and clear ownership of product decisions.
- Post only when instructed. Drafts may be prepared; do not invent adoption or impact.
