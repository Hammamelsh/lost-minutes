"""The view from above: the key alone makes it a private preview; only an explicit switch makes it
public; withdrawing the key withdraws the preview (docs/PHOTO_3D_PREVIEW.md)."""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

try:
    import duckdb  # noqa: F401
    HAS_DUCKDB = True
except ModuleNotFoundError:
    HAS_DUCKDB = False

FAKE_KEY = 'EXAMPLE_KEY_NOT_REAL_0123456789abcdef'


@unittest.skipUnless(HAS_DUCKDB, 'DuckDB not installed; see requirements.txt')
class Photo3dConfigTests(unittest.TestCase):
    def test_nothing_configured_offers_nothing(self):
        from pipeline.live import photo3d_config
        self.assertIsNone(photo3d_config({}))

    def test_a_google_key_names_googles_tileset_and_is_labelled_as_captured_imagery(self):
        from pipeline.live import photo3d_config
        config = photo3d_config({'LM_PHOTO3D_GOOGLE_KEY': FAKE_KEY})
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

    def test_a_key_alone_never_reaches_the_public_config(self):
        from pipeline.live import _config, write_runtime_config
        with tempfile.TemporaryDirectory() as root, mock.patch.dict(os.environ, {'LM_PHOTO3D_GOOGLE_KEY': FAKE_KEY}, clear=False):
            os.environ.pop('LM_PHOTO3D_PUBLIC', None)
            self.assertNotIn('photo3d', _config(20))
            write_runtime_config(root, 20)
            public = json.loads((Path(root) / 'public/data/config.json').read_text())
            self.assertNotIn('photo3d', public)
            self.assertNotIn(FAKE_KEY, json.dumps(public))
            private = json.loads((Path(root) / 'data/private/photo3d.json').read_text())
            self.assertEqual(private['photo3d']['provider'], 'google')
            self.assertFalse(private['public'])

    def test_only_the_explicit_switch_makes_it_public(self):
        from pipeline.live import _config, photo3d_public
        self.assertFalse(photo3d_public({}))
        self.assertFalse(photo3d_public({'LM_PHOTO3D_PUBLIC': ''}))
        self.assertFalse(photo3d_public({'LM_PHOTO3D_PUBLIC': 'no'}))
        self.assertTrue(photo3d_public({'LM_PHOTO3D_PUBLIC': '1'}))
        with mock.patch.dict(os.environ, {'LM_PHOTO3D_GOOGLE_KEY': FAKE_KEY, 'LM_PHOTO3D_PUBLIC': 'yes'}, clear=False):
            self.assertEqual(_config(20)['photo3d']['provider'], 'google')

    def test_withdrawing_the_key_removes_the_private_offer(self):
        from pipeline.live import write_runtime_config
        with tempfile.TemporaryDirectory() as root:
            write_runtime_config(root, 20, {'LM_PHOTO3D_GOOGLE_KEY': FAKE_KEY})
            self.assertTrue((Path(root) / 'data/private/photo3d.json').exists())
            write_runtime_config(root, 20, {})
            self.assertFalse((Path(root) / 'data/private/photo3d.json').exists())

    def test_a_preview_that_cannot_be_written_never_stops_the_publication(self):
        from pipeline.live import write_runtime_config
        with tempfile.TemporaryDirectory() as root:
            (Path(root) / 'data').mkdir()
            (Path(root) / 'data/private').write_text('a file where the folder should be')
            write_runtime_config(root, 20, {'LM_PHOTO3D_GOOGLE_KEY': FAKE_KEY})
            self.assertTrue((Path(root) / 'public/data/config.json').exists())


if __name__ == '__main__':
    unittest.main()
