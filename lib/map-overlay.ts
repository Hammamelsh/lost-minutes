/**
 * Our own layers over the basemap: the reported accuracy, your stop, every bus, the chosen bus
 * and its 3D model. Kept apart from the component so the whole style can be validated in Node
 * against MapLibre's own specification (tests/map-style.test.mjs); MapLibre refuses an entire
 * style over one invalid property, which is exactly how a broken layer once blanked the map.
 */
import type {MapTheme} from '@/lib/map-style';

export const BUS_SOURCE='lm-buses',STOP_SOURCE='lm-stop',HERE_SOURCE='lm-here',MODEL_SOURCE='lm-model',
 WALK_SOURCE='lm-walk',SELECTED_SOURCE='lm-selected',TRAIL_SOURCE='lm-trail',STOPS_AHEAD_SOURCE='lm-stops-ahead';
export const ALL_STOPS_SOURCE='lm-all-stops';
export const OVERLAY_SOURCES=[ALL_STOPS_SOURCE,BUS_SOURCE,STOP_SOURCE,HERE_SOURCE,MODEL_SOURCE,WALK_SOURCE,SELECTED_SOURCE,
 TRAIL_SOURCE,STOPS_AHEAD_SOURCE] as const;
/** The walking route is drawn in the blue that means "you", dotted so it reads as a way on
 *  foot rather than a road or a bus route. */
export const WALK_COLOUR='#2f86d6';
/** Below this zoom a true-to-scale 12 m bus is a speck (34 px long at 18), so the readable flat
 *  symbol is kept and the model is not drawn at all. From here up the model is drawn inside a
 *  ground ring, with the route number floating above it: both are symbols, which MapLibre draws
 *  over every building, so the chosen bus stays identifiable when the model is behind one. */
export const MODEL_MIN_ZOOM=18;

/** Fills stay constant across themes (blue You, orange stop, lime chosen bus); strokes and
 *  labels change so each separates from paper by day and from ink by night. */
export const OVERLAY:Record<MapTheme,{stopRing:string;stopLabel:string;hereLabel:string;busLabel:string;
 halo:string;other:string;otherStroke:string;stale:string;staleStroke:string;ink:string}>={
 day:{stopRing:'#d9711c',stopLabel:'#7c3c0e',hereLabel:'#1d5a8f',busLabel:'#1e2b33',halo:'#fbf6ea',
      other:'#26394a',otherStroke:'#fbf6ea',stale:'#8d8578',staleStroke:'#fbf6ea',ink:'#1b2a12'},
 night:{stopRing:'#ffb459',stopLabel:'#ffce8f',hereLabel:'#bcdcf5',busLabel:'#e6eff3',halo:'#0b1720',
        other:'#e3eef2',otherStroke:'#0b1720',stale:'#7f97a5',staleStroke:'#0b1720',ink:'#0b1720'},
};

/** Once the 3D bus is drawn, the chosen bus's flat symbol steps aside for the ring and badge;
 *  below the model's zoom it is the only marker, whatever the model's state. */
export const HIDE_SELECTED_WHEN_MODEL=['step',['zoom'],1,MODEL_MIN_ZOOM,0];
export const SHOW_RING_WHEN_MODEL=['step',['zoom'],0,MODEL_MIN_ZOOM,1];
/** The ring image is drawn for zoom 20 (radius about 8 m); it scales with the ground. */
export const RING_SIZE=['interpolate',['exponential',2],['zoom'],MODEL_MIN_ZOOM,2**(MODEL_MIN_ZOOM-20),20,1];

export function overlayLayers(theme:MapTheme):Record<string,unknown>[]{
 const o=OVERLAY[theme];
 return [
  // Every boarding point, from the authoritative stop catalogue (NaPTAN), under everything else:
  // a sign on a post from neighbourhood zooms, its name and indicator from street zooms. The two
  // sides of a road are two signs 30–40 m apart, never one. Neither colour is a reserved one
  // (blue is You, orange is your stop, lime is your bus): ink on paper, paper on ink.
  // Every sign is drawn (one hidden by collision would be a stop that cannot be tapped); labels
  // give way to each other, the chosen stop's neighbours first. The chosen stop has its own
  // marker and name, so it is left out of both layers rather than drawn twice.
  {id:'lm-stops-dot',type:'symbol',source:ALL_STOPS_SOURCE,minzoom:13.5,filter:['!=',['get','chosen'],true],
   layout:{'icon-image':'lm-stop-sign','icon-size':['interpolate',['linear'],['zoom'],13.5,0.5,15,0.66,17,0.92,19,1.1],
           'icon-anchor':'bottom','icon-allow-overlap':true,'icon-ignore-placement':true,'symbol-sort-key':['get','rank']},
   paint:{'icon-opacity':['interpolate',['linear'],['zoom'],13.5,0.75,15,1]}},
  {id:'lm-stops-label',type:'symbol',source:ALL_STOPS_SOURCE,minzoom:15.6,filter:['!=',['get','chosen'],true],
   layout:{'text-field':['get','label'],'text-size':11,'text-anchor':'top','text-offset':[0,0.5],
           'text-font':['Noto Sans Regular'],'text-max-width':9,'text-optional':true,'symbol-sort-key':['get','rank']},
   paint:{'text-color':o.busLabel,'text-halo-color':o.halo,'text-halo-width':1.6,'text-opacity':0.9}},
  // Ground geometry: the reported accuracy is a circle on the ground, the right size at
  // every zoom and flat in the City view.
  {id:'lm-here-accuracy',type:'fill',source:HERE_SOURCE,filter:['==',['get','kind'],'accuracy'],
   paint:{'fill-color':'#5aa9e6','fill-opacity':0.14}},
  {id:'lm-here-accuracy-edge',type:'line',source:HERE_SOURCE,filter:['==',['get','kind'],'accuracy'],
   paint:{'line-color':'#5aa9e6','line-opacity':0.6,'line-width':1.3}},
  // The walking route, under every marker. Where the router joined the nearest mapped path a
  // thin dashed link is drawn instead, so an unmapped stretch is not presented as a path.
  {id:'lm-walk-casing',type:'line',source:WALK_SOURCE,filter:['==',['get','kind'],'route'],
   layout:{'line-cap':'round','line-join':'round'},
   paint:{'line-color':o.halo,'line-width':['interpolate',['linear'],['zoom'],13,5,18,12],'line-opacity':0.92}},
  {id:'lm-walk-line',type:'line',source:WALK_SOURCE,filter:['==',['get','kind'],'route'],
   layout:{'line-cap':'round','line-join':'round'},
   paint:{'line-color':WALK_COLOUR,'line-width':['interpolate',['linear'],['zoom'],13,2.6,18,6.5],
          'line-dasharray':[0.1,1.7]}},
  {id:'lm-walk-connector',type:'line',source:WALK_SOURCE,filter:['==',['get','kind'],'connector'],
   paint:{'line-color':WALK_COLOUR,'line-width':1.6,'line-dasharray':[2,2],'line-opacity':0.85}},
  {id:'lm-stop-ring',type:'circle',source:STOP_SOURCE,
   paint:{'circle-radius':15,'circle-color':'#ffb459','circle-opacity':0.18,'circle-pitch-alignment':'map',
          'circle-stroke-color':o.stopRing,'circle-stroke-width':2.5}},
  // A soft contact shadow under the drawn bus, on the ground and scaled with it. Without one the
  // model floated: on the daylight map its near-white roof sat within a few per cent of the paper
  // ground and the whole vehicle washed out. It is drawn only where the model is, and carries no
  // meaning of its own, so it is grey rather than any of the three reserved colours.
  {id:'lm-bus-shadow',type:'circle',source:SELECTED_SOURCE,minzoom:MODEL_MIN_ZOOM,
   layout:{visibility:'none'},
   paint:{'circle-color':'#0b1116','circle-pitch-alignment':'map','circle-blur':0.75,
          'circle-opacity':['interpolate',['linear'],['zoom'],MODEL_MIN_ZOOM,0,19,0.3],
          'circle-radius':['interpolate',['exponential',2],['zoom'],MODEL_MIN_ZOOM,9,21,120]}},
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
  // The chosen bus's recent reports and, apart from them, where it is estimated to be: dots are
  // reports; a dashed line along the road from the last report is the estimate; a pale band
  // around it spans where 8 in 10 held-out estimates at this report age were actually found.
  // The road ahead of the ridden bus (backlog 27): the next stretch of its checked road, lit
  // softly under the bus in the ride's outside view, about a lane wide at the ride's zoom. It is
  // the accepted shape and nothing else; the map shows the layer only while riding, outside.
  {id:'lm-road-ahead',type:'line',source:TRAIL_SOURCE,filter:['==',['get','kind'],'ahead'],
   layout:{'line-cap':'round','line-join':'round',visibility:'none'},
   paint:{'line-color':'#c6f36a','line-opacity':0.34,'line-blur':1.5,
          'line-width':['interpolate',['exponential',2],['zoom'],15,2,18,10,20,34]}},
  {id:'lm-trail-band',type:'line',source:TRAIL_SOURCE,filter:['==',['get','kind'],'band'],
   layout:{'line-cap':'round','line-join':'round'},
   paint:{'line-color':'#c6f36a','line-opacity':0.28,'line-width':['interpolate',['linear'],['zoom'],13,7,18,22]}},
  // A repositioning, traced for a few seconds: from where the bus was drawn to where its latest
  // report put it. Ink, dashed and heavier than the estimate's line, so it reads as a correction.
  {id:'lm-trail-snap',type:'line',source:TRAIL_SOURCE,filter:['==',['get','kind'],'snap'],
   layout:{'line-cap':'round'},
   paint:{'line-color':o.ink,'line-opacity':0.8,'line-width':['interpolate',['linear'],['zoom'],13,2.2,18,4.5],'line-dasharray':[0.6,1.4]}},
  {id:'lm-trail-estimate',type:'line',source:TRAIL_SOURCE,filter:['==',['get','kind'],'estimate'],
   layout:{'line-cap':'round','line-join':'round'},
   paint:{'line-color':o.ink,'line-width':['interpolate',['linear'],['zoom'],13,1.6,18,3.4],'line-dasharray':[1.2,1.2]}},
  // Where the chosen bus reported before now: hollow rings, half the size of a bus marker and
  // with no filled centre, because a filled lime disc is what the chosen bus itself is drawn as.
  // Until 20 September 2026 they were filled discs, and a passenger reading them as buses tapped
  // them and nothing happened: they are this bus's own past, not other buses, and are not
  // selectable. The latest is drawn solid, since that one *is* where the bus last reported.
  {id:'lm-trail-report',type:'circle',source:TRAIL_SOURCE,filter:['==',['get','kind'],'report'],
   paint:{'circle-radius':['interpolate',['linear'],['zoom'],13,1.8,18,3.4],
          'circle-color':['case',['==',['get','latest'],1],'#c6f36a','rgba(0,0,0,0)'],
          'circle-stroke-color':'#c6f36a','circle-stroke-opacity':['case',['==',['get','latest'],1],1,0.7],
          'circle-stroke-width':1.5,'circle-pitch-alignment':'map'}},
  {id:'lm-bus-label',type:'symbol',source:BUS_SOURCE,minzoom:13.5,filter:['==',['get','selected'],0],
   layout:{'text-field':['get','route'],'text-font':['Noto Sans Bold'],'text-size':11.5,
           'text-anchor':'left','text-offset':[0.95,0],'text-padding':2},
   paint:{'text-color':o.busLabel,'text-halo-color':o.halo,'text-halo-width':1.8}},
  // With the model drawn: a lime ring on the ground around the bus, scaled to the ground, and
  // its route number floating above. Symbols are never hidden by buildings.
  {id:'lm-sel-ring',type:'symbol',source:SELECTED_SOURCE,minzoom:MODEL_MIN_ZOOM,
   layout:{'icon-image':'lm-sel-ring','icon-size':RING_SIZE,'icon-rotation-alignment':'map',
           'icon-pitch-alignment':'map','icon-allow-overlap':true,'icon-ignore-placement':true},
   paint:{'icon-opacity':0}},
  {id:'lm-bus-badge',type:'symbol',source:SELECTED_SOURCE,minzoom:MODEL_MIN_ZOOM,
   layout:{visibility:'none','text-field':['get','route'],'text-font':['Noto Sans Bold'],'text-size':15,
           'text-anchor':'bottom','text-offset':[0,-3.6],'text-allow-overlap':true,'text-ignore-placement':true,
           'text-rotation-alignment':'viewport','text-pitch-alignment':'viewport'},
   paint:{'text-color':'#16240c','text-halo-color':'#c6f36a','text-halo-width':3.75}},
  // The chosen bus, drawn from its own source so it can move every frame without redrawing the
  // rest: at its report in observed mode, at the displayed estimate otherwise, captioned so.
  {id:'lm-sel-marker',type:'symbol',source:SELECTED_SOURCE,
   layout:{'icon-image':['get','icon'],'icon-rotate':['get','rotate'],
           'icon-rotation-alignment':'map','icon-pitch-alignment':'map',
           'icon-allow-overlap':true,'icon-ignore-placement':true,
           'text-field':['get','route'],'text-font':['Noto Sans Bold'],'text-size':12.5,
           'text-allow-overlap':true,'text-ignore-placement':true,
           'text-rotation-alignment':'viewport','text-pitch-alignment':'viewport'},
   paint:{'text-color':'#16240c'}},
  {id:'lm-sel-caption',type:'symbol',source:SELECTED_SOURCE,minzoom:13,
   layout:{'text-field':['get','caption'],'text-font':['Noto Sans Bold'],'text-size':11,
           // The drawn bus is 12 m long, so at the ride-along's zoom it is most of the screen: a caption
           // 5.2 em below its centre landed on its own back end. It clears the model's tail at each zoom
           // the model is drawn at.
           'text-anchor':'top','text-offset':['step',['zoom'],['literal',[0,1.6]],MODEL_MIN_ZOOM,['literal',[0,5.2]],
            19,['literal',[0,7.4]],19.6,['literal',[0,10.2]]],
           'text-allow-overlap':true,'text-ignore-placement':true,'text-letter-spacing':0.08,
           'text-rotation-alignment':'viewport','text-pitch-alignment':'viewport'},
   paint:{'text-color':o.busLabel,'text-halo-color':o.halo,'text-halo-width':2.2}},
  // The next few stops on the chosen bus's own timetable pattern, named where they stand: shown in
  // the front view only, so the street ahead carries its real stops and nothing invented.
  {id:'lm-stops-ahead-dot',type:'circle',source:STOPS_AHEAD_SOURCE,layout:{visibility:'none'},
   paint:{'circle-radius':5.5,'circle-color':o.halo,'circle-stroke-color':o.busLabel,'circle-stroke-width':2,
          'circle-pitch-alignment':'viewport'}},
  {id:'lm-stops-ahead-label',type:'symbol',source:STOPS_AHEAD_SOURCE,
   layout:{visibility:'none','text-field':['get','label'],'text-font':['Noto Sans Bold'],'text-size':13,
           'text-anchor':'bottom','text-offset':[0,-0.8],'text-rotation-alignment':'viewport',
           'text-pitch-alignment':'viewport','text-padding':6},
   paint:{'text-color':o.busLabel,'text-halo-color':o.halo,'text-halo-width':2.2}},
  // Labels choose the side with room; the two reference dots draw on top of everything.
  {id:'lm-here-label',type:'symbol',source:HERE_SOURCE,filter:['==',['get','kind'],'point'],
   layout:{'text-field':['coalesce',['get','label'],'You'],'text-size':12.5,'text-radial-offset':1.35,
           'text-variable-anchor':['top','bottom','left','right'],'text-justify':'auto','text-font':['Noto Sans Bold']},
   paint:{'text-color':o.hereLabel,'text-halo-color':o.halo,'text-halo-width':1.8}},
  {id:'lm-stop-label',type:'symbol',source:STOP_SOURCE,
   layout:{'text-field':['get','label'],'text-size':13.5,'text-radial-offset':1.55,
           'text-variable-anchor':['top','bottom','right','left'],'text-justify':'auto',
           'text-font':['Noto Sans Bold'],'text-max-width':11},
   paint:{'text-color':o.stopLabel,'text-halo-color':o.halo,'text-halo-width':2.4}},
  {id:'lm-here-dot',type:'symbol',source:HERE_SOURCE,filter:['==',['get','kind'],'point'],
   layout:{'icon-image':['case',['==',['get','label'],'Starting point'],'lm-start-dot','lm-here-dot'],
           'icon-allow-overlap':true,'icon-pitch-alignment':'map'}},
  {id:'lm-stop-dot',type:'symbol',source:STOP_SOURCE,
   layout:{'icon-image':'lm-stop-dot','icon-allow-overlap':true,'icon-pitch-alignment':'map'}},
  {id:'lm-dest-dot',type:'symbol',source:HERE_SOURCE,filter:['==',['get','kind'],'destination'],
   layout:{'icon-image':'lm-dest-dot','icon-allow-overlap':true,'icon-pitch-alignment':'map'}},
  {id:'lm-dest-label',type:'symbol',source:HERE_SOURCE,filter:['==',['get','kind'],'destination'],
   layout:{'text-field':['concat','To: ',['get','label']],'text-size':12.5,'text-radial-offset':1.2,
           'text-variable-anchor':['top','bottom','left','right'],'text-justify':'auto','text-font':['Noto Sans Bold'],'text-max-width':10},
   paint:{'text-color':o.busLabel,'text-halo-color':o.halo,'text-halo-width':1.8}},
 ];
}
