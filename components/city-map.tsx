"use client";

import {useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import type {ReactNode} from 'react';
import {Armchair,Bus,Crosshair,Eye,LocateFixed,Maximize2,Minimize2,Minus,Moon,Plus,Scan,Sun,X} from 'lucide-react';
import {BASEMAP_CREDITS,MAPLIBRE_MODULE_URL,prefersReducedMotion,webglAvailable} from '@/lib/basemap';
import {applyTheme,baseLayers,buildingExtrusion,buildStyle,FRONT,PALETTES,type MapTheme} from '@/lib/map-style';
import {MODEL_URL,orientedBus,parseBusModel,unorientedToken,type BusModel} from '@/lib/bus-model';
import {accuracyRing} from '@/lib/geo';
import {BUS_SOURCE,HERE_SOURCE,HIDE_SELECTED_WHEN_MODEL,MODEL_SOURCE,OVERLAY,OVERLAY_SOURCES,
        overlayLayers,SELECTED_SOURCE,SHOW_RING_WHEN_MODEL,STOP_SOURCE,STOPS_AHEAD_SOURCE,TRAIL_SOURCE,WALK_SOURCE} from '@/lib/map-overlay';
import {journeyFocus} from '@/lib/journey';
import {DEFAULT_PARAMS,DRAWING,drawingFor,estimate,needsFrames,observedAt,pointAt,project,slice,stepVisual,tickClock,turnToward,
        type PresentationClock,uncertaintyAt,
        type ErrorProfile,type Estimate,type History,type LonLat,type MotionParams,type Track,
        type Visual} from '@/lib/motion';
import {daylightAt} from '@/lib/daylight';
import {historyOf,loadMotionModel,loadTrack,type MotionInfo,type MotionModel,type TrackResult, loadSharedTrack,withinSharedRoad,type SharedRoad} from '@/lib/motion-view';
import type * as MapLibreGL from 'maplibre-gl';
import type {CameraOptions,GeoJSONSource,LngLat,LngLatLike,Map as MapLibreMap,MapMouseEvent} from 'maplibre-gl';
import type {FollowBus} from '@/lib/follow';
import type {Stop} from '@/lib/stops';

export type Here = {lat:number;lon:number;accuracyMetres?:number};
/** 2D is the practical default: north up, flat. City tilts it and raises the buildings. The
 *  ride-along follows one bus from above and behind. */
export type MapView = '2d'|'city'|'ride';
/** How the bus drawn as the chosen one stands: the page's suggestion, the passenger's pin with a
 *  current report, the pin now on another journey, or the pin with no current report (drawn at
 *  its last report, hollow, and never moved on). */
export type SelectionKind='suggested'|'active'|'new_journey'|'absent';

type Props = {
 buses:FollowBus[];selected?:FollowBus;selectionKind?:SelectionKind;stop?:Stop|null;here?:Here|null;
 /** True while the passenger's page is behind the engineering area. The page stays mounted so the
  *  stop, the bus, the ride and this very map come back unchanged — but a map nobody can see must
  *  not go on drawing. Measured on 17 September 2026: hidden, it drew 27.6 frames a second, more
  *  than the 17.2 it drew in front of the passenger, because the view over it is lighter. */
 paused?:boolean;
 /** `reason` says which part of the start failed, so the simple map can say why it is shown. */
 follow:boolean;onSelect:(key:string)=>void;onManualMove:()=>void;onUnavailable:(reason?:string)=>void;
 /** The next few stops on the chosen bus's pattern, labelled in the front view: real stops only. */
 stopsAhead?:{id:string;lat:number;lon:number;label:string}[];
 /** Offered while the detailed map is slow to arrive: the simple map in its place. */
 onSimpleMap?:()=>void;
 view:MapView;onViewChange:(view:MapView)=>void;
 theme:MapTheme;onThemeChange:(theme:MapTheme)=>void;
 /** Incremented by the parent when the passenger asks for something new (a stop, a service, a
  *  bus from the list), so the camera goes to it without a further tap. */
 fitRequest?:number;
 onLocate?:()=>void;locating?:boolean;
 /** Whether `here` is the device's fix or a start the passenger chose; the label on the map says. */
 originKind?:'device'|'chosen';
 /** While true, a tap on the map is a chosen starting point, not a bus. */
 pickingOrigin?:boolean;onPickOrigin?:(point:{lat:number;lon:number})=>void;
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
// The front view: a stylised preview of the street ahead, from a raised point above the drawn
// position on the bus's own checked road shape (never the raw GPS heading, which jitters). It is
// not a seat on board and not the bus's lane: it is the map's street, seen from above the road.
// Raised so that the road ahead, both sides of the street and the skyline share the frame, where
// from 3.5 m a road filled the foot of the screen under an empty sky. Its paint is FRONT's.
const EYE_HEIGHT=7.5;          // m above the road, above a double-decker's roof
const EYE_FORWARD=4;           // m ahead of the drawn position, the middle of a 12 m bus
const LOOK_AHEAD=32;           // m further along the road at a standstill, where the eye rests
// The eye rests further ahead the faster the drawn bus moves, as a passenger's does: 2.5 s of
// travel beyond the standing distance, so 70 m at 15 m/s, capped where the road would be a
// line. A turn still sweeps smoothly because the aim point is on the road shape itself.
const lookAhead=(velocity=0)=>Math.min(80,LOOK_AHEAD+2.5*Math.max(0,velocity));
const FRONT_MAX_PITCH=85;      // MapLibre allows 180; the view looks about 13° below the horizon
const OUTSIDE_MAX_PITCH=70;    // the map's own limit everywhere else
const NO_PADDING={top:0,bottom:0,left:0,right:0};
const NO_STOPS:{id:string;lat:number;lon:number;label:string}[]=[];
// No sky: what MapLibre itself uses when a style sets none.
const SKY_OFF:NonNullable<Parameters<MapLibreMap['setSky']>[0]>={'sky-color':'transparent','horizon-color':'transparent',
 'fog-color':'transparent','fog-ground-blend':1,'atmosphere-blend':0};
// At eye level a road drawn at its map width is a 1 m ribbon: the front view draws each class at a
// real width in metres, its casing a kerb wider. Exponential base 2 in zoom is constant in metres.
const ROAD_METRES:Record<string,number>={'lm-motorway':11,'lm-primary':9,'lm-secondary':7.5,'lm-minor':6,
 'lm-service':4,'lm-path':2,'lm-rail':2.5};
const METRES_PER_PIXEL_Z0=156543.03*Math.cos(53.46*Math.PI/180);   // Manchester's latitude
const metresWide=(metres:number)=>['interpolate',['exponential',2],['zoom'],
 14,metres*2**14/METRES_PER_PIXEL_Z0,24,metres*2**24/METRES_PER_PIXEL_Z0];
// The chosen bus's own marks on the map: hidden in the front view, where the camera is inside it.
const SELECTED_TRAIL=['lm-trail-band','lm-trail-estimate','lm-trail-report'];

/**
 * The ride-along's camera, one state at a time, so the map and the card can say the same thing:
 *   entering    gliding to the bus as the ride starts
 *   following   the camera is on the drawn bus every frame
 *   exploring   the passenger moved the map; the bus goes on without the camera
 *   returning   "Return to bus", another bus or another viewpoint: gliding there, then following
 *   paused      the chosen vehicle started another journey: the camera waits, still, until the
 *               passenger goes on with that journey, and then glides back and follows
 * A gesture during a transition ends it; a transition made obsolete (another bus chosen, the
 * ride left) is cancelled by its token before it can finish. The viewpoint is separate: outside
 * (above and behind the bus) or front (a passenger's eye at the front of the upper deck, offered
 * only where the bus's road has been checked against its own reports).
 */
export type RideState='off'|'entering'|'following'|'exploring'|'returning'|'paused';
export const RIDE_WORDS:Record<RideState,string>={off:'',entering:'going to the bus',following:'following the bus',
 exploring:'exploring the map',returning:'returning to the bus',paused:'paused: this bus started another journey'};
/** Around a tap, how far a bus marker may be and still be the one meant: a finger's reach. */
const TAP_MARGIN=14;
/** Every layer that draws a bus, in the order they are stacked: all of them answer a tap. */
const SELECTABLE=['lm-bus-marker','lm-bus-label','lm-sel-marker','lm-sel-ring','lm-bus-badge','lm-bus-model'];

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
 *  drawn bus just beyond its 12 m length (about 6.6 m radius) so the bus is found even when a
 *  building hides the model, without a halo twice its size around it. */
function ring({stroke,outline,radius}:{stroke:string;outline:string;radius:number}):ImageData{
 const ratio=2,size=Math.ceil(radius*2+14);
 const canvas=document.createElement('canvas');
 canvas.width=size*ratio;canvas.height=size*ratio;
 const g=canvas.getContext('2d')!;
 g.scale(ratio,ratio);g.translate(size/2,size/2);
 // A pool of light on the road under the bus, then the ring itself. The flat 7% disc and 4 px
 // rim it replaced read as a faint ellipse at the ride-along's zoom, on pale daylight roads
 // especially: the bus was there and did not look chosen. The gradient also gives the scene
 // somewhere for the bus to stand, which a flat outline does not.
 const glow=g.createRadialGradient(0,0,radius*0.15,0,0,radius);
 glow.addColorStop(0,'rgba(198,243,106,0.30)');
 glow.addColorStop(0.72,'rgba(198,243,106,0.16)');
 glow.addColorStop(1,'rgba(198,243,106,0.02)');
 g.beginPath();g.arc(0,0,radius,0,2*Math.PI);g.fillStyle=glow;g.fill();
 g.beginPath();g.arc(0,0,radius,0,2*Math.PI);
 g.lineWidth=9;g.strokeStyle=outline;g.globalAlpha=0.62;g.stroke();
 g.globalAlpha=1;g.lineWidth=5.5;g.strokeStyle=stroke;g.stroke();
 return g.getImageData(0,0,size*ratio,size*ratio);
}

function markerImages(theme:MapTheme){
 const o=OVERLAY[theme];
 // By day the chosen bus is rimmed in ink, not a pale rim that vanished against cream roads and
 // pale buildings; by night the pale rim separates it from the ink.
 const rim=theme==='day'?o.ink:'#f4ffe4';
 return {
  'lm-sel-arrow':marker({fill:'#c6f36a',stroke:rim,outline:o.ink,radius:13,nose:true}),
  'lm-sel-dot':marker({fill:'#c6f36a',stroke:rim,outline:o.ink,radius:13,nose:false}),
  // A chosen bus with no current report: hollow, so it cannot pass for one being tracked.
  'lm-sel-lost-arrow':marker({fill:o.halo,stroke:'#8fbf2f',outline:o.ink,radius:12,nose:true}),
  'lm-sel-lost-dot':marker({fill:o.halo,stroke:'#8fbf2f',outline:o.ink,radius:12,nose:false}),
  'lm-sel-ring':ring({stroke:'#c6f36a',outline:o.ink,radius:74}),
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
 if(instance.getLayer('lm-stops-ahead-label')){
  instance.setPaintProperty('lm-stops-ahead-label','text-color',o.busLabel);
  instance.setPaintProperty('lm-stops-ahead-label','text-halo-color',o.halo);
  instance.setPaintProperty('lm-stops-ahead-dot','circle-color',o.halo);
  instance.setPaintProperty('lm-stops-ahead-dot','circle-stroke-color',o.busLabel);
 }
 instance.setPaintProperty('lm-sel-caption','text-color',o.busLabel);
 instance.setPaintProperty('lm-trail-estimate','line-color',o.ink);
 instance.setPaintProperty('lm-trail-report','circle-stroke-color',o.ink);
}

/**
 * Camera padding that keeps the ridden bus in the clear band between the ride-along's bar at
 * the top and its actions and progress card at the bottom, whatever their size on this screen.
 */
function ridePadding(canvas:HTMLElement){
 const box=canvas.getBoundingClientRect();
 const hud=canvas.closest('.vector-map')?.querySelector('.ride-hud');
 const edge=(selector:string,side:'top'|'bottom')=>{
  const found=hud?.querySelector(selector)?.getBoundingClientRect();
  return found?found[side]-box.top:null;
 };
 const top=Math.max(0,...['.ride-bar','.ride-notes'].map(s=>edge(s,'bottom')??0));
 const cardTop=Math.min(...['.ride-actions','.ride-card'].map(s=>edge(s,'top')??Infinity));
 const bottom=Number.isFinite(cardTop)?Math.max(0,box.height-cardTop):0;
 if(box.height-top-bottom<90)return {top:Math.round(box.height*0.1),bottom:0,left:0,right:0};
 return {top:Math.round(top+8),bottom:Math.round(bottom+8),left:0,right:0};
}

/**
 * Room at each edge for the map's own controls, measured, so that a fitted journey lands clear of
 * them with its names (a stop's name sits up to about 40 px from its dot, on whichever side has
 * room). On a phone the legend and the Ride along button take about 110 px at the foot; the fixed
 * 88 px allowed before put a stop fitted near the bottom under the button.
 */
/** Below this width the ride-along takes the whole screen (see the effect in CityMap). It is the
 *  same breakpoint the stylesheet uses for the immersive ride, and the two must agree. */
const IMMERSIVE_RIDE='(max-width: 860px)';

// A stop's name sits up to about this far from its dot, on whichever side has room. It was 40,
// which left a fitted stop clearing the Ride along button by about four pixels — a margin that
// survived only by luck, and that the type change of 17 September 2026 used up.
const NAME_ROOM=60;
function fitPadding(container:HTMLElement){
 const box=container.getBoundingClientRect();
 const within=container.closest('.vector-map');
 const edge=(selector:string)=>{
  const r=within?.querySelector(selector)?.getBoundingClientRect();
  return r&&r.width>0&&r.height>0?r:null;
 };
 const views=edge('.map-views'),tools=edge('.map-tools'),foot=edge('.vector-map-foot');
 return {top:Math.round(Math.max(70,views?views.bottom-box.top+NAME_ROOM:0)),
  bottom:Math.round(Math.max(88,foot?box.bottom-foot.top+NAME_ROOM:0)),
  left:64,right:Math.round(Math.max(64,tools?box.right-tools.left+14:0))};
}

/** Resolve when a camera move ends, or a little after it should have. */
function glide(instance:MapLibreMap,options:Parameters<MapLibreMap['easeTo']>[0]&{duration:number}){
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
async function approach(instance:MapLibreMap,target:()=>CameraOptions&{center:LngLatLike},
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

/** Bearing from one point to another, degrees from north; flat, which is exact enough over 30 m. */
const bearingTo=(a:{lat:number;lon:number},b:{lat:number;lon:number})=>
 (Math.atan2((b.lon-a.lon)*Math.cos(a.lat*Math.PI/180),b.lat-a.lat)*180/Math.PI+360)%360;

/** The front view's eye, at the front of the drawn bus on its own road shape, and the bearing of
 *  the road LOOK_AHEAD metres ahead of it. Null off the road, or with too little road left. */
function frontAim(track:Track,v:{lat:number;lon:number;s:number|null;velocity?:number},lead=0){
 const placed=v.s===null?project(track,v):null;
 if(placed&&placed.offset>40)return null;
 const s=(v.s??placed?.s??0)+lead;
 const eyeS=Math.min(track.length,s+EYE_FORWARD),lookS=Math.min(track.length,eyeS+lookAhead(v.velocity));
 if(lookS-eyeS<5)return null;
 const eye=pointAt(track,eyeS);
 return {eye,bearing:bearingTo(eye,pointAt(track,lookS))};
}

/**
 * The front view's camera: the eye EYE_HEIGHT above the road at the front of the drawn bus,
 * looking LOOK_AHEAD metres ahead, along the road there or along the eased `bearing` the frame
 * loop passes. The eye comes from the displayed state (its place along the road), so the view
 * moves exactly as the bus is drawn: holding when it holds, easing when a report corrects it,
 * never travelling on its own. Null where nothing is left ahead to look along, or the drawn bus
 * is off its road.
 */
function frontCamera(instance:MapLibreMap,track:Track,v:{lat:number;lon:number;s:number|null;velocity?:number},lead=0,
 bearing?:number):CameraOptions|null{
 const aim=frontAim(track,v,lead);
 if(!aim)return null;
 const {eye}=aim,b=(bearing??aim.bearing)*Math.PI/180,reach=lookAhead(v.velocity);
 const ahead={lat:eye.lat+reach*Math.cos(b)/111195,
  lon:eye.lon+reach*Math.sin(b)/(111195*Math.cos(eye.lat*Math.PI/180))};
 try{
  // MapLibre converts any [lon, lat] pair; its typings ask for its own LngLat class, which this
  // module only has once MapLibre itself has loaded.
  const at=(p:{lat:number;lon:number})=>[p.lon,p.lat] as unknown as LngLat;
  const options=instance.calculateCameraOptionsFromTo(at(eye),EYE_HEIGHT,at(ahead),0);
  return Number.isFinite(options.zoom??Number.NaN)&&Number.isFinite(options.pitch??Number.NaN)?options:null;
 }catch{return null}
}

const lineFeature=(coordinates:LonLat[],kind:string)=>({type:'Feature' as const,
 geometry:{type:'LineString' as const,coordinates},properties:{kind}});

/** Diagnostic, not a feature: the drawn state as text, so the browser suite can check that it
 *  moves continuously, keeps its zoom, turns the short way and falls back when it should. */
/** How many frame intervals are kept, and the middle one of them. A median ignores the single
 *  long frame a tile upload or a garbage collection causes; a mean would not. */
const FRAME_SAMPLES=90;
export function medianGap(gaps:number[]){
 if(gaps.length<12)return null;
 const sorted=[...gaps].sort((a,b)=>a-b);
 return sorted[Math.floor(sorted.length/2)];
}

function diagnostics(el:HTMLElement|null,e:Estimate|null,v:Visual|null,frames=0,wall=0,screen:{x:number;y:number}|null=null,frameMs:number|null=null){
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
 // The middle frame interval of the last 90, in milliseconds: how fast this device is actually
 // drawing. Empty until enough consecutive frames have been drawn to mean anything.
 el.setAttribute('data-frame-ms',frameMs===null?'':frameMs.toFixed(1));
}

function motionInfo(e:Estimate,v:Visual,profile:ErrorProfile|null,params:MotionParams,now:number,
                    travelling=false):MotionInfo{
 const band=e.mode==='estimated'?uncertaintyAt(profile,e.reportAge):null;
 // A correction is mentioned while it is recent, not for as long as the bus stays selected.
 const last=v.lastCorrection&&now-v.lastCorrection.at<=30_000?v.lastCorrection:null;
 return {mode:e.mode,reason:e.reason,reportAge:Math.round(e.reportAge),capped:e.capped,horizon:params.horizon,
  // `between` is this instant (a travel in flight); `travels` is the mode. The label follows the
  // instant and the explanation follows the mode (describeMotion), so a bus standing at a report
  // is never captioned as moving, and the flip between the two labels is explained once.
  between:e.mode==='observed'&&v.glide!==null&&now<v.glide.at+v.glide.ms,
  travels:e.mode==='observed'&&travelling,
  speedKmh:e.mode==='estimated'&&e.speed!==null?Math.round(e.speed*3.6):null,
  eased:e.mode==='estimated'&&(e.speed??0)>0&&params.decay>0,
  uncertaintyMetres:band?.metres??null,uncertaintyN:band?.n??null,
  correction:last?{kind:last.kind,metres:last.metres,at:last.at}:null,
  version:params.version};
}

// While these are the reason, the bus is shown at its report only until they load.
const CHECKING='checking whether its movement can be estimated',LOADING='loading its road geometry';

type Inputs={ready:boolean;paused:boolean;selected?:FollowBus;selectionKind?:SelectionKind;history:History|null;track:Track|null;blocked:string|null;provisional:boolean;replay:boolean;
 params:MotionParams;profile:ErrorProfile|null;clockOffsetMs:number;view:MapView;follow:boolean;
 model:BusModel|null;modelShown:boolean;here?:Here|null;stop?:Stop|null;walk:Props['walk'];
 onMotion?:(info:MotionInfo|null)=>void};

/** The ride-along's camera state, kept in a ref for the frame loop and mirrored to React. */
type Ride={state:RideState;camera:'outside'|'front';transition:number;
 pointer:{down:boolean;moved:boolean};settling:boolean;
 /** Fingers on the map now, and when a finger last moved or lifted (performance.now()); while there
  *  are any, and not for longer than a still finger could mean a lift the page never heard, the
  *  frame loop leaves the camera to them. */
 touches:number;touchAt:number};

/**
 * The map. Reports are drawn where they were made. The chosen bus may also be drawn at a
 * clearly labelled estimate between reports, which moves only along accepted road geometry,
 * is corrected smoothly as each report arrives, and is never stored or treated as a report.
 */
export default function CityMap({paused=false,buses,selected,selectionKind,stop,here,follow,onSelect,onManualMove,
                                 onUnavailable,view,onViewChange,theme,onThemeChange,fitRequest=0,
                                 onLocate,locating,originKind='device',pickingOrigin=false,onPickOrigin,
                                 rideOverlay,busLabel='Your bus',walk=null,
                                 clockOffsetMs=0,motion,onMotion,onRideState,stopsAhead=NO_STOPS,onSimpleMap}:Props){
 const root=useRef<HTMLDivElement>(null);
 const container=useRef<HTMLDivElement>(null);
 // Read by the map's one click handler: set while a starting point is being chosen, else null.
 const pickRef=useRef<((point:{lat:number;lon:number})=>void)|null>(null);
 // Looking around in the street preview: degrees off the road ahead, set by a one-finger drag
 // and eased back to straight ahead on release. Following never stops for it: a passenger turning
 // their head is still on the bus. `down` is the primary pointer's last x while it is held.
 const look=useRef({offset:0,down:null as number|null,lastT:0});
 // The frame loop parks when nothing is left to draw (line ~1024: it re-arms only while `more`).
 // A held head-turn on a standing bus draws nothing new, so the loop idled and the turn was never
 // painted; measured 20 September: listener attached and firing, attribute stale. The pointer
 // handlers wake it through this ref, since kick() is defined after the effect that registers them.
 const wake=useRef<()=>void>(()=>{});
 useEffect(()=>{pickRef.current=pickingOrigin&&onPickOrigin?onPickOrigin:null;
  const canvas=map.current?.getCanvas();if(canvas)canvas.style.cursor=pickingOrigin?'crosshair':'';},[pickingOrigin,onPickOrigin]);
 const hudRef=useRef<HTMLDivElement>(null),launchRef=useRef<HTMLButtonElement>(null),lastView=useRef(view);
 const map=useRef<MapLibreMap|null>(null);
 const [ready,setReady]=useState(false);
 const [painted,setPainted]=useState(false);
 const [model,setModel]=useState<BusModel|null>(null);
 const [modelFailed,setModelFailed]=useState(false);
 const [track,setTrack]=useState<(TrackResult&{patternId:string})|null>(null);
 const [motionModel,setMotionModel]=useState<MotionModel|null|undefined>(undefined);
 const [rideState,setRideState]=useState<RideState>('off');
 // The passenger's choice of viewpoint, kept for the visit. The front view is used only where it
 // can be drawn honestly (frontReason below), and never changes which bus is followed.
 const [cameraWish,setCameraWish]=useState<'outside'|'front'>('outside');
 const [frontNote,setFrontNote]=useState<string|null>(null);
 const leaveFront=useRef<((note:string)=>void)|null>(null);
 // The map's own road widths, kept while the front view draws roads at real widths.
 const savedWidths=useRef(new Map<string,unknown>());
 useEffect(()=>{leaveFront.current=note=>{setCameraWish('outside');setFrontNote(note)}},[]);
 // Once the passenger drags, pinches or zooms, the view is theirs until they ask again.
 const userMoved=useRef(false);
 // The last report the camera was brought to, or that a fit framed: `${key}|${observedAtMs}`.
 const broughtTo=useRef('');
 // The theme the map is created in; later changes are applied in place, never by rebuilding.
 const themeRef=useRef(theme);
 const modelRequested=useRef(false);
 const viewRef=useRef(view);
 const visualRef=useRef<Visual|null>(null);
 const estimateRef=useRef<Estimate|null>(null);
 const ride=useRef<Ride>({state:'off',camera:'outside',transition:0,pointer:{down:false,moved:false},settling:false,touches:0,touchAt:0});
 const wasRiding=useRef(false);
 // The bus being ridden, so a change of bus mid-ride re-frames rather than being mistaken for a move.
 const rideKey=useRef('');
 const returnRef=useRef<(fast?:boolean,as?:'entering'|'returning')=>void>(()=>{});
 const resumeTimer=useRef<{at:number;timer:ReturnType<typeof setTimeout>}|null>(null);
 const loop=useRef({raf:null as number|null,lastDraw:0,lastDiag:0,lastFront:0,lastFrontT:0,
  frontBearing:null as number|null,infoKey:'',drawn:false,frames:0,
  // How long the last few frames took, so a view that has become a slideshow can say so rather
  // than look frozen. Written to data-frame-ms; read by the front view's own guard.
  gaps:[] as number[],lastTick:0,
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

 // Diagnostic, not a feature: where every other bus is drawn on the canvas, written when the map
 // settles and when the buses change, so a check can tap the rendered marker itself and leave
 // MapLibre's own hit-testing to decide what it meets.
 const busPoints=useRef<()=>void>(()=>{});
 useEffect(()=>{
  busPoints.current=()=>{
   const instance=map.current,el=root.current;
   if(!instance||!el)return;
   const {clientWidth:width,clientHeight:height}=instance.getContainer();
   const points=busCollection().features.map(feature=>{
    const [lon,lat]=feature.geometry.coordinates,at=instance.project([lon,lat]);
    return {key:feature.properties.key,x:Math.round(at.x),y:Math.round(at.y)};
   }).filter(p=>p.x>=0&&p.y>=0&&p.x<=width&&p.y<=height).slice(0,80);
   el.setAttribute('data-bus-points',JSON.stringify(points));
  };
  busPoints.current();
 },[busCollection]);

 // --- create once -----------------------------------------------------------------
 useEffect(()=>{
  if(!container.current||map.current)return;
  if(!webglAvailable()){onUnavailable('no_webgl');return}
  let cancelled=false;
  // Bound the start itself, including a stalled dynamic import: the module, the map and its WebGL
  // context, and a first frame drawn. The network's tiles are not part of it: timed together, one
  // tile arriving after 7 s turned a working map into the fallback for the whole visit. Parent
  // clock updates must not restart these watchdogs. Unmounting cancels them and any pending startup.
  const firstFrame=setTimeout(()=>{if(!cancelled)onUnavailable('startup_timeout')},7000);
  let noTiles:ReturnType<typeof setTimeout>|undefined,tileWait:ReturnType<typeof setTimeout>|undefined;
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
   }catch{onUnavailable('create_failed');return}
   // North stays up unless a view deliberately turns it: no accidental two-finger rotation.
   instance.touchZoomRotate.disableRotation();
   instance.keyboard.disableRotation();
   instance.on('error',(event:{error?:{message?:string}})=>{
    // A failed tile is survivable; a failed style is not, and we fall back rather than
    // leave the passenger looking at an empty rectangle.
    if(event?.error&&/style/i.test(String(event.error?.message??'')))onUnavailable('style_failed');
   });
   instance.on('load',()=>{
    if(cancelled)return;
    addOverlay(instance,themeRef.current);
    // The front view's own street furniture: a footway either side of the carriageway and a
    // broken centre line, at the road class's real widths in metres. Nothing per street is
    // invented: a primary road gets a primary road's pavement whether or not this one has it,
    // and the HUD still calls the whole view a preview. Hidden until the camera is inside.
    try{
     const fr=FRONT[themeRef.current];
     const under=instance.getLayer('lm-minor-casing')?'lm-minor-casing':undefined;
     instance.addLayer({id:'lm-front-pavement',type:'line',source:'openmaptiles','source-layer':'transportation',minzoom:15,
      filter:['all',['match',['get','class'],['primary','trunk','secondary','tertiary','minor'],true,false],['!=',['get','brunnel'],'tunnel']],
      layout:{visibility:'none','line-cap':'round','line-join':'round'},
      paint:{'line-color':fr.pavement,'line-width':['match',['get','class'],['primary','trunk'],metresWide(9+4.4),
       ['secondary','tertiary'],metresWide(7.5+4.4),metresWide(6+3.6)] as never}} as never,under);
     instance.addLayer({id:'lm-front-markings',type:'line',source:'openmaptiles','source-layer':'transportation',minzoom:16,
      filter:['all',['match',['get','class'],['primary','trunk','secondary','tertiary'],true,false],['!=',['get','brunnel'],'tunnel']],
      layout:{visibility:'none','line-cap':'butt','line-join':'round'},
      // A 2 m dash and a 7 m gap, in units of the 0.15 m line: the ordinary broken centre line.
      paint:{'line-color':fr.marking,'line-opacity':0.85,'line-width':metresWide(0.15) as never,'line-dasharray':[13,47]}} as never);
    }catch{/* an older style without these road layers: the preview simply has no furniture */}
    // One handler for every bus drawn: the one nearest the tap, among those within a finger's
    // reach of it. A handler per layer fired for each layer under the tap, and the chosen bus's
    // layer, registered last, always won, so a bus beside the chosen one could not be tapped; and
    // a marker's 13 px disc was a small target for a finger.
    instance.on('click',(event:MapMouseEvent)=>{
     // Choosing a starting point: the tap is a place, not a bus, and nothing else is chosen by it.
     if(pickRef.current){pickRef.current({lat:event.lngLat.lat,lon:event.lngLat.lng});return}
     // Every way a bus is drawn is a way to tap it: its flat marker, its route number beside it,
     // and, from zoom 18, the 3D model, its ground ring and its badge. Until 20 September 2026
     // only the two marker layers were tested, so the route number was dead to a tap and the
     // drawn bus itself — most of the screen in a ride-along — could not be tapped at all.
     const layers=SELECTABLE.filter(id=>instance.getLayer(id));
     if(!layers.length)return;
     const {x,y}=event.point,m=TAP_MARGIN;
     let best:string|null=null,nearest=Infinity;
     for(const feature of instance.queryRenderedFeatures([[x-m,y-m],[x+m,y+m]],{layers})){
      const key=feature.properties?.key;
      if(typeof key!=='string'||!key)continue;
      // A point is measured from where it is drawn. A shape (the model, or a label's box) has no
      // one point, so it is measured from the bus it belongs to where that is carried, and
      // otherwise counts as a hit at arm's length, so a marker nearer the finger still wins.
      const anchor=feature.geometry.type==='Point'?feature.geometry.coordinates as [number,number]
       :typeof feature.properties?.alat==='number'?[feature.properties.alon,feature.properties.alat] as [number,number]
       :null;
      const d=anchor?(()=>{const at=instance.project(anchor);return Math.hypot(at.x-x,at.y-y)})():m;
      if(d<nearest){nearest=d;best=key}
     }
     if(best)onSelect(best);
    });
    for(const layer of ['lm-bus-marker','lm-sel-marker','lm-bus-label','lm-bus-model']){
     instance.on('mouseenter',layer,()=>{instance.getCanvas().style.cursor='pointer'});
     instance.on('mouseleave',layer,()=>{instance.getCanvas().style.cursor=''});
    }
    setReady(true);
   });
   // Every vector tile failing leaves markers floating on an empty background, which is not
   // a usable map. At the first settled frame, if tiles were requested and none arrived,
   // fall back like any other failed start. Individual tile failures are tolerated, and so is a
   // slow network. Until the tile service has answered at all (its TileJSON), 12 s from the camera
   // last coming to rest; once it has, 40 s for a first whole tile. On a slow network that takes
   // round trips in turn: the tile, then the glyphs its labels need, and a tile counts as loaded
   // only once its labels are laid out. With some tiles in, a late one is waited for up to 25 s
   // before the map counts as painted anyway.
   let tileErrors=0,tilesLoaded=0,shown=false,answered=false;
   const paint=()=>{if(shown||cancelled)return;shown=true;clearTimeout(noTiles);clearTimeout(tileWait);setPainted(true)};
   const armNoTiles=()=>{
    clearTimeout(noTiles);
    noTiles=setTimeout(()=>{if(!cancelled&&!shown&&tilesLoaded===0)onUnavailable('tiles_failed')},answered?40000:12000);
   };
   instance.on('error',(event:{error?:unknown;sourceId?:string;tile?:unknown})=>{
    if(event?.sourceId==='openmaptiles'||(!event?.sourceId&&event?.tile))tileErrors+=1;
   });
   instance.on('sourcedata',(event:{sourceId?:string;tile?:unknown;sourceDataType?:string})=>{
    if(event?.sourceId!=='openmaptiles')return;
    if(event.tile)tilesLoaded+=1;
    if(!answered&&event.sourceDataType==='metadata'){answered=true;if(noTiles!==undefined)armNoTiles()}
   });
   instance.once('render',()=>{
    clearTimeout(firstFrame);
    armNoTiles();
    tileWait=setTimeout(()=>{if(!cancelled&&!shown&&tilesLoaded>0)paint()},25000);
   });
   instance.on('moveend',()=>{if(!shown&&tilesLoaded===0&&noTiles!==undefined)armNoTiles()});
   instance.once('idle',()=>{
    clearTimeout(firstFrame);
    if(cancelled)return;
    if(tileErrors>0&&tilesLoaded===0){onUnavailable('tiles_failed');return}
    paint();
   });
   // Diagnostic, not a feature: the camera as text, written straight to the element so a
   // moving camera does not re-render the page on every frame.
   instance.on('moveend',()=>{
    const centre=instance.getCenter();
    // Centimetres and tenths of a degree: fine enough to measure how smoothly it moves per frame.
    root.current?.setAttribute('data-camera',`${instance.getZoom().toFixed(3)},${centre.lat.toFixed(7)},`
     +`${centre.lng.toFixed(7)},${instance.getPitch().toFixed(1)},${instance.getBearing().toFixed(1)}`);
    // The map's own padding, as MapLibre holds it: a fit that lands wrong with the right bounds
    // is a padding that was not what the fit assumed, and this is the only way to see it.
    const p=instance.getPadding();
    root.current?.setAttribute('data-padding',`${Math.round(p.top??0)},${Math.round(p.right??0)},${Math.round(p.bottom??0)},${Math.round(p.left??0)}`);
    // The last few places the camera stopped, in order, so a wrong final position can be told
    // apart from a right one that something moved afterwards.
    const trail=(root.current?.getAttribute('data-moves')??'').split(';').filter(Boolean);
    trail.push(`${instance.getZoom().toFixed(2)}@${centre.lat.toFixed(5)},${centre.lng.toFixed(5)}`);
    root.current?.setAttribute('data-moves',trail.slice(-6).join(';'));
   });
   instance.on('idle',()=>busPoints.current());
   // The drawn bus's place on the canvas changes when the camera moves as well as when the bus
   // does; a standing bus draws no frames, so it is projected here too, and so is the stop.
   instance.on('move',()=>{
    if(!root.current)return;
    const v=visualRef.current,s=inputs.current.stop;
    if(v){const at=instance.project([v.lon,v.lat]);root.current.setAttribute('data-bus-screen',`${Math.round(at.x)},${Math.round(at.y)}`)}
    if(s){const at=instance.project([s.lon,s.lat]);root.current.setAttribute('data-stop-screen',`${Math.round(at.x)},${Math.round(at.y)}`)}
   });
   // A gesture is the passenger taking over. MapLibre marks its own camera events with the
   // DOM event that caused them; ours carry none, so they can never pass as gestures. In the
   // ride-along a drag pauses following ("Return to bus" resumes it) and a zoom keeps following
   // at the passenger's zoom; either ends the glide to the bus where it is.
   const gesture=(kind:'drag'|'zoom')=>(event:{originalEvent?:unknown})=>{
    if(!event.originalEvent)return;
    const r=ride.current;
    if(viewRef.current==='ride'){
     r.pointer.moved=true;
     // Paused for a new journey, the ride waits for the passenger's choice, not for "Return to bus".
     if(r.state==='paused')return;
     // In the front view the camera sets its own height every frame, so a zoom would be undone at
     // once: like a drag, it pauses following, and "Return to bus" resumes it.
     if(kind==='drag'||r.camera==='front'||r.state==='entering'||r.state==='returning'){
      r.transition+=1;
      if(r.state!=='exploring')setRide('exploring');
     }
     return;
    }
    userMoved.current=true;onManualMove();
   };
   instance.on('dragstart',gesture('drag'));
   instance.on('zoomstart',gesture('zoom'));
   // A finger or a pointer on the map while the camera glides to the bus stops that move at
   // once, before MapLibre decides whether it is a drag: chaining the next move on the
   // interrupted one's end would otherwise swallow the drag. A tap that moves nothing finishes
   // the glide quickly instead of stranding the passenger mid-way.
   const canvasBox=instance.getCanvasContainer();
   const lookDown=(e:PointerEvent)=>{
    if(e.isPrimary&&ride.current.camera==='front'&&ride.current.state==='following'){look.current.down=e.clientX;wake.current()}
   };
   const lookCancel=(e:PointerEvent)=>{if(e.isPrimary){look.current.down=null;wake.current()}};
   const lookMove=(e:PointerEvent)=>{
    const lk=look.current;if(lk.down===null||!e.isPrimary)return;
    // A full width of drag turns the head 160°; clamped so the passenger cannot look backwards through the seat.
    lk.offset=Math.max(-150,Math.min(150,lk.offset+(e.clientX-lk.down)/Math.max(1,canvasBox.clientWidth)*160));
    lk.down=e.clientX;wake.current();
   };
   const lookUp=(e:PointerEvent)=>{if(e.isPrimary){look.current.down=null;wake.current()}};
   // On our own element, the map's container, in the capture phase, so nothing MapLibre does on
   // its own container can precede it.
   const lookHost=container.current;
   lookHost.addEventListener('pointerdown',lookDown,true);lookHost.addEventListener('pointermove',lookMove,true);
   lookHost.addEventListener('pointerup',lookUp,true);lookHost.addEventListener('pointercancel',lookCancel,true);
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
   // A wheel or a pinch in the front view is the passenger taking over, as a drag is. It must pause
   // following before the next frame places the camera, since placing it stops MapLibre's own
   // handlers: otherwise the zoom is cancelled before it begins and the wheel does nothing.
   const takeOver=()=>{
    const r=ride.current;
    if(viewRef.current!=='ride')return;
    if(r.state==='entering'||r.state==='returning'){r.transition+=1;instance.stop();setRide('exploring')}
    // Nothing of ours is moving here, and stopping would reset MapLibre's own zoom as it begins.
    else if(r.camera==='front'&&r.state==='following'){r.transition+=1;setRide('exploring')}
   };
   canvasBox.addEventListener('wheel',takeOver,{passive:true});
   canvasBox.addEventListener('touchstart',(event:TouchEvent)=>{if(event.touches.length>1)takeOver()},{passive:true});
   // How many fingers are on the map, so the frame loop leaves the camera to them. A touch's events
   // all go to the element it began on, so these see every finger lift.
   const fingers=(event:TouchEvent)=>{ride.current.touches=event.touches.length;ride.current.touchAt=performance.now()};
   for(const type of ['touchstart','touchmove','touchend','touchcancel'] as const)canvasBox.addEventListener(type,fingers,{passive:true});
   map.current=instance;
  })().catch(()=>{if(!cancelled)onUnavailable('module_failed')});
  return()=>{cancelled=true;clearTimeout(firstFrame);clearTimeout(noTiles);clearTimeout(tileWait);
   map.current?.remove();map.current=null};
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
  busPoints.current();
  // Until the passenger has taken the camera, a new report that lands outside the frame
  // brings the frame to it; a journey the passenger has not chosen to go on with is not chased.
  if(!selected||follow||view==='ride'||userMoved.current||selectionKind==='new_journey')return;
  // A *new* report, by the bus and the moment it reported: this effect runs on every re-render
  // that gives `selected` a new identity, and a theme switch or a poll does that with the same
  // report as before. Until 21 September 2026 the same report, sitting a few pixels outside the
  // padding a fit had just placed it on, then pulled the camera onto the bus and the stop off the
  // map — measured as the bus landing on the exact centre of the canvas in every failing run of
  // the fitted-map check. A fit marks the report it framed as seen (fitRelevant), so what the
  // passenger just asked for is never undone by the report they asked for it with.
  const reportKey=`${selected.key}|${selected.observedAtMs}`;
  if(reportKey===broughtTo.current)return;
  broughtTo.current=reportKey;
  const point=instance.project([selected.lon,selected.lat]);
  const {clientWidth:width,clientHeight:height}=instance.getContainer();
  // Under a control counts as outside: a bus behind the Ride along button is not in view.
  const pad=fitPadding(instance.getContainer());
  if(point.x<pad.left||point.y<pad.top||point.x>width-pad.right||point.y>height-pad.bottom){
   move(m=>m.easeTo({center:[selected.lon,selected.lat],duration:prefersReducedMotion()?0:450}));
  }
 },[ready,busCollection,selected,selectionKind,follow,view,move]);

 useEffect(()=>{
  const instance=map.current;
  if(!ready||!instance)return;
  const source=instance.getSource(STOP_SOURCE) as GeoJSONSource|undefined;
  source?.setData({type:'FeatureCollection',features:stop?[{type:'Feature',
   geometry:{type:'Point',coordinates:[stop.lon,stop.lat]},
   properties:{label:stop.indicator?`${stop.name} (${stop.indicator})`:stop.name}}]:[]});
  // Diagnostic, as for the bus: where the stop is on the canvas, refreshed on every camera move.
  if(!stop){root.current?.removeAttribute('data-stop-screen');return}
  const at=instance.project([stop.lon,stop.lat]);
  root.current?.setAttribute('data-stop-screen',`${Math.round(at.x)},${Math.round(at.y)}`);
 },[ready,stop]);

 // The next stops on the chosen bus's pattern, labelled in the front view (hidden elsewhere). The
 // list is compared as text, so it is redrawn only when the stops themselves change.
 const aheadData=JSON.stringify(stopsAhead);
 useEffect(()=>{
  const instance=map.current;
  if(!ready||!instance)return;
  const list=JSON.parse(aheadData) as typeof NO_STOPS;
  (instance.getSource(STOPS_AHEAD_SOURCE) as GeoJSONSource|undefined)?.setData({type:'FeatureCollection',
   features:list.map(s=>({type:'Feature' as const,geometry:{type:'Point' as const,coordinates:[s.lon,s.lat]},
    properties:{label:s.label}}))});
  root.current?.setAttribute('data-stops-ahead',String(list.length));
 },[ready,aheadData]);

 // The detailed map slow to arrive: after a few seconds the simple map is offered in its place,
 // while the bus information beside the map is already there.
 const [slow,setSlow]=useState(false);
 useEffect(()=>{
  if(painted)return;
  const timer=setTimeout(()=>setSlow(true),3000);
  return()=>clearTimeout(timer);
 },[painted]);

 // A bigger map, most of the screen, for following a bus closely; the page scrolls to it.
 const [expanded,setExpanded]=useState(false);
 useEffect(()=>{
  if(!ready)return;
  const frame=requestAnimationFrame(()=>{
   map.current?.resize();
   if(expanded)root.current?.scrollIntoView({block:'start',behavior:prefersReducedMotion()?'auto':'smooth'});
  });
  return()=>cancelAnimationFrame(frame);
 },[ready,expanded]);

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
    properties:{kind:'point',label:originKind==='chosen'?'Start':'You'}}]});
 },[ready,here,originKind]);

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
 // The pattern whose road the estimate follows: the matched one. An unresolved bus with several
 // candidates gets no pattern here: which journey it is stays open. It may still get a road, below,
 // where the candidates' geometry is measured to coincide, never because their stop lists do.
 const patternId=!selected?.match?null:'patternId' in selected.match?selected.match.patternId:null;
 const candidateIds=useMemo(()=>!selected?.match||'patternId' in selected.match?null
  :selected.match.candidates?.map(c=>c.patternId)??null,[selected]);
 const candidateKey=candidateIds?[...new Set(candidateIds)].sort().join('|'):'';
 const [shared,setShared]=useState<SharedRoad|null>(null);
 useEffect(()=>{
  let current=true;
  if(patternId){
   setShared(null);
   loadTrack(patternId).then(result=>{if(current)setTrack({...result,patternId})});
  }else if(candidateKey){
   loadSharedTrack(candidateKey.split('|')).then(result=>{
    if(!current)return;
    // Keyed by the candidate set, so a track from one set is never read against another.
    setTrack({track:result.track,reason:result.reason,patternId:candidateKey});
    setShared(result.shared);
   });
  }else{setShared(null)}
  return()=>{current=false};
 },[patternId,candidateKey]);
 // Where along the road the bus's own last report sits, and how much road the drawn estimate
 // and the camera can reach beyond it: at most the measured horizon at the capped speed, plus
 // the front view's look-ahead. On shared road only if the whole of that is shared.
 const LOOK_AHEAD_METRES=17*30+32;
 const trackKey=patternId??candidateKey;
 useEffect(()=>{
  let current=true;
  loadMotionModel().then(value=>{if(current)setMotionModel(value)});
  return()=>{current=false};
 },[]);
 const history=useMemo(()=>selected?historyOf(selected):null,[selected]);
 const trackFor=track&&track.patternId===trackKey?track:null;
 const onSharedRoad=useMemo(()=>{
  if(patternId||!trackFor?.track||!shared||!selected)return patternId?true:null;
  const along=project(trackFor.track,{lat:selected.lat,lon:selected.lon}).s;
  return withinSharedRoad(shared,along,LOOK_AHEAD_METRES);
 },[patternId,trackFor,shared,selected,LOOK_AHEAD_METRES]);
 // Why no estimate is drawn, in words; null when one may be.
 const blocked=!selected?null
  :motion&&!motion.enabled?motion.reason??'reported positions only'
  :!patternId&&!candidateKey?(selected.match&&'unresolved' in selected.match&&selected.match.unresolved==='ambiguous_branch'
    ?'its branch is not settled, so the road ahead is not known':'it is not placed on a timetable pattern')
  :!patternId&&trackFor&&!trackFor.track?trackFor.reason??'its branch is not settled, so the road ahead is not known'
  :!patternId&&onSharedRoad===false?'its branch is not settled, and the candidates’ roads are only known to coincide further on'
  :motionModel===undefined?CHECKING
  :motionModel===null?'movement has not been evaluated yet'
  :!motionModel.patterns.has(patternId??trackFor?.track?.id??'')?'movement on this service has not been evaluated'
  :!trackFor?LOADING
  :!trackFor.track?trackFor.reason??'no road geometry'
  :null;
 // A chosen bus with no current report is not drawn as a bus: only its hollow last-report marker.
 const modelShown=view!=='2d'&&model!==null&&Boolean(selected)&&selectionKind!=='absent';
 const provisional=blocked===CHECKING||blocked===LOADING;
 // The front view needs the road the bus is on, checked against its own reports: an accepted
 // road shape. Without one it would be guesswork at eye level, so the ride stays outside and
 // says why. Stop-to-stop straight lines are never used instead.
 const frontReason=!selected?null
  :trackFor===null&&(patternId||candidateKey)?'Front view is waiting for this bus’s road geometry.'
  :!trackFor?.track?(candidateKey
    ?`Front view needs one road it can be sure of. Which journey this bus is on is not settled, and ${trackFor?.reason?.replace(/^its branch is not settled, and /,'')??'the candidates’ roads have not been compared'}. It is shown from outside.`
    :'Front view needs the road this bus is on, checked against its own reports. This service has none yet, so it is shown from outside.')
  :!patternId&&onSharedRoad===false?'Front view is shown only where every candidate journey follows the same checked road. Here, before they join, the road ahead depends on which journey this is, so it is shown from outside.'
  :null;
 // What the button itself can say, before it is pressed. A control that looks ready and then
 // refuses is worse than one that says what it is waiting for: "checking" is a moment, "not on
 // this route" is the service, and "not settled here" changes as the bus goes on.
 const frontState=!frontReason?'ready'
  :trackFor===null?'checking'
  :candidateKey&&!trackFor?.track?'unsettled'
  :!trackFor?.track?'unsupported':'unsettled';
 const FRONT_LABEL:Record<string,string>={ready:'Front view',checking:'Front view · checking',
  unsupported:'Front view · not on this route',unsettled:'Front view · not here yet'};
 // The button says on its face what it can do, so nothing is hidden behind pressing it; pressing
 // it gives the whole reason in the ride's notes. It is not marked `aria-disabled`, because it
 // does respond, and a stack of permanent notes over the map crowds out the ride card.
 const camera=view==='ride'&&cameraWish==='front'&&!frontReason?'front':'outside';
 const frontFallback=view==='ride'&&cameraWish==='front'&&frontReason?frontReason:null;

 // --- the presentation clock -------------------------------------------------------------
 const inputs=useRef<Inputs>({ready:false,paused:false,history:null,track:null,blocked:null,provisional:false,replay:true,params:DEFAULT_PARAMS,
  profile:null,clockOffsetMs:0,view:'2d',follow:false,model:null,modelShown:false,walk:null});
 const frame=useCallback(function tick(){
  const state=loop.current;
  state.raf=null;
  state.frames+=1;
  const input=inputs.current,instance=map.current;
  if(!instance||!input.ready)return;
  // Behind the data: draw nothing and schedule nothing. The loop is started again on the way back,
  // with the drawing reset, so the bus reappears where the estimate says it is now rather than
  // crawling to catch up across the minutes nobody was watching.
  if(input.paused){state.gaps.length=0;state.lastTick=0;return}
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
  // Another bus, or the same vehicle on another journey, is a new drawing, never a correction of
  // the last one: the other journey's reports say nothing about where this one is going.
  const drawKey=`${input.selected.key}|${input.selected.route}|${input.selected.direction}|${input.selected.journeyRef}`;
  if(state.key!==drawKey){state.key=drawKey;visualRef.current=null}
  // One clock for everything drawn: the server's, as report ages use, and never stepped.
  state.clock=tickClock(state.clock,Date.now(),input.clockOffsetMs);
  const now=state.clock.now;
  const e=input.blocked||!input.track?observedAt(input.history,now,input.blocked??'no road geometry',input.provisional)
   :estimate(input.history,input.track,now,input.params);
  // With no accepted road geometry the bus travels between its own reports rather than jumping
  // (GLIDE): movement without prediction. "Reported positions only" means exactly that — the
  // newest report and nothing between — so the history is withheld and the travel does not start.
  const v=stepVisual(visualRef.current,e,now,e.mode==='estimated'?input.track:null,drawingFor(e,input.profile),
   input.replay?input.history:null);
  visualRef.current=v;estimateRef.current=e;
  const t=performance.now();
  // Frame intervals, over about the last second and a half of continuous animation. A gap longer
  // than a second is the loop having rested (a standing bus costs no frames) and starts a fresh
  // measurement rather than counting the rest as a slow frame.
  if(state.lastTick&&t-state.lastTick<1000)state.gaps.push(t-state.lastTick);
  else state.gaps.length=0;
  state.lastTick=t;
  if(state.gaps.length>FRAME_SAMPLES)state.gaps.splice(0,state.gaps.length-FRAME_SAMPLES);
  // In the ride-along the camera moves every frame, so the bus is drawn every frame too: drawn
  // at half the camera's rate it shimmied against the street. Elsewhere 30 a second is plenty.
  if(!state.drawn||t-state.lastDraw>=(input.view==='ride'?0:32)){
   state.lastDraw=t;state.drawn=true;
   selectedSource?.setData({type:'FeatureCollection',features:[{type:'Feature',
    geometry:{type:'Point',coordinates:[v.lon,v.lat]},
    properties:{key:input.selected.key,route:input.selected.route,
     icon:`lm-sel-${input.selectionKind==='absent'?'lost-':''}${v.bearing!==null?'arrow':'dot'}`,
     rotate:v.bearing??0,caption:input.selectionKind==='absent'?'NO NEW REPORT'
      :input.selectionKind==='new_journey'?'ANOTHER JOURNEY':e.mode==='estimated'?'ESTIMATE':''}}]});
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
    ?{type:'FeatureCollection',features:v.bearing!==null?orientedBus(input.model,v,v.bearing,input.selected.key)
      :unorientedToken(input.model,v,input.selected.key)}
    :EMPTY);
  }
  // Model, marker and camera all follow the same drawn state. Only the centre (and in the
  // ride-along the heading) is set: the passenger's zoom and tilt are left alone. Nothing is
  // set while the map is already moving (a gesture, an animated zoom, a glide of ours): a jump
  // then would cancel it. Once it ends, a camera left far from the bus glides back.
  const r=ride.current;
  // Following is about the camera, not about estimation: a bus shown at its reports is followed
  // to each report it makes (it glides there, GLIDE in lib/motion.ts). Until 20 September 2026
  // this also required an estimate, so Follow on the map did nothing at all on a service with no
  // accepted road geometry — which was most of them.
  const following=input.view==='ride'?r.state==='following':input.follow;
  // Nor while fingers are on the map: between a touch and MapLibre's taking it as a pinch or a drag
  // the map counts as still, and placing the camera then stops its touch handlers, so the gesture
  // was lost before it began (a pinch in the outside ride-along did nothing). Once they lift, a
  // camera left off the bus glides back, at the passenger's zoom. A count unchanged for 8 s is not
  // trusted: a lift the page never heard would otherwise hold the camera still for good, and in
  // the street preview, where the bus itself is hidden, that would look like a frozen picture.
  // A held pointer normally pauses placing the camera, so a pinch or a drag is not undone. In
  // the street preview a held single pointer *is* the camera input (the head-turn), so it does
  // not count; two touches, a pinch, still do.
  const headTurning=r.camera==='front'&&look.current.down!==null&&r.touches<2;
  const touching=r.touches>0&&t-r.touchAt<8000&&!headTurning;
  if(following&&!instance.isMoving()&&!touching){
   if(input.view==='ride'&&r.camera==='front'){
    // Inside the bus: the eye is set from the displayed state every frame (every few seconds
    // under reduced motion), so it holds, eases and corrects exactly as the bus is drawn. It
    // looks along the road ahead, eased with a 0.4 s time constant, so each corner of the road's
    // shape turns the view smoothly rather than with a jolt.
    const aim=input.track?frontAim(input.track,v):null;
    if(aim){
     const gap=t-state.lastFrontT;
     state.frontBearing=state.frontBearing===null||gap>500?aim.bearing
      :turnToward(state.frontBearing,aim.bearing,1-Math.exp(-gap/400));
     state.lastFrontT=t;
    }
    // The head-turn: held, it stays where the finger put it; released, it eases back over ~0.6 s.
    const lk=look.current;
    if(lk.down===null&&lk.offset!==0){const dt=lk.lastT?t-lk.lastT:16;lk.offset*=Math.exp(-dt/600);if(Math.abs(lk.offset)<0.4)lk.offset=0}
    lk.lastT=t;
    const turned=state.frontBearing===null?undefined:(state.frontBearing+lk.offset+360)%360;
    // Diagnostic, not a feature: the head-turn's inputs, so a browser check can read what the
    // loop saw rather than infer it from the camera.
    root.current?.setAttribute('data-look',`${lk.offset.toFixed(1)},${lk.down===null?'up':'held'},${state.frontBearing===null?'null':state.frontBearing.toFixed(1)}`);
    const front=input.track&&aim?frontCamera(instance,input.track,{...v,velocity:v.velocity},0,turned):null;
    if(!front)leaveFront.current?.('Front view ended: the bus’s latest position is off its checked road, so it is shown from outside.');
    else if(!prefersReducedMotion()||t-state.lastFront>=3000){state.lastFront=t;instance.jumpTo(front)}
   }else{
    const bearing=input.view==='ride'&&v.bearing!==null?{bearing:v.bearing}:{};
    const at=instance.project([v.lon,v.lat]),centre=instance.project(instance.getCenter());
    if(Math.hypot(at.x-centre.x,at.y-centre.y)>SETTLE_PX)
     instance.easeTo({center:[v.lon,v.lat],...bearing,duration:prefersReducedMotion()?0:280});
    else instance.jumpTo({center:[v.lon,v.lat],...bearing});
   }
  }
  // Diagnostics a few times a second, and always on the last frame before the loop rests, so a
  // bus that has just come to a stand is described as it is.
  const more=needsFrames(e,v);
  // A held or easing head-turn is something left to draw.
  const headTurnLive=look.current.down!==null||look.current.offset!==0;
  if(!more||t-state.lastDiag>=200){
   state.lastDiag=t;
   diagnostics(root.current,e,v,state.frames,t,instance.project([v.lon,v.lat]),medianGap(state.gaps));
  }
  const info=motionInfo(e,v,input.profile,input.params,now,
   Boolean(input.replay&&input.history&&input.history.fixes.length>1));
  const key=`${info.mode}|${info.reason}|${info.capped}|${info.correction?.at??0}|${Math.floor(info.reportAge/5)}|${info.speedKmh}`;
  if(key!==state.infoKey){state.infoKey=key;input.onMotion?.(info)}
  // Frames only while something moves: a standing, paused or reported-only bus costs nothing.
  // A bus held at its last reports wakes the clock a few seconds before its hold ends, so that
  // it is eased away on time rather than leaping off.
  if(more||headTurnLive)state.raf=requestAnimationFrame(tick);
  else if(e.held&&e.resumeAt&&resumeTimer.current?.at!==e.resumeAt){
   if(resumeTimer.current)clearTimeout(resumeTimer.current.timer);
   const at=e.resumeAt;
   resumeTimer.current={at,timer:setTimeout(()=>{resumeTimer.current=null;if(loop.current.raf===null)loop.current.raf=requestAnimationFrame(tick)},
    Math.max(50,e.resumeAt-now-DRAWING.smoothing*1000))};
  }
 },[]);
 const kick=useCallback(()=>{if(loop.current.raf===null)loop.current.raf=requestAnimationFrame(frame)},[frame]);
 useEffect(()=>{wake.current=kick},[kick]);
 // Coming back from the engineering area, the drawing starts again from where the estimate is now.
 // Keeping the old drawn position would make the bus creep across everything it "missed" while
 // nobody was looking, which is a correction of a gap rather than of a report.
 useEffect(()=>{if(!paused)visualRef.current=null},[paused]);
 useEffect(()=>{
  inputs.current={ready,paused,selected,selectionKind,history,track:trackFor?.track??null,blocked,provisional,
   replay:motion?.enabled!==false,
   params:motionModel?.params??DEFAULT_PARAMS,profile:motionModel?.profile??null,clockOffsetMs,
   view,follow,model,modelShown,here,stop,walk,onMotion};
  kick();
 });
 // The ids go with the frame and the timer. React's development Strict Mode unmounts and
 // remounts every component once; a cancelled frame whose id stayed behind made kick() think a
 // frame was pending, so under `next dev` the selected bus was never drawn and the ride-along
 // glided to an empty map.
 useEffect(()=>()=>{
  if(loop.current.raf!==null){cancelAnimationFrame(loop.current.raf);loop.current.raf=null}
  if(resumeTimer.current){clearTimeout(resumeTimer.current.timer);resumeTimer.current=null}
 },[]);

 // With the model drawn, the flat symbol gives way to the ring and the badge from the model's
 // zoom up; below it, and whenever there is no model, the flat symbol is the marker. "Model
 // loaded" is not "model visible": the ring and badge are symbols, drawn over any building.
 // In the front view the camera is inside the bus: its model, ring, number, caption and trail
 // are all hidden so nothing of its outside can block the view, the buildings are solid (from
 // street level a see-through block reads as a ghost), and a sky and haze fill the horizon.
 useEffect(()=>{
  const instance=map.current;
  if(!ready||!instance)return;
  const inside=camera==='front';
  try{
   instance.setLayoutProperty('lm-bus-model','visibility',modelShown&&!inside?'visible':'none');
   instance.setLayoutProperty('lm-bus-shadow','visibility',modelShown&&!inside?'visible':'none');
   instance.setLayoutProperty('lm-bus-badge','visibility',modelShown&&!inside?'visible':'none');
   instance.setPaintProperty('lm-sel-marker','icon-opacity',(inside?0:modelShown?HIDE_SELECTED_WHEN_MODEL:1) as never);
   instance.setPaintProperty('lm-sel-marker','text-opacity',(inside?0:modelShown?HIDE_SELECTED_WHEN_MODEL:1) as never);
   instance.setPaintProperty('lm-sel-ring','icon-opacity',(inside?0:modelShown?SHOW_RING_WHEN_MODEL:0) as never);
   instance.setLayoutProperty('lm-sel-caption','visibility',inside?'none':'visible');
   for(const id of SELECTED_TRAIL)instance.setLayoutProperty(id,'visibility',inside?'none':'visible');
   const extrusion=(buildingExtrusion(theme) as unknown as {paint:Record<string,unknown>}).paint;
   if(instance.getLayer('lm-buildings-3d')){
    instance.setPaintProperty('lm-buildings-3d','fill-extrusion-opacity',(inside?1:extrusion['fill-extrusion-opacity']) as never);
    instance.setPaintProperty('lm-buildings-3d','fill-extrusion-color',
     (inside?['interpolate',['linear'],['coalesce',['get','render_height'],10],
       6,FRONT[theme].extrusionLow,40,FRONT[theme].extrusionHigh]:extrusion['fill-extrusion-color']) as never);
   }
   for(const id of ['lm-front-pavement','lm-front-markings'])if(instance.getLayer(id)){
    instance.setLayoutProperty(id,'visibility',inside?'visible':'none');
    instance.setPaintProperty(id,'line-color',(id==='lm-front-pavement'?FRONT[theme].pavement:FRONT[theme].marking) as never);
   }
   // Low and to one side in the front view, so walls and roofs differ; elsewhere the map's own.
   instance.setLight((inside?FRONT[theme].light:buildStyle(theme).light) as never);
   // The sky follows the sun, not the theme: by day the theme's sky, through civil twilight a
   // blend toward the theme's twilight palette, and at night the night palette whichever theme
   // the passenger chose. Recomputed on each paint pass; the clock effect below re-runs it.
   const light=daylightAt(Date.now());
   const skyFor=()=>{
    if(!inside)return SKY_OFF;
    if(light.phase==='day')return FRONT[theme].sky;
    if(light.phase==='night')return FRONT.night.sky;
    const a=FRONT[theme].sky as Record<string,string|number>,b=FRONT[theme].twilight as Record<string,string|number>;
    return Object.fromEntries(Object.keys(a).map(k=>[k,typeof a[k]==='number'&&typeof b[k]==='number'
     ?(a[k] as number)*(1-light.dark)+(b[k] as number)*light.dark
     :light.dark<0.5?a[k]:b[k]]));
   };
   instance.setSky(skyFor() as never);
   // In the street preview a one-finger drag is a head-turn, not a pan: MapLibre's dragPan would
   // move the centre the frame loop then puts back, which is the "flies away" a passenger saw.
   // Pinch and wheel still pause following, as before. dragPan returns the moment the camera leaves.
   if(inside)instance.dragPan.disable();else{instance.dragPan.enable();look.current.offset=0;look.current.down=null}
   // The ground drops away from the road surface in the front view, so the street reads as
   // something raised to travel on rather than as one flat wash. The map's own ground comes back
   // the moment the camera leaves.
   if(instance.getLayer('lm-ground'))instance.setPaintProperty('lm-ground','background-color',
    (inside?FRONT[theme].ground:PALETTES[theme].ground) as never);
   const own=(id:string)=>(baseLayers(theme).find(l=>l.id===id) as {paint?:Record<string,unknown>}|undefined)?.paint;
   for(const [id,metres] of Object.entries(ROAD_METRES))for(const [layer,extra] of [[id,0],[`${id}-casing`,1.5]] as const){
    if(!instance.getLayer(layer))continue;
    if(inside){
     if(!savedWidths.current.has(layer))savedWidths.current.set(layer,instance.getPaintProperty(layer,'line-width'));
     instance.setPaintProperty(layer,'line-width',metresWide(metres+extra) as never);
    }else if(savedWidths.current.has(layer)){
     instance.setPaintProperty(layer,'line-width',savedWidths.current.get(layer) as never);
     savedWidths.current.delete(layer);
    }
    // A road's casing reads as its kerb in the front view, lighter than the road so the street's
    // edge shows; elsewhere it takes the current theme's own colour back.
    const kerb=inside?FRONT[theme].kerb:own(layer)?.['line-color'];
    if(extra>0&&kerb)instance.setPaintProperty(layer,'line-color',kerb as never);
   }
   // The front view's own labels: upright street names, and the next stops on the bus's pattern.
   for(const id of ['lm-front-street-name','lm-stops-ahead-dot','lm-stops-ahead-label'])
    if(instance.getLayer(id))instance.setLayoutProperty(id,'visibility',inside?'visible':'none');
   // Street and river names are laid along their lines. From eye height the name of the road
   // ahead stands on end and overlaps itself, so the front view leaves them out.
   for(const layer of instance.getStyle().layers??[])
    if(layer.type==='symbol'&&(layer.layout as Record<string,unknown>|undefined)?.['symbol-placement']==='line')
     instance.setLayoutProperty(layer.id,'visibility',inside?'none':'visible');
  }catch{/* the flat symbol stays: the 2D map is always the fallback */}
  kick();
 },[ready,modelShown,kick,camera,theme]);

 // --- camera ----------------------------------------------------------------------
 // `camera` is the tilt and heading to end at; without it the current tilt is kept.
 const fitRelevant=useCallback((camera?:{pitch:number;bearing:number})=>{
  if(!map.current)return;
  // The report this fit frames is seen: it must not bring the camera to itself afterwards.
  broughtTo.current=selected?`${selected.key}|${selected.observedAtMs}`:'';
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
  // Fitted means readable, not merely inside: the padding is the room the controls actually take,
  // measured, plus room for a marker's name.
  move(m=>m.fitBounds([[Math.min(...lons),Math.min(...lats)],[Math.max(...lons),Math.max(...lats)]],
   {padding:fitPadding(m.getContainer()),maxZoom:16.2,...camera,duration:reduce?0:500}));
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
 // The map resized under a fitted journey: a phone turned, a window resized. The fit was computed
 // for the old size and its padding, so the stop can now sit under a control or below the canvas
 // — measured on 21 September 2026 as a stop 61 px off the bottom of the map after a fit had
 // been asked for during a transient resize. Once the size settles, what the passenger last asked
 // for is framed again, unless they have taken the camera since, in which case it is theirs. The
 // ride has its own band and its own resize handling and is left alone.
 useEffect(()=>{
  const instance=map.current;
  if(!ready||!instance)return;
  let timer:ReturnType<typeof setTimeout>|null=null;
  const onResize=()=>{
   if(timer)clearTimeout(timer);
   timer=setTimeout(()=>{
    timer=null;
    if(viewRef.current==='ride'||userMoved.current)return;
    fitLatest.current();
   },250);
  };
  instance.on('resize',onResize);
  return()=>{if(timer)clearTimeout(timer);instance.off('resize',onResize)};
 },[ready]);
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

 // The ride-along's framing, from the drawn state. Outside: above and behind the bus, turned to
 // its heading. Front: the passenger's eye (frontCamera), led by how far a moving bus will have
 // gone by the end of the glide, so the glide ends where the next frame begins.
 const rideFraming=useCallback((instance:MapLibreMap,leadSeconds=0):CameraOptions&{center:LngLatLike}=>{
  const v=visualRef.current,s=inputs.current.selected,track=inputs.current.track;
  if(ride.current.camera==='front'&&track&&v){
   const e=estimateRef.current;
   const lead=e?.mode==='estimated'&&!e.held&&(e.speed??0)>0?(e.speed??0)*leadSeconds:0;
   const front=frontCamera(instance,track,{...v,velocity:v.velocity},lead);
   if(front?.center)return front as CameraOptions&{center:LngLatLike};
  }
  const centre=instance.getCenter();
  const heading=v?.bearing??s?.bearing??null;
  return {center:(v?[v.lon,v.lat]:s?[s.lon,s.lat]:[centre.lng,centre.lat]) as [number,number],zoom:RIDE_ZOOM,
   pitch:heading===null?50:60,bearing:heading??instance.getBearing()};
 },[]);

 /**
  * Every entry, "Return to bus" and a change of bus: glide to the ride framing (a jump under
  * reduced motion), then follow. The glide is obsolete the moment a gesture, another bus or
  * leaving moves the camera instead.
  */
 const returnToBus=useCallback((fast=false,as:'entering'|'returning'='returning')=>{
  const instance=map.current,r=ride.current;
  if(!instance||viewRef.current!=='ride')return;
  const token=++r.transition;
  instance.stop();
  const duration=fast?450:900;
  // Once outside again, the map's own pitch limit returns.
  const settle=()=>{
   if(r.camera==='outside'&&instance.getPitch()<=OUTSIDE_MAX_PITCH)instance.setMaxPitch(OUTSIDE_MAX_PITCH);
   setRide('following');kick();
  };
  if(prefersReducedMotion()){
   instance.jumpTo(rideFraming(instance));
   settle();
   return;
  }
  setRide(as);
  const still=()=>r.transition===token&&r.state===as;
  // The front view glides straight to the eye: its look-at point is already ahead of the bus.
  const arrived=r.camera==='front'
   ?glide(instance,{...rideFraming(instance,duration/1000),duration}).then(still)
   :approach(instance,()=>rideFraming(instance),duration,still);
  arrived.then(ok=>{if(ok)settle()});
 },[rideFraming,setRide,kick]);
 useEffect(()=>{returnRef.current=returnToBus},[returnToBus]);

 // Entering the ride-along goes straight to the bus: the map the passenger has just left already
 // showed the journey, so a tour only delayed the one thing asked for. A change of viewpoint
 // while riding glides to the new one. Leaving cancels whatever the camera was doing and returns
 // to the practical map, with its own pitch limit.
 useEffect(()=>{
  const instance=map.current,r=ride.current;
  if(!ready||!instance)return;
  if(view!=='ride'){
   if(!wasRiding.current)return;
   wasRiding.current=false;
   r.transition+=1;
   r.camera='outside';
   // Stopping the ride's camera also stops the view's own ease, so the fit carries the tilt and
   // heading of the view being returned to.
   instance.stop();
   instance.resize();
   instance.setPadding(NO_PADDING);
   instance.setMaxPitch(OUTSIDE_MAX_PITCH);
   setRide('off');
   userMoved.current=false;
   fitLatest.current(VIEW_CAMERA[view==='city'?'city':'2d']);
   return;
  }
  const entering=!wasRiding.current;
  if(!entering&&r.camera===camera)return;
  wasRiding.current=true;
  if(entering)rideKey.current=inputs.current.selected?.key??'';
  r.camera=camera;
  // A phone's ride map is taller: the camera takes the new size before anything is framed. The
  // front view is the whole canvas; the outside view keeps the bus in the band the notes leave.
  if(entering)instance.resize();
  instance.setPadding(camera==='front'?NO_PADDING:ridePadding(instance.getContainer()));
  if(camera==='front')instance.setMaxPitch(FRONT_MAX_PITCH);
  returnRef.current(false,entering?'entering':'returning');
 },[ready,view,camera,setRide]);

 // Another bus chosen mid-ride: whatever the camera was doing is obsolete; it goes to the
 // new bus and follows that. The same key is a new report of the same bus, not a change.
 const selectedKey=selected?.key??'';
 useEffect(()=>{
  if(!ready||view!=='ride'||!wasRiding.current||!selectedKey||rideKey.current===selectedKey)return;
  rideKey.current=selectedKey;
  returnRef.current(true);
 },[ready,view,selectedKey]);

 // The chosen vehicle starting another journey mid-ride: the ride waits where it is, the camera
 // still, until the passenger chooses to go on with that journey (the ride card asks). Going on
 // with it, or its first journey reappearing, glides back to the bus and follows it again.
 useEffect(()=>{
  const instance=map.current,r=ride.current;
  if(!ready||!instance||view!=='ride'||!wasRiding.current)return;
  if(selectionKind==='new_journey'){
   if(r.state==='following'||r.state==='returning'||r.state==='exploring'){r.transition+=1;instance.stop();setRide('paused')}
  }else if(r.state==='paused'&&selectionKind==='active')returnRef.current(false,'returning');
 },[ready,view,selectionKind,rideState,setRide]);

 // The clear band moves when the map is resized: a phone's taller ride map, or a rotation.
 // setPadding is a jump, and a jump stops whatever the camera is doing. A phone's map finishes
 // growing just after a ride starts, so applying the band at once cancelled the first glide
 // (a second ride was left flat at the street-map zoom). While the camera moves, it waits.
 useEffect(()=>{
  const instance=map.current;
  if(!ready||!instance||view!=='ride')return;
  let live=true,waiting=false;
  const apply=()=>{waiting=false;if(live)instance.setPadding(ride.current.camera==='front'?NO_PADDING:ridePadding(instance.getContainer()))};
  const onResize=()=>{
   if(!instance.isMoving()){apply();return}
   if(waiting)return;
   waiting=true;
   instance.once('moveend',apply);
  };
  instance.on('resize',onResize);
  return()=>{live=false;instance.off('resize',onResize);instance.off('moveend',apply)};
 },[ready,view]);

 const startRide=()=>onViewChange('ride');
 const exitRide=()=>{setFrontNote(null);onViewChange('2d')};
 const chooseFront=()=>{
  if(frontReason){setFrontNote(frontReason);return}
  setFrontNote(null);setCameraWish('front');
 };
 const chooseOutside=()=>{setFrontNote(null);setCameraWish('outside')};

 useEffect(()=>{onRideState?.(view==='ride'?rideState:'off')},[view,rideState,onRideState]);

 // On a phone the ride-along is the screen, not a card in a list: the map is fixed to the
 // viewport, the page behind it stops scrolling, and the HUD sits inside the safe area. Taking
 // the map out of the flow shortens the document underneath, so the scroll position is recorded
 // on the way in and put back on the way out, and the passenger returns to the stop they left.
 useLayoutEffect(()=>{
  if(view!=='ride'||typeof matchMedia!=='function'||!matchMedia(IMMERSIVE_RIDE).matches)return;
  const y=window.scrollY;
  document.body.classList.add('riding');
  return()=>{document.body.classList.remove('riding');window.scrollTo(0,y)};
 },[view]);

 // Where the ride is a panel rather than the screen, it is still brought into view: one started
 // from below the fold would otherwise play off screen.
 useEffect(()=>{
  if(view!=='ride')return;
  if(typeof matchMedia==='function'&&matchMedia(IMMERSIVE_RIDE).matches)return;
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

 // The ride's controls come and go with it: Ride along is gone once it begins, and the ride's own
 // controls once it ends. Focus left on nothing by that goes to the ride's region, and afterwards
 // back to Ride along, so a keyboard never has to start again from the top of the page. It moves in
 // the same commit that removed the focused control, before anything is painted or announced (a
 // frame later, the page's own effects had already run and focus had sat on the page itself), and
 // once more on the next frame if the target was not ready.
 useLayoutEffect(()=>{
  const was=lastView.current;
  lastView.current=view;
  if((was==='ride')===(view==='ride'))return;
  const place=()=>{
   if(document.activeElement&&document.activeElement!==document.body)return;
   (view==='ride'?hudRef.current:launchRef.current)?.focus({preventScroll:true});
  };
  place();
  const frame=requestAnimationFrame(place);
  return()=>cancelAnimationFrame(frame);
 },[view]);

 const zoomBy=(delta:number)=>{
  if(view!=='ride')userMoved.current=true;
  move(m=>(delta>0?m.zoomIn:m.zoomOut).call(m,{duration:prefersReducedMotion()?0:220}));
 };

 return <div ref={root} className={`vector-map theme-${theme} view-${view}${expanded?' expanded':''}`}
   data-map-state={painted?'painted':ready?'ready':'starting'}
   data-view={view} data-theme={theme} data-model={model?'ready':modelFailed?'failed':'idle'}
   data-ride={view==='ride'?rideState:'off'} data-ride-camera={view==='ride'?camera:'off'}
   data-walk={walk?'route':'none'} data-selected-key={selected?.key??''} data-selection={selectionKind??'none'}>
  <div ref={container} className="vector-map-canvas" aria-label={
   `Map of ${buses.length} last reported bus positions${stop?`, your stop ${stop.name}`:''}.`}/>
  <div className="map-vignette" aria-hidden="true"/>
  {!painted&&<div className="map-loading" role="status">
   <p>Drawing the map…</p>
   {slow&&onSimpleMap&&<>
    <p className="map-loading-slow">The detailed map is slow to arrive. The bus information is ready, and the
     simple map can show it now.</p>
    <button className="map-loading-simple" onClick={onSimpleMap}>Use the simple map</button></>}
  </div>}

  {view!=='ride'&&<div className="map-views">
   <div className="view-switch" role="group" aria-label="Map view">
    <button aria-pressed={view==='2d'} onClick={()=>onViewChange('2d')}>2D</button>
    <button aria-pressed={view==='city'} onClick={()=>onViewChange('city')}>City</button>
   </div>
   <button className="fit-journey" onClick={()=>fitRelevant(VIEW_CAMERA[view])}
    aria-label="Fit journey: you, your stop and the selected bus"><Scan size={15}/>Fit journey</button>
  </div>}

  <div className="map-tools">
   {/* The front view sets its own height: zooming there would move the eye out of the bus. */}
   <button onClick={()=>zoomBy(1)} aria-label="Zoom in" disabled={camera==='front'}><Plus size={18}/></button>
   <button onClick={()=>zoomBy(-1)} aria-label="Zoom out" disabled={camera==='front'}><Minus size={18}/></button>
   {onLocate&&<button onClick={onLocate} disabled={locating} aria-label="Locate me">
    <LocateFixed size={17} className={locating?'spin':''}/></button>}
   <button onClick={()=>setExpanded(value=>!value)} aria-pressed={expanded}
    aria-label={expanded?'Make the map smaller':'Make the map bigger'}>
    {expanded?<Minimize2 size={17}/>:<Maximize2 size={17}/>}</button>
   <button onClick={()=>onThemeChange(theme==='day'?'night':'day')}
    aria-label={theme==='day'?'Switch to the night map':'Switch to the daylight map'}>
    {theme==='day'?<Moon size={17}/>:<Sun size={17}/>}</button>
  </div>

  {/* The legend and the ride button share the map's foot, stacking rather than overlapping. */}
  {view!=='ride'&&(stop||here||selected)&&<div className="vector-map-foot">
   <div className="map-legend-chips" aria-hidden="true">
    {here&&<span className="legend-you">{originKind==='chosen'?'Start':'You'}</span>}
    {walk&&<span className="legend-walk">Walk</span>}
    {stop&&<span className="legend-stop">Your stop</span>}
    {selected&&<span className="legend-bus">{busLabel}</span>}
   </div>
   {selected&&<button className="ride-launch" ref={launchRef} onClick={startRide}
     aria-label={`Ride along with route ${selected.route}`}>
    <span className="ride-launch-route">{selected.route}</span>Ride along</button>}
  </div>}

  {view==='ride'&&<div className="ride-hud" role="region" aria-label="Ride-along" ref={hudRef} tabIndex={-1}>
   {/* Three bands, so a phone keeps the street between them: the bar (leaving, what the camera
       is doing, what this is), any note that has to be read, and the two actions above the card.
       Leaving and returning to the bus are never further than one reach from a thumb. */}
   <div className="ride-bar">
    {/* One text node, so the flex gap does not fall between "Exit" and the rest of its own label. */}
    <button className="ride-exit" onClick={exitRide}><X size={16}/><span>Exit<span className="ride-exit-long"> ride-along</span></span></button>
    {/* The label that never changes stands down on a narrow screen, so the state that does —
        following, exploring, street preview — is the part that is always readable. */}
    <p className="ride-mode" data-state={rideState} role="status"><Eye size={14}/>
     <strong>Ride-along</strong><span className="ride-mode-sep"> · </span>
     <span className="ride-mode-state">{camera==='front'?'street preview · ':''}{RIDE_WORDS[rideState]||'starting'}</span></p>
    <details className="ride-about"><summary><span>What is this?</span></summary>
     <p>A map visualisation, not a film from on board. The bus is drawn at its last report, or at an
      estimate labelled as one. Drag to look around; the bus goes on without the camera until you
      return to it. Front view is a stylised preview of the street ahead, from a point above the road
      where the bus is drawn: the map’s own streets, buildings and names, not photographs. It is not
      the view from on board and does not show the lane the bus is in, and it moves only as the bus
      is drawn.</p></details>
   </div>
   <div className="ride-notes">
    {(frontNote??frontFallback)&&<p className="ride-note" role="status">{frontNote??frontFallback}</p>}
    {selected&&selected.bearing===null&&blocked!==null&&<p className="ride-note">This bus did not report
     a direction, so it is shown from above, not from behind.</p>}
    {modelFailed&&<p className="ride-note" role="status">The 3D bus could not be loaded, so the map
     symbol is shown instead.</p>}
   </div>
   {rideOverlay}
   <div className="ride-actions">
    {rideState==='exploring'&&<button className="ride-return" onClick={()=>returnToBus()}><Crosshair size={14}/>Return to bus</button>}
    {camera==='front'
     ? <button className="ride-camera on" onClick={chooseOutside}><Bus size={14}/>Outside view</button>
     : <button className={`ride-camera${frontReason?' unavailable':''}`} title={frontReason??undefined}
        onClick={chooseFront}>
        <Armchair size={14}/>{FRONT_LABEL[frontState]}</button>}
   </div>
  </div>}

  {view==='city'&&modelFailed&&<p className="map-notice" role="status">The 3D bus could not be loaded,
   so the map symbol is shown instead.</p>}

  <p className="map-credit-line">
   {BASEMAP_CREDITS.map((credit,index)=><span key={credit.href}>{index>0&&' · '}
    <a href={credit.href} target="_blank" rel="noopener noreferrer">{credit.label}</a></span>)}
  </p>
 </div>;
}
