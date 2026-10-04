/**
 * A journey made, one step at a time (4 October 2026).
 *
 * The owner, planning a journey on his phone, asked for it to work the way Google Maps does: help walking to the bus
 * stop, then, on the bus, following it. Walked as a phone on the served site, a chosen journey opened the boarding
 * stop's whole board, nine sections deep, with the walking help at the bottom (2,902 px down) and no way from the plan
 * to the bus. Here a chosen journey becomes a trip: the steps it is made of, in order, one of them current, each about
 * one stop or one bus, so the page can say what to do now and the map can show it.
 *
 *   walk to the stop → wait for the bus → ride it to the stop to get off at → (change) → walk to the destination
 *
 * Nothing here is a prediction. Times are the operators' timetables, read out and labelled as such; where a bus is
 * comes from its last report, in stops and an age; and what the passenger is doing (at the stop, on a bus, off it)
 * is either their own word or their own device's position, never inferred from a bus's.
 */
import type {Stop} from '@/lib/stops';
import {straightLineMetres} from '@/lib/stops';
import type {FollowBus} from '@/lib/follow';
import type {DirectOption,DirectTiming} from '@/lib/plan';
import {legFamily,legStanding,type ChosenConnection,type ConnectionOption,type ConnectionTiming,type Leg,type TimedConnection} from '@/lib/connections';
import type {WalkingProblem,WalkingRoute} from '@/lib/walking';

export type TripTo={lat:number;lon:number;label:string};
export type TripPlan={kind:'direct';option:DirectOption}|{kind:'connection';option:ConnectionOption};
export type TripStep=
 |{kind:'walk';to:Stop}                                   // to the first boarding stop
 |{kind:'wait';leg:1|2;stop:Stop}                         // at a boarding stop, for that leg's buses
 |{kind:'ride';leg:1|2;from:Stop;alight:Stop}             // on a bus, to the stop to get off at
 |{kind:'change';from:Stop;to:Stop}                       // off the first bus, to the second's stop
 |{kind:'arrive';from:Stop;to:TripTo};                    // from the last stop to the destination

/** Where a journey with a change has got to, as the planner's own journey state keeps it (lib/connections.ts). */
export type JourneyStage='before'|'first'|'second';
/** The walk between the two boarding points of a journey with a change: the same stop, the router off, being
 *  checked, or checked (a route, or why there is none). */
export type TransferState={status:'checking'}|{status:'route';route:WalkingRoute}|{status:'problem';problem:WalkingProblem}|{status:'same'}|{status:'off'};

/** The legs of a trip, first to last. */
export const tripLegs=(plan:TripPlan):Leg[]=>plan.kind==='direct'?[plan.option.leg]:[plan.option.first,plan.option.second];
export const tripLeg=(plan:TripPlan,leg:1|2):Leg=>tripLegs(plan)[Math.min(leg,tripLegs(plan).length)-1];
export const tripKey=(plan:TripPlan)=>plan.option.key;

/** The steps a plan is made of. A change at the same stop has no walk of its own: the wait for the second bus is it. */
export function tripSteps(plan:TripPlan,to:TripTo):TripStep[]{
 if(plan.kind==='direct'){
  const o=plan.option;
  return [{kind:'walk',to:o.board},{kind:'wait',leg:1,stop:o.board},{kind:'ride',leg:1,from:o.board,alight:o.alight},
   {kind:'arrive',from:o.alight,to}];
 }
 const o=plan.option;
 return [{kind:'walk',to:o.first.board},{kind:'wait',leg:1,stop:o.first.board},{kind:'ride',leg:1,from:o.first.board,alight:o.first.alight},
  ...(o.transfer.sameStop?[]:[{kind:'change' as const,from:o.transfer.from,to:o.transfer.to}]),
  {kind:'wait',leg:2,stop:o.second.board},{kind:'ride',leg:2,from:o.second.board,alight:o.second.alight},
  {kind:'arrive',from:o.second.alight,to}];
}

/** The stop a step is about, which the page's own stop follows: the board, the map's stop and its walk. */
export function stepStop(step:TripStep):Stop{
 switch(step.kind){
  case 'walk':return step.to;
  case 'wait':return step.stop;
  case 'ride':return step.alight;
  case 'change':return step.to;
  case 'arrive':return step.from;
 }
}

/** The stage a journey with a change is followed by (lib/connections.ts): before the first bus, on it (and the
 *  change after it), on the second. */
export function connectionStage(steps:TripStep[],index:number):'before'|'first'|'second'{
 const firstRide=steps.findIndex(s=>s.kind==='ride'&&s.leg===1);
 const secondRide=steps.findIndex(s=>s.kind==='ride'&&s.leg===2);
 if(index<firstRide)return 'before';
 if(secondRide<0||index<secondRide)return 'first';
 return 'second';
}
/** The first step of a stage, for a journey restored at a stage. */
export function stepOfStage(steps:TripStep[],stage:'before'|'first'|'second'):number{
 if(stage==='before')return 0;
 const i=steps.findIndex(s=>s.kind==='ride'&&s.leg===(stage==='first'?1:2));
 return i<0?0:i;
}

/** How near a position must be to count as at a place: its own accuracy, but never under 35 m (a stop's sign and its
 *  shelter can be that far from the point NaPTAN gives) and never over 60 m (a poor fix is not an arrival). */
export const AT={minMetres:35,maxMetres:60};
export function isAt(here:{lat:number;lon:number;accuracyMetres?:number}|null,place:{lat:number;lon:number}):boolean{
 if(!here)return false;
 const radius=Math.min(AT.maxMetres,Math.max(AT.minMetres,here.accuracyMetres??AT.minMetres));
 return straightLineMetres(here,place)<=radius;
}

/** Where a bus on one of a leg's buses stands, in stops from the boarding stop: negative before it, 0 at it,
 *  positive once past it; with the leg it was found on. */
function offsetOnLeg(bus:FollowBus,leg:Leg):{member:Leg;offset:number;patternIndex:number}|null{
 for(const member of legFamily(leg)){
  const standing=legStanding(bus,member);
  if(!standing)continue;
  const match=bus.match;
  const at=match&&'patternIndex' in match?match.patternIndex:member.boardIndex;
  return {member,offset:at-member.boardIndex,patternIndex:at};
 }
 return null;
}

/**
 * The buses a passenger at the boarding stop may just have boarded, most likely first: one of the leg's buses whose
 * last report is from two stops before the stop to four after it (reports reach the page about 20 s old, and a bus
 * gets on its way). With a device position, a bus whose last report is near it leads; otherwise the one nearest the
 * stop. Never chosen for them: the page asks when there is more than one.
 */
export const BOARDING={before:2,after:4,nearMetres:300};
export function boardingCandidates(leg:Leg,buses:FollowBus[],here?:{lat:number;lon:number}|null,
                                   span:{before:number;after:number}=BOARDING):{bus:FollowBus;offset:number;metres:number|null}[]{
 return buses.map(bus=>{
   const on=offsetOnLeg(bus,leg);
   if(!on||on.offset< -span.before||on.offset>span.after)return null;
   if(on.patternIndex>=on.member.alightIndex)return null;
   const metres=here?straightLineMetres(here,bus):null;
   return {bus,offset:on.offset,metres};
  })
  .filter((x):x is {bus:FollowBus;offset:number;metres:number|null}=>x!==null)
  .sort((a,b)=>{
   const near=(x:typeof a)=>x.metres!==null&&x.metres<=BOARDING.nearMetres;
   if(near(a)!==near(b))return near(a)?-1:1;
   if(near(a)&&near(b))return a.metres!-b.metres!;
   return Math.abs(a.offset)-Math.abs(b.offset)||b.bus.observedAtMs-a.bus.observedAtMs;
  });
}
/** Where a candidate's last report is, against the stop it was boarded at, in stops: "2 stops before Stretford
 *  Mall", "nearest Stretford Mall", "1 stop past Stretford Mall". */
export function offsetWords(offset:number,stop:string):string{
 if(offset===0)return `last report nearest ${stop}`;
 const n=Math.abs(offset);
 return `${n} stop${n===1?'':'s'} ${offset<0?'before':'past'} ${stop}`;
}

/** A ridden bus's progress to the stop to get off at, from its last report: not yet at the boarding stop, so many
 *  stops to go with the next few, or past the stop to get off at. Unknown when the bus is not placed on the leg. */
export type RideProgress=
 |{kind:'unknown'}
 |{kind:'before';stopsAway:number}
 |{kind:'riding';stopsToGo:number;next:string[]}
 |{kind:'past'};
export function rideProgress(bus:FollowBus|null,leg:Leg):RideProgress{
 if(!bus)return {kind:'unknown'};
 const on=offsetOnLeg(bus,leg);
 if(!on)return {kind:'unknown'};
 if(on.offset<0)return {kind:'before',stopsAway:-on.offset};
 if(on.patternIndex>=on.member.alightIndex)return {kind:'past'};
 const stopsToGo=on.member.alightIndex-on.patternIndex;
 return {kind:'riding',stopsToGo,next:on.member.pattern.stops.slice(on.patternIndex+1,Math.min(on.member.alightIndex,on.patternIndex+3)+1)};
}

/** A trip's next journey by the timetable, for its header and its first steps: when to set off, when the first bus
 *  leaves, when the last reaches the stop to get off at, and when the destination is reached on foot after it. */
export type TripTimes={setOffMs:number;departMs:number;line:string;atStopMs:number|null;arriveMs:number|null;
 accessSeconds:number;accessBasis:'route'|'straight';secondDepartMs:number|null;secondLine:string|null};
export function directTripTimes(timing:DirectTiming|null|undefined):TripTimes|null{
 if(!timing||timing.kind!=='timed'||!timing.rows.length)return null;
 const row=timing.rows[0];
 return {setOffMs:row.departMs-timing.access.seconds*1000,departMs:row.departMs,line:row.departure.line,atStopMs:row.arriveMs,
  arriveMs:row.arriveMs===null?null:row.arriveMs+timing.egress.seconds*1000,accessSeconds:timing.access.seconds,accessBasis:timing.access.basis,
  secondDepartMs:null,secondLine:null};
}
export function connectionTripTimes(timing:ConnectionTiming|{kind:'loading'}|null|undefined,row?:TimedConnection|null):TripTimes|null{
 if(!timing||timing.kind!=='timed')return null;
 const chosen=row??timing.rows.find(r=>r.second)??timing.rows[0];
 if(!chosen)return null;
 const last=chosen.second;
 const atStop=last?last.arriveMs:null;
 return {setOffMs:chosen.first.departMs-timing.access.seconds*1000,departMs:chosen.first.departMs,line:chosen.first.departure.line,
  atStopMs:atStop,arriveMs:atStop===null?null:atStop+timing.egress.seconds*1000,accessSeconds:timing.access.seconds,accessBasis:timing.access.basis,
  secondDepartMs:last?last.departMs:null,secondLine:last?last.departure.line:null};
}

/** When to leave, in words a passenger acts on: "Leave now", "Leave in 4 min", or the clock time when it is far off. */
export function leaveWords(setOffMs:number,nowMs:number,clock:(ms:number)=>string):string{
 const minutes=Math.round((setOffMs-nowMs)/60_000);
 if(minutes<=0)return 'Leave now';
 if(minutes<60)return `Leave in ${minutes} min`;
 return `Leave at ${clock(setOffMs)}`;
}
/** "in 6 min", "now", or the clock time; for a bus by the timetable. */
export function inWords(atMs:number,nowMs:number,clock:(ms:number)=>string):string{
 const minutes=Math.round((atMs-nowMs)/60_000);
 if(minutes<=0)return 'now';
 if(minutes<60)return `in ${minutes} min`;
 return `at ${clock(atMs)}`;
}
/** A duration, whole minutes, at least one: "34 min", "1 h 5 min". */
export function durationWords(ms:number):string{
 const minutes=Math.max(1,Math.round(ms/60_000));
 return minutes<60?`${minutes} min`:`${Math.floor(minutes/60)} h${minutes%60?` ${minutes%60} min`:''}`;
}

/** A trip as this tab keeps it, so a refresh, a return from walking directions in another app or a look at another
 *  bus brings it back at the step it was at: which journey (by its public key), the step, the bus the passenger said
 *  they boarded, and for a journey with a change its own choices. Kept in sessionStorage, never in a link. A store
 *  from before 4 October held only a journey with a change and the stage it was at, and is read as one. */
export type StoredTrip={kind:'direct'|'connection';key:string;index:number|null;stage?:JourneyStage;
 boarded:{leg:1|2;bus:string}|null;moreTime:boolean;chosen:ChosenConnection|null};
export function readStoredTrip(raw:string|null):StoredTrip|null{
 if(!raw)return null;
 let t:Record<string,unknown>;
 try{t=JSON.parse(raw)}catch{return null}
 if(!t||typeof t!=='object'||typeof t.key!=='string')return null;
 const c=t.chosen as Record<string,unknown>|null|undefined;
 const chosen=c&&typeof c.first==='string'&&Number.isFinite(c.firstDepartMs)?c as unknown as ChosenConnection:null;
 if(t.v===1){
  const kind=t.kind==='direct'||t.kind==='connection'?t.kind:null;
  const b=t.boarded as Record<string,unknown>|null|undefined;
  const boarded=b&&(b.leg===1||b.leg===2)&&typeof b.bus==='string'?{leg:b.leg as 1|2,bus:b.bus}:null;
  if(!kind||!Number.isInteger(t.index)||(t.index as number)<0)return null;
  return {kind,key:t.key,index:t.index as number,boarded,moreTime:Boolean(t.moreTime),chosen};
 }
 if(t.key.startsWith('c:')&&(t.stage==='before'||t.stage==='first'||t.stage==='second'))
  return {kind:'connection',key:t.key,index:null,stage:t.stage,boarded:null,moreTime:Boolean(t.moreTime),chosen};
 return null;
}
export const storedTrip=(trip:Omit<StoredTrip,'stage'>)=>JSON.stringify({v:1,...trip});
