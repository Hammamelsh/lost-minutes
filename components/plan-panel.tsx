'use client';
// Which bus should they take? From a starting point (this device, or a fixed place chosen for
// this journey or for someone else) to a destination, the direct buses our timetable supports,
// each with its boarding stop and direction, where to get off and both walks; tracked buses by
// their last report, never minutes; and the hand-offs to a full planner for anything with changes.
import {useMemo,useState} from 'react';
import {ArrowLeftRight,Bus,ExternalLink,MapPin,Share2,X} from 'lucide-react';
import type {Stop} from '@/lib/stops';
import type {PatternCatalogue} from '@/lib/patterns';
import type {FollowBus} from '@/lib/follow';
import type {Place} from '@/lib/places';
import PlaceSearch from '@/components/place-search';
import {BEE_NETWORK_PLANNER,directOptions,planText,transitHandoff,type DirectOption} from '@/lib/plan';
import {PLACES_ATTRIBUTION} from '@/lib/places';

export type PlanFrom={kind:'device';lat:number;lon:number;accuracyMetres?:number}|{kind:'chosen';lat:number;lon:number;label:string};
export type PlanTo={lat:number;lon:number;label:string;detail?:string};

const metresWords=(m:number)=>`about ${Math.max(10,Math.round(m/10)*10)} m`;
const stopName=(s:Stop)=>s.indicator?`${s.name} (${s.indicator})`:s.name;

export default function PlanPanel({stops,patterns,day,buses,from,to,device,onUseDevice,onChooseFrom,onSetTo,onChoose,onShowOnMap,link,chosenKey,compact=false}:{
 stops:Stop[];patterns:PatternCatalogue|null;day:string;buses:FollowBus[];
 from:PlanFrom|null;to:PlanTo|null;device:{lat:number;lon:number}|null;
 onUseDevice:()=>void;onChooseFrom:(place:Place)=>void;onSetTo:(place:PlanTo|null)=>void;
 onChoose:(option:DirectOption)=>void;onShowOnMap:()=>void;link:string;chosenKey:string|null;compact?:boolean}){
 const [editing,setEditing]=useState<'from'|'to'|null>(null);
 const [sharing,setSharing]=useState(false);
 const [copied,setCopied]=useState<'no'|'yes'|'failed'>('no');
 const options=useMemo(()=>from&&to?directOptions(from,to,patterns,stops,day,buses):[],[from,to,patterns,stops,day,buses]);
 const fromLabel=!from?null:from.kind==='device'?'My location':from.label;
 const key=(o:DirectOption)=>`${o.pattern.id}|${o.board.id}|${o.alight.id}`;
 const chosen=options.find(o=>key(o)===chosenKey)??null;
 const text=chosen&&from&&to?planText(chosen,{label:fromLabel??'the start'},to,link):null;
 async function copy(){
  if(!text)return;
  try{await navigator.clipboard.writeText(text);setCopied('yes')}catch{setCopied('failed')}
 }
 const swap=()=>{
  // The return is recomputed from the places, never the outward line read backwards. A start
  // that is the device becomes the destination as a fixed point, said so.
  if(!from||!to)return;
  const back:PlanTo={lat:from.lat,lon:from.lon,label:from.kind==='device'?'where you started':from.label};
  onChooseFrom({kind:'address',label:to.label,detail:to.detail??'',lat:to.lat,lon:to.lon,source:'photon'});
  onSetTo(back);
 };
 // With a stop open the plan stands back to one line: what was chosen, and the way to change it.
 if(compact&&chosen)return <section className="plan-panel compact" aria-label="Your plan" data-plan="chosen">
  <p className="plan-summary" data-plan-summary><Bus size={14} aria-hidden="true"/>
   <span><strong>Your plan:</strong> {chosen.line} towards {chosen.headsign} from <strong>{stopName(chosen.board)}</strong>, off at <strong>{stopName(chosen.alight)}</strong> ({chosen.rideStops} stop{chosen.rideStops===1?'':'s'}), then {metresWords(chosen.walkFromAlightMetres)} to {to?.label}.</span>
   <button className="text-action" onClick={()=>onSetTo(null)} data-clear-plan>Change plan</button></p>
 </section>;
 return <section className={`plan-panel${compact?' compact':''}`} aria-label="Plan a journey" data-plan={from&&to?'set':to?'to-only':'empty'}>
  <h3 className="section-head"><Bus size={15} aria-hidden="true"/> Plan a journey
   <small>direct buses from our timetable; changes through a full planner</small></h3>
  <div className="plan-fields">
   <div className="plan-field" data-field="from">
    <span className="plan-field-label">From</span>
    {editing==='from'
     ? <><PlaceSearch stops={stops} near={device??undefined} label="Starting point" placeholder="Postcode, address, landmark or stop"
        onUseDevice={()=>{onUseDevice();setEditing(null)}} onPick={p=>{onChooseFrom(p);setEditing(null)}} autoFocus/>
       <button className="text-action" onClick={()=>setEditing(null)}>Cancel</button></>
     : <button className="plan-place" onClick={()=>setEditing('from')} data-plan-from>
        <MapPin size={14} aria-hidden="true"/><strong>{fromLabel??'Choose a starting point'}</strong>
        <small>{!from?'my location, a postcode, an address, a landmark or a stop':from.kind==='device'?'this device, followed while the page is open':'a fixed starting point, not this device'}</small></button>}
   </div>
   <div className="plan-field" data-field="to">
    <span className="plan-field-label">To</span>
    {editing==='to'||!to
     ? <><PlaceSearch stops={stops} near={from??device??undefined} label="Destination" placeholder="Postcode, address, landmark or stop"
        onPick={p=>{onSetTo({lat:p.lat,lon:p.lon,label:p.label,detail:p.detail});setEditing(null)}} autoFocus={editing==='to'}/>
       {to&&<button className="text-action" onClick={()=>setEditing(null)}>Cancel</button>}</>
     : <button className="plan-place" onClick={()=>setEditing('to')} data-plan-to>
        <MapPin size={14} aria-hidden="true"/><strong>{to.label}</strong><small>{to.detail||'destination'}</small></button>}
   </div>
   {from&&to&&<div className="plan-actions">
    <button className="text-action" onClick={onShowOnMap}>Show both on the map</button>
    <button className="text-action" onClick={swap}><ArrowLeftRight size={14} aria-hidden="true"/> Plan the return</button>
    <button className="text-action" onClick={()=>onSetTo(null)} data-clear-plan><X size={14} aria-hidden="true"/> Clear destination</button>
   </div>}
  </div>

  {from&&to&&<div className="plan-options" data-plan-options={options.length}>
   {options.length===0&&<p className="empty-state plan-empty" role="status"><strong>No direct bus found within a {900} m walk of both places on today’s timetable.</strong>
    <span>Journeys with a change are not planned here; the planners below take the same places.</span></p>}
   {options.map(o=><article key={key(o)} className={`plan-option${key(o)===chosenKey?' on':''}`} data-plan-option={o.line}>
    <div className="plan-option-head"><span className="route-pill">{o.line}</span><strong>towards {o.headsign}</strong>
     <small>{o.rideStops} stop{o.rideStops===1?'':'s'}{o.rideMetres?` · ${(o.rideMetres/1000).toFixed(1)} km by the timetable’s links`:''}</small></div>
    <ol className="plan-legs">
     <li>Walk {metresWords(o.walkToBoardMetres)} <em>(straight line)</em> to <strong>{stopName(o.board)}</strong></li>
     <li>Board the <strong>{o.line}</strong> towards <strong>{o.headsign}</strong></li>
     <li>Get off at <strong>{stopName(o.alight)}</strong>, then walk {metresWords(o.walkFromAlightMetres)} <em>(straight line)</em></li>
    </ol>
    <p className="plan-tracked">{o.tracked.length
     ? <>Tracked: the nearest bus on this route is <strong>{o.tracked[0].stopsAway} stop{o.tracked[0].stopsAway===1?'':'s'}</strong> before your boarding stop, reported {o.tracked[0].ageSeconds??'?'} s ago{o.tracked.length>1?`; ${o.tracked.length-1} more behind it`:''}. No arrival minutes: it is placed by its last report.</>
     : <>No tracked bus is before your boarding stop right now. That is not “no bus”: check the stop’s live board after choosing.</>}</p>
    {o.caution&&<p className="plan-caution">Careful: {o.caution}.</p>}
    <button className="action" onClick={()=>onChoose(o)} data-choose-plan>{key(o)===chosenKey?'Chosen · open the boarding stop':'Choose this bus'}</button>
   </article>)}
   <div className="plan-handoffs">
    <a href={transitHandoff(from,to)} target="_blank" rel="noopener noreferrer" data-handoff="google"><ExternalLink size={14} aria-hidden="true"/> Whole journey in Google Maps (transit), with these two places</a>
    <a href={BEE_NETWORK_PLANNER} target="_blank" rel="noopener noreferrer" data-handoff="bee"><ExternalLink size={14} aria-hidden="true"/> Bee Network journey planner (official; it does not take the places from a link, so type them there)</a>
   </div>
   {chosen&&<div className="plan-share">
    <button className="text-action strong" onClick={()=>setSharing(s=>!s)} data-share-plan><Share2 size={14} aria-hidden="true"/> Share this plan</button>
    {sharing&&text&&<div className="plan-share-preview" data-share-preview>
     <p><strong>What is shared:</strong> the destination{from.kind==='device'?'':' and the fixed starting point you chose'}, the boarding and alighting stops and the route. {from.kind==='device'?'Not your device’s position: the link starts from wherever it is opened.':'Not this device’s position.'} Nothing in it tracks anyone, and the times are looked up afresh when it is opened.</p>
     <pre>{text}</pre>
     <button className="action" onClick={copy}>{copied==='yes'?'Copied':copied==='failed'?'Could not copy — select the text above':'Copy text and link'}</button>
    </div>}
   </div>}
  </div>}
  <p className="plan-attribution">{PLACES_ATTRIBUTION}</p>
 </section>;
}
