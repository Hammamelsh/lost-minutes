/**
 * The view from above: Manchester as previously captured 3D imagery (a photographic mesh in the
 * OGC 3D Tiles format), with the same buses drawn on it that the map draws, at the same places.
 * Research and the decision behind it: docs/PHOTO_3D_RESEARCH.md.
 *
 * Nothing here loads until a passenger asks for the view. The renderer (CesiumJS) is served from
 * this site like MapLibre is, from a folder named by version, and is loaded by a script tag on
 * demand — about 6 MB of JavaScript before compression — so the everyday page never carries it.
 * The imagery comes from the tileset the server is configured to offer (config.json, `photo3d`),
 * which is absent unless the owner has set it up; then the view is not offered at all.
 */
import type * as CesiumTypes from 'cesium';

/** Where this site serves CesiumJS from; the installed version's folder is named in version.json
 *  beside it (scripts/vendor-cesium.mjs), read at runtime. */
export const CESIUM_ROOT='/vendor/cesium/';

/** The server's offer of a 3D tileset, as config.json carries it (lib/live.ts, `photo3d`). */
export type Photo3d={provider:'google'|'sample';tilesetUrl:string;attribution:string;note?:string};

/** One bus as the map drew it this tick: the same drawn place, so a change of renderer never moves
 *  a bus. `chosen` is the passenger's bus; `bearing` is the way it is drawn heading, or null. */
export type DrawnBus={key:string;route:string;destination:string;lat:number;lon:number;bearing:number|null;
 chosen:boolean;ageSeconds:number};
/** What the map drew at `at` (presentation time, ms): every bus it stepped, and where. */
export type DrawnFrame={at:number;buses:DrawnBus[]};

declare global {
 interface Window {Cesium?:typeof CesiumTypes;CESIUM_BASE_URL?:string}
}

let loading:Promise<typeof CesiumTypes>|null=null;

/** CesiumJS, loaded once from this site's own copy; rejects where the script cannot be loaded. */
export function loadCesium():Promise<typeof CesiumTypes>{
 if(typeof window==='undefined')return Promise.reject(new Error('no window'));
 if(window.Cesium)return Promise.resolve(window.Cesium);
 if(loading)return loading;
 loading=(async()=>{
  // The installed version, read fresh: a folder cached under an older version would be gone.
  const response=await fetch(`${CESIUM_ROOT}version.json`,{cache:'no-store'}).catch(()=>null);
  const version=response?.ok?((await response.json()) as {version?:string}).version:undefined;
  if(!version)throw new Error('the 3D renderer is not served by this site');
  const base=`${CESIUM_ROOT}${version}/`;
  window.CESIUM_BASE_URL=base;
  return new Promise<typeof CesiumTypes>((resolve,reject)=>{
   const css=document.createElement('link');
   css.rel='stylesheet';css.href=`${base}Widgets/widgets.css`;
   document.head.appendChild(css);
   const script=document.createElement('script');
   script.src=`${base}Cesium.js`;script.async=true;
   script.onload=()=>{if(window.Cesium)resolve(window.Cesium);else reject(new Error('Cesium loaded but did not define itself'))};
   script.onerror=()=>reject(new Error('the 3D renderer could not be loaded'));
   document.head.appendChild(script);
  });
 })().catch(error=>{loading=null;throw error});
 return loading;
}

/** A point `metres` from (lat, lon) along `bearing` degrees from north. */
export function offsetAlong(lat:number,lon:number,bearing:number,metres:number):{lat:number;lon:number}{
 const rad=bearing*Math.PI/180;
 return {lat:lat+metres*Math.cos(rad)/111195,lon:lon+metres*Math.sin(rad)/(111195*Math.cos(lat*Math.PI/180))};
}

/** The camera for following a bus from above and behind: `range` metres back along its heading and
 *  `height` metres up, looking at it. Shared by the descent and the follow, so they meet. */
export const ABOVE_FOLLOW={range:150,height:95,pitchDegrees:-32};
/** The elevated view a passenger opens on: the city from `height` metres, tilted `pitchDegrees`. */
export const ABOVE_CITY={height:1400,pitchDegrees:-58};
/** Ellipsoidal height assumed for a bus before the ground under it has been measured: Manchester's
 *  centre is 40–60 m above sea level, and the WGS84 ellipsoid lies about 49 m under sea level there,
 *  so a road is around 95 m above the ellipsoid. Measured against the imagery once it has loaded. */
export const ABOVE_DEFAULT_GROUND=95;
