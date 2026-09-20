"use client";

import {useCallback,useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import {ArrowLeft,Clock3,Crosshair,LocateFixed,MapPin,Radio,RefreshCw,Share2,Star,WifiOff,X} from 'lucide-react';
import FollowMap from '@/components/follow-map';
import CityMap,{RIDE_WORDS,type Here,type MapView,type RideState,type SelectionKind} from '@/components/city-map';
import Nearby from '@/components/nearby';
import StopProgress from '@/components/stop-progress';
import BusEvidence from '@/components/bus-evidence';
import WalkGuide from '@/components/walk-guide';
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
import {describeMotion,motionPreferenceServerSnapshot,motionPreferenceSnapshot,saveMotionPreference,
        subscribeMotionPreference,type MotionInfo} from '@/lib/motion-view';
import {journeyQuery,restoreService,writeJourney,type InitialJourney} from '@/lib/journey-context';
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
                                    clockOffsetMs=0,initialJourney}:{
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
 // The page's suggestion while nothing is pinned, kept while it stays a candidate.
 const [suggested,setSuggested]=useState<string|null>(null);
 const [shareState,setShareState]=useState<'idle'|'copied'|'failed'>('idle');
 const [follow,setFollow]=useState(false);
 const [view,setView]=useState<MapView>('2d');
 const [fitRequest,setFitRequest]=useState(0);
 const [walkAttempt,setWalkAttempt]=useState(0);
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
 const serviceRestore=serviceChoice===undefined&&patterns&&initialJourney?.serviceKey&&stop?.id===initialJourney.stopId
  ?restoreService(initialJourney.serviceKey,services):{kind:'none' as const,key:null};
 const serviceKey=serviceChoice!==undefined?serviceChoice:serviceRestore.kind==='chosen'?serviceRestore.key:null;
 const activeService=services.find(s=>s.key===serviceKey)??null;
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
  if(mode==='archive'||!initialJourney)return null;
  if(initialJourney.bus)return {bus:initialJourney.bus,via:initialJourney.source==='link'?'link':'device',journeyKnown:true};
  return initialJourney.busKey?pinFromKey(initialJourney.busKey,'link'):null;
 },[mode,initialJourney]);
 const pin=pinChoice!==undefined?pinChoice:restoredPin;
 // Until the first publication is in, nothing is known about any bus: a pin is neither found nor
 // missing yet, and nothing is suggested in its place.
 const loading=live===null&&mode!=='archive'&&mode!=='offline';
 const selection:Selection=loading?{kind:'none'}:resolveSelection(pin,buses,recall??null);
 // A link that named only a vehicle learns its journey when the vehicle is first seen, so a later
 // change of journey is noticed.
 if(selection.kind==='active'&&!selection.pin.journeyKnown)setPinChoice(adoptJourney(selection.pin,selection.bus));
 // The suggestion: the first bus coming to your stop, or the latest report on the route, kept
 // while it stays one of them. Only a bus timetabled to call and not yet past is suggested.
 const candidates=useMemo(()=>stop?(board?.coming.map(row=>row.bus)??[]):onRoute,[stop,board,onRoute]);
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
 if(serviceRestore.kind==='gone'&&initialJourney?.serviceKey){
  const [,line,,destination]=initialJourney.serviceKey.split('|');
  restoreNotes.push(`${line} to ${destination} is not in today’s timetable for this stop, so every service is listed.`);
 }
 if(initialJourney?.stopId&&!stop&&stops.length>0&&!stops.some(s=>s.id===initialJourney.stopId))
  restoreNotes.push('The stop you had chosen is not in the current stop list. Search for your stop.');

 // The journey as it stands, kept on this device and in the address bar (replaced, never pushed).
 // A pin that has gone missing or changed journey is kept as it was chosen, so a reload asks the
 // same question. Nothing is written until the page has read what was there, and never from a
 // recording.
 useEffect(()=>{
  if(initialJourney===undefined||mode==='archive')return;
  const bus=pin&&pin.journeyKnown?pin.bus:null;
  // A restored service the passenger has not changed is kept, even on a day it does not run.
  const service=serviceChoice!==undefined?serviceChoice
   :initialJourney&&stop?.id===initialJourney.stopId?initialJourney.serviceKey:null;
  let storage:Storage|null=null;
  try{storage=window.localStorage}catch{/* a refused store still works for this visit */}
  writeJourney(storage,{stopId:stop?.id??null,serviceKey:service,bus});
  const query=journeyQuery({stopId:stop?.id??null,serviceKey:service,busKey:pin?.bus.key??null});
  const next=`${window.location.pathname}${query?`?${query}`:''}${window.location.hash}`;
  if(next!==`${window.location.pathname}${window.location.search}${window.location.hash}`)
   window.history.replaceState(window.history.state,'',next);
 },[initialJourney,mode,pin,serviceChoice,stop]);

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
 function selectStop(next:Stop|null){onSelectStop(next);setServiceChoice(null);setView('2d');setFitRequest(n=>n+1)}
 function letGo(){setPinChoice(null);setFollow(false);setView('2d');setFitRequest(n=>n+1)}
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
  const query=journeyQuery({stopId:stop?.id??null,serviceKey,busKey:pin?.bus.key??null});
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
 const timetabled=(()=>{
  if(!shown||!stop||!shown.match||!('patternId' in shown.match))return null;
  const pattern=patternsById.get(shown.match.patternId);
  if(!pattern)return null;
  const stopIndex=pattern.stops.indexOf(stop.id);
  if(stopIndex<0)return null;
  return scheduledAtStop({scheduled:shown.match.scheduled,seconds:pattern.seconds,busIndex:shown.match.patternIndex,stopIndex});
 })();
 const prog=cardRelation?progress(cardRelation,name):null;
 const items=cardRelation&&stop&&relevant?schematic(cardRelation,name,stop.id):[];
 const walked=walkRoute?walkWords(walkRoute):null;
 const notServing=stop&&shown&&assoc&&!relevant
  ?cardStanding==='not_for_stop'?`It does not serve ${stopLabel}. ${assoc.detail}`
   :cardStanding==='passed'?`In the timetable’s stop order its last report is already past ${stopLabel}.`
   :`${assoc.text}. ${assoc.detail}`
  :null;

 // What its own reports say about it and a stop: never the estimate, never the drawn bus.
 const matchedPattern=(bus:FollowBus)=>{
  const match=bus.match as {patternId?:string}|undefined;
  return match?.patternId?patternsById.get(match.patternId):undefined;
 };
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
  {activityAdds&&activityLine&&<p className="ride-status-line">{activityLine.text}</p>}
  {stop&&cardRelation&&prog&&<p className={`ride-progress tone-${relevant?prog.tone:'bad'}`}>
   {relevant?prog.text:NOT_COMING[cardStanding??'unknown']}</p>}
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
 // One message when nothing is coming, with what can be done next, instead of the same news three times.
 const emptyTitle=!board||board.coming.length>0?null
  :loading?'Checking for live positions: the buses coming to this stop appear here once they arrive.'
  :services.length===0?'No timetable coverage for this stop yet, so no bus can be confirmed as coming here.'
  :board.old.some(item=>item.standing==='coming')?'The buses on services calling here have only old reports.'
  :'No bus on a service calling here has a current report. Nothing is guessed to fill the gap.';

 return <section className={`follow${stop?' has-stop':''}${riding?' riding':''}`}>
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
       <button className={savedStopIds.includes(stop.id)?'on':''} aria-pressed={savedStopIds.includes(stop.id)}
        aria-label={savedStopIds.includes(stop.id)?'Saved on this device':'Save this stop'}
        onClick={()=>setBlocked(!saveStops(toggleSavedStop(savedStopIds,stop.id)))}>
        <Star size={15} fill={savedStopIds.includes(stop.id)?'currentColor':'none'}/>
        <span>{savedStopIds.includes(stop.id)?'Saved':'Save'}</span></button>
       <button onClick={share} aria-label="Share this stop"><Share2 size={15}/><span>Share</span></button>
       <button onClick={()=>selectStop(null)}>Change</button>
      </div>
      {mode!=='archive'&&<WalkGuide state={walk} config={walking} here={here} origin={origin} nowMs={nowMs} stop={stop} consent={consent}
       onConsent={setConsent} onRetry={()=>setWalkAttempt(n=>n+1)} onLocate={onLocate} locating={locating}
       locationError={locationError} pickingOrigin={pickingOrigin} onStartPicking={onStartPicking}
       onCancelPicking={onCancelPicking}/>}
     </div>
   : <div className="your-stop unset">
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
   <h3 className="section-head">Services from this stop<small>timetabled · tap to filter</small></h3>
   <div className="service-chips">{services.map(service=>
    <button key={service.key} aria-pressed={activeService?.key===service.key}
     className={`service-chip${activeService?.key===service.key?' on':''}${service.runsToday===false?' not-today':''}`}
     onClick={()=>chooseService(service.key)}>
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
       {(board.maybe.length>0||board.nearby.length>0||more>0)&&<span>{[
        board.maybe.length?`${board.maybe.length} may call here (branch not settled)`:'',
        board.nearby.length?`${board.nearby.length} reported nearby, not coming here`:'',
        more?`${more} more near your stop`:''].filter(Boolean).join(' · ')}</span>}
       <div className="empty-actions">
        {board.maybe.length>0&&<button className="text-action" onClick={()=>scrollTo('.maybe-coming')}>
         See the {board.maybe.length===1?'one':board.maybe.length} that may call</button>}
        {board.nearby.length>0&&<button className="text-action" onClick={()=>scrollTo('.nearby-reports')}>
         Buses reported nearby</button>}
        {more>0&&<button className="text-action" onClick={()=>scrollTo('.exploring',true)}>More near your stop</button>}
        <button className="text-action" onClick={()=>selectStop(null)}>Choose another stop</button>
       </div>
      </div>
    : board.coming.map(item=>row(item,standingWords(item)))}
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
   {shown&&!absent&&stop&&prog&&<div className={`bus-card-answer tone-${relevant?prog.tone:'bad'}`}>
    <strong>{relevant?prog.text:NOT_COMING[cardStanding??'unknown']}</strong>
    {relevant&&prog.detail&&<span>{prog.detail}</span>}</div>}
   {/* The operator's timetable, read out: the named journey's departure plus the scheduled running
       time to this stop. Shown only for a bus still before the stop on one named journey, and
       labelled as the timetable's, because a time at a stop reads as a prediction and is not one. */}
   {shown&&!absent&&stop&&relevant&&timetabled?.kind==='time'&&<p className="bus-card-scheduled" data-scheduled={timetabled.wall}>
    <strong>Timetabled at your stop {timetabled.wall}</strong>
    <span>from the operator’s timetable · not a prediction, and not adjusted for where the bus is</span></p>}
   {activityLine&&<details className="bus-card-activity"><summary><strong>{activityLine.text}</strong>
    <span>How this is known</span></summary><p>{activityLine.detail}</p></details>}
   {notServing&&!absent&&<div className="bus-card-explored" role="note">
    <p>{notServing}</p>
    <button className="back-to-stop" onClick={letGo}><ArrowLeft size={15}/>Back to buses for your stop
     {board&&board.coming.length?` (${board.coming.length} coming)`:''}</button>
   </div>}
   {motionWords&&<div className={`bus-card-motion ${motionInfo?.mode}`}>
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
   {stop&&walked&&<p className="bus-card-walk"><strong>You: {walked.time} walk</strong>
    <span>{walked.distance} to {stopLabel}</span></p>}
   {shown&&!absent&&(stop&&assoc
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
   {shown&&!absent&&<StopProgress items={items}/>}
   {shown&&!absent&&<ul className="distance-lines">{distanceLines({here,stop,bus:shown,relation:cardRelation,
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
   :`Positions older than ${expiryMinutes} minutes are withheld${live?` (${live.withheld.expiredPositions} now)`:''}. `}
   Progress is counted in timetabled stops from each bus’s last report; no arrival time is predicted.
   {' '}<button className="text-action" onClick={onOpenEvidence}>How this works</button></p>
 </section>;
}
