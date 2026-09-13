# Lost Minutes

Find your bus stop in Manchester and the walk to it, see which reported buses are timetabled
to call there and how old each report is, and follow one — at its reports, or at a clearly
labelled estimate between them; or explore a recorded slice of bus movement and inspect the
exact source behind a point.

## Project context

Lost Minutes is a personal data-engineering project by **Hammam Elshtewi**, a data engineer
in Manchester. It exists to show how public transport data is actually collected, validated
and published — end to end, with the evidence kept attached to every number on screen.

The design rule is that nothing on screen may claim more than the data supports. Every
published observation keeps its original timestamp, its raw source file and that file's
SHA-256 fingerprint, and any value the pipeline cannot justify is shown as unknown rather
than filled in. Counts are reconciled rather than asserted: the totals in the Evidence and
Operations views add up to the inputs they came from, including the records that were
rejected or suppressed and why.

Current stage: a local companion that collects the live feed on this machine in bounded runs
and places each bus on a timetabled stop pattern, or states why it cannot, plus a historical
replay of an 11-snapshot public archive sample, with a restartable DuckDB history of every
input, run and publication behind both. It is deliberately **not** a hosted live service, a
punctuality monitor or a delay predictor: no arrival time is predicted, progress is counted
from the nearest pattern stop without a measured error bound, and no scheduled time is shown.
Between reports, a bus on the three evaluated routes (15, 250 and 256) may be drawn at a
labelled estimate, computed on the device and never stored or published.
Roadmap work is tracked in `research/IMPLEMENTED.md`.

Data comes from the Department for Transport's Bus Open Data Service via the Open
Innovations / National Data Library archive (Open Government Licence v3.0), with road
geometry from OpenStreetMap (ODbL). Attribution and licensing are in full at the end of
this file.

## Working now

- A responsive React/TypeScript map and replay interface, with real OpenStreetMap roads.
- An 11-snapshot public BODS archive sample from 11 September 2026, approximately
  08:00–08:10 British Summer Time.
- 3,426 accepted observations across 419 vehicle/journey tracks in the selected area.
- Deduplication, invalid-observation rejection, conflict suppression, source fingerprints,
  explicit archive labels and source-age handling.
- A restartable DuckDB pipeline: raw bytes preserved outside Git and identified by
  SHA-256, one row per observation identity, per-run checkpoints, recorded rejection and
  conflict reasons, and reruns that add no duplicate analytical rows.
- Validate-then-swap publication: a candidate is checked as a whole and only then moved
  into place atomically, so a failed run leaves the last good snapshot serving.
- An Operations view driven by those records: collection, processing and publication times,
  source age, inputs, retained, repeats, conflicts, rejections, per-run outcomes, and every
  total reconciled against the history it came from.
- A mobile-first, stop-first Follow view: find a boarding point by location or search (with
  its side of the road and today's services), see the buses at it now and those coming to it
  in the timetable's stop order, follow one, and read the age of each report rather than a
  reassuring "last updated". An original map style in daylight and night themes, a City view
  and a ride-along with a generic 3D bus, each labelled for what it is.
- Walking guidance to the chosen boarding point: a pedestrian route from
  routing.openstreetmap.de (FOSSGIS e.V.'s OSRM foot profile), asked for only when the
  passenger chooses to, with their location rounded to about 10 m, and drawn on the map with
  its distance and time. A refused or inaccurate location, a stop too far to walk, and a
  router failure each say what happened; a straight line is never passed off as a route.
- Estimated movement between reports on evaluated routes. The estimate follows road
  geometry checked against the buses' own reports, at the speed of the bus's recent reports,
  eased off as the report ages, for a bounded time. Each new report corrects it smoothly. It
  is labelled "Estimated position" with the real report age and scored on held-out captures
  against the last report itself (Evidence tab). Showing reported positions only is one tap
  away.
- Timetable matching against TfGM TransXChange stop patterns: operator, timetable version,
  operating day and direction are checked before position, and branches the position cannot
  separate are kept unresolved rather than guessed.
- A single-writer live collector for one shared Manchester feed, with repeated-payload
  detection, bounded backoff and an evidence-led freshness policy. Phones read our published
  state; no device ever contacts the data service.
- Installable as a web app, with an offline state that says it is offline and keeps every
  cached observation's original timestamps.
- A Python archive importer and a separate credentialed, bounded live collector.

It is **not a hosted live service or a validated delay monitor**. Buses are matched to
timetabled stop patterns, not to individual journeys; stop passage is not inferred beyond the
nearest pattern stop, and there is no scheduled-time comparison or arrival prediction. An
estimated position is a drawing between reports, never evidence that a bus reached, left or
served a stop.
Tracks are reconstructed by observation time from sampled archive responses. They do not
represent a complete stream of what was known at every moment.

## Run locally in VS Code / WSL

Node 22.13+ (Node 24 recommended for the included TypeScript test command), pnpm as
specified in package.json, and Python 3.11+. Open THIS folder, not original-source.zip.
No BODS key is required for the included archive replay.

```bash
pnpm install --frozen-lockfile
pnpm dev          # the frontend alone
pnpm dev:live     # the frontend and the collector together; Ctrl-C stops both cleanly
```

`pnpm dev:live` reads the key from `.env` on the Python side only. It never reaches the
browser: verified by searching the served HTML, every JavaScript chunk and the static build
for the key and finding it in none of them.

Open http://localhost:3000. The site reads two published JSON files and needs no Python
and no API key. To run the pipeline that produces them, create the local environment once:

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m pipeline.run import      # fetch what is missing, load, publish
.venv/bin/python -m pipeline.run status      # refresh and print the Operations payload
```

`import` is safe to repeat and safe to interrupt. See docs/PIPELINE.md for the table grain,
the recovery semantics and the validation checks, and PROJECT_CONTEXT.md for the whole
picture. For checks and a standalone export:

```bash
pnpm test
python3 -m unittest discover -s tests -v          # parser tests, no DuckDB needed
.venv/bin/python -m unittest discover -s tests -v # adds the pipeline history tests
pnpm build
pnpm typecheck
scripts/setup-browser.sh                          # once: browser libraries, no root needed
pnpm test:browser                                 # the built site in a real browser with WebGL
```

`pnpm build` writes `out/`, which can be hosted independently as static files at the root
of your own domain. `pnpm start` serves it locally using Python. GitHub holds the source;
the website host serves the built output. This copy has no ChatGPT hosting requirement.
GitHub Pages under /lost-minutes/ needs explicit base-path and fetch-URL configuration;
the present build assumes a domain root. Backend collection must run separately: `deploy/`
holds a ready but unprovisioned server configuration (Caddy with HTTPS, the collector and a
nightly timetable rebuild under systemd), described in deploy/README.md and costed in
docs/HOSTING.md.

To reproduce the sample, optionally run `python3 -m pipeline.import_archive`. It downloads
the eleven named snapshots, caches them under data/raw/, and regenerates the replay.
This is unnecessary just to run the website. Keep raw downloads out of Git.

Read docs/PIPELINE.md for the data model and recovery behaviour, docs/REVIEW.md for the
verified critique and visual direction, docs/LOCAL_VERIFICATION.md for measured local
results, docs/EXPORT_VERIFICATION.md for the original export checks, and
docs/CLAUDE_HANDOFF.md for the working approach.

## Live capture

Bounded live captures have run on the owner's machine with a registered key (12 and 13
September 2026); the measured results are in docs/LOCAL_VERIFICATION.md. A checkout without a
key publishes an honest `unavailable` state instead, and the interface says so rather than
pretending.

### Setting up a key, exactly

1. Register free at <https://data.bus-data.dft.gov.uk/account/signup/> and copy the API key
   from your account page. Consumers of the location API must be registered.
2. Put it in a local `.env` at the repository root:

   ```bash
   cp .env.example .env
   # then edit .env and set BODS_API_KEY=your-key
   ```

   `.env` is ignored by Git. `pipeline/env.py` loads it when the collector starts; a value
   already exported in your shell always wins over the file. Only the *names* loaded are
   ever printed — never the values.
3. Run a bounded capture:

   ```bash
   .venv/bin/python -m pipeline.collect --minutes 10
   .venv/bin/python -m pipeline.collect --minutes 10 --timetable-url 'https://OFFICIAL_URL'
   ```

Never paste the key into a command, a source file, a commit or a browser asset. The
collector redacts credential query parameters from everything it records, so the stored URL
reads `api_key=[REDACTED]`.

### What the collector does

One writer at a time, enforced by a lock: a second run refuses to start rather than
interleave. Each cycle is recorded with its outcome — `succeeded`, `repeat_payload`,
`http_error`, `transport_error` or `malformed`. Identical bytes are recorded as a repeat and
do **not** make the data look newer. Failures back off, bounded; an authentication rejection
stops collection. Timetable versions are stored by content hash with their declared
effective dates where the file states them — holding a timetable is not evidence that any
journey has been matched to it.

Every run records why it ended: its time limit, a stop signal (SIGINT, SIGTERM or SIGHUP),
rejected credentials, or an exception. A run left `running` by an abrupt stop is closed by the
next collector as `interrupted`, exit reason `abandoned`, at its last cycle, and no cause is
guessed. The page labels a time-limited run as a local run with its end time, never as an
always-on service.

Operators must publish vehicle locations every 10–30 seconds, so the poll interval has a
10-second floor: anything faster mostly returns a payload we already hold.

Local execution stops when this machine stops. There is no scheduler and no hosted worker,
so nothing in the interface is labelled continuously live.

## Source and licensing

Bus data: Department for Transport and contributing operators, via Open Innovations /
National Data Library, under the Open Government Licence v3.0:
https://data.datalibrary.uk/transport/BODS-ARCHIVE/
https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/

Road geometry: © OpenStreetMap contributors, Open Database Licence 1.0. The selected road
extract is in `public/data/roads.json`, including its source timestamp and attribution:
https://www.openstreetmap.org/copyright
The extract was obtained from the Overpass API. It is visual context and is not used to assert
that a bus followed a particular road between sampled positions.

Bus route shapes for the evaluated routes (`public/data/shapes/`) were generated from
OpenStreetMap data (ODbL) by the FOSSGIS Valhalla service, and kept only where observed reports
lie close to them. They carry labelled estimates between reports and are not evidence that a
bus followed that road.

Walking routes come from routing.openstreetmap.de (FOSSGIS e.V., OSRM foot profile, over
OpenStreetMap data under the ODbL). They are asked for only when the passenger chooses to, with
the passenger's location rounded to about 10 m, and the service logs requests under its own
policy. The router is runtime configuration: `LM_WALKING_ROUTER` names another, or `none`
switches walking routes off.

## Where to look

- `pipeline/core.py`: parsing, compound observation identity, conflicts and rejection.
- `pipeline/warehouse.py`: the DuckDB schema, SQL transformations and run bookkeeping.
- `pipeline/run.py`: the orchestrator, checkpointing and restart recovery.
- `pipeline/publish.py`: candidate build, validation checks and the atomic swap.
- `pipeline/operations.py`: the Operations payload and the reconciliation identities.
- `pipeline/collect.py`: the single-writer live collector and its per-cycle record.
- `pipeline/freshness.py`: the freshness policy and the measurements that justify it.
- `pipeline/live.py`: the small published state every device refreshes.
- `pipeline/capture.py`: source preservation, redaction and bounded fetching.
- `lib/replay.ts`, `lib/operations.ts`, `lib/live.ts`: the frontend data contracts.
- `components/follow-view.tsx`: the passenger view, favourites and the route-fitted map.
- `lib/motion.ts`: reports, the estimate and the drawn position, kept apart;
  `scripts/evaluate-motion.mjs` scores the estimate on held-out captures.
- `lib/walking.ts`, `components/walk-guide.tsx`: walking routes, consent and every failure state.
- `pipeline/shapes.py`: road shapes for service patterns, validated against observed reports.
- `app/page.tsx`, `components/operations-view.tsx`: replay, evidence and operations views.
- `research/source-verification.json`: measured sample results and source hashes.
- `research/IMPLEMENTED.md`: implemented capabilities and remaining work.

The owner learns while building. AI can implement changes; important definitions and
claims must remain understandable, tested and supported by source evidence.
