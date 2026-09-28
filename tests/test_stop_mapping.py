"""A road shape's explicit stop mapping (pipeline/stop_mapping.py): which pattern stop each offset along the road
is. Recovered from the build's own routing requests, recorded by the build itself, refused whenever it disagrees
with the pattern; and the real inbound-15 shape, whose list-position reading named every stop 14 places on."""
import json
import unittest
from pathlib import Path

from pipeline import stop_mapping as sm

ROOT = Path(__file__).resolve().parents[1]


def body(*locations):
    return {'trip': {'locations': [{'lat': lat, 'lon': lon} for lat, lon in locations]}}


# Seven pattern stops along a line of latitude: O1 and O2 outside the area (no published coordinates), S1..S5
# inside, S3 visited again after S5 (a loop), and a gap: O3 outside between S4 and S5.
PATTERN = ['O1', 'O2', 'S1', 'S2', 'S3', 'S4', 'O3', 'S5', 'S3']
COORDS = {'S1': (53.40, -2.300), 'S2': (53.40, -2.290), 'S3': (53.40, -2.280), 'S4': (53.40, -2.270), 'S5': (53.40, -2.260)}


class RecoveredFromRequestsTests(unittest.TestCase):
    def test_each_routed_location_is_the_next_pattern_stop_with_those_coordinates(self):
        # Two windows sharing S4, as the builder sends them; the router echoes six decimals.
        bodies = [body((53.400001, -2.300001), (53.4, -2.29), (53.4, -2.28), (53.4, -2.27)),
                  body((53.4, -2.27), (53.4, -2.26), (53.4, -2.28))]
        offsets = [0.0, 660.0, 1330.0, 1990.0, 2660.0, 3320.0]
        mapping = sm.from_requests('P', PATTERN, COORDS, bodies, offsets)
        self.assertEqual([(o['index'], o['stop']) for o in mapping['occurrences']],
                         [(2, 'S1'), (3, 'S2'), (4, 'S3'), (5, 'S4'), (7, 'S5'), (8, 'S3')],
                         'clipped at the start, a gap in the middle, and the loop back to S3 on its own index')
        self.assertEqual(sm.aligned_offsets(mapping, 'P', PATTERN),
                         [None, None, 0.0, 660.0, 1330.0, 1990.0, None, 2660.0, 3320.0])

    def test_a_count_that_does_not_match_is_refused(self):
        with self.assertRaises(sm.MappingError):
            sm.from_requests('P', PATTERN, COORDS, [body((53.4, -2.3), (53.4, -2.29))], [0.0])
        with self.assertRaises(sm.MappingError):
            sm.from_placed('P', 9, [(2, 'S1'), (3, 'S2')], [0.0])

    def test_a_location_that_is_no_stop_of_the_pattern_in_order_is_refused(self):
        with self.assertRaises(sm.MappingError):
            sm.from_requests('P', PATTERN, COORDS, [body((53.4, -2.29), (53.4, -2.30))], [0.0, 660.0])


class RefusedTests(unittest.TestCase):
    MAPPING = sm.from_placed('P', 9, [(2, 'S1'), (3, 'S2'), (4, 'S3')], [0.0, 660.0, 1330.0])

    def refused(self, mapping, pattern_id='P', stops=PATTERN, length=None):
        with self.assertRaises(sm.MappingError):
            sm.aligned_offsets(mapping, pattern_id, stops, length)

    def test_an_old_foreign_or_damaged_mapping_is_refused_never_paired_by_position(self):
        m = self.MAPPING
        self.refused(None)                                         # a shape published before version 2
        self.refused({**m, 'version': 1})
        self.refused(m, pattern_id='Q')                            # another pattern
        self.refused(m, stops=PATTERN[1:])                         # another stop list
        self.refused({**m, 'occurrences': [{**m['occurrences'][0], 'stop': 'S2'}, *m['occurrences'][1:]]})
        self.refused({**m, 'occurrences': m['occurrences'][::-1]})  # out of order
        self.refused({**m, 'occurrences': [*m['occurrences'][:2], {**m['occurrences'][2], 'offset': 10.0}]})
        self.refused(m, length=900.0)                              # an offset beyond the road
        self.refused({**m, 'occurrences': []})


class BuildRecordsTheIndexTests(unittest.TestCase):
    def test_the_build_gives_each_routed_stop_its_index_in_the_full_stop_list(self):
        import duckdb
        from pipeline.patterns import MIN_STOPS_IN_AREA
        from pipeline.shapes import corridor_patterns
        con = duckdb.connect()
        con.execute('CREATE TABLE service_pattern (pattern_id TEXT, line_name TEXT, operator_code TEXT, stop_count INTEGER, stops_in_area INTEGER)')
        con.execute('CREATE TABLE service_pattern_stop (pattern_id TEXT, sequence INTEGER, atco_code TEXT)')
        con.execute('CREATE TABLE stop (atco_code TEXT, lat DOUBLE, lon DOUBLE)')
        con.execute('INSERT INTO service_pattern VALUES (?, ?, ?, ?, ?)', ['P', '99', 'OP', len(PATTERN), max(MIN_STOPS_IN_AREA, 6)])
        # Sequence numbers need not start at zero or run without gaps: the index is the rank.
        con.executemany('INSERT INTO service_pattern_stop VALUES (?, ?, ?)', [('P', 10 + 3 * k, atco) for k, atco in enumerate(PATTERN)])
        con.executemany('INSERT INTO stop VALUES (?, ?, ?)', [(atco, lat, lon) for atco, (lat, lon) in COORDS.items()])
        [pattern] = corridor_patterns(con, ['99'], {})
        self.assertEqual([(s['index'], s['atco']) for s in pattern['stops']],
                         [(2, 'S1'), (3, 'S2'), (4, 'S3'), (5, 'S4'), (7, 'S5'), (8, 'S3')])
        mapping = sm.from_placed('P', pattern['stopCount'], [(s['index'], s['atco']) for s in pattern['stops']],
                                 [0.0, 660.0, 1330.0, 1990.0, 2660.0, 3320.0])
        self.assertEqual(sm.aligned_offsets(mapping, 'P', PATTERN)[8], 3320.0)


class RealInbound15Tests(unittest.TestCase):
    """The published inbound 15 shape, whose list-position reading named every stop 14 places on."""

    def setUp(self):
        from pipeline.passages import decode_polyline, load_track
        pid = 'BNML:15:inbound:9c10700c6c'
        self.pattern = next(p for p in json.loads((ROOT / 'public/data/patterns.json').read_text())['patterns'] if p['id'] == pid)
        index = json.loads((ROOT / 'public/data/shapes/index.json').read_text())
        self.shape = json.loads((ROOT / 'public/data/shapes' / index['patterns'][pid]['file']).read_text())
        self.points = decode_polyline(self.shape['polyline6'], 6)
        self.coords = {s['id']: (s['lat'], s['lon']) for s in json.loads((ROOT / 'public/data/stops.json').read_text())['stops']}
        self.track = load_track(pid, self.pattern['stops'])

    def test_hillingdon_road_opp_is_where_its_own_coordinates_put_it(self):
        j = self.pattern['stops'].index('1800SJ32251')
        self.assertEqual(j, 30)
        self.assertTrue(all(o is None for o in self.track.stop_offsets[:14]), 'its first 14 stops are outside the area')
        self.assertAlmostEqual(self.track.stop_offsets[j], 5495.0, delta=1.0)
        # Independently: the stop's own coordinates, projected onto the road, land there too.
        s, off = self.track.project(self.coords['1800SJ32251'])
        self.assertLess(abs(s - self.track.stop_offsets[j]), 15.0)
        self.assertLess(off, 10.0)

    def test_the_geometry_refutes_the_list_position_reading_it_replaced(self):
        worst, _ = sm.geometry_check(self.shape['stopMapping'], self.points, self.coords)
        self.assertLessEqual(worst, sm.GEOMETRY_TOLERANCE_M)
        by_position = sm.mapping('BNML:15:inbound:9c10700c6c', len(self.pattern['stops']),
                                 [(k, self.pattern['stops'][k], off) for k, off in enumerate(self.shape['stopOffsets'])], 'list position')
        worst_by_position, found = sm.geometry_check(by_position, self.points, self.coords)
        self.assertGreater(worst_by_position, 1000.0)
        self.assertGreater(dict(((i, d) for i, _, d in found))[30], 1000.0, 'Hillingdon Road (opp) read by position')

    def test_an_evaluation_refuses_passages_written_before_the_mapping(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location('evaluate_arrival', ROOT / 'scripts/evaluate-arrival.py')
        ev = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(ev)
        self.assertEqual(ev.passages_from({'stopMapping': 2, 'passages': [1]}), [1])
        with self.assertRaises(SystemExit):
            ev.passages_from({'passages': [1]})


if __name__ == '__main__':
    unittest.main()
