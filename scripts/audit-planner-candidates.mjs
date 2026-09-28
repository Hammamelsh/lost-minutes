// What the planners look at before any time is read, over sampled pairs of real places, against a
// brute-force reading of the same catalogue (docs/ENGINEERING_OPPORTUNITIES.md, entry 67).
//
//   node --experimental-strip-types --import ./tests/alias-loader.mjs scripts/audit-planner-candidates.mjs \
//     --dir <folder holding patterns.json and stops.json> [--day 2026-09-28] [--pairs 5000] [--seed 7] \
//     [--boards <folder holding departures/ and departure-rules.json> --at 2026-09-29T07:00:00Z] [--cut 48]
//
// Direct buses: every pattern open to the public, running on the day, that calls within the stated
// walk of both places, in that order, with less walking than the distance between them, must be in
// some candidate's family (the brute force); and how many candidates a search times (`PLAN_RULES`).
// Journeys with one change: how many candidates a search finds against how many are timed
// (`CONNECTION_RULES.candidates`), which is the cut by distance that happens before any time is read;
// and, given the boards and a moment, how often a candidate beyond the cut would get there sooner
// than every one inside it, each timed as the list times them (the walk between the stops estimated).
// Places are sampled near real stops, 1.5–10 km apart (3–12 km for changes), from a fixed seed, so a
// run is repeatable on the same catalogue. Nothing is fetched; the catalogue is whatever is given.
import {readFileSync} from 'node:fs';
import {parseCatalogue,nearestStops,straightLineMetres} from '@/lib/stops';
import {parsePatterns} from '@/lib/patterns';
import {existsSync} from 'node:fs';
import {CONNECTION_RULES,connectionArrival,connectionOptions,familyQuality,legFamily,serviceDaysAt,timeConnection,transferWalk,
 usablePatterns,withoutUnreliable} from '@/lib/connections';
import {PLAN_RULES,directOptions} from '@/lib/plan';

const arg=(name,fallback)=>{const i=process.argv.indexOf(`--${name}`);return i>0?process.argv[i+1]:fallback};
const dir=arg('dir','public/data'),day=arg('day',new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London'}).format(Date.now()));
const pairs=Number(arg('pairs',5000)),changePairs=Number(arg('change-pairs',400));
let seed=Number(arg('seed',7));
const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647;
const stops=parseCatalogue(JSON.parse(readFileSync(`${dir}/stops.json`,'utf8'))).stops;
const catalogue=parsePatterns(JSON.parse(readFileSync(`${dir}/patterns.json`,'utf8')));
const usable=usablePatterns(catalogue,day);
const jitter=s=>({lat:s.lat+(rnd()-.5)*0.002,lon:s.lon+(rnd()-.5)*0.003});
const pick=(min,max)=>{for(;;){const a=stops[Math.floor(rnd()*stops.length)],b=stops[Math.floor(rnd()*stops.length)];
 const d=straightLineMetres(a,b);if(d>=min&&d<=max)return [jitter(a),jitter(b)]}};
const quantiles=list=>{const s=[...list].sort((x,y)=>x-y),q=f=>s.length?s[Math.floor(f*(s.length-1))]:null;
 return {median:q(.5),p90:q(.9),p99:q(.99),max:s.at(-1)??null}};

// Direct buses.
const within=(point)=>new Map(nearestStops(stops,point,PLAN_RULES.candidateStops).filter(n=>n.metres<=PLAN_RULES.maxWalkMetres).map(n=>[n.stop.id,n.metres]));
let withDirect=0,missing=0,overCap=0;const directCounts=[],missingExamples=[];
for(let n=0;n<pairs;n++){
 const [from,to]=pick(1500,10000),direct=straightLineMetres(from,to);
 const near=within(from),far=within(to),can=new Set();
 for(const p of usable)for(let i=0;i<p.stops.length-1;i++){
  const a=near.get(p.stops[i]);if(a===undefined)continue;
  for(let j=i+1;j<p.stops.length;j++){const b=far.get(p.stops[j]);if(b!==undefined&&a+b<direct){can.add(p.id);break}}
 }
 const options=directOptions(from,to,catalogue,stops,day);
 if(!can.size&&!options.length)continue;
 withDirect++;
 const found=new Set(options.flatMap(o=>legFamily(o.leg).map(l=>l.pattern.id)));
 const lost=[...can].filter(id=>!found.has(id));
 if(lost.length){missing++;if(missingExamples.length<5)missingExamples.push(lost.slice(0,3))}
 // How many the search would have had without its cap: the cap is reached when it returns exactly that many.
 directCounts.push(options.length);if(options.length>=PLAN_RULES.candidates)overCap++;
}

// Journeys with one change.
const all={...CONNECTION_RULES,candidates:10_000};
const boardsDir=arg('boards',null),atMs=Date.parse(arg('at','')),timed=Boolean(boardsDir)&&Number.isFinite(atMs);
const rules=timed?JSON.parse(readFileSync(`${boardsDir}/departure-rules.json`,'utf8')).rules:null;
const anchor=JSON.parse(readFileSync(arg('anchor','public/data/schedule-anchor.json'),'utf8'));
const boardCache=new Map();
const board=id=>{if(!boardCache.has(id)){const f=`${boardsDir}/departures/${id}.json`;boardCache.set(id,existsSync(f)?JSON.parse(readFileSync(f,'utf8')):null)}return boardCache.get(id)};
const arrival=(o,nowMs)=>connectionArrival(o,timeConnection(o,{boards:{first:board(o.first.board.id),second:board(o.second.board.id)},rules,nowMs,
 walk:transferWalk(o.transfer,null),allowanceSeconds:CONNECTION_RULES.allowanceSeconds,
 quality:{first:familyQuality(o.first,anchor),second:familyQuality(o.second,anchor)}}))?.arrive??null;
const cutAt=Number(arg('cut',CONNECTION_RULES.candidates));
const soonest=list=>list.reduce((m,v)=>v!==null&&(m===null||v<m)?v:m,null);
let withChange=0,cut=0,sooner=0,sooner5=0,sooner15=0;const changeCounts=[],boardsRead=[];
for(let n=0;n<changePairs;n++){
 const [from,to]=pick(3000,12000);
 const found=connectionOptions(from,to,catalogue,stops,timed?serviceDaysAt(atMs):day,all);
 if(!found.length)continue;
 withChange++;changeCounts.push(found.length);if(found.length>cutAt)cut++;
 if(!timed)continue;
 const listed=found.map(o=>withoutUnreliable(o,anchor)),times=listed.map(o=>arrival(o,atMs));
 boardsRead.push(new Set(listed.slice(0,cutAt).flatMap(o=>[o.first.board.id,o.second.board.id])).size);
 const inside=soonest(times.slice(0,cutAt)),every=soonest(times);
 if(every!==null&&(inside===null||every<inside)){sooner++;const gain=inside===null?Infinity:(inside-every)/60_000;
  if(gain>=5)sooner5++;if(gain>=15)sooner15++}
}

console.log(JSON.stringify({catalogue:catalogue.generatedAt,day,usablePatterns:usable.length,
 direct:{pairs,withDirect,missingAUsablePattern:missing,missingExamples,candidates:quantiles(directCounts),
  reachingTheCap:overCap,cap:PLAN_RULES.candidates},
 change:{pairs:changePairs,withAChange:withChange,candidatesBeforeTheCut:quantiles(changeCounts),
  timed:cutAt,pairsWithMoreThanAreTimed:cut,
  ...(timed?{at:new Date(atMs).toISOString(),soonerBeyondTheCut:sooner,byAtLeast5Minutes:sooner5,byAtLeast15Minutes:sooner15,
   boardsRead:quantiles(boardsRead)}:{})}},null,1));
