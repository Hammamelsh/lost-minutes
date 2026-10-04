/**
 * The passenger's active journey: the stop, the service chosen there and the bus they chose.
 * It is kept on this device and in the page's address, restored after a reload or from a shared
 * link, and then checked against fresh positions. Only the same vehicle on the same journey is
 * chosen again. A bus that has gone, or now reports another journey, is said so, and no other bus
 * is chosen in its place. Where the passenger is never becomes part of it, on the device or in a
 * link: a link names a stop, a service and a bus, all public.
 */
import {z} from 'zod';
import type {FollowBus} from '@/lib/follow';

export const JOURNEY_STORE='lost-minutes.journey.v1';
/** This tab's active journey: restored silently on a refresh, a return from Google Maps or from
 *  the background. A new tab does not have it, and gets the offer below instead. */
export const JOURNEY_SESSION_STORE='lost-minutes.journey.session.v1';
/** Recent deliberate stop choices, for the home screen. Never written by a link or a restore. */
export const RECENTS_STORE='lost-minutes.recents.v1';
export const RECENTS_MAX=6;
export const RECENTS_MAX_AGE_MS=30*24*60*60*1000;
/** A saved journey older than this is not offered: last night's bus is not this morning's. */
export const JOURNEY_MAX_AGE_MS=12*60*60*1000;

// NaPTAN ATCO codes, "operator|line|direction|destination", and a bus as "operator|vehicle" (the
// old form: a vehicle) or "operator|vehicle|route|direction" (a vehicle on a journey, since
// 20 September 2026: a link that named only a vehicle adopted whatever journey it had since started).
const ATCO=/^[0-9A-Za-z]{4,16}$/;
const PART=/^[^|\x00-\x1f]{0,120}$/;
const isServiceKey=(value:string)=>{const parts=value.split('|');return parts.length===4&&parts[1].length>0&&parts.every(p=>PART.test(p))};
const isBusKey=(value:string)=>{const parts=value.split('|');
 return (parts.length===2||parts.length===4||parts.length===5)&&parts.slice(0,2).every(p=>p.length>0&&PART.test(p))&&parts.every(p=>PART.test(p))};
/**
 * The link form of a chosen bus: the vehicle, the journey it was chosen on, and the operator's own
 * reference for that journey where there is one.
 *
 * The reference matters because the same vehicle runs the same line again: it reaches the terminus
 * and comes back, and that is a different journey with the same route and direction. Without the
 * reference a link opened an hour later would follow whatever trip that vehicle was on and call it
 * the one the link named. Two-part (vehicle only) and four-part (no reference) keys are still read,
 * and a bus restored without a reference learns its journey from the vehicle's next report rather
 * than claiming one.
 */
export const busLinkKey=(bus:{key:string;route:string;direction:string;journeyRef?:string})=>
 [bus.key,bus.route,bus.direction,bus.journeyRef||''].filter((p,i)=>i<3||p).join('|');
/** A link's bus key taken apart: the vehicle key, and the journey if the link carried one. */
export function parseBusKey(value:string):{key:string;route:string|null;direction:string|null;journeyRef:string}|null{
 if(!isBusKey(value))return null;
 const parts=value.split('|');
 return {key:`${parts[0]}|${parts[1]}`,route:parts[2]??null,direction:parts[3]??null,journeyRef:parts[4]??''};
}

const savedBusSchema=z.object({
 key:z.string().refine(isBusKey),operator:z.string().max(20),vehicle:z.string().max(40),route:z.string().max(12),
 direction:z.string().max(20),destination:z.string().max(120),journeyRef:z.string().max(60),observedAtMs:z.number().finite(),
});
const journeySchema=z.object({
 v:z.literal(1),stopId:z.string().regex(ATCO).nullable(),serviceKey:z.string().refine(isServiceKey).nullable(),
 bus:savedBusSchema.nullable(),savedAt:z.number().finite(),
});
export type SavedBus=z.infer<typeof savedBusSchema>;
export type JourneyContext=z.infer<typeof journeySchema>;
/** What a link carries. */
export type SharedJourney={stopId:string|null;serviceKey:string|null;busKey:string|null};
/** What the page restores from, and whether it came from this device or a link. */
export type InitialJourney=SharedJourney&{bus:SavedBus|null;source:'link'|'session'|'offer'};

/** The identity of a chosen bus, without its position: enough to find it again and to name it. */
export function savedBusOf(bus:FollowBus):SavedBus{
 return {key:bus.key,operator:bus.operator,vehicle:bus.vehicle,route:bus.route,direction:bus.direction,
  destination:bus.destination,journeyRef:bus.journeyRef,observedAtMs:bus.observedAtMs};
}

export function readJourney(storage:Pick<Storage,'getItem'>|null|undefined,nowMs:number,key:string=JOURNEY_STORE):JourneyContext|null{
 try{
  const raw=storage?.getItem(key);
  if(!raw)return null;
  const parsed=journeySchema.safeParse(JSON.parse(raw));
  if(!parsed.success||nowMs-parsed.data.savedAt>JOURNEY_MAX_AGE_MS||parsed.data.savedAt>nowMs+60_000)return null;
  return parsed.data;
 }catch{return null}
}

/** False when the device refused to keep it; the journey still works for this visit. Stamped
 *  with the time it is written unless a time is given. */
export function writeJourney(storage:Pick<Storage,'setItem'|'removeItem'>|null|undefined,
                             context:Omit<JourneyContext,'v'|'savedAt'>&{savedAt?:number},key:string=JOURNEY_STORE):boolean{
 try{
  if(!storage)return false;
  if(!context.stopId&&!context.bus){storage.removeItem(key);return true}
  const value=journeySchema.parse({v:1,...context,savedAt:context.savedAt??Date.now()});
  storage.setItem(key,JSON.stringify(value));
  return true;
 }catch{return false}
}

/** New journey: both stores emptied, so nothing can resurrect. Saved stops, routes and recents stay. */
export function clearJourney(local:Pick<Storage,'removeItem'>|null|undefined,session:Pick<Storage,'removeItem'>|null|undefined){
 try{local?.removeItem(JOURNEY_STORE)}catch{}
 try{session?.removeItem(JOURNEY_SESSION_STORE)}catch{}
}

// ------------------------------------------------------------------ recent stops

// A store the view can subscribe to, like saved stops: the snapshot is cached by the raw value so
// it is referentially stable, and the server renders none.
const EMPTY_RECENTS:{stopId:string;at:number}[]=[];
let recentsRaw:string|null|undefined,recentsValue=EMPTY_RECENTS;
const recentsListeners=new Set<()=>void>();
export function recentsSnapshot():{stopId:string;at:number}[]{
 let raw:string|null=null;
 try{raw=window.localStorage.getItem(RECENTS_STORE)}catch{raw=null}
 if(raw!==recentsRaw){recentsRaw=raw;recentsValue=raw?readRecents(window.localStorage,Date.now()):EMPTY_RECENTS}
 return recentsValue;
}
export const recentsServerSnapshot=()=>EMPTY_RECENTS;
export function subscribeRecents(callback:()=>void){
 recentsListeners.add(callback);
 const onStorage=(event:StorageEvent)=>{if(event.key===RECENTS_STORE||event.key===null)callback()};
 window.addEventListener('storage',onStorage);
 return()=>{recentsListeners.delete(callback);window.removeEventListener('storage',onStorage)};
}
/** A deliberate choice of stop, remembered on this device. */
export function rememberRecent(stopId:string){
 try{addRecent(window.localStorage,stopId,Date.now())}catch{/* not kept */}
 recentsRaw=undefined;
 recentsListeners.forEach(callback=>callback());
}

const recentsSchema=z.array(z.object({stopId:z.string().regex(ATCO),at:z.number().finite()})).max(50);
export function readRecents(storage:Pick<Storage,'getItem'>|null|undefined,nowMs:number):{stopId:string;at:number}[]{
 try{
  const raw=storage?.getItem(RECENTS_STORE);
  const parsed=raw?recentsSchema.safeParse(JSON.parse(raw)):null;
  if(!parsed?.success)return [];
  return parsed.data.filter(r=>nowMs-r.at<=RECENTS_MAX_AGE_MS&&r.at<=nowMs+60_000).sort((a,b)=>b.at-a.at).slice(0,RECENTS_MAX);
 }catch{return []}
}
/** A deliberate choice of a stop, most recent first, one entry per stop. */
export function addRecent(storage:(Pick<Storage,'getItem'|'setItem'>)|null|undefined,stopId:string,nowMs:number){
 try{
  if(!storage||!ATCO.test(stopId))return;
  const kept=readRecents(storage,nowMs).filter(r=>r.stopId!==stopId);
  storage.setItem(RECENTS_STORE,JSON.stringify([{stopId,at:nowMs},...kept].slice(0,RECENTS_MAX)));
 }catch{}
}
export function removeRecent(storage:(Pick<Storage,'getItem'|'setItem'>)|null|undefined,stopId:string,nowMs:number){
 try{if(storage)storage.setItem(RECENTS_STORE,JSON.stringify(readRecents(storage,nowMs).filter(r=>r.stopId!==stopId)))}catch{}
}

/** The shareable address: stop, service and bus, each checked. Nothing about the passenger. */
export function journeyQuery({stopId,serviceKey,busKey}:SharedJourney):string{
 const query=new URLSearchParams();
 if(stopId&&ATCO.test(stopId))query.set('stop',stopId);
 if(serviceKey&&isServiceKey(serviceKey))query.set('service',serviceKey);
 if(busKey&&isBusKey(busKey))query.set('bus',busKey);
 return query.toString();
}

/** A link's journey, or null when it names neither a stop nor a bus. Anything malformed is dropped. */
export function parseJourneyQuery(search:string):SharedJourney|null{
 const query=new URLSearchParams(search);
 const stopId=query.get('stop'),serviceKey=query.get('service'),busKey=query.get('bus');
 const shared={stopId:stopId&&ATCO.test(stopId)?stopId:null,
  serviceKey:serviceKey&&isServiceKey(serviceKey)?serviceKey:null,busKey:busKey&&isBusKey(busKey)?busKey:null};
 return shared.stopId||shared.busKey?shared:null;
}

/**
 * What the page starts from. A link wins: it is what someone chose to open, and no saved
 * preference changes it. Then this tab's own active journey, restored silently, because a refresh
 * or a return is the same passenger mid-journey. Then the device's last journey, as an *offer*
 * the home screen shows and the address does not carry. Never the device's journey applied unasked:
 * that is how a saved stop became an unavoidable permanent selection.
 */
export function initialJourney(search:string,storage:Pick<Storage,'getItem'>|null|undefined,nowMs:number,
                               session?:Pick<Storage,'getItem'>|null):InitialJourney|null{
 const shared=parseJourneyQuery(search);
 const active=readJourney(session,nowMs,JOURNEY_SESSION_STORE);
 const saved=readJourney(storage,nowMs);
 if(shared){
  // The bus key may carry its journey (four parts) or, from an older link, only the vehicle.
  const linked=shared.busKey?parseBusKey(shared.busKey):null;
  // A remembered bus stands in for the link's only as the same vehicle on the journey the link names
  // (an old two-part key names no journey, so the vehicle alone is enough there).
  const remembered=[active?.bus,saved?.bus].find(b=>b&&linked&&b.key===linked.key
   &&(linked.route===null||(b.route===linked.route&&b.direction===linked.direction)))??null;
  const bus:SavedBus|null=remembered??(linked&&linked.route&&linked.direction
   ?{key:linked.key,operator:linked.key.split('|')[0],vehicle:linked.key.split('|')[1],route:linked.route,direction:linked.direction,
     // A link carries no report: no time it was last seen (4 October 2026: the card said "Last seen" at the moment
     // the link was opened, of a bus this device had never seen).
     destination:'',journeyRef:linked.journeyRef,observedAtMs:0}:null);
  return {stopId:shared.stopId,serviceKey:shared.serviceKey,busKey:linked?.key??null,bus,source:'link'};
 }
 if(active)return {stopId:active.stopId,serviceKey:active.serviceKey,busKey:active.bus?.key??null,bus:active.bus,source:'session'};
 return saved?{stopId:saved.stopId,serviceKey:saved.serviceKey,busKey:saved.bus?.key??null,bus:saved.bus,source:'offer'}:null;
}

export type BusRestore=
 |{kind:'none'}
 |{kind:'chosen';key:string}
 |{kind:'gone';saved:SavedBus|null;busKey:string}
 |{kind:'other_journey';saved:SavedBus;now:FollowBus};

/**
 * A restored bus against the latest positions. The same vehicle is chosen again only while it is
 * on the same route, direction and journey; a vehicle that has gone, or has started another
 * journey, is reported as such and nothing is chosen in its place.
 */
export function restoreBus(journey:Pick<InitialJourney,'bus'|'busKey'>|null,buses:FollowBus[]):BusRestore{
 const key=journey?.bus?.key??journey?.busKey??null;
 if(!key)return {kind:'none'};
 const now=buses.find(bus=>bus.key===key);
 if(!now)return {kind:'gone',saved:journey?.bus??null,busKey:key};
 const saved=journey?.bus;
 if(saved&&(now.route!==saved.route||now.direction!==saved.direction
            ||(saved.journeyRef!==''&&now.journeyRef!==''&&now.journeyRef!==saved.journeyRef)))
  return {kind:'other_journey',saved,now};
 return {kind:'chosen',key};
}

/** A restored service filter, if the stop still has it in today's timetable. */
export function restoreService(serviceKey:string|null,available:{key:string}[]):{kind:'none'|'chosen'|'gone';key:string|null}{
 if(!serviceKey)return {kind:'none',key:null};
 // The feed writes destinations with underscores and the timetable with spaces; a link built from
 // either names the same service.
 const same=(k:string)=>k.replace(/_/g,' ').toLowerCase();
 const found=available.find(service=>same(service.key)===same(serviceKey));
 return found?{kind:'chosen',key:found.key}:{kind:'gone',key:serviceKey};
}
