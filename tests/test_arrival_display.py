"""The display protocol's parts (pipeline/arrival_display.py): when a page holds a report, which moments it shows,
how errors are kept and pooled, and the journey as the unit of resampling."""
import unittest

from pipeline import arrival_display as ad


class HoldTests(unittest.TestCase):
    def test_a_page_holds_a_report_from_the_first_publication_after_it_plus_its_mean_poll_wait(self):
        publications = [1_000, 21_000, 41_000]
        self.assertEqual(ad.first_hold(5_000, publications), 21_000 + ad.POLL_WAIT_S * 1000)
        self.assertEqual(ad.first_hold(21_000, publications), 21_000 + ad.POLL_WAIT_S * 1000)
        self.assertIsNone(ad.first_hold(50_000, publications), 'no publication followed: never held')


class _Track:
    """A straight road: offset = metres east of the start; reports carry their offset as their longitude."""
    stop_offsets = [0.0, 1000.0, 2000.0, 3000.0]

    def project(self, p, near=None):
        return (p[1], 0.0)


class _Ev:
    @staticmethod
    def scheduled_for(pattern, dep_info, key):
        return None

    @staticmethod
    def blended_eta(placed, at, offset, j, offsets, params, cruise, track, timing):
        t, s = placed[at]
        return int(t + (offset - s) / 5.0 * 1000)          # 5 m/s, exactly


class ScoreJourneyTests(unittest.TestCase):
    def test_minutes_are_shown_only_inside_the_band_and_only_with_one_pattern_before_the_stop(self):
        pattern = {'id': 'P', 'seconds': [0, 200, 400, 600]}
        match = {'matched': True, 'patternId': 'P', 'patternIndex': 0}
        # Six reports 20 s apart at 5 m/s from 0 m; the bus passes stop 3 (3,000 m) at 600 s, as estimated.
        reports = [(k * 20_000, 0.0, k * 100.0, k * 20_000, match) for k in range(6)]
        publications = [k * 20_000 + 1 for k in range(40)]
        passage = {'stop_index': 3, 'stop_id': 'S3', 'stop_offset_m': 3000.0, 'passed_at_ms': 600_000}
        acc = ad.score_journey(_Ev, pattern, _Track(), {}, 'J', reports, [passage], {}, 8.0, publications)
        shown = sum(acc['signed'].values())
        self.assertGreater(shown, 0)
        self.assertEqual(set(acc['signed']), {0}, 'estimated exactly: every error is 0')
        # A report the live match puts on another pattern shows nothing, though the bus is coming.
        other = [(t, la, lo, r, {'matched': False, 'candidates': ['P', 'Q']}) for t, la, lo, r, _ in reports]
        acc2 = ad.score_journey(_Ev, pattern, _Track(), {}, 'J', other, [passage], {}, 8.0, publications)
        self.assertEqual(sum(acc2['signed'].values()), 0)
        self.assertGreater(acc2['eligible'], 0, 'the moments still count against coverage')
        self.assertEqual(acc2['eligibleShown'], 0)


class PoolingTests(unittest.TestCase):
    def journey(self, key, errors, passages=1):
        signed = {}
        for e in errors:
            signed[ad.bin_of(e)] = signed.get(ad.bin_of(e), 0) + 1
        return {'journey': key, 'pattern': 'P', 'signed': sorted([b, c] for b, c in signed.items()),
                'pairedCandidate': [], 'pairedTimetable': [], 'eligible': len(errors), 'eligibleShown': len(errors),
                'passages': passages}

    def test_pooled_quantiles_signed_errors_and_the_interval_are_read_from_the_histograms(self):
        journeys = [self.journey('A', [-1.0, 0.5, 2.0, 3.0]), self.journey('B', [1.0, 1.0, 4.0, 6.0])]
        r = ad.summarise(journeys, interval=(-1.15, 5.75))
        self.assertEqual(r['moments'], 8)
        self.assertEqual(r['journeys'], 2)
        self.assertAlmostEqual(r['medianAbs'], 1.0)
        self.assertAlmostEqual(r['shareLater'], 7 / 8)
        self.assertAlmostEqual(r['intervalCoverage'], 7 / 8, msg='6.0 lies outside the interval')
        self.assertEqual(r['coverage'], 1.0)

    def test_resampling_is_by_whole_journey_and_repeatable(self):
        journeys = [self.journey(str(k), [0.1 * k, 0.2 * k, 3.0]) for k in range(30)]
        a = ad.bootstrap(journeys, (-1.0, 2.0), resamples=200)
        b = ad.bootstrap(journeys, (-1.0, 2.0), resamples=200)
        self.assertEqual(a, b, 'seeded: the same journeys give the same intervals')
        self.assertLessEqual(a['medianAbs95'][0], a['medianAbs95'][1])


if __name__ == '__main__':
    unittest.main()
