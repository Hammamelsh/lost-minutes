'use client';
/**
 * A journey made, one step at a time (lib/trip.ts, 4 October 2026): what to do now, in one card with one main action;
 * the steps as a strip above it; and all of them, with how the times are known, folded below. The owner asked for
 * planning to work the way Google Maps does: walking help to the stop, then, on the bus, following it.
 *
 * The view is told everything and decides only which bus to ask about when more than one could be the passenger's.
 * What it says keeps the page's rules: a time is the operators' timetable and says so; a bus is placed by its last
 * report, in stops and an age, never minutes; a walk is a checked route or an estimate and says which; and a route is
 * asked of the walking router only once the passenger has said yes.
 */
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {Bell,BusFront,Check,ChevronRight,Crosshair,ExternalLink,Flag,Footprints,LocateFixed,MapPin,Share2} from 'lucide-react';
import type {RideProgress,TripStep,TripTo} from '@/lib/trip';
import {durationWords,inWords,leaveWords} from '@/lib/trip';

/** A walk as the trip has it: a checked route, else the straight line lengthened and estimated; whether the route is
 *  being asked for or could not be had; and, before the passenger has agreed to send their location, the offer. */
export type TripWalk={route:{seconds:number;metres:number}|null;estimate:{seconds:number;metres:number}|null;
 state:'idle'|'loading'|'route'|'problem'|'checking'|'off';problem?:string|null;
 ask?:{provider:string;onYes:()=>void}|null;
 /** Between the two stops of a change: how the walk was checked (the old journey card's `data-transfer` meaning). */
 transfer?:string|null};
export type TripBus={key:string;line:string;destination:string;where:string;age:string;tag?:string|null;near?:boolean};
export type TripDeparture={line:string;departMs:number;arriveMs?:number|null;arriveAt?:string|null;
 then?:{line:string;departMs:number}|null;change?:string|null;chosen?:boolean;tight?:boolean};
export type TripRidden={line:string;destination:string;age:string;progress:RideProgress;nextNames:string[];atStopMs:number|null;absent?:boolean};
export type TripRideStop={name:string;state:'passed'|'next'|'later'|'alight'};

const stopWords=(s:{name:string;indicator?:string|null})=>s.indicator?`${s.name} (${s.indicator})`:s.name;
const distance=(m:number)=>m<1000?`${Math.max(10,Math.round(m/10)*10)} m`:`${(m/1000).toFixed(1)} km`;
/** A leg's lines on a small pill, as the options show them: "256", "43/41", "142/42/42B", or "142 +4" for a long family. */
const pillOf=(lines:string)=>{const names=lines.replace(' or ',', ').split(', ');return names.length>3?`${names[0]} +${names.length-1}`:names.join('/')};
const ordinal=(n:number)=>{const t=n%100;if(t>=11&&t<=13)return 'th';return n%10===1?'st':n%10===2?'nd':n%10===3?'rd':'th'};

export default function TripView({steps,index,to,legs,arriveMs,leave,timesNote,departures,departuresNote,nextLeg,
                                  coming,candidates,suggestion,ridden,rideStops,walk,fromWords,onUseLocation,mapsUrl,arrived,
                                  notice,details,shared,nowMs,clock,following=true,onStopSending=null,
                                  onNext,onPrev,onGoTo,onBoard,onWrongBus,onRide,onFinish,onFrame,onWhole,onStop,onShare}:{
 steps:TripStep[];index:number;to:TripTo;
 /** Each leg's buses as a passenger reads them ("42 (or the 142) towards Didsbury") and its lines ("42 or 142"). */
 legs:{service:string;lines:string}[];
 /** When the destination is reached, by the timetable and the walk on; null where this step has no such time. */
 arriveMs:number|null;
 /** On the way to the first stop: when to set off for which bus, by the timetable, and whether it is tight. */
 leave:{setOffMs:number;departMs:number;line:string;tight:boolean}|null;
 /** Why there are no times, where there are none (a timetable known to mislead, none held, still reading). */
 timesNote:string|null;
 /** At a stop: the leg's next departures by the timetable, soonest first; or why there are none. */
 departures:TripDeparture[]|null;departuresNote?:string|null;
 /** On the first bus of a journey with a change, and on the walk between: the second bus from the change. */
 nextLeg?:{service:string;from:string;departures:TripDeparture[]|null;note?:string|null}|null;
 /** At a stop, the leg's buses tracked toward it; boarding, the buses the passenger may be on. */
 coming:TripBus[];candidates:TripBus[];
 /** A bus whose last report is where the device is, while waiting somewhere else: offered, never chosen. */
 suggestion:TripBus|null;
 /** On a bus: the one the passenger said they are on, and how far it has to go by its last report; its stops. */
 ridden:TripRidden|null;rideStops:TripRideStop[];
 walk:TripWalk;
 /** Where the walk starts from, in words ("You are about 250 m away in a straight line"); null when not known. */
 fromWords:string|null;onUseLocation?:()=>void;
 mapsUrl:string|null;arrived:boolean;
 /** Anything the plan needs said at this step (a connection that no longer holds), under the card. */
 notice?:ReactNode;
 /** How the times and the map are known, in the folded list of steps. */
 details?:ReactNode;
 shared:'idle'|'copied'|'failed';
 nowMs:number;clock:(ms:number)=>string;
 /** Whether the map is following the bus ridden; once the passenger moves the map, the way back to it is offered. */
 following?:boolean;
 /** Once the passenger has let walking routes be asked for in this visit: the way to stop it. */
 onStopSending?:(()=>void)|null;
 onNext:()=>void;onPrev:()=>void;onGoTo:(index:number)=>void;onBoard:(key:string|null)=>void;onWrongBus:()=>void;
 onRide:()=>void;onFinish:()=>void;onFrame:()=>void;onWhole:()=>void;onStop:()=>void;onShare:()=>void;
}){
 const [asking,setAsking]=useState(false);
 const step=steps[index];
 const legOf=(n:1|2)=>legs[Math.min(n,legs.length)-1];
 const prev=index>0?steps[index-1]:null;
 // Focus that was on the button just pressed, which the new card no longer has, goes to the card rather than to the
 // page itself.
 const card=useRef<HTMLDivElement>(null);
 const strip=useRef<HTMLOListElement>(null);
 // The strip scrolls sideways where the steps are many: the current one is kept in it.
 useEffect(()=>{
  const list=strip.current,now=list?.querySelector<HTMLElement>('.trip-chip.now');
  if(list&&now&&list.scrollWidth>list.clientWidth)list.scrollLeft=Math.max(0,now.offsetLeft-list.offsetLeft-list.clientWidth/2+now.offsetWidth/2);
 },[index]);
 const seen=useRef(index);
 useEffect(()=>{
  if(seen.current===index)return;
  seen.current=index;
  const active=document.activeElement;
  if(!active||active===document.body||card.current?.closest('.trip')?.contains(active))card.current?.focus({preventScroll:true});
 },[index]);

 function board(){
  if(candidates.length===1){onBoard(candidates[0].key);return}
  if(candidates.length===0){onBoard(null);return}
  setAsking(true);
 }

 const chipLabel=(s:TripStep)=>s.kind==='walk'?`Walk to ${stopWords(s.to)}`:s.kind==='wait'?`Wait for the ${legOf(s.leg).lines}`
  :s.kind==='ride'?`On the ${legOf(s.leg).lines} to ${stopWords(s.alight)}`:s.kind==='change'?`Walk to ${stopWords(s.to)}`:`Walk to ${to.label}`;
 // The steps at a glance: a picture, not controls (the list of all steps below goes to any of them, at a size a finger
 // can use), said to a screen reader as where the trip is.
 const chip=(s:TripStep,i:number)=><li key={i} className={`trip-chip ${i<index?'done':i===index?'now':'later'} kind-${s.kind}`} data-trip-chip={i}>
  <span className="trip-chip-mark">
   {s.kind==='walk'||s.kind==='change'||s.kind==='arrive'?<Footprints size={14} aria-hidden="true"/>
    :s.kind==='wait'?<MapPin size={14} aria-hidden="true"/>:<span className="route-pill">{pillOf(legOf(s.leg).lines)}</span>}
  </span></li>;

 // Every step on one line, for the list of them all.
 const line=(s:TripStep)=>{
  switch(s.kind){
   case 'walk':return <>Walk to <b>{stopWords(s.to)}</b></>;
   case 'wait':return <>Board the <b>{legOf(s.leg).service}</b> at {stopWords(s.stop)}</>;
   case 'ride':return <>Get off at <b>{stopWords(s.alight)}</b></>;
   case 'change':return <>Walk to <b>{stopWords(s.to)}</b> to change</>;
   case 'arrive':return <>Walk to <b>{to.label}</b></>;
  }
 };

 const walkLine=walk.route
  ?<><strong>{durationWords(walk.route.seconds*1000)}</strong> <small>· {distance(walk.route.metres)}, a walking route</small></>
  :walk.estimate?<><strong>about {durationWords(walk.estimate.seconds*1000)}</strong> <small>· {distance(walk.estimate.metres)} in a straight line, estimated</small></>
  :null;
 const walkBlock=<>
  {walkLine&&<p className="trip-big" data-trip-walk={walk.route?'route':'estimate'} data-transfer={walk.transfer??undefined}>{walkLine}</p>}
  {walk.state==='loading'&&<p className="trip-sub" role="status">Finding the walking route…</p>}
  {walk.state==='checking'&&<p className="trip-sub" role="status">Checking the walk between the stops…</p>}
  {walk.state==='problem'&&walk.problem&&<p className="trip-sub">{walk.problem}</p>}
 </>;
 // The walking route, offered after the step's own action: optional, and it says what it sends.
 const askRoute=walk.ask&&<div className="trip-ask-route">
  <button className="text-action strong" onClick={walk.ask.onYes} data-show-route><Footprints size={14} aria-hidden="true"/> Show the walking route</button>
  <small>Sends your location, rounded to about 10 m, and where you are walking to, to {walk.ask.provider}, for each walk
   of this visit. Nothing is sent until you ask.</small></div>;
 const where=fromWords!==null
  ?<p className="trip-here" data-trip-here>{fromWords}</p>
  :<p className="trip-here unknown" data-trip-here="unknown">Your location is not known.{onUseLocation&&<> <button className="text-action" onClick={onUseLocation} data-trip-locate>
    <LocateFixed size={13} aria-hidden="true"/> Use my location</button></>}</p>;
 const maps=mapsUrl&&<a className="text-action trip-maps" href={mapsUrl} target="_blank" rel="noopener noreferrer" data-trip-maps>
  Google Maps directions <ExternalLink size={12} aria-hidden="true"/></a>;
 const back=prev&&<button className="text-action" onClick={onPrev} data-trip-prev>
  {prev.kind==='walk'||prev.kind==='change'?'Not at the stop yet':prev.kind==='wait'?'Not on it yet':'Still on the bus'}</button>;
 // A stop's next buses: on one line, "17:18 (in 4 min) · 17:28 · 17:40", the line named where the leg has more than one;
 // a journey with a change's connections as rows, the one chosen first.
 const several=(list:TripDeparture[])=>new Set(list.map(d=>d.line)).size>1;
 const inline=(list:TripDeparture[],label?:string)=><p className="trip-times-line">{label&&<small className="trip-label">{label} </small>}{list.map((d,i)=><span key={`${d.departMs}-${d.line}`} data-trip-departure={i}>
   {i>0?' · ':''}{several(list)?`${d.line} `:''}<strong>{clock(d.departMs)}</strong>{i===0&&<small> ({inWords(d.departMs,nowMs,clock)})</small>}</span>)}</p>;
 const times=(list:TripDeparture[],label?:string)=>list.every(d=>!d.then)?inline(list,label):<ol className="trip-times">{list.map((d,i)=><li key={`${d.departMs}-${d.line}-${d.then?.departMs??''}`}
   className={d.chosen?'chosen':i===0?'first':undefined} data-trip-departure={i} data-chosen={d.chosen?'':undefined}>
   {d.chosen&&<span className="sr-only">Your connection: </span>}
   <span className="route-pill">{d.line}</span><strong>{clock(d.departMs)}</strong>
   {d.then
    ?<><ChevronRight size={13} aria-hidden="true"/><span className="route-pill">{d.then.line}</span><strong>{clock(d.then.departMs)}</strong>
      {d.change&&<small> · {d.change}</small>}</>
    :i===0&&<small> · {inWords(d.departMs,nowMs,clock)}</small>}
   {d.tight&&<small className="trip-tight" data-tight> · tight</small>}
   {d.arriveMs!=null&&d.arriveAt&&!d.then&&<small> · at {d.arriveAt} {clock(d.arriveMs)}</small>}
  </li>)}</ol>;

 let body:ReactNode=null;
 if(step.kind==='walk'){
  body=<>
   <h3 className="trip-title"><Footprints size={18} aria-hidden="true"/><span>Walk to <b>{stopWords(step.to)}</b></span></h3>
   {walkBlock}
   {leave&&<p className="trip-when" data-trip-leave>
    <strong className={leave.setOffMs-nowMs<=60_000?'urgent':undefined}>{leaveWords(leave.setOffMs,nowMs,clock)}</strong>{' '}
    for the <b>{leave.line}</b> at {clock(leave.departMs)}{leave.tight&&<span className="trip-tight" data-tight> · tight</span>}
    <small> · by the timetable</small></p>}
   {!leave&&timesNote&&<p className="trip-when warn" data-trip-times="none">{timesNote}</p>}
   <div className="trip-actions">
    <button className="action" onClick={onNext} data-trip-next>I’m at the stop</button>
    {maps}
   </div>
   {askRoute}
   {where}
   <p className="trip-sub">Then the {legOf(1).service}.</p>
  </>;
 }else if(step.kind==='wait'){
  const leg=legOf(step.leg);
  body=<>
   <h3 className="trip-title"><MapPin size={18} aria-hidden="true"/><span>Wait at <b>{stopWords(step.stop)}</b></span></h3>
   <p className="trip-for">{leg.lines.includes(' or ')?<>for the <b>{leg.lines}</b>, any of them</>:<>for the <b>{leg.service}</b></>}</p>
   {departures&&departures.length>0
    ?<div className="trip-departures" data-trip-departures={departures.length}>{departures.some(d=>d.then)
      ?<><p className="trip-label">{departures[0].chosen?'Your connection, by the timetable':'Next by the timetable'}</p>{times(departures.slice(0,departures[0].chosen?1:2))}</>
      :times(departures.slice(0,2),'Next by the timetable:')}</div>
    :departuresNote&&<p className="trip-when warn" data-trip-departures="none">{departuresNote}</p>}
   {/* The nearest bus on its way, where it is first; a second only where there are no times to read. */}
   {coming.length>0
    ?<ul className="trip-coming" aria-label="Tracked buses coming">{coming.slice(0,departures&&departures.length?1:2).map(b=><li key={b.key} data-trip-coming={b.key}>
      <span className="route-pill">{b.line}</span><span><strong>{b.where}</strong><small>{b.tag&&<> · <b>{b.tag}</b></>} · reported {b.age}</small></span></li>)}</ul>
    :<p className="trip-sub" data-trip-coming="none">No {leg.lines} is reporting on its way here. That is not “no bus”: the timetable still stands.</p>}
   {suggestion&&!asking&&<p className="trip-suggest" role="status" data-trip-suggest={suggestion.key}>
    Are you on the <b>{suggestion.line}</b>? Its last report is near you.{' '}
    <button className="text-action strong" onClick={()=>onBoard(suggestion.key)}>Yes, follow it</button></p>}
   {asking
    ?<div className="trip-ask" role="group" aria-label="Which bus are you on?" data-trip-ask>
      <p><strong>Which bus are you on?</strong></p>
      <ul>{candidates.map(b=><li key={b.key}><button className="trip-choice" onClick={()=>{setAsking(false);onBoard(b.key)}} data-trip-candidate={b.key}>
       <span className="route-pill">{b.line}</span><span><strong>to {b.destination}</strong><small>{b.where} · {b.age}{b.near?' · near you':''}</small></span>
       <ChevronRight size={15} aria-hidden="true"/></button></li>)}</ul>
      <div className="trip-actions">
       <button className="text-action" onClick={()=>{setAsking(false);onBoard(null)}} data-trip-candidate="none">It’s not listed</button>
       <button className="text-action" onClick={()=>setAsking(false)}>Not on one yet</button>
      </div>
     </div>
    :<div className="trip-actions">
      <button className="action" onClick={board} data-trip-board><BusFront size={15} aria-hidden="true"/> I’m on the bus</button>
      <button className="text-action" onClick={onFrame} data-trip-frame>Show on the map</button>
      <button className="text-action" onClick={onStop} data-trip-stop>This stop’s board</button>
      {back}
     </div>}
  </>;
 }else if(step.kind==='ride'){
  const leg=legOf(step.leg);
  const progress=ridden?.progress??{kind:'unknown' as const};
  const toGo=progress.kind==='riding'?progress.stopsToGo:null;
  const getOff=progress.kind==='past'||(toGo!==null&&toGo<=1);
  body=<>
   <h3 className="trip-title"><BusFront size={18} aria-hidden="true"/><span>{ridden?<>On the <b>{ridden.line}</b> · </>:null}Get off at <b>{stopWords(step.alight)}</b></span></h3>
   {progress.kind==='riding'&&<p className="trip-big" data-trip-togo={toGo}><strong>{toGo} stop{toGo===1?'':'s'} to go</strong>
    <small> · by its last report, {ridden!.age}</small></p>}
   {progress.kind==='riding'&&toGo!==null&&toGo<=1&&<p className="trip-alert" role="alert" data-trip-alert>
    <Bell size={16} aria-hidden="true"/><span>Get off at the next stop: <b>{stopWords(step.alight)}</b></span></p>}
   {progress.kind==='past'&&<p className="trip-alert" role="alert" data-trip-past>
    <Bell size={16} aria-hidden="true"/><span>By its last report your bus has passed {stopWords(step.alight)}. Did you get off?</span></p>}
   {progress.kind==='before'&&<p className="trip-sub" data-trip-before>By its last report ({ridden!.age}) it is {progress.stopsAway} stop{progress.stopsAway===1?'':'s'} before {stopWords(step.from)}.</p>}
   {ridden&&progress.kind==='unknown'&&<p className="trip-sub" data-trip-unplaced>The {ridden.line} you are on is not placed on its route just now.</p>}
   {ridden?.absent&&<p className="trip-sub warn">Not in the latest positions{ridden.age?`: placed by its last report, ${ridden.age}`:''}.</p>}
   {!ridden&&<>
    {candidates.length>0
     ?<div className="trip-ask" role="group" aria-label="Which bus are you on?" data-trip-ask>
       <p><strong>Which bus are you on?</strong> <small>Choose it to follow it to your stop.</small></p>
       <ul>{candidates.map(b=><li key={b.key}><button className="trip-choice" onClick={()=>onBoard(b.key)} data-trip-candidate={b.key}>
        <span className="route-pill">{b.line}</span><span><strong>to {b.destination}</strong><small>{b.where} · {b.age}{b.near?' · near you':''}</small></span>
        <ChevronRight size={15} aria-hidden="true"/></button></li>)}</ul></div>
     :<p className="trip-sub" data-trip-untracked>No {leg.lines} on its way to {stopWords(step.alight)} is reporting, so your bus is not followed here.</p>}
    {rideStops.length>0&&<p className="trip-big"><strong>{rideStops.length} stop{rideStops.length===1?'':'s'}</strong><small> · get off at the {rideStops.length===1?'first':`${rideStops.length}${ordinal(rideStops.length)}`} stop after {stopWords(step.from)}</small></p>}
   </>}
   {ridden?.atStopMs&&<p className="trip-when">At {stopWords(step.alight)} {clock(ridden.atStopMs)} <small>· this bus’s journey, by the timetable</small></p>}
   <div className="trip-actions">
    <button className={getOff?'action':'action secondary'} onClick={onNext} data-trip-next><Check size={15} aria-hidden="true"/> I’ve got off</button>
    {ridden&&!ridden.absent&&<button className="text-action" onClick={onRide} data-trip-ride><Crosshair size={13} aria-hidden="true"/> Ride along</button>}
    {ridden&&!ridden.absent&&!following&&<button className="text-action" onClick={onFrame} data-trip-follow>Follow on the map</button>}
    {ridden&&<button className="text-action" onClick={onWrongBus} data-trip-wrong-bus>Not this bus</button>}
    {back}
   </div>
   {progress.kind==='riding'&&ridden!.nextNames.length>0&&<p className="trip-next-stops" data-trip-next-stops>Next: {ridden!.nextNames.join(' · ')}</p>}
   {rideStops.length>0&&<details className="trip-stops" data-trip-stops={rideStops.length}>
    <summary>{rideStops.length} stop{rideStops.length===1?'':'s'} on this bus</summary>
    <ol>{rideStops.map((s,i)=><li key={i} className={s.state}>{s.name}{s.state==='alight'?' · get off':s.state==='next'?' · next':''}</li>)}</ol>
   </details>}
   {nextLeg&&<NextLeg leg={nextLeg} times={times}/>}
  </>;
 }else if(step.kind==='change'){
  body=<>
   <h3 className="trip-title"><Footprints size={18} aria-hidden="true"/><span>Walk to <b>{stopWords(step.to)}</b></span></h3>
   {walkBlock}
   <div className="trip-actions">
    <button className="action" onClick={onNext} data-trip-next>I’m at the stop</button>
    {maps}
    {back}
   </div>
   {where}
   {nextLeg&&<NextLeg leg={nextLeg} times={times}/>}
  </>;
 }else{
  body=<>
   <h3 className="trip-title"><Flag size={18} aria-hidden="true"/><span>Walk to <b>{to.label}</b></span></h3>
   {arrived
    ?<p className="trip-done" role="status" data-trip-arrived>You’ve arrived.</p>
    :walkBlock}
   <div className="trip-actions">
    <button className="action" onClick={onFinish} data-trip-finish><Check size={15} aria-hidden="true"/> {arrived?'Done':'I’ve arrived'}</button>
    {!arrived&&maps}
    {!arrived&&back}
   </div>
   {!arrived&&askRoute}
   {!arrived&&where}
  </>;
 }

 return <section className="trip" aria-label="Your trip" data-trip-step={step.kind} data-trip-index={index}>
  {/* Where to, and when by the timetable, in one line: the card under it says what to do. */}
  <p className="trip-head"><span className="trip-head-to">To <strong>{to.label}</strong></span>{arriveMs!==null&&<span className="trip-head-at">
   {'\u00a0· '}arrive about <strong data-trip-arrive={arriveMs}>{clock(arriveMs)}</strong><small> by the timetable</small></span>}</p>
  <ol className="trip-strip" ref={strip} role="img" aria-label={`Step ${index+1} of ${steps.length}: ${chipLabel(step)}`}>{steps.map(chip)}</ol>
  {/* The step is announced when it changes, and only then: the card itself changes with every report and tick. */}
  <p className="sr-only" aria-live="polite">{`Step ${index+1} of ${steps.length}: ${chipLabel(step)}`}</p>
  <div className={`trip-now kind-${step.kind}`} data-trip-now={step.kind} tabIndex={-1} ref={card}>{body}</div>
  {notice}
  <details className="trip-all" data-trip-all>
   <summary>All steps, and how this is known</summary>
   <ol className="trip-list">{steps.map((s,i)=><li key={i} className={i<index?'done':i===index?'now':'later'}>
    <button className="text-action" onClick={()=>onGoTo(i)} data-trip-step-link={i}>{line(s)}</button></li>)}</ol>
   <div className="trip-all-actions">
    <button className="text-action" onClick={onWhole} data-trip-whole>Show the whole trip</button>
    <button className="text-action" onClick={onShare} data-trip-share aria-label="Share this trip"><Share2 size={13} aria-hidden="true"/>{' '}
     {shared==='copied'?'Copied':shared==='failed'?'Could not copy':'Share'}</button>
    {onStopSending&&<button className="text-action" onClick={onStopSending} data-stop-sending>Stop sending my location</button>}
   </div>
   {details}
   <p className="trip-basis">Times are the operators’ timetables, not adjusted for where the buses are. A bus is placed by its last report.
    Your location stays on this device unless you ask for a walking route, which sends it, rounded to about 10 m, to the walking router.
    A step moves on by itself only when this device’s location reaches the stop.</p>
  </details>
 </section>;
}

function NextLeg({leg,times}:{leg:{service:string;from:string;departures:TripDeparture[]|null;note?:string|null};
                              times:(list:TripDeparture[],label?:string)=>ReactNode}){
 return <div className="trip-next-leg" data-trip-next-leg>
  <p className="trip-label">Then the {leg.service} from {leg.from}</p>
  {leg.departures&&leg.departures.length>0?times(leg.departures.slice(0,3)):leg.note&&<p className="trip-sub">{leg.note}</p>}
 </div>;
}

/**
 * A chosen connection that no longer holds, before the first bus: said, with what works instead, and nothing replaced
 * until the passenger accepts it (lib/connections.ts, chosenStatus). Moved here from the journey card it began in.
 */
export function ConnectionNotice({why,chosen,offer,arriveAt,clock,reason,onAccept,onOther}:{
 why:'unreachable'|'missed';chosen:{firstLine:string;firstDepartMs:number;secondLine:string|null;secondDepartMs:number|null};
 offer:{first:{line:string;departMs:number};second:{line:string;departMs:number;arriveMs:number|null}|null}|null;
 arriveAt:string;clock:(ms:number)=>string;reason:string;onAccept:()=>void;onOther:()=>void}){
 return <div className="journey-change" role="status" data-change={why}>
  <p><strong>{why==='unreachable'
   ?`Your ${chosen.firstLine} at ${clock(chosen.firstDepartMs)} can no longer be caught.`
   :`Your ${chosen.firstLine} at ${clock(chosen.firstDepartMs)} no longer makes the ${chosen.secondLine??'second bus'}${chosen.secondDepartMs?` at ${clock(chosen.secondDepartMs)}`:''}.`}</strong>{' '}
   {reason}</p>
  {offer&&offer.second
   ?<><p data-offer>{offer.first.line===chosen.firstLine&&offer.first.departMs===chosen.firstDepartMs
     ?`It makes the ${offer.second.line} at ${clock(offer.second.departMs)} instead`
     :`Next that works: ${offer.first.line} ${clock(offer.first.departMs)} → ${offer.second.line} ${clock(offer.second.departMs)}`}
     {offer.second.arriveMs?`, at ${arriveAt} ${clock(offer.second.arriveMs)}`:''}.</p>
    <div className="journey-change-actions">
     <button className="action" onClick={onAccept} data-accept-change>Use this</button>
     <button className="text-action" onClick={onOther}>Other journeys</button></div></>
   :<><p data-offer="none">No connection works by the timetable in the next three hours.</p>
    <div className="journey-change-actions"><button className="text-action" onClick={onOther}>Other journeys</button></div></>}
 </div>;
}
