# Lost Minutes

Explore a real, recorded slice of Manchester bus movement. Choose a route and direction,
select a bus, scrub through the recording, and inspect the exact source behind a point.

## Working now

- A responsive React/TypeScript map and replay interface, with real OpenStreetMap roads.
- An 11-snapshot public BODS archive sample from 11 September 2026, approximately
  08:00–08:10 British Summer Time.
- 3,426 accepted observations across 419 vehicle/journey tracks in the selected area.
- Deduplication, invalid-observation rejection, conflict suppression, source fingerprints,
  explicit archive labels and source-age handling.
- A Python archive importer and a separate credentialed, bounded live collector.

This is a first working release. It is **not a live service or validated delay monitor**.
Timetable matching, stop passage inference and scheduled-service coverage remain open.
Tracks are reconstructed by observation time from sampled archive responses. They do not
represent a complete stream of what was known at every moment.

## Run locally in VS Code / WSL

Node 22.13+ (Node 24 recommended for the included TypeScript test command), pnpm as
specified in package.json, and Python 3.11+. Open THIS folder, not original-source.zip.
No BODS key is required for the included archive replay.

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Open http://localhost:3000. For checks and a standalone production export:

```bash
pnpm test
python3 -m unittest discover -s tests -v
pnpm build
pnpm typecheck
```

`pnpm build` writes `out/`, which can be hosted independently as static files at the root
of your own domain. `pnpm start` serves it locally using Python. GitHub holds the source;
the website host serves the built output. This copy has no ChatGPT hosting requirement.
GitHub Pages under /lost-minutes/ needs explicit base-path and fetch-URL configuration;
the present build assumes a domain root. Backend collection must run separately.

To reproduce the sample, optionally run `python3 -m pipeline.import_archive`. It downloads
the eleven named snapshots, caches them under data/raw/, and regenerates the replay.
This is unnecessary just to run the website. Keep raw downloads out of Git.

Read docs/CLAUDE_HANDOFF.md for the next coding session, docs/REVIEW.md for the verified
critique and visual direction, and docs/EXPORT_VERIFICATION.md for actual export checks.

## Live capture

BODS account/API access is required and has **not** been exercised in this environment.
Set `BODS_API_KEY` in your local environment. Obtain the relevant timetable download URL
from BODS. The key must never be committed, pasted into frontend code or written to logs.

```bash
python -m pipeline.capture --help
python -m pipeline.capture --minutes 10 --timetable-url 'https://OFFICIAL_TIMETABLE_DOWNLOAD_URL'
```

Replace the explicitly marked URL with the real timetable link. The collector preserves
responses, logs successful and failed requests, redacts credential query parameters,
caches timetable versions by content hash and stops on an authentication rejection.
A successful HTTP capture does not mean the source passed semantic validation. The live
collector does not automatically replace the published archive or run indefinitely.

## Source and licensing

Bus data: Department for Transport and contributing operators, via Open Innovations /
National Data Library, under the Open Government Licence v3.0:
https://data.datalibrary.uk/transport/BODS-ARCHIVE/
https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/

Road geometry: © OpenStreetMap contributors, Open Database Licence 1.0. The selected road
extract is in `public/data/roads.json`, including its source timestamp and attribution:
https://www.openstreetmap.org/copyright
The extract was obtained from the Overpass API. Road geometry is visual context and is not
used to assert that a bus followed a particular road between sampled positions.

## Where to look

- `pipeline/core.py`: parsing, compound observation identity, conflicts and publication.
- `pipeline/capture.py`: source preservation, redaction and bounded live collection.
- `pipeline/import_archive.py`: reproducible import of the retained public sample.
- `lib/replay.ts`: the frontend data contract and replay selection functions.
- `app/page.tsx`: interactive map, filters, timeline and evidence view.
- `research/source-verification.json`: measured sample results and source hashes.
- `research/IMPLEMENTED.md`: implemented capabilities and remaining work.

The owner learns while building. AI can implement changes; important definitions and
claims must remain understandable, tested and supported by source evidence.
