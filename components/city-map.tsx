"use client";

import {useCallback,useEffect,useRef,useState} from 'react';
import {Box,Layers,Minus,Plus,Scan} from 'lucide-react';
import {BASEMAP_CREDITS,BASEMAP_STYLE,BUILDING_LAYER,GREEN_SPACE_LAYERS,MAPLIBRE_MODULE_URL,
        prefersReducedMotion,webglAvailable} from '@/lib/basemap';
import {accuracyRing} from '@/lib/geo';
import type * as MapLibreGL from 'maplibre-gl';
import type {GeoJSONSource,Map as MapLibreMap,MapMouseEvent} from 'maplibre-gl';
import type {FollowBus} from '@/lib/follow';
import type {Stop} from '@/lib/stops';

export type Here = {lat:number;lon:number;accuracyMetres?:number};

type Props = {
 buses:FollowBus[];selected?:FollowBus;stop?:Stop|null;here?:Here|null;
 follow:boolean;onSelect:(key:string)=>void;onManualMove:()=>void;
 onUnavailable:()=>void;pitched:boolean;onPitchedChange:(value:boolean)=>void;
 /** Incremented by the parent when the passenger asks for something new (a route, a bus
  *  from the list), so the camera goes to it without a further tap. */
 fitRequest?:number;
};

const BUS_SOURCE='lm-buses',STOP_SOURCE='lm-stop',HERE_SOURCE='lm-here';

/** A round marker as an image, drawn the way a circle layer would draw it: the stroke sits
 *  outside the radius. Drawn at 2x so it is crisp on a phone. */
function dotImage(fill:string,stroke:string,radius:number,strokeWidth:number,ratio=2):ImageData{
 const size=Math.ceil((radius+strokeWidth)*2+2);
 const canvas=document.createElement('canvas');
 canvas.width=size*ratio;canvas.height=size*ratio;
 const g=canvas.getContext('2d')!;
 g.scale(ratio,ratio);
 g.beginPath();g.arc(size/2,size/2,radius,0,Math.PI*2);g.fillStyle=fill;g.fill();
 g.beginPath();g.arc(size/2,size/2,radius+strokeWidth/2,0,Math.PI*2);
 g.lineWidth=strokeWidth;g.strokeStyle=stroke;g.stroke();
 return g.getImageData(0,0,size*ratio,size*ratio);
}

/**
 * The map. Every symbol on it is an observation or a fixed reference point: nothing here is
 * interpolated, and the camera never animates a bus between two reports, because an eased
 * move would look like a position we never saw.
 */
export default function CityMap({buses,selected,stop,here,follow,onSelect,onManualMove,
                                 onUnavailable,pitched,onPitchedChange,fitRequest=0}:Props){
 const container=useRef<HTMLDivElement>(null);
 const map=useRef<MapLibreMap|null>(null);
 const [ready,setReady]=useState(false);
 const [painted,setPainted]=useState(false);
 const [camera,setCamera]=useState('');
 const programmatic=useRef(false);
 // Once the passenger drags, pinches or zooms, the view is theirs: nothing recentres it
 // until they ask for something new. Before that, their bus is kept in the frame.
 const userMoved=useRef(false);

 const busCollection=useCallback(()=>({type:'FeatureCollection' as const,
  features:buses.map(bus=>({type:'Feature' as const,
   geometry:{type:'Point' as const,coordinates:[bus.lon,bus.lat]},
   properties:{key:bus.key,route:bus.route,
               selected:bus.key===selected?.key?1:0,
               stale:bus.freshness==='stale'?1:0}}))}),[buses,selected]);

 // --- create once -----------------------------------------------------------------
 useEffect(()=>{
  if(!container.current||map.current)return;
  if(!webglAvailable()){onUnavailable();return}
  let cancelled=false;
  // Bound the whole startup, including a stalled dynamic import. Parent clock updates
  // must not restart this watchdog. Unmounting cancels it and any pending startup.
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
    instance=new maplibre.Map({
     container:container.current,style:BASEMAP_STYLE,
     center:[-2.2426,53.4808],zoom:12.2,attributionControl:false,
     pitch:0,maxPitch:60,dragRotate:false,
    });
   }catch{onUnavailable();return}
   instance.on('error',(event:{error?:{message?:string}})=>{
    // A failed tile is survivable; a failed style is not, and we fall back rather than
    // leave the passenger looking at an empty rectangle.
    if(event?.error&&/style/i.test(String(event.error?.message??'')))onUnavailable();
   });
   // Idle is the initial-settled signal here, not a claim that every pixel has been
   // visually verified. If startup never settles, the watchdog selects the fallback.
   instance.on('load',()=>{
    if(cancelled)return;
    for(const layer of GREEN_SPACE_LAYERS){
     try{instance.addLayer(layer as never,'water')}catch{try{instance.addLayer(layer as never)}catch{}}
    }
    instance.addSource(BUS_SOURCE,{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    instance.addSource(STOP_SOURCE,{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    instance.addSource(HERE_SOURCE,{type:'geojson',data:{type:'FeatureCollection',features:[]}});

    // Draw order: ground geometry, then every dot, then every label. Labels last means a
    // stop ring can never sit on top of "You", and MapLibre resolves label collisions
    // itself rather than painting one word through another.
    // Reported accuracy as ground geometry: the right size at every zoom and flat in 3D.
    instance.addLayer({id:'lm-here-accuracy',type:'fill',source:HERE_SOURCE,
     filter:['==',['get','kind'],'accuracy'],
     paint:{'fill-color':'#5aa9e6','fill-opacity':0.14}});
    instance.addLayer({id:'lm-here-accuracy-edge',type:'line',source:HERE_SOURCE,
     filter:['==',['get','kind'],'accuracy'],
     paint:{'line-color':'#5aa9e6','line-opacity':0.55,'line-width':1.2}});

    instance.addLayer({id:'lm-stop-ring',type:'circle',source:STOP_SOURCE,
     paint:{'circle-radius':13,'circle-color':'#ffb459','circle-opacity':0.16,
            'circle-stroke-color':'#ffb459','circle-stroke-width':2}});
    // Three colours, three meanings: lime is the bus you chose, near-white is every other
    // bus, and blue is kept for "You" alone so the two can never be read as each other.
    instance.addLayer({id:'lm-bus-dot',type:'circle',source:BUS_SOURCE,
     paint:{'circle-radius':['case',['==',['get','selected'],1],13,7],
            'circle-color':['case',['==',['get','selected'],1],'#c6f36a',
                            ['==',['get','stale'],1],'#7f97a5','#e3eef2'],
            'circle-stroke-color':['case',['==',['get','selected'],1],'#f4ffe4','#0b1720'],
            'circle-stroke-width':['case',['==',['get','selected'],1],3,2]}});

    // "You" and "Your stop" are symbols, not circles, because MapLibre only keeps text off
    // other symbols: as symbols they claim their space, so no label can be painted over
    // them. Placement runs from the top layer down, so the two dots (above the labels)
    // are placed first, then each label takes whichever side of its point has room.
    instance.addImage('lm-here-dot',dotImage('#5aa9e6','#eaf4f8',7,3),{pixelRatio:2});
    instance.addImage('lm-stop-dot',dotImage('#ffd9a5','#1b2b33',5,2),{pixelRatio:2});
    instance.addLayer({id:'lm-here-label',type:'symbol',source:HERE_SOURCE,
     filter:['==',['get','kind'],'point'],
     layout:{'text-field':'You','text-size':12,'text-radial-offset':1.3,
             'text-variable-anchor':['top','bottom','left','right'],'text-justify':'auto',
             'text-font':['Noto Sans Bold']},
     paint:{'text-color':'#bcdcf5','text-halo-color':'#0b1720','text-halo-width':1.6}});
    instance.addLayer({id:'lm-stop-label',type:'symbol',source:STOP_SOURCE,
     layout:{'text-field':['get','label'],'text-size':12.5,'text-radial-offset':1.5,
             'text-variable-anchor':['top','bottom','right','left'],'text-justify':'auto',
             'text-font':['Noto Sans Bold'],'text-max-width':11},
     paint:{'text-color':'#ffce8f','text-halo-color':'#0b1720','text-halo-width':1.8}});
    instance.addLayer({id:'lm-here-dot',type:'symbol',source:HERE_SOURCE,
     filter:['==',['get','kind'],'point'],
     layout:{'icon-image':'lm-here-dot','icon-allow-overlap':true}});
    instance.addLayer({id:'lm-stop-dot',type:'symbol',source:STOP_SOURCE,
     layout:{'icon-image':'lm-stop-dot','icon-allow-overlap':true}});
    instance.addLayer({id:'lm-bus-route',type:'symbol',source:BUS_SOURCE,
     layout:{'text-field':['get','route'],'text-size':['case',['==',['get','selected'],1],13,11],
             'text-font':['Noto Sans Bold'],'text-allow-overlap':false},
     paint:{'text-color':['case',['==',['get','selected'],1],'#1c2b12','#04121a'],
            'text-halo-color':['case',['==',['get','selected'],1],'#c6f36a','#e3eef2'],
            'text-halo-width':1.2}});

    instance.on('click','lm-bus-dot',(event:MapMouseEvent&{features?:{properties?:Record<string,unknown>}[]})=>{
     const key=event.features?.[0]?.properties?.key;
     if(typeof key==='string')onSelect(key);
    });
    for(const layer of ['lm-bus-dot','lm-bus-route']){
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
   // Diagnostic, not a feature: the camera as text, so a regression test can see that
   // ordinary clock updates leave the view where the passenger put it.
   instance.on('moveend',()=>{
    const centre=instance.getCenter();
    setCamera(`${instance.getZoom().toFixed(2)},${centre.lat.toFixed(5)},${centre.lng.toFixed(5)},${Math.round(instance.getPitch())}`);
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
 const move=useCallback((run:(m:MapLibreMap)=>void)=>{
  if(!map.current)return;
  programmatic.current=true;
  run(map.current);
  setTimeout(()=>{programmatic.current=false},350);
 },[]);

 // --- data ------------------------------------------------------------------------
 useEffect(()=>{
  if(!ready||!map.current)return;
  const instance=map.current;
  (instance.getSource(BUS_SOURCE) as GeoJSONSource|undefined)?.setData(busCollection());
  // A bus reports every 20 s or so and can cross a street-level view between two reports.
  // Until the passenger has taken the camera, a new report that lands outside the frame
  // brings the frame to it; the marker itself still jumps, because that is what happened.
  if(!selected||follow||userMoved.current)return;
  const point=instance.project([selected.lon,selected.lat]);
  const {clientWidth:width,clientHeight:height}=instance.getContainer();
  const inset=56;
  if(point.x<inset||point.y<inset||point.x>width-inset||point.y>height-inset){
   move(m=>m.easeTo({center:[selected.lon,selected.lat],duration:prefersReducedMotion()?0:450}));
  }
 },[ready,busCollection,selected,follow,move]);

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

 // --- camera ----------------------------------------------------------------------
 const fitRelevant=useCallback(()=>{
  if(!map.current)return;
  const points:[number,number][]=[
   ...(here?[[here.lon,here.lat] as [number,number]]:[]),
   ...(stop?[[stop.lon,stop.lat] as [number,number]]:[]),
   ...(selected?[[selected.lon,selected.lat] as [number,number]]:[]),
  ];
  if(points.length===0)points.push(...buses.slice(0,40).map(b=>[b.lon,b.lat] as [number,number]));
  if(!points.length)return;
  const lons=points.map(p=>p[0]),lats=points.map(p=>p[1]);
  // The right-hand padding clears the tool column, the bottom clears a marker's label and
  // the credit line, so "fit" means every symbol is on screen and readable, not merely inside.
  // A lone bus gets a street-scale view with room to move; three symbols get a tighter fit.
  move(m=>m.fitBounds([[Math.min(...lons),Math.min(...lats)],[Math.max(...lons),Math.max(...lats)]],
   {padding:{top:64,bottom:84,left:76,right:84},maxZoom:points.length===1?15:16,
    duration:prefersReducedMotion()?0:500}));
 },[here,stop,selected,buses,move]);

 // The camera goes to what the passenger asked for: the first buses, a new route or bus, a
 // chosen stop, a found location. It never moves on an ordinary refresh, so a view they
 // have panned to stays theirs until they ask again. On a phone this is the difference
 // between seeing your bus and seeing the city centre.
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
  if(!ready||!follow||!selected||!map.current)return;
  move(m=>m.easeTo({center:[selected.lon,selected.lat],zoom:Math.max(m.getZoom(),15),
                    duration:prefersReducedMotion()?0:450}));
 },[ready,follow,selected,move]);

 useEffect(()=>{
  if(!ready||!map.current)return;
  const instance=map.current;
  if(pitched){
   if(!instance.getLayer(BUILDING_LAYER.id)){
    try{instance.addLayer(BUILDING_LAYER as never)}catch{}
   }
   move(m=>m.easeTo({pitch:52,bearing:-18,duration:prefersReducedMotion()?0:600}));
  }else{
   if(instance.getLayer(BUILDING_LAYER.id))instance.removeLayer(BUILDING_LAYER.id);
   // Already flat on first paint: starting an easeTo here would cancel the fit the same
   // commit just began, and the passenger would open on the city centre, not their bus.
   if(instance.getPitch()===0&&instance.getBearing()===0)return;
   move(m=>m.easeTo({pitch:0,bearing:0,duration:prefersReducedMotion()?0:500}));
  }
 },[ready,pitched,move]);

 return <div className="vector-map" data-map-state={painted?'painted':ready?'ready':'starting'}
   data-camera={camera}>
  <div ref={container} className="vector-map-canvas" aria-label={
   `Map of ${buses.length} last reported bus positions${stop?`, your stop ${stop.name}`:''}.`}/>
  <div className="map-tools">
   {/* Zoom buttons are for pointers; a phone pinches, and the column would otherwise cover
       a third of the map. Fit and 3D stay everywhere. */}
   <button className="zoom" onClick={()=>{userMoved.current=true;move(m=>m.zoomIn({duration:prefersReducedMotion()?0:220}))}} aria-label="Zoom in"><Plus size={18}/></button>
   <button className="zoom" onClick={()=>{userMoved.current=true;move(m=>m.zoomOut({duration:prefersReducedMotion()?0:220}))}} aria-label="Zoom out"><Minus size={18}/></button>
   <button onClick={fitRelevant} aria-label="Fit you, your stop and the selected bus on screen"><Scan size={17}/></button>
   <button onClick={()=>onPitchedChange(!pitched)} aria-pressed={pitched}
    className={pitched?'active':''} aria-label={pitched?'Back to the flat map':'Show the city in 3D'}>
    {pitched?<Layers size={17}/>:<Box size={17}/>}</button>
  </div>
  {/* One line, ours, in place of MapLibre's control, which repeated the style's own credit
      and grew to three lines on a phone. Every required credit is here and linked. */}
  <p className="map-credit-line">
   {BASEMAP_CREDITS.map((credit,index)=><span key={credit.href}>{index>0&&' · '}
    <a href={credit.href} target="_blank" rel="noopener noreferrer">{credit.label}</a></span>)}
  </p>
 </div>;
}
