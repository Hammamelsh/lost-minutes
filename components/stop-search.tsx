"use client";

import {Fragment,useEffect,useId,useMemo,useRef,useState} from 'react';
import {Bus,ChevronDown,LocateFixed,MapPin,Search,X} from 'lucide-react';
import {addressPlaces,postcodePlaces,PLACES_ATTRIBUTION,type Place} from '@/lib/places';
import {bearingWords,searchStops,stopPlace,type Stop} from '@/lib/stops';
import {servicesAt,towardsWords,type PatternCatalogue} from '@/lib/patterns';
import {looksLikeRoute,routeIndex,searchRoutes,type RouteHit} from '@/lib/route-search';

type Match={kind:'route';hit:RouteHit}|{kind:'stop';stop:Stop}|{kind:'place';place:Place}|{kind:'more';count:number};
/** Stops listed before the places, while places are being asked for: enough to find one's own stop, few enough that
 *  a place is not pushed under the keyboard (four stands of one coach station filled a phone's screen, 1 October
 *  2026). The rest are one tap away. */
const STOPS_BEFORE_PLACES=3;

/**
 * One search for a bus number, a stop, a street or an area, built to the ARIA combobox pattern:
 * the input owns the listbox, the active option is referenced by id rather than focused, and
 * the result count is announced. Routes come from the timetable catalogue, so a route is found
 * whether or not a bus on it is reporting this minute; an exact number is listed before numbers
 * that merely begin with it. A native select cannot do this over 1,700 stops, and scrolling bare
 * numbers was the discovery problem in the first place.
 */
export default function StopSearch({stops,patterns=null,day,onSelect,onSelectRoute,onLocate,locating,locationError,
                                    placeholder='Bus number, stop or area',compact=false,onFocusField,onLeaveField,onListChange,closeSignal=0,places}:{
 stops:Stop[];patterns?:PatternCatalogue|null;
 /** The service day: with it, each stop says where its buses go today, which is how a passenger
  *  tells one side of the road from the other. */
 day?:string;
 onSelect:(stop:Stop)=>void;onSelectRoute?:(hit:RouteHit)=>void;
 onLocate?:()=>void;locating?:boolean;locationError?:string;placeholder?:string;compact?:boolean;onFocusField?:()=>void;
 /** Focus has left the field. `chose` says whether a match was taken on the way out, so a caller
  *  that folded something away for the keyboard knows whether the task has moved on or not. */
 onLeaveField?:(chose:boolean)=>void;
 /** The matches opened or closed: a screen of their own on a phone, which the page puts in its history. */
 onListChange?:(open:boolean)=>void;
 /** Changed by the page to close the matches (the phone's Back). */
 closeSignal?:number;
 /** Places too (postcodes, addresses, landmarks): asked for as one types, after a pause, and picked to plan a
  *  journey there. `near` ranks them; it is rounded before it leaves the page (lib/places.ts). */
 places?:{near:{lat:number;lon:number}|null;onPick:(place:Place)=>void}}){
 const [query,setQuery]=useState('');
 const [open,setOpen]=useState(false);
 const [active,setActive]=useState(0);
 const inputRef=useRef<HTMLInputElement>(null);
 const listId=useId(),statusId=useId();

 const routes=useMemo(()=>routeIndex(patterns),[patterns]);
 // Places, from the same providers the planner uses, for a query that is not a bus number. A late answer to an
 // earlier query is dropped. Stops and routes are listed at once; places join them as they come.
 const [found,setFound]=useState<{query:string;places:Place[]}|null>(null);
 const [moreStops,setMoreStops]=useState(false);
 const placeQuery=places&&query.trim().length>=3&&!looksLikeRoute(query)?query.trim():'';
 const near=places?.near??null;
 const nearKey=near?`${near.lat.toFixed(2)},${near.lon.toFixed(2)}`:'';
 useEffect(()=>{
  if(!placeQuery)return;
  const controller=new AbortController();
  const timer=setTimeout(()=>{
   const options={signal:controller.signal,near:near??undefined};
   Promise.all([postcodePlaces(placeQuery,options),addressPlaces(placeQuery,options)])
    .then(([postcodes,addresses])=>{if(!controller.signal.aborted)setFound({query:placeQuery,places:[...postcodes,...addresses].slice(0,6)})});
  },350);
  return()=>{clearTimeout(timer);controller.abort()};
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[placeQuery,nearKey]);
 const placesFound=placeQuery&&found?.query===placeQuery?found.places:null;
 const placesWaiting=Boolean(placeQuery)&&placesFound===null;
 const matches=useMemo<Match[]>(()=>{
  const found:Match[]=onSelectRoute?searchRoutes(routes,query).map(hit=>({kind:'route',hit})):[];
  // A bare number is a bus first; stops whose name holds it (a "Stop 15") still follow.
  const stopsFound=searchStops(stops,query,looksLikeRoute(query)?6:12).map(({stop})=>({kind:'stop' as const,stop}));
  if(!placeQuery)return [...found,...stopsFound];
  const shown=moreStops?stopsFound:stopsFound.slice(0,STOPS_BEFORE_PLACES);
  const rest=stopsFound.length-shown.length;
  return [...found,...shown,...(placesFound??[]).map(place=>({kind:'place' as const,place})),...(rest>0?[{kind:'more' as const,count:rest}]:[])];
 },[routes,stops,query,onSelectRoute,placeQuery,placesFound,moreStops]);
 const expanded=open&&query.trim().length>0;
 const routeCount=matches.filter(m=>m.kind==='route').length,placeCount=matches.filter(m=>m.kind==='place').length;
 const stopCount=matches.filter(m=>m.kind==='stop').length+(matches.find(m=>m.kind==='more')?.kind==='more'?(matches.find(m=>m.kind==='more') as {count:number}).count:0);
 // The page is told when the matches open and close; and closes them when it says so (Back).
 const told=useRef(false);
 useEffect(()=>{if(told.current!==expanded){told.current=expanded;onListChange?.(expanded)}},[expanded,onListChange]);
 const seenSignal=useRef(closeSignal);
 // Closed by Back, the field lets go too, so that a tap on it opens its matches again (a tap on a field that kept the
 // focus is no new focus).
 // Only matches that were showing: a field emptied by the passenger, its matches gone with the text, keeps the focus.
 useEffect(()=>{if(seenSignal.current!==closeSignal){seenSignal.current=closeSignal;if(told.current){setOpen(false);setActive(0);inputRef.current?.blur()}}},[closeSignal]);

 const chose=useRef(false);
 function choose(index:number){
  chose.current=true;
  const match=matches[index];
  if(!match)return;
  if(match.kind==='more'){chose.current=false;setMoreStops(true);return}
  if(match.kind==='route')onSelectRoute?.(match.hit);else if(match.kind==='place')places?.onPick(match.place);else onSelect(match.stop);
  setQuery('');setOpen(false);setActive(0);setMoreStops(false);
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
    onChange={event=>{setQuery(event.target.value);setOpen(true);setActive(0);setMoreStops(false)}}
    onKeyDown={keys} onFocus={()=>{chose.current=false;setOpen(true);roomForMatches();onFocusField?.()}} onClick={()=>setOpen(true)}
    onBlur={()=>{onLeaveField?.(chose.current);chose.current=false}}/>
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
      ? (()=>{const parts=[routeCount?`${routeCount} ${routeCount===1?'route':'routes'}`:'',stopCount?`${stopCount} ${stopCount===1?'stop':'stops'}`:'',
          placeCount?`${placeCount} ${placeCount===1?'place':'places'}`:''].filter(Boolean);
         const said=parts.length?`${parts.length>1?`${parts.slice(0,-1).join(', ')} and ${parts[parts.length-1]}`:parts[0]} found`:placesWaiting?'':'nothing found';
         return [said,placesWaiting?'looking for places…':''].filter(Boolean).join(' · ')})()
      : compact?'':'Type a bus number (like 263), a stop name, a street or an area. Your location is optional.'}</p>

  {expanded&&<ul className="stop-search-list" role="listbox" id={listId}
    aria-label="Matching routes and stops">
   {matches.length===0&&!placesWaiting&&<li className="stop-search-empty" role="presentation">
    Nothing matches that. Try a bus number (263, 42A), a stop name, a street or an area; only stops
    inside the collected area are listed.</li>}
   {matches.map((match,index)=>{
    const header=match.kind!=='more'&&(index===0||matches[index-1].kind!==match.kind)
     ? <li key={`h-${match.kind}`} className="stop-search-group" role="presentation">{match.kind==='route'?'Routes':match.kind==='place'?'Places · plan a journey there':'Stops'}</li>:null;
    if(match.kind==='more')return <li key="more" id={`${listId}-${index}`} role="option" aria-selected={index===active}
      className={`stop-search-option more ${index===active?'active':''}`} data-more-stops
      onMouseEnter={()=>setActive(index)} onMouseDown={event=>{event.preventDefault();choose(index)}}>
      <strong><ChevronDown size={14} aria-hidden="true"/> {match.count} more {match.count===1?'stop':'stops'}</strong></li>;
    if(match.kind==='place'){
     const {place}=match;
     return <Fragment key={`p-${place.source}|${place.lat}|${place.lon}|${place.label}`}>{header}<li id={`${listId}-${index}`} role="option" aria-selected={index===active}
       className={`stop-search-option place ${index===active?'active':''}`} data-place
       onMouseEnter={()=>setActive(index)} onMouseDown={event=>{event.preventDefault();choose(index)}}>
      <strong><MapPin size={14} aria-hidden="true"/> {place.label}</strong><small>{place.detail}</small></li></Fragment>;
    }
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
    // Where this stop's buses go today: the side of the road, in the passenger's own terms.
    const goes=patterns&&day?towardsWords(servicesAt(patterns,stop.id,day)):'';
    return <Fragment key={stop.id}>{header}<li id={`${listId}-${index}`} role="option"
      aria-selected={index===active}
      className={`stop-search-option ${index===active?'active':''}`}
      onMouseEnter={()=>setActive(index)}
      onMouseDown={event=>{event.preventDefault();choose(index)}}>
     <strong>{stop.name}</strong>
     <small>{[stop.indicator,towards,stop.street].filter(Boolean).join(' · ')}</small>
     {goes&&<small className="search-towards" data-towards>{goes}</small>}
     {stopPlace(stop)&&<em>{stopPlace(stop)}</em>}
    </li></Fragment>;
   })}
   {placesWaiting&&<li className="stop-search-waiting" role="presentation" data-places-waiting>Looking for places…</li>}
   {placeCount>0&&<li className="stop-search-credit" role="presentation">{PLACES_ATTRIBUTION}</li>}
  </ul>}
 </div>;
}
