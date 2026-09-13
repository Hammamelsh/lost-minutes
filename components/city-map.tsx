"use client";

import {useCallback,useEffect,useRef,useState} from 'react';
import type {ReactNode} from 'react';
import {Eye,LocateFixed,Minus,Moon,Plus,Scan,Sun,X} from 'lucide-react';
import {BASEMAP_CREDITS,MAPLIBRE_MODULE_URL,prefersReducedMotion,webglAvailable} from '@/lib/basemap';
import {applyTheme,buildingExtrusion,buildStyle,type MapTheme} from '@/lib/map-style';
import {MODEL_URL,orientedBus,parseBusModel,unorientedToken,type BusModel} from '@/lib/bus-model';
import {accuracyRing} from '@/lib/geo';
import {BUS_SOURCE,HERE_SOURCE,HIDE_SELECTED_WHEN_MODEL,MODEL_SOURCE,OVERLAY,OVERLAY_SOURCES,
        overlayLayers,STOP_SOURCE} from '@/lib/map-overlay';
import {journeyFocus} from '@/lib/journey';
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
};

/** A marker drawn once to a canvas: a disc, with a nose when it has a reported direction. The
 *  nose is drawn pointing north and turned by MapLibre to the bearing, never guessed. */
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

function markerImages(theme:MapTheme){
 const o=OVERLAY[theme];
 return {
  'lm-sel-arrow':marker({fill:'#c6f36a',stroke:'#f4ffe4',outline:o.ink,radius:13,nose:true}),
  'lm-sel-dot':marker({fill:'#c6f36a',stroke:'#f4ffe4',outline:o.ink,radius:13,nose:false}),
  'lm-bus-arrow':marker({fill:o.other,stroke:o.otherStroke,outline:o.otherStroke,radius:6.5,nose:true}),
  'lm-bus-dot':marker({fill:o.other,stroke:o.otherStroke,outline:o.otherStroke,radius:6.5,nose:false}),
  'lm-stale-arrow':marker({fill:o.stale,stroke:o.staleStroke,outline:o.staleStroke,radius:6,nose:true}),
  'lm-stale-dot':marker({fill:o.stale,stroke:o.staleStroke,outline:o.staleStroke,radius:6,nose:false}),
  'lm-here-dot':marker({fill:'#5aa9e6',stroke:'#eaf4f8',outline:o.ink,radius:7.5,nose:false}),
  'lm-stop-dot':marker({fill:'#ffd9a5',stroke:'#1b2b33',outline:'#1b2b33',radius:5,nose:false}),
 };
}

const HALO_LAYERS=['lm-stop-label','lm-here-label','lm-bus-label'] as const;

function addOverlay(instance:MapLibreMap,theme:MapTheme){
 for(const [id,image] of Object.entries(markerImages(theme)))instance.addImage(id,image,{pixelRatio:2});
 const empty={type:'FeatureCollection' as const,features:[]};
 for(const id of OVERLAY_SOURCES)instance.addSource(id,{type:'geojson',data:empty});
 for(const layer of overlayLayers(theme))instance.addLayer(layer as never);
}

function restyleOverlay(instance:MapLibreMap,theme:MapTheme){
 const o=OVERLAY[theme];
 for(const [id,image] of Object.entries(markerImages(theme)))if(instance.hasImage(id))instance.updateImage(id,image);
 for(const id of HALO_LAYERS)if(instance.getLayer(id))instance.setPaintProperty(id,'text-halo-color',o.halo);
 instance.setPaintProperty('lm-stop-ring','circle-stroke-color',o.stopRing);
 instance.setPaintProperty('lm-stop-label','text-color',o.stopLabel);
 instance.setPaintProperty('lm-here-label','text-color',o.hereLabel);
 instance.setPaintProperty('lm-bus-label','text-color',o.busLabel);
}

/**
 * The map. Every symbol on it is an observation or a fixed reference point. Buses are drawn
 * where they reported and nowhere in between: the camera may glide, a marker never does.
 */
/**
 * Vertical camera offset that puts the ridden bus in the clear band between the ride-along's
 * notes at the top and its progress card at the bottom, whatever their size on this screen.
 */
function rideOffset(canvas:HTMLElement):number{
 const box=canvas.getBoundingClientRect();
 const hud=canvas.closest('.vector-map')?.querySelector('.ride-hud');
 const edge=(selector:string,side:'top'|'bottom')=>{
  const found=hud?.querySelector(selector)?.getBoundingClientRect();
  return found?found[side]-box.top:null;
 };
 const top=Math.max(0,...['.ride-exit','.ride-notes'].map(s=>edge(s,'bottom')??0));
 const bottom=edge('.ride-card','top')??box.height;
 // A map too short to leave a band: a little above centre.
 if(bottom-top<90)return -Math.round(box.height*0.1);
 return Math.round((top+bottom)/2-box.height/2);
}

export default function CityMap({buses,selected,stop,here,follow,onSelect,onManualMove,
                                 onUnavailable,view,onViewChange,theme,onThemeChange,fitRequest=0,
                                 onLocate,locating,rideOverlay}:Props){
 const container=useRef<HTMLDivElement>(null);
 const map=useRef<MapLibreMap|null>(null);
 const [ready,setReady]=useState(false);
 const [painted,setPainted]=useState(false);
 const [camera,setCamera]=useState('');
 const [model,setModel]=useState<BusModel|null>(null);
 const [modelFailed,setModelFailed]=useState(false);
 const programmatic=useRef(false);
 // Once the passenger drags, pinches or zooms, the view is theirs until they ask again.
 const userMoved=useRef(false);
 // The theme the map is created in; later changes are applied in place, never by rebuilding.
 const themeRef=useRef(theme);
 const modelRequested=useRef(false);

 const busCollection=useCallback(()=>({type:'FeatureCollection' as const,
  features:buses.map(bus=>{
   const on=bus.key===selected?.key,stale=bus.freshness==='stale',nose=bus.bearing!==null;
   return {type:'Feature' as const,geometry:{type:'Point' as const,coordinates:[bus.lon,bus.lat]},
    properties:{key:bus.key,route:bus.route,selected:on?1:0,sort:on?2:stale?0:1,
     icon:`lm-${on?'sel':stale?'stale':'bus'}-${nose?'arrow':'dot'}`,rotate:bus.bearing??0}};
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
    instance.on('click','lm-bus-marker',(event:MapMouseEvent&{features?:{properties?:Record<string,unknown>}[]})=>{
     const key=event.features?.[0]?.properties?.key;
     if(typeof key==='string')onSelect(key);
    });
    instance.on('mouseenter','lm-bus-marker',()=>{instance.getCanvas().style.cursor='pointer'});
    instance.on('mouseleave','lm-bus-marker',()=>{instance.getCanvas().style.cursor=''});
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
   // Diagnostic, not a feature: the camera as text, so a regression test can see that
   // ordinary clock updates leave the view where the passenger put it.
   instance.on('moveend',()=>{
    const centre=instance.getCenter();
    setCamera(`${instance.getZoom().toFixed(2)},${centre.lat.toFixed(5)},${centre.lng.toFixed(5)},`
             +`${Math.round(instance.getPitch())},${Math.round(instance.getBearing())}`);
   });
   // A drag or a pinch is the user taking over: following stops until they ask for it again.
   instance.on('dragstart',()=>{if(!programmatic.current){userMoved.current=true;onManualMove()}});
   instance.on('zoomstart',()=>{if(!programmatic.current){userMoved.current=true;onManualMove()}});
   map.current=instance;
  })().catch(()=>{if(!cancelled)onUnavailable()});
  return()=>{cancelled=true;clearTimeout(firstPaint);map.current?.remove();map.current=null};
 },[onSelect,onManualMove,onUnavailable]);

 // Every camera move the app makes goes through here, so the drag and zoom handlers can
 // tell the passenger's own gestures from ours.
 const move=useCallback((run:(m:MapLibreMap)=>void,holdMs=350)=>{
  if(!map.current)return;
  programmatic.current=true;
  run(map.current);
  setTimeout(()=>{programmatic.current=false},holdMs);
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
  // A bus reports every 20 s or so and can cross a street-level view between two reports.
  // Until the passenger has taken the camera, a new report that lands outside the frame
  // brings the frame to it; the marker itself still jumps, because that is what happened.
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
  if(!here){source?.setData({type:'FeatureCollection',features:[]});return}
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

 // --- the 3D bus: fetched once, only when a tilted view first needs it ------------------
 useEffect(()=>{
  if(view==='2d'||modelRequested.current)return;
  modelRequested.current=true;
  fetch(MODEL_URL).then(response=>{if(!response.ok)throw Error(`model ${response.status}`);return response.json()})
   .then(value=>setModel(parseBusModel(value)))
   .catch(()=>setModelFailed(true));
 },[view]);

 const modelShown=view!=='2d'&&model!==null&&Boolean(selected);
 useEffect(()=>{
  const instance=map.current;
  if(!ready||!instance)return;
  const source=instance.getSource(MODEL_SOURCE) as GeoJSONSource|undefined;
  const features=modelShown&&model&&selected
   ?(selected.bearing!==null?orientedBus(model,selected,selected.bearing):unorientedToken(model,selected)):[];
  source?.setData({type:'FeatureCollection',features});
  try{
   instance.setLayoutProperty('lm-bus-model','visibility',modelShown?'visible':'none');
   instance.setLayoutProperty('lm-bus-badge','visibility',modelShown?'visible':'none');
   instance.setPaintProperty('lm-bus-marker','icon-opacity',(modelShown?HIDE_SELECTED_WHEN_MODEL:1) as never);
   instance.setPaintProperty('lm-bus-marker','text-opacity',(modelShown?HIDE_SELECTED_WHEN_MODEL:1) as never);
  }catch{/* the flat symbol stays: the 2D map is always the fallback */}
 },[ready,modelShown,model,selected]);

 // --- camera ----------------------------------------------------------------------
 const fitRelevant=useCallback(()=>{
  if(!map.current)return;
  const points=journeyFocus({here,stop,bus:selected}).map(p=>[p.lon,p.lat] as [number,number]);
  // With nothing chosen yet, frame the buses nearest the middle of the map, not the whole
  // city: one distant bus must not shrink everything else to specks.
  if(!points.length&&buses.length){
   const centre=map.current.getCenter();
   points.push(...[...buses].sort((a,b)=>
    Math.hypot(a.lon-centre.lng,a.lat-centre.lat)-Math.hypot(b.lon-centre.lng,b.lat-centre.lat))
    .slice(0,8).map(b=>[b.lon,b.lat] as [number,number]));
  }
  if(!points.length)return;
  const reduce=prefersReducedMotion();
  if(points.length===1){
   move(m=>m.easeTo({center:points[0],zoom:15.4,duration:reduce?0:500}));
   return;
  }
  const lons=points.map(p=>p[0]),lats=points.map(p=>p[1]);
  // The right-hand padding clears the tool column, the top the view switch, the bottom a
  // marker's label and the credit line: fitted means readable, not merely inside.
  move(m=>m.fitBounds([[Math.min(...lons),Math.min(...lats)],[Math.max(...lons),Math.max(...lats)]],
   {padding:{top:70,bottom:88,left:64,right:84},maxZoom:16.2,duration:reduce?0:500}));
 },[here,stop,selected,buses,move]);

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

 useEffect(()=>{
  if(!ready||!follow||!selected||!map.current||view==='ride')return;
  move(m=>m.easeTo({center:[selected.lon,selected.lat],zoom:Math.max(m.getZoom(),15),
                    duration:prefersReducedMotion()?0:450}));
 },[ready,follow,selected,view,move]);

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
   move(m=>m.easeTo({pitch:58,bearing:-17,zoom:Math.max(m.getZoom(),15.2),duration:reduce?0:900}),950);
  }else if(view==='2d'&&(instance.getPitch()!==0||instance.getBearing()!==0)){
   move(m=>m.easeTo({pitch:0,bearing:0,duration:reduce?0:600}),650);
  }
 },[ready,view,move]);

 // The ride-along: above and behind the selected bus, turned to its reported bearing. Each new
 // report moves the camera to the new fix; the bus itself is only ever drawn at a fix. The bus
 // sits in the clear band between the ride-along's notes and its progress card.
 const riding=view==='ride'&&Boolean(selected);
 const rideLat=riding?selected!.lat:null,rideLon=riding?selected!.lon:null;
 const rideBearing=riding?selected!.bearing:null;
 useEffect(()=>{
  const instance=map.current;
  if(!ready||!instance||rideLat===null||rideLon===null)return;
  const reduce=prefersReducedMotion();
  move(m=>m.easeTo({center:[rideLon,rideLat],zoom:19,pitch:rideBearing===null?50:60,
   bearing:rideBearing??m.getBearing(),offset:[0,rideOffset(instance.getContainer())],
   duration:reduce?0:1400}),reduce?50:1450);
 },[ready,rideLat,rideLon,rideBearing,move]);

 // A ride started from the card below the map would otherwise play off screen on a phone.
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
  userMoved.current=true;
  move(m=>(delta>0?m.zoomIn:m.zoomOut).call(m,{duration:prefersReducedMotion()?0:220}));
 };

 return <div className={`vector-map theme-${theme} view-${view}`}
   data-map-state={painted?'painted':ready?'ready':'starting'} data-camera={camera}
   data-view={view} data-theme={theme} data-model={model?'ready':modelFailed?'failed':'idle'}>
  <div ref={container} className="vector-map-canvas" aria-label={
   `Map of ${buses.length} last reported bus positions${stop?`, your stop ${stop.name}`:''}.`}/>
  <div className="map-vignette" aria-hidden="true"/>
  {!painted&&<p className="map-loading" role="status">Drawing the map…</p>}

  {view!=='ride'&&<div className="map-views">
   <div className="view-switch" role="group" aria-label="Map view">
    <button aria-pressed={view==='2d'} onClick={()=>onViewChange('2d')}>2D</button>
    <button aria-pressed={view==='city'} onClick={()=>onViewChange('city')}>City</button>
   </div>
   <button className="fit-journey" onClick={fitRelevant}
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

  {selected&&view!=='ride'&&<button className="ride-launch" onClick={()=>onViewChange('ride')}>
   <span className="ride-launch-route">{selected.route}</span>Ride along</button>}

  {view==='ride'&&<div className="ride-hud" role="region" aria-label="Ride-along">
   {/* One column under the exit, so the notes can never cover each other or the exit. */}
   <div className="ride-notes">
    <p className="ride-disclaimer"><Eye size={14}/>Map visualisation · the bus is drawn at its last
     reported position, not filmed from on board</p>
    {selected&&selected.bearing===null&&<p className="ride-note">This bus did not report a direction,
     so it is shown from above, not from behind.</p>}
    {modelFailed&&<p className="ride-note" role="status">The 3D bus could not be loaded, so the map
     symbol is shown instead.</p>}
   </div>
   {rideOverlay}
   <button className="ride-exit" onClick={()=>onViewChange('2d')}><X size={16}/>Exit ride-along</button>
  </div>}

  {view==='city'&&modelFailed&&<p className="map-notice" role="status">The 3D bus could not be loaded,
   so the map symbol is shown instead.</p>}

  {view!=='ride'&&(stop||here||selected)&&<div className="map-legend-chips" aria-hidden="true">
   {here&&<span className="legend-you">You</span>}
   {stop&&<span className="legend-stop">Your stop</span>}
   {selected&&<span className="legend-bus">Your bus</span>}
  </div>}

  <p className="map-credit-line">
   {BASEMAP_CREDITS.map((credit,index)=><span key={credit.href}>{index>0&&' · '}
    <a href={credit.href} target="_blank" rel="noopener noreferrer">{credit.label}</a></span>)}
  </p>
 </div>;
}
