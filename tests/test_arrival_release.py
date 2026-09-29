"""The release check on the display protocol (scripts/arrival-release-check.py, docs/ARRIVAL_DISPLAY_PROTOCOL.md):
revision days decide nothing, the confirmation window is read once and only when complete, every criterion and
the frozen interval are read, and only a scope an approval names field for field is released."""
import json
import subprocess
import sys
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from pipeline import arrival_display as ad  # noqa: E402
from pipeline import arrival_protocol  # noqa: E402

MODEL = 'blended@9a626129f782'
DIGEST = arrival_protocol.VERSIONS['display-1']['sourceDigest']
PATTERN = 'BNML:15:outbound:c9291c1aea'
SCOPE = {'operator': 'BNML', 'line': '15', 'direction': 'outbound', 'patternIds': [PATTERN], 'model': MODEL,
         'protocol': 'display-1'}
WINDOW = [(date(2026, 9, 29) + timedelta(days=k)).isoformat() for k in range(7)]


def journey(key, errors, timetable_errors=None, eligible=None, shown=None, passages=6):
    signed, cand, tt = {}, {}, {}
    for e in errors:
        signed[ad.bin_of(e)] = signed.get(ad.bin_of(e), 0) + 1
    for e, s in zip(errors, timetable_errors or [e + 2.0 for e in errors]):
        cand[abs(ad.bin_of(e))] = cand.get(abs(ad.bin_of(e)), 0) + 1
        tt[abs(ad.bin_of(s))] = tt.get(abs(ad.bin_of(s)), 0) + 1
    pairs = lambda h: sorted([b, c] for b, c in h.items())
    return {'journey': key, 'pattern': PATTERN, 'signed': pairs(signed), 'pairedCandidate': pairs(cand),
            'pairedTimetable': pairs(tt), 'eligible': len(errors) if eligible is None else eligible,
            'eligibleShown': len(errors) if shown is None else shown, 'passages': passages}


def entry(day, errors=(0.2, -0.3, 0.8, 1.1, -0.9, 2.0), journeys=4, split=None, **over):
    """A day of display moments: `journeys` journeys, each with these errors (minutes, bus later positive)."""
    js = [journey(f'{day}|{k}', list(errors)) for k in range(journeys)]
    e = {'day': day, 'protocol': 'display-1', 'model': MODEL, 'stopMapping': 2, 'sourceDigest': DIGEST, 'operator': 'BNML', 'line': '15',
         'weekday': date.fromisoformat(day).weekday() < 5,
         'split': split or ('confirmation' if day >= '2026-09-29' else 'revision'),
         'directions': {'outbound': {'patternIds': [PATTERN], 'journeys': js}}}
    e.update(over)
    return e


class ReleaseCheckTests(unittest.TestCase):
    def run_check(self, entries, approval=None):
        with tempfile.TemporaryDirectory() as tmp:
            display, out = Path(tmp) / 'display.jsonl', Path(tmp) / 'release.json'
            display.write_text(''.join(json.dumps(e) + '\n' for e in entries))
            extra = []
            if approval is not None:
                (Path(tmp) / 'approval.json').write_text(json.dumps(approval))
                extra = ['--approval', str(Path(tmp) / 'approval.json')]
            subprocess.run([sys.executable, str(ROOT / 'scripts/arrival-release-check.py'), '--display', str(display),
                            '--out', str(out), *extra], check=True, capture_output=True)
            return json.loads(out.read_text())

    def test_until_every_confirmation_day_is_scored_it_is_collecting_and_nothing_is_read(self):
        v = self.run_check([entry(d) for d in WINDOW[:6]], {'approved': [SCOPE]})
        self.assertFalse(v['confirmation']['complete'])
        self.assertEqual(v['directions']['outbound']['status'], 'collecting: 6 of 7 confirmation days scored')
        self.assertNotIn('checks', v['directions']['outbound'])
        self.assertEqual(v['scopes'], [])

    def test_revision_days_decide_nothing(self):
        # Excellent revision days and no confirmation: reported, never released.
        v = self.run_check([entry(f'2026-09-{d}') for d in range(21, 29)], {'approved': [SCOPE]})
        self.assertEqual(len(v['directions']['outbound']['revision']['days']), 8)
        self.assertEqual(v['directions']['outbound']['confirmation']['days'], [])
        self.assertEqual(v['scopes'], [])

    def test_a_complete_passing_window_waits_for_an_exact_approval(self):
        entries = [entry(d) for d in WINDOW]
        v = self.run_check(entries)
        block = v['directions']['outbound']
        self.assertEqual(block['status'], 'passed', block.get('checks'))
        self.assertEqual(v['scopes'], [])
        self.assertEqual([p['direction'] for p in v['awaitingApproval']], ['outbound'])
        self.assertEqual(v['released'], [])
        # A bare direction approves nothing, nor does the exact scope without the results it approves; with them
        # cited, it is released, carrying the validated interval.
        self.assertEqual(self.run_check(entries, {'approved': ['outbound']})['scopes'], [])
        self.assertEqual(self.run_check(entries, {'approved': [SCOPE]})['scopes'], [])
        digest = block['confirmation']['digest']
        self.assertEqual(v['awaitingApproval'][0]['confirmationDigest'], digest)
        scopes = self.run_check(entries, {'approved': [{**SCOPE, 'confirmationDigest': digest}]})['scopes']
        self.assertEqual(len(scopes), 1)
        self.assertEqual(scopes[0]['interval']['low'], -1.15)
        self.assertEqual(scopes[0]['interval']['high'], 5.75)
        self.assertEqual(scopes[0]['protocol'], 'display-1')
        for field, value in (('model', 'blended@000000000000'), ('protocol', 'display-0'), ('line', '15A')):
            self.assertEqual(self.run_check(entries, {'approved': [{**SCOPE, 'confirmationDigest': digest, field: value}]})['scopes'],
                             [], field)

    def test_every_criterion_is_read(self):
        cases = {
            'medianAbs<=1.5': dict(errors=(1.6, -1.7, 1.8, 2.0, -1.9, 1.6)),
            'p80Abs<=3.0': dict(errors=(0.1, 0.2, 3.5, 4.0, 0.3, 3.6, 0.1, 3.9, 0.2, 3.2)),
            'coverage>=50%': None,
            'intervalCoverage>=80%': dict(errors=(0.2, -1.4, 0.8, -1.3, 1.1, -1.6)),
        }
        for name, spec in cases.items():
            if spec is None:
                entries = [entry(d) for d in WINDOW]
                for e in entries:
                    for j in e['directions']['outbound']['journeys']:
                        j['eligible'], j['eligibleShown'] = 100, 10
            else:
                entries = [entry(d, **spec) for d in WINDOW]
            block = self.run_check(entries, {'approved': [SCOPE]})['directions']['outbound']
            self.assertFalse(block['checks'][name], name)
            self.assertTrue(block['status'].startswith('not met'), name)
        # The floors: too few journeys and passages.
        thin = self.run_check([entry(d, journeys=1) for d in WINDOW])['directions']['outbound']
        self.assertFalse(thin['checks']['journeys>=20'])

    def test_entries_from_another_protocol_model_or_stop_mapping_count_toward_nothing(self):
        entries = ([entry(d, protocol='display-0') for d in WINDOW[:3]] + [entry(d, model='blended@000000000000') for d in WINDOW[3:5]]
                   + [entry(d, stopMapping=None) for d in WINDOW[5:]])
        v = self.run_check(entries, {'approved': [SCOPE]})
        self.assertEqual(sorted(v['skipped']), WINDOW)
        self.assertFalse(v['confirmation']['complete'])
        self.assertTrue(v['invalid'], 'and the window, scored under something else, is no longer untouched')

    def test_an_approval_written_before_the_results_approves_nothing(self):
        # Written ahead with a guess, or citing other results: a pass is not released by it.
        entries = [entry(d) for d in WINDOW]
        guessed = {**SCOPE, 'confirmationDigest': '0' * 64}
        self.assertEqual(self.run_check(entries, {'approved': [guessed]})['scopes'], [])
        other = [entry(d, errors=(0.2, -0.3, 0.8, 1.1, -0.9, 1.9)) for d in WINDOW]
        other_digest = arrival_protocol.confirmation_digest(other, 'display-1', 'outbound')
        self.assertNotEqual(other_digest, arrival_protocol.confirmation_digest(entries, 'display-1', 'outbound'),
                            'one error in one journey changes the digest')
        self.assertEqual(self.run_check(entries, {'approved': [{**SCOPE, 'confirmationDigest': other_digest}]})['scopes'], [])

    def test_a_window_day_also_scored_under_another_version_makes_the_window_invalid(self):
        # Every day passes as the frozen version, but one was also scored under a changed model: not untouched.
        entries = [entry(d) for d in WINDOW] + [entry(WINDOW[2], model='blended@111111111111')]
        v = self.run_check(entries)
        block = v['directions']['outbound']
        self.assertTrue(block['status'].startswith('invalid:'), block['status'])
        self.assertIn(WINDOW[2], block['status'])
        self.assertNotIn('checks', block)
        self.assertEqual((v['scopes'], v['awaitingApproval']), ([], []))

    def test_changed_code_under_the_same_version_makes_every_verdict_invalid(self):
        # The defining files, one changed by a comment: a changed model or display cannot pass as the frozen one.
        entries = [entry(d) for d in WINDOW]
        with tempfile.TemporaryDirectory() as tmp:
            for rel in arrival_protocol.DEFINING_FILES:
                target = Path(tmp) / rel
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes((ROOT / rel).read_bytes())
            with open(Path(tmp) / 'pipeline/arrival_display.py', 'a') as f:
                f.write('# changed\n')
            display, out = Path(tmp) / 'display.jsonl', Path(tmp) / 'release.json'
            display.write_text(''.join(json.dumps(e) + '\n' for e in entries))
            subprocess.run([sys.executable, str(ROOT / 'scripts/arrival-release-check.py'), '--display', str(display), '--out', str(out),
                            '--source-root', tmp], check=True, capture_output=True)
            v = json.loads(out.read_text())
        self.assertTrue(v['directions']['outbound']['status'].startswith('invalid:'))
        self.assertIn('a change to the model or the display is a new version', v['directions']['outbound']['status'])
        self.assertEqual(v['awaitingApproval'], [])

    def test_the_shipped_approval_file_approves_nothing_and_the_unit_reads_it(self):
        approval = json.loads((ROOT / 'deploy/arrival-release-approval.json').read_text())
        self.assertEqual(approval['approved'], [])
        unit = (ROOT / 'deploy/systemd/lost-minutes-arrival-eval.service').read_text()
        self.assertIn('--approval deploy/arrival-release-approval.json', unit)


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


if __name__ == '__main__':
    unittest.main()
