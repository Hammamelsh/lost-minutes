// A plan in a link: where to, and where from if the start is a fixed place. Never the device's
// position by itself; the page that opens the link finds its own buses now.
import type {LatLon} from './plan';

export type LinkedPlace=LatLon&{label:string};

const num=(v:string|undefined)=>{if(v===undefined||v.trim()==='')return null;const n=Number(v);return Number.isFinite(n)?n:null};
const readPoint=(params:URLSearchParams,key:string):LinkedPlace|null=>{
 const raw=params.get(key);
 if(!raw)return null;
 const parts=raw.split(',');
 if(parts.length!==2)return null;
 const lat=num(parts[0]),lon=num(parts[1]);
 // A missing or malformed half is nothing, not a number: this was a crash on every page load
 // without a plan in the address until the reader was tested.
 if(lat==null||lon==null||Math.abs(lat)>90||Math.abs(lon)>180)return null;
 return {lat,lon,label:params.get(`${key}Label`)?.slice(0,80)||`a point at ${lat.toFixed(4)}, ${lon.toFixed(4)}`};
};

export function readPlanLink(search:string):{from:LinkedPlace|null;to:LinkedPlace|null}{
 const params=new URLSearchParams(search);
 return {from:readPoint(params,'from'),to:readPoint(params,'to')};
}

/** The current address with the plan's places written in (or taken out), everything else kept. */
export function withPlan(search:string,from:LinkedPlace|null,to:LinkedPlace|null):string{
 const params=new URLSearchParams(search);
 for(const [key,place] of [['from',from],['to',to]] as const){
  if(place){params.set(key,`${place.lat.toFixed(5)},${place.lon.toFixed(5)}`);params.set(`${key}Label`,place.label.slice(0,80))}
  else{params.delete(key);params.delete(`${key}Label`)}
 }
 const q=params.toString();
 return q?`?${q}`:'';
}
