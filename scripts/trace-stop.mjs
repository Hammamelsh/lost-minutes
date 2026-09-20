// Why each bus is, or is not, on a stop's board: the page's own functions run over a frozen
// publication, so the answer is what a passenger would have seen, not a model of it.
//   node --experimental-strip-types --import ./tests/alias-loader.mjs scripts/trace-stop.mjs \
//        --stop 1800SJ32251 --publication data/evaluation/publication-20260920-scheduled.json [--service 'BNML|15|inbound|Piccadilly_Gardens'] [--route 15]
import {readFileSync} from 'node:fs';
import {busesFromLive} from '@/lib/follow';
import {parsePatterns,patternIndex,relateToStop} from '@/lib/patterns';
import {parseCatalogue} from '@/lib/stops';
import {stopBoard,busOnService,isOldReport} from '@/lib/journey';
import {servicesAtStop} from '@/lib/journey';
import {londonDate} from '@/lib/service-days';
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i>0?process.argv[i+1]:d};
const stopId=arg('stop','1800SJ32251'), route=arg('route','15'), serviceKey=arg('service',null);
const live=JSON.parse(readFileSync(arg('publication','data/evaluation/publication-20260920-scheduled.json'),'utf8'));
const patterns=parsePatterns(JSON.parse(readFileSync('public/data/patterns.json','utf8')));
const byId=patternIndex(patterns);
const stops=parseCatalogue(JSON.parse(readFileSync('public/data/stops.json','utf8')));
const stop=stops.stops.find(s=>s.id===stopId);
const nowMs=live.publishedAtMs??Date.parse(live.publishedAt);
const buses=busesFromLive(live,nowMs,nowMs,nowMs);
const relations=new Map(buses.map(b=>[b.key,relateToStop(b,stop.id,byId)]));
const day=londonDate(nowMs);
const services=servicesAtStop(patterns,stop.id,day,buses,byId);
console.log(`publication ${live.publishedAt.slice(0,19)} (${day})  vehicles ${live.vehicles.length} -> buses ${buses.length}  stop ${stop.name} (${stop.indicator}) ${stop.id}`);
console.log('services timetabled at this stop today:', services.map(s=>`${s.key} [${s.reporting??'?'} reporting]`).join(' | ')||'(none)');
const active=serviceKey?services.find(s=>s.key===serviceKey)??null:null;
if(serviceKey) console.log('service filter', serviceKey, active?'-> ACTIVE (matches a service at this stop)':'-> not a service here today: ignored by the page (activeService=null)');
const board=stopBoard(buses,stop,relations,active?(b,r)=>busOnService(b,active,r):undefined);
console.log('board:', Object.fromEntries(Object.entries(board).map(([k,v])=>[k,v.length])));
const boardGroup=new Map(); for(const [g,rows] of Object.entries(board)) for(const r of rows) boardGroup.set(r.bus.key,g);
console.log(`\n--- every route ${route} bus in the publication ---`);
for(const v of live.vehicles.filter(v=>v.route===route)){
 const b=buses.find(x=>x.vehicle===v.vehicle&&x.operator===v.operator);
 const m=v.match||{}; const rel=b?relations.get(b.key):null;
 const pid=m.patternId||(m.candidates||[]).map(c=>c.patternId).join('+')||'-';
 const p=m.patternId?byId.get(m.patternId):null; const stopIdx=p?p.stops.indexOf(stop.id):-1;
 const filt=active&&b&&rel?busOnService(b,active,rel):null;
 console.log(`${v.vehicle.padEnd(9)} ${v.direction.padEnd(8)} to ${(v.destination||'').padEnd(20)} age ${String(v.ageSeconds).padStart(4)}s ${v.freshness.padEnd(7)} | published as bus: ${b?'yes':'NO (withheld/expired)'} | match: ${m.patternId?'placed':'unresolved:'+(m.unresolved||'?')} ${pid.slice(-24)} idx ${m.patternIndex??'-'} | stop on pattern: ${stopIdx>=0?'yes @'+stopIdx:'no'} | relation: ${rel?rel.kind:'-'} | board group: ${b?(boardGroup.get(b.key)||'NONE (not listed)'):'-'}${active?' | passes filter: '+filt:''}`);
}
