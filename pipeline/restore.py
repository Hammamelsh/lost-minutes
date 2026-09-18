"""Read the preserved position captures back into the warehouse.

    .venv/bin/python -m pipeline.restore                       # every capture held
    .venv/bin/python -m pipeline.restore --captures /path/copy  # from a backup copy
    .venv/bin/python -m pipeline.restore --limit 50 --db /tmp/scratch.duckdb

Why this exists. `deploy/backup.sh` copies `data/live-capture/` because the raw SIRI-VM
responses cannot be collected twice: the feed has no history. Until this module, nothing could
read them back, so the copy was files without a door. A backup you cannot restore from is not a
backup, and saying otherwise in a hosting document would have been the kind of claim this project
exists not to make.

Two things it is careful about.

**Integrity is proved, not assumed.** Every capture is named by the SHA-256 of its own bytes, so a
restored copy is verified against its filename before anything is read from it. A file that does
not match is counted and skipped, never loaded.

**The three clocks stay apart.** A restored capture carries the producer's own
`ResponseTimestamp` and nothing else about time. The moment *this* collector fetched it lived only
in the warehouse that was lost, so it is not reinvented: the producer's response time is used as
both the capture and retrieval time, and the run records that it did so. Observation identity does
not include the retrieval time — it is (operator, vehicle, route, direction, journey reference,
observation time) — so a restore reproduces exactly the same observations, and `load_observations`
is idempotent, which makes running this over captures already held a no-op rather than a
duplication.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import re
import sys
from pathlib import Path

from .core import SERVICE_AREA, parse_source
from .warehouse import (DEFAULT_DB, claim_source, connect, finish_run, load_observations,
                        record_raw_source, start_run)

ROOT = Path(__file__).resolve().parents[1]
CAPTURES = Path('data/live-capture/positions')
LIVE_KIND = 'live_positions'
# The producer's own time for the response, the first one in the document. Read from the head of
# the payload rather than by parsing the whole tree: these files are megabytes.
RESPONSE_TIME = re.compile(rb'<ResponseTimestamp>\s*([0-9T:.+\-]{20,40})\s*</ResponseTimestamp>')
HEAD_BYTES = 4096


def response_timestamp(body):
    """The producer's ResponseTimestamp, or None if the payload does not carry one."""
    found = RESPONSE_TIME.search(body[:HEAD_BYTES])
    return found.group(1).decode('ascii') if found else None


def restore(root=ROOT, captures=None, db_path=None, limit=None, log=print):
    root = Path(root)
    directory = Path(captures) if captures else root / CAPTURES
    files = sorted(directory.glob('*.bin.gz'))
    if limit:
        files = files[:limit]
    con = connect(db_path or root / DEFAULT_DB)
    summary = {'captures': len(files), 'loaded': 0, 'corrupt': 0, 'undated': 0, 'malformed': 0,
               'observationsNew': 0, 'observationsRepeat': 0, 'conflicts': 0}
    try:
        run_id = start_run(
            con, 'capture_reload', is_historical=True,
            note=f'restore from {directory}: retrieval times are the producer\'s own '
                 'ResponseTimestamp, because the original retrieval times were not in the '
                 'restored set')
        for path in files:
            body = gzip.decompress(path.read_bytes())
            digest = hashlib.sha256(body).hexdigest()
            if digest != path.name.split('.')[0]:
                summary['corrupt'] += 1
                log({'capture': path.name[:12], 'outcome': 'sha256_mismatch'})
                continue
            stated = response_timestamp(body)
            if not stated:
                # No time we are willing to stand behind, and inventing one would put a made-up
                # figure into the one place this project promises not to.
                summary['undated'] += 1
                log({'capture': digest[:12], 'outcome': 'no_response_timestamp'})
                continue
            try:
                records, rejected, stats = parse_source(body, digest, stated, SERVICE_AREA)
            except Exception as error:                                   # noqa: BLE001
                summary['malformed'] += 1
                log({'capture': digest[:12], 'outcome': 'malformed',
                     'errorClass': type(error).__name__})
                continue
            claim_source(con, run_id, digest, path.name, True)
            record_raw_source(con, run_id, sha256=digest, kind=LIVE_KIND, url=None,
                              stored_path=path.relative_to(root) if path.is_relative_to(root) else path.name,
                              byte_size=len(body), captured_at=stated, retrieved_at=stated)
            counts = load_observations(con, run_id, digest, records, rejected,
                                       stats['activitiesTotal'], stats['outsideArea'],
                                       stats.get('quarantined', ()))
            summary['loaded'] += 1
            summary['observationsNew'] += counts['new']
            summary['observationsRepeat'] += counts['repeats']
            summary['conflicts'] += counts['conflicts']
        finish_run(con, run_id, 'succeeded')
        return summary
    finally:
        con.close()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--captures', help='directory of *.bin.gz position captures '
                                           '(default data/live-capture/positions)')
    parser.add_argument('--db', help='warehouse to load into (default the project\'s)')
    parser.add_argument('--limit', type=int, help='read only the first N captures')
    args = parser.parse_args(argv)
    print(json.dumps(restore(captures=args.captures, db_path=args.db, limit=args.limit)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
