import {z} from 'zod';

const patternSchema = z.object({
 id:z.string(), line:z.string(), direction:z.string().nullable().optional(),
 destination:z.string().nullable().optional(),
 stopCount:z.number().int(), stopsInArea:z.number().int(), lengthMetres:z.number().int(),
 hasRepeatedStop:z.boolean(),
 timetable:z.object({datasetSha256:z.string(),file:z.string(),validFrom:z.string(),validTo:z.string()}),
 stops:z.array(z.string()), metres:z.array(z.number()),
});

const catalogueSchema = z.object({
 schemaVersion:z.literal(1), generatedAt:z.string(),
 supportedLines:z.array(z.string()), patterns:z.array(patternSchema),
 rules:z.object({minimumStopsInAreaFraction:z.number(),minimumStops:z.number()}),
 attribution:z.string(), notes:z.array(z.string()),
});

export type ServicePattern = z.infer<typeof patternSchema>;
export type PatternCatalogue = z.infer<typeof catalogueSchema>;

export const parsePatterns = (value:unknown):PatternCatalogue => catalogueSchema.parse(value);

export function patternIndex(catalogue:PatternCatalogue|null):Map<string,ServicePattern>{
 const map=new Map<string,ServicePattern>();
 for(const pattern of catalogue?.patterns??[])map.set(pattern.id,pattern);
 return map;
}

export type StopRelation =
 | {kind:'approaching';stopsAway:number;alongRouteMetres:number;pattern:ServicePattern}
 | {kind:'passed';stopsPast:number;pattern:ServicePattern}
 | {kind:'at_stop';pattern:ServicePattern}
 | {kind:'does_not_call';pattern:ServicePattern}
 | {kind:'unresolved';reason:string;explanation:string}
 | {kind:'no_pattern_data'};

/**
 * How a matched bus relates to the passenger's stop, along the ordered pattern.
 *
 * `stopsAway` counts stops along the pattern from the stop the bus was last reported nearest
 * to. A position only tells us the bus is *near* that stop, not whether it has already called
 * there, so the count can be out by one in either direction. That is a stated property of the
 * method, not a validated error bound: no measurement of the true error has been made. No
 * arrival time is derived from it, because nothing here measures time.
 */
export function relateToStop(bus:{match?:unknown},stopId:string,
                             patterns:Map<string,ServicePattern>):StopRelation{
 const match=bus.match as (Record<string,unknown>|undefined);
 if(!match)return {kind:'no_pattern_data'};
 if(typeof match.unresolved==='string')
  return {kind:'unresolved',reason:match.unresolved,explanation:String(match.explanation??'')};
 const pattern=patterns.get(String(match.patternId));
 if(!pattern)return {kind:'no_pattern_data'};
 const busIndex=Number(match.patternIndex);
 const stopIndex=pattern.stops.indexOf(stopId);
 if(stopIndex<0)return {kind:'does_not_call',pattern};
 if(stopIndex===busIndex)return {kind:'at_stop',pattern};
 if(stopIndex<busIndex)return {kind:'passed',stopsPast:busIndex-stopIndex,pattern};
 return {kind:'approaching',stopsAway:stopIndex-busIndex,
         alongRouteMetres:Math.max(0,(pattern.metres[stopIndex]??0)-(pattern.metres[busIndex]??0)),
         pattern};
}

export function relationWords(relation:StopRelation):string{
 switch(relation.kind){
  case 'approaching':
   return relation.stopsAway===1
    ? 'about 1 stop away along the route'
    : `about ${relation.stopsAway} stops away along the route`;
  case 'at_stop': return 'last reported at your stop';
  case 'passed':
   return relation.stopsPast===1
    ? 'appears to have passed your stop'
    : `appears to have passed your stop, about ${relation.stopsPast} stops ago`;
  case 'does_not_call': return 'this branch does not call at your stop';
  case 'unresolved': return 'route position unresolved';
  default: return 'no route match';
 }
}

/**
 * Distance along the timetabled stop sequence, read as distance and never as a time.
 *
 * The figure is the operator's own declared link distance summed between stops. Measured
 * against straight lines on 1,791 consecutive stop pairs it is the same as the straight line
 * for most of them (median 1.01x, mean 1.08x, only 27% more than 5% longer), so it is a
 * stop-to-stop chain, not a road-following route distance. The wording says so.
 */
export const alongRouteWords = (metres:number) =>
 metres<1000?`${Math.round(metres/50)*50} m along the stop sequence`
            :`${(metres/1000).toFixed(1)} km along the stop sequence`;

/** Patterns that call at a stop, so a passenger can be told which services are supported. */
export function patternsCallingAt(catalogue:PatternCatalogue|null,stopId:string):ServicePattern[]{
 return (catalogue?.patterns??[]).filter(pattern=>pattern.stops.includes(stopId));
}
