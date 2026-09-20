"""Service patterns from TransXChange: the ordered stops a service actually calls at.

    .venv/bin/python -m pipeline.patterns build                  # every observed service we hold
    .venv/bin/python -m pipeline.patterns build --coverage all   # every file valid today
    .venv/bin/python -m pipeline.patterns build --lines 15,50    # named lines only
    .venv/bin/python -m pipeline.patterns build --max-lines 10   # a quick development build

A route label is not a route. One line has many journey patterns: directions, branches,
short workings and school variants, each calling at a different ordered list of stops. This
module reads those patterns out of the preserved timetable datasets so that a bus can be
placed *on a pattern* rather than merely near a passenger.

Coverage is chosen by evidence and says so. By default it is every (operator, line) pair that
live collection has actually observed and for which a preserved timetable file is valid on the
build date. There is no hidden cap: until 13 September 2026 the build kept only the 14
most-observed lines, which is why route 15 read "not held" while its file sat on disk.

Nothing here is inferred. A pattern records its operator, the timetable version, the days its
journeys run and the declared link distances. A distance the file does not declare stays
unknown rather than becoming zero, and a pattern no journey runs is not a path anyone takes.
"""
from __future__ import annotations

import argparse
import collections
import gzip
import hashlib
import io
import json
import re
import sys
import zipfile
from datetime import date, datetime, timedelta
from pathlib import Path
from xml.etree import ElementTree as ET

from .core import atomic_json, utc_now
from .service_days import LONDON, describe
from .warehouse import DEFAULT_DB, connect, finish_run, start_run

class PatternBuildRefused(RuntimeError):
    """Raised when a build would replace the published catalogue with far less than it holds."""

    def __init__(self, would_publish, already_published, floor):
        super().__init__(f'refusing to publish {would_publish} patterns over {already_published} '
                         f'already published (floor {floor})')
        self.would_publish, self.already_published, self.floor = would_publish, already_published, floor


ROOT = Path(__file__).resolve().parents[1]
PATTERNS_TARGET = Path('public/data/patterns.json')
TIMETABLE_DIR = Path('data/live-capture/timetables')
SCHEMA_VERSION = 2

# BNML_86_..._20260830_20310830_2411885.xml and BNFM_456_..._20251224_20301123_<uuid>.xml:
# operator, line and declared validity, readable without parsing the file. The suffix is a
# number in some datasets and a UUID in others; requiring a number silently dropped all 83
# First Manchester files.
FILENAME = re.compile(r'^(?P<operator>[A-Z0-9]+)_(?P<line>[^_]+)_.*_(?P<start>\d{8})_(?P<end>\d{8})_[^_]+\.xml$')

# A pattern is published when it calls at a stop inside the area we collect, because a
# passenger there could board it, and when it is long enough for "stops before yours" to mean
# anything. It used to need 60% of its stops inside, which hid whole days of service whose
# journeys run a longer path: Sunday's 219 is 45% inside, so every Sunday 219 was refused.
MIN_STOPS_IN_AREA = 1
MIN_STOPS = 5

# A pattern set built today has to still be right tomorrow. Selecting only the files valid on the
# build day left two holes: a registration starting in the next few days was invisible until a
# rebuild happened to run after it began, and a day the timetable changes (a new registration, a
# weekday service replacing a weekend one) depended on the nightly rebuild having succeeded. Every
# file whose validity touches the window from the build day to HORIZON_DAYS ahead is parsed
# instead. Nothing is asserted early: each published pattern carries its own validFrom/validTo,
# and the matcher and the page both ask whether it is valid on the day in question before using
# it. Files that expired before the build day are not parsed; they describe a service that has
# been withdrawn or replaced.
HORIZON_DAYS = 14

WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
DAY_GROUPS = {name: [index] for index, name in enumerate(WEEKDAYS)}
DAY_GROUPS.update({
    'MondayToFriday': [0, 1, 2, 3, 4], 'MondayToSaturday': [0, 1, 2, 3, 4, 5],
    'MondayToSunday': list(range(7)), 'Weekend': [5, 6],
    **{f'Not{name}': [i for i in range(7) if i != index] for index, name in enumerate(WEEKDAYS)},
})

DDL = """
CREATE TABLE IF NOT EXISTS service_pattern (
    pattern_id          TEXT PRIMARY KEY,
    dataset_sha256      TEXT NOT NULL,
    source_file         TEXT NOT NULL,
    line_name           TEXT NOT NULL,
    service_code        TEXT,
    operator_code       TEXT,
    direction           TEXT,
    destination_display TEXT,
    stop_count          INTEGER,
    stops_in_area       INTEGER,
    total_distance_m    INTEGER,   -- NULL when any link distance was not declared
    valid_from          DATE,
    valid_to            DATE,
    has_repeated_stop   BOOLEAN,   -- a loop: progress along it is ambiguous
    first_seen_run_id   TEXT,
    first_seen_at       TIMESTAMPTZ,
    operating_rules     TEXT,      -- JSON: the operating profiles of the journeys that run it
    version_modified    TEXT,      -- the file's ModificationDateTime
    version_revision    TEXT,      -- the file's RevisionNumber
    journey_count       INTEGER,
    distances_known     BOOLEAN
);

CREATE TABLE IF NOT EXISTS service_pattern_stop (
    pattern_id      TEXT NOT NULL,
    sequence        INTEGER NOT NULL,
    atco_code       TEXT NOT NULL,
    distance_from_start_m INTEGER,  -- NULL: not declared, never zero by default
    seconds_from_start    INTEGER,  -- scheduled seconds from the first stop; NULL past an undeclared RunTime
    PRIMARY KEY (pattern_id, sequence)
);
"""

# Warehouses built before operating days and versions were recorded.
MIGRATIONS = [f'ALTER TABLE service_pattern ADD COLUMN IF NOT EXISTS {column}' for column in (
    'operating_rules TEXT', 'version_modified TEXT', 'version_revision TEXT',
    'journey_count INTEGER', 'distances_known BOOLEAN')] + [
    # Scheduled seconds per stop, from the links' RunTime, recorded from 20 September 2026.
    'ALTER TABLE service_pattern_stop ADD COLUMN IF NOT EXISTS seconds_from_start INTEGER']


def ensure_schema(con):
    con.execute(DDL)
    for statement in MIGRATIONS:
        con.execute(statement)


def _parse_date(value):
    return date(int(value[:4]), int(value[4:6]), int(value[6:]))


def _iso(value):
    return value.isoformat() if isinstance(value, date) else (str(value) if value else None)


def newest_snapshots(directory=TIMETABLE_DIR):
    """One snapshot per preserved dataset: the newest copy of each.

    The collector re-downloads the timetable datasets while it runs, so this directory
    accumulates content-addressed snapshots of the same dataset. Reading all of them counted the
    same service twice: on 17 September 2026, with a second BNML snapshot on disk, route 15's
    published journey count doubled from 280 to 560 without a single new journey existing. It
    would also have resurrected a registration the operator had since withdrawn, because the
    older snapshot still contained its file.

    A dataset is identified by the operator whose files dominate it (BNML, BNSM, BNFM), which is
    how TfGM publishes them, and only its newest file is read. "Newest" is the file's
    modification time: these are written once, when the collector stores them.
    """
    newest, skipped = {}, []
    for archive_path in sorted(Path(directory).glob('*.bin.gz')):
        body = gzip.decompress(archive_path.read_bytes())
        with zipfile.ZipFile(io.BytesIO(body)) as archive:
            operators = collections.Counter()
            for member in archive.infolist():
                match = FILENAME.match(Path(member.filename).name)
                if match:
                    operators[match['operator']] += 1
        if not operators:
            skipped.append(archive_path.name)
            continue
        group = operators.most_common(1)[0][0]
        stamp = archive_path.stat().st_mtime
        held = newest.get(group)
        if held is None or stamp > held[0]:
            if held is not None:
                skipped.append(held[1].name)
            newest[group] = (stamp, archive_path)
        else:
            skipped.append(archive_path.name)
    return {'datasets': {group: path for group, (_, path) in sorted(newest.items())},
            'supersededOrUnreadable': sorted(skipped)}


def survey_datasets(directory=TIMETABLE_DIR, today=None, horizon_days=HORIZON_DAYS):
    """What each preserved dataset offers from `today` to `today` + `horizon_days`, from the
    member names alone. A file is taken when its declared validity touches that window, so a
    registration that begins in a few days is parsed now and marked as not yet in force."""
    today = today or datetime.now(LONDON).date()
    horizon = today + timedelta(days=max(0, horizon_days))
    entries, unrecognised = [], []
    expired = beyond = 0
    snapshots = newest_snapshots(directory)
    for archive_path in snapshots['datasets'].values():
        sha = archive_path.stem.split('.')[0]
        body = gzip.decompress(archive_path.read_bytes())
        with zipfile.ZipFile(io.BytesIO(body)) as archive:
            for member in archive.infolist():
                name = Path(member.filename).name
                if not name.lower().endswith('.xml'):
                    continue
                match = FILENAME.match(name)
                if not match:
                    unrecognised.append(name)
                    continue
                start, end = _parse_date(match['start']), _parse_date(match['end'])
                if end < today:
                    expired += 1
                    continue
                if start > horizon:
                    beyond += 1
                    continue
                entries.append({'sha256': sha, 'path': archive_path, 'member': member.filename,
                                'operator': match['operator'], 'line': match['line'],
                                'validFrom': start, 'validTo': end, 'bytes': member.file_size,
                                'inForce': start <= today <= end})
    return {'entries': entries, 'unrecognised': unrecognised,
            'datasetsRead': sorted(snapshots['datasets']),
            'snapshotsSuperseded': len(snapshots['supersededOrUnreadable']),
            'filesExpired': expired, 'filesBeyondHorizon': beyond,
            # Kept under its old name for readers of earlier coverage summaries.
            'notValidOnDate': expired + beyond,
            'date': today, 'horizon': horizon}


def index_datasets(directory=TIMETABLE_DIR, today=None):
    """The files in force on `today`. Kept for callers that only need the list."""
    return [e for e in survey_datasets(directory, today)['entries'] if e['inForce']]


def _local(tag):
    return tag.split('}')[-1]


def _text(node, path):
    value = node.findtext(path) if node is not None else None
    return value.strip() if value else ''



_DURATION = re.compile(r'^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$')


def _seconds(text):
    """An ISO 8601 duration such as PT2M or PT1H30S as whole seconds, or None when absent or
    unreadable. TransXChange puts one on every timing link as RunTime; a link without one leaves
    every later scheduled time on the pattern unknown, exactly as an undeclared distance does."""
    if not text:
        return None
    match = _DURATION.match(text.strip())
    if not match or not any(match.groups()):
        return None               # 'PT' on its own names no duration at all
    hours, minutes, seconds = (float(part) if part else 0.0 for part in match.groups())
    return int(round(hours * 3600 + minutes * 60 + seconds))

def _metres(value):
    try:
        metres = int(str(value).strip())
    except (TypeError, ValueError):
        return None
    return metres if metres >= 0 else None


def _date_ranges(node):
    """[start, end] ISO dates for each DateRange under `node`; a missing end means one day."""
    ranges = []
    for item in node.iter('DateRange') if node is not None else []:
        start = _text(item, 'StartDate')
        if start:
            ranges.append([start, _text(item, 'EndDate') or start])
    return ranges


def serviced_calendars(root):
    """Serviced organisation (usually a school) -> its working days and holidays."""
    calendars = {}
    for organisation in root.iter('ServicedOrganisation'):
        code = _text(organisation, 'OrganisationCode')
        if code:
            calendars[code] = {'WorkingDays': _date_ranges(organisation.find('WorkingDays')),
                               'Holidays': _date_ranges(organisation.find('Holidays'))}
    return calendars


def operating_rule(profile, calendars):
    """One OperatingProfile as a rule a date can be tested against (see service_days)."""
    if profile is None:
        return None
    days, holidays_only = set(), False
    regular = profile.find('RegularDayType')
    if regular is not None:
        week = regular.find('DaysOfWeek')
        for child in week if week is not None else []:
            days.update(DAY_GROUPS.get(child.tag, []))
        holidays_only = regular.find('HolidaysOnly') is not None
    rule = {'days': sorted(days)}
    if holidays_only:
        rule['holidaysOnly'] = True
    special = profile.find('SpecialDaysOperation')
    if special is not None:
        also_on = _date_ranges(special.find('DaysOfOperation'))
        not_on = _date_ranges(special.find('DaysOfNonOperation'))
        if also_on:
            rule['alsoOn'] = also_on
        if not_on:
            rule['notOn'] = not_on
    serviced = profile.find('ServicedOrganisationDayType')
    if serviced is not None:
        for mode, tag in (('only', 'DaysOfOperation'), ('except', 'DaysOfNonOperation')):
            node = serviced.find(tag)
            for kind in ('WorkingDays', 'Holidays'):
                part = node.find(kind) if node is not None else None
                if part is None:
                    continue
                codes = [(ref.text or '').strip() for ref in part.iter('ServicedOrganisationRef')
                         if ref.text and ref.text.strip()]
                ranges = [r for code in codes for r in calendars.get(code, {}).get(kind, [])]
                rule.setdefault('serviced', []).append(
                    {'mode': mode, 'kind': kind, 'organisations': codes, 'ranges': ranges})
    if profile.find('BankHolidayOperation') is not None:
        rule['bankHolidays'] = 'declared_not_evaluated'
    return rule


def _unique(rules):
    seen, result = set(), []
    for rule in rules:
        key = json.dumps(rule, sort_keys=True)
        if key not in seen:
            seen.add(key)
            result.append(rule)
    return result


def extract_patterns(xml_bytes, source_file, dataset_sha, valid_from, valid_to):
    """Ordered stop sequences, their declared distances and the days they run."""
    root = ET.fromstring(xml_bytes)
    for node in root.iter():
        node.tag = _local(node.tag)

    line_name = next((e.text.strip() for e in root.iter('LineName') if e.text), None)
    if not line_name:
        return []
    service = next(root.iter('Service'), None)
    service_code = _text(service, 'ServiceCode') or None
    operator_code = next((e.text.strip() for e in root.iter('NationalOperatorCode') if e.text),
                         next((e.text.strip() for e in root.iter('OperatorCode') if e.text), None))
    period = service.find('OperatingPeriod') if service is not None else None
    declared_from, declared_to = _text(period, 'StartDate'), _text(period, 'EndDate')
    calendars = serviced_calendars(root)
    service_rule = operating_rule(service.find('OperatingProfile') if service is not None else None,
                                  calendars)

    # Section id -> ordered [(atco, metres from the section start or None)].
    sections = {}
    for section in root.iter('JourneyPatternSection'):
        stops, distance, seconds = [], 0, 0
        for link in section.findall('JourneyPatternTimingLink'):
            origin, destination = link.find('From/StopPointRef'), link.find('To/StopPointRef')
            if origin is None or destination is None or not origin.text or not destination.text:
                continue
            if not stops:
                stops.append((origin.text.strip(), 0, 0))
            step = _metres(link.findtext('Distance'))
            # An undeclared link makes every distance after it unknown. Counting it as zero
            # would publish a shorter journey than the file describes, as though measured.
            distance = None if distance is None or step is None else distance + step
            # The same rule for time: RunTime is the scheduled running time of this link, and
            # a link without one leaves every later scheduled time unknown rather than early.
            run = _seconds(link.findtext('RunTime'))
            seconds = None if seconds is None or run is None else seconds + run
            stops.append((destination.text.strip(), distance, seconds))
        if stops:
            sections[section.get('id')] = stops

    # Which patterns journeys actually run, and on which days.
    journeys = list(root.iter('VehicleJourney'))
    pattern_of_journey = {_text(vj, 'VehicleJourneyCode'): _text(vj, 'JourneyPatternRef')
                          for vj in journeys if _text(vj, 'JourneyPatternRef')}
    rules_by_pattern = {}
    for vj in journeys:
        ref = _text(vj, 'JourneyPatternRef') or pattern_of_journey.get(_text(vj, 'VehicleJourneyRef'))
        if not ref:
            continue
        rules_by_pattern.setdefault(ref, []).append(
            operating_rule(vj.find('OperatingProfile'), calendars) or service_rule)

    patterns = []
    for journey in root.iter('JourneyPattern'):
        running = rules_by_pattern.get(journey.get('id'))
        if not running:
            continue              # declared but no journey runs it: not a path anyone takes
        refs = [r.text.strip() for r in journey.findall('JourneyPatternSectionRefs') if r.text]
        if not refs or any(ref not in sections for ref in refs):
            continue              # a section we cannot read would leave a hole in the order
        ordered, offset, offset_s = [], 0, 0
        for ref in refs:
            for atco, metres, secs in sections[ref]:
                if ordered and ordered[-1][0] == atco:
                    continue      # section boundaries repeat the shared stop
                ordered.append((atco,
                                None if offset is None or metres is None else metres + offset,
                                None if offset_s is None or secs is None else secs + offset_s))
            offset = ordered[-1][1] if ordered else offset
            offset_s = ordered[-1][2] if ordered else offset_s
        if len(ordered) < MIN_STOPS:
            continue
        known = [rule for rule in running if rule is not None]
        patterns.append({
            'lineName': line_name, 'serviceCode': service_code, 'operatorCode': operator_code,
            'direction': (journey.findtext('Direction') or '').strip().lower(),
            'destination': (journey.findtext('DestinationDisplay') or '').strip(),
            'stops': ordered, 'sourceFile': source_file, 'datasetSha256': dataset_sha,
            'validFrom': declared_from or _iso(valid_from), 'validTo': declared_to or _iso(valid_to),
            'modified': root.get('ModificationDateTime'), 'revision': root.get('RevisionNumber'),
            'rules': _unique(known) if known else None, 'journeys': len(running),
        })
    return patterns


def _declared(stops):
    return sum(1 for _, metres, *_ in stops if metres is not None)


def deduplicate(patterns):
    """Identical stop sequences for one operator, line and direction are one path.

    Their operating days are combined, so weekday and Saturday journeys over the same stops
    make one pattern that runs on both. Operator is part of the key: two operators running the
    same number over the same stops are still two services.
    """
    merged = {}
    for pattern in patterns:
        key = (pattern.get('operatorCode'), pattern['lineName'], pattern['direction'],
               tuple(atco for atco, *_ in pattern['stops']))
        kept = merged.get(key)
        if kept is None:
            merged[key] = {**pattern, 'journeys': pattern.get('journeys', 0)}
            continue
        if kept.get('rules') is not None and pattern.get('rules') is not None:
            kept['rules'] = _unique(kept['rules'] + pattern['rules'])
        else:
            kept['rules'] = kept.get('rules') or pattern.get('rules')
        kept['journeys'] += pattern.get('journeys', 0)
        if _declared(pattern['stops']) > _declared(kept['stops']):
            kept['stops'] = pattern['stops']
    return list(merged.values())


def pattern_key(pattern):
    """Stable across rebuilds: the same operator, line, direction and stops keep one id."""
    stops = [atco for atco, *_ in pattern['stops']]
    digest = hashlib.sha256(json.dumps([pattern.get('operatorCode'), pattern['lineName'],
                                        pattern['direction'], stops]).encode()).hexdigest()[:10]
    return f"{pattern.get('operatorCode') or 'NOC'}:{pattern['lineName']}:{pattern['direction'] or '-'}:{digest}"


def load(con, run_id, patterns, stops_in_area):
    ensure_schema(con)
    rows, stop_rows = [], []
    for pattern in patterns:
        codes = [atco for atco, *_ in pattern['stops']]
        inside = sum(1 for atco in codes if atco in stops_in_area)
        pattern_id = pattern_key(pattern)
        pattern['patternId'] = pattern_id
        pattern['stopsInArea'] = inside
        known = all(metres is not None for _, metres, *_ in pattern['stops'])
        rows.append((pattern_id, pattern['datasetSha256'], pattern['sourceFile'],
                     pattern['lineName'], pattern.get('serviceCode'), pattern.get('operatorCode'),
                     pattern['direction'], pattern['destination'], len(codes), inside,
                     pattern['stops'][-1][1] if known else None,
                     pattern.get('validFrom'), pattern.get('validTo'),
                     len(set(codes)) != len(codes), run_id,
                     json.dumps(pattern['rules']) if pattern.get('rules') is not None else None,
                     pattern.get('modified'), pattern.get('revision'),
                     pattern.get('journeys'), known))
        for sequence, stop in enumerate(pattern['stops']):
            # A stop is (atco, metres) from an older caller or (atco, metres, seconds) from the
            # parser; a missing third element is an unknown scheduled time, never zero.
            atco, metres = stop[0], stop[1]
            secs = stop[2] if len(stop) > 2 else None
            stop_rows.append((pattern_id, sequence, atco, metres, secs))
    con.execute('DELETE FROM service_pattern_stop')
    con.execute('DELETE FROM service_pattern')
    con.executemany(
        'INSERT INTO service_pattern (pattern_id, dataset_sha256, source_file, line_name,'
        ' service_code, operator_code, direction, destination_display, stop_count,'
        ' stops_in_area, total_distance_m, valid_from, valid_to, has_repeated_stop,'
        ' first_seen_run_id, first_seen_at, operating_rules, version_modified, version_revision,'
        ' journey_count, distances_known)'
        ' VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, now(),?,?,?,?,?)', rows)
    con.executemany('INSERT INTO service_pattern_stop VALUES (?,?,?,?,?)', stop_rows)
    return len(rows), len(stop_rows)


def supported_lines(con):
    """Lines with at least one pattern that calls inside the collected area."""
    return con.execute(f"""
        SELECT line_name,
               count(*) AS patterns,
               sum(CASE WHEN stops_in_area >= {MIN_STOPS_IN_AREA} THEN 1 ELSE 0 END) AS usable,
               max(stop_count) AS longest,
               count(DISTINCT direction) AS directions
        FROM service_pattern GROUP BY 1 ORDER BY usable DESC, patterns DESC""").fetchall()


def build_published(con, coverage=None):
    ensure_schema(con)
    usable = con.execute(f"""
        SELECT pattern_id, line_name, direction, destination_display, stop_count,
               stops_in_area, total_distance_m, has_repeated_stop, dataset_sha256,
               source_file, valid_from, valid_to, operator_code, service_code, operating_rules,
               version_modified, version_revision, journey_count, distances_known
        FROM service_pattern
        WHERE stops_in_area >= {MIN_STOPS_IN_AREA}
        ORDER BY operator_code, line_name, direction, stop_count DESC""").fetchall()
    stops_by_pattern = {}
    for pattern_id, atco, metres, secs in con.execute(
            'SELECT pattern_id, atco_code, distance_from_start_m, seconds_from_start'
            ' FROM service_pattern_stop ORDER BY pattern_id, sequence').fetchall():
        stops_by_pattern.setdefault(pattern_id, []).append((atco, metres, secs))
    patterns = []
    for row in usable:
        stops = stops_by_pattern.get(row[0], [])
        rules = json.loads(row[14]) if row[14] else None
        patterns.append({
            'id': row[0], 'operator': row[12], 'line': row[1], 'serviceCode': row[13],
            'direction': row[2] or None, 'destination': row[3] or None,
            'stopCount': int(row[4]), 'stopsInArea': int(row[5]),
            'lengthMetres': int(row[6]) if row[6] is not None else None,
            'distancesKnown': bool(row[18]) if row[18] is not None else None,
            'hasRepeatedStop': bool(row[7]),
            'timetable': {'datasetSha256': row[8], 'file': row[9],
                          'validFrom': _iso(row[10]), 'validTo': _iso(row[11]),
                          'modified': row[15], 'revision': row[16]},
            'runs': describe(rules), 'operatingRules': rules,
            'journeys': int(row[17]) if row[17] is not None else None,
            'stops': [s[0] for s in stops],
            'metres': [int(s[1]) if s[1] is not None else None for s in stops],
            # Scheduled seconds from the first stop, from the links' RunTime; null past an
            # undeclared link. A time at a stop is this plus a journey's departure, never a prediction.
            'seconds': [int(s[2]) if s[2] is not None else None for s in stops],
        })
    services = sorted({f"{p['operator'] or ''}|{p['line']}" for p in patterns})
    return {
        'schemaVersion': SCHEMA_VERSION, 'generatedAt': utc_now(),
        'supportedLines': sorted({p['line'] for p in patterns}),
        'supportedServices': services,
        'coverage': coverage,
        'patterns': patterns,
        'rules': {'minimumStopsInArea': MIN_STOPS_IN_AREA, 'minimumStops': MIN_STOPS},
        'attribution': 'Timetable data: Transport for Greater Manchester via the Bus Open Data '
                       'Service, Open Government Licence v3.0.',
        'notes': [
            'A pattern is one ordered list of stops a service calls at. One route label has '
            'several: directions, branches and short workings that call at different stops.',
            'A pattern belongs to one operator and one timetable version, and runs only on the '
            'days its journeys declare. Bank-holiday operation is recorded but not evaluated.',
            'A pattern is published when it calls at a stop inside the collected area, because a '
            'passenger there could board it. Its stops outside the area keep their place in the '
            'order but have no coordinates here, and buses out there are not collected.',
            'A distance of null was not declared by the timetable. It is unknown, not zero.',
            'Holding a pattern is not a claim that a particular bus is running it. That match '
            'is made per observation and is shown with its reason.',
        ],
    }


# A refresh that goes wrong must leave the last good catalogue in place. A build that would
# publish nothing, or a small fraction of what is already published, is refused rather than
# written: a partial timetable download is indistinguishable from a service being withdrawn, and
# the wrong one of those would quietly tell passengers their bus does not run. The published file
# keeps its own generatedAt, so an old catalogue is visibly old rather than silently wrong.
KEEP_FRACTION = 0.5


def shrink_floor(already_published, explicit=False, allow_shrink=False):
    """The fewest patterns a build may publish when a catalogue is already published.

    An explicit build (--lines, --max-lines) is meant to be small, and --allow-shrink says a
    real withdrawal is expected. Otherwise a build that would publish less than half of what is
    already there is refused: the likeliest cause is a timetable download that failed or
    arrived truncated, and publishing it would tell passengers their service does not run.
    """
    if explicit or allow_shrink or not already_published:
        return 1
    return max(1, int(already_published * KEEP_FRACTION))


def _published_now(target):
    """The catalogue already on disk, if it can be read. A corrupt one is treated as absent."""
    try:
        return json.loads(Path(target).read_text())
    except (OSError, ValueError):
        return None


def build(root=ROOT, db_path=None, lines=None, coverage='observed', max_lines=None, log=print,
          today=None, allow_shrink=False):
    root = Path(root)
    today = today or datetime.now(LONDON).date()
    survey = survey_datasets(root / TIMETABLE_DIR, today)
    entries = survey['entries']
    con = connect(db_path or root / DEFAULT_DB)
    try:
        ensure_schema(con)
        stops_in_area = {r[0] for r in con.execute('SELECT atco_code FROM stop').fetchall()}
        observed = {(operator, route): int(count) for operator, route, count in con.execute("""
            SELECT o.operator, o.route, count(*) FROM v_publishable_observation o
            JOIN raw_source r ON r.source_sha256 = o.source_sha256
            WHERE r.source_kind = 'live_positions' AND o.route <> 'Unspecified'
            GROUP BY 1, 2""").fetchall()}
        held = {(entry['operator'], entry['line']) for entry in entries}
        if lines:
            wanted = {line.strip() for line in lines if line.strip()}
            selected, mode = {pair for pair in held if pair[1] in wanted}, 'explicit_lines'
        elif coverage == 'all':
            selected, mode = set(held), 'all_valid_files'
        else:
            # Evidence chooses: services seen running here, operator and line both.
            selected, mode = {pair for pair in held if pair in observed}, 'observed_services'
        if max_lines:
            selected = set(sorted(selected, key=lambda pair: (-observed.get(pair, 0), pair))[:max_lines])
        without = sorted(((op, line, n) for (op, line), n in observed.items() if (op, line) not in held),
                         key=lambda item: (-item[2], item[0], item[1]))

        run_id = start_run(con, 'pattern_build', is_historical=False,
                           note=f'TransXChange service patterns: {mode}, {len(selected)} services')
        collected, files = [], 0
        for entry in entries:
            if (entry['operator'], entry['line']) not in selected:
                continue
            body = gzip.decompress(entry['path'].read_bytes())
            with zipfile.ZipFile(io.BytesIO(body)) as archive:
                xml = archive.read(entry['member'])
            files += 1
            collected.extend(extract_patterns(xml, entry['member'], entry['sha256'],
                                              entry['validFrom'], entry['validTo']))
        distinct = deduplicate(collected)
        loaded, stop_rows = load(con, run_id, distinct, stops_in_area)
        finish_run(con, run_id, 'succeeded')
        summary = {
            'selection': mode, 'date': today.isoformat(), 'cap': max_lines,
            'validityWindow': {'from': today.isoformat(), 'to': survey['horizon'].isoformat()},
            'servicesSelected': len(selected), 'filesParsed': files,
            'datasetsRead': survey['datasetsRead'],
            'snapshotsSuperseded': survey['snapshotsSuperseded'],
            'filesNotValidOnDate': survey['notValidOnDate'],
            'filesExpiredBeforeDate': survey['filesExpired'],
            'filesBeyondHorizon': survey['filesBeyondHorizon'],
            'unrecognisedFileNames': len(survey['unrecognised']),
            'observedServicesWithoutTimetable': len(without),
            'observedServicesWithoutTimetableExamples': [
                {'operator': op, 'line': line, 'observations': n} for op, line, n in without[:20]],
        }
        published = build_published(con, summary)
        target = root / PATTERNS_TARGET
        previous = _published_now(target)
        kept = len(previous['patterns']) if previous and previous.get('patterns') else 0
        floor = shrink_floor(kept, explicit=bool(lines or max_lines), allow_shrink=allow_shrink)
        if kept and len(published['patterns']) < floor:
            finish_run(con, run_id, 'refused', error_class='catalogue_would_shrink',
                       error_detail=f"{len(published['patterns'])} patterns is below the floor "
                                    f'of {floor}')
            log(json.dumps({'refused': 'catalogue_would_shrink',
                            'wouldPublish': len(published['patterns']), 'alreadyPublished': kept,
                            'floor': floor, 'keptGeneratedAt': previous.get('generatedAt'),
                            'note': 'the published catalogue was left unchanged; '
                                    'pass --allow-shrink if the reduction is real'}))
            raise PatternBuildRefused(len(published['patterns']), kept, floor)
        atomic_json(target, published)
        log(json.dumps({**{k: v for k, v in summary.items()
                           if k != 'observedServicesWithoutTimetableExamples'},
                        'datasetsIndexed': len({e['sha256'] for e in entries}),
                        'patternsParsed': len(collected), 'distinctPatterns': loaded,
                        'patternStops': stop_rows, 'publishedPatterns': len(published['patterns']),
                        'publishedServices': len(published['supportedServices'])}))
        return published
    finally:
        con.close()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('command', nargs='?', default='build', choices=['build'])
    parser.add_argument('--coverage', choices=['observed', 'all'], default='observed',
                        help='observed: services seen in live collection (default); '
                             'all: every file valid on the date')
    parser.add_argument('--lines', help='comma-separated line labels; overrides --coverage')
    parser.add_argument('--max-lines', type=int, default=None,
                        help='keep only the N most-observed services (development only; '
                             'recorded in the published coverage summary)')
    parser.add_argument('--date', help='judge timetable validity on this day (YYYY-MM-DD); '
                                       'default today in Europe/London')
    parser.add_argument('--allow-shrink', action='store_true',
                        help='publish even if the new catalogue holds far fewer patterns than the '
                             'one already published (a real withdrawal, not a failed download)')
    args = parser.parse_args(argv)
    day = date.fromisoformat(args.date) if args.date else None
    try:
        build(lines=args.lines.split(',') if args.lines else None, coverage=args.coverage,
              max_lines=args.max_lines, today=day, allow_shrink=args.allow_shrink)
    except PatternBuildRefused as refused:
        print(str(refused), file=sys.stderr)
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main())
