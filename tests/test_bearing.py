"""Reported Bearing, from the feed to the published file. Zero is north, not missing."""
import json
import shutil
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from pipeline.core import parse_source, read_bearing  # noqa: E402
from siri_fixtures import bus, siri_document  # noqa: E402

try:
    import duckdb  # noqa: F401
    HAS_DUCKDB = True
except ModuleNotFoundError:
    HAS_DUCKDB = False

NOW = datetime.now(timezone.utc).replace(microsecond=0)


def at(offset_seconds):
    return (NOW + timedelta(seconds=offset_seconds)).strftime('%Y-%m-%dT%H:%M:%S+00:00')


class BearingParsingTests(unittest.TestCase):
    def test_zero_is_a_real_bearing_not_a_missing_one(self):
        self.assertEqual(read_bearing('0'), (0.0, 'reported'))
        self.assertEqual(read_bearing('0.0'), (0.0, 'reported'))
        self.assertEqual(read_bearing('-0'), (0.0, 'reported'))     # no negative zero published

    def test_the_whole_compass_is_accepted_as_reported(self):
        for text, value in (('90', 90.0), ('359.5', 359.5), ('360', 360.0), (' 180 ', 180.0)):
            self.assertEqual(read_bearing(text), (value, 'reported'), text)

    def test_missing_stays_missing(self):
        self.assertEqual(read_bearing(''), (None, 'absent'))
        self.assertEqual(read_bearing(None), (None, 'absent'))

    def test_an_unreadable_or_impossible_bearing_is_invalid_and_never_repaired(self):
        for text in ('-5', '361', '720', 'NaN', 'inf', 'north', '1e999'):
            self.assertEqual(read_bearing(text), (None, 'invalid'), text)

    def test_the_parser_carries_the_status_and_counts_it(self):
        body = siri_document([bus(at(-20), vehicle='N', bearing='0'),
                              bus(at(-20), vehicle='E', bearing='90'),
                              bus(at(-20), vehicle='M'),
                              bus(at(-20), vehicle='X', bearing='-5')])
        records, rejected, stats = parse_source(body, 'a' * 64, NOW.isoformat())
        by_vehicle = {r['vehicle']: r for r in records}
        self.assertEqual(rejected, {})                      # a bad bearing never costs the position
        self.assertEqual((by_vehicle['N']['bearing'], by_vehicle['N']['bearingStatus']), (0.0, 'reported'))
        self.assertEqual((by_vehicle['E']['bearing'], by_vehicle['E']['bearingStatus']), (90.0, 'reported'))
        self.assertEqual((by_vehicle['M']['bearing'], by_vehicle['M']['bearingStatus']), (None, 'absent'))
        self.assertEqual((by_vehicle['X']['bearing'], by_vehicle['X']['bearingStatus'],
                          by_vehicle['X']['bearingRaw']), (None, 'invalid', '-5'))
        self.assertEqual(stats['bearing'], {'reported': 2, 'absent': 1, 'invalid': 1})


class FakeFeed:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = 0

    def __call__(self, url):
        item = self.responses[min(self.calls, len(self.responses) - 1)]
        self.calls += 1
        return item, 200, 'application/xml'


@unittest.skipUnless(HAS_DUCKDB, 'DuckDB not installed; see requirements.txt')
class BearingStorageTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix='lost-minutes-bearing-'))
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)
        (self.root / 'public/data').mkdir(parents=True)
        self.db = self.root / 'data/warehouse/test.duckdb'
        self.ticks = [0.0]

    def collect(self, responses, cycles=1):
        from pipeline.collect import collect
        self.ticks = [0.0]
        return collect(minutes=(cycles * 20) / 60.0, interval=20, root=self.root, db_path=self.db,
                       fetch_fn=FakeFeed(responses), clock=lambda: self.ticks[-1],
                       sleep=lambda s: self.ticks.append(self.ticks[-1] + max(s, 1)),
                       log=lambda *_: None, api_key='test-key-never-real')

    def test_bearings_are_stored_and_published_with_their_status(self):
        self.collect([siri_document([bus(at(-20), vehicle='N', bearing='0'),
                                     bus(at(-20), vehicle='E', bearing='90'),
                                     bus(at(-20), vehicle='M'),
                                     bus(at(-20), vehicle='X', bearing='NaN')])])
        live = json.loads((self.root / 'public/data/live.json').read_text())
        by_vehicle = {v['vehicle']: v for v in live['vehicles']}
        self.assertEqual((by_vehicle['N']['bearing'], by_vehicle['N']['bearingStatus']), (0, 'reported'))
        self.assertEqual((by_vehicle['E']['bearing'], by_vehicle['E']['bearingStatus']), (90, 'reported'))
        self.assertEqual((by_vehicle['M']['bearing'], by_vehicle['M']['bearingStatus']), (None, 'absent'))
        self.assertEqual((by_vehicle['X']['bearing'], by_vehicle['X']['bearingStatus']), (None, 'invalid'))
        self.assertEqual(live['sourceQuality']['bearings'],
                         {'reported': 2, 'absent': 1, 'invalid': 1, 'not_captured': 0})
        from pipeline.warehouse import connect
        con = connect(self.db)
        checks = dict(con.execute("SELECT check_name, passed FROM validation_check").fetchall())
        raw = con.execute("SELECT bearing_raw FROM observation WHERE vehicle = 'X'").fetchone()[0]
        con.close()
        self.assertTrue(checks['bearings_reported_or_explicitly_absent'])
        self.assertEqual(raw, 'NaN')

    def test_a_warehouse_from_before_bearings_is_migrated_and_says_not_captured(self):
        import duckdb
        from pipeline.warehouse import IDENTITY_SQL, connect, load_observations
        self.db.parent.mkdir(parents=True)
        old = duckdb.connect(str(self.db))
        old.execute(f"""CREATE TABLE observation (
            operator TEXT NOT NULL, vehicle TEXT NOT NULL, route TEXT NOT NULL,
            direction TEXT NOT NULL, journey_ref TEXT NOT NULL, observed_at_ms BIGINT NOT NULL,
            observed_at TIMESTAMPTZ NOT NULL, recorded_at_text TEXT NOT NULL, lat DOUBLE NOT NULL,
            lon DOUBLE NOT NULL, destination TEXT, origin TEXT, aimed_departure TEXT,
            source_sha256 TEXT NOT NULL, source_member TEXT, retrieved_at TIMESTAMPTZ,
            first_seen_run_id TEXT, first_seen_at TIMESTAMPTZ, PRIMARY KEY ({IDENTITY_SQL}))""")
        observed_ms = int((NOW - timedelta(seconds=30)).timestamp() * 1000)
        old.execute("INSERT INTO observation VALUES ('OP', 'V1', '142', 'inbound', 'J1', ?,"
                    " now(), ?, 53.47, -2.24, 'Town', NULL, NULL, ?, 'm', now(), 'r0', now())",
                    [observed_ms, at(-30), 'c' * 64])
        old.close()

        con = connect(self.db)                     # the migration runs here
        columns = {row[1] for row in con.execute("PRAGMA table_info('observation')").fetchall()}
        self.assertTrue({'bearing', 'bearing_status', 'bearing_raw'} <= columns)
        self.assertIsNone(con.execute('SELECT bearing_status FROM observation').fetchone()[0])

        from pipeline.live import build_live
        con.execute("INSERT INTO raw_source (source_sha256, source_kind, captured_at, retrieved_at)"
                    " VALUES (?, 'live_positions', now(), now())", ['c' * 64])
        vehicle = build_live(con)['vehicles'][0]
        self.assertEqual((vehicle['bearing'], vehicle['bearingStatus']), (None, 'not_captured'))

        # Re-reading the same report, now with its bearing, fills it in once; no count moves.
        record = {'operator': 'OP', 'vehicle': 'V1', 'route': '142', 'direction': 'inbound',
                  'journeyRef': 'J1', 'time': observed_ms, 'recordedAt': at(-30), 'lat': 53.47,
                  'lon': -2.24, 'destination': 'Town', 'origin': '', 'aimedDeparture': '',
                  'sourceHash': 'd' * 64, 'sourceMember': 'm', 'retrievedAt': NOW.isoformat(),
                  'bearing': 0.0, 'bearingStatus': 'reported', 'bearingRaw': ''}
        con.execute("INSERT INTO source_processing (run_id, source_sha256, outcome) VALUES ('r1', ?, 'pending')", ['d' * 64])
        counts = load_observations(con, 'r1', 'd' * 64, [record], {}, 1, 0)
        self.assertEqual((counts['new'], counts['repeats']), (0, 1))
        self.assertEqual(con.execute('SELECT bearing, bearing_status FROM observation').fetchone(),
                         (0.0, 'reported'))
        self.assertEqual(con.execute('SELECT count(*) FROM observation').fetchone()[0], 1)
        con.close()


if __name__ == '__main__':
    unittest.main()
