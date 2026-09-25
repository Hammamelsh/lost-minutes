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
import {drawingFor,observedAt,stepVisual,type Estimate,type History,type Track,type Visual} from '@/lib/motion';
import {historyOf} from '@/lib/motion-view';

export const FLEET_REASON='every bus on the map is drawn from its own reports, a little behind them';
/** The drawn bus counts as moving above this speed, m/s. */
export const FLEET_MOVING_MPS=0.2;

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
};
export type Fleet=Map<string,FleetEntry>;

const journeyOf=(bus:FollowBus)=>`${bus.route}|${bus.direction}|${bus.journeyRef}`;
const stampOf=(bus:FollowBus)=>`${bus.observedAtMs}:${bus.trail?.length??0}`;

/** The fleet after a publication: a bus still published keeps its drawing (its history rebuilt where
 *  its reports changed); a vehicle on another journey starts afresh; a bus no longer published goes. */
export function reconcileFleet(fleet:Fleet,buses:FollowBus[]):Fleet{
 const next:Fleet=new Map();
 for(const bus of buses){
  const previous=fleet.get(bus.key),journey=journeyOf(bus),stamp=stampOf(bus);
  if(previous&&previous.journey===journey){
   if(previous.stamp!==stamp){previous.history=historyOf(bus);previous.stamp=stamp}
   previous.bus=bus;
   next.set(bus.key,previous);
  }else next.set(bus.key,{bus,history:historyOf(bus),vis:null,e:null,road:undefined,roadAsked:false,journey,stamp});
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
   const e=observedAt(entry.history,now,FLEET_REASON);
   const v=stepVisual(entry.vis,e,now,null,drawingFor(e,null),entry.history,entry.road??null);
   entry.vis=v;entry.e=e;
   lat=v.lat;lon=v.lon;bearing=v.bearing;
   if(v.velocity>FLEET_MOVING_MPS)moving+=1;
  }else{entry.vis=null;entry.e=null}
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
 return {features,total,inView,moving,modelled:modelled.map(({key,lat,lon,bearing})=>({key,lat,lon,bearing}))};
}

/** Every bus at its newest report, with no playback: the first frame, and reduced motion. */
export function fleetAtReports(fleet:Fleet,options:Pick<FleetOptions,'selectedKey'|'relevant'>):FleetStep{
 return stepFleet(fleet,0,{...options,inView:()=>false,animate:false,models:null});
}
