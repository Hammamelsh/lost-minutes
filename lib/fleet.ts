/**
 * Every bus on the map, drawn as the chosen bus is drawn: from its own reports, a bounded time
 * behind them, moving between them at a bus's pace (PLAYBACK in lib/motion.ts, one drawing for
 * every bus). Nothing here is an estimate, and nothing is stored or published: each bus is where
 * its reports put it a little before its newest report, and stands at that report until the next
 * one arrives. Until 25 September 2026 the map drew only the buses of the chosen stop or route, each
 * at its newest report, stepping to the next every poll.
 *
 * The work is bounded by what is on screen: only buses inside the map's bounds (with a margin) are
 * played back each tick; the rest stand at their newest report and start afresh when they come
 * into view. The chosen bus is left out — it has its own drawing, every frame — and a bus tapped
 * on the map hands its drawing over, so choosing it does not move it.
 */
import type {FollowBus} from '@/lib/follow';
import {drawingFor,historyFrom,observedAt,REPOSITION_METRES,stepVisual,type Estimate,type Fix,type History,
 type RepositionReason,type Track,type Visual} from '@/lib/motion';
import {historyOf,serviceOf} from '@/lib/motion-view';

export const FLEET_REASON='every bus on the map is drawn from its own reports, a little behind them';
/** The drawn bus counts as moving above this speed, m/s. */
export const FLEET_MOVING_MPS=0.2;
/** How long a repositioned bus's move stays marked on the map, ms: as long as the chosen bus's trace. */
export const FLEET_MOVED_MS=6000;

/** A bus moved to a report it could not be followed to: from where it was drawn to where it is now,
 *  and why (lib/motion.ts, RepositionReason). */
export type FleetMove={key:string;from:{lat:number;lon:number};to:{lat:number;lon:number};at:number;metres:number;
 why:RepositionReason|null};

export type FleetEntry={
 bus:FollowBus;history:History;vis:Visual|null;e:Estimate|null;
 /** The road checked for this bus's pattern: undefined until asked for, null where there is none. */
 road:Track|null|undefined;
 /** Set once the road has been asked for, so it is asked for once. */
 roadAsked:boolean;
 /** The vehicle's journey when this drawing began: another journey is another drawing. */
 journey:string;
 /** The newest report and the trail's length: a change means the history is rebuilt. */
 stamp:string;
 /** The vehicle's previous journey's reports, kept in front of this journey's while the drawing
  *  crosses from one to the other (reconcileFleet); empty otherwise. */
 carried:Fix[];
 /** Its latest repositioning, marked on the map for FLEET_MOVED_MS. */
 moved:FleetMove|null;
};
export type Fleet=Map<string,FleetEntry>;

const journeyOf=(bus:FollowBus)=>`${bus.route}|${bus.direction}|${bus.journeyRef}`;
const stampOf=(bus:FollowBus)=>`${bus.observedAtMs}:${bus.trail?.length??0}`;

/** This journey's history, with the vehicle's previous journey's reports in front of it while they
 *  are still needed: one vehicle's consecutive reports, played by the rules any two reports are —
 *  travelled between where they can be, a repositioning where they cannot. They are labelled as this
 *  journey's only so that the drawing reads one run of reports; nothing here is stored or published.
 *  All of them, not the newest alone: a bus drawn still short of its last report, as it is for a
 *  smoothing window, lay off a path that began there, and was eased 26 m across to it. */
function historyWith(bus:FollowBus,carried:Fix[]):History{
 const own=historyOf(bus);
 if(!own.fixes.length)return own;
 const before=carried.filter(f=>f.at<own.fixes[0].at);
 if(!before.length)return own;
 const service=serviceOf(bus);
 return historyFrom([...before.map(f=>({...f,service})),...own.fixes]);
}

/** The drawing has reached the new journey's own reports, or is no longer being drawn: the carried
 *  reports have done their work. */
function crossed(entry:FleetEntry):boolean{
 const last=entry.carried[entry.carried.length-1];
 if(!last||!entry.vis)return true;
 const first=entry.history.fixes.find(f=>f.at>last.at);
 const at=entry.vis.buffer?.represented;
 return first!==undefined&&at!==undefined&&at>=first.at;
}

/** The fleet after a publication: a bus still published keeps its drawing (its history rebuilt where
 *  its reports changed); a bus no longer published goes.
 *
 *  A vehicle on another journey keeps its drawing too, while it is being drawn. Until 26 September
 *  2026 it was given a new one, which began at its new report: at the Piccadilly terminus two 192s
 *  starting their next journeys stepped 54 m and 108 m in one frame with nothing between and nothing
 *  said (tests/fleet-journey-change.test.mjs, from the server's own captures). Now its previous
 *  journey's reports stay in front of the new journey's until the drawing has crossed to them, so
 *  the move between the two journeys is judged as any two reports are: travelled at the
 *  bus's own pace where they allow it (41 s and 54 m apart), and a repositioning where they do not
 *  (seven minutes unseen), which the map marks. */
export function reconcileFleet(fleet:Fleet,buses:FollowBus[]):Fleet{
 const next:Fleet=new Map();
 for(const bus of buses){
  const previous=fleet.get(bus.key),journey=journeyOf(bus),stamp=stampOf(bus);
  if(previous&&previous.journey===journey){
   if(previous.stamp!==stamp){
    if(previous.carried.length&&crossed(previous))previous.carried=[];
    previous.history=historyWith(bus,previous.carried);previous.stamp=stamp;
   }
   previous.bus=bus;
   next.set(bus.key,previous);
  }else if(previous?.vis){
   // A new entry, so that a road still being fetched for the old journey's pattern lands on the old one.
   const carried=previous.history.fixes;
   next.set(bus.key,{bus,history:historyWith(bus,carried),vis:previous.vis,e:previous.e,road:undefined,roadAsked:false,
    journey,stamp,carried,moved:previous.moved});
  }else next.set(bus.key,{bus,history:historyOf(bus),vis:null,e:null,road:undefined,roadAsked:false,journey,stamp,
   carried:[],moved:null});
 }
 return next;
}

export type FleetTier='relevant'|'other';
export type FleetFeature={type:'Feature';geometry:{type:'Point';coordinates:[number,number]};
 properties:{key:string;route:string;selected:0;tier:FleetTier;sort:number;icon:string;rotate:number;
  /** 1 where a 3D model stands in for the flat marker this tick. */
  model:0|1}};
export type FleetStep={
 features:FleetFeature[];
 total:number;inView:number;moving:number;
 /** Buses repositioned in the last FLEET_MOVED_MS: each move, for the map to mark. */
 moved:FleetMove[];
 /** Buses in view drawn with a heading, nearest the centre first: the ones a 3D model is built for. */
 modelled:{key:string;lat:number;lon:number;bearing:number}[];
};

export type FleetOptions={
 /** The chosen bus, drawn elsewhere. */
 selectedKey:string|null;
 /** The buses of the passenger's stop or route, drawn a little stronger than the rest. */
 relevant:Set<string>;
 /** Inside the map's bounds (with a margin): played back this tick. */
 inView:(lat:number,lon:number)=>boolean;
 /** False under reduced motion: every bus stands at its newest report. */
 animate:boolean;
 /** Where 3D models are wanted (the map's zoom allows them): the centre they are ranked from, and
  *  how many at most. */
 models:{centre:{lat:number;lon:number};limit:number}|null;
};

const metres=(a:{lat:number;lon:number},b:{lat:number;lon:number})=>
 Math.hypot((b.lat-a.lat)*111195,(b.lon-a.lon)*111195*Math.cos(a.lat*Math.PI/180));

/** One tick of the fleet's drawing at presentation time `now`. */
export function stepFleet(fleet:Fleet,now:number,options:FleetOptions):FleetStep{
 const features:FleetFeature[]=[];
 const candidates:{key:string;lat:number;lon:number;bearing:number;d:number}[]=[];
 const moved:FleetMove[]=[];
 let inView=0,moving=0,total=0;
 for(const entry of fleet.values()){
  const {bus}=entry;
  if(bus.key===options.selectedKey)continue;
  total+=1;
  // Judged by where it is drawn, so a bus drawn just inside the edge keeps moving out of it.
  const drawnAt=entry.vis??bus;
  let lat=bus.lat,lon=bus.lon,bearing:number|null=bus.bearing;
  if(options.animate&&options.inView(drawnAt.lat,drawnAt.lon)){
   inView+=1;
   const before=entry.vis;
   const e=observedAt(entry.history,now,FLEET_REASON);
   const v=stepVisual(entry.vis,e,now,null,drawingFor(e,null),entry.history,entry.road??null);
   entry.vis=v;entry.e=e;
   lat=v.lat;lon=v.lon;bearing=v.bearing;
   if(v.velocity>FLEET_MOVING_MPS)moving+=1;
   // Moved to a report it could not be followed to: the chosen bus is told so on its card; any other
   // bus has the move marked on the map, so that a cut is never mistaken for the bus's own movement.
   const c=v.lastCorrection;
   if(before&&c?.kind==='snap'&&c.at===now&&c.metres>=REPOSITION_METRES)
    entry.moved={key:bus.key,from:{lat:before.lat,lon:before.lon},to:{lat:v.lat,lon:v.lon},at:now,metres:c.metres,why:c.why??null};
  }else{entry.vis=null;entry.e=null;entry.moved=null}
  if(entry.moved&&now-entry.moved.at<FLEET_MOVED_MS)moved.push(entry.moved);
  else entry.moved=null;
  const stale=bus.freshness==='stale';
  const tier:FleetTier=options.relevant.has(bus.key)?'relevant':'other';
  let model:0|1=0;
  if(options.models&&bearing!==null&&!stale&&options.inView(lat,lon)){
   candidates.push({key:bus.key,lat,lon,bearing,d:metres(options.models.centre,{lat,lon})});
   model=1;
  }
  features.push({type:'Feature',geometry:{type:'Point',coordinates:[lon,lat]},
   properties:{key:bus.key,route:bus.route,selected:0,tier,sort:stale?0:tier==='relevant'?2:1,
    icon:`lm-${stale?'stale':tier==='relevant'?'bus':'fleet'}-${bearing!==null?'arrow':'dot'}`,
    rotate:bearing??0,model}});
 }
 candidates.sort((a,b)=>a.d-b.d);
 const modelled=options.models?candidates.slice(0,options.models.limit):[];
 // Only the buses that got a model lose their flat marker; the rest keep it, whatever the zoom.
 if(options.models){
  const kept=new Set(modelled.map(m=>m.key));
  for(const f of features)if(f.properties.model===1&&!kept.has(f.properties.key))f.properties.model=0;
 }
 return {features,total,inView,moving,moved,modelled:modelled.map(({key,lat,lon,bearing})=>({key,lat,lon,bearing}))};
}

/** Every bus at its newest report, with no playback: the first frame, and reduced motion. */
export function fleetAtReports(fleet:Fleet,options:Pick<FleetOptions,'selectedKey'|'relevant'>):FleetStep{
 return stepFleet(fleet,0,{...options,inView:()=>false,animate:false,models:null});
}
