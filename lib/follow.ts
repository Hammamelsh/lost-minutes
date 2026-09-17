// Type-only names are imported as types so the file runs under Node's type stripping as
// well as through the bundler.
import {ageWords,freshnessOf,observationAge} from '@/lib/live';
import type {Freshness,LiveState,LiveVehicle} from '@/lib/live';
import {cleanLabel} from '@/lib/replay';
import type {Journey} from '@/lib/replay';

/** One bus as the passenger view needs it, from the live feed or from the archive. */
export type FollowBus = {
 key:string;operator:string;route:string;direction:string;journeyRef:string;vehicle:string;
 destination:string;lat:number;lon:number;observedAtMs:number;recordedAt:string;
 retrievedAt?:string;ageSeconds:number|null;freshness:Freshness|null;ageWords:string;
 sourceHash:string;
 /** Where the timetable places this bus, or why it could not be placed. Carried through
  *  from the published state so the map, the card and the list all say the same thing. */
 match?:LiveVehicle['match'];
 /** Reported heading in degrees, or null. Never derived from movement: a bus that did not
  *  report one is drawn without a direction. */
 bearing:number|null;
 bearingStatus:'reported'|'absent'|'invalid'|'not_captured';
 /** Scheduled departure from the origin, as the operator reported it. */
 aimedDeparture?:string|null;
 /** When the collector fetched the latest report: nothing downstream could know it earlier. */
 retrievedAtMs?:number|null;
 /** Earlier observed reports of the same journey, oldest first, as published. */
 trail?:TrailFix[];
};

/** One earlier report of the same journey: an observation, never an estimate. */
export type TrailFix={at:number;lat:number;lon:number;bearing:number|null;source:string|null};

/** A bearing is used only when reported and inside the compass. Anything else is null. */
export const usableBearing=(value:unknown,status:unknown)=>
 status==='reported'&&typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=360?value:null;

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
 // Every use reads "to <this>", so the absence has to be a phrase, not a status: "to Destination
 // not supplied" read as a place called Destination.
 return value||'an unnamed destination';
}

/** One published vehicle as the passenger view needs it, aged against the server's clock. */
export function busFromVehicle(v:LiveVehicle,policy:LiveState['freshness']['policy'],
                               serverReferenceMs:number,fetchedAtMs:number,nowMs:number,
                               trailSources:string[]=[]):FollowBus{
 const age=observationAge(v,{serverReferenceMs},fetchedAtMs,nowMs);
 return {key:`${v.operator}|${v.vehicle}`,operator:v.operator,vehicle:v.vehicle,route:v.route,
  direction:v.direction,journeyRef:v.journeyRef,destination:v.destination??'',
  lat:v.lat,lon:v.lon,observedAtMs:v.observedAtMs,recordedAt:v.recordedAt,
  ageSeconds:age,freshness:freshnessOf(age,policy),ageWords:ageWords(age),
  sourceHash:v.sourceHash,match:v.match,
  bearing:usableBearing(v.bearing,v.bearingStatus),bearingStatus:v.bearingStatus??'not_captured',
  aimedDeparture:v.aimedDeparture??null,retrievedAtMs:v.retrievedAtMs??null,
  trail:(v.trail??[]).map(([before,lat,lon,bearing,index])=>
   ({at:v.observedAtMs-before,lat,lon,bearing:usableBearing(bearing,bearing===null?'absent':'reported'),
     source:trailSources[index]??null}))};
}

/** Latest reported position per vehicle from the live state. */
export function busesFromLive(live:LiveState|null,serverReferenceMs:number,
                              fetchedAtMs:number,nowMs:number):FollowBus[]{
 if(!live)return [];
 return live.vehicles.map(v=>busFromVehicle(v,live.freshness.policy,serverReferenceMs,fetchedAtMs,nowMs,
                                            live.trailSources??[]))
  .filter(b=>b.freshness!=='expired');
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
   sourceHash:point.sourceHash,
   // The recording was captured before bearings were stored; a later reprocess may add them.
   bearing:usableBearing((point as {bearing?:unknown}).bearing,(point as {bearingStatus?:unknown}).bearingStatus),
   bearingStatus:((point as {bearingStatus?:FollowBus['bearingStatus']}).bearingStatus)??'not_captured',
   aimedDeparture:journey.aimedDeparture||null});
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
