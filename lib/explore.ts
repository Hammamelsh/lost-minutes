// Which buses suit a ride-along right now, from the same facts the ride uses. Three kinds are told
// apart and never rolled into one: a bus on a road the published evaluation scored the model on
// (its movement is estimated); a bus on a road accepted against that service's own reports (the
// front view is there, and it travels the road between its reports); and a bus merely placed on a
// timetable pattern with a recent report (it travels the line between its reports, outside only).
// Nothing here is a showcase: the list is whatever the latest publication supports, and empty
// when nothing does.
import type {FollowBus} from '@/lib/follow';
import type {MotionModel} from '@/lib/motion-view';
import {project,type Track} from '@/lib/motion';

export type RideTier='estimated'|'road'|'placed';
export type RideCandidate={bus:FollowBus;tier:RideTier;estimated:boolean};

const TIER_ORDER:Record<RideTier,number>={estimated:0,road:1,placed:2};

/** What the ride will be, in the app's own words; "Front view" is what the button in the ride is called. */
export const TIER_WORDS:Record<RideTier,string>={
 estimated:'Reported positions · may pause · Front view',
 road:'Reported positions · may pause · Front view',
 placed:'Reported positions · may pause',
};

export function rideCandidates(buses:FollowBus[],accepted:Set<string>,model:MotionModel|null,limit=3):RideCandidate[]{
 return rankDistinct(eligible(buses,accepted,model),limit);
}

function eligible(buses:FollowBus[],accepted:Set<string>,model:MotionModel|null):RideCandidate[]{
 const out:RideCandidate[]=[];
 for(const bus of buses){
  const m=bus.match,id=m&&'patternId' in m?m.patternId:null;
  // An unsettled branch may be on shared road, but that is decided by geometry at the moment of
  // riding; a bus offered here is one whose ride is certain now.
  if(!id)continue;
  // An operator's test unit is not a ride to offer anyone (BNML "TEST_BUS" on a 263, 22 September 2026).
  if(/test/i.test(bus.vehicle))continue;
  if(accepted.has(id)){
   if(bus.freshness!=='fresh'&&bus.freshness!=='ageing')continue;
   // Since 25 September 2026 every ride is drawn from the bus's own reports (backlog 31), so a bus
   // on a road the model was scored on rides as any other on a checked road; `estimated` says only
   // that the map, outside the ride, shows it estimated.
   const estimated=model?.patterns.has(id)??false;
   out.push({bus,tier:'road',estimated});
  }else if(bus.freshness==='fresh'){
   // A bus with no checked road still rides, between its own reports and from outside only; it is
   // offered after those with one, and only on a fresh report, because that is all it has.
   out.push({bus,tier:'placed',estimated:false});
  }
 }
 return out;
}

function rankDistinct(out:RideCandidate[],limit:number):RideCandidate[]{
 const ranked=out.sort((a,b)=>TIER_ORDER[a.tier]-TIER_ORDER[b.tier]||(a.bus.ageSeconds??999)-(b.bus.ageSeconds??999));
 // Three different rides, not one service three times: on the deployed site the list read two
 // 250s to Piccadilly Gardens and a third 250, which is one choice dressed as three. The first
 // bus of each service (operator, route, direction, destination) keeps its rank; a second bus of a
 // service already listed fills the list only where fewer services than places qualify.
 const seen=new Set<string>(),distinct:RideCandidate[]=[],rest:RideCandidate[]=[];
 for(const c of ranked){
  const service=`${c.bus.operator}|${c.bus.route}|${c.bus.direction}|${c.bus.destination}`;
  if(seen.has(service))rest.push(c);else{seen.add(service);distinct.push(c)}
 }
 return [...distinct,...rest].slice(0,limit);
}

/** How many of the reporting buses are on an accepted road at all, recent or not: the denominator. */
export function onAcceptedRoad(buses:FollowBus[],accepted:Set<string>):number{
 return buses.filter(bus=>{const m=bus.match;const id=m&&'patternId' in m?m.patternId:null;return !!id&&accepted.has(id)}).length;
}

/**
 * Whether a bus's own recent reports promise a clean ride now, judged against its checked road: a
 * ride offered to someone with no stop in mind is a showcase whether we mean it or not, and on
 * 25 September 2026 the offer list could put a bus standing at its terminus, one looping off its
 * route, or one about to finish its journey at the top. Only reports are read — the last two
 * minutes of them — never the drawing, so the same facts decide on the page and in the audit
 * (`scripts/evaluate-ride-offers.mjs`), where these bounds were measured.
 */
export const CLEAN_RIDE={windowMs:120_000,minReports:3,onRoadMetres:12,backMetres:15,minAdvanceMetres:80,
 maxGapMs:40_000,minRemainingMetres:1500};
export type RideSuitability={ok:true}|{ok:false;reason:'no_road'|'few_reports'|'off_road'|'backwards'|'not_moving'|'gaps'|'ending'};

export function rideSuitability(bus:FollowBus,track:Track|null,rules=CLEAN_RIDE):RideSuitability{
 if(!track)return {ok:false,reason:'no_road'};
 const reports=[...(bus.trail??[]),{at:bus.observedAtMs,lat:bus.lat,lon:bus.lon}]
  .filter(r=>bus.observedAtMs-r.at<=rules.windowMs).sort((a,b)=>a.at-b.at);
 if(reports.length<rules.minReports)return {ok:false,reason:'few_reports'};
 let near:number|undefined,first:number|null=null,last=0;
 for(let i=0;i<reports.length;i++){
  const p=project(track,reports[i],near);
  if(p.offset>rules.onRoadMetres)return {ok:false,reason:'off_road'};
  if(near!==undefined&&p.s<near-rules.backMetres)return {ok:false,reason:'backwards'};
  if(i>0&&reports[i].at-reports[i-1].at>rules.maxGapMs)return {ok:false,reason:'gaps'};
  first??=p.s;last=p.s;near=Math.max(near??p.s,p.s);
 }
 if(last-(first??last)<rules.minAdvanceMetres)return {ok:false,reason:'not_moving'};
 if(track.length-last<rules.minRemainingMetres)return {ok:false,reason:'ending'};
 return {ok:true};
}

const patternOf=(bus:FollowBus)=>{const m=bus.match;return m&&'patternId' in m?m.patternId:null};

/** The offer list with the clean-ride rule: only buses on a checked road whose own recent reports
 *  pass `rideSuitability`. A bus with no checked road is not offered: it is drawn on straight lines
 *  between its reports, which cut corners, and the card says it is off its road. `trackOf` answers
 *  from roads already loaded; a road not yet loaded is not a pass. */
export function cleanRideCandidates(buses:FollowBus[],accepted:Set<string>,model:MotionModel|null,
                                    trackOf:(patternId:string)=>Track|null|undefined,limit=3,rules=CLEAN_RIDE):RideCandidate[]{
 return rankDistinct(eligible(buses,accepted,model).filter(c=>{
  const id=patternOf(c.bus);
  return c.tier==='road'&&!!id&&rideSuitability(c.bus,trackOf(id)??null,rules).ok;
 }),limit);
}

/** The patterns whose roads the clean-ride rule needs, best first: those of every bus on a checked
 *  road with a recent report. */
export function roadsToJudge(buses:FollowBus[],accepted:Set<string>,model:MotionModel|null):string[]{
 return [...new Set(eligible(buses,accepted,model).filter(c=>c.tier==='road').map(c=>patternOf(c.bus)).filter((id):id is string=>!!id))];
}
