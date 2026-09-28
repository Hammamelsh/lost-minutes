"""Pool every nightly evaluation of the arrival candidate and read the release criteria over it.

The nightly unit scores one snapshot a night with frozen parameters and writes one entry per day to
data/evaluation/arrival-nightly.jsonl: that day's journeys, passages and per-direction errors at the
release band, the counts coverage needs, both errors where the timetable's time exists too, the
patterns scored and the model. This pools those days, per direction, and reads **every** criterion of
docs/ARRIVAL_RELEASE_CRITERIA.md against the pooled set: median and 80th-percentile error, better
than the timetable by half a minute, coverage, the floors, a weekday. (Until 28 September 2026 it
read four of the six; the timetable comparison and coverage were not checked.)

It writes the verdict to public/data/arrival-release.json, which the page reads. A direction that
passes is shown only as an exact **scope**: an operator, a line, a direction, the patterns that were
scored and the model that scored them. A scope is released only when the approval file names it,
field for field; a bare direction ("outbound") approves nothing. `released`, the list of directions
the page read before 28 September, is always written empty, so a page from before then shows nothing.

    .venv/bin/python scripts/arrival-release-check.py [--nightly data/evaluation/arrival-nightly.jsonl]
        [--approval deploy/arrival-release-approval.json] [--out public/data/arrival-release.json]

Without --approval nothing is released: a passing scope is written as awaiting approval.
"""
import argparse
import json
import statistics
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
LONDON = ZoneInfo('Europe/London')
THRESHOLDS = {'medianAbs': 1.5, 'p80Abs': 3.0, 'betterThanScheduled': 0.5, 'coverage': 0.5,
              'minJourneys': 20, 'minPassages': 150}
# The first day no development or reserved evaluation had seen. The development set was 11-14 and
# 17-20 September and the reserved set was Sunday 20 September, scored and read that evening (10 of
# the 19 journeys the server holds for that day are those), so 20 September is not held out: checked
# journey by journey on 28 September 2026 (docs/MILESTONE_2026-09-28_ARRIVAL_PILOT.md).
UNSEEN_FROM = '2026-09-21'


def pct(values, q):
    if not values:
        return None
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(q * len(ordered)))]


def approved_scope(approval, proposal):
    """The part of a passing scope the approval file names exactly, or None. Every field must match;
    a pattern is released only if the approval names it and it was scored."""
    for entry in (approval or {}).get('approved') or []:
        if not isinstance(entry, dict):
            continue                                   # a bare direction approves nothing
        if any(entry.get(k) != proposal[k] for k in ('operator', 'line', 'direction', 'model')):
            continue
        patterns = [p for p in entry.get('patternIds') or [] if p in proposal['patternIds']]
        if patterns:
            return {**proposal, 'patternIds': patterns}
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--nightly', default=str(ROOT / 'data/evaluation/arrival-nightly.jsonl'))
    ap.add_argument('--out', default=str(ROOT / 'public/data/arrival-release.json'))
    ap.add_argument('--approval', default=None, help='a JSON file whose "approved" list names, field for field, the scopes '
                                                        'the owner has agreed may be shown once they pass')
    a = ap.parse_args()
    approval = json.loads(Path(a.approval).read_text()) if a.approval else None
    path = Path(a.nightly)
    # One entry per day, the latest scoring of that day winning, and only days after every development
    # and reserved set. An entry from before the criteria were read in full (no counts for coverage or
    # the timetable comparison, no model) counts toward nothing: the next nightly run re-scores its day.
    entries = [json.loads(line) for line in path.read_text().splitlines() if line.strip()] if path.exists() else []
    latest = {}
    for e in entries:
        day = e.get('day') or (e.get('days') or ['?'])[0]
        if day >= UNSEEN_FROM and (day not in latest or e.get('scoredAt', '') >= latest[day].get('scoredAt', '')):
            latest[day] = e
    nights = [latest[d] for d in sorted(latest)]
    # A night counts only if its passages named their stops by the shapes' explicit stop mapping (version 2,
    # 28 September 2026): before it, inbound passages were paired with the stops 14 earlier.
    usable = [n for n in nights if n.get('model') and n.get('operator') and n.get('line') and n.get('stopMapping') == 2]
    verdict = {'schemaVersion': 2, 'generatedAt': datetime.now(LONDON).isoformat(), 'nights': len(usable),
               'days': [n.get('day') for n in usable], 'unseenFrom': UNSEEN_FROM, 'thresholds': THRESHOLDS,
               'directions': {}, 'scopes': [], 'awaitingApproval': [],
               'released': [], 'releasedNote': 'directions alone release nothing since 28 September 2026: see scopes',
               'approval': {'file': a.approval, 'entries': (approval or {}).get('approved') or []} if a.approval else None,
               'skippedNights': [n.get('day') for n in nights if n not in usable]}
    for direction in ('inbound', 'outbound'):
        # One model and one service per scope: nights scored by another model are not pooled with these.
        groups = {}
        for night in usable:
            d = night.get('directions', {}).get(direction)
            if d and d.get('moments') is not None:
                groups.setdefault((night['operator'], night['line'], night['model']), []).append((night, d))
        for (operator, line, model), members in sorted(groups.items()):
            errs, both_c, both_s, patterns, shown = [], [], [], set(), []
            journeys = passages = moments = with_estimate = weekdays = 0
            for night, d in members:
                errs.extend(d.get('absErrorsReleaseBand', []))
                both_c.extend(d.get('bothCandidateAbs', []))
                both_s.extend(d.get('bothScheduledAbs', []))
                shown.extend(d.get('absErrorsShownBand', []))
                patterns.update(d.get('patternIds', []))
                journeys += d.get('journeys', 0)
                passages += d.get('passages', 0)
                moments += d.get('moments', 0)
                with_estimate += d.get('withEstimate', 0)
                weekdays += 1 if night.get('weekday') and d.get('journeys', 0) else 0
            med, p80 = (statistics.median(errs) if errs else None), pct(errs, .8)
            med_c = statistics.median(both_c) if both_c else None
            med_s = statistics.median(both_s) if both_s else None
            coverage = with_estimate / moments if moments else None
            checks = {'medianAbs<=1.5': med is not None and med <= THRESHOLDS['medianAbs'],
                      'p80Abs<=3.0': p80 is not None and p80 <= THRESHOLDS['p80Abs'],
                      'betterThanScheduledBy0.5': med_c is not None and med_s is not None
                                                  and med_s - med_c >= THRESHOLDS['betterThanScheduled'],
                      'coverage>=50%': coverage is not None and coverage >= THRESHOLDS['coverage'],
                      'journeys>=20': journeys >= THRESHOLDS['minJourneys'],
                      'passages>=150': passages >= THRESHOLDS['minPassages'],
                      'weekdayNights>=1': weekdays >= 1}
            ok = all(checks.values())
            proposal = {'operator': operator, 'line': line, 'direction': direction, 'patternIds': sorted(patterns),
                        'model': model, 'medianAbs': med, 'p80Abs': p80}
            scope = approved_scope(approval, proposal) if ok else None
            verdict['directions'][direction] = {
                'operator': operator, 'line': line, 'model': model, 'patternIds': sorted(patterns), 'nights': len(members),
                'moments': moments, 'withEstimate': with_estimate, 'coverage': coverage, 'journeys': journeys, 'passages': passages,
                'weekdayNights': weekdays, 'medianAbs': med, 'p80Abs': p80, 'pairedMoments': len(both_c),
                'medianAbsWherePaired': med_c, 'scheduledMedianAbsWherePaired': med_s,
                'checks': checks, 'passed': ok, 'released': scope is not None,
                # Not a criterion: the same errors on the moments a page would show, chosen by its own
                # predicted minutes (2-10). Read before approving; on 28 September they missed both thresholds.
                'shownBand': {'moments': len(shown), 'medianAbs': statistics.median(shown) if shown else None,
                              'p80Abs': pct(shown, .8)}}
            if scope:
                verdict['scopes'].append(scope)
            elif ok:
                verdict['awaitingApproval'].append(proposal)
            print(f'{operator} {line} {direction:9} nights {len(members)}  journeys {journeys:3}  passages {passages:5}  '
                  f'median {med if med is None else round(med, 2)}  p80 {p80 if p80 is None else round(p80, 2)}  '
                  f'vs timetable {None if med_s is None or med_c is None else round(med_s - med_c, 2)}  '
                  f'coverage {None if coverage is None else round(coverage, 3)}  '
                  f'shown band {None if not shown else round(statistics.median(shown), 2)}/{None if not shown else round(pct(shown, .8), 2)}  -> '
                  + (('RELEASED: ' + ', '.join(scope['patternIds'])) if scope
                     else 'PASSED, awaiting an exact approval' if ok
                     else 'not met: ' + ', '.join(k for k, v in checks.items() if not v)))
    Path(a.out).write_text(json.dumps(verdict, indent=1))
    print(f'written {a.out}: {len(verdict["scopes"])} scope(s) released'
          + (f'; awaiting approval {[p["direction"] for p in verdict["awaitingApproval"]]}' if verdict['awaitingApproval'] else ''))


if __name__ == '__main__':
    main()
