"use client";

import {useId,useMemo,useRef,useState} from 'react';
import {LocateFixed,Search,X} from 'lucide-react';
import {bearingWords,searchStops,stopPlace,type Stop} from '@/lib/stops';

/**
 * Stop search, built to the ARIA combobox pattern: the input owns the listbox, the active
 * option is referenced by id rather than focused, and the result count is announced.
 * A native select cannot do this over 1,700 stops, and scrolling bare numbers was the
 * discovery problem in the first place.
 */
export default function StopSearch({stops,onSelect,onLocate,locating,locationError,
                                    placeholder='Search for a stop, street or area'}:{
 stops:Stop[];onSelect:(stop:Stop)=>void;onLocate?:()=>void;locating?:boolean;
 locationError?:string;placeholder?:string}){
 const [query,setQuery]=useState('');
 const [open,setOpen]=useState(false);
 const [active,setActive]=useState(0);
 const inputRef=useRef<HTMLInputElement>(null);
 const listId=useId(),statusId=useId();

 const matches=useMemo(()=>searchStops(stops,query,12),[stops,query]);
 const expanded=open&&query.trim().length>0;

 function choose(index:number){
  const match=matches[index];
  if(!match)return;
  onSelect(match.stop);
  setQuery('');setOpen(false);setActive(0);
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

 return <div className="stop-search">
  <div className="stop-search-field">
   <Search size={18} aria-hidden="true"/>
   <input ref={inputRef} type="text" value={query} role="combobox" autoComplete="off"
    aria-expanded={expanded} aria-controls={listId} aria-autocomplete="list"
    aria-activedescendant={expanded&&matches[active]?`${listId}-${active}`:undefined}
    aria-describedby={statusId} placeholder={placeholder} aria-label={placeholder}
    onChange={event=>{setQuery(event.target.value);setOpen(true);setActive(0)}}
    onKeyDown={keys} onFocus={()=>setOpen(true)}/>
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
      ? `${matches.length} ${matches.length===1?'stop':'stops'} found`
      : 'Type a stop name, street or area. Your location is optional.'}</p>

  {expanded&&<ul className="stop-search-list" role="listbox" id={listId}
    aria-label="Matching stops">
   {matches.length===0&&<li className="stop-search-empty" role="presentation">
    No stop here matches that. Only stops inside the collected area are listed.</li>}
   {matches.map(({stop},index)=>{
    const towards=bearingWords(stop.bearing);
    return <li key={stop.id} id={`${listId}-${index}`} role="option"
      aria-selected={index===active}
      className={`stop-search-option ${index===active?'active':''}`}
      onMouseEnter={()=>setActive(index)}
      onMouseDown={event=>{event.preventDefault();choose(index)}}>
     <strong>{stop.name}</strong>
     <small>{[stop.indicator,towards,stop.street].filter(Boolean).join(' · ')}</small>
     {stopPlace(stop)&&<em>{stopPlace(stop)}</em>}
    </li>;
   })}
  </ul>}
 </div>;
}
