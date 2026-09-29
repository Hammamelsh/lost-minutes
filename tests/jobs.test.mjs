// The Operations view's judgement of the nightly jobs' own record (lib/jobs.ts): a missed night is
// judged from the last *scheduled* attempt, so a run by hand does not hide a timer that stopped; a
// start with no stop long past its time limit is "no result recorded", not "running".
import test from 'node:test';
import assert from 'node:assert/strict';
import {failureWords,judgeJob,parseJobs} from '../lib/jobs.ts';

const HOUR=3600_000;
const job=(over={})=>({name:'refresh',unit:'lost-minutes-refresh.service',title:'Timetable rebuild',schedule:'nightly',
 everySeconds:86_400,graceSeconds:3*3600,timeoutSeconds:1800,lastAttempt:null,lastScheduledAttemptAt:null,lastSuccess:null,...over});
const at=iso=>Date.parse(iso);

test('a job that succeeded last night is succeeded and not overdue; a day and more than three hours later it is overdue', () => {
 const j=job({lastAttempt:{startedAt:'2026-09-29T02:41:00Z',finishedAt:'2026-09-29T02:45:00Z',trigger:'timer',result:'succeeded'},
  lastScheduledAttemptAt:'2026-09-29T02:41:00Z',lastSuccess:{at:'2026-09-29T02:45:00Z',trigger:'timer'}});
 assert.deepEqual(judgeJob(j,at('2026-09-29T12:00:00Z')),{status:'succeeded',overdue:false});
 assert.deepEqual(judgeJob(j,at('2026-09-30T05:40:00Z')),{status:'succeeded',overdue:false},'27 h: within the grace');
 assert.deepEqual(judgeJob(j,at('2026-09-30T05:42:00Z')),{status:'succeeded',overdue:true},'a missed night');
});

test('a run by hand shows as the last attempt but does not stand for the schedule', () => {
 const j=job({lastAttempt:{startedAt:'2026-09-30T10:00:00Z',finishedAt:'2026-09-30T10:04:00Z',trigger:'manual',result:'succeeded'},
  lastScheduledAttemptAt:'2026-09-28T02:40:33Z',lastSuccess:{at:'2026-09-30T10:04:00Z',trigger:'manual'}});
 assert.deepEqual(judgeJob(j,at('2026-09-30T10:05:00Z')),{status:'succeeded',overdue:true});
});

test('a start with no stop is running within the job’s time limit, and "no result recorded" after it', () => {
 const j=job({lastAttempt:{startedAt:'2026-09-29T02:41:00Z',trigger:'timer',result:'running'},lastScheduledAttemptAt:'2026-09-29T02:41:00Z'});
 assert.equal(judgeJob(j,at('2026-09-29T02:50:00Z')).status,'running');
 assert.equal(judgeJob(j,at('2026-09-29T03:30:00Z')).status,'unrecorded','30 min limit and 10 min grace, past');
});

test('a job never attempted is overdue, and a failure reads as systemd said it', () => {
 assert.deepEqual(judgeJob(job(),at('2026-09-29T00:00:00Z')),{status:'never',overdue:true});
 assert.equal(failureWords({serviceResult:'exit-code',exitStatus:'1'}),'failed (exit status 1)');
 assert.equal(failureWords({serviceResult:'timeout',exitStatus:'TERM'}),'failed: ran past its time limit');
 assert.equal(failureWords({serviceResult:'oom-kill'}),'failed: out of memory');
});

test('the published record is validated: a wrong shape is refused, not half-shown', () => {
 assert.throws(()=>parseJobs({schemaVersion:2,generatedAt:'x',jobs:[]}));
 assert.throws(()=>parseJobs({schemaVersion:1,generatedAt:'x',jobs:[{name:'refresh'}]}));
 assert.equal(parseJobs({schemaVersion:1,generatedAt:'x',jobs:[job()]}).jobs.length,1);
 assert.ok(HOUR>0);
});

test('memory is two figures never merged, the whole job and its largest process, with what the kernel did', async () => {
 const {memoryHeadroom} = await import('../lib/jobs.ts');
 const MB = 1048576;
 const rebuilt = job({lastAttempt: {startedAt: 'x', trigger: 'timer', result: 'succeeded', memoryPeakBytes: 1434 * MB, memoryMaxBytes: 1500 * MB}});
 assert.deepEqual(memoryHeadroom(rebuilt), {residentMB: null, unitMB: 1434, maxMB: 1500, residentShare: null, unitShare: 1434 / 1500,
  atCeiling: null, oom: null, oomKills: null, stallSeconds: null, tight: true, outOfMemory: false, from: 'attempt', source: null});
 // The rebuild of 29 September: the whole job at its ceiling, page cache and all; its largest process 599 MB. Both
 // are kept, and closeness is judged on the process: the page cache is what the kernel takes back first.
 const stepped = job({lastAttempt: {startedAt: 'x', trigger: 'timer', result: 'succeeded', memoryPeakBytes: 1500 * MB,
  memoryMaxBytes: 1500 * MB, residentPeakBytes: 599 * MB,
  memoryEvents: {atCeiling: 37, oom: 0, oomKills: 0}, memoryStallSeconds: {some: 0.41, full: 0.39}}});
 const m = memoryHeadroom(stepped);
 assert.equal(m.residentMB, 599);
 assert.equal(m.unitMB, 1500);
 assert.equal(m.unitShare, 1);
 assert.equal(m.tight, false, '599 of 1,500 in one process is not close');
 assert.deepEqual([m.atCeiling, m.oom, m.oomKills, m.stallSeconds, m.outOfMemory], [37, 0, 0, 0.41, false]);
 // An OOM is always said, whatever the peaks read.
 const killed = job({lastAttempt: {startedAt: 'x', trigger: 'timer', result: 'failed', serviceResult: 'oom-kill',
  memoryPeakBytes: 1500 * MB, memoryMaxBytes: 1500 * MB, residentPeakBytes: 700 * MB, memoryEvents: {atCeiling: 90, oom: 1, oomKills: 1}}});
 assert.equal(memoryHeadroom(killed).outOfMemory, true);
 const seeded = job({lastAttempt: {startedAt: 'x', trigger: 'timer', result: 'failed'},
  lastSuccess: {at: 'y', trigger: 'timer', memoryPeakBytes: 700 * MB, memoryMaxBytes: 1500 * MB, memorySource: 'journal'}});
 assert.equal(memoryHeadroom(seeded).from, 'success');
 assert.equal(memoryHeadroom(seeded).tight, false);
 assert.equal(memoryHeadroom(seeded).atCeiling, null, 'not recorded then: not claimed');
 assert.equal(memoryHeadroom(job()), null, 'nothing recorded: nothing claimed');
});
