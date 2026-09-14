/**
 * Lost Minutes cartography: an original MapLibre style over OpenFreeMap's OpenMapTiles
 * vector tiles, in two themes.
 *
 * The brief was the elevated, hand-inked city map of a historical game: a warm paper ground,
 * roads drawn as cased strokes, districts named in spaced capitals, landmarks called out, and
 * a city that rises into view when the camera tilts. Nothing is copied from any game or from
 * OpenFreeMap's own styles; the palette, hierarchy and layer set are ours.
 *
 * Daylight ("paper") is for reading at a stop in sunshine. Night ("ink") keeps the same
 * hierarchy with the ground dark and the arterial roads lit amber. Blue, orange and lime are
 * reserved for You, Your stop and the selected bus, and appear nowhere in the basemap.
 *
 * Detail is admitted by zoom so distant clutter stays out: minor streets from z13, service
 * roads and paths from z15, street names on major roads from z13 and every street from z15,
 * landmark names from z14.
 */
export type MapTheme='day'|'night';

export const TILEJSON_URL='https://tiles.openfreemap.org/planet';
export const GLYPHS_URL='https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
const REGULAR=['Noto Sans Regular'],BOLD=['Noto Sans Bold'],ITALIC=['Noto Sans Italic'];

type Palette={
 ground:string;residential:string;commercial:string;industrial:string;institution:string;
 park:string;parkEdge:string;wood:string;grass:string;pitch:string;cemetery:string;
 water:string;waterEdge:string;waterText:string;
 building:string;buildingEdge:string;extrusion:string;
 casingMajor:string;casingMinor:string;motorway:string;trunk:string;primary:string;
 secondary:string;minor:string;service:string;path:string;rail:string;
 placeText:string;districtText:string;halo:string;roadText:string;landmarkText:string;landmark:string;
 sky:string;horizon:string;fog:string;light:string;lightIntensity:number;
};

export const PALETTES:Record<MapTheme,Palette>={
 day:{
  ground:'#efe5cf',residential:'#eadfc6',commercial:'#e7d7bb',industrial:'#e0d5c1',institution:'#e8d9c6',
  park:'#cdd4a6',parkEdge:'#aab784',wood:'#bdc896',grass:'#d3d8af',pitch:'#c4cf9a',cemetery:'#cbceac',
  water:'#99bec2',waterEdge:'#7aa3a8',waterText:'#3a6870',
  building:'#dccdb1',buildingEdge:'#c6b390',extrusion:'#dfd0b4',
  casingMajor:'#9b7f57',casingMinor:'#c7b08a',motorway:'#e2a553',trunk:'#efc376',primary:'#f3cf7f',
  secondary:'#fbebc8',minor:'#fffbf2',service:'#f8f2e4',path:'#a8906b',rail:'#877660',
  placeText:'#3a2f22',districtText:'#5b4a35',halo:'#f6eedc',roadText:'#584835',
  landmarkText:'#6d3421',landmark:'#a14b30',
  sky:'#e8dac0',horizon:'#f4ead6',fog:'#efe5cf',light:'#fff3d6',lightIntensity:0.38,
 },
 night:{
  // Night, reworked for legibility: a slightly lifted ground so blocks and parks separate from
  // it, arterials in a warm lamp-lit amber, side streets a readable slate, brighter labels.
  ground:'#101d27',residential:'#13212b',commercial:'#15232e',industrial:'#142029',institution:'#162430',
  park:'#132e22',parkEdge:'#24503a',wood:'#11301f',grass:'#142f23',pitch:'#163a28',cemetery:'#152b1f',
  water:'#0f3645',waterEdge:'#2a7188',waterText:'#a9d8e3',
  // Buildings sit close to the ground tone, so blocks read as texture and the journey's
  // streets, stops and bus keep the contrast.
  building:'#182934',buildingEdge:'#243746',extrusion:'#22363f',
  casingMajor:'#04080b',casingMinor:'#0a141c',motorway:'#d9a458',trunk:'#c39a5c',primary:'#a88b5c',
  secondary:'#6d7e89',minor:'#4a5d6f',service:'#35464f',path:'#56707d',rail:'#6c7b85',
  placeText:'#eef4f7',districtText:'#b8c9d3',halo:'#060d12',roadText:'#e4edf2',
  landmarkText:'#f2c37c',landmark:'#d9a15c',
  sky:'#0a1219',horizon:'#1c2c37',fog:'#0d1820',light:'#c7d7ff',lightIntensity:0.32,
 },
};

type Layer=Record<string,unknown>&{id:string;type:string};
const z=(pairs:number[])=>['interpolate',['exponential',1.45],['zoom'],...pairs];
const byClass=(...classes:string[])=>['match',['get','class'],classes,true,false];
const notTunnel=['!=',['get','brunnel'],'tunnel'];

function road(id:string,classes:string[],minzoom:number,widths:number[],colour:string,casing?:{colour:string;extra:number},dash?:number[]):Layer[]{
 const filter=['all',byClass(...classes),notTunnel];
 const layers:Layer[]=[];
 if(casing)layers.push({id:`${id}-casing`,type:'line',source:'openmaptiles','source-layer':'transportation',
  minzoom,filter,layout:{'line-cap':'round','line-join':'round'},
  paint:{'line-color':casing.colour,'line-width':z(widths.map((v,i)=>i%2?v+casing.extra:v))}});
 layers.push({id,type:'line',source:'openmaptiles','source-layer':'transportation',minzoom,filter,
  layout:{'line-cap':dash?'butt':'round','line-join':'round'},
  paint:{'line-color':colour,'line-width':z(widths),...(dash?{'line-dasharray':dash}:{})}});
 return layers;
}

/** The base layers, bottom to top. Our own symbols (You, stop, buses) go above these. */
export function baseLayers(theme:MapTheme):Layer[]{
 const p=PALETTES[theme];
 const landuse=(id:string,classes:string[],colour:string,minzoom=10):Layer=>({id,type:'fill',
  source:'openmaptiles','source-layer':'landuse',minzoom,filter:byClass(...classes),
  paint:{'fill-color':colour}});
 return [
  {id:'lm-ground',type:'background',paint:{'background-color':p.ground}},
  landuse('lm-residential',['residential','suburb','neighbourhood','quarter'],p.residential,9),
  landuse('lm-commercial',['commercial','retail'],p.commercial),
  landuse('lm-industrial',['industrial','garages','railway'],p.industrial),
  landuse('lm-institution',['hospital','school','university','college','kindergarten','library'],p.institution,12),
  {id:'lm-wood',type:'fill',source:'openmaptiles','source-layer':'landcover',filter:byClass('wood'),
   paint:{'fill-color':p.wood}},
  {id:'lm-grass',type:'fill',source:'openmaptiles','source-layer':'landcover',
   filter:byClass('grass','farmland','scrub'),paint:{'fill-color':p.grass,'fill-opacity':0.8}},
  landuse('lm-cemetery',['cemetery'],p.cemetery,12),
  landuse('lm-pitch',['pitch','stadium','playground','track'],p.pitch,13),
  {id:'lm-park',type:'fill',source:'openmaptiles','source-layer':'park',paint:{'fill-color':p.park}},
  {id:'lm-park-edge',type:'line',source:'openmaptiles','source-layer':'park',minzoom:13,
   paint:{'line-color':p.parkEdge,'line-width':z([13,0.4,17,1.2]),'line-opacity':0.7}},
  {id:'lm-water',type:'fill',source:'openmaptiles','source-layer':'water',
   paint:{'fill-color':p.water,'fill-outline-color':p.waterEdge}},
  {id:'lm-waterway',type:'line',source:'openmaptiles','source-layer':'waterway',
   filter:notTunnel,paint:{'line-color':p.water,'line-width':z([10,0.6,17,5])}},
  {id:'lm-building',type:'fill',source:'openmaptiles','source-layer':'building',minzoom:14,
   paint:{'fill-color':p.building,'fill-outline-color':p.buildingEdge,
          'fill-opacity':['interpolate',['linear'],['zoom'],14,0,15,1]}},
  ...road('lm-rail',['rail','transit'],11,[11,0.6,17,2],p.rail,undefined,[3,2]),
  ...road('lm-path',['path','track'],15,[15,0.7,18,2],p.path,undefined,[2,1.5]),
  ...road('lm-service',['service'],15,[15,1.2,18,5],p.service,{colour:p.casingMinor,extra:1.2}),
  ...road('lm-minor',['minor'],13,[13,1,15,3.2,18,11],p.minor,{colour:p.casingMinor,extra:1.4}),
  ...road('lm-secondary',['secondary','tertiary'],11,[11,1,14,4,18,16],p.secondary,{colour:p.casingMajor,extra:1.6}),
  ...road('lm-primary',['primary','trunk'],8,[8,0.8,13,4.5,18,20],p.primary,{colour:p.casingMajor,extra:1.8}),
  ...road('lm-motorway',['motorway'],6,[6,0.8,12,4,18,22],p.motorway,{colour:p.casingMajor,extra:2}),
  // Labels: water, then streets, then landmarks, then places on top.
  // symbol-placement takes no data expression, so lines and points are two layers.
  // Line labels follow their street or river (rotation aligned to the map) but stand upright
  // on a tilted map (pitch aligned to the viewport): the style specification allows the two
  // alignments to differ, and MapLibre keeps line-placed text upright with text-keep-upright.
  {id:'lm-water-name-line',type:'symbol',source:'openmaptiles','source-layer':'water_name',minzoom:12,
   filter:['==',['geometry-type'],'LineString'],
   layout:{'text-field':['get','name'],'text-font':ITALIC,'text-size':13,'text-letter-spacing':0.12,
           'symbol-placement':'line','text-pitch-alignment':'viewport'},
   paint:{'text-color':p.waterText,'text-halo-color':p.halo,'text-halo-width':1.4}},
  {id:'lm-water-name',type:'symbol',source:'openmaptiles','source-layer':'water_name',minzoom:12,
   filter:['!=',['geometry-type'],'LineString'],
   layout:{'text-field':['get','name'],'text-font':ITALIC,'text-size':13,'text-letter-spacing':0.12},
   paint:{'text-color':p.waterText,'text-halo-color':p.halo,'text-halo-width':1.2}},
  {id:'lm-waterway-name',type:'symbol',source:'openmaptiles','source-layer':'waterway',minzoom:14,
   layout:{'text-field':['get','name'],'text-font':ITALIC,'text-size':12,'symbol-placement':'line',
           'text-letter-spacing':0.1,'text-pitch-alignment':'viewport'},
   paint:{'text-color':p.waterText,'text-halo-color':p.halo,'text-halo-width':1.4}},
  // Street names: a little larger than before, with a halo a quarter of the size (the
  // specification's maximum), so they read on a phone at night without shouting by day.
  {id:'lm-street-name-minor',type:'symbol',source:'openmaptiles','source-layer':'transportation_name',
   minzoom:15,filter:byClass('minor','service'),
   layout:{'text-field':['get','name'],'text-font':REGULAR,'text-size':z([15,11.5,18,14]),
           'symbol-placement':'line','text-max-angle':30,'symbol-spacing':320,'text-pitch-alignment':'viewport'},
   paint:{'text-color':p.roadText,'text-halo-color':p.halo,'text-halo-width':2}},
  {id:'lm-street-name',type:'symbol',source:'openmaptiles','source-layer':'transportation_name',
   minzoom:13,filter:byClass('motorway','trunk','primary','secondary','tertiary'),
   layout:{'text-field':['get','name'],'text-font':BOLD,'text-size':z([13,11,17,15]),
           'symbol-placement':'line','text-max-angle':30,'symbol-spacing':360,
           'text-transform':'uppercase','text-letter-spacing':0.06,'text-pitch-alignment':'viewport'},
   paint:{'text-color':p.roadText,'text-halo-color':p.halo,'text-halo-width':2.2}},
  // The front view's street names: stood upright at the middle of each named street, facing the
  // eye, because a name laid along the road stands on end from street level. Only there, and
  // spaced out so a few read rather than many crowd.
  {id:'lm-front-street-name',type:'symbol',source:'openmaptiles','source-layer':'transportation_name',
   minzoom:15,filter:byClass('motorway','trunk','primary','secondary','tertiary','minor'),
   layout:{visibility:'none','text-field':['get','name'],'text-font':BOLD,'text-size':14,
           'symbol-placement':'line-center','text-rotation-alignment':'viewport','text-pitch-alignment':'viewport',
           'text-padding':18},
   paint:{'text-color':p.roadText,'text-halo-color':p.halo,'text-halo-width':2.2}},
  {id:'lm-landmark-dot',type:'circle',source:'openmaptiles','source-layer':'poi',minzoom:14,
   filter:['all',byClass('stadium','railway','attraction','museum','university','college','hospital',
                           'theatre','castle','monument','town_hall','library'),['<=',['get','rank'],24]],
   paint:{'circle-radius':z([14,2.2,18,4]),'circle-color':p.landmark,'circle-stroke-color':p.halo,
          'circle-stroke-width':1.2}},
  {id:'lm-landmark',type:'symbol',source:'openmaptiles','source-layer':'poi',minzoom:14,
   filter:['all',byClass('stadium','railway','attraction','museum','university','college','hospital',
                           'theatre','castle','monument','town_hall','library'),['<=',['get','rank'],24]],
   layout:{'text-field':['get','name'],'text-font':BOLD,'text-size':z([14,11.5,18,14]),
           'text-anchor':'top','text-offset':[0,0.7],'text-max-width':9,'text-padding':4},
   paint:{'text-color':p.landmarkText,'text-halo-color':p.halo,'text-halo-width':2}},
  {id:'lm-district',type:'symbol',source:'openmaptiles','source-layer':'place',minzoom:11,maxzoom:17,
   filter:byClass('suburb','quarter','neighbourhood'),
   layout:{'text-field':['upcase',['get','name']],'text-font':BOLD,
           'text-size':z([11,10.5,15,14]),'text-letter-spacing':0.22,'text-max-width':8,
           'text-padding':6},
   paint:{'text-color':p.districtText,'text-halo-color':p.halo,'text-halo-width':1.8,
          'text-opacity':['interpolate',['linear'],['zoom'],11,0.85,16,0.6]}},
  {id:'lm-town',type:'symbol',source:'openmaptiles','source-layer':'place',maxzoom:14,
   filter:byClass('city','town'),
   layout:{'text-field':['get','name'],'text-font':BOLD,'text-size':z([8,12,13,19]),
           'text-letter-spacing':0.04},
   paint:{'text-color':p.placeText,'text-halo-color':p.halo,'text-halo-width':2}},
 ];
}

/** A complete style: our source, our glyphs, our layers, and the atmosphere for the City view. */
export function buildStyle(theme:MapTheme){
 const p=PALETTES[theme];
 return {
  version:8,name:`Lost Minutes ${theme}`,
  sources:{openmaptiles:{type:'vector',url:TILEJSON_URL}},
  glyphs:GLYPHS_URL,
  layers:baseLayers(theme),
  sky:skyFor(theme),
  light:{anchor:'viewport',color:p.light,intensity:p.lightIntensity,position:[1.2,210,35]},
 };
}

export function skyFor(theme:MapTheme){
 const p=PALETTES[theme];
 return {'sky-color':p.sky,'horizon-color':p.horizon,'fog-color':p.fog,
  'sky-horizon-blend':0.6,'horizon-fog-blend':0.7,'fog-ground-blend':0.35,'atmosphere-blend':0};
}

/** Buildings for the City view, coloured to the theme. By night they are lower in contrast, so
 *  the lit streets and the bus stay the subject; by day they keep their paper look. */
export function buildingExtrusion(theme:MapTheme):Layer{
 return {id:'lm-buildings-3d',type:'fill-extrusion',source:'openmaptiles','source-layer':'building',
  minzoom:14,filter:['!=',['get','hide_3d'],true],
  paint:{'fill-extrusion-color':PALETTES[theme].extrusion,
   'fill-extrusion-height':['coalesce',['get','render_height'],10],
   'fill-extrusion-base':['coalesce',['get','render_min_height'],0],
   'fill-extrusion-opacity':theme==='night'?0.78:0.88,'fill-extrusion-vertical-gradient':true}};
}

/**
 * The front view's own paint: a raised, stylised preview of the street ahead, lit so that the
 * road, the buildings and the sky separate, most of all at night. Buildings take a lighter face
 * and a low light from one side, so walls and roofs differ. A road's casing reads as a kerb. The
 * sky carries a horizon lit by the streets, and a haze fades distant blocks instead of ending them
 * in black. Nothing here adds a feature the map does not have; the outside view keeps the map's
 * own paint.
 */
export const FRONT:Record<MapTheme,{extrusion:string;kerb:string;sky:Record<string,unknown>;
 light:{anchor:'map';color:string;intensity:number;position:[number,number,number]}}>={
 day:{extrusion:'#e4d6bc',kerb:'#a88a60',
  sky:{'sky-color':'#b9cfd9','horizon-color':'#efe7d6','fog-color':'#efe7d6','sky-horizon-blend':0.55,
   'horizon-fog-blend':0.6,'fog-ground-blend':0.25,'atmosphere-blend':0},
  light:{anchor:'map',color:'#fff4dc',intensity:0.45,position:[1.15,225,55]}},
 night:{extrusion:'#415a6a',kerb:'#6f8796',
  sky:{'sky-color':'#0d1d2a','horizon-color':'#4d6879','fog-color':'#22394a','sky-horizon-blend':0.8,
   'horizon-fog-blend':0.55,'fog-ground-blend':0.2,'atmosphere-blend':0},
  light:{anchor:'map',color:'#e8edf2',intensity:0.6,position:[1.15,245,62]}},
};

/** The small part of MapLibre's Map this module needs, so it stays testable without WebGL. */
export type Themeable={
 getLayer:(id:string)=>unknown;setPaintProperty:(id:string,name:string,value:unknown)=>void;
 setSky?:(sky:unknown)=>void;setLight?:(light:unknown)=>void;
};

/** Repaint the base map in another theme without rebuilding it: the map instance, the
 *  camera and our own layers all survive, which the lifecycle tests hold us to. */
export function applyTheme(map:Themeable,theme:MapTheme){
 for(const layer of [...baseLayers(theme),buildingExtrusion(theme)]){
  if(!map.getLayer(layer.id))continue;
  for(const [name,value] of Object.entries((layer.paint??{}) as Record<string,unknown>))
   map.setPaintProperty(layer.id,name,value);
 }
 const style=buildStyle(theme);
 map.setSky?.(style.sky);
 map.setLight?.(style.light);
}

/** Theme-dependent paint for our own symbols: halos must separate a label from either ground. */
export const SYMBOL_HALO:Record<MapTheme,string>={day:'#fbf6ea',night:'#0b1720'};
