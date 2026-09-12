"""Bounded live collector for one shared Manchester feed. One writer, never overlapping.

    .venv/bin/python -m pipeline.collect --minutes 10
    .venv/bin/python -m pipeline.collect --minutes 10 --timetable-url 'https://…'

Phones never contact BODS. This process is the only consumer of the upstream feed; it
publishes a small state object that every device refreshes instead.

Requires BODS_API_KEY in the environment. The key is never logged, never written to the
warehouse and never placed in a published file: `redact_url` strips credential parameters
from anything recorded.
"""
from __future__ import annotations

import argparse
import fcntl
import gzip
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode, urlsplit

from .capture import fetch
from .core import parse_source, redact_url
from .env import load_env
from .freshness import POLL_DEFAULT, POLL_MINIMUM
from .live import publish_live
from .warehouse import (DEFAULT_DB, claim_source, connect, finish_run, load_observations,
                        record_cycle, record_raw_source, record_timetable, start_run)

ROOT = Path(__file__).resolve().parents[1]
FEED_URL = 'https://data.bus-data.dft.gov.uk/api/v1/datafeed/'
MANCHESTER_BBOX = '-2.30,53.42,-2.18,53.51'
LOCK_PATH = Path('data/warehouse/collector.lock')
LIVE_KIND = 'live_positions'
MAX_BACKOFF = 300
TIMETABLE_EVERY = 3600


class CollectorBusy(RuntimeError):
    """Another collector already holds the writer lock."""


class SingleWriter:
    """An advisory file lock. A second collector refuses to start rather than interleave."""

    def __init__(self, path=LOCK_PATH):
        self.path = Path(path)
        self.handle = None

    def __enter__(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.handle = open(self.path, 'w')
        try:
            fcntl.flock(self.handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            self.handle.close()
            self.handle = None
            raise CollectorBusy(
                f'Another collector holds {self.path}. Only one writer may run at a time.'
            ) from error
        self.handle.write(f'{os.getpid()} {datetime.now(timezone.utc).isoformat()}\n')
        self.handle.flush()
        return self

    def __exit__(self, *_):
        if self.handle:
            fcntl.flock(self.handle, fcntl.LOCK_UN)
            self.handle.close()
            self.handle = None
        return False


def store_payload(body, directory, kind):
    """Content-addressed, gzipped, outside Git. Identical payloads are stored once."""
    digest = hashlib.sha256(body).hexdigest()
    target = Path(directory) / kind / f'{digest}.bin.gz'
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        temp = target.with_suffix('.part')
        temp.write_bytes(gzip.compress(body, mtime=0))
        os.replace(temp, target)
    return digest, target


def timetable_dates(body):
    """Effective dates declared by a TransXChange file, where present.

    Absent values stay absent. Holding a timetable is not evidence that any journey in the
    position feed has been matched to it.
    """
    head = body[:400_000]
    if head[:2] == b'PK':  # a zipped dataset; the members are not opened here
        return {}
    text = head.decode('utf-8', 'replace')
    found = {}
    for key, pattern in (('effective_from', r'<StartDate>\s*([0-9]{4}-[0-9]{2}-[0-9]{2})'),
                         ('effective_to', r'<EndDate>\s*([0-9]{4}-[0-9]{2}-[0-9]{2})'),
                         ('modification_datetime', r'ModificationDateTime="([^"]{1,40})"')):
        match = re.search(pattern, text)
        if match:
            found[key] = match.group(1)
    return found


def collect_timetables(con, run_id, urls, directory, log):
    for url in urls:
        try:
            body, status, _ = fetch(url)
        except Exception as error:  # never log the URL: it may carry a credential
            log({'timetable': 'failed', 'errorClass': type(error).__name__})
            continue
        digest, path = store_payload(body, directory, 'timetables')
        record_timetable(con, run_id, content_sha256=digest, source_url=url,
                         stored_path=str(path), byte_size=len(body),
                         retrieved_at=datetime.now(timezone.utc),
                         dataset_label=Path(urlsplit(url).path).name or None,
                         **timetable_dates(body))
        log({'timetable': 'stored', 'sha256': digest[:12], 'bytes': len(body), 'status': status})


def collect(minutes=10.0, interval=POLL_DEFAULT, bbox=MANCHESTER_BBOX, timetable_urls=(),
            root=ROOT, db_path=None, fetch_fn=fetch, clock=time.monotonic, sleep=time.sleep,
            log=print, api_key=None, publish=True):
    """Poll the feed for a bounded window, recording every cycle and its outcome."""
    root = Path(root)
    key = api_key if api_key is not None else os.environ.get('BODS_API_KEY')
    if not key:
        raise SystemExit(
            'BODS_API_KEY is not set. Put it in the environment or in a local .env file '
            '(see README); never paste it into a command, a source file or a log.')
    if interval < POLL_MINIMUM:
        raise SystemExit(f'Interval must be at least {POLL_MINIMUM}s: operators publish '
                         'every 10-30s, so a faster poll only repeats a payload.')
    url = FEED_URL + '?' + urlencode({'api_key': key, 'boundingBox': bbox})
    live_dir = root / 'data/live-capture'

    con = connect(db_path or root / DEFAULT_DB)
    run_id = start_run(con, 'live_capture', is_historical=False,
                       note=f'bounded live collection, bbox {bbox}, interval {interval}s')
    deadline = clock() + minutes * 60
    cycle = failures = 0
    previous_digest = None
    last_timetable = None
    summary = {'cycles': 0, 'changed': 0, 'repeats': 0, 'failures': 0, 'loaded': 0}
    try:
        while clock() < deadline:
            started = clock()
            cycle += 1
            requested_at = datetime.now(timezone.utc)
            if timetable_urls and (last_timetable is None or started - last_timetable >= TIMETABLE_EVERY):
                collect_timetables(con, run_id, timetable_urls, live_dir, log)
                last_timetable = started

            try:
                body, status, _ = fetch_fn(url)
            except urllib.error.HTTPError as error:
                failures += 1
                record_cycle(con, run_id, cycle, requested_at, 'http_error',
                             http_status=error.code, error_class='HTTPError',
                             error_detail=f'HTTP {error.code}')
                log({'cycle': cycle, 'outcome': 'http_error', 'status': error.code,
                     'failureStreak': failures})
                if error.code in (401, 403):
                    finish_run(con, run_id, 'failed', 'AuthorizationRejected',
                               f'HTTP {error.code} from the feed')
                    raise SystemExit('BODS rejected the credentials; collection stopped.')
            except Exception as error:
                failures += 1
                record_cycle(con, run_id, cycle, requested_at, 'transport_error',
                             error_class=type(error).__name__, error_detail=type(error).__name__)
                log({'cycle': cycle, 'outcome': 'transport_error',
                     'errorClass': type(error).__name__, 'failureStreak': failures})
            else:
                failures = 0
                digest, path = store_payload(body, live_dir, 'positions')
                changed = digest != previous_digest
                summary['cycles'] += 1
                if not changed:
                    # The upstream feed republished the same bytes. This is a successful
                    # request that contains no new information, and must never be allowed
                    # to make the data on screen look newer than it is.
                    summary['repeats'] += 1
                    record_cycle(con, run_id, cycle, requested_at, 'repeat_payload',
                                 http_status=status, source_sha256=digest,
                                 byte_size=len(body), payload_changed=False)
                    log({'cycle': cycle, 'outcome': 'repeat_payload', 'sha256': digest[:12]})
                else:
                    try:
                        records, rejected, stats = parse_source(
                            body, digest, requested_at.isoformat())
                    except Exception as error:
                        record_cycle(con, run_id, cycle, requested_at, 'malformed',
                                     http_status=status, source_sha256=digest,
                                     byte_size=len(body), payload_changed=True,
                                     error_class=type(error).__name__, error_detail=error)
                        log({'cycle': cycle, 'outcome': 'malformed',
                             'errorClass': type(error).__name__})
                    else:
                        claim_source(con, run_id, digest, path.name, False)
                        record_raw_source(con, run_id, sha256=digest, kind=LIVE_KIND,
                                          url=url, stored_path=path.relative_to(root),
                                          byte_size=len(body), captured_at=requested_at,
                                          retrieved_at=requested_at)
                        counts = load_observations(con, run_id, digest, records, rejected,
                                                   stats['activitiesTotal'],
                                                   stats['outsideArea'],
                                                   stats.get('quarantined', ()))
                        previous_digest = digest
                        summary['changed'] += 1
                        summary['loaded'] += counts['new']
                        record_cycle(con, run_id, cycle, requested_at, 'succeeded',
                                     http_status=status, source_sha256=digest,
                                     byte_size=len(body), payload_changed=True,
                                     observations_loaded=counts['new'])
                        log({'cycle': cycle, 'outcome': 'succeeded', 'sha256': digest[:12],
                             'inArea': counts['inArea'], 'new': counts['new'],
                             'repeats': counts['repeats'], 'conflicts': counts['conflicts'],
                             'quarantined': counts['rejected']})
            summary['failures'] = failures
            if publish:
                publish_live(con, run_id, root=root)
            # Bounded exponential backoff on consecutive failures, then back to normal.
            wait = min(interval * 2 ** min(failures, 4), MAX_BACKOFF)
            remaining = deadline - clock()
            if remaining <= 0:
                break
            sleep(max(0, min(remaining, wait - (clock() - started))))
        finish_run(con, run_id, 'succeeded')
        if publish:
            publish_live(con, run_id, root=root)
        return {'runId': run_id, **summary}
    except SystemExit:
        raise
    except BaseException as error:
        finish_run(con, run_id, 'failed', type(error).__name__, str(error))
        raise
    finally:
        con.close()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--minutes', type=float, default=10)
    parser.add_argument('--interval', type=float, default=POLL_DEFAULT,
                        help=f'seconds between requests (minimum {POLL_MINIMUM})')
    parser.add_argument('--bbox', default=MANCHESTER_BBOX, help='west,south,east,north')
    parser.add_argument('--timetable-url', action='append', default=[],
                        help='official timetable download URL; may be repeated')
    args = parser.parse_args(argv)
    # A local .env is read before anything else so the key never reaches the command line.
    load_env(ROOT / '.env')
    if not 0 < args.minutes <= 1440:
        parser.error('Use a positive duration up to 1440 minutes')
    try:
        west, south, east, north = [float(v) for v in args.bbox.split(',')]
        assert -180 <= west < east <= 180 and -90 <= south < north <= 90
    except (ValueError, AssertionError):
        parser.error('bbox must be west,south,east,north')
    for url in args.timetable_url:
        parts = urlsplit(url)
        if parts.scheme != 'https' or not parts.hostname or parts.username or parts.password:
            parser.error('Timetable URLs must be HTTPS without embedded credentials')
    try:
        with SingleWriter():
            result = collect(minutes=args.minutes, interval=args.interval, bbox=args.bbox,
                             timetable_urls=args.timetable_url)
    except CollectorBusy as error:
        print(json.dumps({'error': 'collector_busy', 'detail': str(error)}))
        return 2
    print(json.dumps(result, indent=2))
    return 0


if __name__ == '__main__':
    sys.exit(main())
