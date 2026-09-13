"""The published live state: one small object every device refreshes.

Three clocks are kept apart and never collapsed into one "last updated":
  observedAt   when the vehicle reported its position (the source's own timestamp)
  retrievedAt  when this collector fetched the response carrying it
  publishedAt  when we wrote this file

The age shown to a passenger is always the age of the *observation*. A successful request,
or the feed republishing bytes we already had, does not make a position newer.

    .venv/bin/python -m pipeline.live init     # write an honest unavailable state
    .venv/bin/python -m pipeline.live publish  # publish from the warehouse
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .core import SERVICE_AREA, atomic_json, utc_now
from .freshness import EXPIRY, label, measure, policy
from .match import match_all
from .warehouse import DEFAULT_DB, connect

LIVE_TARGET = Path('public/data/live.json')
CONFIG_TARGET = Path('public/data/config.json')
LIVE_KIND = 'live_positions'
SCHEMA_VERSION = 1

NOTES = [
    'Positions are reports, not continuous tracking. Every position in this file is an '
    'observed fix kept exactly as received: nothing here is interpolated, smoothed or predicted.',
    'The page may draw a clearly labelled estimate of where a selected bus has got to since its '
    'last report. Estimates are computed on the device, bounded by measured behaviour, and are '
    'never published here, stored, or counted as observations.',
    'A position older than the expiry threshold is withheld and counted, because the feed '
    'demonstrably carries positions that are hours old.',
    'No arrival time is offered. Progress toward a stop is shown only where a timetabled '
    'service pattern is matched, and is counted in stops along that pattern, not minutes.',
    'A reported position shows a direction only where the vehicle reported a bearing; a missing '
    'or unreadable bearing is stated, never estimated from movement.',
    'Each bus carries up to six earlier reports from the last four minutes of the same journey '
    '(its trail), each pointing at the source file it came from.',
]

# The trail: earlier observed reports of the same journey, so a page can show where a bus has
# been and read its recent speed without waiting for further updates.
TRAIL_SECONDS = 240
TRAIL_POINTS = 6

BEARING_STATUSES = ('reported', 'absent', 'invalid', 'not_captured')

# Latest report per vehicle, newest first. Out-of-order arrivals are handled here rather
# than at load time: the row with the greatest observation time wins, whenever it arrived.
LATEST_SQL = """
WITH ranked AS (
    SELECT o.*, row_number() OVER (PARTITION BY o.operator, o.vehicle
                                   ORDER BY o.observed_at_ms DESC) AS rn
    FROM v_publishable_observation o
    WHERE o.source_sha256 IN (SELECT source_sha256 FROM raw_source WHERE source_kind = ?)
)
SELECT operator, vehicle, route, direction, journey_ref, observed_at_ms, recorded_at_text,
       lat, lon, destination, origin, source_sha256, bearing, bearing_status, aimed_departure,
       epoch_ms(retrieved_at) AS retrieved_at_ms
FROM ranked WHERE rn = 1 ORDER BY observed_at_ms DESC
"""

# Earlier reports of the same journey (operator, vehicle, route, direction, journey_ref) as the
# latest one, newest first, within the trail window. Only recent rows are scanned.
TRAIL_SQL = """
WITH recent AS (
    SELECT o.* FROM v_publishable_observation o
    WHERE o.observed_at_ms >= ?
      AND o.source_sha256 IN (SELECT source_sha256 FROM raw_source WHERE source_kind = ?)
), latest AS (
    SELECT operator, vehicle, route, direction, journey_ref, observed_at_ms FROM (
        SELECT r.*, row_number() OVER (PARTITION BY operator, vehicle
                                       ORDER BY observed_at_ms DESC) AS rn FROM recent r)
    WHERE rn = 1
), earlier AS (
    SELECT r.operator, r.vehicle, r.observed_at_ms, r.lat, r.lon, r.bearing, r.bearing_status,
           r.source_sha256, l.observed_at_ms AS latest_ms,
           row_number() OVER (PARTITION BY r.operator, r.vehicle
                              ORDER BY r.observed_at_ms DESC) AS rn
    FROM recent r JOIN latest l
      ON r.operator = l.operator AND r.vehicle = l.vehicle AND r.route = l.route
     AND r.direction = l.direction AND r.journey_ref = l.journey_ref
     AND r.observed_at_ms < l.observed_at_ms
     AND r.observed_at_ms >= l.observed_at_ms - ? * 1000
)
SELECT operator, vehicle, observed_at_ms, lat, lon, bearing, bearing_status, source_sha256,
       latest_ms
FROM earlier WHERE rn <= ? ORDER BY operator, vehicle, observed_at_ms
"""


def _trails(con, now_ms, vehicles):
    """Attach each published bus's trail, compact: [ms before the latest report, lat, lon,
    reported bearing or null, index into trailSources]. Positions are kept as received."""
    published = {(v['operator'], v['vehicle']): v for v in vehicles}
    sources, index = [], {}
    window_start = now_ms - (EXPIRY + TRAIL_SECONDS) * 1000
    for (operator, vehicle, observed_ms, lat, lon, bearing, status, sha,
         latest_ms) in con.execute(TRAIL_SQL, [window_start, LIVE_KIND, TRAIL_SECONDS,
                                               TRAIL_POINTS]).fetchall():
        item = published.get((operator, vehicle))
        if item is None or int(latest_ms) != item['observedAtMs']:
            continue
        if sha not in index:
            index[sha] = len(sources)
            sources.append(sha)
        item.setdefault('trail', []).append(
            [int(latest_ms) - int(observed_ms), lat, lon,
             bearing if status == 'reported' else None, index[sha]])
    return sources


# Walking directions come from a pedestrian router the page calls directly. The default is the
# FOSSGIS OSRM foot service (fair use: attribution, a "fix the map" link, at most one request a
# second, no heavy use; it logs requests). LM_WALKING_ROUTER in .env points at another OSRM
# foot server, for example a self-hosted one, or switches directions off with "none".
WALKING = {
    'provider': 'osrm',
    'baseUrl': 'https://routing.openstreetmap.de/routed-foot',
    'profile': 'foot',
    'name': 'routing.openstreetmap.de',
    'operator': 'FOSSGIS e.V.',
    'policyUrl': 'https://www.fossgis.de/arbeitsgruppen/osm-server/nutzungsbedingungen/',
    'privacyUrl': 'https://www.fossgis.de/datenschutzerklärung',
    'fixTheMapUrl': 'https://www.openstreetmap.org/fixthemap',
    'attribution': 'Walking route: OSRM foot profile on routing.openstreetmap.de (FOSSGIS e.V.), '
                   'OpenStreetMap data',
    'maxStraightLineMetres': 3000,
    'minSecondsBetweenRequests': 10,
    'timeoutSeconds': 8,
    'inaccurateMetres': 200,
}


def walking_config(environ=None):
    """The walking router the page will call, with any local override applied."""
    override = (environ if environ is not None else os.environ).get('LM_WALKING_ROUTER', '').strip()
    if not override:
        return dict(WALKING)
    if override.lower() == 'none':
        return {**WALKING, 'provider': 'none', 'baseUrl': None}
    if not override.startswith(('https://', 'http://localhost', 'http://127.0.0.1')):
        raise ValueError('LM_WALKING_ROUTER must be an https URL, a localhost URL, or "none"')
    host = override.split('/')[2]
    return {**WALKING, 'baseUrl': override.rstrip('/'), 'name': host, 'operator': '',
            'policyUrl': None, 'privacyUrl': None,
            'attribution': f'Walking route: OSRM foot profile on {host}, OpenStreetMap data'}


def _config(poll_seconds):
    """Runtime pointers, so the served data object can move host without a rebuild."""
    return {'schemaVersion': SCHEMA_VERSION,
            'liveUrl': '/data/live.json',
            'replayUrl': '/data/replay.json',
            'operationsUrl': '/data/operations.json',
            'pollSeconds': poll_seconds,
            'walking': walking_config(),
            'note': 'Written by the collector at each publication. Set LM_WALKING_ROUTER in .env '
                    'to use another OSRM foot server, or "none" to switch walking directions '
                    'off. The frontend reads this at runtime; changing it needs no rebuild.'}


def build_live(con, published_at=None):
    """Assemble the live state. Expired positions are excluded, counted and explained."""
    now = published_at or datetime.now(timezone.utc)
    now_ms = int(now.timestamp() * 1000)
    rows = con.execute(LATEST_SQL, [LIVE_KIND]).fetchall()
    columns = ['operator', 'vehicle', 'route', 'direction', 'journeyRef', 'observedAtMs',
               'recordedAt', 'lat', 'lon', 'destination', 'origin', 'sourceHash', 'bearing',
               'bearingStatus', 'aimedDeparture', 'retrievedAtMs']

    vehicles, expired, ahead_of_clock = [], 0, 0
    for row in rows:
        item = dict(zip(columns, row))
        item['observedAtMs'] = int(item['observedAtMs'])
        age = (now_ms - item['observedAtMs']) / 1000.0
        state = label(age)
        if state == 'expired':
            expired += 1
            continue
        if state == 'ahead_of_clock':
            ahead_of_clock += 1
            continue
        item['ageSeconds'] = round(age, 1)
        item['freshness'] = state
        # NULL status means the row was stored before bearings were captured: unknown, which
        # is a different statement from "the vehicle did not report one".
        item['bearingStatus'] = item['bearingStatus'] or 'not_captured'
        if item['bearingStatus'] != 'reported':
            item['bearing'] = None
        # The operator's scheduled departure from the origin: a timetable claim, not a fix.
        item['aimedDeparture'] = item['aimedDeparture'] or None
        # When we fetched it: the earliest moment anything downstream could have known it.
        item['retrievedAtMs'] = int(item['retrievedAtMs']) if item['retrievedAtMs'] is not None else None
        # Stated on every position so no consumer has to infer it.
        item['positionKind'] = 'observed'
        vehicles.append(item)

    # Place each published bus on a service pattern where the timetable supports it. A bus
    # that cannot be placed carries the reason instead, and is still shown as a position.
    try:
        matching = match_all(con, vehicles)
    except Exception as error:                      # patterns not built yet
        matching = {'matched': 0, 'unmatched': len(vehicles),
                    'reasons': {'patterns_unavailable': type(error).__name__}}
    trail_sources = _trails(con, now_ms, vehicles) if vehicles else []

    cycles = con.execute("""
        SELECT count(*), count(*) FILTER (WHERE outcome = 'succeeded'),
               count(*) FILTER (WHERE outcome = 'repeat_payload'),
               count(*) FILTER (WHERE outcome NOT IN ('succeeded', 'repeat_payload')),
               max(requested_at),
               max(completed_at) FILTER (WHERE outcome IN ('succeeded', 'repeat_payload')),
               max(completed_at) FILTER (WHERE payload_changed)
        FROM collection_cycle""").fetchone()
    total, succeeded, repeats, failed, last_request, last_success, last_change = cycles

    streak = con.execute("""
        SELECT count(*) FROM collection_cycle
        WHERE completed_at > COALESCE(
            (SELECT max(completed_at) FROM collection_cycle
             WHERE outcome IN ('succeeded', 'repeat_payload')), '-infinity'::TIMESTAMPTZ)
    """).fetchone()[0]

    quality = con.execute(f"""
        SELECT count(*), (SELECT count(*) FROM quarantined_record q
                          WHERE q.source_sha256 IN (SELECT source_sha256 FROM raw_source
                                                    WHERE source_kind = '{LIVE_KIND}')),
               (SELECT count(*) FROM observation_conflict c WHERE c.incoming_source IN
                          (SELECT source_sha256 FROM raw_source WHERE source_kind = '{LIVE_KIND}'))
        FROM raw_source WHERE source_kind = '{LIVE_KIND}'""").fetchone()

    reasons = [{'reason': r, 'count': int(c)} for r, c in con.execute(f"""
        SELECT reason, count(*) FROM quarantined_record
        WHERE source_sha256 IN (SELECT source_sha256 FROM raw_source WHERE source_kind = '{LIVE_KIND}')
        GROUP BY 1 ORDER BY 2 DESC""").fetchall()]

    pipeline_failures = [{'outcome': o, 'count': int(c)} for o, c in con.execute("""
        SELECT outcome, count(*) FROM collection_cycle
        WHERE outcome NOT IN ('succeeded', 'repeat_payload') GROUP BY 1 ORDER BY 2 DESC""").fetchall()]

    iso = lambda v: None if v is None else v.astimezone(timezone.utc).isoformat()
    has_positions = bool(vehicles) or quality[0]

    # Which run is collecting, and what kind: a bounded development run on one machine is
    # not an always-on service, and the page must be able to say which it is showing.
    run = con.execute("""
        SELECT run_id, status, started_at, finished_at, planned_minutes, collector_kind,
               exit_reason
        FROM pipeline_run WHERE mode = 'live_capture' ORDER BY started_at DESC LIMIT 1""").fetchone()
    collector = None
    if run:
        collector = {'runId': run[0], 'status': run[1], 'kind': run[5] or 'bounded_development',
                     'startedAt': iso(run[2]), 'finishedAt': iso(run[3]),
                     'plannedMinutes': run[4],
                     'endsBy': iso(run[2] + timedelta(minutes=run[4])) if run[2] and run[4] else None,
                     'exitReason': run[6]}
    state = 'live' if vehicles else ('stale' if has_positions else 'unavailable')

    payload = {
        'schemaVersion': SCHEMA_VERSION,
        'state': state,
        'mode': 'live_bods',
        'area': {'bbox': list(SERVICE_AREA), 'label': 'Manchester and Trafford'},
        'publishedAt': now.astimezone(timezone.utc).isoformat(),
        'publishedAtMs': now_ms,
        'collection': {
            'lastRequestAt': iso(last_request),
            'lastSuccessAt': iso(last_success),
            'lastPayloadChangeAt': iso(last_change),
            'cycles': int(total or 0), 'succeeded': int(succeeded or 0),
            'repeatPayloads': int(repeats or 0), 'failed': int(failed or 0),
            'consecutiveFailures': int(streak or 0),
            'sharedCollector': True,
            'collector': collector,
        },
        'freshness': {'policy': policy(), 'measured': measure(con, LIVE_KIND)},
        'matching': matching,
        'vehicles': vehicles,
        'trailSources': trail_sources,
        'withheld': {
            'expiredPositions': expired,
            'positionsAheadOfClock': ahead_of_clock,
            'conflictingIdentities': int(quality[2] or 0),
            'quarantinedRecords': int(quality[1] or 0),
            'quarantineReasons': reasons,
        },
        'sourceQuality': {'quarantineReasons': reasons,
                          'bearings': {status: sum(1 for v in vehicles if v['bearingStatus'] == status)
                                       for status in BEARING_STATUSES},
                          'note': 'Problems in the data we were given.'},
        'pipelineFailures': {'cycles': pipeline_failures,
                             'note': 'Problems in our own collection, kept separate from '
                                     'source quality.'},
        'attribution': 'Bus location data: Department for Transport / contributing operators, '
                       'via the Bus Open Data Service. Open Government Licence v3.0.',
        'notes': NOTES,
    }
    if state == 'unavailable':
        diagnosis = diagnose_unavailable(con)
        payload['unavailableReason'] = diagnosis['reason']
        payload['unavailableDetail'] = diagnosis['passenger']
        payload['unavailableTechnical'] = diagnosis['technical']
    return payload


def validate_live(payload, previous=None):
    """Refuse to publish a state that would mislead. Named checks, recorded."""
    checks = []
    add = lambda name, ok, detail: checks.append(
        {'name': name, 'passed': bool(ok), 'detail': detail})
    vehicles = payload.get('vehicles') or []
    west, south, east, north = payload.get('area', {}).get('bbox') or SERVICE_AREA

    add('state_is_known', payload.get('state') in ('live', 'stale', 'unavailable'),
        str(payload.get('state')))
    add('positions_have_observation_times',
        all(isinstance(v.get('observedAtMs'), int) for v in vehicles),
        f'{len(vehicles)} vehicles')
    add('positions_inside_declared_area',
        all(west <= v['lon'] <= east and south <= v['lat'] <= north for v in vehicles),
        f'bbox {west},{south},{east},{north}')
    add('no_expired_position_published',
        all(v.get('ageSeconds', 0) <= EXPIRY for v in vehicles),
        f'expiry {EXPIRY}s, withheld {payload.get("withheld", {}).get("expiredPositions")}')
    add('every_position_is_an_observed_fix',
        all(v.get('positionKind') == 'observed' for v in vehicles), 'no estimated positions')
    sources = payload.get('trailSources') or []
    add('trail_is_earlier_observed_history',
        all(0 < point[0] <= TRAIL_SECONDS * 1000 and 0 <= point[4] < len(sources)
            for v in vehicles for point in v.get('trail') or [])
        and all(len(v.get('trail') or []) <= TRAIL_POINTS for v in vehicles),
        f'up to {TRAIL_POINTS} earlier reports of the same journey within {TRAIL_SECONDS}s')
    add('bearings_reported_or_explicitly_absent',
        all(v.get('bearingStatus', 'not_captured') in BEARING_STATUSES
            and ((v.get('bearing') is not None) == (v.get('bearingStatus') == 'reported'))
            and (v.get('bearing') is None or 0 <= v['bearing'] <= 360) for v in vehicles),
        'a bearing is published only when reported and within 0-360'),
    add('live_state_requires_positions',
        payload.get('state') != 'live' or bool(vehicles), f'{len(vehicles)} vehicles')
    add('publication_time_not_before_newest_observation',
        all(v['observedAtMs'] <= payload['publishedAtMs'] for v in vehicles),
        'no position from the future')
    if previous:
        add('publication_time_not_going_backwards',
            payload['publishedAtMs'] >= (previous.get('publishedAtMs') or 0),
            f'previous {previous.get("publishedAtMs")}')
    else:
        add('publication_time_not_going_backwards', True, 'no previous state')
    return checks


def publish_live(con, run_id=None, root=Path('.'), target=LIVE_TARGET, published_at=None,
                 poll_seconds=None):
    """Build, validate, then replace. A failure leaves the last good state in place."""
    from .freshness import POLL_DEFAULT
    target = Path(root) / target
    previous = None
    if target.exists():
        try:
            previous = json.loads(target.read_text())
        except ValueError:
            previous = None

    payload = build_live(con, published_at)
    checks = validate_live(payload, previous)
    failed = [c['name'] for c in checks if not c['passed']]
    body = json.dumps(payload, ensure_ascii=False, separators=(',', ':')) + '\n'
    digest = hashlib.sha256(body.encode()).hexdigest()

    if not failed:
        atomic_json(target, payload)
        atomic_json(Path(root) / CONFIG_TARGET, _config(poll_seconds or POLL_DEFAULT))

    _record(con, run_id, payload, digest, len(body), target, failed, checks, root)
    return {'state': payload['state'], 'vehicles': len(payload['vehicles']),
            'published': not failed, 'failedChecks': failed, 'sha256': digest}


def _record(con, run_id, payload, digest, size, target, failed, checks, root):
    publication_id = 'live-' + digest[:16] + '-' + utc_now()[11:19].replace(':', '')
    con.execute(
        'INSERT INTO publication (publication_id, run_id, snapshot_id, kind, status, built_at,'
        ' published_at, observation_count, journey_count, source_count, window_start_ms,'
        ' window_end_ms, snapshot_sha256, snapshot_bytes, target_path, failure_reason)'
        " VALUES (?, ?, ?, 'live', ?, now(), ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)"
        ' ON CONFLICT (publication_id) DO NOTHING',
        [publication_id, run_id, 'live-' + digest[:16],
         'failed_validation' if failed else 'published',
         None if failed else datetime.now(timezone.utc),
         len(payload['vehicles']), payload['collection']['cycles'],
         min((v['observedAtMs'] for v in payload['vehicles']), default=None),
         payload['publishedAtMs'], digest, size,
         '/'.join(Path(target).parts[-3:]), ', '.join(failed) or None])
    con.executemany(
        'INSERT INTO validation_check VALUES (?, ?, ?, ?)'
        ' ON CONFLICT (publication_id, check_name) DO UPDATE SET passed = excluded.passed,'
        ' detail = excluded.detail',
        [(publication_id, c['name'], c['passed'], c['detail']) for c in checks])


def diagnose_unavailable(con=None, environ=None):
    """Why there is no live data *now*, from actual state rather than an assumption.

    Blaming a missing credential when one is configured sends someone to fix the wrong
    thing. The collector having run before and not running now are different situations and
    are named differently.
    """
    import os
    environ = os.environ if environ is None else environ
    has_key = bool(environ.get('BODS_API_KEY'))
    ran_before = False
    last_published = None
    if con is not None:
        try:
            ran_before = con.execute(
                "SELECT count(*) FROM raw_source WHERE source_kind = ?", [LIVE_KIND]).fetchone()[0] > 0
            last_published = con.execute(
                "SELECT max(published_at) FROM publication WHERE kind = 'live'"
                " AND status = 'published'").fetchone()[0]
        except Exception:                                   # schema not built yet
            pass
    if not has_key:
        return {'reason': 'no_credentials_configured',
                'technical': 'BODS_API_KEY is not set in the environment or in a local .env, '
                             'so the collector cannot authenticate.',
                'passenger': 'Live updates are not set up on this copy yet.'}
    if not ran_before:
        return {'reason': 'collector_never_run',
                'technical': 'Credentials are configured but no live response has ever been '
                             'stored. Start the collector with: pnpm dev:live',
                'passenger': 'Live updates have not been switched on yet.'}
    return {'reason': 'collector_not_running',
            'technical': 'Credentials are configured and the collector has run before, but it '
                         'is not running now, so no fresh state is being published'
                         + (f' (last published {last_published:%Y-%m-%d %H:%M} UTC)'
                            if last_published else '')
                         + '. Start it with: pnpm dev:live',
            'passenger': 'Live updates are not running at the moment.'}


def write_unavailable(root=Path('.'), reason=None, poll_seconds=None, con=None):
    """An honest placeholder that says which of several different things is actually wrong."""
    diagnosis = diagnose_unavailable(con)
    reason = reason or diagnosis['reason']
    from .freshness import POLL_DEFAULT
    payload = {
        'schemaVersion': SCHEMA_VERSION, 'state': 'unavailable', 'mode': 'live_bods',
        'unavailableReason': reason,
        'unavailableDetail': diagnosis['passenger'],
        'unavailableTechnical': diagnosis['technical'],
        'area': {'bbox': list(SERVICE_AREA), 'label': 'Manchester and Trafford'},
        'publishedAt': utc_now(), 'publishedAtMs': int(datetime.now(timezone.utc).timestamp() * 1000),
        'collection': {'lastRequestAt': None, 'lastSuccessAt': None, 'lastPayloadChangeAt': None,
                       'cycles': 0, 'succeeded': 0, 'repeatPayloads': 0, 'failed': 0,
                       'consecutiveFailures': 0, 'sharedCollector': True},
        'freshness': {'policy': policy(), 'measured': None},
        'vehicles': [],
        'withheld': {'expiredPositions': 0, 'positionsAheadOfClock': 0,
                     'conflictingIdentities': 0, 'quarantinedRecords': 0,
                     'quarantineReasons': []},
        'sourceQuality': {'quarantineReasons': [], 'note': 'No live response has been read.'},
        'pipelineFailures': {'cycles': [], 'note': 'No live collection has been attempted.'},
        'attribution': 'Bus location data: Department for Transport / contributing operators, '
                       'via the Bus Open Data Service. Open Government Licence v3.0.',
        'notes': NOTES,
    }
    atomic_json(Path(root) / LIVE_TARGET, payload)
    atomic_json(Path(root) / CONFIG_TARGET, _config(poll_seconds or POLL_DEFAULT))
    return payload


def main(argv=None):
    command = (argv or sys.argv[1:] or ['publish'])[0]
    root = Path(__file__).resolve().parents[1]
    if command == 'init':
        con = connect(root / DEFAULT_DB)
        try:
            payload = write_unavailable(root, con=con)
        finally:
            con.close()
        print(json.dumps({'state': payload['state'], 'reason': payload['unavailableReason']}))
        return 0
    con = connect(root / DEFAULT_DB)
    try:
        print(json.dumps(publish_live(con, None, root=root), indent=2))
        return 0
    finally:
        con.close()


if __name__ == '__main__':
    sys.exit(main())
