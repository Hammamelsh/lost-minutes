import test from 'node:test';
import assert from 'node:assert/strict';
import {busesFromArchive,busesFromLive,destinationLabel,directionLabel,goneQuiet,routeId,routeNumber,
        routesByRecency} from '../lib/follow.ts';

const POLICY={observationFreshSeconds:60,observationAgeingSeconds:150,
 observationExpirySeconds:900,publicationStaleSeconds:120,futureToleranceSeconds:120,
 pollIntervalSeconds:20,basis:'test'};
const NOW=1_000_000_000_000;
const vehicle=(over,extra={})=>({operator:'BNML',vehicle:'V'+over,route:'142',
 direction:'inbound',journeyRef:'J1',destination:'Manchester_Piccadilly',
 observedAtMs:NOW-over*1000,recordedAt:new Date(NOW-over*1000).toISOString(),
 lat:53.47,lon:-2.24,ageSeconds:over,freshness:'fresh',positionKind:'observed',
 sourceHash:'a'.repeat(64),...extra});
const state=vehicles=>({publishedAtMs:NOW,vehicles,freshness:{policy:POLICY}});

test('supplied destinations and directions are shown in readable words',()=>{
 assert.equal(destinationLabel('Manchester_Piccadilly'),'Manchester Piccadilly');
 assert.equal(destinationLabel(''),'an unnamed destination');
 assert.equal(destinationLabel('  '),'an unnamed destination');
 assert.equal(directionLabel('inbound'),'Inbound');
 assert.equal(directionLabel('outbound'),'Outbound');
 assert.equal(directionLabel('anticlockwise'),'Anticlockwise');
 // Nothing supplied means nothing claimed: we never invent a direction.
 assert.equal(directionLabel(''),'');
});

test('a bus carries the age of its own report, not the age of our request',()=>{
 const [bus]=busesFromLive(state([vehicle(30)]),NOW,NOW,NOW);
 assert.equal(Math.round(bus.ageSeconds),30);
 assert.equal(bus.freshness,'fresh');
 assert.match(bus.ageWords,/reported 30s ago/);
 // Thirty local seconds later the same payload reports an older bus.
 const [later]=busesFromLive(state([vehicle(30)]),NOW,NOW,NOW+30_000);
 assert.equal(Math.round(later.ageSeconds),60);
});

test('a position past the cut-off is never handed to the map',()=>{
 const buses=busesFromLive(state([vehicle(30,{vehicle:'A'}),vehicle(5000,{vehicle:'B'})]),NOW,NOW,NOW);
 assert.deepEqual(buses.map(b=>b.vehicle),['A']);
});

test('routes are suggested by how recently they reported, with counts',()=>{
 const buses=busesFromLive(state([
  vehicle(300,{vehicle:'A',route:'86'}),
  vehicle(20,{vehicle:'B',route:'142'}),
  vehicle(40,{vehicle:'C',route:'142'}),
 ]),NOW,NOW,NOW);
 const routes=routesByRecency(buses);
 assert.equal(routes[0].id,'BNML|142','the most recently reported route comes first');
 assert.equal(routes[0].count,2);
 assert.equal(routes[1].id,'BNML|86');
 assert.equal(routeNumber(routes[0].id),'142');
 assert.equal(routeId({operator:'BNML',route:'86'}),'BNML|86');
});

test('an empty feed suggests nothing rather than inventing a route',()=>{
 assert.deepEqual(routesByRecency([]),[]);
 assert.deepEqual(busesFromLive(null,NOW,NOW,NOW),[]);
});

test('archive buses carry absolute times and no relative age',()=>{
 const journeys=[{operator:'BNML',vehicle:'MF74NRL',route:'142',direction:'inbound',
  journeyRef:'1012',destination:'Piccadilly_Gardens',points:[
   {time:NOW-600_000,lat:53.46,lon:-2.23,recordedAt:'a',retrievedAt:'r',sourceHash:'b'.repeat(64)},
   {time:NOW-60_000,lat:53.47,lon:-2.24,recordedAt:'b',retrievedAt:'r',sourceHash:'b'.repeat(64)}]}];
 const [bus]=busesFromArchive(journeys);
 assert.equal(bus.observedAtMs,NOW-60_000,'the last report in the recording wins');
 assert.equal(bus.ageSeconds,null,'a recording from another day has no "minutes ago"');
 assert.equal(bus.freshness,null);
 assert.equal(bus.ageWords,'');
});

test('a bus has gone quiet by how old its report was when the feed was read, not by its age on this clock',()=>{
 // The owner's phone, 30 September 2026: a V1 and an X43, each reporting every 20-30 s, both said "No report for
 // 62s". Their reports were about 15 s old when the collector read the feed; the publication reached the site
 // 23-25 s later and the phone had last asked some 20 s before that.
 const read=15,onThisClock=62;
 const [bus]=busesFromLive(state([vehicle(read)]),NOW,NOW,NOW+(onThisClock-read)*1000);
 assert.equal(Math.round(bus.ageSeconds),onThisClock,'the report is 62 s old now');
 assert.equal(bus.publishedAgeSeconds,read,'and was 15 s old when the feed was read');
 assert.equal(bus.freshness,'ageing','on this clock it has left the fresh band, as before');
 assert.equal(goneQuiet(bus,POLICY),null,'but it has not gone quiet: it was reporting normally');
 // One that had not reported for over a minute when the feed was read has gone quiet, said at its age now.
 const [silent]=busesFromLive(state([vehicle(75)]),NOW,NOW,NOW+20_000);
 assert.equal(goneQuiet(silent,POLICY),95);
 // At the threshold itself, still fresh; a recording or the archive is never judged.
 assert.equal(goneQuiet({ageSeconds:80,publishedAgeSeconds:60},POLICY),null);
 assert.equal(goneQuiet({ageSeconds:61,publishedAgeSeconds:61},POLICY),61);
 assert.equal(goneQuiet({ageSeconds:null,publishedAgeSeconds:null},POLICY),null);
 assert.equal(goneQuiet({ageSeconds:120},POLICY),null);
});
