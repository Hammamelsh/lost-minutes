"""Road geometry for a pattern: joined correctly, measured along itself, and accepted only when
real reports lie close to it. No network: the router is replaced by recorded-shape fixtures."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pipeline.shapes import (ACCEPT_MIN_REPORTS, ACCEPT_P95_METRES, assemble, decide,  # noqa: E402
                             decode_polyline, encode_polyline, metres, offset_from, request_body,
                             usable, validate, windows)

# A road running north from (-2.30, 53.45), then east: two legs through three stops.
A, B, C = (-2.30, 53.45), (-2.30, 53.4545), (-2.2925, 53.4545)


def leg(*points):
    return {'shape': encode_polyline(points), 'summary': {'length': 0}}


class PolylineTests(unittest.TestCase):
    def test_the_encoding_round_trips_at_precision_six(self):
        points = [A, B, C, (-2.291234, 53.456789)]
        decoded = decode_polyline(encode_polyline(points))
        for (x, y), (u, v) in zip(points, decoded):
            self.assertAlmostEqual(x, u, places=6)
            self.assertAlmostEqual(y, v, places=6)


class AssemblyTests(unittest.TestCase):
    def test_windows_share_a_stop_so_no_leg_is_lost(self):
        stops = list(range(45))
        parts = windows(stops, size=20)
        self.assertEqual([(w[0], w[-1]) for w in parts], [(0, 19), (19, 38), (38, 44)])
        self.assertEqual(sum(len(w) - 1 for w in parts), 44, 'every stop-to-stop leg once')

    def test_legs_join_into_one_shape_with_each_stop_measured_along_it(self):
        points, offsets = assemble([{'trip': {'legs': [leg(A, B)]}}, {'trip': {'legs': [leg(B, C)]}}])
        self.assertEqual(len(points), 3, 'the shared point is not repeated')
        self.assertEqual(offsets[0], 0.0)
        self.assertAlmostEqual(offsets[1], metres(A, B), delta=0.2)
        self.assertAlmostEqual(offsets[2], metres(A, B) + metres(B, C), delta=0.2)

    def test_each_stop_is_approached_in_the_direction_buses_travel_there(self):
        body = request_body([{'lat': 53.45, 'lon': -2.3, 'bearing': 'N'}, {'lat': 53.46, 'lon': -2.3, 'bearing': None}])
        self.assertEqual(body['costing'], 'bus')
        self.assertEqual(body['locations'][0]['heading'], 0)
        self.assertNotIn('heading', body['locations'][1], 'no bearing, no invented heading')
        self.assertTrue(all(location['type'] == 'break' for location in body['locations']))


class ValidationTests(unittest.TestCase):
    def test_a_shape_is_accepted_only_when_enough_reports_lie_close_to_it(self):
        shape = [A, B, C]
        near = [(53.450 + i * 0.0001, -2.30 + 0.00012) for i in range(ACCEPT_MIN_REPORTS)]   # ~8 m off
        stats = validate(shape, near)
        self.assertLess(stats['p95'], ACCEPT_P95_METRES)
        self.assertEqual(decide(stats), ('accepted', None))
        few = validate(shape, near[:5])
        self.assertEqual(decide(few)[0], 'rejected')
        self.assertIn('only 5 reports', decide(few)[1])
        wide = validate(shape, [(lat, lon + 0.002) for lat, lon in near])                    # ~130 m off
        self.assertEqual(decide(wide)[0], 'rejected')
        self.assertIn('95%', decide(wide)[1])

    def test_distance_to_the_shape_is_measured_to_the_nearest_segment(self):
        self.assertAlmostEqual(offset_from([A, B], (-2.30, 53.452)), 0.0, places=3)
        self.assertAlmostEqual(offset_from([A, B], (-2.2985, 53.452)), 99.3, delta=1.5)


if __name__ == '__main__':
    unittest.main()


class DegenerateGeometryTests(unittest.TestCase):
    """A router answer with no usable road is refused for that pattern, not raised over the build."""

    def test_a_shape_needs_two_points_to_be_a_road(self):
        self.assertFalse(usable([]))
        self.assertFalse(usable([(1.0, 2.0)]), 'one point is a place, not a path')
        self.assertFalse(usable([1.0, 2.0]), 'a bare pair is not a list of points')
        self.assertFalse(usable([(1.0, 2.0), 3.0]), 'a float among the points is not a point')
        self.assertTrue(usable([(1.0, 2.0), (1.1, 2.1)]))

    def test_validation_is_never_asked_to_measure_against_a_non_path(self):
        # Before 21 September 2026 this raised TypeError out of offset_from and ended the whole
        # run, so every later service in the batch was left unbuilt by one bad router answer.
        self.assertFalse(usable([1.0, 2.0]))
