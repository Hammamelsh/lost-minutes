"use client";

import {useCallback,useMemo,useRef,useState} from 'react';
import {Crosshair,Minus,Plus} from 'lucide-react';
import {Bounds,boundsOf,fitProjection} from '@/lib/geo';
import type {Stop} from '@/lib/stops';
import {FeedMode} from '@/lib/live';
import type {FollowBus} from '@/lib/follow';
import {RoadMap} from '@/lib/replay';

const W=760,H=760;
const MIN_SPAN=0.0025,MAX_SPAN=0.35;

// Fixed reference points, for orientation only. Not stops, and never used in a measurement.
const PLACES:[string,number,number][]=[
 ['CITY CENTRE',-2.2410,53.4808],['HULME',-2.2490,53.4650],['RUSHOLME',-2.2240,53.4550],
 ['FALLOWFIELD',-2.2200,53.4410],['DIDSBURY',-2.2310,53.4180],['OLD TRAFFORD',-2.2830,53.4620],
 ['SALFORD',-2.2900,53.4830],['CHORLTON',-2.2720,53.4430],['ANCOATS',-2.2200,53.4840],
 ['LEVENSHULME',-2.1930,53.4430],['MOSS SIDE',-2.2480,53.4530],['TRAFFORD PARK',-2.3200,53.4680],
];

type View={cx:number;cy:number;span:number};

const spanOf=(b:Bounds)=>Math.max(b.north-b.south,(b.east-b.west)*0.6);
const centreOf=(b:Bounds)=>({cx:(b.west+b.east)/2,cy:(b.south+b.north)/2});

export default function FollowMap({buses,selected,follow,roads,onSelect,onManualMove,mode,stop}:{
 buses:FollowBus[];selected?:FollowBus;follow:boolean;roads:RoadMap|null;
 onSelect:(key:string)=>void;onManualMove:()=>void;mode:FeedMode;stop?:Stop|null}){
 // null means "fit automatically". Any manual pan or zoom takes over, and says so.
 const [view,setView]=useState<View|null>(null);
 const drag=useRef<{x:number;y:number;cx:number;cy:number}|null>(null);
 const [dragging,setDragging]=useState(false);
 const svgRef=useRef<SVGSVGElement>(null);

 const auto=useMemo<View>(()=>{
  if(follow&&selected)return {cx:selected.lon,cy:selected.lat,span:0.012};
  // Fit what the passenger is actually looking at: their stop and the buses on screen.
  const points=[...buses,...(stop?[{lat:stop.lat,lon:stop.lon}]:[])];
  const bounds=boundsOf(points.length?points:[{lat:53.4808,lon:-2.2426}],0.2);
  return bounds?{...centreOf(bounds),span:Math.min(MAX_SPAN,Math.max(MIN_SPAN,spanOf(bounds)))}
               :{cx:-2.2426,cy:53.4808,span:0.06};
 },[buses,selected,follow,stop]);

 const active=view??auto;
 const projector=useMemo(()=>{
  const half=active.span/2,halfX=half/0.6;
  return fitProjection({west:active.cx-halfX,east:active.cx+halfX,
                        south:active.cy-half,north:active.cy+half},W,H);
 },[active]);

 const nudge=useCallback((next:View)=>{
  setView({...next,span:Math.min(MAX_SPAN,Math.max(MIN_SPAN,next.span))});
  onManualMove();
 },[onManualMove]);

 const scale=useMemo(()=>{
  const [x0,y0]=projector.project(active.cx,active.cy);
  const [x1,y1]=projector.project(active.cx+0.01,active.cy+0.01);
  return {x:(x1-x0)/0.01,y:(y0-y1)/0.01};
 },[projector,active]);

 function down(event:React.PointerEvent<SVGSVGElement>){
  if(event.button!==0&&event.pointerType==='mouse')return;
  const rect=svgRef.current?.getBoundingClientRect();
  if(!rect)return;
  drag.current={x:event.clientX,y:event.clientY,cx:active.cx,cy:active.cy};
  setDragging(true);
  (event.target as Element).setPointerCapture?.(event.pointerId);
 }
 function move(event:React.PointerEvent<SVGSVGElement>){
  const start=drag.current;
  const rect=svgRef.current?.getBoundingClientRect();
  if(!start||!rect)return;
  const perPixelX=(W/rect.width)/scale.x,perPixelY=(H/rect.height)/scale.y;
  const dx=(event.clientX-start.x)*perPixelX,dy=(event.clientY-start.y)*perPixelY;
  if(Math.abs(event.clientX-start.x)+Math.abs(event.clientY-start.y)<4)return;
  nudge({cx:start.cx-dx,cy:start.cy+dy,span:active.span});
 }
 const up=()=>{drag.current=null;setDragging(false)};

 const roadPaths=useMemo(()=>{
  if(!roads)return null;
  const {west,east,south,north}=projector.bounds;
  const pad=(east-west)*0.3;
  return roads.roads.map((road,i)=>{
   if(!road.points.some(([lon,lat])=>lon>=west-pad&&lon<=east+pad&&lat>=south-pad&&lat<=north+pad))return null;
   return <polyline key={i} points={road.points.map(([lon,lat])=>projector.project(lon,lat).join(',')).join(' ')}
    fill="none" stroke={road.kind==='motorway'?'#4a6676':'#324a59'}
    strokeWidth={road.kind==='motorway'?4:road.kind==='primary'?2.8:1.5}
    strokeLinecap="round" strokeLinejoin="round"/>;
  });
 },[projector,roads]);

 const {west,east,south,north}=projector.bounds;
 const insetX=(east-west)*0.1,insetY=(north-south)*0.08;

 return <div className="follow-map">
  <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className={dragging?'dragging':''}
   onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
   role="img" aria-label={`Map of ${buses.length} last reported bus positions. Drag to explore.`}>
   <defs><pattern id="follow-grid" width="72" height="72" patternUnits="userSpaceOnUse">
    <path d="M72 0H0V72" fill="none" stroke="#1d3140" strokeWidth=".6"/></pattern></defs>
   <rect width={W} height={H} fill="url(#follow-grid)"/>
   {roadPaths}
   {PLACES.filter(([,lon,lat])=>lon>=west+insetX&&lon<=east-insetX
     &&lat>=south+insetY&&lat<=north-insetY).map(([label,lon,lat])=>{
    const [x,y]=projector.project(lon,lat);
    return <text key={label} x={x} y={y} textAnchor="middle" className="place-label">{label}</text>;
   })}
   {stop&&(()=>{
    const [x,y]=projector.project(stop.lon,stop.lat);
    return <g className="stop-marker" aria-label={`Your stop: ${stop.name}`}>
     <circle cx={x} cy={y} r={15} className="stop-marker-ring"/>
     <path d={`M${x} ${y-16} l7 11 h-14 z`} className="stop-marker-flag"/>
     <circle cx={x} cy={y} r={5} className="stop-marker-dot"/>
    </g>;
   })()}
   {buses.map(bus=>{
    const [x,y]=projector.project(bus.lon,bus.lat);
    if(x<-40||x>W+40||y<-40||y>H+40)return null;
    const on=bus.key===selected?.key;
    const faded=bus.freshness==='stale';
    return <g key={bus.key} className={`bus-marker${on?' on':''}`} tabIndex={0} role="button"
      aria-label={`Route ${bus.route} to ${bus.destination||'unknown destination'}, ${bus.ageWords}`}
      onClick={()=>onSelect(bus.key)}
      onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelect(bus.key)}}}>
     {on&&<circle cx={x} cy={y} r={22} className="bus-halo"/>}
     <circle cx={x} cy={y} r={on?13:7} fill={on?'#c6f36a':faded?'#6f8896':'#8fd0e4'}
      stroke={on?'#f4ffe4':'#0d1b26'} strokeWidth={on?3:2}/>
     {on&&<text x={x} y={y+5} textAnchor="middle" className="bus-marker-route">{bus.route}</text>}
    </g>;
   })}
  </svg>

  <div className="map-tools">
   <button onClick={()=>nudge({...active,span:active.span/1.6})} aria-label="Zoom in"><Plus size={18}/></button>
   <button onClick={()=>nudge({...active,span:active.span*1.6})} aria-label="Zoom out"><Minus size={18}/></button>
   <button onClick={()=>setView(null)} aria-label="Fit the map to the buses on this route"
    className={view?'active':''}><Crosshair size={17}/></button>
  </div>

  <div className="follow-map-foot">
   <span className={`mode-dot ${mode}`}/>
   <span>{view?'Your view · tap the target to refit':'Last reported positions · not continuous tracking'}</span>
  </div>
 </div>;
}
