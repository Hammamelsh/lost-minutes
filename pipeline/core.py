"""Small, dependency-free source parser. No stop-arrival or delay inference here."""
from __future__ import annotations

import hashlib
import io
import json
import math
import os
import zipfile
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from xml.etree import ElementTree as ET

MAX_XML = 80_000_000
MAX_QUARANTINE_PER_SOURCE = 500

# The area the retained archive sample was collected under. Fixed, because the published
# archive figures were measured inside it and reprocessing to a different box would silently
# change numbers that are already documented.
BBOX = (-2.30, 53.42, -2.18, 53.51)

# The area live collection and stop discovery use. Wider on purpose: Longford Park sits
# 0.6 km outside the archive box, so the nearest six stops to it - Stretford Mall, Stretford
# Public Hall, Moss Road - were all unreachable. West to Stretford and Trafford, east past
# Levenshulme.
SERVICE_AREA = (-2.36, 53.40, -2.16, 53.53)

# A vehicle may legitimately report a moment before the response is built, and clocks
# disagree. Beyond this the timestamp is not credible and the record is quarantined rather
# than published: measured on the retained sample, no observation preceded its own file.
FUTURE_TOLERANCE_SECONDS = 120


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def timestamp(value):
    dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if dt.tzinfo is None:
        raise ValueError('Timestamp has no timezone')
    return int(dt.timestamp() * 1000)


def _moment(value):
    """Epoch seconds for a timestamp we produced, or None if it is not a timestamp."""
    try:
        return timestamp(value) / 1000.0
    except (ValueError, AttributeError, TypeError):
        return None


def read_bearing(text):
    """SIRI-VM Bearing: the compass direction the vehicle is heading, 0 to 360 degrees.

    Zero is a real bearing (due north), never a stand-in for missing. Missing stays missing.
    A value that is unreadable or outside the range is kept as text with its status and is
    never repaired: nothing is oriented by a bearing we could not read.
    """
    text = (text or '').strip()
    if not text:
        return None, 'absent'
    try:
        value = float(text)
    except ValueError:
        return None, 'invalid'
    if not math.isfinite(value) or not 0 <= value <= 360:
        return None, 'invalid'
    return (0.0 if value == 0 else value), 'reported'


def redact_url(url):
    p = urlsplit(url)
    hidden = {'api_key', 'apikey', 'key', 'token', 'access_token'}
    # safe='[]' keeps the marker readable as api_key=[REDACTED] rather than %5B…%5D,
    # because these URLs are read by a person inspecting the run history.
    query = urlencode([(k, '[REDACTED]' if k.lower() in hidden else v)
                       for k, v in parse_qsl(p.query, keep_blank_values=True)], safe='[]')
    host = p.hostname or ''
    if p.port:
        host += ':' + str(p.port)
    return urlunsplit((p.scheme, host, p.path, query, ''))


def stopped_by_signal(error):
    """True where an error only stands for a stop. A stop raised from a signal handler while DuckDB is
    running a query does not arrive as itself: DuckDB interrupts the query and raises its own
    RuntimeError("Query interrupted"), with the stop as its cause. A handler that catches Exception
    around a query must re-raise that, or the stop is swallowed: on 26 September 2026 a restart landed
    in the timetable matching, which read it as "patterns not built yet", published every bus
    unmatched, carried on collecting, and was killed by systemd 30 s later."""
    seen = set()
    while error is not None and id(error) not in seen:
        if not isinstance(error, Exception):
            return True
        seen.add(id(error))
        error = error.__cause__ or error.__context__
    return False


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n')
    os.replace(temp, path)


def xml_documents(body):
    if body.startswith(b'PK'):
        with zipfile.ZipFile(io.BytesIO(body)) as archive:
            members = [m for m in archive.infolist() if not m.is_dir() and m.filename.lower().endswith('.xml')]
            if not members or sum(m.file_size for m in members) > MAX_XML:
                raise ValueError('Missing XML or oversized decompressed archive')
            for member in members:
                yield member.filename, archive.read(member)
    else:
        yield 'response.xml', body


def parse_source(body, source_hash, retrieved_at, bounds=BBOX):
    """Parse one raw response.

    Returns (records, rejected, stats). `stats` carries the counts the original return
    value threw away - every VehicleActivity seen, and those outside the selected area -
    plus `quarantined`, the questionable records kept verbatim with a reason.

    An out-of-area bus is a real bus we deliberately do not publish, so it is neither a
    rejection nor a quarantine. Nothing here repairs a value: a coordinate we cannot trust
    is quarantined as text, never rounded or nudged into a plausible-looking position.
    """
    records, rejected = [], Counter()
    quarantined = []
    bearings = Counter()
    activities_total = outside_area = 0
    received = _moment(retrieved_at)

    def quarantine(reason, member, field, detail=''):
        rejected[reason] += 1
        if len(quarantined) < MAX_QUARANTINE_PER_SOURCE:
            quarantined.append({
                'reason': reason, 'detail': str(detail)[:200], 'sourceMember': member,
                'recordedAt': field('RecordedAtTime'), 'latitude': field('Latitude'),
                'longitude': field('Longitude'), 'operator': field('OperatorRef'),
                'vehicle': field('VehicleRef'), 'route': field('LineRef'),
                'direction': field('DirectionRef'),
                'journeyRef': field('DatedVehicleJourneyRef') or field('VehicleJourneyRef'),
            })

    for member, xml in xml_documents(body):
        if len(xml) > MAX_XML or b'<!DOCTYPE' in xml.upper() or b'<!ENTITY' in xml.upper():
            raise ValueError('Oversized XML or prohibited entity declaration')
        root = ET.fromstring(xml)
        for node in root.iter():
            node.tag = node.tag.split('}')[-1]
        for activity in root.iter('VehicleActivity'):
            activities_total += 1

            def field(name):
                item = activity.find('.//' + name)
                return (item.text or '').strip() if item is not None else ''
            try:
                try:
                    lat, lon = float(field('Latitude')), float(field('Longitude'))
                except ValueError as error:
                    quarantine('unreadable_coordinate', member, field, error)
                    continue
                if not math.isfinite(lat) or not math.isfinite(lon) or not (-90 <= lat <= 90 and -180 <= lon <= 180):
                    quarantine('coordinate_out_of_range', member, field, f'{lat},{lon}')
                    continue
                if not (bounds[0] <= lon <= bounds[2] and bounds[1] <= lat <= bounds[3]):
                    outside_area += 1
                    continue
                recorded_at = field('RecordedAtTime')
                try:
                    t = timestamp(recorded_at)
                except ValueError as error:
                    reason = ('timestamp_without_offset' if 'timezone' in str(error)
                              else 'unreadable_timestamp')
                    quarantine(reason, member, field, error)
                    continue
                # Clock skew and future timestamps: a position cannot be reported from the
                # future. Kept with its reason so the source problem stays visible.
                if received is not None and t / 1000.0 > received + FUTURE_TOLERANCE_SECONDS:
                    quarantine('future_timestamp', member, field,
                               f'{round(t / 1000.0 - received)}s ahead of retrieval')
                    continue
                operator, vehicle = field('OperatorRef'), field('VehicleRef')
                if not operator or not vehicle:
                    quarantine('missing_vehicle_identity', member, field,
                               f'operator={operator!r} vehicle={vehicle!r}')
                    continue
                bearing, bearing_status = read_bearing(field('Bearing'))
                bearings[bearing_status] += 1
                record = {
                    'time': t, 'recordedAt': recorded_at, 'retrievedAt': retrieved_at,
                    'lat': lat, 'lon': lon, 'operator': operator, 'vehicle': vehicle,
                    'route': field('LineRef') or 'Unspecified', 'direction': field('DirectionRef'),
                    'journeyRef': field('DatedVehicleJourneyRef') or field('VehicleJourneyRef'),
                    'destination': field('DestinationName'), 'origin': field('OriginName'),
                    'aimedDeparture': field('OriginAimedDepartureTime'),
                    'sourceHash': source_hash, 'sourceMember': member,
                    'bearing': bearing, 'bearingStatus': bearing_status,
                    'bearingRaw': field('Bearing')[:40] if bearing_status == 'invalid' else '',
                }
                records.append(record)
            except OverflowError as error:
                quarantine('coordinate_out_of_range', member, field, error)
    return records, dict(rejected), {'activitiesTotal': activities_total,
                                     'outsideArea': outside_area,
                                     'quarantined': quarantined,
                                     'bearing': dict(bearings)}


def observations(body, source_hash, retrieved_at, bounds=BBOX):
    """Original two-value contract, kept so existing callers and tests are unaffected."""
    records, rejected, _ = parse_source(body, source_hash, retrieved_at, bounds)
    return records, rejected


def observation_key(r):
    return (r['operator'], r['vehicle'], r['route'], r['direction'], r['journeyRef'], r['time'])


def deduplicate(records):
    unique, conflicts = {}, set()
    duplicates = 0
    for record in records:
        key = observation_key(record)
        if key in unique:
            previous = unique[key]
            if (previous['lat'], previous['lon']) != (record['lat'], record['lon']):
                conflicts.add(key)
            else:
                duplicates += 1
        else:
            unique[key] = record
    return [r for k, r in unique.items() if k not in conflicts], duplicates, len(conflicts)


def publish_replay(records, sources, path, rejected=None):
    accepted, duplicates, conflicts = deduplicate(records)
    # Exclude observations outside the captured archive window; old positions remain
    # in raw snapshots and are counted separately, never silently called current.
    capture_times = [timestamp(s['capturedAt']) for s in sources]
    start, end = min(capture_times), max(capture_times)
    usable = [r for r in accepted if start - 120_000 <= r['time'] <= end + 30_000]
    tracks = defaultdict(list)
    for record in usable:
        key = '|'.join([record['operator'], record['vehicle'], record['route'], record['direction'], record['journeyRef'], record['recordedAt'][:10]])
        tracks[key].append(record)
    journeys = []
    for key, points in tracks.items():
        points.sort(key=lambda r: r['time'])
        first = points[0]
        journeys.append({
            'id': hashlib.sha256(key.encode()).hexdigest()[:16],
            **{k: first[k] for k in ['operator', 'vehicle', 'route', 'direction', 'journeyRef', 'destination', 'origin', 'aimedDeparture']},
            'points': points,
        })
    journeys.sort(key=lambda j: (-len(j['points']), j['route'], j['vehicle']))
    output = {
        'schemaVersion': 1, 'mode': 'archive', 'generatedAt': utc_now(),
        'start': start, 'end': end, 'frames': sorted(set(capture_times)),
        'bounds': BBOX, 'journeys': journeys, 'sources': sources,
        'quality': {'rawActivitiesInArea': len(records), 'uniqueObservations': len(usable),
                    'duplicateObservations': duplicates, 'conflictingObservations': conflicts,
                    'outsideCaptureWindow': len(accepted) - len(usable), 'rejected': rejected or {},
                    'timetableMatched': False, 'scheduledCoverage': None},
        'attribution': 'Bus location data: Department for Transport / contributing operators, via Open Innovations / National Data Library. Open Government Licence v3.0.',
        'sourceUrl': 'https://data.datalibrary.uk/transport/BODS-ARCHIVE/',
        'limitations': ['This is a sampled historical replay, not a live feed.',
                       'This reconstruction uses observation timestamps, not a complete history of what a real-time subscriber knew at each moment.',
                       'Routes are operator-supplied labels. Timetable identity has not been validated.',
                       'Markers show last observations, with no invented intermediate positions.',
                       'Connecting lines show observation order, not road-matched paths.',
                       'Missing observations do not establish missing buses or cancelled services.',
                       'No punctuality, passenger waiting-time or roadworks-causation claims are made.'],
    }
    atomic_json(path, output)
    return output
