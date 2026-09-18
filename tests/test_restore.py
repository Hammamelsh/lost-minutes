"""Reading preserved captures back into a warehouse.

`deploy/backup.sh` copies the raw position captures because the feed has no history: a day of them
lost is lost. Until 18 September 2026 nothing could read them back, so the copy was files with no
door. These checks cover the three things that make a restore trustworthy rather than hopeful:
damage is detected, a missing time is refused rather than invented, and restoring twice cannot
double the history.
"""
from __future__ import annotations

import gzip
import hashlib
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

try:
    import duckdb  # noqa: F401
    HAS_DUCKDB = True
except ModuleNotFoundError:
    HAS_DUCKDB = False

from pipeline.restore import response_timestamp, restore  # noqa: E402
from tests.siri_fixtures import bus, siri_document  # noqa: E402

STAMPED = ('<?xml version="1.0" encoding="UTF-8"?>\n'
           '<Siri xmlns="http://www.siri.org.uk/siri" version="2.0"><ServiceDelivery>'
           '<ResponseTimestamp>2026-09-14T09:47:57.743+00:00</ResponseTimestamp>'
           '<VehicleMonitoringDelivery>{activities}</VehicleMonitoringDelivery>'
           '</ServiceDelivery></Siri>')


def capture(directory, body):
    """Store bytes the way the collector does: gzipped, named by their own SHA-256."""
    digest = hashlib.sha256(body).hexdigest()
    path = Path(directory) / f'{digest}.bin.gz'
    path.write_bytes(gzip.compress(body, mtime=0))
    return digest, path


def stamped_capture(directory, **kwargs):
    return capture(directory, STAMPED.format(
        activities=bus('2026-09-14T09:47:50+00:00', **kwargs)).encode())


class TimestampTests(unittest.TestCase):
    def test_the_producers_own_response_time_is_read_from_the_head(self):
        self.assertEqual(response_timestamp(STAMPED.format(activities='').encode()),
                         '2026-09-14T09:47:57.743+00:00')

    def test_a_payload_without_one_yields_nothing_to_invent_from(self):
        self.assertIsNone(response_timestamp(siri_document(bus("2026-09-14T09:47:50+00:00"))))


@unittest.skipUnless(HAS_DUCKDB, 'the warehouse needs DuckDB')
class RestoreTests(unittest.TestCase):
    def test_a_copied_capture_brings_its_observations_back(self):
        with TemporaryDirectory() as copy, TemporaryDirectory() as home:
            stamped_capture(copy, vehicle='V1')
            stamped_capture(copy, vehicle='V2')
            summary = restore(captures=copy, db_path=Path(home) / 'w.duckdb', log=lambda *_: None)
            self.assertEqual(summary['captures'], 2)
            self.assertEqual(summary['loaded'], 2)
            self.assertEqual(summary['corrupt'], 0)
            self.assertGreater(summary['observationsNew'], 0)

    def test_restoring_the_same_copy_twice_doubles_nothing(self):
        with TemporaryDirectory() as copy, TemporaryDirectory() as home:
            stamped_capture(copy, vehicle='V1')
            db = Path(home) / 'w.duckdb'
            first = restore(captures=copy, db_path=db, log=lambda *_: None)
            again = restore(captures=copy, db_path=db, log=lambda *_: None)
            self.assertGreater(first['observationsNew'], 0)
            self.assertEqual(again['observationsNew'], 0)
            self.assertEqual(again['observationsRepeat'], first['observationsNew'] + first['observationsRepeat'])

    def test_a_damaged_copy_is_detected_and_never_loaded(self):
        with TemporaryDirectory() as copy, TemporaryDirectory() as home:
            _, path = stamped_capture(copy, vehicle='V1')
            # One byte changed in transit: the file no longer matches the name it is stored under.
            body = bytearray(gzip.decompress(path.read_bytes()))
            body[-40] = body[-40] ^ 0x20
            path.write_bytes(gzip.compress(bytes(body), mtime=0))
            summary = restore(captures=copy, db_path=Path(home) / 'w.duckdb', log=lambda *_: None)
            self.assertEqual(summary['corrupt'], 1)
            self.assertEqual(summary['loaded'], 0)
            self.assertEqual(summary['observationsNew'], 0)

    def test_a_capture_with_no_stated_time_is_refused_rather_than_dated_by_guess(self):
        with TemporaryDirectory() as copy, TemporaryDirectory() as home:
            capture(copy, siri_document(bus("2026-09-14T09:47:50+00:00")))
            summary = restore(captures=copy, db_path=Path(home) / 'w.duckdb', log=lambda *_: None)
            self.assertEqual(summary['undated'], 1)
            self.assertEqual(summary['loaded'], 0)


if __name__ == '__main__':
    unittest.main()
