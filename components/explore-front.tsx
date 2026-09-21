'use client';
// An optional way in for someone with no stop in mind: a bus whose ride has the front view right
// now. Real eligibility from the latest publication (lib/explore.ts), never a showcase, and kept
// apart from the stop: choosing one is exploring a bus, not waiting for it anywhere.
import {useEffect,useState} from 'react';
import {Armchair} from 'lucide-react';
import type {FollowBus} from '@/lib/follow';
import {destinationLabel,directionLabel} from '@/lib/follow';
import {loadAcceptedPatterns,loadMotionModel,type MotionModel} from '@/lib/motion-view';
import {exploreCandidates,onAcceptedRoad} from '@/lib/explore';

export default function ExploreFront({buses,onChoose}:{buses:FollowBus[];onChoose:(bus:FollowBus)=>void}){
 const [accepted,setAccepted]=useState<Set<string>|null|undefined>(undefined);
 const [model,setModel]=useState<MotionModel|null|undefined>(undefined);
 useEffect(()=>{
  let live=true;
  loadAcceptedPatterns().then(value=>{if(live)setAccepted(value)});
  loadMotionModel().then(value=>{if(live)setModel(value)});
  return ()=>{live=false};
 },[]);
 const checking=accepted===undefined||model===undefined;
 const candidates=checking||!accepted?[]:exploreCandidates(buses,accepted,model??null);
 const onRoad=checking||!accepted?0:onAcceptedRoad(buses,accepted);
 const state=checking?'checking':!accepted?'unpublished':candidates.length?'ready':'none';
 return <section className="explore-front" aria-label="Explore a bus with the front view" data-explore={state}>
  <h3 className="section-head"><Armchair size={15} aria-hidden="true"/> Explore a bus with the front view
   <small>a look at the ride, not a bus for any stop</small></h3>
  {state==='checking'&&<p className="follow-hint">Checking which buses are on a checked road…</p>}
  {state==='unpublished'&&<p className="follow-hint">No road geometry is published, so no front view can be offered.</p>}
  {state==='none'&&<p className="follow-hint">None of the {buses.length} buses reporting has a recent report on a checked
   road{onRoad?` (${onRoad} ${onRoad===1?'is':'are'} on one, with older reports)`:''}. The front view needs a road checked
   against that service’s own reports; the buses are still listed below.</p>}
  {state==='ready'&&<div className="follow-list">
   {candidates.map(({bus,estimated})=><button key={bus.key} className="follow-row" onClick={()=>onChoose(bus)}
     data-explore-bus={bus.key} aria-label={`Explore route ${bus.route} to ${destinationLabel(bus.destination)}, ${estimated?'estimated movement':'reported positions'}, front view`}>
    <span className="route-pill">{bus.route}</span>
    <span className="follow-row-copy"><strong>to {destinationLabel(bus.destination)}</strong>
     <small>{directionLabel(bus.direction)} · {estimated?'Estimated movement':'Reported positions · may pause'} · Front view</small></span>
    <span className={`fresh-chip ${bus.freshness??'unknown'}`}>{bus.ageWords}</span>
   </button>)}
   <p className="follow-hint">Choosing one makes it your bus and frames it on the map; Ride along is on the map. It says nothing
    about any stop.</p>
  </div>}
 </section>;
}
