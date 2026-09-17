"""Placing a bus on a service pattern, and refusing to when the evidence does not support it."""
import gzip
import io
import json
import shutil
import sys
import tempfile
import unittest
import zipfile
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

try:
    import duckdb  # noqa: F401
    HAS_DUCKDB = True
except ModuleNotFoundError:
    HAS_DUCKDB = False

from pipeline.match import (AMBIGUOUS_MARGIN_METRES, MAX_METRES_FROM_PATTERN,  # noqa: E402
                            match_vehicle, metres_between, same_destination)
from pipeline.service_days import describe, pattern_runs_on  # noqa: E402

SUNDAY, MONDAY = date(2026, 9, 13), date(2026, 9, 14)
WEEKDAYS_ONLY = [{'days': [0, 1, 2, 3, 4]}]


# A straight north-south chain of stops roughly 300 m apart, which is urban Manchester spacing.
def chain(prefix, count, lat0=53.470, lon=-2.240, step=0.0027):
    return [(i, f'{prefix}{i:02d}', i * 300, (lat0 + i * step, lon)) for i in range(count)]


def extend(base, prefix, count, d_lat, d_lon):
    """Continue a chain from its last stop in a new direction: where two branches part."""
    last = base[-1]
    return base + [(last[0] + i + 1, f'{prefix}{i:02d}', last[2] + 300 * (i + 1),
                    (last[3][0] + d_lat * (i + 1), last[3][1] + d_lon * (i + 1)))
                   for i in range(count)]


def pattern(pid, line, direction, placed, loop=False, stops=None, destination='Town', **extra):
    return {'id': pid, 'line': line, 'direction': direction, 'destination': destination,
            'loop': loop, 'stopCount': stops or len(placed), 'placed': placed,
            'sequence': [s[1] for s in placed], **extra}


class MatchTests(unittest.TestCase):
    def setUp(self):
        self.main = pattern('p-main', '142', 'inbound', chain('A', 10))

    def bus(self, lat, lon, route='142', direction='inbound', **extra):
        return {'route': route, 'direction': direction, 'lat': lat, 'lon': lon, **extra}

    def test_a_bus_beside_a_pattern_stop_is_placed_on_it(self):
        stop = self.main['placed'][4]
        result = match_vehicle(self.bus(stop[3][0] + 0.0002, stop[3][1]), [self.main])
        self.assertTrue(result['matched'])
        self.assertEqual(result['patternIndex'], 4)
        self.assertEqual(result['nearestStop'], 'A04')
        self.assertEqual(result['metresAlongPattern'], 1200)
        self.assertLess(result['metresFromPatternStop'], 40)
        self.assertEqual(result['evidence']['resolvedBy'], 'position')

    def test_a_route_we_hold_no_timetable_for_is_refused_with_that_reason(self):
        result = match_vehicle(self.bus(53.47, -2.24, route='999'), [self.main])
        self.assertEqual(result['reason'], 'no_pattern_for_route')

    def test_the_opposite_direction_is_refused_rather_than_matched_anyway(self):
        stop = self.main['placed'][3]
        result = match_vehicle(self.bus(stop[3][0], stop[3][1], direction='outbound'), [self.main])
        self.assertEqual(result['reason'], 'no_pattern_for_direction')

    def test_a_direction_held_for_other_days_is_not_the_same_as_one_never_held(self):
        """Route 256, 17 September 2026: the registration in force has Saturday and Sunday
        journeys towards Piccadilly Gardens and no Monday-to-Friday ones at all. Saying
        "not for the direction the operator reported" reads as "this bus does not go that way".
        What is true is that the timetable cannot say, on this day."""
        weekend = pattern('p-weekend', '256', 'inbound', chain('A', 10), rules=[{'days': [5, 6]}])
        weekday_other_way = pattern('p-school', '256', 'outbound', chain('A', 10),
                                    rules=[{'days': [0, 1, 2, 3]}])
        stop = weekend['placed'][3]
        here = self.bus(stop[3][0], stop[3][1], route='256', direction='inbound')
        thursday = match_vehicle(here, [weekend, weekday_other_way], day=MONDAY)
        self.assertEqual(thursday['reason'], 'no_pattern_for_direction_today')
        # The same bus at the weekend is placed, so the refusal really is about the day.
        saturday = match_vehicle(here, [weekend, weekday_other_way], day=date(2026, 9, 19))
        self.assertTrue(saturday['matched'])
        # A direction the timetable never describes keeps the plainer reason.
        never = match_vehicle(self.bus(stop[3][0], stop[3][1], route='256', direction='clockwise'),
                              [weekend], day=date(2026, 9, 19))
        self.assertEqual(never['reason'], 'no_pattern_for_direction')

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
        # Two patterns sharing the position but with different stops there.
        left = pattern('p-left', '50', 'inbound', chain('L', 6, lon=-2.2400))
        right = pattern('p-right', '50', 'inbound', chain('R', 6, lon=-2.2400))
        here = left['placed'][2][3]
        result = match_vehicle(self.bus(here[0], here[1], route='50'), [left, right])
        self.assertEqual(result['reason'], 'ambiguous_branch')
        self.assertEqual(sorted(c['patternId'] for c in result['candidates']), ['p-left', 'p-right'])
        # Different current stops: nothing downstream can be claimed for both.
        self.assertNotIn('nearestStop', result)

    def test_branches_sharing_the_nearest_stop_stay_unresolved_with_what_they_share(self):
        # Regression, 13 September 2026: two branches share A00-A04 and part after A04. A bus
        # beside A03 used to be matched to whichever branch had more stops. Its position says
        # nothing about which way it will turn; only the stops both branches share can be said.
        trunk = chain('A', 5)
        north = pattern('p-north', '50', 'inbound', extend(trunk, 'N', 5, 0.0027, 0))
        east = pattern('p-east', '50', 'inbound', extend(trunk, 'E', 3, 0, 0.0045))
        here = trunk[3][3]
        result = match_vehicle(self.bus(here[0], here[1], route='50'), [north, east])
        self.assertFalse(result['matched'])
        self.assertEqual(result['reason'], 'ambiguous_branch')
        self.assertEqual({c['patternId'] for c in result['candidates']}, {'p-north', 'p-east'})
        self.assertEqual({c['patternIndex'] for c in result['candidates']}, {3})
        self.assertEqual(result['nearestStop'], 'A03')
        self.assertEqual(result['sharedNext'], ['A04'])

    def test_branches_differing_only_behind_the_bus_share_everything_ahead_but_stay_unresolved(self):
        trunk = chain('S', 6)
        start = trunk[0][3]
        west = [(0, 'W00', 0, (start[0], start[1] - 0.006)), (1, 'W01', 300, (start[0], start[1] - 0.003))]
        east = [(0, 'E00', 0, (start[0], start[1] + 0.006)), (1, 'E01', 300, (start[0], start[1] + 0.003))]
        shifted = [(i + 2, atco, metres + 600, where) for i, atco, metres, where in trunk]
        from_west = pattern('p-west', '142', 'inbound', west + shifted)
        from_east = pattern('p-east', '142', 'inbound', east + shifted)
        here = trunk[3][3]
        result = match_vehicle(self.bus(here[0], here[1]), [from_west, from_east])
        self.assertEqual(result['reason'], 'ambiguous_branch', 'which pattern it runs is still unknown')
        self.assertTrue(result['sharedOnward'])
        self.assertEqual(result['sharedNext'], ['S04', 'S05'])
        # Branches that part ahead do not share onward progress.
        north = pattern('p-north', '142', 'inbound', extend(trunk, 'N', 3, 0.0027, 0))
        east_turn = pattern('p-turn', '142', 'inbound', extend(trunk, 'T', 3, 0, 0.0045))
        parting = match_vehicle(self.bus(trunk[3][3][0], trunk[3][3][1]), [north, east_turn])
        self.assertEqual(parting['reason'], 'ambiguous_branch')
        self.assertFalse(parting['sharedOnward'])

    def test_a_short_working_does_not_quietly_become_the_full_route(self):
        full = pattern('p-full', '50', 'inbound', chain('A', 10))
        short = pattern('p-short', '50', 'inbound', chain('A', 6))
        here = full['placed'][2][3]
        result = match_vehicle(self.bus(here[0], here[1], route='50'), [full, short])
        self.assertEqual(result['reason'], 'ambiguous_branch')
        # Both call at A03, A04 and A05 next, so those remain supportable.
        self.assertEqual(result['sharedNext'], ['A03', 'A04', 'A05'])

    def test_the_operators_reported_destination_can_settle_a_branch(self):
        trunk = chain('A', 5)
        north = pattern('p-north', '50', 'inbound', extend(trunk, 'N', 5, 0.0027, 0),
                        destination='Moorside')
        east = pattern('p-east', '50', 'inbound', extend(trunk, 'E', 3, 0, 0.0045),
                       destination='Eastlands')
        here = trunk[3][3]
        result = match_vehicle(self.bus(here[0], here[1], route='50',
                                        destination='Eastlands_Interchange'), [north, east])
        self.assertTrue(result['matched'])
        self.assertEqual(result['patternId'], 'p-east')
        self.assertEqual(result['evidence']['resolvedBy'], 'reported_destination')

    def test_a_destination_both_branches_share_settles_nothing(self):
        trunk = chain('A', 5)
        north = pattern('p-north', '50', 'inbound', extend(trunk, 'N', 5, 0.0027, 0))
        east = pattern('p-east', '50', 'inbound', extend(trunk, 'E', 3, 0, 0.0045))
        here = trunk[3][3]
        result = match_vehicle(self.bus(here[0], here[1], route='50', destination='Town'),
                               [north, east])
        self.assertEqual(result['reason'], 'ambiguous_branch')

    def test_identical_stop_lists_from_two_files_are_one_path_not_a_choice(self):
        one = pattern('p-weekday', '50', 'inbound', chain('A', 8))
        two = pattern('p-saturday', '50', 'inbound', chain('A', 8))
        here = one['placed'][4][3]
        result = match_vehicle(self.bus(here[0], here[1], route='50'), [one, two])
        self.assertTrue(result['matched'])
        self.assertEqual(result['evidence']['plausiblePaths'], 1)

    def test_a_clearly_closer_branch_wins_over_a_distant_one(self):
        near = pattern('p-near', '50', 'inbound', chain('N', 6, lon=-2.2400))
        far = pattern('p-far', '50', 'inbound', chain('F', 6, lon=-2.2600))
        here = near['placed'][3][3]
        result = match_vehicle(self.bus(here[0], here[1], route='50'), [near, far])
        self.assertTrue(result['matched'])
        self.assertEqual(result['patternId'], 'p-near')
        self.assertGreater(metres_between(here[0], here[1], far['placed'][3][3][0],
                                          far['placed'][3][3][1]), AMBIGUOUS_MARGIN_METRES)

    def test_a_route_number_alone_is_not_a_service_the_operator_must_match(self):
        theirs = pattern('p-other', '142', 'inbound', chain('A', 10), operator='BNSM')
        here = theirs['placed'][4][3]
        result = match_vehicle(self.bus(here[0], here[1], operator='BNML'), [theirs])
        self.assertEqual(result['reason'], 'no_pattern_for_operator')
        same = pattern('p-same', '142', 'inbound', chain('A', 10), operator='BNML')
        self.assertTrue(match_vehicle(self.bus(here[0], here[1], operator='BNML'),
                                      [theirs, same])['matched'])

    def test_a_timetable_version_not_valid_on_the_day_is_not_used(self):
        expired = pattern('p-old', '142', 'inbound', chain('A', 10),
                          validFrom=date(2026, 7, 19), validTo=date(2026, 8, 29))
        here = expired['placed'][4][3]
        result = match_vehicle(self.bus(here[0], here[1]), [expired], MONDAY)
        self.assertEqual(result['reason'], 'no_pattern_valid_on_date')

    def test_a_weekday_only_pattern_cannot_be_the_one_running_on_a_sunday(self):
        weekday = pattern('p-weekday', '142', 'inbound', chain('A', 10), rules=WEEKDAYS_ONLY)
        here = weekday['placed'][4][3]
        self.assertEqual(match_vehicle(self.bus(here[0], here[1]), [weekday], SUNDAY)['reason'],
                         'no_pattern_operating_today')
        result = match_vehicle(self.bus(here[0], here[1]), [weekday], MONDAY)
        self.assertTrue(result['matched'])
        self.assertEqual(result['evidence']['weekday'], 'Monday')
        self.assertTrue(result['evidence']['operatingDayChecked'])

    def test_a_sunday_pattern_removes_the_ambiguity_a_weekday_branch_would_add(self):
        trunk = chain('A', 5)
        weekday = pattern('p-school', '50', 'inbound', extend(trunk, 'N', 5, 0.0027, 0),
                          rules=WEEKDAYS_ONLY)
        daily = pattern('p-daily', '50', 'inbound', extend(trunk, 'E', 3, 0, 0.0045),
                        rules=[{'days': list(range(7))}])
        here = trunk[3][3]
        result = match_vehicle(self.bus(here[0], here[1], route='50'), [weekday, daily], SUNDAY)
        self.assertTrue(result['matched'])
        self.assertEqual(result['patternId'], 'p-daily')

    def test_term_time_journeys_run_only_inside_the_school_calendar(self):
        rules = [{'days': [0, 1, 2, 3, 4], 'serviced': [
            {'mode': 'only', 'kind': 'WorkingDays', 'organisations': ['SCH'],
             'ranges': [['2026-09-01', '2026-10-23']]}]}]
        self.assertTrue(pattern_runs_on(rules, MONDAY))
        self.assertFalse(pattern_runs_on(rules, date(2026, 10, 26)))    # half term
        self.assertIsNone(pattern_runs_on(None, MONDAY))                 # unknown, not false
        # TfGM keeps holiday calendars the same way as term ones, so the words stay neutral.
        self.assertEqual(describe(rules), 'Mon–Fri, on listed calendar dates only')
        self.assertEqual(describe([{'days': [5]}, {'days': [0, 1, 2, 3, 4]}]), 'Mon–Sat')

    def test_a_pattern_with_no_stops_in_our_area_cannot_place_anything(self):
        empty = pattern('p-empty', '3', 'inbound', [], stops=20)
        result = match_vehicle(self.bus(53.47, -2.24, route='3'), [empty])
        self.assertEqual(result['reason'], 'no_stop_coordinates')

    def test_a_bus_with_no_direction_supplied_still_matches_a_directed_pattern(self):
        stop = self.main['placed'][6]
        result = match_vehicle(self.bus(stop[3][0], stop[3][1], direction=''), [self.main])
        self.assertTrue(result['matched'])
        self.assertEqual(result['patternIndex'], 6)
        self.assertFalse(result['evidence']['directionReported'])

    def test_an_undeclared_distance_is_published_as_unknown(self):
        placed = [(i, f'A{i:02d}', None if i >= 3 else i * 300, (53.47 + i * 0.0027, -2.24))
                  for i in range(8)]
        unknown = pattern('p-unknown', '142', 'inbound', placed)
        result = match_vehicle(self.bus(placed[5][3][0], placed[5][3][1]), [unknown])
        self.assertTrue(result['matched'])
        self.assertIsNone(result['metresAlongPattern'])

    def test_destinations_are_compared_conservatively(self):
        self.assertTrue(same_destination('Stockport_Interchange', 'Stockport'))
        self.assertTrue(same_destination('Piccadilly Gardens', 'Piccadilly_Gardens'))
        self.assertFalse(same_destination('Piccadilly Gardens', 'Roedean Gardens'))
        self.assertFalse(same_destination('', 'Town'))


TXC = """<?xml version="1.0"?>
<TransXChange xmlns="http://www.transxchange.org.uk/" ModificationDateTime="2026-08-28T14:35:06" RevisionNumber="9">
  <ServicedOrganisations><ServicedOrganisation><OrganisationCode>SCH</OrganisationCode>
    <WorkingDays><DateRange><StartDate>2026-09-01</StartDate><EndDate>2026-10-23</EndDate></DateRange></WorkingDays>
  </ServicedOrganisation></ServicedOrganisations>
  <Operators><Operator id="O1"><NationalOperatorCode>{operator}</NationalOperatorCode></Operator></Operators>
  <Services><Service><ServiceCode>SVC{line}</ServiceCode>
    <Lines><Line id="L1"><LineName>{line}</LineName></Line></Lines>
    <OperatingPeriod><StartDate>2026-08-30</StartDate><EndDate>2031-08-30</EndDate></OperatingPeriod>
    <OperatingProfile><RegularDayType><DaysOfWeek><MondayToFriday/></DaysOfWeek></RegularDayType></OperatingProfile>
    <StandardService>
      <JourneyPattern id="jp_1"><DestinationDisplay>Town</DestinationDisplay><Direction>inbound</Direction>
        <JourneyPatternSectionRefs>js_1</JourneyPatternSectionRefs><JourneyPatternSectionRefs>js_2</JourneyPatternSectionRefs>
      </JourneyPattern>
      <JourneyPattern id="jp_unused"><DestinationDisplay>Nowhere</DestinationDisplay><Direction>inbound</Direction>
        <JourneyPatternSectionRefs>js_1</JourneyPatternSectionRefs>
      </JourneyPattern>
    </StandardService></Service></Services>
  <JourneyPatternSections>
    <JourneyPatternSection id="js_1">{links1}</JourneyPatternSection>
    <JourneyPatternSection id="js_2">{links2}</JourneyPatternSection>
  </JourneyPatternSections>
  <VehicleJourneys>
    <VehicleJourney><VehicleJourneyCode>vj_1</VehicleJourneyCode><JourneyPatternRef>jp_1</JourneyPatternRef><DepartureTime>07:00:00</DepartureTime></VehicleJourney>
    <VehicleJourney><VehicleJourneyCode>vj_2</VehicleJourneyCode><JourneyPatternRef>jp_1</JourneyPatternRef><DepartureTime>09:00:00</DepartureTime>
      <OperatingProfile><RegularDayType><DaysOfWeek><Saturday/></DaysOfWeek></RegularDayType></OperatingProfile></VehicleJourney>
    <VehicleJourney><VehicleJourneyCode>vj_3</VehicleJourneyCode><JourneyPatternRef>jp_1</JourneyPatternRef><DepartureTime>08:10:00</DepartureTime>
      <OperatingProfile><RegularDayType><DaysOfWeek><MondayToFriday/></DaysOfWeek></RegularDayType>
        <ServicedOrganisationDayType><DaysOfOperation><WorkingDays><ServicedOrganisationRef>SCH</ServicedOrganisationRef></WorkingDays></DaysOfOperation></ServicedOrganisationDayType>
      </OperatingProfile></VehicleJourney>
  </VehicleJourneys>
</TransXChange>"""


def link(a, b, metres):
    distance = '' if metres is None else f'<Distance>{metres}</Distance>'
    return (f'<JourneyPatternTimingLink><From><StopPointRef>{a}</StopPointRef></From>'
            f'<To><StopPointRef>{b}</StopPointRef></To>{distance}</JourneyPatternTimingLink>')


def txc(operator='TST', line='142', stops=('S1', 'S2', 'S3', 'S4', 'S5'), distances=(300, 250, 400, 100)):
    pairs = list(zip(stops, stops[1:], distances))
    return TXC.format(operator=operator, line=line,
                      links1=''.join(link(*p) for p in pairs[:2]),
                      links2=''.join(link(*p) for p in pairs[2:])).encode()


@unittest.skipUnless(HAS_DUCKDB, 'DuckDB not installed; see requirements.txt')
class PatternExtractionTests(unittest.TestCase):
    def test_a_journey_pattern_becomes_an_ordered_stop_list_with_distances(self):
        from pipeline.patterns import extract_patterns
        patterns = extract_patterns(txc(), 'test.xml', 'sha', '2026-01-01', '2031-01-01')
        # The declared-but-never-run pattern is not a path anyone takes, so it is dropped.
        self.assertEqual(len(patterns), 1)
        found = patterns[0]
        self.assertEqual((found['lineName'], found['operatorCode'], found['direction']),
                         ('142', 'TST', 'inbound'))
        # The stop shared by the two sections appears once, not twice.
        self.assertEqual([atco for atco, _ in found['stops']], ['S1', 'S2', 'S3', 'S4', 'S5'])
        # Distances accumulate across the section boundary.
        self.assertEqual([m for _, m in found['stops']], [0, 300, 550, 950, 1050])
        # The service's own validity and version, not just the file name's.
        self.assertEqual((found['validFrom'], found['validTo']), ('2026-08-30', '2031-08-30'))
        self.assertEqual((found['modified'], found['revision']), ('2026-08-28T14:35:06', '9'))

    def test_a_missing_link_distance_makes_the_rest_unknown_not_zero(self):
        from pipeline.patterns import extract_patterns
        found = extract_patterns(txc(distances=(300, None, 400, 100)), 't.xml', 'sha', None, None)[0]
        self.assertEqual([m for _, m in found['stops']], [0, 300, None, None, None])

    def test_operating_days_come_from_the_service_and_each_journey(self):
        from pipeline.patterns import extract_patterns
        found = extract_patterns(txc(), 't.xml', 'sha', None, None)[0]
        self.assertEqual(found['journeys'], 3)
        days = sorted(tuple(rule['days']) for rule in found['rules'])
        self.assertIn((0, 1, 2, 3, 4), days)                 # inherited from the service
        self.assertIn((5,), days)                            # the Saturday journey's own
        school = [r for r in found['rules'] if r.get('serviced')]
        self.assertEqual(school[0]['serviced'][0]['ranges'], [['2026-09-01', '2026-10-23']])
        self.assertFalse(pattern_runs_on(found['rules'], SUNDAY))
        self.assertTrue(pattern_runs_on(found['rules'], date(2026, 9, 19)))   # a Saturday

    def test_identical_stop_sequences_collapse_to_one_pattern_per_operator(self):
        from pipeline.patterns import deduplicate
        base = {'lineName': '1', 'direction': 'inbound', 'stops': [('A', 0), ('B', 100)],
                'operatorCode': 'X', 'rules': [{'days': [0]}], 'journeys': 1}
        other = {**base, 'rules': [{'days': [5]}], 'journeys': 2}
        different = {**base, 'direction': 'outbound', 'stops': [('B', 0), ('A', 100)]}
        another_operator = {**base, 'operatorCode': 'Y'}
        merged = deduplicate([base, other, different, another_operator])
        self.assertEqual(len(merged), 3)
        first = next(p for p in merged if p['operatorCode'] == 'X' and p['direction'] == 'inbound')
        self.assertEqual(sorted(r['days'][0] for r in first['rules']), [0, 5])
        self.assertEqual(first['journeys'], 3)

    def test_file_names_with_numeric_or_uuid_suffixes_are_both_recognised(self):
        from pipeline.patterns import FILENAME
        for name in ('BNML_15_BNMLPC20734281801041015_20260830_20310719_2415966.xml',
                     'BNFM_456_BNFMPC000368018010262456_20251224_20301123_ce3b80a8-dc21-4bd9-9e9f-f3717df6150b.xml'):
            match = FILENAME.match(name)
            self.assertIsNotNone(match, name)
        self.assertEqual(FILENAME.match('BNFM_456_X_20251224_20301123_ce3b80a8-dc21.xml')['line'], '456')


@unittest.skipUnless(HAS_DUCKDB, 'DuckDB not installed; see requirements.txt')
class CoverageSelectionTests(unittest.TestCase):
    """The build used to keep only the 14 most-observed lines. Coverage is now deliberate."""

    LINES = [f'L{i}' for i in range(1, 17)]

    def setUp(self):
        from pipeline.warehouse import connect
        self.root = Path(tempfile.mkdtemp(prefix='lost-minutes-patterns-'))
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)
        folder = self.root / 'data/live-capture/timetables'
        folder.mkdir(parents=True)
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w') as archive:
            for line in self.LINES + ['UNSEEN']:
                stops = tuple(f'{line}S{i}' for i in range(5))
                archive.writestr(f'TST_{line}_TSTPC1_20260830_20310830_{line.lower()}-uuid.xml',
                                 txc(line=line, stops=stops))
        (folder / ('a' * 64 + '.bin.gz')).write_bytes(gzip.compress(buffer.getvalue()))
        self.db = self.root / 'data/warehouse/test.duckdb'
        con = connect(self.db)
        con.execute('CREATE TABLE stop (atco_code TEXT PRIMARY KEY, lat DOUBLE, lon DOUBLE)')
        for line in self.LINES + ['UNSEEN']:
            for i in range(5):
                con.execute('INSERT INTO stop VALUES (?, ?, ?)', [f'{line}S{i}', 53.47 + i * 0.003, -2.24])
        con.execute("INSERT INTO raw_source (source_sha256, source_kind) VALUES ('b', 'live_positions')")
        for n, line in enumerate(self.LINES):
            for k in range(n + 1):     # L16 most observed, L1 least
                con.execute(
                    "INSERT INTO observation (operator, vehicle, route, direction, journey_ref,"
                    " observed_at_ms, observed_at, recorded_at_text, lat, lon, source_sha256)"
                    " VALUES ('TST', ?, ?, 'inbound', 'J', ?, now(), 'x', 53.47, -2.24, 'b')",
                    [f'V{line}{k}', line, 1_000 + k])
        con.close()

    def build(self, **kwargs):
        from pipeline.patterns import build
        return build(root=self.root, db_path=self.db, log=lambda *_: None,
                     today=date(2026, 9, 14), **kwargs)

    def test_every_observed_service_with_a_valid_file_is_built_with_no_hidden_cap(self):
        published = self.build()
        self.assertEqual(published['schemaVersion'], 2)
        self.assertEqual(sorted(published['supportedLines']), sorted(self.LINES))   # 16 > 14
        self.assertEqual(published['coverage']['selection'], 'observed_services')
        self.assertIsNone(published['coverage']['cap'])
        self.assertNotIn('UNSEEN', published['supportedLines'])
        self.assertTrue(all(p['operator'] == 'TST' and p['runs'] for p in published['patterns']))

    def test_a_cap_is_explicit_recorded_and_keeps_the_most_observed(self):
        published = self.build(max_lines=3)
        self.assertEqual(sorted(published['supportedLines']), ['L14', 'L15', 'L16'])
        self.assertEqual(published['coverage']['cap'], 3)

    def test_all_valid_files_and_named_lines_are_selectable(self):
        self.assertIn('UNSEEN', self.build(coverage='all')['supportedLines'])
        self.assertEqual(self.build(lines=['L2', 'UNSEEN'])['supportedLines'], ['L2', 'UNSEEN'])


@unittest.skipUnless(HAS_DUCKDB, 'DuckDB not installed; see requirements.txt')
class PublicationRuleTests(unittest.TestCase):
    """Whether a service runs today is a question about its whole timetable.

    Until September 2026 a pattern was published, and matched against, only when 60% of its
    stops lay inside the collected area. Sunday's 219 runs a longer path, 45% inside, so every
    219 seen on a Sunday was told its timetable had no journeys that day.
    """

    INSIDE = [f'IN{i:02d}' for i in range(10)]
    OUTSIDE = [f'OUT{i:02d}' for i in range(20)]

    def setUp(self):
        from pipeline.patterns import load
        from pipeline.warehouse import connect
        root = Path(tempfile.mkdtemp(prefix='lost-minutes-publish-'))
        self.addCleanup(shutil.rmtree, root, ignore_errors=True)
        self.con = connect(root / 'test.duckdb')
        self.addCleanup(self.con.close)
        self.con.execute('CREATE TABLE stop (atco_code TEXT PRIMARY KEY, lat DOUBLE, lon DOUBLE)')
        for i, code in enumerate(self.INSIDE):
            self.con.execute('INSERT INTO stop VALUES (?, ?, ?)', [code, 53.47 + i * 0.003, -2.24])
        load(self.con, 'test-run', [
            self.held('219', self.INSIDE, [0, 1, 2, 3, 4]),                # weekdays, all inside
            self.held('219', self.INSIDE[:5] + self.OUTSIDE[:10], [6]),    # Sundays, 5 of 15
            self.held('231', self.OUTSIDE, [6]),                           # Sundays, none inside
        ], set(self.INSIDE))

    @staticmethod
    def held(line, codes, days):
        return {'stops': [(code, i * 300) for i, code in enumerate(codes)],
                'datasetSha256': 'a' * 64, 'sourceFile': f'TST_{line}_x.xml', 'lineName': line,
                'serviceCode': f'S{line}', 'operatorCode': 'TST', 'direction': 'outbound',
                'destination': 'Ashton', 'validFrom': date(2026, 8, 30),
                'validTo': date(2031, 8, 30), 'rules': [{'days': days}], 'journeys': 4}

    @staticmethod
    def bus(line):
        return {'route': line, 'operator': 'TST', 'direction': 'outbound',
                'lat': 53.47 + 2 * 0.003, 'lon': -2.24}

    def test_a_pattern_calling_at_any_stop_in_the_area_is_published(self):
        from pipeline.patterns import build_published
        published = build_published(self.con)
        self.assertEqual(sorted(p['stopsInArea'] for p in published['patterns']), [5, 10])
        self.assertEqual(published['rules']['minimumStopsInArea'], 1)

    def test_a_sunday_journey_mostly_outside_the_area_still_places_a_sunday_bus(self):
        from pipeline.match import load_patterns
        result = match_vehicle(self.bus('219'), load_patterns(self.con), SUNDAY)
        self.assertTrue(result['matched'], result)
        self.assertEqual(result['nearestStop'], 'IN02')
        self.assertTrue(result['evidence']['operatingDayChecked'])

    def test_journeys_today_wholly_outside_the_area_are_not_called_no_journeys(self):
        from pipeline.match import load_patterns
        result = match_vehicle(self.bus('231'), load_patterns(self.con), SUNDAY)
        self.assertEqual(result['reason'], 'no_stop_coordinates')


class ReconciliationTests(unittest.TestCase):
    """Every vehicle offered for matching must land in exactly one bucket."""

    def test_matched_plus_every_reason_accounts_for_the_whole_population(self):
        from pipeline.match import match_all
        import pipeline.match as module
        patterns = [{'id': 'p', 'line': '1', 'direction': 'inbound', 'destination': 'Town',
                     'loop': False, 'stopCount': 6, 'operator': 'OP',
                     'placed': [(i, f'S{i}', i * 300, (53.47 + i * 0.0027, -2.24)) for i in range(6)]}]
        original = module.load_patterns
        module.load_patterns = lambda con: patterns
        try:
            vehicles = [
                {'route': '1', 'direction': 'inbound', 'lat': 53.4700, 'lon': -2.2400, 'operator': 'OP'},
                {'route': '1', 'direction': 'outbound', 'lat': 53.4700, 'lon': -2.2400, 'operator': 'OP'},
                {'route': '9', 'direction': 'inbound', 'lat': 53.4700, 'lon': -2.2400, 'operator': 'OP'},
                {'route': '1', 'direction': 'inbound', 'lat': 53.9000, 'lon': -2.9000, 'operator': 'OP'},
                {'route': '1', 'direction': 'inbound', 'lat': 53.4700, 'lon': -2.2400, 'operator': 'ZZ'},
            ]
            summary = match_all(None, vehicles)
        finally:
            module.load_patterns = original
        self.assertEqual(summary['matched'] + sum(summary['reasons'].values()), len(vehicles))
        self.assertEqual(summary['matched'] + summary['unmatched'], len(vehicles))
        self.assertEqual(summary['reasons'],
                         {'no_pattern_for_direction': 1, 'no_pattern_for_route': 1,
                          'too_far_from_pattern': 1, 'no_pattern_for_operator': 1})
        for vehicle in vehicles:
            self.assertIn('match', vehicle)
            self.assertEqual(1, ('patternId' in vehicle['match']) + ('unresolved' in vehicle['match']))
            json.dumps(vehicle['match'])      # publishable as it stands


if __name__ == '__main__':
    unittest.main()
