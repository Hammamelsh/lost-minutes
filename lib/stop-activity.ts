/**
 * What a bus's own reports say about it and a stop, and nothing more.
 *
 *   Last reported near X    its latest report is current (no more than 150 s old) and lies within
 *                           50 m of X, a stop on the pattern the bus is matched to, so the stop across
 *                           the road, on the other direction's pattern, is never the one named; where
 *                           both the bus and NaPTAN give a direction, they agree to within 90°.
 *   Appears stopped near X  in addition, at least two distinct reports of this journey, at least 20 s
 *                           apart, the latest no more than 60 s old, all lie within 40 m of X and
 *                           within 15 m (GPS noise) of the latest.
 *
 * Only observations count: never an estimate, the drawn bus, the timetable's assumed dwell, a
 * repeated report or a single position. Stopped near a stop is not at it: the bus may be at lights
 * or in traffic, and nothing here says its doors are open or that anyone can board.
 */
import type {FollowBus} from '@/lib/follow';
import type {ServicePattern} from '@/lib/patterns';
import {straightLineMetres,type Stop} from '@/lib/stops';

export const STOP_ACTIVITY={nearMetres:50,standRadius:40,standSeconds:20,jitterMetres:15,
 freshSeconds:60,currentSeconds:150,bearingTolerance:90} as const;

const COMPASS_DEGREES:Record<string,number>={N:0,NE:45,E:90,SE:135,S:180,SW:225,W:270,NW:315};

/** One report as the rule read it: how far it lay from the stop and from the latest report. */
export type ActivityObservation={at:number;metres:number;fromLatest:number;source:string|null;counted:boolean};

export type StopActivity=
 |{kind:'none';reason:string;observations:ActivityObservation[]}
 |{kind:'near';stop:string;metres:number;at:number;observations:ActivityObservation[]}
 |{kind:'stopped';stop:string;metres:number;since:number;at:number;reports:number;observations:ActivityObservation[]};

const ageWords=(seconds:number)=>seconds<90?`${Math.round(seconds)} s`:`${Math.round(seconds/60)} min`;

/** The bus against the stops of the pattern it is matched to. `pattern` is that matched pattern:
 *  a bus whose branch is unsettled, or with no pattern, has no stop named. */
export function stopActivity(bus:FollowBus,pattern:ServicePattern|null|undefined,
                             stopsById:Map<string,Stop>):StopActivity{
 const rule=STOP_ACTIVITY;
 const none=(reason:string):StopActivity=>({kind:'none',reason,observations:[]});
 if(bus.ageSeconds===null)return none('a recording is shown at its reports, so nothing is said about it now');
 if(!pattern)return none('it is not placed on one timetable pattern, so no stop on its route can be named');
 if(bus.freshness==='stale'||bus.freshness==='expired'||bus.ageSeconds>rule.currentSeconds)
  return none(`its last report is ${ageWords(bus.ageSeconds)} old, too old to say where it is now`);
 let best:{stop:Stop;metres:number}|null=null;
 for(const id of pattern.stops){
  const stop=stopsById.get(id);
  if(!stop)continue;
  const metres=straightLineMetres(stop,bus);
  if(!best||metres<best.metres)best={stop,metres};
 }
 if(!best)return none('no stop on its pattern has a position here');
 if(best.metres>rule.nearMetres)
  return none(`its last report is ${Math.round(best.metres/10)*10} m from the nearest stop on its route`);
 const stopBearing=best.stop.bearing?COMPASS_DEGREES[best.stop.bearing.toUpperCase()]:undefined;
 if(bus.bearing!==null&&stopBearing!==undefined){
  const apart=Math.abs(((bus.bearing-stopBearing)%360+540)%360-180);
  if(apart>rule.bearingTolerance)
   return none(`it reported heading ${Math.round(bus.bearing)}°, not the direction buses travel at ${best.stop.name}`);
 }
 // Distinct reports of this journey, newest first: a repeated report is one observation.
 const seen=new Set<number>();
 const reports=[{at:bus.observedAtMs,lat:bus.lat,lon:bus.lon,source:bus.sourceHash as string|null},
  ...(bus.trail??[]).map(point=>({at:point.at,lat:point.lat,lon:point.lon,source:point.source}))]
  .filter(point=>{if(seen.has(point.at))return false;seen.add(point.at);return true})
  .sort((a,b)=>b.at-a.at);
 const latest=reports[0],stop=best.stop;
 const observations:ActivityObservation[]=reports.map(point=>({at:point.at,metres:straightLineMetres(stop,point),
  fromLatest:straightLineMetres(latest,point),source:point.source,counted:false}));
 // The run back from the latest report that stays by the stop and within GPS noise of the latest.
 let run=0;
 for(const observation of observations){
  if(observation.metres>rule.standRadius||observation.fromLatest>rule.jitterMetres)break;
  run+=1;
 }
 const span=run>=2?(latest.at-observations[run-1].at)/1000:0;
 if(run>=2&&span>=rule.standSeconds&&bus.ageSeconds<=rule.freshSeconds){
  observations.slice(0,run).forEach(observation=>{observation.counted=true});
  return {kind:'stopped',stop:stop.id,metres:best.metres,since:observations[run-1].at,at:latest.at,reports:run,observations};
 }
 observations[0].counted=true;
 return {kind:'near',stop:stop.id,metres:best.metres,at:latest.at,observations};
}

/** The words for a finding, or null when nothing is said. */
export function activityWords(activity:StopActivity,name:(atco:string)=>string):{text:string;detail:string}|null{
 const rule=STOP_ACTIVITY;
 if(activity.kind==='stopped')return {text:`Appears stopped near ${name(activity.stop)}`,
  detail:`${activity.reports} of its reports over ${Math.round((activity.at-activity.since)/1000)} s lie within `
   +`${rule.standRadius} m of the stop and within ${rule.jitterMetres} m of each other. Stopped near a stop is not the `
   +'same as at it: it may be waiting at lights or in traffic, and this says nothing about its doors.'};
 if(activity.kind==='near')return {text:`Last reported near ${name(activity.stop)}`,
  detail:`About ${Math.round(activity.metres/5)*5} m from the stop. One report cannot tell standing, arriving and passing apart.`};
 return null;
}
