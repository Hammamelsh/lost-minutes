// Where two candidate patterns share a road: measured from their geometry, never inferred from
// their stop lists. A bus on unresolved candidates gets road only where all of them run down it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {makeTrack} from '../lib/motion.ts';
import {sharedRoad,withinSharedRoad} from '../lib/motion-view.ts';

// A straight road heading east from a point in Stretford, one vertex every 20 m.
const ORIGIN={lat:53.4487,lon:-2.3095};
const M_PER_DEG_LON=111320*Math.cos(ORIGIN.lat*Math.PI/180);
const east=(metres,northMetres=0)=>[ORIGIN.lon+metres/M_PER_DEG_LON,ORIGIN.lat+northMetres/111320];
const straight=(length,step=20)=>Array.from({length:Math.floor(length/step)+1},(_,i)=>east(i*step));
const accepted=makeTrack('accepted',straight(3000));

test('identical geometry is shared for the whole length',()=>{
 const twin=makeTrack('twin',straight(3000));
 const runs=sharedRoad(accepted,[twin]);
 assert.equal(runs.length,1);
 assert.ok(runs[0].from<=0.5,`starts at the beginning, got ${runs[0].from}`);
 assert.ok(runs[0].to>=accepted.length-0.5,`reaches the end, got ${runs[0].to} of ${accepted.length}`);
});

test('a candidate that leaves the road is shared only up to where it leaves',()=>{
 // Same road for 1,200 m, then it swings 60 m north and runs parallel: not the same road.
 const points=[...straight(1200),...Array.from({length:90},(_,i)=>east(1200+(i+1)*20,60))];
 const divergent=makeTrack('divergent',points);
 const runs=sharedRoad(accepted,[divergent]);
 assert.equal(runs.length,1,JSON.stringify(runs));
 assert.ok(runs[0].from<=0.5);
 assert.ok(Math.abs(runs[0].to-1200)<=40,`shared ends near 1,200 m, got ${runs[0].to}`);
});

test('a candidate on a different road shares nothing, whatever its stops',()=>{
 const elsewhere=makeTrack('elsewhere',straight(3000).map(([lon,lat])=>[lon,lat+300/111320]));
 assert.deepEqual(sharedRoad(accepted,[elsewhere]),[]);
});

test('with several candidates, only road they all share counts',()=>{
 const twin=makeTrack('twin',straight(3000));
 const leavesAt1200=makeTrack('leaves',[...straight(1200),...Array.from({length:90},(_,i)=>east(1200+(i+1)*20,60))]);
 const runs=sharedRoad(accepted,[twin,leavesAt1200]);
 assert.equal(runs.length,1);
 assert.ok(Math.abs(runs[0].to-1200)<=40,`the sparser candidate bounds it, got ${runs[0].to}`);
});

test('a bus is on shared road only if its whole look-ahead is too',()=>{
 const shared=[{from:400,to:2000}];
 assert.equal(withinSharedRoad(shared,500,500),true,'500 to 1,000 m: inside');
 assert.equal(withinSharedRoad(shared,1600,500),false,'1,600 to 2,100 m: runs past the end');
 assert.equal(withinSharedRoad(shared,300,500),false,'starts before the shared road begins');
 assert.equal(withinSharedRoad(shared,1500,500),true,'exactly reaching the end is still inside');
 assert.equal(withinSharedRoad([],500,500),false,'no shared road at all');
});

test('the measured route 15 case: a bus approaching Hillingdon Road is on shared road; one in the first 395 m is not',()=>{
 // The measurement of 20 September 2026: shared run 395 to 13,626 m of the accepted 15 inbound
 // shape; Hillingdon Road (opp) at 8,715 m; look-ahead 542 m (17 m/s × 30 s + 32 m).
 const shared=[{from:395,to:13626}];
 const LOOK=17*30+32;
 assert.equal(withinSharedRoad(shared,8715-2000,LOOK),true,'2 km before the stop');
 assert.equal(withinSharedRoad(shared,8715-300,LOOK),true,'300 m before the stop');
 assert.equal(withinSharedRoad(shared,100,LOOK),false,'in the unshared first 395 m');
 assert.equal(withinSharedRoad(shared,13626-100,LOOK),false,'within a look-ahead of the end');
});
