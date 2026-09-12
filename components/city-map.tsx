"use client";

import {useCallback,useEffect,useRef,useState} from 'react';
import {Box,Layers,Minus,Plus,Scan} from 'lucide-react';
import {BASEMAP_ATTRIBUTION,BASEMAP_STYLE,BUILDING_LAYER,GREEN_SPACE_LAYERS,
        prefersReducedMotion,webglAvailable} from '@/lib/basemap';
import type {GeoJSONSource,Map as MapLibreMap,MapMouseEvent} from 'maplibre-gl';
import type {FollowBus} from '@/lib/follow';
import type {Stop} from '@/lib/stops';

export type Here = {lat:number;lon:number;accuracyMetres?:number};

type Props = {
 buses:FollowBus[];selected?:FollowBus;stop?:Stop|null;here?:Here|null;
 follow:boolean;onSelect:(key:string)=>void;onManualMove:()=>void;
 onUnavailable:()=>void;pitched:boolean;onPitchedChange:(value:boolean)=>void;
};

const BUS_SOURCE='lm-buses',STOP_SOURCE='lm-stop',HERE_SOURCE='lm-here';

/**
 * The map. Every symbol on it is an observation or a fixed reference point: nothing here is
 * interpolated, and the camera never animates a bus between two reports, because an eased
 * move would look like a position we never saw.
 */
export default function CityMap({buses,selected,stop,here,follow,onSelect,onManualMove,
                                 onUnavailable,pitched,onPitchedChange}:Props){
 const container=useRef<HTMLDivElement>(null);
 const map=useRef<MapLibreMap|null>(null);
 const [ready,setReady]=useState(false);
 const programmatic=useRef(false);

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
  (async()=>{
   const maplibre=await import('maplibre-gl');
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
   instance.addControl(new maplibre.AttributionControl({compact:true,
    customAttribution:BASEMAP_ATTRIBUTION}),'bottom-right');
   // `idle` only fires once the map has actually finished drawing, which `loaded()` does
   // not guarantee. If nothing has been painted in time - no usable WebGL, a blocked tile
   // host, a proxy - fall back to the drawn map rather than leave a black rectangle.
   let painted=false;
   instance.once('idle',()=>{painted=true});
   const firstPaint=setTimeout(()=>{if(!cancelled&&!painted)onUnavailable()},7000);
   instance.on('load',()=>{
    if(cancelled)return;
    for(const layer of GREEN_SPACE_LAYERS){
     try{instance.addLayer(layer as never,'water')}catch{try{instance.addLayer(layer as never)}catch{}}
    }
    instance.addSource(BUS_SOURCE,{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    instance.addSource(STOP_SOURCE,{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    instance.addSource(HERE_SOURCE,{type:'geojson',data:{type:'FeatureCollection',features:[]}});

    // Reported accuracy, drawn as the area it actually describes rather than a false point.
    instance.addLayer({id:'lm-here-accuracy',type:'circle',source:HERE_SOURCE,
     filter:['==',['get','kind'],'accuracy'],
     paint:{'circle-color':'#5aa9e6','circle-opacity':0.14,'circle-stroke-color':'#5aa9e6',
            'circle-stroke-opacity':0.4,'circle-stroke-width':1,
            'circle-radius':['get','radiusPx']}});
    instance.addLayer({id:'lm-here-dot',type:'circle',source:HERE_SOURCE,
     filter:['==',['get','kind'],'point'],
     paint:{'circle-radius':7,'circle-color':'#5aa9e6','circle-stroke-color':'#eaf4f8',
            'circle-stroke-width':3}});
    instance.addLayer({id:'lm-here-label',type:'symbol',source:HERE_SOURCE,
     filter:['==',['get','kind'],'point'],
     layout:{'text-field':'You','text-size':12,'text-offset':[0,1.5],'text-anchor':'top',
             'text-font':['Noto Sans Bold']},
     paint:{'text-color':'#bcdcf5','text-halo-color':'#0b1720','text-halo-width':1.6}});

    instance.addLayer({id:'lm-stop-ring',type:'circle',source:STOP_SOURCE,
     paint:{'circle-radius':13,'circle-color':'#ffb459','circle-opacity':0.16,
            'circle-stroke-color':'#ffb459','circle-stroke-width':2}});
    instance.addLayer({id:'lm-stop-dot',type:'circle',source:STOP_SOURCE,
     paint:{'circle-radius':5,'circle-color':'#ffd9a5','circle-stroke-color':'#1b2b33',
            'circle-stroke-width':2}});
    instance.addLayer({id:'lm-stop-label',type:'symbol',source:STOP_SOURCE,
     layout:{'text-field':['get','label'],'text-size':12.5,'text-offset':[0,1.6],
             'text-anchor':'top','text-font':['Noto Sans Bold'],'text-max-width':11},
     paint:{'text-color':'#ffce8f','text-halo-color':'#0b1720','text-halo-width':1.8}});

    instance.addLayer({id:'lm-bus-dot',type:'circle',source:BUS_SOURCE,
     paint:{'circle-radius':['case',['==',['get','selected'],1],13,7],
            'circle-color':['case',['==',['get','selected'],1],'#c6f36a',
                            ['==',['get','stale'],1],'#7f97a5','#8fd0e4'],
            'circle-stroke-color':['case',['==',['get','selected'],1],'#f4ffe4','#0b1720'],
            'circle-stroke-width':['case',['==',['get','selected'],1],3,2]}});
    instance.addLayer({id:'lm-bus-route',type:'symbol',source:BUS_SOURCE,
     layout:{'text-field':['get','route'],'text-size':['case',['==',['get','selected'],1],13,11],
             'text-font':['Noto Sans Bold'],'text-allow-overlap':false},
     paint:{'text-color':['case',['==',['get','selected'],1],'#1c2b12','#04121a'],
            'text-halo-color':['case',['==',['get','selected'],1],'#c6f36a','#8fd0e4'],
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
   instance.once('idle',()=>clearTimeout(firstPaint));
   // A drag or a pinch is the user taking over: following stops until they ask for it again.
   instance.on('dragstart',()=>{if(!programmatic.current)onManualMove()});
   instance.on('zoomstart',()=>{if(!programmatic.current)onManualMove()});
   map.current=instance;
  })();
  return()=>{cancelled=true;map.current?.remove();map.current=null};
 },[onSelect,onManualMove,onUnavailable]);

 // --- data ------------------------------------------------------------------------
 useEffect(()=>{
  if(!ready||!map.current)return;
  (map.current.getSource(BUS_SOURCE) as GeoJSONSource|undefined)?.setData(busCollection());
 },[ready,busCollection]);

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
  const metresPerPixel=(latitude:number,zoom:number)=>
   156543.03392*Math.cos(latitude*Math.PI/180)/Math.pow(2,zoom);
  const radiusPx=here.accuracyMetres
   ?Math.max(8,Math.min(180,here.accuracyMetres/metresPerPixel(here.lat,map.current.getZoom())))
   :0;
  source?.setData({type:'FeatureCollection',features:[
   ...(radiusPx?[{type:'Feature' as const,geometry:{type:'Point' as const,coordinates:[here.lon,here.lat]},
     properties:{kind:'accuracy',radiusPx}}]:[]),
   {type:'Feature' as const,geometry:{type:'Point' as const,coordinates:[here.lon,here.lat]},
    properties:{kind:'point'}}]});
 },[ready,here]);

 // --- camera ----------------------------------------------------------------------
 const move=useCallback((run:(m:MapLibreMap)=>void)=>{
  if(!map.current)return;
  programmatic.current=true;
  run(map.current);
  setTimeout(()=>{programmatic.current=false},350);
 },[]);

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
  move(m=>m.fitBounds([[Math.min(...lons),Math.min(...lats)],[Math.max(...lons),Math.max(...lats)]],
   {padding:{top:70,bottom:70,left:50,right:50},maxZoom:16,
    duration:prefersReducedMotion()?0:500}));
 },[here,stop,selected,buses,move]);

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
   move(m=>m.easeTo({pitch:0,bearing:0,duration:prefersReducedMotion()?0:500}));
  }
 },[ready,pitched,move]);

 return <div className="city-map">
  <div ref={container} className="city-map-canvas" aria-label={
   `Map of ${buses.length} last reported bus positions${stop?`, your stop ${stop.name}`:''}.`}/>
  <div className="map-tools">
   <button onClick={()=>move(m=>m.zoomIn({duration:prefersReducedMotion()?0:220}))} aria-label="Zoom in"><Plus size={18}/></button>
   <button onClick={()=>move(m=>m.zoomOut({duration:prefersReducedMotion()?0:220}))} aria-label="Zoom out"><Minus size={18}/></button>
   <button onClick={fitRelevant} aria-label="Fit you, your stop and the selected bus on screen"><Scan size={17}/></button>
   <button onClick={()=>onPitchedChange(!pitched)} aria-pressed={pitched}
    className={pitched?'active':''} aria-label={pitched?'Back to the flat map':'Show the city in 3D'}>
    {pitched?<Layers size={17}/>:<Box size={17}/>}</button>
  </div>
 </div>;
}
