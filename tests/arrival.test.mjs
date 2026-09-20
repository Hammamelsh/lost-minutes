// Estimated minutes on the device: the blended candidate as evaluated, and every reason it withholds.
import test from 'node:test';
import assert from 'node:assert/strict';
import {makeTrack} from '../lib/motion.ts';
import {ARRIVAL_PARAMS,arrivalEstimate,arrivalWords,observedSpeed,placeReports,scheduledSecondsAt} from '../lib/arrival.ts';

// A straight road east from Stretford, a vertex every 20 m; stops every 500 m; timetable 8 m/s + 10 s a stop.
const ORIGIN={lat:53.4487,lon:-2.3095}, M_LON=111320*Math.cos(ORIGIN.lat*Math.PI/180);
const east=m=>[ORIGIN.lon+m/M_LON,ORIGIN.lat];
const TRACK=makeTrack('P',Array.from({length:161},(_,i)=>east(i*20)),[0,500,1000,1500,2000,2500,3000]);   // 3,200 m: the last stop sits inside the road, not on its floating-point end
const TIMING=[0,72,144,216,288,360,432];
const T0=1_800_000_000_000;
const reports=(offsets,step=20_000)=>offsets.map((m,i)=>({at:T0+i*step,...(([lon,lat])=>({lat,lon}))(east(m))}));
const RELEASED={released:['inbound'],directions:{inbound:{released:true,p80Abs:2.06}}};
const base={track:TRACK,patternId:'P',timing:TIMING,stopIndex:5,direction:'inbound',release:RELEASED};

test('the timetable’s seconds at an offset interpolate between the bracketing stops',()=>{
 assert.equal(scheduledSecondsAt(TRACK,TIMING,0),0);
 assert.equal(scheduledSecondsAt(TRACK,TIMING,250),36);
 assert.equal(scheduledSecondsAt(TRACK,TIMING,1000),144);
 assert.equal(scheduledSecondsAt(TRACK,TIMING,3200),432,'past the last stop: its seconds');
 assert.equal(scheduledSecondsAt(TRACK,[null,null],0),null);
});

test('speed is read from the reports since the latest jump, and refused when there is too little',()=>{
 const placed=placeReports(TRACK,reports([0,160,320,480,640]));
 assert.equal(placed.length,5);
 assert.ok(Math.abs(observedSpeed(placed,4,ARRIVAL_PARAMS.windowS)-8)<0.05,'8 m/s over four 20 s steps');
 assert.equal(observedSpeed(placed,0,ARRIVAL_PARAMS.windowS),null,'no earlier report');
 const jumped=placeReports(TRACK,reports([0,160,1200,1360,1520]));
 const v=observedSpeed(jumped,4,ARRIVAL_PARAMS.windowS);
 assert.ok(Math.abs(v-8)<0.05,`read only after the jump, got ${v}`);
});

test('far from the stop the estimate is the timetable’s remaining seconds; near it, observed pace takes over',()=>{
 // At 300 m, 8 m/s: scheduled remaining to stop 5 (2500 m) is 360-43.2 s = 316.8 s; remaining 2200 m > near, so scheduled.
 const far=arrivalEstimate({...base,reports:reports([0,80,160,240,300]),nowMs:T0+4*20_000+5000});
 assert.equal(far.kind,'estimate');
 assert.ok(Math.abs(far.minutes-(316.8-5)/60)<0.02,`scheduled remaining, got ${far.minutes.toFixed(2)} min`);
 assert.equal(far.remainingM,2200);
 // At 2000 m and standing (five reports at the same place: 0 m/s, below standingBelow, so the
 // pattern's cruise fallback of 7 m/s applies), 500 m left: half scheduled, half progress.
 // A bus that had crept 100 m in 80 s would read 1.25 m/s and NOT be standing; that is by design.
 // 2,050 m, not 2,000: a bus standing a hair short of a stop still has that stop ahead and dwells
 // there, in the port as in the Python, so the fixture stands clear of the boundary.
 const nearStanding=arrivalEstimate({...base,reports:reports([2050,2050,2050,2050,2050]),nowMs:T0+4*20_000+5000});
 assert.equal(nearStanding.kind,'estimate');
 const schedRemain=360-scheduledSecondsAt(TRACK,TIMING,2050);            // 64.8 s
 const progRemain=450/7+0*ARRIVAL_PARAMS.dwellS;                       // 64.3 s at the fallback cruise, no stop between
 const w=450/ARRIVAL_PARAMS.nearM;
 const expect=(w*(T0+80_000+schedRemain*1000)+(1-w)*(T0+80_000+progRemain*1000)-(T0+85_000))/60000;
 assert.ok(Math.abs(nearStanding.minutes-expect)<0.02,`blended, got ${nearStanding.minutes.toFixed(2)} vs ${expect.toFixed(2)}`);
});

test('every withdrawal rule refuses with its reason, and nothing is shown for an unreleased direction',()=>{
 const good=reports([0,160,320,480,640]), now=T0+4*20_000+5000;
 assert.match(arrivalEstimate({...base,reports:good,nowMs:now,release:null}).reason,/not yet released/);
 assert.match(arrivalEstimate({...base,reports:good,nowMs:now,release:{released:['outbound']}}).reason,/not yet released/);
 assert.match(arrivalEstimate({...base,reports:good,nowMs:now+200_000}).reason,/too old/);
 assert.match(arrivalEstimate({...base,reports:reports([2400,2600,2700]),nowMs:T0+45_000}).reason,/at or past your stop/);
 assert.match(arrivalEstimate({...base,reports:good.slice(0,1),nowMs:now}).reason,/too few reports/);
 assert.match(arrivalEstimate({...base,reports:good,nowMs:now,timing:[0,null,null,null,null,null,null]}).reason,/running times/);
 const far=reports([0,160,320]).map(r=>({...r,lat:r.lat+0.003}));   // 330 m off the road
 assert.match(arrivalEstimate({...base,reports:far,nowMs:T0+45_000}).reason,/too few reports/);
});

test('the words are a point inside two minutes of p80 and a range beyond it',()=>{
 const e={kind:'estimate',atMs:0,minutes:6.2,lowMinutes:4.14,highMinutes:8.26,method:'blended',reportAgeS:12,remainingM:1800};
 assert.equal(arrivalWords(e),'4–8 min','p80 of 2.06 is a range');
 assert.equal(arrivalWords({...e,lowMinutes:4.7,highMinutes:7.7}),'about 6 min');
 assert.equal(arrivalWords({...e,minutes:0.3,lowMinutes:0,highMinutes:1.8}),'about 1 min','never zero');
});
