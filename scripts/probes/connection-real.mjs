// The one-change planner on the real catalogue, the served boards and the served publication: for a
// few journeys, what it finds, how it times them, and which buses it can tie to which journeys.
//
//   node --experimental-strip-types --import ./tests/alias-loader.mjs scripts/probes/connection-real.mjs [--base https://lost-minutes.duckdns.org]
//
// Read-only against the site; nothing here writes anything but this report to stdout.
import {readFileSync} from 'node:fs';
import {connectionOptions,busOnJourney,busesOnLeg,familyQuality,rankConnections,timeConnection,transferWalk,connectionSentence,stopName,
 timetabledAtBoard,withoutUnreliable} from '../../lib/connections.ts';
import {directOptions} from '../../lib/plan.ts';
import {parsePatterns} from '../../lib/patterns.ts';
import {parseCatalogue} from '../../lib/stops.ts';
import {parseLive} from '../../lib/live.ts';
import {busesFromLive} from '../../lib/follow.ts';
import {londonDate} from '../../lib/service-days.ts';

const arg=(name,fallback)=>{const i=process.argv.indexOf(`--${name}`);return i>0?process.argv[i+1]:fallback};
const BASE=arg('base','https://lost-minutes.duckdns.org').replace(/\/$/,'');
const json=async url=>{const r=await fetch(url,{cache:'no-store'});return r.ok?r.json():null};

const patterns=parsePatterns(await json(`${BASE}/data/patterns.json`)??JSON.parse(readFileSync('public/data/patterns.json','utf8')));
const stops=parseCatalogue(JSON.parse(readFileSync('public/data/stops.json','utf8'))).stops;
const anchor=await json(`${BASE}/data/schedule-anchor.json`);
const rules=(await json(`${BASE}/data/departure-rules.json`))?.rules??null;
const liveRaw=await json(`${BASE}/data/live.json`);
const live=liveRaw?parseLive(liveRaw):null;
const now=Date.now();
const buses=live?busesFromLive(live,live.publishedAtMs,now,now):[];
const day=londonDate(now);
const wall=ms=>ms===null?'—':new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',hour:'2-digit',minute:'2-digit',hour12:false}).format(ms);
console.log(`catalogue ${patterns.patterns.length} patterns · ${stops.length} stops · ${buses.length} buses at ${wall(now)} on ${day} · anchor ${Object.keys(anchor?.patterns??{}).length} patterns`);

const journeys=[
 {name:'Withington Road (Chorlton) → The Trafford Centre',from:{lat:53.44347,lon:-2.25585},to:{lat:53.46779,lon:-2.35153}},
 {name:'Stretford Mall → Piccadilly Gardens',from:{lat:53.44629,lon:-2.31056},to:{lat:53.48068,lon:-2.23536}},
 {name:'Hillingdon Road (Stretford) → MediaCityUK',from:{lat:53.44867,lon:-2.29932},to:{lat:53.47192,lon:-2.29555}},
 {name:'Hillingdon Road (Stretford) → Withington Community Hospital',from:{lat:53.44867,lon:-2.29932},to:{lat:53.42586,lon:-2.24353}},
 {name:'Brook’s Bar → The Trafford Centre',from:{lat:53.45839,lon:-2.25914},to:{lat:53.46779,lon:-2.35153}},
 {name:'Piccadilly Gardens → Withington Golf Club (Palatine Road)',from:{lat:53.48068,lon:-2.23536},to:{lat:53.41371,lon:-2.25014}},
];
if(!rules)throw new Error('the served departure rules could not be read');
for(const j of journeys){
 const t0=performance.now();
 const direct=directOptions(j.from,j.to,patterns,stops,day,buses);
 const candidates=connectionOptions(j.from,j.to,patterns,stops,day).map(o=>withoutUnreliable(o,anchor));
 const ms=(performance.now()-t0).toFixed(0);
 console.log(`\n## ${j.name}  (${ms} ms, ${candidates.length} candidates)`);
 console.log(`  direct: ${direct.length?direct.map(d=>`${d.line} towards ${d.headsign} from ${stopName(d.board)} (${d.tracked.length} tracked)`).join('; '):'none'}`);
 if(!candidates.length){console.log('  connections: none found in our timetables');continue}
 // As the page does: every candidate timed from its two boards, then the list in order by the timetable.
 const boardOf=new Map();
 for(const id of new Set(candidates.flatMap(o=>[o.first.board.id,o.second.board.id])))boardOf.set(id,await json(`${BASE}/data/departures/${id}.json`));
 const quality=o=>({first:familyQuality(o.first,anchor),second:familyQuality(o.second,anchor)});
 const timeOf=o=>timeConnection(o,{boards:{first:boardOf.get(o.first.board.id),second:boardOf.get(o.second.board.id)},rules,nowMs:now,
  walk:transferWalk(o.transfer,null),allowanceSeconds:120,quality:quality(o)});
 const options=rankConnections(candidates,timeOf);
 for(const o of options){
  console.log(`  · ${connectionSentence(o)}`);
  const q=quality(o);
  const boards={first:boardOf.get(o.first.board.id),second:boardOf.get(o.second.board.id)};
  const timing=timeOf(o);
  console.log(`    timetable quality: first ${q.first.kind}, second ${q.second.kind}`);
  if(timing.kind!=='timed'){console.log(`    timing ${timing.kind}: ${timing.reason}`);}
  else for(const row of timing.rows.slice(0,3)){
   const b1=busOnJourney(row.first.departure,buses),b2=row.second?busOnJourney(row.second.departure,buses):null;
   console.log(`    ${wall(row.first.departMs)} ${row.first.departure.line} → ${wall(row.first.arriveMs)} at ${o.first.alight.name}${row.earlier?` (or from ${wall(row.earlier.departMs)}, ${row.earlier.count})`:''}`
    +` · walk ~${Math.round(timing.walk.seconds/60)} min · ${row.second?`${wall(row.second.departMs)} ${row.second.departure.line} → ${wall(row.second.arriveMs)} (${Math.round((row.changeSeconds??0)/60)} min to change)`:'no second bus within 90 min'}`
    +` · bus1 ${b1?`${b1.vehicle} (${b1.ageWords})`:'not identified'} · bus2 ${b2?`${b2.vehicle} (${b2.ageWords})`:'not identified'}`);
  }
  const on1=busesOnLeg(o.first,buses),on2=busesOnLeg(o.second,buses);
  const said=(x,leg,board)=>{const own=timetabledAtBoard(x.bus,leg,board,rules);
   return `${x.bus.route} ${x.bus.vehicle} ${x.standing.kind==='before'?`${x.standing.stopsAway} stops before`:x.standing.kind==='between'?'between':'past'} (${x.bus.ageWords}${own?`, the ${wall(own.atMs)}`:', journey not named'})`};
  console.log(`    tracked on leg 1: ${on1.length?on1.slice(0,3).map(x=>said(x,o.first,boards.first)).join('; '):'none'}`);
  console.log(`    tracked on leg 2: ${on2.length?on2.slice(0,3).map(x=>said(x,o.second,boards.second)).join('; '):'none'}`);
 }
}
