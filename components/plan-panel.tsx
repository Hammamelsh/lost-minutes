'use client';
// Which bus should they take? From a starting point (this device, or a fixed place chosen for
// this journey or for someone else) to a destination, the direct buses our timetable supports,
// each with its boarding stop and direction, where to get off and both walks; tracked buses by
// their last report, never minutes; and the hand-offs to a full planner for anything with changes.
import {useState} from 'react';
import {ArrowLeftRight,Bus,ExternalLink,LocateFixed,MapPin,Share2,X} from 'lucide-react';
import type {Stop} from '@/lib/stops';
import type {Place} from '@/lib/places';
import PlaceSearch from '@/components/place-search';
import {BEE_NETWORK_PLANNER,directArrival,planText,transitHandoff,type DirectOption,type DirectTiming} from '@/lib/plan';
import {CONNECTION_RULES,TIGHT_SECONDS,connectionArrival,estimatedWalk,legFamily,legService,lineNames,stopName as stopWords,
 type ConnectionOption,type ConnectionTiming} from '@/lib/connections';
import {clockOn} from '@/lib/departures';
import {PLACES_ATTRIBUTION} from '@/lib/places';

export type PlanFrom={kind:'device';lat:number;lon:number;accuracyMetres?:number}|{kind:'chosen';lat:number;lon:number;label:string};
export type PlanTo={lat:number;lon:number;label:string;detail?:string};

const metresWords=(m:number)=>`about ${Math.max(10,Math.round(m/10)*10)} m`;
const stopName=(s:Stop)=>s.indicator?`${s.name} (${s.indicator})`:s.name;

export default function PlanPanel({stops,day,from,to,device,onUseDevice,onChooseFrom,onSetTo,onChoose,onShowOnMap,link,chosenKey,compact=false,onOtherOptions,
                                  direct=[],directTimes=null,lead='direct',checking=false,connections=[],connectionTimes=null,onChooseConnection}:{
 stops:Stop[];day:string;
 from:PlanFrom|null;to:PlanTo|null;device:{lat:number;lon:number}|null;
 onUseDevice:()=>void;onChooseFrom:(place:Place)=>void;onSetTo:(place:PlanTo|null)=>void;
 onChoose:(option:DirectOption)=>void;onShowOnMap:()=>void;link:string;chosenKey:string|null;compact?:boolean;
 /** Back to the list of options, keeping the places (a chosen plan's summary). */
 onOtherOptions?:()=>void;
 /** Journeys with one change (lib/connections.ts), worked out by the view, listed after the direct buses
  *  in the order the view put them in by the timetable; with each one's times, or null while the
  *  timetables are being read. */
 connections?:ConnectionOption[];connectionTimes?:Map<string,ConnectionTiming>|null;onChooseConnection?:(option:ConnectionOption)=>void;
 /** Direct buses, found and put in order by the view like the journeys with one change, with their times. */
 direct?:DirectOption[];directTimes?:Map<string,DirectTiming>|null;
 /** Which kind gets there sooner (a change counted as ten minutes) and so leads; the other folds away. */
 lead?:'direct'|'connections';
 /** The timetables, and the walks between stops, still being read: no order to show yet. */
 checking?:boolean}){
 const [editing,setEditing]=useState<'from'|'to'|null>(null);
 const [sharing,setSharing]=useState(false);
 const [copied,setCopied]=useState<'no'|'yes'|'failed'>('no');
 const options=direct;
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
   <span className="plan-summary-actions">
    {onOtherOptions&&<button className="text-action" onClick={onOtherOptions} data-plan-other-options>Other options</button>}
    <button className="text-action" onClick={()=>onSetTo(null)} data-clear-plan>New destination</button></span></p>
 </section>;
 return <section className={`plan-panel${compact?' compact':''}`} aria-label="Plan a journey" data-plan={from&&to?'set':to?'to-only':'empty'}>
  <h3 className="section-head"><Bus size={15} aria-hidden="true"/> Plan a journey
   <small>direct buses and one change, from our timetables</small></h3>
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

  {to&&!from&&editing!=='from'&&<div className="plan-needs-start" role="status" data-plan-needs-start>
   <p><strong>Where are you starting from?</strong> The buses are found from there to {to.label}.</p>
   <div className="plan-needs-start-actions">
    <button className="action" onClick={onUseDevice} data-plan-use-location><LocateFixed size={15} aria-hidden="true"/> Use my location</button>
    <button className="text-action" onClick={()=>setEditing('from')}>Choose a starting point</button>
   </div>
  </div>}

  {from&&to&&<div className="plan-options" data-plan-options={options.length}>
   {checking&&<p className="plan-note" role="status" data-plan-checking>Finding times: reading the timetables{connections.length?' and checking the walks between stops':''}…</p>}
   {!checking&&options.length===0&&connections.length===0&&<p className="empty-state plan-empty" role="status"><strong>No bus journey found within a {900} m walk of both places on today’s timetable, direct or with one change.</strong>
    <span>That is what our timetables hold (four operators), not proof that no journey exists: the planners below take the same places.</span></p>}
   {!checking&&options.length===0&&connections.length>0&&<p className="plan-note" role="status" data-plan-no-direct>No direct bus within a 900 m walk of both places today; these need one change.</p>}
   {!checking&&(()=>{
    const directCards=options.map(o=>{
     const access=estimatedWalk(o.walkToBoardMetres),egress=estimatedWalk(o.walkFromAlightMetres);
     const lines=[...new Set(legFamily(o.leg).map(l=>l.line))];
     return <article key={key(o)} className={`plan-option${key(o)===chosenKey?' on':''}`} data-plan-option={o.line}>
      <div className="plan-option-head">{lines.slice(0,3).map(line=><span key={line} className="route-pill">{line}</span>)}
       <strong>towards {[...new Set(legFamily(o.leg).map(l=>l.headsign))].join(' or ')}</strong>
       <small>{o.rideStops} stop{o.rideStops===1?'':'s'}{o.rideMetres?` · ${(o.rideMetres/1000).toFixed(1)} km by the timetable’s links`:''}</small></div>
      <NextDirect option={o} timing={directTimes?.get(o.key)??null} day={day}/>
      <ol className="plan-legs">
       <li>Walk {metresWords(o.walkToBoardMetres)} <em>(straight line; about {minutes(access.seconds)} on foot, estimated)</em> to <strong>{stopName(o.board)}</strong></li>
       <li>Board the <strong>{legService(o.leg)}</strong></li>
       <li>Get off at <strong>{stopName(o.alight)}</strong>, then walk {metresWords(o.walkFromAlightMetres)} <em>(straight line; about {minutes(egress.seconds)}, estimated)</em></li>
      </ol>
      <p className="plan-tracked">{o.tracked.length
       ? <>Tracked: the nearest bus between these stops is <strong>{o.tracked[0].stopsAway} stop{o.tracked[0].stopsAway===1?'':'s'}</strong> before your boarding stop, {o.tracked[0].bus.ageWords}{o.tracked.length>1?`; ${o.tracked.length-1} more behind it`:''}. No arrival minutes: it is placed by its last report.</>
       : <>No tracked bus is before your boarding stop right now. That is not “no bus”: check the stop’s live board after choosing.</>}</p>
      {o.caution&&<p className="plan-caution">Careful: {o.caution}.</p>}
      <button className="action" onClick={()=>onChoose(o)} data-choose-plan>{key(o)===chosenKey?'Chosen · open the boarding stop':'Choose this bus'}</button>
     </article>;
    });
    const connectionCards=connectionTimes===null?[]:connections.map(o=><article key={o.key} className={`plan-option connection${o.key===chosenKey?' on':''}`} data-plan-connection={`${o.first.line}|${o.second.line}`}>
      <div className="plan-option-head"><span className="route-pill">{o.first.line}</span><span className="plan-then" aria-hidden="true">→</span><span className="route-pill">{o.second.line}</span>
       <strong>one change at {o.transfer.sameStop?stopWords(o.transfer.to):o.transfer.to.name}</strong>
       <small>{o.first.rideStops+o.second.rideStops} stops</small></div>
      <NextConnection option={o} timing={connectionTimes.get(o.key)??null} day={day}/>
      <ol className="plan-legs">
       <li>Take the <strong>{legService(o.first)}</strong> from <strong>{stopWords(o.first.board)}</strong> <em>({metresWords(o.walkToBoardMetres)} away, straight line; about {minutes(estimatedWalk(o.walkToBoardMetres).seconds)} on foot, estimated)</em></li>
       <li>Get off at <strong>{stopWords(o.first.alight)}</strong>{o.transfer.sameStop?', and change there':<>, then walk to <strong>{stopWords(o.transfer.to)}</strong> <TransferWords option={o} timing={connectionTimes.get(o.key)??null}/></>}</li>
       <li>Take the <strong>{legService(o.second)}</strong>, get off at <strong>{stopWords(o.second.alight)}</strong>, then walk {metresWords(o.walkFromAlightMetres)} <em>(straight line; about {minutes(estimatedWalk(o.walkFromAlightMetres).seconds)}, estimated)</em></li>
      </ol>
      <button className="action" onClick={()=>onChooseConnection?.(o)} data-choose-connection>{o.key===chosenKey?'Chosen':'Choose this journey'}</button>
     </article>);
    // When each kind's soonest gets there, for the line a folded kind is summed up in.
    const soonest=(values:({arrive:number}|null)[])=>values.reduce<number|null>((best,v)=>v&&(best===null||v.arrive<best)?v.arrive:best,null);
    const soonestDirect=soonest(options.map(o=>{const t=directTimes?.get(o.key);return t?directArrival(t):null}));
    const soonestChange=soonest(connections.map(o=>{const t=connectionTimes?.get(o.key);return t?connectionArrival(o,t):null}));
    // Said as the rows under it say their times: at 23:50, the soonest at 00:40 is tomorrow's.
    const at=(ms:number|null)=>ms===null?'':` · soonest there ${clockOn(ms,day)}`;
    if(!options.length)return connectionCards;
    if(!connections.length)return directCards;
    return lead==='direct'
     ?<>{directCards}<details className="plan-connections" data-plan-connections={connections.length}>
       <summary>Journeys with one change ({connections.length}){at(soonestChange)}</summary>{connectionCards}</details></>
     :<><p className="plan-note" role="status" data-plan-change-first>A journey with one change gets there sooner than any direct bus.</p>
       {connectionCards}<details className="plan-connections" data-plan-direct-fold={options.length}>
       <summary>Direct buses ({options.length}){at(soonestDirect)}</summary>{directCards}</details></>;
   })()}
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

/**
 * A listed journey's next connection by the timetable, on one line: when to leave from the first stop,
 * when the second bus reaches the stop to get off at. The timetable's, said to be; a timetable known to
 * mislead gives no time, and says why.
 */
function NextConnection({option,timing,day}:{option:ConnectionOption;timing:ConnectionTiming|null;day:string}){
 if(!timing)return null;
 if(timing.kind==='withheld')return <p className="plan-next warn" data-plan-next="withheld">No times: the {timing.leg===1?option.first.line:option.second.line}’s {timing.reason}.</p>;
 if(timing.kind==='unavailable')return <p className="plan-next" data-plan-next="unavailable">No times: {timing.reason}.</p>;
 const row=timing.rows.find(r=>r.second)??null;
 const when=(ms:number)=>clockOn(ms,day);
 if(!row){const first=timing.rows[0];
  return <p className="plan-next" data-plan-next="no-second">Next {first.first.departure.line} {when(first.first.departMs)}, but no {lineNames(option.second)} is timetabled within 90 min of it reaching the change.</p>}
 const arrive=row.second!.arriveMs;
 // The walk from the last stop, provisional as every walk here is, so that two journeys ending at
 // different distances from the destination can be compared from their lines alone.
 const walkMinutes=Math.round(option.walkFromAlightMetres*CONNECTION_RULES.transferDetour/CONNECTION_RULES.walkMetresPerMinute);
 return <p className="plan-next" data-plan-next="timed">Next: <strong>{row.first.departure.line} {when(row.first.departMs)}</strong>
  {row.earlier?` (or ${row.earlier.count>1?'any from':row.earlier.line===row.first.departure.line?'the':`the ${row.earlier.line} at`} ${when(row.earlier.departMs)})`:''} from {stopWords(option.first.board)}
  <Tight spare={row.boardSpareSeconds} basis={timing.access.basis}/>
  {arrive!==null?<> · at {option.second.alight.name} <strong>{when(arrive)}</strong></>:<> · then the {row.second!.departure.line} {when(row.second!.departMs)}</>}
  {walkMinutes>=3?` · then about ${walkMinutes} min on foot`:''}
  <small> · by the timetable, not live</small></p>;
}

const minutes=(seconds:number)=>`${Math.max(1,Math.round(seconds/60))} min`;

/** A bus that leaves under two minutes after the walk to its stop would be done: said, because the
 *  walk is estimated and a longer one would lose it. */
function Tight({spare,basis}:{spare:number;basis:string}){
 if(spare>=TIGHT_SECONDS)return null;
 return <small className="plan-tight" data-tight> · tight: under 2 min to spare{basis==='route'?' after the walk':' on an estimated walk'}</small>;
}

/** The walk between the two stops as the list has it: checked by the router before anything is
 *  chosen where it could be, else the straight line, lengthened, and said to be unchecked. */
function TransferWords({option,timing}:{option:ConnectionOption;timing:ConnectionTiming|null}){
 const walk=timing&&timing.kind==='timed'?timing.walk:null;
 if(walk&&walk.basis==='route')return <em data-transfer-walk="checked">({minutes(walk.seconds)}, about {Math.max(10,Math.round(walk.metres/10)*10)} m, a checked route)</em>;
 return <em data-transfer-walk="estimated">({metresWords(option.transfer.straightMetres)} in a straight line, about {minutes(estimatedWalk(option.transfer.straightMetres).seconds)}; not checked)</em>;
}

/**
 * A listed direct option's next bus by the timetable, on one line: when it leaves the boarding stop
 * (one the passenger can walk to in time), when it reaches the stop to get off at, and the walk on.
 */
function NextDirect({option,timing,day}:{option:DirectOption;timing:DirectTiming|null;day:string}){
 if(!timing)return null;
 if(timing.kind==='withheld')return <p className="plan-next warn" data-plan-next="withheld">No times: the {option.line}’s {timing.reason}.</p>;
 if(timing.kind==='unavailable')return <p className="plan-next" data-plan-next="unavailable">No times: {timing.reason}.</p>;
 const row=timing.rows[0];
 const when=(ms:number)=>clockOn(ms,day);
 const walkOn=Math.round(timing.egress.seconds/60);
 return <p className="plan-next" data-plan-next="timed">Next: <strong>{row.departure.line} {when(row.departMs)}</strong> from {stopWords(option.board)}
  <Tight spare={row.spareSeconds} basis={timing.access.basis}/>
  {row.arriveMs!==null?<> · at {option.alight.name} <strong>{when(row.arriveMs)}</strong></>:''}
  {walkOn>=3?` · then about ${walkOn} min on foot`:''}
  <small> · by the timetable, not live</small></p>;
}
