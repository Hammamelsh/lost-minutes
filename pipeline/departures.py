"""Scheduled departure boards, one file per boarding point.

    .venv/bin/python -m pipeline.departures publish

A stop's board is a different capability from matching a vehicle to our motion model, and it is
built from a different thing: the operator's own registered timetable, which we already hold and
parse. For every pattern that calls at a stop, every journey's departure from the pattern's first
stop is carried forward by that journey's declared running time to this stop. That is a scheduled
time, said as one — never a prediction, never adjusted for where a bus is.

What it refuses, rather than filling in:
  - a pattern whose stop has no declared running time (`seconds_from_start` null) publishes no
    time at that stop, because the file did not state one and a zero would be an invention;
  - a departure whose journey carried no operating profile we could read (rule -1) is kept and
    marked, so a board can say it may not run today rather than silently listing or dropping it;
  - a stop a pattern ends at is not a departure from it: nobody boards there.

Times are seconds from that service day's midnight, local. A journey timed past midnight keeps a
value over 86400 rather than wrapping, so "00:12 tomorrow" stays after "23:55 tonight" in order
and can be turned into a real timestamp by the page without guessing which day it meant.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .core import atomic_json, utc_now
from .warehouse import DEFAULT_DB, connect

TARGET = Path('public/data/departures')
# A day's own seconds: a departure at 25:10:00 in the file is 12 minutes past midnight, next day.
SECONDS_IN_DAY = 86_400


def _total(run):
    """The last absolute time in a delta-encoded run: [rule, timing, first, gap, gap, ...]."""
    return sum(run[2:])


def _seconds(text):
    try:
        parts = [int(p) for p in str(text).split(':')]
    except (TypeError, ValueError):
        return None
    if len(parts) < 2:
        return None
    hours, minutes = parts[0], parts[1]
    seconds = parts[2] if len(parts) > 2 else 0
    return hours * 3600 + minutes * 60 + seconds


def boards(con, only=None):
    """Every stop's scheduled departures, keyed by ATCO code.

    `only` keeps the boards to the stops we publish at all (the service area): a pattern runs well
    beyond it, and a board for a stop the page can never show is 40 MB nobody reads.
    """
    patterns = con.execute("""
        SELECT pattern_id, operator_code, line_name, direction, destination_display,
               operating_rules, departure_times, valid_from, valid_to, source_file, dataset_sha256
        FROM service_pattern""").fetchall()
    stops_by_pattern = {}
    for pattern_id, sequence, atco, _metres, seconds in con.execute("""
        SELECT pattern_id, sequence, atco_code, distance_from_start_m, seconds_from_start
        FROM service_pattern_stop ORDER BY pattern_id, sequence""").fetchall():
        stops_by_pattern.setdefault(pattern_id, []).append((sequence, atco, seconds))

    # One operating rule can carry a school calendar of forty date ranges, and the same rule is
    # shared by hundreds of patterns. Written into every service of every board it was 40 of the
    # 48 MB; written once and referenced by index it is a few kilobytes in one file.
    catalogue, index = [], {}

    def shared(rule):
        key = json.dumps(rule, sort_keys=True)
        if key not in index:
            index[key] = len(catalogue)
            catalogue.append(rule)
        return index[key]

    by_stop = {}
    for (pattern_id, operator, line, direction, destination, rules_json, departures_json,
         valid_from, valid_to, source_file, dataset) in patterns:
        stops = stops_by_pattern.get(pattern_id) or []
        if len(stops) < 2:
            continue
        info = json.loads(departures_json) if departures_json else {}
        timings, departures = info.get('timings') or [], info.get('departures') or []
        if not departures:
            continue
        rules = json.loads(rules_json) if rules_json else None
        last_index = stops[-1][0]
        for sequence, atco, own_seconds in stops:
            if sequence == last_index:
                continue                      # a pattern that ends here cannot be boarded here
            if only is not None and atco not in only:
                continue
            # Each journey's own declared running time from the origin to this stop, where the
            # file states one. The board keeps the *origin* departure, not the time at this stop,
            # because the origin departure is what the feed reports (OriginAimedDepartureTime) and
            # so the only thing a tracked vehicle can honestly be joined to a scheduled journey on.
            offsets = []
            for timing_index in range(max(1, len(timings))):
                row = timings[timing_index] if timing_index < len(timings) else []
                value = row[sequence] if sequence < len(row) else None
                offsets.append(own_seconds if value is None else int(value))
            times = []
            for row in departures:
                start = _seconds(row[0])
                if start is None:
                    continue
                timing = row[1] if len(row) > 1 else 0
                rule = row[2] if len(row) > 2 else -1
                if not 0 <= timing < len(offsets) or offsets[timing] is None:
                    continue                  # not declared anywhere: no time is published here
                times.append([start, int(timing), int(rule)])
            if not times:
                continue
            times.sort()
            # Grouped by the rule and timing the journey runs on, and delta-encoded from the first
            # departure in each group: a day's departures at a busy stop go from about 12 bytes
            # each to about 4. A run is [ruleIndex, timingIndex, firstOriginSeconds, gap, gap, …].
            runs = []
            for when, timing, rule in times:
                if runs and runs[-1][0] == rule and runs[-1][1] == timing:
                    runs[-1].append(when - _total(runs[-1]))
                else:
                    runs.append([rule, timing, when])
            by_stop.setdefault(atco, []).append({
                'patternId': pattern_id, 'operator': operator, 'line': line,
                'direction': direction, 'destination': destination, 'sequence': sequence,
                'rules': [shared(rule) for rule in (rules or [])], 'runs': runs,
                'offsets': offsets,
                'timetable': {'file': source_file, 'datasetSha256': dataset,
                              'validFrom': str(valid_from) if valid_from else None,
                              'validTo': str(valid_to) if valid_to else None},
            })
    return by_stop, catalogue


def publish(con, root=Path('.'), target=TARGET):
    directory = Path(root) / target
    directory.mkdir(parents=True, exist_ok=True)
    generated = utc_now()
    written, departures, existing = 0, 0, {p.name for p in directory.glob('*.json')}
    area = {row[0] for row in
            con.execute("SELECT atco_code FROM stop WHERE status = 'active'").fetchall()}
    by_stop, rule_catalogue = boards(con, only=area or None)
    for atco, services in by_stop.items():
        services.sort(key=lambda s: (s['line'], s['direction'], s['destination']))
        departures += sum(len(run) - 2 for s in services for run in s['runs'])
        atomic_json(directory / f'{atco}.json', {
            'schemaVersion': 1, 'stop': atco, 'generatedAt': generated,
            'secondsInDay': SECONDS_IN_DAY,
            'runsFormat': 'Each run is [ruleIndex, timingIndex, firstOriginSecondsFromLocalMidnight, '
                          'gap, gap, …]; add the gaps up for the rest. The scheduled time at this '
                          'stop is that origin departure plus services[].offsets[timingIndex]. '
                          'ruleIndex -1 means the journey carried no operating profile we could read.',
            'basis': 'Scheduled departures from the operators’ registered TransXChange timetables. '
                     'Seconds from local midnight on the service day; a time past 86400 is after '
                     'midnight. Not a prediction and not adjusted for where any bus is.',
            'attribution': 'Timetables: TfGM via the Bus Open Data Service (Open Government Licence v3.0).',
            'services': services})
        existing.discard(f'{atco}.json')
        written += 1
    # A stop that has lost its last service keeps no stale board.
    for stale in existing:
        (directory / stale).unlink(missing_ok=True)
    index = {'schemaVersion': 1, 'generatedAt': generated, 'stops': written,
             'departures': departures, 'removed': len(existing), 'rules': len(rule_catalogue),
             'basis': 'One board per boarding point under public/data/departures/<ATCO>.json. A '
                      'service’s `rules` are indices into public/data/departure-rules.json.'}
    atomic_json(Path(root) / 'public/data/departure-rules.json',
                {'schemaVersion': 1, 'generatedAt': generated, 'rules': rule_catalogue})
    atomic_json(Path(root) / 'public/data/departures.json', index)
    return index


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('command', choices=['publish'])
    parser.add_argument('--db', default=None)
    args = parser.parse_args(argv)
    con = connect(args.db or Path('.') / DEFAULT_DB)
    try:
        print(json.dumps(publish(con)))
    finally:
        con.close()
    return 0


if __name__ == '__main__':
    sys.exit(main())
