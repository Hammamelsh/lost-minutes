"""Place an observed bus on a service pattern, or say precisely why we cannot.

The published position tells us where a bus was. It does not tell us which of a line's
branches it is running, which way round it is going, or whether it has already passed you.
This module answers what the timetable and the position can support, and records a reason
whenever they cannot. A refusal is a result, not a failure.

Identity comes before geometry. A pattern is a candidate only if it belongs to the same
operator, comes from a timetable version valid on the day of the report, has journeys on that
day, and runs in the direction the operator reported. A route number alone is not a service.

Then position chooses between candidates, and when two different paths fit the position
equally well the result stays unresolved and carries every candidate. A shared current stop
is not a shared destination: branches that meet here can part at the next stop. The operator's
own reported destination may settle it; nothing else here is allowed to.

No prediction is made. Matching a bus to a pattern says where it is along an ordered list of
stops; it says nothing about when it will reach any of them.
"""
from __future__ import annotations

import json
import math
import re

from .service_days import WEEKDAY_NAMES, parse_iso, pattern_runs_on, service_day

# Urban stop spacing in Manchester is a few hundred metres. Beyond this the nearest pattern
# stop is not evidence that the bus is on that pattern at all.
MAX_METRES_FROM_PATTERN = 500
# Two candidate paths whose best stops are within this of each other are not distinguishable
# by position alone.
AMBIGUOUS_MARGIN_METRES = 60

REASONS = {
    'no_pattern_for_route': 'No timetable pattern is held for this route label.',
    'no_pattern_for_operator': 'Timetables for this route number are held, but for a different '
                               'operator, so they describe a different service.',
    'no_pattern_valid_on_date': 'The timetable held for this service is not valid on the day '
                                'of this report.',
    'no_pattern_operating_today': 'The timetable held for this service has no journeys on this '
                                  'day, so none of its patterns can be the one this bus is running.',
    'no_pattern_for_direction': 'Patterns are held for this route, but not for the direction '
                                'the operator reported.',
    'too_far_from_pattern': 'The bus is too far from any stop on the route to say where along '
                            'it the bus has got to.',
    'ambiguous_branch': 'More than one branch of this route fits the position, so which one the '
                        'bus is on cannot be settled from the position alone.',
    'loop_pattern': 'This pattern calls at the same stop more than once, so a position does '
                    'not identify a single point of progress.',
    'no_stop_coordinates': 'The patterns this bus could be running call at no stop inside the '
                           'area we hold stops for, so it cannot be placed on one.',
}

# Words that name the kind of place rather than the place, dropped before destinations are
# compared: "Stockport_Interchange" and "Stockport" name the same end of a route.
GENERIC_PLACE_WORDS = {'bus', 'station', 'interchange', 'the', 'stop', 'stand', 'terminus'}


def metres_between(a_lat, a_lon, b_lat, b_lon):
    r = 6371000.0
    d_lat = math.radians(b_lat - a_lat)
    d_lon = math.radians(b_lon - a_lon)
    mid = math.radians((a_lat + b_lat) / 2)
    x = d_lon * math.cos(mid)
    return math.hypot(x, d_lat) * r


def load_patterns(con):
    """Every held pattern with its stop sequence, identity and the coordinates we hold.

    All of them, not only the published ones: whether a service runs today is a question about
    the whole timetable. Only stops inside the collected area carry coordinates, so a bus can
    only be placed on a pattern that calls there, which is exactly what gets published.
    """
    from .patterns import ensure_schema    # DuckDB-only path
    ensure_schema(con)
    coordinates = {row[0]: (row[1], row[2]) for row in
                   con.execute('SELECT atco_code, lat, lon FROM stop').fetchall()}
    sequences = {}
    for pattern_id, atco, metres in con.execute(
            'SELECT pattern_id, atco_code, distance_from_start_m FROM service_pattern_stop'
            ' ORDER BY pattern_id, sequence').fetchall():
        sequences.setdefault(pattern_id, []).append((atco, metres))
    patterns = []
    for row in con.execute("""
            SELECT pattern_id, line_name, operator_code, direction, destination_display,
                   has_repeated_stop, stop_count, valid_from, valid_to, operating_rules
            FROM service_pattern""").fetchall():
        stops = sequences.get(row[0], [])
        patterns.append({
            'id': row[0], 'line': row[1], 'operator': row[2] or None,
            'direction': (row[3] or '').lower(), 'destination': row[4], 'loop': bool(row[5]),
            'stopCount': int(row[6]), 'validFrom': parse_iso(row[7]), 'validTo': parse_iso(row[8]),
            'rules': json.loads(row[9]) if row[9] else None,
            'sequence': [atco for atco, _ in stops],
            'placed': [(index, atco, metres, coordinates[atco])
                       for index, (atco, metres) in enumerate(stops) if atco in coordinates]})
    return patterns


def _sequence(pattern):
    return pattern.get('sequence') or [stop[1] for stop in pattern['placed']]


def _common_prefix(lists):
    shared = []
    for items in zip(*lists):
        if len(set(items)) != 1:
            break
        shared.append(items[0])
    return shared


def _place(text):
    words = re.sub(r'[^a-z0-9 ]+', ' ', (text or '').replace('_', ' ').lower()).split()
    return ' '.join(word for word in words if word not in GENERIC_PLACE_WORDS)


def same_destination(reported, declared):
    """Conservative: the two name the same place only if one contains the other."""
    a, b = _place(reported), _place(declared)
    return bool(a and b) and (a == b or a in b or b in a)


def match_vehicle(vehicle, patterns, day=None):
    """Best pattern for one observed position, with its evidence or the reason there is none."""
    line = (vehicle.get('route') or '').strip()
    operator = (vehicle.get('operator') or '').strip()
    direction = (vehicle.get('direction') or '').strip().lower()
    evidence = {'operatorChecked': bool(operator), 'directionReported': bool(direction)}
    if day is not None:
        evidence.update({'serviceDay': day.isoformat(), 'weekday': WEEKDAY_NAMES[day.weekday()]})

    for_line = [p for p in patterns if p['line'] == line]
    if not for_line:
        return {'matched': False, 'reason': 'no_pattern_for_route', 'evidence': evidence}

    same_service = [p for p in for_line
                    if not operator or not p.get('operator') or p['operator'] == operator]
    if not same_service:
        return {'matched': False, 'reason': 'no_pattern_for_operator', 'evidence': evidence}

    if day is not None:
        valid = [p for p in same_service
                 if (not p.get('validFrom') or p['validFrom'] <= day)
                 and (not p.get('validTo') or day <= p['validTo'])]
        if not valid:
            return {'matched': False, 'reason': 'no_pattern_valid_on_date', 'evidence': evidence}
        # A pattern with no recorded rules was built before operating days were kept; it is
        # not excluded, and the evidence says the day could not be checked.
        running = [p for p in valid if pattern_runs_on(p.get('rules'), day) is not False]
        if not running:
            return {'matched': False, 'reason': 'no_pattern_operating_today', 'evidence': evidence}
        evidence['operatingDayChecked'] = all(p.get('rules') is not None for p in running)
        same_service = running

    candidates = [p for p in same_service if not direction or not p['direction']
                  or p['direction'] == direction]
    if not candidates:
        return {'matched': False, 'reason': 'no_pattern_for_direction', 'evidence': evidence}

    scored = []
    for pattern in candidates:
        if not pattern['placed']:
            continue
        best = min(pattern['placed'],
                   key=lambda s: metres_between(vehicle['lat'], vehicle['lon'], s[3][0], s[3][1]))
        scored.append((metres_between(vehicle['lat'], vehicle['lon'], best[3][0], best[3][1]),
                       pattern, best))
    if not scored:
        return {'matched': False, 'reason': 'no_stop_coordinates', 'evidence': evidence}

    scored.sort(key=lambda item: (item[0], -item[1]['stopCount']))
    distance = scored[0][0]
    if distance > MAX_METRES_FROM_PATTERN:
        return {'matched': False, 'reason': 'too_far_from_pattern',
                'nearestPatternMetres': round(distance), 'evidence': evidence}

    # Every distinct path that fits the position about as well as the best. Patterns with
    # identical stop sequences are one path, however many files or day types declare them.
    paths = {}
    for item in scored:
        if item[0] - distance < AMBIGUOUS_MARGIN_METRES:
            paths.setdefault(tuple(_sequence(item[1])), item)
    plausible = list(paths.values())
    evidence['plausiblePaths'] = len(plausible)
    reported = vehicle.get('destination') or ''
    chosen = plausible[0]
    if len(plausible) > 1:
        agreeing = [item for item in plausible if same_destination(reported, item[1].get('destination'))]
        if len(agreeing) == 1:
            chosen = agreeing[0]
            evidence['resolvedBy'] = 'reported_destination'
        else:
            nearest_codes = {item[2][1] for item in plausible}
            result = {'matched': False, 'reason': 'ambiguous_branch',
                      'candidates': [{'patternId': item[1]['id'], 'patternIndex': item[2][0]}
                                     for item in plausible],
                      'metresFromPatternStop': round(distance), 'evidence': evidence}
            if len(nearest_codes) == 1:
                # What every candidate agrees on next, in order. Beyond that they differ, and
                # the bus's destination is exactly what the position cannot tell us.
                result['nearestStop'] = nearest_codes.pop()
                result['sharedNext'] = _common_prefix(
                    [_sequence(item[1])[item[2][0] + 1:] for item in plausible])
            return result
    else:
        evidence['resolvedBy'] = 'position'

    _, pattern, nearest = chosen
    if pattern['loop']:
        return {'matched': False, 'reason': 'loop_pattern', 'evidence': evidence}
    evidence['destinationAgrees'] = (same_destination(reported, pattern.get('destination'))
                                     if reported and pattern.get('destination') else None)
    index, atco, metres, _ = nearest
    return {'matched': True, 'patternId': pattern['id'], 'patternIndex': index,
            'nearestStop': atco,
            'metresAlongPattern': int(metres) if metres is not None else None,
            'metresFromPatternStop': round(chosen[0]),
            'patternDirection': pattern['direction'] or None,
            'patternDestination': pattern.get('destination') or None,
            'evidence': evidence}


def match_all(con, vehicles):
    """Match every published vehicle, and summarise why the rest could not be matched."""
    patterns = load_patterns(con)
    summary = {'matched': 0, 'unmatched': 0, 'reasons': {}}
    for vehicle in vehicles:
        day = service_day(vehicle['observedAtMs']) if vehicle.get('observedAtMs') else None
        result = match_vehicle(vehicle, patterns, day)
        if result['matched']:
            vehicle['match'] = {k: v for k, v in result.items() if k != 'matched'}
            summary['matched'] += 1
        else:
            entry = {'unresolved': result['reason'],
                     'explanation': REASONS.get(result['reason'], result['reason'])}
            for key in ('candidates', 'nearestStop', 'sharedNext', 'metresFromPatternStop',
                        'nearestPatternMetres', 'evidence'):
                if key in result:
                    entry[key] = result[key]
            vehicle['match'] = entry
            summary['unmatched'] += 1
            summary['reasons'][result['reason']] = summary['reasons'].get(result['reason'], 0) + 1
    return summary
