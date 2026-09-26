"use client";

import {useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import Link from 'next/link';
import {ArrowDown,ArrowLeft,ArrowUpRight,BusFront,Check,Clock3,Database,ExternalLink,Focus,Info,Layers3,LoaderCircle,MapPin,Minus,Pause,Play,Plus,RotateCcw,Route,ShieldCheck,Activity} from 'lucide-react';
import {Slider} from '@/components/ui/slider';
import {Select,SelectContent,SelectItem,SelectTrigger,SelectValue} from '@/components/ui/select';
import {Tabs,TabsContent,TabsList,TabsTrigger} from '@/components/ui/tabs';
import {Table,TableBody,TableCell,TableHead,TableHeader,TableRow} from '@/components/ui/table';
import {cleanLabel,clock,gaps,Journey,lastObservation,latestVisible,percentile,parseReplay,parseRoadMap,Replay,RoadMap,routeKey,visibleJourneys} from '@/lib/replay';
import {Operations,parseOperations} from '@/lib/operations';
import OperationsView from '@/components/operations-view';
import FollowView from '@/components/follow-view';
import MotionEvidence from '@/components/motion-evidence';
import SectionBoundary from '@/components/section-boundary';
import SiteNotes from '@/components/site-notes';
import CoverageLedger from '@/components/coverage-ledger';
import {busesFromArchive,busesFromLive,busFromVehicle} from '@/lib/follow';
import {DEFAULT_CONFIG,elapsedWords,feedMode,LiveState,parseConfig,parseLive,publicationAge,serverReference,SiteConfig} from '@/lib/live';
import {isPreviewPath,loadPreviewOffer} from '@/lib/preview';
import type {Photo3d} from '@/lib/gods-eye';
import type {LiveVehicle} from '@/lib/live';

/** SHA-256 of the live file exactly as this page received it, so the passenger's evidence can
 *  be matched to the publisher's recorded fingerprint. Absent where the browser cannot hash. */
async function fingerprint(text:string){
 try{
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
 }catch{return null}
}
import {FRESH_POSITION_OPTIONS,fromGeolocation,type Origin,type DeviceOrigin,type ChosenOrigin} from '@/lib/origin';
import {nearestStops,parseCatalogue,type Catalogue,type Stop,straightLineMetres} from '@/lib/stops';
import {parsePatterns,patternIndex,type PatternCatalogue} from '@/lib/patterns';
import {clearJourney,initialJourney as readInitialJourney,type InitialJourney} from '@/lib/journey-context';
import {parseRecordedRide,parseRideIndex,publicationAt,rideBusKey,rideLengthMs,rideLive,RIDES_INDEX_URL,
 type RecordedRide,type RecordedRideSummary} from '@/lib/recorded-ride';

/**
 * The passenger's page, and the views behind the data. A passenger needs one thing: their stop and
 * their bus, so that page has no tabs. The engineering views (the pipeline's record, the evidence
 * and a recorded morning to replay) are one link away under "Behind the data". The address's hash
 * names the view, so a link can open one directly and Back returns to the passenger's page.
 */
type Section='follow'|'operations'|'evidence'|'recorded';
/** A start the passenger chose, kept for this browsing session and no longer. */
const ORIGIN_KEY='lost-minutes.walking-origin.v1';
const SECTION_OF:Record<string,Section>={'':'follow','#follow':'follow','#behind-the-data':'operations',
 '#operations':'operations','#evidence':'evidence','#recorded-journeys':'recorded','#workspace':'recorded'};
const HASH_OF:Record<Section,string>={follow:'',operations:'#operations',evidence:'#evidence',recorded:'#recorded-journeys'};
/** A hash that names no view (a skip link's target, say) leaves the view as it is. */
const sectionOf=(hash:string):Section|null=>SECTION_OF[hash]??null;

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

function RecordingLoading({error}:{error:string}){
 return <section className="loading-card"><LoaderCircle className={error?'':'spin'} size={26}/><h2>{error||'Loading the recording…'}</h2><p>{error?'Reload the page to try again. Nothing live is shown here.':'Opening the original observations and their source record.'}</p>{error&&<button className="action" onClick={()=>location.reload()}>Try again</button>}</section>;
}

/** The address never changes path within the app (every address write keeps it), so nothing to subscribe to. */
const noSubscription=()=>()=>{};
const previewSnapshot=()=>isPreviewPath(window.location.pathname);

export default function Home(){
 const [data,setData]=useState<Replay|null>(null),[roads,setRoads]=useState<RoadMap|null>(null),[error,setError]=useState('');
 const [ops,setOps]=useState<Operations|null>(null),[opsError,setOpsError]=useState('');
 const [config,setConfig]=useState<SiteConfig>(DEFAULT_CONFIG);
 // The private preview (lib/preview.ts): this same page at /preview/, which the server serves only
 // behind a password; there, and only there, the server's private offer of the view from above is
 // read. The public page never asks for it.
 const preview=useSyncExternalStore(noSubscription,previewSnapshot,()=>false);
 const [previewPhoto3d,setPreviewPhoto3d]=useState<Photo3d|null>(null);
 useEffect(()=>{
  if(!preview)return;
  let current=true;
  loadPreviewOffer().then(offer=>{if(current)setPreviewPhoto3d(offer)});
  return()=>{current=false};
 },[preview]);
 const [live,setLive]=useState<LiveState|null>(null),[liveFetchedAt,setLiveFetchedAt]=useState(0);
 // Every vehicle this visit has seen, so a chosen bus that drops out of the feed can still be
 // described by its last report instead of silently vanishing.
 const [lastSeen,setLastSeen]=useState<Map<string,LiveVehicle>>(()=>new Map());
 const [liveFingerprint,setLiveFingerprint]=useState<string|null>(null);
 const [serverRef,setServerRef]=useState(0),[ageBasis,setAgeBasis]=useState<'server'|'device'>('server');
 const [fromCache,setFromCache]=useState(false),[online,setOnline]=useState(true);
 const [refreshing,setRefreshing]=useState(false),[usingArchive,setUsingArchive]=useState(false);
 const [catalogue,setCatalogue]=useState<Catalogue|null>(null);
 const [patterns,setPatterns]=useState<PatternCatalogue|null>(null);
 const [stop,setStop]=useState<Stop|null>(null);
 // The journey left on this device or opened from a link: undefined until the stops are known.
 const [journey,setJourney]=useState<InitialJourney|null|undefined>(undefined);
 // The address's query as last applied or written, so Back and Forward apply only a real change,
 // and a counter the view watches to drop its own choices when the address is applied over them.
 const appliedSearch=useRef('');
 const [journeyEpoch,setJourneyEpoch]=useState(0);
 // A recorded ride replayed in place of the live feed (lib/recorded-ride.ts): badged everywhere,
 // never remembered as a journey, and left by one action. `index` is the publication last served
 // from it; `ended` once the last has been. While one runs the live feed is not polled, and a fetch
 // already in flight is dropped, so nothing live is ever drawn under a recording's badge.
 const [recordings,setRecordings]=useState<RecordedRideSummary[]>([]);
 const [ride,setRide]=useState<{data:RecordedRide;startedAtMs:number;index:number;ended:boolean}|null>(null);
 const [rideError,setRideError]=useState<string|null>(null);
 const rideRef=useRef(false);
 useEffect(()=>{rideRef.current=ride!==null},[ride]);
 const startRecording=useCallback(async(summary:{id:string;file:string})=>{
  try{
   const response=await fetch(summary.file);
   if(!response.ok)throw new Error(`recording unavailable (${response.status})`);
   const data=parseRecordedRide(await response.json());
   // The live feed goes at once: its buses must not stand under the recording's badge, and the
   // recorded vehicle may be on the road right now on another journey — on 24 September 2026 the
   // 163's own bus was, and the page pinned the live one, then read the recording as a change of
   // journey and paused the ride.
   setUsingArchive(false);setStop(null);setRideError(null);setLiveFingerprint(null);setLive(null);
   setRide({data,startedAtMs:Date.now(),index:-1,ended:false});
   // The address names the recording, so the link that is shared reopens it — and never a vehicle
   // that stopped reporting on the day it was made.
   const next=`${window.location.pathname}?ride=${data.id}`;
   window.history.replaceState(window.history.state,'',next);
   appliedSearch.current=`?ride=${data.id}`;
  }catch{setRideError('The recording could not be loaded just now.')}
 },[]);
 const [locating,setLocating]=useState(false),[locationError,setLocationError]=useState('');
 // Where the passenger is starting from: the device's fix, with its own accuracy and timestamp, or a
 // point they chose themselves, which outranks the device until they explicitly go back to it.
 // Three things, kept apart (21 September 2026): the device's latest measured position, the
 // journey's starting point (the device, or a fixed place chosen for this journey or for someone
 // else), and which of those the journey uses. Until then one value held whichever was last set,
 // measured once per press of Locate me and never again, so a passenger who walked saw their
 // position stay where it had been read — the fault the owner reported, reproduced from this code.
 const [device,setDevice]=useState<DeviceOrigin|null>(null);
 const [chosenOrigin,setChosenOrigin]=useState<ChosenOrigin|null>(null);
 const [originMode,setOriginMode]=useState<'device'|'chosen'|null>(null);
 const origin=useMemo<Origin|null>(()=>originMode==='chosen'?chosenOrigin:originMode==='device'?device:null,[originMode,chosenOrigin,device]);
 // Counts explicit choices of a start (Locate me, a chosen point): what the camera may go to. A
 // position update while walking is not one, so it never moves the camera.
 const [originEpoch,setOriginEpoch]=useState(0);
 const watchRef=useRef<number|null>(null);
 const originModeRef=useRef(originMode);
 const deviceRef=useRef(device);
 useEffect(()=>{originModeRef.current=originMode;deviceRef.current=device},[originMode,device]);
 const [pickingOrigin,setPickingOrigin]=useState(false);
 const here=useMemo(()=>origin?{lat:origin.lat,lon:origin.lon,
  accuracyMetres:origin.kind==='device'?origin.accuracyMetres:undefined}:null,[origin]);
 const devicePoint=useMemo(()=>device?{lat:device.lat,lon:device.lon,accuracyMetres:device.accuracyMetres,takenAtMs:device.takenAtMs}:null,[device]);
 const [outsideArea,setOutsideArea]=useState(false);
 const [nowMs,setNowMs]=useState(0);
 const [route,setRoute]=useState('BNML|142'),[direction,setDirection]=useState('inbound'),[selected,setSelected]=useState('');
 const [offset,setOffset]=useState(0),[playing,setPlaying]=useState(false);
 const [section,setSection]=useState<Section>('follow');
 useEffect(()=>{const abort=new AbortController();fetch('/data/replay.json',{signal:abort.signal}).then(r=>{if(!r.ok)throw Error('The recorded sample could not be loaded.');return r.json()}).then(value=>{const d=parseReplay(value);setData(d);setOffset(Math.min(300,Math.floor((d.end-d.start)/1000)));if(!d.journeys.some((j:Journey)=>routeKey(j)==='BNML|142')){setRoute(routeKey(d.journeys[0]));setDirection('all')}}).catch(e=>{if(e.name!=='AbortError')setError(e.message)});fetch('/data/roads.json',{signal:abort.signal}).then(r=>r.ok?r.json():null).then(value=>setRoads(value?parseRoadMap(value):null)).catch(()=>{});fetch('/data/stops.json',{signal:abort.signal}).then(r=>r.ok?r.json():null)
 .then(value=>{
  if(!value)return;
  const parsed=parseCatalogue(value);
  setCatalogue(parsed);
  // A start the passenger chose earlier in this session is kept: their word outranks the device.
  try{const kept=sessionStorage.getItem(ORIGIN_KEY);if(kept){const o=JSON.parse(kept);
   if(o&&o.kind==='chosen'&&Number.isFinite(o.lat)&&Number.isFinite(o.lon)){setChosenOrigin(o);setOriginMode('chosen')}}}catch{/* nothing kept */}
  // A link wins; this tab's own journey restores silently; the device's last journey is only
  // offered (docs/JOURNEY_STATE.md). None of them holds where the passenger is.
  let storage:Storage|null=null,session:Storage|null=null;
  try{storage=window.localStorage}catch{/* a refused store: nothing to restore */}
  try{session=window.sessionStorage}catch{/* likewise */}
  const restored=readInitialJourney(window.location.search,storage,Date.now(),session);
  appliedSearch.current=window.location.search;
  const rideId=new URLSearchParams(window.location.search).get('ride');
  if(rideId&&/^[0-9a-z][0-9a-z-]{2,79}$/.test(rideId))startRecording({id:rideId,file:`/data/rides/${rideId}.json`});
  const found=restored&&restored.source!=='offer'&&restored.stopId?parsed.stops.find(s=>s.id===restored.stopId)??null:null;
  if(found)setStop(current=>current??found);
  setJourney(restored);
 }).catch(()=>{});
 fetch('/data/patterns.json',{signal:abort.signal}).then(r=>r.ok?r.json():null)
 .then(value=>{if(value)setPatterns(parsePatterns(value))}).catch(()=>{});
 fetch(RIDES_INDEX_URL,{signal:abort.signal}).then(r=>r.ok?r.json():null)
 .then(value=>{if(value)setRecordings(parseRideIndex(value))}).catch(()=>{});
 fetch('/data/operations.json',{signal:abort.signal}).then(r=>{if(!r.ok)throw Error('No pipeline record has been published yet.');return r.json()}).then(value=>setOps(parseOperations(value))).catch(e=>{if(e.name!=='AbortError')setOpsError('The pipeline record could not be read: '+e.message)});return()=>abort.abort()},[startRecording]);
 // Published state is polled; the page never contacts the data service itself.
 const lastLoad=useRef(0);
 const loadLive=useCallback(async(target:string)=>{
  lastLoad.current=Date.now();
  setRefreshing(true);
  try{
   const response=await fetch(`${target}${target.includes('?')?'&':'?'}t=${Date.now()}`,{cache:'no-store'});
   if(!response.ok)throw Error(`live state unavailable (${response.status})`);
   const cached=response.headers.get('X-Lost-Minutes-From-Cache')==='1';
   const headerDate=response.headers.get('Date'),headerAge=response.headers.get('Age');
   const text=await response.text();
   const value=parseLive(JSON.parse(text));
   const reference=serverReference(headerDate,headerAge,value,Date.now());
   if(rideRef.current)return;
   setLive(value);setFromCache(cached);setServerRef(reference.serverReferenceMs);
   setLastSeen(previous=>{
    const next=new Map(previous);
    for(const vehicle of value.vehicles)next.set(`${vehicle.operator}|${vehicle.vehicle}`,vehicle);
    return next;
   });
   setLiveFingerprint(await fingerprint(text));
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

 // Polling stops while the page is out of sight (a locked screen, another app), which spares the
 // battery and the data allowance; coming back, or back online, asks at once instead of waiting
 // for the next poll, so the ages shown are never left over from before.
 useEffect(()=>{
  const id=setInterval(()=>{if(!document.hidden&&!rideRef.current)loadLive(config.liveUrl)},Math.max(10,config.pollSeconds)*1000);
  const resume=()=>{
   if(document.hidden)return;
   setNowMs(Date.now());
   if(Date.now()-lastLoad.current>3000&&!rideRef.current)loadLive(config.liveUrl);
  };
  document.addEventListener('visibilitychange',resume);
  addEventListener('online',resume);addEventListener('pageshow',resume);
  return()=>{clearInterval(id);document.removeEventListener('visibilitychange',resume);
   removeEventListener('online',resume);removeEventListener('pageshow',resume)};
 },[config,loadLive]);

 // The recording's clock: once a second, the publication a phone would have been served this far
 // in is put where the live one goes, its times moved onto now so the ages read as they did.
 useEffect(()=>{
  if(!ride)return;
  const tick=()=>{
   const elapsed=Date.now()-ride.startedAtMs;
   const index=publicationAt(ride.data,elapsed);
   const ended=elapsed>=rideLengthMs(ride.data);
   if(index!==ride.index&&index>=0){
    const value=rideLive(ride.data,index,ride.startedAtMs);
    setLive(value);setFromCache(false);setServerRef(value.publishedAtMs);setAgeBasis('server');
    setLiveFetchedAt(Date.now());setNowMs(Date.now());
   }
   if(index!==ride.index||ended!==ride.ended)
    setRide(r=>r&&r.startedAtMs===ride.startedAtMs?{...r,index,ended}:r);
  };
  tick();
  const id=setInterval(tick,1000);
  return()=>clearInterval(id);
 },[ride]);
 const leaveRecording=useCallback(()=>{
  setRide(null);
  window.history.replaceState(window.history.state,'',window.location.pathname);
  appliedSearch.current='';
  loadLive(config.liveUrl);
 },[config.liveUrl,loadLive]);
 const replayRecording=useCallback(()=>setRide(r=>r?{...r,startedAtMs:Date.now(),index:-1,ended:false}:r),[]);

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

 // ------------------------------------------------------------ which view
 // The passenger's page is never taken down: it stays laid out and hidden while a view behind the
 // data is open, so the stop, the chosen bus, a ride-along and the map come back as they were, and
 // so does the place on the page and the control that had focus.
 const sectionRef=useRef<Section>('follow');
 const passengerScroll=useRef(0),returnFocus=useRef<HTMLElement|null>(null),moveFocus=useRef(false);
 const go=useCallback((next:Section,focus:boolean)=>{
  const was=sectionRef.current;
  if(was===next)return;
  if(was==='follow'){
   passengerScroll.current=window.scrollY;
   returnFocus.current=document.activeElement instanceof HTMLElement&&document.activeElement!==document.body?document.activeElement:null;
  }
  moveFocus.current=focus;
  sectionRef.current=next;
  setSection(next);
  if(next!=='recorded')setPlaying(false);
 },[]);
 const show=useCallback((next:Section,hash:string=HASH_OF[next])=>{
  const target=`${window.location.pathname}${window.location.search}${hash}`;
  if(target!==`${window.location.pathname}${window.location.search}${window.location.hash}`)
   window.history.pushState(window.history.state,'',target);
  go(next,true);
 },[go]);
 // Where the address points: on arrival, and on Back or Forward.
 useEffect(()=>{
  let arriving=true;
  const sync=()=>{const next=sectionOf(window.location.hash);if(next)go(next,!arriving);arriving=false};
  sync();
  addEventListener('hashchange',sync);addEventListener('popstate',sync);
  return()=>{removeEventListener('hashchange',sync);removeEventListener('popstate',sync)};
 },[go]);
 // Back and Forward apply the journey the address names: its stop, filter and bus, or none. A
 // hash-only move (into or out of Behind the data) leaves the journey alone.
 useEffect(()=>{
  const onPop=()=>{
   if(!catalogue||window.location.search===appliedSearch.current)return;
   appliedSearch.current=window.location.search;
   const rideId=new URLSearchParams(window.location.search).get('ride');
   if(rideId&&/^[0-9a-z][0-9a-z-]{2,79}$/.test(rideId)){startRecording({id:rideId,file:`/data/rides/${rideId}.json`});return}
   const next=readInitialJourney(window.location.search,null,Date.now(),null);
   setStop(next?.stopId?catalogue.stops.find(s=>s.id===next.stopId)??null:null);
   setJourney(next);
   setJourneyEpoch(n=>n+1);
  };
  addEventListener('popstate',onPop);
  return()=>removeEventListener('popstate',onPop);
 },[catalogue,startRecording]);
 // New journey: the stop, the filter, the bus and the address, and both journey stores, so that
 // nothing cleared can come back. Saved stops, saved routes and recent stops stay.
 const newJourney=useCallback(()=>{
  setStop(null);setJourney(null);
  let storage:Storage|null=null,session:Storage|null=null;
  try{storage=window.localStorage}catch{}
  try{session=window.sessionStorage}catch{}
  clearJourney(storage,session);
  appliedSearch.current='';
  if(window.location.search)window.history.replaceState(window.history.state,'',window.location.pathname);
 },[]);
 const noteAddress=useCallback((search:string)=>{appliedSearch.current=search},[]);
 const shownSection=useRef<Section>('follow');
 useLayoutEffect(()=>{
  const was=shownSection.current;
  shownSection.current=section;
  if(was===section)return;
  const focus=moveFocus.current;
  moveFocus.current=false;
  if(section==='follow'){
   window.scrollTo(0,passengerScroll.current);
   const back=returnFocus.current;
   if(focus)(back?.isConnected?back:document.getElementById('passenger-title'))?.focus({preventScroll:true});
  }else if(was==='follow'){
   window.scrollTo(0,0);
   if(focus)document.getElementById('data-title')?.focus({preventScroll:true});
  }
 },[section]);

 const duration=data?Math.floor((data.end-data.start)/1000):0,time=data?data.start+offset*1000:0;
 const filtered=useMemo(()=>data?.journeys.filter(j=>(route==='all'||routeKey(j)===route)&&(direction==='all'||j.direction===direction))??[],[data,route,direction]);
 const routeChoices=useMemo(()=>Array.from(new Set(data?.journeys.map(routeKey)??[])).sort((a,b)=>a.split('|')[1].localeCompare(b.split('|')[1],undefined,{numeric:true})),[data]);
 const chosen=filtered.find(j=>j.id===selected)??filtered[0];
 const point=chosen?lastObservation(chosen,time):undefined;
 const seen=visibleJourneys(filtered,time);
 const count=filtered.reduce((n,j)=>n+j.points.filter(p=>p.time<=time).length,0);
 // Location is optional and never required: the search box completes the task alone.
 const judgeArea=useCallback((point:{lat:number;lon:number})=>{
  if(!catalogue)return;
  // Outside the area we collect is a different answer from "nothing found", and is said so.
  const [west,south,east,north]=catalogue.area.bbox;
  const inside=point.lon>=west&&point.lon<=east&&point.lat>=south&&point.lat<=north;
  const nearby=nearestStops(catalogue.stops,point,1);
  setOutsideArea(!inside||!nearby.length||nearby[0].metres>3000);
 },[catalogue]);
 // A start the passenger confirmed themselves. Kept for this session until they go back to the device.
 // A measured position is taken up only when it says something new: the device moved further
 // than its own accuracy makes doubtful (half the radius, at least 15 m), the fix got clearly
 // better, or the last one is over a minute old (so its age stays honest). GPS noise inside that
 // band changes nothing downstream: no re-sorted list, no re-routed walk, no moved marker.
 const acceptFix=useCallback((position:GeolocationPosition)=>{
  const next=fromGeolocation(position),previous=deviceRef.current;
  let accept=!previous;
  if(previous){
   const moved=straightLineMetres(previous,next);
   const threshold=Math.max(15,0.5*(next.accuracyMetres??50));
   const better=(next.accuracyMetres??Infinity)<0.7*(previous.accuracyMetres??Infinity);
   const aged=next.takenAtMs-previous.takenAtMs>60_000;
   accept=moved>=threshold||better||aged;
  }
  if(!accept)return;
  deviceRef.current=next;setDevice(next);
  if(originModeRef.current==='device')judgeArea(next);
 },[judgeArea]);
 const stopWatch=useCallback(()=>{
  if(watchRef.current!==null&&'geolocation' in navigator){navigator.geolocation.clearWatch(watchRef.current)}
  watchRef.current=null;
 },[]);
 // Followed only while the journey starts from the device and the page is in front: a walk to the
 // stop moves the marker; a fixed starting point, or a hidden tab, is not followed at all.
 const startWatch=useCallback(()=>{
  if(watchRef.current!==null||!('geolocation' in navigator))return;
  watchRef.current=navigator.geolocation.watchPosition(acceptFix,()=>{/* a failed update keeps the last fix, whose age is shown */},
   {enableHighAccuracy:true,maximumAge:5_000,timeout:30_000});
 },[acceptFix]);
 useEffect(()=>{
  const onVisibility=()=>{
   if(document.visibilityState==='hidden')stopWatch();
   else if(deviceRef.current){
    // Followed before: followed again, from a fresh fix, whatever the journey starts from.
    startWatch();
    navigator.geolocation?.getCurrentPosition(acceptFix,()=>{},FRESH_POSITION_OPTIONS);
   }
  };
  document.addEventListener('visibilitychange',onVisibility);
  return()=>{document.removeEventListener('visibilitychange',onVisibility);stopWatch()};
 },[acceptFix,startWatch,stopWatch]);
 // A start the passenger chose is fixed until they change it: a late fix from the device can never
 // overwrite a friend's starting point, because the device's position is kept apart from it.
 // The device goes on being followed (if it ever was): it is drawn as You beside the start, and
 // only the start ignores it. Nothing here touches the device's own position.
 const chooseOrigin=useCallback((point:{lat:number;lon:number},label:string)=>{
  const chosen:ChosenOrigin={kind:'chosen',lat:point.lat,lon:point.lon,label,chosenAtMs:Date.now()};
  setChosenOrigin(chosen);setOriginMode('chosen');setOriginEpoch(n=>n+1);setPickingOrigin(false);setLocationError('');judgeArea(point);
  try{sessionStorage.setItem(ORIGIN_KEY,JSON.stringify(chosen))}catch{/* not kept, still used */}
 },[judgeArea]);
 // Asking for the device's position is always explicit, and always fresh: it replaces a chosen
 // start, because pressing it is how the passenger says "use where my phone thinks I am". From
 // then on the position is followed while the page is in front.
 const locate=useCallback(()=>{
  if(!catalogue)return;
  if(!('geolocation' in navigator)){
   setLocationError('This browser cannot share a location. Search for your stop instead.');
   return;
  }
  // Already followed: the device's position is as fresh as the watch keeps it, so "use my
  // location" is answered at once from it, and the watch goes on. (A one-shot request with
  // maximumAge 0 beside an active watch never answered in Chromium's emulation, and on a phone
  // it would wait for a fix the watch is already delivering.)
  if(watchRef.current!==null&&deviceRef.current){
   const point=deviceRef.current;
   setOriginMode('device');setOriginEpoch(n=>n+1);setPickingOrigin(false);setLocationError('');
   try{sessionStorage.removeItem(ORIGIN_KEY)}catch{}
   judgeArea(point);
   return;
  }
  setLocating(true);setLocationError('');
  navigator.geolocation.getCurrentPosition(position=>{
   const point=fromGeolocation(position);
   setLocating(false);setDevice(point);setOriginMode('device');setOriginEpoch(n=>n+1);setPickingOrigin(false);
   try{sessionStorage.removeItem(ORIGIN_KEY)}catch{}
   judgeArea(point);
   startWatch();
  },error=>{
   setLocating(false);
   setLocationError(error.code===error.PERMISSION_DENIED
    ?'Location is off, which is fine. Search for your stop instead.'
    :'Your location could not be read. Search for your stop instead.');
  },FRESH_POSITION_OPTIONS);
 },[catalogue,judgeArea,startWatch]);

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
 const recall=useCallback((key:string)=>{
  const vehicle=lastSeen.get(key);
  return vehicle&&live?busFromVehicle(vehicle,live.freshness.policy,serverRef||live.publishedAtMs,liveFetchedAt,reference):null;
 },[lastSeen,live,serverRef,liveFetchedAt,reference]);
 const archiveDate=data?new Intl.DateTimeFormat('en-GB',{dateStyle:'long',timeZone:'Europe/London'}).format(data.start):undefined;
 const age=point?Math.max(0,Math.round((time-point.time)/1000)):null;
 const routeLabel=route==='all'?'All routes':route.split('|')[1];
 const selectedGaps=chosen?gaps(chosen):[];
 const p90=percentile(selectedGaps,.9);
 const source=data?.sources.find(s=>s.sha256===point?.sourceHash);
 useEffect(()=>{if(!playing)return;const id=setInterval(()=>setOffset(v=>{if(v>=duration){setPlaying(false);return duration}return Math.min(duration,v+10)}),250);return()=>clearInterval(id)},[playing,duration]);
 useEffect(()=>{if(!data)return;const context=(document as Document & {modelContext?:{registerTool:(tool:unknown,options:{signal:AbortSignal})=>unknown}}).modelContext;if(!context)return;const lifecycle=new AbortController();const tool={name:'inspect_recorded_bus_journey',description:'Select an archived bus journey and replay time in Lost Minutes. Returns observed data only; no inferred lateness.',inputSchema:{type:'object',properties:{journeyId:{type:'string'},secondsFromStart:{type:'number'}},required:['journeyId'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:true},execute:async(input:unknown)=>{const v=input as {journeyId?:unknown;secondsFromStart?:unknown};const j=data.journeys.find(j=>j.id===v?.journeyId);if(!j)throw Error('Unknown journey');const second=v.secondsFromStart??0;if(typeof second!=='number'||!Number.isFinite(second)||second<0||second>duration)throw Error('Replay time is outside the recording');setRoute(routeKey(j));setDirection(j.direction||'all');setSelected(j.id);setOffset(second);setPlaying(false);show('recorded');await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return {journeyId:j.id,mode:'archive',route:j.route,observations:j.points.length,position:latestVisible(j,data.start+second*1000)??null}}};try{Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{})}catch{}return()=>lifecycle.abort()},[data,duration,show]);
 function changeRoute(value:string){setRoute(value);setSelected('');setPlaying(false)}
 const away=section!=='follow';
 // The pipeline as it stands now, for anyone reviewing it: what the passenger's page is reading.
 const collector=live?.collection.collector;
 const liveNow=liveMode==='live'?`Right now: live positions${collector?.kind==='bounded_development'?' from a time-limited run on one machine':''}, published ${publishedAge===null?'moments':elapsedWords(publishedAge)} ago.`
  :liveMode==='stale'?`Right now: our publication has stopped updating${publishedAge===null?'':`; the last was ${Math.max(1,Math.round(publishedAge/60))} min ago`}, and the passenger’s page says so.`
  :liveMode==='offline'?'Right now: this device is offline, and the passenger’s page says so.'
  :'Right now: no live collection is running, so the passenger’s page says that rather than show old positions.';
 const archiveNote=data?<p className="archive-note"><span className="archive-badge"><Clock3 size={14}/> ARCHIVE REPLAY</span>
  <span>Recorded {archiveDate}, {clock(data.start)}–{clock(data.end)} BST</span><small>Historical observations · not live</small></p>:null;
 return <main className="app-shell">
  <a className="skip-link" href="#content-start">{away?'Skip to the content':'Skip to your stop and buses'}</a>
  <header className="masthead"><Link className="brand" href={preview?'/preview/':'/'} aria-label="Lost Minutes home" onClick={event=>{if(away){event.preventDefault();show('follow')}}}><span className="brand-mark"><Route size={23}/></span>lost minutes<span className="brand-period">.</span></Link><span className="location-label">MANCHESTER / UK</span>
   {away
    ?<a href="#follow" onClick={event=>{event.preventDefault();show('follow')}} className="header-link back"><ArrowLeft size={16}/>Back to buses</a>
    :<a href="#behind-the-data" onClick={event=>{event.preventDefault();show('operations','#behind-the-data')}} className="header-link">Behind the data <ArrowUpRight size={16}/></a>}</header>
  {preview&&<p className="preview-banner" role="note" data-preview={previewPhoto3d?previewPhoto3d.provider:'none'}>
   <strong>Private preview</strong>
   <span className="preview-banner-long">{previewPhoto3d?'The view from above is on under Explore Manchester. It is not public.'
    :'No 3D imagery is configured on this server yet, so the view from above is not offered.'}</span>
   <span className="preview-banner-short">{previewPhoto3d?'Not public':'No 3D imagery configured'}</span>
   <Link href="/">Leave the preview</Link></p>}
  <div id="content-start" tabIndex={-1}/>

  {/* The passenger's page: laid out even while hidden, never gated on the recording. */}
  <div id="follow" className={`passenger-area${away?' away':''}`} inert={away}>
   <section className="page-heading compact"><div><p className="eyebrow">MANCHESTER BUSES</p><h1 id="passenger-title" tabIndex={-1}>Follow your bus.</h1><p className="intro">Every bus reporting in the area, drawn from its own reports a little behind them, and how long ago it last reported. Tap one to follow it.</p></div></section>
   <FollowView paused={away} mode={followMode} live={live} buses={followBuses} roads={roads} walkingConfig={config.walking}
    clockOffsetMs={!usingArchive&&serverRef&&liveFetchedAt?serverRef-liveFetchedAt:0}
    onRefresh={()=>loadLive(config.liveUrl)} refreshing={refreshing}
    publicationAgeSeconds={publishedAge} ageBasis={ageBasis} archiveDate={archiveDate}
    usingArchive={usingArchive}
    stops={catalogue?.stops??[]} stop={stop} onSelectStop={setStop}
    patterns={patterns} patternsById={patternsById}
    onLocate={locate} locating={locating} locationError={locationError}
    here={here} origin={origin} device={devicePoint} originEpoch={originEpoch} outsideArea={outsideArea}
    onClearHere={()=>{setOriginMode(null);stopWatch();setOutsideArea(false);try{sessionStorage.removeItem(ORIGIN_KEY)}catch{}}}
    pickingOrigin={pickingOrigin} onStartPicking={()=>setPickingOrigin(true)} onCancelPicking={()=>setPickingOrigin(false)}
    onChooseOrigin={chooseOrigin}
    onOpenEvidence={()=>show('evidence')}
    onUseArchive={data?()=>setUsingArchive(true):undefined}
    nowMs={reference} liveFingerprint={usingArchive?null:liveFingerprint} recall={usingArchive?undefined:recall}
    initialJourney={journey} journeyEpoch={journeyEpoch} onNewJourney={newJourney} onAddress={noteAddress}
    recording={ride?{id:ride.data.id,title:ride.data.title,date:ride.data.recordedOn,when:ride.data.fromLocal,
     busKey:rideBusKey(ride.data),started:ride.index>=0,ended:ride.ended,onLeave:leaveRecording,onReplay:replayRecording}:null}
    recordings={recordings} onWatchRecording={startRecording} recordingError={rideError}
    photo3d={preview?(previewPhoto3d??config.photo3d??null):(config.photo3d??null)}/>
   {usingArchive&&<button className="text-action follow-leave-archive"
    onClick={()=>setUsingArchive(false)}>Leave the recording and show live state</button>}
  </div>

  {away&&<section id="behind-the-data" className="data-area" aria-labelledby="data-title">
   <div className="page-heading data-heading"><div>
    <p className="eyebrow">BEHIND THE DATA</p>
    <h1 id="data-title" tabIndex={-1}>How Lost Minutes is built.</h1>
    <p className="intro">A personal data-engineering project. This is where each bus position on the passenger’s page comes from, how it is checked and how the page knows how fresh it is. Your stop and bus are kept while you are here.</p>
    <ol className="data-steps">
     <li><strong>Collect</strong><span>One collector reads the Department for Transport’s Bus Open Data Service every 20 seconds, for everyone. Each raw response is kept with its SHA-256 fingerprint; no phone contacts the service.</span></li>
     <li><strong>Check</strong><span>Every report is parsed and validated. A repeat is recorded as a repeat and conflicting reports are withheld. A bus is placed on a TfGM timetable pattern only when operator, timetable version, day and direction agree.</span></li>
     <li><strong>Publish</strong><span>A new file is checked as a whole, then swapped in at once. If a check fails, the last good file keeps serving.</span></li>
     <li><strong>Freshness</strong><span>Every age on screen is the bus’s own report’s. Positions older than 15 minutes are withheld, and the page says when our own publication has stopped updating.</span></li>
    </ol>
    <p className="data-stack">Python and DuckDB for the pipeline; Next.js and MapLibre for this page. <a href="https://github.com/Hammamelsh/lost-minutes" target="_blank" rel="noreferrer">Source and documentation on GitHub <ExternalLink size={13}/></a></p>
    <p className="data-now" role="status">{liveNow}</p>
   </div></div>
   <SectionBoundary resetKey={section} onBack={()=>show('follow')}>
   <Tabs value={section} onValueChange={value=>show(value as Section)} className="workspace-tabs">
    <div className="workspace-toolbar"><TabsList className="view-tabs" aria-label="Behind the data"><TabsTrigger value="operations"><Activity size={16}/>Operations</TabsTrigger><TabsTrigger value="evidence"><ShieldCheck size={16}/>Evidence</TabsTrigger><TabsTrigger value="recorded"><MapPin size={16}/>Recorded journeys</TabsTrigger></TabsList>{section!=='operations'&&data&&<div className="filters"><label htmlFor="route-select">Route</label><Select value={route} onValueChange={changeRoute}><SelectTrigger id="route-select" className="route-select"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">All recorded routes</SelectItem>{routeChoices.map(r=><SelectItem key={r} value={r}>{r.split('|')[1]} · {r.split('|')[0]}</SelectItem>)}</SelectContent></Select><label htmlFor="direction-select" className="sr-only">Direction</label><Select value={direction} onValueChange={v=>{setDirection(v);setSelected('')}}><SelectTrigger id="direction-select" className="direction-select"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">Both directions</SelectItem><SelectItem value="inbound">Inbound</SelectItem><SelectItem value="outbound">Outbound</SelectItem></SelectContent></Select></div>}</div>
    <TabsContent value="recorded" id="recorded-journeys">{!data?<RecordingLoading error={error}/>:<>
     {archiveNote}
     <div className="workspace-grid"><section className="map-card"><div className="map-card-head"><div><span className="eyebrow">{route==='all'?'THE RECORDED NETWORK':`ROUTE ${routeLabel}`}</span><h2>{chosen?cleanLabel(chosen.destination)||'Manchester journeys':'No journeys in this selection'}{chosen&&<ArrowDown size={18}/>}</h2></div><span className="time-chip">{clock(time,true)} <small>BST</small></span></div><MapView journeys={filtered} time={time} selected={chosen?.id??''} choose={setSelected} roads={roads}/><div className="map-foot"><Info size={15}/><p>Positions update only when an observation exists. Dashed trails connect samples; they are not exact road paths.</p></div></section>
     <aside className="journey-panel"><div className="panel-top"><span className="eyebrow">IN THIS VIEW</span><span className="tiny-label">at {clock(time)}</span></div><div className="headline-number">{seen.length}<span> buses observed</span></div><p className="muted">With a position no more than 2 minutes old at the replay time.</p><div className="mini-stats"><div><strong>{count.toLocaleString()}</strong><span>unique observations<br/>up to this moment</span></div><div><strong>{filtered.length}</strong><span>recorded journey tracks<br/>across the full sample</span></div></div><div className="section-rule"/><div className="section-title"><h3>Select a journey</h3><BusFront size={18}/></div><div className="journey-list">{filtered.length===0?<p className="empty-copy">No observations match this route and direction. Try another selection.</p>:filtered.map(j=>{const p=lastObservation(j,time);const isCurrent=!!latestVisible(j,time);return <button key={j.id} className={`journey-choice ${chosen?.id===j.id?'chosen':''}`} onClick={()=>setSelected(j.id)} aria-pressed={chosen?.id===j.id}><span className="route-pill">{j.route}</span><span className="journey-choice-copy"><strong>{j.vehicle}</strong><span>{cleanLabel(j.destination)||'Destination not supplied'}</span></span><span className={isCurrent?'fresh-label':'quiet-label'}>{isCurrent?'Observed':p?'Older':'Later'}</span></button>})}</div>
     {chosen&&<div className="selected-evidence"><div className="section-title"><h3>One bus, up close</h3><span>{chosen.vehicle}</span></div><dl><div><dt>Last observation</dt><dd>{point?clock(point.time,true):'Not yet observed'}</dd></div><div><dt>Age at replay time</dt><dd>{age===null?'—':`${age}s`}{age!==null&&age>120?' · older':''}</dd></div><div><dt>90th percentile sample gap</dt><dd>{p90===null?'Not enough points':`${Math.round(p90)}s`}</dd></div></dl><p className="microcopy">These are gaps in this sampled archive, not a measure of the operator’s full reporting frequency.</p><button className="text-action" onClick={()=>show('evidence')}>Inspect the source <ArrowUpRight size={16}/></button></div>}
     </aside></div>
     <section className="timeline-card" aria-label="Replay controls"><div className="playback"><button className="play-button" onClick={()=>{if(offset>=duration)setOffset(0);setPlaying(v=>!v)}} aria-label={playing?'Pause replay':'Play replay'}>{playing?<Pause size={23} fill="currentColor"/>:<Play size={23} fill="currentColor"/>}</button><div><strong>{clock(time,true)}</strong><span>Replay · 40× speed</span></div><button className="restart-button" aria-label="Restart recording" onClick={()=>{setOffset(0);setPlaying(false)}}><RotateCcw size={17}/></button></div><div className="timeline-track"><Slider min={0} max={duration} step={1} value={[offset]} onValueChange={v=>{setOffset(v[0]);setPlaying(false)}} aria-label="Replay time"/><div className="timeline-labels"><span>{clock(data.start)}</span><span>{Math.round(duration/60)}-minute recording · BST</span><span>{clock(data.end)}</span></div></div></section>
     <div className="next-measure"><Layers3 size={21}/><div><strong>A clear view of the evidence comes first.</strong><p>Timetable matching and stop arrivals are not yet validated. This version shows recorded movement; delay and reliability figures will appear only when supported.</p></div><button onClick={()=>show('evidence')} className="text-action">See what’s verified <ArrowUpRight size={16}/></button></div>
    </>}</TabsContent>
    <TabsContent value="evidence" id="evidence">{!data?<RecordingLoading error={error}/>:<>{archiveNote}<section className="evidence-heading"><span className="eyebrow">OBSERVATIONS, NOT ASSUMPTIONS</span><h2>What this recording can tell you.</h2><p>Real public bus data, sampled from the Open Innovations archive. Each accepted point retains its original timestamp and source fingerprint.</p></section><div className="evidence-stats"><div><Database size={21}/><strong>{data.sources.length}</strong><span>archived source snapshots</span></div><div><Check size={21}/><strong>{data.quality.uniqueObservations.toLocaleString()}</strong><span>accepted observations in the area</span></div><div><RotateCcw size={21}/><strong>{data.quality.duplicateObservations.toLocaleString()}</strong><span>repeated observations removed</span></div><div><ShieldCheck size={21}/><strong>{data.quality.conflictingObservations}</strong><span>conflicting identities suppressed</span></div></div><div className="evidence-columns"><section className="evidence-card"><h3>Reading this sample</h3><p>4,236 input observations = 3,426 retained + 740 repeats + 70 outside the capture window. A repeat has the same operator, vehicle, route, direction, journey reference, timestamp and coordinates. Identical coordinates with a new timestamp are retained. Conflicting coordinates at the same identity and time are suppressed.</p><ul>{data.limitations.map(l=><li key={l}>{l}</li>)}</ul><p><strong>Expected service coverage: unknown.</strong> We have not validated a schedule denominator. The number of observed buses is not a percentage of the expected service.</p><a href={data.sourceUrl} target="_blank" rel="noreferrer" className="text-action">Open the original archive <ExternalLink size={15}/></a></section><section className="evidence-card how-live-works"><h3>How the live view works</h3><ol><li><strong>A bus reports.</strong> Its equipment sends a position with its own timestamp, and a bearing where it has one. Operators must report every 10 to 30 seconds.</li><li><strong>We ask once, for everyone.</strong> One collector reads the feed on a fixed interval. Phones never contact the data service, and an identical response is recorded as a repeat rather than treated as news.</li><li><strong>Every report is checked.</strong> A timestamp without a time zone, an unreadable coordinate or a position dated in the future is set aside with its reason. Two sources disagreeing about one bus means neither is shown.</li><li><strong>A bus is placed on a timetable pattern only when the evidence allows.</strong> Same operator, a timetable version valid that day, journeys on that day, the reported direction, then position. When branches still compete, all of them are kept.</li><li><strong>Only checked data is published.</strong> If a publication fails its checks, the previous good one keeps serving.</li></ol><p>Nothing here is a prediction. A bus is drawn where it said it was, and when; the camera may move between reports, the bus never does.</p></section><section className="evidence-card"><h3>Selected observation</h3>{chosen&&point?<><dl><div><dt>Vehicle / operator</dt><dd>{chosen.vehicle} / {chosen.operator}</dd></div><div><dt>Journey reference</dt><dd>{chosen.journeyRef||'Not supplied'}</dd></div><div><dt>Source observation time</dt><dd>{point.recordedAt}</dd></div><div><dt>Coordinates</dt><dd>{point.lat.toFixed(6)}, {point.lon.toFixed(6)}</dd></div><div><dt>Archive capture time</dt><dd>{source?.capturedAt||'Unknown'}</dd></div></dl><p className="microcopy">SHA-256 identifies the exact downloaded source file.</p><code className="source-hash">{point.sourceHash}</code>{source&&<a href={source.url} target="_blank" rel="noreferrer" className="text-action">Original source ZIP ({(source.bytes/1e6).toFixed(1)} MB) <ExternalLink size={15}/></a>}</>:<p>Select a journey and replay time to inspect an observation.</p>}</section></div>{chosen&&<section className="evidence-card observation-table"><h3>Observation sequence · {chosen.vehicle}</h3><p>Source timestamps retain their supplied offsets; this sample is UTC, displayed in Europe/London (BST on this date). Coordinates have not been snapped to roads or stops.</p><Table><TableHeader><TableRow><TableHead>Recorded at</TableHead><TableHead>Latitude</TableHead><TableHead>Longitude</TableHead><TableHead>Gap from previous</TableHead><TableHead>At replay time</TableHead></TableRow></TableHeader><TableBody>{chosen.points.map((p,i)=><TableRow key={p.time}><TableCell>{clock(p.time,true)}</TableCell><TableCell>{p.lat.toFixed(6)}</TableCell><TableCell>{p.lon.toFixed(6)}</TableCell><TableCell>{i?`${Math.round((p.time-chosen.points[i-1].time)/1000)}s`:'First sample'}</TableCell><TableCell>{p.time>time?'Later in recording':'Available'}</TableCell></TableRow>)}</TableBody></Table></section>}<MotionEvidence/></>}</TabsContent>
    <TabsContent value="operations" id="operations">{ops
     ?<><OperationsView ops={ops} servedSnapshotId={data?.snapshotId}/>
       <CoverageLedger vehicles={live?.vehicles??[]} patterns={patterns}/></>
     :<section className="ops-card ops-empty"><Activity size={22}/><h3>No pipeline record is published</h3>
       <p>{opsError||'Run the pipeline to generate public/data/operations.json.'}</p>
       <code className="source-hash">.venv/bin/python -m pipeline.run import</code></section>}
    </TabsContent>
   </Tabs>
   </SectionBoundary>
  </section>}
  <SiteNotes feed={liveMode} publishedAgo={publishedAge===null?'':`${elapsedWords(publishedAge)} ago`} stop={null}
   photo3d={(preview?(previewPhoto3d??config.photo3d):config.photo3d)?.provider??null}/>
  <footer className="footer"><span>lost minutes<span className="brand-period">.</span> <span className="footer-caption">Made to make the journey clearer.</span></span><p>{data?.attribution??'Public bus observations with explicit source provenance.'} <a href="https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/" target="_blank" rel="noreferrer">OGL v3.0</a>{!away&&<> · <a href="#behind-the-data" onClick={event=>{event.preventDefault();show('operations','#behind-the-data')}}>Behind the data: how it is built</a></>}</p></footer>
 </main>
}
