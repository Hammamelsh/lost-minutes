'use client';

import {useState} from 'react';
import {ClipboardCheck, Copy, Globe, MapPin, MessageSquare} from 'lucide-react';
import {BUILD} from '@/lib/build';

/** Where a beta report goes. The repository is public and issues are the record; nothing is
 *  collected by this page, so there is nowhere else for a report to go. */
const ISSUES='https://github.com/Hammamelsh/lost-minutes/issues/new?labels=beta-feedback'
 +'&title=Beta%20feedback';

/**
 * Two short notes at the foot of the page: how to send feedback, and exactly what happens to a
 * passenger's location.
 *
 * The feedback note writes the report's own context — the build, what the feed was doing, the
 * screen — because a report without them cannot be acted on, and asks the passenger to send it
 * themselves. Nothing leaves the page: there is no endpoint here to send it to, and adding one
 * would mean collecting from people who came to look at buses.
 */
export default function SiteNotes({feed,publishedAgo,stop,photo3d=null}:{feed:string;publishedAgo:string;stop:string|null;
 /** Who provides the view from above where it is offered: Google's content needs its own notice. */
 photo3d?:'google'|'sample'|null}){
 const [copied,setCopied]=useState(false);
 const [report,setReport]=useState('');
 // Written when the note is opened, not on every render, so it carries what was true at the
 // moment the passenger decided to say something: the map's own drawing rate included, which is
 // the one number nobody can report by eye and the one that would settle whether a street preview
 // "froze" or merely crawled on that phone's GPU.
 const compose=()=>{
  const map=typeof document==='undefined'?null:document.querySelector('.vector-map');
  setReport([
   'Lost Minutes beta feedback',
   '',
   'What I was doing:',
   'What I expected:',
   'What happened:',
   '',
   '--- context, filled in by the page ---',
   `build: ${BUILD}`,
   `feed: ${feed}${publishedAgo?` · published ${publishedAgo}`:''}`,
   `stop chosen: ${stop??'none'}`,
   `map: view ${map?.getAttribute('data-view')??'none'}, ride ${map?.getAttribute('data-ride')??'off'}`
    +`, camera ${map?.getAttribute('data-ride-camera')??'off'}, state ${map?.getAttribute('data-map-state')??'none'}`,
   `drawing: ${map?.getAttribute('data-frame-ms')||'not measured'} ms a frame (lower is smoother)`,
   typeof window==='undefined'?'':`screen: ${window.innerWidth}x${window.innerHeight}, dpr ${window.devicePixelRatio}`,
   typeof navigator==='undefined'?'':`browser: ${navigator.userAgent}`,
   `at: ${new Date().toISOString()}`,
  ].join('\n'));
 };
 const copy=async()=>{
  try{await navigator.clipboard.writeText(report);setCopied(true);setTimeout(()=>setCopied(false),4000)}
  catch{setCopied(false)}
 };
 return <div className="site-notes">
  <details className="site-note" onToggle={event=>{if((event.currentTarget as HTMLDetailsElement).open)compose()}}>
   <summary><MessageSquare size={15}/>Send feedback</summary>
   <div className="site-note-body">
    <p>This is an open beta by one person. The most useful things to say are where you got stuck,
     anything that read as wrong, and whether the bus you followed was the one you saw.</p>
    <p className="microcopy">Nothing is sent from this page. Copying puts the text below on your
     clipboard, to send however suits you.</p>
    <pre className="site-note-report">{report}</pre>
    <div className="site-note-actions">
     <button type="button" className="action" onClick={copy}>
      {copied?<ClipboardCheck size={15}/>:<Copy size={15}/>}{copied?'Copied':'Copy this report'}</button>
     <a className="text-action" href={ISSUES} target="_blank" rel="noopener noreferrer">
      Open an issue on GitHub</a>
    </div>
   </div>
  </details>
  <details className="site-note">
   <summary><MapPin size={15}/>Your location</summary>
   <div className="site-note-body">
    <p>Nothing asks for your location until you press <strong>Buses near me</strong> or
     <strong> Locate me</strong>. Searching for a stop by name never does.</p>
    <p>When you do, the position stays in this browser: it sorts nearby stops by distance and
     draws the blue dot. It is not stored and it is not sent to this site, which is a set of
     static files and has nothing to send it to.</p>
    <p>There is one exception, and only when you ask for it. <strong>Walking directions</strong>
     send your position, rounded to about 10&nbsp;m, and the stop&rsquo;s position to
     {' '}<a href="https://routing.openstreetmap.de" target="_blank" rel="noopener noreferrer">
     routing.openstreetmap.de</a>, a free pedestrian router run by FOSSGIS e.V. on OpenStreetMap
     data. That request reaches them; nothing else does, and no journey of yours is recorded here
     or there by us.</p>
    <p className="microcopy">Saved stops, saved routes and the last journey you looked at are kept
     in this browser, for this address, and go nowhere else. Clearing site data removes them.</p>
   </div>
  </details>
  {/* The notice Google's terms ask of an application that includes Google Maps content (3.2.2) and
      what it receives (4.4): only where that content is offered. */}
  {photo3d==='google'&&<details className="site-note" data-note="google-maps">
   <summary><Globe size={15}/>The view from above</summary>
   <div className="site-note-body">
    <p>The view from above includes Google Maps features and content: Google&rsquo;s Photorealistic
     3D Tiles, imagery captured at an earlier date. Their use is subject to the
     {' '}<a href="https://maps.google.com/help/terms_maps/" target="_blank" rel="noopener noreferrer">Google Maps
     End User Additional Terms of Service</a> and the
     {' '}<a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Google Privacy
     Policy</a>.</p>
    <p>Nothing is asked of Google until you open the view. Opening it makes one request for the imagery
     and then asks for the tiles on screen; your browser sends those requests to Google, which receives
     your IP address and the parts of Manchester shown, as it does from any page with Google Maps on it.
     Your location is not sent: the view opens on the city, or on the bus you chose.</p>
    <p className="microcopy">The buses on it are this site&rsquo;s own: positions from the Bus Open Data
     Service (Open Government Licence), each drawn where its own reports put it; road shapes from
     OpenStreetMap (ODbL). Nothing about them comes from Google.</p>
   </div>
  </details>}
 </div>;
}
