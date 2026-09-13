"""Matching before and after a rule change, on the same frozen capture.

    .venv/bin/python -m pipeline.assess_matching --at 2026-09-13T13:16:22Z --at 2026-09-13T14:30:00Z

For each moment, the vehicles a publication would have carried then (each vehicle's newest
report fetched by that moment, no older than the expiry threshold) are matched against the
same timetable patterns in two ways: with the earlier rule, which kept only patterns with 60%
of their stops inside the collected area, and with every held pattern, the current rule.
Unresolved buses whose candidates share every stop ahead are counted separately and never as
matched. The capture and the patterns are identical between the two columns, so a difference
is the rule's, not the traffic's. Nothing is published; the result is written for the record.
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path

from .core import atomic_json, utc_now

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = Path('data/warehouse/lost-minutes.duckdb')
TARGET = Path('data/evaluation/matching-assessment.json')
OLD_SHARE = 0.6

AT_SQL = """
WITH fetched AS (
    SELECT o.* FROM v_publishable_observation o
    WHERE o.source_sha256 IN (SELECT source_sha256 FROM raw_source WHERE source_kind = 'live_positions')
      AND epoch_ms(o.retrieved_at) <= ? AND o.observed_at_ms >= ? AND o.observed_at_ms <= ?
), ranked AS (
    SELECT f.*, row_number() OVER (PARTITION BY operator, vehicle ORDER BY observed_at_ms DESC) AS rn FROM fetched f
)
SELECT operator, vehicle, route, direction, destination, lat, lon, observed_at_ms FROM ranked WHERE rn = 1
"""


def vehicles_at(con, at_ms, expiry_seconds):
    rows = con.execute(AT_SQL, [at_ms, at_ms - expiry_seconds * 1000, at_ms]).fetchall()
    return [{'operator': o, 'vehicle': v, 'route': r, 'direction': d, 'destination': dest,
             'lat': lat, 'lon': lon, 'observedAtMs': int(ms)}
            for o, v, r, d, dest, lat, lon, ms in rows]


def outcomes(vehicles, patterns):
    from .match import match_vehicle
    from .service_days import service_day
    counts, shared = Counter(), 0
    for vehicle in vehicles:
        result = match_vehicle(vehicle, patterns, service_day(vehicle['observedAtMs']))
        counts['matched' if result['matched'] else result['reason']] += 1
        shared += int(bool(result.get('sharedOnward')))
    return dict(counts), shared


def assess(con, moments):
    from .freshness import EXPIRY
    from .match import load_patterns
    patterns = load_patterns(con)
    share = {pid: (inside, total) for pid, inside, total in con.execute(
        'SELECT pattern_id, stops_in_area, stop_count FROM service_pattern').fetchall()}
    old = [p for p in patterns if share[p['id']][0] >= share[p['id']][1] * OLD_SHARE]
    results = []
    for moment in moments:
        at_ms = int(datetime.fromisoformat(moment.replace('Z', '+00:00')).timestamp() * 1000)
        vehicles = vehicles_at(con, at_ms, EXPIRY)
        before, _ = outcomes(vehicles, old)
        after, shared = outcomes(vehicles, patterns)
        results.append({'at': moment, 'vehicles': len(vehicles),
                        'rule60': before, 'everyHeldPattern': after,
                        'unresolvedWithSharedOnward': shared})
    return {'generatedAt': utc_now(), 'patternsHeld': len(patterns), 'patternsUnderOldRule': len(old),
            'moments': results,
            'note': 'Same frozen capture and the same timetable build in both columns; only the '
                    'pattern rule differs. Shared onward progress is counted apart and never as matched.'}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--at', action='append', required=True, help='ISO moment, e.g. 2026-09-13T13:16:22Z')
    parser.add_argument('--out', default=str(TARGET))
    args = parser.parse_args(argv)
    from .warehouse import connect
    con = connect(ROOT / DEFAULT_DB)
    try:
        payload = assess(con, args.at)
    finally:
        con.close()
    atomic_json(ROOT / args.out, payload)
    print(json.dumps(payload['moments'], indent=1))
    return 0


if __name__ == '__main__':
    sys.exit(main())
