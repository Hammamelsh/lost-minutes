"""The arrival display's frozen versions (pipeline/arrival_protocol.py): the code that defines a version cannot
change under its name, a version's window opens after it is frozen and after every earlier version's, and the
nightly scoring never replaces another version's record of a day. These tests fail on a change to the model or
the display that has not been made a new version with its own untouched window."""
import json
import pickle
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from pipeline import arrival_display as ad  # noqa: E402
from pipeline import arrival_protocol as ap  # noqa: E402


class FrozenVersionTests(unittest.TestCase):
    def test_the_code_that_defines_the_current_version_is_the_code_it_was_frozen_with(self):
        # Failing here means a file that decides the model or what a page shows has changed. If that is a change to
        # the model or the display, it is a new version (a new PROTOCOL, a new entry, a new untouched window); if it
        # truly decides nothing, the digest is re-pinned deliberately, with the reason, before the window opens.
        self.assertEqual(ap.source_digest(), ap.VERSIONS[ad.PROTOCOL]['sourceDigest'])
        self.assertEqual(ap.deployed_problems(ad.PROTOCOL, ap.VERSIONS[ad.PROTOCOL]['model']), [])

    def test_the_protocol_s_own_constants_agree_with_its_frozen_entry(self):
        v = ap.VERSIONS[ad.PROTOCOL]
        self.assertEqual((ad.CONFIRMATION_FROM, ad.CONFIRMATION_DAYS), (v['confirmation']['from'], v['confirmation']['days']))
        params = (ROOT / 'scripts/arrival-params-frozen.json').read_bytes()
        import hashlib
        self.assertEqual('blended@' + hashlib.sha256(params).hexdigest()[:12], v['model'])

    def test_every_window_opens_after_its_version_is_frozen_and_after_every_earlier_window(self):
        london = ZoneInfo('Europe/London')
        previous_end = None
        for name, v in sorted(ap.VERSIONS.items(), key=lambda kv: kv[1]['frozenAt']):
            days = ap.window(name)
            opens = datetime.fromisoformat(days[0]).replace(tzinfo=london)
            self.assertLess(datetime.fromisoformat(v['frozenAt']), opens, f'{name} frozen before its window opens')
            if previous_end:
                self.assertGreater(days[0], previous_end, f'{name} starts after every earlier window')
            previous_end = days[-1]

    def test_a_changed_defining_file_is_named_as_a_new_version(self):
        with tempfile.TemporaryDirectory() as tmp:
            for rel in ap.DEFINING_FILES:
                target = Path(tmp) / rel
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes((ROOT / rel).read_bytes())
            self.assertEqual(ap.deployed_problems(ad.PROTOCOL, ap.VERSIONS[ad.PROTOCOL]['model'], tmp), [])
            (Path(tmp) / 'lib/arrival.ts').write_text((ROOT / 'lib/arrival.ts').read_text() + '\n// a display change\n')
            problems = ap.deployed_problems(ad.PROTOCOL, ap.VERSIONS[ad.PROTOCOL]['model'], tmp)
            self.assertEqual(len(problems), 1)
            self.assertIn('is a new version', problems[0])
        self.assertTrue(ap.deployed_problems(ad.PROTOCOL, 'blended@000000000000'))
        self.assertTrue(ap.deployed_problems('display-9', 'x'))


class NightlyRecordTests(unittest.TestCase):
    def test_a_day_scored_under_another_version_is_kept_beside_this_one_never_replaced(self):
        # A record of 2026-09-21 made under another model is in the file; the nightly scoring of that day under
        # the current version adds its own record, and the other stays exactly as it was.
        with tempfile.TemporaryDirectory() as tmp:
            other = {'day': '2026-09-21', 'protocol': 'display-1', 'model': 'blended@000000000000', 'stopMapping': 2,
                     'directions': {'outbound': {'patternIds': [], 'journeys': [{'journey': 'kept as it was'}]}}}
            out = Path(tmp) / 'nightly.jsonl'
            out.write_text(json.dumps(other) + '\n')
            inputs = {'line': '15', 'operator': 'BNML', 'depInfo': [], 'matchable': [],
                      'days': {'2026-09-21': {'publications': [], 'rows': []}}}
            (Path(tmp) / 'inputs.pkl').write_bytes(pickle.dumps(inputs))
            run = subprocess.run([sys.executable, str(ROOT / 'scripts/evaluate-arrival-display.py'), '--inputs',
                                  str(Path(tmp) / 'inputs.pkl'), '--out', str(out)], capture_output=True, text=True)
            self.assertEqual(run.returncode, 0, run.stderr[-800:])
            records = [json.loads(line) for line in out.read_text().splitlines()]
            self.assertEqual(len(records), 2)
            self.assertIn(other, records, 'the other version\'s record is unchanged')
            mine = next(r for r in records if r['model'] != 'blended@000000000000')
            self.assertEqual(ap.identity(mine), ap.expected(ad.PROTOCOL), 'scored as, and marked as, the frozen version')
            # Run again: nothing is scored twice.
            again = subprocess.run([sys.executable, str(ROOT / 'scripts/evaluate-arrival-display.py'), '--inputs',
                                    str(Path(tmp) / 'inputs.pkl'), '--out', str(out)], capture_output=True, text=True)
            self.assertIn('nothing extracted that is not already scored', again.stdout)
            self.assertEqual(len(out.read_text().splitlines()), 2)


if __name__ == '__main__':
    unittest.main()
