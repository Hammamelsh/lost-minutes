"use client";

import {LocateFixed,MapPin,Navigation} from 'lucide-react';
import StopSearch from '@/components/stop-search';
import type {PatternCatalogue} from '@/lib/patterns';
import {patternsCallingAt} from '@/lib/patterns';
import {bearingWords,distanceWords,nearestStops,stopPlace,type Stop} from '@/lib/stops';

/**
 * Getting to a stop: location first because it is the common case, search beside it with
 * the same reach because location is often refused, wrong, or simply not wanted.
 *
 * Nothing here depends on live vehicles. The stop catalogue is static, so finding your stop
 * works when collection is down.
 */
export default function Nearby({stops,patterns,here,outsideArea,onSelect,onLocate,locating,
                                locationError,onClearHere,areaLabel}:{
 stops:Stop[];patterns:PatternCatalogue|null;here:{lat:number;lon:number;accuracyMetres?:number}|null;
 outsideArea:boolean;onSelect:(stop:Stop)=>void;onLocate:()=>void;locating:boolean;
 locationError?:string;onClearHere:()=>void;areaLabel:string}){
 const nearby=here&&!outsideArea?nearestStops(stops,here,6):[];

 return <section className="nearby">
  <div className="nearby-lead">
   <button className="nearby-action" onClick={onLocate} disabled={locating}>
    <Navigation size={19}/>{locating?'Finding you…':'Buses near me'}</button>
   <p className="nearby-or">or search — the same thing, without sharing a location</p>
   <StopSearch stops={stops} onSelect={onSelect} placeholder="Stop name, street or area"/>
  </div>

  {locationError&&<p className="nearby-note warn">{locationError}</p>}

  {here&&outsideArea&&<div className="nearby-outside">
   <MapPin size={19}/>
   <div>
    <strong>You are outside the area this copy collects</strong>
    <p>Positions and stops are held for {areaLabel} only. Nothing is hidden from you — there
    is simply no data here. Search for a stop inside the area to look around it.</p>
    <button className="text-action" onClick={onClearHere}>Forget my location</button>
   </div>
  </div>}

  {nearby.length>0&&<div className="nearby-list">
   <div className="nearby-head">
    <span><LocateFixed size={14}/> Stops near you</span>
    {here?.accuracyMetres&&<small>your position is accurate to about {Math.round(here.accuracyMetres)} m</small>}
   </div>
   {nearby.map(({stop,metres})=>{
    const serving=patternsCallingAt(patterns,stop.id);
    const lines=[...new Set(serving.map(p=>p.line))];
    return <button key={stop.id} className="nearby-stop" onClick={()=>onSelect(stop)}>
     <span className="nearby-stop-pin"><MapPin size={16}/></span>
     <span className="nearby-stop-copy">
      <strong>{stop.name}</strong>
      <small>{[stop.indicator,bearingWords(stop.bearing),stop.street].filter(Boolean).join(' · ')}</small>
      <em>{stopPlace(stop)}</em>
      <span className="nearby-stop-lines">{lines.length
       ? `Confirmed here: ${lines.slice(0,6).join(', ')}`
       : 'No confirmed services here yet'}</span>
     </span>
     <span className="nearby-stop-distance">{distanceWords(metres).replace(' in a straight line','')}
      <small>straight line</small></span>
    </button>;
   })}
   <p className="nearby-note">Distances are straight lines, not walking distance, and the two
   sides of a road are different stops. Check the direction before you cross.</p>
  </div>}
 </section>;
}
