// Which bus should they take? Answered from the timetable catalogue this app already holds, and
// only where the answer is complete: a pattern open to the public, valid and running on the day,
// that calls at a stop near the start *before* a stop near the destination, with both walks short
// enough to make. A bus that merely passes near both places is not a journey, and one that serves
// both stops but does not leave in time is not a better journey than one that does: options are
// timed from the stops' own boards (`timeDirect`) and put in order by when they arrive (`rankDirect`).
import type {PatternCatalogue} from '@/lib/patterns';
import {nearestStops,straightLineMetres,type Stop} from '@/lib/stops';
import type {FollowBus} from '@/lib/follow';
import {atStopMs,busesOnLeg,estimatedWalk,legFamily,legService,legsBetween,readyAtStop,spareAtStop,usablePatterns,
 type Leg,type ScheduleQuality,type TransferWalk} from '@/lib/connections';
import {departuresOn,type ScheduledDeparture,type StopDepartures} from '@/lib/departures';
import type {OperatingRule} from '@/lib/service-days';

export type LatLon={lat:number;lon:number};
export type TrackedBus={bus:FollowBus;stopsAway:number;ageSeconds:number|null};
export type DirectOption={
 /** `d:<pattern>|<board>|<alight>`: the planner's own bus between the two stops. */
 key:string;
 /** That bus and every other open to the public between the same two stops, in order (variants of
  *  its line, other lines): one instruction, timed as whichever leaves first. */
 leg:Leg;
 pattern:Leg['pattern'];
 line:string;operator:string|null;direction:string|null;headsign:string;
 board:Stop;boardIndex:number;walkToBoardMetres:number;
 alight:Stop;alightIndex:number;walkFromAlightMetres:number;
 rideStops:number;rideMetres:number|null;
 /** Buses of the leg whose last report is before the boarding stop, nearest first. */
 tracked:TrackedBus[];
 /** Why a tracked bus may be gone before the walk is made: stated, never a promise either way. */
 caution:string|null;
 score:number;
};

/** `candidateStops` bounds the search, not the walk: every stop within `maxWalkMetres` is looked at
 *  (about 160 around Piccadilly Gardens, 50 in Stretford). It was 14 until 28 September 2026, which in
 *  practice searched 130–460 m while the page said 900 m, and missed the 23 from Norwood Road, 418 m
 *  from Hillingdon Road, to Withington Community Hospital. `candidates` are timed, and the best
 *  `options` of them by arrival are listed. On the served catalogue of 27 September, 2,573 of 5,000
 *  random pairs of places had a direct bus, with a median of 2 candidates, 9 at the 99th percentile
 *  and 21 at most (from Charlotte Street in the centre, 11 and 16): 24 times them all. */
export const PLAN_RULES={maxWalkMetres:900,candidateStops:250,options:5,candidates:24,walkMetresPerMinute:80};

/** Direct bus options from `from` to `to` on `day` (YYYY-MM-DD, Europe/London, or the service days a
 *  search meets: `serviceDaysAt`), best by walking and riding first: the candidates, before timing.
 *  Each pattern is taken at its own best pair of stops, and patterns between the same two stops are
 *  one option. Until 28 September 2026 one pair was chosen per line and destination, by distance,
 *  before any time was read, and a variant that does not call at that pair was lost: on the served
 *  catalogue, 5 of 773 pairs of places lost a usable variant that way (two BNML 86 variants inbound
 *  from Chorlton Bus Station among them). */
export function directOptions(from:LatLon,to:LatLon,catalogue:PatternCatalogue|null,stops:Stop[],day:string|string[],tracked:FollowBus[]=[]):DirectOption[]{
 if(!catalogue)return [];
 const near=(p:LatLon)=>nearestStops(stops,p,PLAN_RULES.candidateStops).filter(n=>n.metres<=PLAN_RULES.maxWalkMetres);
 const origins=new Map(near(from).map(n=>[n.stop.id,n]));
 const targets=new Map(near(to).map(n=>[n.stop.id,n]));
 if(!origins.size||!targets.size)return [];
 const direct=straightLineMetres(from,to);
 const usable=usablePatterns(catalogue,day);
 const found:DirectOption[]=[];
 for(const pattern of usable){
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
  const score=choice.walkTo+choice.walkFrom+(rideMetres??rideStops*450);
  const leg:Leg={pattern,line:pattern.line,operator:pattern.operator??null,headsign:pattern.destination??'?',
   board,boardIndex:choice.i,alight,alightIndex:choice.j,rideStops,rideMetres,also:[]};
  found.push({key:`d:${pattern.id}|${board.id}|${alight.id}`,leg,pattern,line:pattern.line,operator:pattern.operator??null,
   direction:pattern.direction??null,headsign:pattern.destination??'?',board,boardIndex:choice.i,walkToBoardMetres:choice.walkTo,
   alight,alightIndex:choice.j,walkFromAlightMetres:choice.walkFrom,rideStops,rideMetres,tracked:[],caution:null,score});
 }
 // Every bus between the chosen two stops travels with the option, and two services between the
 // same two stops are one option: the better scored, carrying the other. The same bus from two
 // pairs of stops stays two options until they are timed (`rankDirect` keeps the one set off for
 // later): by distance alone the stop further along looks better, because the ride is shorter.
 const byPair=new Map<string,DirectOption>();
 for(const option of found.sort((a,b)=>a.score-b.score)){
  const pair=`${option.board.id}|${option.alight.id}`;
  if(byPair.has(pair))continue;
  const leg={...option.leg,also:legsBetween(option.board,option.alight,usable,option.pattern.id)};
  const coming=busesOnLeg(leg,tracked).filter(x=>x.standing.kind==='before')
   .map(x=>({bus:x.bus,stopsAway:x.standing.kind==='before'?x.standing.stopsAway:0,ageSeconds:x.bus.ageSeconds}));
  const nearestBus=coming[0];
  // A bus one stop away with a ten-minute walk ahead of the passenger is not theirs to catch.
  const walkMinutes=option.walkToBoardMetres/PLAN_RULES.walkMetresPerMinute;
  const caution=nearestBus&&nearestBus.stopsAway<=Math.max(1,Math.round(walkMinutes/2))&&option.walkToBoardMetres>150
   ?`the nearest tracked bus is ${nearestBus.stopsAway} stop${nearestBus.stopsAway===1?'':'s'} away and the walk is about ${Math.round(option.walkToBoardMetres)} m; it may pass before you reach the stop`
   :null;
  byPair.set(pair,{...option,leg,tracked:coming,caution});
 }
 return [...byPair.values()].slice(0,PLAN_RULES.candidates);
}

// --------------------------------------------------------------------- timing, from the timetable

export type DirectRow={departure:ScheduledDeparture;departMs:number;arriveMs:number|null;
 /** Seconds between the walk to the stop being done and the bus leaving (`spareAtStop`). */
 spareSeconds:number};
export type DirectTiming=
 |{kind:'timed';rows:DirectRow[];access:TransferWalk;egress:TransferWalk;
   /** True when nothing left within the next three hours, so the rows are the next day's. */
   later:boolean}
 |{kind:'withheld';reason:string}
 |{kind:'unavailable';reason:string};

const stopWords=(s:Stop)=>s.indicator?`${s.name} (${s.indicator})`:s.name;

/**
 * The next direct buses by the timetable: every bus of the option's leg from its boarding stop that
 * the passenger can reach the stop for (the walk there counted, estimated), each with its time at
 * the stop to get off at. A bus that leaves later and arrives no later makes an earlier one
 * pointless, and it is dropped. A timetable known not to match its buses gives no times.
 */
export function timeDirect(option:DirectOption,input:{board:StopDepartures|null;rules:OperatingRule[]|null;nowMs:number;
 quality:ScheduleQuality;access?:TransferWalk;egress?:TransferWalk;limit?:number}):DirectTiming{
 if(input.quality.kind==='unreliable')return {kind:'withheld',reason:input.quality.words};
 if(!input.rules)return {kind:'unavailable',reason:'the timetable’s operating rules could not be read'};
 if(!input.board)return {kind:'unavailable',reason:`no timetable board is published for ${stopWords(option.board)}`};
 const access=input.access??estimatedWalk(option.walkToBoardMetres);
 const egress=input.egress??estimatedWalk(option.walkFromAlightMetres);
 const ready=readyAtStop(input.nowMs,access);
 const rowsIn=(toMs:number)=>legFamily(option.leg)
  .flatMap(leg=>departuresOn(input.board,input.rules,leg.pattern.id,ready,toMs)
   .map(departure=>({departure,departMs:departure.atMs,arriveMs:atStopMs(departure,leg.pattern,leg.alightIndex),
    spareSeconds:spareAtStop(departure.atMs,input.nowMs,access)})))
  .sort((a,b)=>a.departMs-b.departMs);
 let rows=rowsIn(input.nowMs+180*60_000);
 const later=!rows.length;
 if(later)rows=rowsIn(input.nowMs+26*3600_000);
 if(!rows.length)return {kind:'unavailable',reason:`nothing between these stops is timetabled from ${stopWords(option.board)} in the next day`};
 const kept:DirectRow[]=[];
 let soonest=Infinity;
 for(let i=rows.length-1;i>=0;i--){
  const arrive=rows[i].arriveMs;
  if(arrive!==null&&arrive>=soonest)continue;
  kept.push(rows[i]);
  if(arrive!==null)soonest=arrive;
 }
 return {kind:'timed',rows:kept.reverse().slice(0,input.limit??6),access,egress,later};
}

/** When a timed option reaches the destination (its soonest arrival at its stop, and the walk on),
 *  the bus that does it, and when the passenger must set off for that bus. */
export function directArrival(timing:DirectTiming):{arrive:number;leave:number;setOff:number}|null{
 if(timing.kind!=='timed')return null;
 let best:{arrive:number;leave:number;setOff:number}|null=null;
 for(const row of timing.rows){
  if(row.arriveMs===null)continue;
  const arrive=row.arriveMs+timing.egress.seconds*1000;
  if(!best||arrive<best.arrive)best={arrive,leave:row.departMs,setOff:row.departMs-timing.access.seconds*1000};
 }
 return best;
}

/**
 * The direct options in the order a passenger would want them: soonest at the destination, then the
 * latest to set off (the same bus from a nearer stop, or a later bus as soon there), then the
 * planner's own order; those with no time after them. An option whose next bus a better option
 * already offers, from its own stop or another along the way, is dropped: the same bus is one choice.
 */
export function rankDirect(options:DirectOption[],timingOf:(option:DirectOption)=>DirectTiming,limit=PLAN_RULES.options):DirectOption[]{
 const ranked=options.map((option,i)=>({option,i,timing:timingOf(option)}))
  .map(x=>({...x,end:directArrival(x.timing)}))
  .sort((a,b)=>a.end&&b.end?(a.end.arrive-b.end.arrive||b.end.setOff-a.end.setOff||a.i-b.i):a.end?-1:b.end?1:a.i-b.i);
 const offered=new Set<string>(),out:DirectOption[]=[];
 for(const {option,timing} of ranked){
  const next=timing.kind==='timed'?timing.rows[0]:null;
  const bus=next?`${next.departure.patternId}|${next.departure.originLocal}|${next.departure.serviceDay}`:null;
  if(bus&&offered.has(bus))continue;
  if(bus)offered.add(bus);
  out.push(option);
  if(out.length>=limit)break;
 }
 return out;
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
  `Board the ${legService(option.leg)}.`,
  `Get off at ${stop(option.alight)}, ${option.rideStops} stop${option.rideStops===1?'':'s'} later, then walk about ${Math.round(option.walkFromAlightMetres/10)*10} m.`,
  `No times are promised here: check live departures on the way. ${link}`].join('\n');
}
