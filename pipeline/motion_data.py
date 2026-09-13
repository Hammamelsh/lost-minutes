"""Report sequences for evaluating estimated movement, exported from the warehouse.

    .venv/bin/python -m pipeline.motion_data export --lines 15,250,256

Each sequence is one journey of one vehicle (operator, vehicle, route, direction, journey_ref),
its reports in observation order, each with the time we fetched it and the pattern the matcher
places that report on. The estimator is then scored in Node against these exact reports
(scripts/evaluate-motion.mjs), so the code that is evaluated is the code the page runs.

Only observed reports are exported. Nothing here is estimated, and nothing estimated is ever
written back to the warehouse.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .core import atomic_json, utc_now

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = Path('data/warehouse/lost-minutes.duckdb')
TARGET = Path('data/evaluation/motion-reports.json')

SQL = """
SELECT o.operator, o.vehicle, o.route, o.direction, o.journey_ref, o.destination,
       o.observed_at_ms, epoch_ms(o.retrieved_at) AS retrieved_ms, o.lat, o.lon, o.bearing,
       o.bearing_status, o.source_sha256, o.first_seen_run_id
FROM v_publishable_observation o
WHERE o.source_sha256 IN (SELECT source_sha256 FROM raw_source WHERE source_kind = 'live_positions')
  AND o.route IN ({marks})
ORDER BY o.operator, o.vehicle, o.journey_ref, o.observed_at_ms
"""


def export(con, lines, since_ms=None, until_ms=None):
    """Sequences for the lines; with a window, only journeys whose first report falls inside it,
    so a fresh evaluation never sees a journey that began in the development captures."""
    from .match import load_patterns, match_vehicle
    from .service_days import service_day
    patterns = load_patterns(con)
    runs = {run: {'runId': run, 'startedAt': started.isoformat() if started else None,
                  'finishedAt': finished.isoformat() if finished else None, 'status': status,
                  'kind': kind}
            for run, started, finished, status, kind in con.execute(
                "SELECT run_id, started_at, finished_at, status, collector_kind FROM pipeline_run"
                " WHERE mode = 'live_capture'").fetchall()}
    sources, source_index, sequences, current = [], {}, [], None
    for (operator, vehicle, route, direction, journey, destination, observed, retrieved, lat, lon,
         bearing, status, sha, run) in con.execute(SQL.format(marks=','.join('?' for _ in lines)),
                                                   list(lines)).fetchall():
        key = (operator, vehicle, route, direction, journey)
        if current is None or current['key'] != key:
            current = {'key': key, 'operator': operator, 'vehicle': vehicle, 'route': route,
                       'direction': direction, 'journeyRef': journey, 'fixes': []}
            sequences.append(current)
        result = match_vehicle({'operator': operator, 'route': route, 'direction': direction,
                                'destination': destination, 'lat': lat, 'lon': lon},
                               patterns, service_day(int(observed)))
        if sha not in source_index:
            source_index[sha] = len(sources)
            sources.append(sha)
        # [observed ms, retrieved ms, lat, lon, reported bearing or null, pattern or null,
        #  source index, run]
        # The road the page would follow: the matched pattern, or the first candidate when the
        # candidates share every stop ahead (as the page does). Otherwise none.
        road = (result['patternId'] if result.get('matched')
                else result['candidates'][0]['patternId']
                if result.get('sharedOnward') and result.get('candidates') else None)
        current['fixes'].append([int(observed), int(retrieved) if retrieved is not None else None,
                                 lat, lon, bearing if status == 'reported' else None,
                                 road, source_index[sha], run])
    for sequence in sequences:
        del sequence['key']
    inside = lambda s: ((since_ms is None or s['fixes'][0][0] >= since_ms)
                        and (until_ms is None or s['fixes'][0][0] < until_ms))
    return {'schemaVersion': 1, 'generatedAt': utc_now(), 'lines': list(lines),
            'window': {'since': since_ms, 'until': until_ms,
                       'rule': 'a journey is included when its first report is inside the window'},
            'runs': sorted(runs.values(), key=lambda r: r['startedAt'] or ''),
            'sources': sources, 'sequences': [s for s in sequences if len(s['fixes']) >= 2 and inside(s)],
            'note': 'Observed reports only, one sequence per journey of one vehicle. Each fix: '
                    '[observed ms, retrieved ms, lat, lon, reported bearing or null, matched '
                    'pattern or null, index into sources, first-seen run].'}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='command', required=True)
    out = sub.add_parser('export')
    out.add_argument('--lines', required=True)
    out.add_argument('--out', default=str(TARGET))
    out.add_argument('--since', help='ISO time: only journeys that began at or after it (UTC if no offset)')
    out.add_argument('--until', help='ISO time: only journeys that began before it')
    args = parser.parse_args(argv)
    from datetime import datetime, timezone

    def ms(text):
        if not text:
            return None
        moment = datetime.fromisoformat(text.replace('Z', '+00:00'))
        return int((moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)).timestamp() * 1000)
    from .warehouse import connect
    con = connect(ROOT / DEFAULT_DB)
    try:
        payload = export(con, [line.strip() for line in args.lines.split(',') if line.strip()],
                         ms(args.since), ms(args.until))
    finally:
        con.close()
    atomic_json(ROOT / args.out, payload)
    fixes = sum(len(s['fixes']) for s in payload['sequences'])
    print(json.dumps({'sequences': len(payload['sequences']), 'fixes': fixes,
                      'placed': sum(1 for s in payload['sequences'] for f in s['fixes'] if f[5])}))
    return 0


if __name__ == '__main__':
    sys.exit(main())
