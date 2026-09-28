"""The evaluated arrival estimator's own answers, written out for the page's estimator to be held to.

For every journey of one pattern on the chosen days, at every report of that journey (the moment a
passenger could have been shown something), and for every stop of the road still ahead, this runs
the evaluator's functions exactly as scripts/evaluate-arrival.py scores them: the reports at or
before that moment, the timetable in force (the journey's own timing where its departure names one),
the accepted road shape and the frozen parameters. `scripts/arrival-parity.mjs` then asks the page's
estimator (lib/arrival.ts) the same questions and compares every answer and every refusal.

It also records, per report, whether the evaluator's chained placement (each report searched near
the one before) equals a placement with no chain: when they agree for every report, where a page
starts reading a journey cannot change where it places a report.

    .venv/bin/python scripts/arrival-parity-cases.py --db <warehouse copy> --passages <passages json> \
        --catalogue <patterns.json> [--pattern BNML:15:outbound:c9291c1aea] [--from 2026-09-21] [--to 2026-09-27] \
        --out cases.json
"""
import argparse
import hashlib
import importlib.util
import json
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from pipeline.passages import load_track  # noqa: E402
from pipeline.patterns import _departure_info  # noqa: E402
from pipeline.warehouse import connect  # noqa: E402

LONDON = ZoneInfo('Europe/London')
spec = importlib.util.spec_from_file_location('evaluate_arrival', ROOT / 'scripts/evaluate-arrival.py')
ev = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ev)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--db', required=True)
    ap.add_argument('--passages', required=True)
    ap.add_argument('--catalogue', required=True)
    ap.add_argument('--params', default=str(ROOT / 'scripts/arrival-params-frozen.json'))
    ap.add_argument('--pattern', default='BNML:15:outbound:c9291c1aea')
    ap.add_argument('--from', dest='first', default='2026-09-21')
    ap.add_argument('--to', dest='last', default='2026-09-27')
    ap.add_argument('--out', required=True)
    a = ap.parse_args()

    frozen_bytes = Path(a.params).read_bytes()
    frozen = json.loads(frozen_bytes)
    params, cruise_by = frozen['params'], frozen['cruise']
    catalogue = json.loads(Path(a.catalogue).read_text())
    pattern = next(p for p in catalogue['patterns'] if p['id'] == a.pattern)
    operator, line = pattern['operator'], pattern['line']
    track = load_track(a.pattern, pattern['stops'])
    if track is None:
        raise SystemExit(f'{a.pattern}: no accepted shape')
    cruise = cruise_by.get(a.pattern, 8.0)          # as score() reads it

    con = connect(a.db, read_only=True) if 'read_only' in connect.__code__.co_varnames else connect(a.db)
    dep_info = {row[0]: _departure_info(row[1]) for row in con.execute(
        'SELECT pattern_id, departure_times FROM service_pattern WHERE pattern_id = ?', [a.pattern]).fetchall()}
    rows = con.execute("""
        SELECT direction, vehicle, aimed_departure, observed_at_ms, lat, lon
        FROM v_publishable_observation
        WHERE operator = ? AND route = ? AND aimed_departure IS NOT NULL AND aimed_departure <> ''
        ORDER BY observed_at_ms""", [operator, line]).fetchall()
    reports = defaultdict(list)
    for direction, vehicle, aimed, t, lat, lon in rows:
        reports[(direction, f'{vehicle}|{aimed}')].append((int(t), lat, lon))

    passages = json.loads(Path(a.passages).read_text())['passages']
    day_of = lambda ms: datetime.fromtimestamp(ms / 1000, LONDON).date().isoformat()
    keys = sorted({p['journey_key'] for p in passages if p['pattern_id'] == a.pattern and p['scoreable']
                   and a.first <= day_of(p['passed_at_ms']) <= a.last})

    journeys, cases_total, chain_differs = [], 0, 0
    for key in keys:
        raw = sorted(reports.get((pattern['direction'], key), []))
        placed = ev.place_reports(track, raw)
        if len(placed) < 6:                          # as score() skips it
            continue
        sched = ev.scheduled_for(pattern, dep_info, key)
        timing = (sched[0] if sched else None) or pattern.get('seconds')
        # Placement with no chain, report by report, against the evaluator's chained placement.
        unchained = []
        for t, lat, lon in raw:
            s, off = track.project((lat, lon), None)
            if off <= 40:
                unchained.append((t, s))
        same_chain = len(unchained) == len(placed) and all(
            u[0] == p[0] and abs(u[1] - p[1]) < 1e-6 for u, p in zip(unchained, placed))
        chain_differs += 0 if same_chain else 1
        cases = []
        for i, (t_now, s_now) in enumerate(placed):
            for j, off in enumerate(track.stop_offsets):
                if off is None or off <= s_now or j >= len(timing):
                    continue
                eta = ev.blended_eta(placed, i, off, j, track.stop_offsets, params, cruise, track, timing)
                cases.append([i, j, eta])
        cases_total += len(cases)
        journeys.append({'key': key, 'day': day_of(raw[0][0]), 'reports': [list(r) for r in raw],
                         'placed': [list(p) for p in placed], 'timing': timing, 'named': sched is not None,
                         'sameWithoutChain': same_chain, 'cases': cases})

    out = {'pattern': a.pattern, 'operator': operator, 'line': line, 'direction': pattern['direction'],
           'days': [a.first, a.last], 'model': 'blended@' + hashlib.sha256(frozen_bytes).hexdigest()[:12],
           'params': params, 'cruise': cruise, 'stopOffsets': track.stop_offsets, 'patternStops': pattern['stops'],
           'catalogueGeneratedAt': catalogue.get('generatedAt'), 'journeys': journeys}
    Path(a.out).write_text(json.dumps(out))
    print(json.dumps({'pattern': a.pattern, 'journeys': len(journeys), 'cases': cases_total,
                      'estimates': sum(1 for j in journeys for c in j['cases'] if c[2] is not None),
                      'journeysWhosePlacementDependsOnTheChain': chain_differs, 'model': out['model']}))


if __name__ == '__main__':
    main()
