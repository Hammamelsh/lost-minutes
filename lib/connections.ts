/**
 * A journey with one change, planned from the timetable catalogue this app already holds and timed
 * from the scheduled departure boards it already publishes. Nothing here talks to a network.
 *
 * What a connection is here: one pattern valid and running on the day, boarded at a stop near the
 * start and left at a stop further along it; a second pattern of another line, boarded at a stop
 * within a short straight-line reach of that one and left at a stop near the destination. Straight
 * lines only choose candidates. The walk between the two boarding points is provisional until a
 * pedestrian router has checked it (lib/walking.ts), and the timing is recomputed when it has.
 *
 * What the timing is: the operators' registered timetables, read out, and said to be. A first bus's
 * scheduled arrival at the change, the walk, an allowance for getting off and crossing, and the next
 * scheduled departure of the second bus from its boarding point. It is never adjusted for where any
 * bus is. Where a service's timetable is known not to match its own buses (public/data/
 * schedule-anchor.json: inbound 15 runs about 15 minutes ahead of them), no time is constructed from
 * it, and the card says why rather than wearing a "Scheduled" label that hides the fact.
 *
 * What a tracked bus is: a vehicle the matcher placed on one of the two patterns, tied to a timetabled
 * journey only where the operator's own reported origin departure names it (one journey at that
 * time, or one shared timing). A tracked position says where a bus was; it never says the connection
 * will be made, and nothing here turns it into minutes.
 */
import type {PatternCatalogue,ServicePattern} from '@/lib/patterns';
import {validOn} from '@/lib/patterns';
import {runsOn,type OperatingRule} from '@/lib/service-days';
import {nearestStops,straightLineMetres,type Stop} from '@/lib/stops';
import type {FollowBus} from '@/lib/follow';
import {departuresOn,londonInstant,type ScheduledDeparture,type StopDepartures} from '@/lib/departures';
import {serviceKey} from '@/lib/journey';

export type LatLon={lat:number;lon:number};

export type Leg={
 pattern:ServicePattern;line:string;operator:string|null;headsign:string;
 board:Stop;boardIndex:number;alight:Stop;alightIndex:number;
 rideStops:number;rideMetres:number|null;
 /** The other buses between the same two stops, in order, on the day: other lines and other variants
  *  of this one, wherever they go on to (the 263 and the 255 from Davyhulme Road East to Trafford Bar;
  *  the 86 and its short working). One instruction, whichever comes first (`siblingLegs`). */
 also:Leg[];
};
/** Where the passenger gets off the first bus and where they board the second: two boarding points,
 *  or one. `straightMetres` is what chose the pair; it is not a walking distance. */
export type Transfer={from:Stop;to:Stop;straightMetres:number;sameStop:boolean};
export type ConnectionOption={
 kind:'connection';key:string;first:Leg;second:Leg;transfer:Transfer;
 walkToBoardMetres:number;walkFromAlightMetres:number;score:number;
};

export const CONNECTION_RULES={
 /** Every stop within the walk is a candidate (`candidateStops` only bounds the search; see PLAN_RULES). */
 maxWalkMetres:900,candidateStops:250,
 /** Two boarding points further apart than this in a straight line are not offered as a change. */
 maxTransferMetres:350,
 /** A bus that passes within this of the start, or of the destination, is direct: no change is made
  *  to it or from it. Beyond this a change can still be the shorter walk. */
 directReachMetres:450,
 /** Shown: the best few by the timetable (`rankConnections`), out of this many candidates timed. */
 options:4,candidates:8,
 /** First buses read for one timing, before the ones that only wait for the same second bus are
  *  folded into the later one (`timeConnection`). */
 firstBuses:12,
 walkMetresPerMinute:80,
 /** A provisional walk between two boarding points: the straight line, lengthened for the streets. */
 transferDetour:1.3,
 /** Metres a change costs in the ranking, so a direct bus of similar length ranks first. */
 changePenaltyMetres:700,
 /** Getting off, crossing and finding the stop: added to the walk before the second bus can be caught. */
 allowanceSeconds:120,
 /** "More time to change": added on request. */
 moreTimeSeconds:300,
 /** How long after the passenger could be at the second boarding point a second bus is looked for. */
 secondLegWindowMinutes:90,
 firstLegWindowMinutes:180,
} as const;

const stopWords=(s:Stop)=>s.indicator?`${s.name} (${s.indicator})`:s.name;
const metresBetween=(p:ServicePattern,from:number,to:number)=>{
 const a=p.metres[from],b=p.metres[to];
 return typeof a==='number'&&typeof b==='number'?Math.max(0,b-a):null;
};
const runsToday=(p:ServicePattern,day:string)=>validOn(p,day)&&runsOn(p.operatingRules as OperatingRule[]|null|undefined,day)!==false;

/** A leg and the other buses between its two stops. */
export const legFamily=(leg:Leg):Leg[]=>[leg,...leg.also];

/**
 * The other buses a passenger could equally take between a leg's two stops: every other pattern
 * running on the day that calls at the boarding stop and later at the alighting stop, whatever its
 * line, variant or destination, except the other leg's line (riding it there and back is a U-turn),
 * a first bus that goes on to within a short walk of where the second is left (a direct bus, not a
 * way to change), and a second bus that passes within a short walk of where the first is boarded (a
 * loop). Found from the option alone, so a journey chosen from the list and the same journey restored
 * from its key have the same family. Timing, tracked buses and wording read the whole family: the
 * next bus is never one variant's next bus (Brook's Bar, 28 September 2026: an 86 variant with no
 * journeys that morning had been timed while the 86 itself left every ten minutes).
 */
function siblingLegs(leg:Leg,today:ServicePattern[],other:Leg,order:'first'|'second',stopById:Map<string,Stop>):Leg[]{
 const out:Leg[]=[];
 const within=(id:string,place:Stop)=>{const st=stopById.get(id);return Boolean(st&&straightLineMetres(st,place)<=CONNECTION_RULES.directReachMetres)};
 for(const p of today){
  if(p.id===leg.pattern.id)continue;
  if(p.line===other.line&&(p.operator??'')===(other.operator??''))continue;
  const i=p.stops.indexOf(leg.board.id);
  if(i<0)continue;
  const j=p.stops.indexOf(leg.alight.id,i+1);
  if(j<0)continue;
  if(order==='first'&&p.stops.some((id,k)=>k>j&&within(id,other.alight)))continue;
  if(order==='second'&&p.stops.some((id,k)=>k<i&&within(id,other.board)))continue;
  out.push({pattern:p,line:p.line,operator:p.operator??null,headsign:p.destination??'?',board:leg.board,boardIndex:i,
   alight:leg.alight,alightIndex:j,rideStops:j-i,rideMetres:metresBetween(p,i,j),also:[]});
 }
 return out.sort((a,b)=>a.line.localeCompare(b.line,'en',{numeric:true})||a.pattern.id.localeCompare(b.pattern.id));
}
const withSiblings=(option:ConnectionOption,today:ServicePattern[],stopById:Map<string,Stop>):ConnectionOption=>({...option,
 first:{...option.first,also:siblingLegs(option.first,today,option.second,'first',stopById)},
 second:{...option.second,also:siblingLegs(option.second,today,option.first,'second',stopById)}});
/** Whether one leg's family already carries another leg: the same two stops, and its bus among them. */
const covers=(a:Leg,b:Leg)=>a.board.id===b.board.id&&a.alight.id===b.alight.id&&legFamily(a).some(l=>l.pattern.id===b.pattern.id);

export const connectionKey=(first:Leg,second:Leg)=>
 `c:${first.pattern.id}|${first.board.id}|${first.alight.id}|${second.pattern.id}|${second.board.id}|${second.alight.id}`;
export const directKey=(patternId:string,boardId:string,alightId:string)=>`d:${patternId}|${boardId}|${alightId}`;

// A coarse grid over the stops, so the boarding points within reach of one are found without
// measuring every stop in the catalogue for every candidate.
const CELL_LAT=0.004,CELL_LON=0.006;   // about 445 m by 400 m at Manchester's latitude
function stopGrid(stops:Stop[]){
 const cells=new Map<string,Stop[]>();
 const cell=(lat:number,lon:number)=>`${Math.floor(lat/CELL_LAT)}:${Math.floor(lon/CELL_LON)}`;
 for(const s of stops){const k=cell(s.lat,s.lon);const list=cells.get(k);if(list)list.push(s);else cells.set(k,[s])}
 return (around:Stop,radius:number)=>{
  const out:Stop[]=[];
  const la=Math.floor(around.lat/CELL_LAT),lo=Math.floor(around.lon/CELL_LON);
  for(let i=la-1;i<=la+1;i++)for(let j=lo-1;j<=lo+1;j++)
   for(const s of cells.get(`${i}:${j}`)??[])if(s.id===around.id||straightLineMetres(around,s)<=radius)out.push(s);
  return out;
 };
}

/**
 * Journeys with one change from `from` to `to` on `day` (YYYY-MM-DD, Europe/London), best first. One
 * option per pair of services; a pair whose walks add up to more than the straight line between the
 * places is not a journey. Two patterns of one line are never a change (a U-turn, or the same bus).
 */
export function connectionOptions(from:LatLon,to:LatLon,catalogue:PatternCatalogue|null,stops:Stop[],day:string,
                                  rules=CONNECTION_RULES):ConnectionOption[]{
 if(!catalogue)return [];
 const near=(p:LatLon)=>nearestStops(stops,p,rules.candidateStops).filter(n=>n.metres<=rules.maxWalkMetres);
 const origins=new Map(near(from).map(n=>[n.stop.id,n]));
 const targets=new Map(near(to).map(n=>[n.stop.id,n]));
 if(!origins.size||!targets.size)return [];
 const direct=straightLineMetres(from,to);
 const stopById=new Map(stops.map(s=>[s.id,s]));
 const today=catalogue.patterns.filter(p=>runsToday(p,day));
 // Second legs: every pattern that reaches a stop near the destination, and every stop of it before
 // its last such stop, at which it could be boarded.
 const secondLegs=new Map<string,{pattern:ServicePattern;targets:{j:number;walkFrom:number}[]}>();
 const callsAt=new Map<string,{pattern:ServicePattern;index:number}[]>();
 for(const pattern of today){
  const reached:{j:number;walkFrom:number}[]=[];
  pattern.stops.forEach((id,j)=>{const t=targets.get(id);if(t)reached.push({j,walkFrom:t.metres})});
  if(!reached.length)continue;
  secondLegs.set(pattern.id,{pattern,targets:reached});
  const last=Math.max(...reached.map(t=>t.j));
  for(let k=0;k<last;k++){
   const list=callsAt.get(pattern.stops[k]);
   const entry={pattern,index:k};
   if(list)list.push(entry);else callsAt.set(pattern.stops[k],[entry]);
  }
 }
 if(!secondLegs.size)return [];
 const neighbours=stopGrid(stops);
 // How near a pattern comes to a place, measured stop by stop: the candidate stops are only the
 // nearest few, and in a dense centre they miss most of the stops within reach (Piccadilly Gardens,
 // 28 September 2026: "ride one stop, walk 330 m back to Piccadilly Gardens (Stop H) for the 43").
 const nearestTo=(p:ServicePattern,point:LatLon,after=-1)=>{
  let best=Infinity;
  for(let i=after+1;i<p.stops.length;i++){const st=stopById.get(p.stops[i]);if(st)best=Math.min(best,straightLineMetres(point,st))}
  return best;
 };
 // For a second bus, how near it has come to the start by each of its stops: a loop is passing the
 // start before the passenger gets off it, not somewhere after.
 const toStart=new Map<string,number[]>();
 const startDistanceBy=(p:ServicePattern,upTo:number)=>{
  let prefix=toStart.get(p.id);
  if(!prefix){let best=Infinity;prefix=p.stops.map(id=>{const st=stopById.get(id);if(st)best=Math.min(best,straightLineMetres(from,st));return best});toStart.set(p.id,prefix)}
  return prefix[upTo]??Infinity;
 };
 const best=new Map<string,ConnectionOption>(),families=new Map<string,ConnectionOption>();
 for(const first of today){
  // Boarded at the origin stop nearest the start that it calls at, and not at its last stop.
  let boarding:{i:number;walk:number;stop:Stop}|null=null;
  first.stops.forEach((id,i)=>{
   const o=origins.get(id);
   if(o&&i<first.stops.length-1&&(!boarding||o.metres<boarding.walk))boarding={i,walk:o.metres,stop:o.stop};
  });
  if(!boarding)continue;
  const from1=boarding as {i:number;walk:number;stop:Stop};
  // A first bus that itself reaches a stop about as near the destination as the second would is a
  // direct journey (lib/plan.ts offers it): changing off it is a detour, not a second way.
  const nearEnough=(walk:number)=>Math.max(walk+200,rules.directReachMetres);
  if(nearestTo(first,to,from1.i)<=nearEnough(0))continue;
  const service1=serviceKey(first);
  for(let x=from1.i+1;x<first.stops.length;x++){
   const off=stopById.get(first.stops[x]);
   if(!off)continue;
   for(const on of neighbours(off,rules.maxTransferMetres)){
    const straight=on.id===off.id?0:straightLineMetres(off,on);
    for(const {pattern:second,index:k} of callsAt.get(on.id)??[]){
     if(second.id===first.id||(second.line===first.line&&(second.operator??'')===(first.operator??'')))continue;
     const legs=secondLegs.get(second.id)!;
     let alight:{j:number;walkFrom:number}|null=null;
     for(const t of legs.targets)if(t.j>k&&(!alight||t.walkFrom<alight.walkFrom))alight=t;
     if(!alight)continue;
     // Likewise a second bus that passes about as near the start as the first bus's stop, before the
     // passenger would get off it: riding one bus to catch another that could have been boarded a
     // street away is a loop, not a change (Stretford Mall, 28 September 2026: "take the 245 one stop
     // back to the Robin Hood for the 255", which itself calls at Stretford Mall).
     if(startDistanceBy(second,alight.j)<=nearEnough(from1.walk))continue;
     const end=stopById.get(second.stops[alight.j]);
     if(!end)continue;
     if(from1.walk+alight.walkFrom>=direct)continue;
     const ride1=metresBetween(first,from1.i,x),ride2=metresBetween(second,k,alight.j);
     const score=from1.walk+(ride1??(x-from1.i)*450)+straight*rules.transferDetour*2+rules.changePenaltyMetres
      +(ride2??(alight.j-k)*450)+alight.walkFrom;
     // One option per pair of services; and one per family — two second buses of one operator to one
     // destination after the same first leg (the 23 and the 25 to The Trafford Centre) are one choice
     // to a passenger. Between the same two stops the other line is kept on the option, whichever comes
     // first; from other stops only the better is kept.
     const key=`${service1}||${serviceKey(second)}`;
     const family=`${first.id}|${from1.stop.id}|${second.operator??''}|${second.destination??''}`;
     const seen=best.get(key),kin=families.get(family);
     if(seen&&seen.score<=score)continue;
     const leg1:Leg={pattern:first,line:first.line,operator:first.operator??null,headsign:first.destination??'?',
      board:from1.stop,boardIndex:from1.i,alight:off,alightIndex:x,rideStops:x-from1.i,rideMetres:ride1,also:[]};
     const leg2:Leg={pattern:second,line:second.line,operator:second.operator??null,headsign:second.destination??'?',
      board:on,boardIndex:k,alight:end,alightIndex:alight.j,rideStops:alight.j-k,rideMetres:ride2,also:[]};
     const sameWay=kin&&kin.transfer.from.id===off.id&&kin.transfer.to.id===on.id&&kin.second.alight.id===end.id;
     if(kin&&kin.score<=score){
      if(sameWay&&kin.second.pattern.id!==second.id&&!kin.second.also.some(l=>l.pattern.id===second.id))kin.second.also.push(leg2);
      continue;
     }
     if(kin){
      best.delete(`${serviceKey(kin.first.pattern)}||${serviceKey(kin.second.pattern)}`);
      if(sameWay)leg2.also.push({...kin.second,also:[]},...kin.second.also.filter(l=>l.pattern.id!==second.id));
     }
     const option:ConnectionOption={kind:'connection',key:connectionKey(leg1,leg2),first:leg1,second:leg2,
      transfer:{from:off,to:on,straightMetres:straight,sameStop:on.id===off.id},
      walkToBoardMetres:from1.walk,walkFromAlightMetres:alight.walkFrom,score};
     best.set(key,option);families.set(family,option);
    }
   }
  }
 }
 // Each option carries every bus between its two pairs of stops. An option a better one already
 // carries on both legs is the same instruction (the 263 → 53 and the 255 → 53 from the same stops at
 // the same change); so is one that boards some of the same buses a stop along for the same change
 // and the same second bus (Sydney Street against Davyhulme Road East, a stop apart). Either is dropped.
 const kept:ConnectionOption[]=[];
 const shareBuses=(a:Leg,b:Leg)=>legFamily(a).some(l=>legFamily(b).some(m=>m.pattern.id===l.pattern.id));
 for(const option of [...best.values()].sort((a,b)=>a.score-b.score).map(o=>withSiblings(o,today,stopById))){
  if(kept.some(k=>covers(k.second,option.second)&&(covers(k.first,option.first)
   ||(k.first.alight.id===option.first.alight.id&&shareBuses(k.first,option.first)))))continue;
  kept.push(option);
 }
 return kept.slice(0,rules.candidates);
}

/**
 * A chosen journey back from its key (a link, or this tab's store), checked against the catalogue
 * and the day: the patterns must still exist and run, and the stops must still be in their order.
 * Null otherwise, and the page says the plan is no longer available rather than showing a stale one.
 */
export function connectionFromKey(key:string,patternsById:Map<string,ServicePattern>,stopById:Map<string,Stop>,day:string):ConnectionOption|null{
 if(!key.startsWith('c:'))return null;
 const parts=key.slice(2).split('|');
 if(parts.length!==6)return null;
 const leg=(patternId:string,boardId:string,alightId:string):Leg|null=>{
  const pattern=patternsById.get(patternId),board=stopById.get(boardId),alight=stopById.get(alightId);
  if(!pattern||!board||!alight||!runsToday(pattern,day))return null;
  const i=pattern.stops.indexOf(boardId),j=pattern.stops.indexOf(alightId);
  if(i<0||j<=i)return null;
  return {pattern,line:pattern.line,operator:pattern.operator??null,headsign:pattern.destination??'?',
   board,boardIndex:i,alight,alightIndex:j,rideStops:j-i,rideMetres:metresBetween(pattern,i,j),also:[]};
 };
 const first=leg(parts[0],parts[1],parts[2]),second=leg(parts[3],parts[4],parts[5]);
 if(!first||!second)return null;
 const straight=first.alight.id===second.board.id?0:straightLineMetres(first.alight,second.board);
 const today=[...patternsById.values()].filter(p=>runsToday(p,day));
 return withSiblings({kind:'connection',key,first,second,transfer:{from:first.alight,to:second.board,straightMetres:straight,sameStop:first.alight.id===second.board.id},
  walkToBoardMetres:0,walkFromAlightMetres:0,score:0},today,stopById);
}

// --------------------------------------------------------------------- the timetable's quality

/** What is known about a pattern's timetable clock against its own buses (schedule-anchor.json). */
export type ScheduleQuality=
 |{kind:'verified';words:string;offsetMinutes:number|null}
 |{kind:'unverified';words:string;offsetMinutes:null}
 |{kind:'unreliable';words:string;offsetMinutes:number|null};
export type AnchorFile={patterns:Record<string,{verified:boolean;reason?:string|null;medianOffsetMinutes?:number}>}|null|undefined;

export function scheduleQuality(patternId:string,anchor:AnchorFile):ScheduleQuality{
 const entry=anchor?.patterns?.[patternId];
 if(!entry)return {kind:'unverified',words:'its timetable has not been checked against this service’s own buses',offsetMinutes:null};
 if(entry.verified)return {kind:'verified',offsetMinutes:entry.medianOffsetMinutes??null,
  words:`its timetable was checked against this service’s own buses${typeof entry.medianOffsetMinutes==='number'?` (they run about ${Math.round(Math.abs(entry.medianOffsetMinutes))} min ${entry.medianOffsetMinutes>=0?'behind':'ahead of'} it at the first stops)`:''}`};
 return {kind:'unreliable',offsetMinutes:entry.medianOffsetMinutes??null,
  words:entry.reason??'its timetable is known not to match where its own buses are'};
}

/**
 * A leg's buses with those whose timetable is known not to match its own buses left out: a sibling
 * on such a timetable would put its misleading times among the others (the inbound 15 serves some
 * of the 86's stops into town). The leg's own bus is kept, and its timing is withheld with the
 * reason instead. The same option back when nothing is left out, so identity holds.
 */
export function withoutUnreliable(option:ConnectionOption,anchor:AnchorFile):ConnectionOption{
 const trusted=(l:Leg)=>scheduleQuality(l.pattern.id,anchor).kind!=='unreliable';
 if(option.first.also.every(trusted)&&option.second.also.every(trusted))return option;
 return {...option,first:{...option.first,also:option.first.also.filter(trusted)},second:{...option.second,also:option.second.also.filter(trusted)}};
}

/** What is known of a leg's timetables together: its own bus's, unless that one is checked and
 *  another bus of the leg is not, when the leg as a whole is unchecked. */
export function familyQuality(leg:Leg,anchor:AnchorFile):ScheduleQuality{
 const own=scheduleQuality(leg.pattern.id,anchor);
 if(own.kind!=='verified')return own;
 const unchecked=leg.also.map(l=>scheduleQuality(l.pattern.id,anchor)).find(q=>q.kind!=='verified');
 return unchecked?{kind:'unverified',offsetMinutes:null,
  words:`its timetable was checked against its own buses, but not every other bus between these stops has been`}:own;
}

// --------------------------------------------------------------------- the walk between the stops

export type TransferWalk={basis:'straight'|'route';metres:number;seconds:number};

/** The walk between the two boarding points: provisional from the straight line, lengthened for the
 *  streets, until a pedestrian router has answered; then the router's own distance and pace. */
export function transferWalk(transfer:Transfer,route:{metres:number;seconds:number}|null|undefined,rules=CONNECTION_RULES):TransferWalk{
 if(route)return {basis:'route',metres:route.metres,seconds:route.seconds};
 if(transfer.sameStop)return {basis:'straight',metres:0,seconds:0};
 const metres=transfer.straightMetres*rules.transferDetour;
 return {basis:'straight',metres,seconds:metres/rules.walkMetresPerMinute*60};
}

// --------------------------------------------------------------------- timing, from the timetable

export type TimedLeg={departure:ScheduledDeparture;departMs:number;arriveMs:number|null};
export type TimedConnection={
 first:TimedLeg;
 /** The next scheduled second bus the passenger could reach; null where none is timetabled inside the window. */
 second:TimedLeg|null;
 /** When the passenger could be at the second boarding point: arrival, the walk and the allowance. */
 readyMs:number|null;
 /** Second bus leaves minus first bus arrives; and what is left of it after the walk and the allowance. */
 changeSeconds:number|null;spareSeconds:number|null;
 /** Earlier first buses that only wait longer for this same second bus, folded into this row: the
  *  earliest of them, and how many. A passenger already at the stop may take one; they arrive no sooner. */
 earlier:{departMs:number;line:string;count:number}|null;
};
export type ConnectionTiming=
 |{kind:'timed';rows:TimedConnection[];walk:TransferWalk;allowanceSeconds:number;
   /** True when nothing left within the first window, so the rows are the next day's. */
   later:boolean}
 |{kind:'withheld';leg:1|2;reason:string}
 |{kind:'unavailable';reason:string};

/** The scheduled instant of a journey at another stop of its pattern, or null where the timetable
 *  declares no running time to it (never zero, never the nearest). */
export function atStopMs(departure:ScheduledDeparture,pattern:ServicePattern,index:number):number|null{
 const own=pattern.timings?.[departure.timing]?.[index];
 const seconds=own===null||own===undefined?pattern.seconds?.[index]:own;
 if(seconds===null||seconds===undefined)return null;
 return londonInstant(departure.serviceDay,departure.originSeconds+seconds);
}

/**
 * The next few connections by the timetable: each first bus that leaves the boarding point in the
 * next `firstLegWindowMinutes`, where it is timetabled to reach the change, when the passenger could
 * be at the second boarding point, and the first second bus timetabled to leave after that.
 */
export function timeConnection(option:ConnectionOption,input:{
 boards:{first:StopDepartures|null;second:StopDepartures|null};rules:OperatingRule[]|null;nowMs:number;
 walk:TransferWalk;allowanceSeconds:number;quality:{first:ScheduleQuality;second:ScheduleQuality};
 limit?:number;planRules?:typeof CONNECTION_RULES}):ConnectionTiming{
 const rules=input.planRules??CONNECTION_RULES;
 if(input.quality.first.kind==='unreliable')return {kind:'withheld',leg:1,reason:input.quality.first.words};
 if(input.quality.second.kind==='unreliable')return {kind:'withheld',leg:2,reason:input.quality.second.words};
 if(!input.rules)return {kind:'unavailable',reason:'the timetable’s operating rules could not be read'};
 if(!input.boards.first)return {kind:'unavailable',reason:`no timetable board is published for ${stopWords(option.first.board)}`};
 if(!input.boards.second)return {kind:'unavailable',reason:`no timetable board is published for ${stopWords(option.second.board)}`};
 const {first,second}=option;
 // Every first bus of the leg's family from its boarding point, each timed to the change on its own pattern.
 const firstsIn=(fromMs:number,toMs:number)=>legFamily(first)
  .flatMap(leg=>departuresOn(input.boards.first,input.rules,leg.pattern.id,fromMs,toMs).map(departure=>({leg,departure})))
  .sort((a,b)=>a.departure.atMs-b.departure.atMs).slice(0,input.limit??rules.firstBuses);
 let firsts=firstsIn(input.nowMs-60_000,input.nowMs+rules.firstLegWindowMinutes*60_000);
 // Nothing in the next few hours is not nothing: at eleven at night the next first bus is tomorrow's,
 // and it is shown as tomorrow's (the board does the same).
 const later=!firsts.length;
 if(later)firsts=firstsIn(input.nowMs-60_000,input.nowMs+26*3600_000);
 if(!firsts.length)return {kind:'unavailable',reason:`nothing on the ${lineNames(first)} is timetabled from ${stopWords(first.board)} in the next day`};
 const rows:TimedConnection[]=[];
 for(const {leg:ridden,departure} of firsts){
  const arriveMs=atStopMs(departure,ridden.pattern,ridden.alightIndex);
  const row:TimedConnection={first:{departure,departMs:departure.atMs,arriveMs},second:null,readyMs:null,changeSeconds:null,spareSeconds:null,earlier:null};
  if(arriveMs!==null){
   row.readyMs=arriveMs+Math.round(input.walk.seconds+input.allowanceSeconds)*1000;
   // The first second bus of any of the leg's buses to leave after the passenger could be there.
   let next:{leg:Leg;departure:ScheduledDeparture}|null=null;
   for(const leg of legFamily(second)){
    const d=departuresOn(input.boards.second,input.rules,leg.pattern.id,row.readyMs,row.readyMs+rules.secondLegWindowMinutes*60_000)[0];
    if(d&&(!next||d.atMs<next.departure.atMs))next={leg,departure:d};
   }
   if(next){
    row.second={departure:next.departure,departMs:next.departure.atMs,arriveMs:atStopMs(next.departure,next.leg.pattern,next.leg.alightIndex)};
    row.changeSeconds=Math.round((next.departure.atMs-arriveMs)/1000);
    row.spareSeconds=Math.round((next.departure.atMs-row.readyMs)/1000);
   }
  }
  rows.push(row);
 }
 return {kind:'timed',rows:foldEarlier(rows),walk:input.walk,allowanceSeconds:input.allowanceSeconds,later};
}

/**
 * A first bus that leaves earlier only to reach the destination no sooner than a later one (it waits
 * longer for the same second bus) is not another connection: it is folded into the later row, which
 * says when the earliest of those leaves. A first bus with no second bus in reach, where a later one
 * has one, is folded silently. Rows stay in order of leaving, each reaching the destination later
 * than the one before.
 */
function foldEarlier(rows:TimedConnection[]):TimedConnection[]{
 const end=(r:TimedConnection)=>r.second?(r.second.arriveMs??r.second.departMs):Infinity;
 const kept:TimedConnection[]=[];   // later rows first
 for(let i=rows.length-1;i>=0;i--){
  const row=rows[i],after=kept.at(-1);
  if(after&&end(after)<Infinity&&end(after)<=end(row)){
   if(row.second)after.earlier={departMs:row.first.departMs,line:row.first.departure.line,count:(after.earlier?.count??0)+1};
   continue;
  }
  kept.push(row);
 }
 return kept.reverse();
}

/**
 * The options in the order a passenger would want them: soonest at the destination by the timetable
 * (the second bus's arrival at its stop, and the walk from it, provisional as every walk here is until
 * checked), then the one that leaves later, then the planner's own order; those with no time after, in
 * the planner's order. Taken once, when the boards arrive, so the list does not reorder under a finger.
 */
export function rankConnections(options:ConnectionOption[],timingOf:(option:ConnectionOption)=>ConnectionTiming,
                                limit:number=CONNECTION_RULES.options):ConnectionOption[]{
 const walkMs=(option:ConnectionOption)=>(option.walkFromAlightMetres??0)*CONNECTION_RULES.transferDetour/CONNECTION_RULES.walkMetresPerMinute*60_000;
 const end=(option:ConnectionOption,timing:ConnectionTiming)=>{
  if(timing.kind!=='timed')return null;
  const row=timing.rows.find(r=>r.second);
  return row?{arrive:(row.second!.arriveMs??row.second!.departMs)+walkMs(option),leave:row.first.departMs}:null;
 };
 return options.map((option,i)=>({option,i,e:end(option,timingOf(option))}))
  .sort((a,b)=>a.e&&b.e?(a.e.arrive-b.e.arrive||b.e.leave-a.e.leave||a.i-b.i):a.e?-1:b.e?1:a.i-b.i)
  .slice(0,limit).map(x=>x.option);
}

/** On the first bus: the second leg's buses from the change, by the timetable, from the soonest the
 *  passenger could be there (if they got off now). Which first bus they are on is not assumed. */
export type OnwardTiming=
 |{kind:'timed';rows:TimedLeg[]}
 |{kind:'withheld';reason:string}
 |{kind:'unavailable';reason:string};
export function onwardFromChange(option:ConnectionOption,input:{board:StopDepartures|null;rules:OperatingRule[]|null;nowMs:number;
 walk:TransferWalk;quality:ScheduleQuality;limit?:number}):OnwardTiming{
 if(input.quality.kind==='unreliable')return {kind:'withheld',reason:input.quality.words};
 if(!input.rules)return {kind:'unavailable',reason:'the timetable’s operating rules could not be read'};
 if(!input.board)return {kind:'unavailable',reason:`no timetable board is published for ${stopWords(option.second.board)}`};
 const from=input.nowMs+Math.round(input.walk.seconds)*1000;
 const rows=legFamily(option.second)
  .flatMap(leg=>departuresOn(input.board,input.rules,leg.pattern.id,from,from+CONNECTION_RULES.firstLegWindowMinutes*60_000)
   .map(departure=>({departure,departMs:departure.atMs,arriveMs:atStopMs(departure,leg.pattern,leg.alightIndex)})))
  .sort((a,b)=>a.departMs-b.departMs).slice(0,input.limit??3);
 if(!rows.length)return {kind:'unavailable',reason:`no ${lineNames(option.second)} is timetabled from ${stopWords(option.second.board)} in the next three hours`};
 return {kind:'timed',rows};
}

// --------------------------------------------------------------------- tracked buses

/** The vehicle reporting this very timetabled journey: the operator's own reported origin departure
 *  on this pattern and service day, naming one journey or one shared timing. Never the nearest bus. */
export function busOnJourney(departure:ScheduledDeparture,buses:FollowBus[]):FollowBus|null{
 return buses.find(bus=>{
  const match=bus.match;
  if(!match||!('patternId' in match)||match.patternId!==departure.patternId)return false;
  const scheduled=match.scheduled;
  if(!scheduled||!('departure' in scheduled))return false;
  if(scheduled.departure!==departure.originLocal||scheduled.serviceDay!==departure.serviceDay)return false;
  return scheduled.journeys===1||scheduled.timing===departure.timing;
 })??null;
}

/** Where a bus on a leg's pattern stands relative to the leg, from its last report and the timetable's order. */
export type LegStanding=
 |{kind:'before';stopsAway:number}          // before the boarding point
 |{kind:'between';stopsToAlight:number}      // between the boarding point and the alighting stop
 |{kind:'past'};
export function legStanding(bus:FollowBus,leg:Leg):LegStanding|null{
 const match=bus.match;
 if(!match||!('patternId' in match)||match.patternId!==leg.pattern.id)return null;
 const at=match.patternIndex;
 if(at<leg.boardIndex)return {kind:'before',stopsAway:leg.boardIndex-at};
 if(at<leg.alightIndex)return {kind:'between',stopsToAlight:leg.alightIndex-at};
 return {kind:'past'};
}

/** The buses tracked on any of a leg's patterns that have not yet passed its alighting stop, nearest
 *  the boarding point first: what a passenger waiting there can see coming, whether or not any is
 *  tied to a timetabled journey. */
export function busesOnLeg(leg:Leg,buses:FollowBus[]):{bus:FollowBus;standing:LegStanding}[]{
 const family=legFamily(leg);
 return buses.map(bus=>{
   for(const member of family){const standing=legStanding(bus,member);if(standing)return {bus,standing}}
   return null;
  })
  .filter((x):x is {bus:FollowBus;standing:LegStanding}=>x!==null&&x.standing.kind!=='past')
  .sort((a,b)=>rank(a.standing)-rank(b.standing));
}
const rank=(s:LegStanding)=>s.kind==='before'?s.stopsAway:s.kind==='between'?-1:99;

/**
 * The timetabled departure, from a leg's boarding stop, of the journey a tracked bus reports it is on:
 * its operator's reported origin departure, on its service day, naming one journey of the leg's buses
 * (or one shared timing). What lets a tracked bus be said to be "the 06:15" rather than left
 * unidentified; null where the report does not name one, or the board does not hold it.
 */
export function timetabledAtBoard(bus:FollowBus,leg:Leg,board:StopDepartures|null,rules:OperatingRule[]|null):ScheduledDeparture|null{
 const match=bus.match;
 if(!board||!rules||!match||!('patternId' in match))return null;
 const member=legFamily(leg).find(l=>l.pattern.id===match.patternId);
 const scheduled=match.scheduled;
 if(!member||!scheduled||!('departure' in scheduled))return null;
 const day=scheduled.serviceDay;
 const found=departuresOn(board,rules,member.pattern.id,londonInstant(day,0),londonInstant(day,30*3600))
  .filter(d=>d.serviceDay===day&&d.originLocal===scheduled.departure&&(scheduled.journeys===1||d.timing===scheduled.timing));
 return found.length===1?found[0]:null;
}

// --------------------------------------------------------------------- words

/** A leg's lines, each once: "263", "263 or 255", "23, 25 or 250". */
export function lineNames(leg:Leg):string{
 const lines=[...new Set(legFamily(leg).map(l=>l.line))];
 return lines.length>1?`${lines.slice(0,-1).join(', ')} or ${lines.at(-1)}`:lines[0];
}
/** A leg's lines for a tight space: "263/255". */
export const lineShort=(leg:Leg)=>[...new Set(legFamily(leg).map(l=>l.line))].join('/');
/**
 * A leg's buses as a passenger reads them, with the destinations on their fronts: "263 (or the 255)
 * towards Piccadilly Gardens"; "41 towards Middleton Bus Station or Piccadilly Gardens" for one line
 * whose journeys end in different places; "85 towards Chorlton Bus Station (or the 85A towards
 * Wintermans Road)" for lines that go on to different places. Lines going to the same places are named
 * together; the leg's own bus leads.
 */
export function legService(leg:Leg):string{
 const byLine=new Map<string,string[]>();
 for(const l of legFamily(leg)){
  const places=byLine.get(l.line)??[];
  if(!places.includes(l.headsign))places.push(l.headsign);
  byLine.set(l.line,places);
 }
 const byPlaces=new Map<string,{lines:string[];places:string[]}>();
 for(const [line,places] of byLine){
  const key=[...places].sort().join('|');
  const group=byPlaces.get(key)??{lines:[],places};
  group.lines.push(line);
  byPlaces.set(key,group);
 }
 const either=(words:string[])=>words.length>1?`${words.slice(0,-1).join(', ')} or ${words.at(-1)}`:words[0];
 const groups=[...byPlaces.values()];
 if(groups.length===1){const [{lines,places}]=groups;
  return `${lines[0]}${lines.length>1?` (or the ${lines.slice(1).join(', ')})`:''} towards ${either(places)}`}
 const said=groups.map(({lines,places})=>`${either(lines)} towards ${either(places)}`);
 return `${said[0]} (or the ${said.slice(1).join(', or the ')})`;
}
export const legWords=(leg:Leg)=>`the ${legService(leg)}`;
export const stopName=stopWords;

/** One sentence a passenger can follow, in the order they will do it. */
export function connectionSentence(o:ConnectionOption):string{
 const walk=(m:number)=>`about ${Math.max(10,Math.round(m/10)*10)} m`;
 const change=o.transfer.sameStop?`change at the same stop, ${stopWords(o.transfer.to)}`
  :`walk ${walk(o.transfer.straightMetres*CONNECTION_RULES.transferDetour)} to ${stopWords(o.transfer.to)}`;
 return `Take ${legWords(o.first)} from ${stopWords(o.first.board)} → get off at ${stopWords(o.first.alight)} `
  +`(${o.first.rideStops} stop${o.first.rideStops===1?'':'s'}) → ${change} → take ${legWords(o.second)} `
  +`→ get off at ${stopWords(o.second.alight)} (${o.second.rideStops} stop${o.second.rideStops===1?'':'s'}).`;
}

/** Minutes, said as a passenger would: "7 min to change". */
export const minutesWords=(seconds:number)=>{
 const m=Math.round(seconds/60);
 return m<1?'under a minute':`${m} min`;
};
