"""Inferred stop passages: a crossing between two reports, with its uncertainty; not a report near a stop."""
import unittest

from pipeline.passages import MAX_GAP_S, Track, infer_passages
from pipeline.stop_mapping import aligned_offsets, from_placed

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



class PatternStartingOutsideTheAreaTests(unittest.TestCase):
    """Inbound 15 calls at 14 stops outside the service area before its first inside it; its road is built
    through the 47 inside only. Read by list position, the road's offsets named every passage after the
    stop 14 earlier, and its timetable, read there, looked 15 minutes early (28 September 2026). Here two
    stops outside come first, and the road's stop mapping says which stop each offset is."""
    PATTERN = ['O1', 'O2', 'S1', 'S2', 'S3']
    MAPPING = from_placed('P', 5, [(2, 'S1'), (3, 'S2'), (4, 'S3')], [500.0, 1500.0, 2500.0])

    def offsets(self):
        return aligned_offsets(self.MAPPING, 'P', self.PATTERN)

    def test_the_offsets_are_put_on_the_patterns_own_stops(self):
        self.assertEqual(self.offsets(), [None, None, 500.0, 1500.0, 2500.0])

    def test_each_passage_is_named_after_its_own_stop(self):
        track = Track(TRACK.points, self.offsets())
        reports = journey([(0, 0), (80, 10), (160, 20), (240, 30), (320, 40), (400, 50), (560, 70), (640, 80)])
        passages, _ = infer_passages('P', self.PATTERN, reports, track)
        self.assertEqual([(p.stop_id, p.stop_index) for p in passages], [('S1', 2)])

    def test_the_evaluator_reads_the_timetable_at_the_right_stops(self):
        import importlib.util
        from pathlib import Path
        spec = importlib.util.spec_from_file_location('evaluate_arrival', Path(__file__).resolve().parents[1] / 'scripts/evaluate-arrival.py')
        ev = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(ev)
        # Scheduled seconds from the origin: O1 0, O2 600 (both outside), S1 900, S2 960, S3 1020.
        timing = [0, 600, 900, 960, 1020]
        track = Track(TRACK.points, self.offsets())
        self.assertEqual(ev.scheduled_seconds_at(track, timing, 1000.0), 930, 'halfway from S1 to S2')
        # From 1000 m to S3 (index 4) is 90 scheduled seconds. By the old indexing the road's offsets met the
        # timetable of the stops two earlier, and this read 900 - 300 = 600 s.
        self.assertEqual(ev.remaining_eta([(T0, 1000.0)], 0, 4, track, timing), T0 + 90_000)


class ScheduleAnchorTests(unittest.TestCase):
    def test_a_pattern_with_nothing_at_its_first_stops_keeps_no_verdict_from_before(self):
        """A pattern re-read with no passages at its first stops (all outside the area) is not checked: an
        earlier verdict for it is dropped, not kept, so the page says unchecked rather than a withdrawn reason."""
        import importlib.util
        from pathlib import Path
        spec = importlib.util.spec_from_file_location('schedule_anchor', Path(__file__).resolve().parents[1] / 'scripts/schedule-anchor.py')
        anchor = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(anchor)
        existing = {'P:in': {'verified': False, 'reason': 'schedule runs 15 min early'}, 'Q:other-line': {'verified': True}}
        merged = anchor.merged_verdicts(existing, read={'P:in', 'P:out'}, fresh={'P:out': {'verified': True}})
        self.assertEqual(merged, {'P:out': {'verified': True}, 'Q:other-line': {'verified': True}})


if __name__ == '__main__':
    unittest.main()
