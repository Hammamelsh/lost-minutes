/** The vector basemap's plumbing: where MapLibre is served from, the credits it must show,
 *  and whether this device can render it. The style itself is ours, in lib/map-style.ts.
 *
 *  OpenFreeMap serves OpenMapTiles-schema vector tiles from OpenStreetMap data, free and
 *  without a key. Attribution for OpenStreetMap and the providers is required and is shown
 *  on the map. MapLibre is the renderer; it bundles no tiles of its own.
 */
import maplibrePackage from 'maplibre-gl/package.json';

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

/** Whether this device gives a WebGL context at all. The probe's own context is released at once:
 *  left for the garbage collector, one was kept alive for every page load, on top of the map's. */
export function webglAvailable(){
 if(typeof document==='undefined')return false;
 try{
  const canvas=document.createElement('canvas');
  const gl=(canvas.getContext('webgl2')||canvas.getContext('webgl')) as WebGLRenderingContext|null;
  if(!gl)return false;
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return true;
 }catch{return false}
}

export const prefersReducedMotion = () =>
 typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
