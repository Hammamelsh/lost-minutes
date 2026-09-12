import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseCatalogue,nearestStops,searchStops,straightLineMetres,distanceWords,
        bearingWords,stopDetail} from '../lib/stops.ts';

const catalogue=parseCatalogue(JSON.parse(readFileSync(new URL('../public/data/stops.json',import.meta.url),'utf8')));
const LONGFORD={lat:53.4487,lon:-2.3095};      // the example that had no coverage before
const PICCADILLY={lat:53.4808,lon:-2.2374};

test('the catalogue covers the Longford Park area it previously missed',()=>{
 const near=nearestStops(catalogue.stops,LONGFORD,6);
 assert.ok(near.length===6);
 assert.ok(near[0].metres<400,`nearest stop is ${near[0].metres} m away`);
 // Stretford stops are inside the published service area.
 const [west,south,east,north]=catalogue.area.bbox;
 assert.ok(LONGFORD.lon>=west&&LONGFORD.lon<=east&&LONGFORD.lat>=south&&LONGFORD.lat<=north);
 assert.ok(near.some(n=>/stretford|moss road/i.test(n.stop.name)));
});

test('nearest stops come back ordered, and never from the wrong end of the city',()=>{
 const near=nearestStops(catalogue.stops,PICCADILLY,8);
 for(let i=1;i<near.length;i++)assert.ok(near[i].metres>=near[i-1].metres,'ordered by distance');
 assert.ok(near[0].metres<300);
 assert.ok(near.every(n=>n.metres<1500));
});

test('a point far outside the area still returns stops, so the caller decides what that means',()=>{
 // London. The catalogue answers honestly; the interface is what says "outside our area".
 const near=nearestStops(catalogue.stops,{lat:51.5,lon:-0.12},3);
 assert.equal(near.length,3);
 assert.ok(near[0].metres>200000,'the nearest Manchester stop is a long way from London');
});

test('distances are always labelled as straight lines',()=>{
 assert.match(distanceWords(240),/straight line/);
 assert.match(distanceWords(2400),/straight line/);
 for(const m of [50,500,5000])assert.ok(!/walk/i.test(distanceWords(m)));
 assert.equal(Math.round(straightLineMetres({lat:53.48,lon:-2.24},{lat:53.48,lon:-2.24})),0);
});

test('the two sides of a road are distinguishable from the catalogue alone',()=>{
 const byName=new Map();
 for(const stop of catalogue.stops){
  const key=`${stop.name}|${stop.locality??''}`;
  byName.set(key,[...(byName.get(key)??[]),stop]);
 }
 const pairs=[...byName.values()].filter(group=>group.length>1&&group.some(s=>s.bearing));
 assert.ok(pairs.length>50,'many stops share a name with their opposite side');
 const sample=pairs.find(group=>new Set(group.map(s=>s.bearing)).size>1);
 assert.ok(sample,'at least one shared name has genuinely different bearings');
 const details=sample.map(stopDetail);
 assert.equal(new Set(details).size,details.length,'their descriptions differ');
 assert.ok(sample.every(s=>!s.bearing||bearingWords(s.bearing).endsWith('bound')));
});

test('search still finds a stop when a location is never given',()=>{
 const found=searchStops(catalogue.stops,'stretford mall',5);
 assert.ok(found.length>0);
 assert.match(found[0].stop.name,/Stretford Mall/i);
 assert.deepEqual(searchStops(catalogue.stops,'',5),[]);
 assert.deepEqual(searchStops(catalogue.stops,'zzzzqq',5),[]);
});
