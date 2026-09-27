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

/** Required credits, each linked to its own terms, in the words each provider asks for (read
 *  27 September 2026): OpenStreetMap's data is ODbL, credited "© OpenStreetMap contributors" or
 *  "© OpenStreetMap" with the name linked to its copyright page; OpenFreeMap asks to be named; the
 *  OpenMapTiles schema is CC-BY 4.0, credited "© OpenMapTiles". `more` is the part a phone leaves
 *  out (globals.css), still giving the credit OpenStreetMap asks for; a © is joined to its name, so
 *  a credit that has to take two lines never parts them. */
export const BASEMAP_CREDITS = [
 {label:'©\u00a0OpenStreetMap',more:' contributors',href:'https://www.openstreetmap.org/copyright'},
 {label:'OpenFreeMap',href:'https://openfreemap.org'},
 {label:'©\u00a0OpenMapTiles',href:'https://www.openmaptiles.org/'},
] as const;

export const BASEMAP_ATTRIBUTION = BASEMAP_CREDITS.map(c=>c.label+('more' in c?c.more:'')).join(' · ');

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
