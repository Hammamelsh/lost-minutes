"use client";

import {useMemo,useState,useSyncExternalStore} from 'react';
import {ChevronDown,Clock3,Crosshair,Radio,RefreshCw,Star,WifiOff} from 'lucide-react';
import FollowMap from '@/components/follow-map';
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
                                    usingArchive,onOpenEvidence}:{
 mode:FeedMode;live:LiveState|null;buses:FollowBus[];roads:import('@/lib/replay').RoadMap|null;
 onRefresh:()=>void;refreshing:boolean;publicationAgeSeconds:number|null;
 ageBasis:'server'|'device';archiveDate?:string;onUseArchive?:()=>void;usingArchive:boolean;
 onOpenEvidence:()=>void}){
 const favourites=useSyncExternalStore(subscribeFavourites,favouritesSnapshot,favouritesServerSnapshot);
 const [blocked,setBlocked]=useState(false);
 const [choice,setChoice]=useState<{route:string;direction:string}|null>(null);
 const [selectedKey,setSelectedKey]=useState('');
 const [follow,setFollow]=useState(false);
 const [details,setDetails]=useState(false);

 const available=useMemo(()=>routesByRecency(buses),[buses]);
 const availableIds=useMemo(()=>available.map(r=>r.id),[available]);

 // The user's choice is kept even when its buses disappear. We never switch route silently.
 const fallback=useMemo(()=>{
  const saved=favourites.find(f=>availableIds.includes(`${f.operator}|${f.route}`));
  if(saved)return {route:`${saved.operator}|${saved.route}`,direction:saved.direction};
  return {route:available[0]?.id??'',direction:'all'};
 },[favourites,available,availableIds]);
 const active=choice??fallback;
 const {route,direction}=active;

 const onRoute=useMemo(()=>buses.filter(b=>routeId(b)===route),[buses,route]);
 const shown=useMemo(()=>onRoute
  .filter(b=>direction==='all'||b.direction===direction)
  .sort((a,b)=>b.observedAtMs-a.observedAtMs),[onRoute,direction]);
 const directions=useMemo(()=>Array.from(new Set(onRoute.map(b=>b.direction).filter(Boolean))),[onRoute]);
 const selected=shown.find(b=>b.key===selectedKey)??shown[0];

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

  {buses.length>0&&<FollowMap buses={shown} selected={selected} follow={follow} roads={roads}
   mode={mode} onSelect={setSelectedKey} onManualMove={()=>setFollow(false)}/>}

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

  {buses.length>0&&shown.length===0&&<div className="follow-empty small">
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
    </div>
    <button className={`follow-toggle ${follow?'on':''}`} onClick={()=>setFollow(v=>!v)}
     aria-pressed={follow} aria-label={follow?'Stop following this bus':'Keep this bus centred'}>
     <Crosshair size={18}/><span>{follow?'Following':'Follow'}</span></button>
   </div>
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

  {shown.length>1&&<div className="follow-list">
   <p className="follow-list-head">Other buses on route {routeNumber(route)}</p>
   {shown.filter(bus=>bus.key!==selected?.key).map(bus=><button key={bus.key} onClick={()=>{setSelectedKey(bus.key);setFollow(false)}}
     className={`follow-row ${bus.key===selected?.key?'on':''}`} aria-pressed={bus.key===selected?.key}>
    <span className="route-pill">{bus.route}</span>
    <span className="follow-row-copy">
     <strong>{destinationLabel(bus.destination)}</strong>
     <small>{directionLabel(bus.direction)}</small></span>
    {mode==='archive'
     ?<span className="fresh-chip archive">{clock(bus.observedAtMs,true)}</span>
     :<span className={`fresh-chip ${bus.freshness??'unknown'}`}>{bus.ageWords.replace('reported ','')}</span>}
   </button>)}
  </div>}

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
