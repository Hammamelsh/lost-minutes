"use client";

import {AlertTriangle, Check, Database, FileClock, GitCompareArrows, Info, ShieldAlert} from 'lucide-react';
import {Table,TableBody,TableCell,TableHead,TableHeader,TableRow} from '@/components/ui/table';
import {Operations, humanAge, shortId, stamp, statusTone} from '@/lib/operations';

const NUMBER = new Intl.NumberFormat('en-GB');
const n = (v:number) => NUMBER.format(v);

function StatusChip({status}:{status:string|null|undefined}){
 if(!status)return <span className="ops-chip idle">not recorded</span>;
 return <span className={`ops-chip ${statusTone(status)}`}>{status.replaceAll('_',' ')}</span>;
}

export default function OperationsView({ops,servedSnapshotId}:{ops:Operations;servedSnapshotId?:string}){
 const {totals,freshness,servedSnapshot,recordedPublication}=ops;
 const unbalanced=ops.reconciliation.filter(r=>r.applicable!==false&&!r.balanced);
 const unchecked=ops.reconciliation.filter(r=>r.applicable===false);
 const latestRun=ops.runs[0];
 // The page can only vouch for the file it actually loaded.
 const agreesWithPage=!servedSnapshotId||!servedSnapshot.snapshotId||servedSnapshotId===servedSnapshot.snapshotId;

 const measures=[
  {label:'Newest source captured',value:stamp(freshness.latestSourceCapturedAt),
   note:'When the archive published the file upstream'},
  {label:'Source retrieved',value:stamp(freshness.latestSourceRetrievedAt),
   note:'When this machine downloaded it'},
  {label:'Last processing finished',value:stamp(freshness.lastProcessedAt),
   note:latestRun?`Run ended ${latestRun.status.replaceAll('_',' ')}`:'No run recorded'},
  {label:'Last publication',value:stamp(freshness.lastPublishedAt),
   note:'When the served snapshot was swapped in'},
 ];

 return <section className="ops">
  <header className="ops-heading">
   <span className="eyebrow">PIPELINE OPERATIONS</span>
   <h2>What the pipeline actually did.</h2>
   <p>Every figure below is read from the DuckDB run history and from the snapshot file on
   disk. Nothing is a live reading, and no status is shown as healthy simply because a
   command exited.</p>
   <div className="ops-mode-labels">
    <span className="ops-mode archive"><FileClock size={14}/> HISTORICAL ARCHIVE REPLAY</span>
    {/* This record is the archive import's; live collection runs are kept in the warehouse and
        summarised in the live publication, not here. */}
    <span className="ops-mode idle">LIVE RUNS ARE NOT IN THIS RECORD</span>
   </div>
  </header>

  <div className="ops-measures">
   {measures.map(m=><div key={m.label}><span className="ops-measure-label">{m.label}</span>
    <strong>{m.value}</strong><small>{m.note}</small></div>)}
  </div>

  <div className="ops-note-row">
   <Info size={15}/>
   <p><strong>Source age at publication: {humanAge(freshness.sourceAgeSecondsAtPublication)}.</strong>{' '}
   That is the gap between the newest source file and the moment it was published. On a
   historical archive a large number is expected: it measures the data, not the pipeline.
   Source freshness and processing time are different things.</p>
  </div>

  <div className="ops-columns">
   <section className="ops-card">
    <h3><Database size={17}/> Snapshot being served</h3>
    <dl>
     <div><dt>Snapshot id</dt><dd className="mono">{servedSnapshot.snapshotId??'—'}</dd></div>
     <div><dt>File</dt><dd className="mono">{servedSnapshot.path}</dd></div>
     <div><dt>SHA-256 of the file on disk</dt><dd className="mono wrap">{servedSnapshot.sha256??'—'}</dd></div>
     <div><dt>Observations in the file</dt><dd>{n(servedSnapshot.observationCount??0)}</dd></div>
     <div><dt>Recorded publication</dt><dd className="mono">{shortId(recordedPublication?.publicationId,22)}</dd></div>
     <div><dt>Journeys recorded</dt><dd>{n(recordedPublication?.journeyCount??0)}</dd></div>
    </dl>
    <p className={servedSnapshot.matchesRecordedPublication?'ops-verdict ok':'ops-verdict bad'}>
     {servedSnapshot.matchesRecordedPublication
      ? <><Check size={15}/> The file on disk matches the publication recorded in the warehouse, by hash and by id.</>
      : <><ShieldAlert size={15}/> The file on disk does not match the last recorded publication. Treat the served data as unverified until the pipeline is run again.</>}
    </p>
    {!agreesWithPage&&<p className="ops-verdict bad"><ShieldAlert size={15}/> This page loaded
     snapshot {shortId(servedSnapshotId,20)}, but Operations describes{' '}
     {shortId(servedSnapshot.snapshotId,20)}. One of the two files was replaced after the
     other was read; reload the page.</p>}
   </section>

   <section className="ops-card">
    <h3><GitCompareArrows size={17}/> Inputs and what became of them</h3>
    <dl>
     <div><dt>Source files stored</dt><dd>{n(totals.rawSources)}</dd></div>
     <div><dt>Vehicle reports in the sources</dt><dd>{n(totals.activitiesTotal)}</dd></div>
     <div><dt>Inside the selected area</dt><dd>{n(totals.activitiesInArea)}</dd></div>
     <div><dt>Outside the area, not published</dt><dd>{n(totals.outsideArea)}</dd></div>
     <div><dt>Refused by validation</dt><dd>{n(totals.rejectedRecords)}</dd></div>
     <div><dt>Retained as observations</dt><dd>{n(totals.retainedObservations)}</dd></div>
     <div><dt>Repeats of an observation already held</dt><dd>{n(totals.repeatObservations)}</dd></div>
     <div><dt>Conflicting identities withheld</dt><dd>{n(totals.conflictIdentities)}</dd></div>
     <div><dt>Outside the capture window</dt><dd>{n(totals.outsideCaptureWindow)}</dd></div>
     <div><dt>Published to the map</dt><dd>{n(totals.publishedObservations)}</dd></div>
    </dl>
    <p className="microcopy">{totals.rejectedRecords===0
     ? 'No record in this sample was refused by validation. That is a property of this sample, not a guarantee about the feed.'
     : `${n(totals.rejectedRecords)} records were refused. Reasons are listed below.`}</p>
   </section>
  </div>

  <section className="ops-card">
   <h3>Do the totals add up?</h3>
   <p>Each row is computed twice, from different tables, and compared. A single unbalanced
   row means a count on this page cannot be trusted.</p>
   <Table><TableHeader><TableRow>
     <TableHead>Check</TableHead><TableHead>Expression</TableHead>
     <TableHead>Left</TableHead><TableHead>Right</TableHead><TableHead>Result</TableHead>
    </TableRow></TableHeader>
    <TableBody>{ops.reconciliation.map(r=><TableRow key={r.expression}>
     <TableCell>{r.label}{r.applicable===false&&r.note&&<><br/><small className="ops-note">{r.note}</small></>}</TableCell>
     <TableCell className="mono small">{r.expression}</TableCell>
     <TableCell className="mono">{typeof r.left==='number'?n(r.left):shortId(r.left,14)}</TableCell>
     <TableCell className="mono">{typeof r.right==='number'?n(r.right):shortId(r.right,14)}</TableCell>
     <TableCell><span className={`ops-chip ${r.applicable===false?'idle':r.balanced?'done':'bad'}`}>
      {r.applicable===false?'not checked here':r.balanced?'balanced':'UNBALANCED'}</span></TableCell>
    </TableRow>)}</TableBody></Table>
   {unbalanced.length>0&&<p className="ops-verdict bad"><AlertTriangle size={15}/> {unbalanced.length} check(s)
    did not balance. The published counts are not reconciled.</p>}
   {unbalanced.length===0&&unchecked.length>0&&<p className="ops-verdict"><Info size={15}/> Every check this
    warehouse can make balances; {unchecked.length} about the archive replay cannot be made here, and say so.</p>}
   {ops.rejections.length>0&&<div className="ops-rejections">
    <h4>Records refused, by reason</h4>
    <ul>{ops.rejections.map(r=><li key={r.reason}><strong>{n(r.count)}</strong> {r.reason.replaceAll('_',' ')}</li>)}</ul>
   </div>}
  </section>

  <section className="ops-card ops-runs">
   <h3>Run history</h3>
   <p>Processing and publication are recorded separately, because a run can read its inputs
   perfectly and still publish nothing if the candidate snapshot fails validation.</p>
   <div className="ops-table-scroll">
    <Table><TableHeader><TableRow>
      <TableHead>Started</TableHead><TableHead>Mode</TableHead><TableHead>Processing</TableHead>
      <TableHead>Sources</TableHead><TableHead>In area</TableHead><TableHead>New</TableHead>
      <TableHead>Repeats</TableHead><TableHead>Conflicts</TableHead><TableHead>Refused</TableHead>
      <TableHead>Publication</TableHead>
     </TableRow></TableHeader>
     <TableBody>{ops.runs.map(run=><TableRow key={run.runId}>
      <TableCell>{stamp(run.startedAt)}<br/><small className="mono">{shortId(run.runId,18)}</small></TableCell>
      <TableCell>{run.mode.replaceAll('_',' ')}<br/><small>{run.isHistorical?'archive':'live'}</small></TableCell>
      <TableCell><StatusChip status={run.status}/>{run.errorClass&&<><br/><small>{run.errorClass}</small></>}</TableCell>
      <TableCell>{n(run.sourcesProcessed)}/{n(run.sourcesSeen)}</TableCell>
      <TableCell>{n(run.activitiesInArea)}</TableCell>
      <TableCell>{n(run.newObservations)}</TableCell>
      <TableCell>{n(run.repeatObservations)}</TableCell>
      <TableCell>{n(run.conflictingObservations)}</TableCell>
      <TableCell>{n(run.rejectedRecords)}</TableCell>
      <TableCell><StatusChip status={run.publicationStatus}/>
       {run.publicationFailureReason&&<><br/><small className="mono">{run.publicationFailureReason}</small></>}</TableCell>
     </TableRow>)}</TableBody></Table>
   </div>
   {ops.runs.some(r=>r.status==='interrupted')&&<p className="microcopy">An interrupted run was
   left unfinished by a stopped process. The next run reports what it had claimed and repeats
   that work; loading the same source again adds no analytical rows.</p>}
  </section>

  <section className="ops-card">
   <h3>What each number means</h3>
   <dl className="ops-definitions">
    {Object.entries(ops.definitions).map(([key,text])=><div key={key}>
     <dt className="mono">{key}</dt><dd>{text}</dd></div>)}
   </dl>
  </section>

  <ul className="ops-notes">{ops.notes.map(note=><li key={note}>{note}</li>)}</ul>
 </section>;
}
