/** The vector basemap: OpenFreeMap's dark style, with the layers a passenger needs added.
 *
 *  OpenFreeMap serves OpenMapTiles-schema vector tiles from OpenStreetMap data, free and
 *  without a key. Attribution for OpenStreetMap and the providers is required and is shown
 *  on the map. MapLibre is the renderer; it bundles no tiles of its own.
 */
import maplibrePackage from 'maplibre-gl/package.json';

export const BASEMAP_STYLE = 'https://tiles.openfreemap.org/styles/dark';

/** MapLibre's own ES modules, served unbundled so that its web worker resolves beside them
 *  (scripts/vendor-maplibre.mjs). The version in the path keeps every cached copy coherent. */
export const MAPLIBRE_MODULE_URL = `/vendor/maplibre-gl/${maplibrePackage.version}/maplibre-gl.mjs`;

/** Required credits, each linked to its own terms. OpenStreetMap data is ODbL; OpenFreeMap
 *  and OpenMapTiles ask to be named. */
export const BASEMAP_CREDITS = [
 {label:'© OpenStreetMap contributors',href:'https://www.openstreetmap.org/copyright'},
 {label:'OpenFreeMap',href:'https://openfreemap.org'},
 {label:'OpenMapTiles',href:'https://www.openmaptiles.org/'},
] as const;

export const BASEMAP_ATTRIBUTION = BASEMAP_CREDITS.map(c=>c.label).join(' · ');

/** The dark style carries water and streets but no green space, which is exactly what makes
 *  a city recognisable. These are added over the same vector source. */
export const GREEN_SPACE_LAYERS = [
 {id:'lm-park',type:'fill',source:'openmaptiles','source-layer':'park',
  paint:{'fill-color':'#17301f','fill-opacity':0.55}},
 {id:'lm-landcover-wood',type:'fill',source:'openmaptiles','source-layer':'landcover',
  filter:['in','class','wood','grass'],
  paint:{'fill-color':'#16301e','fill-opacity':0.45}},
 {id:'lm-landuse-green',type:'fill',source:'openmaptiles','source-layer':'landuse',
  filter:['in','class','cemetery','pitch','park'],
  paint:{'fill-color':'#16301e','fill-opacity':0.4}},
] as const;

/** Pitched buildings for the optional city view. Restrained on purpose: they orient you,
 *  they are not the subject. */
export const BUILDING_LAYER = {
 id:'lm-buildings', type:'fill-extrusion', source:'openmaptiles', 'source-layer':'building',
 minzoom:13,
 paint:{
  'fill-extrusion-color':'#24404f',
  'fill-extrusion-height':['coalesce',['get','render_height'],12],
  'fill-extrusion-base':['coalesce',['get','render_min_height'],0],
  'fill-extrusion-opacity':0.75,
 },
} as const;

export function webglAvailable(){
 if(typeof document==='undefined')return false;
 try{
  const canvas=document.createElement('canvas');
  return !!(canvas.getContext('webgl2')||canvas.getContext('webgl'));
 }catch{return false}
}

export const prefersReducedMotion = () =>
 typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
