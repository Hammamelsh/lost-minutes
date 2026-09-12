import {z} from 'zod';

const stopSchema = z.object({
 id:z.string(), name:z.string(), indicator:z.string().optional(), street:z.string().optional(),
 locality:z.string().optional(), parentLocality:z.string().optional(),
 bearing:z.string().optional(), lat:z.number(), lon:z.number(),
});

const routeSchema = z.object({
 operator:z.string(), route:z.string(), observations:z.number().int().nonnegative(),
 destinations:z.array(z.string()), lastObservedAtMs:z.number().nullable().optional(),
});

const catalogueSchema = z.object({
 schemaVersion:z.literal(1), generatedAt:z.string(),
 area:z.object({bbox:z.array(z.number()).length(4),label:z.string(),atcoArea:z.string()}),
 stops:z.array(stopSchema), routes:z.array(routeSchema),
 attribution:z.string(), notes:z.array(z.string()),
});

export type Stop = z.infer<typeof stopSchema>;
export type CatalogueRoute = z.infer<typeof routeSchema>;
export type Catalogue = z.infer<typeof catalogueSchema>;

export const parseCatalogue = (value:unknown):Catalogue => catalogueSchema.parse(value);

/** NaPTAN bearings are the direction a bus travels at the stop, which is how the two sides
 *  of one road are told apart. Anything we were not given stays unsaid. */
const COMPASS:Record<string,string> = {N:'northbound',NE:'north-eastbound',E:'eastbound',
 SE:'south-eastbound',S:'southbound',SW:'south-westbound',W:'westbound',NW:'north-westbound'};
export const bearingWords = (bearing?:string) => bearing?COMPASS[bearing.toUpperCase()]??'':'';

/** "Stop SB · southbound · Princess Street" — enough to pick the right side of the road. */
export function stopDetail(stop:Stop):string{
 return [stop.indicator,bearingWords(stop.bearing),stop.street]
  .filter(Boolean).join(' · ');
}

export const stopPlace = (stop:Stop) =>
 [stop.locality,stop.parentLocality].filter(Boolean).join(', ');

/** Straight-line metres. Never presented as a walking distance: pavements are not straight. */
export function straightLineMetres(a:{lat:number;lon:number},b:{lat:number;lon:number}){
 const R=6371000,toRad=Math.PI/180;
 const dLat=(b.lat-a.lat)*toRad,dLon=(b.lon-a.lon)*toRad;
 const lat=((a.lat+b.lat)/2)*toRad;
 const x=dLon*Math.cos(lat);
 return Math.round(R*Math.sqrt(x*x+dLat*dLat));
}

export function distanceWords(metres:number):string{
 if(metres<1000)return `${Math.round(metres/10)*10} m away in a straight line`;
 return `${(metres/1000).toFixed(1)} km away in a straight line`;
}

const normalise = (value:string) => value.toLowerCase().replace(/[^a-z0-9 ]+/g,' ').replace(/\s+/g,' ').trim();

export type StopMatch = {stop:Stop;score:number};

/**
 * Rank stops for a typed query. Whole-word prefixes beat mid-word matches, and every typed
 * word must appear somewhere, so "picc gard" finds Piccadilly Gardens but "picc xyz" finds
 * nothing rather than something plausible-looking.
 */
export function searchStops(stops:Stop[],query:string,limit=20,near?:{lat:number;lon:number}):StopMatch[]{
 const words=normalise(query).split(' ').filter(Boolean);
 if(!words.length)return [];
 const results:StopMatch[]=[];
 for(const stop of stops){
  const haystack=normalise([stop.name,stop.indicator,stop.street,stop.locality,
                            stop.parentLocality].filter(Boolean).join(' '));
  const name=normalise(stop.name);
  let score=0,ok=true;
  for(const word of words){
   if(name.startsWith(word))score+=6;
   else if(new RegExp(`\\b${word}`).test(name))score+=4;
   else if(new RegExp(`\\b${word}`).test(haystack))score+=2;
   else if(haystack.includes(word))score+=1;
   else {ok=false;break}
  }
  if(!ok)continue;
  if(near)score+=Math.max(0,3-straightLineMetres(near,stop)/1000);
  results.push({stop,score});
 }
 return results.sort((a,b)=>b.score-a.score||a.stop.name.localeCompare(b.stop.name)).slice(0,limit);
}

export function nearestStops(stops:Stop[],point:{lat:number;lon:number},limit=8){
 return stops.map(stop=>({stop,metres:straightLineMetres(point,stop)}))
  .sort((a,b)=>a.metres-b.metres).slice(0,limit);
}

// ------------------------------------------------------------------ saved stops

const STORE='lost-minutes.stops.v1';
const EMPTY:string[]=[];
let cachedRaw:string|null|undefined;
let cachedValue:string[]=EMPTY;
const listeners=new Set<()=>void>();

function read():string[]{
 try{
  const raw=window.localStorage.getItem(STORE);
  if(!raw)return EMPTY;
  const parsed=z.array(z.string()).safeParse(JSON.parse(raw));
  return parsed.success?parsed.data.slice(0,20):EMPTY;
 }catch{return EMPTY}
}

export function savedStopsSnapshot():string[]{
 let raw:string|null=null;
 try{raw=window.localStorage.getItem(STORE)}catch{raw=null}
 if(raw!==cachedRaw){cachedRaw=raw;cachedValue=raw?read():EMPTY}
 return cachedValue;
}

export const savedStopsServerSnapshot=()=>EMPTY;

export function subscribeSavedStops(callback:()=>void){
 listeners.add(callback);
 const onStorage=(event:StorageEvent)=>{if(event.key===STORE||event.key===null)callback()};
 window.addEventListener('storage',onStorage);
 return()=>{listeners.delete(callback);window.removeEventListener('storage',onStorage)};
}

/** Device-local only, and a device that refuses storage is reported rather than crashed through. */
export function saveStops(ids:string[]):boolean{
 let ok=true;
 try{window.localStorage.setItem(STORE,JSON.stringify(ids.slice(0,20)))}catch{ok=false}
 cachedRaw=undefined;
 listeners.forEach(callback=>callback());
 return ok;
}

export const toggleSavedStop=(ids:string[],id:string)=>
 ids.includes(id)?ids.filter(value=>value!==id):[id,...ids];
