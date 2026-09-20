"use client";

import {ExternalLink,Footprints,LocateFixed,MapPinned,RefreshCw,Smartphone} from 'lucide-react';
import {distanceWords,straightMetres,walkWords,type WalkingConfig} from '@/lib/walking';
import {googleMapsLinkLabel,googleMapsWalkingUrl,originConfidence,type Origin} from '@/lib/origin';
import type {WalkStatus} from '@/lib/use-walking';

/**
 * Walking to the boarding point.
 *
 * The answer comes first and is only as confident as the start it was worked out from: a walking
 * time from a position that could be a street out is said with that doubt beside it, not as a
 * plain number. The passenger can take a fresh fix, choose the start themselves, or go back to
 * the device; and can hand the whole walk to Google Maps, which gets the boarding point by
 * coordinates and never by a name two stops share. Everything about how the route was worked out
 * sits behind one details control.
 */
export default function WalkGuide({state,config,here,origin,nowMs,stop,consent,onConsent,onRetry,onLocate,locating,
                                   locationError,pickingOrigin=false,onStartPicking,onCancelPicking}:{
 state:WalkStatus;config:WalkingConfig;here:{lat:number;lon:number;accuracyMetres?:number}|null;
 origin:Origin|null;nowMs:number;
 stop:{id:string;lat:number;lon:number;name:string;indicator?:string|null};consent:boolean;
 onConsent:(value:boolean)=>void;onRetry:()=>void;onLocate?:()=>void;locating?:boolean;locationError?:string;
 pickingOrigin?:boolean;onStartPicking?:()=>void;onCancelPicking?:()=>void}){
 const straight=here?straightMetres(here,stop):null;
 const route='route' in state?state.route:undefined;
 const words=route?walkWords(route):null;
 // nowMs is the page's own clock, 0 before its first tick, which originConfidence reads as no age.
 const confidence=originConfidence(origin,nowMs);
 const chosen=origin?.kind==='chosen';
 const provider=`${config.name}${config.operator?` (${config.operator})`:''}`;
 const stopName=`${stop.name}${stop.indicator?` (${stop.indicator})`:''}`;
 const showingRoute=Boolean(words&&state.status!=='problem');
 const mapsUrl=googleMapsWalkingUrl(stop,origin);

 // Compact by default: the answer, the hand-off, and one disclosure for the start and the workings.
 // While the start is missing or in doubt, the ways to fix it are in the open row, where the
 // caveat that names them is; once it is confident they fold away with the rest.
 const needsStart=!origin||!confidence.mayStateConfidently;
 const startButtons=<>
  {onLocate&&<button className="walk-action" onClick={onLocate} disabled={locating} data-update-location>
   {chosen?<Smartphone size={15}/>:<LocateFixed size={15} className={locating?'spin':''}/>}
   {chosen?'Use my device location':origin?'Update my location':'Locate me'}</button>}
  {onStartPicking&&origin&&<button className="walk-action" onClick={onStartPicking} data-choose-start>
   <MapPinned size={15}/>{chosen?'Choose a different start':'Choose starting point'}</button>}
 </>;

 return <div className={`walk-guide walk-${state.status} walk-origin-${confidence.band}`} aria-live="polite"
             data-walk={state.status} data-origin-band={confidence.band} data-origin-kind={origin?.kind??'none'}>
  <div className="walk-head">
   <Footprints size={16} aria-hidden="true"/>
   {showingRoute
    ? <p className="walk-answer">
       {/* A time from an uncertain start is hedged in the answer itself, where it is read. */}
       <strong>{confidence.mayStateConfidently?words!.time:<><em>about</em> {words!.time}</>} walk</strong>
       <span>{words!.distance} to {stopName}</span></p>
    : <p className="walk-answer">
       <strong>Walk there<span className="sr-only"> to {stopName}</span></strong>
       {straight!==null&&<span>{distanceWords(straight)} in a straight line, not a walking route</span>}</p>}
  </div>

  {/* Why the number above is hedged: one clause, beside it, while the start is in doubt. */}
  {showingRoute&&confidence.caveat&&<p className="walk-caveat" data-caveat>
   Starting point uncertain: {confidence.caveat}. Update your location or choose the start yourself.</p>}
  {chosen&&<p className="walk-origin-from">Starting from <strong>{origin!.label}</strong>, which you chose.</p>}

  {state.status==='loading'&&<p className="walk-status">Asking {config.name} for a walking route…</p>}

  {state.status==='problem'&&<div className={`walk-problem walk-${state.problem.code}`} role="status">
   <p>{state.problem.message}</p>
   {state.problem.retry&&state.problem.code!=='inaccurate'&&state.problem.code!=='no_location'&&
    <div className="walk-problem-actions"><button className="walk-action" onClick={onRetry}><RefreshCw size={15}/>Try again</button></div>}
   {locationError&&state.problem.code==='no_location'&&<p className="walk-note">{locationError}</p>}
  </div>}

  {/* The actions: our route (asked for, never sent unasked), the start while it needs fixing, and
      the hand-off, always offered once a stop is chosen: it needs neither our route nor our fix.
      The destination is the boarding point's coordinates; the origin goes only if the passenger chose it. */}
  {pickingOrigin
   ? <div className="walk-picking" role="status" data-picking>
      <span>Tap the map where you are starting from.</span>
      {onCancelPicking&&<button className="text-action" onClick={onCancelPicking}>Cancel</button>}
     </div>
   : <div className="walk-actions">
      {state.status==='idle'&&!consent&&here&&<button className="walk-action" onClick={()=>onConsent(true)} data-show-route
        aria-label="Show walking route"><Footprints size={15}/>Walking route</button>}
      {needsStart&&startButtons}
      <a className="walk-maps" href={mapsUrl} target="_blank" rel="noopener noreferrer" data-maps-link
         aria-label={`Walk to this stop in Google Maps${chosen?', from your chosen start':''}`}>
       <MapPinned size={16}/>{googleMapsLinkLabel(origin)}<ExternalLink size={14}/></a>
     </div>}
  {state.status==='idle'&&!consent&&here&&<p className="walk-consent-note">Sends your location, rounded to about 10 m, and this
   stop to {config.name}, which logs requests. Nothing is sent until you ask.
   {config.privacyUrl&&<> <a href={config.privacyUrl} target="_blank" rel="noopener noreferrer">Privacy</a></>}</p>}

  {/* The start once it is settled, and everything about how the walk was worked out, folded away. */}
  <details className="walk-details" data-walk-details>
   <summary>{needsStart?'How this walk is worked out':'Starting point, and how this walk is worked out'}</summary>
   {!needsStart&&!pickingOrigin&&<div className="walk-origin">{startButtons}</div>}
   <dl>
    {origin?.kind==='device'&&<>
     <dt>Your position</dt>
     <dd>{origin.accuracyMetres!==undefined?`accurate to about ${distanceWords(origin.accuracyMetres)}`:'accuracy not reported by your device'}
      {confidence.ageMs!==undefined&&`, taken ${Math.round(confidence.ageMs/1000)} s ago`}</dd></>}
    {chosen&&<><dt>Your position</dt><dd>{origin!.label}, chosen by you</dd></>}
    {route&&<>
     <dt>Route</dt><dd>{provider}’s foot profile, at its walking pace</dd>
     {route.startGapMetres>25&&<><dt>Start</dt><dd>begins {Math.round(route.startGapMetres)} m from the position above, on the nearest mapped path</dd></>}
     {route.endGapMetres>25&&<><dt>End</dt><dd>ends {Math.round(route.endGapMetres)} m from the stop, where no path is mapped</dd></>}
    </>}
    <dt>Google Maps</dt><dd>opens the boarding point by its coordinates ({stop.lat.toFixed(5)}, {stop.lon.toFixed(5)}, {stop.id}) in walking mode{chosen?', from your chosen start':', from wherever your phone says you are'}</dd>
   </dl>
   <p><a href={config.fixTheMapUrl} target="_blank" rel="noopener noreferrer">Fix the map</a>
    {consent&&<> · <button className="text-action" onClick={()=>onConsent(false)}>Stop sending my location</button></>}</p>
  </details>
 </div>;
}
