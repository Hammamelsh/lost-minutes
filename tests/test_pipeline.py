import unittest
from pipeline.core import observations, deduplicate, redact_url, timestamp


def fixture(recorded='2026-09-11T07:00:00Z', latitude='53.47', vehicle='123'):
    return f'''<Siri xmlns="http://www.siri.org.uk/siri"><ServiceDelivery><VehicleMonitoringDelivery><VehicleActivity><RecordedAtTime>{recorded}</RecordedAtTime><MonitoredVehicleJourney><OperatorRef>OP</OperatorRef><LineRef>42</LineRef><VehicleRef>{vehicle}</VehicleRef><FramedVehicleJourneyRef><DatedVehicleJourneyRef>trip1</DatedVehicleJourneyRef></FramedVehicleJourneyRef><VehicleLocation><Longitude>-2.24</Longitude><Latitude>{latitude}</Latitude></VehicleLocation></MonitoredVehicleJourney></VehicleActivity></VehicleMonitoringDelivery></ServiceDelivery></Siri>'''.encode()


class SourceTests(unittest.TestCase):
    def parse(self, **kwargs):
        return observations(fixture(**kwargs), 'source', '2026-09-11T07:00:10Z')

    def test_nested_journey_id_and_offset(self):
        records, errors = self.parse()
        self.assertEqual(records[0]['journeyRef'], 'trip1')
        self.assertEqual(records[0]['time'], timestamp('2026-09-11T08:00:00+01:00'))
        self.assertFalse(errors)

    def test_naive_time_and_nonfinite_location_rejected(self):
        self.assertFalse(self.parse(recorded='2026-09-11T07:00:00')[0])
        self.assertFalse(self.parse(latitude='nan')[0])

    def test_repeat_snapshot_not_new_observation(self):
        records, _ = self.parse()
        unique, duplicates, conflicts = deduplicate(records + records)
        self.assertEqual((len(unique), duplicates, conflicts), (1, 1, 0))

    def test_stationary_bus_with_new_time_is_new_observation(self):
        a, _ = self.parse()
        b, _ = self.parse(recorded='2026-09-11T07:00:30Z')
        self.assertEqual(len(deduplicate(a + b)[0]), 2)

    def test_conflicting_location_is_quarantined(self):
        a, _ = self.parse()
        b, _ = self.parse(latitude='53.48')
        unique, _, conflicts = deduplicate(a + b)
        self.assertEqual((len(unique), conflicts), (0, 1))

    def test_operator_is_part_of_identity(self):
        records, _ = self.parse()
        other = {**records[0], 'operator': 'OTHER'}
        self.assertEqual(len(deduplicate(records + [other])[0]), 2)

    def test_credentials_not_logged(self):
        url = redact_url('https://u:secret@example.com/feed?api_key=private&boundingBox=1,2,3,4')
        self.assertNotIn('private', url)
        self.assertNotIn('secret', url)
        self.assertIn('boundingBox', url)

    def test_xml_entity_declarations_rejected(self):
        with self.assertRaises(ValueError):
            observations(b'<!DOCTYPE Siri><Siri/>', 'hash', 'now')


if __name__ == '__main__':
    unittest.main()
