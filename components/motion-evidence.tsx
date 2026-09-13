"use client";

import {useEffect,useMemo,useState} from 'react';
import {decodePolyline} from '@/lib/motion';
import {clock} from '@/lib/replay';

type Stat={p50:number|null;p80:number|null;p90:number|null};
type Bin={upTo:number;n:number;model:Stat;baseline:Stat;betterThanBaseline:number|null;bandCoverage:number|null};
type Replay={operator:string;vehicle:string;route:string;direction:string;journeyRef:string;pattern:string|null;
 shapeFile:string|null;fixes:[number,number,number,number][];
 estimates:[number,number,number,number,number,number,number][]};
type Visible={n:number;meanMove?:number|null;p50:number|null;p80:number|null;p95:number|null;snapped:number|null;back:number|null;forward:number|null};
type Evaluation={version:string;method:string;generatedAt:string;supported:boolean;
 visibleCorrections?:{basis:string;heldOut?:Visible;heldOutConstantSpeed?:Visible;heldOutPrevious?:Visible&{setting?:string}};
 data:{reportsSha256:string;lines:string[];split:string;training:{sequences:number;fixes:number};
  heldOut:{sequences:number;fixes:number}};
 params:Record<string,unknown>;fitted:Record<string,unknown>;
 heldOut:{bins:Bin[];abstained:{reason:string;count:number}[];
  headline:{reportAgeUpTo:number;n:number;modelMedianMetres:number|null;baselineMedianMetres:number|null}};
 replay:Replay[];notes:string[]};

const metres=(v:number|null|undefined)=>v===null||v===undefined?'—':`${Math.round(v)} m`;
const share=(v:number|null|undefined)=>v===null||v===undefined?'—':`${Math.round(v*100)}%`;

/**
 * The evidence behind estimated movement: how far estimates were from the reports that later
 * arrived, beside the last report's own error, on held-out captures, with a replay of real
 * held-out journeys. Sparse reports cannot check a drawn position between two of them.
 */
export default function MotionEvidence(){
 const [evaluation,setEvaluation]=useState<Evaluation|null|undefined>(undefined);
 const [pick,setPick]=useState(0);
 const [step,setStep]=useState(0);
 const [shapes,setShapes]=useState<Record<string,[number,number][]>>({});
 useEffect(()=>{
  let current=true;
  fetch('/data/motion-evaluation.json',{cache:'no-store'}).then(r=>r.ok?r.json():null)
   .then(value=>{if(current)setEvaluation(value)}).catch(()=>{if(current)setEvaluation(null)});
  return()=>{current=false};
 },[]);
 const sample=evaluation?.replay[pick];
 const shapeFile=sample?.shapeFile??null;
 useEffect(()=>{
  if(!shapeFile||shapes[shapeFile])return;
  let current=true;
  fetch(`/data/shapes/${shapeFile}`).then(r=>r.ok?r.json():null)
   .then(value=>{if(current&&value?.polyline6)setShapes(all=>({...all,[shapeFile]:decodePolyline(value.polyline6,6)}))})
   .catch(()=>{});
  return()=>{current=false};
 },[shapeFile,shapes]);
 const shape=shapeFile?shapes[shapeFile]??null:null;
 const estimate=sample?.estimates[Math.min(step,Math.max(0,(sample?.estimates.length??1)-1))];

 const frame=useMemo(()=>{
  if(!sample)return null;
  const points:[number,number][]=[...sample.fixes.map(f=>[f[3],f[2]] as [number,number]),
   ...sample.estimates.map(e=>[e[4],e[3]] as [number,number])];
  const lons=points.map(p=>p[0]),lats=points.map(p=>p[1]);
  const pad=0.0015,minLon=Math.min(...lons)-pad,maxLon=Math.max(...lons)+pad,minLat=Math.min(...lats)-pad,maxLat=Math.max(...lats)+pad;
  const k=Math.cos((minLat+maxLat)/2*Math.PI/180),width=(maxLon-minLon)*k,height=maxLat-minLat,scale=320/Math.max(width,height);
  const at=(lon:number,lat:number)=>[(lon-minLon)*k*scale+10,(maxLat-lat)*scale+10] as const;
  return {at,w:width*scale+20,h:height*scale+20,
   inside:(p:[number,number])=>p[0]>=minLon&&p[0]<=maxLon&&p[1]>=minLat&&p[1]<=maxLat};
 },[sample]);

 if(evaluation===undefined)return <section className="motion-evidence"><p>Loading the motion evaluation…</p></section>;
 if(evaluation===null)return <section className="motion-evidence">
  <h3>Estimated movement</h3>
  <p>No motion evaluation has been published, so every bus is drawn only where it reported.</p></section>;

 if(!evaluation.heldOut?.bins||!evaluation.data||!Array.isArray(evaluation.replay))
  return <section className="motion-evidence"><h3>Estimated movement</h3>
   <p>The published motion evaluation could not be read in full, so it is not summarised here.</p></section>;
 const basis=estimate&&sample?sample.fixes.find(f=>f[0]===estimate[1]):undefined;
 const target=estimate&&sample?sample.fixes.find(f=>f[0]===estimate[2]):undefined;
 return <section className="motion-evidence" aria-label="Estimated movement, checked against later reports">
  <h3>Estimated movement, checked against the reports that followed</h3>
  <p>{evaluation.method}. {evaluation.supported
   ?`Within ${evaluation.heldOut.headline.reportAgeUpTo} s of a report, on held-out captures, the estimate’s median distance from the next report was ${metres(evaluation.heldOut.headline.modelMedianMetres)}, against ${metres(evaluation.heldOut.headline.baselineMedianMetres)} for the last report itself (${evaluation.heldOut.headline.n} cases).`
   :'On training captures it did not beat the last report, so the page does not draw estimates.'}</p>
  <dl className="motion-facts">
   <div><dt>Version</dt><dd>{evaluation.version}</dd></div>
   <div><dt>Routes</dt><dd>{evaluation.data.lines.join(', ')}</dd></div>
   <div><dt>Settings chosen on</dt><dd>captures before {clock(Date.parse(evaluation.data.split),true)}: {evaluation.data.training.sequences} journeys, {evaluation.data.training.fixes} reports</dd></div>
   <div><dt>Scored on (held out)</dt><dd>later captures: {evaluation.data.heldOut.sequences} journeys, {evaluation.data.heldOut.fixes} reports</dd></div>
   <div><dt>Reports file</dt><dd className="mono">SHA-256 {evaluation.data.reportsSha256.slice(0,12)}…</dd></div>
  </dl>
  <div className="motion-table-wrap"><table className="motion-table">
   <thead><tr><th>Report age up to</th><th>Cases</th><th>Estimate, median</th><th>Estimate, 8 in 10</th>
    <th>Last report, median</th><th>Estimate closer</th><th>Band held it</th></tr></thead>
   <tbody>{evaluation.heldOut.bins.map(bin=><tr key={bin.upTo}>
    <td>{bin.upTo} s</td><td>{bin.n}</td><td>{metres(bin.model.p50)}</td><td>{metres(bin.model.p80)}</td>
    <td>{metres(bin.baseline.p50)}</td><td>{share(bin.betterThanBaseline)}</td><td>{share(bin.bandCoverage)}</td></tr>)}</tbody>
  </table></div>
  {evaluation.visibleCorrections?.heldOut&&(()=>{
   const seen=evaluation.visibleCorrections.heldOut,constant=evaluation.visibleCorrections.heldOutConstantSpeed;
   const previous=evaluation.visibleCorrections.heldOutPrevious;
   const hold=Number(evaluation.params.holdBack??35),snap=Number(evaluation.params.largeCorrection??150);
   const compare=(pick:(v:Visible)=>number|null|undefined,unit:(v:number|null|undefined)=>string)=>[
    constant?`${unit(pick(constant))} at constant speed`:'',
    previous?`${unit(pick(previous))} with the earlier eased-speed model`:''].filter(Boolean).join(', ');
   return <>
    <h4>When a new report arrives</h4>
    <p className="motion-visible">On held-out captures each new report moved the estimate by a median
     of {metres(seen.p50)}, and by less than {metres(seen.p80)} in 8 cases of 10 ({seen.n} reports)
     {seen.meanMove!==null&&seen.meanMove!==undefined?`; ${metres(seen.meanMove)} on average (${compare(v=>v.meanMove,metres)})`:''}.
     In {share(seen.back)} it went back by more than {hold} m ({compare(v=>v.back,share)}); a
     smaller step back is held rather than drawn. {share(seen.snapped)} were over {snap} m ({compare(v=>v.snapped,share)}):
     those jump to the new report, and the card says by how much.</p>
   </>;
  })()}
  <h4>When nothing is estimated</h4>
  <ul className="motion-abstained">{evaluation.heldOut.abstained.slice(0,8).map(item=>
   <li key={item.reason}><strong>{item.count}</strong> {item.reason}</li>)}</ul>

  {sample&&frame&&<>
   <h4>Replay a held-out journey</h4>
   <div className="motion-picks" role="group" aria-label="Held-out journeys">
    {evaluation.replay.map((journey,i)=><button key={`${journey.vehicle}|${journey.journeyRef}`}
     aria-pressed={i===pick} onClick={()=>{setPick(i);setStep(0)}}>
     {journey.route} · {journey.direction} · {journey.estimates.length} estimates</button>)}
   </div>
   <label className="motion-scrub">Estimate {Math.min(step,sample.estimates.length-1)+1} of {sample.estimates.length}
    <input type="range" min={0} max={Math.max(0,sample.estimates.length-1)} value={Math.min(step,sample.estimates.length-1)}
     onChange={event=>setStep(Number(event.target.value))}/></label>
   <svg className="motion-replay" viewBox={`0 0 ${frame.w} ${frame.h}`} role="img"
    aria-label="Reports as dots; the estimate as a ring; lines to the report that arrived">
    {shape&&<polyline points={shape.filter(frame.inside).map(p=>frame.at(p[0],p[1]).join(',')).join(' ')}
     fill="none" stroke="#6d7e89" strokeWidth="2"/>}
    {sample.fixes.map(f=>{const [x,y]=frame.at(f[3],f[2]);return <circle key={f[0]} cx={x} cy={y} r={2.6} fill="#c6f36a" opacity={0.55}/>})}
    {estimate&&basis&&target&&(()=>{
     const [bx,by]=frame.at(basis[3],basis[2]),[tx,ty]=frame.at(target[3],target[2]),[ex,ey]=frame.at(estimate[4],estimate[3]);
     return <g>
      <line x1={bx} y1={by} x2={tx} y2={ty} stroke="#f1c68a" strokeDasharray="3 3" strokeWidth="1.4"/>
      <line x1={ex} y1={ey} x2={tx} y2={ty} stroke="#c6f36a" strokeWidth="1.6"/>
      <circle cx={bx} cy={by} r={4.4} fill="#f1c68a"/>
      <circle cx={tx} cy={ty} r={4.4} fill="#e8f1f5"/>
      <circle cx={ex} cy={ey} r={5.2} fill="none" stroke="#c6f36a" strokeWidth="2"/>
     </g>;
    })()}
   </svg>
   {estimate&&<p className="motion-replay-caption">Made at {clock(estimate[0],true)} from the report of {clock(estimate[1],true)} (amber);
    for {clock(estimate[2],true)}, {Math.round((estimate[2]-estimate[1])/1000)} s after it. The estimate (ring) was{' '}
    <strong>{metres(estimate[5])}</strong> from the report that then arrived (white); the last report was {metres(estimate[6])} from it.</p>}
  </>}
  <ul className="motion-notes">{evaluation.notes.map(note=><li key={note}>{note}</li>)}</ul>
 </section>;
}
