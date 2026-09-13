/**
 * The passenger's questions, answered from the data we hold and no further.
 *
 *   Which bus, to where?          the operator's reported route and destination
 *   From which boarding point?    the chosen NaPTAN stop, with its side of the road
 *   Does it call here?            the timetable pattern it was matched to, or why not
 *   How far has it got?           its last report against the timetable's stop order
 *   How old is that report?       the report's own age, never our request's
 *
 * Three distances are kept apart and labelled: you to your stop (straight line), the bus to
 * your stop (straight line, plus the declared stop-sequence distance where it exists), and
 * an arrival time, which Lost Minutes does not predict.
 */
import type {FollowBus} from '@/lib/follow';
import {alongRouteWords,bringsItToYourStop,relateToStop,relationWords} from '@/lib/patterns';
import type {PatternCatalogue,ServicePattern,StopRelation} from '@/lib/patterns';
import {runsOn} from '@/lib/service-days';
import type {OperatingRule} from '@/lib/service-days';
import {straightLineMetres} from '@/lib/stops';
import type {Stop} from '@/lib/stops';

/** Within this straight-line distance of the stop a report counts as "at or near" it. */
export const AT_STOP_METRES=150;

export type Tone='good'|'caution'|'bad'|'neutral';

// --------------------------------------------------------------------- services here

export type ServiceChoice={key:string;operator:string|null;line:string;direction:string|null;
 destination:string;runsToday:boolean|null;runs:string;patterns:ServicePattern[];reporting:number};

export const serviceKey=(p:{operator?:string|null;line:string;direction?:string|null;destination?:string|null})=>
 `${p.operator??''}|${p.line}|${p.direction??''}|${p.destination??''}`;

const natural=(a:string,b:string)=>a.localeCompare(b,undefined,{numeric:true});

/**
 * The services a passenger can board at a stop, one per operator, line, direction and
 * destination. A pattern that ends at this stop is left out: there the bus terminates.
 */
export function servicesAtStop(catalogue:PatternCatalogue|null,stopId:string,day:string,
                               buses:FollowBus[],patterns:Map<string,ServicePattern>):ServiceChoice[]{
 const groups=new Map<string,ServiceChoice>();
 for(const pattern of catalogue?.patterns??[]){
  const index=pattern.stops.indexOf(stopId);
  if(index<0||index===pattern.stops.length-1)continue;
  const key=serviceKey(pattern);
  const group=groups.get(key)??{key,operator:pattern.operator??null,line:pattern.line,
   direction:pattern.direction??null,destination:pattern.destination||'Destination not named in the timetable',
   runsToday:null,runs:pattern.runs??'',patterns:[],reporting:0};
  group.patterns.push(pattern);
  groups.set(key,group);
 }
 for(const group of groups.values()){
  const days=group.patterns.map(p=>runsOn(p.operatingRules as OperatingRule[]|null|undefined,day));
  group.runsToday=days.some(d=>d===true)?true:days.every(d=>d===false)?false:null;
  group.runs=[...new Set(group.patterns.map(p=>p.runs).filter(Boolean))].join('; ');
 }
 for(const bus of buses){
  const relation=relateToStop(bus,stopId,patterns);
  if(!bringsItToYourStop(relation)&&relation.kind!=='branch_some_call')continue;
  const keys=new Set('pattern' in relation?[serviceKey(relation.pattern)]
                     :'candidates' in relation?relation.candidates.map(serviceKey):[]);
  for(const key of keys){const group=groups.get(key);if(group)group.reporting+=1}
 }
 return [...groups.values()].sort((a,b)=>
  Number(b.runsToday===true)-Number(a.runsToday===true)||b.reporting-a.reporting
  ||natural(a.line,b.line)||a.destination.localeCompare(b.destination));
}

/** Whether a bus is one of a chosen service's buses. Its route number alone is not enough. */
export function busOnService(bus:FollowBus,choice:ServiceChoice,relation:StopRelation){
 if(bus.route!==choice.line)return false;
 if(choice.operator&&bus.operator!==choice.operator)return false;
 if('pattern' in relation)return serviceKey(relation.pattern)===choice.key;
 if('candidates' in relation)return relation.candidates.some(p=>serviceKey(p)===choice.key);
 return false;
}

// --------------------------------------------------------------------- buses at the stop

export type NearbyBus={bus:FollowBus;metres:number;relation:StopRelation};

/** Buses whose last report is at or near the stop, nearest first, whatever their service. */
export function busesAtStop(buses:FollowBus[],stop:Stop,patterns:Map<string,ServicePattern>,
                            radius=AT_STOP_METRES):NearbyBus[]{
 return buses.map(bus=>({bus,metres:straightLineMetres(stop,bus),relation:relateToStop(bus,stop.id,patterns)}))
  .filter(item=>item.metres<=radius).sort((a,b)=>a.metres-b.metres);
}

// --------------------------------------------------------------------- the card's claims

export type Claim={tone:Tone;text:string;detail:string};

const plural=(n:number,one:string,many:string)=>`${n} ${n===1?one:many}`;

/** "Does it call at my stop?" with its reason beside it. */
export function association(relation:StopRelation,bus:FollowBus):Claim{
 switch(relation.kind){
  case 'approaching': case 'near_your_stop': case 'beyond':
   return {tone:'good',text:'Timetabled to call at your stop',
    detail:[`Matched to the ${relation.pattern.operator??''} ${relation.pattern.line} pattern to ${relation.pattern.destination??'its terminus'}`.replace('  ',' '),
            relation.pattern.runs?`runs ${relation.pattern.runs}`:''].filter(Boolean).join(' · ')};
  case 'does_not_call':
   return {tone:'bad',text:'Its branch does not call at your stop',
    detail:`It is running the pattern to ${relation.pattern.destination??'another terminus'}, which does not include your stop.`};
  case 'branch_all_call':
   return {tone:'good',text:'Every possible branch calls at your stop',
    detail:`Its position fits ${plural(relation.candidates.length,'branch','branches')} of route ${bus.route}; which one is unresolved, but your stop is on all of them.`};
  case 'branch_some_call':
   return {tone:'caution',text:`May call at your stop (${relation.calling} of ${relation.total} possible branches)`,
    detail:'Its position fits more than one branch and they do not all call here. Its destination is what would settle it.'};
  case 'branch_none_call':
   return {tone:'bad',text:'None of its possible branches calls at your stop',detail:''};
  case 'unresolved':
   // Name the service: "this route label" says less to a passenger than "BNSM route 53".
   if(relation.reason==='no_pattern_for_route')
    return {tone:'neutral',text:'Not confirmed for your stop',
     detail:`No timetable pattern is held for ${bus.operator} route ${bus.route}, so whether it calls here is unknown.`};
   if(relation.reason==='no_pattern_for_operator')
    return {tone:'neutral',text:'Not confirmed for your stop',
     detail:`Route ${bus.route} timetables are held, but for another operator; ${bus.operator}'s is not, so whether it calls here is unknown.`};
   return {tone:'caution',text:'Not confirmed for your stop',detail:relation.explanation};
  default:
   return {tone:'neutral',text:'Not confirmed for your stop',
    detail:`No timetable pattern is held for ${bus.operator} route ${bus.route}, so whether it calls here is unknown.`};
 }
}

/** "How far has it got?", as far as one report and the stop order support. */
export function progress(relation:StopRelation,name:(atco:string)=>string):Claim{
 switch(relation.kind){
  case 'approaching':
   return {tone:'good',text:`Last report nearest ${name(relation.nearestStop)} · ${plural(relation.stopsAway,'stop','stops')} before yours`,
    detail:'Counted along the timetable’s stop order from the stop the report was closest to. It may or may not have called there yet.'};
  case 'near_your_stop':
   return {tone:'good',text:relation.metresFromStop!==null
     ?`Last report about ${Math.round(relation.metresFromStop/10)*10} m from your stop`:'Last report nearest your stop',
    detail:'Arriving, at the stop or just leaving: one position cannot tell which.'};
  case 'beyond':
   return {tone:'bad',text:`Last report is past your stop · nearest ${name(relation.nearestStop)}, ${plural(relation.stopsPast,'stop','stops')} later`,
    detail:'In the timetable’s stop order its last report comes after your stop.'};
  case 'branch_all_call':
   return {tone:'good',text:relation.nearestStop
     ?`Last report nearest ${name(relation.nearestStop)} · ${relationWords(relation)}`:relationWords(relation),
    detail:'Counted separately on each possible branch from the stop it was closest to.'};
  case 'branch_some_call': case 'branch_none_call':
   return {tone:'caution',text:relation.nearestStop
     ?`Last report nearest ${name(relation.nearestStop)}; after that its branches differ`:'Its possible branches differ from here',
    detail:'A shared stop now does not mean a shared route onward.'};
  case 'does_not_call':
   return {tone:'neutral',text:'Progress toward your stop does not apply',detail:''};
  case 'unresolved':
   return {tone:'neutral',text:'Its progress toward your stop cannot be stated',detail:relation.explanation};
  default:
   return {tone:'neutral',text:'Its progress toward your stop cannot be stated',
    detail:'That needs a timetable pattern for this service.'};
 }
}

export type DistanceLine={label:string;value:string;basis:string};

const metresWords=(m:number)=>m<1000?`${Math.round(m/10)*10} m`:`${(m/1000).toFixed(1)} km`;

/**
 * You to your stop and the bus to your stop, each with the basis it actually has. Your
 * distance is a walking route only when a pedestrian router supplied one; otherwise it is
 * labelled as a straight line. No arrival time is listed: nothing here predicts one.
 */
export function distanceLines({here,stop,bus,relation,walk}:{here?:{lat:number;lon:number}|null;
 stop?:Stop|null;bus?:FollowBus|null;relation?:StopRelation|null;
 walk?:{metres:number;seconds:number;provider:string}|null}):DistanceLine[]{
 const lines:DistanceLine[]=[];
 if(walk&&stop)lines.push({label:'You to your stop',
  value:`${Math.max(1,Math.round(walk.seconds/60))} min walk · ${metresWords(walk.metres)}`,
  basis:`walking route from ${walk.provider}, at its walking pace`});
 else if(here&&stop)lines.push({label:'You to your stop',value:metresWords(straightLineMetres(here,stop)),
  basis:'straight line, not a walking route'});
 if(bus&&stop){
  lines.push({label:'Bus to your stop',value:metresWords(straightLineMetres(bus,stop)),
   basis:'straight line from its last report'});
  if(relation?.kind==='approaching')lines.push({label:'Along the stop sequence',
   value:relation.alongMetres===null?'not declared':alongRouteWords(relation.alongMetres).replace(' along the stop sequence',''),
   basis:relation.alongMetres===null?'the timetable omits a link distance'
    :'the timetable’s declared link distances, stop to stop, not the road'});
 }
 return lines;
}

// --------------------------------------------------------------------- the stop board

/** Where a bus stands relative to your stop, as far as its last report and the timetable go. */
export type Standing='coming'|'maybe'|'passed'|'not_for_stop'|'unknown';

export function standing(relation:StopRelation):Standing{
 switch(relation.kind){
  case 'approaching': case 'near_your_stop': case 'branch_all_call': return 'coming';
  case 'branch_some_call': return 'maybe';
  case 'beyond': return 'passed';
  case 'does_not_call': case 'branch_none_call': return 'not_for_stop';
  default: return 'unknown';
 }
}

/** A report old enough to be listed apart: it may no longer describe where the bus is. */
export const isOldReport=(bus:FollowBus)=>bus.freshness==='stale';

export type BoardRow={bus:FollowBus;relation:StopRelation;standing:Standing;metres:number};
export type StopBoard={coming:BoardRow[];maybe:BoardRow[];nearby:BoardRow[];passed:BoardRow[];
 old:BoardRow[];elsewhere:BoardRow[]};

// Nearest first for someone waiting: at or near the stop, then fewest stops away.
function waitRank(relation:StopRelation):[number,number]{
 if(relation.kind==='near_your_stop')return [0,0];
 if(relation.kind==='approaching')return [1,relation.stopsAway];
 if(relation.kind==='branch_all_call')return [2,relation.stopsAway??relation.range?.[0]??99];
 return [9,0];
}

/**
 * The buses around a stop, ranked for someone waiting there. Buses timetabled to call and not
 * yet past come first and alone. A bus whose branch may not call, one reported near the stop
 * that is not coming here, one already past it, one with an old report and one merely nearby
 * are each listed apart, so nothing is promoted into the boarding options by proximity alone.
 */
export function stopBoard(buses:FollowBus[],stop:Stop,relations:Map<string,StopRelation>,
                          onService?:(bus:FollowBus,relation:StopRelation)=>boolean):StopBoard{
 const board:StopBoard={coming:[],maybe:[],nearby:[],passed:[],old:[],elsewhere:[]};
 for(const bus of buses){
  const relation=relations.get(bus.key);
  if(!relation)continue;
  const row:BoardRow={bus,relation,standing:standing(relation),metres:straightLineMetres(stop,bus)};
  if(isOldReport(bus)){if(row.metres<=3000)board.old.push(row);continue}
  if(row.standing==='coming'||row.standing==='maybe'){
   // A chosen service narrows the boarding options; it never reclassifies a bus.
   if(!onService||onService(bus,relation))board[row.standing].push(row);
   continue;
  }
  if(row.metres<=AT_STOP_METRES)board.nearby.push(row);
  else if(row.standing==='passed'&&row.metres<=3000)board.passed.push(row);
  else if(row.metres<=1500)board.elsewhere.push(row);
 }
 const byMetres=(a:BoardRow,b:BoardRow)=>a.metres-b.metres;
 board.coming.sort((a,b)=>{const x=waitRank(a.relation),y=waitRank(b.relation);
  return x[0]-y[0]||x[1]-y[1]||(a.bus.ageSeconds??0)-(b.bus.ageSeconds??0)});
 board.maybe.sort(byMetres);board.nearby.sort(byMetres);board.elsewhere.sort(byMetres);
 board.passed.sort((a,b)=>('stopsPast' in a.relation?a.relation.stopsPast:0)-('stopsPast' in b.relation?b.relation.stopsPast:0));
 board.old.sort((a,b)=>(a.bus.ageSeconds??0)-(b.bus.ageSeconds??0));
 board.elsewhere=board.elsewhere.slice(0,12);
 return board;
}

/** One short phrase for a bus's standing, for a list row. */
export function standingWords(row:BoardRow):string{
 switch(row.standing){
  case 'coming': case 'maybe': return relationWords(row.relation);
  case 'passed': return 'already past your stop';
  case 'not_for_stop': return 'does not call at your stop';
  default: return 'not confirmed for your stop';
 }
}

// --------------------------------------------------------------------- the schematic

export type SchematicItem=
 | {kind:'stop';atco:string;name:string;role:'bus'|'yours'|'both'|'plain'}
 | {kind:'gap';count:number}
 | {kind:'fork';branches:number};

/**
 * A compact strip of named stops between the bus's nearest stop and yours: the timetable's
 * order, not the road. Long runs between the two collapse into a counted gap.
 */
export function schematic(relation:StopRelation,name:(atco:string)=>string,stopId:string,max=7):SchematicItem[]{
 if(relation.kind==='branch_all_call'||relation.kind==='branch_some_call'||relation.kind==='branch_none_call'){
  const first=relation.candidates[0];
  const index=relation.nearestStop?first.stops.indexOf(relation.nearestStop):-1;
  if(index<0)return [];
  // Stops shared by every branch from the nearest one on, then the point where they part.
  const shared:string[]=[];
  for(let i=index;i<first.stops.length;i++){
   const atco=first.stops[i];
   if(!relation.candidates.every(p=>p.stops[p.stops.indexOf(relation.nearestStop!)+(i-index)]===atco))break;
   shared.push(atco);
  }
  const items:SchematicItem[]=shared.slice(0,max-1).map((atco,i)=>({kind:'stop',atco,name:name(atco),
   role:i===0?(atco===stopId?'both':'bus'):atco===stopId?'yours':'plain'}));
  items.push({kind:'fork',branches:relation.candidates.length});
  return items;
 }
 if(!('pattern' in relation)||relation.kind==='does_not_call')return [];
 const pattern=relation.pattern;
 const stopIndex=pattern.stops.indexOf(stopId);
 const busIndex=relation.kind==='near_your_stop'?stopIndex:pattern.stops.indexOf(relation.nearestStop);
 if(stopIndex<0||busIndex<0)return [];
 const low=Math.max(0,Math.min(busIndex,stopIndex)-1);
 const high=Math.min(pattern.stops.length-1,Math.max(busIndex,stopIndex)+1);
 const keep=new Set([low,busIndex,busIndex+1,stopIndex-1,stopIndex,high]);
 const items:SchematicItem[]=[];
 let gap=0;
 for(let i=low;i<=high;i++){
  if(high-low+1>max&&!keep.has(i)){gap+=1;continue}
  if(gap){items.push({kind:'gap',count:gap});gap=0}
  const atco=pattern.stops[i];
  items.push({kind:'stop',atco,name:name(atco),
   role:i===busIndex&&i===stopIndex?'both':i===busIndex?'bus':i===stopIndex?'yours':'plain'});
 }
 return items;
}

// --------------------------------------------------------------------- the camera

/** What "Fit journey" frames: you, your stop and the chosen bus. Other buses never widen it. */
export function journeyFocus({here,stop,bus}:{here?:{lat:number;lon:number}|null;
 stop?:{lat:number;lon:number}|null;bus?:{lat:number;lon:number}|null}){
 return [here,stop,bus].filter((p):p is {lat:number;lon:number}=>Boolean(p));
}
