import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parsePatterns,patternIndex,relateToStop,relationWords,alongRouteWords,
        patternsCallingAt} from '../lib/patterns.ts';

const published=parsePatterns(JSON.parse(readFileSync(new URL('../public/data/patterns.json',import.meta.url),'utf8')));

const pattern={id:'p1',line:'142',direction:'inbound',destination:'Piccadilly',
 stopCount:6,stopsInArea:6,lengthMetres:1500,hasRepeatedStop:false,
 timetable:{datasetSha256:'a'.repeat(64),file:'f.xml',validFrom:'2026-01-01',validTo:'2031-01-01'},
 stops:['S0','S1','S2','S3','S4','S5'],metres:[0,300,600,900,1200,1500]};
const branch={...pattern,id:'p2',stops:['S0','S1','X2','X3'],metres:[0,300,700,1100]};
const index=patternIndex({...published,patterns:[pattern,branch]});
const at=(patternId,i)=>({match:{patternId,patternIndex:i,nearestStop:'x',metresAlongPattern:0,
 metresFromPatternStop:10,patternDirection:'inbound',patternDestination:'Piccadilly'}});

test('a bus behind your stop is counted forward along the timetabled order',()=>{
 const relation=relateToStop(at('p1',1),'S4',index);
 assert.equal(relation.kind,'approaching');
 assert.equal(relation.stopsAway,3);
 assert.equal(relation.alongRouteMetres,900);      // 1200 - 300
 assert.match(relationWords(relation),/about 3 stops away/);
});

test('a bus already past your stop is never presented as approaching',()=>{
 const relation=relateToStop(at('p1',4),'S1',index);
 assert.equal(relation.kind,'passed');
 assert.equal(relation.stopsPast,3);
 assert.match(relationWords(relation),/passed your stop/);
});

test('a bus at your stop is said to be there, not one stop away',()=>{
 assert.equal(relateToStop(at('p1',2),'S2',index).kind,'at_stop');
});

test('a branch that does not call at your stop is excluded, not approximated',()=>{
 const relation=relateToStop(at('p2',1),'S4',index);
 assert.equal(relation.kind,'does_not_call');
 assert.match(relationWords(relation),/does not call at your stop/);
});

test('an unresolved match carries the reason through to the passenger',()=>{
 const relation=relateToStop({match:{unresolved:'ambiguous_branch',explanation:'Two branches fit.'}},'S4',index);
 assert.equal(relation.kind,'unresolved');
 assert.equal(relation.reason,'ambiguous_branch');
 assert.equal(relation.explanation,'Two branches fit.');
});

test('a bus with no match at all is not silently related to the stop',()=>{
 assert.equal(relateToStop({},'S4',index).kind,'no_pattern_data');
 assert.equal(relateToStop(at('missing',1),'S4',index).kind,'no_pattern_data');
 assert.equal(relationWords({kind:'no_pattern_data'}),'no route match');
});

test('one stop away reads in the singular',()=>{
 assert.match(relationWords(relateToStop(at('p1',3),'S4',index)),/about 1 stop away/);
});

test('along-route distance is stated as distance and never as a time',()=>{
 assert.equal(alongRouteWords(900),'900 m along the stop sequence');
 assert.equal(alongRouteWords(1267),'1.3 km along the stop sequence');
 // It must not imply road-following geometry, which the measurement does not support.
 for(const m of [500,2500])assert.ok(!/along the route/.test(alongRouteWords(m)));
 for(const metres of [0,250,900,5000])assert.ok(!/min|minute|arriv|eta/i.test(alongRouteWords(metres)));
});

test('the published pattern catalogue is internally consistent',()=>{
 assert.ok(published.patterns.length>0,'patterns are published');
 for(const p of published.patterns){
  assert.equal(p.stops.length,p.metres.length,`${p.id} stop and distance arrays agree`);
  assert.ok(p.stops.length>=published.rules.minimumStops);
  assert.ok(p.stopsInArea>=p.stopCount*published.rules.minimumStopsInAreaFraction,
   `${p.id} has enough of its stops inside the collected area`);
  // Distances never go backwards along a pattern.
  for(let i=1;i<p.metres.length;i++)assert.ok(p.metres[i]>=p.metres[i-1],`${p.id} distances increase`);
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
 assert.ok(calling.every(p=>p.stops.includes(sample)));
 assert.deepEqual(patternsCallingAt(published,'not-a-real-stop'),[]);
});
