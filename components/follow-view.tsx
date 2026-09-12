"use client";

import {useMemo,useState,useSyncExternalStore} from 'react';
import {BusFront,Crosshair,Info,Radio,RefreshCw,Star,WifiOff} from 'lucide-react';
import {boundsOf,fitProjection} from '@/lib/geo';
import {ageWords,Favourite,FeedMode,favouriteKey,favouritesServerSnapshot,favouritesSnapshot,
        Freshness,freshnessOf,isFavourite,LiveState,observationAge,saveFavourites,
        subscribeFavourites,toggleFavourite} from '@/lib/live';
import {clock,cleanLabel,Journey,RoadMap} from '@/lib/replay';

const W=760,H=760;

// Fixed reference points, for orientation only. Not stops, and not used in any measurement.
const PLACES:[string,number,number][]=[
 ['CITY CENTRE',-2.2410,53.4808],['HULME',-2.2490,53.4650],['RUSHOLME',-2.2240,53.4550],
 ['FALLOWFIELD',-2.2200,53.4410],['DIDSBURY',-2.2310,53.4180],['OLD TRAFFORD',-2.2830,53.4620],
 ['SALFORD',-2.2900,53.4830],['CHORLTON',-2.2720,53.4430],['ANCOATS',-2.2200,53.4840],
];

/** One bus as this view needs it, whether it came from the live feed or the archive. */
export type FollowBus = {
 key:string;operator:string;route:string;direction:string;journeyRef:string;vehicle:string;
 destination:string;lat:number;lon:number;observedAtMs:number;recordedAt:string;
 ageSeconds:number|null;freshness:Freshness|null;sourceHash:string;
};

const MODE_COPY:Record<FeedMode,{label:string;tone:string;detail:string}>={
 live:{label:'LIVE',tone:'live',detail:'Positions as last reported by the buses themselves.'},
 stale:{label:'NOT UPDATING',tone:'warn',detail:'The collector has not published recently. These are the last positions we hold.'},
 offline:{label:'OFFLINE',tone:'warn',detail:'Showing data saved on this device, with the times it was originally reported.'},
 unavailable:{label:'NOT COLLECTING',tone:'idle',detail:'No live collection is running, so there are no current positions.'},
 archive:{label:'ARCHIVE REPLAY',tone:'archive',detail:'A recording from 11 September 2026. Times shown are when each bus actually reported.'},
};

function FreshnessChip({value,age}:{value:Freshness|null;age:number|null}){
 if(value===null)return null;
 return <span className={`fresh-chip ${value}`}>{ageWords(age)}</span>;
}

function FollowMap({buses,selected,follow,roads,onSelect,mode}:{
 buses:FollowBus[];selected?:FollowBus;follow:boolean;roads:RoadMap|null;
 onSelect:(key:string)=>void;mode:FeedMode}){
 const bounds=useMemo(()=>{
  if(follow&&selected)return boundsOf([selected],3.5);
  return boundsOf(buses.length?buses:[{lat:53.4808,lon:-2.2426}],0.25);
 },[buses,selected,follow]);
 const projector=useMemo(()=>bounds?fitProjection(bounds,W,H):null,[bounds]);
 const roadPaths=useMemo(()=>{
  if(!projector||!roads)return null;
  const {west,east,south,north}=projector.bounds;
  return roads.roads.map((road,i)=>{
   const inView=road.points.some(([lon,lat])=>lon>=west&&lon<=east&&lat>=south&&lat<=north);
   if(!inView)return null;
   return <polyline key={i} points={road.points.map(([lon,lat])=>projector.project(lon,lat).join(',')).join(' ')}
    fill="none" stroke={road.kind==='motorway'?'#3d5564':'#283d4b'}
    strokeWidth={road.kind==='motorway'?3.4:road.kind==='primary'?2.4:1.2}
    strokeLinecap="round" strokeLinejoin="round"/>;
  });
 },[projector,roads]);
 if(!projector)return <div className="follow-map empty">No positions to place on the map.</div>;
 return <div className="follow-map">
  <svg viewBox={`0 0 ${W} ${H}`} role="img"
   aria-label={`Map of ${buses.length} last reported bus positions. Select a bus to follow it.`}>
   <defs><pattern id="follow-grid" width="64" height="64" patternUnits="userSpaceOnUse">
    <path d="M64 0H0V64" fill="none" stroke="#1d3140" strokeWidth=".6"/></pattern></defs>
   <rect width={W} height={H} fill="url(#follow-grid)"/>
   {roadPaths}
   {PLACES.filter(([,lon,lat])=>{
     // Inset, so a label never lands half-off the edge of the map.
     const {west,east,south,north}=projector.bounds;
     const insetX=(east-west)*0.08,insetY=(north-south)*0.06;
     return lon>=west+insetX&&lon<=east-insetX&&lat>=south+insetY&&lat<=north-insetY;
    }).map(([label,lon,lat])=>{
    const [x,y]=projector.project(lon,lat);
    return <text key={label} x={x} y={y} textAnchor="middle" className="place-label">{label}</text>;
   })}
   {buses.map(bus=>{
    const [x,y]=projector.project(bus.lon,bus.lat);
    const active=bus.key===selected?.key;
    const dim=bus.freshness==='stale'||bus.freshness==='ageing';
    return <g key={bus.key} className="bus-marker" tabIndex={0} role="button"
      aria-label={`${bus.route} to ${bus.destination||'unknown destination'}, ${ageWords(bus.ageSeconds)}`}
      onClick={()=>onSelect(bus.key)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' ')onSelect(bus.key)}}>
     {active&&<circle cx={x} cy={y} r={18} className="bus-halo"/>}
     <circle cx={x} cy={y} r={active?9:6.5}
      fill={active?'#c6f36a':dim?'#7e98a6':'#8fd0e4'} stroke="#0d1b26" strokeWidth={2}/>
     {active&&<text x={x+15} y={y+4} className="bus-marker-label">{bus.route}</text>}
    </g>;
   })}
  </svg>
  <div className="follow-map-foot">
   <span className={`mode-dot ${MODE_COPY[mode].tone}`}/>
   <span>Last reported positions · not continuous tracking</span>
  </div>
 </div>;
}

export default function FollowView({mode,live,buses,roads,onRefresh,refreshing,
                                    publicationAgeSeconds,archiveDate,onUseArchive,usingArchive}:{
 mode:FeedMode;live:LiveState|null;buses:FollowBus[];roads:RoadMap|null;
 onRefresh:()=>void;refreshing:boolean;publicationAgeSeconds:number|null;
 archiveDate?:string;onUseArchive?:()=>void;usingArchive:boolean}){
 // The saved routes live on the device, so they are read through an external store
 // rather than copied into state by an effect.
 const favourites=useSyncExternalStore(subscribeFavourites,favouritesSnapshot,favouritesServerSnapshot);
 const [storageBlocked,setStorageBlocked]=useState(false);
 const [choice,setChoice]=useState<{route:string;direction:string}|null>(null);
 const [selectedKey,setSelectedKey]=useState('');
 const [follow,setFollow]=useState(false);

 const routes=useMemo(()=>Array.from(new Set(buses.map(b=>`${b.operator}|${b.route}`)))
  .sort((a,b)=>a.split('|')[1].localeCompare(b.split('|')[1],undefined,{numeric:true})),[buses]);

 // A saved route that is actually on the road wins. Failing that, the route carrying the
 // most recently reported bus, which is more useful than whichever sorts first.
 // Derived, never stored, so arriving positions cannot fight the user's selection.
 const fallback=useMemo(()=>{
  const saved=favourites.find(f=>routes.includes(`${f.operator}|${f.route}`));
  if(saved)return {route:`${saved.operator}|${saved.route}`,direction:saved.direction};
  const newest=buses.reduce<FollowBus|null>((best,b)=>!best||b.observedAtMs>best.observedAtMs?b:best,null);
  return {route:newest?`${newest.operator}|${newest.route}`:(routes[0]??''),direction:'all'};
 },[favourites,routes,buses]);
 const active=choice&&routes.includes(choice.route)?choice:fallback;
 const {route,direction}=active;

 const shown=useMemo(()=>buses
  .filter(b=>(!route||`${b.operator}|${b.route}`===route)&&(direction==='all'||b.direction===direction))
  .sort((a,b)=>b.observedAtMs-a.observedAtMs),[buses,route,direction]);
 const selected=shown.find(b=>b.key===selectedKey)??shown[0];
 const directions=useMemo(()=>Array.from(new Set(
  buses.filter(b=>!route||`${b.operator}|${b.route}`===route).map(b=>b.direction).filter(Boolean))),[buses,route]);

 const current:Favourite|null=route?{operator:route.split('|')[0],route:route.split('|')[1],direction}:null;
 const saved=current?isFavourite(favourites,current):false;
 function toggleSaved(){
  if(!current)return;
  setStorageBlocked(!saveFavourites(toggleFavourite(favourites,current)));
 }

 const copy=MODE_COPY[mode];
 return <section className="follow">
  <div className={`follow-status ${copy.tone}`} role="status">
   <div className="follow-status-head">
    <span className="follow-badge">{mode==='offline'?<WifiOff size={13}/>:<Radio size={13}/>}{copy.label}</span>
    {mode==='archive'&&archiveDate&&<span className="follow-status-date">{archiveDate}</span>}
    {mode!=='archive'&&mode!=='unavailable'&&<span className="follow-status-date">
     {publicationAgeSeconds===null?'never published':`state written ${Math.round(publicationAgeSeconds)}s ago`}</span>}
    <button className="follow-refresh" onClick={onRefresh} disabled={refreshing}
     aria-label="Check for a newer published state">
     <RefreshCw size={15} className={refreshing?'spin':''}/></button>
   </div>
   <p>{copy.detail}</p>
  </div>

  {mode==='unavailable'&&<div className="follow-empty">
   <Radio size={24}/>
   <h3>Live collection is not running</h3>
   <p>{live?.unavailableReason==='no_credentials_configured'
    ?'This build has no Bus Open Data credentials, so nothing is being collected. The recorded sample is complete and can be explored instead.'
    :'No live positions have been published yet.'}</p>
   {onUseArchive&&!usingArchive&&<button className="action" onClick={onUseArchive}>
    Follow a bus in the recorded sample</button>}
  </div>}

  {buses.length>0&&<>
   <div className="follow-controls">
    <div className="follow-saved">
     <span className="follow-label"><Star size={13}/> Saved</span>
     {favourites.length===0
      ?<span className="follow-hint">Save a route to bring it back first next time.</span>
      :<div className="follow-chips">{favourites.map(f=>{
        const key=`${f.operator}|${f.route}`;
        const available=routes.includes(key);
        return <button key={favouriteKey(f)} disabled={!available}
         className={`follow-chip ${route===key&&direction===f.direction?'on':''}`}
         onClick={()=>{setChoice({route:key,direction:f.direction});setSelectedKey('')}}
         title={available?undefined:'No positions for this route right now'}>
         {f.route}<small>{f.direction==='all'?'both ways':f.direction}</small></button>;
       })}</div>}
    </div>
    <div className="follow-pickers">
     <label className="sr-only" htmlFor="follow-route">Route</label>
     <select id="follow-route" value={route} onChange={e=>{setChoice({route:e.target.value,direction});setSelectedKey('')}}>
      {routes.map(r=><option key={r} value={r}>Route {r.split('|')[1]} · {r.split('|')[0]}</option>)}
     </select>
     <label className="sr-only" htmlFor="follow-direction">Direction</label>
     <select id="follow-direction" value={direction} onChange={e=>{setChoice({route,direction:e.target.value});setSelectedKey('')}}>
      <option value="all">Both directions</option>
      {directions.map(d=><option key={d} value={d}>{cleanLabel(d)}</option>)}
     </select>
     <button className={`follow-save ${saved?'on':''}`} onClick={toggleSaved}
      aria-pressed={saved}><Star size={16} fill={saved?'currentColor':'none'}/>{saved?'Saved':'Save'}</button>
    </div>
    {storageBlocked&&<p className="follow-hint warn">This device would not let us save the
     route. It will still work for this visit.</p>}
   </div>

   <FollowMap buses={shown} selected={selected} follow={follow} roads={roads} mode={mode}
    onSelect={setSelectedKey}/>

   {selected&&<div className="follow-selected">
    <div className="follow-selected-head">
     <div>
      <span className="route-pill big">{selected.route}</span>
      <strong>{cleanLabel(selected.destination)||'Destination not supplied'}</strong>
      <small>{selected.vehicle} · {selected.operator}</small>
     </div>
     <button className={`follow-toggle ${follow?'on':''}`} onClick={()=>setFollow(v=>!v)}
      aria-pressed={follow}><Crosshair size={16}/>{follow?'Following':'Follow'}</button>
    </div>
    <dl>
     <div><dt>Last reported</dt><dd>{mode==='archive'
      ?`${clock(selected.observedAtMs,true)} on the recording`
      :ageWords(selected.ageSeconds)}</dd></div>
     <div><dt>Reported at</dt><dd className="mono">{selected.recordedAt}</dd></div>
     <div><dt>Position</dt><dd className="mono">{selected.lat.toFixed(5)}, {selected.lon.toFixed(5)}</dd></div>
    </dl>
    {follow&&<p className="follow-note"><Info size={14}/> The map is centred on this bus. The
     view moves when a new position is reported, not in between.</p>}
   </div>}

   <div className="follow-list">
    <div className="follow-list-head"><BusFront size={16}/>
     <h3>{shown.length} {shown.length===1?'bus':'buses'} on route {route.split('|')[1]}</h3></div>
    {shown.map(bus=><button key={bus.key} onClick={()=>setSelectedKey(bus.key)}
      className={`follow-row ${bus.key===selected?.key?'on':''}`} aria-pressed={bus.key===selected?.key}>
     <span className="route-pill">{bus.route}</span>
     <span className="follow-row-copy">
      <strong>{cleanLabel(bus.destination)||'Destination not supplied'}</strong>
      <small>{bus.vehicle}{bus.direction?` · ${cleanLabel(bus.direction)}`:''}</small></span>
     {mode==='archive'
      ?<span className="fresh-chip archive">{clock(bus.observedAtMs,true)}</span>
      :<FreshnessChip value={bus.freshness} age={bus.ageSeconds}/>}
    </button>)}
   </div>
  </>}

  <ul className="follow-notes">
   <li>A position is where a bus said it was, when it said it. It is not where the bus is now.</li>
   {mode!=='archive'&&live&&<li>Positions older than {Math.round(live.freshness.policy.observationExpirySeconds/60)} minutes
    are withheld: {live.withheld.expiredPositions} withheld in the current state.</li>}
   <li>No arrival times or nearby stops are shown. That needs a validated route and stop
    relationship, which we have not established.</li>
   {live?.collection.sharedCollector&&mode!=='archive'&&<li>One shared collector reads the
    feed for everyone. Your phone never contacts the data service.</li>}
  </ul>
 </section>;
}

/** Latest reported position per vehicle from the live state. */
export function busesFromLive(live:LiveState|null,fetchedAtMs:number,nowMs:number):FollowBus[]{
 if(!live)return [];
 return live.vehicles.map(v=>{
  const age=observationAge(v,live,fetchedAtMs,nowMs);
  return {key:`${v.operator}|${v.vehicle}`,operator:v.operator,vehicle:v.vehicle,route:v.route,
   direction:v.direction,journeyRef:v.journeyRef,destination:v.destination??'',
   lat:v.lat,lon:v.lon,observedAtMs:v.observedAtMs,recordedAt:v.recordedAt,
   ageSeconds:age,freshness:freshnessOf(age,live.freshness.policy),sourceHash:v.sourceHash};
 }).filter(b=>b.freshness!=='expired');
}

/** Last reported position per vehicle in the recording. Ages are deliberately absent:
 *  "3 minutes ago" would be a lie about a recording made on another day. */
export function busesFromArchive(journeys:Journey[]):FollowBus[]{
 const latest=new Map<string,FollowBus>();
 for(const journey of journeys){
  const point=journey.points.at(-1);
  if(!point)continue;
  const key=`${journey.operator}|${journey.vehicle}`;
  const existing=latest.get(key);
  if(existing&&existing.observedAtMs>=point.time)continue;
  latest.set(key,{key,operator:journey.operator,vehicle:journey.vehicle,route:journey.route,
   direction:journey.direction,journeyRef:journey.journeyRef,destination:journey.destination,
   lat:point.lat,lon:point.lon,observedAtMs:point.time,recordedAt:point.recordedAt,
   ageSeconds:null,freshness:null,sourceHash:point.sourceHash});
 }
 return Array.from(latest.values());
}
