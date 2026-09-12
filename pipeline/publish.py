"""Build a candidate snapshot from the warehouse, validate it, then swap it in atomically.

The order matters and is the whole point: a run that fails validation must leave the
snapshot that is already being served exactly where it is. Processing success and
publication success are recorded separately, because they are different things.
"""
from __future__ import annotations

import hashlib
import json
import os
from collections import defaultdict
from datetime import timezone
from pathlib import Path

from .core import BBOX, atomic_json, utc_now
from .warehouse import IDENTITY_SQL, active_publication, capture_window, warehouse_totals

REPLAY_TARGET = Path('public/data/replay.json')
OPERATIONS_TARGET = Path('public/data/operations.json')
SNAPSHOT_ARCHIVE = Path('data/published')

# Kept identical to the published contract the frontend already validates.
ATTRIBUTION = ('Bus location data: Department for Transport / contributing operators, via '
               'Open Innovations / National Data Library. Open Government Licence v3.0.')
SOURCE_URL = 'https://data.datalibrary.uk/transport/BODS-ARCHIVE/'
LIMITATIONS = [
    'This is a sampled historical replay, not a live feed.',
    'Routes are operator-supplied labels. Timetable identity has not been validated.',
    'Markers show last observations, with no invented intermediate positions.',
    'Connecting lines show observation order, not road-matched paths.',
    'Missing observations do not establish missing buses or cancelled services.',
    'No punctuality, passenger waiting-time or roadworks-causation claims are made.',
    'This reconstruction uses observation timestamps, not a complete history of what a '
    'real-time subscriber knew at each moment.',
]

# Observations are admitted a little before the first capture and a little after the last,
# because a response can carry a position recorded shortly before it was published.
LEAD_MS, LAG_MS = 120_000, 30_000

PUBLISHABLE_SQL = f"""
SELECT operator, vehicle, route, direction, journey_ref, observed_at_ms, recorded_at_text,
       lat, lon, destination, origin, aimed_departure, source_sha256, source_member,
       -- Normalised to UTC so the published contract keeps one timestamp convention.
       -- The original observation string is never reformatted; this is our own clock.
       strftime(retrieved_at AT TIME ZONE 'UTC', '%Y-%m-%dT%H:%M:%S+00:00') AS retrieved_at_text
FROM v_publishable_observation
WHERE observed_at_ms BETWEEN ? AND ?
ORDER BY operator, vehicle, route, direction, journey_ref, observed_at_ms
"""


def _iso(value):
    """UTC ISO-8601. Our own timestamps use one convention; source strings are untouched."""
    return None if value is None else value.astimezone(timezone.utc).isoformat()


def canonical_bytes(payload):
    return json.dumps(payload, ensure_ascii=False, separators=(',', ':'), sort_keys=True).encode()


def build_snapshot(con):
    """Assemble the candidate replay snapshot. SQL selects and filters; Python shapes JSON."""
    start, end = capture_window(con)
    if start is None:
        raise ValueError('No position sources in the warehouse; nothing to publish')
    rows = con.execute(PUBLISHABLE_SQL, [start - LEAD_MS, end + LAG_MS]).fetchall()
    columns = ['operator', 'vehicle', 'route', 'direction', 'journeyRef', 'time', 'recordedAt',
               'lat', 'lon', 'destination', 'origin', 'aimedDeparture', 'sourceHash',
               'sourceMember', 'retrievedAt']
    tracks = defaultdict(list)
    for row in rows:
        point = dict(zip(columns, row))
        point['time'] = int(point['time'])
        # A journey track is one vehicle on one journey on one calendar day.
        key = '|'.join([point['operator'], point['vehicle'], point['route'], point['direction'],
                        point['journeyRef'], point['recordedAt'][:10]])
        tracks[key].append(point)

    journeys = []
    for key, points in tracks.items():
        points.sort(key=lambda p: p['time'])
        first = points[0]
        journeys.append({
            'id': hashlib.sha256(key.encode()).hexdigest()[:16],
            **{k: first[k] for k in ['operator', 'vehicle', 'route', 'direction', 'journeyRef',
                                     'destination', 'origin', 'aimedDeparture']},
            'points': points,
        })
    journeys.sort(key=lambda j: (-len(j['points']), j['route'], j['vehicle']))

    sources = [
        {'url': url, 'sha256': sha, 'bytes': int(size),
         'capturedAt': _iso(captured), 'retrievedAt': _iso(retrieved)}
        for url, sha, size, captured, retrieved in con.execute(
            'SELECT source_url, source_sha256, byte_size, captured_at, retrieved_at'
            " FROM raw_source WHERE source_kind = 'archive_positions' ORDER BY captured_at").fetchall()
    ]
    totals = warehouse_totals(con)
    published = sum(len(j['points']) for j in journeys)
    frames = sorted({int(t.timestamp() * 1000) for (t,) in con.execute(
        "SELECT captured_at FROM raw_source WHERE source_kind = 'archive_positions'").fetchall()})

    payload = {
        'schemaVersion': 1, 'mode': 'archive', 'generatedAt': utc_now(),
        'start': start, 'end': end, 'frames': frames, 'bounds': list(BBOX),
        'journeys': journeys, 'sources': sources,
        'quality': {
            'rawActivitiesInArea': totals['activitiesInArea'],
            'uniqueObservations': published,
            'duplicateObservations': totals['repeatObservations'],
            'conflictingObservations': totals['conflictIdentities'],
            'outsideCaptureWindow': totals['publishableObservations'] - published,
            'rejected': dict(con.execute(
                'SELECT reason, sum(record_count)::BIGINT FROM rejection GROUP BY 1').fetchall()),
            'timetableMatched': False, 'scheduledCoverage': None,
        },
        'attribution': ATTRIBUTION, 'sourceUrl': SOURCE_URL, 'limitations': LIMITATIONS,
    }
    # The id names this content, so it is derived before it is embedded.
    payload['snapshotId'] = 'snap-' + hashlib.sha256(canonical_bytes(payload)).hexdigest()[:16]
    return payload


def validate(con, candidate, active):
    """Every check is named and recorded, whether it passes or fails."""
    checks = []

    def check(name, passed, detail):
        checks.append({'name': name, 'passed': bool(passed), 'detail': detail})

    journeys = candidate.get('journeys') or []
    points = [p for j in journeys for p in j['points']]
    quality = candidate.get('quality') or {}

    check('schema_shape',
          candidate.get('schemaVersion') == 1 and candidate.get('mode') == 'archive'
          and isinstance(candidate.get('snapshotId'), str),
          f"schemaVersion={candidate.get('schemaVersion')} mode={candidate.get('mode')}")
    check('window_ordered', (candidate.get('end') or 0) > (candidate.get('start') or 0),
          f"start={candidate.get('start')} end={candidate.get('end')}")
    check('journeys_non_empty',
          bool(journeys) and all(j['points'] for j in journeys),
          f'{len(journeys)} journeys, {len(points)} points')
    check('points_reconcile_with_quality', len(points) == quality.get('uniqueObservations'),
          f"points={len(points)} quality.uniqueObservations={quality.get('uniqueObservations')}")
    hashes = {s['sha256'] for s in candidate.get('sources') or []}
    unresolved = sum(1 for p in points if p['sourceHash'] not in hashes)
    check('every_point_resolves_to_a_source', unresolved == 0, f'{unresolved} unresolved points')
    west, south, east, north = candidate.get('bounds') or BBOX
    outside = sum(1 for p in points
                  if not (west <= p['lon'] <= east and south <= p['lat'] <= north))
    check('coordinates_inside_declared_bounds', outside == 0, f'{outside} points outside bounds')
    check('no_unvalidated_timetable_claim',
          quality.get('timetableMatched') is False and quality.get('scheduledCoverage') is None,
          'timetableMatched=False, scheduledCoverage=None')

    # Guards against publishing a partial rerun, and against a backfill winding the served
    # window backwards. A candidate must account for the whole warehouse, not a subset.
    start, end = candidate.get('start'), candidate.get('end')
    expected = con.execute(
        'SELECT count(*) FROM v_publishable_observation WHERE observed_at_ms BETWEEN ? AND ?',
        [start - LEAD_MS, end + LAG_MS]).fetchone()[0]
    check('built_from_full_warehouse', len(points) == expected,
          f'candidate={len(points)} warehouse_publishable_in_window={expected}')

    if active:
        suppressed_since = con.execute(
            'SELECT count(*) FROM observation_conflict WHERE detected_at > '
            '(SELECT published_at FROM publication WHERE publication_id = ?)',
            [active['publicationId']]).fetchone()[0]
        check('window_end_not_earlier_than_served',
              (end or 0) >= (active['windowEndMs'] or 0),
              f"candidate_end={end} served_end={active['windowEndMs']}")
        check('observations_not_lost_without_suppression',
              len(points) + suppressed_since >= (active['observationCount'] or 0),
              f"candidate={len(points)} served={active['observationCount']} "
              f'newly_suppressed={suppressed_since}')
    else:
        check('window_end_not_earlier_than_served', True, 'no snapshot served yet')
        check('observations_not_lost_without_suppression', True, 'no snapshot served yet')
    return checks


def publish(con, run_id, candidate, target=REPLAY_TARGET, archive_dir=SNAPSHOT_ARCHIVE):
    """Validate the candidate, then replace the served snapshot in one atomic rename."""
    target, archive_dir = Path(target), Path(archive_dir)
    active = active_publication(con)
    checks = validate(con, candidate, active)
    body = json.dumps(candidate, ensure_ascii=False, separators=(',', ':')) + '\n'
    raw = body.encode()
    snapshot_id = candidate['snapshotId']
    publication_id = snapshot_id + '-' + utc_now()[11:19].replace(':', '')
    failed = [c['name'] for c in checks if not c['passed']]

    # Always keep the candidate on disk, valid or not, so a failure can be inspected.
    archive_dir.mkdir(parents=True, exist_ok=True)
    archived = archive_dir / f"{'rejected-' if failed else ''}{publication_id}.json"
    archived.write_bytes(raw)

    row = {
        'publication_id': publication_id, 'run_id': run_id, 'snapshot_id': snapshot_id,
        'status': 'failed_validation' if failed else 'published',
        'observation_count': sum(len(j['points']) for j in candidate['journeys']),
        'journey_count': len(candidate['journeys']), 'source_count': len(candidate['sources']),
        'window_start_ms': candidate['start'], 'window_end_ms': candidate['end'],
        'snapshot_sha256': hashlib.sha256(raw).hexdigest(), 'snapshot_bytes': len(raw),
        'target_path': str(target), 'archived_path': str(archived),
        'failure_reason': ', '.join(failed) or None,
    }

    if not failed:
        target.parent.mkdir(parents=True, exist_ok=True)
        temp = target.with_suffix('.json.candidate')
        with open(temp, 'wb') as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp, target)  # atomic: readers see the old or the new file, never half

    con.execute(
        'INSERT INTO publication (publication_id, run_id, snapshot_id, status, built_at,'
        ' published_at, observation_count, journey_count, source_count, window_start_ms,'
        ' window_end_ms, snapshot_sha256, snapshot_bytes, target_path, archived_path, failure_reason)'
        ' VALUES (?, ?, ?, ?, now(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [row['publication_id'], row['run_id'], row['snapshot_id'], row['status'],
         None, row['observation_count'], row['journey_count'],
         row['source_count'], row['window_start_ms'], row['window_end_ms'],
         row['snapshot_sha256'], row['snapshot_bytes'], row['target_path'],
         row['archived_path'], row['failure_reason']])
    if not failed:
        # published_at is set only once the bytes are actually in place at the target.
        con.execute('UPDATE publication SET published_at = now() WHERE publication_id = ?',
                    [publication_id])
    con.executemany(
        'INSERT INTO validation_check VALUES (?, ?, ?, ?)'
        ' ON CONFLICT (publication_id, check_name) DO UPDATE SET passed = excluded.passed,'
        ' detail = excluded.detail',
        [(publication_id, c['name'], c['passed'], c['detail']) for c in checks])
    return {'publicationId': publication_id, 'snapshotId': snapshot_id,
            'status': row['status'], 'checks': checks, 'failed': failed,
            'archivedPath': str(archived), 'sha256': row['snapshot_sha256']}
