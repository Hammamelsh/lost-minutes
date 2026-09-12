"""The stop catalogue: bounded NaPTAN import, stored with lineage and published compactly.

    .venv/bin/python -m pipeline.stops import     # fetch if needed, load, publish
    .venv/bin/python -m pipeline.stops publish    # republish from the warehouse

A stop is a physical boarding point, not a place name. Two stops facing opposite ways share a
name and differ by their indicator and bearing, and that difference is the whole point: it is
what stops a passenger watching a bus that is driving away from them.

Source: Department for Transport NaPTAN, ATCO area 180 (Greater Manchester). Open Government
Licence v3.0. Nothing here is inferred; absent fields stay absent.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from .core import SERVICE_AREA, atomic_json, utc_now
from .warehouse import DEFAULT_DB, connect, finish_run, record_raw_source, start_run

ROOT = Path(__file__).resolve().parents[1]
ATCO_AREA = '180'
NAPTAN_URL = 'https://naptan.api.dft.gov.uk/v1/access-nodes?dataFormat=csv&atcoAreaCodes='
SOURCE_KIND = 'naptan_stops'
STOPS_TARGET = Path('public/data/stops.json')

# On-street bus stops, bus/coach station bays and their entrances. Rail, tram and taxi nodes
# are excluded: this product is about buses.
BUS_STOP_TYPES = {'BCT', 'BCS', 'BCQ', 'BCE', 'BST', 'BCP'}

# NaPTAN bearings are the compass direction a bus travels when it is at the stop.
COMPASS = {'N': 'northbound', 'NE': 'north-eastbound', 'E': 'eastbound', 'SE': 'south-eastbound',
           'S': 'southbound', 'SW': 'south-westbound', 'W': 'westbound', 'NW': 'north-westbound'}

DDL = """
CREATE TABLE IF NOT EXISTS stop (
    atco_code        TEXT PRIMARY KEY,   -- the physical boarding point
    naptan_code      TEXT,               -- the short code printed on the flag
    common_name      TEXT NOT NULL,
    indicator        TEXT,               -- "Stop A", "opp", "adj" - distinguishes the sides
    street           TEXT,
    landmark         TEXT,
    bearing          TEXT,               -- direction of travel at the stop, not of the stop
    locality         TEXT,
    parent_locality  TEXT,
    lat              DOUBLE NOT NULL,
    lon              DOUBLE NOT NULL,
    stop_type        TEXT,
    bus_stop_type    TEXT,
    status           TEXT,
    modified_at      TEXT,
    source_sha256    TEXT,
    first_seen_run_id TEXT,
    first_seen_at    TIMESTAMPTZ
);
"""


def fetch_csv(url, fetch_fn=None):
    from .capture import fetch as default_fetch
    body, _, _ = (fetch_fn or default_fetch)(url)
    return body


def ensure_extract(root=ROOT, atco=ATCO_AREA, fetch_fn=None):
    """Cached locally; the extract is 5 MB and changes slowly. Never enters Git."""
    path = Path(root) / 'data/raw' / f'naptan-{atco}.csv'
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        return path.read_bytes(), path, True
    body = fetch_csv(NAPTAN_URL + atco, fetch_fn)
    temp = path.with_suffix('.part')
    temp.write_bytes(body)
    temp.replace(path)
    return body, path, False


def readable_bearing(bearing):
    return COMPASS.get((bearing or '').strip().upper(), '')


def select_stops(body, bounds=SERVICE_AREA):
    """Active bus stops inside the collected area. Rejections are counted by reason."""
    reader = csv.DictReader(io.StringIO(body.decode('utf-8-sig', 'replace')))
    kept, rejected = [], {}

    def refuse(reason):
        rejected[reason] = rejected.get(reason, 0) + 1

    for row in reader:
        if row.get('StopType') not in BUS_STOP_TYPES:
            refuse('not_a_bus_stop')
            continue
        if (row.get('Status') or '').strip().lower() != 'active':
            refuse('not_active')
            continue
        try:
            lon, lat = float(row['Longitude']), float(row['Latitude'])
        except (TypeError, ValueError):
            refuse('unreadable_coordinate')
            continue
        if not (bounds[0] <= lon <= bounds[2] and bounds[1] <= lat <= bounds[3]):
            refuse('outside_collected_area')
            continue
        name = (row.get('CommonName') or '').strip()
        if not name:
            refuse('missing_name')
            continue
        kept.append({
            'atcoCode': row['ATCOCode'].strip(), 'naptanCode': (row.get('NaptanCode') or '').strip(),
            'commonName': name, 'indicator': (row.get('Indicator') or '').strip(),
            'street': (row.get('Street') or '').strip(), 'landmark': (row.get('Landmark') or '').strip(),
            'bearing': (row.get('Bearing') or '').strip().upper(),
            'locality': (row.get('LocalityName') or '').strip(),
            'parentLocality': (row.get('ParentLocalityName') or '').strip(),
            'lat': lat, 'lon': lon, 'stopType': row.get('StopType', ''),
            'busStopType': (row.get('BusStopType') or '').strip(),
            'status': (row.get('Status') or '').strip(),
            'modifiedAt': (row.get('ModificationDateTime') or '').strip(),
        })
    return kept, rejected


def load(con, run_id, stops, source_sha256):
    con.execute(DDL)
    con.executemany(
        'INSERT INTO stop (atco_code, naptan_code, common_name, indicator, street, landmark,'
        ' bearing, locality, parent_locality, lat, lon, stop_type, bus_stop_type, status,'
        ' modified_at, source_sha256, first_seen_run_id, first_seen_at)'
        ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, now())'
        ' ON CONFLICT (atco_code) DO UPDATE SET common_name = excluded.common_name,'
        ' indicator = excluded.indicator, bearing = excluded.bearing, lat = excluded.lat,'
        ' lon = excluded.lon, status = excluded.status, source_sha256 = excluded.source_sha256',
        [(s['atcoCode'], s['naptanCode'], s['commonName'], s['indicator'], s['street'],
          s['landmark'], s['bearing'], s['locality'], s['parentLocality'], s['lat'], s['lon'],
          s['stopType'], s['busStopType'], s['status'], s['modifiedAt'], source_sha256, run_id)
         for s in stops])
    return len(stops)


def build_catalogue(con):
    """What the interface needs to let someone find a stop, and nothing more."""
    rows = con.execute("""
        SELECT atco_code, common_name, indicator, street, locality, parent_locality,
               bearing, lat, lon
        FROM stop ORDER BY locality, common_name, indicator""").fetchall()
    # Trimmed for a phone: the readable bearing is derived client-side from `bearing`, and a
    # parent locality is only carried when it adds something to the locality already given.
    stops = [{'id': r[0], 'name': r[1], 'indicator': r[2] or None, 'street': r[3] or None,
              'locality': r[4] or None,
              'parentLocality': (r[5] or None) if (r[5] and r[5] != r[4]) else None,
              'bearing': r[6] or None,
              'lat': round(r[7], 5), 'lon': round(r[8], 5)} for r in rows]
    stops = [{k: v for k, v in stop.items() if v is not None} for stop in stops]
    # Route labels we have actually observed, with the destinations they were seen serving.
    routes = [{'operator': r[0], 'route': r[1], 'observations': int(r[2]),
               'destinations': [d for d in (r[3] or []) if d][:4],
               'lastObservedAtMs': int(r[4]) if r[4] is not None else None}
              for r in con.execute("""
        SELECT operator, route, count(*) AS n,
               list(DISTINCT replace(destination, '_', ' ')) AS destinations,
               max(observed_at_ms)
        FROM v_publishable_observation
        WHERE route <> 'Unspecified' GROUP BY 1, 2 ORDER BY n DESC""").fetchall()]
    return {
        'schemaVersion': 1, 'generatedAt': utc_now(),
        'area': {'bbox': list(SERVICE_AREA), 'label': 'Manchester and Trafford',
                 'atcoArea': ATCO_AREA},
        'stops': stops, 'routes': routes,
        'attribution': 'Stop data: Department for Transport NaPTAN, Open Government Licence '
                       'v3.0. Bus location data: DfT / contributing operators via the Bus Open '
                       'Data Service, Open Government Licence v3.0.',
        'notes': [
            'Stops are the physical boarding points inside the collected area only. A stop '
            'missing here is not evidence that no stop exists.',
            'Two stops can share a name and face opposite ways. The indicator and bearing are '
            'what tell them apart.',
            'A route label is what an operator supplied. It is not proof that every variant or '
            'every stop on that route is supported here.',
        ],
    }


def publish(con, root=ROOT, target=STOPS_TARGET):
    catalogue = build_catalogue(con)
    atomic_json(Path(root) / target, catalogue)
    return catalogue


def run_import(root=ROOT, db_path=None, fetch_fn=None, log=print):
    root = Path(root)
    body, path, cached = ensure_extract(root, fetch_fn=fetch_fn)
    digest = hashlib.sha256(body).hexdigest()
    stops, rejected = select_stops(body)
    con = connect(db_path or root / DEFAULT_DB)
    try:
        run_id = start_run(con, 'stop_import', is_historical=False,
                           note=f'NaPTAN ATCO {ATCO_AREA}, bounded to the collected area')
        record_raw_source(con, run_id, sha256=digest, kind=SOURCE_KIND, url=NAPTAN_URL + ATCO_AREA,
                          stored_path=path.relative_to(root), byte_size=len(body),
                          captured_at=datetime.now(timezone.utc),
                          retrieved_at=datetime.fromtimestamp(path.stat().st_mtime, timezone.utc))
        loaded = load(con, run_id, stops, digest)
        finish_run(con, run_id, 'succeeded')
        catalogue = publish(con, root)
        log(json.dumps({'source': str(path.name), 'cacheHit': cached, 'bytes': len(body),
                        'sha256': digest[:12], 'stopsLoaded': loaded,
                        'publishedStops': len(catalogue['stops']),
                        'publishedRoutes': len(catalogue['routes']), 'rejected': rejected}))
        return catalogue
    finally:
        con.close()


def main(argv=None):
    command = (argv or sys.argv[1:] or ['import'])[0]
    if command == 'import':
        run_import()
        return 0
    con = connect(ROOT / DEFAULT_DB)
    try:
        catalogue = publish(con)
        print(json.dumps({'stops': len(catalogue['stops']), 'routes': len(catalogue['routes'])}))
        return 0
    finally:
        con.close()


if __name__ == '__main__':
    sys.exit(main())
