"""Read the release criteria on the display protocol's confirmation days, and publish the verdict the page reads.

Since 29 September 2026 the criteria (docs/ARRIVAL_RELEASE_CRITERIA.md, thresholds unchanged) are read on the
moments a page would show an estimate (docs/ARRIVAL_DISPLAY_PROTOCOL.md, protocol display-1), scored a day at a
time by scripts/evaluate-arrival-display.py into data/evaluation/arrival-display-nightly.jsonl. This pools them:

  - revision days (before the confirmation window) are reported, and decide nothing;
  - the confirmation window (seven service days from 29 September) is reported as collecting until every day
    of it is scored, and then read once, per direction, against every criterion and the frozen interval;
  - a direction that passes is published as an exact scope (operator, line, direction, patterns, model,
    protocol, and the validated interval) only when the approval file names it field for field and cites the
    SHA-256 of the window's own results (`confirmationDigest`), which exists only once they do: an approval
    written beforehand approves nothing, and results never approve themselves. A bare direction approves
    nothing, and `released`, the list older pages read, is always empty;
  - the version must be the frozen one (pipeline/arrival_protocol.py): the model and the code that defines it
    as frozen, and its window untouched, no day of it scored under anything else. Otherwise the verdict is
    invalid and nothing is proposed: a change to the model or the display is a new version with a new window.

    .venv/bin/python scripts/arrival-release-check.py [--display data/evaluation/arrival-display-nightly.jsonl]
        [--approval deploy/arrival-release-approval.json] [--out public/data/arrival-release.json]
"""
import argparse
import hashlib
import json
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from pipeline import arrival_display as ad  # noqa: E402  (no DuckDB: this reads JSON only)
from pipeline import arrival_protocol  # noqa: E402
from pipeline.stop_mapping import MAPPING_VERSION  # noqa: E402

LONDON = ZoneInfo('Europe/London')
MODEL = arrival_protocol.VERSIONS[ad.PROTOCOL]['model']   # the frozen parameters' hash (scripts/arrival-params-frozen.json)


def window():
    return arrival_protocol.window(ad.PROTOCOL)


def approved_scope(approval, proposal):
    """The part of a passing scope the approval file names exactly, or None. Every field must match, the
    confirmation digest among them; a pattern is released only if the approval names it and it was scored."""
    for entry in (approval or {}).get('approved') or []:
        if not isinstance(entry, dict):
            continue                                   # a bare direction approves nothing
        if any(entry.get(k) != proposal[k] for k in ('operator', 'line', 'direction', 'model', 'protocol', 'confirmationDigest')):
            continue
        patterns = [p for p in entry.get('patternIds') or [] if p in proposal['patternIds']]
        if patterns:
            return {**proposal, 'patternIds': patterns}
    return None


def checks_for(r):
    t = ad.THRESHOLDS
    better = (r['timetableMedianAbsWherePaired'] - r['medianAbsWherePaired']
              if r['timetableMedianAbsWherePaired'] is not None and r['medianAbsWherePaired'] is not None else None)
    return {'medianAbs<=1.5': r['medianAbs'] is not None and r['medianAbs'] <= t['medianAbs'],
            'p80Abs<=3.0': r['p80Abs'] is not None and r['p80Abs'] <= t['p80Abs'],
            'betterThanTimetableBy0.5': better is not None and better >= t['betterThanTimetable'],
            'coverage>=50%': r['coverage'] is not None and r['coverage'] >= t['coverage'],
            'journeys>=20': r['journeys'] >= t['minJourneys'],
            'passages>=150': r['passages'] >= t['minPassages'],
            'weekdays>=1': r['weekdays'] >= t['minWeekdays'],
            'intervalCoverage>=80%': r['intervalCoverage'] is not None and r['intervalCoverage'] >= t['intervalCoverage']}


def fragile(r):
    """Criteria a 95% interval by journey crosses: a pass that could as well have been a fail."""
    b = r.get('bootstrap') or {}
    out = []
    for key, limit in (('medianAbs95', ad.THRESHOLDS['medianAbs']), ('p80Abs95', ad.THRESHOLDS['p80Abs'])):
        ci = b.get(key)
        if ci and ci[0] <= limit < ci[1]:
            out.append(key)
    ci = b.get('intervalCoverage95')
    if ci and ci[0] < ad.THRESHOLDS['intervalCoverage'] <= ci[1]:
        out.append('intervalCoverage95')
    return out


def summary(entries, direction, interval):
    journeys = [j for e in entries for j in e['directions'].get(direction, {}).get('journeys', [])]
    r = ad.summarise(journeys, interval)
    r['days'] = [e['day'] for e in entries if e['directions'].get(direction, {}).get('journeys')]
    r['weekdays'] = sum(1 for e in entries if e.get('weekday') and e['directions'].get(direction, {}).get('journeys'))
    return r


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--display', default=str(ROOT / 'data/evaluation/arrival-display-nightly.jsonl'))
    ap.add_argument('--out', default=str(ROOT / 'public/data/arrival-release.json'))
    ap.add_argument('--approval', default=None, help='a JSON file whose "approved" list names, field for field, the scopes '
                                                        'the owner has agreed may be shown, each citing the results it approves')
    ap.add_argument('--params', default=str(ROOT / 'scripts/arrival-params-frozen.json'))
    ap.add_argument('--source-root', default=str(ROOT), help='where the code that defines the version is read from')
    a = ap.parse_args()
    approval = json.loads(Path(a.approval).read_text()) if a.approval else None
    path = Path(a.display)
    entries = [json.loads(line) for line in path.read_text().splitlines() if line.strip()] if path.exists() else []
    current = lambda e: (e.get('protocol'), e.get('model'), e.get('stopMapping')) == (ad.PROTOCOL, MODEL, MAPPING_VERSION)
    usable = sorted((e for e in entries if current(e)), key=lambda e: e['day'])
    days = window()
    own = arrival_protocol.expected(ad.PROTOCOL)
    # Revision days decide nothing and are summed as scored; a confirmation day counts only as the frozen version.
    revision = [e for e in usable if e['day'] < ad.CONFIRMATION_FROM]
    confirmation = [e for e in entries if e.get('day') in days and arrival_protocol.identity(e) == own]
    complete = sorted(e['day'] for e in confirmation) == days
    on_disk = 'blended@' + hashlib.sha256(Path(a.params).read_bytes()).hexdigest()[:12]
    invalid = arrival_protocol.deployed_problems(ad.PROTOCOL, on_disk, a.source_root)
    touched = arrival_protocol.touched_days(entries, ad.PROTOCOL)
    if touched:
        invalid.append(f"its confirmation window is not untouched: {', '.join(touched)} scored under something else")
    verdict = {'schemaVersion': 3, 'generatedAt': datetime.now(LONDON).isoformat(), 'protocol': ad.PROTOCOL,
               'model': MODEL, 'stopMapping': MAPPING_VERSION, 'thresholds': ad.THRESHOLDS,
               'confirmation': {'window': days, 'scored': [e['day'] for e in confirmation], 'complete': complete,
                                'note': 'read once, when every day of the window is scored'},
               'directions': {}, 'scopes': [], 'awaitingApproval': [],
               'released': [], 'releasedNote': 'directions alone release nothing since 28 September 2026: see scopes',
               'approval': {'file': a.approval, 'entries': (approval or {}).get('approved') or []} if a.approval else None,
               'skipped': sorted({e['day'] for e in entries if not current(e)}), 'invalid': invalid}
    for (operator, line, direction), interval in sorted(ad.FROZEN_INTERVALS.items()):
        patterns = sorted({p for e in usable if (e.get('operator'), e.get('line')) == (operator, line)
                           for p in e['directions'].get(direction, {}).get('patternIds', [])})
        rev = summary([e for e in revision if (e.get('operator'), e.get('line')) == (operator, line)], direction, interval)
        conf = summary([e for e in confirmation if (e.get('operator'), e.get('line')) == (operator, line)], direction, interval)
        block = {'operator': operator, 'line': line, 'direction': direction, 'patternIds': patterns,
                 'interval': {'low': interval[0], 'high': interval[1], 'nominal': ad.INTERVAL_NOMINAL},
                 'revision': rev, 'confirmation': conf, 'released': False}
        if invalid:
            block['status'] = 'invalid: ' + '; '.join(invalid)
        elif not complete:
            block['status'] = f"collecting: {len(confirmation)} of {len(days)} confirmation days scored"
        else:
            digest = arrival_protocol.confirmation_digest(entries, ad.PROTOCOL, direction)
            block['confirmation']['digest'] = digest
            checks = checks_for(conf)
            block.update({'checks': checks, 'fragile': fragile(conf),
                          'status': 'passed' if all(checks.values()) else 'not met: ' + ', '.join(k for k, v in checks.items() if not v)})
            if all(checks.values()):
                proposal = {'operator': operator, 'line': line, 'direction': direction, 'patternIds': patterns,
                            'model': MODEL, 'protocol': ad.PROTOCOL, 'confirmationDigest': digest,
                            'interval': {'low': interval[0], 'high': interval[1], 'coverage': conf['intervalCoverage']},
                            'medianAbs': conf['medianAbs'], 'p80Abs': conf['p80Abs']}
                scope = approved_scope(approval, proposal)
                if scope:
                    verdict['scopes'].append(scope)
                    block['released'] = True
                else:
                    verdict['awaitingApproval'].append(proposal)
        verdict['directions'][direction] = block
        fmt = lambda x: '-' if x is None else f'{x:.2f}'
        print(f"{operator} {line} {direction:9} revision {len(rev['days'])} days: median {fmt(rev['medianAbs'])} p80 {fmt(rev['p80Abs'])} "
              f"coverage {fmt(rev['coverage'])} | confirmation {len(conf['days'])} of {len(days)} days: median {fmt(conf['medianAbs'])} "
              f"p80 {fmt(conf['p80Abs'])} -> {block['status']}{' RELEASED' if block['released'] else ''}")
    Path(a.out).write_text(json.dumps(verdict, indent=1))
    print(f'written {a.out}: {len(verdict["scopes"])} scope(s) released')


if __name__ == '__main__':
    main()
