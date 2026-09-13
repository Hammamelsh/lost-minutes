"use client";

import {Footprints,LocateFixed,RefreshCw} from 'lucide-react';
import {distanceWords,straightMetres,walkWords,type WalkingConfig} from '@/lib/walking';
import type {WalkStatus} from '@/lib/use-walking';

/**
 * Walking to the boarding point: asked for only on request, with what gets sent and to whom
 * said first. A failure is stated with its reason; a straight line is labelled as one and is
 * never offered as the walking distance.
 */
export default function WalkGuide({state,config,here,stop,consent,onConsent,onRetry,onLocate,locating,locationError}:{
 state:WalkStatus;config:WalkingConfig;here:{lat:number;lon:number;accuracyMetres?:number}|null;
 stop:{id:string;lat:number;lon:number;name:string;indicator?:string|null};consent:boolean;
 onConsent:(value:boolean)=>void;onRetry:()=>void;onLocate?:()=>void;locating?:boolean;locationError?:string}){
 const straight=here?straightMetres(here,stop):null;
 const route='route' in state?state.route:undefined;
 const words=route?walkWords(route):null;
 const provider=`${config.name}${config.operator?` (${config.operator})`:''}`;
 const stopName=`${stop.name}${stop.indicator?` (${stop.indicator})`:''}`;
 return <div className={`walk-guide walk-${state.status}`} aria-live="polite" data-walk={state.status}>
  <div className="walk-head">
   <Footprints size={16} aria-hidden="true"/>
   {words&&state.status!=='problem'
    ? <p className="walk-answer"><strong>{words.time} walk</strong><span>{words.distance} to {stopName}</span></p>
    : <p className="walk-answer"><strong>Walk to {stopName}</strong>
       {straight!==null&&<span>{distanceWords(straight)} in a straight line, not a walking route</span>}</p>}
  </div>

  {state.status==='idle'&&!consent&&<div className="walk-consent">
   <p>Directions send your location, rounded to about 10 m, and this stop’s location to {provider},
    which logs requests. Nothing is sent until you ask.
    {config.privacyUrl&&<> <a href={config.privacyUrl} target="_blank" rel="noopener noreferrer">Their privacy statement</a></>}</p>
   <button className="walk-action" onClick={()=>onConsent(true)} disabled={!here}>
    <Footprints size={15}/>Show walking route</button>
  </div>}

  {state.status==='loading'&&<p className="walk-status">Asking {config.name} for a walking route…</p>}

  {state.status==='problem'&&<div className="walk-problem" role="status">
   <p>{state.problem.message}</p>
   <div className="walk-problem-actions">
    {(state.problem.code==='no_location'||state.problem.code==='inaccurate')&&onLocate&&
     <button className="walk-action" onClick={onLocate} disabled={locating}><LocateFixed size={15}/>Locate me</button>}
    {state.problem.retry&&state.problem.code!=='inaccurate'&&
     <button className="walk-action" onClick={onRetry}><RefreshCw size={15}/>Try again</button>}
   </div>
   {locationError&&state.problem.code==='no_location'&&<p className="walk-note">{locationError}</p>}
  </div>}

  {route&&state.status!=='problem'&&<p className="walk-basis">
   Route and time from {provider}’s foot profile, at its walking pace
   {route.startGapMetres>25?`; it starts ${Math.round(route.startGapMetres)} m from you, on the nearest mapped path`:''}
   {route.endGapMetres>25?`; it ends ${Math.round(route.endGapMetres)} m from the stop, where no path is mapped`:''}.
   {' '}<a href={config.fixTheMapUrl} target="_blank" rel="noopener noreferrer">Fix the map</a>
   {consent&&<> · <button className="text-action" onClick={()=>onConsent(false)}>Stop sending my location</button></>}</p>}
 </div>;
}
