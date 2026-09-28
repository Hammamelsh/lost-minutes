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
