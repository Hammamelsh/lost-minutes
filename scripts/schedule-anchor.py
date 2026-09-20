"""Is the timetable's clock anchored where the bus actually is? Per pattern, from its own reports.

The page shows 'Timetabled at your stop 07:11' as the feed's origin departure plus the pattern's
scheduled seconds. On 20 September 2026 that was found to be about fifteen minutes early for
every inbound route-15 journey: the inbound journey key first appears in the feed a median
14.5 min after its registered departure, standing at the origin, on every day held. Outbound is
within about two minutes. The registration and the operator's running disagree about when the
inbound journey starts, and nothing on the page could tell.

So the timetabled line is now shown only for a pattern whose schedule has been checked against
inferred passages at its first stops: median signed error within ANCHOR_TOLERANCE_MIN on at
least MIN_PASSAGES passages. Everything else is withheld with the reason, exactly as an estimate
is withheld on a service whose movement has not been evaluated.

    .venv/bin/python scripts/schedule-anchor.py [--line 15] [--out public/data/schedule-anchor.json]

The output is published with the site, like motion-evaluation.json. A pattern not in it is not
verified.
"""
import argparse
import json
import statistics
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import importlib.util  # noqa: E402

spec = importlib.util.spec_from_file_location('ev', ROOT / 'scripts/evaluate-arrival.py')
ev = importlib.util.module_from_spec(spec)
sys.argv = [sys.argv[0]]
spec.loader.exec_module(ev)

LONDON = ZoneInfo('Europe/London')
ANCHOR_TOLERANCE_MIN = 3.0
MIN_PASSAGES = 20
FIRST_STOPS = 10          # the anchor is judged where the journey has just begun


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--line', default='15')
    ap.add_argument('--operator', default='BNML')
    ap.add_argument('--out', default=str(ROOT / 'public/data/schedule-anchor.json'))
    a = ap.parse_args()
    passages, patterns, dep_info, reports = ev.load_everything(a.line, a.operator)
    errors = defaultdict(list)
    days = defaultdict(set)
    for p in passages:
        if not p['scoreable'] or p['stop_index'] >= FIRST_STOPS:
            continue
        pattern = patterns.get(p['pattern_id'])
        sched = pattern and ev.scheduled_for(pattern, dep_info, p['journey_key'])
        if not sched:
            continue
        timing, dep_ms = sched
        sec = timing[p['stop_index']] if p['stop_index'] < len(timing) else None
        if sec is None:
            continue
        errors[p['pattern_id']].append((p['passed_at_ms'] - (dep_ms + sec * 1000)) / 60000)
        days[p['pattern_id']].add(ev.local_wall(p['passed_at_ms']).date().isoformat())

    out_path = Path(a.out)
    existing = json.loads(out_path.read_text()) if out_path.exists() else {'patterns': {}}
    result = {'schemaVersion': 1, 'generatedAt': datetime.now(LONDON).isoformat(),
              'rule': {'toleranceMinutes': ANCHOR_TOLERANCE_MIN, 'minimumPassages': MIN_PASSAGES, 'firstStops': FIRST_STOPS,
                       'basis': 'median signed error of inferred passages at the first stops against the feed origin departure plus timetable seconds'},
              'notes': ['A pattern absent from this file has not been checked, and its timetabled time is withheld.',
                        'Verified means the timetable clock starts where the bus does, within the tolerance; it says nothing about lateness later on.'],
              'patterns': dict(existing.get('patterns', {}))}
    for pid, errs in errors.items():
        med = statistics.median(errs)
        verified = abs(med) <= ANCHOR_TOLERANCE_MIN and len(errs) >= MIN_PASSAGES
        result['patterns'][pid] = {'verified': verified, 'medianOffsetMinutes': round(med, 2),
                                   'p80AbsMinutes': round(ev.pct([abs(e) for e in errs], .8), 2),
                                   'passages': len(errs), 'days': sorted(days[pid]),
                                   'reason': None if verified else (
                                       f'schedule runs {abs(med):.0f} min {"early" if med > 0 else "late"} against the bus’s own reports at its first stops'
                                       if len(errs) >= MIN_PASSAGES else f'only {len(errs)} passages to check against')}
        print(f"{pid:34} passages {len(errs):4}  median {med:+6.1f} min  -> {'VERIFIED' if verified else 'withheld: ' + result['patterns'][pid]['reason']}")
    out_path.write_text(json.dumps(result, indent=1))
    print(f'written {out_path}')


if __name__ == '__main__':
    main()
