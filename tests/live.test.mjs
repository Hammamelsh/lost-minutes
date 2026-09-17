import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseLive,parseConfig,DEFAULT_CONFIG,observationAge,publicationAge,freshnessOf,
        ageWords,feedMode,readFavourites,writeFavourites,toggleFavourite,isFavourite,
        favouriteKey,serverReference} from '../lib/live.ts';
import {accuracyRing,boundsOf,fitProjection,metres} from '../lib/geo.ts';

const published=JSON.parse(readFileSync(new URL('../public/data/live.json',import.meta.url),'utf8'));
const config=parseConfig(JSON.parse(readFileSync(new URL('../public/data/config.json',import.meta.url),'utf8')));

const POLICY={observationFreshSeconds:60,observationAgeingSeconds:150,
 observationExpirySeconds:900,publicationStaleSeconds:120,futureToleranceSeconds:120,
 pollIntervalSeconds:20,basis:'test'};

test('the published live state parses and states its own mode honestly',()=>{
 const state=parseLive(published);
 assert.equal(state.mode,'live_bods');
 assert.ok(['live','stale','unavailable'].includes(state.state));
 if(state.state==='unavailable')assert.equal(state.vehicles.length,0);
 for(const vehicle of state.vehicles)assert.equal(vehicle.positionKind,'observed');
 assert.ok(state.freshness.policy.observationExpirySeconds>0);
});

test('the contract refuses a state that would mislead',()=>{
 const base=parseLive(published);
 // "live" with nothing observed would claim currency we do not have.
 assert.throws(()=>parseLive({...base,state:'live',vehicles:[]}));
 const vehicle={operator:'T',vehicle:'V',route:'1',direction:'inbound',journeyRef:'J',
  destination:'X',observedAtMs:1,recordedAt:'2026-09-12T00:00:00+00:00',lat:53.47,lon:-2.24,
  ageSeconds:99999,freshness:'expired',positionKind:'observed',sourceHash:'a'.repeat(64)};
 assert.throws(()=>parseLive({...base,state:'live',vehicles:[vehicle]}),/expiry/);
 // An estimated position would have to declare itself, and this release publishes none.
 assert.throws(()=>parseLive({...base,state:'live',
  vehicles:[{...vehicle,ageSeconds:10,positionKind:'estimated'}]}));
});

test('a wrong clock on the phone cannot make a position look fresh',()=>{
 const reference={serverReferenceMs:1_000_000};
 const vehicle={observedAtMs:1_000_000-45_000};      // 45s old at the moment of fetching
 const fetchedAt=5_000_000;                          // device clock is hours out
 assert.equal(observationAge(vehicle,reference,fetchedAt,fetchedAt),45);
 // Ten more local seconds elapse: age grows by exactly ten, whatever the clock says.
 assert.equal(observationAge(vehicle,reference,fetchedAt,fetchedAt+10_000),55);
 // A device clock behind the fetch moment must never subtract from the age.
 assert.equal(observationAge(vehicle,reference,fetchedAt,fetchedAt-60_000),45);
});

test('when the collector stops, observations keep ageing instead of freezing',()=>{
 // A state published ten minutes ago, whose newest bus was 15s old when it was written.
 const live={publishedAtMs:1_000_000};
 const vehicle={observedAtMs:1_000_000-15_000};
 const serverNow=1_000_000+600_000;                  // server clock at the moment we fetch
 const reference=serverReference(new Date(serverNow).toUTCString(),null,live,0);
 const age=observationAge(vehicle,reference,5_000_000,5_000_000);
 assert.ok(age>=615-1&&age<=615+1,`expected about 615s, got ${age}`);
 assert.notEqual(Math.round(age),15,'the age must not freeze at its value when published');
 // Our own publication is separately reported as ten minutes stale.
 assert.equal(Math.round(publicationAge(live,reference,5_000_000,5_000_000)),600);
});

test('the age reference follows RFC 9111: Date plus Age, and never reads younger',()=>{
 const live={publishedAtMs:1_000_000};
 const at=ms=>new Date(ms).toUTCString();
 // A fresh response from the origin.
 assert.deepEqual(serverReference(at(1_200_000),null,live,0),
  {serverReferenceMs:1_200_000,basis:'server'});
 // The same response after a cache held it for 90 seconds: the origin clock has moved on.
 assert.deepEqual(serverReference(at(1_200_000),'90',live,0),
  {serverReferenceMs:1_290_000,basis:'server'});
 assert.equal(serverReference(at(1_200_000),'not a number',live,0).serverReferenceMs,1_200_000);
 // No readable server clock: fall back to this device, never below the publication time.
 assert.deepEqual(serverReference(null,null,live,1_500_000),
  {serverReferenceMs:1_500_000,basis:'device'});
 assert.deepEqual(serverReference('not a date',null,live,10),
  {serverReferenceMs:1_000_000,basis:'device'},'a device clock behind publication is ignored');
 // A server claiming a time before its own publication is not believed.
 assert.deepEqual(serverReference(at(1),null,live,1_400_000),
  {serverReferenceMs:1_400_000,basis:'device'});
});

test('a cached response never makes a position look newer than it is',()=>{
 // The exact pair from the screenshot: published, then delivered 111s later.
 const live={publishedAtMs:1_000_000};
 const vehicle={observedAtMs:1_000_000-24_000};
 const reference=serverReference(new Date(1_111_000).toUTCString(),null,live,0);
 assert.equal(Math.round(observationAge(vehicle,reference,1_111_000,1_111_000)),135);
 assert.equal(Math.round(publicationAge(live,reference,1_111_000,1_111_000)),111);
 // Served from a cache that held it 60s: both ages grow by 60, neither shrinks.
 const viaCache=serverReference(new Date(1_111_000).toUTCString(),'60',live,0);
 assert.equal(Math.round(observationAge(vehicle,viaCache,1_171_000,1_171_000)),195);
 assert.equal(Math.round(publicationAge(live,viaCache,1_171_000,1_171_000)),171);
});

test('publication age measures our own staleness, separately from the observation',()=>{
 const live={publishedAtMs:1_000_000};
 assert.equal(publicationAge(live,{serverReferenceMs:1_030_000},1_030_000,1_030_000),30);
 assert.equal(publicationAge(live,{serverReferenceMs:1_030_000},1_030_000,1_090_000),90);
});

test('freshness thresholds come from the published policy, not the frontend',()=>{
 assert.equal(freshnessOf(0,POLICY),'fresh');
 assert.equal(freshnessOf(60,POLICY),'fresh');
 assert.equal(freshnessOf(61,POLICY),'ageing');
 assert.equal(freshnessOf(151,POLICY),'stale');
 assert.equal(freshnessOf(899,POLICY),'stale','still shown right up to the cut-off');
 assert.equal(freshnessOf(901,POLICY),'expired');
 // No gap between the last shown band and the withheld one.
 assert.equal(freshnessOf(POLICY.observationExpirySeconds,POLICY),'stale');
 assert.equal(freshnessOf(null,POLICY),'unknown');
 assert.equal(freshnessOf(-1,POLICY),'ahead_of_clock');
 assert.equal(freshnessOf(undefined,POLICY),'unknown');
});

test('age wording never claims a position is current',()=>{
 assert.equal(ageWords(3),'reported 3s ago');
 assert.equal(ageWords(0.2),'reported 1s ago','never "now", and never a bare zero');
 assert.equal(ageWords(45),'reported 45s ago');
 assert.equal(ageWords(600),'reported 10 min ago');
 assert.equal(ageWords(7200),'reported 2h 0m ago');
 assert.equal(ageWords(null),'age unknown');
 assert.equal(ageWords(-5),'timestamped ahead of our clock');
 for(const seconds of [0,1,30,90,3600,90000])assert.ok(!/\bnow\b/.test(ageWords(seconds)));
});

test('archive, live, stale, offline and unavailable stay five different states',()=>{
 const live={state:'live',publishedAtMs:0,freshness:{policy:POLICY},vehicles:[{}]};
 assert.equal(feedMode(live,false,true,10),'live');
 assert.equal(feedMode(live,false,true,300),'stale','our own state going stale is visible');
 assert.equal(feedMode(live,true,true,10),'offline','a cached response is never called live');
 assert.equal(feedMode(live,false,false,10),'offline');
 assert.equal(feedMode({...live,state:'stale'},false,true,10),'stale');
 assert.equal(feedMode({...live,state:'unavailable'},false,true,10),'unavailable');
 assert.equal(feedMode(null,false,true,null),'unavailable');
});

test('saved routes stay on the device and survive a blocked store',()=>{
 const store=new Map();
 const fake={getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,v)};
 assert.deepEqual(readFavourites(fake),[]);
 const item={operator:'BNML',route:'142',direction:'inbound'};
 assert.ok(writeFavourites(toggleFavourite([],item),fake));
 assert.deepEqual(readFavourites(fake),[item]);
 assert.ok(isFavourite(readFavourites(fake),item));
 assert.deepEqual(toggleFavourite(readFavourites(fake),item),[]);
 assert.equal(favouriteKey(item),'BNML|142|inbound');
 // A device that refuses storage is reported, not crashed through.
 const blocked={getItem:()=>{throw Error('denied')},setItem:()=>{throw Error('denied')}};
 assert.deepEqual(readFavourites(blocked),[]);
 assert.equal(writeFavourites([item],blocked),false);
 // Corrupt stored data is discarded rather than trusted.
 store.set('lost-minutes.favourites.v1','{"not":"an array"}');
 assert.deepEqual(readFavourites(fake),[]);
});

test('the runtime config can repoint the live feed without a rebuild',()=>{
 assert.equal(config.schemaVersion,1);
 assert.ok(config.pollSeconds>=10,'never poll faster than the upstream cadence');
 assert.equal(parseConfig({nonsense:true}).liveUrl,DEFAULT_CONFIG.liveUrl);
 assert.equal(parseConfig(null).pollSeconds,DEFAULT_CONFIG.pollSeconds);
});

test('reported accuracy is drawn as a ground ring of the reported radius',()=>{
 const centre={lat:53.4487,lon:-2.3095};
 for(const radius of [15,250,1500]){
  const ring=accuracyRing(centre.lat,centre.lon,radius);
  assert.equal(ring.length,65,'64 segments, closed');
  assert.deepEqual(ring[0],ring[64],'the ring closes on itself');
  for(const [lon,lat] of ring){
   const d=metres(centre,{lat,lon});
   assert.ok(Math.abs(d-radius)<=Math.max(1,radius*0.01),`${radius} m ring vertex at ${d} m`);
  }
 }
 // It is geometry, so its extent in degrees follows latitude rather than a fixed pixel count.
 const ring=accuracyRing(53.4487,-2.3095,500);
 const lons=ring.map(p=>p[0]),lats=ring.map(p=>p[1]);
 assert.ok(Math.max(...lons)-Math.min(...lons)>Math.max(...lats)-Math.min(...lats),
  'a degree of longitude is shorter than a degree of latitude here');
});

test('the map fits the points it is given without distorting them',()=>{
 const points=[{lat:53.470,lon:-2.240},{lat:53.480,lon:-2.220}];
 const bounds=boundsOf(points);
 assert.ok(bounds.west<-2.240&&bounds.east>-2.220);
 assert.ok(bounds.south<53.470&&bounds.north>53.480);
 assert.equal(boundsOf([]),null);
 const projector=fitProjection(bounds,600,600);
 for(const point of points){
  const [x,y]=projector.project(point.lon,point.lat);
  assert.ok(x>=0&&x<=600&&y>=0&&y<=600,'every point lands inside the viewport');
 }
 // A single point still produces a usable window rather than an infinite zoom.
 const single=fitProjection(boundsOf([points[0]]),600,600);
 const [x,y]=single.project(points[0].lon,points[0].lat);
 assert.ok(Math.abs(x-300)<1&&Math.abs(y-300)<1);
 assert.ok(metres(points[0],points[1])>1000);
});
