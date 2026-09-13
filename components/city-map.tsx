"use client";

import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import type {ReactNode} from 'react';
import {Crosshair,Eye,LocateFixed,Minus,Moon,Plus,Scan,SkipForward,Sun,X} from 'lucide-react';
import {BASEMAP_CREDITS,MAPLIBRE_MODULE_URL,prefersReducedMotion,webglAvailable} from '@/lib/basemap';
import {applyTheme,buildingExtrusion,buildStyle,type MapTheme} from '@/lib/map-style';
import {MODEL_URL,orientedBus,parseBusModel,unorientedToken,type BusModel} from '@/lib/bus-model';
import {accuracyRing} from '@/lib/geo';
import {BUS_SOURCE,HERE_SOURCE,HIDE_SELECTED_WHEN_MODEL,MODEL_SOURCE,OVERLAY,OVERLAY_SOURCES,
        overlayLayers,SELECTED_SOURCE,SHOW_RING_WHEN_MODEL,STOP_SOURCE,TRAIL_SOURCE,WALK_SOURCE} from '@/lib/map-overlay';
import {journeyFocus} from '@/lib/journey';
import {DEFAULT_PARAMS,estimate,needsFrames,observedAt,project,slice,stepVisual,tickClock,type PresentationClock,uncertaintyAt,
        type ErrorProfile,type Estimate,type History,type LonLat,type MotionParams,type Track,
        type Visual} from '@/lib/motion';
import {historyOf,loadMotionModel,loadTrack,type MotionInfo,type MotionModel,type TrackResult} from '@/lib/motion-view';
import type * as MapLibreGL from 'maplibre-gl';
import type {GeoJSONSource,Map as MapLibreMap,MapMouseEvent} from 'maplibre-gl';
import type {FollowBus} from '@/lib/follow';
import type {Stop} from '@/lib/stops';

export type Here = {lat:number;lon:number;accuracyMetres?:number};
/** 2D is the practical default: north up, flat. City tilts it and raises the buildings. The
 *  ride-along follows one bus from above and behind. */
export type MapView = '2d'|'city'|'ride';

type Props = {
 buses:FollowBus[];selected?:FollowBus;stop?:Stop|null;here?:Here|null;
 follow:boolean;onSelect:(key:string)=>void;onManualMove:()=>void;onUnavailable:()=>void;
 view:MapView;onViewChange:(view:MapView)=>void;
 theme:MapTheme;onThemeChange:(theme:MapTheme)=>void;
 /** Incremented by the parent when the passenger asks for something new (a stop, a service, a
  *  bus from the list), so the camera goes to it without a further tap. */
 fitRequest?:number;
 onLocate?:()=>void;locating?:boolean;
 /** The route badge, report age and stop progress, shown over the map during a ride-along. */
 rideOverlay?:ReactNode;
 /** "Your bus" for one coming to your stop; "Selected bus" for one you are only looking at. */
 busLabel?:string;
 /** A walking route from a pedestrian router, from you to your stop. */
 walk?:{path:[number,number][];from:{lat:number;lon:number};to:{lat:number;lon:number}}|null;
 /** The server's clock minus this device's, so estimates run on the clock report ages use. */
 clockOffsetMs?:number;
 /** Whether movement may be estimated at all, and if not, why. */
 motion?:{enabled:boolean;reason?:string|null};
 /** Coarse news of the estimate, for the page's words: mode, reason, age and corrections. */
 onMotion?:(info:MotionInfo|null)=>void;
 /** The ride-along's camera state, so the card can say the same thing as the map. */
 onRideState?:(state:RideState)=>void;
};

const EMPTY={type:'FeatureCollection' as const,features:[]};
/** The ride-along's framing: close enough that the 12 m bus reads as a bus (about 135 px long,
 *  seen flat, at Manchester's latitude). Set when the ride starts and by "Return to bus"; the
 *  passenger's own zoom and tilt are kept through ordinary updates. */
const RIDE_ZOOM=20;
// The tilt and heading each everyday view returns to, including on leaving the ride-along.
const VIEW_CAMERA={'2d':{pitch:0,bearing:0},city:{pitch:58,bearing:-17}};
// While following, the camera is re-centred on the drawn bus every frame; after a gesture or
// an animated zoom has moved it further than this (px), it glides back rather than jumping.
const SETTLE_PX=40;

/**
 * The ride-along's camera, one state at a time, so the map and the card can say the same thing:
 *   entering    the optional introduction (you, your stop, then the bus), or the first framing
 *   following   the camera is on the drawn bus every frame
 *   exploring   the passenger moved the map; the bus goes on without the camera
 *   returning   "Return to bus" or "Skip": gliding back to the ride framing, then following
 * A gesture during a transition ends it; a transition made obsolete (another bus chosen, the
 * ride left) is cancelled by its token before it can finish.
 */
export type RideState='off'|'entering'|'following'|'exploring'|'returning';
export const RIDE_WORDS:Record<RideState,string>={off:'',entering:'entering',following:'following the bus',
 exploring:'exploring the map',returning:'returning to the bus'};

/** A marker drawn once to a canvas: a disc, with a nose when it has a direction. The nose is
 *  drawn pointing north and turned by MapLibre to the bearing. */
function marker({fill,stroke,outline,radius,nose}:{fill:string;stroke:string;outline:string;
 radius:number;nose:boolean}):ImageData{
 const ratio=2,tip=nose?radius*0.95:0,half=radius+tip+4,size=Math.ceil(half*2);
 const canvas=document.createElement('canvas');
 canvas.width=size*ratio;canvas.height=size*ratio;
 const g=canvas.getContext('2d')!;
 g.scale(ratio,ratio);g.translate(size/2,size/2);
 const shape=()=>{
  g.beginPath();
  if(nose){
   const a=Math.PI/180;
   g.moveTo(0,-(radius+tip));
   g.lineTo(radius*Math.sin(38*a),-radius*Math.cos(38*a));
   g.arc(0,0,radius,-Math.PI/2+38*a,3*Math.PI/2-38*a,false);
   g.closePath();
  }else g.arc(0,0,radius,0,2*Math.PI);
 };
 shape();g.lineJoin='round';g.lineWidth=5;g.strokeStyle=outline;g.stroke();
 shape();g.fillStyle=fill;g.fill();
 shape();g.lineWidth=2;g.strokeStyle=stroke;g.stroke();
 return g.getImageData(0,0,size*ratio,size*ratio);
}

/** A hollow ring, drawn for zoom 20 and scaled down with the ground below it: it encircles the
 *  drawn bus (about 8 m radius) so the bus is found even when a building hides the model. */
function ring({stroke,outline,radius}:{stroke:string;outline:string;radius:number}):ImageData{
 const ratio=2,size=Math.ceil(radius*2+16);
 const canvas=document.createElement('canvas');
 canvas.width=size*ratio;canvas.height=size*ratio;
 const g=canvas.getContext('2d')!;
 g.scale(ratio,ratio);g.translate(size/2,size/2);
 g.beginPath();g.arc(0,0,radius,0,2*Math.PI);
 g.lineWidth=11;g.strokeStyle=outline;g.globalAlpha=0.55;g.stroke();
 g.globalAlpha=1;g.lineWidth=6;g.strokeStyle=stroke;g.stroke();
 g.beginPath();g.arc(0,0,radius,0,2*Math.PI);g.fillStyle=stroke;g.globalAlpha=0.12;g.fill();
 return g.getImageData(0,0,size*ratio,size*ratio);
}

function markerImages(theme:MapTheme){
 const o=OVERLAY[theme];
 return {
  'lm-sel-arrow':marker({fill:'#c6f36a',stroke:'#f4ffe4',outline:o.ink,radius:13,nose:true}),
  'lm-sel-dot':marker({fill:'#c6f36a',stroke:'#f4ffe4',outline:o.ink,radius:13,nose:false}),
  'lm-sel-ring':ring({stroke:'#c6f36a',outline:o.ink,radius:92}),
  'lm-bus-arrow':marker({fill:o.other,stroke:o.otherStroke,outline:o.otherStroke,radius:6.5,nose:true}),
  'lm-bus-dot':marker({fill:o.other,stroke:o.otherStroke,outline:o.otherStroke,radius:6.5,nose:false}),
  'lm-stale-arrow':marker({fill:o.stale,stroke:o.staleStroke,outline:o.staleStroke,radius:6,nose:true}),
  'lm-stale-dot':marker({fill:o.stale,stroke:o.staleStroke,outline:o.staleStroke,radius:6,nose:false}),
  'lm-here-dot':marker({fill:'#5aa9e6',stroke:'#eaf4f8',outline:o.ink,radius:7.5,nose:false}),
  'lm-stop-dot':marker({fill:'#ffd9a5',stroke:'#1b2b33',outline:'#1b2b33',radius:5,nose:false}),
 };
}

const HALO_LAYERS=['lm-stop-label','lm-here-label','lm-bus-label','lm-sel-caption'] as const;

function addOverlay(instance:MapLibreMap,theme:MapTheme){
 for(const [id,image] of Object.entries(markerImages(theme)))instance.addImage(id,image,{pixelRatio:2});
 for(const id of OVERLAY_SOURCES)instance.addSource(id,{type:'geojson',data:EMPTY});
 for(const layer of overlayLayers(theme))instance.addLayer(layer as never);
}

function restyleOverlay(instance:MapLibreMap,theme:MapTheme){
 const o=OVERLAY[theme];
 for(const [id,image] of Object.entries(markerImages(theme)))if(instance.hasImage(id))instance.updateImage(id,image);
 for(const id of HALO_LAYERS)if(instance.getLayer(id))instance.setPaintProperty(id,'text-halo-color',o.halo);
 if(instance.getLayer('lm-walk-casing'))instance.setPaintProperty('lm-walk-casing','line-color',o.halo);
 instance.setPaintProperty('lm-stop-ring','circle-stroke-color',o.stopRing);
 instance.setPaintProperty('lm-stop-label','text-color',o.stopLabel);
 instance.setPaintProperty('lm-here-label','text-color',o.hereLabel);
 instance.setPaintProperty('lm-bus-label','text-color',o.busLabel);
 instance.setPaintProperty('lm-sel-caption','text-color',o.busLabel);
 instance.setPaintProperty('lm-trail-estimate','line-color',o.ink);
 instance.setPaintProperty('lm-trail-report','circle-stroke-color',o.ink);
}

/**
 * Camera padding that keeps the ridden bus in the clear band between the ride-along's notes
 * at the top and its progress card at the bottom, whatever their size on this screen.
 */
function ridePadding(canvas:HTMLElement){
 const box=canvas.getBoundingClientRect();
 const hud=canvas.closest('.vector-map')?.querySelector('.ride-hud');
 const edge=(selector:string,side:'top'|'bottom')=>{
  const found=hud?.querySelector(selector)?.getBoundingClientRect();
  return found?found[side]-box.top:null;
 };
 const top=Math.max(0,...['.ride-exit','.ride-notes'].map(s=>edge(s,'bottom')??0));
 const cardTop=edge('.ride-card','top');
 const bottom=cardTop===null?0:Math.max(0,box.height-cardTop);
 if(box.height-top-bottom<90)return {top:Math.round(box.height*0.1),bottom:0,left:0,right:0};
 return {top:Math.round(top+8),bottom:Math.round(bottom+8),left:0,right:0};
}

/** Resolve when a camera move ends, or a little after it should have. */
function glide(instance:MapLibreMap,options:Record<string,unknown>&{duration:number}){
 return new Promise<void>(resolve=>{
  const done=()=>{clearTimeout(timer);instance.off('moveend',done);resolve()};
  const timer=setTimeout(done,options.duration+700);
  instance.on('moveend',done);
  instance.easeTo(options as never);
 });
}

/**
 * Glide to a framing centred on the bus without losing it on the way. One ease that zooms in
 * and moves the centre together swings an off-centre point outwards before it lands (to about
 * three times its offset over six zoom levels), off a phone's screen. So the bus is brought to
 * the middle first, at the zoom already shown, and the zoom, tilt and turn then happen around
 * it. False if something else took the camera in between.
 */
async function approach(instance:MapLibreMap,target:()=>Record<string,unknown>&{center:[number,number]},
 duration:number,still:()=>boolean){
 const middle=instance.project(instance.getCenter()),bus=instance.project(target().center);
 const off=Math.hypot(bus.x-middle.x,bus.y-middle.y);
 if(off>24){
  await glide(instance,{center:target().center,duration:Math.round(Math.min(600,Math.max(250,off*0.8)))});
  if(!still())return false;
 }
 await glide(instance,{...target(),duration});
 return still();
}

const lineFeature=(coordinates:LonLat[],kind:string)=>({type:'Feature' as const,
 geometry:{type:'LineString' as const,coordinates},properties:{kind}});

/** Diagnostic, not a feature: the drawn state as text, so the browser suite can check that it
 *  moves continuously, keeps its zoom, turns the short way and falls back when it should. */
function diagnostics(el:HTMLElement|null,e:Estimate|null,v:Visual|null,frames=0,wall=0,screen:{x:number;y:number}|null=null){
 if(!el)return;
 // Frames drawn so far: it stops rising when nothing moves, which is the point.
 el.setAttribute('data-frames',String(frames));
 el.setAttribute('data-motion',e?e.mode:'none');
 el.setAttribute('data-motion-reason',e?.reason??'');
 el.setAttribute('data-report-age',e?e.reportAge.toFixed(1):'');
 // lat, lon, metres along the road, heading, and that frame's presentation and real (page) times.
 el.setAttribute('data-display',v?`${v.lat.toFixed(6)},${v.lon.toFixed(6)},${v.s===null?'':v.s.toFixed(1)},`
  +`${v.bearing===null?'':v.bearing.toFixed(1)},${Math.round(v.frame)},${Math.round(wall)}`:'');
 el.setAttribute('data-correction',v?.lastCorrection
  ?`${v.lastCorrection.kind}:${Math.round(v.lastCorrection.metres)}:${Math.round(v.lastCorrection.at)}`:'none');
 // Where the drawn bus is on the canvas, in CSS pixels from its top-left corner.
 el.setAttribute('data-bus-screen',screen?`${Math.round(screen.x)},${Math.round(screen.y)}`:'');
}

function motionInfo(e:Estimate,v:Visual,profile:ErrorProfile|null,params:MotionParams,now:number):MotionInfo{
 const band=e.mode==='estimated'?uncertaintyAt(profile,e.reportAge):null;
 // A correction is mentioned while it is recent, not for as long as the bus stays selected.
 const last=v.lastCorrection&&now-v.lastCorrection.at<=30_000?v.lastCorrection:null;
 return {mode:e.mode,reason:e.reason,reportAge:Math.round(e.reportAge),capped:e.capped,horizon:params.horizon,
  speedKmh:e.mode==='estimated'&&e.speed!==null?Math.round(e.speed*3.6):null,
  eased:e.mode==='estimated'&&(e.speed??0)>0&&params.decay>0,
  uncertaintyMetres:band?.metres??null,uncertaintyN:band?.n??null,
  correction:last?{kind:last.kind,metres:last.metres,at:last.at}:null,
  version:params.version};
}

// While these are the reason, the bus is shown at its report only until they load.
const CHECKING='checking whether its movement can be estimated',LOADING='loading its road geometry';

type Inputs={ready:boolean;selected?:FollowBus;history:History|null;track:Track|null;blocked:string|null;provisional:boolean;
 params:MotionParams;profile:ErrorProfile|null;clockOffsetMs:number;view:MapView;follow:boolean;
 model:BusModel|null;modelShown:boolean;here?:Here|null;stop?:Stop|null;walk:Props['walk'];
 onMotion?:(info:MotionInfo|null)=>void};

/** The ride-along's camera state, kept in a ref for the frame loop and mirrored to React. */
type Ride={state:RideState;intro:boolean;introSeen:boolean;transition:number;
 pointer:{down:boolean;moved:boolean};settling:boolean};

/**
 * The map. Reports are drawn where they were made. The chosen bus may also be drawn at a
 * clearly labelled estimate between reports, which moves only along accepted road geometry,
 * is corrected smoothly as each report arrives, and is never stored or treated as a report.
 */
export default function CityMap({buses,selected,stop,here,follow,onSelect,onManualMove,
                                 onUnavailable,view,onViewChange,theme,onThemeChange,fitRequest=0,
                                 onLocate,locating,rideOverlay,busLabel='Your bus',walk=null,
                                 clockOffsetMs=0,motion,onMotion,onRideState}:Props){
 const root=useRef<HTMLDivElement>(null);
 const container=useRef<HTMLDivElement>(null);
 const map=useRef<MapLibreMap|null>(null);
 const [ready,setReady]=useState(false);
 const [painted,setPainted]=useState(false);
 const [model,setModel]=useState<BusModel|null>(null);
 const [modelFailed,setModelFailed]=useState(false);
 const [track,setTrack]=useState<(TrackResult&{patternId:string})|null>(null);
 const [motionModel,setMotionModel]=useState<MotionModel|null|undefined>(undefined);
 const [rideState,setRideState]=useState<RideState>('off');
 // Once the passenger drags, pinches or zooms, the view is theirs until they ask again.
 const userMoved=useRef(false);
 // The theme the map is created in; later changes are applied in place, never by rebuilding.
 const themeRef=useRef(theme);
 const modelRequested=useRef(false);
 const viewRef=useRef(view);
 const visualRef=useRef<Visual|null>(null);
 const estimateRef=useRef<Estimate|null>(null);
 const ride=useRef<Ride>({state:'off',intro:false,introSeen:false,transition:0,pointer:{down:false,moved:false},settling:false});
 const wasRiding=useRef(false);
 // The bus being ridden, so a change of bus mid-ride re-frames rather than being mistaken for a move.
 const rideKey=useRef('');
 const returnRef=useRef<(fast?:boolean)=>void>(()=>{});
 const resumeTimer=useRef<{at:number;timer:ReturnType<typeof setTimeout>}|null>(null);
 const loop=useRef({raf:null as number|null,lastDraw:0,lastDiag:0,infoKey:'',drawn:false,frames:0,
  key:null as string|null,clock:null as PresentationClock|null});
 // One place changes the ride state, so the frame loop, the HUD and the card never disagree.
 const setRide=useCallback((next:RideState)=>{
  ride.current.state=next;
  root.current?.setAttribute('data-ride',next);
  setRideState(next);
 },[]);

 // The selected bus is drawn from its own source; every other bus stays a plain report.
 const busCollection=useCallback(()=>({type:'FeatureCollection' as const,
  features:buses.filter(bus=>bus.key!==selected?.key).map(bus=>{
   const stale=bus.freshness==='stale',nose=bus.bearing!==null;
   return {type:'Feature' as const,geometry:{type:'Point' as const,coordinates:[bus.lon,bus.lat]},
    properties:{key:bus.key,route:bus.route,selected:0,sort:stale?0:1,
     icon:`lm-${stale?'stale':'bus'}-${nose?'arrow':'dot'}`,rotate:bus.bearing??0}};
  })}),[buses,selected]);

 // --- create once -----------------------------------------------------------------
 useEffect(()=>{
  if(!container.current||map.current)return;
  if(!webglAvailable()){onUnavailable();return}
  let cancelled=false;
  // Bound the whole startup, including a stalled dynamic import. Parent clock updates must
  // not restart this watchdog. Unmounting cancels it and any pending startup.
  const firstPaint=setTimeout(()=>{if(!cancelled)onUnavailable()},7000);
  (async()=>{
   // Loaded as MapLibre ships it, not bundled. Its web worker is found beside its own module
   // file; bundled, that location became a build-machine path, the worker was started from
   // this page instead, and no tile ever loaded (scripts/vendor-maplibre.mjs).
   const maplibre=await import(/* webpackIgnore: true */ /* turbopackIgnore: true */
                               MAPLIBRE_MODULE_URL) as typeof MapLibreGL;
   if(cancelled||!container.current)return;
   let instance:MapLibreMap;
   try{
    instance=new maplibre.Map({container:container.current,style:buildStyle(themeRef.current) as never,
     center:[-2.2426,53.4808],zoom:12.2,attributionControl:false,
     pitch:0,bearing:0,maxPitch:70,dragRotate:false});
   }catch{onUnavailable();return}
   // North stays up unless a view deliberately turns it: no accidental two-finger rotation.
   instance.touchZoomRotate.disableRotation();
   instance.keyboard.disableRotation();
   instance.on('error',(event:{error?:{message?:string}})=>{
    // A failed tile is survivable; a failed style is not, and we fall back rather than
    // leave the passenger looking at an empty rectangle.
    if(event?.error&&/style/i.test(String(event.error?.message??'')))onUnavailable();
   });
   instance.on('load',()=>{
    if(cancelled)return;
    addOverlay(instance,themeRef.current);
    for(const layer of ['lm-bus-marker','lm-sel-marker']){
     instance.on('click',layer,(event:MapMouseEvent&{features?:{properties?:Record<string,unknown>}[]})=>{
      const key=event.features?.[0]?.properties?.key;
      if(typeof key==='string')onSelect(key);
     });
     instance.on('mouseenter',layer,()=>{instance.getCanvas().style.cursor='pointer'});
     instance.on('mouseleave',layer,()=>{instance.getCanvas().style.cursor=''});
    }
    setReady(true);
   });
   // Every vector tile failing leaves markers floating on an empty background, which is not
   // a usable map. At the first settled frame, if tiles were requested and none arrived,
   // fall back like any other failed start. Individual tile failures are tolerated.
   let tileErrors=0,tilesLoaded=0;
   instance.on('error',(event:{error?:unknown;sourceId?:string;tile?:unknown})=>{
    if(event?.sourceId==='openmaptiles'||(!event?.sourceId&&event?.tile))tileErrors+=1;
   });
   instance.on('sourcedata',(event:{sourceId?:string;tile?:unknown})=>{
    if(event?.tile&&event.sourceId==='openmaptiles')tilesLoaded+=1;
   });
   instance.once('idle',()=>{
    clearTimeout(firstPaint);
    if(cancelled)return;
    if(tileErrors>0&&tilesLoaded===0){onUnavailable();return}
    setPainted(true);
   });
   // Diagnostic, not a feature: the camera as text, written straight to the element so a
   // moving camera does not re-render the page on every frame.
   instance.on('moveend',()=>{
    const centre=instance.getCenter();
    root.current?.setAttribute('data-camera',`${instance.getZoom().toFixed(2)},${centre.lat.toFixed(5)},`
     +`${centre.lng.toFixed(5)},${Math.round(instance.getPitch())},${Math.round(instance.getBearing())}`);
   });
   // The drawn bus's place on the canvas changes when the camera moves as well as when the bus
   // does; a standing bus draws no frames, so it is projected here too.
   instance.on('move',()=>{
    const v=visualRef.current;
    if(!v||!root.current)return;
    const at=instance.project([v.lon,v.lat]);
    root.current.setAttribute('data-bus-screen',`${Math.round(at.x)},${Math.round(at.y)}`);
   });
   // A gesture is the passenger taking over. MapLibre marks its own camera events with the
   // DOM event that caused them; ours carry none, so they can never pass as gestures. In the
   // ride-along a drag pauses following ("Return to bus" resumes it) and a zoom keeps following
   // at the passenger's zoom; either ends an introduction or a return where it is.
   const gesture=(kind:'drag'|'zoom')=>(event:{originalEvent?:unknown})=>{
    if(!event.originalEvent)return;
    const r=ride.current;
    if(viewRef.current==='ride'){
     r.pointer.moved=true;
     if(kind==='drag'||r.state==='entering'||r.state==='returning'){
      r.transition+=1;
      if(r.state!=='exploring')setRide('exploring');
     }
     return;
    }
    userMoved.current=true;onManualMove();
   };
   instance.on('dragstart',gesture('drag'));
   instance.on('zoomstart',gesture('zoom'));
   // A finger or a pointer on the map during an introduction or a return stops that camera
   // move at once, before MapLibre decides whether it is a drag: chaining the next move on the
   // interrupted one's end would otherwise swallow the drag. A tap that moves nothing skips
   // to the bus instead of stranding the passenger mid-way.
   const canvasBox=instance.getCanvasContainer();
   const pointerDown=()=>{
    const r=ride.current;
    if(viewRef.current!=='ride')return;
    r.pointer={down:true,moved:false};
    if(r.state==='entering'||r.state==='returning'){r.transition+=1;instance.stop()}
   };
   const pointerUp=()=>{
    const r=ride.current;
    if(viewRef.current!=='ride'||!r.pointer.down)return;
    r.pointer.down=false;
    if(!r.pointer.moved&&(r.state==='entering'||r.state==='returning'))returnRef.current(true);
   };
   canvasBox.addEventListener('pointerdown',pointerDown);
   canvasBox.addEventListener('pointerup',pointerUp);
   canvasBox.addEventListener('pointercancel',pointerUp);
   canvasBox.addEventListener('wheel',()=>{
    const r=ride.current;
    if(viewRef.current!=='ride')return;
    if(r.state==='entering'||r.state==='returning'){r.transition+=1;instance.stop();setRide('exploring')}
   },{passive:true});
   map.current=instance;
  })().catch(()=>{if(!cancelled)onUnavailable()});
  return()=>{cancelled=true;clearTimeout(firstPaint);map.current?.remove();map.current=null};
 },[onSelect,onManualMove,onUnavailable,setRide]);

 useEffect(()=>{viewRef.current=view},[view]);

 // Every camera move the app makes goes through here. A camera that cannot be computed (a
 // frame too small for its padding) leaves the view as it is; it must never take the page down.
 const move=useCallback((run:(m:MapLibreMap)=>void)=>{
  if(!map.current)return;
  try{run(map.current)}catch{}
 },[]);

 // --- theme: repaint in place ----------------------------------------------------------
 useEffect(()=>{
  themeRef.current=theme;
  const instance=map.current;
  if(!ready||!instance)return;
  applyTheme(instance as never,theme);
  restyleOverlay(instance,theme);
 },[ready,theme]);

 // --- data ------------------------------------------------------------------------
 useEffect(()=>{
  if(!ready||!map.current)return;
  const instance=map.current;
  (instance.getSource(BUS_SOURCE) as GeoJSONSource|undefined)?.setData(busCollection());
  // Until the passenger has taken the camera, a new report that lands outside the frame
  // brings the frame to it.
  if(!selected||follow||view==='ride'||userMoved.current)return;
  const point=instance.project([selected.lon,selected.lat]);
  const {clientWidth:width,clientHeight:height}=instance.getContainer();
  const inset=56;
  if(point.x<inset||point.y<inset||point.x>width-inset||point.y>height-inset){
   move(m=>m.easeTo({center:[selected.lon,selected.lat],duration:prefersReducedMotion()?0:450}));
  }
 },[ready,busCollection,selected,follow,view,move]);

 useEffect(()=>{
  if(!ready||!map.current)return;
  const source=map.current.getSource(STOP_SOURCE) as GeoJSONSource|undefined;
  source?.setData({type:'FeatureCollection',features:stop?[{type:'Feature',
   geometry:{type:'Point',coordinates:[stop.lon,stop.lat]},
   properties:{label:stop.indicator?`${stop.name} (${stop.indicator})`:stop.name}}]:[]});
 },[ready,stop]);

 useEffect(()=>{
  if(!ready||!map.current)return;
  const source=map.current.getSource(HERE_SOURCE) as GeoJSONSource|undefined;
  if(!here){source?.setData(EMPTY);return}
  // No clamp: a phone reporting 1,500 m is drawn 1,500 m wide, because that is the claim
  // it made. A tidy small circle would suggest a precision the device never had.
  const accuracy=here.accuracyMetres&&here.accuracyMetres>0?here.accuracyMetres:0;
  source?.setData({type:'FeatureCollection',features:[
   ...(accuracy?[{type:'Feature' as const,
     geometry:{type:'Polygon' as const,coordinates:[accuracyRing(here.lat,here.lon,accuracy)]},
     properties:{kind:'accuracy'}}]:[]),
   {type:'Feature' as const,geometry:{type:'Point' as const,coordinates:[here.lon,here.lat]},
    properties:{kind:'point'}}]});
 },[ready,here]);

 // --- the walking route --------------------------------------------------------------
 useEffect(()=>{
  if(!ready||!map.current)return;
  const source=map.current.getSource(WALK_SOURCE) as GeoJSONSource|undefined;
  if(!walk||walk.path.length<2){source?.setData(EMPTY);return}
  const first=walk.path[0],last=walk.path[walk.path.length-1];
  const apart=(a:[number,number],b:{lat:number;lon:number})=>
   Math.hypot((a[0]-b.lon)*Math.cos(b.lat*Math.PI/180),a[1]-b.lat)*111195;
  const features=[lineFeature(walk.path,'route')];
  if(apart(first,walk.from)>6)features.push(lineFeature([[walk.from.lon,walk.from.lat],first],'connector'));
  if(apart(last,walk.to)>6)features.push(lineFeature([last,[walk.to.lon,walk.to.lat]],'connector'));
  source?.setData({type:'FeatureCollection',features});
 },[ready,walk]);

 // --- the 3D bus: fetched once, only when a tilted view first needs it ------------------
 useEffect(()=>{
  if(view==='2d'||modelRequested.current)return;
  modelRequested.current=true;
  fetch(MODEL_URL).then(response=>{if(!response.ok)throw Error(`model ${response.status}`);return response.json()})
   .then(value=>setModel(parseBusModel(value)))
   .catch(()=>setModelFailed(true));
 },[view]);

 // --- estimated movement: its inputs -----------------------------------------------------
 // The pattern whose road the estimate follows: the matched one, or, when the candidates differ
 // only in stops behind the bus, the first of them, whose road ahead they all share.
 const patternId=!selected?.match?null:'patternId' in selected.match?selected.match.patternId
  :selected.match.sharedOnward&&selected.match.candidates?.length?selected.match.candidates[0].patternId:null;
 useEffect(()=>{
  if(!patternId)return;
  let current=true;
  loadTrack(patternId).then(result=>{if(current)setTrack({...result,patternId})});
  return()=>{current=false};
 },[patternId]);
 useEffect(()=>{
  let current=true;
  loadMotionModel().then(value=>{if(current)setMotionModel(value)});
  return()=>{current=false};
 },[]);
 const history=useMemo(()=>selected?historyOf(selected):null,[selected]);
 const trackFor=track&&track.patternId===patternId?track:null;
 // Why no estimate is drawn, in words; null when one may be.
 const blocked=!selected?null
  :motion&&!motion.enabled?motion.reason??'reported positions only'
  :!patternId?(selected.match&&'unresolved' in selected.match&&selected.match.unresolved==='ambiguous_branch'
    ?'its branch is not settled, so the road ahead is not known':'it is not placed on a timetable pattern')
  :motionModel===undefined?CHECKING
  :motionModel===null?'movement has not been evaluated yet'
  :!motionModel.patterns.has(patternId)?'movement on this service has not been evaluated'
  :!trackFor?LOADING
  :!trackFor.track?trackFor.reason??'no road geometry'
  :null;
 const modelShown=view!=='2d'&&model!==null&&Boolean(selected);
 const provisional=blocked===CHECKING||blocked===LOADING;

 // --- the presentation clock -------------------------------------------------------------
 const inputs=useRef<Inputs>({ready:false,history:null,track:null,blocked:null,provisional:false,params:DEFAULT_PARAMS,
  profile:null,clockOffsetMs:0,view:'2d',follow:false,model:null,modelShown:false,walk:null});
 const frame=useCallback(function tick(){
  const state=loop.current;
  state.raf=null;
  state.frames+=1;
  const input=inputs.current,instance=map.current;
  if(!instance||!input.ready)return;
  const selectedSource=instance.getSource(SELECTED_SOURCE) as GeoJSONSource|undefined;
  const trailSource=instance.getSource(TRAIL_SOURCE) as GeoJSONSource|undefined;
  const modelSource=instance.getSource(MODEL_SOURCE) as GeoJSONSource|undefined;
  if(!input.selected||!input.history){
   if(state.drawn){selectedSource?.setData(EMPTY);trailSource?.setData(EMPTY);modelSource?.setData(EMPTY);state.drawn=false}
   visualRef.current=null;estimateRef.current=null;state.key=null;
   if(state.infoKey!=='none'){state.infoKey='none';input.onMotion?.(null)}
   diagnostics(root.current,null,null,state.frames,0,null);
   return;
  }
  // Another bus is a new drawing, never a correction of the last one.
  if(state.key!==input.selected.key){state.key=input.selected.key;visualRef.current=null}
  // One clock for everything drawn: the server's, as report ages use, and never stepped.
  state.clock=tickClock(state.clock,Date.now(),input.clockOffsetMs);
  const now=state.clock.now;
  const e=input.blocked||!input.track?observedAt(input.history,now,input.blocked??'no road geometry',input.provisional)
   :estimate(input.history,input.track,now,input.params);
  const v=stepVisual(visualRef.current,e,now,e.mode==='estimated'?input.track:null,input.params);
  visualRef.current=v;estimateRef.current=e;
  const t=performance.now();
  if(!state.drawn||t-state.lastDraw>=32){
   state.lastDraw=t;state.drawn=true;
   selectedSource?.setData({type:'FeatureCollection',features:[{type:'Feature',
    geometry:{type:'Point',coordinates:[v.lon,v.lat]},
    properties:{key:input.selected.key,route:input.selected.route,icon:`lm-sel-${v.bearing!==null?'arrow':'dot'}`,
     rotate:v.bearing??0,caption:e.mode==='estimated'?'ESTIMATE':''}}]});
   const fixes=input.history.fixes,last=fixes[fixes.length-1];
   const features:object[]=fixes.map(fix=>({type:'Feature',geometry:{type:'Point',coordinates:[fix.lon,fix.lat]},
    properties:{kind:'report',latest:fix===last?1:0}}));
   if(e.mode==='estimated'&&input.track&&v.s!==null){
    const from=project(input.track,e.basis,v.s).s;
    if(Math.abs(v.s-from)>2)features.push(lineFeature(slice(input.track,from,v.s),'estimate'));
    const band=uncertaintyAt(input.profile,e.reportAge);
    if(band)features.push(lineFeature(slice(input.track,v.s-band.metres,v.s+band.metres),'band'));
   }
   trailSource?.setData({type:'FeatureCollection',features} as never);
   modelSource?.setData(input.modelShown&&input.model
    ?{type:'FeatureCollection',features:v.bearing!==null?orientedBus(input.model,v,v.bearing):unorientedToken(input.model,v)}
    :EMPTY);
  }
  // Model, marker and camera all follow the same drawn state. Only the centre (and in the
  // ride-along the heading) is set: the passenger's zoom and tilt are left alone. Nothing is
  // set while the map is already moving (a gesture, an animated zoom, a glide of ours): a jump
  // then would cancel it. Once it ends, a camera left far from the bus glides back.
  const r=ride.current;
  const following=input.view==='ride'?r.state==='following':input.follow&&e.mode==='estimated';
  if(following&&!instance.isMoving()){
   const bearing=input.view==='ride'&&v.bearing!==null?{bearing:v.bearing}:{};
   const at=instance.project([v.lon,v.lat]),centre=instance.project(instance.getCenter());
   if(Math.hypot(at.x-centre.x,at.y-centre.y)>SETTLE_PX)
    instance.easeTo({center:[v.lon,v.lat],...bearing,duration:prefersReducedMotion()?0:280});
   else instance.jumpTo({center:[v.lon,v.lat],...bearing});
  }
  if(t-state.lastDiag>=200){
   state.lastDiag=t;
   diagnostics(root.current,e,v,state.frames,t,instance.project([v.lon,v.lat]));
  }
  const info=motionInfo(e,v,input.profile,input.params,now);
  const key=`${info.mode}|${info.reason}|${info.capped}|${info.correction?.at??0}|${Math.floor(info.reportAge/5)}|${info.speedKmh}`;
  if(key!==state.infoKey){state.infoKey=key;input.onMotion?.(info)}
  // Frames only while something moves: a standing, paused or reported-only bus costs nothing.
  // A bus held at its last reports wakes the clock when its hold would end.
  if(needsFrames(e,v))state.raf=requestAnimationFrame(tick);
  else if(e.held&&e.resumeAt&&resumeTimer.current?.at!==e.resumeAt){
   if(resumeTimer.current)clearTimeout(resumeTimer.current.timer);
   const at=e.resumeAt;
   resumeTimer.current={at,timer:setTimeout(()=>{resumeTimer.current=null;if(loop.current.raf===null)loop.current.raf=requestAnimationFrame(tick)},
    Math.max(50,e.resumeAt-now+30))};
  }
 },[]);
 const kick=useCallback(()=>{if(loop.current.raf===null)loop.current.raf=requestAnimationFrame(frame)},[frame]);
 useEffect(()=>{
  inputs.current={ready,selected,history,track:trackFor?.track??null,blocked,provisional,
   params:motionModel?.params??DEFAULT_PARAMS,profile:motionModel?.profile??null,clockOffsetMs,
   view,follow,model,modelShown,here,stop,walk,onMotion};
  kick();
 });
 useEffect(()=>()=>{
  if(loop.current.raf!==null)cancelAnimationFrame(loop.current.raf);
  if(resumeTimer.current)clearTimeout(resumeTimer.current.timer);
 },[]);

 // With the model drawn, the flat symbol gives way to the ring and the badge from the model's
 // zoom up; below it, and whenever there is no model, the flat symbol is the marker. "Model
 // loaded" is not "model visible": the ring and badge are symbols, drawn over any building.
 useEffect(()=>{
  const instance=map.current;
  if(!ready||!instance)return;
  try{
   instance.setLayoutProperty('lm-bus-model','visibility',modelShown?'visible':'none');
   instance.setLayoutProperty('lm-bus-badge','visibility',modelShown?'visible':'none');
   instance.setPaintProperty('lm-sel-marker','icon-opacity',(modelShown?HIDE_SELECTED_WHEN_MODEL:1) as never);
   instance.setPaintProperty('lm-sel-marker','text-opacity',(modelShown?HIDE_SELECTED_WHEN_MODEL:1) as never);
   instance.setPaintProperty('lm-sel-ring','icon-opacity',(modelShown?SHOW_RING_WHEN_MODEL:0) as never);
  }catch{/* the flat symbol stays: the 2D map is always the fallback */}
  kick();
 },[ready,modelShown,kick]);

 // --- camera ----------------------------------------------------------------------
 // `camera` is the tilt and heading to end at; without it the current tilt is kept.
 const fitRelevant=useCallback((camera?:{pitch:number;bearing:number})=>{
  if(!map.current)return;
  const points=journeyFocus({here,stop,bus:selected}).map(p=>[p.lon,p.lat] as [number,number]);
  // The walking route is part of the journey: it is framed too.
  if(walk)points.push(...walk.path);
  // With nothing chosen yet, frame the buses nearest the middle of the map, not the whole
  // city: one distant bus must not shrink everything else to specks.
  if(!points.length&&buses.length){
   const centre=map.current.getCenter();
   points.push(...[...buses].sort((a,b)=>
    Math.hypot(a.lon-centre.lng,a.lat-centre.lat)-Math.hypot(b.lon-centre.lng,b.lat-centre.lat))
    .slice(0,8).map(b=>[b.lon,b.lat] as [number,number]));
  }
  const reduce=prefersReducedMotion();
  if(!points.length){
   if(camera)move(m=>m.easeTo({...camera,duration:reduce?0:500}));
   return;
  }
  if(points.length===1){
   move(m=>m.easeTo({center:points[0],zoom:15.4,...camera,duration:reduce?0:500}));
   return;
  }
  const lons=points.map(p=>p[0]),lats=points.map(p=>p[1]);
  // The right-hand padding clears the tool column, the top the view switch, the bottom a
  // marker's label and the credit line: fitted means readable, not merely inside.
  move(m=>m.fitBounds([[Math.min(...lons),Math.min(...lats)],[Math.max(...lons),Math.max(...lats)]],
   {padding:{top:70,bottom:88,left:64,right:84},maxZoom:16.2,...camera,duration:reduce?0:500}));
 },[here,stop,selected,buses,walk,move]);

 // The camera goes to what the passenger asked for: the first buses, a new stop, service or
 // bus, a found location. It never moves on an ordinary refresh.
 const fitLatest=useRef(fitRelevant);
 useEffect(()=>{fitLatest.current=fitRelevant},[fitRelevant]);
 const haveBuses=buses.length>0;
 const hereKey=here?`${here.lat.toFixed(5)},${here.lon.toFixed(5)}`:'';
 const stopId=stop?.id??'';
 useEffect(()=>{
  if(!ready)return;
  userMoved.current=false;
  fitLatest.current();
 },[ready,fitRequest,stopId,hereKey,haveBuses]);
 // A walking route that arrives is framed once, unless the passenger has taken the camera.
 const walkKey=walk?`${walk.path.length}|${walk.path[0]?.join(',')}|${walk.path[walk.path.length-1]?.join(',')}`:'';
 useEffect(()=>{
  if(!ready||!walkKey||userMoved.current||view==='ride')return;
  fitLatest.current();
 },[ready,walkKey,view]);

 // Following in 2D or City: an estimate is followed frame by frame by the clock above; a bus
 // shown at its reports is re-centred when a new report arrives.
 useEffect(()=>{
  if(!ready||!follow||!selected||!map.current||view==='ride')return;
  if(estimateRef.current?.mode==='estimated'){kick();return}
  move(m=>m.easeTo({center:[selected.lon,selected.lat],zoom:Math.max(m.getZoom(),15),
                    duration:prefersReducedMotion()?0:450}));
 },[ready,follow,selected,view,move,kick]);

 // Views: buildings rise in City and the ride-along; 2D is flat and north up.
 useEffect(()=>{
  const instance=map.current;
  if(!ready||!instance)return;
  const reduce=prefersReducedMotion();
  if(view!=='2d'){
   if(!instance.getLayer('lm-buildings-3d')){
    try{instance.addLayer(buildingExtrusion(themeRef.current) as never,'lm-here-accuracy')}catch{}
   }
  }else if(instance.getLayer('lm-buildings-3d'))instance.removeLayer('lm-buildings-3d');
  if(view==='city'){
   move(m=>m.easeTo({...VIEW_CAMERA.city,zoom:Math.max(m.getZoom(),15.2),duration:reduce?0:900}));
  }else if(view==='2d'&&(instance.getPitch()!==0||instance.getBearing()!==0)){
   move(m=>m.easeTo({...VIEW_CAMERA['2d'],duration:reduce?0:600}));
  }
 },[ready,view,move]);

 // The ride-along's framing, from the drawn state: above and behind it, turned to its heading.
 const rideFraming=useCallback((instance:MapLibreMap)=>{
  const v=visualRef.current,s=inputs.current.selected;
  const centre=instance.getCenter();
  const heading=v?.bearing??s?.bearing??null;
  return {center:(v?[v.lon,v.lat]:s?[s.lon,s.lat]:[centre.lng,centre.lat]) as [number,number],zoom:RIDE_ZOOM,
   pitch:heading===null?50:60,bearing:heading??instance.getBearing()};
 },[]);

 /**
  * "Return to bus", "Skip to the bus", and the first framing of a ride without an
  * introduction: glide to the ride framing (a jump under reduced motion), then follow. The
  * glide is obsolete the moment a gesture, another bus or leaving moves the camera instead.
  */
 const returnToBus=useCallback((fast=false)=>{
  const instance=map.current,r=ride.current;
  if(!instance||viewRef.current!=='ride')return;
  const token=++r.transition;
  instance.stop();
  if(prefersReducedMotion()){
   instance.jumpTo(rideFraming(instance));
   setRide('following');kick();
   return;
  }
  setRide('returning');
  approach(instance,()=>rideFraming(instance),fast?450:900,()=>r.transition===token&&r.state==='returning').then(still=>{
   if(!still)return;
   setRide('following');kick();
  });
 },[rideFraming,setRide,kick]);
 useEffect(()=>{returnRef.current=returnToBus},[returnToBus]);

 // Entering the ride-along: the first time, an introduction (you, your stop and the bus,
 // then the stop, then the bus), each step interruptible and skippable; later entries and
 // reduced motion go straight to the bus. Leaving cancels whatever the camera was doing and
 // returns to the practical map.
 useEffect(()=>{
  const instance=map.current,r=ride.current;
  if(!ready||!instance)return;
  if(view!=='ride'){
   if(!wasRiding.current)return;
   wasRiding.current=false;
   r.transition+=1;
   // Stopping the ride's camera also stops the view's own ease, so the fit carries the tilt and
   // heading of the view being returned to.
   instance.stop();
   instance.resize();
   instance.setPadding({top:0,bottom:0,left:0,right:0});
   setRide('off');
   userMoved.current=false;
   fitLatest.current(VIEW_CAMERA[view==='city'?'city':'2d']);
   return;
  }
  if(wasRiding.current)return;
  wasRiding.current=true;
  rideKey.current=inputs.current.selected?.key??'';
  // A phone's ride map is taller: the camera takes the new size before anything is framed.
  instance.resize();
  instance.setPadding(ridePadding(instance.getContainer()));
  const intro=r.intro&&!prefersReducedMotion();
  r.intro=false;
  if(!intro){returnRef.current(false);return}
  r.introSeen=true;
  const token=++r.transition;
  setRide('entering');
  const {here:you,stop:board,selected:bus,walk:path}=inputs.current;
  const points:LonLat[]=journeyFocus({here:you,stop:board,bus}).map(p=>[p.lon,p.lat]);
  if(path)points.push(...path.path);
  // A framing that cannot fit (a small screen under the ride-along's notes) is skipped:
  // MapLibre throws on it, and nothing here may take the page down.
  const framing=(list:LonLat[],maxZoom:number)=>{
   const lons=list.map(p=>p[0]),lats=list.map(p=>p[1]);
   try{
    const fitted=instance.cameraForBounds([[Math.min(...lons),Math.min(...lats)],[Math.max(...lons),Math.max(...lats)]],{padding:48,maxZoom});
    return fitted&&Number.isFinite(fitted.zoom??Number.NaN)?fitted:null;
   }catch{return null}
  };
  // Two glides, the bus in the frame throughout: the whole journey (you, your stop, the bus
  // and the walk) centred on the drawn bus, then down to the bus itself, which therefore stays
  // in the middle while the camera zooms, tilts and turns. A middle step on the stop was tried
  // and dropped: on a phone its tilt swung the bus out of the frame, and it said nothing new.
  const drawn=visualRef.current??bus;
  const overview=points.length>=2&&drawn
   ?framing(points.flatMap(([lon,lat])=>[[lon,lat],[2*drawn.lon-lon,2*drawn.lat-lat]] as LonLat[]),17):null;
  const still=()=>r.transition===token&&r.state==='entering';
  (async()=>{
   if(overview){
    await glide(instance,{...overview,pitch:35,duration:1200});
    if(!still())return;
   }
   if(!await approach(instance,()=>rideFraming(instance),1400,still))return;
   setRide('following');kick();
  })();
 },[ready,view,kick,rideFraming,setRide]);

 // Another bus chosen mid-ride: whatever the camera was doing is obsolete; it goes to the
 // new bus and follows that. The same key is a new report of the same bus, not a change.
 const selectedKey=selected?.key??'';
 useEffect(()=>{
  if(!ready||view!=='ride'||!wasRiding.current||!selectedKey||rideKey.current===selectedKey)return;
  rideKey.current=selectedKey;
  returnRef.current(true);
 },[ready,view,selectedKey]);

 // The clear band moves when the map is resized: a phone's taller ride map, or a rotation.
 // setPadding is a jump, and a jump stops whatever the camera is doing. A phone's map finishes
 // growing just after a ride starts, so applying the band at once cancelled the first glide
 // (a second ride was left flat at the street-map zoom). While the camera moves, it waits.
 useEffect(()=>{
  const instance=map.current;
  if(!ready||!instance||view!=='ride')return;
  let live=true,waiting=false;
  const apply=()=>{waiting=false;if(live)instance.setPadding(ridePadding(instance.getContainer()))};
  const onResize=()=>{
   if(!instance.isMoving()){apply();return}
   if(waiting)return;
   waiting=true;
   instance.once('moveend',apply);
  };
  instance.on('resize',onResize);
  return()=>{live=false;instance.off('resize',onResize);instance.off('moveend',apply)};
 },[ready,view]);

 const skipIntro=()=>returnToBus(true);
 const startRide=()=>{ride.current.intro=!ride.current.introSeen;onViewChange('ride')};
 const exitRide=()=>onViewChange('2d');

 useEffect(()=>{onRideState?.(view==='ride'?rideState:'off')},[view,rideState,onRideState]);

 // A ride started below the map would otherwise play off screen on a phone.
 useEffect(()=>{
  if(view!=='ride')return;
  const box=container.current?.parentElement;
  if(!box)return;
  const rect=box.getBoundingClientRect();
  if(rect.top<0||rect.bottom>window.innerHeight)
   box.scrollIntoView({block:'start',behavior:prefersReducedMotion()?'auto':'smooth'});
 },[view]);

 useEffect(()=>{
  if(view!=='ride')return;
  const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape')onViewChange('2d')};
  window.addEventListener('keydown',onKey);
  return()=>window.removeEventListener('keydown',onKey);
 },[view,onViewChange]);

 const zoomBy=(delta:number)=>{
  if(view!=='ride')userMoved.current=true;
  move(m=>(delta>0?m.zoomIn:m.zoomOut).call(m,{duration:prefersReducedMotion()?0:220}));
 };

 return <div ref={root} className={`vector-map theme-${theme} view-${view}`}
   data-map-state={painted?'painted':ready?'ready':'starting'}
   data-view={view} data-theme={theme} data-model={model?'ready':modelFailed?'failed':'idle'}
   data-ride={view==='ride'?rideState:'off'} data-walk={walk?'route':'none'}>
  <div ref={container} className="vector-map-canvas" aria-label={
   `Map of ${buses.length} last reported bus positions${stop?`, your stop ${stop.name}`:''}.`}/>
  <div className="map-vignette" aria-hidden="true"/>
  {!painted&&<p className="map-loading" role="status">Drawing the map…</p>}

  {view!=='ride'&&<div className="map-views">
   <div className="view-switch" role="group" aria-label="Map view">
    <button aria-pressed={view==='2d'} onClick={()=>onViewChange('2d')}>2D</button>
    <button aria-pressed={view==='city'} onClick={()=>onViewChange('city')}>City</button>
   </div>
   <button className="fit-journey" onClick={()=>fitRelevant(VIEW_CAMERA[view])}
    aria-label="Fit journey: you, your stop and the selected bus"><Scan size={15}/>Fit journey</button>
  </div>}

  <div className="map-tools">
   <button onClick={()=>zoomBy(1)} aria-label="Zoom in"><Plus size={18}/></button>
   <button onClick={()=>zoomBy(-1)} aria-label="Zoom out"><Minus size={18}/></button>
   {onLocate&&<button onClick={onLocate} disabled={locating} aria-label="Locate me">
    <LocateFixed size={17} className={locating?'spin':''}/></button>}
   <button onClick={()=>onThemeChange(theme==='day'?'night':'day')}
    aria-label={theme==='day'?'Switch to the night map':'Switch to the daylight map'}>
    {theme==='day'?<Moon size={17}/>:<Sun size={17}/>}</button>
  </div>

  {/* The legend and the ride button share the map's foot, stacking rather than overlapping. */}
  {view!=='ride'&&(stop||here||selected)&&<div className="vector-map-foot">
   <div className="map-legend-chips" aria-hidden="true">
    {here&&<span className="legend-you">You</span>}
    {walk&&<span className="legend-walk">Walk</span>}
    {stop&&<span className="legend-stop">Your stop</span>}
    {selected&&<span className="legend-bus">{busLabel}</span>}
   </div>
   {selected&&<button className="ride-launch" onClick={startRide}
     aria-label={`Ride along with route ${selected.route}`}>
    <span className="ride-launch-route">{selected.route}</span>Ride along</button>}
  </div>}

  {view==='ride'&&<div className="ride-hud" role="region" aria-label="Ride-along">
   {/* One column under the exit, so the notes can never cover each other or the exit. The
       mode line is short; what a ride-along is sits behind "What is this?". */}
   <div className="ride-notes">
    <p className="ride-mode" data-state={rideState} role="status"><Eye size={14}/>
     <strong>Ride-along</strong><span>· {RIDE_WORDS[rideState]||'starting'}</span></p>
    <details className="ride-about"><summary>What is this?</summary>
     <p>A map visualisation, not a film from on board. The bus is drawn at its last report, or at an
      estimate labelled as one. Drag to look around; the bus goes on without the camera until you
      return to it.</p></details>
    {selected&&selected.bearing===null&&blocked!==null&&<p className="ride-note">This bus did not report
     a direction, so it is shown from above, not from behind.</p>}
    {modelFailed&&<p className="ride-note" role="status">The 3D bus could not be loaded, so the map
     symbol is shown instead.</p>}
    {rideState==='entering'&&<button className="ride-skip" onClick={skipIntro}><SkipForward size={14}/>Skip to the bus</button>}
    {rideState==='exploring'&&<button className="ride-return" onClick={()=>returnToBus()}><Crosshair size={14}/>Return to bus</button>}
   </div>
   {rideOverlay}
   <button className="ride-exit" onClick={exitRide}><X size={16}/>Exit ride-along</button>
  </div>}

  {view==='city'&&modelFailed&&<p className="map-notice" role="status">The 3D bus could not be loaded,
   so the map symbol is shown instead.</p>}

  <p className="map-credit-line">
   {BASEMAP_CREDITS.map((credit,index)=><span key={credit.href}>{index>0&&' · '}
    <a href={credit.href} target="_blank" rel="noopener noreferrer">{credit.label}</a></span>)}
  </p>
 </div>;
}
