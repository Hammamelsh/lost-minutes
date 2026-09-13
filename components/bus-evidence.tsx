"use client";

import {ExternalLink} from 'lucide-react';
import type {FollowBus} from '@/lib/follow';
import type {FeedMode} from '@/lib/live';
import {relationWords} from '@/lib/patterns';
import type {ServicePattern,StopRelation} from '@/lib/patterns';
import {clock} from '@/lib/replay';

type Evidence={serviceDay?:string;weekday?:string;operatorChecked?:boolean;directionReported?:boolean;
 operatingDayChecked?:boolean;plausiblePaths?:number;resolvedBy?:string;destinationAgrees?:boolean|null};
type MatchShape={patternId?:string;patternIndex?:number;nearestStop?:string;metresFromPatternStop?:number;
 unresolved?:string;explanation?:string;candidates?:{patternId:string;patternIndex:number}[];
 nearestPatternMetres?:number;evidence?:Evidence};

const BEARING:Record<FollowBus['bearingStatus'],string>={
 reported:'',absent:'not reported by the vehicle',invalid:'reported but unreadable, so not used',
 not_captured:'not recorded: stored before bearings were captured',
};

const short=(hash:string)=>`${hash.slice(0,12)}…`;
const tick=(value:boolean|undefined,yes:string,no:string)=>value===undefined?'not recorded':value?yes:no;

/**
 * Source to screen for one bus: the report as supplied, what the matcher checked and against
 * which timetable version, its verdict, and the publication this page received. Everything
 * here is read from the published files; nothing is recomputed to look tidier.
 */
export default function BusEvidence({bus,relation,patterns,mode,publishedAt,liveFingerprint,
                                     ageBasis,expiryMinutes,name,onOpenEvidence}:{
 bus:FollowBus;relation?:StopRelation;patterns:Map<string,ServicePattern>;mode:FeedMode;
 publishedAt?:string|null;liveFingerprint?:string|null;ageBasis:'server'|'device';
 expiryMinutes:number;name:(atco:string)=>string;onOpenEvidence:()=>void}){
 const match=bus.match as MatchShape|undefined;
 const evidence=match?.evidence;
 const pattern=match?.patternId?patterns.get(match.patternId):undefined;
 const candidates=(match?.candidates??[]).map(c=>patterns.get(c.patternId)).filter((p):p is ServicePattern=>Boolean(p));
 const version=pattern??candidates[0];
 // Candidates that differ only in stops the bus has left behind agree on every stop ahead.
 const sameAhead=(match?.candidates?.length??0)>1&&new Set((match?.candidates??[]).map(c=>
  patterns.get(c.patternId)?.stops.slice(c.patternIndex).join(' ')??c.patternId)).size===1;
 return <div className="bus-evidence">
  <section>
   <h4>The report</h4>
   <dl>
    <div><dt>Reported at</dt><dd>{clock(bus.observedAtMs,true)}<small>{bus.recordedAt}</small></dd></div>
    <div><dt>Operator · vehicle</dt><dd>{bus.operator} · {bus.vehicle}</dd></div>
    <div><dt>Line · direction</dt><dd>{bus.route} · {bus.direction||'direction not supplied'}</dd></div>
    <div><dt>Destination (as supplied)</dt><dd>{bus.destination||'not supplied'}</dd></div>
    <div><dt>Position</dt><dd className="mono">{bus.lat.toFixed(5)}, {bus.lon.toFixed(5)}</dd></div>
    <div><dt>Bearing</dt><dd>{bus.bearing!==null?`${Math.round(bus.bearing)}° (reported; 0° is north)`:BEARING[bus.bearingStatus]}</dd></div>
    {bus.aimedDeparture&&<div><dt>Scheduled origin departure</dt><dd>{clock(Date.parse(bus.aimedDeparture))}
     <small>the operator’s timetable claim, not an observation</small></dd></div>}
    <div><dt>Source file</dt><dd className="mono" title={bus.sourceHash}>SHA-256 {short(bus.sourceHash)}</dd></div>
   </dl>
  </section>

  {mode!=='archive'&&<section>
   <h4>The match</h4>
   <dl>
    <div><dt>Inputs</dt><dd>operator {bus.operator}, line {bus.route}, direction {bus.direction||'not supplied'},
     position{evidence?.serviceDay?`, service day ${evidence.weekday} ${evidence.serviceDay}`:''}</dd></div>
    <div><dt>Checked</dt><dd>{[tick(evidence?.operatorChecked,'same operator','operator not supplied'),
     'timetable valid that day',tick(evidence?.operatingDayChecked,'runs that day','days not recorded'),
     tick(evidence?.directionReported,'same direction','direction not supplied')].join(' · ')}</dd></div>
    {evidence?.plausiblePaths!==undefined&&<div><dt>Paths that fit the position</dt>
     <dd>{evidence.plausiblePaths===1?'1, so the position alone places it'
      :evidence.resolvedBy==='reported_destination'
       ?`${evidence.plausiblePaths}, settled by the operator’s reported destination`
       :sameAhead?`${evidence.plausiblePaths}, differing only in stops before this one, so every stop ahead is the same on each`
       :`${evidence.plausiblePaths}, left unresolved: nothing else tells them apart`}</dd></div>}
    {match?.nearestStop&&<div><dt>Nearest pattern stop</dt><dd>{name(match.nearestStop)}
     {match.metresFromPatternStop!==undefined?` · ${match.metresFromPatternStop} m from the report`:''}</dd></div>}
    <div><dt>Result</dt><dd>{match?.patternId?`placed on pattern ${match.patternId}, stop ${Number(match.patternIndex)+1} of ${pattern?.stopCount??'?'}`
     :match?.unresolved?`${match.unresolved.replaceAll('_',' ')}: ${match.explanation}`
     :'no match attempted for this position'}</dd></div>
    {candidates.length>1&&<div><dt>Candidates kept</dt><dd>{candidates.map(p=>`${p.line} to ${p.destination??'?'} (${p.stopCount} stops, ${p.runs??'days not recorded'})`).join(' · ')}</dd></div>}
    {relation&&relation.kind!=='no_pattern_data'&&<div><dt>Against your stop</dt><dd>{relationWords(relation)}</dd></div>}
   </dl>
  </section>}

  {version&&<section>
   <h4>The timetable version</h4>
   <dl>
    <div><dt>Service</dt><dd>{version.operator??'?'} {version.line} {version.direction??''} to {version.destination??'?'}
     {version.runs?<small>runs {version.runs}{version.operatingRules?.some(r=>r.bankHolidays)?'; bank holidays not evaluated':''}</small>:null}</dd></div>
    <div><dt>Stops in the collected area</dt><dd>{version.stopsInArea} of {version.stopCount}
     <small>the rest keep their place in the order but have no position here</small></dd></div>
    <div><dt>File</dt><dd className="mono wrap">{version.timetable.file}</dd></div>
    <div><dt>Version</dt><dd>{version.timetable.revision?`revision ${version.timetable.revision}`:'revision not stated'}
     {version.timetable.modified?`, modified ${version.timetable.modified.slice(0,10)}`:''}
     <small>valid {version.timetable.validFrom??'?'} to {version.timetable.validTo??'?'}</small></dd></div>
    <div><dt>Dataset</dt><dd className="mono" title={version.timetable.datasetSha256}>SHA-256 {short(version.timetable.datasetSha256)}</dd></div>
   </dl>
  </section>}

  <section>
   <h4>The publication</h4>
   <dl>
    {mode==='archive'
     ?<div><dt>Shown because</dt><dd>It is this bus’s last position in the recording.</dd></div>
     :<>
      <div><dt>Published</dt><dd>{publishedAt?clock(Date.parse(publishedAt),true):'unknown'}</dd></div>
      <div><dt>File this page received</dt><dd className="mono">{liveFingerprint?`SHA-256 ${short(liveFingerprint)}`:'fingerprint not available here'}
       <small>hashed in this browser; the publisher records the same hash for every file it writes, so the two can be compared</small></dd></div>
      <div><dt>Age measured against</dt><dd>{ageBasis==='server'?'the server’s clock':'this device’s clock (server time unreadable); it can read old, never new'}</dd></div>
      <div><dt>Shown because</dt><dd>It is the newest report for this bus and is under the {expiryMinutes}-minute cut-off.</dd></div>
     </>}
   </dl>
  </section>
  <button className="text-action" onClick={onOpenEvidence}>Source files and checks in Evidence <ExternalLink size={14}/></button>
 </div>;
}
