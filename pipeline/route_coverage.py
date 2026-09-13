"""How well one route is covered, as four separate answers, for checking a tester's route.

    .venv/bin/python -m pipeline.route_coverage --line 245
    .venv/bin/python -m pipeline.route_coverage --line 15 --stop 1800SJ32231 --json

1. Timetable patterns: which service patterns the app publishes for the line, their validity,
   operating days and whether one calls at the tester's stop.
2. Road geometry: which of those patterns has an accepted road shape, or why not.
3. Estimated movement: whether the motion evaluation covered the pattern. Anything else is shown
   at its reports only.
4. Live observations: the buses on the line in the current publication and how each was placed,
   and, when the warehouse is free, how many live observations of it the warehouse holds.

Every answer is read from what the app actually serves (public/data) or has stored. A missing
piece is reported as missing, with its published reason. The answers are never folded into one
score: a route with no timetable is not "partly covered", and estimate support is never claimed
for a pattern the evaluation did not include.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'public' / 'data'
DEFAULT_DB = ROOT / 'data' / 'warehouse' / 'lost-minutes.duckdb'

PLACEMENT_WORDS = {
    'placed': 'placed on a timetable pattern',
    'ambiguous_branch': 'unresolved between branches',
    'no_pattern_for_route': 'refused: no timetable pattern held for the route',
    'no_pattern_for_operator': 'refused: no pattern for this operator',
    'no_pattern_operating_today': 'refused: its timetable has no journeys today',
    'too_far_from_pattern': 'refused: too far from any pattern stop',
}


def _read(path: Path):
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def load_published(data_dir: Path = DATA) -> dict:
    """The files the app serves; a missing or unreadable one is None, and says so in the report."""
    return {'patterns': _read(data_dir / 'patterns.json'), 'shapes': _read(data_dir / 'shapes' / 'index.json'),
            'motion': _read(data_dir / 'motion-evaluation.json'), 'live': _read(data_dir / 'live.json'),
            'stops': _read(data_dir / 'stops.json')}


def _placement(vehicle: dict) -> str:
    match = vehicle.get('match') or {}
    if 'patternId' in match:
        return 'placed'
    return match.get('unresolved') or ('no match published' if not match else 'unrecognised')


def coverage_report(line: str, published: dict, operator: str | None = None, stop: str | None = None,
                    history: dict | None = None) -> dict:
    """The four answers for one line, kept apart."""
    patterns_file, shapes, motion, live = (published.get(k) for k in ('patterns', 'shapes', 'motion', 'live'))
    stops = {s['id']: s for s in (published.get('stops') or {}).get('stops', [])}
    wanted = lambda item: item.get('line', item.get('route')) == line and (operator is None or item.get('operator') == operator)

    patterns = [p for p in (patterns_file or {}).get('patterns', []) if wanted(p)]
    without = [s for s in ((patterns_file or {}).get('coverage') or {}).get('observedServicesWithoutTimetableExamples', [])
               if wanted(s)]
    timetable = {
        'published': patterns_file is not None,
        'generatedAt': (patterns_file or {}).get('generatedAt'),
        'patterns': [{'id': p['id'], 'operator': p.get('operator'), 'direction': p.get('direction'),
                      'destination': p.get('destination'), 'stops': len(p.get('stops', [])), 'runs': p.get('runs'),
                      'journeys': p.get('journeys'),
                      'validFrom': (p.get('timetable') or {}).get('validFrom'),
                      'validTo': (p.get('timetable') or {}).get('validTo'),
                      'file': (p.get('timetable') or {}).get('file'),
                      **({'callsAtStop': stop in p.get('stops', [])[:-1]} if stop else {})}
                     for p in patterns],
        'observedWithoutTimetable': without,
    }
    if stop:
        timetable['stop'] = {'id': stop, 'name': (stops.get(stop) or {}).get('name'),
                             'indicator': (stops.get(stop) or {}).get('indicator'),
                             'patternsCalling': sum(1 for p in timetable['patterns'] if p['callsAtStop'])}

    shape_index = (shapes or {}).get('patterns', {})
    geometry = {'published': shapes is not None, 'patterns': []}
    for p in patterns:
        entry = shape_index.get(p['id'])
        geometry['patterns'].append({'id': p['id'], 'status': entry.get('status') if entry else 'not built',
                                     'reason': entry.get('reason') if entry else 'no road shape has been built for this pattern',
                                     'reports': ((entry or {}).get('validation') or {}).get('reports'),
                                     'offsetP95Metres': ((entry or {}).get('validation') or {}).get('offsetP95Metres')})

    corridor = set(((motion or {}).get('corridor') or {}).get('patterns', []))
    estimates = {'published': motion is not None, 'version': (motion or {}).get('version'),
                 'patterns': [{'id': p['id'], 'evaluated': p['id'] in corridor} for p in patterns]}

    vehicles = [v for v in (live or {}).get('vehicles', []) if wanted(v)]
    kinds: dict[str, int] = {}
    for v in vehicles:
        kinds[_placement(v)] = kinds.get(_placement(v), 0) + 1
    observations = {
        'publication': {'published': live is not None, 'publishedAt': (live or {}).get('publishedAt'),
                        'state': (live or {}).get('state'), 'buses': len(vehicles), 'placement': kinds,
                        'onPatterns': sorted({v['match']['patternId'] for v in vehicles if 'patternId' in (v.get('match') or {})})},
        'history': history or {'counted': False, 'reason': 'not requested'},
    }
    return {'line': line, 'operator': operator, 'timetable': timetable, 'geometry': geometry,
            'estimates': estimates, 'observations': observations,
            'answers': {
                'timetable': bool(timetable['patterns']),
                'geometry': any(g['status'] == 'accepted' for g in geometry['patterns']),
                'estimates': any(e['evaluated'] for e in estimates['patterns']),
                'observedNow': bool(vehicles),
                'observedBefore': (history or {}).get('observations', 0) > 0 if (history or {}).get('counted') else None,
            }}


def warehouse_history(line: str, operator: str | None = None, days: int = 7, db_path: Path = DEFAULT_DB,
                      now: datetime | None = None) -> dict:
    """Live observations of the line held in the warehouse, if it can be read without disturbing a
    running collector (a read-only open fails while the collector holds its lock, and is said so)."""
    if not Path(db_path).exists():
        return {'counted': False, 'reason': f'no warehouse at {Path(db_path).name}'}
    try:
        import duckdb
        con = duckdb.connect(str(db_path), read_only=True)
    except Exception as error:  # the collector holds the lock, or duckdb is missing
        return {'counted': False, 'reason': 'the warehouse is in use (a collector is running) or unreadable: '
                                            + type(error).__name__}
    since = (now or datetime.now(timezone.utc)) - timedelta(days=days)
    args = [line, int(since.timestamp() * 1000)] + ([operator] if operator else [])
    live = "o.source_sha256 IN (SELECT source_sha256 FROM raw_source WHERE source_kind = 'live_positions')"
    where = f"o.route = ? AND o.observed_at_ms >= ? AND {live}" + (' AND o.operator = ?' if operator else '')
    try:
        total, vehicles, first, last = con.execute(
            f"SELECT count(*), count(DISTINCT o.operator || '|' || o.vehicle), min(o.observed_at_ms), max(o.observed_at_ms)"
            f" FROM v_publishable_observation o WHERE {where}", args).fetchone()
        by_day = con.execute(
            f"SELECT CAST(to_timestamp(o.observed_at_ms / 1000) AS DATE) AS day, count(*)"
            f" FROM v_publishable_observation o WHERE {where} GROUP BY day ORDER BY day", args).fetchall()
    finally:
        con.close()
    iso = lambda ms: datetime.fromtimestamp(ms / 1000, timezone.utc).isoformat() if ms else None
    return {'counted': True, 'days': days, 'observations': total, 'vehicles': vehicles,
            'first': iso(first), 'last': iso(last), 'byUtcDay': [[str(day), n] for day, n in by_day]}


def _count(n, one: str, many: str | None = None) -> str:
    return f"{n} {one if n == 1 else many or one + 's'}"


def render(report: dict) -> str:
    line, t, g, e, o = (report[k] for k in ('line', 'timetable', 'geometry', 'estimates', 'observations'))
    lines = [f"Route {line}{' · ' + report['operator'] if report['operator'] else ''}: coverage in four separate answers"]
    lines.append('')
    lines.append('1. Timetable patterns')
    if not t['published']:
        lines.append('   patterns.json is missing: nothing can be said.')
    elif not t['patterns']:
        extra = '; '.join(f"{s['operator']} {s['line']} observed {s['observations']} times with no timetable held"
                          for s in t['observedWithoutTimetable'])
        lines.append(f"   None published for this line.{' ' + extra + '.' if extra else ''}")
    else:
        for p in t['patterns']:
            calls = '' if 'callsAtStop' not in p else ('; calls at your stop' if p['callsAtStop'] else '; does not call at your stop')
            lines.append(f"   {p['id']}: {p['direction']} to {p['destination']}, {_count(p['stops'], 'stop')}, runs {p['runs']}, "
                         f"{_count(p['journeys'], 'journey')}, valid {p['validFrom']} to {p['validTo']}{calls}")
        if 'stop' in t:
            name = f"{t['stop']['name']} ({t['stop']['indicator']})" if t['stop']['name'] else t['stop']['id']
            lines.append(f"   At {name}: {t['stop']['patternsCalling']} of {len(t['patterns'])} patterns call there.")
    lines.append('')
    lines.append('2. Road geometry (needed for estimated movement)')
    if not g['patterns']:
        lines.append('   No patterns, so no geometry to check.')
    for p in g['patterns']:
        detail = f" ({p['reports']} reports, 95% within {p['offsetP95Metres']} m)" if p['status'] == 'accepted' else f": {p['reason']}"
        lines.append(f"   {p['id']}: {p['status']}{detail}")
    lines.append('')
    lines.append('3. Estimated movement')
    evaluated = [p['id'] for p in e['patterns'] if p['evaluated']]
    lines.append(f"   {'Evaluated for ' + ', '.join(evaluated) if evaluated else 'Not evaluated for this line: its buses are shown at their reports only.'}"
                 + (f" (model {e['version']})" if evaluated else ''))
    lines.append('')
    lines.append('4. Live observations')
    now = o['publication']
    if not now['published']:
        lines.append('   live.json is missing.')
    else:
        placed = ', '.join(f"{n} {PLACEMENT_WORDS.get(kind, kind)}" for kind, n in sorted(now['placement'].items()))
        lines.append(f"   In the publication of {now['publishedAt']} ({now['state']}): {_count(now['buses'], 'bus', 'buses')}"
                     + (f": {placed}" if placed else '') + '.')
    history = o['history']
    if history.get('counted'):
        lines.append(f"   In the warehouse, last {history['days']} days of live captures: {history['observations']} "
                     f"observations of {history['vehicles']} vehicles ({history['first']} to {history['last']}).")
    else:
        lines.append(f"   Warehouse history not counted: {history.get('reason')}.")
    a = report['answers']
    yes = lambda v: 'unknown' if v is None else 'yes' if v else 'no'
    lines.append('')
    lines.append(f"Answers, kept apart: timetable {yes(a['timetable'])} · road geometry {yes(a['geometry'])} · "
                 f"estimates {yes(a['estimates'])} · reporting now {yes(a['observedNow'])} · seen before {yes(a['observedBefore'])}")
    return '\n'.join(lines)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--line', required=True, help='route number as the feed reports it, e.g. 245')
    parser.add_argument('--operator', help='operator code, e.g. BNML; all operators if omitted')
    parser.add_argument('--stop', help="the tester's stop, as an ATCO code")
    parser.add_argument('--days', type=int, default=7, help='warehouse history window in days')
    parser.add_argument('--no-history', action='store_true', help='do not open the warehouse')
    parser.add_argument('--json', action='store_true')
    args = parser.parse_args(argv)
    history = None if args.no_history else warehouse_history(args.line, args.operator, args.days)
    report = coverage_report(args.line, load_published(), args.operator, args.stop, history)
    print(json.dumps(report, indent=1) if args.json else render(report))
    return 0


if __name__ == '__main__':
    sys.exit(main())
