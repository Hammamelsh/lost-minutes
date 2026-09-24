/**
 * A recorded ride: one vehicle's reports on one journey, as they were published on the day, replayed
 * at the same spacing for someone who wants to see what Ride-along is when no live bus suits it.
 *
 * The file is cut from the collector's own retained captures (scripts/make-recorded-ride.mjs from
 * pipeline/replay_publications.py): every report keeps its recorded time text, its source file's
 * SHA-256, its match and its trail. What moves is the clock the page ages them against, so that a
 * report the phone would have been served twelve seconds old reads as twelve seconds old now. It
 * is never live and is badged as a recording wherever it is shown; nothing from it is remembered
 * as a journey or written into the address, and the link that reopens it names the recording.
 */
import {z} from 'zod';
import {parseLive,type LiveState} from '@/lib/live';

const ID=/^[0-9a-z][0-9a-z-]{2,79}$/;

const summarySchema=z.object({
 id:z.string().regex(ID),title:z.string(),operator:z.string(),vehicle:z.string(),route:z.string(),
 direction:z.string(),destination:z.string(),recordedOn:z.string(),from:z.string(),fromLocal:z.string(),
 toLocal:z.string(),seconds:z.number().nonnegative(),reports:z.number().int().positive(),file:z.string(),
});
export type RecordedRideSummary=z.infer<typeof summarySchema>;

const rideSchema=z.object({
 schemaVersion:z.literal(1),
 id:z.string().regex(ID),title:z.string(),operator:z.string(),vehicle:z.string(),route:z.string(),
 direction:z.string(),journeyRef:z.string(),destination:z.string(),origin:z.string().nullable().optional(),
 recordedOn:z.string(),from:z.string(),to:z.string(),fromLocal:z.string(),toLocal:z.string(),
 seconds:z.number().nonnegative(),reports:z.number().int().positive(),basis:z.string(),
 source:z.record(z.unknown()).optional(),
 sources:z.array(z.string().regex(/^[a-f0-9]{64}$/)),
 envelope:z.record(z.unknown()),
 publications:z.array(z.object({
  receivedAtMs:z.number().int(),publishedAt:z.string(),publishedAtMs:z.number().int(),
  trailSources:z.array(z.number().int().nonnegative()),vehicle:z.record(z.unknown()),
 })).min(1),
});
export type RecordedRide=z.infer<typeof rideSchema>;

export const RIDES_INDEX_URL='/data/rides/index.json';

/** The published list of recordings, or none: a malformed index offers nothing rather than a guess. */
export function parseRideIndex(value:unknown):RecordedRideSummary[]{
 const parsed=z.object({schemaVersion:z.literal(1),rides:z.array(summarySchema)}).safeParse(value);
 return parsed.success?parsed.data.rides:[];
}

export function parseRecordedRide(value:unknown):RecordedRide{
 const ride=rideSchema.parse(value);
 for(let i=1;i<ride.publications.length;i++)
  if(ride.publications[i].receivedAtMs<ride.publications[i-1].receivedAtMs)throw new Error('recorded ride out of order');
 for(const p of ride.publications)for(const i of p.trailSources)if(i>=ride.sources.length)throw new Error('recorded ride names a source it does not list');
 return ride;
}

export const rideBusKey=(ride:Pick<RecordedRide,'operator'|'vehicle'>)=>`${ride.operator}|${ride.vehicle}`;

/** How long the replay runs: from the first publication a phone was served to the last. */
export const rideLengthMs=(ride:RecordedRide)=>ride.publications[ride.publications.length-1].receivedAtMs-ride.publications[0].receivedAtMs;

/** Which publication a phone would have been served this far into the ride; −1 before the first. */
export function publicationAt(ride:RecordedRide,elapsedMs:number):number{
 const base=ride.publications[0].receivedAtMs;
 let index=-1;
 for(let i=0;i<ride.publications.length;i++){
  if(ride.publications[i].receivedAtMs-base<=elapsedMs)index=i;else break;
 }
 return index;
}

/**
 * One publication as the live state the page reads, with every clock moved onto the replay's:
 * the publication time and the report's observation and retrieval times shift by the same amount,
 * so the ages the page works out are the ages they were. The report's recorded time text, its
 * source hash, its match and its trail (which carries ages, not times) are left exactly as
 * published: those are the evidence, and they say when this really happened.
 */
export function rideLive(ride:RecordedRide,index:number,startedAtMs:number):LiveState{
 const p=ride.publications[Math.max(0,Math.min(index,ride.publications.length-1))];
 const shift=startedAtMs-ride.publications[0].receivedAtMs;
 const v=p.vehicle;
 const moved=(value:unknown)=>typeof value==='number'?value+shift:value;
 const vehicle={...v,observedAtMs:moved(v.observedAtMs),retrievedAtMs:moved(v.retrievedAtMs)};
 return parseLive({...ride.envelope,publishedAtMs:p.publishedAtMs+shift,
  publishedAt:new Date(p.publishedAtMs+shift).toISOString(),vehicles:[vehicle],
  trailSources:p.trailSources.map(i=>ride.sources[i])});
}

/** Words for the offer: what it is, when it was, how long it runs. */
export function rideWords(ride:Pick<RecordedRideSummary,'recordedOn'|'fromLocal'|'seconds'>):string{
 const minutes=Math.max(1,Math.round(ride.seconds/60));
 return `${ride.recordedOn}, ${ride.fromLocal} · ${minutes} min`;
}
