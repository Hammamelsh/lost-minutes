"""Road-following geometry for a service pattern, checked against where its buses reported.

    .venv/bin/python -m pipeline.shapes build --lines 15,250,256
    .venv/bin/python -m pipeline.shapes build --lines 15 --router https://valhalla1.openstreetmap.de

A timetable pattern is an ordered list of stops. Joining their coordinates with straight lines
does not say which roads a bus takes, and TfGM's TransXChange files carry no route geometry
(no <Track> in any file checked). A bus-costing router therefore finds a road path through the
stops in order, arriving at each in the direction NaPTAN says buses travel there. Each shape is
then tested against real reports of buses matched to that pattern: it is accepted for estimated
movement only when those reports lie close to it. Anything else stays in observed mode.

Requests go to the FOSSGIS Valhalla service at most about once a second, with a client id, and
every response is stored gzipped under data/raw/shapes, named by its SHA-256.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from .core import atomic_json, utc_now

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = Path('data/warehouse/lost-minutes.duckdb')
ROUTER = 'https://valhalla1.openstreetmap.de'
CLIENT_ID = 'lost-minutes'
USER_AGENT = 'LostMinutes/0.3 (portfolio research; https://github.com/Hammamelsh/lost-minutes)'
MAX_LOCATIONS = 10            # the FOSSGIS service's limit per request; windows share one stop
REQUEST_GAP = 1.2             # seconds between requests: the service allows one a second
ACCEPT_P95_METRES = 35.0      # 95% of a pattern's reports must lie this close to its shape
ACCEPT_MIN_REPORTS = 30       # fewer reports than this cannot vouch for a shape
SHAPES_DIR = Path('public/data/shapes')
RAW_DIR = Path('data/raw/shapes')
COMPASS = {'N': 0, 'NE': 45, 'E': 90, 'SE': 135, 'S': 180, 'SW': 225, 'W': 270, 'NW': 315}

DDL = """
CREATE TABLE IF NOT EXISTS pattern_shape (
    pattern_id       TEXT PRIMARY KEY,
    router           TEXT NOT NULL,
    costing          TEXT NOT NULL,
    built_at         TIMESTAMPTZ NOT NULL,
    run_id           TEXT,
    response_sha256  TEXT NOT NULL,     -- the stored router responses, comma-separated
    polyline6        TEXT,              -- the shape, Google polyline at precision 6 (lon/lat)
    stop_offsets     TEXT,              -- JSON: metres along the shape of each placed stop
    points           INTEGER NOT NULL,
    length_m         DOUBLE NOT NULL,
    stops_placed     INTEGER NOT NULL,
    stop_count       INTEGER NOT NULL,
    reports          INTEGER,
    offset_p50_m     DOUBLE,
    offset_p95_m     DOUBLE,
    within_30m       DOUBLE,
    status           TEXT NOT NULL,     -- accepted | rejected
    reason           TEXT
);
"""

# ------------------------------------------------------------------ polyline


def decode_polyline(text, precision=6):
    """Google's encoded polyline, as Valhalla returns it (precision 6), as (lon, lat) pairs."""
    points, index, lat, lon, factor = [], 0, 0, 0, 10 ** precision
    while index < len(text):
        values = []
        for _ in range(2):
            result = shift = 0
            while True:
                byte = ord(text[index]) - 63
                index += 1
                result |= (byte & 0x1f) << shift
                shift += 5
                if byte < 0x20:
                    break
            values.append(~(result >> 1) if result & 1 else result >> 1)
        lat += values[0]
        lon += values[1]
        points.append((lon / factor, lat / factor))
    return points


def encode_polyline(points, precision=6):
    factor, out, last_lat, last_lon = 10 ** precision, [], 0, 0
    for lon, lat in points:
        ilat, ilon = round(lat * factor), round(lon * factor)
        for delta in (ilat - last_lat, ilon - last_lon):
            value = ~(delta << 1) if delta < 0 else delta << 1
            while value >= 0x20:
                out.append(chr((0x20 | (value & 0x1f)) + 63))
                value >>= 5
            out.append(chr(value + 63))
        last_lat, last_lon = ilat, ilon
    return ''.join(out)


# ------------------------------------------------------------------ geometry

def metres(a, b):
    """Metres between two (lon, lat) points; equirectangular, exact enough over a few km."""
    x = math.radians(b[0] - a[0]) * math.cos(math.radians((a[1] + b[1]) / 2))
    return math.hypot(x, math.radians(b[1] - a[1])) * 6371008.8


def offset_from(points, p):
    """Shortest distance in metres from a (lon, lat) point to the polyline."""
    kx = math.cos(math.radians(p[1])) * 111195.0
    ky = 111195.0
    best = math.inf
    for (ax, ay), (bx, by) in zip(points, points[1:]):
        dx, dy = (bx - ax) * kx, (by - ay) * ky
        px, py = (p[0] - ax) * kx, (p[1] - ay) * ky
        length = dx * dx + dy * dy
        t = 0.0 if length == 0 else max(0.0, min(1.0, (px * dx + py * dy) / length))
        best = min(best, math.hypot(px - t * dx, py - t * dy))
    return best


def percentile(values, q):
    if not values:
        return None
    ordered = sorted(values)
    k = (len(ordered) - 1) * q
    lo, hi = math.floor(k), math.ceil(k)
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (k - lo)


# ------------------------------------------------------------------ requests

def windows(stops, size=MAX_LOCATIONS):
    """Consecutive windows of at most `size` stops, each starting where the last ended."""
    out, start = [], 0
    while start < len(stops) - 1:
        end = min(start + size, len(stops))
        out.append(stops[start:end])
        start = end - 1
    return out


def request_body(window):
    """Each stop is a break in the route, approached in the direction buses travel there."""
    locations = []
    for stop in window:
        location = {'lat': stop['lat'], 'lon': stop['lon'], 'type': 'break'}
        if stop.get('bearing') in COMPASS:
            location.update({'heading': COMPASS[stop['bearing']], 'heading_tolerance': 60})
        locations.append(location)
    return {'locations': locations, 'costing': 'bus', 'shape_format': 'polyline6',
            'directions_options': {'units': 'kilometers', 'directions_type': 'none'}}


def post(router, body, fetch=None):
    request = urllib.request.Request(
        f'{router.rstrip("/")}/route', data=json.dumps(body).encode(), method='POST',
        headers={'Content-Type': 'application/json', 'User-Agent': USER_AGENT,
                 'X-Client-Id': CLIENT_ID})
    with (fetch or urllib.request.urlopen)(request, timeout=40) as response:
        return response.read()


def store_raw(body, root):
    digest = hashlib.sha256(body).hexdigest()
    target = Path(root) / RAW_DIR / f'{digest}.json.gz'
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        target.write_bytes(gzip.compress(body, mtime=0))
    return digest


def assemble(responses):
    """Join the legs of consecutive windows into one shape, with each stop's distance along it.

    Distances are measured along the joined geometry itself, so a stop's offset and the drawn
    shape always agree. Leg i of a window runs from its stop i to stop i + 1."""
    points, offsets, total = [], [0.0], 0.0
    for body in responses:
        for leg in body['trip']['legs']:
            leg_points = decode_polyline(leg['shape'])
            if points and leg_points and leg_points[0] == points[-1]:
                leg_points = leg_points[1:]
            for point in leg_points:
                if points:
                    total += metres(points[-1], point)
                points.append(point)
            offsets.append(round(total, 1))
    return points, offsets


# ------------------------------------------------------------------ validation

def validate(points, reports):
    """How close the reports of buses on this pattern lie to its shape."""
    distances = [offset_from(points, (lon, lat)) for lat, lon in reports]
    return {'reports': len(distances),
            'p50': percentile(distances, 0.5), 'p95': percentile(distances, 0.95),
            'within30': (sum(d <= 30 for d in distances) / len(distances)) if distances else None}


def decide(stats):
    if stats['reports'] < ACCEPT_MIN_REPORTS:
        return 'rejected', f"only {stats['reports']} reports on this pattern to check the shape against"
    if stats['p95'] > ACCEPT_P95_METRES:
        return 'rejected', (f"95% of its reports lie within {stats['p95']:.0f} m of the shape, "
                            f'more than the {ACCEPT_P95_METRES:.0f} m allowed')
    return 'accepted', None


def reports_for(con, pattern, patterns, since_ms=None):
    """Positions of live reports that the matcher places on this very pattern."""
    from .match import match_vehicle
    from .service_days import service_day
    rows = con.execute(
        "SELECT o.operator, o.route, o.direction, o.destination, o.lat, o.lon, o.observed_at_ms"
        " FROM v_publishable_observation o JOIN raw_source r USING (source_sha256)"
        " WHERE r.source_kind = 'live_positions' AND o.route = ? AND o.operator = ?"
        + (' AND o.observed_at_ms >= ?' if since_ms else ''),
        [pattern['line'], pattern['operator']] + ([since_ms] if since_ms else [])).fetchall()
    placed = []
    for operator, route, direction, destination, lat, lon, observed in rows:
        vehicle = {'operator': operator, 'route': route, 'direction': direction,
                   'destination': destination, 'lat': lat, 'lon': lon}
        result = match_vehicle(vehicle, patterns, service_day(observed))
        if result.get('matched') and result['patternId'] == pattern['id']:
            placed.append((lat, lon))
    return placed


# ------------------------------------------------------------------ build and publish

def corridor_patterns(con, lines, stop_bearings):
    """Published patterns of the named lines, with their placed stops in order."""
    from .patterns import MIN_STOPS_IN_AREA
    marks = ','.join('?' for _ in lines)
    patterns = []
    for pattern_id, line, operator, stop_count in con.execute(
            f'SELECT pattern_id, line_name, operator_code, stop_count FROM service_pattern'
            f' WHERE line_name IN ({marks}) AND stops_in_area >= {MIN_STOPS_IN_AREA}'
            ' ORDER BY operator_code, line_name, pattern_id', list(lines)).fetchall():
        stops = [{'atco': atco, 'lat': lat, 'lon': lon, 'bearing': stop_bearings.get(atco)}
                 for atco, lat, lon in con.execute(
                     'SELECT ps.atco_code, s.lat, s.lon FROM service_pattern_stop ps'
                     ' JOIN stop s ON s.atco_code = ps.atco_code WHERE ps.pattern_id = ?'
                     ' ORDER BY ps.sequence', [pattern_id]).fetchall()]
        patterns.append({'id': pattern_id, 'line': line, 'operator': operator,
                         'stopCount': int(stop_count), 'stops': stops})
    return patterns


def build(root=ROOT, db_path=None, lines=('15',), router=ROUTER, fetch=None, sleep=time.sleep,
          log=print, since_ms=None):
    from .warehouse import connect, finish_run, start_run   # DuckDB only where it is needed
    root = Path(root)
    bearings = {}
    stops_file = root / 'public/data/stops.json'
    if stops_file.exists():
        bearings = {s['id']: s.get('bearing') for s in json.loads(stops_file.read_text())['stops']}
    con = connect(db_path or root / DEFAULT_DB)
    con.execute(DDL)
    run_id = start_run(con, 'shape_build', is_historical=False,
                       note=f'bus road geometry for lines {",".join(lines)} from {router}')
    from .match import load_patterns
    matchable = load_patterns(con)
    built = []
    try:
        for pattern in corridor_patterns(con, lines, bearings):
            stops = pattern['stops']
            if len(stops) < 2:
                continue
            responses, hashes, problem = [], [], None
            for window in windows(stops):
                try:
                    body = post(router, request_body(window), fetch)
                except urllib.error.HTTPError as error:
                    detail = error.read()[:300].decode('utf-8', 'replace')
                    problem = f'the router found no bus path: HTTP {error.code} {detail}'
                    break
                hashes.append(store_raw(body, root))
                responses.append(json.loads(body))
                sleep(REQUEST_GAP)
            if problem:
                points, offsets, stats = [], [], {'reports': 0, 'p50': None, 'p95': None, 'within30': None}
                status, reason = 'rejected', problem
            else:
                points, offsets = assemble(responses)
                stats = validate(points, reports_for(con, pattern, matchable, since_ms))
                status, reason = decide(stats)
            length = 0.0 if not offsets else offsets[-1]
            con.execute('DELETE FROM pattern_shape WHERE pattern_id = ?', [pattern['id']])
            con.execute(
                'INSERT INTO pattern_shape VALUES (?, ?, ?, now(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [pattern['id'], router, 'bus', run_id, ','.join(hashes),
                 encode_polyline(points) if points else None, json.dumps(offsets),
                 len(points), length, len(stops), pattern['stopCount'], stats['reports'],
                 stats['p50'], stats['p95'], stats['within30'], status, reason])
            built.append({'pattern': pattern['id'], 'status': status, 'reason': reason,
                          'reports': stats['reports'],
                          'p95': None if stats['p95'] is None else round(stats['p95'], 1)})
            log(json.dumps(built[-1]))
        finish_run(con, run_id, 'succeeded', exit_reason='completed')
        publish(con, root)
        return built
    except BaseException as error:
        finish_run(con, run_id, 'failed', type(error).__name__, str(error),
                   exit_reason=f'exception:{type(error).__name__}')
        raise
    finally:
        con.close()


def safe_name(pattern_id):
    return pattern_id.replace(':', '_').replace('/', '_') + '.json'


def publish(con, root=ROOT):
    """One small file per shape, loaded only for a selected bus, and an index of what exists."""
    con.execute(DDL)
    target = Path(root) / SHAPES_DIR
    index = {'schemaVersion': 1, 'generatedAt': utc_now(),
             'rule': {'acceptP95Metres': ACCEPT_P95_METRES, 'minimumReports': ACCEPT_MIN_REPORTS},
             'notes': ['A shape is a road path a bus-costing router found through a pattern’s stops in '
                       'order. It is not the operator’s own route geometry, which TfGM does not publish.',
                       'A shape is accepted for estimated movement only when reports of buses matched to '
                       'that pattern lie close to it; otherwise buses on it are shown where they reported.'],
             'attribution': 'Road geometry: Valhalla bus routing on valhalla1.openstreetmap.de (FOSSGIS e.V.), '
                            '© OpenStreetMap contributors, ODbL.',
             'patterns': {}}
    for (pattern_id, router, costing, built_at, hashes, polyline, offsets, points, length,
         placed, total, reports, p50, p95, within, status, reason) in con.execute(
            'SELECT pattern_id, router, costing, built_at, response_sha256, polyline6, stop_offsets,'
            ' points, length_m, stops_placed, stop_count, reports, offset_p50_m, offset_p95_m,'
            ' within_30m, status, reason FROM pattern_shape ORDER BY pattern_id').fetchall():
        entry = {'status': status, 'reason': reason, 'lengthMetres': round(length, 1),
                 'stopsPlaced': placed, 'stopCount': total,
                 'validation': {'reports': reports, 'offsetP50Metres': None if p50 is None else round(p50, 1),
                                'offsetP95Metres': None if p95 is None else round(p95, 1),
                                'within30Share': None if within is None else round(within, 3)},
                 'provenance': {'router': router, 'costing': costing,
                                'builtAt': built_at.astimezone(timezone.utc).isoformat(),
                                'responseSha256': hashes.split(',') if hashes else []}}
        if polyline:
            entry['file'] = safe_name(pattern_id)
            atomic_json(target / entry['file'], {'id': pattern_id, 'polyline6': polyline,
                                                 'stopOffsets': json.loads(offsets or '[]'), **entry})
        index['patterns'][pattern_id] = entry
    atomic_json(target / 'index.json', index)
    return index


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='command', required=True)
    make = sub.add_parser('build', help='route, validate and publish shapes for named lines')
    make.add_argument('--lines', required=True, help='comma-separated line names, e.g. 15,250,256')
    make.add_argument('--router', default=ROUTER)
    sub.add_parser('publish', help='republish shapes already in the warehouse')
    args = parser.parse_args(argv)
    if args.command == 'publish':
        from .warehouse import connect
        con = connect(ROOT / DEFAULT_DB)
        publish(con, ROOT)
        con.close()
        return 0
    built = build(lines=[line.strip() for line in args.lines.split(',') if line.strip()], router=args.router)
    print(json.dumps({'shapes': len(built), 'accepted': sum(b['status'] == 'accepted' for b in built)}))
    return 0


if __name__ == '__main__':
    sys.exit(main())
