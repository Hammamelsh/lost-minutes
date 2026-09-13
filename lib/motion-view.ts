"use client";
/**
 * From the published files to the motion core: a selected bus's reports, the road geometry of
 * the pattern it was placed on, and the settings measured by the published evaluation. Every
 * input is read, never invented: with no accepted geometry or no evaluation the bus is shown
 * where it reported, with the reason.
 */
import {z} from 'zod';
import {DEFAULT_PARAMS,decodePolyline,historyFrom,makeTrack,type ErrorProfile,type Fix,type History,
        type MotionParams,type Track} from '@/lib/motion';
import type {FollowBus} from '@/lib/follow';

export const serviceOf=(bus:{route:string;direction:string;journeyRef:string})=>
 `${bus.route}|${bus.direction}|${bus.journeyRef}`;

/** The bus's published trail and its latest report, as one journey's history. */
export function historyOf(bus:FollowBus):History{
 const service=serviceOf(bus);
 const fixes:Fix[]=(bus.trail??[]).map(p=>({at:p.at,lat:p.lat,lon:p.lon,bearing:p.bearing,service,source:p.source}));
 fixes.push({at:bus.observedAtMs,lat:bus.lat,lon:bus.lon,bearing:bus.bearing,
  availableAt:bus.retrievedAtMs??null,service,source:bus.sourceHash});
 return historyFrom(fixes);
}

// ------------------------------------------------------------------ road geometry

const indexSchema=z.object({patterns:z.record(z.object({status:z.string(),reason:z.string().nullable().optional(),
 file:z.string().optional()}).passthrough())}).passthrough();
const shapeSchema=z.object({id:z.string(),polyline6:z.string(),
 stopOffsets:z.array(z.number().nullable()).optional()}).passthrough();

export type TrackResult={track:Track|null;reason:string|null};

let indexRequest:Promise<z.infer<typeof indexSchema>|null>|null=null;
const trackRequests=new Map<string,Promise<TrackResult>>();

function loadIndex(base:string){
 indexRequest??=fetch(`${base}/index.json`,{cache:'no-store'})
  .then(response=>response.ok?response.json():null).then(value=>value?indexSchema.parse(value):null)
  .catch(()=>null);
 return indexRequest;
}

/** The accepted road geometry of a pattern, or why there is none. */
export function loadTrack(patternId:string|null|undefined,base='/data/shapes'):Promise<TrackResult>{
 if(!patternId)return Promise.resolve({track:null,reason:'its branch is not settled, so the road ahead is not known'});
 const cached=trackRequests.get(patternId);
 if(cached)return cached;
 const request=(async():Promise<TrackResult>=>{
  const index=await loadIndex(base);
  const entry=index?.patterns[patternId];
  if(!index)return {track:null,reason:'no road geometry has been published'};
  if(!entry)return {track:null,reason:'no road geometry has been built for this service'};
  if(entry.status!=='accepted'||!entry.file)return {track:null,reason:`its road geometry was not accepted: ${entry.reason??'no reason recorded'}`};
  const response=await fetch(`${base}/${entry.file}`,{cache:'no-store'}).catch(()=>null);
  if(!response?.ok)return {track:null,reason:'its road geometry could not be loaded'};
  const shape=shapeSchema.parse(await response.json());
  return {track:makeTrack(patternId,decodePolyline(shape.polyline6,6),shape.stopOffsets??[]),reason:null};
 })().catch(()=>({track:null,reason:'its road geometry could not be read'}));
 trackRequests.set(patternId,request);
 return request;
}

// ------------------------------------------------------------------ the measured settings

const evaluationSchema=z.object({
 version:z.string(),
 params:z.record(z.unknown()),
 errorProfile:z.object({version:z.string(),basis:z.string(),
  bins:z.array(z.object({upTo:z.number(),n:z.number(),p50:z.number(),p80:z.number()}))}).nullable(),
 corridor:z.object({lines:z.array(z.string()),patterns:z.array(z.string())}),
}).passthrough();

export type MotionModel={version:string;params:MotionParams;profile:ErrorProfile|null;patterns:Set<string>;lines:string[]};

let modelRequest:Promise<MotionModel|null>|null=null;

/** The published evaluation: its settings, its error by report age, and which patterns it covers. */
export function loadMotionModel(url='/data/motion-evaluation.json'):Promise<MotionModel|null>{
 modelRequest??=fetch(url,{cache:'no-store'}).then(response=>response.ok?response.json():null)
  .then(value=>{
   if(!value)return null;
   const data=evaluationSchema.parse(value);
   const params={...DEFAULT_PARAMS} as MotionParams;
   for(const [key,setting] of Object.entries(data.params))
    if(key in params&&typeof setting===typeof params[key as keyof MotionParams])
     (params as Record<string,unknown>)[key]=setting;
   params.version=data.version;
   return {version:data.version,params,profile:data.errorProfile,patterns:new Set(data.corridor.patterns),lines:data.corridor.lines};
  }).catch(()=>null);
 return modelRequest;
}

// ------------------------------------------------------------------ what the page says

/** What the map's clock reports to the page, a few times a minute rather than every frame. */
export type MotionInfo={mode:'estimated'|'observed';reason:string;reportAge:number;capped:boolean;horizon:number;
 speedKmh:number|null;eased:boolean;uncertaintyMetres:number|null;uncertaintyN:number|null;
 correction:{kind:string;metres:number;at:number}|null;version:string};

const ageWords=(seconds:number)=>seconds<90?`${seconds} s`:`${Math.round(seconds/60)} min`;

/** "Estimated position" with the real report age, or "Last reported position" with why. */
export function describeMotion(info:MotionInfo):{label:string;detail:string}{
 if(info.mode==='observed'){
  // When an estimate is withdrawn the drawn bus goes back to the report, and says how far.
  const moved=info.correction?.kind==='snap'&&info.correction.metres>=5
   ?` The drawn bus moved ${Math.round(info.correction.metres)} m to that report.`:'';
  return {label:`Last reported position · ${ageWords(info.reportAge)} ago`,detail:`Not estimated: ${info.reason}.${moved}`};
 }
 const parts=[info.speedKmh?`moving about ${info.speedKmh} km/h by its recent reports${info.eased?', eased off as the report ages':''}`
  :'standing at its last reports'];
 if(info.capped)parts.push(`held where it would be ${info.horizon} s after that report, the most we extrapolate`);
 if(info.uncertaintyMetres!==null)parts.push(`the pale band, ±${Math.round(info.uncertaintyMetres)} m, is where 8 in 10 `
  +`held-out estimates at this report age were found`);
 if(info.correction&&info.correction.metres>=5)
  parts.push(`the last new report ${info.correction.kind==='snap'?'moved it':'eased it'} ${Math.round(info.correction.metres)} m`);
 return {label:`Estimated position · last report ${ageWords(info.reportAge)} ago`,detail:`${parts.join('; ')}.`};
}

// ------------------------------------------------------------------ the passenger's choice

const PREFERENCE_KEY='lost-minutes.motion.v1';
const listeners=new Set<()=>void>();

/** Estimated movement is on by default; "reported positions only" is remembered on this device. */
export function motionPreferenceSnapshot(){
 try{return localStorage.getItem(PREFERENCE_KEY)!=='observed'}catch{return true}
}
export const motionPreferenceServerSnapshot=()=>true;
export function subscribeMotionPreference(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener)}}
export function saveMotionPreference(estimated:boolean){
 try{if(estimated)localStorage.removeItem(PREFERENCE_KEY);else localStorage.setItem(PREFERENCE_KEY,'observed')}catch{}
 listeners.forEach(listener=>listener());
}
