"""Read what the display evaluation needs from a warehouse copy, and nothing else, in a process of its own.

The scoring (scripts/evaluate-arrival-display.py) runs in a process that never loads DuckDB: on 28 September
2026, with the DuckDB extension (1.5.5, Python 3.14.4) loaded in the same process, the scoring failed at random
in about one run in three or four (objects swapped between frames, a builtin not found, a segmentation fault),
even with the connection closed before it began; with DuckDB never loaded, ten runs of ten succeeded, identical.
So this step does the least it can in Python: it fetches rows and the catalogue the live matcher reads, for each
complete service day not yet scored under the current protocol, model and stop mapping, and writes them.

    .venv/bin/python scripts/extract-arrival-inputs.py --line 15 --db data/evaluation/snapshot.duckdb \\
        [--scored data/evaluation/arrival-display-nightly.jsonl] [--out data/evaluation/arrival-display-inputs.pkl]
        [--days 2026-09-29,2026-09-30] [--window-days 14]
"""
import argparse
import hashlib
import json
import pickle
import sys
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from pipeline import arrival_display as ad  # noqa: E402
from pipeline.match import load_patterns  # noqa: E402
from pipeline.stop_mapping import MAPPING_VERSION  # noqa: E402
from pipeline.warehouse import connect  # noqa: E402

LONDON = ZoneInfo('Europe/London')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--line', default='15')
    ap.add_argument('--operator', default='BNML')
    ap.add_argument('--db', required=True)
    ap.add_argument('--params', default=str(ROOT / 'scripts/arrival-params-frozen.json'))
    ap.add_argument('--scored', default=str(ROOT / 'data/evaluation/arrival-display-nightly.jsonl'))
    ap.add_argument('--out', default=str(ROOT / 'data/evaluation/arrival-display-inputs.pkl'))
    ap.add_argument('--days', default=None, help='comma-separated service days (default: complete days not yet scored)')
    ap.add_argument('--window-days', type=int, default=14, help='look no further back than this many days')
    a = ap.parse_args()

    model = 'blended@' + hashlib.sha256(Path(a.params).read_bytes()).hexdigest()[:12]
    scored = set()
    if Path(a.scored).exists():
        for line in Path(a.scored).read_text().splitlines():
            if line.strip():
                e = json.loads(line)
                if (e.get('protocol'), e.get('model'), e.get('stopMapping')) == (ad.PROTOCOL, model, MAPPING_VERSION):
                    scored.add(e['day'])
    con = connect(a.db, read_only=True) if 'read_only' in connect.__code__.co_varnames else connect(a.db)
    latest = con.execute('SELECT max(observed_at_ms) FROM v_publishable_observation').fetchone()[0]
    last_complete = datetime.fromtimestamp(latest / 1000, LONDON).date() - timedelta(days=1)
    if a.days:
        days = sorted(a.days.split(','))
    else:
        days = [(last_complete - timedelta(days=k)).isoformat() for k in range(a.window_days)]
        days = sorted(d for d in days if d not in scored)
    days = [d for d in days if d <= last_complete.isoformat()]
    inputs = {'line': a.line, 'operator': a.operator, 'db': str(a.db), 'lastComplete': last_complete.isoformat(),
              'extractedAt': datetime.now(LONDON).isoformat(), 'days': {}}
    if days:
        inputs['depInfo'] = [(pid, text) for pid, text in con.execute(
            'SELECT pattern_id, departure_times FROM service_pattern WHERE line_name = ? AND operator_code = ?',
            [a.line, a.operator]).fetchall()]
        inputs['matchable'] = load_patterns(con)
    for day in days:
        start = int(datetime.fromisoformat(day).replace(tzinfo=LONDON).timestamp() * 1000) - 3 * 3600_000
        stop = start + 30 * 3600_000
        publications = [int(r[0]) for r in con.execute(
            "SELECT epoch_ms(published_at) FROM publication WHERE kind = 'live' AND status = 'published'"
            ' AND epoch_ms(published_at) BETWEEN ? AND ? ORDER BY 1', [start, stop + 3600_000]).fetchall()]
        rows = [(str(d), str(v), str(aim), int(t), float(la), float(lo), None if r is None else int(r), None if de is None else str(de))
                for d, v, aim, t, la, lo, r, de in con.execute("""
            SELECT direction, vehicle, aimed_departure, observed_at_ms, lat, lon, epoch_ms(retrieved_at), destination
            FROM v_publishable_observation
            WHERE operator = ? AND route = ? AND aimed_departure IS NOT NULL AND aimed_departure <> ''
              AND observed_at_ms BETWEEN ? AND ? ORDER BY observed_at_ms""", [a.operator, a.line, start, stop]).fetchall()]
        inputs['days'][day] = {'publications': publications, 'rows': rows}
    con.close()
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    # Our own file, written and read by the nightly unit in its private data directory.
    Path(a.out).write_bytes(pickle.dumps(inputs, protocol=pickle.HIGHEST_PROTOCOL))
    print(json.dumps({'extracted': {d: len(v['rows']) for d, v in inputs['days'].items()}, 'lastComplete': inputs['lastComplete'],
                      'alreadyScored': len(scored)}))


if __name__ == '__main__':
    main()
