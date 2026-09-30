// The ride's sight line to the chosen bus (lib/sightline.ts): how steeply the camera must look down to see the
// bus over the buildings between them, and when no tilt can.
import test from 'node:test';
import assert from 'node:assert/strict';
import {SIGHT,sightline} from '../lib/sightline.ts';

const BUS={lon:-2.24354,lat:53.48731,heading:0};    // heading north, the camera south of it, behind
const KX=111195*Math.cos(BUS.lat*Math.PI/180);
const at=(east,north)=>[BUS.lon+east/KX,BUS.lat+north/111195];
const box=(e0,n0,e1,n1)=>[[at(e0,n0),at(e1,n0),at(e1,n1),at(e0,n1),at(e0,n0)]];
// The ride's camera: 56.2 m from the bus (zoom 20 on a 844 px phone canvas), due south of it, looking north.
const D=56.2;
const camera=pitch=>{const r=pitch*Math.PI/180;const [lon,lat]=at(0,-D*Math.sin(r));return {lon,lat,altitude:D*Math.cos(r)}};

test('an open street constrains nothing',()=>{
 const s=sightline({bus:BUS,camera:camera(60),pitch:60,footprints:[]});
 assert.deepEqual(s,{cap:null,inside:false,blocking:[],binding:null});
});

test('a 30 m building 20 m behind the bus: the camera looks down just steeply enough, and there it is clear',()=>{
 const building={rings:box(-15,-20,15,-35),height:30};
 const s=sightline({bus:BUS,camera:camera(60),pitch:60,footprints:[building]});
 assert.ok(s.cap!==null&&s.cap<60,`blocked at 60: cap ${s.cap}`);
 assert.deepEqual(s.blocking,[0]);
 // At the pitch it asked for, the same building no longer asks for a lower one.
 const again=sightline({bus:BUS,camera:camera(s.cap),pitch:s.cap,footprints:[building]});
 assert.ok(again.cap>=s.cap-0.5,`clear at ${s.cap.toFixed(1)}: asks ${again.cap.toFixed(1)}`);
 // And the geometry agrees: the sight line from the top of the seen part to the camera clears the roof edge.
 const r=s.cap*Math.PI/180,ground=D*Math.sin(r),alt=D*Math.cos(r);
 assert.ok(SIGHT.busHeight+20*(alt-SIGHT.busHeight)/ground>30,'over the near roof edge');
});

test('a building beside the road, off the sight line, or beyond the camera, constrains nothing',()=>{
 const beside={rings:box(6,-10,25,-40),height:40};
 const beyond={rings:box(-10,-90,10,-110),height:60};
 const ahead={rings:box(-10,10,10,30),height:60};
 const s=sightline({bus:BUS,camera:camera(60),pitch:60,footprints:[beside,beyond,ahead]});
 assert.equal(s.cap,null);
 assert.equal(s.inside,false);
});

test('a low wall behind the bus leaves the pitch where it is',()=>{
 const wall={rings:box(-10,-5,10,-6),height:2.5};
 const s=sightline({bus:BUS,camera:camera(60),pitch:60,footprints:[wall]});
 assert.ok(s.cap===null||s.cap>=60,`cap ${s.cap}`);
 assert.deepEqual(s.blocking,[]);
});

test('the camera standing inside a building behind the bus is taken out of it',()=>{
 // Victoria, 29 September: the camera 49 m behind the bus was inside the 30 m station.
 const station={rings:box(-40,-40,40,-120),height:30};
 const s=sightline({bus:BUS,camera:camera(60),pitch:60,footprints:[station]});
 assert.ok(s.cap!==null&&s.cap<60);
});

test('a bus inside a footprint cannot be seen at any pitch, and says so',()=>{
 // A covered bus station, or a bus drawn where its reports put it, inside a block.
 const roof={rings:box(-20,-20,20,20),height:12};
 const s=sightline({bus:BUS,camera:camera(60),pitch:60,footprints:[roof]});
 assert.equal(s.inside,true);
 // A merged footprint with the bus in its hole (a courtyard) is not inside.
 const courtyard={rings:[...box(-30,-30,30,30),...box(-10,-10,10,10)],height:20};
 assert.equal(sightline({bus:BUS,camera:camera(60),pitch:60,footprints:[courtyard]}).inside,false);
});

test('the sides of the bus must clear too',()=>{
 // A building whose corner crosses only the line to the bus's left side.
 const corner={rings:box(-12,-15,-1,-30),height:30};
 const s=sightline({bus:BUS,camera:camera(60),pitch:60,footprints:[corner]});
 assert.ok(s.cap!==null&&s.cap<60);
});

test('a bus standing with its rear against a low building is seen by its front half: the camera hardly moves',()=>{
 // Stretford Mall (the browser fixture's stop A): a 5 m building whose face is 1.8 m behind the bus's centre.
 // Aimed at the bus's middle, this sent the camera to 24 degrees.
 const shop={rings:box(-20,-1.8,20,-30),height:5};
 const s=sightline({bus:BUS,camera:camera(60),pitch:60,footprints:[shop]});
 assert.ok(s.cap===null||s.cap>=50,`cap ${s.cap}`);
 assert.equal(s.inside,false);
});

test('without a heading the bus is aimed at its centre',()=>{
 const building={rings:box(-15,-20,15,-35),height:30};
 const centred=sightline({bus:{...BUS,heading:null},camera:camera(60),pitch:60,footprints:[building]});
 const ahead=sightline({bus:BUS,camera:camera(60),pitch:60,footprints:[building]});
 assert.ok(centred.cap<ahead.cap,`the centre asks for more: ${centred.cap.toFixed(1)} against ${ahead.cap.toFixed(1)}`);
});

test('a bridge over the road is neither around the bus nor in the way of a sight line passing beneath it',()=>{
 // Its deck at 12-16 m: the line from the camera crosses its rear edge 13 m back at about 8.6 m, beneath it.
 // (A deck at 7-14 m would be crossed, and would rightly lift the camera over it.)
 const bridge={rings:box(-20,-10,20,10),height:16,base:12};
 const s=sightline({bus:BUS,camera:camera(60),pitch:60,footprints:[bridge]});
 assert.equal(s.inside,false,'the bus is under it, not inside it');
 assert.ok(s.cap===null||s.cap>=60,`cap ${s.cap}`);
 // A building reaching down to the street around the bus is still inside.
 assert.equal(sightline({bus:BUS,camera:camera(60),pitch:60,footprints:[{...bridge,base:0}]}).inside,true);
 const low=sightline({bus:BUS,camera:camera(60),pitch:60,footprints:[{...bridge,height:14,base:7}]});
 assert.ok(low.cap!==null&&low.cap<60&&!low.inside,'a lower deck in the line is climbed over, and is still not around the bus');
});
