"""Place an observed bus on a service pattern, or say precisely why we cannot.

The published position tells us where a bus was. It does not tell us which of a line's
branches it is running, which way round it is going, or whether it has already passed you.
This module answers the first two from the timetable and the position, and records a reason
whenever it cannot. A refusal is a result, not a failure.

No prediction is made here. Matching a bus to a pattern says where it is along an ordered
list of stops; it says nothing about when it will reach any of them.
"""
from __future__ import annotations

import math

# Urban stop spacing in Manchester is a few hundred metres. Beyond this the nearest pattern
# stop is not evidence that the bus is on that pattern at all.
MAX_METRES_FROM_PATTERN = 500
# Two candidate patterns whose best stops are within this of each other are not
# distinguishable by position alone.
AMBIGUOUS_MARGIN_METRES = 60

REASONS = {
    'no_pattern_for_route': 'No timetable pattern is held for this route label.',
    'no_pattern_for_direction': 'Patterns are held for this route, but not for the direction '
                                'the operator reported.',
    'too_far_from_pattern': 'The bus is too far from any stop on the route to say where along '
                            'it the bus has got to.',
    'ambiguous_branch': 'Two branches of this route fit the position equally well, so which '
                        'one the bus is on cannot be settled from the position.',
    'loop_pattern': 'This pattern calls at the same stop more than once, so a position does '
                    'not identify a single point of progress.',
    'no_stop_coordinates': 'The pattern stops here are outside the area we hold stop data for.',
}


def metres_between(a_lat, a_lon, b_lat, b_lon):
    r = 6371000.0
    d_lat = math.radians(b_lat - a_lat)
    d_lon = math.radians(b_lon - a_lon)
    mid = math.radians((a_lat + b_lat) / 2)
    x = d_lon * math.cos(mid)
    return math.hypot(x, d_lat) * r


def load_patterns(con):
    """Publishable patterns with their stop sequences and the coordinates we hold."""
    coordinates = {row[0]: (row[1], row[2]) for row in
                   con.execute('SELECT atco_code, lat, lon FROM stop').fetchall()}
    patterns = []
    for row in con.execute("""
            SELECT p.pattern_id, p.line_name, p.direction, p.destination_display,
                   p.has_repeated_stop, p.stop_count, p.stops_in_area
            FROM service_pattern p
            WHERE p.stops_in_area >= p.stop_count * 0.6""").fetchall():
        stops = con.execute(
            'SELECT atco_code, distance_from_start_m FROM service_pattern_stop'
            ' WHERE pattern_id = ? ORDER BY sequence', [row[0]]).fetchall()
        placed = [(index, atco, metres, coordinates[atco])
                  for index, (atco, metres) in enumerate(stops) if atco in coordinates]
        patterns.append({'id': row[0], 'line': row[1], 'direction': (row[2] or '').lower(),
                         'destination': row[3], 'loop': bool(row[4]),
                         'stopCount': int(row[5]), 'placed': placed})
    return patterns


def match_vehicle(vehicle, patterns):
    """Best pattern for one observed position, with the evidence or the reason there is none."""
    line = (vehicle.get('route') or '').strip()
    direction = (vehicle.get('direction') or '').strip().lower()
    for_line = [p for p in patterns if p['line'] == line]
    if not for_line:
        return {'matched': False, 'reason': 'no_pattern_for_route'}

    candidates = [p for p in for_line if not direction or not p['direction']
                  or p['direction'] == direction]
    if not candidates:
        return {'matched': False, 'reason': 'no_pattern_for_direction'}

    scored = []
    for pattern in candidates:
        if not pattern['placed']:
            continue
        best = min(pattern['placed'],
                   key=lambda s: metres_between(vehicle['lat'], vehicle['lon'], s[3][0], s[3][1]))
        distance = metres_between(vehicle['lat'], vehicle['lon'], best[3][0], best[3][1])
        scored.append((distance, pattern, best))
    if not scored:
        return {'matched': False, 'reason': 'no_stop_coordinates'}

    scored.sort(key=lambda item: (item[0], -item[1]['stopCount']))
    distance, pattern, nearest = scored[0]
    if distance > MAX_METRES_FROM_PATTERN:
        return {'matched': False, 'reason': 'too_far_from_pattern',
                'nearestPatternMetres': round(distance)}
    if pattern['loop']:
        return {'matched': False, 'reason': 'loop_pattern'}

    # Two different branches fitting equally well is not a match, it is a coin toss.
    rivals = [item for item in scored[1:]
              if item[1]['id'] != pattern['id'] and item[0] - distance < AMBIGUOUS_MARGIN_METRES]
    if rivals:
        rival_stop = rivals[0][2][1]
        if rival_stop != nearest[1]:
            return {'matched': False, 'reason': 'ambiguous_branch',
                    'candidates': [pattern['id'], rivals[0][1]['id']]}

    index, atco, metres, _ = nearest
    return {'matched': True, 'patternId': pattern['id'], 'patternIndex': index,
            'nearestStop': atco, 'metresAlongPattern': int(metres),
            'metresFromPatternStop': round(distance),
            'patternDirection': pattern['direction'] or None,
            'patternDestination': pattern['destination'] or None}


def match_all(con, vehicles):
    """Match every published vehicle, and summarise why the rest could not be matched."""
    patterns = load_patterns(con)
    summary = {'matched': 0, 'unmatched': 0, 'reasons': {}}
    for vehicle in vehicles:
        result = match_vehicle(vehicle, patterns)
        if result['matched']:
            vehicle['match'] = {k: v for k, v in result.items() if k != 'matched'}
            summary['matched'] += 1
        else:
            vehicle['match'] = {'unresolved': result['reason'],
                                'explanation': REASONS.get(result['reason'], result['reason'])}
            summary['unmatched'] += 1
            summary['reasons'][result['reason']] = summary['reasons'].get(result['reason'], 0) + 1
    return summary
