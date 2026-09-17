import {runsOn} from '@/lib/service-days';
import type {OperatingRule} from '@/lib/service-days';
import {validOn} from '@/lib/patterns';
import type {PatternCatalogue} from '@/lib/patterns';
import type {LiveVehicle} from '@/lib/live';

/**
 * The coverage ledger: for every service actually seen reporting, what this app can and cannot
 * say about it today, and why.
 *
 * Coverage here is four different things and they are kept apart, because a passenger and a
 * reviewer are misled by any single number:
 *
 *   positions   we receive the bus's own reports. This is near-total inside the area.
 *   timetable   a registration valid today, with journeys running today, in the direction the
 *               operator reported. Without it a bus is drawn where it reported and nothing is
 *               claimed about stops.
 *   geometry    a road path through the pattern's stops, accepted only against that pattern's
 *               own reports. Without it there is no street preview.
 *   estimate    movement between reports, which needs the geometry above.
 *
 * Route 256 on a weekday is the case that makes the distinction concrete: positions yes,
 * timetable no — the registration in force carries Saturday and Sunday journeys towards
 * Piccadilly Gardens and no Monday-to-Friday ones at all.
 */
export type ServiceCoverage={
 key:string; operator:string|null; line:string;
 /** Vehicles of this service in the publication the page is showing. */
 reporting:number;
 /** How many of those the timetable could place on a pattern. */
 placed:number;
 /** Why the rest could not be placed, commonest first. */
 refusals:{reason:string;count:number;explanation:string}[];
 /** Patterns held whose timetable is in force today and whose journeys run today. */
 patternsToday:number;
 /** Patterns held for this service on any day, in force or not. */
 patternsHeld:number;
 directionsToday:string[];
 /** Of today's patterns, how many have a road shape accepted against their own reports. */
 withGeometry:number;
};

export type CoverageLedger={
 day:string;
 services:ServiceCoverage[];
 totals:{services:number;reporting:number;placed:number;withTimetableToday:number;withGeometry:number};
 catalogue:{generatedAt:string|null;patterns:number};
};

/** Accepted road shapes, by pattern id, from /data/shapes/index.json. */
export type ShapeIndex={patterns?:Record<string,{status?:string}>};

const serviceKey=(operator:string|null|undefined,line:string)=>`${operator??'?'}|${line}`;

export function coverageLedger(vehicles:LiveVehicle[],catalogue:PatternCatalogue|null,
                               shapes:ShapeIndex|null,day:string):CoverageLedger{
 const accepted=new Set(Object.entries(shapes?.patterns??{})
  .filter(([,value])=>value?.status==='accepted').map(([id])=>id));
 const held=new Map<string,{today:ReturnType<typeof patternsOf>;all:number}>();
 function patternsOf(operator:string|null,line:string){
  return (catalogue?.patterns??[]).filter(p=>p.line===line&&(p.operator??null)===operator
   &&validOn(p,day)&&runsOn(p.operatingRules as OperatingRule[]|null|undefined,day)!==false);
 }
 const services=new Map<string,ServiceCoverage>();
 for(const vehicle of vehicles){
  const key=serviceKey(vehicle.operator,vehicle.route);
  let row=services.get(key);
  if(!row){
   if(!held.has(key)){
    const today=patternsOf(vehicle.operator??null,vehicle.route);
    const all=(catalogue?.patterns??[]).filter(p=>p.line===vehicle.route&&(p.operator??null)===(vehicle.operator??null)).length;
    held.set(key,{today,all});
   }
   const {today,all}=held.get(key)!;
   row={key,operator:vehicle.operator??null,line:vehicle.route,reporting:0,placed:0,refusals:[],
        patternsToday:today.length,patternsHeld:all,
        directionsToday:[...new Set(today.map(p=>p.direction).filter(Boolean) as string[])].sort(),
        withGeometry:today.filter(p=>accepted.has(p.id)).length};
   services.set(key,row);
  }
  row.reporting+=1;
  const match=vehicle.match;
  if(match&&'patternId' in match)row.placed+=1;
  else if(match&&'unresolved' in match){
   const found=row.refusals.find(r=>r.reason===match.unresolved);
   if(found)found.count+=1;
   else row.refusals.push({reason:match.unresolved,count:1,explanation:match.explanation});
  }
 }
 const rows=[...services.values()];
 for(const row of rows)row.refusals.sort((a,b)=>b.count-a.count||a.reason.localeCompare(b.reason));
 rows.sort((a,b)=>b.reporting-a.reporting||a.line.localeCompare(b.line,'en',{numeric:true}));
 return {day,services:rows,
  totals:{services:rows.length,
   reporting:rows.reduce((n,r)=>n+r.reporting,0),
   placed:rows.reduce((n,r)=>n+r.placed,0),
   withTimetableToday:rows.filter(r=>r.patternsToday>0).length,
   withGeometry:rows.filter(r=>r.withGeometry>0).length},
  catalogue:{generatedAt:catalogue?.generatedAt??null,patterns:catalogue?.patterns.length??0}};
}

/** What this service can be said to support, in the order a reader should take it. */
export const supportWords=(row:ServiceCoverage)=>[
 {label:'Positions',held:row.reporting>0,note:`${row.reporting} reporting now`},
 {label:'Timetable today',held:row.patternsToday>0,
  note:row.patternsToday>0?`${row.patternsToday} pattern${row.patternsToday===1?'':'s'} · ${row.directionsToday.join(', ')||'direction not stated'}`
   :row.patternsHeld>0?'held, but no journeys today':'no registration held here'},
 {label:'Road geometry',held:row.withGeometry>0,
  note:row.withGeometry>0?`${row.withGeometry} checked against its own reports`:'not built or not accepted'},
 {label:'Estimated movement',held:row.withGeometry>0,
  note:row.withGeometry>0?'between reports, labelled':'positions are shown as reported'},
];
