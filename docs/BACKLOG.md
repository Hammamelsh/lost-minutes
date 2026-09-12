# Backlog

Ideas worth keeping, in priority order, with the reason each is not being built yet. Nothing
here is implemented. The point of this file is to stop good ideas becoming scope creep.

## 1. Real live capture against BODS  — blocked on a credential
Everything is built and tested with fixtures. One registered key turns it on. Until a real
capture has run, no claim about live operation is made anywhere in the interface.

## 2. Somewhere to run the collector — needs a decision
The pipeline is a single local process. To be useful to a passenger it has to run while the
owner's laptop is closed, and the published objects have to be served from a host that is
not GitHub. Options and trade-offs belong in one decision, not in drip-fed infrastructure.
Not started: no paid service should be provisioned before the cost is written down.

## 3. Validated route and stop relationships — the gate for every measurement
Needed before ETAs, nearby stops, approaching-bus claims, headways or travel times can be
honest. Requires matching dated journeys to a timetable version and validating ordered route
geometry. Timetable storage with declared effective dates already exists; matching does not.

## 4. Corridor travel time with an interval, not a point estimate
Two fixed gates on one validated corridor, each crossing bracketed between consecutive
observations, published as a conservative interval with its uncertainty and coverage. Rejects
ambiguous loops, large gaps and unmatched directions. Depends on item 3.

## 5. Time–distance chart beside the map
Once route progress is validated, the geometry of the chart shows bunching and spreading
without a word of explanation. Depends on item 3.

## 6. Retention and storage budget for accumulating raw captures
Raw responses are a few megabytes each. Continuous collection needs a retention policy and a
recorded storage cost before it runs for weeks. Depends on item 2.

## 7. Alerting on freshness and volume
One notification channel fed by the existing run metadata: failed publication, stale source,
observed volume away from a baseline. Deliberately after item 2, because there is nothing to
alert on until collection runs unattended.

## 8. Smaller published state for mobile data
`replay.json` is 1.6 MB. The live state is small, but the archive replay is not. Worth
splitting per route, or serving a compact binary, once there is real traffic to measure.

## 9. Accessibility audit against a checklist
Contrast pairs were checked and touch targets are 44px, but no screen-reader pass, keyboard
trap audit or reduced-motion review against a formal checklist has been done.

## Explicitly not doing
- Spark, Kafka, a warehouse cluster or an orchestration platform for a dataset this size.
- An AI feature added to claim AI engineering. A model earns its place or stays out.
- Background location tracking, or any promise of continuous coverage.
- A second hosted prototype. One repository, one site.
