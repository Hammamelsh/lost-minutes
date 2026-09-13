"""The walking router the page is told to use, and how a local override changes it."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

try:
    import duckdb  # noqa: F401
    HAS_DUCKDB = True
except ModuleNotFoundError:
    HAS_DUCKDB = False


@unittest.skipUnless(HAS_DUCKDB, 'DuckDB not installed; see requirements.txt')
class WalkingConfigTests(unittest.TestCase):
    def test_the_default_is_the_fossgis_foot_router_with_its_policy_links(self):
        from pipeline.live import walking_config
        config = walking_config({})
        self.assertEqual((config['provider'], config['profile']), ('osrm', 'foot'))
        self.assertEqual(config['baseUrl'], 'https://routing.openstreetmap.de/routed-foot')
        self.assertEqual(config['fixTheMapUrl'], 'https://www.openstreetmap.org/fixthemap')
        self.assertTrue(config['policyUrl'] and config['privacyUrl'])

    def test_a_local_override_points_at_another_server_or_switches_directions_off(self):
        from pipeline.live import walking_config
        local = walking_config({'LM_WALKING_ROUTER': 'http://localhost:5000/'})
        self.assertEqual((local['baseUrl'], local['name']), ('http://localhost:5000', 'localhost:5000'))
        self.assertIsNone(local['policyUrl'], "FOSSGIS's policy is not another server's policy")
        off = walking_config({'LM_WALKING_ROUTER': 'none'})
        self.assertEqual((off['provider'], off['baseUrl']), ('none', None))
        with self.assertRaises(ValueError):
            walking_config({'LM_WALKING_ROUTER': 'http://example.com'})   # plain http off this machine

    def test_the_runtime_config_carries_the_walking_router(self):
        from pipeline.live import _config, walking_config
        self.assertEqual(_config(20)['walking'], walking_config())


if __name__ == '__main__':
    unittest.main()
