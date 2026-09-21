// Finding a route by its number, from the timetable catalogue rather than from the buses reporting
// now: a route does not disappear because no bus on it is visible this minute.
import type {PatternCatalogue,ServicePattern} from './patterns';

export type RouteDirection={direction:string|null;destination:string|null;patterns:ServicePattern[]};
export type RouteHit={id:string;operator:string|null;line:string;directions:RouteDirection[];exact:boolean};

/** One entry per operator and line, with its directions and the patterns behind each. */
export function routeIndex(catalogue:PatternCatalogue|null):RouteHit[]{
 const byRoute=new Map<string,RouteHit>();
 for(const pattern of catalogue?.patterns??[]){
  const id=`${pattern.operator??''}|${pattern.line}`;
  const hit=byRoute.get(id)??{id,operator:pattern.operator??null,line:pattern.line,directions:[],exact:false};
  const key=`${pattern.direction??''}|${pattern.destination??''}`;
  let dir=hit.directions.find(d=>`${d.direction??''}|${d.destination??''}`===key);
  if(!dir){dir={direction:pattern.direction??null,destination:pattern.destination??null,patterns:[]};hit.directions.push(dir)}
  dir.patterns.push(pattern);
  byRoute.set(id,hit);
 }
 for(const hit of byRoute.values()){
  // The direction most journeys run first; a destination named by one school journey last.
  const journeys=(d:RouteDirection)=>d.patterns.reduce((n,p)=>n+(p.journeys??0),0);
  hit.directions.sort((a,b)=>journeys(b)-journeys(a));
 }
 return [...byRoute.values()].sort((a,b)=>a.line.localeCompare(b.line,undefined,{numeric:true}));
}

/** What a passenger types for a bus: digits with an optional letter (263, 42A), or a letter
 *  prefix and digits (V1, X43). Anything else is a stop, street or area. */
export const looksLikeRoute=(query:string)=>/^(\d{1,3}[a-z]?|[a-z]{1,2}\d{1,3})$/i.test(query.trim());

/** Routes matching a query: an exact number first, then numbers that begin with it. */
export function searchRoutes(index:RouteHit[],query:string,limit=6):RouteHit[]{
 const q=query.trim().toUpperCase().replace(/\s+/g,'');
 if(!q||!looksLikeRoute(q))return [];
 const exact=index.filter(r=>r.line.toUpperCase()===q).map(r=>({...r,exact:true}));
 const prefix=index.filter(r=>r.line.toUpperCase()!==q&&r.line.toUpperCase().startsWith(q)).map(r=>({...r,exact:false}));
 return [...exact,...prefix].slice(0,limit);
}

/** The stop sequence a direction can be browsed by: its longest pattern. */
export function longestPattern(direction:RouteDirection):ServicePattern|null{
 return direction.patterns.reduce<ServicePattern|null>((best,p)=>!best||p.stops.length>best.stops.length?p:best,null);
}
