"""The nightly jobs record themselves: each attempt, how it ended by systemd's own account, the last
success, and whether the timer or a person started it, so that a scheduled run is never confused
with a controlled one and a timer that stops firing is visible. From 24 to 28 September 2026 the
arrival evaluation failed five nights running and nothing said so."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pipeline import jobs  # noqa: E402

TIMER = {'TRIGGER_UNIT': 'lost-minutes-refresh.timer'}


class JobRecordTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix='lost-minutes-jobs-'))

    def published(self):
        return {job['name']: job for job in json.loads((self.root / jobs.TARGET).read_text())['jobs']}

    def test_a_scheduled_attempt_is_recorded_as_it_starts_and_its_success_as_it_stops(self):
        jobs.start(self.root, 'refresh', now='2026-09-29T02:41:00+00:00', env=TIMER)
        job = self.published()['refresh']
        self.assertEqual(job['lastAttempt']['result'], 'running')
        self.assertEqual(job['lastAttempt']['trigger'], 'timer')
        self.assertEqual(job['lastScheduledAttemptAt'], '2026-09-29T02:41:00+00:00')
        self.assertIsNone(job['lastSuccess'])
        jobs.finish(self.root, 'refresh', now='2026-09-29T02:45:10+00:00',
                    env={**TIMER, 'SERVICE_RESULT': 'success', 'EXIT_CODE': 'exited', 'EXIT_STATUS': '0'})
        job = self.published()['refresh']
        self.assertEqual(job['lastAttempt']['result'], 'succeeded')
        self.assertEqual(job['lastAttempt']['finishedAt'], '2026-09-29T02:45:10+00:00')
        self.assertEqual(job['lastSuccess'], {'at': '2026-09-29T02:45:10+00:00', 'trigger': 'timer'})
        self.assertEqual(self.published()['arrival-eval']['lastAttempt'], None, 'the other job is untouched')

    def test_a_failure_is_recorded_with_systemd_s_own_account_and_the_last_success_is_kept(self):
        jobs.start(self.root, 'arrival-eval', now='2026-09-28T03:11:55+00:00', env=TIMER)
        jobs.finish(self.root, 'arrival-eval', now='2026-09-28T03:12:22+00:00', env={'SERVICE_RESULT': 'success'})
        jobs.start(self.root, 'arrival-eval', now='2026-09-29T03:11:00+00:00', env=TIMER)
        jobs.finish(self.root, 'arrival-eval', now='2026-09-29T03:31:00+00:00',
                    env={'SERVICE_RESULT': 'timeout', 'EXIT_CODE': 'killed', 'EXIT_STATUS': 'TERM'})
        job = self.published()['arrival-eval']
        self.assertEqual(job['lastAttempt']['result'], 'failed')
        self.assertEqual((job['lastAttempt']['serviceResult'], job['lastAttempt']['exitStatus']), ('timeout', 'TERM'))
        self.assertEqual(job['lastSuccess']['at'], '2026-09-28T03:12:22+00:00')
        self.assertEqual(job['lastFailure']['at'], '2026-09-29T03:31:00+00:00')

    def test_a_run_by_hand_is_said_to_be_one_and_does_not_stand_for_the_schedule(self):
        jobs.start(self.root, 'refresh', now='2026-09-28T02:40:33+00:00', env=TIMER)
        jobs.start(self.root, 'refresh', now='2026-09-28T10:30:00+00:00', env={})
        jobs.finish(self.root, 'refresh', now='2026-09-28T10:34:00+00:00', env={'SERVICE_RESULT': 'success'})
        job = self.published()['refresh']
        self.assertEqual(job['lastAttempt']['trigger'], 'manual')
        self.assertEqual(job['lastSuccess']['trigger'], 'manual')
        self.assertEqual(job['lastScheduledAttemptAt'], '2026-09-28T02:40:33+00:00', 'overdue is judged by the schedule')

    def test_the_record_before_the_jobs_recorded_themselves_is_seeded_and_said_to_be(self):
        jobs.seed(self.root, 'refresh', '2026-09-28T02:40:33+00:00', '2026-09-28T02:40:36+00:00', 'failed',
                  success_at='2026-09-27T02:44:52+00:00', service_result='exit-code', exit_status='1')
        job = self.published()['refresh']
        self.assertEqual(job['seededFrom'], 'journal')
        self.assertEqual(job['lastAttempt']['result'], 'failed')
        self.assertEqual(job['lastScheduledAttemptAt'], '2026-09-28T02:40:33+00:00')
        self.assertEqual(job['lastSuccess']['at'], '2026-09-27T02:44:52+00:00')
        self.assertEqual(job['schedule'], 'nightly at 03:40 London time (up to 5 min later)')
        self.assertEqual(job['everySeconds'], 86_400)

    def test_a_record_that_cannot_be_written_is_said_and_never_raised_into_the_job(self):
        blocked = self.root / 'blocked'
        blocked.write_text('a file where a directory would go')
        self.assertEqual(jobs.main(['start', 'refresh', '--root', str(blocked)]), 1)


if __name__ == '__main__':
    unittest.main()
