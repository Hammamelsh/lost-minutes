"use client";

import type {SchematicItem} from '@/lib/journey';

/**
 * Named stops in the timetable's order between the bus's nearest stop and yours. A strip of
 * dots, deliberately not a map line: it shows sequence, not the road, and never a time.
 */
export default function StopProgress({items,compact=false}:{items:SchematicItem[];compact?:boolean}){
 if(!items.length)return null;
 return <figure className={`stop-progress${compact?' compact':''}`}>
  <ol aria-label="Stops in the timetable’s order">
   {items.map((item,index)=>{
    if(item.kind==='gap')return <li key={`gap-${index}`} className="sp-gap">
     <span className="sp-dot" aria-hidden="true"/><span className="sp-name">{item.count} more {item.count===1?'stop':'stops'}</span></li>;
    if(item.kind==='fork')return <li key={`fork-${index}`} className="sp-fork">
     <span className="sp-dot" aria-hidden="true"/><span className="sp-name">branches part here · {item.branches} possible</span></li>;
    return <li key={`${item.atco}-${index}`} className={`sp-stop ${item.role}`}>
     <span className="sp-dot" aria-hidden="true"/>
     <span className="sp-name">{item.name}</span>
     {item.role==='bus'&&<em>last report nearest here</em>}
     {item.role==='yours'&&<em>your stop</em>}
     {item.role==='both'&&<em>your stop · last report nearest here</em>}
    </li>;
   })}
  </ol>
  {!compact&&<figcaption>Stop order from the timetable, not the road, and not a time.</figcaption>}
 </figure>;
}
