"use client";
/**
 * From the published files to the motion core: a selected bus's reports, the road geometry of
 * the pattern it was placed on, and the settings measured by the published evaluation. Every
 * input is read, never invented: with no accepted geometry or no evaluation the bus is shown
 * where it reported, with the reason.
 */
import {z} from 'zod';
import {DEFAULT_PARAMS,decodePolyline,historyFrom,makeTrack,project,type ErrorProfile,type Fix,type History,
        type MotionParams,type RepositionReason,type Track} from '@/lib/motion';
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

/** The ids of every pattern whose road geometry is accepted, from the one shared index request. */
export async function loadAcceptedPatterns(base='/data/shapes'):Promise<Set<string>|null>{
 const index=await loadIndex(base);
 if(!index)return null;
 return new Set(Object.entries(index.patterns).filter(([,entry])=>entry.status==='accepted'&&entry.file).map(([id])=>id));
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

// ------------------------------------------------------------------ verified shared road

/** Along the accepted track, the stretches every other candidate's road also runs down. */
export type SharedRoad={from:number;to:number}[];

/**
 * Where two or more candidate patterns share the same road, measured, not inferred.
 *
 * Until 20 September 2026 an unresolved match whose candidates shared every stop ahead was
 * given the first candidate's road, on the reasoning that identical remaining stops meant an
 * identical road ahead. That is an inference, and a wrong one in general: two variants can call
 * at the same stops by different streets, and a bus still before the boarding stop is on road
 * that the candidates' later convergence says nothing about. This looks at the geometry instead.
 *
 * Every vertex of each other candidate's shape is projected onto the accepted track. A run of
 * accepted-track offsets where all of them lie within `toleranceMetres` is shared road; anything
 * else is not, whatever the stop lists say. The accepted track is the reference because it is the
 * one checked against that service's own reports; a candidate whose shape was never accepted
 * lends nothing but its geometry, and only where that geometry coincides with checked road.
 *
 * Measured on route 15 inbound on 20 September 2026: all 684 vertices of the 5-journey short
 * working lie within 10 m of the accepted 140-journey shape, so the shared run is 395 m to
 * 13,626 m of the accepted track, and Hillingdon Road (opp) at 8,715 m has 8,320 m of shared
 * road before it. The first 395 m are not shared and are refused.
 */
export function sharedRoad(accepted:Track,others:Track[],toleranceMetres=10):SharedRoad{
 if(!others.length)return [{from:0,to:accepted.length}];
 // Walk the accepted track's own vertices: each is shared road if every other candidate's road
 // passes within tolerance of it. Runs are contiguous vertices, so the result needs no guess at
 // how far apart hits may be. The first version projected the *other* shapes onto this one and
 // bridged hits within 60 m; a road with a 136 m straight then fell into pieces, none long
 // enough to hold a look-ahead, and a bus plainly on shared road was refused. Testing this
 // track's vertices instead makes a long straight one segment, as it is.
 const near:(number|undefined)[]=others.map(()=>undefined);
 const sharedAt=(i:number)=>{
  const at={lat:accepted.points[i][1],lon:accepted.points[i][0]};
  for(let k=0;k<others.length;k++){
   const projection=project(others[k],at,near[k]);
   if(projection.offset>toleranceMetres)return false;
   near[k]=projection.s;
  }
  return true;
 };
 const runs:SharedRoad=[];
 let open:{from:number;to:number}|null=null;
 for(let i=0;i<accepted.points.length;i++){
  const s=accepted.cum[i];
  if(sharedAt(i)){
   if(open)open.to=s;else open={from:s,to:s};
  }else if(open){runs.push(open);open=null}
 }
 if(open)runs.push(open);
 return runs.filter(r=>r.to>r.from);
}

/** Whether a bus at `offset` metres, and the road `lookAheadMetres` beyond it, is all shared. */
export function withinSharedRoad(shared:SharedRoad,offset:number,lookAheadMetres:number){
 return shared.some(run=>offset>=run.from&&offset+lookAheadMetres<=run.to);
}

export type SharedTrackResult={track:Track|null;shared:SharedRoad|null;candidates:string[];reason:string|null};
const sharedRequests=new Map<string,Promise<SharedTrackResult>>();

/**
 * The road for an unresolved bus: the accepted candidate's track, with the stretches every
 * candidate shares. Nothing is chosen between the candidates; only where their roads coincide is
 * used, and the caller must still check the bus's own position against `shared`.
 */
export function loadSharedTrack(candidateIds:string[],base='/data/shapes'):Promise<SharedTrackResult>{
 const ids=[...new Set(candidateIds)].sort();
 if(ids.length<2)return Promise.resolve({track:null,shared:null,candidates:ids,reason:'its branch is not settled, so the road ahead is not known'});
 const key=ids.join('|');
 const cached=sharedRequests.get(key);
 if(cached)return cached;
 const request=(async():Promise<SharedTrackResult>=>{
  const index=await loadIndex(base);
  if(!index)return {track:null,shared:null,candidates:ids,reason:'no road geometry has been published'};
  const entries=ids.map(id=>({id,entry:index.patterns[id]}));
  if(entries.some(e=>!e.entry?.file))return {track:null,shared:null,candidates:ids,reason:'its branch is not settled, and not every candidate has road geometry to compare'};
  const accepted=entries.filter(e=>e.entry!.status==='accepted');
  if(!accepted.length)return {track:null,shared:null,candidates:ids,reason:'its branch is not settled, and none of the candidates’ road geometry has been checked against reports'};
  const tracks=new Map<string,Track>();
  for(const {id,entry} of entries){
   const response=await fetch(`${base}/${entry!.file}`,{cache:'no-store'}).catch(()=>null);
   if(!response?.ok)return {track:null,shared:null,candidates:ids,reason:'its road geometry could not be loaded'};
   const shape=shapeSchema.parse(await response.json());
   tracks.set(id,makeTrack(id,decodePolyline(shape.polyline6,6),shape.stopOffsets??[]));
  }
  const reference=tracks.get(accepted[0].id)!;
  const others=ids.filter(id=>id!==reference.id).map(id=>tracks.get(id)!);
  const shared=sharedRoad(reference,others);
  if(!shared.length)return {track:null,shared:[],candidates:ids,reason:'its branch is not settled, and the candidates take different roads'};
  return {track:reference,shared,candidates:ids,reason:null};
 })().catch(()=>({track:null,shared:null,candidates:ids,reason:'its road geometry could not be read'}));
 sharedRequests.set(key,request);
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
 /** Observed, and at this moment travelling between two of its own reports (GLIDE). */
 between?:boolean;
 /** Observed, with the reports to travel between as they arrive: the mode, whether or not it is
  *  moving in this frame. Off under "reported positions only", or with a single report. */
 travels?:boolean;
 /** Observed and travelling down a checked road between its reports, rather than along the chord. */
 onRoad?:boolean;
 /** Observed, with a checked road that its reports have left here for another street: drawn in a
  *  straight line between them. */
 offRoad?:boolean;
 /** Observed and played back, and at this instant standing where its reports stood (a stop, the
  *  lights): said as standing, not as "moving between its reports" (25 September 2026). */
 standing?:boolean;
 /** Observed and played back: how long ago the moment is that the drawn place stands for — the
  *  presentation clock less that moment, in seconds. It includes the latest report's own age; what
  *  the playback adds is this less `reportAge`. */
 displayDelaySeconds?:number|null;
 speedKmh:number|null;eased:boolean;uncertaintyMetres:number|null;uncertaintyN:number|null;
 correction:{kind:string;metres:number;at:number;justNow?:boolean;standing?:boolean;
  /** Set when the bus was repositioned rather than travelled: which continuity was missing. */
  why?:RepositionReason}|null;version:string};

/** What to say about a repositioning, in the passenger's terms rather than the model's. */
export const REPOSITION_WORDS:Record<RepositionReason,string>={
 no_earlier_report:'there was no earlier report to travel from',
 too_far:'it is too far to have been followed between reports',
 too_long:'too long passed between its reports',
 resumed:'the page was in the background, so its movement meanwhile was not drawn',
};

const ageWords=(seconds:number)=>seconds<90?`${seconds} s`:`${Math.round(seconds/60)} min`;

/**
 * A delay in seconds to the nearest five. The drawn moment's age is the real one — the
 * presentation clock less the moment being shown, measured on the map each frame, never the
 * setting — and it drifts by a second or two as the clock runs at real time and the reports
 * arrive; said to five seconds with "about", it is honest and does not flicker. Under three
 * seconds it is not a delay worth a number.
 */
export function delaySeconds(actual:number|null|undefined):number|null{
 if(actual==null||!Number.isFinite(actual)||actual<2.5)return null;
 return Math.round(actual/5)*5;
}

/** "Estimated position" with the real report age, or "Last reported position" with why. */
export function describeMotion(info:MotionInfo):{label:string;detail:string;said?:string}{
 if(info.mode==='observed'){
  // When an estimate is withdrawn the drawn bus goes back to the report, and says how far.
  // A bus drawn at its reports that could not travel to the new one is *repositioned*, and that
  // says which continuity was missing rather than leaving the move unexplained.
  const c=info.correction;
  const moved=c?.kind==='snap'&&c.metres>=5
   ?c.why?` It was moved ${Math.round(c.metres)} m to its latest report rather than travelled there, because `
     +`${REPOSITION_WORDS[c.why]}. The ground in between was not drawn, because it is not known.`
    :` The drawn bus moved ${Math.round(c.metres)} m to that report.`:'';
  // The label says what is drawn at this instant — travelling between two of its own reports, or
  // standing at the newest — and one sentence under both explains the cycle, so the two read as
  // one story rather than two features. Labelling the *mode* instead captioned a bus standing at a
  // report three minutes old as "between its reports", which it was not. The reason is the reason:
  // on route 263 the road is checked and what is withheld is the evaluation, and a fixed clause
  // about geometry was false there. Nothing here is a guess about where the bus is now.
  // Two ages, never merged: how old the latest report is, and how much further back the playback
  // draws the bus than that report. The label gives the moment drawn — now less the moment the drawn
  // place stands for, which is the figure measured — with the report's own age beside it; the
  // detail gives what the playback adds. A playback within a few seconds of the report adds nothing
  // worth a number, and then only the report's age is said: rounding the moment drawn to five
  // seconds could otherwise put it under the report's own age (25 September 2026).
  const extra=info.displayDelaySeconds!=null&&Number.isFinite(info.displayDelaySeconds)
   ?delaySeconds(info.displayDelaySeconds-info.reportAge):null;
  const delay=extra!==null?delaySeconds(info.displayDelaySeconds):null;
  const pace=', at a bus’s own pace — its speed smoothed over the previous half-minute, pulling away and slowing as '
   +'a bus does — so that it moves steadily instead of stopping and starting as each report arrives; it is never '
   +'ahead of a report.';
  const delayed=delay!==null&&extra!==null
   ?` It is drawn where its reports put it about ${delay} seconds ago: its latest report is ${ageWords(info.reportAge)}`
    +` old, and the playback draws it about ${extra} s behind that report${pace}`
   :info.displayDelaySeconds!=null&&info.travels?` It is drawn at or just behind its latest report, ${ageWords(info.reportAge)} old${pace}`:'';
  const drawn=delay!==null?`as it was about ${ageWords(delay)} ago · report ${ageWords(info.reportAge)} old`:null;
  const cycle=info.travels
   ?(delayed||' It moves between its own reports at the speed they imply and waits at the newest, so it can run a '
    +'little behind, never ahead, and may pause.')
    +(info.onRoad
      ?' Between two reports it goes down the road checked against this service’s own reports, because both'
       +' of them were measured onto it.'
      :info.offRoad
      ?' Here its reports have left the road checked for this service — they lie on another street — so it is'
       +' drawn in a straight line between them: the streets it took are not known.'
      :' The line between two reports is a straight line, not its road: no road has been checked for it.')
   :'';
  // A repositioning is said where it is seen, not only in the explanation: `said` repeats it for the
  // card to keep in view while the rest of the detail folds away (26 September 2026).
  const said=moved.trim()||undefined;
  if(info.between&&info.offRoad)return {label:drawn!==null?`Off its checked road · ${drawn}`
    :`Off its checked road · latest ${ageWords(info.reportAge)} ago`,
   detail:`Not estimated: ${info.reason}.${cycle}${moved}`,said};
  if(info.between&&info.standing)return {label:drawn!==null?`Standing · ${drawn}`
    :`Standing · latest ${ageWords(info.reportAge)} ago`,
   detail:`Not estimated: ${info.reason}.${cycle}${moved}`,said};
  if(info.between)return {label:drawn!==null?`Moving between its reports · ${drawn}`
    :`Moving between its reports · latest ${ageWords(info.reportAge)} ago`,
   detail:`Not estimated: ${info.reason}.${cycle}${moved}`,said};
  return {label:`Last reported position · ${ageWords(info.reportAge)} ago`,detail:`Not estimated: ${info.reason}.${cycle}${moved}`,said};
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
