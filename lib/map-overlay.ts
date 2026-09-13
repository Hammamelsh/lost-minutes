/**
 * Our own layers over the basemap: the reported accuracy, your stop, every bus, the chosen bus
 * and its 3D model. Kept apart from the component so the whole style can be validated in Node
 * against MapLibre's own specification (tests/map-style.test.mjs); MapLibre refuses an entire
 * style over one invalid property, which is exactly how a broken layer once blanked the map.
 */
import type {MapTheme} from '@/lib/map-style';

export const BUS_SOURCE='lm-buses',STOP_SOURCE='lm-stop',HERE_SOURCE='lm-here',MODEL_SOURCE='lm-model';
export const OVERLAY_SOURCES=[BUS_SOURCE,STOP_SOURCE,HERE_SOURCE,MODEL_SOURCE] as const;
/** Below this zoom a true-to-scale 12 m bus is a speck, so the readable symbol is kept. */
export const MODEL_MIN_ZOOM=17;

/** Fills stay constant across themes (blue You, orange stop, lime chosen bus); strokes and
 *  labels change so each separates from paper by day and from ink by night. */
export const OVERLAY:Record<MapTheme,{stopRing:string;stopLabel:string;hereLabel:string;busLabel:string;
 halo:string;other:string;otherStroke:string;stale:string;staleStroke:string;ink:string}>={
 day:{stopRing:'#d9711c',stopLabel:'#7c3c0e',hereLabel:'#1d5a8f',busLabel:'#1e2b33',halo:'#fbf6ea',
      other:'#26394a',otherStroke:'#fbf6ea',stale:'#8d8578',staleStroke:'#fbf6ea',ink:'#1b2a12'},
 night:{stopRing:'#ffb459',stopLabel:'#ffce8f',hereLabel:'#bcdcf5',busLabel:'#e6eff3',halo:'#0b1720',
        other:'#e3eef2',otherStroke:'#0b1720',stale:'#7f97a5',staleStroke:'#0b1720',ink:'#0b1720'},
};

/** Once the 3D bus is drawn, the flat symbol for that one bus steps aside; the rest stay. */
export const HIDE_SELECTED_WHEN_MODEL=['step',['zoom'],1,MODEL_MIN_ZOOM,['case',['==',['get','selected'],1],0,1]];

export function overlayLayers(theme:MapTheme):Record<string,unknown>[]{
 const o=OVERLAY[theme];
 return [
  // Ground geometry first: the reported accuracy is a circle on the ground, the right size at
  // every zoom and flat in the City view.
  {id:'lm-here-accuracy',type:'fill',source:HERE_SOURCE,filter:['==',['get','kind'],'accuracy'],
   paint:{'fill-color':'#5aa9e6','fill-opacity':0.14}},
  {id:'lm-here-accuracy-edge',type:'line',source:HERE_SOURCE,filter:['==',['get','kind'],'accuracy'],
   paint:{'line-color':'#5aa9e6','line-opacity':0.6,'line-width':1.3}},
  {id:'lm-stop-ring',type:'circle',source:STOP_SOURCE,
   paint:{'circle-radius':15,'circle-color':'#ffb459','circle-opacity':0.18,'circle-pitch-alignment':'map',
          'circle-stroke-color':o.stopRing,'circle-stroke-width':2.5}},
  {id:'lm-bus-model',type:'fill-extrusion',source:MODEL_SOURCE,minzoom:MODEL_MIN_ZOOM,
   layout:{visibility:'none'},
   paint:{'fill-extrusion-color':['get','colour'],'fill-extrusion-base':['get','base'],
          'fill-extrusion-height':['get','height'],'fill-extrusion-opacity':1,
          'fill-extrusion-vertical-gradient':true}},
  // Every bus: a disc with a nose where a bearing was reported, lying flat on the map so the
  // nose points along the street in the City view too. The chosen bus draws last and carries
  // its route number.
  {id:'lm-bus-marker',type:'symbol',source:BUS_SOURCE,
   layout:{'icon-image':['get','icon'],'icon-rotate':['get','rotate'],
           'icon-rotation-alignment':'map','icon-pitch-alignment':'map',
           'icon-allow-overlap':true,'icon-ignore-placement':true,'symbol-sort-key':['get','sort'],
           'text-field':['case',['==',['get','selected'],1],['get','route'],''],
           'text-font':['Noto Sans Bold'],'text-size':12.5,'text-allow-overlap':true,
           'text-ignore-placement':true,'text-rotation-alignment':'viewport','text-pitch-alignment':'viewport'},
   paint:{'text-color':'#16240c'}},
  {id:'lm-bus-label',type:'symbol',source:BUS_SOURCE,minzoom:13.5,filter:['==',['get','selected'],0],
   layout:{'text-field':['get','route'],'text-font':['Noto Sans Bold'],'text-size':11,
           'text-anchor':'left','text-offset':[0.95,0],'text-padding':2},
   paint:{'text-color':o.busLabel,'text-halo-color':o.halo,'text-halo-width':1.5}},
  {id:'lm-bus-badge',type:'symbol',source:BUS_SOURCE,minzoom:MODEL_MIN_ZOOM,filter:['==',['get','selected'],1],
   layout:{visibility:'none','text-field':['get','route'],'text-font':['Noto Sans Bold'],'text-size':15,
           'text-offset':[0,-2.8],'text-allow-overlap':true,'text-ignore-placement':true},
   paint:{'text-color':'#16240c','text-halo-color':'#c6f36a','text-halo-width':4}},
  // Labels choose the side with room; the two reference dots draw on top of everything.
  {id:'lm-here-label',type:'symbol',source:HERE_SOURCE,filter:['==',['get','kind'],'point'],
   layout:{'text-field':'You','text-size':12.5,'text-radial-offset':1.35,
           'text-variable-anchor':['top','bottom','left','right'],'text-justify':'auto','text-font':['Noto Sans Bold']},
   paint:{'text-color':o.hereLabel,'text-halo-color':o.halo,'text-halo-width':1.8}},
  {id:'lm-stop-label',type:'symbol',source:STOP_SOURCE,
   layout:{'text-field':['get','label'],'text-size':13,'text-radial-offset':1.55,
           'text-variable-anchor':['top','bottom','right','left'],'text-justify':'auto',
           'text-font':['Noto Sans Bold'],'text-max-width':11},
   paint:{'text-color':o.stopLabel,'text-halo-color':o.halo,'text-halo-width':2}},
  {id:'lm-here-dot',type:'symbol',source:HERE_SOURCE,filter:['==',['get','kind'],'point'],
   layout:{'icon-image':'lm-here-dot','icon-allow-overlap':true,'icon-pitch-alignment':'map'}},
  {id:'lm-stop-dot',type:'symbol',source:STOP_SOURCE,
   layout:{'icon-image':'lm-stop-dot','icon-allow-overlap':true,'icon-pitch-alignment':'map'}},
 ];
}
