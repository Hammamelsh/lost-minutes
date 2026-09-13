"use client";

import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {ExternalLink,Film,Maximize2,Pause,Play} from 'lucide-react';
import {parseWindowSeat,playerUrl,recordingWords,type WindowSeat,type WindowSeatJourney} from '@/lib/window-seat';
import type {PatternCatalogue} from '@/lib/patterns';
import type {Stop} from '@/lib/stops';

/**
 * A window-seat journey: an independent creator's film from a real bus, shown through the video
 * service's own embed. Nothing loads from the service until the passenger asks; play, pause and
 * full screen are then driven through the player's message API, and if the player never
 * answers, the original video is one tap away. It is a recording, kept apart from anything live.
 */
type PlayerState='idle'|'loading'|'ready'|'playing'|'paused'|'buffering'|'ended'|'error'|'timeout';
const PLAYER_ORIGIN='https://www.youtube-nocookie.com';
const READY_TIMEOUT_MS=12_000;
const ERROR_WORDS:Record<number,string>={2:'the player rejected the request',5:'the player could not start',
 100:'the video is no longer available',101:'its owner does not allow it to be embedded',
 150:'its owner does not allow it to be embedded',153:'the player refused this page'};

function stateWords(state:PlayerState){
 switch(state){
  case 'idle':return 'not loaded';case 'loading':return 'loading the player';case 'ready':return 'ready';
  case 'playing':return 'playing';case 'paused':return 'paused';case 'buffering':return 'buffering';
  case 'ended':return 'finished';case 'error':return 'not playable here';case 'timeout':return 'the player did not answer';
 }
}

export default function WindowSeatJourneys({patterns,stops}:{patterns:PatternCatalogue|null;stops:Stop[]}){
 const [data,setData]=useState<WindowSeat|null|undefined>(undefined);
 useEffect(()=>{
  let current=true;
  fetch('/data/window-seat.json',{cache:'no-store'}).then(r=>r.ok?r.json():null)
   .then(value=>{if(current)setData(value?parseWindowSeat(value):null)}).catch(()=>{if(current)setData(null)});
  return()=>{current=false};
 },[]);
 if(data===undefined)return null;
 if(data===null)return null;
 return <section className="window-seat" aria-label="Window-seat journeys">
  <div className="ws-head"><span className="eyebrow">WINDOW-SEAT JOURNEY · RECORDED</span>
   <h2>See the streets from a real bus.</h2>
   <p>A film from the upper deck by an independent creator, shown through YouTube’s own player. A
    recording from another day: it is not live and is not the bus tracked on the Follow tab.</p></div>
  {data.journeys.map(journey=><JourneyCard key={journey.id} journey={journey} patterns={patterns} stops={stops}/>)}
 </section>;
}

function JourneyCard({journey,patterns,stops}:{journey:WindowSeatJourney;patterns:PatternCatalogue|null;stops:Stop[]}){
 const [player,setPlayer]=useState<PlayerState>('idle');
 const [errorCode,setErrorCode]=useState<number|null>(null);
 const [origin,setOrigin]=useState('');
 const frame=useRef<HTMLIFrameElement>(null);
 const box=useRef<HTMLDivElement>(null);
 const readyTimer=useRef<ReturnType<typeof setTimeout>|null>(null);

 // The player's own messages: only from its origin, only for this frame.
 useEffect(()=>{
  if(player==='idle')return;
  const onMessage=(event:MessageEvent)=>{
   if(event.origin!==PLAYER_ORIGIN||event.source!==frame.current?.contentWindow)return;
   let message:{event?:string;info?:unknown};
   try{message=JSON.parse(String(event.data))}catch{return}
   if(message.event==='onReady'){
    if(readyTimer.current){clearTimeout(readyTimer.current);readyTimer.current=null}
    setPlayer(current=>current==='loading'||current==='timeout'?'ready':current);
   }else if(message.event==='onError'&&typeof message.info==='number'){
    if(readyTimer.current){clearTimeout(readyTimer.current);readyTimer.current=null}
    setErrorCode(message.info);setPlayer('error');
   }else if(message.event==='infoDelivery'&&message.info&&typeof message.info==='object'){
    const state=(message.info as {playerState?:unknown}).playerState;
    if(typeof state!=='number')return;
    setPlayer(current=>current==='error'?current
     :state===1?'playing':state===2?'paused':state===3?'buffering':state===0?'ended':current==='loading'?'ready':current);
   }
  };
  window.addEventListener('message',onMessage);
  return()=>window.removeEventListener('message',onMessage);
 },[player]);
 useEffect(()=>()=>{if(readyTimer.current)clearTimeout(readyTimer.current)},[]);

 const load=()=>{
  // This page's origin, read when the passenger asks: the player answers only to it.
  setOrigin(window.location.origin);
  setPlayer('loading');setErrorCode(null);
  readyTimer.current=setTimeout(()=>setPlayer(current=>current==='loading'?'timeout':current),READY_TIMEOUT_MS);
 };
 const send=useCallback((func:string)=>{
  frame.current?.contentWindow?.postMessage(JSON.stringify({event:'command',func,args:[]}),PLAYER_ORIGIN);
 },[]);
 const listen=()=>{
  // Asks the player to report its state; without this it stays silent.
  frame.current?.contentWindow?.postMessage(JSON.stringify({event:'listening',id:journey.video.id,channel:'widget'}),PLAYER_ORIGIN);
 };
 const fullscreen=()=>{
  const target=box.current;
  if(target?.requestFullscreen)target.requestFullscreen().catch(()=>{});
 };

 const loaded=player!=='idle';
 const playable=player==='ready'||player==='playing'||player==='paused'||player==='buffering'||player==='ended';
 const failed=player==='error'||player==='timeout';
 const today=useMemo(()=>{
  const lookup=journey.route.todayLookup;
  if(!lookup||!patterns)return null;
  const candidates=patterns.patterns.filter(p=>p.line===lookup.line&&p.direction===lookup.direction);
  const pattern=[...candidates].sort((a,b)=>(b.journeys??0)-(a.journeys??0))[0];
  if(!pattern)return null;
  const names=new Map(stops.map(s=>[s.id,s.indicator?`${s.name} (${s.indicator})`:s.name]));
  return {pattern,stops:pattern.stops.map(id=>names.get(id)??id)};
 },[journey,patterns,stops]);

 return <article className="ws-card" data-player={player}>
  <div className="ws-player-column">
   <div className="ws-player" ref={box} data-loaded={loaded?'yes':'no'}>
    {!loaded&&<div className="ws-facade">
     <Film size={26}/>
     <strong>{journey.title}</strong>
     <button className="ws-load" onClick={load}><Play size={18} fill="currentColor"/>Play on this page</button>
     <small>Loads YouTube’s player from youtube-nocookie.com, which then applies Google’s privacy
      policy. Nothing is loaded until you tap.</small>
    </div>}
    {loaded&&origin&&<iframe ref={frame} className="ws-frame" src={playerUrl(journey,origin)}
     title={journey.video.titleAsPublished} onLoad={listen}
     allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen
     referrerPolicy="strict-origin-when-cross-origin"/>}
   </div>
   <div className="ws-controls" aria-label="Playback">
    <button onClick={()=>send(player==='playing'?'pauseVideo':'playVideo')} disabled={!playable}
     aria-label={player==='playing'?'Pause':'Play'}>
     {player==='playing'?<Pause size={16} fill="currentColor"/>:<Play size={16} fill="currentColor"/>}
     <span>{player==='playing'?'Pause':'Play'}</span></button>
    <button onClick={fullscreen} disabled={!loaded} aria-label="Full screen"><Maximize2 size={16}/><span>Full screen</span></button>
    <a className="ws-original" href={journey.video.url} target="_blank" rel="noopener noreferrer">
     <ExternalLink size={15}/>Open original video</a>
    <span className="ws-state" role="status">{stateWords(player)}
     {player==='error'&&errorCode!==null?` (${ERROR_WORDS[errorCode]??`error ${errorCode}`})`:''}</span>
   </div>
   {failed&&<p className="ws-fallback" role="alert">The video cannot be played here{player==='error'&&errorCode!==null
    ?`: ${ERROR_WORDS[errorCode]??`error ${errorCode}`}`:''}. Open the original on YouTube instead; it is the same recording.</p>}
  </div>
  <div className="ws-about">
   <p className="ws-badge"><span className="archive-badge">RECORDED JOURNEY</span>
    <span>{recordingWords(journey.recording,journey.video.publishedAt)}</span></p>
   <h3>{journey.title}</h3>
   <dl className="ws-facts">
    <div><dt>Route</dt><dd><strong>{journey.route.line}</strong> {journey.route.from} → {journey.route.to}
     {journey.route.direction?` · ${journey.route.direction}`:''}</dd></div>
    <div><dt>Filmed by</dt><dd><a href={journey.video.creator.url} target="_blank" rel="noopener noreferrer">{journey.video.creator.name}</a>
     {' '}· published {journey.video.publishedAt} · {Math.round(journey.video.lengthSeconds/60)} min</dd></div>
    <div><dt>Operator</dt><dd>{journey.route.operatorAtRecording??'not stated by the creator'}</dd></div>
   </dl>
   <p className="ws-note">{journey.route.operatorNote} {journey.chaptersNote}</p>
   <h4>Along the way</h4>
   <ul className="ws-highlights">{journey.highlights.map(item=><li key={item.name}><strong>{item.name}</strong> <span>{item.note}</span></li>)}</ul>
   <details className="ws-details"><summary>Stops as listed by the creator ({journey.stopsAsListedByCreator.length})</summary>
    <ol>{journey.stopsAsListedByCreator.map((name,i)=><li key={`${i}-${name}`}>{name}</li>)}</ol>
    <p className="microcopy">Copied from the video description; the film has no timestamps for them.</p></details>
   {today&&<details className="ws-details ws-today"><summary>Today’s {journey.route.line} in the timetable ({today.stops.length} stops)</summary>
    <p className="microcopy">For orientation only: the current timetable pattern to {today.pattern.destination||'its terminus'}
     {' '}({today.pattern.operator}, {today.pattern.runs}). It is not the route recorded in {journey.recording.date?.slice(0,4)??'the film'} and is not synchronised with the film.</p>
    <ol>{today.stops.map((name,i)=><li key={`${i}-${name}`}>{name}</li>)}</ol></details>}
   <details className="ws-details"><summary>Source and permission</summary>
    <p className="microcopy">“{journey.video.titleAsPublished}” by {journey.video.creator.name}. {journey.video.licence}{' '}
     Embedding was confirmed on {journey.video.embeddableCheckedAt}. Recording date basis: {journey.recording.basis}{' '}
     Direction basis: {journey.route.basis}</p></details>
  </div>
 </article>;
}
