"""Run the pipeline: ingest raw sources, load the warehouse, publish if valid.

    .venv/bin/python -m pipeline.run import      # fetch what is missing, load, publish
    .venv/bin/python -m pipeline.run reprocess   # reload cached sources, then publish
    .venv/bin/python -m pipeline.run publish     # rebuild and republish from the warehouse
    .venv/bin/python -m pipeline.run status      # print the Operations summary

One process, one DuckDB file, no scheduler. When this machine stops, the pipeline stops.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from .capture import fetch
from .core import atomic_json, parse_source, utc_now
from .operations import write_operations
from .publish import build_snapshot, publish
from .warehouse import (abandoned_runs, claim_source, connect, fail_source, finish_run,
                        load_observations, mark_interrupted, record_raw_source, start_run,
                        unfinished_sources, warehouse_totals)

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE_KIND = 'archive_positions'
REQUEST_SPACING = 1.1  # the archive publisher permits at most one request a second


class SimulatedCrash(RuntimeError):
    """Fault injection for the restart tests. Escapes without any cleanup, like a kill."""


def _captured_at(name):
    return datetime.strptime(name, 'sirivm-%Y%m%dT%H%M%S.zip').replace(tzinfo=timezone.utc)


def ensure_source(root, selection, name, fetch_fn=fetch):
    """Return (bytes, path, cache_hit, retrieved_at). Raw files never enter Git."""
    path = root / 'data/raw' / name
    path.parent.mkdir(parents=True, exist_ok=True)  # the original importer omitted this
    if path.exists():
        retrieved = datetime.fromtimestamp(path.stat().st_mtime, timezone.utc)
        return path.read_bytes(), path, True, retrieved
    time.sleep(REQUEST_SPACING)
    body, _, _ = fetch_fn(selection['base_url'] + name)
    temp = path.with_suffix('.part')
    temp.write_bytes(body)
    temp.replace(path)
    return body, path, False, datetime.now(timezone.utc)


def process_sources(con, run_id, names, selection, root=ROOT, fetch_fn=fetch,
                    fail_after=None, fail_during=None, log=print):
    """Load each source into the warehouse. Safe to call again with the same inputs."""
    con.execute('UPDATE pipeline_run SET sources_seen = ? WHERE run_id = ?', [len(names), run_id])
    processed = 0
    for name in names:
        body, path, cache_hit, retrieved = ensure_source(root, selection, name, fetch_fn)
        digest = hashlib.sha256(body).hexdigest()
        # The checkpoint is written before the work, so an interruption is visible afterwards.
        claim_source(con, run_id, digest, name, cache_hit)
        record_raw_source(con, run_id, sha256=digest, kind=ARCHIVE_KIND,
                          url=selection['base_url'] + name, stored_path=path.relative_to(root),
                          byte_size=len(body), captured_at=_captured_at(name),
                          retrieved_at=retrieved)
        if fail_during is not None and processed + 1 >= fail_during:
            # Claimed but never loaded: the checkpoint is left 'pending' on purpose.
            raise SimulatedCrash(f'injected crash while processing {name}')
        try:
            records, rejected, stats = parse_source(body, digest, retrieved.isoformat())
            counts = load_observations(con, run_id, digest, records, rejected,
                                       stats['activitiesTotal'], stats['outsideArea'],
                                       stats.get('quarantined', ()))
        except Exception as error:
            fail_source(con, run_id, digest, error)
            raise
        processed += 1
        log(json.dumps({'source': name, 'sha256': digest[:12], 'cacheHit': cache_hit,
                        'inArea': counts['inArea'], 'new': counts['new'],
                        'repeats': counts['repeats'], 'conflicts': counts['conflicts'],
                        'rejected': counts['rejected']}))
        if fail_after is not None and processed >= fail_after:
            raise SimulatedCrash(f'injected crash after {processed} sources')
    return processed


def resume_abandoned(con, log=print):
    """Close out runs that a crash, a kill or a closed lid left marked 'running'."""
    resumed = []
    for run_id in abandoned_runs(con):
        pending = unfinished_sources(con, run_id)
        mark_interrupted(con, run_id)
        resumed.append({'runId': run_id, 'unfinishedSources': pending})
        log(json.dumps({'interruptedRun': run_id, 'unfinished': pending}))
    return resumed


def publish_current(con, run_id, log=print, root=ROOT):
    """Build a candidate from the warehouse, validate it, swap it in only if it passes."""
    from .publish import OPERATIONS_TARGET, REPLAY_TARGET, SNAPSHOT_ARCHIVE
    root = Path(root)
    candidate = build_snapshot(con)
    result = publish(con, run_id, candidate, root / REPLAY_TARGET, root / SNAPSHOT_ARCHIVE)
    operations = write_operations(con, root / OPERATIONS_TARGET, root / REPLAY_TARGET)
    log(json.dumps({'publication': result['status'], 'snapshotId': result['snapshotId'],
                    'observations': candidate['quality']['uniqueObservations'],
                    'journeys': len(candidate['journeys']),
                    'failedChecks': result['failed'],
                    'servedMatchesRecord': operations['servedSnapshot']['matchesRecordedPublication']}))
    return result


def run_import(reprocess=False, root=ROOT, db_path=None, fetch_fn=fetch, fail_after=None,
               fail_during=None, log=print, publish_after=True):
    from .warehouse import DEFAULT_DB
    root = Path(root)
    selection = json.loads((root / 'data/archive-selection.json').read_text())
    con = connect(db_path or root / DEFAULT_DB)
    try:
        resumed = resume_abandoned(con, log)
        run_id = start_run(con, 'reprocess' if reprocess else 'archive_import',
                           is_historical=True,
                           note='public BODS archive selection, historical replay',
                           resumed_from=resumed[0]['runId'] if resumed else None)
        try:
            process_sources(con, run_id, selection['files'], selection, root, fetch_fn,
                            fail_after, fail_during, log)
        except SimulatedCrash:
            raise  # leaves the run row 'running', exactly as a killed process would
        except Exception as error:
            finish_run(con, run_id, 'failed', type(error).__name__, str(error))
            raise
        finish_run(con, run_id, 'succeeded')
        result = publish_current(con, run_id, log, root) if publish_after else None
        if result and not result['failed']:
            _write_verification(con, root)
        return {'runId': run_id, 'resumed': resumed, 'publication': result,
                'totals': warehouse_totals(con)}
    finally:
        con.close()


def _write_verification(con, root):
    """Keep the tracked evidence file in step with the warehouse."""
    totals = warehouse_totals(con)
    sources = [{'url': u, 'sha256': s, 'bytes': int(b),
                'capturedAt': c.isoformat(), 'retrievedAt': r.isoformat()}
               for u, s, b, c, r in con.execute(
                   'SELECT source_url, source_sha256, byte_size, captured_at, retrieved_at'
                   " FROM raw_source WHERE source_kind = ? ORDER BY captured_at",
                   [ARCHIVE_KIND]).fetchall()]
    replay = json.loads((root / 'public/data/replay.json').read_text())
    atomic_json(root / 'research/source-verification.json', {
        'checkedAt': utc_now(), 'sources': sources, 'quality': replay['quality'],
        'distinctTracks': len(replay['journeys']), 'snapshotId': replay.get('snapshotId'),
        'warehouseTotals': totals,
        'findings': ['Actual public archive responses inspected, hashed and parsed.',
                     'Only selected Manchester coordinates are published.',
                     'Source observations deduplicated by compound identity and observation time.',
                     'Conflicting positions with the same observation identity are withheld.',
                     'Every published figure is reconciled against the DuckDB history.',
                     'Timetable identity and stop-time inference remain unvalidated.'],
    })


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('command', choices=['import', 'reprocess', 'publish', 'status'])
    parser.add_argument('--db', type=Path, default=None)
    parser.add_argument('--no-publish', action='store_true')
    args = parser.parse_args(argv)

    if args.command in ('import', 'reprocess'):
        result = run_import(reprocess=args.command == 'reprocess', db_path=args.db,
                            publish_after=not args.no_publish)
        print(json.dumps({'totals': result['totals']}, indent=2))
        failed = result['publication'] and result['publication']['failed']
        return 1 if failed else 0

    from .warehouse import DEFAULT_DB
    con = connect(args.db or ROOT / DEFAULT_DB)
    try:
        if args.command == 'publish':
            resume_abandoned(con)
            run_id = start_run(con, 'reprocess', note='republish from existing warehouse')
            finish_run(con, run_id, 'succeeded')
            result = publish_current(con, run_id)
            return 1 if result['failed'] else 0
        operations = write_operations(con)
        print(json.dumps({'servedSnapshot': operations['servedSnapshot'],
                          'freshness': operations['freshness'],
                          'totals': operations['totals'],
                          'reconciliation': operations['reconciliation']}, indent=2))
        return 0
    finally:
        con.close()


if __name__ == '__main__':
    sys.exit(main())
