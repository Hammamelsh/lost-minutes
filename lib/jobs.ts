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
 memoryPeakBytes:z.number().nullable().optional(),memoryMaxBytes:z.number().nullable().optional(),
 residentPeakBytes:z.number().nullable().optional(),
});
const jobSchema=z.object({
 name:z.string(),unit:z.string(),title:z.string(),does:z.string().optional(),schedule:z.string(),
 everySeconds:z.number(),graceSeconds:z.number(),timeoutSeconds:z.number().optional(),
 lastAttempt:attemptSchema.nullable().optional(),lastScheduledAttemptAt:z.string().nullable().optional(),
 lastSuccess:z.object({at:z.string(),trigger:z.string().nullable().optional(),memoryPeakBytes:z.number().nullable().optional(),
  memoryMaxBytes:z.number().nullable().optional(),memorySource:z.string().nullable().optional(),
  residentPeakBytes:z.number().nullable().optional()}).nullable().optional(),
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

/**
 * How close a run came to its memory ceiling, against its MemoryMax. Two figures, from the last attempt that
 * recorded either, else the last success:
 *  - resident: the largest resident set of any of its steps (pipeline/jobs.py `step`), the memory that could
 *    get it killed, and what `tight` is judged on when it is known;
 *  - unit: the unit's own cgroup peak, which also counts page cache the kernel reclaims before it would stop
 *    anything, and which a job reading the 0.9 GB warehouse fills towards its ceiling whatever it needs.
 * `tight` from 85%: the rebuild of 27 September read 1.4G of 1500M as a unit, 1.11 GB of it resident (backlog 39).
 */
export type MemoryHeadroom={residentMB:number|null;unitMB:number|null;maxMB:number|null;share:number|null;tight:boolean;
 basis:'resident'|'unit';from:'attempt'|'success';source:string|null};
export function memoryHeadroom(job:NightlyJob):MemoryHeadroom|null{
 const mb=(bytes:number)=>Math.round(bytes/1048576);
 const a=job.lastAttempt,s=job.lastSuccess;
 const pick=a&&(a.residentPeakBytes||a.memoryPeakBytes)
  ?{resident:a.residentPeakBytes??null,unit:a.memoryPeakBytes??null,max:a.memoryMaxBytes??null,from:'attempt' as const,source:null}
  :s&&(s.residentPeakBytes||s.memoryPeakBytes)
   ?{resident:s.residentPeakBytes??null,unit:s.memoryPeakBytes??null,max:s.memoryMaxBytes??null,from:'success' as const,source:s.memorySource??null}
   :null;
 if(!pick)return null;
 const basis=pick.resident?'resident' as const:'unit' as const;
 const peak=(pick.resident??pick.unit)!;
 const share=pick.max?peak/pick.max:null;
 return {residentMB:pick.resident?mb(pick.resident):null,unitMB:pick.unit?mb(pick.unit):null,maxMB:pick.max?mb(pick.max):null,
  share,tight:share!==null&&share>=0.85,basis,from:pick.from,source:pick.source};
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
