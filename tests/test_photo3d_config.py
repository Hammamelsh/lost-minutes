"""The photographic 3D tileset the page is told to offer, from the server's own environment only."""
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
class Photo3dConfigTests(unittest.TestCase):
    def test_nothing_configured_offers_nothing(self):
        from pipeline.live import _config, photo3d_config
        self.assertIsNone(photo3d_config({}))
        self.assertNotIn('photo3d', _config(20) if 'LM_PHOTO3D_GOOGLE_KEY' not in __import__('os').environ else {})

    def test_a_google_key_names_googles_tileset_and_is_labelled_as_captured_imagery(self):
        from pipeline.live import photo3d_config
        config = photo3d_config({'LM_PHOTO3D_GOOGLE_KEY': 'EXAMPLE_KEY_NOT_REAL_0123456789abcdef'})
        self.assertEqual(config['provider'], 'google')
        self.assertTrue(config['tilesetUrl'].startswith('https://tile.googleapis.com/v1/3dtiles/root.json?key='))
        self.assertIn('not a live camera', config['note'])
        with self.assertRaises(ValueError):
            photo3d_config({'LM_PHOTO3D_GOOGLE_KEY': 'short'})

    def test_a_sample_tileset_is_labelled_as_a_sample_and_must_be_https(self):
        from pipeline.live import photo3d_config
        config = photo3d_config({'LM_PHOTO3D_TILESET': 'https://example.org/tileset.json'})
        self.assertEqual(config['provider'], 'sample')
        self.assertIn('not Manchester', config['attribution'])
        with self.assertRaises(ValueError):
            photo3d_config({'LM_PHOTO3D_TILESET': 'http://example.org/tileset.json'})


if __name__ == '__main__':
    unittest.main()
