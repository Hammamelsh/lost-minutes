"""Pool every nightly evaluation of the arrival candidate and read the release criteria over it.

The nightly unit scores one snapshot a night with frozen parameters and appends a line to
data/evaluation/arrival-nightly.jsonl: that night's unseen journeys, passages and per-direction
errors at the release band. This pools those nights, per direction, and prints the criteria
(docs/ARRIVAL_RELEASE_CRITERIA.md, as amended on 20 September to apply per direction to data
unseen at the time of the amendment) against the pooled set. It writes the verdict to
public/data/arrival-release.json, which the page reads: a direction passes only when this file
says so, and nothing is shown until then.

    .venv/bin/python scripts/arrival-release-check.py [--nightly data/evaluation/arrival-nightly.jsonl]
"""
import argparse
import json
import statistics
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
LONDON = ZoneInfo('Europe/London')
THRESHOLDS = {'medianAbs': 1.5, 'p80Abs': 3.0, 'minJourneys': 20, 'minPassages': 150}


def pct(values, q):
    if not values:
        return None
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(q * len(ordered)))]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--nightly', default=str(ROOT / 'data/evaluation/arrival-nightly.jsonl'))
    ap.add_argument('--out', default=str(ROOT / 'public/data/arrival-release.json'))
    a = ap.parse_args()
    path = Path(a.nightly)
    nights = [json.loads(line) for line in path.read_text().splitlines() if line.strip()] if path.exists() else []
    verdict = {'schemaVersion': 1, 'generatedAt': datetime.now(LONDON).isoformat(), 'nights': len(nights),
               'thresholds': THRESHOLDS, 'directions': {}, 'released': []}
    for direction in ('inbound', 'outbound'):
        errs, journeys, passages, weekdays = [], 0, 0, 0
        for night in nights:
            d = night.get('directions', {}).get(direction)
            if not d:
                continue
            errs.extend(d.get('absErrorsReleaseBand', []))
            journeys += d.get('journeys', 0)
            passages += d.get('passages', 0)
            weekdays += 1 if night.get('weekday') else 0
        med, p80 = (statistics.median(errs) if errs else None), pct(errs, .8)
        checks = {'medianAbs<=1.5': med is not None and med <= THRESHOLDS['medianAbs'],
                  'p80Abs<=3.0': p80 is not None and p80 <= THRESHOLDS['p80Abs'],
                  'journeys>=20': journeys >= THRESHOLDS['minJourneys'],
                  'passages>=150': passages >= THRESHOLDS['minPassages'],
                  'weekdayNights>=1': weekdays >= 1}
        ok = all(checks.values())
        verdict['directions'][direction] = {'moments': len(errs), 'journeys': journeys, 'passages': passages, 'weekdayNights': weekdays,
                                            'medianAbs': med, 'p80Abs': p80, 'checks': checks, 'released': ok}
        if ok:
            verdict['released'].append(direction)
        print(f'{direction:9} nights {sum(1 for n in nights if direction in n.get("directions", {}))}  journeys {journeys:3}  passages {passages:4}  '
              f'moments {len(errs):6}  median {med if med is None else round(med, 2)}  p80 {p80 if p80 is None else round(p80, 2)}  -> '
              + ('RELEASE' if ok else 'not yet: ' + ', '.join(k for k, v in checks.items() if not v)))
    Path(a.out).write_text(json.dumps(verdict, indent=1))
    print(f'written {a.out}: released {verdict["released"] or "nothing"}')


if __name__ == '__main__':
    main()
