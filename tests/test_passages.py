"""Inferred stop passages: a crossing between two reports, with its uncertainty; not a report near a stop."""
import unittest

from pipeline.passages import MAX_GAP_S, Track, infer_passages

# A straight road heading east from Stretford, 3 km, a vertex every 50 m; stops at 500, 1500, 2500 m.
LAT, LON = 53.4487, -2.3095
M_LON = 111320 * 0.5955   # metres per degree of longitude at this latitude
east = lambda m: (LAT, LON + m / M_LON)
TRACK = Track([east(i * 50) for i in range(61)], [500.0, 1500.0, 2500.0])
STOPS = ['S1', 'S2', 'S3']
T0 = 1_700_000_000_000


def journey(offsets_and_times):
    return {'v|07:00:00': [(T0 + t * 1000, *east(m)) for m, t in offsets_and_times]}


class PassageInferenceTests(unittest.TestCase):
    def test_a_crossing_between_two_reports_is_a_passage_timed_by_interpolation(self):
        # 8 m/s: at 400 m at t=50, at 560 m at t=70. S1 at 500 m is 5/8 of the way: t=62.5.
        reports = journey([(0, 0), (80, 10), (160, 20), (240, 30), (320, 40), (400, 50), (560, 70), (640, 80)])
        passages, summary = infer_passages('P', STOPS, reports, TRACK)
        self.assertEqual(summary['scoreable'], 1)
        p = passages[0]
        self.assertEqual(p.stop_id, 'S1')
        self.assertAlmostEqual(p.passed_at_ms, T0 + 62_500, delta=10)   # ms; the synthetic track's metres-per-degree is rounded
        self.assertEqual(p.gap_s, 20)
        self.assertEqual(p.uncertainty_s, 10)
        self.assertTrue(p.scoreable)

    def test_a_report_near_a_stop_with_no_crossing_is_not_a_passage(self):
        # Reports sit 30 m short of S1 and never go past it: nothing is inferred.
        reports = journey([(0, 0), (100, 10), (200, 20), (300, 30), (400, 40), (470, 50), (470, 70), (470, 90)])
        passages, summary = infer_passages('P', STOPS, reports, TRACK)
        self.assertEqual(passages, [])

    def test_a_wide_gap_is_recorded_but_never_scored(self):
        reports = journey([(0, 0), (80, 10), (160, 20), (240, 30), (320, 40), (400, 50), (700, 50 + MAX_GAP_S + 30), (780, 150)])
        passages, summary = infer_passages('P', STOPS, reports, TRACK)
        self.assertEqual(summary['passages'], 1)
        self.assertEqual(summary['unbounded'], 1)
        self.assertEqual(summary['scoreable'], 0)
        self.assertFalse(passages[0].scoreable)

    def test_a_backwards_step_is_a_jump_and_produces_no_passage(self):
        # 450 -> 300 (backwards) -> 600: the crossing of S1 happens across a jump and is not believed.
        reports = journey([(0, 0), (100, 10), (200, 20), (300, 30), (450, 40), (300, 50), (600, 60), (700, 70)])
        passages, summary = infer_passages('P', STOPS, reports, TRACK)
        self.assertEqual(summary['backwardsSkipped'], 1)
        # The 300 -> 600 step after the jump does cross S1 and is a passage on its own evidence.
        self.assertEqual([p.stop_id for p in passages], ['S1'])
        self.assertAlmostEqual(passages[0].before_offset_m, 300, delta=0.1)

    def test_a_second_visit_is_kept_apart_and_not_scored(self):
        reports = journey([(0, 0), (200, 10), (400, 20), (600, 30), (400, 40), (450, 50), (600, 60), (700, 70)])
        passages, summary = infer_passages('P', STOPS, reports, TRACK)
        visits = [(p.stop_id, p.visit, p.scoreable) for p in passages]
        self.assertIn(('S1', 1, True), visits)
        self.assertIn(('S1', 2, False), visits)
        self.assertEqual(summary['repeatVisits'], 1)

    def test_reports_off_the_road_are_not_placed(self):
        far = (LAT + 0.002, LON + 400 / M_LON)   # 220 m north of the road, at 400 m along
        reports = {'v|07:00:00': [(T0 + t * 1000, *east(m)) for m, t in [(0, 0), (100, 10), (200, 20), (300, 30)]]
                   + [(T0 + 40_000, *far)] + [(T0 + t * 1000, *east(m)) for m, t in [(560, 70), (640, 80), (720, 90)]]}
        passages, summary = infer_passages('P', STOPS, reports, TRACK)
        self.assertEqual(summary['reportsOffRoad'], 1)
        self.assertEqual(summary['reportsPlaced'], 7)
        # The crossing 300 -> 560 brackets S1 across the dropped report: gap 40 s, still scoreable.
        self.assertEqual([p.stop_id for p in passages], ['S1'])
        self.assertEqual(passages[0].gap_s, 40)

    def test_too_few_reports_gives_nothing_rather_than_a_guess(self):
        passages, summary = infer_passages('P', STOPS, journey([(0, 0), (600, 60)]), TRACK)
        self.assertEqual(passages, [])
        self.assertEqual(summary['journeysTooFewReports'], 1)


if __name__ == '__main__':
    unittest.main()
