"""Bounded BODS collector. Run: python -m pipeline.capture --help."""
import argparse
import gzip
import hashlib
import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlencode, urlsplit
from .core import atomic_json, redact_url, utc_now

MAX_RESPONSE = 40_000_000


def fetch(url):
    request = urllib.request.Request(url, headers={'User-Agent': 'LostMinutes/0.1 (bounded public-data research)'})
    with urllib.request.urlopen(request, timeout=30) as response:
        body = response.read(MAX_RESPONSE + 1)
        if len(body) > MAX_RESPONSE:
            raise ValueError('Response exceeds capture limit')
        return body, response.status, response.headers.get('Content-Type', '')


def capture_source(url, directory, kind):
    started = utc_now()
    record = {'retrievedAt': started, 'url': redact_url(url), 'kind': kind}
    try:
        body, status, content_type = fetch(url)
        digest = hashlib.sha256(body).hexdigest()
        target = directory / kind / (digest + '.bin.gz')
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists():
            temp = target.with_suffix('.tmp')
            temp.write_bytes(gzip.compress(body, mtime=0))
            os.replace(temp, target)
        record.update(status=status, bytes=len(body), sha256=digest,
                      contentType=content_type, file=str(target), acceptedTransport=True)
    except urllib.error.HTTPError as error:
        record.update(status=error.code, acceptedTransport=False, error='HTTP error')
    except Exception as error:
        # Exceptions can contain a credential-bearing request URL. Never log them.
        record.update(acceptedTransport=False, error=type(error).__name__)
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / 'capture-log.jsonl').open('a') as log:
        log.write(json.dumps(record) + '\n')
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--minutes', type=float, default=10)
    parser.add_argument('--interval', type=float, default=20)
    parser.add_argument('--bbox', default='-2.30,53.42,-2.18,53.51')
    parser.add_argument('--timetable-url', action='append', required=True,
                        help='Relevant official timetable download URL; may be repeated')
    parser.add_argument('--output', type=Path, default=Path('data/live-capture'))
    args = parser.parse_args()
    if not 0 < args.minutes <= 1440 or args.interval < 20:
        parser.error('Use a positive duration up to 1440 minutes and an interval >=20 seconds')
    try:
        west, south, east, north = [float(v) for v in args.bbox.split(',')]
        assert -180 <= west < east <= 180 and -90 <= south < north <= 90
    except (ValueError, AssertionError):
        parser.error('bbox must be west,south,east,north')
    key = os.environ.get('BODS_API_KEY')
    if not key:
        parser.error('Set BODS_API_KEY in your environment; do not paste it into source code')
    for url in args.timetable_url:
        p = urlsplit(url)
        if p.scheme != 'https' or not p.hostname or p.username or p.password:
            parser.error('Timetable URLs must be HTTPS without embedded credentials')
    query = urlencode({'api_key': key, 'boundingBox': args.bbox})
    url = 'https://data.bus-data.dft.gov.uk/api/v1/datafeed/?' + query
    last_schedule = 0.0
    deadline = time.monotonic() + args.minutes * 60
    failures = 0
    while time.monotonic() < deadline:
        tick = time.monotonic()
        if tick - last_schedule >= 3600:
            for schedule in args.timetable_url:
                status = capture_source(schedule, args.output, 'timetables')
                print(json.dumps({'kind': 'timetable', 'saved': status['acceptedTransport']}), flush=True)
            last_schedule = tick
        result = capture_source(url, args.output, 'positions')
        failures = 0 if result['acceptedTransport'] else failures + 1
        print(json.dumps({'kind': 'positions', 'saved': result['acceptedTransport'],
                          'bytes': result.get('bytes'), 'failureStreak': failures}), flush=True)
        if result.get('status') in (401, 403):
            raise SystemExit('BODS access rejected; capture stopped. Check account/API access.')
        interval = min(args.interval * 2 ** min(failures, 4), 300)
        time.sleep(max(0, min(deadline - time.monotonic(), interval - (time.monotonic() - tick))))


if __name__ == '__main__':
    main()
