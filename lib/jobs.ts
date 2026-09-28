/**
 * The nightly jobs' own record (pipeline/jobs.py, published as /data/jobs.json): each job's last
 * attempt and how systemd says it ended, the last success, and the last scheduled attempt, from
 * which a missed night is judged. Read and judged here; nothing is inferred beyond it.
 */
import {z} from 'zod';

const attemptSchema=z.object({
 startedAt:z.string().nullable(),finishedAt:z.string().nullable().optional(),
 trigger:z.enum(['timer','manual']).nullable().optional(),result:z.string(),
 serviceResult:z.string().nullable().optional(),exitCode:z.string().nullable().optional(),exitStatus:z.string().nullable().optional(),
});
const jobSchema=z.object({
 name:z.string(),unit:z.string(),title:z.string(),does:z.string().optional(),schedule:z.string(),
 everySeconds:z.number(),graceSeconds:z.number(),timeoutSeconds:z.number().optional(),
 lastAttempt:attemptSchema.nullable().optional(),lastScheduledAttemptAt:z.string().nullable().optional(),
 lastSuccess:z.object({at:z.string(),trigger:z.string().nullable().optional()}).nullable().optional(),
 lastFailure:z.object({at:z.string().nullable(),trigger:z.string().nullable().optional(),
  serviceResult:z.string().nullable().optional(),exitStatus:z.string().nullable().optional()}).nullable().optional(),
 seededFrom:z.string().nullable().optional(),
});
const jobsSchema=z.object({schemaVersion:z.literal(1),generatedAt:z.string(),jobs:z.array(jobSchema)});
export type NightlyJob=z.infer<typeof jobSchema>;
export const parseJobs=(value:unknown)=>jobsSchema.parse(value);

/** How systemd's account of a failed attempt reads to a person. */
export function failureWords(attempt:{serviceResult?:string|null;exitStatus?:string|null}|null|undefined):string{
 if(!attempt)return 'failed';
 switch(attempt.serviceResult){
  case 'exit-code':return `failed (exit status ${attempt.exitStatus??'unknown'})`;
  case 'timeout':return 'failed: ran past its time limit';
  case 'signal':return `failed: stopped by signal ${attempt.exitStatus??''}`.trim();
  case 'oom-kill':return 'failed: out of memory';
  case 'core-dump':return 'failed: crashed';
  default:return attempt.serviceResult?`failed (${attempt.serviceResult})`:'failed';
 }
}

export type JobJudgement={
 /** What the last attempt was: still running, ended as it did, ended with no result recorded, or none. */
 status:'running'|'succeeded'|'failed'|'unrecorded'|'never';
 /** No scheduled attempt within the schedule and its grace: a missed night, or a timer that stopped. */
 overdue:boolean;
};

export function judgeJob(job:NightlyJob,nowMs:number):JobJudgement{
 const last=job.lastAttempt;
 const scheduled=job.lastScheduledAttemptAt?Date.parse(job.lastScheduledAttemptAt):NaN;
 const overdue=!Number.isFinite(scheduled)||nowMs-scheduled>(job.everySeconds+job.graceSeconds)*1000;
 if(!last)return {status:'never',overdue};
 if(last.result==='running'){
  // A start with no stop, long past the job's own time limit: the machine went down, or the record
  // could not be written. Said as that, not as running.
  const started=last.startedAt?Date.parse(last.startedAt):NaN;
  const limit=((job.timeoutSeconds??3600)+600)*1000;
  return {status:Number.isFinite(started)&&nowMs-started<=limit?'running':'unrecorded',overdue};
 }
 return {status:last.result==='succeeded'?'succeeded':'failed',overdue};
}
