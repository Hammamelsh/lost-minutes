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
from zoneinfo import ZoneInfo
from datetime import datetime
import math
import re

from .patterns import _departure_info
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
    # Held, but not for this day. That is "we cannot say", not "this bus does not go that way":
    # route 256 has Saturday and Sunday journeys towards Piccadilly Gardens in the registration
    # in force, and no Monday-to-Friday ones at all, so every weekday inbound 256 lands here.
    'no_pattern_for_direction_today': 'The timetable held for this route has journeys in this '
                                      'direction, but none on this day of the week, so which '
                                      'stops this bus calls at cannot be said.',
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
                   has_repeated_stop, stop_count, valid_from, valid_to, operating_rules,
                   departure_times
            FROM service_pattern""").fetchall():
        stops = sequences.get(row[0], [])
        patterns.append({
            'id': row[0], 'line': row[1], 'operator': row[2] or None,
            'direction': (row[3] or '').lower(), 'destination': row[4], 'loop': bool(row[5]),
            'stopCount': int(row[6]), 'validFrom': parse_iso(row[7]), 'validTo': parse_iso(row[8]),
            'rules': json.loads(row[9]) if row[9] else None,
            'departureInfo': _departure_info(row[10] if len(row) > 10 else None),
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

    valid = same_service
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

    def _fits_direction(pattern):
        return not direction or not pattern['direction'] or pattern['direction'] == direction

    candidates = [p for p in same_service if _fits_direction(p)]
    if not candidates:
        # A direction held for other days of the week is a different situation from one the
        # timetable never describes, and the passenger is told which.
        held_other_days = day is not None and any(_fits_direction(p) for p in valid)
        return {'matched': False,
                'reason': 'no_pattern_for_direction_today' if held_other_days
                          else 'no_pattern_for_direction',
                'evidence': evidence}

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
                onward = [_sequence(item[1])[item[2][0] + 1:] for item in plausible]
                result['sharedNext'] = _common_prefix(onward)
                # Candidates that differ only in stops already behind the bus agree on every
                # stop ahead: its progress from here can be stated, though which pattern it is
                # running still cannot, and it is not counted as matched.
                result['sharedOnward'] = len({tuple(stops) for stops in onward}) == 1
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


LONDON = ZoneInfo('Europe/London')


def scheduled_journey(vehicle, pattern_id, patterns):
    """Which scheduled journey a matched bus is running, from the operator's own reported
    origin departure time against the pattern's timetabled departures. Returns a dict with the
    local HH:MM:SS departure and how many journeys on this pattern share it, or a reason.

    This names a journey; it predicts nothing. A time at a later stop is this departure plus the
    pattern's scheduled seconds to that stop, and is labelled as the timetable's, not ours."""
    aimed = vehicle.get('aimedDeparture')
    if not aimed:
        return {'reason': 'no_aimed_departure_reported'}
    try:
        when = datetime.fromisoformat(aimed.replace('Z', '+00:00')).astimezone(LONDON)
    except ValueError:
        return {'reason': 'aimed_departure_unreadable'}
    local = when.strftime('%H:%M:%S')
    pattern = next((p for p in patterns if p['id'] == pattern_id), None)
    info = (pattern or {}).get('departureInfo') or {'departures': []}
    if not info['departures']:
        return {'reason': 'pattern_has_no_departure_times'}
    hits = [index for time, index in info['departures'] if time == local]
    if not hits:
        return {'reason': 'aimed_departure_not_in_timetable', 'aimedLocal': local}
    # Several journeys at one departure are one answer only if they share a timing: then
    # whichever this is, it reaches every stop at the same scheduled second.
    if len(set(hits)) == 1:
        return {'departure': local, 'journeys': len(hits), 'timing': hits[0],
                'serviceDay': when.date().isoformat()}
    return {'reason': 'journeys_at_this_time_differ_in_timing', 'journeys': len(hits), 'aimedLocal': local}


def match_all(con, vehicles):
    """Match every published vehicle, and summarise why the rest could not be matched."""
    patterns = load_patterns(con)
    summary = {'matched': 0, 'unmatched': 0, 'reasons': {}}
    for vehicle in vehicles:
        day = service_day(vehicle['observedAtMs']) if vehicle.get('observedAtMs') else None
        result = match_vehicle(vehicle, patterns, day)
        if result['matched']:
            result['scheduled'] = scheduled_journey(vehicle, result['patternId'], patterns)
            vehicle['match'] = {k: v for k, v in result.items() if k != 'matched'}
            summary['matched'] += 1
        else:
            entry = {'unresolved': result['reason'],
                     'explanation': REASONS.get(result['reason'], result['reason'])}
            for key in ('candidates', 'nearestStop', 'sharedNext', 'sharedOnward',
                        'metresFromPatternStop', 'nearestPatternMetres', 'evidence'):
                if key in result:
                    entry[key] = result[key]
            vehicle['match'] = entry
            summary['unmatched'] += 1
            summary['reasons'][result['reason']] = summary['reasons'].get(result['reason'], 0) + 1
    return summary
