"use client";
/**
 * The server's nightly jobs as they recorded themselves: for each, its last attempt (scheduled or by
 * hand) and how it ended, its last success, and whether a scheduled run is overdue. No status is
 * shown as healthy because nothing complained: a job that never ran is overdue, not quiet.
 */
import {useEffect,useState} from 'react';
import {CalendarClock} from 'lucide-react';
import {failureWords,judgeJob,memoryHeadroom,parseJobs,type NightlyJob} from '@/lib/jobs';
import {stamp} from '@/lib/operations';

const STATUS:Record<string,{words:string;tone:string}>={
 running:{words:'running',tone:'idle'},succeeded:{words:'succeeded',tone:'done'},failed:{words:'failed',tone:'bad'},
 unrecorded:{words:'no result recorded',tone:'warn'},never:{words:'no attempt recorded',tone:'idle'},
};
const by=(trigger:string|null|undefined)=>trigger==='manual'?'by hand':'scheduled';

export default function NightlyJobs(){
 const [jobs,setJobs]=useState<NightlyJob[]|null>(null);
 const [problem,setProblem]=useState<string|null>(null);
 const [now,setNow]=useState(0);
 useEffect(()=>{
  const abort=new AbortController();
  fetch('/data/jobs.json',{signal:abort.signal,cache:'no-store'})
   .then(r=>{if(!r.ok)throw Error(r.status===404?'No job record is published on this server yet.':`The job record could not be read (${r.status}).`);return r.json()})
   .then(value=>{setJobs(parseJobs(value).jobs);setNow(Date.now())})
   .catch(error=>{if(error.name!=='AbortError')setProblem(error instanceof Error?error.message:'The job record could not be read.')});
  const tick=setInterval(()=>setNow(Date.now()),60_000);
  return()=>{abort.abort();clearInterval(tick)};
 },[]);
 return <section className="ops-card nightly-jobs" aria-labelledby="nightly-jobs-heading" data-jobs={jobs?jobs.length:problem?'unavailable':'loading'}>
  <h3 id="nightly-jobs-heading"><CalendarClock size={17} aria-hidden="true"/> Nightly jobs</h3>
  <p className="nightly-jobs-lead">Each job records its own attempts on the server, and says whether the schedule or a person
   started it. A job whose scheduled run has not happened is shown as overdue.</p>
  {problem&&<p className="nightly-jobs-note" role="status">{problem}</p>}
  {jobs&&<div className="nightly-jobs-list">{jobs.map(job=>{
   const judged=judgeJob(job,now);
   const last=job.lastAttempt;
   const status=STATUS[judged.status];
   return <article key={job.name} className="nightly-job" data-job={job.name} data-job-status={judged.status} data-job-overdue={judged.overdue||undefined}>
    <header><strong>{job.title}</strong>
     <span className={`ops-chip ${status.tone}`}>{status.words}</span>
     {judged.overdue&&<span className="ops-chip bad" data-overdue>overdue</span>}</header>
    <small>{job.schedule}{job.does?` · ${job.does}`:''}</small>
    <dl>
     <div><dt>Last attempt</dt><dd>{last?.startedAt?<>{stamp(last.startedAt,false)} · {by(last.trigger)} · {judged.status==='failed'?failureWords(last):status.words}</>:'none recorded'}</dd></div>
     <div><dt>Last success</dt><dd>{job.lastSuccess?<>{stamp(job.lastSuccess.at,false)}{job.lastSuccess.trigger==='manual'?' · by hand':''}</>:'none recorded'}</dd></div>
     <div><dt>Last scheduled run</dt><dd>{job.lastScheduledAttemptAt?stamp(job.lastScheduledAttemptAt,false):'none recorded'}{judged.overdue?' · the next was due and has not run':''}</dd></div>
     {(()=>{const m=memoryHeadroom(job);const n=(x:number)=>x.toLocaleString('en-GB');const pc=(x:number|null)=>x===null?'':` (${Math.round(x*100)}%)`;
      // Two figures, never merged: the whole job with the page cache it filled, and its largest single process.
      // What the kernel did says which kind of peak it was (lib/jobs.ts memoryHeadroom).
      const kernel=m?[m.atCeiling===null?null:m.atCeiling>0?`held at its ceiling ${n(m.atCeiling)} time${m.atCeiling===1?'':'s'}, the kernel taking back page cache`:'never held at its ceiling',
       m.oomKills===null&&m.oom===null?null:m.outOfMemory?null:'no OOM',
       m.stallSeconds===null?null:`waited on memory ${m.stallSeconds<0.1?'under 0.1':m.stallSeconds.toFixed(1)} s`].filter(Boolean):[];
      return <div data-memory={m?(m.outOfMemory?'oom':m.tight?'tight':'ok'):'none'}><dt>Memory at its peak</dt><dd>{m
      ?<>{m.unitMB!==null&&<span data-memory-unit>Whole job {n(m.unitMB)} MB{m.maxMB?` of its ${n(m.maxMB)} MB ceiling`:''}{pc(m.unitShare)}, page cache included</span>}
       {m.residentMB!==null&&<span data-memory-resident>{m.unitMB!==null?'; largest':'Largest'} single process {n(m.residentMB)} MB resident{m.maxMB?pc(m.residentShare):''}</span>}
       {m.outOfMemory?<strong className="nightly-jobs-tight" data-memory-oom> · out of memory{m.oomKills?`: ${n(m.oomKills)} process${m.oomKills===1?'':'es'} killed`:''}</strong>
        :m.tight?<strong className="nightly-jobs-tight"> · close to its ceiling</strong>:''}
       <small> · {m.from==='attempt'?'last attempt':'last success'}{m.source==='journal'?', from the journal, rounded':''}
        {kernel.length?<span data-memory-kernel>; {kernel.join(', ')}</span>:''}</small></>
      :'not recorded yet'}</dd></div>})()}
    </dl>
    {job.seededFrom==='journal'&&<p className="nightly-jobs-note">Attempts before 28 September 2026 were read from the server’s journal; each run records itself from then.</p>}
   </article>})}</div>}
 </section>;
}
