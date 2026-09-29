"""Backlog 43 reproduction: the display evaluation exactly as it ran at 19:11-19:21 UTC on 28 September 2026,
reading the warehouse with DuckDB and scoring in the same process, when it failed in 4 of 17 runs. Recovered
from the session record; only ROOT is changed, for its place here. Never run in production.

Score the frozen arrival estimator as a page would show it, one service day at a time
(pipeline/arrival_display.py, docs/ARRIVAL_DISPLAY_PROTOCOL.md).

Each complete day not yet scored under this protocol, model and stop mapping is scored once and appended to
the nightly file; a day already there is left alone, so a night costs one day, not the whole warehouse. Days
before CONFIRMATION_FROM are labelled `revision` (seen while the approach was being chosen); from it they are
`confirmation`, untouched until scored here.

    .venv/bin/python scripts/evaluate-arrival-display.py --line 15 --db data/evaluation/snapshot.duckdb \\
        --passages data/evaluation/passages-15-server.json [--out data/evaluation/arrival-display-nightly.jsonl]
        [--days 2026-09-21,2026-09-22] [--rescore]
"""
import argparse
import hashlib
import importlib.util
import json
import sys
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[2]   # kept in scripts/probes/; otherwise as run on 28 September
sys.path.insert(0, str(ROOT))
from pipeline import arrival_display as ad  # noqa: E402
from pipeline.match import load_patterns, match_vehicle  # noqa: E402
from pipeline.passages import load_track  # noqa: E402
from pipeline.patterns import _departure_info  # noqa: E402
from pipeline.service_days import service_day  # noqa: E402
from pipeline.stop_mapping import MAPPING_VERSION  # noqa: E402
from pipeline.warehouse import connect  # noqa: E402

LONDON = ZoneInfo('Europe/London')
# The first service day no one had scored or looked at when the protocol was frozen (28-29 September 2026).
CONFIRMATION_FROM = '2026-09-29'

ARGS = sys.argv[1:]
sys.argv = [sys.argv[0]]
spec = importlib.util.spec_from_file_location('evaluate_arrival', ROOT / 'scripts/evaluate-arrival.py')
ev = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ev)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--line', default='15')
    ap.add_argument('--operator', default='BNML')
    ap.add_argument('--db', required=True)
    ap.add_argument('--passages', required=True)
    ap.add_argument('--params', default=str(ROOT / 'scripts/arrival-params-frozen.json'))
    ap.add_argument('--catalogue', default=str(ROOT / 'public/data/patterns.json'))
    ap.add_argument('--out', default=str(ROOT / 'data/evaluation/arrival-display-nightly.jsonl'))
    ap.add_argument('--days', default=None, help='comma-separated service days; default every complete day not yet scored')
    ap.add_argument('--rescore', action='store_true', help='score the days even if already in the file')
    a = ap.parse_args(ARGS)

    frozen_bytes = Path(a.params).read_bytes()
    frozen = json.loads(frozen_bytes)
    model = 'blended@' + hashlib.sha256(frozen_bytes).hexdigest()[:12]
    params, cruise_by = frozen['params'], frozen['cruise']
    passages = ev.passages_from(json.loads(Path(a.passages).read_text()))
    catalogue = json.loads(Path(a.catalogue).read_text())
    patterns = {p['id']: p for p in catalogue['patterns'] if p['operator'] == a.operator and p['line'] == a.line}

    out = Path(a.out)
    kept = {}
    if out.exists():
        for line in out.read_text().splitlines():
            if line.strip():
                e = json.loads(line)
                kept[e['day']] = e
    same = lambda e: (e.get('protocol'), e.get('model'), e.get('stopMapping')) == (ad.PROTOCOL, model, MAPPING_VERSION)

    # Passages by service day, as the evaluator groups them: the local date of the journey's first passage.
    by_journey = defaultdict(list)
    for p in passages:
        if p['scoreable'] and p.get('visit', 1) == 1:
            by_journey[(p['pattern_id'], p['journey_key'])].append(p)
    journeys_by_day = defaultdict(dict)
    for jk, plist in by_journey.items():
        day = ev.local_wall(min(p['passed_at_ms'] for p in plist)).date().isoformat()
        journeys_by_day[day][jk] = plist

    con = connect(a.db, read_only=True) if 'read_only' in connect.__code__.co_varnames else connect(a.db)
    latest = con.execute('SELECT max(observed_at_ms) FROM v_publishable_observation').fetchone()[0]
    last_complete = (ev.local_wall(latest).date() - timedelta(days=1)).isoformat()
    wanted = sorted(d for d in journeys_by_day if d <= last_complete)
    if a.days:
        wanted = [d for d in a.days.split(',') if d in journeys_by_day]
    todo = [d for d in wanted if a.rescore or d not in kept or not same(kept[d])]
    if not todo:
        print(json.dumps({'scored': [], 'note': 'every complete day is already scored under this protocol'}))
        return

    dep_info = {row[0]: _departure_info(row[1]) for row in
                con.execute('SELECT pattern_id, departure_times FROM service_pattern WHERE line_name = ? AND operator_code = ?',
                            [a.line, a.operator]).fetchall()}
    matchable = load_patterns(con)
    tracks = {pid: load_track(pid, p['stops']) for pid, p in patterns.items()}
    for day in todo:
        start = int(datetime.fromisoformat(day).replace(tzinfo=LONDON).timestamp() * 1000) - 3 * 3600_000
        stop = start + 30 * 3600_000
        publications = [int(r[0]) for r in con.execute(
            "SELECT epoch_ms(published_at) FROM publication WHERE kind = 'live' AND status = 'published'"
            ' AND epoch_ms(published_at) BETWEEN ? AND ? ORDER BY 1', [start, stop + 3600_000]).fetchall()]
        rows = con.execute("""
            SELECT direction, vehicle, aimed_departure, observed_at_ms, lat, lon, epoch_ms(retrieved_at), destination
            FROM v_publishable_observation
            WHERE operator = ? AND route = ? AND aimed_departure IS NOT NULL AND aimed_departure <> ''
              AND observed_at_ms BETWEEN ? AND ? ORDER BY observed_at_ms""", [a.operator, a.line, start, stop]).fetchall()
        reports = defaultdict(list)
        cache = {}
        for direction, vehicle, aimed, t, lat, lon, retrieved, destination in rows:
            sday = service_day(int(t))
            ck = (direction, destination, lat, lon, sday)
            if ck not in cache:
                cache[ck] = match_vehicle({'operator': a.operator, 'route': a.line, 'direction': direction,
                                           'destination': destination, 'lat': lat, 'lon': lon}, matchable, sday)
            reports[(direction, f'{vehicle}|{aimed}')].append((int(t), lat, lon, int(retrieved) if retrieved is not None else None, cache[ck]))
        entry = {'day': day, 'protocol': ad.PROTOCOL, 'model': model, 'stopMapping': MAPPING_VERSION,
                 'operator': a.operator, 'line': a.line, 'scoredAt': datetime.now(LONDON).isoformat(),
                 'weekday': datetime.fromisoformat(day).weekday() < 5,
                 'split': 'confirmation' if day >= CONFIRMATION_FROM else 'revision', 'directions': {}}
        for (pid, key), plist in sorted(journeys_by_day[day].items()):
            pattern, track = patterns.get(pid), tracks.get(pid)
            if not pattern or track is None:
                continue
            journey_reports = sorted(reports.get((pattern['direction'], key), []), key=lambda r: r[0])
            acc = ad.score_journey(ev, pattern, track, dep_info, key, journey_reports, plist, params,
                                   cruise_by.get(pid, 8.0), publications)
            d = entry['directions'].setdefault(pattern['direction'], {'patternIds': [], 'journeys': []})
            if pid not in d['patternIds']:
                d['patternIds'].append(pid)
            d['journeys'].append(ad.to_json(acc))
        kept[day] = entry
        shown = {d: sum(sum(c for _, c in j['signed']) for j in v['journeys']) for d, v in entry['directions'].items()}
        print(json.dumps({'day': day, 'split': entry['split'], 'journeys': {d: len(v['journeys']) for d, v in entry['directions'].items()},
                          'displayMoments': shown}))
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(''.join(json.dumps(kept[d]) + '\n' for d in sorted(kept)))
    print(f'{out} now holds {len(kept)} day(s)')


if __name__ == '__main__':
    main()
