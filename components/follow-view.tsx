"use client";

import {useCallback,useMemo,useState,useSyncExternalStore} from 'react';
import {Clock3,Crosshair,LocateFixed,MapPin,Radio,RefreshCw,Star,WifiOff} from 'lucide-react';
import FollowMap from '@/components/follow-map';
import CityMap,{type Here,type MapView} from '@/components/city-map';
import Nearby from '@/components/nearby';
import StopProgress from '@/components/stop-progress';
import BusEvidence from '@/components/bus-evidence';
import {bringsItToYourStop,relateToStop,relationWords,type PatternCatalogue,type ServicePattern,
        type StopRelation} from '@/lib/patterns';
import {association,busesAtStop,busOnService,distanceLines,progress,schematic,servicesAtStop} from '@/lib/journey';
import {londonDate} from '@/lib/service-days';
import {bearingWords,savedStopsServerSnapshot,savedStopsSnapshot,saveStops,stopPlace,
        straightLineMetres,subscribeSavedStops,toggleSavedStop,type Stop} from '@/lib/stops';
import {destinationLabel,directionLabel,routeId,routeNumber,routesByRecency,type FollowBus} from '@/lib/follow';
import {favouriteKey,favouritesServerSnapshot,favouritesSnapshot,isFavourite,saveFavourites,
        subscribeFavourites,toggleFavourite,type Favourite,type FeedMode,type LiveState} from '@/lib/live';
import {clock} from '@/lib/replay';
import {saveTheme,subscribeTheme,themeServerSnapshot,themeSnapshot} from '@/lib/theme';

const MODE:Record<FeedMode,{label:string;tone:string}>={
 live:{label:'LIVE',tone:'live'},
 stale:{label:'NOT UPDATING',tone:'warn'},
 offline:{label:'OFFLINE',tone:'warn'},
 unavailable:{label:'NOT COLLECTING',tone:'idle'},
 archive:{label:'ARCHIVE REPLAY',tone:'archive'},
};

const FRESHNESS:Record<string,string>={
 fresh:'a recent report',
 ageing:'it may have moved on since',
 stale:'an old report: it may have finished, lost signal or be out of coverage',
 expired:'older than the cut-off, so it is not drawn',
};

// Nearest first for a waiting passenger: at or near the stop, then fewest stops away.
function waitRank(relation:StopRelation):[number,number]{
 if(relation.kind==='near_your_stop')return [0,0];
 if(relation.kind==='approaching')return [1,relation.stopsAway];
 if(relation.kind==='branch_all_call')return [2,relation.stopsAway??relation.range?.[0]??99];
 if(relation.kind==='branch_some_call')return [3,0];
 return [9,0];
}

export default function FollowView({mode,live,buses,roads,onRefresh,refreshing,
                                    publicationAgeSeconds,ageBasis,archiveDate,onUseArchive,
                                    usingArchive,onOpenEvidence,stops,stop,onSelectStop,
                                    onLocate,locating,locationError,patterns,patternsById,
                                    here,outsideArea,onClearHere,nowMs,liveFingerprint,recall}:{
 mode:FeedMode;live:LiveState|null;buses:FollowBus[];roads:import('@/lib/replay').RoadMap|null;
 onRefresh:()=>void;refreshing:boolean;publicationAgeSeconds:number|null;
 ageBasis:'server'|'device';archiveDate?:string;onUseArchive?:()=>void;usingArchive:boolean;
 onOpenEvidence:()=>void;stops:Stop[];stop:Stop|null;onSelectStop:(stop:Stop|null)=>void;
 onLocate?:()=>void;locating?:boolean;locationError?:string;
 patterns:PatternCatalogue|null;patternsById:Map<string,ServicePattern>;
 here:Here|null;outsideArea:boolean;onClearHere:()=>void;
 nowMs:number;liveFingerprint?:string|null;recall?:(key:string)=>FollowBus|null}){
 const favourites=useSyncExternalStore(subscribeFavourites,favouritesSnapshot,favouritesServerSnapshot);
 const savedStopIds=useSyncExternalStore(subscribeSavedStops,savedStopsSnapshot,savedStopsServerSnapshot);
 const theme=useSyncExternalStore(subscribeTheme,themeSnapshot,themeServerSnapshot);
 const [blocked,setBlocked]=useState(false);
 const [choice,setChoice]=useState<{route:string;direction:string}|null>(null);
 const [serviceKey,setServiceKey]=useState<string|null>(null);
 const [selectedKey,setSelectedKey]=useState('');
 const [follow,setFollow]=useState(false);
 const [view,setView]=useState<MapView>('2d');
 const [fitRequest,setFitRequest]=useState(0);
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

 // ------------------------------------------------------------ at your stop
 const relations=useMemo(()=>{
  const map=new Map<string,StopRelation>();
  if(stop)for(const bus of buses)map.set(bus.key,relateToStop(bus,stop.id,patternsById));
  return map;
 },[buses,stop,patternsById]);
 const services=useMemo(()=>stop?servicesAtStop(patterns,stop.id,day,buses,patternsById):[],
  [patterns,stop,day,buses,patternsById]);
 const activeService=services.find(s=>s.key===serviceKey)??null;
 const waiting=useMemo(()=>{
  if(!stop)return [];
  return buses.filter(bus=>{
   const relation=relations.get(bus.key)!;
   return (bringsItToYourStop(relation)||relation.kind==='branch_some_call')
    &&(!activeService||busOnService(bus,activeService,relation));
  }).sort((a,b)=>{
   const ra=waitRank(relations.get(a.key)!),rb=waitRank(relations.get(b.key)!);
   return ra[0]-rb[0]||ra[1]-rb[1]||(a.ageSeconds??0)-(b.ageSeconds??0);
  });
 },[buses,stop,relations,activeService]);
 const atStop=useMemo(()=>stop?busesAtStop(buses,stop,patternsById):[],[buses,stop,patternsById]);
 const nearbyOther=useMemo(()=>{
  if(!stop)return [];
  const shown=new Set([...waiting.map(b=>b.key),...atStop.map(item=>item.bus.key)]);
  return buses.filter(bus=>!shown.has(bus.key)).map(bus=>({bus,metres:straightLineMetres(stop,bus)}))
   .filter(item=>item.metres<=1500).sort((a,b)=>a.metres-b.metres).slice(0,12);
 },[buses,stop,waiting,atStop]);

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
  if(!stop)return onRoute;
  const keys=new Set([...waiting.map(b=>b.key),...atStop.map(i=>i.bus.key),...nearbyOther.map(i=>i.bus.key)]);
  return buses.filter(b=>keys.has(b.key));
 },[stop,onRoute,waiting,atStop,nearbyOther,buses]);
 const liveSelected=selectedKey?buses.find(b=>b.key===selectedKey):undefined;
 // An explicit choice is kept when its bus leaves the feed; the card says so rather than
 // quietly switching to another bus.
 const gone=selectedKey&&!liveSelected?recall?.(selectedKey)??null:null;
 const selected=liveSelected??(selectedKey?undefined:(stop?waiting[0]??atStop[0]?.bus:onRoute[0]));
 const cardBus=selected??gone??undefined;
 const cardRelation=cardBus&&stop?(relations.get(cardBus.key)??relateToStop(cardBus,stop.id,patternsById)):undefined;
 const effectiveView:MapView=view==='ride'&&!selected?'2d':view;

 const copy=MODE[mode];
 const policy=live?.freshness.policy;
 const expiryMinutes=policy?Math.round(policy.observationExpirySeconds/60):15;

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

 const ageText=(bus:FollowBus)=>mode==='archive'?`reported ${clock(bus.observedAtMs,true)}`:bus.ageWords;
 const assoc=cardBus&&cardRelation?association(cardRelation,cardBus):null;
 const prog=cardRelation?progress(cardRelation,name):null;
 const items=cardRelation&&stop?schematic(cardRelation,name,stop.id):[];

 const rideOverlay=selected?<div className="ride-card">
  <div className="ride-card-head">
   <span className="route-badge">{selected.route}</span>
   <div><strong>to {destinationLabel(selected.destination)}</strong><small>{ageText(selected)}</small></div>
  </div>
  {stop&&cardRelation&&prog&&<p className={`ride-progress tone-${prog.tone}`}>{prog.text}</p>}
  {stop&&cardRelation&&<StopProgress items={schematic(cardRelation,name,stop.id,5)} compact/>}
 </div>:null;

 return <section className={`follow${stop?' has-stop':''}`}>
  <div className={`follow-bar ${copy.tone}`} role="status">
   <span className="follow-badge">{mode==='offline'?<WifiOff size={13}/>:<Radio size={13}/>}{copy.label}</span>
   <span className="follow-bar-when">
    {mode==='archive'?archiveDate
     :publicationAgeSeconds===null?'not published yet'
     :`updated ${ageBasis==='device'?'about ':''}${Math.round(publicationAgeSeconds)}s ago`}</span>
   <button className="follow-refresh" onClick={onRefresh} disabled={refreshing}
    aria-label="Check for newer positions"><RefreshCw size={15} className={refreshing?'spin':''}/></button>
  </div>

  {/* Where am I, and where is my stop? */}
  {stops.length>0&&(stop
   ? <div className="your-stop">
      <span className="your-stop-mark"><MapPin size={18}/></span>
      <span className="your-stop-copy">
       <small className="your-stop-eyebrow">Your stop</small>
       <strong>{stop.name}{stop.indicator?` (${stop.indicator})`:''}</strong>
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
      fitRequest={fitRequest} onLocate={onLocate} locating={locating} rideOverlay={rideOverlay}/>}

  {/* Which bus, is it coming here, how far has it got, how old is that? */}
  {cardBus&&<article className={`bus-card${gone?' gone':''}`} aria-label="Your bus">
   <header className="bus-card-head">
    <span className="route-badge">{cardBus.route}</span>
    <div className="bus-card-title">
     <strong>to {destinationLabel(cardBus.destination)}</strong>
     <small>{[directionLabel(cardBus.direction),cardBus.operator].filter(Boolean).join(' · ')}</small>
    </div>
    <span className={`age-chip ${mode==='archive'?'archive':cardBus.freshness??'unknown'}`}>
     {mode==='archive'?clock(cardBus.observedAtMs,true):cardBus.ageWords.replace('reported ','')}</span>
   </header>
   {gone&&<p className="bus-card-gone">Not in the latest publication. Its last report was at
    {' '}{clock(gone.observedAtMs,true)}. It stays selected until you choose another bus.</p>}
   {stop&&assoc&&prog
    ? <dl className="claims">
       <div className="claim"><dt>Boarding point</dt><dd><strong>{stop.name}{stop.indicator?` (${stop.indicator})`:''}</strong>
        <span>{[bearingWords(stop.bearing),stop.street].filter(Boolean).join(' · ')}</span></dd></div>
       <div className={`claim tone-${assoc.tone}`}><dt>Calls at your stop?</dt><dd><strong>{assoc.text}</strong>
        {assoc.detail&&<span>{assoc.detail}</span>}</dd></div>
       <div className={`claim tone-${prog.tone}`}><dt>Progress</dt><dd><strong>{prog.text}</strong>
        {prog.detail&&<span>{prog.detail}</span>}</dd></div>
       <div className="claim"><dt>Report age</dt><dd><strong>{ageText(cardBus)}</strong>
        <span>{mode==='archive'?'from the recording, not live':FRESHNESS[cardBus.freshness??'']??'age unknown'}</span></dd></div>
      </dl>
    : <p className="bus-card-hint"><strong>{mode==='archive'?'A recorded position':`Reported ${ageText(cardBus).replace(/^reported /,'')}`}</strong>
      Choose your stop to see whether this bus calls there and how far it has got.</p>}
   <StopProgress items={items}/>
   <ul className="distance-lines">{distanceLines({here,stop,bus:cardBus,relation:cardRelation}).map(line=>
    <li key={line.label}><span>{line.label}</span><strong>{line.value}</strong><small>{line.basis}</small></li>)}</ul>
   {!gone&&<div className="bus-card-actions">
    {!mapFallback&&<button className="ride-button" onClick={()=>setView('ride')}
     aria-label={`Ride along with route ${cardBus.route}`}>Ride along</button>}
    <button className={`follow-toggle ${follow?'on':''}`} onClick={()=>setFollow(v=>!v)}
     aria-pressed={follow} aria-label={follow?'Stop following this bus':'Keep this bus centred'}>
     <Crosshair size={16}/><span>{follow?'Following':'Follow'}</span></button>
   </div>}
   <details className="bus-evidence-toggle">
    <summary>How we know this</summary>
    <BusEvidence bus={cardBus} relation={cardRelation} patterns={patternsById} mode={mode}
     publishedAt={live?.publishedAt} liveFingerprint={liveFingerprint} ageBasis={ageBasis}
     expiryMinutes={expiryMinutes} name={name} onOpenEvidence={onOpenEvidence}/>
   </details>
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

  {stop&&atStop.length>0&&<section className="at-stop" aria-label="Buses at your stop now">
   <h3 className="section-head">At your stop now<small>last report within 150 m</small></h3>
   {atStop.map(({bus,metres,relation})=><button key={bus.key} onClick={()=>chooseBus(bus.key)}
     className={`follow-row${bus.key===cardBus?.key?' on':''}`} aria-pressed={bus.key===cardBus?.key}>
    <span className="route-pill">{bus.route}</span>
    <span className="follow-row-copy"><strong>to {destinationLabel(bus.destination)}</strong>
     <small>{Math.round(metres/10)*10} m away · {bringsItToYourStop(relation)?'timetabled to call here'
      :relation.kind==='does_not_call'||relation.kind==='branch_none_call'?'does not call here':'not confirmed for this stop'}</small></span>
    <span className={`fresh-chip ${mode==='archive'?'archive':bus.freshness??'unknown'}`}>
     {mode==='archive'?clock(bus.observedAtMs,true):bus.ageWords.replace('reported ','')}</span>
   </button>)}
  </section>}

  {stop&&<section className="waiting" aria-label="Buses for your stop">
   <h3 className="section-head">{activeService?`${activeService.line} to ${activeService.destination}`:'Coming to your stop'}
    <small>by the timetable’s stop order</small></h3>
   {waiting.length===0
    ? <p className="services-empty">{services.length
       ?'No bus we can place on a service calling here has a current report. Nothing is guessed to fill the gap.'
       :'Without timetable coverage for this stop, no bus can be confirmed as coming here.'}</p>
    : waiting.map(bus=>{
       const relation=relations.get(bus.key)!;
       return <button key={bus.key} onClick={()=>chooseBus(bus.key)}
        className={`follow-row${bus.key===cardBus?.key?' on':''}`} aria-pressed={bus.key===cardBus?.key}>
        <span className="route-pill">{bus.route}</span>
        <span className="follow-row-copy"><strong>to {destinationLabel(bus.destination)}</strong>
         <small>{relationWords(relation)}</small></span>
        <span className={`fresh-chip ${mode==='archive'?'archive':bus.freshness??'unknown'}`}>
         {mode==='archive'?clock(bus.observedAtMs,true):bus.ageWords.replace('reported ','')}</span>
       </button>;
      })}
  </section>}

  {stop&&nearbyOther.length>0&&<details className="exploring">
   <summary>Other buses nearby, not confirmed for your stop ({nearbyOther.length})</summary>
   <p>Real reported buses within 1.5 km. The timetable does not place them as calling at your
   stop, so they are kept apart from the boarding options rather than guessed at.</p>
   {nearbyOther.map(({bus,metres})=><button key={bus.key} className="exploring-row" onClick={()=>chooseBus(bus.key)}>
    <span className="route-pill">{bus.route}</span>
    <span><strong>to {destinationLabel(bus.destination)}</strong>
     <small>{(metres/1000).toFixed(1)} km away · {relationWords(relations.get(bus.key)??{kind:'no_pattern_data'})}</small></span>
   </button>)}
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
     <span className={`fresh-chip ${mode==='archive'?'archive':bus.freshness??'unknown'}`}>
      {mode==='archive'?clock(bus.observedAtMs,true):bus.ageWords.replace('reported ','')}</span>
    </button>)}
   </div>}
  </section>}

  <p className="follow-notes">{mode==='archive'
   ?'A recording: times are when each bus reported on the day, not how long ago. '
   :`Positions older than ${expiryMinutes} minutes are withheld${live?` (${live.withheld.expiredPositions} now)`:''}. `}
   Nearby-stop distances are straight-line distances. Bus progress is counted in stops where a
   timetabled service pattern is matched; it is not an arrival-time or waiting-time prediction.
   {' '}<button className="text-action" onClick={onOpenEvidence}>How this works</button></p>
 </section>;
}
