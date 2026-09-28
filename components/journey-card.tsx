'use client';
/**
 * One compact card for a journey with a change: what to do first, then the rest of the journey in
 * the order it happens. "Take the 42 towards Piccadilly Gardens → get off at Oxford Road → walk to
 * Stop C → take the 250 towards The Trafford Centre."
 *
 * Every time on it is the operators' timetable, read out, and is labelled as such; the tracked buses
 * are placed by their last reports, in stops and an age; nothing here says the change will be made.
 * A timetable known not to match its own buses gives no times, and the card says so instead of
 * wearing a "Scheduled" label over the gap. The walk between the two boarding points is provisional
 * until a pedestrian router has checked it, and the card says which it is.
 */
import {ArrowRight,ChevronDown,Crosshair,Footprints,Info,RotateCcw,Share2,X} from 'lucide-react';
import type {FollowBus} from '@/lib/follow';
import {clockWords} from '@/lib/departures';
import {busOnJourney,busesOnLeg,legService,lineNames,minutesWords,stopName,type ConnectionOption,type ConnectionTiming,type Leg,
 type LegStanding,type OnwardTiming,type ScheduleQuality,type TimedConnection} from '@/lib/connections';
import type {WalkingProblem,WalkingRoute} from '@/lib/walking';

export type JourneyStage='before'|'first'|'second';
export type TransferState={status:'checking'}|{status:'route';route:WalkingRoute}|{status:'problem';problem:WalkingProblem}|{status:'same'}|{status:'off'};

const metresWords=(m:number)=>`about ${Math.max(10,Math.round(m/10)*10)} m`;
const walkMinutes=(seconds:number)=>`${Math.max(1,Math.round(seconds/60))} min`;

/** A tracked bus's place, said once: on the leg's own timetable order, with its report age. */
function standingWords(standing:LegStanding,leg:Leg,at:'board'|'alight'):string{
 if(standing.kind==='before')return `${standing.stopsAway} stop${standing.stopsAway===1?'':'s'} before ${stopName(leg.board)}`;
 if(standing.kind==='between')return at==='alight'?`${standing.stopsToAlight} stop${standing.stopsToAlight===1?'':'s'} before ${stopName(leg.alight)}`
  :`already past ${stopName(leg.board)}, on its way to ${stopName(leg.alight)}`;
 return `past ${stopName(leg.alight)}`;
}

export default function JourneyCard({option,timing,quality,stage,transfer,buses,nowMs,moreTime,onStage,onFocus,onMoreTime,onEnd,onOtherOptions,rideable,onRide,onShare,shareState='idle',roads,
                                    onward=null,trackedTime}:{
 option:ConnectionOption;timing:ConnectionTiming|{kind:'loading'};quality:{first:ScheduleQuality;second:ScheduleQuality};
 stage:JourneyStage;transfer:TransferState;buses:FollowBus[];nowMs:number;moreTime:boolean;
 onStage:(stage:JourneyStage)=>void;onFocus:(focus:'whole'|'first'|'second')=>void;onMoreTime:(value:boolean)=>void;
 onEnd:()=>void;onOtherOptions:()=>void;
 /** The tracked bus the map could ride along with for the current leg, if any, and the way to. */
 rideable?:FollowBus|null;onRide?:(bus:FollowBus)=>void;
 /** Share the instructions and a link that carries the journey, never a location. */
 onShare?:()=>void;shareState?:'idle'|'copied'|'failed';
 /** Whether each leg is drawn on a checked road, or stop to stop; undefined while the roads load. */
 roads?:{first:boolean;second:boolean};
 /** On the first bus: the second bus's times from the change, which is what matters by then. */
 onward?:OnwardTiming|null;
 /** A tracked bus's own journey's timetabled time at the leg's boarding stop ("06:15"), where its
  *  report names one and that timetable is not known to mislead. */
 trackedTime?:(bus:FollowBus,leg:1|2)=>string|null;
}){
 const {first,second,transfer:change}=option;
 const rows=timing.kind==='timed'?timing.rows:[];
 const next:TimedConnection|null=rows[0]??null;
 const bus1=next?busOnJourney(next.first.departure,buses):null;
 const bus2=next?.second?busOnJourney(next.second.departure,buses):null;
 const on1=busesOnLeg(first,buses),on2=busesOnLeg(second,buses);
 const walkWords=transfer.status==='route'?`${walkMinutes(transfer.route.seconds)} walk (${metresWords(transfer.route.metres)}, a checked route)`
  :transfer.status==='same'?'the same stop'
  :transfer.status==='checking'?`${metresWords(change.straightMetres)} apart in a straight line · checking the walking route`
  :transfer.status==='problem'?`${metresWords(change.straightMetres)} apart in a straight line · the walking route could not be checked (${transfer.problem.message.replace(/\.$/,'')})`
  :`${metresWords(change.straightMetres)} apart in a straight line · not checked as a walk`;
 const provisional=transfer.status!=='route'&&transfer.status!=='same';
 // What the times are: the timetable's, and how far that timetable has been checked.
 const basis=timing.kind==='timed'
  ?`Times are the operators’ timetables${timing.walk.basis==='route'?', the checked walk':', a provisional walk'} and ${Math.round(timing.allowanceSeconds/60)} min to change · not adjusted for where the buses are`
  :null;
 const unchecked=[quality.first,quality.second].filter(q=>q.kind==='unverified').length;
 // What each step is at this stage: the one to do now, the bus the passenger is on (whose next
 // action is getting off), done, or later. The change is next while on the first bus.
 const stepTone=(n:1|2):'now'|'riding'|'done'|'later'=>stage==='before'?(n===1?'now':'later'):stage==='first'?(n===1?'riding':'later'):(n===1?'done':'riding');
 const changeTone=stage==='before'?'later':stage==='first'?'soon':'done';
 const tracked=(list:{bus:FollowBus;standing:LegStanding}[],leg:Leg,n:1|2,bound:FollowBus|null,at:'board'|'alight')=>{
  if(bound){const s=list.find(x=>x.bus.key===bound.key)?.standing;
   return <span className="journey-tracked" data-tracked="journey">Tracked on this journey · {s?standingWords(s,leg,at):'reported'} · {bound.ageWords}</span>}
  if(list.length){
   // Before boarding, the bus coming to the stop leads (served 28 September: a 255 already past the
   // stop was named first); on the bus, the one already on its way.
   const {bus,standing}=at==='board'?(list.find(x=>x.standing.kind==='before')??list[0]):list[0];
   // Its own journey where its report names one (an earlier or a later bus than the next connection's);
   // otherwise it is a bus of the line, and which journey it is on is left open.
   const time=trackedTime?.(bus,n)??null;
   return <span className="journey-tracked" data-tracked={time?'other':'line'}>A {bus.route} is tracked {standingWords(standing,leg,at)} · {bus.ageWords} · {time?`the ${time} by the timetable`:'which journey it is on is not identified'}</span>}
  return <span className="journey-tracked none" data-tracked="none">No tracked bus on the {lineNames(leg)} is reporting toward {stopName(leg.board)} yet · that is not “no bus”</span>;
 };

 return <section className={`journey-card stage-${stage}`} aria-label="Your journey" data-journey={option.key} data-stage={stage} data-timing={timing.kind}>
  <header className="journey-head">
   <p className="journey-eyebrow">Your journey · one change</p>
   <div className="journey-actions">
    <button className="text-action" onClick={onOtherOptions} data-other-options>Other journeys</button>
    <button className="text-action" onClick={onEnd} aria-label="End this journey" data-end-journey><X size={14} aria-hidden="true"/> End</button>
   </div>
  </header>

  {/* The next thing to do leads; the rest follows in order, once. */}
  <ol className="journey-steps">
   <li className={`journey-step tone-${stepTone(1)}`} data-step="1">
    <span className="journey-n" aria-hidden="true">1</span>
    <div className="journey-step-copy">
     <strong>{stepTone(1)==='riding'?'On':'Take'} the {legService(first)}</strong>
     <span>from <b>{stopName(first.board)}</b>{stage==='before'&&option.walkToBoardMetres>0?` · ${metresWords(option.walkToBoardMetres)} away in a straight line`:''}</span>
     <span className={stepTone(1)==='riding'?'journey-next':undefined}>get off at <b>{stopName(first.alight)}</b> · {first.rideStops} stop{first.rideStops===1?'':'s'}</span>
     {stage!=='second'&&tracked(on1,first,1,bus1,stage==='first'?'alight':'board')}
    </div>
   </li>
   <li className={`journey-step change tone-${changeTone}`} data-step="change">
    <span className="journey-n" aria-hidden="true"><Footprints size={13}/></span>
    <div className="journey-step-copy">
     <strong>{change.sameStop?`Change at the same stop`:`Walk to ${stopName(change.to)}`}</strong>
     <span data-transfer={transfer.status}>{walkWords}</span>
     {provisional&&!change.sameStop&&<span className="journey-provisional">Provisional: whether these two stops are an easy walk apart is not known until the route is checked.</span>}
    </div>
   </li>
   <li className={`journey-step tone-${stepTone(2)}`} data-step="2">
    <span className="journey-n" aria-hidden="true">2</span>
    <div className="journey-step-copy">
     <strong>{stepTone(2)==='riding'?'On':'Take'} the {legService(second)}</strong>
     <span>from <b>{stopName(second.board)}</b></span>
     <span className={stepTone(2)==='riding'?'journey-next':undefined}>get off at <b>{stopName(second.alight)}</b> · {second.rideStops} stop{second.rideStops===1?'':'s'}{option.walkFromAlightMetres>0?` · then ${metresWords(option.walkFromAlightMetres)} in a straight line`:''}</span>
     {tracked(on2,second,2,bus2,stage==='second'?'alight':'board')}
    </div>
   </li>
  </ol>

  {/* When, by the timetable: before the first bus, the next first bus, when it reaches the change, and
      the second bus it makes; on the first bus, the second bus's times from the change; on the second
      bus, nothing more to catch. Every line says what it is. */}
  {stage==='before'&&<div className="journey-times" data-times={timing.kind}>
   {timing.kind==='loading'&&<p className="journey-note">Reading the timetables for both stops…</p>}
   {timing.kind==='unavailable'&&<p className="journey-note" data-times-unavailable>No times: {timing.reason}.</p>}
   {timing.kind==='withheld'&&<p className="journey-note warn" data-times-withheld={timing.leg}>
    <strong>No times for the {timing.leg===1?first.line:second.line}:</strong> {timing.reason}. A time from this timetable would mislead, so
    none is shown; its stops and order still hold. The official live board for {stopName(timing.leg===1?first.board:second.board)} is linked below.</p>}
   {timing.kind==='timed'&&<>
    {timing.later&&<p className="journey-note">Nothing more in the next three hours. The next by the timetable:</p>}
    <ol className="journey-rows">
     {rows.slice(0,3).map((row,i)=><li key={row.first.departMs} className={`journey-row${i===0?' next':''}`} data-row={i}>
      <span className="journey-row-leg"><span className="route-pill">{row.first.departure.line}</span>
       <strong>{clockWords({atMs:row.first.departMs})}</strong><small>{row.first.arriveMs!==null?`→ ${clockWords({atMs:row.first.arriveMs})} at ${first.alight.name}`:'arrival not declared'}
        {row.earlier&&row.second?` · or ${row.earlier.count>1?'any from':row.earlier.line===row.first.departure.line?'the':`the ${row.earlier.line} at`} ${clockWords({atMs:row.earlier.departMs})}, for the same ${row.second.departure.line}`:''}</small></span>
      <ArrowRight size={14} aria-hidden="true" className="journey-row-arrow"/>
      <span className="journey-row-leg">{row.second
       ?<><span className="route-pill">{row.second.departure.line}</span><strong>{clockWords({atMs:row.second.departMs})}</strong>
         <small>{row.changeSeconds!==null?`${minutesWords(row.changeSeconds)} to change`:''}{row.spareSeconds!==null&&row.spareSeconds<120?' · tight':''}{row.second.arriveMs!==null?` · at ${second.alight.name} ${clockWords({atMs:row.second.arriveMs})}`:''}</small></>
       :<small>{row.first.arriveMs===null?'the second bus cannot be timed from an undeclared arrival':'no second bus timetabled within 90 min of arriving'}</small>}</span>
     </li>)}
    </ol>
    <p className="journey-basis" data-basis>{basis}{unchecked?` · ${unchecked===2?'neither timetable has':'one timetable has not'} been checked against its own buses`:''}</p>
   </>}
  </div>}
  {stage==='first'&&<div className="journey-times" data-times={onward?`onward-${onward.kind}`:'loading'}>
   {!onward&&<p className="journey-note">Reading the timetable for {stopName(second.board)}…</p>}
   {onward?.kind==='unavailable'&&<p className="journey-note" data-times-unavailable>No times: {onward.reason}.</p>}
   {onward?.kind==='withheld'&&<p className="journey-note warn" data-times-withheld="2">
    <strong>No times for the {second.line}:</strong> {onward.reason}. A time from this timetable would mislead, so none is shown.</p>}
   {onward?.kind==='timed'&&<>
    <p className="journey-note">The next {lineNames(second)} from {stopName(second.board)}, by the timetable:</p>
    <ol className="journey-rows onward">
     {onward.rows.map((row,i)=><li key={row.departMs} className={`journey-row${i===0?' next':''}`} data-onward-row={i}>
      <span className="journey-row-leg"><span className="route-pill">{row.departure.line}</span><strong>{clockWords({atMs:row.departMs})}</strong>
       <small>{row.arriveMs!==null?`→ ${clockWords({atMs:row.arriveMs})} at ${second.alight.name}`:'arrival not declared'}</small></span>
     </li>)}
    </ol>
    <p className="journey-basis" data-basis>Times are the operator’s timetable from the soonest you could be at {stopName(second.board)} · not adjusted for where the buses are{quality.second.kind==='unverified'?' · this timetable has not been checked against its own buses':''}</p>
   </>}
  </div>}

  <div className="journey-controls">
   {stage==='before'&&<button className="action" onClick={()=>onStage('first')} data-stage-to="first">I’m on the first bus</button>}
   {stage==='first'&&<button className="action" onClick={()=>onStage('second')} data-stage-to="second">I’ve changed buses</button>}
   {stage==='first'&&<button className="text-action" onClick={()=>onStage('before')} data-stage-to="before"><RotateCcw size={13} aria-hidden="true"/> Not on it yet</button>}
   {stage==='second'&&<button className="text-action" onClick={()=>onStage('first')} data-stage-to="first"><RotateCcw size={13} aria-hidden="true"/> Still to change</button>}
   {rideable&&onRide&&<button className="text-action" onClick={()=>onRide(rideable)} data-ride-leg><Crosshair size={13} aria-hidden="true"/> Ride along with this bus</button>}
   {onShare&&<button className="text-action" onClick={onShare} data-share-journey aria-label="Share this journey"><Share2 size={13} aria-hidden="true"/> {shareState==='copied'?'Copied':shareState==='failed'?'Could not copy':'Share'}</button>}
  </div>
  <div className="journey-focus" role="group" aria-label="Show on the map">
   <button className="text-action" onClick={()=>onFocus('whole')} data-focus="whole">Show whole journey</button>
   <button className="text-action" onClick={()=>onFocus('first')} data-focus="first">First bus</button>
   <button className="text-action" onClick={()=>onFocus('second')} data-focus="second">Next bus</button>
  </div>
  <details className="journey-details">
   <summary><Info size={13} aria-hidden="true"/> Details<ChevronDown size={13} aria-hidden="true"/></summary>
   <ul>
    <li>Found from the operators’ registered timetables held here (four operators), on today’s services. A journey not found here may still exist on an operator not held.</li>
    <li>The {first.line}: {quality.first.words}. The {second.line}: {quality.second.words}.</li>
    <li>A bus is named as “on this journey” only where its operator reports the departure time of that very timetabled journey. Otherwise a tracked bus of the line is said to be one, and which journey it is on is left open.</li>
    <li>Tracked positions are last reports, in stops and an age. They do not say the change will be made.</li>
    <li>The walk between the two boarding points is asked of routing.openstreetmap.de once, as two public stop positions; nothing about you is sent. Accessibility of the change (crossings, steps) is not known here.</li>
    {roads&&<li data-roads={`${roads.first?'road':'stops'},${roads.second?'road':'stops'}`}>On the map, {roads.first&&roads.second?'both legs are drawn on their checked roads'
     :!roads.first&&!roads.second?`neither leg has a checked road here, so both are drawn stop to stop, straight between stops, which is not the road`
     :`the ${roads.first?first.line:second.line} is drawn on its checked road and the ${roads.first?second.line:first.line} stop to stop, straight between stops, which is not the road`}.</li>}
    <li><label className="journey-more-time"><input type="checkbox" checked={moreTime} onChange={e=>onMoreTime(e.target.checked)} data-more-time/> More time to change (adds 5 min to the allowance)</label></li>
    <li>Now {clockWords({atMs:nowMs})}.</li>
   </ul>
  </details>
 </section>;
}
