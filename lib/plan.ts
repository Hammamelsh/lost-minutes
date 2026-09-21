// Which bus should they take? Answered from the timetable catalogue this app already holds, and
// only where the answer is complete: one pattern, valid and running on the day, that calls at a
// stop near the start *before* a stop near the destination, with both walks short enough to
// make. A bus that merely passes near both places is not a journey. No times are invented: a
// tracked bus is placed by its last report (stops away, age), and the rest is the timetable's
// order. Changes are not planned here; the hand-off to a full planner says so.
import type {PatternCatalogue,ServicePattern} from '@/lib/patterns';
import {validOn} from '@/lib/patterns';
import {runsOn,type OperatingRule} from '@/lib/service-days';
import {nearestStops,straightLineMetres,type Stop} from '@/lib/stops';
import type {FollowBus} from '@/lib/follow';

export type LatLon={lat:number;lon:number};
export type TrackedBus={bus:FollowBus;stopsAway:number;ageSeconds:number|null};
export type DirectOption={
 pattern:ServicePattern;
 line:string;operator:string|null;direction:string|null;headsign:string;
 board:Stop;boardIndex:number;walkToBoardMetres:number;
 alight:Stop;alightIndex:number;walkFromAlightMetres:number;
 rideStops:number;rideMetres:number|null;
 /** Buses on this pattern whose last report is before the boarding stop, nearest first. */
 tracked:TrackedBus[];
 /** Why a tracked bus may be gone before the walk is made: stated, never a promise either way. */
 caution:string|null;
 score:number;
};

export const PLAN_RULES={maxWalkMetres:900,candidateStops:14,options:5,walkMetresPerMinute:80};

/** Direct bus options from `from` to `to` on `day` (YYYY-MM-DD, Europe/London). */
export function directOptions(from:LatLon,to:LatLon,catalogue:PatternCatalogue|null,stops:Stop[],day:string,buses:FollowBus[]=[]):DirectOption[]{
 if(!catalogue)return [];
 const near=(p:LatLon)=>nearestStops(stops,p,PLAN_RULES.candidateStops).filter(n=>n.metres<=PLAN_RULES.maxWalkMetres);
 const origins=new Map(near(from).map(n=>[n.stop.id,n]));
 const targets=new Map(near(to).map(n=>[n.stop.id,n]));
 if(!origins.size||!targets.size)return [];
 const direct=straightLineMetres(from,to);
 const best=new Map<string,DirectOption>();
 for(const pattern of catalogue.patterns){
  if(!validOn(pattern,day)||runsOn(pattern.operatingRules as OperatingRule[]|null|undefined,day)===false)continue;
  // The earliest boarding stop and, after it, the alighting stop nearest the destination.
  let choice:{i:number;j:number;walkTo:number;walkFrom:number}|null=null;
  for(let i=0;i<pattern.stops.length-1;i++){
   const o=origins.get(pattern.stops[i]);if(!o)continue;
   for(let j=i+1;j<pattern.stops.length;j++){
    const t=targets.get(pattern.stops[j]);if(!t)continue;
    const candidate={i,j,walkTo:o.metres,walkFrom:t.metres};
    if(!choice||candidate.walkTo+candidate.walkFrom<choice.walkTo+choice.walkFrom)choice=candidate;
   }
  }
  if(!choice)continue;
  // Two walks that add up to the distance between the places is no journey: the bus would be a
  // detour (a stop 900 m away, one stop back, and a walk from there), and so would a bus between
  // two stops that both serve the same place.
  if(choice.walkTo+choice.walkFrom>=direct)continue;
  const board=origins.get(pattern.stops[choice.i])!.stop,alight=targets.get(pattern.stops[choice.j])!.stop;
  const mi=pattern.metres?.[choice.i],mj=pattern.metres?.[choice.j];
  const rideMetres=typeof mi==='number'&&typeof mj==='number'?mj-mi:null;
  const rideStops=choice.j-choice.i;
  const tracked=buses.filter(b=>b.match&&'patternId' in b.match&&b.match.patternId===pattern.id
    &&typeof b.match.patternIndex==='number'&&b.match.patternIndex<choice!.i)
   .map(b=>({bus:b,stopsAway:choice!.i-(b.match as {patternIndex:number}).patternIndex,ageSeconds:b.ageSeconds}))
   .sort((a,b)=>a.stopsAway-b.stopsAway);
  const nearestBus=tracked[0];
  // A bus one stop away with a ten-minute walk ahead of the passenger is not theirs to catch.
  const walkMinutes=choice.walkTo/PLAN_RULES.walkMetresPerMinute;
  const caution=nearestBus&&nearestBus.stopsAway<=Math.max(1,Math.round(walkMinutes/2))&&choice.walkTo>150
   ?`the nearest tracked bus is ${nearestBus.stopsAway} stop${nearestBus.stopsAway===1?'':'s'} away and the walk is about ${Math.round(choice.walkTo)} m; it may pass before you reach the stop`
   :null;
  const score=choice.walkTo+choice.walkFrom+(rideMetres??rideStops*450);
  // One option per service and direction: the best pair of stops for it, not one per pair.
  const key=`${pattern.operator??''}|${pattern.line}|${pattern.direction??''}|${pattern.destination??''}`;
  const option:DirectOption={pattern,line:pattern.line,operator:pattern.operator??null,direction:pattern.direction??null,
   headsign:pattern.destination??'?',board,boardIndex:choice.i,walkToBoardMetres:choice.walkTo,
   alight,alightIndex:choice.j,walkFromAlightMetres:choice.walkFrom,rideStops,rideMetres,tracked,caution,score};
  const seen=best.get(key);
  if(!seen||option.score<seen.score||(option.tracked.length&&!seen.tracked.length))best.set(key,option);
 }
 return [...best.values()].sort((a,b)=>(b.tracked.length?1:0)-(a.tracked.length?1:0)||a.score-b.score).slice(0,PLAN_RULES.options);
}

/** Google Maps directions in transit mode, by coordinates: the documented `api=1` form, no key. */
export const transitHandoff=(from:LatLon,to:LatLon)=>
 `https://www.google.com/maps/dir/?api=1&origin=${from.lat.toFixed(5)},${from.lon.toFixed(5)}&destination=${to.lat.toFixed(5)},${to.lon.toFixed(5)}&travelmode=transit`;
/** The Bee Network journey planner page: it takes no start or destination in its address. */
export const BEE_NETWORK_PLANNER='https://tfgm.com/plan-a-journey';

/** The plan as a few lines of text a friend can read, with what it does and does not say. */
export function planText(option:DirectOption,from:{label:string},to:{label:string},link:string):string{
 const stop=(s:Stop)=>s.indicator?`${s.name} (${s.indicator})`:s.name;
 return [`From ${from.label} to ${to.label}:`,
  `Walk about ${Math.round(option.walkToBoardMetres/10)*10} m (straight line) to ${stop(option.board)}.`,
  `Board the ${option.line} towards ${option.headsign}.`,
  `Get off at ${stop(option.alight)}, ${option.rideStops} stop${option.rideStops===1?'':'s'} later, then walk about ${Math.round(option.walkFromAlightMetres/10)*10} m.`,
  `No times are promised here: check live departures on the way. ${link}`].join('\n');
}
