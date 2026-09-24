"use client";

import {LocateFixed,MapPin,Navigation} from 'lucide-react';
import type {PatternCatalogue} from '@/lib/patterns';
import {patternsCallingAt} from '@/lib/patterns';
import {bearingWords,distanceWords,nearestStops,stopPlace,type Stop} from '@/lib/stops';

const COMPASS_DEGREES:Record<string,number>={N:0,NE:45,E:90,SE:135,S:180,SW:225,W:270,NW:315};

/**
 * Getting to a stop: location first because it is the common case, search beside it with
 * the same reach because location is often refused, wrong, or simply not wanted.
 *
 * Each boarding point says which side of the road it is (its NaPTAN bearing, the way buses
 * travel there) and which timetabled services leave from it today. Nothing here depends on
 * live vehicles, so finding your stop works when collection is down.
 */
export default function Nearby({stops,patterns,here,outsideArea,onSelect,onLocate,locating,
                                locationError,onClearHere,areaLabel,day,browseAt=null,onStopBrowsing,onTryRide}:{
 stops:Stop[];patterns:PatternCatalogue|null;here:{lat:number;lon:number;accuracyMetres?:number}|null;
 /** The map's centre after the passenger moved it and asked for stops there: the list is
  *  centred on it instead of on the device until they go back to their location. */
 browseAt?:{lat:number;lon:number}|null;onStopBrowsing?:()=>void;
 /** Try Ride-along, further down the panel: one quiet line under the primary task, so the ride
  *  is found from the first screen without competing with finding a stop. */
 onTryRide?:()=>void;
 outsideArea:boolean;onSelect:(stop:Stop)=>void;onLocate:()=>void;locating:boolean;
 locationError?:string;onClearHere:()=>void;areaLabel:string;day:string}){
 const origin=browseAt??(here&&!outsideArea?here:null);
 const nearby=origin?nearestStops(stops,origin,8):[];

 return <section className="nearby">
  <div className="nearby-lead">
   <button className="nearby-action" onClick={onLocate} disabled={locating}>
    <Navigation size={19}/>{locating?'Finding you…':'Buses near me'}</button>
   <p className="nearby-or">or search above, without sharing a location</p>
   {onTryRide&&<button className="text-action nearby-try-ride" onClick={onTryRide} data-try-ride-link>
    Or try Ride-along<small>the map rides with one bus</small></button>}
  </div>

  {locationError&&<p className="nearby-note warn">{locationError}</p>}

  {here&&outsideArea&&<div className="nearby-outside">
   <MapPin size={19}/>
   <div>
    <strong>You are outside the area this copy collects</strong>
    <p>Positions and stops are held for {areaLabel} only. Search for a stop inside the area
    to look around it.</p>
    <button className="text-action" onClick={onClearHere}>Forget my location</button>
   </div>
  </div>}

  {nearby.length>0&&<div className="nearby-list">
   <div className="nearby-head">
    <span><LocateFixed size={14}/> {browseAt?'Stops around the map’s centre':'Stops near you'}</span>
    {browseAt
     ? <button className="text-action" onClick={onStopBrowsing}>{here?'Back to my location':'Stop browsing here'}</button>
     : here?.accuracyMetres?<small>your position is accurate to about {Math.round(here.accuracyMetres)} m</small>:null}
   </div>
   {nearby.map(({stop,metres})=>{
    const today=patternsCallingAt(patterns,stop.id,day);
    const ever=today.length?today:patternsCallingAt(patterns,stop.id);
    const services=[...new Map(today.map(p=>[`${p.line}|${p.destination}`,p])).values()]
     .sort((a,b)=>a.line.localeCompare(b.line,undefined,{numeric:true}));
    const towards=bearingWords(stop.bearing);
    const degrees=stop.bearing?COMPASS_DEGREES[stop.bearing.toUpperCase()]:undefined;
    return <button key={stop.id} className="nearby-stop" onClick={()=>onSelect(stop)}>
     <span className="nearby-stop-pin" aria-hidden="true">
      {degrees!==undefined?<Navigation size={15} style={{transform:`rotate(${degrees-45}deg)`}}/>:<MapPin size={16}/>}
     </span>
     <span className="nearby-stop-copy">
      <strong>{stop.name}{stop.indicator&&<span className="nearby-indicator">{stop.indicator}</span>}</strong>
      <small>{towards&&<b>{towards}</b>}{towards&&stop.street?' · ':''}{stop.street}</small>
      {stopPlace(stop)&&<em>{stopPlace(stop)}</em>}
      <span className={`nearby-stop-lines${services.length?'':' none'}`}>{services.length
       ? services.slice(0,4).map(p=>`${p.line} to ${p.destination??'?'}`).join(' · ')
         +(services.length>4?` · +${services.length-4} more`:'')
       : ever.length?'Timetabled here, but nothing runs today'
       : 'No timetable coverage for this stop yet'}</span>
     </span>
     <span className="nearby-stop-distance">{distanceWords(metres).replace(' away in a straight line','')}
      <small>straight line</small></span>
    </button>;
   })}
   <p className="nearby-note">Distances are straight lines, not walking routes. The two sides of
   a road are different stops: the direction shown is the way buses travel there.</p>
  </div>}
 </section>;
}
