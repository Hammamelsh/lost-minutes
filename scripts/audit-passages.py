"""Audit the inferred stop passages on route 15 against the 'within 40 m' count they replace.

On 20 September 2026 the project quoted 2,025 (journey, stop) pairs with a report within 40 m
of the stop as if they were arrivals. They are not: a report near a stop is one position with
GPS noise, 20 s from the next. This script infers passages from crossings instead
(pipeline/passages.py) and reports what survives, with its uncertainty, so the arrival
estimator is scored against something that carries its own error bar.

    .venv/bin/python scripts/audit-passages.py [--line 15] [--out data/evaluation/passages-15.json]
"""
import argparse
import json
import math
import statistics
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from pipeline.passages import Track, infer_passages, load_track, metres, passages_to_json  # noqa: E402
from pipeline.warehouse import DEFAULT_DB, connect  # noqa: E402

LONDON = ZoneInfo('Europe/London')


def main():
    args = argparse.ArgumentParser()
    args.add_argument('--line', default='15')
    args.add_argument('--operator', default='BNML')
    args.add_argument('--out', default=str(ROOT / 'data/evaluation/passages-15.json'))
    a = args.parse_args()

    catalogue = json.loads((ROOT / 'public/data/patterns.json').read_text())
    patterns = [p for p in catalogue['patterns'] if p['operator'] == a.operator and p['line'] == a.line]
    stops_json = json.loads((ROOT / 'public/data/stops.json').read_text())
    stop_xy = {s['id']: (s['lat'], s['lon']) for s in (stops_json['stops'] if isinstance(stops_json, dict) else stops_json)}

    con = connect(ROOT / DEFAULT_DB)
    rows = con.execute("""
        SELECT direction, vehicle, aimed_departure, observed_at_ms, lat, lon
        FROM v_publishable_observation
        WHERE operator = ? AND route = ? AND aimed_departure IS NOT NULL AND aimed_departure <> ''
        ORDER BY observed_at_ms""", [a.operator, a.line]).fetchall()
    by_dir = defaultdict(lambda: defaultdict(list))
    for direction, vehicle, aimed, t, lat, lon in rows:
        by_dir[direction][f'{vehicle}|{aimed}'].append((int(t), lat, lon))
    print(f'route {a.line} observations with a journey key: {len(rows)}; journeys: '
          + ', '.join(f'{d} {len(j)}' for d, j in by_dir.items()))

    all_passages, totals = [], Counter()
    within40_pairs = 0
    for pattern in patterns:
        track = load_track(pattern['id'])
        journeys = by_dir.get(pattern['direction'], {})
        if track is None:
            print(f"\n{pattern['id']}: no accepted shape; {len(journeys)} journeys in this direction cannot be scored")
            continue
        passages, summary = infer_passages(pattern['id'], pattern['stops'], journeys, track)
        # The old count, for the same journeys, so the two can be set side by side.
        for key, reports in journeys.items():
            if len(reports) < 10:
                continue
            for sid in pattern['stops']:
                xy = stop_xy.get(sid)
                if xy and any(metres((lat, lon), xy) <= 40 for _, lat, lon in reports):
                    within40_pairs += 1
        all_passages.extend(passages)
        totals.update({k: v for k, v in summary.items() if isinstance(v, int)})
        gaps = [p.gap_s for p in passages if p.scoreable]
        print(f"\n{pattern['id']}  journeys {summary['journeys']}  used {summary['journeysUsed']}  "
              f"reports placed {summary['reportsPlaced']}  off-road {summary['reportsOffRoad']}")
        print(f"   passages {summary['passages']}  scoreable {summary['scoreable']}  unbounded(>60 s) {summary['unbounded']}  "
              f"repeat visits {summary['repeatVisits']}  backwards steps skipped {summary['backwardsSkipped']}")
        if gaps:
            print(f"   scoreable gap: median {statistics.median(gaps):.0f} s, p90 {sorted(gaps)[int(.9*len(gaps))]:.0f} s  "
                  f"-> uncertainty median ±{statistics.median(gaps)/2:.0f} s")

    scoreable = [p for p in all_passages if p.scoreable]
    print('\n=== against the count this replaces ===')
    print(f'(journey, stop) pairs with a report within 40 m, same journeys and patterns: {within40_pairs}')
    print(f'inferred passages: {len(all_passages)}   scoreable (gap ≤ 60 s, first visit): {len(scoreable)}')
    days = Counter(datetime.fromtimestamp(p.passed_at_ms / 1000, LONDON).strftime('%a %d %b') for p in scoreable)
    print('scoreable passages by day: ' + ', '.join(f'{d} {n}' for d, n in sorted(days.items(), key=lambda x: x[0][4:])))
    hill = [p for p in scoreable if p.stop_id == '1800SJ32251']
    print(f'Hillingdon Road (opp) 1800SJ32251: {len(hill)} scoreable passages')

    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps({'line': a.line, 'operator': a.operator, 'generatedAt': datetime.now(LONDON).isoformat(),
                                       'rules': {'maxGapS': 60, 'offRoadM': 40, 'minReports': 6},
                                       'totals': dict(totals), 'within40Pairs': within40_pairs,
                                       'passages': passages_to_json(all_passages)}, indent=1))
    print(f'\nwritten {a.out}')


if __name__ == '__main__':
    main()
