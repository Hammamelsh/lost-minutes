"""Placing a bus on a service pattern, and refusing to when the evidence does not support it."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

try:
    import duckdb  # noqa: F401
    HAS_DUCKDB = True
except ModuleNotFoundError:
    HAS_DUCKDB = False

from pipeline.match import (AMBIGUOUS_MARGIN_METRES, MAX_METRES_FROM_PATTERN,  # noqa: E402
                            match_vehicle, metres_between)

# A straight north-south chain of stops roughly 300 m apart, which is urban Manchester spacing.
def chain(prefix, count, lat0=53.470, lon=-2.240, step=0.0027):
    return [(i, f'{prefix}{i:02d}', i * 300, (lat0 + i * step, lon)) for i in range(count)]


def pattern(pid, line, direction, placed, loop=False, stops=None):
    return {'id': pid, 'line': line, 'direction': direction, 'destination': 'Town',
            'loop': loop, 'stopCount': stops or len(placed), 'placed': placed}


class MatchTests(unittest.TestCase):
    def setUp(self):
        self.main = pattern('p-main', '142', 'inbound', chain('A', 10))

    def bus(self, lat, lon, route='142', direction='inbound'):
        return {'route': route, 'direction': direction, 'lat': lat, 'lon': lon}

    def test_a_bus_beside_a_pattern_stop_is_placed_on_it(self):
        stop = self.main['placed'][4]
        result = match_vehicle(self.bus(stop[3][0] + 0.0002, stop[3][1]), [self.main])
        self.assertTrue(result['matched'])
        self.assertEqual(result['patternIndex'], 4)
        self.assertEqual(result['nearestStop'], 'A04')
        self.assertEqual(result['metresAlongPattern'], 1200)
        self.assertLess(result['metresFromPatternStop'], 40)

    def test_a_route_we_hold_no_timetable_for_is_refused_with_that_reason(self):
        result = match_vehicle(self.bus(53.47, -2.24, route='999'), [self.main])
        self.assertEqual(result, {'matched': False, 'reason': 'no_pattern_for_route'})

    def test_the_opposite_direction_is_refused_rather_than_matched_anyway(self):
        stop = self.main['placed'][3]
        result = match_vehicle(self.bus(stop[3][0], stop[3][1], direction='outbound'), [self.main])
        self.assertEqual(result['reason'], 'no_pattern_for_direction')

    def test_a_bus_far_from_every_stop_is_not_placed(self):
        # Well beyond the threshold: being near nothing is not evidence of being anywhere.
        result = match_vehicle(self.bus(53.40, -2.40), [self.main])
        self.assertEqual(result['reason'], 'too_far_from_pattern')
        self.assertGreater(result['nearestPatternMetres'], MAX_METRES_FROM_PATTERN)

    def test_a_loop_pattern_is_refused_because_progress_is_ambiguous(self):
        looping = pattern('p-loop', '7', 'inbound', chain('L', 8), loop=True)
        stop = looping['placed'][2]
        result = match_vehicle(self.bus(stop[3][0], stop[3][1], route='7'), [looping])
        self.assertEqual(result['reason'], 'loop_pattern')

    def test_two_branches_fitting_equally_well_are_refused_not_guessed(self):
        # Two patterns sharing the position but diverging in their stop lists.
        left = pattern('p-left', '50', 'inbound', chain('L', 6, lon=-2.2400))
        right = pattern('p-right', '50', 'inbound', chain('R', 6, lon=-2.2400))
        here = left['placed'][2][3]
        result = match_vehicle(self.bus(here[0], here[1], route='50'), [left, right])
        self.assertEqual(result['reason'], 'ambiguous_branch')
        self.assertEqual(sorted(result['candidates']), ['p-left', 'p-right'])

    def test_a_clearly_closer_branch_wins_over_a_distant_one(self):
        near = pattern('p-near', '50', 'inbound', chain('N', 6, lon=-2.2400))
        far = pattern('p-far', '50', 'inbound', chain('F', 6, lon=-2.2600))
        here = near['placed'][3][3]
        result = match_vehicle(self.bus(here[0], here[1], route='50'), [near, far])
        self.assertTrue(result['matched'])
        self.assertEqual(result['patternId'], 'p-near')
        self.assertGreater(metres_between(here[0], here[1], far['placed'][3][3][0],
                                          far['placed'][3][3][1]), AMBIGUOUS_MARGIN_METRES)

    def test_a_pattern_with_no_stops_in_our_area_cannot_place_anything(self):
        empty = pattern('p-empty', '3', 'inbound', [], stops=20)
        result = match_vehicle(self.bus(53.47, -2.24, route='3'), [empty])
        self.assertEqual(result['reason'], 'no_stop_coordinates')

    def test_a_bus_with_no_direction_supplied_still_matches_a_directed_pattern(self):
        stop = self.main['placed'][6]
        result = match_vehicle(self.bus(stop[3][0], stop[3][1], direction=''), [self.main])
        self.assertTrue(result['matched'])
        self.assertEqual(result['patternIndex'], 6)


@unittest.skipUnless(HAS_DUCKDB, 'DuckDB not installed; see requirements.txt')
class PatternExtractionTests(unittest.TestCase):
    def test_a_journey_pattern_becomes_an_ordered_stop_list_with_distances(self):
        from pipeline.patterns import extract_patterns
        xml = b"""<?xml version="1.0"?>
        <TransXChange xmlns="http://www.transxchange.org.uk/">
          <Services><Service><ServiceCode>SVC1</ServiceCode>
            <Lines><Line><LineName>142</LineName></Line></Lines>
            <StandardService>
              <JourneyPattern id="jp_1"><DestinationDisplay>Town</DestinationDisplay>
                <Direction>inbound</Direction>
                <JourneyPatternSectionRefs>js_1</JourneyPatternSectionRefs>
                <JourneyPatternSectionRefs>js_2</JourneyPatternSectionRefs>
              </JourneyPattern>
            </StandardService></Service></Services>
          <JourneyPatternSections>
            <JourneyPatternSection id="js_1">
              <JourneyPatternTimingLink><From><StopPointRef>S1</StopPointRef></From>
                <To><StopPointRef>S2</StopPointRef></To><Distance>300</Distance></JourneyPatternTimingLink>
              <JourneyPatternTimingLink><From><StopPointRef>S2</StopPointRef></From>
                <To><StopPointRef>S3</StopPointRef></To><Distance>250</Distance></JourneyPatternTimingLink>
            </JourneyPatternSection>
            <JourneyPatternSection id="js_2">
              <JourneyPatternTimingLink><From><StopPointRef>S3</StopPointRef></From>
                <To><StopPointRef>S4</StopPointRef></To><Distance>400</Distance></JourneyPatternTimingLink>
              <JourneyPatternTimingLink><From><StopPointRef>S4</StopPointRef></From>
                <To><StopPointRef>S5</StopPointRef></To><Distance>100</Distance></JourneyPatternTimingLink>
            </JourneyPatternSection>
          </JourneyPatternSections>
        </TransXChange>"""
        patterns = extract_patterns(xml, 'test.xml', 'sha', '2026-01-01', '2031-01-01')
        self.assertEqual(len(patterns), 1)
        found = patterns[0]
        self.assertEqual(found['lineName'], '142')
        self.assertEqual(found['direction'], 'inbound')
        # The stop shared by the two sections appears once, not twice.
        self.assertEqual([atco for atco, _ in found['stops']], ['S1', 'S2', 'S3', 'S4', 'S5'])
        # Distances accumulate across the section boundary.
        self.assertEqual([m for _, m in found['stops']], [0, 300, 550, 950, 1050])

    def test_identical_stop_sequences_collapse_to_one_pattern(self):
        from pipeline.patterns import deduplicate
        base = {'lineName': '1', 'direction': 'inbound', 'stops': [('A', 0), ('B', 100)]}
        other = {'lineName': '1', 'direction': 'inbound', 'stops': [('A', 0), ('B', 100)]}
        different = {'lineName': '1', 'direction': 'outbound', 'stops': [('B', 0), ('A', 100)]}
        self.assertEqual(len(deduplicate([base, other, different])), 2)


if __name__ == '__main__':
    unittest.main()
