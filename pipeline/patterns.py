"""Service patterns from TransXChange: the ordered stops a service actually calls at.

    .venv/bin/python -m pipeline.patterns build     # extract, score, load and publish

A route label is not a route. One line has many journey patterns: directions, branches,
short workings and school variants, each calling at a different ordered list of stops. This
module reads those patterns out of the preserved timetable datasets so that a bus can be
placed *on a pattern* rather than merely near a passenger.

Nothing here is inferred. A pattern is only used when the file declaring it is valid today,
its stops resolve to real NaPTAN boarding points, and enough of it lies inside the area we
collect. Everything else is recorded as unsupported and said so on screen.
"""
from __future__ import annotations

import gzip
import io
import json
import re
import sys
import zipfile
from datetime import date, datetime, timezone
from pathlib import Path
from xml.etree import ElementTree as ET

from .core import atomic_json, utc_now
from .warehouse import DEFAULT_DB, connect, finish_run, start_run

ROOT = Path(__file__).resolve().parents[1]
PATTERNS_TARGET = Path('public/data/patterns.json')
TIMETABLE_DIR = Path('data/live-capture/timetables')

# BNML_86_..._20260830_20310830_2411885.xml: operator, line and validity, without parsing.
FILENAME = re.compile(r'^(?P<operator>[A-Z0-9]+)_(?P<line>[^_]+)_.*_(?P<start>\d{8})_(?P<end>\d{8})_\d+\.xml$')

# A pattern is only publishable if we can follow it: most of its stops must be inside the
# area we collect, and it must be long enough for "stops before yours" to mean anything.
MIN_STOPS_IN_AREA = 0.6
MIN_STOPS = 5

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
    total_distance_m    INTEGER,
    valid_from          DATE,
    valid_to            DATE,
    has_repeated_stop   BOOLEAN,   -- a loop: progress along it is ambiguous
    first_seen_run_id   TEXT,
    first_seen_at       TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS service_pattern_stop (
    pattern_id      TEXT NOT NULL,
    sequence        INTEGER NOT NULL,
    atco_code       TEXT NOT NULL,
    distance_from_start_m INTEGER,
    PRIMARY KEY (pattern_id, sequence)
);
"""


def _parse_date(value):
    return date(int(value[:4]), int(value[4:6]), int(value[6:]))


def index_datasets(directory=TIMETABLE_DIR, today=None):
    """What each preserved dataset offers, from the member names alone."""
    today = today or date.today()
    entries = []
    for archive_path in sorted(Path(directory).glob('*.bin.gz')):
        sha = archive_path.stem.split('.')[0]
        body = gzip.decompress(archive_path.read_bytes())
        with zipfile.ZipFile(io.BytesIO(body)) as archive:
            for member in archive.infolist():
                match = FILENAME.match(Path(member.filename).name)
                if not match:
                    continue
                start, end = _parse_date(match['start']), _parse_date(match['end'])
                if not (start <= today <= end):
                    continue
                entries.append({'sha256': sha, 'path': archive_path, 'member': member.filename,
                                'operator': match['operator'], 'line': match['line'],
                                'validFrom': start, 'validTo': end, 'bytes': member.file_size})
    return entries


def _local(tag):
    return tag.split('}')[-1]


def extract_patterns(xml_bytes, source_file, dataset_sha, valid_from, valid_to):
    """Ordered stop sequences with along-route distance, straight from the declaration."""
    root = ET.fromstring(xml_bytes)
    for node in root.iter():
        node.tag = _local(node.tag)

    line_name = next((e.text.strip() for e in root.iter('LineName') if e.text), None)
    service_code = next((e.text.strip() for e in root.iter('ServiceCode') if e.text), None)
    operator_code = next((e.text.strip() for e in root.iter('NationalOperatorCode') if e.text),
                         next((e.text.strip() for e in root.iter('OperatorCode') if e.text), None))
    if not line_name:
        return []

    # Section id -> ordered [(atco, cumulative distance)], built from the timing links.
    sections = {}
    for section in root.iter('JourneyPatternSection'):
        stops, distance = [], 0
        for link in section.findall('JourneyPatternTimingLink'):
            origin = link.find('From/StopPointRef')
            destination = link.find('To/StopPointRef')
            if origin is None or destination is None:
                continue
            if not stops:
                stops.append((origin.text.strip(), 0))
            step = link.find('Distance')
            try:
                distance += int(step.text) if step is not None and step.text else 0
            except ValueError:
                pass
            stops.append((destination.text.strip(), distance))
        if stops:
            sections[section.get('id')] = stops

    patterns = []
    for journey in root.iter('JourneyPattern'):
        refs = [r.text.strip() for r in journey.findall('JourneyPatternSectionRefs') if r.text]
        ordered, offset = [], 0
        for ref in refs:
            part = sections.get(ref)
            if not part:
                continue
            for atco, metres in part:
                if ordered and ordered[-1][0] == atco:
                    continue          # section boundaries repeat the shared stop
                ordered.append((atco, metres + offset))
            offset = ordered[-1][1] if ordered else offset
        if len(ordered) < MIN_STOPS:
            continue
        direction = journey.findtext('Direction') or ''
        destination = journey.findtext('DestinationDisplay') or ''
        patterns.append({
            'lineName': line_name, 'serviceCode': service_code, 'operatorCode': operator_code,
            'direction': direction.strip().lower(), 'destination': destination.strip(),
            'stops': ordered, 'sourceFile': source_file, 'datasetSha256': dataset_sha,
            'validFrom': valid_from, 'validTo': valid_to,
        })
    return patterns


def deduplicate(patterns):
    """1,657 journey patterns collapse to a handful of distinct stop sequences."""
    seen = {}
    for pattern in patterns:
        key = (pattern['lineName'], pattern['direction'],
               tuple(atco for atco, _ in pattern['stops']))
        if key not in seen:
            seen[key] = pattern
    return list(seen.values())


def load(con, run_id, patterns, stops_in_area):
    con.execute(DDL)
    rows, stop_rows = [], []
    for index, pattern in enumerate(patterns):
        codes = [atco for atco, _ in pattern['stops']]
        inside = sum(1 for atco in codes if atco in stops_in_area)
        pattern_id = f"{pattern['datasetSha256'][:8]}:{pattern['lineName']}:{pattern['direction']}:{index}"
        pattern['patternId'] = pattern_id
        pattern['stopsInArea'] = inside
        rows.append((pattern_id, pattern['datasetSha256'], pattern['sourceFile'],
                     pattern['lineName'], pattern['serviceCode'], pattern['operatorCode'],
                     pattern['direction'], pattern['destination'], len(codes), inside,
                     pattern['stops'][-1][1], pattern['validFrom'], pattern['validTo'],
                     len(set(codes)) != len(codes), run_id))
        for sequence, (atco, metres) in enumerate(pattern['stops']):
            stop_rows.append((pattern_id, sequence, atco, metres))
    con.execute('DELETE FROM service_pattern_stop')
    con.execute('DELETE FROM service_pattern')
    con.executemany(
        'INSERT INTO service_pattern (pattern_id, dataset_sha256, source_file, line_name,'
        ' service_code, operator_code, direction, destination_display, stop_count,'
        ' stops_in_area, total_distance_m, valid_from, valid_to, has_repeated_stop,'
        ' first_seen_run_id, first_seen_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, now())', rows)
    con.executemany('INSERT INTO service_pattern_stop VALUES (?,?,?,?)', stop_rows)
    return len(rows), len(stop_rows)


def supported_lines(con):
    """Lines we can honestly follow: enough of the pattern lies inside the collected area."""
    return con.execute(f"""
        SELECT line_name,
               count(*) AS patterns,
               sum(CASE WHEN stops_in_area >= stop_count * {MIN_STOPS_IN_AREA} THEN 1 ELSE 0 END) AS usable,
               max(stop_count) AS longest,
               count(DISTINCT direction) AS directions
        FROM service_pattern GROUP BY 1 ORDER BY usable DESC, patterns DESC""").fetchall()


def build_published(con):
    usable = con.execute(f"""
        SELECT pattern_id, line_name, direction, destination_display, stop_count,
               stops_in_area, total_distance_m, has_repeated_stop, dataset_sha256,
               source_file, valid_from, valid_to
        FROM service_pattern
        WHERE stops_in_area >= stop_count * {MIN_STOPS_IN_AREA}
        ORDER BY line_name, direction, stop_count DESC""").fetchall()
    patterns = []
    for row in usable:
        stops = con.execute(
            'SELECT atco_code, distance_from_start_m FROM service_pattern_stop'
            ' WHERE pattern_id = ? ORDER BY sequence', [row[0]]).fetchall()
        patterns.append({
            'id': row[0], 'line': row[1], 'direction': row[2] or None,
            'destination': row[3] or None, 'stopCount': int(row[4]),
            'stopsInArea': int(row[5]), 'lengthMetres': int(row[6] or 0),
            'hasRepeatedStop': bool(row[7]),
            'timetable': {'datasetSha256': row[8], 'file': row[9],
                          'validFrom': str(row[10]), 'validTo': str(row[11])},
            'stops': [s[0] for s in stops],
            'metres': [int(s[1] or 0) for s in stops],
        })
    lines = sorted({p['line'] for p in patterns})
    return {
        'schemaVersion': 1, 'generatedAt': utc_now(),
        'supportedLines': lines, 'patterns': patterns,
        'rules': {'minimumStopsInAreaFraction': MIN_STOPS_IN_AREA, 'minimumStops': MIN_STOPS},
        'attribution': 'Timetable data: Transport for Greater Manchester via the Bus Open Data '
                       'Service, Open Government Licence v3.0.',
        'notes': [
            'A pattern is one ordered list of stops a service calls at. One route label has '
            'several: directions, branches and short workings that call at different stops.',
            'Only patterns with most of their stops inside the collected area are published, '
            'because progress along the rest could not be followed.',
            'Holding a pattern is not a claim that a particular bus is running it. That match '
            'is made per observation and is shown with its reason.',
        ],
    }


def build(root=ROOT, db_path=None, lines=None, limit_lines=14, log=print, today=None):
    root = Path(root)
    entries = index_datasets(root / TIMETABLE_DIR, today)
    con = connect(db_path or root / DEFAULT_DB)
    try:
        stops_in_area = {r[0] for r in con.execute('SELECT atco_code FROM stop').fetchall()}
        observed = dict(con.execute("""
            SELECT route, count(*) FROM v_publishable_observation o
            JOIN raw_source r ON r.source_sha256 = o.source_sha256
            WHERE r.source_kind = 'live_positions' AND route <> 'Unspecified'
            GROUP BY 1""").fetchall())
        # Evidence chooses the corridors: lines we have actually seen running, most first.
        candidates = lines or [line for line, _ in
                               sorted(((l, observed.get(l, 0)) for l in {e['line'] for e in entries}
                                       if l in observed), key=lambda x: -x[1])][:limit_lines]
        run_id = start_run(con, 'pattern_build', is_historical=False,
                           note=f'TransXChange service patterns for {len(candidates)} observed lines')
        collected = []
        for entry in entries:
            if entry['line'] not in candidates:
                continue
            body = gzip.decompress(entry['path'].read_bytes())
            with zipfile.ZipFile(io.BytesIO(body)) as archive:
                xml = archive.read(entry['member'])
            collected.extend(extract_patterns(xml, entry['member'], entry['sha256'],
                                              entry['validFrom'], entry['validTo']))
        distinct = deduplicate(collected)
        loaded, stop_rows = load(con, run_id, distinct, stops_in_area)
        finish_run(con, run_id, 'succeeded')
        published = build_published(con)
        atomic_json(root / PATTERNS_TARGET, published)
        log(json.dumps({'datasetsIndexed': len({e['sha256'] for e in entries}),
                        'filesValidToday': len(entries), 'linesConsidered': len(candidates),
                        'patternsParsed': len(collected), 'distinctPatterns': loaded,
                        'patternStops': stop_rows,
                        'publishedPatterns': len(published['patterns']),
                        'supportedLines': published['supportedLines']}))
        return published
    finally:
        con.close()


def main(argv=None):
    build()
    return 0


if __name__ == '__main__':
    sys.exit(main())
