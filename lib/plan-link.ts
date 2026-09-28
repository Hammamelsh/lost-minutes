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

// The journey chosen from the options: a direct bus ("d:pattern|board|alight") or one with a change
// ("c:pattern|board|alight|pattern|board|alight"). Public identifiers only: timetable pattern ids and
// NaPTAN codes, which the page that opens the link looks up afresh and checks against that day.
const PLAN_KEY=/^[dc]:[^|\s]{1,80}(\|[0-9A-Za-z]{4,16}){2}(\|[^|\s]{1,80}(\|[0-9A-Za-z]{4,16}){2})?$/;
export const isPlanKey=(value:string)=>PLAN_KEY.test(value)&&(value.startsWith('d:')?value.split('|').length===3:value.split('|').length===6);

export function readPlanLink(search:string):{from:LinkedPlace|null;to:LinkedPlace|null;plan:string|null}{
 const params=new URLSearchParams(search);
 const plan=params.get('plan');
 return {from:readPoint(params,'from'),to:readPoint(params,'to'),plan:plan&&isPlanKey(plan)?plan:null};
}

/** The current address with the plan's places and chosen journey written in (or taken out), everything else kept. */
export function withPlan(search:string,from:LinkedPlace|null,to:LinkedPlace|null,plan:string|null=null):string{
 const params=new URLSearchParams(search);
 for(const [key,place] of [['from',from],['to',to]] as const){
  if(place){params.set(key,`${place.lat.toFixed(5)},${place.lon.toFixed(5)}`);params.set(`${key}Label`,place.label.slice(0,80))}
  else{params.delete(key);params.delete(`${key}Label`)}
 }
 if(plan&&to&&isPlanKey(plan))params.set('plan',plan);else params.delete('plan');
 const q=params.toString();
 return q?`?${q}`:'';
}
