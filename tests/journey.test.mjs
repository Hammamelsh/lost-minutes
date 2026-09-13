import test from 'node:test';
import assert from 'node:assert/strict';
import {patternIndex} from '../lib/patterns.ts';
import {relateToStop} from '../lib/patterns.ts';
import {association,busesAtStop,distanceLines,journeyFocus,progress,schematic,
        servicesAtStop,busOnService,AT_STOP_METRES,standing,standingWords,stopBoard} from '../lib/journey.ts';
import {londonDate,ruleApplies,runsOn,weekdayIndex} from '../lib/service-days.ts';
import {usableBearing} from '../lib/follow.ts';

// Labelled fixture: two branches of one service sharing S0-S2, one weekday-only service, and
// one pattern that terminates at S2. Coordinates are a straight line of ~300 m steps.
const stopAt=(i)=>({lat:53.47+i*0.0027,lon:-2.24});
const base={operator:'BNML',line:'50',direction:'inbound',stopCount:6,stopsInArea:6,lengthMetres:1500,
 hasRepeatedStop:false,timetable:{datasetSha256:'a'.repeat(64),file:'f.xml',validFrom:'2026-01-01',validTo:'2031-01-01'},
 operatingRules:[{days:[0,1,2,3,4,5,6]}],runs:'Mon–Sun'};
const north={...base,id:'north',destination:'Moorside',stops:['S0','S1','S2','N3','N4','N5'],metres:[0,300,600,900,1200,1500]};
const east={...base,id:'east',destination:'Eastlands',stops:['S0','S1','S2','E3','E4'],metres:[0,300,600,950,1300]};
const school={...base,id:'school',line:'X9',destination:'Academy',operatingRules:[{days:[0,1,2,3,4]}],runs:'Mon–Fri',
 stops:['S0','S1','S2','A3','A4'],metres:[0,300,600,900,1200]};
const ending={...base,id:'ending',line:'7',destination:'Here',stops:['Q0','Q1','Q2','Q3','S2'],metres:[0,1,2,3,4]};
const catalogue={schemaVersion:2,generatedAt:'x',supportedLines:['50','X9','7'],patterns:[north,east,school,ending],
 rules:{minimumStopsInAreaFraction:0.6,minimumStops:5},attribution:'',notes:[]};
const byId=patternIndex(catalogue);
const SUNDAY='2026-09-13',MONDAY='2026-09-14';
const bus=(key,i,match,extra={})=>({key,operator:'BNML',route:'50',direction:'inbound',journeyRef:'J',vehicle:key,
 destination:'',...stopAt(i),observedAtMs:0,recordedAt:'',ageSeconds:20,freshness:'fresh',ageWords:'reported 20s ago',
 sourceHash:'b'.repeat(64),bearing:null,bearingStatus:'absent',match,...extra});
const name=(atco)=>`Stop ${atco}`;

test('services at a stop are grouped by destination, running today first, terminating ones left out',()=>{
 const services=servicesAtStop(catalogue,'S2',SUNDAY,[],byId);
 assert.deepEqual(services.map(s=>`${s.line}→${s.destination}`),['50→Eastlands','50→Moorside','X9→Academy']);
 assert.equal(services.find(s=>s.line==='X9').runsToday,false);        // a weekday service on a Sunday
 assert.equal(servicesAtStop(catalogue,'S2',MONDAY,[],byId).find(s=>s.line==='X9').runsToday,true);
 assert.ok(!services.some(s=>s.line==='7'),'a pattern ending at S2 cannot be boarded there');
});

test('a bus is counted for a service only when the timetable relates it to this stop',()=>{
 const coming=bus('a',1,{patternId:'north',patternIndex:1,nearestStop:'S1',metresAlongPattern:300,metresFromPatternStop:12});
 const beyond=bus('b',4,{patternId:'north',patternIndex:4,nearestStop:'N4',metresAlongPattern:1200,metresFromPatternStop:12});
 const services=servicesAtStop(catalogue,'S2',SUNDAY,[coming,beyond],byId);
 assert.equal(services.find(s=>s.destination==='Moorside').reporting,1);
 const choice=services.find(s=>s.destination==='Moorside');
 assert.ok(busOnService(coming,choice,relateToStop(coming,'S2',byId)));
 assert.ok(!busOnService({...coming,operator:'BNSM'},choice,relateToStop(coming,'S2',byId)),
  'same route number, another operator: not this service');
});

test('the shared-stop ambiguity is shown as what both branches support, and nothing more',()=>{
 const ambiguous=bus('c',1,{unresolved:'ambiguous_branch',explanation:'More than one branch fits.',nearestStop:'S1',
  candidates:[{patternId:'north',patternIndex:1},{patternId:'east',patternIndex:1}]});
 const toShared=relateToStop(ambiguous,'S2',byId);
 assert.equal(association(toShared,ambiguous).text,'Every possible branch calls at your stop');
 assert.match(progress(toShared,name).text,/1 stop before yours on every possible branch/);
 const items=schematic(toShared,name,'S2');
 assert.deepEqual(items.map(i=>i.kind==='stop'?`${i.atco}:${i.role}`:i.kind),['S1:bus','S2:yours','fork']);
 const toOneBranch=relateToStop(ambiguous,'N4',byId);
 assert.equal(association(toOneBranch,ambiguous).tone,'caution');
 assert.match(association(toOneBranch,ambiguous).text,/1 of 2 possible branches/);
});

test('progress words are qualified, and never a time',()=>{
 const near=relateToStop(bus('d',2,{patternId:'north',patternIndex:2,nearestStop:'S2',metresAlongPattern:600,metresFromPatternStop:38}),'S2',byId);
 assert.match(progress(near,name).text,/about 40 m from your stop/);
 assert.match(progress(near,name).detail,/cannot tell/);
 const coming=relateToStop(bus('e',0,{patternId:'north',patternIndex:0,nearestStop:'S0',metresAlongPattern:0,metresFromPatternStop:5}),'N4',byId);
 assert.equal(progress(coming,name).text,'Last report nearest Stop S0 · 4 stops before yours');
 for(const claim of [progress(near,name),progress(coming,name)])
  assert.ok(!/minute|arriv(es|ing in)|\bdue\b|\beta\b/i.test(claim.text),claim.text);
});

test('my distance and the bus distance carry their basis, and nothing predicts an arrival',()=>{
 const here={lat:53.4705,lon:-2.2410},stop={id:'S2',name:'S2',...stopAt(2)};
 const b=bus('f',0,{patternId:'north',patternIndex:0,nearestStop:'S0',metresAlongPattern:0,metresFromPatternStop:5});
 const relation=relateToStop(b,'S2',byId);
 const lines=distanceLines({here,stop,bus:b,relation});
 assert.deepEqual(lines.map(l=>l.label),['You to your stop','Bus to your stop','Along the stop sequence']);
 assert.match(lines[0].basis,/straight line, not a walking route/);
 assert.match(lines[1].basis,/straight line/);
 assert.match(lines[2].basis,/not the road/);
 assert.ok(!lines.some(l=>/arriv|minute/i.test(`${l.label} ${l.value}`)));
 // With a route from a pedestrian router, and only then, it is a walking distance and time.
 const walked=distanceLines({here,stop,bus:b,relation,walk:{metres:341,seconds:273,provider:'routing.openstreetmap.de'}});
 assert.equal(walked[0].value,'5 min walk · 340 m');
 assert.match(walked[0].basis,/walking route from routing.openstreetmap.de/);
});

test('the stop board keeps relevant buses apart from passed, wrong, unresolved and old ones',()=>{
 const away={...base,id:'away',destination:'Elsewhere',stops:['Z0','Z1','Z2','Z3','Z4'],metres:[0,300,600,900,1200]};
 const index=patternIndex({...catalogue,patterns:[...catalogue.patterns,away]});
 const stop={id:'S2',name:'S2',...stopAt(2)};
 const buses=[
  bus('coming',1,{patternId:'north',patternIndex:1,nearestStop:'S1',metresAlongPattern:300,metresFromPatternStop:12}),
  bus('passed',4,{patternId:'north',patternIndex:4,nearestStop:'N4',metresAlongPattern:1200,metresFromPatternStop:12}),
  bus('wrong',2,{patternId:'away',patternIndex:2,nearestStop:'Z2',metresAlongPattern:600,metresFromPatternStop:12}),
  bus('maybe',1.5,{unresolved:'ambiguous_branch',explanation:'Two branches fit.',
   candidates:[{patternId:'north',patternIndex:1},{patternId:'away',patternIndex:1}]}),
  bus('unknown',2.2,undefined),
  bus('old',1,{patternId:'north',patternIndex:1,nearestStop:'S1',metresAlongPattern:300,metresFromPatternStop:12},{freshness:'stale'}),
 ];
 const relations=new Map(buses.map(b=>[b.key,relateToStop(b,'S2',index)]));
 const board=stopBoard(buses,stop,relations);
 assert.deepEqual(board.coming.map(r=>r.bus.key),['coming'],'only a bus timetabled to call and not past');
 assert.deepEqual(board.maybe.map(r=>r.bus.key),['maybe']);
 assert.deepEqual(board.nearby.map(r=>r.bus.key).sort(),['unknown','wrong'],'near the stop is not coming to it');
 assert.deepEqual(board.passed.map(r=>r.bus.key),['passed']);
 assert.deepEqual(board.old.map(r=>r.bus.key),['old'],'an old report is listed apart, even on a calling service');
 assert.equal(standingWords(board.nearby.find(r=>r.bus.key==='wrong')),'does not call at your stop');
 assert.equal(standing(relations.get('coming')),'coming');
});

test('buses at the stop are those reported within the radius, nearest first',()=>{
 const stop={id:'S2',name:'S2',...stopAt(2)};
 const found=busesAtStop([bus('far',0,undefined),bus('here',2,undefined),bus('close',2,undefined,{lat:stopAt(2).lat+0.0008})],stop,byId);
 assert.deepEqual(found.map(f=>f.bus.key),['here','close']);
 assert.ok(found.every(f=>f.metres<=AT_STOP_METRES));
});

test('a long stop sequence collapses into a counted gap',()=>{
 const long={...north,id:'long',stops:Array.from({length:20},(_,i)=>`L${i}`),metres:Array.from({length:20},(_,i)=>i*300)};
 const index=patternIndex({...catalogue,patterns:[long]});
 const relation=relateToStop(bus('g',0,{patternId:'long',patternIndex:2,nearestStop:'L2',metresAlongPattern:600,metresFromPatternStop:9}),'L15',index);
 const items=schematic(relation,name,'L15');
 assert.ok(items.length<=8);
 assert.ok(items.some(i=>i.kind==='gap'&&i.count>0));
 assert.ok(items.some(i=>i.kind==='stop'&&i.role==='bus'&&i.atco==='L2'));
 assert.ok(items.some(i=>i.kind==='stop'&&i.role==='yours'&&i.atco==='L15'));
});

test('fit journey frames you, your stop and the chosen bus only',()=>{
 assert.equal(journeyFocus({here:null,stop:stopAt(1),bus:stopAt(3)}).length,2);
 assert.equal(journeyFocus({}).length,0);
});

test('operating days evaluate the same way the pipeline does',()=>{
 assert.equal(weekdayIndex(SUNDAY),6);
 assert.equal(weekdayIndex(MONDAY),0);
 assert.equal(londonDate(Date.UTC(2026,8,13,23,30)),'2026-09-14');     // 00:30 BST is Monday
 const term=[{days:[0,1,2,3,4],serviced:[{mode:'only',kind:'WorkingDays',organisations:['SCH'],ranges:[['2026-09-01','2026-10-23']]}]}];
 assert.equal(runsOn(term,MONDAY),true);
 assert.equal(runsOn(term,'2026-10-26'),false);
 assert.equal(runsOn(null,MONDAY),null);
 assert.equal(ruleApplies({days:[6],notOn:[[SUNDAY,SUNDAY]]},SUNDAY),false);
 assert.equal(ruleApplies({days:[],alsoOn:[[SUNDAY,SUNDAY]]},SUNDAY),true);
});

test('a bearing is used only when reported and inside the compass, and zero counts',()=>{
 assert.equal(usableBearing(0,'reported'),0);
 assert.equal(usableBearing(359.5,'reported'),359.5);
 assert.equal(usableBearing(90,'absent'),null);
 assert.equal(usableBearing(null,'reported'),null);
 assert.equal(usableBearing(400,'reported'),null);
});
