'use client';
/**
 * The view from above: previously captured 3D imagery of Manchester, with the buses the map draws
 * placed on it at the same drawn positions. A second renderer, not a second drawing: every position
 * comes from the map's own playback (lib/fleet.ts, lib/motion.ts) through `frame`, so opening,
 * choosing a bus, following it and leaving never move a bus or touch the journey.
 *
 * The interaction: open on the city from above; tap a bus and the camera descends behind it and
 * follows; a drag or a pinch takes the camera and "Return to bus" gives it back; Exit returns to
 * the map with the same bus, stop and journey. Reduced motion: no descent, no glide, the view cuts.
 *
 * What it is not: a live camera (the imagery was captured some time ago and the provider does not
 * publish when), a lane-level position, or one simultaneous scene (each bus is drawn where its own
 * reports put it a little behind them, as the map says). The bar says so, in one line.
 */
import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import type * as CesiumTypes from 'cesium';
import {Bus,Crosshair,X} from 'lucide-react';
import {prefersReducedMotion} from '@/lib/basemap';
import {ABOVE_CITY,ABOVE_DEFAULT_GROUND,ABOVE_FOLLOW,loadCesium,offsetAlong,type DrawnFrame,type Photo3d} from '@/lib/gods-eye';
import {destinationLabel} from '@/lib/follow';

type Status='loading'|'ready'|'failed';
type Props={
 photo3d:Photo3d;
 /** What the map drew last, written by the map on every tick of its fleet. */
 frame:{current:DrawnFrame|null};
 /** The passenger's bus, if any: the camera goes to it. */
 selectedKey:string|null;
 /** Where to open: the stop, the bus, or the middle of the city. */
 start:{lat:number;lon:number};
 onSelect:(key:string)=>void;
 onLeave:()=>void;
 /** Which buses the map should step for this view: its centre and reach. */
 onFocus:(focus:{lat:number;lon:number;radiusM:number}|null)=>void;
};

const LIME='#c6f36a',GREY='#8fa3ae';
const BUS_LENGTH=12,BUS_WIDTH=2.55,BUS_HEIGHT=3.3;

export default function GodsEye({photo3d,frame,selectedKey,start,onSelect,onLeave,onFocus}:Props){
 const root=useRef<HTMLDivElement>(null);
 const container=useRef<HTMLDivElement>(null);
 const [status,setStatus]=useState<Status>('loading');
 const [why,setWhy]=useState<string|null>(null);
 const [mode,setMode]=useState<'city'|'following'|'exploring'>('city');
 const [tiles,setTiles]=useState<{loaded:boolean;credits:string}>({loaded:false,credits:''});
 const [named,setNamed]=useState<{route:string;destination:string;age:number}|null>(null);
 const state=useRef({viewer:null as CesiumTypes.Viewer|null,cesium:null as typeof CesiumTypes|null,
  following:false,selected:null as string|null,heights:new Map<string,number>(),lastClamp:0,clamping:false,
  ticks:[] as number[],frames:0,openedAt:0,usableAt:0,descending:false,timer:null as ReturnType<typeof setInterval>|null,
  tileset:null as CesiumTypes.Cesium3DTileset|null,imagery:false,release:null as (()=>void)|null,
  handler:null as CesiumTypes.ScreenSpaceEventHandler|null});
 // Read by the tick and the handlers, which are registered once; written outside render.
 const selectedRef=useRef(selectedKey),onSelectRef=useRef(onSelect),onFocusRef=useRef(onFocus);
 useEffect(()=>{selectedRef.current=selectedKey;onSelectRef.current=onSelect;onFocusRef.current=onFocus},[selectedKey,onSelect,onFocus]);

 // --- the viewer, created once ------------------------------------------------------------
 useEffect(()=>{
  let live=true;
  const s=state.current;
  s.openedAt=performance.now();
  (async()=>{
   let Cesium:typeof CesiumTypes;
   try{Cesium=await loadCesium()}catch(error){if(live){setWhy(error instanceof Error?error.message:'the renderer could not be loaded');setStatus('failed')}return}
   if(!live||!container.current)return;
   let viewer:CesiumTypes.Viewer;
   try{
    // No widgets, no globe under Google's tiles (the tiles are the ground; a globe would show
    // through gaps as a second, unrelated surface), a render only when something changed.
    viewer=new Cesium.Viewer(container.current,{
     baseLayerPicker:false,geocoder:false,homeButton:false,sceneModePicker:false,navigationHelpButton:false,
     animation:false,timeline:false,fullscreenButton:false,infoBox:false,selectionIndicator:false,
     requestRenderMode:true,maximumRenderTimeChange:Infinity,
     globe:photo3d.provider==='sample'?undefined:false,baseLayer:false,skyBox:false,skyAtmosphere:false,
     contextOptions:{webgl:{powerPreference:'high-performance'}},
    });
   }catch(error){if(live){setWhy(error instanceof Error?error.message:'WebGL is not available');setStatus('failed')}return}
   s.viewer=viewer;s.cesium=Cesium;
   viewer.scene.backgroundColor=Cesium.Color.fromCssColorString('#0b1720');
   if(viewer.scene.sun)viewer.scene.sun.show=false;
   if(viewer.scene.moon)viewer.scene.moon.show=false;
   viewer.scene.postRender.addEventListener(()=>{s.frames+=1});
   // Google's own advice for its tiles: many requests in flight to its host.
   Cesium.RequestScheduler.requestsByServer['tile.googleapis.com:443']=18;
   // The imagery. A tileset that cannot be loaded (a wrong key, no network) leaves the buses over
   // nothing, which is said rather than shown as a black city.
   try{
    const tileset=await Cesium.Cesium3DTileset.fromUrl(photo3d.tilesetUrl,{showCreditsOnScreen:true,skipLevelOfDetail:true,
     maximumScreenSpaceError:16});
    if(!live){viewer.destroy();return}
    viewer.scene.primitives.add(tileset);
    s.tileset=tileset;
    // Usable once the tiles the first view needs are in (the tick also reads `tilesLoaded`, which
    // is how a tileset with nothing to load, the fixture's, counts as loaded).
    tileset.initialTilesLoaded.addEventListener(()=>{if(live)imageryLoaded()});
    tileset.loadProgress.addEventListener((pending:number,processing:number)=>{
     root.current?.setAttribute('data-above-tiles',`${pending},${processing}`);
    });
   }catch(error){
    if(!live)return;
    setWhy(`the imagery could not be loaded (${error instanceof Error?error.message:'unknown error'})`);
    setStatus('failed');
    root.current?.setAttribute('data-above-imagery','failed');
    return;
   }
   if(!live)return;
   // Open on the city from above: from higher, settling to the elevated view (a cut under reduced motion).
   const dest=Cesium.Cartesian3.fromDegrees(start.lon,start.lat-ABOVE_CITY.height*0.55/111195,ABOVE_CITY.height);
   const orientation={heading:0,pitch:Cesium.Math.toRadians(ABOVE_CITY.pitchDegrees),roll:0};
   if(prefersReducedMotion())viewer.camera.setView({destination:dest,orientation});
   else{
    viewer.camera.setView({destination:Cesium.Cartesian3.fromDegrees(start.lon,start.lat-2200/111195,5200),orientation});
    viewer.camera.flyTo({destination:dest,orientation,duration:2.2});
   }
   // A tap on a bus chooses it; a drag, a wheel or a pinch takes the camera from the follow.
   const handler=new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
   s.handler=handler;
   handler.setInputAction((movement:{position:CesiumTypes.Cartesian2})=>{
    const picked=viewer.scene.pick(movement.position);
    const id=picked?.id;
    if(id instanceof Cesium.Entity&&typeof id.id==='string'&&id.id.startsWith('bus:'))onSelectRef.current(id.id.slice(4));
   },Cesium.ScreenSpaceEventType.LEFT_CLICK);
   // Read from the canvas itself (a pointer down, a wheel, a touch), not from the renderer's event
   // handler, which did not report the down of a drag while the camera was in its follow.
   const release=()=>{if(s.following){s.following=false;setMode('exploring')}};
   const canvas=viewer.scene.canvas;
   for(const type of ['pointerdown','wheel','touchstart'] as const)canvas.addEventListener(type,release,{passive:true,capture:true});
   s.release=()=>{for(const type of ['pointerdown','wheel','touchstart'] as const)canvas.removeEventListener(type,release,{capture:true})};
   setStatus('ready');
   root.current?.setAttribute('data-above-ready-ms',String(Math.round(performance.now()-s.openedAt)));
   // Which buses the map should step for this view: what the camera can see, roughly.
   const focus=()=>{
    const c=viewer.camera.positionCartographic;
    onFocusRef.current({lat:Cesium.Math.toDegrees(c.latitude),lon:Cesium.Math.toDegrees(c.longitude),radiusM:Math.max(600,Math.min(6000,c.height*3))});
   };
   focus();
   viewer.camera.moveEnd.addEventListener(focus);
   // The tick: the map's drawn frame onto the scene, ten times a second, only while the page is in front.
   s.timer=setInterval(()=>{if(!document.hidden)tick()},100);
  })();
  // The attributions of what is on screen, aggregated in a line as the provider requires; the
  // renderer's own credit display shows them too, with the provider's logo.
  const imageryLoaded=()=>{
   const s=state.current;
   if(s.imagery||!s.tileset)return;
   s.imagery=true;s.usableAt=s.usableAt||performance.now();
   setTiles({loaded:true,credits:(s.tileset.asset?.copyright as string|undefined)??''});
   root.current?.setAttribute('data-above-usable-ms',String(Math.round(s.usableAt-s.openedAt)));
  };
  const tick=()=>{
   const s=state.current,viewer=s.viewer,Cesium=s.cesium,f=frame.current;
   if(!viewer||!Cesium||viewer.isDestroyed()||!f)return;
   if(s.tileset&&!s.imagery&&s.tileset.tilesLoaded)imageryLoaded();
   const t0=performance.now();
   const seen=new Set<string>();
   let chosen:{lat:number;lon:number;bearing:number|null;height:number}|null=null;
   for(const bus of f.buses){
    const id=`bus:${bus.key}`;seen.add(id);
    const height=(s.heights.get(bus.key)??ABOVE_DEFAULT_GROUND)+BUS_HEIGHT/2;
    const position=Cesium.Cartesian3.fromDegrees(bus.lon,bus.lat,height);
    const heading=Cesium.Math.toRadians(bus.bearing??0);
    let entity=viewer.entities.getById(id);
    if(!entity){
     entity=viewer.entities.add({id,position,
      box:{dimensions:new Cesium.Cartesian3(BUS_WIDTH,BUS_LENGTH,BUS_HEIGHT),
       material:Cesium.Color.fromCssColorString(bus.chosen?LIME:GREY),outline:true,outlineColor:Cesium.Color.fromCssColorString('#0b1720')},
      label:{text:bus.route,font:'bold 13px Inter, sans-serif',fillColor:Cesium.Color.fromCssColorString('#16240c'),
       showBackground:true,backgroundColor:Cesium.Color.fromCssColorString(bus.chosen?LIME:'#e6eff3'),
       backgroundPadding:new Cesium.Cartesian2(5,3),pixelOffset:new Cesium.Cartesian2(0,-22),
       verticalOrigin:Cesium.VerticalOrigin.BOTTOM,disableDepthTestDistance:Number.POSITIVE_INFINITY,
       scaleByDistance:new Cesium.NearFarScalar(200,1,2500,0.5)}});
    }else{
     entity.position=new Cesium.ConstantPositionProperty(position);
     const box=entity.box;
     if(box)box.material=new Cesium.ColorMaterialProperty(Cesium.Color.fromCssColorString(bus.chosen?LIME:GREY));
     if(entity.label)entity.label.backgroundColor=new Cesium.ConstantProperty(Cesium.Color.fromCssColorString(bus.chosen?LIME:'#e6eff3'));
    }
    entity.orientation=new Cesium.ConstantProperty(Cesium.Transforms.headingPitchRollQuaternion(position,new Cesium.HeadingPitchRoll(heading,0,0)));
    if(bus.chosen){chosen={lat:bus.lat,lon:bus.lon,bearing:bus.bearing,height};setNamed(n=>n&&n.route===bus.route&&n.destination===bus.destination&&Math.abs(n.age-bus.ageSeconds)<1?n:{route:bus.route,destination:destinationLabel(bus.destination),age:Math.round(bus.ageSeconds)})}
   }
   for(const entity of [...viewer.entities.values])if(!seen.has(entity.id))viewer.entities.remove(entity);
   // The ground under each bus, measured against the imagery once a second: the mesh carries the
   // real terrain, and a bus drawn at an assumed height would float or sink.
   if(!s.clamping&&t0-s.lastClamp>1000&&f.buses.length){
    s.clamping=true;s.lastClamp=t0;
    const keys=f.buses.slice(0,60).map(b=>b.key);
    const points=f.buses.slice(0,60).map(b=>Cesium.Cartesian3.fromDegrees(b.lon,b.lat,ABOVE_DEFAULT_GROUND+200));
    viewer.scene.clampToHeightMostDetailed(points,[...viewer.entities.values]).then(clamped=>{
     clamped.forEach((p,i)=>{if(p){const c=Cesium.Cartographic.fromCartesian(p);if(c)s.heights.set(keys[i],c.height)}});
    }).catch(()=>{}).finally(()=>{s.clamping=false});
   }
   // A newly chosen bus: descend to it; then follow from above and behind.
   if(chosen&&s.selected!==selectedRef.current){
    s.selected=selectedRef.current;s.descending=true;s.following=false;
    const back=offsetAlong(chosen.lat,chosen.lon,(chosen.bearing??0)+180,ABOVE_FOLLOW.range);
    const destination=Cesium.Cartesian3.fromDegrees(back.lon,back.lat,chosen.height+ABOVE_FOLLOW.height);
    const orientation={heading:Cesium.Math.toRadians(chosen.bearing??0),pitch:Cesium.Math.toRadians(ABOVE_FOLLOW.pitchDegrees),roll:0};
    const done=()=>{s.descending=false;s.following=true;setMode('following')};
    if(prefersReducedMotion()){viewer.camera.setView({destination,orientation});done()}
    else viewer.camera.flyTo({destination,orientation,duration:2.6,complete:done,cancel:()=>{s.descending=false}});
   }
   if(chosen&&s.following&&!s.descending){
    const target=Cesium.Cartesian3.fromDegrees(chosen.lon,chosen.lat,chosen.height);
    viewer.camera.lookAt(target,new Cesium.HeadingPitchRange(Cesium.Math.toRadians(chosen.bearing??0),
     Cesium.Math.toRadians(ABOVE_FOLLOW.pitchDegrees),Math.hypot(ABOVE_FOLLOW.range,ABOVE_FOLLOW.height)));
   }
   if(!chosen&&s.selected){s.selected=null;s.following=false;setMode('city');viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY)}
   viewer.scene.requestRender();
   const ms=performance.now()-t0;
   s.ticks.push(ms);if(s.ticks.length>30)s.ticks.splice(0,s.ticks.length-30);
   const sorted=[...s.ticks].sort((a,b)=>a-b);
   const memory=(performance as Performance&{memory?:{usedJSHeapSize:number}}).memory?.usedJSHeapSize;
   root.current?.setAttribute('data-above-stats',`${f.buses.length},${sorted[Math.floor(sorted.length/2)].toFixed(1)},${s.frames}${memory?','+Math.round(memory/1048576):''}`);
  };
  return()=>{
   live=false;
   if(s.timer)clearInterval(s.timer);
   s.release?.();s.release=null;
   if(s.handler&&!s.handler.isDestroyed())s.handler.destroy();s.handler=null;
   onFocusRef.current(null);
   if(s.viewer&&!s.viewer.isDestroyed())s.viewer.destroy();
   s.viewer=null;
  };
  // The viewer is created for the tileset and the opening place it was given; a new one gets a new viewer.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[photo3d.tilesetUrl,start.lat,start.lon]);

 // Return to bus: the follow again, from above and behind.
 const returnToBus=()=>{const s=state.current;if(s.viewer&&s.cesium){s.following=true;setMode('following')}};
 // The view is the screen: drawn on the body (inside the panel, its containment would box a fixed
 // element in), and the page behind it does not scroll while it is open.
 useEffect(()=>{document.body.classList.add('above');return()=>document.body.classList.remove('above')},[]);
 if(typeof document==='undefined')return null;

 const words=status==='failed'?`Not shown: ${why}.`
  :photo3d.provider==='sample'?'A sample tileset, not Manchester: a check of the viewer, not the imagery.'
  :'Imagery captured earlier by the provider, not a live camera; buses where their own reports put them, a little behind.';
 return createPortal(<div ref={root} className={`gods-eye mode-${mode}`} role="region" aria-label="Manchester from above"
   data-above={status} data-above-mode={mode} data-above-provider={photo3d.provider} data-above-imagery={tiles.loaded?'loaded':'waiting'}>
  <div ref={container} className="gods-eye-canvas"/>
  <div className="gods-eye-bar">
   <button className="ride-exit" onClick={onLeave} aria-label="Exit the view from above"><X size={16}/> Exit</button>
   <span className="gods-eye-mode">{status==='loading'?'Loading the view from above…':mode==='following'?'Following your bus':mode==='exploring'?'Looking around':'Manchester from above'}</span>
   {mode==='exploring'&&<button className="ride-return" onClick={returnToBus}><Crosshair size={15}/> Return to bus</button>}
  </div>
  {named&&mode!=='city'&&<div className="gods-eye-card" data-above-bus>
   <span className="route-pill">{named.route}</span><strong>to {named.destination}</strong><small>report {named.age} s ago</small>
  </div>}
  {status==='ready'&&mode==='city'&&<p className="gods-eye-hint"><Bus size={13} aria-hidden="true"/> Tap a bus to descend to it.</p>}
  <p className="gods-eye-note" data-above-note>{words}{tiles.credits?` · ${tiles.credits}`:''}</p>
  {status==='failed'&&<div className="gods-eye-failed" role="alert"><p>{words}</p><button className="text-action strong" onClick={onLeave}>Back to the map</button></div>}
 </div>,document.body);
}
