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
   observationExpirySeconds:z.number(),
   publicationStaleSeconds:z.number(), futureToleranceSeconds:z.number(),
   pollIntervalSeconds:z.number(), basis:z.string(),
  }),
  measured:z.object({
   measuredFor:z.string(), measurementLabel:z.string(), isLiveMeasurement:z.boolean(),
   observationToSourcePublicationSeconds:summarySchema,
   observationToRetrievalSeconds:summarySchema, ourCycleSeconds:summarySchema,
   reportIntervalSeconds:summarySchema, sourceCadenceSeconds:summarySchema,
   caveat:z.string(),
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

export type AgeBasis = 'server'|'device';
export type Reference = {serverReferenceMs:number;basis:AgeBasis};

/**
 * The clock every age is measured against: what the origin's clock read when this response
 * was produced, advanced by however long it then sat in caches.
 *
 * Using the payload's own publishedAt instead froze every age at the moment of publication:
 * a state published 111 seconds earlier still claimed its buses reported 24 seconds ago.
 * That pair is reproducible and is what the screenshot showed.
 *
 * `Date` is when the response was generated and `Age` is how long a cache has held it
 * (RFC 9111 section 4.2.3), so the origin's clock at delivery is Date + Age. Neither header
 * is CORS-safelisted, so a cross-origin host must send
 * `Access-Control-Expose-Headers: Date, Age` or neither is readable.
 *
 * When no server clock is readable we fall back to this device's clock, and never below the
 * publication time. That can over-report an age; it must never under-report one, because
 * under-reporting is what makes a stale position look current.
 */
export function serverReference(headerDate:string|null|undefined,headerAge:string|null|undefined,
                                live:{publishedAtMs:number},deviceNowMs:number=Date.now()):Reference{
 const generated=headerDate?Date.parse(headerDate):NaN;
 const held=Number.parseInt(headerAge??'',10);
 if(Number.isFinite(generated)){
  const atDelivery=generated+(Number.isFinite(held)&&held>0?held*1000:0);
  if(atDelivery>=live.publishedAtMs)return {serverReferenceMs:atDelivery,basis:'server'};
 }
 return {serverReferenceMs:Math.max(live.publishedAtMs,deviceNowMs),basis:'device'};
}

/**
 * Age of the observation, in seconds, immune to a wrong clock on this device.
 *
 * The historical part is measured entirely on the server's clock
 * (serverReferenceMs - observedAtMs). Only time *elapsed locally since the fetch* is added,
 * which a device clock offset cannot affect.
 */
export function observationAge(vehicle:{observedAtMs:number},reference:{serverReferenceMs:number},
                               fetchedAtMs:number,nowMs:number=Date.now()){
 const atFetch=(reference.serverReferenceMs-vehicle.observedAtMs)/1000;
 const sinceFetch=Math.max(0,(nowMs-fetchedAtMs)/1000);
 return atFetch+sinceFetch;
}

/** Age of our own published state: how long since the collector last wrote it. */
export function publicationAge(live:{publishedAtMs:number},reference:{serverReferenceMs:number},
                               fetchedAtMs:number,nowMs:number=Date.now()){
 const atFetch=Math.max(0,(reference.serverReferenceMs-live.publishedAtMs)/1000);
 return atFetch+Math.max(0,(nowMs-fetchedAtMs)/1000);
}

export type Freshness = 'fresh'|'ageing'|'stale'|'expired'|'unknown'|'ahead_of_clock';

export function freshnessOf(ageSeconds:number|null|undefined,policy:FreshnessPolicy):Freshness{
 if(ageSeconds===null||ageSeconds===undefined||!Number.isFinite(ageSeconds))return 'unknown';
 if(ageSeconds<0)return 'ahead_of_clock';
 if(ageSeconds<=policy.observationFreshSeconds)return 'fresh';
 if(ageSeconds<=policy.observationAgeingSeconds)return 'ageing';
 // The last shown band ends where the withheld band begins, so a bus is either drawn with
 // an honest age or not drawn at all. No position falls in a gap between the two.
 if(ageSeconds<=policy.observationExpirySeconds)return 'stale';
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
