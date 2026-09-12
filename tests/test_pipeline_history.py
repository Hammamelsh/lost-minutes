"""Behaviour tests for the persistent pipeline: reruns, restart, conflicts, backfill, failure.

Controlled SIRI-VM fixtures, a fake fetcher and a throwaway warehouse per test. No network.
"""
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

try:
    import duckdb  # noqa: F401
    HAS_DUCKDB = True
except ModuleNotFoundError:
    HAS_DUCKDB = False

from siri_fixtures import bus, snapshot_zip  # noqa: E402


@unittest.skipUnless(HAS_DUCKDB, 'DuckDB not installed; see requirements.txt')
class PipelineHistoryTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix='lost-minutes-test-'))
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)
        (self.root / 'data').mkdir(parents=True)
        (self.root / 'public/data').mkdir(parents=True)
        self.db = self.root / 'data/warehouse/test.duckdb'
        self.bodies = {}

    # -- harness ----------------------------------------------------------------
    def selection(self, names):
        payload = {'base_url': 'https://data.datalibrary.uk/transport/BODS-ARCHIVE/test/',
                   'files': names}
        (self.root / 'data/archive-selection.json').write_text(json.dumps(payload))
        return payload

    def fake_fetch(self, url):
        name = url.rsplit('/', 1)[-1]
        return self.bodies[name], 200, 'application/zip'

    def add_snapshot(self, name, activities):
        self.bodies[name] = snapshot_zip(activities)

    def run_pipeline(self, **kwargs):
        from pipeline.run import run_import
        return run_import(root=self.root, db_path=self.db, fetch_fn=self.fake_fetch,
                          log=lambda *_: None, **kwargs)

    def connect(self):
        from pipeline.warehouse import connect
        return connect(self.db)

    def served(self):
        return json.loads((self.root / 'public/data/replay.json').read_text())

    def operations(self):
        return json.loads((self.root / 'public/data/operations.json').read_text())

    def assert_reconciled(self):
        for item in self.operations()['reconciliation']:
            self.assertTrue(item['balanced'], f"unbalanced: {item['expression']} "
                                              f"{item['left']} != {item['right']}")

    # -- 1. repeated imports ----------------------------------------------------
    def test_repeated_import_does_not_duplicate_analytical_observations(self):
        self.selection(['sirivm-20260911T070001.zip', 'sirivm-20260911T070101.zip'])
        self.add_snapshot('sirivm-20260911T070001.zip', [bus('2026-09-11T07:00:00+00:00')])
        self.add_snapshot('sirivm-20260911T070101.zip', [bus('2026-09-11T07:01:00+00:00',
                                                             lat=53.471)])
        first = self.run_pipeline()
        second = self.run_pipeline()
        self.assertEqual(first['totals']['storedObservations'], 2)
        self.assertEqual(second['totals']['storedObservations'], 2, 'a rerun must add no rows')
        # Per-source facts stay put; the second pass sees only repeats.
        self.assertEqual(second['totals']['activitiesInArea'], 2)
        self.assertEqual(second['totals']['repeatObservations'], 0)
        self.assertEqual(len(self.served()['journeys']), 1)
        self.assert_reconciled()

    # -- 2. interruption and restart -------------------------------------------
    def test_interrupted_run_is_recorded_then_resumed_to_the_same_result(self):
        from pipeline.run import SimulatedCrash
        names = [f'sirivm-20260911T07{m:02d}01.zip' for m in range(4)]
        self.selection(names)
        for index, name in enumerate(names):
            self.add_snapshot(name, [bus(f'2026-09-11T07:0{index}:00+00:00',
                                         lat=53.470 + index / 1000)])
        with self.assertRaises(SimulatedCrash):
            self.run_pipeline(fail_during=3)

        con = self.connect()
        # A killed process leaves the run claimed but unfinished, and publishes nothing.
        self.assertEqual(con.execute("SELECT status FROM pipeline_run").fetchone()[0], 'running')
        self.assertEqual(con.execute('SELECT count(*) FROM observation').fetchone()[0], 2)
        self.assertEqual(con.execute(
            "SELECT count(*) FROM source_processing WHERE outcome = 'pending'").fetchone()[0], 1)
        self.assertEqual(con.execute('SELECT count(*) FROM publication').fetchone()[0], 0)
        con.close()
        self.assertFalse((self.root / 'public/data/replay.json').exists())

        result = self.run_pipeline()
        con = self.connect()
        statuses = dict(con.execute('SELECT status, count(*) FROM pipeline_run GROUP BY 1').fetchall())
        con.close()
        self.assertEqual(statuses, {'interrupted': 1, 'succeeded': 1})
        self.assertEqual(result['resumed'][0]['unfinishedSources'], [names[2]],
                         'the half-finished source must be named, not silently skipped')
        self.assertEqual(result['totals']['storedObservations'], 4, 'restart must finish the work')
        points = [p for j in self.served()['journeys'] for p in j['points']]
        self.assertEqual(len(points), 4)
        self.assert_reconciled()

    # -- 3. conflicts and stationary buses -------------------------------------
    def test_conflicting_coordinates_are_recorded_and_withheld_from_publication(self):
        self.selection(['sirivm-20260911T070001.zip', 'sirivm-20260911T070101.zip'])
        stated = bus('2026-09-11T07:00:00+00:00', lat=53.470, lon=-2.240)
        contradicted = bus('2026-09-11T07:00:00+00:00', lat=53.480, lon=-2.250)
        moved_on = bus('2026-09-11T07:00:30+00:00', lat=53.472, lon=-2.242)
        self.add_snapshot('sirivm-20260911T070001.zip', [stated])
        self.add_snapshot('sirivm-20260911T070101.zip', [contradicted, moved_on])
        result = self.run_pipeline()

        con = self.connect()
        conflict = con.execute('SELECT kind, stored_lat, incoming_lat FROM observation_conflict').fetchall()
        stored = con.execute('SELECT count(*) FROM observation').fetchone()[0]
        publishable = con.execute('SELECT count(*) FROM v_publishable_observation').fetchone()[0]
        con.close()
        self.assertEqual(conflict, [('with_stored', 53.470, 53.480)])
        self.assertEqual(stored, 2, 'the first reading stays stored as evidence')
        self.assertEqual(publishable, 1, 'the disputed identity is withheld, not guessed')
        self.assertEqual(result['totals']['conflictIdentities'], 1)
        # The published file contains the undisputed observation only.
        points = [p for j in self.served()['journeys'] for p in j['points']]
        self.assertEqual([p['recordedAt'] for p in points], ['2026-09-11T07:00:30+00:00'])
        self.assertEqual(self.served()['quality']['conflictingObservations'], 1)
        self.assert_reconciled()

    def test_stationary_bus_with_a_new_timestamp_is_a_new_observation(self):
        self.selection(['sirivm-20260911T070001.zip', 'sirivm-20260911T070101.zip'])
        self.add_snapshot('sirivm-20260911T070001.zip', [bus('2026-09-11T07:00:00+00:00')])
        # Identical coordinates, later timestamp: the bus reported again without moving.
        self.add_snapshot('sirivm-20260911T070101.zip', [bus('2026-09-11T07:01:00+00:00')])
        result = self.run_pipeline()
        self.assertEqual(result['totals']['storedObservations'], 2)
        self.assertEqual(result['totals']['repeatObservations'], 0)
        points = [p for j in self.served()['journeys'] for p in j['points']]
        self.assertEqual(len(points), 2)
        self.assertEqual({(p['lat'], p['lon']) for p in points}, {(53.470, -2.240)})

    # -- 4. late and backfilled data -------------------------------------------
    def test_backfill_adds_history_without_winding_the_served_window_back(self):
        self.selection(['sirivm-20260911T070501.zip', 'sirivm-20260911T070601.zip'])
        self.add_snapshot('sirivm-20260911T070501.zip', [bus('2026-09-11T07:05:00+00:00')])
        self.add_snapshot('sirivm-20260911T070601.zip',
                          [bus('2026-09-11T07:06:00+00:00', lat=53.472)])
        self.run_pipeline()
        before = self.served()
        con = self.connect()
        served_end = con.execute("SELECT window_end_ms FROM publication WHERE status='published'").fetchone()[0]
        con.close()

        # A late-arriving *older* snapshot, imported after the newer one was published.
        self.selection(['sirivm-20260911T070501.zip', 'sirivm-20260911T070601.zip',
                        'sirivm-20260911T070001.zip'])
        self.add_snapshot('sirivm-20260911T070001.zip',
                          [bus('2026-09-11T07:00:00+00:00', lat=53.469, vehicle='V2', journey='J2')])
        self.run_pipeline()
        after = self.served()

        self.assertEqual(after['end'], before['end'], 'the window end must not move backwards')
        self.assertLess(after['start'], before['start'], 'older history extends the window back')
        self.assertGreater(after['quality']['uniqueObservations'],
                           before['quality']['uniqueObservations'])
        con = self.connect()
        rows = con.execute('SELECT status, window_end_ms FROM publication ORDER BY built_at').fetchall()
        con.close()
        self.assertEqual([r[0] for r in rows], ['published', 'published'])
        self.assertTrue(all(r[1] >= served_end for r in rows))
        self.assert_reconciled()

    # -- 5. failed validation ---------------------------------------------------
    def test_failed_validation_leaves_the_previous_publication_serving(self):
        from pipeline.publish import publish
        self.selection(['sirivm-20260911T070001.zip', 'sirivm-20260911T070101.zip'])
        self.add_snapshot('sirivm-20260911T070001.zip', [bus('2026-09-11T07:00:00+00:00')])
        self.add_snapshot('sirivm-20260911T070101.zip',
                          [bus('2026-09-11T07:00:30+00:00', lat=53.471)])
        self.run_pipeline()
        good = self.served()
        target = self.root / 'public/data/replay.json'
        before_bytes = target.read_bytes()

        # A candidate built from a subset of the warehouse: exactly the backfill accident
        # the guard exists for. It must never reach the served file.
        con = self.connect()
        from pipeline.publish import build_snapshot
        partial = build_snapshot(con)
        partial['journeys'][0]['points'] = partial['journeys'][0]['points'][:1]
        partial['quality']['uniqueObservations'] = 1
        result = publish(con, 'run-partial', partial, target, self.root / 'data/published')
        rows = con.execute('SELECT status, failure_reason FROM publication ORDER BY built_at').fetchall()
        failed_checks = con.execute(
            'SELECT check_name FROM validation_check WHERE publication_id = ? AND NOT passed',
            [result['publicationId']]).fetchall()
        con.close()

        self.assertEqual(result['status'], 'failed_validation')
        self.assertIn('built_from_full_warehouse', [c[0] for c in failed_checks])
        self.assertEqual(target.read_bytes(), before_bytes, 'the served file must be untouched')
        self.assertEqual(self.served()['snapshotId'], good['snapshotId'])
        self.assertEqual([r[0] for r in rows], ['published', 'failed_validation'])
        # The rejected candidate is kept for inspection, outside the served path.
        self.assertTrue(Path(result['archivedPath']).name.startswith('rejected-'))

    def test_processing_success_and_publication_success_are_recorded_separately(self):
        self.selection(['sirivm-20260911T070001.zip', 'sirivm-20260911T070101.zip'])
        self.add_snapshot('sirivm-20260911T070001.zip', [bus('2026-09-11T07:00:00+00:00')])
        self.add_snapshot('sirivm-20260911T070101.zip',
                          [bus('2026-09-11T07:01:00+00:00', lat=53.471)])
        self.run_pipeline()
        con = self.connect()
        from pipeline.publish import build_snapshot, publish
        broken = build_snapshot(con)
        broken['journeys'] = []            # a candidate that cannot be published
        broken['quality']['uniqueObservations'] = 0
        publish(con, 'run-broken', broken, self.root / 'public/data/replay.json',
                self.root / 'data/published')
        run_status = con.execute('SELECT status FROM pipeline_run ORDER BY started_at').fetchall()
        pub_status = con.execute('SELECT status FROM publication ORDER BY built_at').fetchall()
        con.close()
        self.assertEqual([r[0] for r in run_status], ['succeeded'])
        self.assertEqual([r[0] for r in pub_status], ['published', 'failed_validation'])
        self.assertEqual(self.served()['quality']['uniqueObservations'], 2)


if __name__ == '__main__':
    unittest.main()
