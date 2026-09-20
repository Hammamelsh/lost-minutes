// Journey state layers (docs/JOURNEY_STATE.md): a link wins, a tab's session restores, the device
// only offers; a link names a journey, not a vehicle; recents are deliberate; New journey clears all.
import test from 'node:test';
import assert from 'node:assert/strict';
import {addRecent,busLinkKey,clearJourney,initialJourney,JOURNEY_SESSION_STORE,JOURNEY_STORE,parseBusKey,
        readRecents,removeRecent,writeJourney} from '../lib/journey-context.ts';

const store=()=>{const m=new Map();return {getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),size:()=>m.size}};
const NOW=1_800_000_000_000;
const bus={key:'BNML|MF74NPO',operator:'BNML',vehicle:'MF74NPO',route:'15',direction:'inbound',destination:'Piccadilly_Gardens',journeyRef:'1108',observedAtMs:NOW};

test('a bare address with only a device journey is an offer, never an applied selection',()=>{
 const local=store(); writeJourney(local,{stopId:'1800SJ32251',serviceKey:null,bus,savedAt:NOW-60_000});
 const j=initialJourney('',local,NOW,store());
 assert.equal(j.source,'offer'); assert.equal(j.stopId,'1800SJ32251');
});

test('the tab’s own session journey restores silently and outranks the device’s offer',()=>{
 const local=store(), session=store();
 writeJourney(local,{stopId:'1800SJ00811',serviceKey:null,bus:null,savedAt:NOW-3_600_000});
 writeJourney(session,{stopId:'1800SJ32251',serviceKey:'BNML|15|inbound|Piccadilly Gardens',bus,savedAt:NOW-60_000},JOURNEY_SESSION_STORE);
 const j=initialJourney('',local,NOW,session);
 assert.equal(j.source,'session'); assert.equal(j.stopId,'1800SJ32251'); assert.equal(j.serviceKey,'BNML|15|inbound|Piccadilly Gardens');
});

test('a link wins over both stores, and its four-part bus key restores a journey, not just a vehicle',()=>{
 const local=store(), session=store();
 writeJourney(session,{stopId:'1800SJ00811',serviceKey:null,bus:null,savedAt:NOW},JOURNEY_SESSION_STORE);
 const j=initialJourney('?stop=1800SJ32251&bus=BNML%7CMF74NPO%7C15%7Cinbound',local,NOW,session);
 assert.equal(j.source,'link'); assert.equal(j.stopId,'1800SJ32251');
 assert.equal(j.busKey,'BNML|MF74NPO'); assert.equal(j.bus.route,'15'); assert.equal(j.bus.direction,'inbound');
 assert.equal(busLinkKey(bus),'BNML|MF74NPO|15|inbound|1108','the link carries the trip too');
 assert.equal(busLinkKey({...bus,journeyRef:''}),'BNML|MF74NPO|15|inbound','and leaves it out where the operator gave none');
});

test('a link naming another journey of a remembered vehicle does not borrow the remembered journey',()=>{
 const session=store();
 writeJourney(session,{stopId:'1800SJ32251',serviceKey:null,bus,savedAt:NOW},JOURNEY_SESSION_STORE);
 const j=initialJourney('?stop=1800SJ32251&bus=BNML%7CMF74NPO%7C15%7Coutbound',store(),NOW,session);
 assert.equal(j.bus.direction,'outbound'); assert.equal(j.bus.journeyRef,'','the link’s journey, not the store’s');
 const same=initialJourney('?stop=1800SJ32251&bus=BNML%7CMF74NPO%7C15%7Cinbound',store(),NOW,session);
 assert.equal(same.bus.journeyRef,'1108','the same journey borrows the remembered detail');
});

test('an old two-part link key restores the vehicle with no journey, so the page must check it against the stop',()=>{
 const j=initialJourney('?stop=1800SJ32251&bus=BNML%7CMF74NPO',store(),NOW,store());
 assert.equal(j.busKey,'BNML|MF74NPO'); assert.equal(j.bus,null);
 assert.deepEqual(parseBusKey('BNML|MF74NPO'),{key:'BNML|MF74NPO',route:null,direction:null,journeyRef:''});
 assert.equal(parseBusKey('bad'),null); assert.equal(parseBusKey('a|b|c'),null,'three parts is neither form');
});

test('recents are deliberate choices, most recent first, one per stop, six at most, thirty days',()=>{
 const local=store();
 for(let i=0;i<8;i++)addRecent(local,`1800SJ0000${i}`,NOW+i*1000);
 addRecent(local,'1800SJ00003',NOW+20_000);
 const r=readRecents(local,NOW+30_000);
 assert.equal(r.length,6); assert.equal(r[0].stopId,'1800SJ00003','re-chosen moves to the front');
 assert.equal(new Set(r.map(x=>x.stopId)).size,6);
 removeRecent(local,'1800SJ00003',NOW+30_000);
 assert.ok(!readRecents(local,NOW+30_000).some(x=>x.stopId==='1800SJ00003'));
 assert.equal(readRecents(local,NOW+31*24*3_600_000).length,0,'thirty days later, nothing');
 addRecent(local,'not an atco!',NOW); assert.ok(!readRecents(local,NOW+40_000).some(x=>x.stopId==='not an atco!'));
});

test('New journey empties both journey stores and leaves recents and saved things alone',()=>{
 const local=store(), session=store();
 writeJourney(local,{stopId:'1800SJ32251',serviceKey:null,bus,savedAt:NOW});
 writeJourney(session,{stopId:'1800SJ32251',serviceKey:null,bus,savedAt:NOW},JOURNEY_SESSION_STORE);
 addRecent(local,'1800SJ32251',NOW); local.setItem('lost-minutes.stops.v1','["1800SJ32251"]');
 clearJourney(local,session);
 assert.equal(local.getItem(JOURNEY_STORE),null); assert.equal(session.getItem(JOURNEY_SESSION_STORE),null);
 assert.equal(readRecents(local,NOW+1).length,1); assert.equal(local.getItem('lost-minutes.stops.v1'),'["1800SJ32251"]');
 assert.equal(initialJourney('',local,NOW+1,session),null,'nothing to offer or restore: nothing resurrects');
});

test('a link carries a vehicle on a route, not a trip: the journey reference is not invented', () => {
 const bare = initialJourney('?stop=1800SJ32251&bus=BNML%7CMF74NPO%7C15%7Cinbound', store(), NOW, store());
 assert.equal(bare.bus.journeyRef, '', 'a link with no reference never claims which trip it was');
 const named = initialJourney('?stop=1800SJ32251&bus=BNML%7CMF74NPO%7C15%7Cinbound%7C1108', store(), NOW, store());
 assert.equal(named.bus.journeyRef, '1108', 'a link that carries the trip keeps it');
 const session = store();
 writeJourney(session, {stopId: '1800SJ32251', serviceKey: null, bus, savedAt: NOW}, JOURNEY_SESSION_STORE);
 assert.equal(initialJourney('', store(), NOW, session).bus.journeyRef, '1108',
  'this tab’s own journey does know the trip, so a refresh keeps it exactly');
});
