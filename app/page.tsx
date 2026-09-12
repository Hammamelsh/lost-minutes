"use client";

import {useCallback,useEffect,useMemo,useState} from 'react';
import Link from 'next/link';
import {ArrowDown,ArrowUpRight,BusFront,Check,Clock3,Database,ExternalLink,Focus,Info,Layers3,LoaderCircle,MapPin,Minus,Pause,Play,Plus,RotateCcw,Route,ShieldCheck,Activity,Navigation} from 'lucide-react';
import {Slider} from '@/components/ui/slider';
import {Select,SelectContent,SelectItem,SelectTrigger,SelectValue} from '@/components/ui/select';
import {Tabs,TabsContent,TabsList,TabsTrigger} from '@/components/ui/tabs';
import {Table,TableBody,TableCell,TableHead,TableHeader,TableRow} from '@/components/ui/table';
import {cleanLabel,clock,gaps,Journey,lastObservation,latestVisible,percentile,parseReplay,parseRoadMap,Replay,RoadMap,routeKey,visibleJourneys} from '@/lib/replay';
import {Operations,parseOperations} from '@/lib/operations';
import OperationsView from '@/components/operations-view';
import FollowView from '@/components/follow-view';
import {busesFromArchive,busesFromLive} from '@/lib/follow';
import {DEFAULT_CONFIG,feedMode,LiveState,parseConfig,parseLive,publicationAge,serverReference,SiteConfig} from '@/lib/live';
import {nearestStops,parseCatalogue,type Catalogue,type Stop} from '@/lib/stops';
import {parsePatterns,patternIndex,type PatternCatalogue} from '@/lib/patterns';

const MAP_W=950,MAP_H=780;
function project(lon:number,lat:number){const cos=Math.cos(53.47*Math.PI/180);const scale=Math.min(MAP_W/(.12*cos),MAP_H/.09);return [MAP_W/2+(lon+2.24)*cos*scale,MAP_H/2-(lat-53.465)*scale];}
function line(points:{lon:number;lat:number}[]){return points.map(p=>project(p.lon,p.lat).join(',')).join(' ');}

function MapView({journeys,time,selected,choose,roads}:{journeys:Journey[];time:number;selected:string;choose:(id:string)=>void;roads:RoadMap|null}){
 const [zoom,setZoom]=useState(1);
 const selectedJourney=journeys.find(j=>j.id===selected);
 const center=selectedJourney?lastObservation(selectedJourney,time):undefined;
 const [cx,cy]=center?project(center.lon,center.lat):[MAP_W/2,MAP_H/2];
 const vw=MAP_W/zoom,vh=MAP_H/zoom;
 const viewBox=zoom===1?`0 0 ${MAP_W} ${MAP_H}`:`${Math.max(0,Math.min(MAP_W-vw,cx-vw/2))} ${Math.max(0,Math.min(MAP_H-vh,cy-vh/2))} ${vw} ${vh}`;
 const roadElements=useMemo(()=>roads?.roads.map((road,i)=><polyline key={i} points={road.points.map(p=>project(p[0],p[1]).join(',')).join(' ')} fill="none" stroke={road.kind==='motorway'?'#3d5564':'#293e4c'} strokeWidth={road.kind==='motorway'?4:road.kind==='primary'?3:1.6} strokeLinecap="round" strokeLinejoin="round"/>),[roads]);
 const places=[['CITY CENTRE',-2.241,53.483],['HULME',-2.249,53.465],['RUSHOLME',-2.224,53.455],['FALLOWFIELD',-2.22,53.441],['OLD TRAFFORD',-2.283,53.462]] as const;
 return <div className="map-surface">
   <div className="map-top"><span><MapPin size={15}/> Manchester</span><span className="map-top-note">Recorded positions</span></div>
   <svg viewBox={viewBox} className="city-map" aria-label="Map of recorded bus positions in Manchester. Select a bus to inspect its observations.">
    <defs><pattern id="grid" width="70" height="70" patternUnits="userSpaceOnUse"><path d="M70 0H0V70" fill="none" stroke="#203440" strokeWidth=".65"/></pattern></defs>
    <rect width={MAP_W} height={MAP_H} fill="url(#grid)"/>{roadElements}
    {places.map(([name,lon,lat])=>{const [x,y]=project(lon,lat);return <text key={name} x={x} y={y} textAnchor="middle" className="place-label">{name}</text>})}
    {journeys.map(j=>{const points=j.points.filter(p=>p.time<=time);const active=j.id===selected;return points.length>1?<polyline key={j.id} points={line(points)} fill="none" stroke={active?'#c6f36a':'#72a9bc'} strokeWidth={active?4:1.5} opacity={active?0.95:0.28} strokeDasharray="5 6" strokeLinecap="round" strokeLinejoin="round"/>:null})}
    {visibleJourneys(journeys,time).map(j=>{const p=latestVisible(j,time);if(!p)return null;const [x,y]=project(p.lon,p.lat);const active=j.id===selected;return <g key={j.id} transform={`translate(${x} ${y})`} role="button" tabIndex={0} aria-label={`Bus ${j.vehicle}, route ${j.route}, ${clock(p.time,true)}. Inspect journey.`} aria-pressed={active} onClick={()=>choose(j.id)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose(j.id)}}} className="bus-marker"><circle r={23} fill="transparent"/>{active&&<circle r={21} fill="#c6f36a" fillOpacity=".12" stroke="#c6f36a" strokeOpacity=".45"/>}<circle r={active?9:6} fill={active?'#c6f36a':'#a5d5e0'} stroke="#101d28" strokeWidth="3"/>{active&&<g transform="translate(17 -33)"><rect width="80" height="29" rx="7" fill="#c6f36a"/><text x="40" y="19" textAnchor="middle" fill="#14200e" fontSize="14" fontWeight="700">{j.route} · {j.vehicle.slice(-3)}</text></g>}</g>})}
   </svg>
   {!roads&&<span className="map-fallback">Position plot · street layer unavailable</span>}
   <div className="map-tools"><button onClick={()=>setZoom(z=>Math.min(2.5,z+.5))} aria-label="Zoom in on selected bus"><Plus size={19}/></button><button onClick={()=>setZoom(z=>Math.max(1,z-.5))} aria-label="Zoom out"><Minus size={19}/></button><button onClick={()=>setZoom(1)} aria-label="Show full area"><Focus size={19}/></button></div>
   <div className="map-legend"><span><i className="legend-dot"/> Last observed position</span><span><i className="legend-line"/> Observation trail</span></div>
   <a className="map-credit" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>
 </div>
}

export default function Home(){
 const [data,setData]=useState<Replay|null>(null),[roads,setRoads]=useState<RoadMap|null>(null),[error,setError]=useState('');
 const [ops,setOps]=useState<Operations|null>(null),[opsError,setOpsError]=useState('');
 const [config,setConfig]=useState<SiteConfig>(DEFAULT_CONFIG);
 const [live,setLive]=useState<LiveState|null>(null),[liveFetchedAt,setLiveFetchedAt]=useState(0);
 const [serverRef,setServerRef]=useState(0),[ageBasis,setAgeBasis]=useState<'server'|'device'>('server');
 const [fromCache,setFromCache]=useState(false),[online,setOnline]=useState(true);
 const [refreshing,setRefreshing]=useState(false),[usingArchive,setUsingArchive]=useState(false);
 const [catalogue,setCatalogue]=useState<Catalogue|null>(null);
 const [patterns,setPatterns]=useState<PatternCatalogue|null>(null);
 const [stop,setStop]=useState<Stop|null>(null);
 const [locating,setLocating]=useState(false),[locationError,setLocationError]=useState('');
 const [nowMs,setNowMs]=useState(0);
 const [route,setRoute]=useState('BNML|142'),[direction,setDirection]=useState('inbound'),[selected,setSelected]=useState('');
 const [offset,setOffset]=useState(0),[playing,setPlaying]=useState(false),[tab,setTab]=useState('follow');
 useEffect(()=>{const abort=new AbortController();fetch('/data/replay.json',{signal:abort.signal}).then(r=>{if(!r.ok)throw Error('The recorded sample could not be loaded.');return r.json()}).then(value=>{const d=parseReplay(value);setData(d);setOffset(Math.min(300,Math.floor((d.end-d.start)/1000)));if(!d.journeys.some((j:Journey)=>routeKey(j)==='BNML|142')){setRoute(routeKey(d.journeys[0]));setDirection('all')}}).catch(e=>{if(e.name!=='AbortError')setError(e.message)});fetch('/data/roads.json',{signal:abort.signal}).then(r=>r.ok?r.json():null).then(value=>setRoads(value?parseRoadMap(value):null)).catch(()=>{});fetch('/data/stops.json',{signal:abort.signal}).then(r=>r.ok?r.json():null)
 .then(value=>{if(value)setCatalogue(parseCatalogue(value))}).catch(()=>{});
 fetch('/data/patterns.json',{signal:abort.signal}).then(r=>r.ok?r.json():null)
 .then(value=>{if(value)setPatterns(parsePatterns(value))}).catch(()=>{});
 fetch('/data/operations.json',{signal:abort.signal}).then(r=>{if(!r.ok)throw Error('No pipeline record has been published yet.');return r.json()}).then(value=>setOps(parseOperations(value))).catch(e=>{if(e.name!=='AbortError')setOpsError('The pipeline record could not be read: '+e.message)});return()=>abort.abort()},[]);
 // Published state is polled; the page never contacts the data service itself.
 const loadLive=useCallback(async(target:string)=>{
  setRefreshing(true);
  try{
   const response=await fetch(`${target}${target.includes('?')?'&':'?'}t=${Date.now()}`,{cache:'no-store'});
   if(!response.ok)throw Error(`live state unavailable (${response.status})`);
   const cached=response.headers.get('X-Lost-Minutes-From-Cache')==='1';
   const headerDate=response.headers.get('Date'),headerAge=response.headers.get('Age');
   const value=parseLive(await response.json());
   const reference=serverReference(headerDate,headerAge,value,Date.now());
   setLive(value);setFromCache(cached);setServerRef(reference.serverReferenceMs);
   setAgeBasis(reference.basis);
   setLiveFetchedAt(Date.now());setNowMs(Date.now());
  }catch{
   setFromCache(true);
  }finally{setRefreshing(false)}
 },[]);

 useEffect(()=>{
  let cancelled=false;
  fetch('/data/config.json',{cache:'no-store'}).then(r=>r.ok?r.json():null)
   .then(value=>{if(cancelled)return;const next=value?parseConfig(value):DEFAULT_CONFIG;setConfig(next);return loadLive(next.liveUrl)})
   .catch(()=>{if(!cancelled)loadLive(DEFAULT_CONFIG.liveUrl)});
  return()=>{cancelled=true};
 },[loadLive]);

 useEffect(()=>{
  const id=setInterval(()=>loadLive(config.liveUrl),Math.max(10,config.pollSeconds)*1000);
  return()=>clearInterval(id);
 },[config,loadLive]);

 // Ages are recomputed from elapsed local time, so a wrong device clock cannot make a
 // position look fresher than the publisher said it was.
 useEffect(()=>{const id=setInterval(()=>setNowMs(Date.now()),5000);return()=>clearInterval(id)},[]);

 useEffect(()=>{
  const update=()=>setOnline(navigator.onLine);
  update();
  addEventListener('online',update);addEventListener('offline',update);
  return()=>{removeEventListener('online',update);removeEventListener('offline',update)};
 },[]);

 useEffect(()=>{
  if(!('serviceWorker' in navigator))return;
  navigator.serviceWorker.register('/sw.js').catch(()=>{});
 },[]);

 const duration=data?Math.floor((data.end-data.start)/1000):0,time=data?data.start+offset*1000:0;
 const filtered=useMemo(()=>data?.journeys.filter(j=>(route==='all'||routeKey(j)===route)&&(direction==='all'||j.direction===direction))??[],[data,route,direction]);
 const routeChoices=useMemo(()=>Array.from(new Set(data?.journeys.map(routeKey)??[])).sort((a,b)=>a.split('|')[1].localeCompare(b.split('|')[1],undefined,{numeric:true})),[data]);
 const chosen=filtered.find(j=>j.id===selected)??filtered[0];
 const point=chosen?lastObservation(chosen,time):undefined;
 const seen=visibleJourneys(filtered,time);
 const count=filtered.reduce((n,j)=>n+j.points.filter(p=>p.time<=time).length,0);
 // Location is optional and never required: the search box completes the task alone.
 const locate=useCallback(()=>{
  if(!catalogue)return;
  if(!('geolocation' in navigator)){
   setLocationError('This browser cannot share a location. Search for your stop instead.');
   return;
  }
  setLocating(true);setLocationError('');
  navigator.geolocation.getCurrentPosition(position=>{
   const here={lat:position.coords.latitude,lon:position.coords.longitude};
   const nearby=nearestStops(catalogue.stops,here,1);
   setLocating(false);
   if(!nearby.length||nearby[0].metres>3000){
    setLocationError('No collected stop is near you. Search for a stop instead.');
    return;
   }
   setStop(nearby[0].stop);
  },error=>{
   setLocating(false);
   setLocationError(error.code===error.PERMISSION_DENIED
    ?'Location is off, which is fine. Search for your stop instead.'
    :'Your location could not be read. Search for your stop instead.');
  },{enableHighAccuracy:false,timeout:10000,maximumAge:60000});
 },[catalogue]);

 const reference=nowMs||liveFetchedAt;
 const publishedAge=live?publicationAge(live,{serverReferenceMs:serverRef||live.publishedAtMs},liveFetchedAt,reference):null;
 const liveMode=feedMode(live,fromCache,online,publishedAge);
 // Archive mode is an explicit, badged choice. It never stands in for live data silently.
 const followMode=usingArchive?'archive':liveMode;
 const followBuses=useMemo(()=>usingArchive
  ?busesFromArchive(data?.journeys??[])
  :busesFromLive(live,serverRef||live?.publishedAtMs||0,liveFetchedAt,reference),
  [usingArchive,data,live,serverRef,liveFetchedAt,reference]);
 const patternsById=useMemo(()=>patternIndex(patterns),[patterns]);
 const archiveDate=data?new Intl.DateTimeFormat('en-GB',{dateStyle:'long',timeZone:'Europe/London'}).format(data.start):undefined;
 const age=point?Math.max(0,Math.round((time-point.time)/1000)):null;
 const routeLabel=route==='all'?'All routes':route.split('|')[1];
 const selectedGaps=chosen?gaps(chosen):[];
 const p90=percentile(selectedGaps,.9);
 const source=data?.sources.find(s=>s.sha256===point?.sourceHash);
 useEffect(()=>{if(!playing)return;const id=setInterval(()=>setOffset(v=>{if(v>=duration){setPlaying(false);return duration}return Math.min(duration,v+10)}),250);return()=>clearInterval(id)},[playing,duration]);
 useEffect(()=>{if(!data)return;const context=(document as Document & {modelContext?:{registerTool:(tool:unknown,options:{signal:AbortSignal})=>unknown}}).modelContext;if(!context)return;const lifecycle=new AbortController();const tool={name:'inspect_recorded_bus_journey',description:'Select an archived bus journey and replay time in Lost Minutes. Returns observed data only; no inferred lateness.',inputSchema:{type:'object',properties:{journeyId:{type:'string'},secondsFromStart:{type:'number'}},required:['journeyId'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:true},execute:async(input:unknown)=>{const v=input as {journeyId?:unknown;secondsFromStart?:unknown};const j=data.journeys.find(j=>j.id===v?.journeyId);if(!j)throw Error('Unknown journey');const second=v.secondsFromStart??0;if(typeof second!=='number'||!Number.isFinite(second)||second<0||second>duration)throw Error('Replay time is outside the recording');setRoute(routeKey(j));setDirection(j.direction||'all');setSelected(j.id);setOffset(second);setPlaying(false);setTab('explore');await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return {journeyId:j.id,mode:'archive',route:j.route,observations:j.points.length,position:latestVisible(j,data.start+second*1000)??null}}};try{Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{})}catch{}return()=>lifecycle.abort()},[data,duration]);
 function changeRoute(value:string){setRoute(value);setSelected('');setPlaying(false)}
 return <main className="app-shell">
  <a className="skip-link" href="#workspace">Skip to recorded journeys</a>
  <header className="masthead"><Link className="brand" href="/" aria-label="Lost Minutes home"><span className="brand-mark"><Route size={23}/></span>lost minutes<span className="brand-period">.</span></Link><span className="location-label">MANCHESTER / UK</span><a href="#evidence" onClick={()=>{setTab('evidence');setPlaying(false)}} className="header-link">Behind the numbers <ArrowUpRight size={16}/></a></header>
  {/* The passenger view leads with the bus, not with a hero. The archive badge belongs to
      the archive views: on Follow it would contradict the live status banner below. */}
  {tab==='follow'
   ?<section className="page-heading compact"><div><p className="eyebrow">MANCHESTER BUSES</p><h1>Follow your bus.</h1><p className="intro">The last position each bus reported, and how long ago it reported it.</p></div></section>
   :<section className="page-heading"><div><p className="eyebrow">A CITY IN MOTION</p><h1>Every journey leaves a trace.</h1><p className="intro">Follow Manchester’s buses. Replay a moment. Look closer.</p></div><div className="recording-label"><span className="archive-badge"><Clock3 size={14}/> ARCHIVE REPLAY</span><span>{data?new Intl.DateTimeFormat('en-GB',{dateStyle:'long',timeZone:'Europe/London'}).format(data.start):'Recorded public data'}</span><small>Historical observations · not live</small></div></section>}
  {!data?<section className="loading-card"><LoaderCircle className={error?'':'spin'} size={26}/><h2>{error||'Loading the Manchester recording…'}</h2><p>{error?'Reload the page to try again. No live data is being shown.':'Opening the original observations and their source record.'}</p>{error&&<button className="action" onClick={()=>location.reload()}>Try again</button>}</section>:<Tabs value={tab} onValueChange={v=>{setTab(v);if(v!=='explore')setPlaying(false)}} className="workspace-tabs">
   <div className="workspace-toolbar"><TabsList className="view-tabs"><TabsTrigger value="follow"><Navigation size={16}/>Follow</TabsTrigger><TabsTrigger value="explore"><MapPin size={16}/>Explore</TabsTrigger><TabsTrigger value="evidence"><ShieldCheck size={16}/>Evidence</TabsTrigger><TabsTrigger value="operations"><Activity size={16}/>Operations</TabsTrigger></TabsList>{tab!=='follow'&&<div className="filters"><label htmlFor="route-select">Route</label><Select value={route} onValueChange={changeRoute}><SelectTrigger id="route-select" className="route-select"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">All recorded routes</SelectItem>{routeChoices.map(r=><SelectItem key={r} value={r}>{r.split('|')[1]} · {r.split('|')[0]}</SelectItem>)}</SelectContent></Select><label htmlFor="direction-select" className="sr-only">Direction</label><Select value={direction} onValueChange={v=>{setDirection(v);setSelected('')}}><SelectTrigger id="direction-select" className="direction-select"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">Both directions</SelectItem><SelectItem value="inbound">Inbound</SelectItem><SelectItem value="outbound">Outbound</SelectItem></SelectContent></Select></div>}</div>
   <TabsContent value="follow" id="follow">
    <FollowView mode={followMode} live={live} buses={followBuses} roads={roads}
     onRefresh={()=>loadLive(config.liveUrl)} refreshing={refreshing}
     publicationAgeSeconds={publishedAge} ageBasis={ageBasis} archiveDate={archiveDate}
     usingArchive={usingArchive}
     stops={catalogue?.stops??[]} stop={stop} onSelectStop={setStop}
     patterns={patterns} patternsById={patternsById}
     onLocate={locate} locating={locating} locationError={locationError}
     onOpenEvidence={()=>{setTab('evidence');setPlaying(false)}}
     onUseArchive={data?()=>setUsingArchive(true):undefined}/>
    {usingArchive&&<button className="text-action follow-leave-archive"
     onClick={()=>setUsingArchive(false)}>Leave the recording and show live state</button>}
   </TabsContent>
   <TabsContent value="explore" id="workspace">
    <div className="workspace-grid"><section className="map-card"><div className="map-card-head"><div><span className="eyebrow">{route==='all'?'THE RECORDED NETWORK':`ROUTE ${routeLabel}`}</span><h2>{chosen?cleanLabel(chosen.destination)||'Manchester journeys':'No journeys in this selection'}{chosen&&<ArrowDown size={18}/>}</h2></div><span className="time-chip">{clock(time,true)} <small>BST</small></span></div><MapView journeys={filtered} time={time} selected={chosen?.id??''} choose={setSelected} roads={roads}/><div className="map-foot"><Info size={15}/><p>Positions update only when an observation exists. Dashed trails connect samples; they are not exact road paths.</p></div></section>
    <aside className="journey-panel"><div className="panel-top"><span className="eyebrow">IN THIS VIEW</span><span className="tiny-label">at {clock(time)}</span></div><div className="headline-number">{seen.length}<span> buses observed</span></div><p className="muted">With a position no more than 2 minutes old at the replay time.</p><div className="mini-stats"><div><strong>{count.toLocaleString()}</strong><span>unique observations<br/>up to this moment</span></div><div><strong>{filtered.length}</strong><span>recorded journey tracks<br/>across the full sample</span></div></div><div className="section-rule"/><div className="section-title"><h3>Select a journey</h3><BusFront size={18}/></div><div className="journey-list">{filtered.length===0?<p className="empty-copy">No observations match this route and direction. Try another selection.</p>:filtered.map(j=>{const p=lastObservation(j,time);const isCurrent=!!latestVisible(j,time);return <button key={j.id} className={`journey-choice ${chosen?.id===j.id?'chosen':''}`} onClick={()=>setSelected(j.id)} aria-pressed={chosen?.id===j.id}><span className="route-pill">{j.route}</span><span className="journey-choice-copy"><strong>{j.vehicle}</strong><span>{cleanLabel(j.destination)||'Destination not supplied'}</span></span><span className={isCurrent?'fresh-label':'quiet-label'}>{isCurrent?'Observed':p?'Older':'Later'}</span></button>})}</div>
    {chosen&&<div className="selected-evidence"><div className="section-title"><h3>One bus, up close</h3><span>{chosen.vehicle}</span></div><dl><div><dt>Last observation</dt><dd>{point?clock(point.time,true):'Not yet observed'}</dd></div><div><dt>Age at replay time</dt><dd>{age===null?'—':`${age}s`}{age!==null&&age>120?' · older':''}</dd></div><div><dt>90th percentile sample gap</dt><dd>{p90===null?'Not enough points':`${Math.round(p90)}s`}</dd></div></dl><p className="microcopy">These are gaps in this sampled archive, not a measure of the operator’s full reporting frequency.</p><button className="text-action" onClick={()=>{setTab('evidence');setPlaying(false)}}>Inspect the source <ArrowUpRight size={16}/></button></div>}
    </aside></div>
    <section className="timeline-card" aria-label="Replay controls"><div className="playback"><button className="play-button" onClick={()=>{if(offset>=duration)setOffset(0);setPlaying(v=>!v)}} aria-label={playing?'Pause replay':'Play replay'}>{playing?<Pause size={23} fill="currentColor"/>:<Play size={23} fill="currentColor"/>}</button><div><strong>{clock(time,true)}</strong><span>Replay · 40× speed</span></div><button className="restart-button" aria-label="Restart recording" onClick={()=>{setOffset(0);setPlaying(false)}}><RotateCcw size={17}/></button></div><div className="timeline-track"><Slider min={0} max={duration} step={1} value={[offset]} onValueChange={v=>{setOffset(v[0]);setPlaying(false)}} aria-label="Replay time"/><div className="timeline-labels"><span>{clock(data.start)}</span><span>{Math.round(duration/60)}-minute recording · BST</span><span>{clock(data.end)}</span></div></div></section>
    <div className="next-measure"><Layers3 size={21}/><div><strong>A clear view of the evidence comes first.</strong><p>Timetable matching and stop arrivals are not yet validated. This version shows recorded movement; delay and reliability figures will appear only when supported.</p></div><button onClick={()=>setTab('evidence')} className="text-action">See what’s verified <ArrowUpRight size={16}/></button></div>
   </TabsContent>
   <TabsContent value="evidence" id="evidence"><section className="evidence-heading"><span className="eyebrow">OBSERVATIONS, NOT ASSUMPTIONS</span><h2>What this recording can tell you.</h2><p>Real public bus data, sampled from the Open Innovations archive. Each accepted point retains its original timestamp and source fingerprint.</p></section><div className="evidence-stats"><div><Database size={21}/><strong>{data.sources.length}</strong><span>archived source snapshots</span></div><div><Check size={21}/><strong>{data.quality.uniqueObservations.toLocaleString()}</strong><span>accepted observations in the area</span></div><div><RotateCcw size={21}/><strong>{data.quality.duplicateObservations.toLocaleString()}</strong><span>repeated observations removed</span></div><div><ShieldCheck size={21}/><strong>{data.quality.conflictingObservations}</strong><span>conflicting identities suppressed</span></div></div><div className="evidence-columns"><section className="evidence-card"><h3>Reading this sample</h3><p>4,236 input observations = 3,426 retained + 740 repeats + 70 outside the capture window. A repeat has the same operator, vehicle, route, direction, journey reference, timestamp and coordinates. Identical coordinates with a new timestamp are retained. Conflicting coordinates at the same identity and time are suppressed.</p><ul>{data.limitations.map(l=><li key={l}>{l}</li>)}</ul><p><strong>Expected service coverage: unknown.</strong> We have not validated a schedule denominator. The number of observed buses is not a percentage of the expected service.</p><a href={data.sourceUrl} target="_blank" rel="noreferrer" className="text-action">Open the original archive <ExternalLink size={15}/></a></section><section className="evidence-card"><h3>Selected observation</h3>{chosen&&point?<><dl><div><dt>Vehicle / operator</dt><dd>{chosen.vehicle} / {chosen.operator}</dd></div><div><dt>Journey reference</dt><dd>{chosen.journeyRef||'Not supplied'}</dd></div><div><dt>Source observation time</dt><dd>{point.recordedAt}</dd></div><div><dt>Coordinates</dt><dd>{point.lat.toFixed(6)}, {point.lon.toFixed(6)}</dd></div><div><dt>Archive capture time</dt><dd>{source?.capturedAt||'Unknown'}</dd></div></dl><p className="microcopy">SHA-256 identifies the exact downloaded source file.</p><code className="source-hash">{point.sourceHash}</code>{source&&<a href={source.url} target="_blank" rel="noreferrer" className="text-action">Original source ZIP ({(source.bytes/1e6).toFixed(1)} MB) <ExternalLink size={15}/></a>}</>:<p>Select a journey and replay time to inspect an observation.</p>}</section></div>{chosen&&<section className="evidence-card observation-table"><h3>Observation sequence · {chosen.vehicle}</h3><p>Source timestamps retain their supplied offsets; this sample is UTC, displayed in Europe/London (BST on this date). Coordinates have not been snapped to roads or stops.</p><Table><TableHeader><TableRow><TableHead>Recorded at</TableHead><TableHead>Latitude</TableHead><TableHead>Longitude</TableHead><TableHead>Gap from previous</TableHead><TableHead>At replay time</TableHead></TableRow></TableHeader><TableBody>{chosen.points.map((p,i)=><TableRow key={p.time}><TableCell>{clock(p.time,true)}</TableCell><TableCell>{p.lat.toFixed(6)}</TableCell><TableCell>{p.lon.toFixed(6)}</TableCell><TableCell>{i?`${Math.round((p.time-chosen.points[i-1].time)/1000)}s`:'First sample'}</TableCell><TableCell>{p.time>time?'Later in recording':'Available'}</TableCell></TableRow>)}</TableBody></Table></section>}</TabsContent>
   <TabsContent value="operations" id="operations">{ops
    ?<OperationsView ops={ops} servedSnapshotId={data.snapshotId}/>
    :<section className="ops-card ops-empty"><Activity size={22}/><h3>No pipeline record is published</h3>
      <p>{opsError||'Run the pipeline to generate public/data/operations.json.'}</p>
      <code className="source-hash">.venv/bin/python -m pipeline.run import</code></section>}
   </TabsContent>
  </Tabs>}
  <footer className="footer"><span>lost minutes<span className="brand-period">.</span> <span className="footer-caption">Made to make the journey clearer.</span></span><p>{data?.attribution??'Public bus observations with explicit source provenance.'} <a href="https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/" target="_blank" rel="noreferrer">OGL v3.0</a></p></footer>
 </main>
}
