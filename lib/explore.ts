// Which buses suit a ride-along right now, from the same facts the ride uses. Three kinds are told
// apart and never rolled into one: a bus on a road the published evaluation scored the model on
// (its movement is estimated); a bus on a road accepted against that service's own reports (the
// front view is there, and it travels the road between its reports); and a bus merely placed on a
// timetable pattern with a recent report (it travels the line between its reports, outside only).
// Nothing here is a showcase: the list is whatever the latest publication supports, and empty
// when nothing does.
import type {FollowBus} from '@/lib/follow';
import type {MotionModel} from '@/lib/motion-view';

export type RideTier='estimated'|'road'|'placed';
export type RideCandidate={bus:FollowBus;tier:RideTier;estimated:boolean};

const TIER_ORDER:Record<RideTier,number>={estimated:0,road:1,placed:2};

/** What the ride will be, in the app's own words; "Front view" is what the button in the ride is called. */
export const TIER_WORDS:Record<RideTier,string>={
 estimated:'Estimated movement · Front view',
 road:'Reported positions · may pause · Front view',
 placed:'Reported positions · may pause',
};

export function rideCandidates(buses:FollowBus[],accepted:Set<string>,model:MotionModel|null,limit=3):RideCandidate[]{
 const out:RideCandidate[]=[];
 for(const bus of buses){
  const m=bus.match,id=m&&'patternId' in m?m.patternId:null;
  // An unsettled branch may be on shared road, but that is decided by geometry at the moment of
  // riding; a bus offered here is one whose ride is certain now.
  if(!id)continue;
  if(accepted.has(id)){
   if(bus.freshness!=='fresh'&&bus.freshness!=='ageing')continue;
   const estimated=model?.patterns.has(id)??false;
   out.push({bus,tier:estimated?'estimated':'road',estimated});
  }else if(bus.freshness==='fresh'){
   // A bus with no checked road still rides, between its own reports and from outside only; it is
   // offered after those with one, and only on a fresh report, because that is all it has.
   out.push({bus,tier:'placed',estimated:false});
  }
 }
 return out.sort((a,b)=>TIER_ORDER[a.tier]-TIER_ORDER[b.tier]||(a.bus.ageSeconds??999)-(b.bus.ageSeconds??999)).slice(0,limit);
}

/** How many of the reporting buses are on an accepted road at all, recent or not: the denominator. */
export function onAcceptedRoad(buses:FollowBus[],accepted:Set<string>):number{
 return buses.filter(bus=>{const m=bus.match;const id=m&&'patternId' in m?m.patternId:null;return !!id&&accepted.has(id)}).length;
}
