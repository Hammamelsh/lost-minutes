// Type-only names are imported as types so the file runs under Node's type stripping as
// well as through the bundler.
import {ageWords,freshnessOf,observationAge} from '@/lib/live';
import type {Freshness,LiveState} from '@/lib/live';
import {cleanLabel} from '@/lib/replay';
import type {Journey} from '@/lib/replay';

/** One bus as the passenger view needs it, from the live feed or from the archive. */
export type FollowBus = {
 key:string;operator:string;route:string;direction:string;journeyRef:string;vehicle:string;
 destination:string;lat:number;lon:number;observedAtMs:number;recordedAt:string;
 retrievedAt?:string;ageSeconds:number|null;freshness:Freshness|null;ageWords:string;
 sourceHash:string;
};

export const routeId = (bus:{operator:string;route:string}) => `${bus.operator}|${bus.route}`;
export const routeNumber = (id:string) => id.split('|')[1] ?? id;

/** Supplied direction words, made readable. Never inferred: if the feed says nothing, we say nothing. */
export function directionLabel(direction:string):string{
 const value=cleanLabel(direction).toLowerCase();
 if(!value)return '';
 if(value==='inbound')return 'Inbound';
 if(value==='outbound')return 'Outbound';
 return value.charAt(0).toUpperCase()+value.slice(1);
}

export function destinationLabel(destination:string):string{
 const value=cleanLabel(destination);
 return value||'Destination not supplied';
}

/** Latest reported position per vehicle from the live state. */
export function busesFromLive(live:LiveState|null,serverReferenceMs:number,
                              fetchedAtMs:number,nowMs:number):FollowBus[]{
 if(!live)return [];
 return live.vehicles.map(v=>{
  const age=observationAge(v,{serverReferenceMs},fetchedAtMs,nowMs);
  return {key:`${v.operator}|${v.vehicle}`,operator:v.operator,vehicle:v.vehicle,route:v.route,
   direction:v.direction,journeyRef:v.journeyRef,destination:v.destination??'',
   lat:v.lat,lon:v.lon,observedAtMs:v.observedAtMs,recordedAt:v.recordedAt,
   ageSeconds:age,freshness:freshnessOf(age,live.freshness.policy),ageWords:ageWords(age),
   sourceHash:v.sourceHash};
 }).filter(b=>b.freshness!=='expired');
}

/** Last reported position per vehicle in the recording. Ages are deliberately absent:
 *  "3 minutes ago" would be a lie about a recording made on another day. */
export function busesFromArchive(journeys:Journey[]):FollowBus[]{
 const latest=new Map<string,FollowBus>();
 for(const journey of journeys){
  const point=journey.points.at(-1);
  if(!point)continue;
  const key=`${journey.operator}|${journey.vehicle}`;
  const existing=latest.get(key);
  if(existing&&existing.observedAtMs>=point.time)continue;
  latest.set(key,{key,operator:journey.operator,vehicle:journey.vehicle,route:journey.route,
   direction:journey.direction,journeyRef:journey.journeyRef,destination:journey.destination,
   lat:point.lat,lon:point.lon,observedAtMs:point.time,recordedAt:point.recordedAt,
   retrievedAt:point.retrievedAt,ageSeconds:null,freshness:null,ageWords:'',
   sourceHash:point.sourceHash});
 }
 return Array.from(latest.values());
}

/** Routes with buses, most recently reported first, so suggestions are actually useful. */
export function routesByRecency(buses:FollowBus[]):{id:string;count:number;newestMs:number}[]{
 const map=new Map<string,{id:string;count:number;newestMs:number}>();
 for(const bus of buses){
  const id=routeId(bus);
  const entry=map.get(id);
  if(entry){entry.count+=1;entry.newestMs=Math.max(entry.newestMs,bus.observedAtMs)}
  else map.set(id,{id,count:1,newestMs:bus.observedAtMs});
 }
 return Array.from(map.values()).sort((a,b)=>b.newestMs-a.newestMs);
}
