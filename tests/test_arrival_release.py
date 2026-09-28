"""Pooling nightly evaluations: days are the unit, a re-run replaces, nothing before 21 September counts,
every criterion is read, and only a scope an approval names field for field is released."""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODEL = 'blended@9a626129f782'
SCOPE = {'operator': 'BNML', 'line': '15', 'direction': 'outbound', 'patternIds': ['BNML:15:outbound:c9291c1aea'], 'model': MODEL}


def entry(day, journeys, passages, errs, scored_at='2026-09-22T04:10:00+01:00', weekday=True, model=MODEL,
          moments=None, with_estimate=None, candidate_abs=None, scheduled_abs=None, shown=None):
    d = {'journeys': journeys, 'passages': passages, 'absErrorsReleaseBand': errs,
         'moments': len(errs) if moments is None else moments, 'withEstimate': len(errs) if with_estimate is None else with_estimate,
         'bothCandidateAbs': errs if candidate_abs is None else candidate_abs,
         'bothScheduledAbs': [e + 1.0 for e in errs] if scheduled_abs is None else scheduled_abs,
         'patternIds': ['BNML:15:outbound:c9291c1aea'], 'absErrorsShownBand': errs if shown is None else shown}
    return {'day': day, 'scoredAt': scored_at, 'weekday': weekday, 'candidate': 'blended', 'model': model,
            'operator': 'BNML', 'line': '15', 'stopMapping': 2, 'directions': {'outbound': d}}


def passing(days=('2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24'), **over):
    return [entry(day, 6, 40, [1.0] * 40, **over) for day in days]    # 24 journeys, 160 passages, weekdays


class ReleaseCheckTests(unittest.TestCase):
    def run_check(self, entries, approval=None):
        with tempfile.TemporaryDirectory() as tmp:
            nightly = Path(tmp) / 'nightly.jsonl'
            nightly.write_text(''.join(json.dumps(e) + '\n' for e in entries))
            out = Path(tmp) / 'release.json'
            extra = []
            if approval is not None:
                (Path(tmp) / 'approval.json').write_text(json.dumps(approval))
                extra = ['--approval', str(Path(tmp) / 'approval.json')]
            subprocess.run([sys.executable, str(ROOT / 'scripts/arrival-release-check.py'), '--nightly', str(nightly), '--out', str(out), *extra],
                           check=True, capture_output=True)
            return json.loads(out.read_text())

    def test_the_same_day_scored_four_times_is_one_day(self):
        same = [entry('2026-09-21', 5, 40, [1.0] * 40, scored_at=f'2026-09-22T04:0{i}:00+01:00') for i in range(4)]
        v = self.run_check(same, {'approved': [SCOPE]})
        self.assertEqual(v['nights'], 1)
        self.assertEqual(v['directions']['outbound']['journeys'], 5)
        self.assertFalse(v['directions']['outbound']['checks']['journeys>=20'])
        self.assertEqual(v['scopes'], [])

    def test_a_later_scoring_of_a_day_replaces_the_earlier_one(self):
        v = self.run_check([entry('2026-09-21', 3, 30, [2.0] * 30, '2026-09-22T04:00:00+01:00'),
                            entry('2026-09-21', 8, 60, [1.0] * 60, '2026-09-22T04:20:00+01:00')])
        self.assertEqual(v['directions']['outbound']['journeys'], 8, 'the later run of the same day wins')

    def test_days_up_to_the_reserved_sunday_count_toward_nothing(self):
        # 20 September was the reserved set, scored and read that evening: not held out.
        v = self.run_check([entry('2026-09-17', 30, 300, [0.5] * 300), entry('2026-09-20', 30, 300, [0.5] * 300),
                            entry('2026-09-21', 4, 20, [1.0] * 20)])
        self.assertEqual(v['days'], ['2026-09-21'])
        self.assertEqual(v['directions']['outbound']['journeys'], 4)

    def test_every_criterion_is_read(self):
        ok = self.run_check(passing(), {'approved': [SCOPE]})
        self.assertTrue(ok['directions']['outbound']['passed'])
        # Not half a minute better than the timetable where both exist: not released.
        close = self.run_check(passing(scheduled_abs=[1.2] * 40), {'approved': [SCOPE]})
        self.assertFalse(close['directions']['outbound']['checks']['betterThanScheduledBy0.5'])
        self.assertEqual(close['scopes'], [])
        # An estimate at under half the moments: not released.
        thin = self.run_check(passing(moments=100), {'approved': [SCOPE]})
        self.assertFalse(thin['directions']['outbound']['checks']['coverage>=50%'])
        self.assertEqual(thin['scopes'], [])
        # No weekday: not released.
        weekend = self.run_check(passing(weekday=False), {'approved': [SCOPE]})
        self.assertFalse(weekend['directions']['outbound']['checks']['weekdayNights>=1'])

    def test_a_night_without_the_new_counts_counts_toward_nothing(self):
        old = [{'day': d, 'scoredAt': 'x', 'weekday': True, 'candidate': 'blended',
                'directions': {'outbound': {'journeys': 6, 'passages': 40, 'absErrorsReleaseBand': [1.0] * 40}}}
               for d in ('2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24')]
        v = self.run_check(old, {'approved': [SCOPE]})
        self.assertEqual(v['nights'], 0)
        self.assertEqual(v['scopes'], [])

    def test_a_night_scored_before_the_stop_mapping_counts_toward_nothing(self):
        # Until 28 September 2026 passages were paired with stops by list position (inbound 15 by 14 stops).
        old = [{**e, 'stopMapping': None} for e in passing()]
        verdict = self.run_check(old)
        self.assertEqual(verdict['nights'], 0)
        self.assertEqual(sorted(verdict['skippedNights']), ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24'])
        self.assertEqual(verdict['directions'], {})

    def test_only_an_exact_approval_releases_and_only_what_it_names(self):
        self.assertEqual(self.run_check(passing())['scopes'], [], 'no approval file: nothing')
        held = self.run_check(passing(), {'approved': []})
        self.assertEqual(held['scopes'], [])
        self.assertEqual([p['direction'] for p in held['awaitingApproval']], ['outbound'])
        self.assertEqual(self.run_check(passing(), {'approved': ['outbound']})['scopes'], [], 'a bare direction approves nothing')
        for field, value in (('operator', 'BNSM'), ('line', '15A'), ('direction', 'inbound'), ('model', 'blended@000000000000')):
            self.assertEqual(self.run_check(passing(), {'approved': [{**SCOPE, field: value}]})['scopes'], [], f'another {field}')
        unevaluated = {**SCOPE, 'patternIds': ['BNML:15:outbound:ffffffffff']}
        self.assertEqual(self.run_check(passing(), {'approved': [unevaluated]})['scopes'], [], 'a pattern never scored')
        agreed = self.run_check(passing(), {'approved': [SCOPE]})
        self.assertEqual(len(agreed['scopes']), 1)
        self.assertEqual({k: agreed['scopes'][0][k] for k in SCOPE}, SCOPE)
        self.assertEqual(agreed['released'], [], 'the list pages before 28 September read stays empty')
        # Approval releases nothing that has not passed.
        self.assertEqual(self.run_check(passing(days=('2026-09-21',)), {'approved': [SCOPE]})['scopes'], [])

    def test_the_moments_a_page_would_show_are_reported_beside_the_criteria(self):
        v = self.run_check(passing(shown=[4.0] * 40), {'approved': []})
        band = v['directions']['outbound']['shownBand']
        self.assertEqual(band['medianAbs'], 4.0)
        self.assertTrue(v['directions']['outbound']['passed'], 'reported, not a criterion')

    def test_the_shipped_approval_file_approves_nothing_and_the_unit_reads_it(self):
        approval = json.loads((ROOT / 'deploy/arrival-release-approval.json').read_text())
        self.assertEqual(approval['approved'], [])
        unit = (ROOT / 'deploy/systemd/lost-minutes-arrival-eval.service').read_text()
        self.assertIn('--approval deploy/arrival-release-approval.json', unit)


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
