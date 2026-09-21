"use client";

import {useCallback,useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import {ArrowLeft,Clock3,Crosshair,History,LocateFixed,MapPin,Play,Radio,RefreshCw,RotateCcw,Share2,Star,WifiOff,X} from 'lucide-react';
import FollowMap from '@/components/follow-map';
import CityMap,{RIDE_WORDS,type Here,type MapView,type RideState,type SelectionKind} from '@/components/city-map';
import Nearby from '@/components/nearby';
import StopProgress from '@/components/stop-progress';
import BusEvidence from '@/components/bus-evidence';
import WalkGuide from '@/components/walk-guide';
import ExploreFront from '@/components/explore-front';
import InstallHint from '@/components/install-hint';
import {relateToStop,type PatternCatalogue,type ServicePattern,type StopRelation} from '@/lib/patterns';
import {association,busOnService,distanceLines,progress,schematic,servicesAtStop,standing,standingWords,
        stopBoard,type BoardRow} from '@/lib/journey';
import {londonDate} from '@/lib/service-days';
import {bearingWords,savedStopsServerSnapshot,savedStopsSnapshot,saveStops,stopPlace,
        subscribeSavedStops,toggleSavedStop,type Stop} from '@/lib/stops';
import {destinationLabel,directionLabel,routeId,routeNumber,routesByRecency,type FollowBus} from '@/lib/follow';
import {elapsedWords,favouriteKey,favouritesServerSnapshot,favouritesSnapshot,isFavourite,saveFavourites,
        subscribeFavourites,toggleFavourite,type Favourite,type FeedMode,type LiveState} from '@/lib/live';
import {clock} from '@/lib/replay';
import {saveTheme,subscribeTheme,themeServerSnapshot,themeSnapshot} from '@/lib/theme';
import {DEFAULT_WALKING,walkWords,type WalkingConfig} from '@/lib/walking';
import {useWalkingConsent,useWalkingRoute} from '@/lib/use-walking';
import type {Origin} from '@/lib/origin';
import {scheduledAtStop} from '@/lib/scheduled';
import {arrivalEstimate,arrivalWords,type ArrivalRelease} from '@/lib/arrival';
import {loadTrack} from '@/lib/motion-view';
import type {Track} from '@/lib/motion';
import {describeMotion,motionPreferenceServerSnapshot,motionPreferenceSnapshot,saveMotionPreference,
        subscribeMotionPreference,type MotionInfo} from '@/lib/motion-view';
import {busLinkKey,JOURNEY_SESSION_STORE,journeyQuery,recentsServerSnapshot,recentsSnapshot,rememberRecent,
        restoreService,subscribeRecents,writeJourney,type InitialJourney} from '@/lib/journey-context';
import {adoptJourney,alternativesTo,keepSuggestion,pinFromKey,pinOf,resolveSelection,
        type Pin,type PinSource,type Selection} from '@/lib/selection';
import {activityWords,stopActivity} from '@/lib/stop-activity';
import {prefersReducedMotion} from '@/lib/basemap';

const MODE:Record<FeedMode,{label:string;tone:string}>={
 live:{label:'LIVE',tone:'live'},
 stale:{label:'NOT UPDATING',tone:'warn'},
 offline:{label:'OFFLINE',tone:'warn'},
 unavailable:{label:'NOT COLLECTING',tone:'idle'},
 archive:{label:'ARCHIVE REPLAY',tone:'archive'},
};

const FRESHNESS:Record<string,string>={
 ageing:'it may have moved on since',
 stale:'an old report: it may have finished or lost signal',
};

// What a chosen bus that is not coming to your stop is, in the card's headline.
const NOT_COMING:Record<string,string>={
 not_for_stop:'Does not serve your stop',passed:'Already past your stop',
 maybe:'May call at your stop',unknown:'Not confirmed for your stop',
};

// Why the detailed map gave way to the simple one, in plain words.
const FALLBACK:Record<string,string>={
 no_webgl:'this browser gave the page no WebGL',module_failed:'its code could not be loaded',
 create_failed:'it could not be started',style_failed:'its style could not be loaded',
 tiles_failed:'none of its map tiles arrived',startup_timeout:'it could not finish starting',
};

export default function FollowView({paused=false,mode,live,buses,roads,onRefresh,refreshing,
                                    publicationAgeSeconds,ageBasis,archiveDate,onUseArchive,
                                    usingArchive,onOpenEvidence,stops,stop,onSelectStop,
                                    onLocate,locating,locationError,patterns,patternsById,
                                    here,origin=null,outsideArea,onClearHere,nowMs,liveFingerprint,recall,walkingConfig,
                                    pickingOrigin=false,onStartPicking,onCancelPicking,onChooseOrigin,
                                    clockOffsetMs=0,initialJourney,journeyEpoch=0,onNewJourney,onAddress}:{
 /** True while the engineering area is open in front of this page. It stays mounted, so the map
  *  must be told to stop drawing rather than paint a canvas nobody can see. */
 paused?:boolean;
 mode:FeedMode;live:LiveState|null;buses:FollowBus[];roads:import('@/lib/replay').RoadMap|null;
 onRefresh:()=>void;refreshing:boolean;publicationAgeSeconds:number|null;
 ageBasis:'server'|'device';archiveDate?:string;onUseArchive?:()=>void;usingArchive:boolean;
 onOpenEvidence:()=>void;stops:Stop[];stop:Stop|null;onSelectStop:(stop:Stop|null)=>void;
 onLocate?:()=>void;locating?:boolean;locationError?:string;
 patterns:PatternCatalogue|null;patternsById:Map<string,ServicePattern>;
 here:Here|null;outsideArea:boolean;onClearHere:()=>void;
 /** What `here` is: the device's fix or a start the passenger chose. */
 origin?:Origin|null;
 pickingOrigin?:boolean;onStartPicking?:()=>void;onCancelPicking?:()=>void;
 onChooseOrigin?:(point:{lat:number;lon:number},label:string)=>void;
 nowMs:number;liveFingerprint?:string|null;recall?:(key:string)=>FollowBus|null;
 /** The journey left on this device or opened from a link; undefined until the page has read it. */
 initialJourney?:InitialJourney|null;
 /** Bumped by the page when Back or Forward applies the address over this view's own choices. */
 journeyEpoch?:number;
 /** New journey: the page clears its stop, the stores and the address. */
 onNewJourney?:()=>void;
 /** The address's query as this view wrote it, so the page knows what it has applied. */
 onAddress?:(search:string)=>void;
 walkingConfig?:WalkingConfig|null;clockOffsetMs?:number}){
 const favourites=useSyncExternalStore(subscribeFavourites,favouritesSnapshot,favouritesServerSnapshot);
 const savedStopIds=useSyncExternalStore(subscribeSavedStops,savedStopsSnapshot,savedStopsServerSnapshot);
 const theme=useSyncExternalStore(subscribeTheme,themeSnapshot,themeServerSnapshot);
 const [consent,setConsent]=useWalkingConsent();
 const estimatedMovement=useSyncExternalStore(subscribeMotionPreference,motionPreferenceSnapshot,motionPreferenceServerSnapshot);
 const [motionInfo,setMotionInfo]=useState<MotionInfo|null>(null);
 const reportMotion=useCallback((info:MotionInfo|null)=>setMotionInfo(info),[]);
 // The ride-along's camera state, as the map reports it, so the card says the same thing.
 const [rideState,setRideState]=useState<RideState>('off');
 const [blocked,setBlocked]=useState(false);
 const [choice,setChoice]=useState<{route:string;direction:string}|null>(null);
 // The passenger's own choices in this visit, undefined until they make one: until then a journey
 // restored from this device or a link stands in, checked against fresh data below.
 const [serviceChoice,setServiceChoice]=useState<string|null|undefined>(undefined);
 // The bus the passenger chose (a pin), or null once they let it go. It is never replaced by
 // another bus: see lib/selection.ts.
 const [pinChoice,setPinChoice]=useState<Pin|null|undefined>(undefined);
 // Why a stop change let the chosen bus go, said once beside the stop.
 const [changeNote,setChangeNote]=useState<string|null>(null);
 // Back or Forward applied the address: this visit's own choices give way to what it names.
 const [seenEpoch,setSeenEpoch]=useState(journeyEpoch);
 if(journeyEpoch!==seenEpoch){setSeenEpoch(journeyEpoch);setPinChoice(undefined);setServiceChoice(undefined);setChangeNote(null)}
 // Stops chosen deliberately on this device; the server renders none.
 const recents=useSyncExternalStore(subscribeRecents,recentsSnapshot,recentsServerSnapshot);
 // The page's suggestion while nothing is pinned, kept while it stays a candidate.
 const [suggested,setSuggested]=useState<string|null>(null);
 const [shareState,setShareState]=useState<'idle'|'copied'|'failed'>('idle');
 const [follow,setFollow]=useState(false);
 const [view,setView]=useState<MapView>('2d');
 const [fitRequest,setFitRequest]=useState(0);
 const [walkAttempt,setWalkAttempt]=useState(0);
 // Which directions the arrival criteria have released on unseen journeys, if any: fetched once.
 // Nothing is released until scripts/arrival-release-check.py writes that it is, and the page
 // shows estimated minutes only for a released direction. Until then this stays null and the
 // estimator computes nothing a passenger can see.
 const [arrivalRelease,setArrivalRelease]=useState<ArrivalRelease>(null);
 useEffect(()=>{
  let current=true;
  fetch('/data/arrival-release.json',{cache:'no-store'}).then(r=>r.ok?r.json():null)
   .then(v=>{if(current)setArrivalRelease(v&&Array.isArray(v.released)?v:null)}).catch(()=>{if(current)setArrivalRelease(null)});
  return()=>{current=false};
 },[]);
 // The chosen bus's road, for the arrival estimate: the same accepted shape the map uses, loaded
 // by pattern id and cached by lib/motion-view, so the estimate and the drawing read one geometry.
 const [arrivalTrack,setArrivalTrack]=useState<{patternId:string;track:Track|null}|null>(null);
 // Which patterns' timetable clocks have been checked against their own buses: fetched once,
 // like the motion evaluation. null until it arrives or if it cannot; a pattern absent is unchecked.
 const [scheduleAnchor,setScheduleAnchor]=useState<{patterns:Record<string,{verified:boolean;reason?:string|null;medianOffsetMinutes?:number}>}|null|undefined>(undefined);
 useEffect(()=>{
  let current=true;
  fetch('/data/schedule-anchor.json',{cache:'no-store'}).then(r=>r.ok?r.json():null)
   .then(v=>{if(current)setScheduleAnchor(v&&typeof v==='object'&&v.patterns?v:null)}).catch(()=>{if(current)setScheduleAnchor(null)});
  return()=>{current=false};
 },[]);
 // MapLibre when the device can render it; the drawn map when it cannot, and why.
 const [mapFallback,setMapFallback]=useState<string|null>(null);
 // Dependencies of CityMap's creation effect: they must never change identity, or the page's
 // five-second clock would tear the map down on every tick (the 13 September lifecycle bug).
 const stopFollowing=useCallback(()=>setFollow(false),[]);
 const showMapFallback=useCallback((reason?:string)=>setMapFallback(reason??'create_failed'),[]);
 const chooseSimpleMap=useCallback(()=>setMapFallback('chosen'),[]);
 const busesRef=useRef(buses);
 useEffect(()=>{busesRef.current=buses},[buses]);
 // A bus tapped on the map is chosen: pinned, as a bus tapped in a list is.
 const selectFromMap=useCallback((key:string)=>{
  const bus=busesRef.current.find(candidate=>candidate.key===key);
  if(bus)setPinChoice(pinOf(bus,'map'));
  setFollow(false);
 },[]);

 // The day a timetable is judged against: today in Manchester, or the recording's day.
 const day=londonDate(mode==='archive'?(buses[0]?.observedAtMs??nowMs):nowMs);
 const stopById=useMemo(()=>new Map(stops.map(s=>[s.id,s])),[stops]);
 const savedStops=savedStopIds.map(id=>stopById.get(id)).filter((s):s is Stop=>Boolean(s));
 const name=useCallback((atco:string)=>stopById.get(atco)?.name??'a stop outside our area',[stopById]);
 const stopLabel=stop?`${stop.name}${stop.indicator?` (${stop.indicator})`:''}`:'';

 // ------------------------------------------------------------ walking to your stop
 const walking=walkingConfig??DEFAULT_WALKING;
 const walk=useWalkingRoute({here,stop,config:walking,consent,nowMs,attempt:walkAttempt});
 const walkRoute=walk.status!=='problem'&&'route' in walk&&walk.route&&stop&&walk.route.stopId===stop.id?walk.route:undefined;

 // ------------------------------------------------------------ at your stop
 const relations=useMemo(()=>{
  const map=new Map<string,StopRelation>();
  if(stop)for(const bus of buses)map.set(bus.key,relateToStop(bus,stop.id,patternsById));
  return map;
 },[buses,stop,patternsById]);
 const services=useMemo(()=>stop?servicesAtStop(patterns,stop.id,day,buses,patternsById):[],
  [patterns,stop,day,buses,patternsById]);
 // A restored service filter applies only at the restored stop and once today's services are
 // known; one the stop no longer has is said so below, not silently dropped.
 const serviceRestore=serviceChoice===undefined&&patterns&&initialJourney?.serviceKey&&initialJourney.source!=='offer'
  &&stop?.id===initialJourney.stopId?restoreService(initialJourney.serviceKey,services):{kind:'none' as const,key:null};
 const serviceKey=serviceChoice!==undefined?serviceChoice:serviceRestore.kind==='chosen'?serviceRestore.key:null;
 const activeService=services.find(s=>s.key===serviceKey)??null;
 // A filter that names no service at this stop today (from a link, or Continue) is said, not ignored.
 const filterGone=Boolean(patterns&&stop&&(serviceRestore.kind==='gone'||(serviceKey&&!activeService)));
 const filterGoneKey=serviceRestore.kind==='gone'?serviceRestore.key:serviceKey;
 const board=useMemo(()=>stop?stopBoard(buses,stop,relations,
  activeService?(bus,relation)=>busOnService(bus,activeService,relation):undefined):null,
  [buses,stop,relations,activeService]);

 // ------------------------------------------------------------ browse by route (no stop)
 const available=useMemo(()=>routesByRecency(buses),[buses]);
 const availableIds=useMemo(()=>available.map(r=>r.id),[available]);
 // With no route chosen, the route of the latest report is offered, and then kept while it still
 // has buses: re-taken at every publication, the list and its suggested bus jumped to whichever
 // route happened to report last.
 const [keptRoute,setKeptRoute]=useState<string|null>(null);
 const fallbackRoute=useMemo(()=>{
  const saved=favourites.find(f=>availableIds.includes(`${f.operator}|${f.route}`));
  if(saved)return {route:`${saved.operator}|${saved.route}`,direction:saved.direction};
  return {route:keptRoute&&availableIds.includes(keptRoute)?keptRoute:available[0]?.id??'',direction:'all'};
 },[favourites,available,availableIds,keptRoute]);
 const {route,direction}=choice??fallbackRoute;
 if(!choice&&route&&route!==keptRoute)setKeptRoute(route);
 const onRoute=useMemo(()=>buses.filter(b=>routeId(b)===route&&(direction==='all'||b.direction===direction))
  .sort((a,b)=>b.observedAtMs-a.observedAtMs),[buses,route,direction]);
 const directions=useMemo(()=>Array.from(new Set(buses.filter(b=>routeId(b)===route).map(b=>b.direction).filter(Boolean))),[buses,route]);
 const routeChoices=useMemo(()=>{
  const ids=new Set(availableIds);
  if(route)ids.add(route);
  return Array.from(ids).sort((a,b)=>routeNumber(a).localeCompare(routeNumber(b),undefined,{numeric:true}));
 },[availableIds,route]);
 const current:Favourite|null=route?{operator:route.split('|')[0],route:routeNumber(route),direction}:null;
 const savedRoute=current?isFavourite(favourites,current):false;

 // ------------------------------------------------------------ the chosen bus
 const mapBuses=useMemo(()=>{
  if(!stop||!board)return onRoute;
  const keys=new Set([...board.coming,...board.maybe,...board.nearby,...board.passed,...board.old,
                      ...board.elsewhere].map(row=>row.bus.key));
  return buses.filter(b=>keys.has(b.key));
 },[stop,board,onRoute,buses]);
 // A journey restored from this device or a link is a pin like any other: the same vehicle on the
 // same journey is followed again; otherwise the page says what became of it and chooses nothing
 // in its place. A recording restores nothing.
 const restoredPin=useMemo<Pin|null>(()=>{
  if(mode==='archive'||!initialJourney||initialJourney.source==='offer')return null;
  if(initialJourney.bus)return {bus:initialJourney.bus,via:initialJourney.source==='link'?'link':'device',
   // The journey is known when the link named one: a route and a direction are enough to notice
   // the vehicle turning up on another service, and `sameJourney` compares the operator's own
   // journey reference only where both sides carry one. New links carry it (busLinkKey), so the
   // same vehicle's *next* trip on the same line is a change too; an older four-part link cannot
   // tell those apart and does not pretend to.
   journeyKnown:true};
  return initialJourney.busKey?pinFromKey(initialJourney.busKey,'link'):null;
 },[mode,initialJourney]);
 const pin=pinChoice!==undefined?pinChoice:restoredPin;
 // Until the first publication is in, nothing is known about any bus: a pin is neither found nor
 // missing yet, and nothing is suggested in its place.
 const loading=live===null&&mode!=='archive'&&mode!=='offline';
 const selection:Selection=loading?{kind:'none'}:resolveSelection(pin,buses,recall??null);
 // A link that named only a vehicle learns its journey when the vehicle is first seen, so a later
 // change of journey is noticed. So does an older four-part link, which named the route and the
 // direction but not the operator's reference for the trip: once the vehicle is seen on that very
 // route and direction, the trip it is on is the one the link meant, and from then on the pin is
 // exact and the address it writes carries it.
 if(selection.kind==='active'&&(!selection.pin.journeyKnown||(!selection.pin.bus.journeyRef&&selection.bus.journeyRef)))
  setPinChoice(adoptJourney(selection.pin,selection.bus));
 // The suggestion: the first bus coming to your stop, or the latest report on the route, kept
 // while it stays one of them. Only a bus timetabled to call and not yet past is suggested.
 // With no stop chosen, a bus is suggested only where the passenger has pointed at something: a
 // route they picked, or one of their saved routes. Until 20 September 2026 the home screen
 // suggested the latest report anywhere in Manchester — a 43 to the airport to someone who had
 // opened the page to find their own stop — which is an answer to a question nobody asked.
 // In a recording the whole point is to watch a journey, and the route comes from the replay's own
 // controls, so one is shown there as before.
 const routeIsTheirs=mode==='archive'||Boolean(choice)||favourites.some(f=>`${f.operator}|${f.route}`===route);
 const candidates=useMemo(()=>stop?(board?.coming.map(row=>row.bus)??[]):routeIsTheirs?onRoute:[],
  [stop,board,onRoute,routeIsTheirs]);
 const nextSuggested=keepSuggestion(suggested,candidates);
 if(nextSuggested!==suggested)setSuggested(nextSuggested);
 const suggestion=nextSuggested?candidates.find(bus=>bus.key===nextSuggested):undefined;
 const pinned=selection.kind!=='none';
 // The bus drawn and described: the pinned one (at its last report if it has gone missing), or,
 // with nothing pinned, the suggestion.
 const shown:FollowBus|undefined=selection.kind==='active'||selection.kind==='new_journey'?selection.bus
  :selection.kind==='absent'?selection.last??undefined:pin||loading?undefined:suggestion;
 const selectionKind:SelectionKind|undefined=selection.kind==='none'?(shown?'suggested':undefined):selection.kind;
 const absent=selection.kind==='absent';
 // The chosen vehicle now reports another journey. It stays chosen, but that journey is neither
 // predicted nor followed until the passenger says to go on with it: it is drawn at its reports.
 const pausedJourney=selection.kind==='new_journey';
 const identity=shown??pin?.bus;
 const cardRelation=shown&&stop?(relations.get(shown.key)??relateToStop(shown,stop.id,patternsById)):undefined;
 const cardStanding=cardRelation?standing(cardRelation):null;
 const relevant=!stop||cardStanding==='coming';
 // One name for the bus shown, the same on the card, the strip and the map's legend: a suggestion;
 // the bus chosen for your stop, or a chosen bus now missing or on another journey; or a bus chosen
 // with no stop, or one not coming to it.
 const busNoun=selectionKind==='suggested'?'Suggested bus'
  :absent||selection.kind==='new_journey'||relevant&&stop?'Your bus':'Selected bus';
 const effectiveView:MapView=view==='ride'&&!shown?'2d':view;
 const riding=effectiveView==='ride';
 const alternatives=pinned&&selection.kind!=='active'?alternativesTo(pin,candidates):[];
 const activeKey=selection.kind==='active'?selection.bus.key:selection.kind==='none'?shown?.key:undefined;

 // What became of a restored service or stop, said once fresh data is in.
 const restoreNotes:string[]=[];
 if(filterGone&&filterGoneKey){
  const [,line,,destination]=filterGoneKey.split('|');
  restoreNotes.push(`${line} to ${destination.replace(/_/g,' ')} is not in today’s timetable for this stop, so every service is listed.`);
 }
 if(changeNote)restoreNotes.push(changeNote);
 if(initialJourney?.stopId&&!stop&&stops.length>0&&!stops.some(s=>s.id===initialJourney.stopId))
  restoreNotes.push('The stop you had chosen is not in the current stop list. Search for your stop.');

 // The journey as it stands (docs/JOURNEY_STATE.md): this tab's store holds it exactly; the device's
 // store holds the last journey, replaced by a new one and emptied only by New journey, never by a
 // page with nothing chosen; and the address is replaced, never pushed, from here. A pin that has
 // gone missing or changed journey is kept as it was chosen, so a reload asks the same question.
 // Nothing is written until the page has read what was there, and never from a recording.
 useEffect(()=>{
  if(initialJourney===undefined||mode==='archive')return;
  const bus=pin&&pin.journeyKnown?pin.bus:null;
  // A restored service the passenger has not changed is kept, even on a day it does not run.
  const service=serviceChoice!==undefined?serviceChoice
   :initialJourney&&initialJourney.source!=='offer'&&stop?.id===initialJourney.stopId?initialJourney.serviceKey:null;
  let storage:Storage|null=null,session:Storage|null=null;
  try{storage=window.localStorage}catch{/* a refused store still works for this visit */}
  try{session=window.sessionStorage}catch{/* likewise */}
  const context={stopId:stop?.id??null,serviceKey:service,bus};
  writeJourney(session,context,JOURNEY_SESSION_STORE);
  if(context.stopId||context.bus)writeJourney(storage,context);
  const query=journeyQuery({stopId:stop?.id??null,serviceKey:service,busKey:pin?pin.journeyKnown?busLinkKey(pin.bus):pin.bus.key:null});
  const next=`${window.location.pathname}${query?`?${query}`:''}${window.location.hash}`;
  if(next!==`${window.location.pathname}${window.location.search}${window.location.hash}`){
   window.history.replaceState(window.history.state,'',next);
   onAddress?.(query?`?${query}`:'');
  }
 },[initialJourney,mode,pin,serviceChoice,stop,onAddress]);

 // Before the first publication arrives nothing is known either way: not "not collecting".
 const copy=loading?{label:'CHECKING',tone:'idle'}:MODE[mode];
 const policy=live?.freshness.policy;
 const expiryMinutes=policy?Math.round(policy.observationExpirySeconds/60):15;
 const collector=live?.collection.collector;

 // Every way of choosing a bus pins it. Filters, a new route or a new stop leave the pin alone:
 // a bus the passenger chose never disappears because it falls outside the list being browsed.
 function pinBus(bus:FollowBus,via:PinSource){setPinChoice(pinOf(bus,via))}
 function chooseBus(bus:FollowBus){pinBus(bus,'list');setFollow(false);setFitRequest(n=>n+1)}
 function chooseService(key:string){setServiceChoice(serviceKey===key?null:key);setFitRequest(n=>n+1)}
 function pick(next:{route:string;direction:string}){setChoice(next);setFitRequest(n=>n+1)}
 // Choosing a stop is deliberate: it is remembered as a recent, the filter is cleared, and the
 // chosen bus stays chosen only if it calls at the new stop, else it is let go and the reason said.
 // The address is pushed, so Back returns to the previous stop.
 function selectStop(next:Stop|null){
  const live=pin?buses.find(b=>b.key===pin.bus.key):undefined;
  const serves=pin&&next?live?['coming','maybe'].includes(standing(relateToStop(live,next.id,patternsById))):false:Boolean(pin);
  if(pin&&next&&!serves){
   setPinChoice(null);
   const label=`${next.name}${next.indicator?` (${next.indicator})`:''}`;
   setChangeNote(live
    ?`${pin.bus.route||'The bus'} to ${destinationLabel(pin.bus.destination)}, which you had chosen, does not call at ${label}, so it is no longer chosen.`
    :`The bus you had chosen has no current report and cannot be checked against ${label}, so it is no longer chosen.`);
  }else setChangeNote(null);
  onSelectStop(next);setServiceChoice(null);setView('2d');setFollow(false);setFitRequest(n=>n+1);
  if(next)rememberRecent(next.id);
  const kept=pin&&serves?pin:null;
  const query=journeyQuery({stopId:next?.id??null,serviceKey:null,busKey:kept?kept.journeyKnown?busLinkKey(kept.bus):kept.bus.key:null});
  const target=`${window.location.pathname}${query?`?${query}`:''}`;
  if(target!==`${window.location.pathname}${window.location.search}${window.location.hash}`){
   // A stop chosen is a place Back can return to. "Change" (no stop yet) is on the way to one: it
   // is pushed, marked as on the way, and the stop chosen next replaces it rather than adding to
   // it, so history reads stop, stop, stop, and a stop's own entry is never overwritten.
   const state={...(window.history.state??{}),lmIntermediate:!next};
   if(next&&window.history.state?.lmIntermediate)window.history.replaceState(state,'',target);
   else window.history.pushState(state,'',target);
   onAddress?.(query?`?${query}`:'');
  }
 }
 function letGo(){setPinChoice(null);setFollow(false);setView('2d');setFitRequest(n=>n+1)}
 // The device's last journey, taken up: its stop, its filter and its bus, checked against fresh data
 // like any restore.
 const offer=initialJourney?.source==='offer'&&!stop?initialJourney:null;
 const offerStop=offer?.stopId?stopById.get(offer.stopId)??null:null;
 function continueOffer(){
  if(!offer)return;
  onSelectStop(offerStop);setServiceChoice(offer.serviceKey);setChangeNote(null);
  setPinChoice(offer.bus?{bus:offer.bus,via:'device',journeyKnown:true}:offer.busKey?pinFromKey(offer.busKey,'device'):null);
  setView('2d');setFitRequest(n=>n+1);
 }
 // New journey: nothing chosen, nothing filtered, nothing followed; the page clears the rest.
 function newJourney(){
  setPinChoice(null);setServiceChoice(null);setChoice(null);setFollow(false);setView('2d');setChangeNote(null);
  onNewJourney?.();
 }
 function continueJourney(){if(selection.kind==='new_journey')pinBus(selection.bus,'continue')}
 // Following or riding along starts on the bus shown, and so pins it.
 function toggleFollow(){
  if(!follow&&selection.kind==='none'&&shown)pinBus(shown,'follow');
  setFollow(value=>!value);
 }
 function changeView(next:MapView){
  if(next==='ride'&&selection.kind==='none'&&shown)pinBus(shown,'ride');
  setView(next);
 }
 function showCard(){
  const card=document.getElementById('lm-bus-card');
  card?.scrollIntoView({block:'nearest',behavior:prefersReducedMotion()?'auto':'smooth'});
  // Focus goes with it, so the next Tab continues from the card, not from the lists above it.
  card?.focus({preventScroll:true});
 }
 // A shared link names the stop, the service and the bus the passenger chose: never where they are.
 async function share(){
  const query=journeyQuery({stopId:stop?.id??null,serviceKey,busKey:pin?pin.journeyKnown?busLinkKey(pin.bus):pin.bus.key:null});
  const url=`${window.location.origin}${window.location.pathname}${query?`?${query}`:''}`;
  try{
   if(navigator.share){await navigator.share({title:`Lost Minutes · ${stopLabel}`,url});setShareState('idle');return}
   await navigator.clipboard.writeText(url);setShareState('copied');
  }catch(error){setShareState(error instanceof DOMException&&error.name==='AbortError'?'idle':'failed')}
 }

 const ageText=(bus:FollowBus)=>mode==='archive'?`reported ${clock(bus.observedAtMs,true)}`:bus.ageWords;
 const ageChip=(bus:FollowBus)=>mode==='archive'?clock(bus.observedAtMs,true):bus.ageWords.replace('reported ','');
 const assoc=shown&&cardRelation?association(cardRelation,shown):null;
 // A timetabled time at the passenger's stop, from the named scheduled journey and the pattern's
 // running times: every premise checked in lib/scheduled.ts, none assumed.
 // Cheap enough to compute each render, which the card does on the clock anyway.
 // Estimated minutes to your stop: only for a released direction, only from raw reports.
 const arrivalPatternId=shown&&shown.match&&'patternId' in shown.match?shown.match.patternId:null;
 useEffect(()=>{
  // No state write here: a track kept from another pattern is ignored below by its patternId, so
  // nothing needs clearing, and a synchronous setState in an effect cascades renders.
  if(!arrivalPatternId||!arrivalRelease?.released.length)return;
  let current=true;
  loadTrack(arrivalPatternId).then(r=>{if(current)setArrivalTrack({patternId:arrivalPatternId,track:r.track})});
  return()=>{current=false};
 },[arrivalPatternId,arrivalRelease]);
 const arrival=(()=>{
  if(!shown||!stop||!shown.match||!('patternId' in shown.match)||mode==='archive')return null;
  const pattern=patternsById.get(shown.match.patternId);
  if(!pattern||!arrivalTrack||arrivalTrack.patternId!==pattern.id||!arrivalTrack.track)return null;
  const stopIndex=pattern.stops.indexOf(stop.id);
  if(stopIndex<0||shown.match.patternIndex>=stopIndex)return null;
  const sched=shown.match.scheduled;
  const timing=(sched&&'timing' in sched&&sched.timing!==undefined&&pattern.timings?.[sched.timing])||pattern.seconds;
  if(!timing)return null;
  const reports=[...(shown.trail??[]).map(f=>({at:f.at,lat:f.lat,lon:f.lon})),{at:shown.observedAtMs,lat:shown.lat,lon:shown.lon}];
  // nowMs is the page clock, 0 before its first tick: then every report reads as in the future and
  // the estimate correctly waits, rather than reading an impure Date.now() in render.
  return arrivalEstimate({track:arrivalTrack.track,patternId:pattern.id,timing,stopIndex,reports,nowMs,
   release:arrivalRelease,direction:pattern.direction??''});
 })();
 const timetabled=(()=>{
  if(!shown||!stop||!shown.match||!('patternId' in shown.match))return null;
  const pattern=patternsById.get(shown.match.patternId);
  if(!pattern)return null;
  const stopIndex=pattern.stops.indexOf(stop.id);
  if(stopIndex<0)return null;
  return scheduledAtStop({scheduled:shown.match.scheduled,seconds:pattern.seconds,timings:pattern.timings,busIndex:shown.match.patternIndex,stopIndex,
   anchor:scheduleAnchor===undefined?null:scheduleAnchor?.patterns?.[pattern.id]??null});
 })();
 const prog=cardRelation?progress(cardRelation,name):null;
 const items=cardRelation&&stop&&relevant?schematic(cardRelation,name,stop.id):[];
 const walked=walkRoute?walkWords(walkRoute):null;
 // What its own reports say about it and a stop: never the estimate, never the drawn bus.
 const matchedPattern=(bus:FollowBus)=>{
  const match=bus.match as {patternId?:string}|undefined;
  return match?.patternId?patternsById.get(match.patternId):undefined;
 };

 // The stop across the road: the bus's own matched pattern calls at a stop with this stop's name
 // and a different id. That is the pattern's evidence, not a guess about direction, and it is only
 // offered when the two are within 120 m, which is what "across the road" means.
 const otherSide=(()=>{
  if(!stop||!shown||relevant||cardStanding!=='not_for_stop')return null;
  const pattern=matchedPattern(shown);
  if(!pattern)return null;
  const twin=pattern.stops.map(id=>stopById.get(id)).find(s=>s&&s.id!==stop.id&&s.name===stop.name);
  if(!twin)return null;
  const m=Math.hypot((twin.lat-stop.lat)*111320,(twin.lon-stop.lon)*111320*Math.cos(stop.lat*Math.PI/180));
  return m<=120?{stop:twin,metres:Math.round(m/10)*10}:null;
 })();
 const notServing=stop&&shown&&assoc&&!relevant
  ?cardStanding==='not_for_stop'?otherSide
    ?`This bus is going the other way. It calls at ${otherSide.stop.name}${otherSide.stop.indicator?` (${otherSide.stop.indicator})`:''}, across the road about ${otherSide.metres} m away, not at ${stopLabel}.`
    :`It does not serve ${stopLabel}. ${assoc.detail}`
   :cardStanding==='passed'?`In the timetable’s stop order its last report is already past ${stopLabel}.`
   :`${assoc.text}. ${assoc.detail}`
  :null;

 const activity=shown&&!absent&&mode!=='archive'?stopActivity(shown,matchedPattern(shown),stopById):null;
 // The next few stops on the chosen bus's own pattern, for the front view's labels: real stops, at
 // most three, and your own stop left to its own label.
 // For an unsettled bus whose candidates differ only in stops behind it (sharedOnward: a fact
 // about the stop lists, which is all a label needs), the first candidate's stops ahead are the
 // stops ahead. Whether the road is shared is judged separately, from geometry, on the map.
 const aheadMatch=(()=>{const m=shown?.match as {patternId?:string;patternIndex?:number;sharedOnward?:boolean;
  candidates?:{patternId:string;patternIndex:number}[]}|undefined;
  return m?.patternId?m:m?.sharedOnward&&m.candidates?.length?m.candidates[0]:undefined})();
 const aheadPattern=aheadMatch?.patternId?patternsById.get(aheadMatch.patternId):undefined;
 const stopsAhead=aheadPattern&&typeof aheadMatch?.patternIndex==='number'
  ?aheadPattern.stops.slice(aheadMatch.patternIndex,aheadMatch.patternIndex+4).filter(id=>id!==stop?.id)
    .map(id=>stopById.get(id)).filter((s):s is Stop=>Boolean(s)).slice(0,3)
    .map(s=>({id:s.id,lat:s.lat,lon:s.lon,label:s.indicator?`${s.name} (${s.indicator})`:s.name}))
  :[];
 const activityLine=activity?activityWords(activity,name):null;
 // One Locate me on screen: the walk guide's while it is asking for the location, otherwise the
 // detailed map's own, or the stop's beside the simple map, which has none.
 // The walk guide carries the location controls (update, choose a start, back to the device)
 // whenever a stop is chosen, so the map's own Locate me steps aside then: one control, one place.
 const guideLocates=Boolean(stop&&onLocate)&&mode!=='archive';

 // Estimates are for live data you are watching now: never a recording, never offline, never for a
 // bus with no current report, which is shown where it last reported and not moved on, and never
 // for a journey the passenger has not chosen to go on with.
 const motion={enabled:estimatedMovement&&!absent&&!pausedJourney&&mode!=='archive'&&mode!=='offline'&&mode!=='unavailable',
  reason:absent?'there is no current report from this bus'
   :pausedJourney?'this bus is now on another journey, until you choose to keep following it'
   :!estimatedMovement?'you chose reported positions only'
   :mode==='archive'?'a recording is shown at its reported positions':'the feed is not live'};
 // The age is the page's, the one the card's age chip shows, so the card never gives two.
 const motionWords=mode!=='archive'&&motionInfo&&shown&&!absent?describeMotion({...motionInfo,
  reportAge:shown.ageSeconds!==null&&Number.isFinite(shown.ageSeconds)?Math.round(shown.ageSeconds):motionInfo.reportAge})
  :null;

 // What happened to a pinned bus, in the card, the strip and the ride card alike.
 const absentWords=selection.kind!=='absent'?null
  :mode==='unavailable'||mode==='offline'?'Live positions are not available, so this bus cannot be checked. Nothing else has been chosen in its place.'
  :selection.last?`It is not in the latest publication. Its last report was at ${clock(selection.last.observedAtMs,true)} `
   +`(${selection.last.ageWords.replace('reported ','')}); it is shown there, not moved on. Nothing else has been chosen in its place.`
  :`It is not in the latest publication${selection.pin.bus.observedAtMs?`; the last report this device had from it was at ${clock(selection.pin.bus.observedAtMs,true)}`:''}. `
   +'Nothing else has been chosen in its place.';
 const journeyWords=selection.kind!=='new_journey'?null
  :`Vehicle ${selection.bus.vehicle}, chosen as the ${selection.pin.bus.route} to ${destinationLabel(selection.pin.bus.destination)}, `
   +`now reports route ${selection.bus.route}${selection.bus.direction?` ${directionLabel(selection.bus.direction).toLowerCase()}`:''} `
   +`to ${destinationLabel(selection.bus.destination)}${selection.bus.journeyRef?` (journey ${selection.bus.journeyRef})`:''}. `
   +'It is shown at each report it makes, not estimated, and the map has stopped following it. '
   +'Keep following it to go on with this journey.';
 // "Last reported near Moss Park Road" beside "last report nearest Moss Park Road, 2 stops before
 // yours" is the same fact twice, and a passenger reads the repetition as two different claims.
 // The activity line is kept where it says more: that the bus appears to be standing there, or
 // where the progress line names a different stop or is missing altogether.
 const progressText=stop&&prog&&relevant?prog.text:stop&&!relevant?NOT_COMING[cardStanding??'unknown']:null;
 const activityAdds=activityLine!==null&&(activity?.kind==='stopped'||!progressText
  ||!progressText.includes(name(activity?.kind==='near'?activity.stop:'')));
 const stripStatus=selection.kind==='absent'?'No current report'
  :selection.kind==='new_journey'?`Now on another journey · ${ageChip(selection.bus)}`
  :shown?[progressText,activityAdds?activityLine?.text:null,ageChip(shown)].filter(Boolean).join(' · '):'';
 const inList=!pin||(stop?mapBuses:onRoute).some(bus=>bus.key===pin.bus.key);

 const rideOverlay=shown?<div className="ride-card" data-vehicle={shown.vehicle}>
  <div className="ride-card-head">
   <span className="route-badge">{shown.route}</span>
   <div>{!relevant&&<small className="ride-card-eyebrow">Selected bus · not coming to your stop</small>}
    <strong>to {destinationLabel(shown.destination)}</strong>{!motionWords&&<small>{ageText(shown)}</small>}</div>
  </div>
  {absent&&<p className="ride-status-line warn">No current report · shown at its last report, not moved on</p>}
  {pausedJourney&&<div className="ride-journey">
   <p className="ride-status-line warn">Now on another journey{shown.route?`: ${shown.route} to ${destinationLabel(shown.destination)}`:''}.
    Not estimated, and the camera has stopped following it.</p>
   <button className="text-action strong" onClick={continueJourney}>Keep following it on this journey</button>
  </div>}
  {motionWords&&<p className={`ride-motion ${motionInfo?.mode}`}>{motionWords.label}</p>}
  {motionInfo?.correction?.kind==='snap'&&motionInfo.correction.justNow&&<p className="ride-status-line warn" data-snap>
   Moved {Math.round(motionInfo.correction.metres)} m to its latest report{motionInfo.correction.standing?' · it had stopped':''}</p>}
  {activityAdds&&activityLine&&<p className="ride-status-line">{activityLine.text}</p>}
  {stop&&cardRelation&&prog&&relevant&&<p className={`ride-progress tone-${prog.tone}`}>{prog.text}</p>}
  {stop&&cardRelation&&relevant&&<StopProgress items={schematic(cardRelation,name,stop.id,5)} compact/>}
 </div>:null;

 const row=(item:BoardRow,detail:string)=><button key={item.bus.key} onClick={()=>chooseBus(item.bus)}
   className={`follow-row standing-${item.standing}${item.bus.key===activeKey?' on':''}`}
   aria-pressed={item.bus.key===activeKey}>
  <span className="route-pill">{item.bus.route}</span>
  <span className="follow-row-copy"><strong>to {destinationLabel(item.bus.destination)}</strong><small>{detail}</small></span>
  {pin?.bus.key===item.bus.key&&<em className="row-tag">{selection.kind==='new_journey'?'your bus · another journey':'your bus'}</em>}
  <span className={`fresh-chip ${mode==='archive'?'archive':item.bus.freshness??'unknown'}`}>{ageChip(item.bus)}</span>
 </button>;
 const more=board?board.passed.length+board.old.length+board.elsewhere.length:0;
 const scrollTo=(selector:string,open=false)=>{
  const element=document.querySelector<HTMLElement>(selector);
  if(open&&element instanceof HTMLDetailsElement)element.open=true;
  element?.scrollIntoView({block:'nearest',behavior:prefersReducedMotion()?'auto':'smooth'});
 };
 // One message when nothing is coming, telling the situations apart (no reports, a filter, old
 // reports, no feed, no coverage), each with what can be done next, instead of the same news three times.
 const hidden=board?.hidden.length??0,maybeN=board?.maybe.length??0;
 const runningServices=services.filter(s=>s.runsToday!==false);
 const serviceNames=(list:typeof services)=>list.slice(0,3).map(s=>`${s.line} to ${s.destination}`).join(', ')+(list.length>3?` and ${list.length-3} more`:'');
 const emptyKind=!board||board.coming.length>0?null
  :loading?'loading':services.length===0?'no_coverage':hidden>0?'filtered'
  :mode==='offline'||mode==='unavailable'?'feed'
  :board.maybe.length>0?'unsettled'
  :board.old.some(item=>item.standing==='coming')?'old'
  :runningServices.length===0?'not_today':'no_reports';
 const emptyTitle=emptyKind==='loading'?'Checking for live positions: the buses coming to this stop appear here once they arrive.'
  :emptyKind==='no_coverage'?'No timetable is held for this stop, so no bus can be confirmed as coming here.'
  :emptyKind==='filtered'?`Your filter, ${activeService?.line} to ${activeService?.destination}, hides ${hidden} ${hidden===1?'bus':'buses'} coming or possibly coming here.`
  :emptyKind==='feed'?(mode==='offline'?'You are offline, so nothing can be confirmed as coming: the last positions saved here are shown.'
                       :'Live positions are unavailable, so nothing can be confirmed as coming.')
  :emptyKind==='unsettled'?`${maybeN===1?'One bus':`${maybeN} buses`} may call here, but ${maybeN===1?'it is':'they are'} not confirmed: which branch ${maybeN===1?'it is':'they are'} on cannot be settled from the position alone.`
  :emptyKind==='old'?'The buses on services calling here have only old reports.'
  :emptyKind==='not_today'?`No service is timetabled to call here today (${serviceNames(services)} ${services.length===1?'runs':'run'} on other days).`
  :emptyKind==='no_reports'?`${serviceNames(runningServices)} ${runningServices.length===1?'is':'are'} timetabled here today, but no bus on ${runningServices.length===1?'it':'them'} has a current report.`
  :null;
 const emptyAside=emptyKind==='no_reports'?'A missing report does not mean no bus is running: the operator’s feed can leave vehicles out. Nothing is guessed to fill the gap.'
  :emptyKind==='no_coverage'?'The timetables held cover four operators (docs under Behind the data). Buses reported nearby are still listed.'
  :emptyKind==='old'?`Reports older than ${expiryMinutes} minutes are not drawn as current.`
  :emptyKind==='unsettled'?'The operator’s reported destination can settle it as the bus goes on. Nothing else is guessed.'
  :null;

 // Riding or exploring a bus that is not one of this stop's: the bus leads and the stop becomes
 // secondary context (CSS `order`), rather than the page opening with a stop search the passenger
 // has already moved on from. Nothing is unchosen, and the way back is in the card.
 // Wherever the page cannot say this bus is coming to the stop: it is not an answer to "what is
 // coming here", so the bus the passenger chose leads instead. A bus that *may* call on an
 // unsettled branch is still such an answer, and the stop stays in front for it.
 const exploringBus=Boolean(stop&&pinned&&!absent&&cardStanding!==null&&cardStanding!=='coming'&&cardStanding!=='maybe');
 return <section className={`follow${stop?' has-stop':''}${riding?' riding':''}${exploringBus?' exploring-bus':''}`}>
  <div className={`follow-bar ${copy.tone}`} role="status">
   <span className="follow-badge">{mode==='offline'?<WifiOff size={13}/>:<Radio size={13}/>}{copy.label}</span>
   <span className="follow-bar-when">
    {mode==='archive'?archiveDate
     :loading?'waiting for the first positions'
     :publicationAgeSeconds===null?'not published yet'
     :`updated ${ageBasis==='device'?'about ':''}${elapsedWords(publicationAgeSeconds)} ago`}</span>
   {mode!=='archive'&&collector?.kind==='bounded_development'&&<span className="follow-bar-run"
     title="Collected by a time-limited run on one machine, not an always-on service">
    local run{collector.endsBy&&collector.status==='running'?` · until ${clock(Date.parse(collector.endsBy))}`:''}</span>}
   <button className="follow-refresh" onClick={onRefresh} disabled={refreshing}
    aria-label="Check for newer positions"><RefreshCw size={15} className={refreshing?'spin':''}/></button>
  </div>

  {/* Where am I, where is my stop, and how do I walk there? The stop's name has the whole width;
      its actions sit on their own row beneath it. */}
  {stops.length>0&&(stop
   ? <div className="your-stop">
      <div className="your-stop-row">
       <span className="your-stop-mark"><MapPin size={18}/></span>
       <span className="your-stop-copy">
        <small className="your-stop-eyebrow">Your stop</small>
        <strong>{stopLabel}</strong>
        <small>{[bearingWords(stop.bearing),stop.street].filter(Boolean).join(' · ')||'No side-of-road detail supplied'}</small>
        {stopPlace(stop)&&<em>{stopPlace(stop)}</em>}
       </span>
      </div>
      <div className="your-stop-actions">
       {/* The detailed map has its own Locate me; the simple map does not, so here only with it. */}
       {onLocate&&mapFallback&&!guideLocates&&<button className="your-stop-locate" onClick={onLocate} disabled={locating} aria-label="Locate me">
        <LocateFixed size={15} className={locating?'spin':''}/><span>Locate me</span></button>}
       <button className={savedStopIds.includes(stop.id)?'on':''} aria-pressed={savedStopIds.includes(stop.id)} data-compact
        aria-label={savedStopIds.includes(stop.id)?'Saved on this device':'Save this stop'}
        onClick={()=>setBlocked(!saveStops(toggleSavedStop(savedStopIds,stop.id)))}>
        <Star size={15} fill={savedStopIds.includes(stop.id)?'currentColor':'none'}/>
        <span>{savedStopIds.includes(stop.id)?'Saved':'Save'}</span></button>
       <button onClick={share} aria-label="Share this stop" data-compact><Share2 size={15}/><span>Share</span></button>
       <button onClick={()=>selectStop(null)}>Change</button>
       <button onClick={newJourney} aria-label="New journey: clear the stop, filter and chosen bus" data-new-journey>
        <RotateCcw size={15}/><span>New journey</span></button>
      </div>
      {mode!=='archive'&&<WalkGuide state={walk} config={walking} here={here} origin={origin} nowMs={nowMs} stop={stop} consent={consent}
       onConsent={setConsent} onRetry={()=>setWalkAttempt(n=>n+1)} onLocate={onLocate} locating={locating}
       locationError={locationError} pickingOrigin={pickingOrigin} onStartPicking={onStartPicking}
       onCancelPicking={onCancelPicking}/>}
     </div>
   : <div className="your-stop unset">
      {/* The last journey on this device, offered and never applied: one tap takes it up, one lets it go. */}
      {offer&&offerStop&&<section className="continue" aria-label="Continue your last journey" data-continue>
       <button className="continue-chip" onClick={continueOffer}>
        <Play size={15} aria-hidden="true"/>
        <span className="continue-copy"><strong>Continue · {offerStop.name}{offerStop.indicator?` (${offerStop.indicator})`:''}</strong>
         <small>{offer.bus?`${offer.bus.route} to ${destinationLabel(offer.bus.destination)}`
          :offer.serviceKey?`${offer.serviceKey.split('|')[1]} to ${(offer.serviceKey.split('|')[3]??'').replace(/_/g,' ')}`
          :'your last stop'} · from earlier today</small></span>
       </button>
       <button className="continue-forget" onClick={newJourney} aria-label="Forget this journey"><X size={15}/></button>
      </section>}
      {/* A returning passenger's own stops and routes come first, above finding a new one. */}
      {(savedStops.length>0||favourites.length>0)&&<section className="saved" aria-label="Saved on this phone">
       <h3 className="saved-head">Saved on this phone<small>{savedStops.length&&favourites.length?'stops and routes'
        :savedStops.length?'stops':'routes'}</small></h3>
       <div className="stop-chips">
        {savedStops.map(saved=><button key={saved.id} className="stop-chip" onClick={()=>selectStop(saved)}>
         <MapPin size={14}/><span>{saved.name}{saved.indicator?` · ${saved.indicator}`:''}</span></button>)}
        {favourites.map(f=>{
         const id=`${f.operator}|${f.route}`,running=availableIds.includes(id);
         const way=f.direction==='all'?'both ways':directionLabel(f.direction).toLowerCase();
         return <button key={favouriteKey(f)} className={`stop-chip route${route===id?' on':''}`}
          aria-pressed={route===id} aria-label={`Route ${f.route}, ${way}${running?'':', no buses reporting now'}`}
          onClick={()=>{pick({route:id,direction:f.direction});scrollTo('.route-browse')}}>
          <span className="route-pill">{f.route}</span><span>{way}{running?'':' · none now'}</span></button>;
        })}
       </div>
       <InstallHint/>
      </section>}
      {(()=>{const recentStops=recents.map(r=>stopById.get(r.stopId)).filter((s):s is Stop=>s!==undefined&&!savedStopIds.includes(s.id));
       return recentStops.length>0&&<section className="saved recent" aria-label="Recent stops" data-recents>
        <h3 className="saved-head">Recent stops<small>chosen on this phone</small></h3>
        <div className="stop-chips">{recentStops.map(recent=><button key={recent.id} className="stop-chip" onClick={()=>selectStop(recent)}>
         <History size={14}/><span>{recent.name}{recent.indicator?` · ${recent.indicator}`:''}</span></button>)}</div>
       </section>})()}
      <Nearby stops={stops} patterns={patterns} here={here} outsideArea={outsideArea} day={day}
       onSelect={selectStop} onLocate={onLocate??(()=>{})} locating={!!locating}
       locationError={locationError} onClearHere={onClearHere} areaLabel="Manchester"/>
     </div>)}
  {blocked&&<p className="follow-hint warn">This device would not let us save that. It still works for this visit.</p>}
  {shareState==='copied'&&<p className="follow-hint">Link copied. It names this stop{pin?' and the bus you chose':''}, never
   your location.</p>}
  {shareState==='failed'&&<p className="follow-hint warn">This browser would not share or copy the link.</p>}
  {restoreNotes.length>0&&<div className="restore-notice" role="status">
   {restoreNotes.map(note=><p key={note}>{note}</p>)}
  </div>}

  {/* The bus being followed, one glance away. It comes before the map, so that on a phone the
      answer shares the first screen with the stop; on a wide screen the map has a column of its
      own, so the order there is unchanged. */}
  {identity&&<div className={`active-bus ${selectionKind??'none'}`} role="status" aria-label="The bus shown on the map"
    data-vehicle={identity.vehicle}>
   <span className="route-pill">{identity.route||'?'}</span>
   <span className="active-bus-copy">
    <strong>{selectionKind==='suggested'?'Suggested':busNoun}: {identity.route
     ?`${identity.route} to ${destinationLabel(identity.destination)}`:`vehicle ${identity.vehicle}`}</strong>
    <small>{stripStatus}{!inList?' · not in the list below':''}</small>
   </span>
   <button className="text-action" onClick={showCard}>Details</button>
  </div>}

  {mapFallback
   ? <div className="map-fallback-wrap" data-map-fallback={mapFallback}>
      <p className="map-fallback-note" role="status">{mapFallback==='chosen'
       ?'The simple map, as you chose.'
       :`The detailed map could not be used here (${FALLBACK[mapFallback]??mapFallback}), so this simpler map is shown.`}
       {mapFallback!=='no_webgl'&&<> <button className="text-action" onClick={()=>setMapFallback(null)}>
        {mapFallback==='chosen'?'Use the detailed map':'Try the detailed map again'}</button></>}</p>
      <FollowMap buses={mapBuses} selected={shown} follow={follow&&!pausedJourney} roads={roads}
       mode={mode} stop={stop} here={here} onSelect={selectFromMap} onManualMove={stopFollowing}/>
     </div>
   : <CityMap paused={paused} buses={mapBuses} selected={shown} selectionKind={selectionKind} stop={stop} here={here} follow={follow&&!pausedJourney}
      onSelect={selectFromMap} onManualMove={stopFollowing} onUnavailable={showMapFallback}
      view={effectiveView} onViewChange={changeView} theme={theme} onThemeChange={saveTheme}
      fitRequest={fitRequest} onLocate={guideLocates?undefined:onLocate} locating={locating} rideOverlay={rideOverlay}
      originKind={origin?.kind??'device'} pickingOrigin={pickingOrigin}
      onPickOrigin={onChooseOrigin?point=>onChooseOrigin(point,'a point on the map'):undefined}
      busLabel={absent?'Your bus · no report':busNoun}
      walk={walkRoute&&here&&stop?{path:walkRoute.path,from:here,to:{lat:stop.lat,lon:stop.lon}}:null}
      clockOffsetMs={clockOffsetMs} motion={motion} onMotion={reportMotion} onRideState={setRideState}
      stopsAhead={stopsAhead} onSimpleMap={chooseSimpleMap}/>}


  {/* The stop first: what leaves from here, then the buses coming to it with how far each has got
      and how old its report is, then everything else listed apart with what it is. The card for
      the chosen bus follows, so the alternatives are never below a long card. */}
  {stop&&services.length>0&&<section className="services" aria-label="Services from your stop">
   <h3 className="section-head">Services from this stop<small>{activeService?'filtered · tap it again to clear':'timetabled · tap to filter'}</small></h3>
   <div className="service-chips">{services.map(service=>
    <button key={service.key} aria-pressed={activeService?.key===service.key}
     aria-label={`${activeService?.key===service.key?'Clear filter: ':''}${service.line} to ${service.destination}`}
     className={`service-chip${activeService?.key===service.key?' on':''}${service.runsToday===false?' not-today':''}`}
     onClick={()=>chooseService(service.key)}>
     {activeService?.key===service.key&&<X size={13} className="service-chip-clear" aria-hidden="true"/>}
     <span className="route-pill">{service.line}</span>
     <span className="service-chip-copy"><strong>to {service.destination}</strong>
      <small>{service.runsToday===false?`not running today · ${service.runs}`
       :service.reporting?`${service.reporting} coming or here`:'none reporting nearby'}</small></span>
    </button>)}</div>
  </section>}
  {stop&&board&&<section className="waiting" aria-label="Buses coming to your stop">
   <h3 className="section-head">{activeService?`${activeService.line} to ${activeService.destination}`:'Coming to your stop'}
    <small>by the timetable’s stop order</small></h3>
   {emptyTitle
    ? <div className="empty-state" role="status">
       <strong>{emptyTitle}</strong>
       {emptyAside&&<span>{emptyAside}</span>}
       {(board.maybe.length>0||board.nearby.length>0||more>0)&&<span>{[
        board.maybe.length&&emptyKind!=='unsettled'?`${board.maybe.length} may call here (branch not settled)`:'',
        board.nearby.length?`${board.nearby.length} reported nearby, not coming here`:'',
        more?`${more} more near your stop`:''].filter(Boolean).join(' · ')}</span>}
       <div className="empty-actions">
        {emptyKind==='filtered'&&<button className="text-action strong" onClick={()=>setServiceChoice(null)} data-clear-filter>Show all services</button>}
        {board.maybe.length>0&&<button className="text-action" onClick={()=>scrollTo('.maybe-coming')}>
         See the {board.maybe.length===1?'one':board.maybe.length} that may call</button>}
        {board.nearby.length>0&&<button className="text-action" onClick={()=>scrollTo('.nearby-reports')}>
         Buses reported nearby</button>}
        {more>0&&<button className="text-action" onClick={()=>scrollTo('.exploring',true)}>More near your stop</button>}
        <button className="text-action" onClick={()=>selectStop(null)}>Choose another stop</button>
       </div>
      </div>
    : board.coming.map(item=>row(item,standingWords(item)))}
   {!emptyTitle&&hidden>0&&<button className="text-action filter-more" onClick={()=>setServiceChoice(null)} data-clear-filter>
    Show all services · {hidden} more coming or possibly coming on other services</button>}
  </section>}
  {stop&&board&&board.maybe.length>0&&<section className="maybe-coming" aria-label="Buses that may call at your stop">
   <h3 className="section-head">May call at your stop<small>branch not settled</small></h3>
   {board.maybe.map(item=>row(item,standingWords(item)))}
  </section>}
  {stop&&board&&board.nearby.length>0&&<section className="nearby-reports" aria-label="Last reported nearby">
   <h3 className="section-head">Last reported nearby<small>within 150 m, not coming to your stop</small></h3>
   {board.nearby.map(item=>row(item,`${Math.round(item.metres/10)*10} m away · ${standingWords(item)}`))}
  </section>}
  {stop&&board&&more>0&&<details className="exploring">
   <summary>More buses near your stop ({more})</summary>
   {board.passed.length>0&&<div className="board-group"><h4>Already past your stop</h4>
    {board.passed.map(item=>row(item,standingWords(item)))}</div>}
   {board.elsewhere.length>0&&<div className="board-group"><h4>Not for your stop</h4>
    {board.elsewhere.map(item=>row(item,`${(item.metres/1000).toFixed(1)} km away · ${standingWords(item)}`))}</div>}
   {board.old.length>0&&<div className="board-group"><h4>Old reports</h4>
    {board.old.map(item=>row(item,`${standingWords(item)} · an old report`))}</div>}
  </details>}

  {/* Which bus, is it coming here, how far has it got, how old is that? */}
  {identity&&<article id="lm-bus-card" className={`bus-card${absent?' gone':''}${relevant?'':' explored'}${selectionKind==='suggested'?' suggested':''}`}
    aria-label={absent?'Your bus, no current report':busNoun} tabIndex={-1}
    data-vehicle={identity.vehicle} data-selection={selectionKind??'none'}>
   <p className="bus-card-eyebrow">{absent?'Your bus · no current report'
    :selection.kind==='new_journey'?'Your bus · another journey':busNoun}</p>
   <header className="bus-card-head">
    <span className="route-badge">{identity.route||'?'}</span>
    <div className="bus-card-title">
     {/* A link that named only a vehicle, never seen since: its route and destination are unknown. */}
     <strong>{identity.route?`to ${destinationLabel(identity.destination)}`:`Vehicle ${identity.vehicle}`}</strong>
     <small>{[directionLabel(identity.direction),identity.operator].filter(Boolean).join(' · ')}</small>
    </div>
    {shown&&!absent?<span className={`age-chip ${mode==='archive'?'archive':shown.freshness??'unknown'}`}>{ageChip(shown)}</span>
     :<span className="age-chip stale">no current report</span>}
   </header>
   {selectionKind==='suggested'&&<p className="bus-card-suggestion">Shown because it is {stop?'coming to your stop':'the latest report on this route'}.
    It stays shown while it is; following it or riding along keeps it chosen.</p>}
   {absentWords&&<div className="selection-note absent" role="status">
    <p><strong>No current report.</strong> {absentWords}</p>
    <div className="selection-actions">
     {alternatives.map(bus=><button key={bus.key} className="text-action" onClick={()=>chooseBus(bus)}>
      Follow {bus.route} to {destinationLabel(bus.destination)} instead</button>)}
     <button className="text-action" onClick={letGo}>Stop following this bus</button>
    </div>
   </div>}
   {journeyWords&&<div className="selection-note journey" role="status">
    <p><strong>This bus has started another journey.</strong> {journeyWords}</p>
    <div className="selection-actions">
     <button className="text-action strong" onClick={continueJourney}>Keep following it on this journey</button>
     {alternatives.map(bus=><button key={bus.key} className="text-action" onClick={()=>chooseBus(bus)}>
      Follow {bus.route} to {destinationLabel(bus.destination)} instead</button>)}
     <button className="text-action" onClick={letGo}>Stop following it</button>
    </div>
   </div>}
   {/* A bus that does not serve the stop is said so once, in the block below with the way back,
       not here as well: the same sentence three times reads as three different problems. */}
   {shown&&!absent&&stop&&prog&&relevant&&<div className={`bus-card-answer tone-${prog.tone}`}>
    <strong>{prog.text}</strong>{prog.detail&&<span>{prog.detail}</span>}</div>}
   {/* The operator's timetable, read out: the named journey's departure plus the scheduled running
       time to this stop. Shown only for a bus still before the stop on one named journey, and
       labelled as the timetable's, because a time at a stop reads as a prediction and is not one. */}
   {/* Estimated minutes: shown only for a direction the criteria released on unseen journeys, computed
       from the bus's own reports on its checked road, labelled as an estimate with the report age. */}
   {shown&&!absent&&stop&&relevant&&arrival?.kind==='estimate'&&<p className="bus-card-arrival" data-arrival={arrival.minutes.toFixed(1)}>
    <strong>Estimated {arrivalWords(arrival)} to your stop</strong>
    <span>an estimate from its reports, last {arrival.reportAgeS} s ago · {Math.round(arrival.remainingM/100)*100} m of road left · not a promise</span></p>}
   {shown&&!absent&&stop&&relevant&&timetabled?.kind==='time'&&<p className="bus-card-scheduled" data-scheduled={timetabled.wall}>
    <strong>Timetabled at your stop {timetabled.wall}</strong>
    <span>from the operator’s timetable · not a prediction, and not adjusted for where the bus is</span></p>}
   {activityLine&&relevant&&<details className="bus-card-activity"><summary><strong>{activityLine.text}</strong>
    <span>How this is known</span></summary><p>{activityLine.detail}</p></details>}
   {notServing&&!absent&&<div className="bus-card-explored" role="note" data-other-side={otherSide?otherSide.stop.id:undefined}>
    <p>{notServing}</p>
    {otherSide&&<button className="back-to-stop" onClick={()=>selectStop(otherSide.stop)} data-use-other-side>
     <ArrowLeft size={15}/>Use {otherSide.stop.name}{otherSide.stop.indicator?` (${otherSide.stop.indicator})`:''} instead</button>}
    <button className="back-to-stop" onClick={letGo}><ArrowLeft size={15}/>Back to buses for your stop
     {board&&board.coming.length?` (${board.coming.length} coming)`:''}</button>
   </div>}
   {motionWords&&relevant&&<div className={`bus-card-motion ${motionInfo?.mode}`}>
    {/* The label is the claim; how an estimate is made is one tap away. Why a bus is not
        estimated stays in view. */}
    {motionInfo?.mode==='estimated'
     ? <details><summary><strong>{motionWords.label}</strong><span>How the estimate is made</span></summary>
        <p>{motionWords.detail}</p></details>
     : <p><strong>{motionWords.label}</strong><span>{motionWords.detail}</span></p>}
    <button className="text-action" aria-pressed={!estimatedMovement}
     onClick={()=>saveMotionPreference(!estimatedMovement)}>
     {estimatedMovement?'Show reported positions only':'Show estimated movement'}</button>
   </div>}
   {stop&&walked&&relevant&&<p className="bus-card-walk"><strong>You: {walked.time} walk</strong>
    <span>{walked.distance} to {stopLabel}</span></p>}
   {shown&&!absent&&relevant&&(stop&&assoc
    ? <dl className="claims">
       <div className="claim"><dt>Boarding point</dt><dd><strong>{stopLabel}</strong>
        <span>{[bearingWords(stop.bearing),stop.street].filter(Boolean).join(' · ')}</span></dd></div>
       <div className={`claim tone-${assoc.tone}`}><dt>Calls at your stop?</dt><dd><strong>{assoc.text}</strong>
        {relevant&&assoc.detail&&<span>{assoc.detail}</span>}</dd></div>
       <div className="claim"><dt>Report age</dt><dd><strong>{ageText(shown)}</strong>
        {mode==='archive'?<span>from the recording, not live</span>
         :FRESHNESS[shown.freshness??'']&&<span>{FRESHNESS[shown.freshness??'']}</span>}</dd></div>
      </dl>
    : <p className="bus-card-hint"><strong>{mode==='archive'?'A recorded position':`Reported ${ageChip(shown)}`}</strong>
      Choose your stop to see whether this bus calls there and how far it has got.</p>)}
   {shown&&!absent&&relevant&&<StopProgress items={items}/>}
   {shown&&!absent&&relevant&&<ul className="distance-lines">{distanceLines({here,stop,bus:shown,relation:cardRelation,
     walk:walkRoute?{metres:walkRoute.metres,seconds:walkRoute.seconds,provider:walkRoute.provider}:null}).map(line=>
    <li key={line.label}><span>{line.label}</span><strong>{line.value}</strong><small>{line.basis}</small></li>)}</ul>}
   {shown&&!absent&&(riding||!pausedJourney)&&<div className="bus-card-actions">
    {riding
     ? <div className="ride-status" data-state={rideState}>
        <span className="ride-status-words">Riding along · {rideState==='exploring'
         ?'you moved the map; return to the bus on the map':RIDE_WORDS[rideState]||'starting'}</span>
        <button className="ride-state" onClick={()=>setView('2d')} aria-label="Leave the ride-along"
         aria-pressed="true"><X size={16}/><span>Exit</span></button>
       </div>
     : <button className={`follow-toggle ${follow?'on':''}`} onClick={toggleFollow}
        aria-pressed={follow} aria-label={follow?'Stop following this bus':'Keep this bus centred'}>
        <Crosshair size={16}/><span>{follow?'Following on the map':selectionKind==='suggested'?'Follow this bus':'Follow on the map'}</span></button>}
    {pinned&&!riding&&<button className="text-action" onClick={letGo}>Choose another bus</button>}
   </div>}
   {absent&&riding&&<div className="bus-card-actions"><div className="ride-status" data-state={rideState}>
    <span className="ride-status-words">Riding along · waiting for a new report from this bus</span>
    <button className="ride-state" onClick={()=>setView('2d')} aria-label="Leave the ride-along"
     aria-pressed="true"><X size={16}/><span>Exit</span></button></div></div>}
   {shown&&<details className="bus-evidence-toggle">
    <summary>How we know this</summary>
    <BusEvidence bus={shown} relation={cardRelation} patterns={patternsById} mode={mode}
     publishedAt={live?.publishedAt} liveFingerprint={liveFingerprint} ageBasis={ageBasis}
     expiryMinutes={expiryMinutes} name={name} onOpenEvidence={onOpenEvidence} activity={activity}/>
   </details>}
  </article>}

  {/* Four situations, told apart in plain words rather than one vague message. */}
  {mode==='unavailable'&&!loading&&<div className="follow-empty">
   <Radio size={20}/><h3>Live bus positions are unavailable</h3>
   <p>This page is not receiving current bus positions. You can still browse the map and search
    the stops. Try refreshing, or explore a dated recording.</p>
   {onUseArchive&&!usingArchive&&<button className="action" onClick={onUseArchive}>Follow a bus in the recording</button>}
  </div>}
  {mode!=='unavailable'&&buses.length===0&&<div className="follow-empty">
   <Clock3 size={20}/>
   <h3>{mode==='offline'?'No saved positions on this device':'Every position we hold has passed its cut-off'}</h3>
   <p>{mode==='offline'
    ?'Your browser cannot reach us and there is no copy saved here yet.'
    :`Nothing has reported in the last ${expiryMinutes} minutes, so there is nothing honest to draw.`}</p>
   {mode==='stale'&&<p className="follow-empty-aside">Our collector last published{' '}
    {publicationAgeSeconds===null?'at an unknown time':`${elapsedWords(publicationAgeSeconds)} ago`}.</p>}
   {onUseArchive&&!usingArchive&&<button className="action" onClick={onUseArchive}>Follow a bus in the recording</button>}
  </div>}

  {/* For someone with no stop in mind: a bus whose ride has the front view now, from the latest
      publication's own eligibility. Choosing one is exploring, and the page says so. */}
  {!stop&&buses.length>0&&mode==='live'&&<ExploreFront buses={buses}
    onChoose={bus=>{pick({route:routeId(bus),direction:bus.direction});chooseBus(bus);scrollTo('#lm-bus-card')}}/>}
  {!stop&&buses.length>0&&<section className="route-browse" aria-label="Follow a route">
   <h3 className="section-head">Or follow a route<small>without choosing a stop</small></h3>
   <div className="follow-pickers">
    <label className="sr-only" htmlFor="follow-route">Route</label>
    <div className="picker route"><span>Route</span>
     <select id="follow-route" value={route} onChange={e=>pick({route:e.target.value,direction:'all'})}>
      {routeChoices.map(id=><option key={id} value={id}>{routeNumber(id)}</option>)}
     </select></div>
    <label className="sr-only" htmlFor="follow-direction">Direction</label>
    <div className="picker"><span>Direction</span>
     <select id="follow-direction" value={direction} onChange={e=>pick({route,direction:e.target.value})}>
      <option value="all">Both ways</option>
      {directions.map(d=><option key={d} value={d}>{directionLabel(d)}</option>)}
     </select></div>
    <button className={`follow-save ${savedRoute?'on':''}`} aria-pressed={savedRoute}
     aria-label={savedRoute?'Saved on this device':'Save this route on this device'}
     onClick={()=>{if(current)setBlocked(!saveFavourites(toggleFavourite(favourites,current)))}}>
     <Star size={18} fill={savedRoute?'currentColor':'none'}/></button>
   </div>
   {/* Saved routes are listed once, with the saved stops at the top of the page. */}
   {onRoute.length>1&&<div className="follow-list">
    {onRoute.filter(bus=>bus.key!==shown?.key).slice(0,10).map(bus=><button key={bus.key}
      onClick={()=>chooseBus(bus)} className="follow-row">
     <span className="route-pill">{bus.route}</span>
     <span className="follow-row-copy"><strong>to {destinationLabel(bus.destination)}</strong>
      <small>{directionLabel(bus.direction)}</small></span>
     {pin?.bus.key===bus.key&&<em className="row-tag">{selection.kind==='new_journey'?'your bus · another journey':'your bus'}</em>}
     <span className={`fresh-chip ${mode==='archive'?'archive':bus.freshness??'unknown'}`}>{ageChip(bus)}</span>
    </button>)}
   </div>}
  </section>}

  <p className="follow-notes">{mode==='archive'
   ?'A recording: times are when each bus reported on the day, not how long ago. '
   :`Positions older than ${expiryMinutes} minutes are withheld. `}
   Progress is counted in timetabled stops from each bus’s last report. Where the operator’s timetable names the journey, its scheduled time at your stop is shown as the timetable’s; no arrival time is predicted.
   {' '}<button className="text-action" onClick={onOpenEvidence}>How this works</button></p>
 </section>;
}
