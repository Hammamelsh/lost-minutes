/**
 * The nightly jobs' own record (pipeline/jobs.py, published as /data/jobs.json): each job's last
 * attempt and how systemd says it ended, the last success, and the last scheduled attempt, from
 * which a missed night is judged. Read and judged here; nothing is inferred beyond it.
 */
import {z} from 'zod';

/** What the kernel did about a unit's memory in a run (pipeline/jobs.py memory_pressure): held at its ceiling,
 *  OOM events and kills, and seconds its processes waited on memory. Recorded from 29 September 2026. */
const pressureSchema={
 memoryEvents:z.object({atCeiling:z.number(),oom:z.number(),oomKills:z.number()}).partial().nullable().optional(),
 memoryStallSeconds:z.object({some:z.number(),full:z.number()}).partial().nullable().optional(),
};
const attemptSchema=z.object({
 startedAt:z.string().nullable(),finishedAt:z.string().nullable().optional(),
 trigger:z.enum(['timer','manual']).nullable().optional(),result:z.string(),
 serviceResult:z.string().nullable().optional(),exitCode:z.string().nullable().optional(),exitStatus:z.string().nullable().optional(),
 memoryPeakBytes:z.number().nullable().optional(),memoryMaxBytes:z.number().nullable().optional(),
 residentPeakBytes:z.number().nullable().optional(),...pressureSchema,
});
const jobSchema=z.object({
 name:z.string(),unit:z.string(),title:z.string(),does:z.string().optional(),schedule:z.string(),
 everySeconds:z.number(),graceSeconds:z.number(),timeoutSeconds:z.number().optional(),
 lastAttempt:attemptSchema.nullable().optional(),lastScheduledAttemptAt:z.string().nullable().optional(),
 lastSuccess:z.object({at:z.string(),trigger:z.string().nullable().optional(),memoryPeakBytes:z.number().nullable().optional(),
  memoryMaxBytes:z.number().nullable().optional(),memorySource:z.string().nullable().optional(),
  residentPeakBytes:z.number().nullable().optional(),...pressureSchema}).nullable().optional(),
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
 * A run's memory, as two figures that are never merged, from the last attempt that recorded either, else the last
 * success:
 *  - unit: the whole job's own cgroup peak, every process and the page cache it filled. Reading or copying the
 *    1.15 GB warehouse fills page cache towards the ceiling whatever the job needs, and the kernel takes it back
 *    before it would stop anything, so a unit at its ceiling is not by itself a job short of memory;
 *  - resident: the largest resident set of any single process of its steps (pipeline/jobs.py `step`). It is not
 *    the whole job's use: steps run one after another, and a step's other processes are not in it.
 * What tells the two situations apart is what the kernel did (recorded from 29 September 2026): how often the unit
 * was held at its ceiling, its OOM events and kills, and how long its processes waited on memory.
 * `tight` from 85% of the ceiling, on the resident figure where it is known, else the unit's (the rebuild of
 * 27 September read 1.4G of 1500M as a unit, 1.11 GB of it in one process; backlog 39). An OOM is always said.
 */
export type MemoryHeadroom={residentMB:number|null;unitMB:number|null;maxMB:number|null;
 residentShare:number|null;unitShare:number|null;
 atCeiling:number|null;oom:number|null;oomKills:number|null;stallSeconds:number|null;
 tight:boolean;outOfMemory:boolean;from:'attempt'|'success';source:string|null};
export function memoryHeadroom(job:NightlyJob):MemoryHeadroom|null{
 const mb=(bytes:number)=>Math.round(bytes/1048576);
 const a=job.lastAttempt,s=job.lastSuccess;
 const run=a&&(a.residentPeakBytes||a.memoryPeakBytes)?{...a,from:'attempt' as const,source:null}
  :s&&(s.residentPeakBytes||s.memoryPeakBytes)?{...s,from:'success' as const,source:s.memorySource??null}:null;
 if(!run)return null;
 const max=run.memoryMaxBytes??null,resident=run.residentPeakBytes??null,unit=run.memoryPeakBytes??null;
 const share=(x:number|null)=>x!==null&&max?x/max:null;
 const residentShare=share(resident),unitShare=share(unit);
 const events=run.memoryEvents??null,stall=run.memoryStallSeconds??null;
 const oom=events?.oom??null,oomKills=events?.oomKills??null;
 const outOfMemory=(oom??0)>0||(oomKills??0)>0||(run.from==='attempt'&&a?.serviceResult==='oom-kill');
 const judged=residentShare??unitShare;
 return {residentMB:resident?mb(resident):null,unitMB:unit?mb(unit):null,maxMB:max?mb(max):null,residentShare,unitShare,
  atCeiling:events?.atCeiling??null,oom,oomKills,stallSeconds:stall?.some??null,
  tight:judged!==null&&judged>=0.85,outOfMemory,from:run.from,source:run.source};
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
