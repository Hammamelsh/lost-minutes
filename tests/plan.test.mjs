import test from 'node:test';
import assert from 'node:assert/strict';
import {directOptions,planText,transitHandoff} from '../lib/plan.ts';
import {looksLikePostcode,looksLikePartialPostcode,stopPlaces,postcodePlaces,addressPlaces,inside} from '../lib/places.ts';

// A straight road running north with stops every 300 m, and one pattern each way.
const stops=Array.from({length:8},(_,i)=>({id:`S${i}`,name:`Stop ${i}`,lat:53.45+i*300/111195,lon:-2.30}));
const common={operator:'BNML',serviceCode:'X',stopCount:8,stopsInArea:8,runs:'Mon–Sun',journeys:20,
 operatingRules:[{days:[0,1,2,3,4,5,6]}],timetable:{datasetSha256:'f',file:'x.xml',validFrom:'2026-01-01',validTo:'2031-12-31',modified:'2026-01-01',revision:'1'},
 metres:stops.map((_,i)=>i*300),seconds:null,timings:null};
const north={...common,id:'BNML:9:inbound:aaaa',line:'9',direction:'inbound',destination:'North End',stops:stops.map(s=>s.id)};
const south={...common,id:'BNML:9:outbound:bbbb',line:'9',direction:'outbound',destination:'South End',stops:[...stops.map(s=>s.id)].reverse()};
const weekend={...north,id:'BNML:9:inbound:cccc',destination:'North End (Sat–Sun)',operatingRules:[{days:[5,6]}]};
const catalogue={schemaVersion:2,generatedAt:'2026-09-21T00:00:00Z',supportedLines:['9'],patterns:[north,south,weekend],rules:{minimumStops:5},attribution:'test',notes:[]};
const at=i=>({lat:stops[i].lat+0.0002,lon:stops[i].lon+0.0003});   // ~30 m from stop i
const MONDAY='2026-09-21';

test('a direct option boards before it alights on one valid pattern, and the other direction is not offered', () => {
 const options=directOptions(at(1),at(5),catalogue,stops,MONDAY);
 assert.equal(options.length,1);
 const [o]=options;
 assert.equal(o.line,'9'); assert.equal(o.headsign,'North End');
 assert.equal(o.board.id,'S1'); assert.equal(o.alight.id,'S5'); assert.equal(o.rideStops,4); assert.equal(o.rideMetres,1200);
 assert.ok(o.walkToBoardMetres<60&&o.walkFromAlightMetres<60);
 // Back the other way: recomputed, and the southbound pattern is the answer.
 const back=directOptions(at(5),at(1),catalogue,stops,MONDAY);
 assert.equal(back[0].headsign,'South End'); assert.equal(back[0].board.id,'S5');
});

test('a pattern that does not run on the day, a stop beyond walking reach, and the same stop both ends are all refused', () => {
 assert.ok(directOptions(at(1),at(5),catalogue,stops,MONDAY).every(o=>o.pattern.id!==weekend.id));
 assert.equal(directOptions({lat:53.45,lon:-2.32},at(5),catalogue,stops,MONDAY).length,0,'1.3 km from the nearest stop: no walk offered');
 assert.equal(directOptions(at(3),at(3),catalogue,stops,MONDAY).length,0,'nothing to ride');
});

test('a tracked bus before the boarding stop is listed by stops away; one too close for the walk carries a caution', () => {
 const bus=(patternId,patternIndex,extra={})=>({key:`k${patternIndex}`,operator:'BNML',vehicle:'V',route:'9',direction:'inbound',journeyRef:'j',destination:'North_End',
  lat:0,lon:0,observedAtMs:0,recordedAt:'',ageSeconds:20,freshness:'fresh',ageWords:'20 s',sourceHash:'h',bearing:null,bearingStatus:'absent',
  match:{patternId,patternIndex,nearestStop:'S0',evidence:{}},...extra});
 const o=directOptions(at(3),at(6),catalogue,stops,MONDAY,[bus(north.id,0),bus(north.id,2),bus(north.id,5)])[0];
 assert.deepEqual(o.tracked.map(t=>t.stopsAway),[1,3],'only buses before the boarding stop, nearest first');
 assert.equal(o.caution,null,'a 30 m walk: nothing to warn about');
 const far=directOptions({lat:stops[3].lat,lon:stops[3].lon+0.006},at(6),catalogue,stops,MONDAY,[bus(north.id,2)])[0];
 assert.match(far.caution,/may pass before you reach the stop/);
});

test('the plan text names both walks, the boarding stop, the direction and the alighting stop, and promises no time', () => {
 const o=directOptions(at(1),at(5),catalogue,stops,MONDAY)[0];
 const text=planText(o,{label:'Home'},{label:'Work'},'https://example/plan');
 assert.match(text,/Walk about \d+0 m \(straight line\) to Stop 1/);
 assert.match(text,/Board the 9 towards North End/);
 assert.match(text,/Get off at Stop 5, 4 stops later/);
 assert.match(text,/No times are promised/);
 assert.equal(transitHandoff({lat:53.4,lon:-2.3},{lat:53.5,lon:-2.2}),'https://www.google.com/maps/dir/?api=1&origin=53.40000,-2.30000&destination=53.50000,-2.20000&travelmode=transit');
});

test('places: postcodes are recognised, our stops come as places, and the providers are read defensively', async () => {
 assert.ok(looksLikePostcode('M32 8LZ')&&looksLikePostcode('m328lz'));
 assert.ok(looksLikePartialPostcode('M32 8')&&!looksLikePartialPostcode('M32 8LZ'));
 assert.ok(!looksLikePostcode('Stretford Mall'));
 const s=stopPlaces([{id:'A',name:'Stretford Mall',indicator:'Stop A',street:'Kingsway',lat:53.44629,lon:-2.31056}],'stretford');
 assert.equal(s[0].label,'Stretford Mall (Stop A)'); assert.match(s[0].detail,/Bus stop · Kingsway/);
 const fake=json=>async()=>new Response(JSON.stringify(json),{status:200});
 const pc=await postcodePlaces('M32 8LZ',{fetch:fake({status:200,result:{postcode:'M32 8LZ',latitude:53.4436,longitude:-2.3078,admin_district:'Trafford',admin_ward:'Longford'}})});
 assert.equal(pc[0].label,'M32 8LZ'); assert.match(pc[0].detail,/Postcode · Longford · Trafford/);
 const outside=await postcodePlaces('SW1A 1AA',{fetch:fake({status:200,result:{postcode:'SW1A 1AA',latitude:51.5,longitude:-0.14}})});
 assert.equal(outside.length,0,'outside Greater Manchester is not offered');
 const ad=await addressPlaces('Old Trafford',{fetch:fake({features:[
  {properties:{name:'Old Trafford',osm_key:'leisure',osm_value:'stadium',city:'Manchester',postcode:'M16 0RA'},geometry:{coordinates:[-2.2913,53.4631]}},
  {properties:{name:'Old Trafford',osm_key:'highway',osm_value:'bus_stop'},geometry:{coordinates:[-2.29,53.46]}},
  {properties:{name:'Old Trafford',osm_key:'place',osm_value:'suburb',city:'Manchester'},geometry:{coordinates:[-2.28,53.455]}}]})});
 assert.equal(ad.length,2,'an OSM bus stop is left to our catalogue');
 assert.match(ad[0].detail,/stadium · Manchester · M16 0RA/);
 assert.ok(inside({lat:53.46,lon:-2.29})&&!inside({lat:51.5,lon:-0.1}));
 const failed=await addressPlaces('anything',{fetch:async()=>{throw new Error('offline')}});
 assert.deepEqual(failed,[]);
});

test('the plan link is read defensively and written back without touching the rest of the address', async () => {
 const {readPlanLink,withPlan}=await import('../lib/plan-link.ts');
 assert.deepEqual(readPlanLink(''),{from:null,to:null});
 assert.deepEqual(readPlanLink('?stop=1800SJ00811'),{from:null,to:null});
 assert.deepEqual(readPlanLink('?to=53.4,-2.3&toLabel=Work').to,{lat:53.4,lon:-2.3,label:'Work'});
 assert.equal(readPlanLink('?to=53.4').to,null);
 assert.equal(readPlanLink('?to=,').to,null);
 assert.equal(readPlanLink('?to=abc,-2.3').to,null);
 assert.equal(readPlanLink('?to=95,-2.3').to,null);
 assert.match(readPlanLink('?to=53.4,-2.3').to.label,/a point at 53\.4000, -2\.3000/);
 const written=withPlan('?stop=1800SJ00811&bus=BNML%7CV',{lat:53.44365,lon:-2.30780,label:'M32 8LZ'},{lat:53.4,lon:-2.3,label:'Work'});
 assert.equal(written,'?stop=1800SJ00811&bus=BNML%7CV&from=53.44365%2C-2.30780&fromLabel=M32+8LZ&to=53.40000%2C-2.30000&toLabel=Work');
 assert.equal(withPlan(written,null,null),'?stop=1800SJ00811&bus=BNML%7CV');
});
