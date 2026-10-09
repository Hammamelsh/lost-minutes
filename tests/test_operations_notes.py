"""The Operations record's notes say what its own runs are (pipeline/operations.py, notes_for).

Until 9 October 2026 they were fixed sentences from the archive-only release, and the hosted server published
"Nothing is collected live" and "one local WSL process ... no scheduler and no hosted worker yet" under its own
live runs for nineteen days.
"""
import unittest

try:
    import duckdb  # noqa: F401
    HAS_DUCKDB = True
except ImportError:
    HAS_DUCKDB = False

if HAS_DUCKDB:
    from pipeline.operations import NOTES, notes_for


@unittest.skipUnless(HAS_DUCKDB, 'DuckDB not installed; see requirements.txt')
class OperationsNotesTests(unittest.TestCase):
    def test_a_record_of_live_runs_never_calls_itself_an_archive_or_a_local_process(self):
        notes = notes_for([{'isHistorical': False}, {'isHistorical': False}])
        self.assertIn('current data', notes[0])
        for note in notes:
            for stale in ('archive', 'Nothing is collected live', 'WSL', 'no scheduler', 'hosted worker'):
                self.assertNotIn(stale, note)

    def test_an_archive_record_still_says_nothing_in_it_is_live(self):
        self.assertEqual(notes_for([{'isHistorical': True}, {'isHistorical': True}])[0],
                         'Every run listed here is a historical archive replay. Nothing is collected live.')

    def test_a_record_of_both_says_which_is_which(self):
        first = notes_for([{'isHistorical': True}, {'isHistorical': False}])[0]
        self.assertIn('Runs marked live', first)
        self.assertIn('Runs marked archive', first)

    def test_the_notes_true_of_any_record_follow_the_first(self):
        for runs in ([], [{'isHistorical': True}], [{'isHistorical': False}]):
            self.assertEqual(notes_for(runs)[1:], NOTES)


if __name__ == '__main__':
    unittest.main()
