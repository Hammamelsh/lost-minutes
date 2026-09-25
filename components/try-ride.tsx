'use client';
// Try Ride-along: the way in for someone who has heard there is a ride and has no stop in mind.
// It offers only a bus whose own recent reports promise a clean ride now — on its checked road,
// moving along it, reporting steadily, with road left to ride (`cleanRideCandidates`) — and, when
// nothing live suits, a dated recording. Since 25 September 2026 it offers neither a bus on a road
// the model was scored on (drawn at an estimate, corrected by up to hundreds of metres as reports
// arrive: 119 of 159 offered rides jumped within three minutes, scripts/evaluate-ride-offers.mjs)
// nor one with no checked road (drawn on straight lines between reports). Choosing a live bus
// starts the ride at once; the bus becomes theirs, and the page says nothing about any stop. A
// recording is never dressed as live.
import {useEffect,useState} from 'react';
import {Armchair,Film} from 'lucide-react';
import type {FollowBus} from '@/lib/follow';
import {destinationLabel,directionLabel} from '@/lib/follow';
import {loadAcceptedPatterns,loadMotionModel,loadTrack,type MotionModel} from '@/lib/motion-view';
import {cleanRideCandidates,onAcceptedRoad,roadsToJudge,TIER_WORDS} from '@/lib/explore';
import type {Track} from '@/lib/motion';
import {rideWords,type RecordedRideSummary} from '@/lib/recorded-ride';

export default function TryRide({buses,live,recordings,onRide,onWatch,error}:{
 buses:FollowBus[];live:boolean;recordings:RecordedRideSummary[];
 onRide:(bus:FollowBus)=>void;onWatch:(ride:RecordedRideSummary)=>void;error?:string|null;
}){
 const [accepted,setAccepted]=useState<Set<string>|null|undefined>(undefined);
 const [model,setModel]=useState<MotionModel|null|undefined>(undefined);
 // The checked roads of the buses that might be offered: a bus is judged against its own road.
 const [roads,setRoads]=useState<ReadonlyMap<string,Track|null>>(new Map());
 useEffect(()=>{
  let alive=true;
  loadAcceptedPatterns().then(value=>{if(alive)setAccepted(value)});
  loadMotionModel().then(value=>{if(alive)setModel(value)});
  return ()=>{alive=false};
 },[]);
 const needed=!live||accepted===undefined||model===undefined?[]:roadsToJudge(buses,accepted??new Set(),model??null);
 const missing=needed.filter(id=>!roads.has(id));
 const missingKey=missing.join(',');
 useEffect(()=>{
  if(!missingKey)return;
  let alive=true;
  Promise.all(missingKey.split(',').map(id=>loadTrack(id).then(result=>[id,result.track] as const)))
   .then(loaded=>{if(alive)setRoads(previous=>{const next=new Map(previous);for(const [id,track] of loaded)next.set(id,track);return next})});
  return ()=>{alive=false};
 },[missingKey]);
 // Checking until the first roads are in; after that a newly needed road is judged when it arrives,
 // and the list meanwhile shows what is already known to be clean.
 const checking=live&&(accepted===undefined||model===undefined||(needed.length>0&&roads.size===0));
 const candidates=!live||checking?[]:cleanRideCandidates(buses,accepted??new Set(),model??null,id=>roads.get(id));
 const onRoad=!live||checking||!accepted?0:onAcceptedRoad(buses,accepted);
 const state=!live?'offline':checking?'checking':candidates.length?'ready':'none';
 // With nothing live to ride, the recording leads; otherwise it follows the live buses.
 const recordedFirst=state!=='ready'&&recordings.length>0;
 const recorded=recordings.length>0&&<div className="try-ride-recorded" data-ride-recordings={recordings.length}>
  {recordings.map(ride=><button key={ride.id} className="follow-row recorded" onClick={()=>onWatch(ride)}
    data-ride-recording={ride.id}
    aria-label={`Watch a recorded ride: route ${ride.route} to ${destinationLabel(ride.destination)}, ${rideWords(ride)}, a recording, not live`}>
   <span className="route-pill">{ride.route}</span>
   <span className="follow-row-copy"><strong><Film size={13} aria-hidden="true"/> Recorded ride · to {destinationLabel(ride.destination)}</strong>
    <small>{rideWords(ride)} · a recording, not live</small></span>
   <span className="fresh-chip archive">recorded</span>
  </button>)}
  {error&&<p className="follow-hint warn" role="alert">{error}</p>}
 </div>;
 return <section className="try-ride" id="try-ride" aria-label="Try Ride-along" data-rides={state} data-ride-live={candidates.length}>
  <h3 className="section-head"><Armchair size={15} aria-hidden="true"/> Try Ride-along
   <small>the map follows one bus · not a film</small></h3>
  <p className="try-ride-lead">Choose a bus and the map rides with it through the streets, at the pace its own
   reports allow. It is not for any stop; Exit is one tap.</p>
  {recordedFirst&&recorded}
  {state==='checking'&&<p className="follow-hint">Checking which buses suit a ride right now…</p>}
  {state==='offline'&&<p className="follow-hint" data-ride-none>Live positions are not arriving, so no live ride
   can be offered{recordings.length?'; the recording above is':''}.</p>}
  {state==='none'&&<p className="follow-hint" data-ride-none>None of the {buses.length} buses reporting would give a
   smooth ride right now{onRoad?` (${onRoad} ${onRoad===1?'is':'are'} on a checked road)`:''}: a ride is offered only
   for a bus moving along its checked road, reporting steadily, with road left to ride. This is checked again
   with every update.</p>}
  {state==='ready'&&<div className="follow-list">
   {candidates.map(({bus,tier})=><button key={bus.key} className="follow-row" onClick={()=>onRide(bus)}
     data-ride-bus={bus.key} data-ride-tier={tier}
     aria-label={`Try Ride-along with route ${bus.route} to ${destinationLabel(bus.destination)}: ${TIER_WORDS[tier]}`}>
    <span className="route-pill">{bus.route}</span>
    {/* The section is the verb; a row says where the bus goes. "Ride along · to The Trafford Centre"
        was cut short on a 390 px phone and the destination, the one thing that tells rows apart,
        was what it lost. The accessible name keeps the whole sentence. */}
    <span className="follow-row-copy"><strong>to {destinationLabel(bus.destination)}</strong>
     <small>{directionLabel(bus.direction)} · {TIER_WORDS[tier]}</small></span>
    <span className={`fresh-chip ${bus.freshness??'unknown'}`}>{bus.ageWords.replace('reported ','')}</span>
   </button>)}
  </div>}
  {!recordedFirst&&recorded}
 </section>;
}
