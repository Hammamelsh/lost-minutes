"""Build the Operations payload from real pipeline records. No invented statuses."""
from __future__ import annotations

import hashlib
import json
from datetime import timezone
from pathlib import Path

from .core import utc_now
from .publish import OPERATIONS_TARGET, REPLAY_TARGET
from .warehouse import active_publication, warehouse_totals

RUN_HISTORY_LIMIT = 25

DEFINITIONS = {
    'activitiesTotal': 'Every VehicleActivity element found in the source files, anywhere in '
                       'the feed, counted once per distinct source file.',
    'activitiesInArea': 'Of those, the ones whose coordinates fall inside the selected '
                        'Manchester bounding box. Inputs to everything below.',
    'outsideArea': 'Real buses outside the selected area. Not errors, and not published.',
    'rejectedRecords': 'Records refused by validation, grouped by reason: a missing operator '
                       'or vehicle identity, or a coordinate or timestamp that could not be '
                       'trusted. A timestamp without an offset is always refused.',
    'retainedObservations': 'Distinct observation identities stored: one row per (operator, '
                            'vehicle, route, direction, journey reference, observation time).',
    'repeatObservations': 'Input rows that repeated an identity already stored with the same '
                          'coordinates, or an extra copy of one identity inside a single '
                          'source. Derived, so reprocessing the same file does not inflate it.',
    'conflictIdentities': 'Identities where two sources disagreed about the coordinates. The '
                          'first row stays stored as evidence; the identity is withheld from '
                          'the published snapshot rather than being silently picked.',
    'publishableObservations': 'Stored observations minus every conflicting identity.',
    'publishedObservations': 'Publishable observations inside the capture window, which is '
                             'what the map and Evidence view actually read.',
    'sourceAge': 'Time between the newest source file being captured upstream and the moment '
                 'we published from it. On a historical archive this is expected to be large; '
                 'it measures the data, not the pipeline.',
}

NOTES = [
    'Every run listed here is a historical archive replay. Nothing is collected live.',
    'This pipeline runs in one local WSL process. When the machine or the terminal stops, '
    'collection stops; there is no scheduler and no hosted worker yet.',
    'Source freshness and processing time are different measurements and are shown separately.',
    'A run can process its inputs successfully and still publish nothing, if the candidate '
    'snapshot fails validation. Both outcomes are recorded.',
    'No expected-service coverage is shown, because no timetable denominator has been validated.',
]


def _iso(value):
    return None if value is None else value.astimezone(timezone.utc).isoformat()


def _display_path(path):
    """Project-relative form. An absolute path would publish the local username."""
    parts = Path(path).parts
    for anchor in ('public', 'data'):
        if anchor in parts:
            return '/'.join(parts[parts.index(anchor):])
    return Path(path).name


def build_operations(con, replay_target=REPLAY_TARGET):
    totals = warehouse_totals(con)
    active = active_publication(con)
    if active and active.get('targetPath'):
        active['targetPath'] = _display_path(active['targetPath'])

    freshness = con.execute("""
        SELECT max(captured_at), max(retrieved_at),
               (SELECT max(finished_at) FROM source_processing WHERE outcome = 'succeeded'),
               (SELECT max(published_at) FROM publication WHERE status = 'published')
        FROM raw_source
    """).fetchone()
    latest_captured, latest_retrieved, last_processed, last_published = freshness

    runs = []
    for row in con.execute(f"""
        SELECT t.run_id, t.mode, t.status, t.is_historical, t.started_at, t.finished_at,
               t.sources_seen, t.sources_processed, t.resumed_from, t.error_class, t.error_detail,
               t.activities_total, t.activities_in_area, t.outside_area, t.new_observations,
               t.repeat_observations, t.conflicting_observations, t.rejected_records,
               p.status, p.snapshot_id, p.failure_reason
        FROM v_run_totals t
        LEFT JOIN publication p ON p.run_id = t.run_id
        ORDER BY t.started_at DESC LIMIT {RUN_HISTORY_LIMIT}
    """).fetchall():
        runs.append({
            'runId': row[0], 'mode': row[1], 'status': row[2], 'isHistorical': bool(row[3]),
            'startedAt': _iso(row[4]), 'finishedAt': _iso(row[5]),
            'durationSeconds': None if not (row[4] and row[5]) else round((row[5] - row[4]).total_seconds(), 2),
            'sourcesSeen': int(row[6] or 0), 'sourcesProcessed': int(row[7] or 0),
            'resumedFrom': row[8], 'errorClass': row[9], 'errorDetail': row[10],
            'activitiesTotal': int(row[11] or 0), 'activitiesInArea': int(row[12] or 0),
            'outsideArea': int(row[13] or 0), 'newObservations': int(row[14] or 0),
            'repeatObservations': int(row[15] or 0), 'conflictingObservations': int(row[16] or 0),
            'rejectedRecords': int(row[17] or 0),
            'publicationStatus': row[18], 'publicationSnapshotId': row[19],
            'publicationFailureReason': row[20],
        })

    publications = [{
        'publicationId': r[0], 'snapshotId': r[1], 'status': r[2], 'builtAt': _iso(r[3]),
        'publishedAt': _iso(r[4]), 'observationCount': int(r[5] or 0),
        'journeyCount': int(r[6] or 0), 'sha256': r[7], 'failureReason': r[8],
        'failedChecks': [c for (c,) in con.execute(
            'SELECT check_name FROM validation_check WHERE publication_id = ? AND NOT passed'
            ' ORDER BY check_name', [r[0]]).fetchall()],
    } for r in con.execute("""
        SELECT publication_id, snapshot_id, status, built_at, published_at, observation_count,
               journey_count, snapshot_sha256, failure_reason
        FROM publication ORDER BY built_at DESC LIMIT 12
    """).fetchall()]

    rejections = [{'reason': r[0], 'count': int(r[1])} for r in con.execute(
        'SELECT reason, sum(record_count)::BIGINT FROM rejection GROUP BY 1 ORDER BY 2 DESC').fetchall()]

    # What is actually on disk right now, not what we believe we wrote.
    served = {'path': _display_path(replay_target), 'present': Path(replay_target).exists()}
    if served['present']:
        raw = Path(replay_target).read_bytes()
        served['sha256'] = hashlib.sha256(raw).hexdigest()
        served['bytes'] = len(raw)
        try:
            body = json.loads(raw)
            served['snapshotId'] = body.get('snapshotId')
            served['observationCount'] = sum(len(j['points']) for j in body.get('journeys', []))
            served['generatedAt'] = body.get('generatedAt')
        except (ValueError, KeyError, TypeError):
            served['snapshotId'] = None
    served['matchesRecordedPublication'] = bool(
        active and served.get('sha256') == active.get('sha256')
        and served.get('snapshotId') == active.get('snapshotId'))

    # Counted independently of the totals above, so the reconciliation below is a real
    # check and not an identity that restates one number as itself.
    from .publish import LAG_MS, LEAD_MS
    from .warehouse import capture_window
    window_start, window_end = capture_window(con)
    if window_start is None:
        inside_window = outside_window = 0
    else:
        inside_window, outside_window = con.execute(
            'SELECT count(*) FILTER (WHERE observed_at_ms BETWEEN ? AND ?),'
            ' count(*) FILTER (WHERE observed_at_ms NOT BETWEEN ? AND ?)'
            ' FROM v_publishable_observation',
            [window_start - LEAD_MS, window_end + LAG_MS,
             window_start - LEAD_MS, window_end + LAG_MS]).fetchone()
        inside_window, outside_window = int(inside_window), int(outside_window)
    # What the served file actually contains, read back from disk.
    published_observations = served.get('observationCount') or 0
    source_age = None
    if latest_captured is not None and last_published is not None:
        source_age = round((last_published - latest_captured).total_seconds())

    reconciliation = [
        {'label': 'Inputs account for area, rejections and out-of-area buses',
         'expression': 'activitiesTotal = activitiesInArea + outsideArea + rejectedRecords',
         'left': totals['activitiesTotal'],
         'right': totals['activitiesInArea'] + totals['outsideArea'] + totals['rejectedRecords']},
        {'label': 'In-area inputs account for retained, repeats and conflicts',
         'expression': 'activitiesInArea = retainedObservations + repeatObservations + conflictingInputRows',
         'left': totals['activitiesInArea'],
         'right': totals['storedObservations'] + totals['repeatObservations'] + totals['conflictingInputRows']},
        {'label': 'Conflicting identities are withheld from the publishable set',
         'expression': 'publishableObservations = retainedObservations - suppressedObservations',
         'left': totals['publishableObservations'],
         'right': totals['storedObservations'] - totals['suppressedObservations']},
        {'label': 'The snapshot on disk is the publishable set inside the capture window',
         'expression': 'observationsInServedFile + outsideCaptureWindow = publishableObservations',
         'left': published_observations + outside_window,
         'right': totals['publishableObservations']},
        {'label': 'The file being served is the publication we recorded',
         'expression': 'servedFileSha256 = recordedPublicationSha256',
         'left': served.get('sha256'), 'right': (active or {}).get('sha256')},
    ]
    for item in reconciliation:
        item['balanced'] = item['left'] == item['right']
        item['applicable'] = True
    # The last two identities are about the archive replay this warehouse published. A server
    # that never ran the archive import serves a replay.json that arrived with a deploy, and has
    # no publication of it to compare against: those two rows cannot be checked here, and saying
    # UNBALANCED would claim a broken count where there is no count of ours to break.
    if active is None and served['present']:
        for item in reconciliation[3:]:
            item['applicable'] = False
            item['note'] = ('Not checked on this machine: the replay on disk was not published from '
                            'this warehouse (no archive publication is recorded here; the file arrived '
                            'with a deploy). Running the archive import here would make it checkable.')

    return {
        'schemaVersion': 1,
        'generatedAt': utc_now(),
        'mode': 'historical_archive',
        'servedSnapshot': served,
        'recordedPublication': active,
        'freshness': {
            'latestSourceCapturedAt': _iso(latest_captured),
            'latestSourceRetrievedAt': _iso(latest_retrieved),
            'lastProcessedAt': _iso(last_processed),
            'lastPublishedAt': _iso(last_published),
            'sourceAgeSecondsAtPublication': source_age,
        },
        'totals': {
            'rawSources': totals['rawSources'],
            'sourcesProcessed': totals['sourcesProcessed'],
            'activitiesTotal': totals['activitiesTotal'],
            'activitiesInArea': totals['activitiesInArea'],
            'outsideArea': totals['outsideArea'],
            'rejectedRecords': totals['rejectedRecords'],
            'retainedObservations': totals['storedObservations'],
            'repeatObservations': totals['repeatObservations'],
            'conflictIdentities': totals['conflictIdentities'],
            'conflictingInputRows': totals['conflictingInputRows'],
            'publishableObservations': totals['publishableObservations'],
            'suppressedObservations': totals['suppressedObservations'],
            'publishedObservations': published_observations,
            'insideCaptureWindow': inside_window,
            'outsideCaptureWindow': outside_window,
        },
        'reconciliation': reconciliation,
        'rejections': rejections,
        'runs': runs,
        'publications': publications,
        'definitions': DEFINITIONS,
        'notes': NOTES,
    }


def write_operations(con, target=OPERATIONS_TARGET, replay_target=REPLAY_TARGET):
    from .core import atomic_json
    payload = build_operations(con, replay_target)
    atomic_json(target, payload)
    return payload
