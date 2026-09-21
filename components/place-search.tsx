'use client';
// A place to start from or go to: our stops, a postcode, an address or a landmark, each shown with
// what tells it from its namesakes, and none chosen until the passenger picks it. Providers are
// asked only as the passenger types, after a pause, and a late answer to an earlier query is
// dropped, so a changed destination can never show the previous one's results.
import {Fragment,useEffect,useId,useRef,useState} from 'react';
import {LocateFixed,MapPin,Search,X} from 'lucide-react';
import type {Stop} from '@/lib/stops';
import {searchPlaces,type Place} from '@/lib/places';

export default function PlaceSearch({stops,near,onPick,onUseDevice,placeholder,label,autoFocus=false}:{
 stops:Stop[];near?:{lat:number;lon:number}|null;onPick:(place:Place)=>void;onUseDevice?:()=>void;
 placeholder:string;label:string;autoFocus?:boolean}){
 const [query,setQuery]=useState('');
 const [results,setResults]=useState<Place[]>([]);
 const [state,setState]=useState<'idle'|'searching'|'done'>('idle');
 const [active,setActive]=useState(0);
 const inputRef=useRef<HTMLInputElement>(null);
 const listId=useId(),statusId=useId();
 const requestRef=useRef(0);
 useEffect(()=>{
  const q=query.trim();
  const id=++requestRef.current;
  if(!q)return;
  const controller=new AbortController();
  const timer=setTimeout(()=>{
   setState('searching');
   searchPlaces(q,stops,{signal:controller.signal,near:near??undefined}).then(found=>{
    if(id!==requestRef.current)return;   // a later query is what counts now
    setResults(found);setState('done');setActive(0);
   });
  },300);
  return()=>{clearTimeout(timer);controller.abort()};
 },[query,stops,near]);
 // Results belong to the query that is typed: an emptied field shows none, whatever arrived.
 const shown=query.trim()?results:[];
 const rows:({kind:'device'}|{kind:'place';place:Place})[]=[...(onUseDevice?[{kind:'device' as const}]:[]),...shown.map(place=>({kind:'place' as const,place}))];
 const expanded=query.trim().length>0||Boolean(onUseDevice);
 function choose(index:number){
  const row=rows[index];if(!row)return;
  if(row.kind==='device')onUseDevice?.();else onPick(row.place);
  setQuery('');setResults([]);setState('idle');
 }
 function keys(event:React.KeyboardEvent<HTMLInputElement>){
  if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();if(!rows.length)return;
   setActive(c=>(c+(event.key==='ArrowDown'?1:-1)+rows.length)%rows.length);return}
  if(event.key==='Enter'&&rows[active]){event.preventDefault();choose(active)}
 }
 const groupOf=(p:Place)=>p.kind==='stop'?'Bus stops':p.kind==='postcode'?'Postcodes':'Addresses and places';
 return <div className="place-search" data-place-search={label}>
  <div className="stop-search-field">
   <Search size={18} aria-hidden="true"/>
   <input ref={inputRef} type="text" value={query} role="combobox" autoComplete="off" autoFocus={autoFocus}
    aria-expanded={expanded} aria-controls={listId} aria-autocomplete="list" aria-label={label}
    aria-activedescendant={expanded&&rows[active]?`${listId}-${active}`:undefined} aria-describedby={statusId}
    placeholder={placeholder} onChange={e=>{setQuery(e.target.value);setActive(0)}} onKeyDown={keys}/>
   {query&&<button className="stop-search-clear" aria-label="Clear" onClick={()=>{setQuery('');inputRef.current?.focus()}}><X size={16}/></button>}
  </div>
  <p id={statusId} className="stop-search-status" role="status">
   {!query.trim()?'':state==='searching'?'Searching…':state==='done'?(shown.length?`${shown.length} ${shown.length===1?'place':'places'} found: pick one to confirm it`:'Nothing found in Greater Manchester. Try a postcode, a street, a landmark or a stop name.'):''}</p>
  {expanded&&<ul className="stop-search-list" role="listbox" id={listId} aria-label={`${label}: matches`}>
   {rows.map((row,index)=>{
    if(row.kind==='device')return <li key="device" id={`${listId}-${index}`} role="option" aria-selected={index===active}
      className={`stop-search-option device ${index===active?'active':''}`} onMouseEnter={()=>setActive(index)}
      onMouseDown={e=>{e.preventDefault();choose(index)}}><LocateFixed size={15} aria-hidden="true"/><strong>My location</strong><small>where this device is now; asks permission</small></li>;
    const {place}=row;
    const header=index===0||rows[index-1].kind!=='place'||groupOf((rows[index-1] as {place:Place}).place)!==groupOf(place)
     ? <li key={`h-${index}`} className="stop-search-group" role="presentation">{groupOf(place)}</li>:null;
    return <Fragment key={`${place.source}|${place.lat}|${place.lon}|${place.label}`}>{header}<li id={`${listId}-${index}`} role="option" aria-selected={index===active}
      className={`stop-search-option ${index===active?'active':''}`} onMouseEnter={()=>setActive(index)}
      onMouseDown={e=>{e.preventDefault();choose(index)}}>
     <MapPin size={14} aria-hidden="true"/><strong>{place.label}</strong><small>{place.detail}</small></li></Fragment>;
   })}
  </ul>}
 </div>;
}
