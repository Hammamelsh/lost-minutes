"""Behaviour tests for live collection and the published live state.

No network. The feed is replaced by a scripted fake so failures can be exercised exactly:
repeated payloads, out-of-order reports, clock skew, expiry, malformed bodies, upstream
errors, rejected credentials, overlapping writers and interrupted collection.
"""
import json
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
        result = collect(minutes=(cycles * interval) / 60.0, interval=interval,
                         root=self.root, db_path=self.db, fetch_fn=feed,
                         clock=self.clock, sleep=self.sleep, log=lambda *_: None,
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
        self.run_collector([siri_document([bus(at(-45))])], cycles=1)
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
        run = con.execute('SELECT status, error_class FROM pipeline_run').fetchone()
        con.close()
        self.assertEqual(run[0], 'failed')
        self.assertEqual(run[1], 'KeyboardInterrupt')
        with SingleWriter(lock):
            pass  # the lock did not leak

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
        # 387 + 310 + 302 = 999 distinct identities across the first three real snapshots,
        # the same figures the archive import reports, now reached via the live path.
        self.assertEqual(stored, 999)
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


if __name__ == '__main__':
    unittest.main()
