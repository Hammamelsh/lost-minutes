// Which buses a newcomer could explore with the front view right now, from the same facts the
// ride uses: a recent report, placed on one pattern, that pattern's road accepted against its own
// reports. Where the published evaluation also scored the model on that pattern the ride is an
// estimate; otherwise the bus travels between its own reports. Nothing here is a showcase: the
// list is whatever the latest publication supports, and empty when nothing does.
import type {FollowBus} from './follow';
import type {MotionModel} from './motion-view';

export type ExploreCandidate={bus:FollowBus;estimated:boolean};

export function exploreCandidates(buses:FollowBus[],accepted:Set<string>,model:MotionModel|null,limit=3):ExploreCandidate[]{
 const out:ExploreCandidate[]=[];
 for(const bus of buses){
  if(bus.freshness!=='fresh'&&bus.freshness!=='ageing')continue;
  const m=bus.match,id=m&&'patternId' in m?m.patternId:null;
  // An unsettled branch may be on shared road, but that is decided by geometry at the moment of
  // riding; a bus offered for exploration is one whose front view is certain now.
  if(!id||!accepted.has(id))continue;
  out.push({bus,estimated:model?.patterns.has(id)??false});
 }
 return out.sort((a,b)=>Number(b.estimated)-Number(a.estimated)||(a.bus.ageSeconds??999)-(b.bus.ageSeconds??999)).slice(0,limit);
}

/** How many of the reporting buses are on an accepted road at all, recent or not: the denominator. */
export function onAcceptedRoad(buses:FollowBus[],accepted:Set<string>):number{
 return buses.filter(bus=>{const m=bus.match;const id=m&&'patternId' in m?m.patternId:null;return !!id&&accepted.has(id)}).length;
}
