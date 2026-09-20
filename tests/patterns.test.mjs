import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parsePatterns,patternIndex,relateToStop,relationWords,alongRouteWords,
        patternsCallingAt,boardableAt} from '../lib/patterns.ts';

const published=parsePatterns(JSON.parse(readFileSync(new URL('../public/data/patterns.json',import.meta.url),'utf8')));

const base={operator:'BNML',line:'142',direction:'inbound',destination:'Piccadilly',
 stopCount:6,stopsInArea:6,lengthMetres:1500,hasRepeatedStop:false,
 timetable:{datasetSha256:'a'.repeat(64),file:'f.xml',validFrom:'2026-01-01',validTo:'2031-01-01'}};
const pattern={...base,id:'p1',stops:['S0','S1','S2','S3','S4','S5'],metres:[0,300,600,900,1200,1500]};
const branch={...base,id:'p2',destination:'Eastlands',stops:['S0','S1','S2','X3','X4'],metres:[0,300,600,1000,1400]};
const undeclared={...base,id:'p3',stops:['S0','S1','S2','S3','S4','S5'],metres:[0,300,null,null,null,null]};
const index=patternIndex({...published,patterns:[pattern,branch,undeclared]});
const at=(patternId,i,metres=10)=>({match:{patternId,patternIndex:i,nearestStop:'x',metresAlongPattern:0,
 metresFromPatternStop:metres,patternDirection:'inbound',patternDestination:'Piccadilly'}});

test('a bus behind your stop is counted forward along the timetabled order',()=>{
 const relation=relateToStop(at('p1',1),'S4',index);
 assert.equal(relation.kind,'approaching');
 assert.equal(relation.stopsAway,3);
 assert.equal(relation.nearestStop,'S1');
 assert.equal(relation.alongMetres,900);      // 1200 - 300
 assert.equal(relationWords(relation),'3 stops before yours');
});

test('a report past your stop is described as past, never as approaching',()=>{
 const relation=relateToStop(at('p1',4),'S1',index);
 assert.equal(relation.kind,'beyond');
 assert.equal(relation.stopsPast,3);
 assert.equal(relationWords(relation),'last reported past your stop');
});

test('nearest to your stop is not turned into "at your stop" or "has left"',()=>{
 const relation=relateToStop(at('p1',2,40),'S2',index);
 assert.equal(relation.kind,'near_your_stop');
 assert.equal(relation.metresFromStop,40);
 assert.equal(relationWords(relation),'last reported at or near your stop');
});

test('a branch that does not call at your stop is excluded, not approximated',()=>{
 const relation=relateToStop(at('p2',1),'S4',index);
 assert.equal(relation.kind,'does_not_call');
});

test('an undeclared link distance stays unknown rather than becoming zero',()=>{
 const relation=relateToStop(at('p3',1),'S4',index);
 assert.equal(relation.kind,'approaching');
 assert.equal(relation.alongMetres,null);
 assert.match(alongRouteWords(null),/not declared/);
});

test('an unresolved branch keeps both candidates and says only what holds on both',()=>{
 const ambiguous={match:{unresolved:'ambiguous_branch',explanation:'More than one branch fits.',
  nearestStop:'S1',candidates:[{patternId:'p1',patternIndex:1},{patternId:'p2',patternIndex:1}]}};
 // S2 is on both branches, one stop on: supportable despite the ambiguity.
 const shared=relateToStop(ambiguous,'S2',index);
 assert.equal(shared.kind,'branch_all_call');
 assert.equal(shared.stopsAway,1);
 assert.match(relationWords(shared),/1 stop before yours on every possible branch/);
 // S4 is on one branch only: that is all that can be said.
 const partial=relateToStop(ambiguous,'S4',index);
 assert.equal(partial.kind,'branch_some_call');
 assert.equal(`${partial.calling}/${partial.total}`,'1/2');
 // A stop on neither.
 assert.equal(relateToStop(ambiguous,'Z9',index).kind,'branch_none_call');
});

test('any other unresolved match carries its reason through to the passenger',()=>{
 const relation=relateToStop({match:{unresolved:'no_pattern_operating_today',explanation:'No journeys today.'}},'S4',index);
 assert.equal(relation.kind,'unresolved');
 assert.equal(relation.reason,'no_pattern_operating_today');
 assert.equal(relation.explanation,'No journeys today.');
});

test('a bus with no match at all is not silently related to the stop',()=>{
 assert.equal(relateToStop({},'S4',index).kind,'no_pattern_data');
 assert.equal(relateToStop(at('missing',1),'S4',index).kind,'no_pattern_data');
 assert.equal(relationWords({kind:'no_pattern_data'}),'no timetable pattern held');
});

test('one stop reads in the singular',()=>{
 assert.equal(relationWords(relateToStop(at('p1',3),'S4',index)),'1 stop before yours');
});

test('no relation is ever worded as a time or an arrival',()=>{
 const relations=[relateToStop(at('p1',1),'S4',index),relateToStop(at('p1',4),'S1',index),
  relateToStop(at('p1',2),'S2',index),relateToStop(at('p2',1),'S4',index)];
 for(const r of relations)assert.ok(!/min|minute|arriv|eta|due|will/i.test(relationWords(r)),relationWords(r));
});

test('along-route distance is stated as distance and never as a time',()=>{
 assert.equal(alongRouteWords(900),'900 m along the stop sequence');
 assert.equal(alongRouteWords(1267),'1.3 km along the stop sequence');
 for(const m of [500,2500])assert.ok(!/along the route/.test(alongRouteWords(m)));
 for(const metres of [0,250,900,5000])assert.ok(!/min|minute|arriv|eta/i.test(alongRouteWords(metres)));
});

test('a pattern cannot be boarded at the stop where it terminates',()=>{
 assert.ok(boardableAt(pattern,'S4'));
 assert.ok(!boardableAt(pattern,'S5'));
 assert.ok(!boardableAt(pattern,'nowhere'));
});

test('the published pattern catalogue is internally consistent',()=>{
 assert.ok(published.patterns.length>0,'patterns are published');
 for(const p of published.patterns){
  assert.equal(p.stops.length,p.metres.length,`${p.id} stop and distance arrays agree`);
  assert.ok(p.stops.length>=published.rules.minimumStops);
  // Older catalogues were built with a 60% share; current ones need a stop inside the area.
  const least=published.rules.minimumStopsInArea??Math.ceil(p.stopCount*published.rules.minimumStopsInAreaFraction);
  assert.ok(p.stopsInArea>=least,`${p.id} meets the published in-area rule`);
  // Declared distances never go backwards, and once one is undeclared the rest are too.
  const firstUnknown=p.metres.indexOf(null);
  const known=firstUnknown<0?p.metres:p.metres.slice(0,firstUnknown);
  for(let i=1;i<known.length;i++)assert.ok(known[i]>=known[i-1],`${p.id} distances increase`);
  if(firstUnknown>=0)assert.ok(p.metres.slice(firstUnknown).every(m=>m===null),`${p.id} stays unknown`);
  assert.match(p.timetable.datasetSha256,/^[a-f0-9]{64}$/);
 }
 assert.deepEqual([...new Set(published.patterns.map(p=>p.line))].sort(),
  [...published.supportedLines].sort());
});

test('a real stop resolves to the real patterns that call at it',()=>{
 const withStops=published.patterns.filter(p=>p.stops.length>0);
 const sample=withStops[0].stops[3];
 const calling=patternsCallingAt(published,sample);
 assert.ok(calling.length>=1);
 assert.ok(calling.every(p=>p.stops.includes(sample)&&p.stops.indexOf(sample)<p.stops.length-1));
 assert.deepEqual(patternsCallingAt(published,'not-a-real-stop'),[]);
});


test('scheduled seconds travel with the pattern as a parallel array, and a mismatch is refused',()=>{
 const timed={...pattern,id:'p4',seconds:[0,60,120,180,240,300]};
 const parsed=parsePatterns({...published,patterns:[timed]});
 assert.deepEqual(parsed.patterns[0].seconds,[0,60,120,180,240,300]);
 const untimed=parsePatterns({...published,patterns:[pattern]});
 assert.equal(untimed.patterns[0].seconds,undefined,'a catalogue built before run times were recorded has none');
 const partial={...pattern,id:'p5',seconds:[0,60,null,null,null,null]};
 assert.deepEqual(parsePatterns({...published,patterns:[partial]}).patterns[0].seconds,[0,60,null,null,null,null]);
 assert.throws(()=>parsePatterns({...published,patterns:[{...pattern,id:'p6',seconds:[0,60]}]}),/scheduled seconds disagree/);
});
