"""Pooling nightly evaluations: days are the unit, a re-run replaces, and nothing before the amendment counts."""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def entry(day, journeys, passages, errs, scored_at='2026-09-21T04:10:00+01:00'):
    return {'day': day, 'scoredAt': scored_at, 'weekday': True, 'candidate': 'blended',
            'directions': {'outbound': {'journeys': journeys, 'passages': passages, 'absErrorsReleaseBand': errs},
                           'inbound': {'journeys': 0, 'passages': 0, 'absErrorsReleaseBand': []}}}


class ReleaseCheckTests(unittest.TestCase):
    def run_check(self, entries):
        with tempfile.TemporaryDirectory() as tmp:
            nightly = Path(tmp) / 'nightly.jsonl'
            nightly.write_text(''.join(json.dumps(e) + '\n' for e in entries))
            out = Path(tmp) / 'release.json'
            subprocess.run([sys.executable, str(ROOT / 'scripts/arrival-release-check.py'), '--nightly', str(nightly), '--out', str(out)],
                           check=True, capture_output=True)
            return json.loads(out.read_text())

    def test_the_same_day_scored_four_times_is_one_day(self):
        # 5 journeys, 40 passages, four runs of the same Sunday: must not pool to 20 journeys.
        same = [entry('2026-09-20', 5, 40, [1.0] * 40, scored_at=f'2026-09-20T18:0{i}:00+01:00') for i in range(4)]
        v = self.run_check(same)
        self.assertEqual(v['nights'], 1)
        self.assertEqual(v['directions']['outbound']['journeys'], 5)
        self.assertEqual(v['directions']['outbound']['passages'], 40)
        self.assertFalse(v['directions']['outbound']['checks']['journeys>=20'])
        self.assertEqual(v['released'], [])

    def test_a_later_scoring_of_a_day_replaces_the_earlier_one(self):
        v = self.run_check([entry('2026-09-21', 3, 30, [2.0] * 30, '2026-09-22T04:00:00+01:00'),
                            entry('2026-09-21', 8, 60, [1.0] * 60, '2026-09-22T04:20:00+01:00')])
        self.assertEqual(v['nights'], 1)
        self.assertEqual(v['directions']['outbound']['journeys'], 8, 'the later run of the same day wins')

    def test_days_before_the_amendment_count_toward_nothing(self):
        v = self.run_check([entry('2026-09-17', 30, 300, [0.5] * 300), entry('2026-09-21', 4, 20, [1.0] * 20)])
        self.assertEqual(v['nights'], 1)
        self.assertEqual(v['days'], ['2026-09-21'])
        self.assertEqual(v['directions']['outbound']['journeys'], 4)

    def test_enough_distinct_days_can_release_a_direction(self):
        days = [entry(f'2026-09-{21 + i}', 6, 40, [1.0] * 40) for i in range(4)]   # 24 journeys, 160 passages, weekdays
        v = self.run_check(days)
        self.assertEqual(v['nights'], 4)
        self.assertTrue(v['directions']['outbound']['released'])
        self.assertEqual(v['released'], ['outbound'])
        self.assertFalse(v['directions']['inbound']['released'], 'no inbound evidence, no inbound release')


if __name__ == '__main__':
    unittest.main()


class NightlyEvaluationReadsTheCatalogueTests(unittest.TestCase):
    """The nightly evaluation names a journey's timing from the warehouse's departures. Since 23 September
    2026 each is stored as [time, timing, rule]; reading them as pairs failed every night from the 24th."""

    def test_a_journey_is_named_from_departures_stored_with_their_rule(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location('evaluate_arrival', ROOT / 'scripts/evaluate-arrival.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        stored = json.dumps({'timings': [[0, 60, 120], [0, 90, 180]],
                             'departures': [['07:05:00', 0, 2], ['07:25:00', 1, 2], ['07:45:00', 0, 2], ['07:45:00', 1, 3]],
                             'departureFields': ['time', 'timing', 'rule']})
        dep_info = {'P': module._departure_info(stored)}
        pattern = {'id': 'P', 'seconds': [0, 60, 120]}
        timing, departed = module.scheduled_for(pattern, dep_info, 'V1|2026-09-28T07:25:00+01:00')
        self.assertEqual(timing, [0, 90, 180], 'the 07:25 runs the second timing')
        self.assertEqual(departed, module.wall_to_ms(__import__('datetime').date(2026, 9, 28), '07:25:00'))
        self.assertIsNone(module.scheduled_for(pattern, dep_info, 'V1|2026-09-28T07:45:00+01:00'),
                          'two journeys at 07:45 on different timings name neither')
        # The older pair form still reads, as the warehouse's own reader allows.
        pairs = {'P': module._departure_info(json.dumps({'timings': [[0, 60, 120]], 'departures': [['07:05:00', 0]]}))}
        self.assertEqual(module.scheduled_for(pattern, pairs, 'V1|2026-09-28T07:05:00+01:00')[0], [0, 60, 120])
