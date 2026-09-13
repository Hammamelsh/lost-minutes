"use client";

import {useCallback,useMemo,useState,useSyncExternalStore} from 'react';
import {ArrowLeft,Clock3,Crosshair,LocateFixed,MapPin,Radio,RefreshCw,Star,WifiOff,X} from 'lucide-react';
import FollowMap from '@/components/follow-map';
import CityMap,{type Here,type MapView} from '@/components/city-map';
import Nearby from '@/components/nearby';
import StopProgress from '@/components/stop-progress';
import BusEvidence from '@/components/bus-evidence';
import WalkGuide from '@/components/walk-guide';
import {relateToStop,type PatternCatalogue,type ServicePattern,type StopRelation} from '@/lib/patterns';
import {association,busOnService,distanceLines,progress,schematic,servicesAtStop,standing,standingWords,
        stopBoard,type BoardRow} from '@/lib/journey';
import {londonDate} from '@/lib/service-days';
import {bearingWords,savedStopsServerSnapshot,savedStopsSnapshot,saveStops,stopPlace,
        subscribeSavedStops,toggleSavedStop,type Stop} from '@/lib/stops';
import {destinationLabel,directionLabel,routeId,routeNumber,routesByRecency,type FollowBus} from '@/lib/follow';
import {favouriteKey,favouritesServerSnapshot,favouritesSnapshot,isFavourite,saveFavourites,
        subscribeFavourites,toggleFavourite,type Favourite,type FeedMode,type LiveState} from '@/lib/live';
import {clock} from '@/lib/replay';
import {saveTheme,subscribeTheme,themeServerSnapshot,themeSnapshot} from '@/lib/theme';
import {DEFAULT_WALKING,walkWords,type WalkingConfig} from '@/lib/walking';
import {useWalkingConsent,useWalkingRoute} from '@/lib/use-walking';
import {describeMotion,motionPreferenceServerSnapshot,motionPreferenceSnapshot,saveMotionPreference,
        subscribeMotionPreference,type MotionInfo} from '@/lib/motion-view';

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

export default function FollowView({mode,live,buses,roads,onRefresh,refreshing,
                                    publicationAgeSeconds,ageBasis,archiveDate,onUseArchive,
                                    usingArchive,onOpenEvidence,stops,stop,onSelectStop,
                                    onLocate,locating,locationError,patterns,patternsById,
                                    here,outsideArea,onClearHere,nowMs,liveFingerprint,recall,walkingConfig,
                                    clockOffsetMs=0}:{
 mode:FeedMode;live:LiveState|null;buses:FollowBus[];roads:import('@/lib/replay').RoadMap|null;
 onRefresh:()=>void;refreshing:boolean;publicationAgeSeconds:number|null;
 ageBasis:'server'|'device';archiveDate?:string;onUseArchive?:()=>void;usingArchive:boolean;
 onOpenEvidence:()=>void;stops:Stop[];stop:Stop|null;onSelectStop:(stop:Stop|null)=>void;
 onLocate?:()=>void;locating?:boolean;locationError?:string;
 patterns:PatternCatalogue|null;patternsById:Map<string,ServicePattern>;
 here:Here|null;outsideArea:boolean;onClearHere:()=>void;
 nowMs:number;liveFingerprint?:string|null;recall?:(key:string)=>FollowBus|null;
 walkingConfig?:WalkingConfig|null;clockOffsetMs?:number}){
 const favourites=useSyncExternalStore(subscribeFavourites,favouritesSnapshot,favouritesServerSnapshot);
 const savedStopIds=useSyncExternalStore(subscribeSavedStops,savedStopsSnapshot,savedStopsServerSnapshot);
 const theme=useSyncExternalStore(subscribeTheme,themeSnapshot,themeServerSnapshot);
 const [consent,setConsent]=useWalkingConsent();
 const estimatedMovement=useSyncExternalStore(subscribeMotionPreference,motionPreferenceSnapshot,motionPreferenceServerSnapshot);
 const [motionInfo,setMotionInfo]=useState<MotionInfo|null>(null);
 const reportMotion=useCallback((info:MotionInfo|null)=>setMotionInfo(info),[]);
 const [blocked,setBlocked]=useState(false);
 const [choice,setChoice]=useState<{route:string;direction:string}|null>(null);
 const [serviceKey,setServiceKey]=useState<string|null>(null);
 const [selectedKey,setSelectedKey]=useState('');
 const [follow,setFollow]=useState(false);
 const [view,setView]=useState<MapView>('2d');
 const [fitRequest,setFitRequest]=useState(0);
 const [walkAttempt,setWalkAttempt]=useState(0);
 // MapLibre when the device can render it; the drawn map when it cannot.
 const [mapFallback,setMapFallback]=useState(false);
 // Dependencies of CityMap's creation effect: they must never change identity, or the page's
 // five-second clock would tear the map down on every tick (the 13 September lifecycle bug).
 const stopFollowing=useCallback(()=>setFollow(false),[]);
 const showMapFallback=useCallback(()=>setMapFallback(true),[]);
 const selectFromMap=useCallback((key:string)=>{setSelectedKey(key);setFollow(false)},[]);

 // The day a timetable is judged against: today in Manchester, or the recording's day.
 const day=londonDate(mode==='archive'?(buses[0]?.observedAtMs??nowMs):nowMs);
 const stopById=useMemo(()=>new Map(stops.map(s=>[s.id,s])),[stops]);
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
 const activeService=services.find(s=>s.key===serviceKey)??null;
 const board=useMemo(()=>stop?stopBoard(buses,stop,relations,
  activeService?(bus,relation)=>busOnService(bus,activeService,relation):undefined):null,
  [buses,stop,relations,activeService]);

 // ------------------------------------------------------------ browse by route (no stop)
 const available=useMemo(()=>routesByRecency(buses),[buses]);
 const availableIds=useMemo(()=>available.map(r=>r.id),[available]);
 const fallbackRoute=useMemo(()=>{
  const saved=favourites.find(f=>availableIds.includes(`${f.operator}|${f.route}`));
  if(saved)return {route:`${saved.operator}|${saved.route}`,direction:saved.direction};
  return {route:available[0]?.id??'',direction:'all'};
 },[favourites,available,availableIds]);
 const {route,direction}=choice??fallbackRoute;
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

 // ------------------------------------------------------------ the selected bus
 const mapBuses=useMemo(()=>{
  if(!stop||!board)return onRoute;
  const keys=new Set([...board.coming,...board.maybe,...board.nearby,...board.passed,...board.old,
                      ...board.elsewhere].map(row=>row.bus.key));
  return buses.filter(b=>keys.has(b.key));
 },[stop,board,onRoute,buses]);
 const liveSelected=selectedKey?buses.find(b=>b.key===selectedKey):undefined;
 // An explicit choice is kept when its bus leaves the feed; the card says so rather than
 // quietly switching to another bus.
 const gone=selectedKey&&!liveSelected?recall?.(selectedKey)??null:null;
 // Only a bus timetabled to call at your stop and not yet past it is chosen for you. Anything
 // else is shown only when you pick it, and is labelled as not coming to your stop.
 const selected=liveSelected??(selectedKey?undefined:(stop?board?.coming[0]?.bus:onRoute[0]));
 const cardBus=selected??gone??undefined;
 const cardRelation=cardBus&&stop?(relations.get(cardBus.key)??relateToStop(cardBus,stop.id,patternsById)):undefined;
 const cardStanding=cardRelation?standing(cardRelation):null;
 const relevant=!stop||cardStanding==='coming';
 const effectiveView:MapView=view==='ride'&&!selected?'2d':view;
 const riding=effectiveView==='ride';

 const copy=MODE[mode];
 const policy=live?.freshness.policy;
 const expiryMinutes=policy?Math.round(policy.observationExpirySeconds/60):15;
 const collector=live?.collection.collector;

 function chooseBus(key:string){setSelectedKey(key);setFollow(false);setFitRequest(n=>n+1)}
 function chooseService(key:string){
  setServiceKey(current=>current===key?null:key);setSelectedKey('');setFollow(false);setFitRequest(n=>n+1);
 }
 function pick(next:{route:string;direction:string}){
  setChoice(next);setSelectedKey('');setFollow(false);setFitRequest(n=>n+1);
 }
 function selectStop(next:Stop|null){
  onSelectStop(next);setServiceKey(null);setSelectedKey('');setView('2d');setFitRequest(n=>n+1);
 }
 function backToStop(){setSelectedKey('');setFollow(false);setView('2d');setFitRequest(n=>n+1)}

 const ageText=(bus:FollowBus)=>mode==='archive'?`reported ${clock(bus.observedAtMs,true)}`:bus.ageWords;
 const ageChip=(bus:FollowBus)=>mode==='archive'?clock(bus.observedAtMs,true):bus.ageWords.replace('reported ','');
 const assoc=cardBus&&cardRelation?association(cardRelation,cardBus):null;
 const prog=cardRelation?progress(cardRelation,name):null;
 const items=cardRelation&&stop&&relevant?schematic(cardRelation,name,stop.id):[];
 const walked=walkRoute?walkWords(walkRoute):null;
 const notServing=stop&&cardBus&&assoc&&!relevant
  ?cardStanding==='not_for_stop'?`It does not serve ${stopLabel}. ${assoc.detail}`
   :cardStanding==='passed'?`In the timetable’s stop order its last report is already past ${stopLabel}.`
   :`${assoc.text}. ${assoc.detail}`
  :null;

 // Estimates are for live data you are watching now: never a recording, never offline.
 const motion={enabled:estimatedMovement&&mode!=='archive'&&mode!=='offline'&&mode!=='unavailable',
  reason:!estimatedMovement?'you chose reported positions only'
   :mode==='archive'?'a recording is shown at its reported positions':'the feed is not live'};
 // The age is the page's, the one the card's age chip shows, so the card never gives two.
 // A recording is only ever shown at its reports, and says so in its own header.
 const motionWords=mode!=='archive'&&motionInfo&&selected&&cardBus?.key===selected.key?describeMotion({...motionInfo,
  reportAge:selected.ageSeconds!==null&&Number.isFinite(selected.ageSeconds)?Math.round(selected.ageSeconds):motionInfo.reportAge})
  :null;

 const rideOverlay=selected?<div className="ride-card">
  <div className="ride-card-head">
   <span className="route-badge">{selected.route}</span>
   <div>{!relevant&&<small className="ride-card-eyebrow">Selected bus · not coming to your stop</small>}
    <strong>to {destinationLabel(selected.destination)}</strong>{!motionWords&&<small>{ageText(selected)}</small>}</div>
  </div>
  {motionWords&&<p className={`ride-motion ${motionInfo?.mode}`}>{motionWords.label}</p>}
  {stop&&cardRelation&&prog&&<p className={`ride-progress tone-${relevant?prog.tone:'bad'}`}>
   {relevant?prog.text:NOT_COMING[cardStanding??'unknown']}</p>}
  {stop&&cardRelation&&relevant&&<StopProgress items={schematic(cardRelation,name,stop.id,5)} compact/>}
 </div>:null;

 const row=(item:BoardRow,detail:string)=><button key={item.bus.key} onClick={()=>chooseBus(item.bus.key)}
   className={`follow-row standing-${item.standing}${item.bus.key===cardBus?.key?' on':''}`}
   aria-pressed={item.bus.key===cardBus?.key}>
  <span className="route-pill">{item.bus.route}</span>
  <span className="follow-row-copy"><strong>to {destinationLabel(item.bus.destination)}</strong><small>{detail}</small></span>
  <span className={`fresh-chip ${mode==='archive'?'archive':item.bus.freshness??'unknown'}`}>{ageChip(item.bus)}</span>
 </button>;
 const more=board?board.passed.length+board.old.length+board.elsewhere.length:0;

 return <section className={`follow${stop?' has-stop':''}`}>
  <div className={`follow-bar ${copy.tone}`} role="status">
   <span className="follow-badge">{mode==='offline'?<WifiOff size={13}/>:<Radio size={13}/>}{copy.label}</span>
   <span className="follow-bar-when">
    {mode==='archive'?archiveDate
     :publicationAgeSeconds===null?'not published yet'
     :`updated ${ageBasis==='device'?'about ':''}${Math.round(publicationAgeSeconds)}s ago`}</span>
   {mode!=='archive'&&collector?.kind==='bounded_development'&&<span className="follow-bar-run"
     title="Collected by a time-limited run on one machine, not an always-on service">
    local run{collector.endsBy&&collector.status==='running'?` · until ${clock(Date.parse(collector.endsBy))}`:''}</span>}
   <button className="follow-refresh" onClick={onRefresh} disabled={refreshing}
    aria-label="Check for newer positions"><RefreshCw size={15} className={refreshing?'spin':''}/></button>
  </div>

  {/* Where am I, where is my stop, and how do I walk there? */}
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
       <span className="your-stop-actions">
        {onLocate&&<button className="your-stop-locate" onClick={onLocate} disabled={locating} aria-label="Locate me">
         <LocateFixed size={15} className={locating?'spin':''}/></button>}
        <button className={savedStopIds.includes(stop.id)?'on':''} aria-pressed={savedStopIds.includes(stop.id)}
         aria-label={savedStopIds.includes(stop.id)?'Saved on this device':'Save this stop'}
         onClick={()=>setBlocked(!saveStops(toggleSavedStop(savedStopIds,stop.id)))}>
         <Star size={15} fill={savedStopIds.includes(stop.id)?'currentColor':'none'}/></button>
        <button onClick={()=>selectStop(null)}>Change</button>
       </span>
      </div>
      {mode!=='archive'&&<WalkGuide state={walk} config={walking} here={here} stop={stop} consent={consent}
       onConsent={setConsent} onRetry={()=>setWalkAttempt(n=>n+1)} onLocate={onLocate} locating={locating}
       locationError={locationError}/>}
     </div>
   : <div className="your-stop unset">
      <Nearby stops={stops} patterns={patterns} here={here} outsideArea={outsideArea} day={day}
       onSelect={selectStop} onLocate={onLocate??(()=>{})} locating={!!locating}
       locationError={locationError} onClearHere={onClearHere} areaLabel="Manchester"/>
      {savedStopIds.length>0&&<div className="stop-chips">
       {savedStopIds.map(id=>{
        const saved=stopById.get(id);
        return saved?<button key={id} className="stop-chip" onClick={()=>selectStop(saved)}>
         <MapPin size={14}/><span>{saved.name}{saved.indicator?` · ${saved.indicator}`:''}</span>
        </button>:null;
       })}
      </div>}
     </div>)}
  {blocked&&<p className="follow-hint warn">This device would not let us save that. It still works for this visit.</p>}

  {mapFallback
   ? <FollowMap buses={mapBuses} selected={selected} follow={follow} roads={roads}
      mode={mode} stop={stop} here={here} onSelect={selectFromMap} onManualMove={stopFollowing}/>
   : <CityMap buses={mapBuses} selected={selected} stop={stop} here={here} follow={follow}
      onSelect={selectFromMap} onManualMove={stopFollowing} onUnavailable={showMapFallback}
      view={effectiveView} onViewChange={setView} theme={theme} onThemeChange={saveTheme}
      fitRequest={fitRequest} onLocate={onLocate} locating={locating} rideOverlay={rideOverlay}
      busLabel={relevant?'Your bus':'Selected bus'}
      walk={walkRoute&&here&&stop?{path:walkRoute.path,from:here,to:{lat:stop.lat,lon:stop.lon}}:null}
      clockOffsetMs={clockOffsetMs} motion={motion} onMotion={reportMotion}/>}

  {/* Which bus, is it coming here, how far has it got, how old is that? */}
  {cardBus&&<article className={`bus-card${gone?' gone':''}${relevant?'':' explored'}`}
    aria-label={relevant&&stop?'Your bus':'Selected bus'}>
   <p className="bus-card-eyebrow">{relevant&&stop?'Your bus':'Selected bus'}</p>
   <header className="bus-card-head">
    <span className="route-badge">{cardBus.route}</span>
    <div className="bus-card-title">
     <strong>to {destinationLabel(cardBus.destination)}</strong>
     <small>{[directionLabel(cardBus.direction),cardBus.operator].filter(Boolean).join(' · ')}</small>
    </div>
    <span className={`age-chip ${mode==='archive'?'archive':cardBus.freshness??'unknown'}`}>{ageChip(cardBus)}</span>
   </header>
   {stop&&prog&&<div className={`bus-card-answer tone-${relevant?prog.tone:'bad'}`}>
    <strong>{relevant?prog.text:NOT_COMING[cardStanding??'unknown']}</strong>
    {relevant&&prog.detail&&<span>{prog.detail}</span>}</div>}
   {notServing&&<div className="bus-card-explored" role="note">
    <p>{notServing}</p>
    <button className="back-to-stop" onClick={backToStop}><ArrowLeft size={15}/>Back to buses for your stop
     {board&&board.coming.length?` (${board.coming.length} coming)`:''}</button>
   </div>}
   {motionWords&&!gone&&<div className={`bus-card-motion ${motionInfo?.mode}`}>
    <p><strong>{motionWords.label}</strong><span>{motionWords.detail}</span></p>
    <button className="text-action" aria-pressed={!estimatedMovement}
     onClick={()=>saveMotionPreference(!estimatedMovement)}>
     {estimatedMovement?'Show reported positions only':'Show estimated movement'}</button>
   </div>}
   {gone&&<p className="bus-card-gone">Not in the latest publication. Its last report was at
    {' '}{clock(gone.observedAtMs,true)}. It stays selected until you choose another bus.</p>}
   {stop&&walked&&<p className="bus-card-walk"><strong>You: {walked.time} walk</strong>
    <span>{walked.distance} to {stopLabel}</span></p>}
   {stop&&assoc
    ? <dl className="claims">
       <div className="claim"><dt>Boarding point</dt><dd><strong>{stopLabel}</strong>
        <span>{[bearingWords(stop.bearing),stop.street].filter(Boolean).join(' · ')}</span></dd></div>
       <div className={`claim tone-${assoc.tone}`}><dt>Calls at your stop?</dt><dd><strong>{assoc.text}</strong>
        {relevant&&assoc.detail&&<span>{assoc.detail}</span>}</dd></div>
       <div className="claim"><dt>Report age</dt><dd><strong>{ageText(cardBus)}</strong>
        {mode==='archive'?<span>from the recording, not live</span>
         :FRESHNESS[cardBus.freshness??'']&&<span>{FRESHNESS[cardBus.freshness??'']}</span>}</dd></div>
      </dl>
    : <p className="bus-card-hint"><strong>{mode==='archive'?'A recorded position':`Reported ${ageChip(cardBus)}`}</strong>
      Choose your stop to see whether this bus calls there and how far it has got.</p>}
   <StopProgress items={items}/>
   <ul className="distance-lines">{distanceLines({here,stop,bus:cardBus,relation:cardRelation,
     walk:walkRoute?{metres:walkRoute.metres,seconds:walkRoute.seconds,provider:walkRoute.provider}:null}).map(line=>
    <li key={line.label}><span>{line.label}</span><strong>{line.value}</strong><small>{line.basis}</small></li>)}</ul>
   {!gone&&<div className="bus-card-actions">
    {riding
     ? <button className="ride-state" onClick={()=>setView('2d')} aria-label="Leave the ride-along"
        aria-pressed="true"><X size={16}/><span>Riding along · exit</span></button>
     : <button className={`follow-toggle ${follow?'on':''}`} onClick={()=>setFollow(v=>!v)}
        aria-pressed={follow} aria-label={follow?'Stop following this bus':'Keep this bus centred'}>
        <Crosshair size={16}/><span>{follow?'Following on the map':'Follow on the map'}</span></button>}
   </div>}
   <details className="bus-evidence-toggle">
    <summary>How we know this</summary>
    <BusEvidence bus={cardBus} relation={cardRelation} patterns={patternsById} mode={mode}
     publishedAt={live?.publishedAt} liveFingerprint={liveFingerprint} ageBasis={ageBasis}
     expiryMinutes={expiryMinutes} name={name} onOpenEvidence={onOpenEvidence}/>
   </details>
  </article>}
  {stop&&board&&!cardBus&&buses.length>0&&<article className="bus-card empty" aria-label="Your bus">
   <p className="bus-card-eyebrow">Your bus</p>
   <div className="bus-card-answer tone-neutral"><strong>No bus is confirmed coming to your stop yet</strong>
    <span>{board.maybe.length?`${board.maybe.length===1?'One bus':`${board.maybe.length} buses`} may call here; the branch is not settled.`
     :board.old.some(row=>row.standing==='coming')?'The buses on services calling here have only old reports; they are listed below as old reports.'
     :board.nearby.length?'The buses reported nearby are not coming to this stop.'
     :services.length?'No bus on a service calling here has a current report.'
     :'This stop has no timetable coverage, so no bus can be confirmed as coming here.'}</span></div>
  </article>}

  {/* Four situations, told apart in plain words rather than one vague message. */}
  {mode==='unavailable'&&<div className="follow-empty">
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
    {publicationAgeSeconds===null?'at an unknown time':`${Math.round(publicationAgeSeconds)} seconds ago`}.</p>}
   {onUseArchive&&!usingArchive&&<button className="action" onClick={onUseArchive}>Follow a bus in the recording</button>}
  </div>}

  {stop&&<section className="services" aria-label="Services from your stop">
   <h3 className="section-head">Services from this stop{services.length?<small>timetabled · tap to filter</small>:null}</h3>
   {services.length===0
    ? <p className="services-empty">No timetable coverage for this stop yet. Buses near it can be shown,
       but none can be confirmed as calling here.</p>
    : <div className="service-chips">{services.map(service=>
       <button key={service.key} aria-pressed={activeService?.key===service.key}
        className={`service-chip${activeService?.key===service.key?' on':''}${service.runsToday===false?' not-today':''}`}
        onClick={()=>chooseService(service.key)}>
        <span className="route-pill">{service.line}</span>
        <span className="service-chip-copy"><strong>to {service.destination}</strong>
         <small>{service.runsToday===false?`not running today · ${service.runs}`
          :service.reporting?`${service.reporting} coming or here`:'none reporting nearby'}</small></span>
       </button>)}</div>}
  </section>}

  {/* Relevant buses first and alone; everything else is listed apart with what it is. */}
  {stop&&board&&<section className="waiting" aria-label="Buses coming to your stop">
   <h3 className="section-head">{activeService?`${activeService.line} to ${activeService.destination}`:'Coming to your stop'}
    <small>by the timetable’s stop order</small></h3>
   {board.coming.length===0
    ? <p className="services-empty">{services.length
       ?'No bus on a service calling here has a current report. Nothing is guessed to fill the gap.'
       :'Without timetable coverage for this stop, no bus can be confirmed as coming here.'}</p>
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
   {favourites.length>0&&<div className="follow-chips">
    {favourites.map(f=>{
     const id=`${f.operator}|${f.route}`;
     return <button key={favouriteKey(f)} className={`follow-chip ${route===id?'on':''}`}
      onClick={()=>pick({route:id,direction:f.direction})}>
      {f.route}{!availableIds.includes(id)&&<em>no buses</em>}</button>;
    })}
   </div>}
   {onRoute.length>1&&<div className="follow-list">
    {onRoute.filter(bus=>bus.key!==selected?.key).slice(0,10).map(bus=><button key={bus.key}
      onClick={()=>chooseBus(bus.key)} className="follow-row">
     <span className="route-pill">{bus.route}</span>
     <span className="follow-row-copy"><strong>to {destinationLabel(bus.destination)}</strong>
      <small>{directionLabel(bus.direction)}</small></span>
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
