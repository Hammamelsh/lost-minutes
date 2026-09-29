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


    def test_the_memory_peak_is_read_from_the_unit_s_own_cgroup_and_only_there(self):
        proc = self.root / 'cgroup'
        group = self.root / 'sys' / 'system.slice' / 'lost-minutes-refresh.service'
        group.mkdir(parents=True)
        (group / 'memory.peak').write_text('1503238553\n')
        (group / 'memory.max').write_text('1572864000\n')
        proc.write_text('0::/system.slice/lost-minutes-refresh.service\n')
        read = jobs.unit_memory('lost-minutes-refresh.service', proc, self.root / 'sys')
        self.assertEqual(read, {'memoryPeakBytes': 1503238553, 'memoryMaxBytes': 1572864000})
        (group / 'memory.max').write_text('max\n')
        self.assertIsNone(jobs.unit_memory('lost-minutes-refresh.service', proc, self.root / 'sys')['memoryMaxBytes'])
        # What the kernel did about it: a ceiling reached by page cache it took back reads apart from one that killed.
        self.assertNotIn('memoryEvents', jobs.unit_memory('lost-minutes-refresh.service', proc, self.root / 'sys'))
        (group / 'memory.events').write_text('low 0\nhigh 0\nmax 37\noom 0\noom_kill 0\noom_group_kill 0\n')
        (group / 'memory.pressure').write_text('some avg10=0.00 avg60=0.12 avg300=0.03 total=412337\n'
                                              'full avg10=0.00 avg60=0.10 avg300=0.02 total=398001\n')
        read = jobs.unit_memory('lost-minutes-refresh.service', proc, self.root / 'sys')
        self.assertEqual(read['memoryEvents'], {'atCeiling': 37, 'oom': 0, 'oomKills': 0})
        self.assertEqual(read['memoryStallSeconds'], {'some': 0.412, 'full': 0.398})
        (group / 'memory.pressure').write_text('garbled\n')
        self.assertNotIn('memoryStallSeconds', jobs.unit_memory('lost-minutes-refresh.service', proc, self.root / 'sys'))
        # From a shell the process is in a session's cgroup: that peak is not the job's, and nothing is read.
        proc.write_text('0::/user.slice/user-1000.slice/session-3.scope\n')
        self.assertEqual(jobs.unit_memory('lost-minutes-refresh.service', proc, self.root / 'sys'), {})

    def test_a_finished_attempt_and_its_success_carry_the_peak_and_the_ceiling(self):
        jobs.start(self.root, 'refresh', now='2026-09-29T02:41:00+00:00', env=TIMER)
        jobs.finish(self.root, 'refresh', now='2026-09-29T02:45:10+00:00',
                    env={**TIMER, 'SERVICE_RESULT': 'success', 'EXIT_CODE': 'exited', 'EXIT_STATUS': '0'},
                    memory={'memoryPeakBytes': 1_400_000_000, 'memoryMaxBytes': 1_572_864_000})
        job = self.published()['refresh']
        self.assertEqual(job['lastAttempt']['memoryPeakBytes'], 1_400_000_000)
        self.assertEqual(job['lastSuccess']['memoryMaxBytes'], 1_572_864_000)

    def test_each_step_s_resident_peak_is_kept_and_its_exit_status_passed_through(self):
        """The unit's peak counts page cache; a step's own largest resident set is what could get it killed."""
        jobs.start(self.root, 'refresh', now='2026-09-30T02:43:00+00:00', env={'TRIGGER_UNIT': 'lost-minutes-refresh.timer'})
        code = jobs.step(self.root, 'refresh', [sys.executable, '-c', 'x = bytearray(60 * 1024 * 1024)'])
        self.assertEqual(code, 0)
        failing = jobs.step(self.root, 'refresh', [sys.executable, '-c', 'import sys; sys.exit(3)'])
        self.assertEqual(failing, 3, 'the job fails as its step did')
        attempt = json.loads((Path(self.root) / 'data/jobs/refresh.json').read_text())['lastAttempt']
        self.assertGreaterEqual(attempt['residentPeakBytes'], 60 * 1024 * 1024)
        self.assertEqual([s['exitStatus'] for s in attempt['steps']], [0, 3])
        self.assertTrue(all(isinstance(s['seconds'], float) and s['seconds'] >= 0 for s in attempt['steps']), 'each step is timed')
        jobs.finish(self.root, 'refresh', now='2026-09-30T02:45:00+00:00', env={'SERVICE_RESULT': 'success'}, memory={})
        state = json.loads((Path(self.root) / 'data/jobs/refresh.json').read_text())
        self.assertEqual(state['lastSuccess']['residentPeakBytes'], attempt['residentPeakBytes'])
        # A new attempt starts without the last one's peak.
        jobs.start(self.root, 'refresh', now='2026-10-01T02:43:00+00:00', env={})
        self.assertNotIn('residentPeakBytes', json.loads((Path(self.root) / 'data/jobs/refresh.json').read_text())['lastAttempt'])

    def test_a_step_is_recorded_by_what_it_runs(self):
        py = '/srv/lost-minutes/app/.venv/bin/python'
        self.assertEqual(jobs.step_label([py, '-m', 'pipeline.patterns', 'build']), 'pipeline.patterns build')
        self.assertEqual(jobs.step_label([py, '-m', 'pipeline.run', '--db', 'x']), 'pipeline.run')
        self.assertEqual(jobs.step_label([py, 'scripts/extract-arrival-inputs.py', '--line', '15', '--db', 'data/evaluation/snapshot.duckdb',
                                          '--out', 'data/evaluation/arrival-display-inputs.pkl']), 'extract-arrival-inputs.py')
        self.assertEqual(jobs.step_label(['/bin/cp', '-f', 'a', 'b']), 'cp')
        self.assertEqual(jobs.step_label([py, '-m']), 'python')
        self.assertEqual(jobs.step_label([]), '?')

    def test_a_seeded_success_can_carry_the_journal_s_rounded_peak(self):
        self.assertEqual(jobs.parse_size('1.4G'), int(1.4 * 1024 ** 3))
        self.assertEqual(jobs.parse_size('1500M'), 1500 * 1024 ** 2)
        jobs.seed(self.root, 'refresh', '2026-09-28T02:40:33+00:00', '2026-09-28T02:40:36+00:00', 'failed',
                  success_at='2026-09-27T02:44:52+00:00', service_result='exit-code', exit_status='1',
                  success_memory_peak='1.4G', memory_max='1500M')
        success = self.published()['refresh']['lastSuccess']
        self.assertEqual(success['memoryPeakBytes'], int(1.4 * 1024 ** 3))
        self.assertEqual(success['memorySource'], 'journal')


if __name__ == '__main__':
    unittest.main()
