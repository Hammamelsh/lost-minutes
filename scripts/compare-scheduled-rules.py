"""Both scheduled-journey rules against ONE stored publication and ONE catalogue.

The two live snapshots quoted on 20 September 2026 (123 of 218 named, then 163 of 224) were
different fleets at different moments: consistent with the change, not evidence for it. This
holds everything fixed except the rule. Departure groups are counted apart from vehicles, because
one group can hold many buses and the rule acts on groups.

    .venv/bin/python scripts/compare-scheduled-rules.py \
        data/evaluation/publication-20260920-scheduled.json
"""
import json
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from pipeline.match import load_patterns  # noqa: E402
from pipeline.warehouse import DEFAULT_DB, connect  # noqa: E402

LONDON = ZoneInfo('Europe/London')


def old_rule(hits):
    """Named only when exactly one journey leaves at that time."""
    return len(hits) == 1


def new_rule(hits):
    """Named when every journey at that time runs the same timing."""
    return len(hits) >= 1 and len(set(hits)) == 1


def main(path):
    publication = json.loads(Path(path).read_text())
    con = connect(ROOT / DEFAULT_DB, read_only=True) if 'read_only' in connect.__code__.co_varnames else connect(ROOT / DEFAULT_DB)
    patterns = {p['id']: p for p in load_patterns(con)}
    vehicles = [v for v in publication['vehicles'] if 'patternId' in (v.get('match') or {})]

    groups = defaultdict(list)          # (patternId, local departure) -> [vehicle keys]
    unresolvable = Counter()
    for v in vehicles:
        aimed = v.get('aimedDeparture')
        pattern = patterns.get(v['match']['patternId'])
        if not aimed or not pattern:
            unresolvable['no aimed departure or pattern'] += 1
            continue
        local = datetime.fromisoformat(aimed.replace('Z', '+00:00')).astimezone(LONDON).strftime('%H:%M:%S')
        groups[(pattern['id'], local)].append(f"{v['operator']}|{v['vehicle']}")

    per_group = {}
    for (pid, local), keys in groups.items():
        info = patterns[pid].get('departureInfo') or {'departures': []}
        hits = [i for t, i in info['departures'] if t == local]
        per_group[(pid, local)] = {'vehicles': len(keys), 'journeys': len(hits), 'timings': len(set(hits)),
                                   'old': old_rule(hits), 'new': new_rule(hits)}

    g_old = sum(1 for g in per_group.values() if g['old'])
    g_new = sum(1 for g in per_group.values() if g['new'])
    v_old = sum(g['vehicles'] for g in per_group.values() if g['old'])
    v_new = sum(g['vehicles'] for g in per_group.values() if g['new'])
    gained = [(k, g) for k, g in per_group.items() if g['new'] and not g['old']]
    lost = [(k, g) for k, g in per_group.items() if g['old'] and not g['new']]
    not_in = sum(1 for g in per_group.values() if g['journeys'] == 0)

    print(f"publication {publication['publishedAt'][:19]}  matched vehicles {len(vehicles)}  "
          f"departure groups {len(per_group)}  (skipped: {dict(unresolvable) or 'none'})")
    print()
    print(f"{'':28}{'old rule':>12}{'new rule':>12}{'change':>10}")
    print(f"{'departure groups named':28}{g_old:>12}{g_new:>12}{g_new - g_old:>+10}")
    print(f"{'vehicles with a time shown':28}{v_old:>12}{v_new:>12}{v_new - v_old:>+10}")
    print(f"{'groups not in timetable':28}{not_in:>12}{not_in:>12}{0:>+10}")
    print()
    print(f"groups gained by the new rule: {len(gained)}  (vehicles {sum(g['vehicles'] for _, g in gained)})")
    for (pid, local), g in sorted(gained, key=lambda x: -x[1]['vehicles'])[:6]:
        print(f"   {pid:34} {local}  journeys {g['journeys']}  timings {g['timings']}  vehicles {g['vehicles']}")
    print(f"groups lost by the new rule: {len(lost)}  (expected 0: a single journey is a single timing)")
    still = [(k, g) for k, g in per_group.items() if not g['new'] and g['journeys'] > 1]
    print(f"groups still refused, journeys differ in timing: {len(still)}  (vehicles {sum(g['vehicles'] for _, g in still)})")
    print()
    print("Claim this supports: on this publication, with this catalogue, the new rule names every group the old")
    print("rule named plus those where all retained candidate journeys share a timing. It does not identify a")
    print("unique journey in those groups; it establishes that they agree on the scheduled time at every stop,")
    print("subject to the match and the timetable being right.")


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else ROOT / 'data/evaluation/publication-20260920-scheduled.json')
