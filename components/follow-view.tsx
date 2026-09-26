"use client";

import {useCallback,useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import {ArrowLeft,Clock3,Crosshair,History,LocateFixed,MapPin,Play,Radio,RefreshCw,RotateCcw,Share2,Star,WifiOff,X,ChevronDown,ChevronUp,Route} from 'lucide-react';
import FollowMap from '@/components/follow-map';
import CityMap,{RIDE_WORDS,type Here,type MapView,type RideState,type SelectionKind} from '@/components/city-map';
import Nearby from '@/components/nearby';
import StopSearch from '@/components/stop-search';
import PlanPanel,{type PlanTo} from '@/components/plan-panel';
import {readPlanLink,withPlan} from '@/lib/plan-link';
import type {DirectOption} from '@/lib/plan';
import type {Place} from '@/lib/places';
import {longestPattern,routeIndex,type RouteHit} from '@/lib/route-search';
import {serviceKey as serviceKeyOf} from '@/lib/journey';
import StopProgress from '@/components/stop-progress';
import BusEvidence from '@/components/bus-evidence';
import WalkGuide from '@/components/walk-guide';
import {DepartureBoard} from '@/components/departure-board';
import TryRide from '@/components/try-ride';
import dynamic from 'next/dynamic';
import type {DrawnFrame,Photo3d} from '@/lib/gods-eye';
// The view from above is loaded only when a passenger opens it: its renderer is 6 MB.
const GodsEye=dynamic(()=>import('@/components/gods-eye'),{ssr:false});
import type {RecordedRideSummary} from '@/lib/recorded-ride';
import InstallHint from '@/components/install-hint';
import {relateToStop,servicesAt,towardsWords,type PatternCatalogue,type ServicePattern,type StopRelation} from '@/lib/patterns';
import {association,busOnService,distanceLines,progress,schematic,servicesAtStop,standing,standingWords,
        stopBoard,type BoardRow} from '@/lib/journey';
import {londonDate} from '@/lib/service-days';
import {readSheetHeights,SHEET_PEEK,useSheetViewport} from '@/lib/use-sheet-viewport';
import {bearingWords,savedStopsServerSnapshot,savedStopsSnapshot,saveStops,stopPlace,straightLineMetres,
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
import {describeMotion,motionPreferenceServerSnapshot,motionPreferenceSnapshot,REPOSITION_WORDS,saveMotionPreference,
        subscribeMotionPreference,type MotionInfo} from '@/lib/motion-view';
import {busLinkKey,JOURNEY_SESSION_STORE,journeyQuery,recentsServerSnapshot,recentsSnapshot,rememberRecent,
        restoreService,subscribeRecents,writeJourney,type InitialJourney} from '@/lib/journey-context';
import {adoptJourney,alternativesTo,keepSuggestion,pinFromKey,pinOf,resolveSelection,
        type Pin,type PinSource,type Selection} from '@/lib/selection';
import {activityWords,stopActivity} from '@/lib/stop-activity';
import {prefersReducedMotion} from '@/lib/basemap';

/** A recorded ride as the page replays it (app/page.tsx): what it is, whose bus, and the two ways out. */
export type Recording={id:string;title:string;date:string;when:string;busKey:string;started:boolean;ended:boolean;
 onLeave:()=>void;onReplay:()=>void};

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
                                    here,origin=null,device=null,originEpoch=0,outsideArea,onClearHere,nowMs,liveFingerprint,recall,walkingConfig,
                                    pickingOrigin=false,onStartPicking,onCancelPicking,onChooseOrigin,
                                    clockOffsetMs=0,initialJourney,journeyEpoch=0,onNewJourney,onAddress,
                                    recording=null,recordings=[],onWatchRecording,recordingError=null,photo3d=null}:{
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
 /** The device's latest measured position, apart from the journey's start; and how many times a
  *  start has been chosen explicitly (what the camera may go to). */
 device?:(Here&{takenAtMs?:number})|null;originEpoch?:number;
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
 /** A recorded ride being replayed in place of the feed: badged, never remembered, left by one action. */
 recording?:Recording|null;
 /** The recordings on offer for Try Ride-along, and the way to start one. */
 recordings?:RecordedRideSummary[];onWatchRecording?:(ride:RecordedRideSummary)=>void;recordingError?:string|null;
 /** The photographic 3D tileset this server offers for the view from above, or null: not offered. */
 photo3d?:Photo3d|null;
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
 // The view from above (components/gods-eye.tsx): open or not, what the map last drew for it, and
 // which buses it asked the map to step. The map keeps drawing underneath; nothing else changes.
 const [above,setAbove]=useState(false);
 const drawnFrame=useRef<DrawnFrame|null>(null);
 const onDrawn=useCallback((frame:DrawnFrame)=>{drawnFrame.current=frame},[]);
 const [aboveFocus,setAboveFocus]=useState<{lat:number;lon:number;radiusM:number}|null>(null);
 // Where the view opens: taken once, when it is opened (the chosen bus moves on; the view must not
 // be rebuilt around each of its reports).
 const [aboveStart,setAboveStart]=useState<{lat:number;lon:number}|null>(null);
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
 // The panel shows one thing at a time — the way in (home), a stop's board, a bus's details, or a
 // plan — and on a phone it is a sheet over the map with three heights. Choosing a bus from a
 // list, a marker or Details opens its details; Back returns to the board with the bus still
 // chosen; a stop or New journey closes both.
 const [busOpen,setBusOpen]=useState(false);
 const [planOpen,setPlanOpen]=useState(false);
 const [sheet,setSheet]=useState<'peek'|'half'|'full'>('half');
 // The drag keeps the last few pointer positions with their times, so its end can tell a flick
 // from a slow drag that stopped: a flick goes the way it was thrown, a stop snaps to the nearest.
 const sheetDrag=useRef<{y:number;h:number;moved:boolean;samples:{t:number;y:number}[]}|null>(null);
 const followRef=useRef<HTMLElement>(null);
 useSheetViewport(followRef);
 // The sheet folds for the keyboard so the search's matches have the screen; what it was before is
 // kept, and given back when the search is left without a choice. A choice moves the task on and
 // sets the sheet itself.
 const sheetBeforeSearch=useRef<'peek'|'half'|'full'|null>(null);
 const panelBody=useRef<HTMLDivElement>(null);
 const selectFromMap=useCallback((key:string)=>{
  setBusOpen(true);setSheet(sh=>sh==='peek'?'half':sh);
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
 // Browsing stops around a place on the map rather than around the device, and where the map's
 // centre is after the passenger moved it (an offer to browse there, never taken up by itself).
 const [browseAt,setBrowseAt]=useState<{lat:number;lon:number}|null>(null);
 const [panCentre,setPanCentre]=useState<{lat:number;lon:number}|null>(null);
 const routes=useMemo(()=>routeIndex(patterns),[patterns]);
 // A journey being planned: where to, and which direct option was chosen. The start is the
 // origin the page already keeps (this device, or a fixed place). Kept for this tab, and in a
 // shared link; cleared by New journey.
 const [destination,setDestinationState]=useState<PlanTo|null>(null);
 const [chosenPlan,setChosenPlan]=useState<string|null>(null);
 const DESTINATION_KEY='lost-minutes.destination.v1';
 // Restored after mount, off the render path: a link's destination first, else this tab's. A
 // starting point in a link is a fixed place someone chose, and is taken up as one, once.
 useEffect(()=>{
  const linked=readPlanLink(window.location.search);
  let kept:PlanTo|null=null;
  try{const raw=sessionStorage.getItem(DESTINATION_KEY);if(raw){const t=JSON.parse(raw);if(t&&Number.isFinite(t.lat)&&Number.isFinite(t.lon)&&t.label)kept=t}}catch{/* nothing kept */}
  const timer=setTimeout(()=>{
   if(linked.to)setDestinationState(linked.to);else if(kept)setDestinationState(kept);
   if(linked.from&&onChooseOrigin&&!origin)onChooseOrigin({lat:linked.from.lat,lon:linked.from.lon},linked.from.label);
  },0);
  return()=>clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[]);
 function setDestination(next:PlanTo|null){
  setDestinationState(next);setChosenPlan(null);
  if(!next)setPlanOpen(true);
  try{if(next)sessionStorage.setItem(DESTINATION_KEY,JSON.stringify(next));else sessionStorage.removeItem(DESTINATION_KEY)}catch{}
  const fromPlace=origin?.kind==='chosen'?{lat:origin.lat,lon:origin.lon,label:origin.label}:null;
  const target=`${window.location.pathname}${withPlan(window.location.search,next?fromPlace:null,next)}`;
  if(target!==`${window.location.pathname}${window.location.search}`){window.history.replaceState(window.history.state,'',target);onAddress?.(withPlan(window.location.search,next?fromPlace:null,next))}
 }
 const planLink=typeof window==='undefined'?'':`${window.location.origin}${window.location.pathname}${withPlan(window.location.search,origin?.kind==='chosen'?{lat:origin.lat,lon:origin.lon,label:origin.label}:null,destination)}`;
 function choosePlan(option:DirectOption){
  setChosenPlan(`${option.pattern.id}|${option.board.id}|${option.alight.id}`);
  setPlanOpen(false);
  selectStop(option.board);
  const key=serviceKeyOf(option.pattern);
  setTimeout(()=>{setServiceChoice(key);scrollTo('.waiting')},0);
 }
 function chooseFromPlace(place:Place){onChooseOrigin?.({lat:place.lat,lon:place.lon},place.label)}
 // Which of a route's directions is open: two directions can share a compass word and differ only
 // by destination (a branch), so the key is both.
 const [dirKey,setDirKey]=useState<string|null>(null);
 const directionKey=(d:{direction:string|null;destination:string|null})=>`${d.direction??''}|${d.destination??''}`;
 const fallbackRoute=useMemo(()=>{
  const saved=favourites.find(f=>availableIds.includes(`${f.operator}|${f.route}`));
  if(saved)return {route:`${saved.operator}|${saved.route}`,direction:saved.direction};
  return {route:keptRoute&&availableIds.includes(keptRoute)?keptRoute:available[0]?.id??'',direction:'all'};
 },[favourites,available,availableIds,keptRoute]);
 const {route,direction}=choice??fallbackRoute;
 if(!choice&&route&&route!==keptRoute)setKeptRoute(route);
 const onRoute=useMemo(()=>buses.filter(b=>routeId(b)===route&&(direction==='all'||b.direction===direction))
  .sort((a,b)=>b.observedAtMs-a.observedAtMs),[buses,route,direction]);
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
 // The buses the map draws a size stronger than the rest of the fleet: those coming to the stop, or
 // that may be, or last reported beside it; with no stop, the route being browsed.
 const mapEmphasis=useMemo(()=>stop&&board?[...board.coming,...board.maybe,...board.nearby].map(row=>row.bus.key)
  :onRoute.map(b=>b.key),[stop,board,onRoute]);
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
  if(initialJourney===undefined||mode==='archive'||recording)return;
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
 },[initialJourney,mode,pin,serviceChoice,stop,onAddress,recording]);

 // Before the first publication arrives nothing is known either way: not "not collecting". A
 // recording is its own state, whatever the replayed publication's age says.
 const copy=recording?{label:recording.ended?'RECORDING ENDED':'RECORDED RIDE',tone:'archive'}
  :loading?{label:'CHECKING',tone:'idle'}:MODE[mode];
 const policy=live?.freshness.policy;
 const expiryMinutes=policy?Math.round(policy.observationExpirySeconds/60):15;
 const collector=live?.collection.collector;

 // Every way of choosing a bus pins it. Filters, a new route or a new stop leave the pin alone:
 // a bus the passenger chose never disappears because it falls outside the list being browsed.
 function pinBus(bus:FollowBus,via:PinSource){setPinChoice(pinOf(bus,via))}
 function chooseBus(bus:FollowBus){pinBus(bus,'list');setFollow(false);setFitRequest(n=>n+1);setBusOpen(true);setSheet(s=>s==='peek'?'half':s);
  setTimeout(()=>{panelBody.current?.scrollTo({top:0,behavior:prefersReducedMotion()?'auto':'smooth'})},0)}
 function chooseService(key:string){setServiceChoice(serviceKey===key?null:key);setFitRequest(n=>n+1)}
 // Try Ride-along: the bus is pinned as a ride would pin it and the ride begins, with no stop.
 function startRide(bus:FollowBus){
  pick({route:routeId(bus),direction:bus.direction});
  pinBus(bus,'ride');setFollow(false);setBusOpen(true);setSheet(s=>s==='peek'?'half':s);setView('ride');
 }
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
  setBusOpen(false);setPlanOpen(false);setSheet('half');
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
 function letGo(){setPinChoice(null);setFollow(false);setView('2d');setFitRequest(n=>n+1);setBusOpen(false)}
 const rideStarted=useRef<string|null>(null);
 const startRideRef=useRef(startRide),letGoRef=useRef(letGo);
 startRideRef.current=startRide;letGoRef.current=letGo;
 useEffect(()=>{
  if(!recording){
   // Back to live: the recording's bus is not a bus anyone chose from the feed, so it is let go
   // rather than left as "no current report".
   if(rideStarted.current){rideStarted.current=null;letGoRef.current()}
   return;
  }
  if(rideStarted.current===recording.id)return;
  // Only from the recording's own publications: the same vehicle may be live on another journey.
  if(!recording.started)return;
  const bus=buses.find(b=>b.key===recording.busKey);
  if(!bus)return;
  rideStarted.current=recording.id;
  startRideRef.current(bus);
 },[recording,buses]);
 // A route found by its number. At a stop it serves, that is a filter of the board; anywhere else
 // it opens the route itself, first direction first, so its stops and buses are seen without an
 // unrelated stop having to be chosen.
 function onSelectRoute(hit:RouteHit){
  const id=`${hit.operator??''}|${hit.line}`;
  if(stop){
   const served=services.find(s=>s.line===hit.line&&(s.operator??'')===(hit.operator??''));
   if(served){chooseService(served.key);scrollTo('.waiting');return}
   selectStop(null);
  }
  pick({route:id,direction:hit.directions[0]?.direction??'all'});
  setDirKey(hit.directions[0]?directionKey(hit.directions[0]):null);
  setPlanOpen(false);setBusOpen(false);setSheet('half');
  setTimeout(()=>scrollTo('.route-browse'),50);
 }
 // The map's centre, after a move the passenger made, is a place to look for stops. Offered as
 // a button; taken up, the nearby list is centred there until they go back to their location.
 const listOrigin=browseAt??(here&&!outsideArea?here:null);
 const farFromList=panCentre&&(!listOrigin||straightLineMetres(panCentre,listOrigin)>300);
 function browseHere(){
  if(!panCentre)return;
  if(stop)selectStop(null);
  setPlanOpen(false);setSheet('half');
  setBrowseAt(panCentre);setPanCentre(null);
  setTimeout(()=>scrollTo('.nearby-list'),50);
 }
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
  setDestinationState(null);setChosenPlan(null);try{sessionStorage.removeItem(DESTINATION_KEY)}catch{}
  setBusOpen(false);setPlanOpen(false);setSheet('half');
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
  // Leaving the ride hands back to the map: on a phone a sheet left full (Try Ride-along opens it
  // there, and the ride is started from its rows) came back over the map the camera had just
  // returned to flat, so Exit landed on a list with no map (the served site, 24 September 2026).
  if(view==='ride'&&next!=='ride')setSheet(s=>s==='full'?'half':s);
  setView(next);
 }
 function showCard(){
  setBusOpen(true);setSheet(sh=>sh==='peek'?'half':sh);
  const card=document.getElementById('lm-bus-card');
  card?.scrollIntoView({block:'nearest',behavior:prefersReducedMotion()?'auto':'smooth'});
  // Focus goes with it, so the next Tab continues from the card, not from the lists above it.
  card?.focus({preventScroll:true});
 }
 // A shared link names the stop, the service and the bus the passenger chose: never where they are.
 async function share(){
  const query=recording?`ride=${recording.id}`
   :journeyQuery({stopId:stop?.id??null,serviceKey,busKey:pin?pin.journeyKnown?busLinkKey(pin.bus):pin.bus.key:null});
  const url=`${window.location.origin}${window.location.pathname}${query?`?${query}`:''}`;
  const title=recording?`Lost Minutes · a recorded ride, ${recording.title}`:stop?`Lost Minutes · ${stopLabel}`
   :pin?`Lost Minutes · ${pin.bus.route} to ${destinationLabel(pin.bus.destination)}`:'Lost Minutes';
  try{
   if(navigator.share){await navigator.share({title,url});setShareState('idle');return}
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
   // Not the same statement as "it does not serve your stop", and it was reading like one. The
   // count of branches stays: it is the fact, and the sentence is what it means.
   :cardStanding==='maybe'?`${assoc.text}. Until its next reports settle which branch it is on, we `
    +`cannot confirm it either way. ${assoc.detail}`
   :`We cannot confirm whether this bus serves ${stopLabel}. ${assoc.text}. ${assoc.detail}`
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
  :mode==='unavailable'||mode==='offline'?'Live positions are not available, so this bus cannot be checked.'
  :selection.last?`It is not in the latest publication. Its last report was at ${clock(selection.last.observedAtMs,true)} `
   +`(${selection.last.ageWords.replace('reported ','')}).`
  :`It is not in the latest publication${selection.pin.bus.observedAtMs?`; the last report this device had from it was at ${clock(selection.pin.bus.observedAtMs,true)}`:''}.`;
 // A journey change leads with the one sentence that matters and the two things the passenger can
 // do about it. Which vehicle, which references and what the drawing is doing are true but are not
 // the decision, so they sit behind Details. Until 22 September 2026 all of it was one paragraph
 // in the card, and most of it again in the strip above and the ride card over the map.
 const journeyWords=selection.kind!=='new_journey'?null
  :`Your bus has finished the ${selection.pin.bus.route} to ${destinationLabel(selection.pin.bus.destination)} `
   +`and is now running the ${selection.bus.route}${selection.bus.direction?` ${directionLabel(selection.bus.direction).toLowerCase()}`:''} `
   +`to ${destinationLabel(selection.bus.destination)}.`;
 // Which of the three actually changed, so the account is of this change and not of changes in
 // general: a relabelling would be one of them, a new journey is the route or the direction.
 const journeyChanges=selection.kind!=='new_journey'?[]:[
  selection.bus.route!==selection.pin.bus.route?'route':null,
  selection.bus.direction!==selection.pin.bus.direction?'direction':null,
  selection.pin.bus.journeyRef&&selection.bus.journeyRef!==selection.pin.bus.journeyRef
   ?'journey reference':null,
  selection.bus.destination!==selection.pin.bus.destination?'destination':null,
 ].filter((value):value is string=>value!==null);
 const journeyDetail=selection.kind!=='new_journey'?null
  :`Vehicle ${selection.bus.vehicle}, chosen as the ${selection.pin.bus.route} to ${destinationLabel(selection.pin.bus.destination)}`
   +`${selection.pin.bus.journeyRef?` (journey ${selection.pin.bus.journeyRef})`:''}, now reports route `
   +`${selection.bus.route}${selection.bus.direction?` ${directionLabel(selection.bus.direction).toLowerCase()}`:''} `
   +`to ${destinationLabel(selection.bus.destination)}${selection.bus.journeyRef?` (journey ${selection.bus.journeyRef})`:''}. `
   +`${journeyChanges.length===1?`Its ${journeyChanges[0]} changed`:`Its ${journeyChanges.slice(0,-1).join(', ')} and ${journeyChanges.at(-1)} changed`}`
   +', which is a new journey and not a relabelled one. It is shown at each report it makes, not '
   +'estimated, and the map has stopped following it.';
 // "Last reported near Moss Park Road" beside "last report nearest Moss Park Road, 2 stops before
 // yours" is the same fact twice, and a passenger reads the repetition as two different claims.
 // The activity line is kept where it says more: that the bus appears to be standing there, or
 // where the progress line names a different stop or is missing altogether.
 const progressText=stop&&prog&&relevant?prog.text:stop&&!relevant?NOT_COMING[cardStanding??'unknown']:null;
 const activityAdds=activityLine!==null&&(activity?.kind==='stopped'||!progressText
  ||!progressText.includes(name(activity?.kind==='near'?activity.stop:'')));
 // A report can be old while the feed is perfectly well: the vehicle stopped reporting, which is
 // what MF74NNL did at 20:44:48 on 22 September 2026 and what the card then showed for six minutes
 // in the same colours as a fresh one. It is its own state now, said in words and marked on the card.
 const quiet=mode==='live'&&shown&&!absent&&shown.freshness!=='fresh'&&shown.ageSeconds!==null
  &&Number.isFinite(shown.ageSeconds)?Math.round(shown.ageSeconds):null;
 const quietWords=quiet===null?null
  :`This bus has not reported for ${elapsedWords(quiet)}. Live positions are arriving normally, so it `
   +'is this vehicle that has gone quiet — it is drawn where it last reported, not moved on.';
 const stripStatus=selection.kind==='absent'?''
  :selection.kind==='new_journey'?`Now on another journey · ${ageChip(selection.bus)}`
  :shown?[progressText,activityAdds?activityLine?.text:null].filter(Boolean).join(' · '):'';
 const inList=!pin||(stop?mapBuses:onRoute).some(bus=>bus.key===pin.bus.key);

 const rideOverlay=shown?<div className="ride-card" data-vehicle={shown.vehicle}>
  <div className="ride-card-head">
   <span className="route-badge">{shown.route}</span>
   <div>{recording&&<small className="ride-card-eyebrow recording" data-ride-recording-label>Recording · {recording.date}</small>}
    {!relevant&&!recording&&<small className="ride-card-eyebrow">Selected bus · {(NOT_COMING[cardStanding??'unknown']||'not coming to your stop').toLowerCase()}</small>}
    <strong>to {destinationLabel(shown.destination)}</strong>{!motionWords&&<small>{ageText(shown)}</small>}</div>
  </div>
  {absent&&<p className="ride-status-line warn">No current report · shown at its last report, not moved on</p>}
  {quiet!==null&&!absent&&<p className="ride-status-line warn" data-quiet={quiet}>No report for {elapsedWords(quiet)} ·
   the feed is live, this bus has gone quiet</p>}
  {pausedJourney&&<div className="ride-journey">
   {/* The short version over the map; the identity and what the drawing is doing are in the card. */}
   <p className="ride-status-line warn">Now on another journey{shown.route?`: ${shown.route} to ${destinationLabel(shown.destination)}`:''}.</p>
   <button className="text-action strong" onClick={continueJourney}>Follow the new journey</button>
  </div>}
  {motionWords&&<p className={`ride-motion ${motionInfo?.mode}`}>{motionWords.label}</p>}
  {/* A repositioning says which continuity was missing: the bus was moved, not followed, and the
      ground in between was not drawn because it is not known. */}
  {motionInfo?.correction?.kind==='snap'&&motionInfo.correction.justNow&&<p className="ride-status-line warn" data-snap
    data-why={motionInfo.correction.why??undefined}>
   Moved {Math.round(motionInfo.correction.metres)} m to its latest report
   {motionInfo.correction.why?` · ${REPOSITION_WORDS[motionInfo.correction.why]}`
    :motionInfo.correction.standing?' · it had stopped':''}</p>}
  {activityAdds&&activityLine&&<p className="ride-status-line">{activityLine.text}</p>}
  {stop&&cardRelation&&prog&&relevant&&<p className={`ride-progress tone-${prog.tone}`}>{prog.text}</p>}
  {stop&&cardRelation&&relevant&&<StopProgress items={schematic(cardRelation,name,stop.id,5)} compact/>}
  {/* The way from the ride to everything the card holds. It leaves the ride first, because on a
      phone the ride is the whole screen and the card is not on it. */}
  <button className="text-action ride-details" onClick={()=>{setView('2d');setTimeout(showCard,0)}}>Details</button>
 </div>:null;

 const row=(item:BoardRow,detail:string)=><button key={item.bus.key} onClick={()=>chooseBus(item.bus)}
   data-bus={item.bus.key}
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
 const panelMode:'home'|'stop'|'bus'|'plan'=planOpen?'plan':busOpen&&identity?'bus':stop?'stop':'home';
 const inStop=!!stop&&(panelMode==='stop'||panelMode==='bus');
 const showStopBlock=panelMode!=='plan';
 // The sheet's one line when it is folded down: what the panel is about, and the next thing to do.
 const handleWords=panelMode==='plan'?'Plan a journey'
  :panelMode==='bus'&&identity?`${identity.route||'Bus'} to ${destinationLabel(identity.destination)}${stripStatus?` · ${stripStatus}`:''}`
  :stop?`${stopLabel}${identity?` · ${identity.route} to ${destinationLabel(identity.destination)}`:board?.coming.length?` · ${board.coming.length} coming`:''}`
  :'Find your stop';
 // The list's own scroll position is the passenger's place in it and survives the sheet moving:
 // showing the map for a moment and coming back must not lose it. (A new task scrolls it itself.)
 const sheetTo=(next:'peek'|'half'|'full')=>{
  setSheet(next);
  // The expanded sheet is measured from the search bar's place on screen, which is only where
  // it should be when the page is at its top.
  if(next==='full'&&window.scrollY>0)window.scrollTo({top:0,behavior:'auto'});
 };
 const dragStart=(e:React.PointerEvent)=>{const el=e.currentTarget.closest('.panel') as HTMLElement|null;if(!el)return;
  sheetDrag.current={y:e.clientY,h:el.getBoundingClientRect().height,moved:false,samples:[{t:e.timeStamp,y:e.clientY}]}};
 const dragMove=(e:React.PointerEvent)=>{const d=sheetDrag.current;if(!d)return;const el=e.currentTarget.closest('.panel') as HTMLElement|null;if(!el)return;
  if(!d.moved){if(Math.abs(e.clientY-d.y)<8)return;d.moved=true;el.style.transition='none';
   try{(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)}catch{}}
  d.samples.push({t:e.timeStamp,y:e.clientY});if(d.samples.length>6)d.samples.shift();
  // The sheet follows the finger between the smallest and the largest height it can rest at:
  // never taller than the expanded state, so what is dragged to is always a state that exists.
  const {full}=readSheetHeights(followRef.current);
  el.style.height=`${Math.min(full,Math.max(SHEET_PEEK,d.h-(e.clientY-d.y)))}px`};
 const dragEnd=(e:React.PointerEvent)=>{const d=sheetDrag.current;sheetDrag.current=null;const el=e.currentTarget.closest('.panel') as HTMLElement|null;if(!d||!el)return;
  if(!d.moved)return;
  const h=el.getBoundingClientRect().height;el.style.height='';el.style.transition='';
  const t=readSheetHeights(followRef.current);
  // Velocity over the last hundred milliseconds or so, in pixels a millisecond: up is negative.
  const s=d.samples,last=s[s.length-1],first=s.find(x=>last.t-x.t<=120)??s[0];
  const vy=last.t>first.t?(last.y-first.y)/(last.t-first.t):0;
  const FLICK=0.35;
  let next:'peek'|'half'|'full';
  if(vy<-FLICK)next=h>t.half+20?'full':'half';                 // thrown upwards: the next state up
  else if(vy>FLICK)next=h<t.half-20?'peek':'half';             // thrown downwards: the next state down
  else next=(['peek','half','full'] as const).reduce((best,k)=>Math.abs(h-t[k])<Math.abs(h-t[best])?k:best,'half');
  sheetTo(next)};
 // What the labelled control does from here: open the panel out, or give the map back.
 const openLabel=panelMode==='bus'?'Open details':panelMode==='plan'?'Open planner':'Open full list';
 // The feed's state is about bus *positions*. Under a board of scheduled departures the word LIVE
 // on its own read as if the departures were live, so the status says what it is about.
 const feedWords=recording?`${recording.ended?'Recording ended':'Recorded ride'} · ${recording.date}`
  :(copy.label==='LIVE'?'Live positions':copy.label==='CHECKING'?'Checking positions'
  :copy.label==='ARCHIVE REPLAY'?'Recorded positions':`Positions ${copy.label.toLowerCase()}`)
  +(publicationAgeSeconds!==null&&!loading?` · ${elapsedWords(publicationAgeSeconds)} ago`:'');
 return <section ref={followRef} className={`follow panel-${panelMode} sheet-${sheet}${stop?' has-stop':''}${riding?' riding':''}${exploringBus?' exploring-bus':''}`}
   data-panel={panelMode} data-sheet={sheet}>
  {/* The way in, always in reach: the feed's state, one search, and the entry to planning. */}
  <div className="follow-top">
  <div className={`follow-bar ${copy.tone}`} role="status">
   <span className="follow-badge">{mode==='offline'?<WifiOff size={13}/>:<Radio size={13}/>}{copy.label}</span>
   <span className="follow-bar-when">
    {recording?`${recording.date}, ${recording.when} · not live`
     :mode==='archive'?archiveDate
     :loading?'waiting for the first positions'
     :publicationAgeSeconds===null?'not published yet'
     :`positions updated ${ageBasis==='device'?'about ':''}${elapsedWords(publicationAgeSeconds)} ago`}</span>
   {mode!=='archive'&&collector?.kind==='bounded_development'&&<span className="follow-bar-run"
     title="Collected by a time-limited run on one machine, not an always-on service">
    local run{collector.endsBy&&collector.status==='running'?` · until ${clock(Date.parse(collector.endsBy))}`:''}</span>}
   <button className="follow-refresh" onClick={onRefresh} disabled={refreshing}
    aria-label="Check for newer positions"><RefreshCw size={15} className={refreshing?'spin':''}/></button>
  </div>
  {stops.length>0&&mode!=='archive'&&<div className="follow-search">
   <StopSearch stops={stops} patterns={patterns} day={day} onSelect={selectStop} onSelectRoute={onSelectRoute} compact
    placeholder="Bus number, stop or area"
    onFocusField={()=>{if(sheet!=='peek')sheetBeforeSearch.current=sheet;sheetTo('peek')}}
    onLeaveField={chose=>{const before=sheetBeforeSearch.current;sheetBeforeSearch.current=null;
     if(!chose&&before&&before!=='peek')sheetTo(before)}}/>
   <button className={`plan-entry${panelMode==='plan'?' on':''}`} aria-pressed={panelMode==='plan'} data-plan-entry
    aria-label={panelMode==='plan'?'Close the journey planner':'Plan a journey'}
    onClick={()=>{if(panelMode==='plan'){setPlanOpen(false)}else{setPlanOpen(true);sheetTo('full')}}}>
    <Route size={15} aria-hidden="true"/><span className="plan-entry-words">{panelMode==='plan'?'Close planner':'Plan a journey'}</span>
    <span className="plan-entry-short" aria-hidden="true">{panelMode==='plan'?'Close':'Plan'}</span></button>
  </div>}
  </div>

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
   : <CityMap paused={paused} buses={mapBuses} fleet={buses} emphasis={mapEmphasis} onDrawn={onDrawn} mirror={above?aboveFocus:null} selected={shown} selectionKind={selectionKind} stop={stop} here={here} follow={follow&&!pausedJourney}
      onSelect={selectFromMap} onManualMove={stopFollowing} onUnavailable={showMapFallback}
      stops={stops} onSelectStop={id=>{const s=stopById.get(id);if(s)selectStop(s)}}
      onWantMap={()=>{const handle=document.querySelector('.follow > .panel .sheet-handle');
       if(handle&&handle.getBoundingClientRect().height>0)sheetTo('peek')}}
      onPanned={setPanCentre} findHere={farFromList?browseHere:null}
      device={origin?.kind==='chosen'?device:null} originEpoch={originEpoch}
      destination={destination?{lat:destination.lat,lon:destination.lon,label:destination.label}:null}
      view={effectiveView} onViewChange={changeView} theme={theme} onThemeChange={saveTheme}
      fitRequest={fitRequest} onLocate={guideLocates?undefined:onLocate} locating={locating} rideOverlay={rideOverlay}
      originKind={origin?.kind??'device'} pickingOrigin={pickingOrigin}
      onPickOrigin={onChooseOrigin?point=>onChooseOrigin(point,'a point on the map'):undefined}
      busLabel={absent?'Your bus · no report':busNoun}
      walk={walkRoute&&here&&stop?{path:walkRoute.path,from:here,to:{lat:stop.lat,lon:stop.lon}}:null}
      clockOffsetMs={clockOffsetMs} motion={motion} onMotion={reportMotion} onRideState={setRideState}
      stopsAhead={stopsAhead} onSimpleMap={chooseSimpleMap}/>}

  <div className="panel" data-panel={panelMode}>
   {/* On a phone the panel is a sheet: a handle that drags, and a button that does the same. */}
   <div className="sheet-handle" onPointerDown={dragStart} onPointerMove={dragMove} onPointerUp={dragEnd} onPointerCancel={dragEnd}>
    <div className="sheet-row">
     <div className="sheet-title">
      <span className="sheet-words">{handleWords}</span>
      <span className={`sheet-status ${copy.tone}`} data-feed-status>{feedWords}</span>
     </div>
     {mode!=='archive'&&<button className="sheet-refresh" onClick={onRefresh} disabled={refreshing}
      aria-label="Check for newer positions"><RefreshCw size={16} className={refreshing?'spin':''}/></button>}
     {/* One labelled control that does what the drag does: out to the full panel, or the map back. */}
     <button type="button" className="sheet-toggle" aria-expanded={sheet==='full'} data-sheet-toggle
      onClick={()=>sheetTo(sheet==='full'?'half':'full')}>
      {sheet==='full'?<ChevronDown size={16} aria-hidden="true"/>:<ChevronUp size={16} aria-hidden="true"/>}
      <span>{sheet==='full'?'Show map':openLabel}</span>
     </button>
    </div>
   </div>
   {(panelMode==='bus'||panelMode==='plan')&&<div className="panel-head">
    <button className="panel-back" onClick={()=>{if(panelMode==='plan')setPlanOpen(false);else setBusOpen(false)}} data-panel-back>
     <ArrowLeft size={16} aria-hidden="true"/>{panelMode==='plan'?(stop?`Back to ${stop.name}`:'Back'):stop?'Back to the board':'Back'}</button>
    {stop&&<button className="text-action" onClick={newJourney} aria-label="New journey: clear the stop, filter and chosen bus" data-new-journey>
     <RotateCcw size={14} aria-hidden="true"/> New journey</button>}
   </div>}
   <div className="panel-body" ref={panelBody}>
  {/* Where am I, where is my stop, and how do I walk there? The stop's name has the whole width;
      its actions sit on their own row beneath it. */}
  {showStopBlock&&(stop
   ? <div className="your-stop">
      <div className="your-stop-row">
       <span className="your-stop-mark"><MapPin size={18}/></span>
       <span className="your-stop-copy">
        <small className="your-stop-eyebrow">Your stop</small>
        <strong>{stopLabel}</strong>
        {/* Where its buses go first: "to Piccadilly Gardens (15, 255, 256)" is how a passenger knows
            this is the side of the road they want; the compass word and the street follow. */}
        <small data-stop-towards>{[towardsWords(servicesAt(patterns,stop.id,day)),bearingWords(stop.bearing),stop.street].filter(Boolean).join(' · ')||'No side-of-road detail supplied'}</small>
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
       <button onClick={()=>selectStop(null)}>Change stop</button>
       <button onClick={newJourney} aria-label="New journey: clear the stop, filter and chosen bus" data-new-journey>
        <RotateCcw size={15}/><span>New journey</span></button>
      </div>
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
       locationError={locationError} onClearHere={onClearHere} areaLabel="Manchester"
       browseAt={browseAt} onStopBrowsing={()=>{setBrowseAt(null);if(!here)onLocate?.()}}
       onTryRide={!recording&&(mode==='live'||recordings.length>0)?()=>{
        // The section is further down the panel; on a phone that is under the fold of the half
        // sheet, so the sheet opens and the section comes into view with its first row focused.
        sheetTo('full');
        setTimeout(()=>{scrollTo('.try-ride');
         document.querySelector<HTMLElement>('.try-ride button')?.focus({preventScroll:true})},60);
       }:undefined}/>
     </div>)}
  {blocked&&<p className="follow-hint warn">This device would not let us save that. It still works for this visit.</p>}
  {shareState==='copied'&&<p className="follow-hint" data-share-copied>{recording
   ?'Link copied. It opens this recording, and says it is one.'
   :stop?`Link copied. It names this stop${pin?' and the bus you chose':''}, never your location.`
   :'Link copied. It names this bus and its journey, never your location; once the journey has ended, the link says so.'}</p>}
  {shareState==='failed'&&<p className="follow-hint warn">This browser would not share or copy the link.</p>}
  {restoreNotes.length>0&&<div className="restore-notice" role="status">
   {restoreNotes.map(note=><p key={note}>{note}</p>)}
  </div>}
  {recording&&<div className="recording-note" role="status" data-recording={recording.ended?'ended':recording.started?'playing':'starting'}>
   <p><strong>{recording.ended?'The recording has ended.':'A recording, not live.'}</strong>{' '}
    {recording.title}, {recording.date} at {recording.when}, replayed at the pace it was published. The ages shown are the recording’s.</p>
   <div className="selection-actions">
    <button className="text-action strong" onClick={recording.onLeave} data-leave-recording>Back to live buses</button>
    {recording.ended&&<button className="text-action" onClick={recording.onReplay} data-replay-recording>Play it again</button>}
   </div>
  </div>}



  {/* The stop first: what leaves from here, then the buses coming to it with how far each has got
      and how old its report is, then everything else listed apart with what it is. The card for
      the chosen bus follows, so the alternatives are never below a long card. */}
  {/* "When is the next bus?" is a question about the timetable, so it is answered from the
      timetable, and it leads: the service chips below it are a filter and the tracked buses under
      those are a different capability, neither of which is the question. They are never mixed:
      no row here borrows a time from a bus, and no bus below is given a departure time it did
      not report. */}
  {inStop&&stop&&mode!=='archive'&&<DepartureBoard stop={stop} buses={buses} nowMs={nowMs}
    filterLine={activeService?.line??null} onChooseBus={chooseBus}
    trackedWords={bus=>{const item=board?[...board.coming,...board.maybe].find(i=>i.bus.key===bus.key):undefined;return item?standingWords(item):null}}/>}
  {inStop&&services.length>0&&<section className="services" aria-label="Services from your stop">
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
       :service.reporting?`${service.reporting} tracked ${service.reporting===1?'bus':'buses'} coming or here`:'no tracked bus coming yet'}</small></span>
    </button>)}</div>
  </section>}
  {inStop&&stop&&board&&<section className="waiting" aria-label="Buses coming to your stop">
   <h3 className="section-head">{activeService?`${activeService.line} to ${activeService.destination}`:'Coming to your stop'}
    <small>by the timetable’s stop order</small></h3>
   {/* "When?", answered with what is true here: a tracked bus is placed by its last report, in
       stops and an age, never in minutes; arrival minutes come only from an evaluation that has
       passed its criteria (none has); the operator's own live board is one tap away. */}
   <p className="board-when" data-board-when>
    <span><strong>Tracked buses</strong> are shown by their last report — stops away and its age, not minutes
     {arrivalRelease?.released?.length?'; arrival minutes where our estimate has passed its criteria':' (no arrival minutes here yet)'}.
     The timetabled departures are above.</span>
   </p>
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
    : board.coming.map(item=>row(item,`tracked · ${standingWords(item)}`))}
   {!emptyTitle&&hidden>0&&<button className="text-action filter-more" onClick={()=>setServiceChoice(null)} data-clear-filter>
    Show all services · {hidden} more coming or possibly coming on other services</button>}
  </section>}
  {inStop&&board&&board.maybe.length>0&&<section className="maybe-coming" aria-label="Buses that may call at your stop">
   <h3 className="section-head">May call at your stop<small>branch not settled</small></h3>
   {board.maybe.map(item=>row(item,standingWords(item)))}
  </section>}
  {inStop&&board&&board.nearby.length>0&&<section className="nearby-reports" aria-label="Last reported nearby">
   <h3 className="section-head">Last reported nearby<small>within 150 m, not coming to your stop</small></h3>
   {board.nearby.map(item=>row(item,`${Math.round(item.metres/10)*10} m away · ${standingWords(item)}`))}
  </section>}
  {inStop&&board&&more>0&&<details className="exploring">
   <summary>More buses near your stop ({more})</summary>
   {board.passed.length>0&&<div className="board-group"><h4>Already past your stop</h4>
    {board.passed.map(item=>row(item,standingWords(item)))}</div>}
   {board.elsewhere.length>0&&<div className="board-group"><h4>Not for your stop</h4>
    {board.elsewhere.map(item=>row(item,`${(item.metres/1000).toFixed(1)} km away · ${standingWords(item)}`))}</div>}
   {board.old.length>0&&<div className="board-group"><h4>Old reports</h4>
    {board.old.map(item=>row(item,`${standingWords(item)} · an old report`))}</div>}
  </details>}

  {/* Getting to the stop comes after what leaves from it: the walk, on request, with the hand-off. */}
  {inStop&&stop&&mode!=='archive'&&<section className="getting-there" aria-label="Getting to your stop">
   <WalkGuide state={walk} config={walking} here={here} origin={origin} nowMs={nowMs} stop={stop} consent={consent}
    onConsent={setConsent} onRetry={()=>setWalkAttempt(n=>n+1)} onLocate={onLocate} locating={locating}
    locationError={locationError} pickingOrigin={pickingOrigin} onStartPicking={onStartPicking}
    onCancelPicking={onCancelPicking}/>
  </section>}

  {/* Which bus, is it coming here, how far has it got, how old is that? */}
  {identity&&(panelMode==='bus'||inStop||panelMode==='home')&&<article id="lm-bus-card" className={`bus-card${absent?' gone':''}${relevant?'':' explored'}${selectionKind==='suggested'?' suggested':''}${quiet===null?'':' quiet'}`}
    aria-label={absent?'Your bus, no current report':busNoun} tabIndex={-1}
    data-vehicle={identity.vehicle} data-selection={selectionKind??'none'}>
   {/* One summary, not two. Until 22 September 2026 a sticky strip above carried the route, the
       destination and the status, and this head carried them again a few lines below: the same
       three facts twice, which reads as two different claims about one bus. The strip's job —
       keeping the chosen bus in view while the board is browsed — is this head's now, because it
       sticks. `active-bus` stays the name of that summary, wherever it lives. */}
   <div className={`active-bus bus-card-summary ${selectionKind??'none'}`} data-vehicle={identity.vehicle}
     role="status" aria-label="The bus shown on the map">
    <p className="bus-card-eyebrow">{absent?'Your bus'
     :selection.kind==='new_journey'?'Your bus · another journey':busNoun}</p>
    <header className="bus-card-head">
     <span className="route-badge">{identity.route||'?'}</span>
     <div className="bus-card-title">
      {/* A link that named only a vehicle, never seen since: its route and destination are unknown. */}
      <strong>{identity.route?`to ${destinationLabel(identity.destination)}`:`Vehicle ${identity.vehicle}`}</strong>
      <small>{[directionLabel(identity.direction),identity.operator].filter(Boolean).join(' · ')}</small>
     </div>
     {shown&&!absent?<span className={`age-chip ${mode==='archive'?'archive':shown.freshness??'unknown'}`}>{ageChip(shown)}</span>
      :<span className="age-chip stale">No current report</span>}
    </header>
    {(stripStatus||!inList)&&<p className="active-bus-copy"><small>{stripStatus}{!inList?' · not in the list below':''}</small></p>}
   </div>
   {selectionKind==='suggested'&&<p className="bus-card-suggestion">Shown because it is {stop?'coming to your stop':'the latest report on this route'}.
    It stays shown while it is; following it or riding along keeps it chosen.</p>}
   {/* A bus with no current report is a short, actionable status: when it was last seen, the way
       out, and the rest behind Details. The chip above already says "no current report", so this
       does not say it again; until 23 September 2026 the card said it four times. */}
   {absentWords&&<div className="selection-note absent" role="status">
    <p><strong>{mode==='unavailable'||mode==='offline'?'Live positions are not available'
     :selection.kind==='absent'&&selection.last?`Last seen ${clock(selection.last.observedAtMs,true)}`
     :selection.kind==='absent'&&selection.pin.bus.observedAtMs?`Last seen ${clock(selection.pin.bus.observedAtMs,true)}`
     :'Not in the latest positions'}</strong>
     {' '}· drawn where it last reported, not moved on. Nothing else has been chosen in its place.</p>
    <div className="selection-actions">
     <button className="text-action strong" onClick={letGo}>Stop following</button>
    </div>
    <details className="selection-detail"><summary>Details</summary>
     <p>{absentWords}</p>
     {alternatives.length>0&&<div className="selection-actions">
      {alternatives.map(bus=><button key={bus.key} className="text-action" onClick={()=>chooseBus(bus)}>
       Follow {bus.route} to {destinationLabel(bus.destination)} instead</button>)}
     </div>}
    </details>
   </div>}
   {journeyWords&&<div className="selection-note journey" role="status">
    <p><strong>This bus has started another journey.</strong> {journeyWords}</p>
    <div className="selection-actions">
     <button className="text-action strong" onClick={continueJourney}>Follow the new journey</button>
     <button className="text-action" onClick={letGo}>{stop?'Back to buses for my stop':'Stop following it'}</button>
    </div>
    {journeyDetail&&<details className="selection-detail"><summary>Details</summary>
     <p>{journeyDetail}</p>
     {alternatives.length>0&&<div className="selection-actions">
      {alternatives.map(bus=><button key={bus.key} className="text-action" onClick={()=>chooseBus(bus)}>
       Follow {bus.route} to {destinationLabel(bus.destination)} instead</button>)}
     </div>}
    </details>}
   </div>}
   {quietWords&&<p className="bus-card-quiet" role="status" data-quiet={quiet}>
    <strong>No report for {elapsedWords(quiet ?? 0)}</strong><span>{quietWords}</span></p>}
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
    {/* The label is the claim, and stays in view; how it is drawn — and why it is not estimated — is
        one tap away (26 September 2026: the explanation ran to five sentences under every bus). A
        repositioning is said in view as well. */}
    <details><summary><strong>{motionWords.label}</strong>
     <span>{motionInfo?.mode==='estimated'?'How the estimate is made':'How it is drawn'}</span></summary>
     <p>{motionWords.detail}</p></details>
    {motionWords.said&&<p className="bus-card-moved" data-moved>{motionWords.said}</p>}
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
    : <p className="bus-card-hint"><strong>{mode==='archive'?'A recorded position.':recording?'A bus in a recording.':'No stop chosen.'}</strong>
      {' '}{recording?'It is ridden for what the ride is; it is not coming to any stop of yours.'
      :'Choose your stop to see whether this bus calls there and how far it has got.'}</p>)}
   {shown&&!absent&&relevant&&<StopProgress items={items}/>}
   {shown&&!absent&&relevant&&<ul className="distance-lines">{distanceLines({here,stop,bus:shown,relation:cardRelation,
     walk:walkRoute?{metres:walkRoute.metres,seconds:walkRoute.seconds,provider:walkRoute.provider}:null}).map(line=>
    <li key={line.label}><span>{line.label}</span><strong>{line.value}</strong><small>{line.basis}</small></li>)}</ul>}
   {shown&&!absent&&(riding||!pausedJourney)&&<div className="bus-card-actions">
    {riding
     ? <div className="ride-status" data-state={rideState}>
        {/* The card says what the map's camera is doing, so the two agree; the ride's own controls
            — Exit, Return to bus, the viewpoint — are on the map beside it, once. A second Exit
            here was the same action twice on a computer, and nothing on a phone, where the ride
            is the whole screen and this card is not on it. */}
        <span className="ride-status-words">Riding along · {rideState==='exploring'
         ?'you moved the map; return to the bus on the map':RIDE_WORDS[rideState]||'starting'}</span>
       </div>
     : <button className={`follow-toggle ${follow?'on':''}`} onClick={toggleFollow}
        aria-pressed={follow} aria-label={follow?'Stop following this bus':'Keep this bus centred'}>
        <Crosshair size={16}/><span>{follow?'Following on the map':selectionKind==='suggested'?'Follow this bus':'Follow on the map'}</span></button>}
    {pinned&&!riding&&<button className="text-action" onClick={letGo}>Choose another bus</button>}
    {!stop&&pinned&&<button className="text-action" onClick={share} aria-label={recording?'Share this recording':'Share this bus'} data-share-bus>
     <Share2 size={14} aria-hidden="true"/> Share</button>}
   </div>}
   {absent&&riding&&<div className="bus-card-actions"><div className="ride-status" data-state={rideState}>
    <span className="ride-status-words">Riding along · waiting for a new report from this bus</span></div></div>}
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

  {/* Planning: a start (this device or a fixed place, which is the same origin the walk uses), a
      destination, and the direct buses the timetable supports between them. */}
  {stops.length>0&&mode!=='archive'&&(panelMode==='plan'||((inStop||panelMode==='home')&&(chosenPlan||destination)))
   &&<PlanPanel stops={stops} patterns={patterns} day={day} buses={buses}
    from={origin?origin.kind==='device'?{kind:'device',lat:origin.lat,lon:origin.lon,accuracyMetres:origin.accuracyMetres}:{kind:'chosen',lat:origin.lat,lon:origin.lon,label:origin.label}:null}
    to={destination} device={device} onUseDevice={()=>onLocate?.()} onChooseFrom={chooseFromPlace} onSetTo={setDestination}
    onChoose={choosePlan} onShowOnMap={()=>{setFitRequest(n=>n+1);document.querySelector('.vector-map')?.scrollIntoView({block:'start',behavior:'smooth'})}}
    link={planLink} chosenKey={chosenPlan} compact={panelMode!=='plan'}/>}
  {panelMode==='home'&&(buses.length>0||choice)&&<section className="route-browse" aria-label="Follow a route">
   <h3 className="section-head">{choice?`Route ${routeNumber(route)}`:'Or follow a route'}<small>{choice?'directions, stops and buses':'without choosing a stop'}</small>
    {choice&&<button className="text-action filter-clear" onClick={()=>{setChoice(null);setDirKey(null)}} data-clear-route>Clear route</button>}</h3>
   {(()=>{
    // The route as the timetable knows it: its directions, and the stops of the chosen one, each a
    // stop to choose. Shown whether or not a bus on it is reporting this minute.
    const hit=choice?routes.find(r=>r.id===route):undefined;
    if(!hit)return null;
    const dir=hit.directions.find(d=>directionKey(d)===dirKey)??(direction==='all'?null:hit.directions.find(d=>(d.direction??'all')===direction)??null);
    const pattern=dir?longestPattern(dir):null;
    const stopsOnRoute=pattern?pattern.stops.map(id=>stopById.get(id)).filter((s):s is Stop=>s!==undefined):[];
    return <div className="route-panel" data-route={route}>
     <div className="route-directions" role="group" aria-label="Direction">
      {hit.directions.map(d=><button key={`${d.direction}|${d.destination}`} className={`stop-chip route${dir===d?' on':''}`}
        aria-pressed={dir===d} onClick={()=>{setDirKey(directionKey(d));pick({route,direction:d.direction??'all'})}}>
       <span>to {d.destination??'?'}</span><small>{directionLabel(d.direction??'')||'direction not given'}</small></button>)}
     </div>
     {pattern
      ? <details className="route-stops" open>
         <summary>Stops on this route towards {dir?.destination??'?'} <small>({stopsOnRoute.length}{pattern.stops.length>stopsOnRoute.length?` of ${pattern.stops.length} in the area`:''})</small></summary>
         <ol>{stopsOnRoute.map(s=><li key={s.id}><button className="route-stop" onClick={()=>selectStop(s)}>
          <strong>{s.name}</strong><small>{[s.indicator,s.street].filter(Boolean).join(' · ')}</small></button></li>)}</ol>
        </details>
      : <p className="follow-hint">Choose a direction to see its stops.</p>}
     <p className="follow-hint" data-route-buses={onRoute.length}>{onRoute.length
      ? `${onRoute.length} ${onRoute.length===1?'bus':'buses'} on this route ${onRoute.length===1?'is':'are'} reporting now, listed below.`
      : 'No bus on this route is reporting right now. The stops above are from its timetable; choose one to see what is coming.'}</p>
    </div>;
   })()}
   <div className="follow-pickers">
    <label className="sr-only" htmlFor="follow-route">Route</label>
    <div className="picker route"><span>Route</span>
     <select id="follow-route" value={route} onChange={e=>pick({route:e.target.value,direction:'all'})}>
      {routeChoices.map(id=><option key={id} value={id}>{routeNumber(id)}</option>)}
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
  {/* The app's other purpose, after the everyday one: exploring Manchester by riding along with a
      bus, from the latest publication's own eligibility, and a dated recording when nothing live
      suits. Choosing starts the ride. */}
  {panelMode==='home'&&!recording&&(mode==='live'||recordings.length>0)&&<TryRide buses={mode==='live'?buses:[]}
    live={mode==='live'} recordings={recordings} onRide={startRide} onWatch={ride=>onWatchRecording?.(ride)} error={recordingError}
    above={photo3d?()=>{setBusOpen(true);setAboveStart(stop?{lat:stop.lat,lon:stop.lon}:shown?{lat:shown.lat,lon:shown.lon}:{lat:53.4794,lon:-2.2453});setAbove(true)}:undefined}/>}
  {above&&photo3d&&aboveStart&&<GodsEye photo3d={photo3d} frame={drawnFrame} selectedKey={shown?.key??null} start={aboveStart}
    onSelect={selectFromMap} onLeave={()=>setAbove(false)} onFocus={setAboveFocus}/>}

  {panelMode!=='plan'&&<p className="follow-notes panel-notes">{mode==='archive'
   ?'A recording: times are when each bus reported on the day, not how long ago. '
   :recording?`A recorded ride from ${recording.date}, replayed at the pace it was published; nothing between its reports was recorded. `
   :`Positions older than ${expiryMinutes} minutes are withheld. `}
   Progress is counted in timetabled stops from each bus’s last report. Where the operator’s timetable names the journey, its scheduled time at your stop is shown as the timetable’s; no arrival time is predicted.
   {' '}<button className="text-action" onClick={onOpenEvidence}>How this works</button></p>}
   </div>
  </div>

 </section>;
}
