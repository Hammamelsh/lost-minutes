'use client';
/**
 * "When is the next bus?" at the chosen stop, answered from the operators' registered timetables.
 *
 * It is deliberately not built on our vehicle matching. A departure is a fact about the timetable
 * and is listed whether or not any bus is tracked on it; a tracked vehicle is named beside a row
 * only where it can be tied to that exact scheduled journey — same pattern, same origin departure,
 * same service day, and one journey at that time — and where it cannot, the row stands alone
 * rather than borrowing the nearest bus. No row ever shows a predicted time.
 *
 * Every row carries its own label. Today that is always "Scheduled", because no live departure
 * feed is configured; the shape is the same for a live one, and the official board is one tap away
 * either way.
 */
import {useEffect,useMemo,useState} from 'react';
import {ExternalLink} from 'lucide-react';
import type {FollowBus} from '@/lib/follow';
import {clockWords,countdownWords,loadDepartureRules,loadStopDepartures,minutesUntil,
 nextDepartures,serviceDayOf,type ScheduledDeparture,type StopDepartures} from '@/lib/departures';
import type {OperatingRule} from '@/lib/service-days';
import type {Stop} from '@/lib/stops';

const label=(value:string|null|undefined)=>(value??'').replace(/_/g,' ').trim();

/** The tracked vehicle on this very scheduled journey, or null. Never the nearest bus. */
function vehicleFor(departure:ScheduledDeparture,buses:FollowBus[]):FollowBus|null{
 if(departure.sharedDeparture!==1)return null;
 return buses.find(bus=>{
  const match=bus.match;
  if(!match||!('patternId' in match)||match.patternId!==departure.patternId)return null;
  const scheduled=match.scheduled;
  if(!scheduled||!('departure' in scheduled))return false;
  return scheduled.departure===departure.originLocal
   &&scheduled.serviceDay===departure.serviceDay
   &&scheduled.journeys===1;
 })??null;
}

export function DepartureBoard({stop,buses,nowMs,filterLine,onChooseBus}:{
 stop:Stop;buses:FollowBus[];nowMs:number;filterLine?:string|null;
 onChooseBus?:(bus:FollowBus)=>void;
}){
 // The board is keyed by the stop it is for, so a board still in flight for the previous stop can
 // never be read against this one: the state carries the id it belongs to rather than being reset.
 const [board,setBoard]=useState<{stop:string;value:StopDepartures|null}|null>(null);
 const [rules,setRules]=useState<OperatingRule[]|null|undefined>(undefined);
 useEffect(()=>{
  let live=true;
  loadStopDepartures(stop.id).then(value=>{if(live)setBoard({stop:stop.id,value})});
  loadDepartureRules().then(value=>{if(live)setRules(value)});
  return()=>{live=false};
 },[stop.id]);
 const loaded=board&&board.stop===stop.id?board.value:undefined;

 // Recomputed on the page's own clock, so a countdown is never left behind by a minute boundary —
 // but quantised to fifteen seconds, because a stop with a hundred journeys a day has some tens of
 // thousands of departures to place and the answer in minutes cannot change faster than that.
 const tick=Math.floor(nowMs/15_000);
 const found=useMemo(()=>{
  const nowMs=tick*15_000;
  if(loaded===undefined||rules===undefined)return null;
  const keep=(list:ScheduledDeparture[])=>filterLine?list.filter(row=>row.line===filterLine):list;
  const limit=filterLine?6:8;
  const soon=keep(nextDepartures(loaded,rules??null,nowMs,{limit,withinMinutes:180}));
  if(soon.length)return {rows:soon,later:false};
  // Nothing in the next three hours is not nothing: at eleven at night the next bus from this stop
  // is tomorrow morning's, and an empty board would be saying something it does not know.
  const later=keep(nextDepartures(loaded,rules??null,nowMs,{limit,withinMinutes:26*60}));
  return {rows:later,later:true};
 },[loaded,rules,tick,filterLine]);
 const rows=found?found.rows:null;

 const official=<a className="board-official" href={`https://tfgm.com/public-transport/bus/stops/${stop.id}`}
  target="_blank" rel="noopener noreferrer" data-official-departures>
  <ExternalLink size={13} aria-hidden="true"/> Live departures on Bee Network (official)</a>;

 return <section className="departures" aria-label="Next departures from this stop" data-departures={rows?rows.length:'loading'}>
  <h3 className="section-head">Next departures<small>from the operators’ timetables</small></h3>
  {rows===null&&<p className="departures-note">Reading the timetable for this stop…</p>}
  {rows!==null&&loaded===null&&<p className="departures-note" data-departures-missing>
   No timetable board is published for this stop here. The operator’s own live board has one.</p>}
  {/* Rules that did not load are not an empty timetable, and saying "nothing is timetabled" would
      be claiming something we do not know. */}
  {rows!==null&&loaded&&rules===null&&<p className="departures-note" data-departures-unreadable>
   The timetable for this stop could not be read just now, so its departures are not shown.</p>}
  {rows!==null&&loaded&&rules&&rows.length===0&&<p className="departures-note" data-departures-empty>
   Nothing more is timetabled from this stop in the next day{filterLine?` on the ${filterLine}`:''}.</p>}
  {found?.later&&rows&&rows.length>0&&<p className="departures-note" data-departures-later>
   Nothing more in the next three hours{filterLine?` on the ${filterLine}`:''}. The next from this stop:</p>}
  {rows!==null&&rows.length>0&&<ol className="departure-rows">
   {rows.map((row,index)=>{
    const bus=vehicleFor(row,buses);
    const minutes=minutesUntil(row,nowMs);
    return <li key={`${row.patternId}-${row.atMs}-${index}`} className="departure-row"
      data-line={row.line} data-at={row.atMs} data-kind="scheduled">
     <span className="route-pill">{row.line}</span>
     <span className="departure-copy">
      <strong>to {label(row.destination)||'its destination'}</strong>
      <small>{[row.operator,row.dayKnown?null:'the timetable does not say which days this journey runs']
       .filter(Boolean).join(' · ')}</small>
     </span>
     <span className="departure-when">
      <strong>{clockWords(row)}</strong>
      {/* A countdown in minutes stops meaning anything after an hour or two, so beyond that the
          board says which day instead: "tomorrow" is what a passenger reads at eleven at night. */}
      <small>{minutes<=0?'due':minutes<120?`in ${countdownWords(row,nowMs)}`
       :row.serviceDay===serviceDayOf(nowMs)?'later today':'tomorrow'}</small>
     </span>
     <span className="departure-kind" data-kind="scheduled">Scheduled</span>
     {/* Named only where the vehicle reports this journey's own departure time, which is why the
         claim is made here, on the one row it is true of, and not over the board. */}
     {bus&&onChooseBus&&<button className="text-action departure-bus" onClick={()=>onChooseBus(bus)}
       data-vehicle={bus.vehicle}>Follow {bus.vehicle}, which reports this journey’s departure time</button>}
    </li>;
   })}
  </ol>}
  <p className="departures-basis">
   <span>From the operator’s registered timetable — not predictions, and not adjusted for traffic
    or for where any bus is.</span>
   {official}
  </p>
 </section>;
}
