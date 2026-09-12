import {z} from 'zod';

const nullableString = z.string().nullable().optional();
const count = z.number().int().nonnegative();

const vehicleSchema = z.object({
 operator:z.string(), vehicle:z.string(), route:z.string(), direction:z.string(),
 journeyRef:z.string(), destination:z.string().nullable().optional(),
 origin:z.string().nullable().optional(),
 observedAtMs:z.number().int(), recordedAt:z.string(),
 lat:z.number().min(-90).max(90), lon:z.number().min(-180).max(180),
 ageSeconds:z.number(), freshness:z.string(),
 // Stated by the publisher on every position. An estimate would have to say so.
 positionKind:z.literal('observed'),
 sourceHash:z.string().regex(/^[a-f0-9]{64}$/),
});

const summarySchema = z.object({
 samples:count, p50:z.number().nullable(), p95:z.number().nullable(),
 min:z.number().nullable(), max:z.number().nullable(), windowDescription:z.string(),
});

const liveSchema = z.object({
 schemaVersion:z.literal(1),
 state:z.enum(['live','stale','unavailable']),
 mode:z.literal('live_bods'),
 unavailableReason:nullableString,
 area:z.object({bbox:z.array(z.number()).length(4),label:z.string()}),
 publishedAt:z.string(), publishedAtMs:z.number().int(),
 collection:z.object({
  lastRequestAt:nullableString, lastSuccessAt:nullableString,
  lastPayloadChangeAt:nullableString,
  cycles:count, succeeded:count, repeatPayloads:count, failed:count,
  consecutiveFailures:count, sharedCollector:z.boolean(),
 }),
 freshness:z.object({
  policy:z.object({
   observationFreshSeconds:z.number(), observationAgeingSeconds:z.number(),
   observationStaleSeconds:z.number(), observationExpirySeconds:z.number(),
   publicationStaleSeconds:z.number(), futureToleranceSeconds:z.number(),
   pollIntervalSeconds:z.number(), basis:z.string(),
  }),
  measured:z.object({
   publicationDelaySeconds:summarySchema, reportIntervalSeconds:summarySchema,
   sourceCadenceSeconds:summarySchema, caveat:z.string(),
  }).nullable(),
 }),
 vehicles:z.array(vehicleSchema),
 withheld:z.object({
  expiredPositions:count, positionsAheadOfClock:count, conflictingIdentities:count,
  quarantinedRecords:count,
  quarantineReasons:z.array(z.object({reason:z.string(),count:count})),
 }),
 sourceQuality:z.object({quarantineReasons:z.array(z.object({reason:z.string(),count:count})),note:z.string()}),
 pipelineFailures:z.object({cycles:z.array(z.object({outcome:z.string(),count:count})),note:z.string()}),
 attribution:z.string(),
 notes:z.array(z.string()),
});

export const configSchema = z.object({
 schemaVersion:z.literal(1),
 liveUrl:z.string(), replayUrl:z.string(), operationsUrl:z.string(),
 pollSeconds:z.number().positive(),
 note:z.string().optional(),
});

export type LiveState = z.infer<typeof liveSchema>;
export type LiveVehicle = z.infer<typeof vehicleSchema>;
export type SiteConfig = z.infer<typeof configSchema>;
export type FreshnessPolicy = LiveState['freshness']['policy'];

export const DEFAULT_CONFIG:SiteConfig = {schemaVersion:1, liveUrl:'/data/live.json',
 replayUrl:'/data/replay.json', operationsUrl:'/data/operations.json', pollSeconds:20};

export function parseLive(value:unknown):LiveState{
 const data = liveSchema.parse(value);
 if(data.state==='live'&&data.vehicles.length===0)throw Error('A live state must carry at least one observed position.');
 const expiry = data.freshness.policy.observationExpirySeconds;
 if(data.vehicles.some(v=>v.ageSeconds>expiry))throw Error('A published position is older than the expiry threshold.');
 return data;
}

export function parseConfig(value:unknown):SiteConfig{
 try{return configSchema.parse(value);}catch{return DEFAULT_CONFIG;}
}

/** How the page knows what it is showing. Archive, live, stale, offline and unavailable
 *  are five different things and are never collapsed into one "last updated". */
export type FeedMode = 'live'|'stale'|'offline'|'unavailable'|'archive';

/**
 * Age of the observation, in seconds, immune to a wrong clock on this device.
 *
 * The server-side part of the age is measured entirely by the publisher's clock
 * (publishedAtMs - observedAtMs). Only the time *elapsed locally since we fetched* is
 * added, which a clock offset cannot affect.
 */
export function observationAge(vehicle:{observedAtMs:number},live:{publishedAtMs:number},
                               fetchedAtMs:number,nowMs:number=Date.now()){
 const atPublication=(live.publishedAtMs-vehicle.observedAtMs)/1000;
 const sinceFetch=Math.max(0,(nowMs-fetchedAtMs)/1000);
 return atPublication+sinceFetch;
}

/** Age of our own published state: how long since the collector last wrote it. */
export function publicationAge(live:{publishedAtMs:number},fetchedAtMs:number,nowMs:number=Date.now()){
 return Math.max(0,(fetchedAtMs-live.publishedAtMs)/1000)+Math.max(0,(nowMs-fetchedAtMs)/1000);
}

export type Freshness = 'fresh'|'ageing'|'stale'|'expired'|'unknown'|'ahead_of_clock';

export function freshnessOf(ageSeconds:number|null|undefined,policy:FreshnessPolicy):Freshness{
 if(ageSeconds===null||ageSeconds===undefined||!Number.isFinite(ageSeconds))return 'unknown';
 if(ageSeconds<0)return 'ahead_of_clock';
 if(ageSeconds<=policy.observationFreshSeconds)return 'fresh';
 if(ageSeconds<=policy.observationAgeingSeconds)return 'ageing';
 if(ageSeconds<=policy.observationStaleSeconds)return 'stale';
 return 'expired';
}

/** Plain words a passenger can act on. Never "now": a report is never instantaneous. */
export function ageWords(seconds:number|null|undefined):string{
 if(seconds===null||seconds===undefined||!Number.isFinite(seconds))return 'age unknown';
 const s=Math.round(seconds);
 if(s<0)return 'timestamped ahead of our clock';
 if(s<10)return 'reported seconds ago';
 if(s<90)return `reported ${s}s ago`;
 const m=Math.round(s/60);
 if(m<60)return `reported ${m} min ago`;
 const h=Math.floor(m/60);
 return h<24?`reported ${h}h ${m%60}m ago`:`reported ${Math.floor(h/24)}d ago`;
}

/** Effective mode, given what the network and the payload actually said. */
export function feedMode(live:LiveState|null,fromCache:boolean,online:boolean,
                         ageSeconds:number|null,policy?:FreshnessPolicy):FeedMode{
 if(!online||fromCache)return 'offline';
 if(!live)return 'unavailable';
 if(live.state==='unavailable')return 'unavailable';
 const limit=(policy??live.freshness.policy).publicationStaleSeconds;
 if(live.state==='stale')return 'stale';
 if(ageSeconds!==null&&ageSeconds>limit)return 'stale';
 return 'live';
}

// ---------------------------------------------------------------- favourites

export type Favourite = {operator:string;route:string;direction:string};
const STORE = 'lost-minutes.favourites.v1';
export const favouriteKey = (f:Favourite) => `${f.operator}|${f.route}|${f.direction}`;

const favouriteArray=z.array(z.object({operator:z.string(),route:z.string(),direction:z.string()}));

/** Device-local only. Never sent anywhere, and a blocked store is not an error. */
export function readFavourites(storage?:Storage):Favourite[]{
 try{
  const raw=(storage??window.localStorage).getItem(STORE);
  if(!raw)return [];
  const parsed=favouriteArray.safeParse(JSON.parse(raw));
  return parsed.success?parsed.data.slice(0,24):[];
 }catch{return [];}
}

// --- external store, so React reads the device store without syncing it into state ---
const EMPTY:Favourite[]=[];
let cachedRaw:string|null|undefined;
let cachedValue:Favourite[]=EMPTY;
const listeners=new Set<()=>void>();

/** Stable snapshot: the same array reference until the stored string actually changes. */
export function favouritesSnapshot():Favourite[]{
 let raw:string|null=null;
 try{raw=window.localStorage.getItem(STORE)}catch{raw=null}
 if(raw!==cachedRaw){cachedRaw=raw;cachedValue=raw?readFavourites():EMPTY}
 return cachedValue;
}

export const favouritesServerSnapshot=()=>EMPTY;

export function subscribeFavourites(callback:()=>void){
 listeners.add(callback);
 const onStorage=(event:StorageEvent)=>{if(event.key===STORE||event.key===null)callback()};
 window.addEventListener('storage',onStorage);
 return()=>{listeners.delete(callback);window.removeEventListener('storage',onStorage)};
}

/** Persist and notify. Returns false when the device refuses to store anything. */
export function saveFavourites(items:Favourite[]):boolean{
 const ok=writeFavourites(items);
 cachedRaw=undefined;                       // force a re-read on the next snapshot
 listeners.forEach(callback=>callback());
 return ok;
}

export function writeFavourites(items:Favourite[],storage?:Storage):boolean{
 try{
  (storage??window.localStorage).setItem(STORE,JSON.stringify(items.slice(0,24)));
  return true;
 }catch{return false;}
}

export function toggleFavourite(items:Favourite[],item:Favourite):Favourite[]{
 const key=favouriteKey(item);
 return items.some(f=>favouriteKey(f)===key)?items.filter(f=>favouriteKey(f)!==key):[...items,item];
}

export const isFavourite = (items:Favourite[],item:Favourite) =>
 items.some(f=>favouriteKey(f)===favouriteKey(item));
