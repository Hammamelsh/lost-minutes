# Documentation index

## Start here

| | |
|---|---|
| [`../README.md`](../README.md) | what the project is, how it works, its guarantees and limits |
| [`EVIDENCE.md`](EVIDENCE.md) | each claim, its implementation, the check behind it, and whether a fresh clone can reproduce it |
| [`SETUP.md`](SETUP.md) | the credential-free demo and live collection, step by step |
| [`case-studies/01-ingestion-identity-and-recovery.md`](case-studies/01-ingestion-identity-and-recovery.md) | observation identity, provenance, conflicts, and what survives a crash |
| [`case-studies/02-latency-investigation.md`](case-studies/02-latency-investigation.md) | measuring where a report's age went, and the one change it justified |
| [`case-studies/03-arrival-evaluation.md`](case-studies/03-arrival-evaluation.md) | an arrival estimate built, evaluated, and kept off the page |
| [`case-studies/04-operational-failures.md`](case-studies/04-operational-failures.md) | production failures, reproduced and fixed |

## Current reference

| | |
|---|---|
| [`RELEASE.md`](RELEASE.md) | the release record, newest first: what is deployed, what was verified, by commit |
| [`BACKLOG.md`](BACKLOG.md) | every reported or found fault, its cause and status, with corrections kept |
| [`PIPELINE.md`](PIPELINE.md) | table grain, recovery semantics, validation checks, freshness |
| [`../PROJECT_CONTEXT.md`](../PROJECT_CONTEXT.md) | the working log: dated progress, data definitions, known limitations |
| [`MOTION_MODEL.md`](MOTION_MODEL.md) | how a bus is drawn between its reports, and the estimate's evaluation |
| [`JOURNEY_STATE.md`](JOURNEY_STATE.md) | what the page remembers, where, and the screens in the browser's history |
| [`STOP_MAPPING.md`](STOP_MAPPING.md) | the explicit, versioned mapping of stops to road offsets |
| [`ARRIVAL_RELEASE_CRITERIA.md`](ARRIVAL_RELEASE_CRITERIA.md), [`ARRIVAL_DISPLAY_PROTOCOL.md`](ARRIVAL_DISPLAY_PROTOCOL.md) | the criteria (written before results) and the frozen protocol |
| [`LIVE_DEPARTURES_FEASIBILITY.md`](LIVE_DEPARTURES_FEASIBILITY.md) | live departure times from NextBuses, now run by TransportAPI: what is published, what is unverified, and the smallest pilot (2 October 2026) |
| [`ENGINEERING_OPPORTUNITIES.md`](ENGINEERING_OPPORTUNITIES.md) | recurring friction that could justify tooling, with evidence and status |
| [`PHYSICAL_DEVICE_CHECKLIST.md`](PHYSICAL_DEVICE_CHECKLIST.md) | what only a phone in hand can answer; none of it is checked yet |
| [`../deploy/README.md`](../deploy/README.md) | the server's units, install, deploy, rollback and memory limits |
| [`PROVISIONING.md`](PROVISIONING.md) | the runbook used to provision the server on 20 September 2026; still the runbook for a new one |
| [`CONNECTION_WALKTHROUGH.md`](CONNECTION_WALKTHROUGH.md) | a ten-minute walkthrough for a first-time tester of two-bus journeys |
| [`PHOTO_3D_PREVIEW.md`](PHOTO_3D_PREVIEW.md), [`PHOTO_3D_RESEARCH.md`](PHOTO_3D_RESEARCH.md), [`PHOTO_3D_TERMS.md`](PHOTO_3D_TERMS.md) | a photographic view kept behind a password, its research and the open terms question |
| [`TFGM_APPROACH.md`](TFGM_APPROACH.md) | drafts for approaching TfGM; nothing has been sent |

## Milestone records

Dated accounts of each piece of work, as they were written; later corrections are noted in them and in
`BACKLOG.md`: [`MILESTONE_2026-09-21_EVENING.md`](MILESTONE_2026-09-21_EVENING.md),
[`MILESTONE_2026-09-22_JOURNEYS.md`](MILESTONE_2026-09-22_JOURNEYS.md),
[`MILESTONE_2026-09-22_WORKSPACE.md`](MILESTONE_2026-09-22_WORKSPACE.md),
[`MILESTONE_2026-09-23_RIDE_AND_DEPARTURES.md`](MILESTONE_2026-09-23_RIDE_AND_DEPARTURES.md),
[`MILESTONE_2026-09-23_SHEET_PACING_DISCOVERY.md`](MILESTONE_2026-09-23_SHEET_PACING_DISCOVERY.md),
[`MILESTONE_2026-09-25_ONE_RIDE.md`](MILESTONE_2026-09-25_ONE_RIDE.md),
[`MILESTONE_2026-09-25_NIGHT_FLEET.md`](MILESTONE_2026-09-25_NIGHT_FLEET.md),
[`MILESTONE_2026-09-26_SIMPLER.md`](MILESTONE_2026-09-26_SIMPLER.md),
[`MILESTONE_2026-09-26_PREVIEW_AND_JUMPS.md`](MILESTONE_2026-09-26_PREVIEW_AND_JUMPS.md),
[`MILESTONE_2026-09-27_ROADS_MEMORY_REASONS.md`](MILESTONE_2026-09-27_ROADS_MEMORY_REASONS.md),
[`MILESTONE_2026-09-28_CONNECTION.md`](MILESTONE_2026-09-28_CONNECTION.md),
[`MILESTONE_2026-09-28_RELIABILITY.md`](MILESTONE_2026-09-28_RELIABILITY.md),
[`MILESTONE_2026-09-28_ARRIVAL_PILOT.md`](MILESTONE_2026-09-28_ARRIVAL_PILOT.md),
[`MILESTONE_2026-09-29_CORRECTIONS.md`](MILESTONE_2026-09-29_CORRECTIONS.md),
[`MILESTONE_2026-09-29_CLOSEOUT.md`](MILESTONE_2026-09-29_CLOSEOUT.md).

## Historical: superseded, kept as written

Each carries a note at its top saying what superseded it.

| | written | superseded by |
|---|---|---|
| [`REVIEW.md`](REVIEW.md) | an assessment of the original export, 12 September 2026 | the current state in `RELEASE.md` |
| [`CLAUDE_HANDOFF.md`](CLAUDE_HANDOFF.md) | the first session's handoff, 12 September | `AGENTS.md`, `CLAUDE.md` |
| [`EXPORT_VERIFICATION.md`](EXPORT_VERIFICATION.md), [`MAP_REPAIR_VERIFICATION.md`](MAP_REPAIR_VERIFICATION.md) | 12–13 September checks | `RELEASE.md`, `EVIDENCE.md` |
| [`LOCAL_VERIFICATION.md`](LOCAL_VERIFICATION.md) | local results, 12–18 September | `RELEASE.md` |
| [`MILESTONE_CHECKLIST.md`](MILESTONE_CHECKLIST.md) | requirement checklists, 13–21 September | the milestone records and `RELEASE.md` |
| [`HOSTING.md`](HOSTING.md) | the hosting proposal before anything was bought | the server that has run since 20 September (`RELEASE.md`) |
| [`OBSERVATION.md`](OBSERVATION.md) | a planned 48-hour observation, never run as a separate exercise | continuous operation since 20 September; case study 4 |
| [`PASSENGER_TEST.md`](PASSENGER_TEST.md) | the first trial's script, 17 September | the interface has changed since; `CONNECTION_WALKTHROUGH.md` |
| [`COVERAGE.md`](COVERAGE.md) | coverage measured 17–18 September | the served catalogue's coverage block (`EVIDENCE.md`) |
| [`DEPARTURE_DATA.md`](DEPARTURE_DATA.md) | departure-data research, 22 September | `LIVE_DEPARTURES_FEASIBILITY.md` |
| [`NEXT_PROJECT.md`](NEXT_PROJECT.md) | a decision note on what to build next, 17 September | — |
| [`INSPIRATION_RESEARCH.md`](INSPIRATION_RESEARCH.md), [`LOST_MINUTES_REDESIGN_RESEARCH.md`](LOST_MINUTES_REDESIGN_RESEARCH.md) | design research, 12–14 September | the built interface |
| [`../research/IMPLEMENTED.md`](../research/IMPLEMENTED.md) | the implementation record to 14 September | `RELEASE.md` |
