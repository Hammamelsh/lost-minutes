// The Operations view's nightly jobs, from the record the jobs write themselves (pipeline/jobs.py,
// /data/jobs.json). FIXTURE records, timed from the moment the check starts: a rebuild whose last
// scheduled run failed, an evaluation run by hand after its timer stopped, and no record at all.
// What is checked is what a person reads: the last attempt and how it ended, who started it, the
// last success, and "overdue" judged from the last *scheduled* run, never from a run by hand.
import {test, expect} from '@playwright/test';
import {serveLive, journeyLive, servePatterns} from './fixtures.mjs';

const HOUR = 3600_000;
const iso = ms => new Date(ms).toISOString().replace('.000Z', '+00:00');
const stamp = ms => new Intl.DateTimeFormat('en-GB', {timeZone: 'Europe/London', day: '2-digit', month: 'short',
  hour: '2-digit', minute: '2-digit'}).format(ms);
const job = (name, over) => ({name, unit: `lost-minutes-${name}.service`, everySeconds: 86_400, graceSeconds: 3 * 3600,
  ...(name === 'refresh'
    ? {title: 'Timetable rebuild', schedule: 'nightly at 03:40 London time (up to 5 min later)', timeoutSeconds: 1800}
    : {title: 'Arrival evaluation', schedule: 'nightly at 04:10 London time (up to 5 min later)', timeoutSeconds: 1200}),
  ...over});

async function open(page, jobs) {
  await servePatterns(page);
  await serveLive(page, [() => journeyLive()]);
  await page.route('**/data/jobs.json*', route => jobs === null
    ? route.fulfill({status: 404, body: 'not found'})
    : route.fulfill({json: {schemaVersion: 1, generatedAt: new Date().toISOString(), jobs}}));
  // Opened at its own address: the passenger's page is kept behind it, hidden, so no map is awaited.
  await page.goto('/#operations');
  await expect(page.locator('.nightly-jobs')).toBeVisible({timeout: 20_000});
}

test('each nightly job says its last attempt, who started it, how it ended, its last success, and whether a scheduled run is overdue', async ({page}) => {
  const now = Date.now();
  const failedAt = now - 8 * HOUR, lastGood = now - 32 * HOUR, byHand = now - 1 * HOUR, timerLast = now - 30 * HOUR;
  await open(page, [
    job('refresh', {lastAttempt: {startedAt: iso(failedAt), finishedAt: iso(failedAt + 3000), trigger: 'timer', result: 'failed',
      serviceResult: 'exit-code', exitCode: 'exited', exitStatus: '1'}, lastScheduledAttemptAt: iso(failedAt),
      lastSuccess: {at: iso(lastGood), trigger: 'timer', memoryPeakBytes: 1503238553, memoryMaxBytes: 1572864000, memorySource: 'journal'},
      seededFrom: 'journal'}),
    job('arrival-eval', {lastAttempt: {startedAt: iso(byHand), finishedAt: iso(byHand + 150_000), trigger: 'manual', result: 'succeeded',
      serviceResult: 'success'}, lastScheduledAttemptAt: iso(timerLast), lastSuccess: {at: iso(byHand + 150_000), trigger: 'manual'}}),
  ]);
  const section = page.locator('.nightly-jobs');
  await expect(section).toHaveAttribute('data-jobs', '2');
  // The rebuild: its scheduled run last night failed, and says how; it is not overdue (8 h ago).
  const rebuild = section.locator('[data-job="refresh"]');
  await expect(rebuild).toHaveAttribute('data-job-status', 'failed');
  await expect(rebuild.locator('[data-overdue]')).toHaveCount(0);
  await expect(rebuild).toContainText(`Last attempt${stamp(failedAt)} · scheduled · failed (exit status 1)`);
  await expect(rebuild).toContainText(`Last success${stamp(lastGood)}`);
  await expect(rebuild).toContainText('read from the server’s journal');
  // How close its last success came to its memory ceiling: 1.4G of 1500M, said to be close, and whence.
  await expect(rebuild.locator('[data-memory]')).toHaveAttribute('data-memory', 'tight');
  await expect(rebuild.locator('[data-memory]')).toContainText('Whole job 1,434 MB of its 1,500 MB ceiling (96%), page cache included · close to its ceiling');
  await expect(rebuild.locator('[data-memory]')).toContainText('last success, from the journal, rounded');
  await expect(rebuild.locator('[data-memory-resident]')).toHaveCount(0);   // not recorded then, so not claimed
  // The evaluation: run by hand an hour ago and succeeded, but its timer has not run for 30 h: overdue,
  // because a run by hand does not stand for the schedule.
  const evaluation = section.locator('[data-job="arrival-eval"]');
  await expect(evaluation).toHaveAttribute('data-job-status', 'succeeded');
  await expect(evaluation.locator('[data-overdue]')).toHaveText('overdue');
  await expect(evaluation).toContainText(`Last attempt${stamp(byHand)} · by hand · succeeded`);
  await expect(evaluation).toContainText(`Last success${stamp(byHand + 150_000)} · by hand`);
  await expect(evaluation).toContainText(`Last scheduled run${stamp(timerLast)} · the next was due and has not run`);
  await expect(evaluation.locator('[data-memory]')).toHaveText(/not recorded yet/);
});

test('a job started and never finished, long past its time limit, is "no result recorded", not "running"', async ({page}) => {
  const now = Date.now(), started = now - 2 * HOUR;
  await open(page, [job('refresh', {lastAttempt: {startedAt: iso(started), trigger: 'timer', result: 'running'},
    lastScheduledAttemptAt: iso(started), lastSuccess: {at: iso(now - 26 * HOUR), trigger: 'timer'}}), job('arrival-eval', {})]);
  const rebuild = page.locator('[data-job="refresh"]');
  await expect(rebuild).toHaveAttribute('data-job-status', 'unrecorded');
  await expect(rebuild).toContainText('no result recorded');
  // Never attempted at all: no attempt recorded, and overdue.
  const evaluation = page.locator('[data-job="arrival-eval"]');
  await expect(evaluation).toHaveAttribute('data-job-status', 'never');
  await expect(evaluation.locator('[data-overdue]')).toBeVisible();
});

test('with no job record published, the view says so in place and the rest of Operations stands', async ({page}) => {
  await open(page, null);
  await expect(page.locator('.nightly-jobs')).toHaveAttribute('data-jobs', 'unavailable');
  await expect(page.locator('.nightly-jobs')).toContainText('No job record is published on this server yet.');
  await expect(page.getByRole('tab', {name: 'Operations'})).toHaveAttribute('aria-selected', 'true');
});

test('the whole job and its largest process are said apart, with what the kernel did, and an OOM is always said', async ({page}) => {
  // The rebuild of 29 September: the whole job at its ceiling with page cache, its largest process 599 MB resident.
  // Neither stands for the other; the kernel's own account says the ceiling was page cache it took back.
  const now = Date.now(), MB = 1048576;
  await open(page, [job('refresh', {lastAttempt: {startedAt: iso(now - 2 * HOUR), finishedAt: iso(now - 2 * HOUR + 60_000), trigger: 'timer',
    result: 'succeeded', serviceResult: 'success', memoryPeakBytes: 1500 * MB, memoryMaxBytes: 1500 * MB, residentPeakBytes: 599 * MB,
    memoryEvents: {atCeiling: 37, oom: 0, oomKills: 0}, memoryStallSeconds: {some: 0.41, full: 0.39}},
  lastScheduledAttemptAt: iso(now - 2 * HOUR), lastSuccess: {at: iso(now - 2 * HOUR + 60_000), trigger: 'timer'}}),
  job('arrival-eval', {lastAttempt: {startedAt: iso(now - HOUR), finishedAt: iso(now - HOUR + 60_000), trigger: 'timer',
    result: 'failed', serviceResult: 'oom-kill', memoryPeakBytes: 1500 * MB, memoryMaxBytes: 1500 * MB, residentPeakBytes: 1400 * MB,
    memoryEvents: {atCeiling: 120, oom: 1, oomKills: 1}}, lastScheduledAttemptAt: iso(now - HOUR)})]);
  const memory = page.locator('[data-job="refresh"] [data-memory]');
  await expect(memory).toHaveAttribute('data-memory', 'ok');
  await expect(memory.locator('[data-memory-unit]')).toHaveText('Whole job 1,500 MB of its 1,500 MB ceiling (100%), page cache included');
  await expect(memory.locator('[data-memory-resident]')).toHaveText('; largest single process 599 MB resident (40%)');
  await expect(memory.locator('[data-memory-kernel]')).toHaveText('; held at its ceiling 37 times, the kernel taking back page cache, no OOM, waited on memory 0.4 s');
  await expect(memory).not.toContainText('close to its ceiling');
  const killed = page.locator('[data-job="arrival-eval"] [data-memory]');
  await expect(killed).toHaveAttribute('data-memory', 'oom');
  await expect(killed.locator('[data-memory-oom]')).toHaveText(' · out of memory: 1 process killed');
  await expect(page.locator('[data-job="arrival-eval"]')).toContainText('failed: out of memory');
});
