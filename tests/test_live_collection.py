"""Behaviour tests for live collection and the published live state.

No network. The feed is replaced by a scripted fake so failures can be exercised exactly:
repeated payloads, out-of-order reports, clock skew, expiry, malformed bodies, upstream
errors, rejected credentials, overlapping writers and interrupted collection.
"""
import io
import json
import os
import shutil
import sys
import tempfile
import unittest
import urllib.error
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from siri_fixtures import bus, siri_document  # noqa: E402

try:
    import duckdb  # noqa: F401
    HAS_DUCKDB = True
except ModuleNotFoundError:
    HAS_DUCKDB = False

# Ages are measured against the real clock at publication, so fixtures are relative to it.
NOW = datetime.now(timezone.utc).replace(microsecond=0)
ARCHIVE = Path(__file__).resolve().parents[1] / 'data/raw'
ARCHIVE_FILES = sorted(ARCHIVE.glob('sirivm-*.zip')) if ARCHIVE.exists() else []


def at(offset_seconds):
    return (NOW + timedelta(seconds=offset_seconds)).strftime('%Y-%m-%dT%H:%M:%S+00:00')


class FakeFeed:
    """Returns the next scripted response per request; an item may be an exception."""

    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = 0
        self.urls = []

    def __call__(self, url):
        self.urls.append(url)
        item = self.responses[min(self.calls, len(self.responses) - 1)]
        self.calls += 1
        if isinstance(item, Exception):
            raise item
        return item, 200, 'application/xml'


@unittest.skipUnless(HAS_DUCKDB, 'DuckDB not installed; see requirements.txt')
class LiveCollectionTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix='lost-minutes-live-'))
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)
        (self.root / 'public/data').mkdir(parents=True)
        self.db = self.root / 'data/warehouse/test.duckdb'
        self.ticks = [0.0]

    # -- harness ----------------------------------------------------------------
    def clock(self):
        return self.ticks[-1]

    def sleep(self, seconds):
        self.ticks.append(self.ticks[-1] + max(seconds, 1))

    def run_collector(self, responses, cycles=2, interval=20, **kwargs):
        from pipeline.collect import collect
        feed = FakeFeed(responses)
        # The fake clock advances only when the collector sleeps, so the window ends after
        # exactly the number of cycles we intend.
        self.ticks = [0.0]
        log = kwargs.pop('log', lambda *_: None)
        result = collect(minutes=(cycles * interval) / 60.0, interval=interval,
                         root=self.root, db_path=self.db, fetch_fn=feed,
                         clock=self.clock, sleep=self.sleep, log=log,
                         api_key='test-key-never-real', **kwargs)
        return result, feed

    def connect(self):
        from pipeline.warehouse import connect
        return connect(self.db)

    def live(self):
        return json.loads((self.root / 'public/data/live.json').read_text())

    # -- repeated payloads ------------------------------------------------------
    def test_a_repeated_payload_is_not_new_information(self):
        payload = siri_document([bus(at(-30))])
        result, feed = self.run_collector([payload, payload], cycles=2)
        self.assertEqual(feed.calls, 2)
        self.assertEqual((result['changed'], result['repeats']), (1, 1))
        con = self.connect()
        outcomes = dict(con.execute(
            'SELECT outcome, count(*) FROM collection_cycle GROUP BY 1').fetchall())
        stored = con.execute('SELECT count(*) FROM observation').fetchone()[0]
        changed_at = con.execute(
            'SELECT max(completed_at) FROM collection_cycle WHERE payload_changed').fetchone()[0]
        repeat_at = con.execute(
            "SELECT max(completed_at) FROM collection_cycle WHERE outcome='repeat_payload'").fetchone()[0]
        con.close()
        self.assertEqual(outcomes, {'succeeded': 1, 'repeat_payload': 1})
        self.assertEqual(stored, 1, 'a repeated payload must add no observation')
        self.assertLess(changed_at, repeat_at,
                        'the later request must not become the payload change time')
        live = self.live()
        self.assertEqual(live['collection']['repeatPayloads'], 1)
        self.assertEqual(live['collection']['lastPayloadChangeAt'][:19],
                         changed_at.astimezone(timezone.utc).isoformat()[:19])
        self.assertNotEqual(live['collection']['lastPayloadChangeAt'],
                            live['collection']['lastSuccessAt'],
                            'freshness must come from the data, not from the request')

    # -- out-of-order reports ---------------------------------------------------
    def test_an_older_report_arriving_later_does_not_move_the_bus_back(self):
        newer = siri_document([bus(at(-20), lat=53.4750)])
        older = siri_document([bus(at(-90), lat=53.4700)])
        self.run_collector([newer, older], cycles=2)
        live = self.live()
        self.assertEqual(len(live['vehicles']), 1)
        vehicle = live['vehicles'][0]
        self.assertEqual(vehicle['lat'], 53.4750, 'the newest observation must win')
        self.assertEqual(vehicle['recordedAt'], at(-20))
        con = self.connect()
        self.assertEqual(con.execute('SELECT count(*) FROM observation').fetchone()[0], 2,
                         'both reports are retained, only the newest is published')
        con.close()

    # -- clock skew and expiry --------------------------------------------------
    def test_a_position_from_the_future_is_quarantined_with_its_reason(self):
        self.run_collector([siri_document([bus(at(600), vehicle='FUTURE'),
                                           bus(at(-20), vehicle='OK')])], cycles=1)
        con = self.connect()
        rows = con.execute('SELECT reason, vehicle_raw, recorded_at_raw, detail'
                           ' FROM quarantined_record').fetchall()
        con.close()
        self.assertEqual(len(rows), 1)
        self.assertEqual((rows[0][0], rows[0][1]), ('future_timestamp', 'FUTURE'))
        self.assertEqual(rows[0][2], at(600), 'the raw timestamp is kept verbatim')
        self.assertIn('ahead of retrieval', rows[0][3])
        live = self.live()
        self.assertEqual([v['vehicle'] for v in live['vehicles']], ['OK'])
        self.assertEqual(live['withheld']['quarantineReasons'],
                         [{'reason': 'future_timestamp', 'count': 1}])

    def test_an_expired_position_is_withheld_and_counted_not_drawn(self):
        from pipeline.freshness import EXPIRY
        self.run_collector([siri_document([bus(at(-(EXPIRY + 300)), vehicle='YESTERDAY'),
                                           bus(at(-30), vehicle='RUNNING')])], cycles=1)
        live = self.live()
        self.assertEqual([v['vehicle'] for v in live['vehicles']], ['RUNNING'])
        self.assertEqual(live['withheld']['expiredPositions'], 1)
        con = self.connect()
        self.assertEqual(con.execute('SELECT count(*) FROM observation').fetchone()[0], 2,
                         'the expired position is retained in history, just not published')
        con.close()

    def test_every_published_position_is_labelled_observed_and_aged(self):
        # Aged from now, not from when the module was imported: 45 s against the 60 s "fresh" limit
        # left fifteen seconds for every test run before this one, and a slower CI runner used them
        # up on 28 September 2026 ('ageing' != 'fresh').
        when = (datetime.now(timezone.utc) - timedelta(seconds=45)).strftime('%Y-%m-%dT%H:%M:%S+00:00')
        self.run_collector([siri_document([bus(when)])], cycles=1)
        vehicle = self.live()['vehicles'][0]
        self.assertEqual(vehicle['positionKind'], 'observed')
        self.assertGreaterEqual(vehicle['ageSeconds'], 45)
        self.assertEqual(vehicle['freshness'], 'fresh')
        self.assertIn('observationExpirySeconds', self.live()['freshness']['policy'])

    # -- upstream failure -------------------------------------------------------
    def test_an_upstream_failure_keeps_the_last_state_with_its_original_timestamps(self):
        good = siri_document([bus(at(-30))])
        result, _ = self.run_collector([good, urllib.error.URLError('unreachable')], cycles=2)
        live = self.live()
        self.assertEqual(result['failures'], 1)
        self.assertEqual(len(live['vehicles']), 1, 'the last known position is still served')
        self.assertEqual(live['vehicles'][0]['recordedAt'], at(-30),
                         'a cached position keeps its own observation time')
        self.assertEqual(live['collection']['consecutiveFailures'], 1)
        self.assertEqual([c['outcome'] for c in live['pipelineFailures']['cycles']],
                         ['transport_error'])
        con = self.connect()
        outcomes = [r[0] for r in con.execute(
            'SELECT outcome FROM collection_cycle ORDER BY cycle_no').fetchall()]
        con.close()
        self.assertEqual(outcomes, ['succeeded', 'transport_error'])

    def test_a_malformed_response_is_recorded_and_does_not_replace_good_state(self):
        good = siri_document([bus(at(-30))])
        result, _ = self.run_collector([good, b'<Siri><not-xml'], cycles=2)
        con = self.connect()
        outcomes = [r[0] for r in con.execute(
            'SELECT outcome FROM collection_cycle ORDER BY cycle_no').fetchall()]
        error_class = con.execute(
            "SELECT error_class FROM collection_cycle WHERE outcome='malformed'").fetchone()
        con.close()
        self.assertEqual(outcomes, ['succeeded', 'malformed'])
        self.assertIsNotNone(error_class[0])
        live = self.live()
        self.assertEqual(len(live['vehicles']), 1)
        self.assertEqual(live['vehicles'][0]['recordedAt'], at(-30))

    def test_rejected_credentials_stop_collection_and_mark_the_run_failed(self):
        rejected = urllib.error.HTTPError('https://redacted', 401, 'Unauthorized', {}, None)
        with self.assertRaises(SystemExit):
            self.run_collector([rejected], cycles=2)
        con = self.connect()
        run = con.execute('SELECT status, error_class FROM pipeline_run').fetchone()
        cycle = con.execute('SELECT outcome, http_status FROM collection_cycle').fetchone()
        con.close()
        self.assertEqual(run, ('failed', 'AuthorizationRejected'))
        self.assertEqual(cycle, ('http_error', 401))

    # -- single writer ----------------------------------------------------------
    def test_a_second_collector_refuses_to_run_while_one_holds_the_lock(self):
        from pipeline.collect import CollectorBusy, SingleWriter
        lock = self.root / 'data/warehouse/collector.lock'
        with SingleWriter(lock):
            with self.assertRaises(CollectorBusy):
                with SingleWriter(lock):
                    pass
        # Released on exit, so the next run starts normally.
        with SingleWriter(lock):
            pass

    def test_an_interrupted_collection_releases_the_lock_and_records_the_failure(self):
        from pipeline.collect import CollectorBusy, SingleWriter, collect
        lock = self.root / 'data/warehouse/collector.lock'

        class Boom(RuntimeError):
            pass

        def exploding_fetch(url):
            raise KeyboardInterrupt('operator pressed ctrl-c')

        with self.assertRaises(KeyboardInterrupt):
            with SingleWriter(lock):
                collect(minutes=1, interval=20, root=self.root, db_path=self.db,
                        fetch_fn=exploding_fetch, clock=self.clock, sleep=self.sleep,
                        log=lambda *_: None, api_key='test-key')
        con = self.connect()
        run = con.execute('SELECT status, error_class, exit_reason FROM pipeline_run').fetchone()
        con.close()
        # Ctrl-C is an interruption, not a failure, and the run says which signal ended it.
        self.assertEqual(run, ('interrupted', 'KeyboardInterrupt', 'signal:SIGINT'))
        with SingleWriter(lock):
            pass  # the lock did not leak

    def test_a_run_left_running_is_closed_as_abandoned_by_the_next_collector(self):
        from pipeline.warehouse import connect, record_cycle, start_run
        con = connect(self.db)
        left = start_run(con, 'live_capture', is_historical=False, note='left behind')
        record_cycle(con, left, 1, NOW - timedelta(minutes=40), 'succeeded')
        last = con.execute('SELECT completed_at FROM collection_cycle WHERE run_id = ?',
                           [left]).fetchone()[0]
        con.close()
        self.run_collector([siri_document([bus(at(-30))])], cycles=1)
        con = self.connect()
        row = con.execute('SELECT status, exit_reason, error_class, finished_at, error_detail'
                          ' FROM pipeline_run WHERE run_id = ?', [left]).fetchone()
        newest = con.execute('SELECT status, exit_reason FROM pipeline_run WHERE run_id <> ?',
                             [left]).fetchone()
        con.close()
        self.assertEqual(row[:3], ('interrupted', 'abandoned', 'AbandonedRun'))
        self.assertEqual(row[3], last, 'closed at its last recorded cycle, not when it was found')
        self.assertIn('No cause is inferred', row[4])
        self.assertEqual(newest, ('succeeded', 'time_limit_reached'))

    def test_a_bounded_run_says_it_is_bounded_and_why_it_ended(self):
        self.run_collector([siri_document([bus(at(-30))])], cycles=2, interval=20)
        con = self.connect()
        status, reason, kind, planned = con.execute(
            'SELECT status, exit_reason, collector_kind, planned_minutes FROM pipeline_run').fetchone()
        con.close()
        self.assertEqual((status, reason, kind), ('succeeded', 'time_limit_reached', 'bounded_development'))
        self.assertAlmostEqual(planned, 40 / 60)
        collector = self.live()['collection']['collector']
        self.assertEqual((collector['kind'], collector['exitReason']),
                         ('bounded_development', 'time_limit_reached'))
        self.assertAlmostEqual(collector['plannedMinutes'], 40 / 60)
        self.assertIsNotNone(collector['endsBy'])

    def test_each_bus_carries_its_recent_reports_of_the_same_journey(self):
        older_journey = siri_document([bus(at(-110), lat=53.4690, journey='J0')])
        first = siri_document([bus(at(-80), lat=53.4700)])
        second = siri_document([bus(at(-50), lat=53.4725, bearing=90),
                                bus(at(-45), vehicle='V2', lat=53.46)])
        latest = siri_document([bus(at(-20), lat=53.4750)])
        self.run_collector([older_journey, first, second, latest], cycles=4)
        live = self.live()
        vehicle = next(v for v in live['vehicles'] if v['vehicle'] == 'V1')
        other = next(v for v in live['vehicles'] if v['vehicle'] == 'V2')
        # Oldest first, as milliseconds before the published report. The report from another
        # journey of the same bus is not part of this journey's trail.
        self.assertEqual([p[0] for p in vehicle['trail']], [60000, 30000])
        self.assertEqual([p[1] for p in vehicle['trail']], [53.47, 53.4725])
        self.assertEqual([p[3] for p in vehicle['trail']], [None, 90.0],
                         'a trail point keeps its own reported bearing')
        for point in vehicle['trail']:
            self.assertRegex(live['trailSources'][point[4]], '^[a-f0-9]{64}$')
        self.assertNotIn('trail', other, 'a single report has no trail')
        self.assertIsInstance(vehicle['retrievedAtMs'], int)
        self.assertGreaterEqual(vehicle['retrievedAtMs'], vehicle['observedAtMs'])

    def test_a_polite_stop_signal_is_recorded_as_an_interruption(self):
        import os
        import signal
        import time as real_time
        from pipeline.collect import CollectorStopped, collect
        before = signal.getsignal(signal.SIGTERM)

        def stopping_fetch(url):
            os.kill(os.getpid(), signal.SIGTERM)   # as a process manager or a closed terminal would
            for _ in range(200):
                real_time.sleep(0.01)
            raise AssertionError('the signal should have ended the run first')

        with self.assertRaises(CollectorStopped):
            collect(minutes=1, interval=20, root=self.root, db_path=self.db,
                    fetch_fn=stopping_fetch, clock=self.clock, sleep=self.sleep,
                    log=lambda *_: None, api_key='test-key-never-real')
        con = self.connect()
        run = con.execute('SELECT status, exit_reason, error_class FROM pipeline_run').fetchone()
        con.close()
        self.assertEqual(run, ('interrupted', 'signal:SIGTERM', 'CollectorStopped'))
        self.assertIs(signal.getsignal(signal.SIGTERM), before, 'the previous handler is restored')

    def test_a_stop_during_a_warehouse_query_is_still_a_polite_stop(self):
        """26 September 2026: a deploy's restart landed during a publication; DuckDB turned the stop
        into "Query interrupted", and the collector recorded a failure and exited 1."""
        import os
        import signal
        from unittest import mock
        from pipeline.collect import CollectorStopped, collect

        def publish_during_a_stop(con, run_id, root):
            # A query long enough to be interrupted, on the collector's own connection, with the
            # stop arriving while it runs, as a service manager's does.
            import threading
            threading.Timer(0.3, os.kill, (os.getpid(), signal.SIGTERM)).start()
            con.execute('SELECT count(*) FROM range(20000000000) t(x) WHERE x % 7 = 3').fetchall()
            raise AssertionError('the stop should have interrupted the query')

        # The feed fails (a transport error is recorded and the cycle goes on to publish), so the
        # stop arrives in the publication's query, where it arrived on the server.
        feed = FakeFeed([OSError('no network in this test')])
        with mock.patch('pipeline.collect.publish_live', side_effect=publish_during_a_stop):
            with self.assertRaises(CollectorStopped) as raised:
                collect(minutes=1, interval=20, root=self.root, db_path=self.db,
                        fetch_fn=feed, clock=self.clock, sleep=self.sleep,
                        log=lambda *_: None, api_key='test-key-never-real')
        self.assertEqual(raised.exception.signal_name, 'SIGTERM')
        con = self.connect()
        run = con.execute('SELECT status, exit_reason, error_class FROM pipeline_run').fetchone()
        con.close()
        self.assertEqual(run, ('interrupted', 'signal:SIGTERM', 'CollectorStopped'))

    def test_a_stop_during_the_timetable_matching_is_not_read_as_missing_patterns(self):
        """26 September 2026: a restart landed in the matching, whose handler for "patterns not built
        yet" caught the interrupted query, published every bus unmatched, and carried on collecting
        until systemd killed it 30 s later."""
        import os
        import signal
        import threading
        from unittest import mock
        from pipeline.collect import CollectorStopped, collect

        def matching_during_a_stop(con, vehicles):
            threading.Timer(0.3, os.kill, (os.getpid(), signal.SIGTERM)).start()
            con.execute('SELECT count(*) FROM range(20000000000) t(x) WHERE x % 7 = 3').fetchall()
            raise AssertionError('the stop should have interrupted the query')

        feed = FakeFeed([siri_document([bus(at(-5))])])
        with mock.patch('pipeline.live.match_all', side_effect=matching_during_a_stop):
            with self.assertRaises(CollectorStopped):
                collect(minutes=1, interval=20, root=self.root, db_path=self.db,
                        fetch_fn=feed, clock=self.clock, sleep=self.sleep,
                        log=lambda *_: None, api_key='test-key-never-real')
        con = self.connect()
        run = con.execute('SELECT status, exit_reason, error_class FROM pipeline_run').fetchone()
        con.close()
        self.assertEqual(run, ('interrupted', 'signal:SIGTERM', 'CollectorStopped'))

    def test_a_stop_the_warehouse_swallows_is_still_acted_on(self):
        """27 September 2026: a deploy's SIGTERM landed in the batch insert of a cycle's positions,
        DuckDB's executemany finished the insert as if nothing had happened, and the collector went
        on collecting until systemd killed it 30 s later. Reproduced with the real collector against a
        copy of the warehouse: in two sweeps of 19 stops landing in that load, 8 and 9 were lost, and
        with this fix none of 19. The handler now records the stop as well as raising it, and the
        collector acts on the record once the warehouse has handed control back."""
        import os
        import signal
        import time as real_time
        from unittest import mock
        from pipeline import collect as collect_module
        from pipeline.collect import CollectorStopped, collect
        real_load = collect_module.load_observations

        def load_that_swallows_a_stop(*args, **kwargs):
            # As executemany did: the signal's handler runs during the load, and what it raises goes
            # no further.
            try:
                os.kill(os.getpid(), signal.SIGTERM)
                for _ in range(100):
                    real_time.sleep(0.01)
            except CollectorStopped:
                pass
            return real_load(*args, **kwargs)

        feed = FakeFeed([siri_document([bus(at(-5))]), siri_document([bus(at(-3))]),
                         siri_document([bus(at(-1))])])
        with mock.patch('pipeline.collect.load_observations', side_effect=load_that_swallows_a_stop):
            with self.assertRaises(CollectorStopped) as raised:
                collect(minutes=1, interval=20, root=self.root, db_path=self.db,
                        fetch_fn=feed, clock=self.clock, sleep=self.sleep,
                        log=lambda *_: None, api_key='test-key-never-real')
        self.assertEqual(raised.exception.signal_name, 'SIGTERM')
        self.assertEqual(feed.calls, 1, 'no further request after the stop')
        con = self.connect()
        run = con.execute('SELECT status, exit_reason, error_class FROM pipeline_run').fetchone()
        cycles = con.execute('SELECT count(*), min(outcome) FROM collection_cycle').fetchone()
        con.close()
        self.assertEqual(run, ('interrupted', 'signal:SIGTERM', 'CollectorStopped'))
        self.assertEqual(cycles, (1, 'succeeded'), 'the cycle the stop landed in is recorded whole, and it is the last')

    def test_a_service_manager_stop_exits_zero_and_a_ctrl_c_exits_130(self):
        """A recorded, graceful stop is a success; systemd must not call it a failure.

        Returning 130 for SIGTERM put the unit into `failed` after every nightly rebuild, which
        left a real failure looking exactly like a routine stop. 130 stays for Ctrl-C, where it
        is the shell's own convention.
        """
        import contextlib
        from unittest import mock
        from pipeline import collect as collect_module
        from pipeline.collect import CollectorStopped

        cases = [(CollectorStopped('SIGTERM'), 0), (CollectorStopped('SIGHUP'), 0),
                 (CollectorStopped('SIGINT'), 130), (KeyboardInterrupt(), 130)]
        for raised, expected in cases:
            with self.subTest(stop=type(raised).__name__ + ':' + str(raised)):
                with mock.patch.object(collect_module, 'collect', side_effect=raised), \
                     mock.patch.object(collect_module, 'SingleWriter',
                                       lambda *a, **k: contextlib.nullcontext()), \
                     mock.patch.object(sys, 'argv', ['collect', '--minutes', '1']), \
                     mock.patch.dict(os.environ, {'BODS_API_KEY': 'test-key-never-real'}), \
                     contextlib.redirect_stdout(io.StringIO()):
                    self.assertEqual(collect_module.main(), expected)

    def test_the_run_says_whether_it_is_a_service_or_somebody_s_laptop(self):
        """Operations shows this, so a hosted service must not describe itself as development."""
        import os as _os
        from unittest import mock
        from pipeline.collect import COLLECTOR_KINDS

        self.assertIn('hosted_service', COLLECTOR_KINDS)
        with mock.patch.dict(_os.environ, {'LM_COLLECTOR_KIND': 'hosted_service'}):
            self.run_collector([siri_document([bus(at(-30))])], cycles=1)
        con = self.connect()
        kind, note = con.execute(
            'SELECT collector_kind, note FROM pipeline_run ORDER BY started_at DESC LIMIT 1'
        ).fetchone()
        con.close()
        self.assertEqual(kind, 'hosted_service')
        self.assertIn('hosted service collection', note)

    def test_an_unknown_collector_kind_is_refused_rather_than_recorded(self):
        import os as _os
        from unittest import mock
        with mock.patch.dict(_os.environ, {'LM_COLLECTOR_KIND': 'production-ish'}):
            with self.assertRaises(SystemExit) as caught:
                self.run_collector([siri_document([bus(at(-30))])], cycles=1)
        self.assertIn('LM_COLLECTOR_KIND', str(caught.exception))

    # -- publication consistency ------------------------------------------------
    def test_the_published_state_is_validated_and_a_failure_keeps_the_previous_file(self):
        from pipeline.live import publish_live, validate_live
        self.run_collector([siri_document([bus(at(-30))])], cycles=1)
        target = self.root / 'public/data/live.json'
        before = target.read_bytes()

        # A candidate that would draw a bus from an expired position must not publish.
        con = self.connect()
        bad = json.loads(before)
        bad['vehicles'] = [dict(bad['vehicles'][0], ageSeconds=99999)]
        checks = validate_live(bad, json.loads(before))
        failed = [c['name'] for c in checks if not c['passed']]
        self.assertIn('no_expired_position_published', failed)

        # Publishing again with an earlier publication time must not move time backwards.
        result = publish_live(con, 'run-x', root=self.root,
                              published_at=datetime.now(timezone.utc) - timedelta(hours=1))
        statuses = [r[0] for r in con.execute(
            "SELECT status FROM publication WHERE kind='live' ORDER BY built_at").fetchall()]
        con.close()
        self.assertFalse(result['published'])
        self.assertIn('publication_time_not_going_backwards', result['failedChecks'])
        self.assertEqual(target.read_bytes(), before, 'the served file must be untouched')
        self.assertEqual(statuses[-1], 'failed_validation')

    def test_the_live_state_matches_the_warehouse_and_leaks_no_credential(self):
        self.run_collector([siri_document([bus(at(-30), vehicle='A'),
                                           bus(at(-40), vehicle='B', journey='J2')])], cycles=1)
        live = self.live()
        con = self.connect()
        expected = con.execute("""
            SELECT count(DISTINCT (operator, vehicle)) FROM v_publishable_observation
            WHERE source_sha256 IN (SELECT source_sha256 FROM raw_source
                                    WHERE source_kind = 'live_positions')""").fetchone()[0]
        recorded_urls = [r[0] for r in con.execute('SELECT source_url FROM raw_source').fetchall()]
        con.close()
        self.assertEqual(len(live['vehicles']), expected)
        body = json.dumps(live)
        self.assertNotIn('test-key-never-real', body, 'no key may reach a published file')
        self.assertNotIn('api_key=test', body)
        for url in recorded_urls:
            self.assertIn('[REDACTED]', url, 'the stored URL must be redacted')
            self.assertNotIn('test-key-never-real', url)

    # -- real payloads through the live code path --------------------------------
    @unittest.skipUnless(len(ARCHIVE_FILES) >= 2,
                         'needs the cached archive sample: python -m pipeline.run import')
    def test_real_archive_payloads_flow_through_the_live_path_and_all_expire(self):
        """Real BODS bytes, real volume, exercising the expiry control end to end.

        Every position in the retained sample is a day old, so a correct pipeline must
        publish none of them as buses and must say so, rather than drawing yesterday.
        """
        bodies = [path.read_bytes() for path in ARCHIVE_FILES[:3]]
        result, feed = self.run_collector(bodies, cycles=3)
        self.assertEqual((feed.calls, result['changed'], result['repeats']), (3, 3, 0))
        live = self.live()
        con = self.connect()
        stored = con.execute('SELECT count(*) FROM observation').fetchone()[0]
        con.close()
        # The archive import retains 387 + 310 + 302 = 999 from these three snapshots, because
        # it filters to the box the archive was collected under. The live path filters to the
        # wider service area that reaches Stretford, so it keeps more from the same bytes.
        from pipeline.core import BBOX, SERVICE_AREA
        self.assertGreater(stored, 999)
        self.assertLess(SERVICE_AREA[0], BBOX[0], 'the service area extends further west')
        self.assertEqual(stored, result['loaded'], 'cycle counts must match the stored rows')
        self.assertEqual(live['vehicles'], [], 'a day-old position is not a bus on the map')
        self.assertEqual(live['state'], 'stale')
        con = self.connect()
        distinct_vehicles = con.execute(
            'SELECT count(*) FROM (SELECT DISTINCT operator, vehicle FROM observation)').fetchone()[0]
        con.close()
        self.assertEqual(live['withheld']['expiredPositions'], distinct_vehicles,
                         'every vehicle we hold was withheld, and counted')

    def test_measurements_report_their_sample_size_and_window(self):
        self.run_collector([siri_document([bus(at(-30))]),
                            siri_document([bus(at(-5), lat=53.4715)])], cycles=2)
        measured = self.live()['freshness']['measured']
        self.assertEqual(measured['measuredFor'], 'live_positions')
        self.assertTrue(measured['isLiveMeasurement'])
        for key in ('observationToRetrievalSeconds', 'ourCycleSeconds',
                    'reportIntervalSeconds', 'sourceCadenceSeconds'):
            self.assertIn('samples', measured[key])
            self.assertIn('p50', measured[key])
            self.assertIn('p95', measured[key])
            self.assertIn('windowDescription', measured[key])
        self.assertIn('caveat', measured)

    # -- where a report's age goes (backlog 48) -----------------------------------------------
    def test_each_cycle_logs_where_its_time_went_and_publishes_none_of_it(self):
        lines = []
        self.run_collector([siri_document([bus(at(-30)), bus(at(-50), vehicle='V2', lat=53.471)]),
                            siri_document([bus(at(-10), lat=53.4705), bus(at(-50), vehicle='V2', lat=53.471)])],
                           cycles=2, log=lines.append)
        timings = [line for line in lines if isinstance(line, dict) and 'ms' in line]
        self.assertEqual([t['cycle'] for t in timings], [1, 2], 'one timing line a cycle')
        for t in timings:
            self.assertTrue({'fetch', 'store', 'parse', 'load', 'publish'} <= set(t['ms']), t['ms'])
            self.assertTrue({'previous', 'latest', 'match', 'trails', 'collection', 'freshness', 'validate',
                             'serialise', 'write', 'record'} <= set(t['publication']), t['publication'])
            self.assertTrue(all(isinstance(v, int) and v >= 0 for v in [*t['ms'].values(), *t['publication'].values()]))
            self.assertGreaterEqual(t['stampToWrittenMs'], 0, 'written after its own stamp')
            self.assertLessEqual(t['requestedAtMs'], t['receivedAtMs'])
            self.assertLessEqual(t['receivedAtMs'], t['publishedAtMs'], 'stamped after the feed was read')
        # The run's first payload has nothing to compare with; the second brings one new report (V1's), not V2's
        # again, and says how old it was on arrival.
        self.assertIsNone(timings[0]['arrivalAges'])
        (age, count), = timings[1]['arrivalAges'].items()
        self.assertEqual(count, 1)
        self.assertGreaterEqual(int(age), 10)
        published = (self.root / 'public/data/live.json').read_text()
        for key in ('arrivalAges', 'stampToWrittenMs', '"timings"', 'receivedAtMs'):
            self.assertNotIn(key, published, 'the timings are the collector\'s log, not the public file')


class ArrivalTimingTests(unittest.TestCase):
    """The pieces of the timing line that need no warehouse (backlog 48)."""

    def test_only_a_vehicle_s_later_reports_count_and_old_ones_are_counted_together(self):
        from pipeline.collect import arrival_ages
        rec = lambda vehicle, ms: {'operator': 'OP', 'vehicle': vehicle, 'time': ms}
        newest = {}
        self.assertIsNone(arrival_ages([rec('A', 100_000), rec('B', 50_000)], newest, 130_000),
                          'a run\'s first payload counts nothing')
        self.assertEqual(newest, {('OP', 'A'): 100_000, ('OP', 'B'): 50_000})
        ages = arrival_ages([rec('A', 100_000), rec('B', 120_000), rec('C', 10_000)], newest, 1_000_000)
        # A: the same report again, not counted; B: 880 s on arrival; C: first seen, 990 s, past the cap.
        self.assertEqual(ages, {'880': 1, '>900': 1})
        self.assertEqual(arrival_ages([rec('A', 90_000)], newest, 1_000_000), {}, 'an older report is not new')

    def test_the_feed_s_response_timestamp_is_read_where_it_says_one(self):
        from pipeline.collect import response_timestamp_ms
        body = (b'<Siri version="2.0" xmlns="http://www.siri.org.uk/siri"><ServiceDelivery>'
                b'<ResponseTimestamp>2026-09-20T00:49:34.134+00:00</ResponseTimestamp>')
        self.assertEqual(response_timestamp_ms(body),
                         int(datetime(2026, 9, 20, 0, 49, 34, 134000, tzinfo=timezone.utc).timestamp() * 1000))
        self.assertIsNone(response_timestamp_ms(siri_document([bus(at(-5))])), 'not said, not guessed')
        self.assertIsNone(response_timestamp_ms(b'<ResponseTimestamp>yesterday</ResponseTimestamp>'))


if __name__ == '__main__':
    unittest.main()


@unittest.skipUnless(HAS_DUCKDB, 'DuckDB not installed; see requirements.txt')
class TimetableDownloadTests(unittest.TestCase):
    def test_a_page_that_is_not_a_zip_is_kept_apart_not_stored_as_a_timetable(self):
        # 27 September 2026: BODS answered a timetable download with its "problem with the service"
        # page under HTTP 200, and the page became a snapshot the nightly rebuild then failed on.
        from pipeline.collect import collect_timetables
        page = b'<!DOCTYPE html>\n<html lang="en" class="govuk-template"><title>Problem with the service - GOV.UK</title>'
        logged = []
        with tempfile.TemporaryDirectory() as directory:
            stored = collect_timetables(None, 'run-1', ['https://data.bus-data.dft.gov.uk/timetable/dataset/1/download/?api_key=SECRET'],
                                        Path(directory), log=logged.append,
                                        fetch_fn=lambda url: (page, 200, 'text/html'), size_fn=lambda url: None)
            self.assertEqual(stored, [])
            self.assertEqual([entry.get('timetable') for entry in logged], ['rejected'])
            self.assertEqual(logged[0]['reason'], 'not a zip archive')
            self.assertEqual(logged[0]['status'], 200)
            self.assertNotIn('SECRET', json.dumps(logged), 'the key never reaches a log')
            self.assertFalse((Path(directory) / 'timetables').exists(), 'nothing among the timetables')
            self.assertEqual(len(list((Path(directory) / 'timetables-rejected').glob('*.bin.gz'))), 1, 'the bytes kept apart')


class UnavailableDiagnosisTests(unittest.TestCase):
    """Why there is no live data must come from state, not from an assumption."""

    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix='lost-minutes-diag-'))
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)
        from pipeline.warehouse import connect
        self.con = connect(self.root / 'w.duckdb')
        self.addCleanup(self.con.close)

    def diagnose(self, environ):
        from pipeline.live import diagnose_unavailable
        return diagnose_unavailable(self.con, environ)

    def test_no_key_blames_the_key(self):
        result = self.diagnose({})
        self.assertEqual(result['reason'], 'no_credentials_configured')
        self.assertIn('BODS_API_KEY', result['technical'])

    def test_a_configured_key_that_has_never_collected_says_so(self):
        result = self.diagnose({'BODS_API_KEY': 'x' * 40})
        self.assertEqual(result['reason'], 'collector_never_run')
        self.assertIn('pnpm dev:live', result['technical'])
        # The passenger is never shown the credential wording.
        self.assertNotIn('BODS_API_KEY', result['passenger'])

    def test_a_collector_that_has_run_but_is_not_running_is_not_blamed_on_the_key(self):
        from pipeline.warehouse import record_raw_source, start_run
        run_id = start_run(self.con, 'live_capture', is_historical=False)
        record_raw_source(self.con, run_id, sha256='a' * 64, kind='live_positions',
                          url='https://example.test/feed?api_key=secret', stored_path='x',
                          byte_size=1, captured_at=NOW, retrieved_at=NOW)
        result = self.diagnose({'BODS_API_KEY': 'x' * 40})
        self.assertEqual(result['reason'], 'collector_not_running')
        self.assertIn('pnpm dev:live', result['technical'])
        # This is the case the published placeholder got wrong before.
        self.assertNotEqual(result['reason'], 'no_credentials_configured')

    def test_the_passenger_wording_never_leaks_the_technical_reason(self):
        for environ in ({}, {'BODS_API_KEY': 'x' * 40}):
            result = self.diagnose(environ)
            self.assertNotIn('BODS_API_KEY', result['passenger'])
            self.assertNotIn('collector', result['passenger'].lower())


class StopSignalTests(unittest.TestCase):
    """A stop must be recorded however the collector was started.

    On 19 September 2026 a collector started by `scripts/preview.sh` ignored the SIGINT that
    `preview.sh stop` sends and went on collecting — cycles 170 to 177 arrived after the signal —
    while the script reported that it had stopped. The cause is POSIX: a shell starting a background
    job without job control sets SIGINT to SIG_IGN in the child, and an ignored disposition survives
    exec. Installing a handler replaces it, so SIGINT belongs in STOP_SIGNALS whatever else sends it.
    """

    def test_every_signal_a_stop_is_sent_with_is_handled(self):
        from pipeline.collect import STOP_SIGNALS
        self.assertIn('SIGTERM', STOP_SIGNALS, 'systemd and preview.sh stop send this')
        self.assertIn('SIGINT', STOP_SIGNALS, 'Ctrl-C, dev:live, and an inherited SIG_IGN')
        self.assertIn('SIGHUP', STOP_SIGNALS, 'a closed terminal')

    def test_installing_a_handler_overrides_an_inherited_ignore(self):
        import signal
        from pipeline.collect import _install_stop_handlers, _restore_handlers
        before = signal.signal(signal.SIGINT, signal.SIG_IGN)      # as a background job inherits it
        try:
            previous = _install_stop_handlers()
            try:
                self.assertNotEqual(signal.getsignal(signal.SIGINT), signal.SIG_IGN,
                                    'an ignored SIGINT must not survive the collector starting')
            finally:
                _restore_handlers(previous)
        finally:
            signal.signal(signal.SIGINT, before)
