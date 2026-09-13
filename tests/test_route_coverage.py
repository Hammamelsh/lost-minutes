"""The route coverage check keeps its four answers apart and never claims more than is published."""
import unittest

from pipeline.route_coverage import coverage_report, render


def published(**over):
    base = {
        'patterns': {'generatedAt': '2026-09-13T12:00:00Z', 'coverage': {'observedServicesWithoutTimetableExamples': [
            {'operator': 'BNGN', 'line': '10', 'observations': 3034}]},
            'patterns': [
                {'id': 'BNML:15:inbound:a', 'operator': 'BNML', 'line': '15', 'direction': 'inbound',
                 'destination': 'Piccadilly Gardens', 'stops': ['S1', 'S2', 'S3'], 'runs': 'Mon–Sun', 'journeys': 140,
                 'timetable': {'validFrom': '2026-08-30', 'validTo': '2031-07-19', 'file': 'BNML_15.xml'}},
                {'id': 'BNML:15:outbound:b', 'operator': 'BNML', 'line': '15', 'direction': 'outbound',
                 'destination': 'Roedean Gardens', 'stops': ['S3', 'S2', 'S1'], 'runs': 'Mon–Sun', 'journeys': 138,
                 'timetable': {'validFrom': '2026-08-30', 'validTo': '2031-07-19', 'file': 'BNML_15.xml'}},
                {'id': 'BNML:245:outbound:c', 'operator': 'BNML', 'line': '245', 'direction': 'outbound',
                 'destination': 'Trafford Centre', 'stops': ['S9', 'S8'], 'runs': 'Mon–Sat', 'journeys': 30,
                 'timetable': {'validFrom': '2026-08-30', 'validTo': '2031-07-19', 'file': 'BNML_245.xml'}}]},
        'shapes': {'patterns': {'BNML:15:inbound:a': {'status': 'accepted', 'reason': None,
                                                        'validation': {'reports': 412, 'offsetP95Metres': 18}},
                                'BNML:15:outbound:b': {'status': 'rejected', 'reason': 'only 0 reports on this pattern'}}},
        'motion': {'version': 'motion-3', 'corridor': {'lines': ['15'], 'patterns': ['BNML:15:inbound:a']}},
        'live': {'publishedAt': '2026-09-13T20:19:50Z', 'state': 'live', 'vehicles': [
            {'operator': 'BNML', 'vehicle': 'A', 'route': '15', 'match': {'patternId': 'BNML:15:inbound:a'}},
            {'operator': 'BNML', 'vehicle': 'B', 'route': '15', 'match': {'unresolved': 'ambiguous_branch'}},
            {'operator': 'BNGN', 'vehicle': 'C', 'route': '10', 'match': {'unresolved': 'no_pattern_for_route'}}]},
        'stops': {'stops': [{'id': 'S2', 'name': 'Marston Road', 'indicator': 'nr'}]},
    }
    base.update(over)
    return base


class RouteCoverage(unittest.TestCase):
    def test_four_answers_are_kept_apart(self):
        report = coverage_report('15', published(), stop='S2')
        self.assertEqual(report['answers'], {'timetable': True, 'geometry': True, 'estimates': True,
                                             'observedNow': True, 'observedBefore': None})
        self.assertEqual([p['callsAtStop'] for p in report['timetable']['patterns']], [True, True])
        self.assertEqual(report['timetable']['stop']['name'], 'Marston Road')
        geometry = {p['id']: p['status'] for p in report['geometry']['patterns']}
        self.assertEqual(geometry, {'BNML:15:inbound:a': 'accepted', 'BNML:15:outbound:b': 'rejected'})
        self.assertEqual([p['evaluated'] for p in report['estimates']['patterns']], [True, False])
        self.assertEqual(report['observations']['publication']['placement'], {'placed': 1, 'ambiguous_branch': 1})

    def test_a_route_with_patterns_but_no_geometry_or_evaluation_says_each_separately(self):
        report = coverage_report('245', published())
        self.assertTrue(report['answers']['timetable'])
        self.assertFalse(report['answers']['geometry'])
        self.assertFalse(report['answers']['estimates'])
        self.assertFalse(report['answers']['observedNow'])
        self.assertEqual(report['geometry']['patterns'][0]['status'], 'not built')
        text = render(report)
        self.assertIn('Not evaluated for this line: its buses are shown at their reports only.', text)
        self.assertIn('not built: no road shape has been built for this pattern', text)

    def test_an_observed_route_without_a_timetable_is_not_called_covered(self):
        report = coverage_report('10', published())
        self.assertFalse(report['answers']['timetable'])
        self.assertTrue(report['answers']['observedNow'])
        self.assertEqual(report['observations']['publication']['placement'], {'no_pattern_for_route': 1})
        self.assertIn('observed 3034 times with no timetable held', render(report))

    def test_missing_files_are_reported_not_guessed(self):
        report = coverage_report('15', published(patterns=None, live=None, shapes=None, motion=None))
        self.assertFalse(report['timetable']['published'])
        self.assertFalse(report['answers']['timetable'])
        self.assertIn('patterns.json is missing', render(report))
        self.assertIn('live.json is missing', render(report))

    def test_history_is_reported_only_when_it_was_counted(self):
        report = coverage_report('15', published(), history={'counted': False, 'reason': 'the warehouse is in use'})
        self.assertIsNone(report['answers']['observedBefore'])
        self.assertIn('Warehouse history not counted: the warehouse is in use.', render(report))
        counted = coverage_report('15', published(), history={'counted': True, 'days': 7, 'observations': 812,
                                                              'vehicles': 9, 'first': 'a', 'last': 'b', 'byUtcDay': []})
        self.assertTrue(counted['answers']['observedBefore'])


if __name__ == '__main__':
    unittest.main()
