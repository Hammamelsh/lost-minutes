"""Score the frozen arrival estimator as a page would show it, one service day at a time
(pipeline/arrival_display.py, docs/ARRIVAL_DISPLAY_PROTOCOL.md), from inputs extracted by
scripts/extract-arrival-inputs.py.

This process never loads DuckDB: with it loaded, the scoring failed at random under Python 3.14.4 on 28 September
2026 (the extraction script says how that was found). A guard stands in its place, so any use of it here stops
with an error rather than running.

Each extracted day not yet scored under this protocol, model and stop mapping is scored once and kept in the
nightly file; a night costs a day, not the whole warehouse. Days before CONFIRMATION_FROM are `revision` (seen
while the approach was being chosen); from it they are `confirmation`, untouched until scored here. Each day's
record carries the digest of the code it was scored with (pipeline/arrival_protocol.py), a day is kept once for
each version that scored it, so no version's record is ever replaced by another's, and a confirmation day is
scored once.

    .venv/bin/python scripts/evaluate-arrival-display.py --inputs data/evaluation/arrival-display-inputs.pkl \\
        [--out data/evaluation/arrival-display-nightly.jsonl] [--rescore]
"""
import sys
import types


class _NoDuckDB(types.ModuleType):
    def __getattr__(self, name):
        raise RuntimeError('DuckDB is not loaded in the scoring process (scripts/extract-arrival-inputs.py says why)')


sys.modules['duckdb'] = _NoDuckDB('duckdb')          # before any pipeline import

import argparse  # noqa: E402
import hashlib  # noqa: E402
import importlib.util  # noqa: E402
import json  # noqa: E402
import pickle  # noqa: E402
from collections import defaultdict  # noqa: E402
from dataclasses import asdict  # noqa: E402
from datetime import datetime  # noqa: E402
from pathlib import Path  # noqa: E402
from zoneinfo import ZoneInfo  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from pipeline import arrival_display as ad  # noqa: E402
from pipeline import arrival_protocol  # noqa: E402
from pipeline.match import match_vehicle  # noqa: E402
from pipeline.passages import infer_passages, load_track  # noqa: E402
from pipeline.patterns import _departure_info  # noqa: E402
from pipeline.service_days import service_day  # noqa: E402
from pipeline.stop_mapping import MAPPING_VERSION  # noqa: E402

LONDON = ZoneInfo('Europe/London')
CONFIRMATION_FROM = ad.CONFIRMATION_FROM   # the first day nobody had scored or looked at when the protocol was frozen

ARGS = sys.argv[1:]
sys.argv = [sys.argv[0]]
spec = importlib.util.spec_from_file_location('evaluate_arrival', ROOT / 'scripts/evaluate-arrival.py')
ev = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ev)


def score_day(day, data, inputs, patterns, tracks, dep_info, params, cruise_by, model, source_digest=None):
    """One service day's entry: every journey whose first passage falls on it, scored display moment by moment."""
    matchable = inputs['matchable']
    cache, reports = {}, defaultdict(list)
    for direction, vehicle, aimed, t, lat, lon, retrieved, destination in data['rows']:
        sday = service_day(t)
        ck = (direction, destination, lat, lon, sday)
        if ck not in cache:
            cache[ck] = match_vehicle({'operator': inputs['operator'], 'route': inputs['line'], 'direction': direction,
                                       'destination': destination, 'lat': lat, 'lon': lon}, matchable, sday)
        reports[(direction, f'{vehicle}|{aimed}')].append((t, lat, lon, retrieved, cache[ck]))
    entry = {'day': day, 'protocol': ad.PROTOCOL, 'model': model, 'stopMapping': MAPPING_VERSION, 'sourceDigest': source_digest,
             'operator': inputs['operator'], 'line': inputs['line'], 'scoredAt': datetime.now(LONDON).isoformat(),
             'weekday': datetime.fromisoformat(day).weekday() < 5,
             'split': 'confirmation' if day >= CONFIRMATION_FROM else 'revision', 'directions': {}}
    for pid, pattern in sorted(patterns.items()):
        track = tracks.get(pid)
        if track is None:
            continue
        journeys = {key: sorted((r[0], r[1], r[2]) for r in reps) for (direction, key), reps in reports.items()
                    if direction == pattern['direction']}
        found, _ = infer_passages(pid, pattern['stops'], journeys, track)
        by_journey = defaultdict(list)
        for p in found:
            if p.scoreable and p.visit == 1:
                by_journey[p.journey_key].append(asdict(p))
        d = entry['directions'].setdefault(pattern['direction'], {'patternIds': [], 'journeys': []})
        d['patternIds'].append(pid)
        for key, plist in sorted(by_journey.items()):
            if ev.local_wall(min(p['passed_at_ms'] for p in plist)).date().isoformat() != day:
                continue                                   # that journey belongs to the next or the previous day
            journey_reports = sorted(reports[(pattern['direction'], key)], key=lambda r: r[0])
            acc = ad.score_journey(ev, pattern, track, dep_info, key, journey_reports, plist, params,
                                   cruise_by.get(pid, 8.0), data['publications'])
            d['journeys'].append(ad.to_json(acc))
    return entry


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--inputs', default=str(ROOT / 'data/evaluation/arrival-display-inputs.pkl'))
    ap.add_argument('--params', default=str(ROOT / 'scripts/arrival-params-frozen.json'))
    ap.add_argument('--catalogue', default=str(ROOT / 'public/data/patterns.json'))
    ap.add_argument('--out', default=str(ROOT / 'data/evaluation/arrival-display-nightly.jsonl'))
    ap.add_argument('--rescore', action='store_true', help='score the days even if already in the file')
    a = ap.parse_args(ARGS)

    # Our own file, written by scripts/extract-arrival-inputs.py in the nightly unit's private directory.
    inputs = pickle.loads(Path(a.inputs).read_bytes())
    frozen_bytes = Path(a.params).read_bytes()
    frozen = json.loads(frozen_bytes)
    model = 'blended@' + hashlib.sha256(frozen_bytes).hexdigest()[:12]
    out = Path(a.out)
    digest = arrival_protocol.source_digest()
    mine = (ad.PROTOCOL, model, MAPPING_VERSION, digest)
    kept = {}                      # (day, what it was scored under) -> its record: one per version, none replaced
    if out.exists():
        for line in out.read_text().splitlines():
            if line.strip():
                e = json.loads(line)
                kept[(e['day'], arrival_protocol.identity(e))] = e
    # Scored under this protocol, model and stop mapping already, with or without the digest it was recorded with.
    done = {d for (d, ident) in kept if ident[:3] == mine[:3]}
    todo = [d for d in sorted(inputs['days']) if d not in done or (a.rescore and d < CONFIRMATION_FROM)]
    if not todo:
        print(json.dumps({'scored': [], 'note': 'nothing extracted that is not already scored under this protocol'}))
        return
    catalogue = json.loads(Path(a.catalogue).read_text())
    patterns = {p['id']: p for p in catalogue['patterns'] if p['operator'] == inputs['operator'] and p['line'] == inputs['line']}
    tracks = {pid: load_track(pid, p['stops']) for pid, p in patterns.items()}
    dep_info = {pid: _departure_info(text) for pid, text in inputs['depInfo']}
    for day in todo:
        entry = score_day(day, inputs['days'][day], inputs, patterns, tracks, dep_info, frozen['params'], frozen['cruise'], model,
                          digest)
        kept[(day, mine)] = entry
        print(json.dumps({'day': day, 'split': entry['split'],
                          'journeys': {d: len(v['journeys']) for d, v in entry['directions'].items()},
                          'displayMoments': {d: sum(sum(c for _, c in j['signed']) for j in v['journeys'])
                                             for d, v in entry['directions'].items()}}))
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(''.join(json.dumps(kept[k]) + '\n' for k in sorted(kept, key=lambda k: (k[0], json.dumps(k[1])))))
    print(f"{out} now holds {len({d for d, _ in kept})} day(s), {len(kept)} record(s)")


if __name__ == '__main__':
    main()
