/**
 * The scheduled departure board for one boarding point.
 *
 * This is a different capability from matching a vehicle to our motion model, and it is built from
 * a different thing: the operator's own registered timetable, which the pipeline already parses
 * (`pipeline/departures.py`). A row here is a *scheduled* departure and says so. Nothing on this
 * board is a prediction, and no row borrows a time from a bus: where a tracked vehicle can be tied
 * to a scheduled journey it is named beside that row, and where it cannot the row stands alone.
 *
 * Times are seconds from local midnight on the service day, so a journey timed at 00:12 the next
 * morning is 86 520 rather than 720 and stays in order. Each is turned into a real instant against
 * Europe/London, so a countdown crosses midnight and both clock changes without arithmetic on
 * wall-clock strings.
 */
import {z} from 'zod';
import {type OperatingRule,londonDate,ruleApplies} from '@/lib/service-days';

const ruleSchema:z.ZodType<OperatingRule>=z.object({
 days:z.array(z.number()).optional(),holidaysOnly:z.boolean().optional(),
 alsoOn:z.array(z.tuple([z.string(),z.string()])).optional(),
 notOn:z.array(z.tuple([z.string(),z.string()])).optional(),
 serviced:z.array(z.object({mode:z.enum(['only','except']),kind:z.string(),
  organisations:z.array(z.string()),ranges:z.array(z.tuple([z.string(),z.string()]))})).optional(),
 bankHolidays:z.string().optional(),
}).passthrough() as unknown as z.ZodType<OperatingRule>;

const serviceSchema=z.object({
 patternId:z.string(),operator:z.string().nullable(),line:z.string(),
 direction:z.string().nullable(),destination:z.string().nullable(),sequence:z.number(),
 rules:z.array(z.number()),offsets:z.array(z.number().nullable()),
 runs:z.array(z.array(z.number())),
 timetable:z.object({file:z.string().nullable(),datasetSha256:z.string().nullable(),
  validFrom:z.string().nullable(),validTo:z.string().nullable()}).partial().optional(),
});
const boardSchema=z.object({schemaVersion:z.number(),stop:z.string(),generatedAt:z.string(),
 services:z.array(serviceSchema)});
const rulesSchema=z.object({schemaVersion:z.number(),rules:z.array(ruleSchema)});

export type StopBoardService=z.infer<typeof serviceSchema>;
export type StopDepartures={stop:string;generatedAt:string;services:StopBoardService[]};

/** One scheduled departure from this stop, on a named journey of a named pattern. */
export type ScheduledDeparture={
 /** Local midnight of the service day it belongs to, plus its own seconds. */
 atMs:number;
 /** The operator's scheduled departure from the pattern's *first* stop, HH:MM:SS local: what the
  *  feed reports as OriginAimedDepartureTime, and the only key a vehicle may be joined on. */
 originLocal:string;
 originSeconds:number;
 /** Seconds from that service day's local midnight at *this* stop: past 86 400 for a journey
  *  timed after midnight, which is how it keeps its place in the order. */
 stopSeconds:number;
 serviceDay:string;
 line:string;destination:string;direction:string|null;operator:string|null;patternId:string;
 /** How many journeys of this pattern leave the origin at that time: more than one and no single
  *  vehicle can be named for this row. */
 sharedDeparture:number;
 /** False when the journey carried no operating profile we could read: it may not run today. */
 dayKnown:boolean;
};

const SECONDS_IN_DAY=86_400;
const LONDON=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',hour12:false,
 year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});

/** Europe/London's offset from UTC at that instant, in milliseconds. */
function offsetAt(ms:number):number{
 const parts=Object.fromEntries(LONDON.formatToParts(ms).map(part=>[part.type,part.value]));
 const asUtc=Date.UTC(Number(parts.year),Number(parts.month)-1,Number(parts.day),
  Number(parts.hour)%24,Number(parts.minute),Number(parts.second));
 return asUtc-Math.floor(ms/1000)*1000;
}

/**
 * The instant of `seconds` past local midnight on `iso`, in Europe/London.
 *
 * Taken in two passes, because the offset that applies is the one at the answer, not the one at
 * the guess: on the last Sunday in October 01:30 happens twice and on the last Sunday in March it
 * does not happen at all, and a timetable states wall-clock times either way.
 */
export function londonInstant(iso:string,seconds:number):number{
 const [year,month,day]=iso.split('-').map(Number);
 const wall=Date.UTC(year,(month??1)-1,day??1)+seconds*1000;
 return wall-offsetAt(wall-offsetAt(wall));
}

/** Local midnight of the service day a moment belongs to: a timetable's day, not the clock's. */
export const serviceDayOf=(nowMs:number)=>londonDate(nowMs);

/** A day either side of an ISO date: `-1` for the journeys timed past midnight that still belong
 *  to yesterday, `+1` for tomorrow morning's, which is what is next at eleven at night. */
export function shiftDay(iso:string,days:number):string{
 const [year,month,day]=iso.split('-').map(Number);
 return new Date(Date.UTC(year,(month??1)-1,(day??1)+days)).toISOString().slice(0,10);
}
export const previousDay=(iso:string)=>shiftDay(iso,-1);

const label=(value:string|null|undefined)=>(value??'').replace(/_/g,' ').trim();

/** Every departure of one service on one service day, as instants. */
function departuresOf(service:StopBoardService,rules:OperatingRule[],day:string):ScheduledDeparture[]{
 const out:ScheduledDeparture[]=[];
 const shared=new Map<number,number>();
 for(const run of service.runs){
  let at=run[2];
  for(let i=2;i<run.length;i++){
   if(i>2)at+=run[i];
   shared.set(at,(shared.get(at)??0)+1);
  }
 }
 for(const run of service.runs){
  const ruleIndex=run[0],timing=run[1];
  const rule=ruleIndex>=0?rules[service.rules[ruleIndex]??-1]:undefined;
  // A journey whose own profile we could not read is neither claimed to run nor hidden: it is
  // carried with `dayKnown` false, and the board says the day is unconfirmed rather than guessing.
  const dayKnown=rule!==undefined;
  if(rule&&!ruleApplies(rule,day))continue;
  const offset=service.offsets[timing];
  if(offset===null||offset===undefined)continue;
  let origin=run[2];
  for(let i=2;i<run.length;i++){
   if(i>2)origin+=run[i];
   const seconds=origin+offset;
   const hours=Math.floor(origin/3600),minutes=Math.floor((origin%3600)/60),secs=origin%60;
   out.push({
    atMs:londonInstant(day,seconds),
    originLocal:`${String(hours%24).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:${String(secs).padStart(2,'0')}`,
    originSeconds:origin,stopSeconds:seconds,serviceDay:day,
    line:service.line,destination:label(service.destination),direction:service.direction,
    operator:service.operator,patternId:service.patternId,
    sharedDeparture:shared.get(origin)??1,dayKnown,
   });
  }
 }
 return out;
}

/**
 * The next `limit` scheduled departures from this stop at `nowMs`.
 *
 * Two service days are read: today's, and yesterday's for the journeys timed past midnight that
 * are still running. A departure already gone is dropped by `graceSeconds`, not by nothing: a bus
 * timed at 21:14 is still worth showing at 21:14:30.
 */
export function nextDepartures(board:StopDepartures|null,rules:OperatingRule[]|null,nowMs:number,
                               {limit=8,graceSeconds=60,withinMinutes=180}={}):ScheduledDeparture[]{
 if(!board||!rules)return [];
 const today=serviceDayOf(nowMs),yesterday=previousDay(today),tomorrow=shiftDay(today,1);
 const all:ScheduledDeparture[]=[];
 for(const service of board.services){
  all.push(...departuresOf(service,rules,today));
  // Only the ones that ran past midnight; the rest of yesterday is over. Judged on the time at
  // *this* stop, which is the departure's own — two journeys of one pattern can be timed
  // differently, so the pattern's first offset is not theirs.
  for(const departure of departuresOf(service,rules,yesterday))
   if(departure.stopSeconds>=SECONDS_IN_DAY)all.push(departure);
  // And tomorrow's, because at eleven at night the next bus from this stop is tomorrow's, and a
  // board that simply went blank would be saying something it does not know.
  all.push(...departuresOf(service,rules,tomorrow));
 }
 const from=nowMs-graceSeconds*1000,to=nowMs+withinMinutes*60_000;
 return all.filter(d=>d.atMs>=from&&d.atMs<=to).sort((a,b)=>a.atMs-b.atMs).slice(0,limit);
}

/** Minutes until a departure, from the instants themselves: never from a clock-face subtraction. */
export const minutesUntil=(departure:{atMs:number},nowMs:number)=>
 Math.round((departure.atMs-nowMs)/60_000);

export function countdownWords(departure:{atMs:number},nowMs:number):string{
 const minutes=minutesUntil(departure,nowMs);
 if(minutes<=0)return 'due';
 if(minutes===1)return '1 min';
 if(minutes<60)return `${minutes} min`;
 const hours=Math.floor(minutes/60);
 return `${hours} h ${minutes-hours*60} min`;
}

export const clockWords=(departure:{atMs:number})=>new Intl.DateTimeFormat('en-GB',
 {timeZone:'Europe/London',hour:'2-digit',minute:'2-digit',hour12:false}).format(departure.atMs);

const boardCache=new Map<string,Promise<StopDepartures|null>>();
let rulesRequest:Promise<OperatingRule[]|null>|null=null;

/**
 * A fetch that is certain to settle. A board that says "reading the timetable" has promised
 * something about the near future, and a promise that a hung request can hold for ever is the
 * fault this milestone fixed in the front view's "checking" (docs/REVIEW.md).
 */
async function fetchWithin(url:string,ms=8000):Promise<Response|null>{
 const abort=new AbortController();
 const timer=setTimeout(()=>abort.abort(),ms);
 try{return await fetch(url,{signal:abort.signal})}catch{return null}finally{clearTimeout(timer)}
}

/** The shared operating rules every board's services point at: one fetch, kept for the visit. */
export function loadDepartureRules(base='/data'):Promise<OperatingRule[]|null>{
 rulesRequest??=(async()=>{
  const response=await fetchWithin(`${base}/departure-rules.json`);
  if(!response?.ok)return null;
  const parsed=rulesSchema.safeParse(await response.json().catch(()=>null));
  return parsed.success?parsed.data.rules:null;
 })();
 return rulesRequest;
}

/** One stop's board. A stop with no board published is null, never an empty board: they differ. */
export function loadStopDepartures(atco:string|null|undefined,base='/data'):Promise<StopDepartures|null>{
 if(!atco)return Promise.resolve(null);
 const cached=boardCache.get(atco);
 if(cached)return cached;
 const request=(async():Promise<StopDepartures|null>=>{
  const response=await fetchWithin(`${base}/departures/${encodeURIComponent(atco)}.json`);
  if(!response?.ok)return null;
  const parsed=boardSchema.safeParse(await response.json().catch(()=>null));
  return parsed.success?{stop:parsed.data.stop,generatedAt:parsed.data.generatedAt,
   services:parsed.data.services}:null;
 })();
 boardCache.set(atco,request);
 return request;
}

/** For tests: forget what has been fetched. */
export function resetDepartureCache(){boardCache.clear();rulesRequest=null}
