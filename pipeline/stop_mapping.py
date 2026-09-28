"""Which stop of a pattern each measured point on its road belongs to: an explicit, versioned mapping.

A road shape is built by routing a bus through a pattern's stops *inside the service area* only
(pipeline/shapes.py): a pattern can start outside it (inbound 15 calls at 14 stops first), end outside
it, leave and re-enter it, or call at one stop twice. Until 28 September 2026 a shape carried a bare
list of offsets, one per stop it was built through, and every reader paired the k-th offset with the
pattern's k-th stop. That was right for 276 of the 560 published shapes, whose stops inside the area
come first, and wrong for the other 284: on inbound 15 each stop was read as the one 14 places on, which
made its timetable look 15 minutes early and its arrival evaluation invalid
(docs/MILESTONE_2026-09-28_ARRIVAL_PILOT.md §6).

Version 2 names each placed stop as an *occurrence*: its index in the pattern's full stop list, its
stop code, and its offset along the road. An index is an occurrence, so a stop visited twice has two.
A reader uses a mapping only when its version, its pattern, the pattern's stop count and every stop
code agree with the pattern it holds (`aligned_offsets`), and refuses it otherwise; it never pairs by
list position again. The page applies the same rule (lib/stop-mapping.ts).

Where a mapping comes from, in order of preference:
  - the build itself, which knows which stops it routed (`from_placed`);
  - for shapes built before this existed, the build's own routing requests, stored by SHA-256 in
    data/raw/shapes: their locations are the routed stops' coordinates, in order (`from_requests`).
Either is then checked against geometry it did not come from (`geometry_check`): each stop's own
coordinates must lie near the road at the offset the mapping gives it.
"""
from __future__ import annotations

import math

MAPPING_VERSION = 2
# Published stop coordinates are rounded to five decimals (about 1.1 m), the router's echo to six.
COORD_TOLERANCE_DEG = 1.5e-5
# A routed stop sits beside its road: the router ends a leg where the stop meets the road. Over every
# published shape on 28 September 2026 (560 shapes, 15,960 stops) a stop lay a median 6.5 m from the road
# at its own offset, 12.7 m at the 99th percentile and 15.7 m at worst; read by list position instead, the
# 284 shapes that differ had a median worst stop 1,047 m away. A stop further than this fails the check.
GEOMETRY_TOLERANCE_M = 30.0


class MappingError(ValueError):
    """A mapping that cannot be trusted for this pattern. Never repaired, never guessed around."""


def mapping(pattern_id, pattern_stop_count, occurrences, source):
    """The published form. `occurrences` is [(pattern index, stop code, offset metres)] in road order."""
    return {'version': MAPPING_VERSION, 'patternId': pattern_id, 'patternStopCount': pattern_stop_count,
            'source': source,
            'occurrences': [{'index': int(i), 'stop': stop, 'offset': float(offset)} for i, stop, offset in occurrences]}


def from_placed(pattern_id, pattern_stop_count, placed, offsets):
    """From the build: `placed` is [(pattern index, stop code)] of the stops it routed, in order."""
    if len(placed) != len(offsets):
        raise MappingError(f'{len(placed)} stops routed but {len(offsets)} offsets measured')
    return mapping(pattern_id, pattern_stop_count,
                   [(i, stop, offset) for (i, stop), offset in zip(placed, offsets)], 'build')


def routed_locations(bodies):
    """The stops' coordinates as sent to the router, in order: windows overlap by one stop."""
    locations = []
    for w, body in enumerate(bodies):
        found = body['trip']['locations']
        locations += found if w == 0 else found[1:]
    return [(float(loc['lat']), float(loc['lon'])) for loc in locations]


def from_requests(pattern_id, pattern_stops, coords, bodies, offsets):
    """From the build's stored routing requests: walk the pattern's stops in order and take, for each
    routed location, the next stop with those coordinates. A stop the build did not route is skipped,
    whatever today's stop table says, because the requests record what was routed."""
    locations = routed_locations(bodies)
    if len(locations) != len(offsets):
        raise MappingError(f'{len(locations)} routed locations but {len(offsets)} offsets')
    occurrences, j = [], 0
    for k, (lat, lon) in enumerate(locations):
        while j < len(pattern_stops):
            c = coords.get(pattern_stops[j])
            if c and abs(c[0] - lat) <= COORD_TOLERANCE_DEG and abs(c[1] - lon) <= COORD_TOLERANCE_DEG:
                break
            j += 1
        if j == len(pattern_stops):
            raise MappingError(f'routed location {k} ({lat}, {lon}) is no stop of the pattern after the last matched')
        occurrences.append((j, pattern_stops[j], offsets[k]))
        j += 1
    return mapping(pattern_id, len(pattern_stops), occurrences, 'router requests')


def aligned_offsets(stop_mapping, pattern_id, pattern_stops, length=None):
    """The offsets on the pattern's own stop indices, None where the road has no stop, from a mapping
    that agrees with this pattern in every respect; MappingError otherwise."""
    if not isinstance(stop_mapping, dict):
        raise MappingError('the shape carries no stop mapping (published before version 2)')
    if stop_mapping.get('version') != MAPPING_VERSION:
        raise MappingError(f"stop mapping version {stop_mapping.get('version')!r}, not {MAPPING_VERSION}")
    if stop_mapping.get('patternId') != pattern_id:
        raise MappingError(f"the mapping is for {stop_mapping.get('patternId')!r}, not {pattern_id!r}")
    if stop_mapping.get('patternStopCount') != len(pattern_stops):
        raise MappingError(f"the mapping counts {stop_mapping.get('patternStopCount')} stops, the pattern {len(pattern_stops)}")
    aligned, last_index, last_offset = [None] * len(pattern_stops), -1, -math.inf
    for occ in stop_mapping.get('occurrences') or []:
        i, stop, offset = occ.get('index'), occ.get('stop'), occ.get('offset')
        if not isinstance(i, int) or not 0 <= i < len(pattern_stops) or i <= last_index:
            raise MappingError(f'occurrence index {i!r} out of order or out of range')
        if pattern_stops[i] != stop:
            raise MappingError(f'the mapping names {stop!r} at stop {i}, the pattern {pattern_stops[i]!r}')
        if not isinstance(offset, (int, float)) or not math.isfinite(offset) or offset < last_offset:
            raise MappingError(f'offset {offset!r} at stop {i} is not along the road in order')
        if length is not None and offset > length + 1.0:
            raise MappingError(f'offset {offset} at stop {i} is beyond the road ({length:.1f} m)')
        aligned[i], last_index, last_offset = float(offset), i, offset
    if last_index < 0:
        raise MappingError('the mapping places no stop')
    return aligned


# ------------------------------------------------------------------ the independent check

def _metres(a, b):
    """(lat, lon) points, equirectangular at their mean latitude: ample for tens of metres."""
    x = math.radians(b[1] - a[1]) * math.cos(math.radians((a[0] + b[0]) / 2))
    return math.hypot(x, math.radians(b[0] - a[0])) * 6371008.8


def point_at(points, cum, s):
    """The (lat, lon) point `s` metres along a polyline of (lat, lon) points with cumulative metres `cum`."""
    if s <= 0:
        return points[0]
    for i in range(1, len(points)):
        if cum[i] >= s:
            span = cum[i] - cum[i - 1]
            t = 0.0 if span == 0 else (s - cum[i - 1]) / span
            return (points[i - 1][0] + t * (points[i][0] - points[i - 1][0]),
                    points[i - 1][1] + t * (points[i][1] - points[i - 1][1]))
    return points[-1]


def geometry_check(stop_mapping, points, coords):
    """Each mapped stop's distance from the road at the offset the mapping gives it, from geometry the
    mapping did not come from: the stop's own published coordinates and the shape's own polyline, measured
    along the polyline as the offsets are. Returns (worst metres, [(index, stop, metres)]); a stop with no
    published coordinates is left out."""
    cum = [0.0]
    for i in range(1, len(points)):
        cum.append(cum[-1] + _metres(points[i - 1], points[i]))
    found = []
    for occ in stop_mapping['occurrences']:
        c = coords.get(occ['stop'])
        if c is None:
            continue
        found.append((occ['index'], occ['stop'], _metres(point_at(points, cum, occ['offset']), c)))
    return (max((d for _, _, d in found), default=0.0), found)
