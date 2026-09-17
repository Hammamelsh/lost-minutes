'use client';

import {useEffect,useState} from 'react';
import {Check,Minus} from 'lucide-react';
import {coverageLedger,supportWords,type ShapeIndex} from '@/lib/coverage';
import type {PatternCatalogue} from '@/lib/patterns';
import type {LiveVehicle} from '@/lib/live';
import {londonDate} from '@/lib/service-days';

/**
 * Coverage, service by service, for the publication on screen.
 *
 * The honest answer to "does this app cover route N?" is four answers, and a reviewer should be
 * able to see all four without asking. Nothing here is a claim about the wider network: it counts
 * only the buses in the publication this page loaded, on this day.
 */
const FIRST=12;

export default function CoverageLedger({vehicles,patterns}:
 {vehicles:LiveVehicle[];patterns:PatternCatalogue|null}){
 const [all,setAll]=useState(false);
 // The day and the road shapes are both settled after the first paint: the day because reading the
 // clock during a render is not a pure thing to do, and the shapes because they are a small file
 // nobody needs until this view is opened. They arrive together so the ledger is drawn once.
 const [ready,setReady]=useState<{day:string;shapes:ShapeIndex|null}|null>(null);
 useEffect(()=>{
  let live=true;
  const day=londonDate(Date.now());
  const settle=(shapes:ShapeIndex|null)=>{if(live)setReady({day,shapes})};
  fetch('/data/shapes/index.json',{cache:'no-store'})
   .then(response=>response.ok?response.json():null)
   .then(value=>settle(value as ShapeIndex|null)).catch(()=>settle(null));
  return()=>{live=false};
 },[]);
 if(!ready)return null;
 const {day,shapes}=ready;
 if(!vehicles.length)return <section className="coverage"><h3>Coverage</h3>
  <p className="microcopy">No publication is loaded, so there is nothing to count.</p></section>;
 const ledger=coverageLedger(vehicles,patterns,shapes,day);
 const shown=all?ledger.services:ledger.services.slice(0,FIRST);
 return <section className="coverage" aria-label="Coverage by service">
  <div className="section-title"><h3>What can be said, service by service</h3>
   <span>{ledger.day}</span></div>
  <p className="microcopy">Counted from the {ledger.totals.reporting} vehicles in the publication
   this page is showing, across {ledger.totals.services} services. A position is nearly always
   available; a timetable, a checked road and estimated movement are not, and each is stated
   separately rather than rolled into one figure.{shapes===null&&' Road geometry is still loading.'}</p>
  <div className="coverage-totals">
   <div><strong>{ledger.totals.placed}</strong><span>of {ledger.totals.reporting} buses placed on a
    pattern by the timetable</span></div>
   <div><strong>{ledger.totals.withTimetableToday}</strong><span>of {ledger.totals.services} services
    with a registration running today</span></div>
   <div><strong>{ledger.totals.withGeometry}</strong><span>services with an accepted road shape, which
    is what estimated movement and the street preview need</span></div>
  </div>
  <ul className="coverage-list">
   {shown.map(row=><li key={row.key} className="coverage-row">
    <div className="coverage-row-head">
     <span className="route-pill">{row.line}</span>
     <strong>{row.operator??'operator not stated'}</strong>
     <span className="coverage-count">{row.reporting} reporting · {row.placed} placed</span>
    </div>
    <div className="coverage-marks">
     {supportWords(row).map(mark=><span key={mark.label} className={`coverage-mark ${mark.held?'yes':'no'}`}>
      {mark.held?<Check size={13}/>:<Minus size={13}/>}<b>{mark.label}</b><i>{mark.note}</i></span>)}
    </div>
    {row.refusals.length>0&&<ul className="coverage-refusals">
     {row.refusals.map(refusal=><li key={refusal.reason}>
      <b>{refusal.count}</b> {refusal.explanation}</li>)}
    </ul>}
   </li>)}
  </ul>
  {ledger.services.length>FIRST&&<button type="button" className="text-action" onClick={()=>setAll(v=>!v)}>
   {all?'Show the busiest services only':`Show all ${ledger.services.length} services`}</button>}
 </section>;
}
