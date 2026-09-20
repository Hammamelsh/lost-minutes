import {z} from 'zod';
import {runsOn} from '@/lib/service-days';
import type {OperatingRule} from '@/lib/service-days';

const nullableString = z.string().nullable().optional();
const dateRange = z.tuple([z.string(),z.string()]);
const ruleSchema = z.object({
 days:z.array(z.number().int().min(0).max(6)).optional(), holidaysOnly:z.boolean().optional(),
 alsoOn:z.array(dateRange).optional(), notOn:z.array(dateRange).optional(),
 serviced:z.array(z.object({mode:z.enum(['only','except']),kind:z.string(),
  organisations:z.array(z.string()),ranges:z.array(dateRange)})).optional(),
 bankHolidays:z.string().optional(),
});

// Accepts the version-1 catalogue as well, so a site built before the rebuild still reads.
const patternSchema = z.object({
 id:z.string(), operator:nullableString, line:z.string(), serviceCode:nullableString,
 direction:nullableString, destination:nullableString,
 stopCount:z.number().int(), stopsInArea:z.number().int(),
 lengthMetres:z.number().int().nullable(), distancesKnown:z.boolean().nullable().optional(),
 hasRepeatedStop:z.boolean(),
 timetable:z.object({datasetSha256:z.string(),file:z.string(),
  validFrom:z.string().nullable(),validTo:z.string().nullable(),
  modified:nullableString,revision:nullableString}),
 runs:z.string().optional(), operatingRules:z.array(ruleSchema).nullable().optional(),
 journeys:z.number().int().nullable().optional(),
 stops:z.array(z.string()),
 // null: the timetable did not declare that distance. Unknown, never zero.
 metres:z.array(z.number().nullable()),
 /** Scheduled seconds from the first stop, from the timetable's link run times; null past an
  *  undeclared link, and absent from catalogues built before it was recorded. */
 seconds:z.array(z.number().nullable()).optional(),
 /** Distinct per-stop scheduled seconds among the journeys merged into this pattern; a
  *  scheduled journey names which one it runs. Absent from older catalogues. */
 timings:z.array(z.array(z.number().nullable())).optional(),
});

const catalogueSchema = z.object({
 schemaVersion:z.union([z.literal(1),z.literal(2)]), generatedAt:z.string(),
 supportedLines:z.array(z.string()), supportedServices:z.array(z.string()).optional(),
 coverage:z.record(z.unknown()).nullable().optional(),
 patterns:z.array(patternSchema),
 // minimumStopsInAreaFraction is the rule catalogues were built with before September 2026.
 rules:z.object({minimumStopsInArea:z.number().optional(),minimumStopsInAreaFraction:z.number().optional(),
  minimumStops:z.number()}),
 attribution:z.string(), notes:z.array(z.string()),
});

export type ServicePattern = z.infer<typeof patternSchema>;
export type PatternCatalogue = z.infer<typeof catalogueSchema>;

export function parsePatterns(value:unknown):PatternCatalogue{
 const catalogue=catalogueSchema.parse(value);
 for(const pattern of catalogue.patterns){
  if(pattern.stops.length!==pattern.metres.length)throw Error(`${pattern.id}: stops and distances disagree`);
  if(pattern.seconds&&pattern.stops.length!==pattern.seconds.length)throw Error(`${pattern.id}: stops and scheduled seconds disagree`);
 }
 return catalogue;
}

export function patternIndex(catalogue:PatternCatalogue|null):Map<string,ServicePattern>{
 const map=new Map<string,ServicePattern>();
 for(const pattern of catalogue?.patterns??[])map.set(pattern.id,pattern);
 return map;
}

/**
 * How a bus relates to the passenger's stop, from its last report and the timetable's order
 * of stops.
 *
 * The anchor is the pattern stop the report was *nearest* to. That is all a position gives:
 * it does not say whether the bus has called there yet, so "nearest to your stop" is never
 * turned into "at your stop", and a nearest stop after yours is described as a report past
 * your stop, not as a measured fact that it has left. No error bound is claimed for the count,
 * because none has been measured, and nothing here measures time.
 *
 * When the matcher left several branches open, each is kept. What stays supportable is what
 * holds on every one of them: a stop every branch calls at, at the same count or not.
 */
export type StopRelation =
 | {kind:'approaching';stopsAway:number;alongMetres:number|null;pattern:ServicePattern;nearestStop:string}
 | {kind:'near_your_stop';pattern:ServicePattern;metresFromStop:number|null}
 | {kind:'beyond';stopsPast:number;pattern:ServicePattern;nearestStop:string}
 | {kind:'does_not_call';pattern:ServicePattern}
 | {kind:'branch_all_call';stopsAway:number|null;range:[number,number]|null;candidates:ServicePattern[];nearestStop:string|null}
 | {kind:'branch_some_call';calling:number;total:number;candidates:ServicePattern[];nearestStop:string|null}
 | {kind:'branch_none_call';candidates:ServicePattern[];nearestStop:string|null}
 | {kind:'unresolved';reason:string;explanation:string}
 | {kind:'no_pattern_data'};

type MatchLike = {patternId?:unknown;patternIndex?:unknown;metresFromPatternStop?:unknown;
 unresolved?:unknown;explanation?:unknown;candidates?:unknown;nearestStop?:unknown};

const along=(pattern:ServicePattern,from:number,to:number)=>{
 const a=pattern.metres[from],b=pattern.metres[to];
 return a===null||a===undefined||b===null||b===undefined?null:Math.max(0,b-a);
};

export function relateToStop(bus:{match?:unknown},stopId:string,
                             patterns:Map<string,ServicePattern>):StopRelation{
 const match=bus.match as MatchLike|undefined;
 if(!match)return {kind:'no_pattern_data'};
 if(typeof match.unresolved==='string'){
  if(match.unresolved==='ambiguous_branch'&&Array.isArray(match.candidates))
   return relateBranches(match,stopId,patterns);
  return {kind:'unresolved',reason:match.unresolved,explanation:String(match.explanation??'')};
 }
 const pattern=patterns.get(String(match.patternId));
 if(!pattern)return {kind:'no_pattern_data'};
 const busIndex=Number(match.patternIndex);
 const stopIndex=pattern.stops.indexOf(stopId);
 const nearestStop=pattern.stops[busIndex]??'';
 const metres=Number(match.metresFromPatternStop);
 if(stopIndex<0)return {kind:'does_not_call',pattern};
 if(stopIndex===busIndex)return {kind:'near_your_stop',pattern,metresFromStop:Number.isFinite(metres)?metres:null};
 if(stopIndex<busIndex)return {kind:'beyond',stopsPast:busIndex-stopIndex,pattern,nearestStop};
 return {kind:'approaching',stopsAway:stopIndex-busIndex,alongMetres:along(pattern,busIndex,stopIndex),
         pattern,nearestStop};
}

function relateBranches(match:MatchLike,stopId:string,patterns:Map<string,ServicePattern>):StopRelation{
 const candidates=(match.candidates as {patternId:string;patternIndex:number}[])
  .map(c=>({pattern:patterns.get(c.patternId),index:c.patternIndex}))
  .filter((c):c is {pattern:ServicePattern;index:number}=>Boolean(c.pattern));
 if(candidates.length<2)
  return {kind:'unresolved',reason:'ambiguous_branch',explanation:String(match.explanation??'')};
 const nearestStop=typeof match.nearestStop==='string'?match.nearestStop:null;
 // Stops ahead to your stop on each branch; null where that branch does not bring it there.
 const ahead=candidates.map(c=>{const j=c.pattern.stops.indexOf(stopId);return j>=c.index?j-c.index:null});
 const calling=ahead.filter((n):n is number=>n!==null);
 const list=candidates.map(c=>c.pattern);
 if(calling.length===candidates.length){
  const low=Math.min(...calling),high=Math.max(...calling);
  return {kind:'branch_all_call',stopsAway:low===high?low:null,range:low===high?null:[low,high],
          candidates:list,nearestStop};
 }
 if(calling.length)return {kind:'branch_some_call',calling:calling.length,total:candidates.length,
                           candidates:list,nearestStop};
 return {kind:'branch_none_call',candidates:list,nearestStop};
}

const stops=(n:number)=>`${n} ${n===1?'stop':'stops'}`;

/** Short, list-sized words for a relation. The card adds the qualification beside it. */
export function relationWords(relation:StopRelation):string{
 switch(relation.kind){
  case 'approaching': return `${stops(relation.stopsAway)} before yours`;
  case 'near_your_stop': return 'last reported at or near your stop';
  case 'beyond': return 'last reported past your stop';
  case 'does_not_call': return 'its branch does not call at your stop';
  case 'branch_all_call':
   if(relation.stopsAway===0)return 'at or near your stop on every possible branch';
   return relation.stopsAway!==null
    ? `${stops(relation.stopsAway)} before yours on every possible branch`
    : `${relation.range![0]}–${relation.range![1]} stops before yours, by branch`;
  case 'branch_some_call': return `your stop is on ${relation.calling} of ${relation.total} possible branches`;
  case 'branch_none_call': return 'none of its possible branches calls at your stop';
  case 'unresolved': return 'position along the route unresolved';
  default: return 'no timetable pattern held';
 }
}

/** Whether a relation lets the bus be offered as one to wait for at this stop. */
export const bringsItToYourStop=(relation:StopRelation)=>
 relation.kind==='approaching'||relation.kind==='near_your_stop'||relation.kind==='branch_all_call';

/**
 * Distance along the timetabled stop sequence, read as distance and never as a time.
 *
 * The figure is the operator's own declared link distance summed between stops. Measured
 * against straight lines on 1,791 consecutive stop pairs it is the same as the straight line
 * for most of them (median 1.01x, mean 1.08x, only 27% more than 5% longer), so it is a
 * stop-to-stop chain, not a road-following route distance. The wording says so. Where the
 * timetable did not declare a link, the distance is unknown and is said to be.
 */
export const alongRouteWords = (metres:number|null) =>
 metres===null?'distance along the stop sequence not declared by the timetable'
 :metres<1000?`${Math.round(metres/50)*50} m along the stop sequence`
 :`${(metres/1000).toFixed(1)} km along the stop sequence`;

/** A pattern can be boarded at a stop it calls at, except its last: there it terminates. */
export const boardableAt=(pattern:ServicePattern,stopId:string)=>{
 const index=pattern.stops.indexOf(stopId);
 return index>=0&&index<pattern.stops.length-1;
};

/**
 * Whether the timetable version a pattern came from is in force on a day (YYYY-MM-DD).
 *
 * The catalogue is built ahead of the days it is used on, and since September 2026 it also
 * carries registrations that start within the next fortnight, so that a timetable change does
 * not depend on a rebuild happening that morning. A pattern is therefore only usable on a day
 * its own declared validity covers. ISO dates compare correctly as strings.
 */
export const validOn=(pattern:ServicePattern,day:string)=>{
 const {validFrom,validTo}=pattern.timetable;
 return (!validFrom||validFrom<=day)&&(!validTo||day<=validTo);
};

/** Patterns that call at a stop and can be boarded there, optionally only those whose timetable
 *  is in force and whose journeys run on a given day (YYYY-MM-DD). A pattern whose days are not
 *  recorded is kept, as unknown. */
export function patternsCallingAt(catalogue:PatternCatalogue|null,stopId:string,day?:string):ServicePattern[]{
 return (catalogue?.patterns??[]).filter(pattern=>boardableAt(pattern,stopId)
  &&(!day||validOn(pattern,day))
  &&(!day||runsOn(pattern.operatingRules as OperatingRule[]|null|undefined,day)!==false));
}
