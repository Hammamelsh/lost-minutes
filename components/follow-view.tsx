"use client";

import {useMemo,useState,useSyncExternalStore} from 'react';
import {ChevronDown,Clock3,Crosshair,MapPin,Radio,RefreshCw,Star,WifiOff} from 'lucide-react';
import FollowMap from '@/components/follow-map';
import CityMap,{type Here} from '@/components/city-map';
import Nearby from '@/components/nearby';
import {alongRouteWords,patternsCallingAt,relateToStop,relationWords,type PatternCatalogue,
        type ServicePattern,type StopRelation} from '@/lib/patterns';
import {distanceWords,savedStopsServerSnapshot,savedStopsSnapshot,saveStops,
        stopDetail,stopPlace,straightLineMetres,subscribeSavedStops,toggleSavedStop,
        type Stop} from '@/lib/stops';
import {destinationLabel,directionLabel,FollowBus,routeId,routeNumber,routesByRecency} from '@/lib/follow';
import {Favourite,FeedMode,favouriteKey,favouritesServerSnapshot,favouritesSnapshot,
        isFavourite,LiveState,saveFavourites,subscribeFavourites,toggleFavourite} from '@/lib/live';
import {clock} from '@/lib/replay';

const MODE:Record<FeedMode,{label:string;tone:string;line:string}>={
 live:{label:'LIVE',tone:'live',line:'Buses report their position; this is the last one each sent.'},
 stale:{label:'NOT UPDATING',tone:'warn',line:'Our collector has stopped publishing. These are the last positions we hold.'},
 offline:{label:'OFFLINE',tone:'warn',line:'Your browser cannot reach us. This is the copy saved on this device, with its original times.'},
 unavailable:{label:'NOT COLLECTING',tone:'idle',line:'Nothing is being collected right now, so there are no current positions.'},
 archive:{label:'ARCHIVE REPLAY',tone:'archive',line:'A recording from an earlier day. Times shown are when each bus actually reported.'},
};

export default function FollowView({mode,live,buses,roads,onRefresh,refreshing,
                                    publicationAgeSeconds,ageBasis,archiveDate,onUseArchive,
                                    usingArchive,onOpenEvidence,stops,stop,onSelectStop,
                                    onLocate,locating,locationError,patterns,patternsById,
                                    here,outsideArea,onClearHere}:{
 mode:FeedMode;live:LiveState|null;buses:FollowBus[];roads:import('@/lib/replay').RoadMap|null;
 onRefresh:()=>void;refreshing:boolean;publicationAgeSeconds:number|null;
 ageBasis:'server'|'device';archiveDate?:string;onUseArchive?:()=>void;usingArchive:boolean;
 onOpenEvidence:()=>void;stops:Stop[];stop:Stop|null;onSelectStop:(stop:Stop|null)=>void;
 onLocate?:()=>void;locating?:boolean;locationError?:string;
 patterns:PatternCatalogue|null;patternsById:Map<string,ServicePattern>;
 here:Here|null;outsideArea:boolean;onClearHere:()=>void}){
 const favourites=useSyncExternalStore(subscribeFavourites,favouritesSnapshot,favouritesServerSnapshot);
 const savedStopIds=useSyncExternalStore(subscribeSavedStops,savedStopsSnapshot,savedStopsServerSnapshot);
 const [blocked,setBlocked]=useState(false);
 const [choice,setChoice]=useState<{route:string;direction:string}|null>(null);
 const [selectedKey,setSelectedKey]=useState('');
 const [follow,setFollow]=useState(false);
 const [details,setDetails]=useState(false);
 // MapLibre when the device can render it; the vector map is the better answer to "is this
 // my stop", but a device without WebGL or a failed tile host still gets a usable map.
 const [mapFallback,setMapFallback]=useState(false);
 const [pitched,setPitched]=useState(false);

 const available=useMemo(()=>routesByRecency(buses),[buses]);
 const availableIds=useMemo(()=>available.map(r=>r.id),[available]);

 // The user's choice is kept even when its buses disappear. We never switch route silently.
 // What to show before the user has chosen: a saved route that is running, else a route the
 // timetable says calls at their stop, else whichever reported most recently. This is a
 // default, never a switch: an explicit choice is kept even when its buses disappear.
 const fallback=useMemo(()=>{
  const saved=favourites.find(f=>availableIds.includes(`${f.operator}|${f.route}`));
  if(saved)return {route:`${saved.operator}|${saved.route}`,direction:saved.direction};
  if(stop){
   const serving=new Set(patternsCallingAt(patterns,stop.id).map(p=>p.line));
   const match=available.find(r=>serving.has(routeNumber(r.id)));
   if(match)return {route:match.id,direction:'all'};
  }
  return {route:available[0]?.id??'',direction:'all'};
 },[favourites,available,availableIds,stop,patterns]);
 const active=choice??fallback;
 const {route,direction}=active;

 const onRoute=useMemo(()=>buses.filter(b=>routeId(b)===route),[buses,route]);
 const shown=useMemo(()=>{
  const filtered=onRoute.filter(b=>direction==='all'||b.direction===direction);
  // With a stop chosen, nearest first is the order a waiting passenger cares about.
  // Without one, most recently reported first.
  return stop
   ? filtered.map(b=>({...b,metresFromStop:straightLineMetres(stop,b)}))
             .sort((a,b)=>a.metresFromStop!-b.metresFromStop!)
   : filtered.sort((a,b)=>b.observedAtMs-a.observedAtMs);
 },[onRoute,direction,stop]);
 const directions=useMemo(()=>Array.from(new Set(onRoute.map(b=>b.direction).filter(Boolean))),[onRoute]);
 const relations=useMemo(()=>{
  const map=new Map<string,StopRelation>();
  if(stop)for(const bus of shown)map.set(bus.key,relateToStop(bus,stop.id,patternsById));
  return map;
 },[shown,stop,patternsById]);
 // Buses confirmed to be coming to this stop lead, nearest along the route first.
 const ordered=useMemo(()=>{
  if(!stop)return shown;
  const rank=(key:string)=>{
   const relation=relations.get(key);
   if(relation?.kind==='approaching')return [0,relation.stopsAway] as const;
   if(relation?.kind==='at_stop')return [1,0] as const;
   if(relation?.kind==='unresolved'||relation?.kind==='no_pattern_data')return [2,0] as const;
   if(relation?.kind==='passed')return [3,relation.stopsPast] as const;
   return [4,0] as const;
  };
  return [...shown].sort((a,b)=>{
   const ra=rank(a.key),rb=rank(b.key);
   return ra[0]-rb[0]||ra[1]-rb[1];
  });
 },[shown,stop,relations]);
 const selected=ordered.find(b=>b.key===selectedKey)??ordered[0];
 const selectedRelation=selected&&stop?relations.get(selected.key):undefined;
 const servingPatterns=stop?patternsCallingAt(patterns,stop.id):[];

 const current:Favourite|null=route
  ?{operator:route.split('|')[0],route:routeNumber(route),direction}:null;
 const saved=current?isFavourite(favourites,current):false;
 const routeChoices=useMemo(()=>{
  const ids=new Set(availableIds);
  if(route)ids.add(route);                       // a chosen route stays listed when empty
  return Array.from(ids).sort((a,b)=>routeNumber(a).localeCompare(routeNumber(b),undefined,{numeric:true}));
 },[availableIds,route]);

 const copy=MODE[mode];
 const policy=live?.freshness.policy;
 const expiryMinutes=policy?Math.round(policy.observationExpirySeconds/60):15;

 function pick(next:{route:string;direction:string}){setChoice(next);setSelectedKey('');setFollow(false)}

 return <section className="follow">
  <div className={`follow-bar ${copy.tone}`} role="status">
   <span className="follow-badge">{mode==='offline'?<WifiOff size={13}/>:<Radio size={13}/>}{copy.label}</span>
   <span className="follow-bar-when">
    {mode==='archive'?archiveDate
     :publicationAgeSeconds===null?'not published yet'
     :`feed updated ${ageBasis==='device'?'about ':''}${Math.round(publicationAgeSeconds)}s ago`}</span>
   <button className="follow-refresh" onClick={onRefresh} disabled={refreshing}
    aria-label="Check for newer positions"><RefreshCw size={16} className={refreshing?'spin':''}/></button>
  </div>

  {stops.length>0&&(stop
   ? <div className="your-stop">
      <span className="your-stop-mark"><MapPin size={19}/></span>
      <span className="your-stop-copy">
       <strong>{stop.name}</strong>
       <small>{stopDetail(stop)||'No side-of-road detail supplied'}</small>
       {stopPlace(stop)&&<em>{stopPlace(stop)}</em>}
      </span>
      <span className="your-stop-support">{servingPatterns.length>0
       ? `Timetable-supported here: route ${[...new Set(servingPatterns.map(p=>p.line))].slice(0,8).join(', ')}`
       : 'No timetabled pattern for this stop is supported yet, so buses can be shown near it but not confirmed as calling here.'}</span>
      <span className="your-stop-actions">
       <button className={savedStopIds.includes(stop.id)?'on':''}
        aria-pressed={savedStopIds.includes(stop.id)}
        onClick={()=>setBlocked(!saveStops(toggleSavedStop(savedStopIds,stop.id)))}>
        <Star size={15} fill={savedStopIds.includes(stop.id)?'currentColor':'none'}/>
        {savedStopIds.includes(stop.id)?'Saved':'Save'}</button>
       <button onClick={()=>onSelectStop(null)}>Change</button>
      </span>
     </div>
   : <div className="your-stop unset">
      <Nearby stops={stops} patterns={patterns} here={here} outsideArea={outsideArea}
       onSelect={onSelectStop} onLocate={onLocate??(()=>{})} locating={!!locating}
       locationError={locationError} onClearHere={onClearHere} areaLabel="Manchester"/>
      {savedStopIds.length>0&&<div className="stop-chips" style={{marginTop:12}}>
       {savedStopIds.map(id=>{
        const saved=stops.find(s=>s.id===id);
        return saved?<button key={id} className="stop-chip" onClick={()=>onSelectStop(saved)}>
         <MapPin size={14}/><span>{saved.name}{saved.indicator?` · ${saved.indicator}`:''}</span>
        </button>:null;
       })}
      </div>}
     </div>)}

  {buses.length>0&&<div className="follow-pickers">
   <label className="sr-only" htmlFor="follow-route">Route</label>
   <div className="picker route">
    <span>Route</span>
    <select id="follow-route" value={route} onChange={e=>pick({route:e.target.value,direction:'all'})}>
     {routeChoices.map(id=><option key={id} value={id}>{routeNumber(id)}</option>)}
    </select>
   </div>
   <label className="sr-only" htmlFor="follow-direction">Direction</label>
   <div className="picker">
    <span>Direction</span>
    <select id="follow-direction" value={direction} onChange={e=>pick({route,direction:e.target.value})}>
     <option value="all">Both ways</option>
     {directions.map(d=><option key={d} value={d}>{directionLabel(d)}</option>)}
    </select>
   </div>
   <button className={`follow-save ${saved?'on':''}`} aria-pressed={saved}
    aria-label={saved?'Saved on this device':'Save this route on this device'}
    onClick={()=>{if(current)setBlocked(!saveFavourites(toggleFavourite(favourites,current)))}}>
    <Star size={18} fill={saved?'currentColor':'none'}/></button>
  </div>}

  {favourites.length>0&&buses.length>0&&<div className="follow-chips">
   {favourites.map(f=>{
    const id=`${f.operator}|${f.route}`;
    return <button key={favouriteKey(f)} className={`follow-chip ${route===id?'on':''}`}
     onClick={()=>pick({route:id,direction:f.direction})}>
     {f.route}{!availableIds.includes(id)&&<em>no buses</em>}</button>;
   })}
  </div>}
  {blocked&&<p className="follow-hint warn">This device would not let us save the route. It still works for this visit.</p>}

  {(buses.length>0||stop||here)&&(mapFallback
   ? <FollowMap buses={ordered} selected={selected} follow={follow} roads={roads}
      mode={mode} stop={stop} onSelect={setSelectedKey} onManualMove={()=>setFollow(false)}/>
   : <CityMap buses={ordered} selected={selected} stop={stop} here={here} follow={follow}
      onSelect={setSelectedKey} onManualMove={()=>setFollow(false)}
      onUnavailable={()=>setMapFallback(true)} pitched={pitched} onPitchedChange={setPitched}/>)}

  {/* Four different situations, told apart in plain words rather than one vague message. */}
  {mode==='unavailable'&&<div className="follow-empty">
   <Radio size={22}/><h3>No buses are being collected</h3>
   <p>{live?.unavailableReason==='no_credentials_configured'
    ?'This build has no Bus Open Data credentials, so nothing is being collected right now. The recorded sample is complete and you can follow a bus through it instead.'
    :'No live positions have been published yet.'}</p>
   {onUseArchive&&!usingArchive&&<button className="action" onClick={onUseArchive}>
    Follow a bus in the recording</button>}
  </div>}

  {mode!=='unavailable'&&buses.length===0&&<div className="follow-empty">
   <Clock3 size={22}/>
   <h3>{mode==='offline'?'No saved positions on this device'
        :'Every position we hold has passed its cut-off'}</h3>
   <p>{mode==='offline'
    ?'Your browser cannot reach us and there is no copy saved here yet. Positions will appear when you are back online.'
    :`Nothing has reported in the last ${expiryMinutes} minutes, so there is nothing honest to
      draw. This usually means collection has stopped rather than that the buses have.`}</p>
   {mode==='stale'&&<p className="follow-empty-aside">Our collector last published{' '}
    {publicationAgeSeconds===null?'at an unknown time':`${Math.round(publicationAgeSeconds)} seconds ago`}.
    Old positions are withheld rather than shown as if they were current.</p>}
   {onUseArchive&&!usingArchive&&<button className="action" onClick={onUseArchive}>
    Follow a bus in the recording</button>}
  </div>}

  {buses.length>0&&ordered.length===0&&<div className="follow-empty small">
   <Clock3 size={20}/>
   <h3>No buses on route {routeNumber(route)} right now</h3>
   <p>Nothing on this route has reported in the last {expiryMinutes} minutes, so there is
   nothing to show. Your route is still selected — it will reappear on its own.</p>
   {available.length>0&&<div className="follow-suggest">
    <span>Reporting now:</span>
    {available.slice(0,5).map(r=><button key={r.id} onClick={()=>pick({route:r.id,direction:'all'})}>
     {routeNumber(r.id)}<em>{r.count}</em></button>)}
   </div>}
  </div>}

  {selected&&<div className="follow-panel">
   <div className="follow-panel-main">
    <span className="route-pill big">{selected.route}</span>
    <div className="follow-panel-copy">
     <strong>{destinationLabel(selected.destination)}</strong>
     <small>{[directionLabel(selected.direction),
              mode==='archive'?`reported ${clock(selected.observedAtMs,true)}`:selected.ageWords]
             .filter(Boolean).join(' · ')}</small>
     {stop&&<small className="stop-distance">{distanceWords(straightLineMetres(stop,selected))} from your stop</small>}
    </div>
    <button className={`follow-toggle ${follow?'on':''}`} onClick={()=>setFollow(v=>!v)}
     aria-pressed={follow} aria-label={follow?'Stop following this bus':'Keep this bus centred'}>
     <Crosshair size={18}/><span>{follow?'Following':'Follow'}</span></button>
   </div>
   {stop&&selectedRelation&&<p className={`follow-relation ${selectedRelation.kind}`}>
    <strong>{relationWords(selectedRelation)}</strong>
    {selectedRelation.kind==='approaching'&&
     <span> · {alongRouteWords(selectedRelation.alongRouteMetres)} · counted from the
      timetabled stop order, so it can be out by a stop either way, and it is not a time</span>}
    {selectedRelation.kind==='does_not_call'&&
     <span> · it is running {selectedRelation.pattern.destination||'another branch'}, which
      does not include your stop</span>}
    {selectedRelation.kind==='unresolved'&&<span> · {selectedRelation.explanation}</span>}
    {selectedRelation.kind==='no_pattern_data'&&
     <span> · no timetable pattern is held for this route, so its relationship to your stop
      is unknown</span>}
   </p>}
   {mode!=='archive'&&selected.freshness==='stale'&&<p className="follow-panel-warn">
    This bus has not reported for a while. It may have finished its journey, lost signal, or
    be in a spot with no coverage — we cannot tell which, so we show the last report and its age.</p>}
   {follow&&<p className="follow-panel-note">The map stays centred on this bus. It moves when a
    new position is reported, not in between. Drag the map to explore and following stops.</p>}

   <button className="follow-details-toggle" aria-expanded={details}
    onClick={()=>setDetails(v=>!v)}>
    <ChevronDown size={15} className={details?'open':''}/>Where this position came from</button>
   {details&&<dl className="follow-details">
    <div><dt>The bus reported at</dt><dd>{clock(selected.observedAtMs,true)}
     <small>{selected.recordedAt}</small></dd></div>
    <div><dt>Position</dt><dd className="mono">{selected.lat.toFixed(5)}, {selected.lon.toFixed(5)}</dd></div>
    <div><dt>Checks it passed</dt><dd>Timestamp carried a time zone; coordinates inside
     Manchester; identity complete; not a repeat of a position we already held; no other
     source disagreed about where it was.</dd></div>
    <div><dt>Age measured against</dt><dd>{ageBasis==='server'
     ? 'our clock, taken from the response that carried this position'
     : 'this device’s clock, because the server time was not readable — the age may read older than it is, never newer'}</dd></div>
    <div><dt>Shown because</dt><dd>{mode==='archive'
     ?'It is the last position for this bus in the recording.'
     :`It is the newest report for this bus and is under the ${expiryMinutes}-minute cut-off.`}</dd></div>
   </dl>}
   {details&&<button className="text-action" onClick={onOpenEvidence}>
    Source file, fingerprint and full observation table in Evidence</button>}
  </div>}

  {stop&&servingPatterns.length>0&&<div className="services">
   <p className="follow-list-head">Confirmed to call at this stop</p>
   {[...new Map(servingPatterns.map(p=>[`${p.line}|${p.direction??''}|${p.destination??''}`,p])).values()]
    .slice(0,8).map(pattern=>{
     const running=buses.filter(b=>b.route===pattern.line);
     const key=`${pattern.line}|${pattern.direction}|${pattern.destination}`;
     return <button key={key} className={`service-row ${routeNumber(route)===pattern.line?'on':''}`}
       onClick={()=>{const found=available.find(r=>routeNumber(r.id)===pattern.line);
                     if(found)pick({route:found.id,direction:'all'})}}
       disabled={!available.some(r=>routeNumber(r.id)===pattern.line)}>
      <span className="route-pill">{pattern.line}</span>
      <span className="service-copy">
       <strong>{pattern.destination||'Destination not named in the timetable'}</strong>
       <small>{directionLabel(pattern.direction??'')||'Direction not stated'}</small></span>
      <span className={`service-state ${running.length?'reporting':'quiet'}`}>
       {running.length?`${running.length} reporting`:'none reporting now'}</span>
     </button>;
    })}
   <p className="services-note">These services are confirmed by the timetable to call here.
   A service with nothing reporting has not gone away; we simply hold no current position
   for it.</p>
  </div>}

  {ordered.length>1&&<div className="follow-list">
   <p className="follow-list-head">{stop
    ? `Route ${routeNumber(route)} — other buses`
    : `Other buses on route ${routeNumber(route)}`}</p>
   {ordered.filter(bus=>bus.key!==selected?.key).map(bus=><button key={bus.key} onClick={()=>{setSelectedKey(bus.key);setFollow(false)}}
     className={`follow-row ${bus.key===selected?.key?'on':''}`} aria-pressed={bus.key===selected?.key}>
    <span className="route-pill">{bus.route}</span>
    <span className="follow-row-copy">
     <strong>{destinationLabel(bus.destination)}</strong>
     <small>{[directionLabel(bus.direction),
              stop?relationWords(relations.get(bus.key)??{kind:'no_pattern_data'}):''
             ].filter(Boolean).join(' · ')}</small></span>
    {mode==='archive'
     ?<span className="fresh-chip archive">{clock(bus.observedAtMs,true)}</span>
     :<span className={`fresh-chip ${bus.freshness??'unknown'}`}>{bus.ageWords.replace('reported ','')}</span>}
   </button>)}
  </div>}

  {stop&&(()=>{
   const unconfirmed=ordered.filter(bus=>{
    const relation=relations.get(bus.key);
    return relation&&(relation.kind==='does_not_call'||relation.kind==='unresolved'
                      ||relation.kind==='no_pattern_data');
   });
   if(!unconfirmed.length)return null;
   return <details className="exploring">
    <summary>Nearby but not confirmed for your stop ({unconfirmed.length})</summary>
    <p>These are real reported buses near you. The timetable does not place them as calling
    at your stop, so they are kept out of the boarding options above rather than guessed at.</p>
    {unconfirmed.slice(0,8).map(bus=><div key={bus.key} className="exploring-row">
     <span className="route-pill">{bus.route}</span>
     <span><strong>{destinationLabel(bus.destination)}</strong>
      <small>{relationWords(relations.get(bus.key)??{kind:'no_pattern_data'})}</small></span>
    </div>)}
   </details>;
  })()}

  <details className="how-it-works">
   <summary>How this works</summary>
   <ol>
    <li><strong>A bus reports.</strong> Its equipment sends a position with its own timestamp.
     Operators must do this every 10 to 30 seconds.</li>
    <li><strong>We ask once, for everyone.</strong> One collector reads the feed every
     {' '}{policy?policy.pollIntervalSeconds:20} seconds. Your phone never contacts the data
     service, and an identical response is recorded as a repeat rather than treated as news.</li>
    <li><strong>Every report is checked.</strong> A timestamp without a time zone, a
     coordinate we cannot read, or a position dated in the future is set aside with its
     reason instead of being cleaned up. If two sources disagree about one bus, we show
     neither and say so.</li>
    <li><strong>Only checked data is published.</strong> The map reads one small published
     file. If a publication fails its checks, the previous good one keeps serving.</li>
   </ol>
   <p>Nothing here is a prediction. We never draw where a bus probably is, and we never
   promise a bus is where the dot is now — only where it said it was, and when.</p>
  </details>

  <ul className="follow-notes">
   {mode==='archive'
    ? <li>This is a recording, so nothing here expires. Times are when each bus reported on
      the day, not how long ago that was.</li>
    : <li>Positions older than {expiryMinutes} minutes are withheld{live
      ?`: ${live.withheld.expiredPositions} withheld in the current state`:''}. The feed does
      carry very old positions, so this cut-off is doing real work.</li>}
   <li>No arrival times, nearby stops or waiting times are shown. Those need a validated
    route and stop relationship, which we have not established.</li>
  </ul>
 </section>;
}
