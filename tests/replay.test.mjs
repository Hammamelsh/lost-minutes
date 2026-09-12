import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseReplay,lastObservation,latestVisible,visibleJourneys,clock} from '../lib/replay.ts';

const data=parseReplay(JSON.parse(readFileSync(new URL('../public/data/replay.json',import.meta.url),'utf8')));

test('replay never shows future observations and expires old positions',()=>{
 for(const journey of data.journeys){
  for(const frame of data.frames){
   const p=latestVisible(journey,frame);
   if(p){assert.ok(p.time<=frame);assert.ok(frame-p.time<=120000);}
  }
  assert.equal(lastObservation(journey,journey.points[0].time-1),undefined);
  assert.equal(latestVisible(journey,journey.points.at(-1).time+120001),undefined);
 }
});

test('map count is distinct vehicles, including when a vehicle changes journey',()=>{
 for(const frame of data.frames){
  const visible=visibleJourneys(data.journeys,frame);
  assert.equal(new Set(visible.map(j=>j.operator+'|'+j.vehicle)).size,visible.length);
 }
});

test('every published point resolves to an inspected source fingerprint',()=>{
 const hashes=new Set(data.sources.map(s=>s.sha256));
 let points=0;
 for(const j of data.journeys){for(const p of j.points){assert.ok(hashes.has(p.sourceHash));points++;}}
 assert.equal(points,data.quality.uniqueObservations);
});

test('contract rejects malformed data and does not silently imply live operation',()=>{
 assert.throws(()=>parseReplay({...data,mode:'live'}));
 assert.throws(()=>parseReplay({...data,journeys:[]}));
 assert.equal(data.quality.timetableMatched,false);
 assert.equal(data.quality.scheduledCoverage,null);
});

test('British Summer Time is displayed from explicit UTC observations',()=>{
 assert.equal(clock(Date.parse('2026-09-11T07:00:00Z')),'08:00');
});
