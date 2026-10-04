'use client';
// Which bus should they take? From a starting point (this device, or a fixed place chosen for
// this journey or for someone else) to a destination, the direct buses and the journeys with one
// change our timetables support. Each option says it in one look, as a passenger reads a journey
// planner: walk, bus, walk; when to leave and when it gets there by the timetable; and one Go, which
// starts the trip (components/trip-view.tsx). How it is worked out is one tap away under it.
// Tracked buses are placed by their last report, never given minutes; and the hand-offs to a full
// planner are offered for anything else.
import {useState} from 'react';
import {ArrowLeftRight,Bus,ChevronRight,ExternalLink,Footprints,LocateFixed,MapPin,Route,X} from 'lucide-react';
import type {Stop} from '@/lib/stops';
import type {Place} from '@/lib/places';
import PlaceSearch from '@/components/place-search';
import {BEE_NETWORK_PLANNER,directArrival,transitHandoff,type DirectOption,type DirectTiming} from '@/lib/plan';
import {TIGHT_SECONDS,connectionArrival,estimatedWalk,legService,lineNames,lineShort,stopName as stopWords,
 type ConnectionOption,type ConnectionTiming} from '@/lib/connections';
import {clockOn} from '@/lib/departures';
import {durationWords,leaveWords} from '@/lib/trip';
import {PLACES_ATTRIBUTION} from '@/lib/places';

export type PlanFrom={kind:'device';lat:number;lon:number;accuracyMetres?:number}|{kind:'chosen';lat:number;lon:number;label:string};
export type PlanTo={lat:number;lon:number;label:string;detail?:string};

const metresWords=(m:number)=>`about ${Math.max(10,Math.round(m/10)*10)} m`;
const minutes=(seconds:number)=>`${Math.max(1,Math.round(seconds/60))} min`;
/** A leg's lines on its pill: "142/42/42B", and for a longer family the first and how many more ("142 +4"), so the
 *  strip and the times share one line (the 142 from Oxford Road runs with four sibling lines in the evening). */
const pill=(leg:ConnectionOption['first'])=>{const lines=lineShort(leg).split('/');return lines.length>3?`${lines[0]} +${lines.length-1}`:lines.join('/')};
/** A leg's buses beside Go: where each goes, while that is short; else the lines, any of which calls at both stops. */
const goWords=(leg:ConnectionOption['first'])=>{const service=legService(leg);return service.length<=60?service:`any ${lineNames(leg)}`};

export default function PlanPanel({stops,day,nowMs,from,to,device,onUseDevice,onChooseFrom,onSetTo,onChoose,onShowOnMap,chosenKey,compact=false,resume=null,
                                  direct=[],directTimes=null,lead='direct',checking=false,connections=[],connectionTimes=null,onChooseConnection}:{
 stops:Stop[];day:string;
 /** The page's clock, for "Leave in 4 min". */
 nowMs:number;
 from:PlanFrom|null;to:PlanTo|null;device:{lat:number;lon:number}|null;
 onUseDevice:()=>void;onChooseFrom:(place:Place)=>void;onSetTo:(place:PlanTo|null)=>void;
 onChoose:(option:DirectOption)=>void;onShowOnMap:()=>void;chosenKey:string|null;compact?:boolean;
 /** A trip being made, kept while its options are looked at again: one line back to it. */
 resume?:{words:string;onResume:()=>void}|null;
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
 const options=direct;
 const fromLabel=!from?null:from.kind==='device'?'My location':from.label;
 const clock=(ms:number)=>clockOn(ms,day);
 const swap=()=>{
  // The return is recomputed from the places, never the outward line read backwards. A start
  // that is the device becomes the destination as a fixed point, said so.
  if(!from||!to)return;
  const back:PlanTo={lat:from.lat,lon:from.lon,label:from.kind==='device'?'where you started':from.label};
  onChooseFrom({kind:'address',label:to.label,detail:to.detail??'',lat:to.lat,lon:to.lon,source:'photon'});
  onSetTo(back);
 };
 return <section className={`plan-panel${compact?' compact':''}`} aria-label="Plan a journey" data-plan={from&&to?'set':to?'to-only':'empty'}>
  {resume&&<button className="trip-resume" onClick={resume.onResume} data-plan-resume>
   <Route size={15} aria-hidden="true"/><span><strong>Back to your trip</strong><small>{resume.words}</small></span>
   <ChevronRight size={15} aria-hidden="true"/></button>}
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
     const timing=directTimes?.get(o.key)??null;
     const t=timing?.kind==='timed'?timing:null;
     const access=t?t.access:estimatedWalk(o.walkToBoardMetres),egress=t?t.egress:estimatedWalk(o.walkFromAlightMetres);
     const row=t?.rows[0]??null;
     const chosen=o.key===chosenKey;
     return <article key={o.key} className={`plan-option${chosen?' on':''}`} data-plan-option={o.line}>
      <div className="plan-option-top">
       <Strip parts={[{walk:access.seconds},{lines:pill(o.leg)},{walk:egress.seconds}]}/>
       {row&&<When setOffMs={row.departMs-access.seconds*1000} arriveMs={row.arriveMs===null?null:row.arriveMs+egress.seconds*1000} clock={clock}/>}
      </div>
      <NextDirect option={o} timing={timing} clock={clock} nowMs={nowMs}/>
      {o.caution&&<p className="plan-caution">Careful: {o.caution}.</p>}
      <div className="plan-go">
       <button className="action" onClick={()=>onChoose(o)} data-choose-plan
        aria-label={`${chosen?'Continue':'Go'}: the ${o.line} from ${stopWords(o.board)} to ${stopWords(o.alight)}`}>{chosen?'Continue':'Go'}</button>
       <span className="plan-go-words">{goWords(o.leg)} · {o.rideStops} stop{o.rideStops===1?'':'s'}</span>
      </div>
      <details className="plan-more">
       <summary>Steps and tracked buses</summary>
       <ol className="plan-legs">
        <li>Walk {metresWords(o.walkToBoardMetres)} <em>(straight line; about {minutes(estimatedWalk(o.walkToBoardMetres).seconds)} on foot, estimated)</em> to <strong>{stopWords(o.board)}</strong></li>
        <li>Board the <strong>{legService(o.leg)}</strong></li>
        <li>Get off at <strong>{stopWords(o.alight)}</strong>, then walk {metresWords(o.walkFromAlightMetres)} <em>(straight line; about {minutes(estimatedWalk(o.walkFromAlightMetres).seconds)}, estimated)</em></li>
       </ol>
       <p className="plan-tracked">{o.tracked.length
        ? <>Tracked: the nearest bus between these stops is <strong>{o.tracked[0].stopsAway} stop{o.tracked[0].stopsAway===1?'':'s'}</strong> before your boarding stop, {o.tracked[0].bus.ageWords}{o.tracked.length>1?`; ${o.tracked.length-1} more behind it`:''}. No arrival minutes: it is placed by its last report.</>
        : <>No tracked bus is before your boarding stop right now. That is not “no bus”: the timetable still stands.</>}</p>
       {o.rideMetres?<p className="plan-ride-km">{(o.rideMetres/1000).toFixed(1)} km on the bus, by the timetable’s links.</p>:null}
      </details>
     </article>;
    });
    const connectionCards=connectionTimes===null?[]:connections.map(o=>{
     const timing=connectionTimes.get(o.key)??null;
     const t=timing?.kind==='timed'?timing:null;
     const access=t?t.access:estimatedWalk(o.walkToBoardMetres),egress=t?t.egress:estimatedWalk(o.walkFromAlightMetres);
     const between=t?t.walk:estimatedWalk(o.transfer.straightMetres);
     const row=t?.rows.find(r=>r.second)??null;
     const chosen=o.key===chosenKey;
     return <article key={o.key} className={`plan-option connection${chosen?' on':''}`} data-plan-connection={`${o.first.line}|${o.second.line}`}>
      <div className="plan-option-top">
       <Strip parts={[{walk:access.seconds},{lines:pill(o.first)},...(o.transfer.sameStop?[]:[{walk:between.seconds}]),{lines:pill(o.second)},{walk:egress.seconds}]}/>
       {row?.second&&<When setOffMs={row.first.departMs-access.seconds*1000} arriveMs={row.second.arriveMs===null?null:row.second.arriveMs+egress.seconds*1000} clock={clock}/>}
      </div>
      <NextConnection option={o} timing={timing} clock={clock} nowMs={nowMs}/>
      <div className="plan-go">
       <button className="action" onClick={()=>onChooseConnection?.(o)} data-choose-connection
        aria-label={`${chosen?'Continue':'Go'}: the ${o.first.line} then the ${o.second.line}`}>{chosen?'Continue':'Go'}</button>
       <span className="plan-go-words">one change at {o.transfer.sameStop?stopWords(o.transfer.to):o.transfer.to.name} · {o.first.rideStops+o.second.rideStops} stops</span>
      </div>
      <details className="plan-more">
       <summary>Steps and the change</summary>
       <ol className="plan-legs">
        <li>Take the <strong>{legService(o.first)}</strong> from <strong>{stopWords(o.first.board)}</strong> <em>({metresWords(o.walkToBoardMetres)} away, straight line; about {minutes(estimatedWalk(o.walkToBoardMetres).seconds)} on foot, estimated)</em></li>
        <li>Get off at <strong>{stopWords(o.first.alight)}</strong>{o.transfer.sameStop?', and change there':<>, then walk to <strong>{stopWords(o.transfer.to)}</strong> <TransferWords option={o} timing={timing}/></>}</li>
        <li>Take the <strong>{legService(o.second)}</strong>, get off at <strong>{stopWords(o.second.alight)}</strong>, then walk {metresWords(o.walkFromAlightMetres)} <em>(straight line; about {minutes(estimatedWalk(o.walkFromAlightMetres).seconds)}, estimated)</em></li>
       </ol>
       {row?.earlier&&<p className="plan-tracked">An earlier {row.earlier.line} {row.earlier.count>1?`(from ${clock(row.earlier.departMs)}, ${row.earlier.count} of them)`:`at ${clock(row.earlier.departMs)}`} makes the same {row.second?.departure.line}: it waits longer at the change.</p>}
      </details>
     </article>;
    });
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
  </div>}
  <p className="plan-attribution">{PLACES_ATTRIBUTION}</p>
 </section>;
}

/** An option in one look: the walks (estimated minutes) and the buses, in the order they are made. */
function Strip({parts}:{parts:({walk:number}|{lines:string})[]}){
 const shown=parts.filter(p=>!('walk' in p)||p.walk>=30);
 const words=shown.map(p=>'walk' in p?`walk ${minutes(p.walk)}`:`bus ${p.lines}`).join(', then ');
 return <span className="plan-strip" role="img" aria-label={words} data-plan-strip>
  {shown.map((p,i)=><span key={i} className="plan-strip-part">
   {i>0&&<ChevronRight size={12} aria-hidden="true" className="plan-strip-sep"/>}
   {'walk' in p?<span className="plan-strip-walk"><Footprints size={13} aria-hidden="true"/>{Math.max(1,Math.round(p.walk/60))}</span>
    :<span className="route-pill">{p.lines}</span>}
  </span>)}
 </span>;
}

/** When to set off and when the destination is reached, by the timetable and the estimated walks; and how long. */
function When({setOffMs,arriveMs,clock}:{setOffMs:number;arriveMs:number|null;clock:(ms:number)=>string}){
 return <span className="plan-when" data-plan-when>
  {arriveMs!==null
   ?<><strong>{clock(setOffMs)} – {clock(arriveMs)}</strong><small>{durationWords(arriveMs-setOffMs)}</small></>
   :<strong>Leave {clock(setOffMs)}</strong>}
 </span>;
}

/**
 * A listed journey's next connection by the timetable, on one line: when to leave, the first bus from the first stop
 * and the second it makes. The timetable's, said to be; a timetable known to mislead gives no time, and says why.
 */
function NextConnection({option,timing,clock,nowMs}:{option:ConnectionOption;timing:ConnectionTiming|null;clock:(ms:number)=>string;nowMs:number}){
 if(!timing)return null;
 if(timing.kind==='withheld')return <p className="plan-next warn" data-plan-next="withheld">No times: the {timing.leg===1?option.first.line:option.second.line}’s {timing.reason}.</p>;
 if(timing.kind==='unavailable')return <p className="plan-next" data-plan-next="unavailable">No times: {timing.reason}.</p>;
 const row=timing.rows.find(r=>r.second)??null;
 if(!row){const first=timing.rows[0];
  return <p className="plan-next" data-plan-next="no-second">Next {first.first.departure.line} {clock(first.first.departMs)}, but no {lineNames(option.second)} is timetabled within 90 min of it reaching the change.</p>}
 return <p className="plan-next" data-plan-next="timed"><b>{leaveWords(row.first.departMs-timing.access.seconds*1000,nowMs,clock)}</b>
  {' '}· <strong>{row.first.departure.line} {clock(row.first.departMs)}</strong> from {stopWords(option.first.board)}<Tight spare={row.boardSpareSeconds} basis={timing.access.basis}/>,
  then <strong>{row.second!.departure.line} {clock(row.second!.departMs)}</strong>
  {row.second!.arriveMs!==null?<> · at {option.second.alight.name} {clock(row.second!.arriveMs)}</>:null}
  <small> · by the timetable, not live</small></p>;
}

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
 * A listed direct option's next bus by the timetable, on one line: when to leave, the bus from the boarding stop (one
 * the passenger can walk to in time) and when it reaches the stop to get off at.
 */
function NextDirect({option,timing,clock,nowMs}:{option:DirectOption;timing:DirectTiming|null;clock:(ms:number)=>string;nowMs:number}){
 if(!timing)return null;
 if(timing.kind==='withheld')return <p className="plan-next warn" data-plan-next="withheld">No times: the {option.line}’s {timing.reason}.</p>;
 if(timing.kind==='unavailable')return <p className="plan-next" data-plan-next="unavailable">No times: {timing.reason}.</p>;
 const row=timing.rows[0];
 return <p className="plan-next" data-plan-next="timed"><b>{leaveWords(row.departMs-timing.access.seconds*1000,nowMs,clock)}</b>
  {' '}· <strong>{row.departure.line} {clock(row.departMs)}</strong> from {stopWords(option.board)}<Tight spare={row.spareSeconds} basis={timing.access.basis}/>
  {row.arriveMs!==null?<> · at {option.alight.name} {clock(row.arriveMs)}</>:null}
  <small> · by the timetable, not live</small></p>;
}
