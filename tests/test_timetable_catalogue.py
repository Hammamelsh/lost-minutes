"""How the timetable catalogue chooses what to read, and what it refuses to publish.

Three failures this guards against, each seen on this machine:

* the collector re-downloads the datasets while it runs, so the preserved directory accumulates
  snapshots of the same dataset. Reading all of them counted route 15's journeys twice (280 -> 560
  on 17 September 2026) and would have kept alive a registration the operator had withdrawn;
* a catalogue built on one day was blind to a registration beginning the next, because only files
  valid on the build day were read;
* a truncated or failed download would have replaced a full catalogue with a nearly empty one,
  and the page would have told passengers their service does not run.
"""
from __future__ import annotations

import gzip
import io
import unittest
import zipfile
from datetime import date, timedelta
from pathlib import Path
from tempfile import TemporaryDirectory

from pipeline.patterns import newest_snapshots, shrink_floor, survey_datasets

# Real shape: OPERATOR_LINE_SERVICECODE_START_END_SUFFIX.xml
def name(operator, line, start, end, suffix):
    return f'{operator}_{line}_{operator}PC1_{start:%Y%m%d}_{end:%Y%m%d}_{suffix}.xml'


def dataset(directory, sha, members, mtime=None):
    """One preserved dataset: a gzipped zip named by a content hash, as the collector stores it."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w') as archive:
        for member in members:
            archive.writestr(member, '<TransXChange/>')
    path = Path(directory) / f'{sha}.bin.gz'
    path.write_bytes(gzip.compress(buffer.getvalue()))
    if mtime is not None:
        import os
        os.utime(path, (mtime, mtime))
    return path


class SnapshotTests(unittest.TestCase):
    def test_only_the_newest_snapshot_of_a_dataset_is_read(self):
        today = date(2026, 9, 17)
        later = today + timedelta(days=365)
        with TemporaryDirectory() as directory:
            dataset(directory, 'a' * 8, [name('BNML', '15', today, later, '1'),
                                         name('BNML', '256', today, later, '2')], mtime=1_000_000)
            dataset(directory, 'b' * 8, [name('BNML', '15', today, later, '1'),
                                         name('BNML', '256', today, later, '2')], mtime=2_000_000)
            dataset(directory, 'c' * 8, [name('BNSM', '25', today, later, '3')], mtime=1_500_000)
            snapshots = newest_snapshots(directory)
            self.assertEqual(sorted(snapshots['datasets']), ['BNML', 'BNSM'])
            self.assertTrue(snapshots['datasets']['BNML'].name.startswith('b'))
            self.assertEqual([p[:8] for p in snapshots['supersededOrUnreadable']], ['aaaaaaaa'])
            # Each service file is offered exactly once, so nothing is counted twice.
            entries = survey_datasets(directory, today)['entries']
            self.assertEqual(len(entries), 3)
            self.assertEqual(sorted(e['line'] for e in entries), ['15', '25', '256'])

    def test_a_registration_starting_within_the_horizon_is_read_but_marked_not_in_force(self):
        today = date(2026, 9, 17)
        with TemporaryDirectory() as directory:
            dataset(directory, 'd' * 8, [
                name('BNML', '15', today - timedelta(days=30), today + timedelta(days=3), 'now'),
                name('BNML', '15', today + timedelta(days=4), today + timedelta(days=400), 'next'),
                name('BNML', '15', today + timedelta(days=40), today + timedelta(days=400), 'far'),
                name('BNML', '15', today - timedelta(days=60), today - timedelta(days=1), 'gone'),
            ])
            survey = survey_datasets(directory, today)
            suffixes = {Path(e['member']).name.rsplit('_', 1)[-1]: e['inForce'] for e in survey['entries']}
            self.assertEqual(suffixes, {'now.xml': True, 'next.xml': False})
            self.assertEqual(survey['filesExpired'], 1)
            self.assertEqual(survey['filesBeyondHorizon'], 1)
            self.assertEqual(survey['horizon'], today + timedelta(days=14))


class ShrinkGuardTests(unittest.TestCase):
    def test_a_build_may_not_quietly_replace_a_catalogue_with_a_fraction_of_itself(self):
        self.assertEqual(shrink_floor(400), 200)
        self.assertEqual(shrink_floor(0), 1, 'nothing published yet: any first build is allowed')

    def test_an_explicit_or_approved_build_is_allowed_to_be_small(self):
        self.assertEqual(shrink_floor(400, explicit=True), 1)
        self.assertEqual(shrink_floor(400, allow_shrink=True), 1)


if __name__ == '__main__':
    unittest.main()
