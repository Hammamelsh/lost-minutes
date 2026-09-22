"""Republish past moments from retained position captures.

    .venv/bin/python -m pipeline.replay_publications \
        --captures /path/to/captures --db /path/to/scratch.duckdb \
        --out reel.json --vehicle MF74NNL

Each capture is loaded in the order it was fetched, and after every one the live state is
assembled exactly as the collector assembles it — the same matcher, the same trails, the same
freshness policy — at that capture's own ResponseTimestamp. The result is the sequence of
publications a phone was served over that window, rebuilt from the raw bytes rather than
described from memory.

It never writes to the project's warehouse unless `--db` names it, and it publishes nothing:
the reel is a file for `scripts/probes/movement-replay.mjs` to play back.

Why this exists: a movement fault reported by a passenger is a moment, and the moment has
passed. Without this the only way to look at it again is to wait for a similar one and hope,
which is not evidence. `restore.py` already proves the captures can be read back; this adds the
one step that makes them answer a question about the page.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from .core import SERVICE_AREA, parse_source
from .live import LIVE_KIND, build_live
from .restore import ROOT, response_timestamp
from .warehouse import (DEFAULT_DB, claim_source, connect, finish_run, load_observations,
                        record_raw_source, start_run)



def replay(captures, db_path, vehicles=(), log=print):
    files = sorted(Path(captures).glob('*.bin.gz'), key=lambda p: p.stat().st_mtime)
    con = connect(db_path)
    publications, skipped = [], {'corrupt': 0, 'undated': 0, 'malformed': 0}
    try:
        run_id = start_run(con, 'capture_reload', is_historical=True,
                           note=f'replay from {captures}: publications rebuilt for past moments')
        for path in files:
            body = gzip.decompress(path.read_bytes())
            digest = hashlib.sha256(body).hexdigest()
            if digest != path.name.split('.')[0]:
                skipped['corrupt'] += 1
                continue
            stated = response_timestamp(body)
            if not stated:
                skipped['undated'] += 1
                continue
            try:
                records, rejected, stats = parse_source(body, digest, stated, SERVICE_AREA)
            except Exception:                                            # noqa: BLE001
                skipped['malformed'] += 1
                continue
            claim_source(con, run_id, digest, path.name, True)
            record_raw_source(con, run_id, sha256=digest, kind=LIVE_KIND, url=None,
                              stored_path=path.name, byte_size=len(body),
                              captured_at=stated, retrieved_at=stated)
            load_observations(con, run_id, digest, records, rejected,
                              stats['activitiesTotal'], stats['outsideArea'],
                              stats.get('quarantined', ()))
            at = stated if hasattr(stated, 'astimezone') else datetime.fromisoformat(stated)
            at = at.astimezone(timezone.utc)
            payload = build_live(con, published_at=at)
            if vehicles:
                payload['vehicles'] = [v for v in payload['vehicles'] if v['vehicle'] in vehicles]
            publications.append({'receivedAtMs': int(at.timestamp() * 1000), 'live': payload})
            if len(publications) % 25 == 0:
                log(f'  {len(publications)} publications, last {at.isoformat()}')
        finish_run(con, run_id, 'succeeded')
    finally:
        con.close()
    return publications, skipped


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--captures', required=True)
    parser.add_argument('--db', default=str(ROOT / DEFAULT_DB))
    parser.add_argument('--out', required=True)
    parser.add_argument('--vehicle', action='append', default=[],
                        help='keep only these vehicles in the reel (repeatable)')
    args = parser.parse_args(argv)
    publications, skipped = replay(args.captures, args.db, tuple(args.vehicle))
    Path(args.out).write_text(json.dumps({
        'recordedFrom': f'retained captures at {args.captures}',
        'rebuiltBy': 'pipeline.replay_publications',
        'startedAtMs': publications[0]['receivedAtMs'] if publications else None,
        'endedAtMs': publications[-1]['receivedAtMs'] if publications else None,
        'skipped': skipped, 'publications': publications}))
    print(json.dumps({'publications': len(publications), 'skipped': skipped, 'out': args.out}))
    return 0


if __name__ == '__main__':
    sys.exit(main())
