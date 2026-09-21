"use client";

import {Fragment,useId,useMemo,useRef,useState} from 'react';
import {Bus,LocateFixed,Search,X} from 'lucide-react';
import {bearingWords,searchStops,stopPlace,type Stop} from '@/lib/stops';
import type {PatternCatalogue} from '@/lib/patterns';
import {looksLikeRoute,routeIndex,searchRoutes,type RouteHit} from '@/lib/route-search';

type Match={kind:'route';hit:RouteHit}|{kind:'stop';stop:Stop};

/**
 * One search for a bus number, a stop, a street or an area, built to the ARIA combobox pattern:
 * the input owns the listbox, the active option is referenced by id rather than focused, and
 * the result count is announced. Routes come from the timetable catalogue, so a route is found
 * whether or not a bus on it is reporting this minute; an exact number is listed before numbers
 * that merely begin with it. A native select cannot do this over 1,700 stops, and scrolling bare
 * numbers was the discovery problem in the first place.
 */
export default function StopSearch({stops,patterns=null,onSelect,onSelectRoute,onLocate,locating,locationError,
                                    placeholder='Bus number, stop or area',compact=false}:{
 stops:Stop[];patterns?:PatternCatalogue|null;onSelect:(stop:Stop)=>void;onSelectRoute?:(hit:RouteHit)=>void;
 onLocate?:()=>void;locating?:boolean;locationError?:string;placeholder?:string;compact?:boolean}){
 const [query,setQuery]=useState('');
 const [open,setOpen]=useState(false);
 const [active,setActive]=useState(0);
 const inputRef=useRef<HTMLInputElement>(null);
 const listId=useId(),statusId=useId();

 const routes=useMemo(()=>routeIndex(patterns),[patterns]);
 const matches=useMemo<Match[]>(()=>{
  const found:Match[]=onSelectRoute?searchRoutes(routes,query).map(hit=>({kind:'route',hit})):[];
  // A bare number is a bus first; stops whose name holds it (a "Stop 15") still follow.
  return [...found,...searchStops(stops,query,looksLikeRoute(query)?6:12).map(({stop})=>({kind:'stop' as const,stop}))];
 },[routes,stops,query,onSelectRoute]);
 const expanded=open&&query.trim().length>0;
 const routeCount=matches.filter(m=>m.kind==='route').length,stopCount=matches.length-routeCount;

 function choose(index:number){
  const match=matches[index];
  if(!match)return;
  if(match.kind==='route')onSelectRoute?.(match.hit);else onSelect(match.stop);
  setQuery('');setOpen(false);setActive(0);
 }

 // With a phone's keyboard up only the top of the screen is left, and the matches opened below the
 // field behind it (one visible of nine at 360 px). The field goes to the top, once the keyboard
 // has had time to open, so the matches have the room between it and the keyboard.
 function roomForMatches(){
  if(!window.matchMedia?.('(pointer: coarse)').matches)return;
  const field=inputRef.current?.closest('.stop-search-field');
  window.setTimeout(()=>field?.scrollIntoView({block:'start',behavior:'smooth'}),250);
 }

 function keys(event:React.KeyboardEvent<HTMLInputElement>){
  if(event.key==='ArrowDown'||event.key==='ArrowUp'){
   event.preventDefault();
   if(!matches.length)return;
   setOpen(true);
   setActive(current=>{
    const next=event.key==='ArrowDown'?current+1:current-1;
    return (next+matches.length)%matches.length;
   });
   return;
  }
  if(event.key==='Home'&&expanded){event.preventDefault();setActive(0);return}
  if(event.key==='End'&&expanded){event.preventDefault();setActive(matches.length-1);return}
  if(event.key==='Enter'&&expanded){event.preventDefault();choose(active);return}
  if(event.key==='Escape'){setOpen(false);setActive(0)}
 }

 return <div className={`stop-search${compact?' compact':''}`}>
  <div className="stop-search-field">
   <Search size={18} aria-hidden="true"/>
   <input ref={inputRef} type="text" value={query} role="combobox" autoComplete="off"
    aria-expanded={expanded} aria-controls={listId} aria-autocomplete="list"
    aria-activedescendant={expanded&&matches[active]?`${listId}-${active}`:undefined}
    aria-describedby={statusId} placeholder={placeholder} aria-label={placeholder}
    onChange={event=>{setQuery(event.target.value);setOpen(true);setActive(0)}}
    onKeyDown={keys} onFocus={()=>{setOpen(true);roomForMatches()}}/>
   {query&&<button className="stop-search-clear" aria-label="Clear the search"
     onClick={()=>{setQuery('');setOpen(false);inputRef.current?.focus()}}><X size={16}/></button>}
   {onLocate&&<button className="stop-search-locate" onClick={onLocate} disabled={locating}
     aria-label="Find stops near me">
     <LocateFixed size={18} className={locating?'spin':''}/></button>}
  </div>

  <p id={statusId} className="stop-search-status" role="status">
   {locationError
    ? locationError
    : expanded
      ? [routeCount?`${routeCount} ${routeCount===1?'route':'routes'}`:'',stopCount?`${stopCount} ${stopCount===1?'stop':'stops'}`:'']
         .filter(Boolean).join(' and ')+(matches.length?' found':'nothing found')
      : compact?'':'Type a bus number (like 263), a stop name, a street or an area. Your location is optional.'}</p>

  {expanded&&<ul className="stop-search-list" role="listbox" id={listId}
    aria-label="Matching routes and stops">
   {matches.length===0&&<li className="stop-search-empty" role="presentation">
    Nothing matches that. Try a bus number (263, 42A), a stop name, a street or an area; only stops
    inside the collected area are listed.</li>}
   {matches.map((match,index)=>{
    const header=index===0||matches[index-1].kind!==match.kind
     ? <li key={`h-${match.kind}`} className="stop-search-group" role="presentation">{match.kind==='route'?'Routes':'Stops'}</li>:null;
    if(match.kind==='route'){
     const {hit}=match;
     const ways=hit.directions.slice(0,2).map(d=>`to ${d.destination??'?'}`).join(' · ');
     return <Fragment key={hit.id}>{header}<li id={`${listId}-${index}`} role="option" aria-selected={index===active}
       className={`stop-search-option route ${index===active?'active':''}`}
       onMouseEnter={()=>setActive(index)} onMouseDown={event=>{event.preventDefault();choose(index)}}>
      <span className="route-pill"><Bus size={12} aria-hidden="true"/>{hit.line}</span>
      <strong>Route {hit.line}{hit.exact?'':' …'}</strong>
      <small>{ways}{hit.directions.length>2?` · +${hit.directions.length-2} more`:''}{hit.operator?` · ${hit.operator}`:''}</small>
     </li></Fragment>;
    }
    const {stop}=match;
    const towards=bearingWords(stop.bearing);
    return <Fragment key={stop.id}>{header}<li id={`${listId}-${index}`} role="option"
      aria-selected={index===active}
      className={`stop-search-option ${index===active?'active':''}`}
      onMouseEnter={()=>setActive(index)}
      onMouseDown={event=>{event.preventDefault();choose(index)}}>
     <strong>{stop.name}</strong>
     <small>{[stop.indicator,towards,stop.street].filter(Boolean).join(' · ')}</small>
     {stopPlace(stop)&&<em>{stopPlace(stop)}</em>}
    </li></Fragment>;
   })}
  </ul>}
 </div>;
}
