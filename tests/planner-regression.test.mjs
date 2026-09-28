// A regression set for the journey planners, one case per fault found on 28 September 2026, each
// checked against an answer worked out independently of the planner: a brute-force oracle reads the
// fixture's journeys as written (stops and times, and the days each runs) and finds the earliest
// arrival by trying every reachable pair of stops. The planner reads the same journeys only as the
// app does, as a catalogue of patterns and per-stop departure boards. Where the oracle and the
// planner agree, it is not because one was copied from the other.
//
//   1. a direct public service against a school service (and a closed one), on a school day, later
//      the same morning, and in half-term;
//   2. a variant of a line carrying the only departures between two stops, and a variant that
//      boards at a stop the line's usual pattern does not call at;
//   3. a useful stop beyond the old nearest-14 cutoff;
//   4. a bus leaving before the passenger can walk to the stop;
//   5. a connection its checked transfer walk invalidates (and one a shorter walk does not);
//   6. a connection that is the one with buses, further by distance than the first eight.
import test from 'node:test';
import assert from 'node:assert/strict';
import {PLAN_RULES,directArrival,directOptions,rankDirect,timeDirect} from '../lib/plan.ts';
import {CONNECTION_RULES,TIGHT_SECONDS,chosenFrom,chosenStatus,connectionOptions,estimatedWalk,familyQuality,rankConnections,timeConnection,transferWalk} from '../lib/connections.ts';
import {londonInstant} from '../lib/departures.ts';

// ------------------------------------------------------------------ a small world, in metres

const LAT0=53.44,LON0=-2.30,M_LAT=1/111195,M_LON=1/(111195*Math.cos(LAT0*Math.PI/180));
const place=(east,north)=>({lat:LAT0+north*M_LAT,lon:LON0+east*M_LON});
const stop=(id,east,north,name=id)=>({id,name,indicator:null,...place(east,north)});
const metresBetween=(a,b)=>{const dy=(a.lat-b.lat)/M_LAT,dx=(a.lon-b.lon)/M_LON;return Math.hypot(dx,dy)};

const ORIGIN=place(0,0),DESTINATION=place(3000,0);
// The 23 leaves from a stop 418 m away and swings south; the school 734 leaves from a stop 120 m
// away and runs straight. By walking and riding distance alone (the list's order before
// 28 September) the 734 comes first; by when each gets there, it depends on the hour.
const S={
 A:stop('A000',418,0,'Norwood Road'),A0:stop('A00W',560,-150,'Norwood Road West'),A1:stop('A001',1100,-800),A2:stop('A002',1900,-800),A3:stop('A003',2500,-400),
 X:stop('X000',2800,-150,'Mersey Road'),X2:stop('X002',3600,-150),C:stop('C000',300,500,'Cavendish Road'),
 B:stop('B000',0,120,'Hillingdon Road'),B1:stop('B001',1000,120),B2:stop('B002',2000,120),
 Y:stop('Y000',2950,120,'Nell Lane'),Y2:stop('Y002',3000,60,'School gates'),
 F:stop('F000',-2500,0),F1:stop('F001',-2600,0),F2:stop('F002',-2700,0),F3:stop('F003',-2800,0),
};
// Twenty stops between 50 and 300 m of the start, on a line that goes nowhere useful: before
// 28 September the planners looked at the fourteen nearest stops only, and would stop at these.
const CLUTTER=Array.from({length:20},(_,k)=>stop(`Z0${String(k).padStart(2,'0')}`,Math.cos(k)*(50+k*12),Math.sin(k)*(50+k*12)));
const STOPS=[...Object.values(S),...CLUTTER];

const MONDAY='2026-09-28',HALF_TERM_MONDAY='2026-10-26';
const TERM=[['2026-09-01','2026-10-23']];
const weekdayIndex=iso=>(new Date(`${iso}T12:00:00Z`).getUTCDay()+6)%7;
const hms=(h,m)=>h*3600+m*60;
const at=(day,h,m)=>londonInstant(day,hms(h,m));
const wall=ms=>new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',hour:'2-digit',minute:'2-digit',hour12:false}).format(ms);

/**
 * The world's journeys, written once: each line's stops, minutes from the first stop to each, its
 * origin departures, the days it runs (as the oracle judges them, and as operating rules for the
 * planner), and whether it is open to the public.
 */
const LINES=[
 {id:'BNSM:23:inbound:main',line:'23',to:'Stockport',stops:['A','A1','A2','A3','X','X2'],minutes:[0,4,8,12,15,19],
  departures:Array.from({length:40},(_,k)=>hms(6,5)+k*15*60),days:[0,1,2,3,4,5,6],publicUse:true},
 // A variant of the 23 between the same two stops: in case 2 it holds the only departures.
 {id:'BNSM:23:inbound:short',line:'23',to:'Mersey Road',stops:['A','A1','A2','X'],minutes:[0,4,8,14],
  departures:[],days:[0,1,2,3,4,5,6],publicUse:true},
 // A school service open to anyone, on school days in term only, from a stop nearer the start.
 {id:'BNML:734:outbound:sch',line:'734',to:'Loreto Grammar School',stops:['B','B1','B2','Y'],minutes:[0,5,10,13],
  departures:[hms(7,27)],days:[0,1,2,3,4],term:TERM,publicUse:true},
 // A scholars' bus closed to the public, frequent and fast: never to be offered.
 {id:'BNML:732:outbound:closed',line:'732',to:'School gates',stops:['B','B1','Y2'],minutes:[0,4,9],
  departures:Array.from({length:12},(_,k)=>hms(7,0)+k*10*60),days:[0,1,2,3,4],publicUse:false},
 {id:'BNML:Q:outbound:clutter',line:'Q',to:'Far End',stops:[...CLUTTER.map(s=>s.id),'F','F1','F2','F3'],
  minutes:Array.from({length:24},(_,k)=>k),departures:[hms(7,0)],days:[0,1,2,3,4,5,6],publicUse:true},
];
const idOf=key=>S[key]?.id??key;

// ------------------------------------------------------------------ the oracle, from the journeys

const runsOn=(line,day)=>line.days.includes(weekdayIndex(day))&&(!line.term||line.term.some(([a,b])=>a<=day&&day<=b));
const walkSeconds=metres=>metres*CONNECTION_RULES.transferDetour/CONNECTION_RULES.walkMetresPerMinute*60;

/** The earliest arrival at the destination by one bus, trying every stop pair within the walk; of
 *  two that arrive together, the one the passenger sets off for later (the same bus from a nearer
 *  stop, or a later bus as soon there). */
function oracleDirect(from,to,day,nowMs,lines=LINES){
 let best=null;
 for(const line of lines){
  if(!line.publicUse||!runsOn(line,day))continue;
  const stops=line.stops.map(idOf).map(id=>STOPS.find(s=>s.id===id));
  for(let i=0;i<stops.length-1;i++){
   const walkTo=metresBetween(from,stops[i]);if(walkTo>PLAN_RULES.maxWalkMetres)continue;
   const ready=walkSeconds(walkTo)<60?nowMs-60_000:nowMs+Math.round(walkSeconds(walkTo))*1000;
   for(let j=i+1;j<stops.length;j++){
    const walkFrom=metresBetween(to,stops[j]);if(walkFrom>PLAN_RULES.maxWalkMetres)continue;
    for(const origin of line.departures){
     const leave=londonInstant(day,origin+line.minutes[i]*60);
     if(leave<ready||leave>nowMs+180*60_000)continue;
     const arrive=londonInstant(day,origin+line.minutes[j]*60)+walkSeconds(walkFrom)*1000;
     const setOff=leave-walkSeconds(walkTo)*1000;
     if(!best||arrive<best.arrive||(arrive===best.arrive&&setOff>best.setOff))
      best={line:line.line,board:stops[i].id,alight:stops[j].id,leave,arrive,setOff};
    }
   }
  }
 }
 return best;
}

// ------------------------------------------------------------------ the same journeys, as the app reads them

const rules=[{days:[0,1,2,3,4,5,6]},{days:[0,1,2,3,4]},
 {days:[0,1,2,3,4],serviced:[{mode:'only',kind:'WorkingDays',organisations:['SCH'],ranges:TERM}]}];
const ruleOf=line=>line.term?2:line.days.length===7?0:1;
function catalogueOf(lines){
 const patterns=lines.map(line=>{
  const stops=line.stops.map(idOf).map(id=>STOPS.find(s=>s.id===id));
  const metres=[0];for(let k=1;k<stops.length;k++)metres.push(Math.round(metres[k-1]+metresBetween(stops[k-1],stops[k])));
  const seconds=line.minutes.map(m=>m*60);
  return {id:line.id,operator:line.id.split(':')[0],line:line.line,serviceCode:line.line,direction:line.id.split(':')[2],destination:line.to,
   stopCount:stops.length,stopsInArea:stops.length,lengthMetres:metres.at(-1),distancesKnown:true,hasRepeatedStop:false,
   timetable:{datasetSha256:'f',file:`${line.line}.xml`,validFrom:'2026-01-01',validTo:'2031-12-31',modified:null,revision:null},
   operatingRules:[rules[ruleOf(line)]],journeys:line.departures.length,stops:stops.map(s=>s.id),metres,seconds,timings:[seconds],
   publicUse:line.publicUse};
 });
 return {schemaVersion:2,generatedAt:'x',supportedLines:[...new Set(lines.map(l=>l.line))],patterns,rules:{minimumStops:3},attribution:'test',notes:[]};
}
/** A stop's board: each line calling there (not at its last stop), its origin departures and offset. */
function boardOf(stopId,lines){
 const services=[];
 for(const line of lines){
  const index=line.stops.map(idOf).indexOf(stopId);
  if(index<0||index===line.stops.length-1||!line.departures.length)continue;
  const sorted=[...line.departures].sort((a,b)=>a-b);
  const run=[0,0,sorted[0]];for(let k=1;k<sorted.length;k++)run.push(sorted[k]-sorted[k-1]);
  services.push({patternId:line.id,operator:line.id.split(':')[0],line:line.line,direction:line.id.split(':')[2],destination:line.to,
   sequence:index,rules:[ruleOf(line)],offsets:[line.minutes[index]*60],runs:[run],...(line.publicUse?{}:{publicUse:false})});
 }
 return {stop:stopId,generatedAt:'x',services};
}
const unverified={kind:'unverified',words:'unchecked',offsetMinutes:null};

/** What the list would lead with: the direct candidates, timed from their boards, ranked. */
function planDirect(from,to,day,nowMs,lines=LINES){
 const candidates=directOptions(from,to,catalogueOf(lines),STOPS,day);
 const timingOf=option=>timeDirect(option,{board:boardOf(option.board.id,lines),rules,nowMs,quality:familyQuality(option.leg,{patterns:{}})});
 const ranked=rankDirect(candidates,timingOf);
 return {candidates,ranked,timingOf};
}

// ------------------------------------------------------------------ 1. public against school, and closed

test('1. a public service that gets there sooner outranks a school service from a nearer stop, and the closed one is never offered', () => {
 const now=at(MONDAY,7,0);
 const {candidates,ranked,timingOf}=planDirect(ORIGIN,DESTINATION,MONDAY,now);
 const expected=oracleDirect(ORIGIN,DESTINATION,MONDAY,now);
 // Worked out by hand as well: Norwood Road is 418 m away, 6.8 min on foot estimated, so the 07:05
 // 23 is gone and the 07:20 is the one, at Mersey Road 07:35 and 4.1 min on foot (250 m) to the
 // destination: 07:39. The 07:27 734 reaches Nell Lane at 07:40 with 2.1 min (130 m) on: 07:42.
 assert.equal(wall(expected.leave),'07:20'); assert.equal(expected.line,'23');
 assert.ok(!candidates.some(o=>[o.leg.pattern,...o.leg.also.map(l=>l.pattern)].some(p=>p.publicUse===false)),'the 732 is in no option');
 assert.equal(ranked[0].line,'23','soonest there first, not nearest stop first');
 const next=timingOf(ranked[0]);
 assert.equal(next.rows[0].departMs,expected.leave);
 assert.equal(Math.round(directArrival(next).arrive/1000),Math.round(expected.arrive/1000));
 assert.ok(ranked.some(o=>o.line==='734'),'the school service is kept, below');
 // By score alone (the list's order before 28 September), the 734's nearer stop put it first.
 assert.equal(candidates[0].line,'734');
});

test('1b. later the same school-day morning the school service is the sooner, and is offered first', () => {
 const now=at(MONDAY,7,15);
 const expected=oracleDirect(ORIGIN,DESTINATION,MONDAY,now);
 assert.equal(expected.line,'734','by hand: the 07:35 23 is at the destination at 07:54, the 07:27 734 at 07:42');
 const {ranked,timingOf}=planDirect(ORIGIN,DESTINATION,MONDAY,now);
 assert.equal(ranked[0].line,'734');
 assert.equal(timingOf(ranked[0]).rows[0].departMs,expected.leave);
});

test('1c. in half-term the school service does not run, by its own calendar, and is not what the list leads with', () => {
 const now=at(HALF_TERM_MONDAY,7,15);
 const expected=oracleDirect(ORIGIN,DESTINATION,HALF_TERM_MONDAY,now);
 assert.equal(expected.line,'23');
 const {ranked,timingOf}=planDirect(ORIGIN,DESTINATION,HALF_TERM_MONDAY,now);
 assert.equal(ranked[0].line,'23');
 assert.equal(timingOf(ranked[0]).rows[0].departMs,expected.leave);
 const school=ranked.find(o=>o.line==='734');
 if(school)assert.notEqual(timingOf(school).kind==='timed'&&!timingOf(school).later?'today':'not today','today','no 734 today');
});

// ------------------------------------------------------------------ 2. variants

test('2. a variant of a line carrying the only departures between two stops is timed, not "no service"', () => {
 const main={...LINES[0],departures:[]};
 const short={...LINES[1],departures:Array.from({length:10},(_,k)=>hms(7,10)+k*20*60)};
 const lines=[main,short,...LINES.slice(2)];
 const now=at(MONDAY,7,0);
 const expected=oracleDirect(ORIGIN,DESTINATION,MONDAY,now,lines);
 assert.equal(expected.line,'23'); assert.equal(wall(expected.leave),'07:10');
 const {ranked,timingOf}=planDirect(ORIGIN,DESTINATION,MONDAY,now,lines);
 const option=ranked.find(o=>o.line==='23');
 assert.ok(option,'the 23 is offered');
 assert.equal(timingOf(option).rows[0].departMs,expected.leave);
 assert.equal(timingOf(option).rows[0].departure.patternId,'BNSM:23:inbound:short');
});

test('2b. a variant that boards at another stop is timed on its own, not lost to its line’s usual stop', () => {
 // The 23's usual pattern has no departures before 08:05; a variant to the same destination starts at
 // Cavendish Road, 583 m away, which the usual pattern does not call at, and leaves at 07:12.
 const main={...LINES[0],departures:Array.from({length:8},(_,k)=>hms(8,5)+k*15*60)};
 const via={id:'BNSM:23:inbound:via-c',line:'23',to:'Stockport',stops:['C','A2','A3','X','X2'],minutes:[0,6,10,13,17],
  departures:[hms(7,12)],days:[0,1,2,3,4,5,6],publicUse:true};
 const lines=[main,via,...LINES.slice(2)];
 const now=at(MONDAY,7,0);
 const expected=oracleDirect(ORIGIN,DESTINATION,MONDAY,now,lines);
 // By hand: Cavendish Road is 9.5 min on foot (583 m, estimated), so the 07:12 is reached, at Mersey
 // Road 07:25 and at the destination about 07:29; the usual 23 cannot be there before 08:24.
 assert.equal(expected.board,S.C.id); assert.equal(wall(expected.leave),'07:12');
 const {candidates,ranked,timingOf}=planDirect(ORIGIN,DESTINATION,MONDAY,now,lines);
 const usual=candidates.find(o=>o.pattern.id===main.id),other=candidates.find(o=>o.pattern.id===via.id);
 assert.ok(usual&&other,'both 23s are candidates');
 assert.ok(usual.score<other.score&&!other.leg.also.some(l=>l.pattern.id===main.id),
  'the case is a real one: by distance the usual stop is the better, and it is not the variant’s');
 assert.equal(ranked[0].pattern.id,via.id,'the one that gets there first leads');
 const timing=timingOf(ranked[0]);
 assert.equal(timing.rows[0].departMs,expected.leave);
 assert.equal(Math.round(directArrival(timing).arrive/1000),Math.round(expected.arrive/1000));
});

test('2c. the same bus from two stops is one choice, and the one set off for later is kept', () => {
 // The 23 calls at Norwood Road and a minute later at Norwood Road West, 170 m from the start; a
 // variant to the same place starts at Norwood Road West and has no journeys this morning. Its option
 // there can only offer the 23's own buses, a minute later and after a longer walk.
 const main={...LINES[0],id:'BNSM:23:inbound:main',stops:['A','A0','A1','A2','A3','X','X2'],minutes:[0,1,4,8,12,15,19]};
 const west={id:'BNSM:23:inbound:west',line:'23',to:'Stockport',stops:['A0','A1','A2','A3','X','X2'],minutes:[0,3,7,11,14,18],
  departures:[hms(18,0)],days:[0,1,2,3,4,5,6],publicUse:true};
 const lines=[main,west,...LINES.slice(2)];
 const from=place(418,-60),now=at(MONDAY,7,0);
 const expected=oracleDirect(from,DESTINATION,MONDAY,now,lines);
 // By hand: Norwood Road is 60 m away (under a minute on foot), so the 07:05 is caught there; from
 // Norwood Road West (170 m, 2.8 min) the same bus at 07:06 means setting off 45 s sooner.
 assert.equal(expected.board,S.A.id); assert.equal(wall(expected.leave),'07:05');
 const {candidates,ranked,timingOf}=planDirect(from,DESTINATION,MONDAY,now,lines);
 assert.ok(candidates.some(o=>o.board.id===S.A0.id),'the case is a real one: the stop along is a candidate');
 const next=o=>{const t=timingOf(o);return t.kind==='timed'?t.rows[0]:null};
 assert.equal(ranked[0].board.id,S.A.id);
 assert.equal(next(ranked[0]).departMs,expected.leave);
 const buses=ranked.map(next).filter(Boolean).map(r=>`${r.departure.patternId}|${r.departure.originLocal}|${r.departure.serviceDay}`);
 assert.equal(new Set(buses).size,buses.length,'no bus is offered twice');
 assert.ok(!ranked.some(o=>o.board.id===S.A0.id&&next(o)?.departure.patternId===main.id&&next(o)?.departure.originLocal==='07:05:00'),
  'the same 07:05 is not offered again from the stop along');
});

// ------------------------------------------------------------------ 3. beyond the nearest fourteen

test('3. a stop beyond the fourteen nearest is found, as the walk the page states allows', () => {
 const nearest=STOPS.map(s=>({s,m:metresBetween(ORIGIN,s)})).sort((a,b)=>a.m-b.m);
 const rank=nearest.findIndex(x=>x.s.id===S.A.id);
 assert.ok(rank>=14,`Norwood Road is the ${rank+1}th nearest stop`);
 const now=at(MONDAY,7,0);
 assert.ok(planDirect(ORIGIN,DESTINATION,MONDAY,now).candidates.some(o=>o.board.id===S.A.id));
 const saved=PLAN_RULES.candidateStops;
 try{
  PLAN_RULES.candidateStops=14;
  assert.ok(!planDirect(ORIGIN,DESTINATION,MONDAY,now).candidates.some(o=>o.board.id===S.A.id),'the old cutoff misses it: the case is a real one');
 }finally{PLAN_RULES.candidateStops=saved}
});

// ------------------------------------------------------------------ 4. the walk to the first stop

test('4. a bus leaving before the passenger can walk to the stop is not offered as the next one', () => {
 const now=at(MONDAY,7,1);          // the 07:05 23 leaves in 4 min; Norwood Road is 6.8 min away
 const {ranked,timingOf}=planDirect(ORIGIN,DESTINATION,MONDAY,now);
 const option=ranked.find(o=>o.line==='23');
 const timing=timingOf(option);
 assert.equal(timing.access.basis,'straight','the walk to the stop is an estimate, and says so');
 assert.ok(Math.abs(timing.access.seconds-walkSeconds(418))<1);
 assert.equal(wall(timing.rows[0].departMs),'07:20');
 assert.ok(!timing.rows.some(r=>wall(r.departMs)==='07:05'));
 assert.ok(timing.rows[0].spareSeconds>=TIGHT_SECONDS,'with 12 min to spare it is not tight');
 // At 07:12:30 the walk (6 min 48 s, estimated) is done at 07:19:18: the 07:20 is offered, and with 42 s
 // to spare on an estimated walk it is said to be tight, not presented as comfortably ready.
 const {ranked:late,timingOf:t3}=planDirect(ORIGIN,DESTINATION,MONDAY,now+11.5*60_000);
 const lateRow=t3(late.find(o=>o.line==='23')).rows[0];
 assert.equal(wall(lateRow.departMs),'07:20');
 assert.equal(lateRow.spareSeconds,42);
 // From beside the stop, the same bus is there to take.
 const {ranked:atStop,timingOf:t2}=planDirect(place(418,20),DESTINATION,MONDAY,now);
 assert.equal(wall(t2(atStop.find(o=>o.line==='23')).rows[0].departMs),'07:05');
});

// ------------------------------------------------------------------ 5. a transfer walk, checked

test('5. a connection its checked transfer walk invalidates is said to be, and a replacement is offered, not put in its place', () => {
 // The 9 north to a crossing, a 100 m change, the 7 east. From beside the 9's stop.
 const LAT=53.45,ML=1/111195,MO=1/(111195*Math.cos(LAT*Math.PI/180));
 const nine=Array.from({length:6},(_,i)=>({id:`N00${i}`,name:`Nine ${i}`,indicator:null,lat:LAT+i*300*ML,lon:-2.3}));
 const seven=Array.from({length:6},(_,j)=>({id:`E00${j}`,name:`Seven ${j}`,indicator:null,lat:LAT+4*300*ML,lon:-2.3+(j*300+80)*MO}));
 const stops=[...nine,...seven];
 const pattern=(id,line,list,to)=>({id,operator:'BNML',line,serviceCode:line,direction:'out',destination:to,stopCount:list.length,stopsInArea:list.length,
  lengthMetres:1500,distancesKnown:true,hasRepeatedStop:false,timetable:{datasetSha256:'f',file:'x',validFrom:'2026-01-01',validTo:'2031-12-31',modified:null,revision:null},
  operatingRules:[{days:[0,1,2,3,4,5,6]}],journeys:10,stops:list.map(s=>s.id),metres:list.map((_,k)=>k*300),seconds:list.map((_,k)=>k*60),timings:[list.map((_,k)=>k*60)],publicUse:true});
 const catalogue={schemaVersion:2,generatedAt:'x',supportedLines:['9','7'],patterns:[pattern('BNML:9:out:a','9',nine,'North'),pattern('BNML:7:out:b','7',seven,'East')],rules:{minimumStops:3},attribution:'t',notes:[]};
 const board=(stop,p,offset,origins)=>{const run=[0,0,origins[0]];for(let k=1;k<origins.length;k++)run.push(origins[k]-origins[k-1]);
  return {stop,generatedAt:'x',services:[{patternId:p.id,operator:'BNML',line:p.line,direction:'out',destination:p.destination,sequence:1,rules:[0],offsets:[offset],runs:[run]}]}};
 const [o]=connectionOptions({lat:nine[1].lat+0.0002,lon:nine[1].lon+0.0003},{lat:seven[4].lat+0.0002,lon:seven[4].lon+0.0003},catalogue,stops,MONDAY);
 assert.equal(o.first.line,'9'); assert.equal(o.second.line,'7');
 const boards={first:board(o.first.board.id,catalogue.patterns[0],60,[hms(10,5),hms(10,25)]),
  second:board(o.second.board.id,catalogue.patterns[1],60,[hms(10,10),hms(10,11),hms(10,14),hms(10,40),hms(10,59)])};
 const now=at(MONDAY,10,0),quality={first:unverified,second:unverified};
 const provisional=timeConnection(o,{boards,rules:[{days:[0,1,2,3,4,5,6]}],nowMs:now,walk:transferWalk(o.transfer,null),allowanceSeconds:120,quality});
 // By hand: the 10:06 9 is at the crossing 10:09; the estimated walk (80 m straight, 78 s) and
 // 2 min to change make 10:12:18, so the 10:12 7 is just missed and the 10:15 is the one.
 const listed=provisional.rows[0];
 assert.equal(`${wall(listed.first.departMs)} ${wall(listed.second.departMs)}`,'10:06 10:15');
 const chosen=chosenFrom(listed);
 assert.equal(chosenStatus(provisional,chosen).kind,'held');
 // The router finds 12 minutes: ready 10:23, so the 10:15 cannot be made; the 10:41 can.
 const checked=timeConnection(o,{boards,rules:[{days:[0,1,2,3,4,5,6]}],nowMs:now,walk:transferWalk(o.transfer,{metres:900,seconds:720}),allowanceSeconds:120,quality});
 const status=chosenStatus(checked,chosen);
 assert.equal(status.kind,'changed'); assert.equal(status.why,'missed');
 assert.equal(`${wall(status.offer.first.departMs)} ${wall(status.offer.second.departMs)}`,'10:06 10:41','the same first bus, and the second bus it now makes');
 // Accepting it is the passenger's act: the offer becomes the choice, and holds.
 assert.equal(chosenStatus(checked,chosenFrom(status.offer)).kind,'held');
 // A walk checked shorter than its estimate (20 s) makes the 10:12 reachable too: the passenger's
 // 10:15 is still theirs, not "missed" because an earlier one now exists.
 const shorter=timeConnection(o,{boards,rules:[{days:[0,1,2,3,4,5,6]}],nowMs:now,walk:transferWalk(o.transfer,{metres:30,seconds:20}),allowanceSeconds:120,quality});
 assert.equal(wall(shorter.rows[0].second.departMs),'10:12','the case is a real one: the soonest is now earlier');
 const kept=chosenStatus(shorter,chosen);
 assert.equal(kept.kind,'held');
 assert.equal(`${wall(kept.row.first.departMs)} ${wall(kept.row.second.departMs)}`,'10:06 10:15');
 assert.equal(kept.row.changeSeconds,6*60,'from 10:09 at the crossing to the 10:15');
 // And once the chosen first bus has gone, it cannot be caught at all: said, and the next offered.
 // (At 10:07 it is still there for someone at the stop: a bus due in the last minute is shown, as the
 // stop's board shows it. At 10:08 it is not.)
 const later=timeConnection(o,{boards,rules:[{days:[0,1,2,3,4,5,6]}],nowMs:at(MONDAY,10,8),walk:transferWalk(o.transfer,{metres:900,seconds:720}),allowanceSeconds:120,quality});
 const gone=chosenStatus(later,chosenFrom(status.offer));
 assert.equal(gone.kind,'changed'); assert.equal(gone.why,'unreachable');
 // By hand: the 10:26 9 is at the crossing 10:29; with the 12 min walk and 2 min, 10:43; the 11:00 7.
 assert.equal(`${wall(gone.offer.first.departMs)} ${wall(gone.offer.second.departMs)}`,'10:26 11:00');
 // With no second bus left in reach, nothing is offered rather than a first bus that leads nowhere.
 const lastBoards={...boards,second:board(o.second.board.id,catalogue.patterns[1],60,[hms(10,10),hms(10,14),hms(10,40)])};
 const stranded=timeConnection(o,{boards:lastBoards,rules:[{days:[0,1,2,3,4,5,6]}],nowMs:at(MONDAY,10,8),walk:transferWalk(o.transfer,{metres:900,seconds:720}),allowanceSeconds:120,quality});
 const none=chosenStatus(stranded,chosenFrom(status.offer));
 assert.equal(none.kind,'changed'); assert.equal(none.offer,null);
 assert.ok(estimatedWalk(100).seconds>60);
});

// ------------------------------------------------------------------ 6. the connections timed

test('6. a connection further by distance than the first eight is still timed, and leads when it is the one with buses', () => {
 // Twelve connections by short walks and short rides, none with a bus today, and one by long walks and
 // long rides that has them. Found in order of distance, the real one comes last: timing only the first
 // eight (the rule until 28 September) could never find it.
 const LAT=53.45,ML=1/111195,MO=1/(111195*Math.cos(LAT*Math.PI/180));
 const at2=(east,north)=>({lat:LAT+north*ML,lon:-2.3+east*MO});
 const stopAt=(id,east,north)=>({id,name:id,indicator:null,...at2(east,north)});
 const origin=at2(0,0),destination=at2(6000,0);
 const stops=[stopAt('DO',0,100),stopAt('DD',6000,100),stopAt('RO',0,-800),stopAt('RM',1500,-2000),stopAt('RT',3000,-2500),
  stopAt('RT2',3060,-2500),stopAt('RN',4500,-2000),stopAt('RD',6000,-700)];
 const angles=[25,50,75,100,125,150,210,235,260,285,310,335];
 angles.forEach((deg,k)=>{const x=3000+1000*Math.cos(deg*Math.PI/180),y=1000*Math.sin(deg*Math.PI/180);
  stops.push(stopAt(`M${k}`,x/2,y/2),stopAt(`T${k}`,x,y),stopAt(`U${k}`,x+60,y),stopAt(`N${k}`,(x+60+6000)/2,y/2))});
 const byId=new Map(stops.map(s=>[s.id,s]));
 const metresBetweenStops=(a,b)=>Math.hypot((a.lat-b.lat)/ML,(a.lon-b.lon)/MO);
 const pattern=(id,line,ids,to,minutes)=>{const list=ids.map(i=>byId.get(i));const metres=[0];
  for(let i=1;i<list.length;i++)metres.push(Math.round(metres[i-1]+metresBetweenStops(list[i-1],list[i])));
  const seconds=minutes.map(m=>m*60);
  return {id,operator:'BNML',line,serviceCode:line,direction:'out',destination:to,stopCount:list.length,stopsInArea:list.length,
   lengthMetres:metres.at(-1),distancesKnown:true,hasRepeatedStop:false,
   timetable:{datasetSha256:'f',file:'x',validFrom:'2026-01-01',validTo:'2031-12-31',modified:null,revision:null},
   operatingRules:[{days:[0,1,2,3,4,5,6]}],journeys:10,stops:ids,metres,seconds,timings:[seconds],publicUse:true}};
 const patterns=[pattern('BNML:R1:out','R1',['RO','RM','RT'],'Far Crossing',[0,6,12]),pattern('BNML:R2:out','R2',['RT2','RN','RD'],'Far End',[0,6,12])];
 angles.forEach((_,k)=>patterns.push(pattern(`BNML:F${k}:out`,`F${k}`,['DO',`M${k}`,`T${k}`],`Crossing ${k}`,[0,4,8]),
  pattern(`BNML:S${k}:out`,`S${k}`,[`U${k}`,`N${k}`,'DD'],`End ${k}`,[0,4,8])));
 const catalogue={schemaVersion:2,generatedAt:'x',supportedLines:patterns.map(p=>p.line),patterns,rules:{minimumStops:3},attribution:'t',notes:[]};
 const board=(stop,p,origins)=>{const run=[0,0,origins[0]];for(let k=1;k<origins.length;k++)run.push(origins[k]-origins[k-1]);
  return {stop,generatedAt:'x',services:[{patternId:p.id,operator:'BNML',line:p.line,direction:'out',destination:p.destination,sequence:0,
   rules:[0],offsets:[0],runs:[run]}]}};
 const empty=stop=>({stop,generatedAt:'x',services:[]});
 const boards={RO:board('RO',patterns[0],Array.from({length:12},(_,k)=>hms(7,0)+k*20*60)),
  RT2:board('RT2',patterns[1],Array.from({length:24},(_,k)=>hms(7,0)+k*10*60))};
 const found=connectionOptions(origin,destination,catalogue,stops,MONDAY);
 const real=found.findIndex(o=>o.first.line==='R1'&&o.second.line==='R2');
 // Twelve decoys, four crossings between them that the rules also allow (none with buses), then the real one.
 assert.equal(real,found.length-1,'the real one comes last by distance');
 assert.ok(real>=8,`the real one is the ${real+1}th by distance`);
 assert.ok(!connectionOptions(origin,destination,catalogue,stops,MONDAY,{...CONNECTION_RULES,candidates:8})
  .some(o=>o.first.line==='R1'),'the old cut of eight leaves it untimed: the case is a real one');
 const now=at(MONDAY,7,5),quality={first:unverified,second:unverified};
 const timingOf=o=>timeConnection(o,{boards:{first:boards[o.first.board.id]??empty(o.first.board.id),second:boards[o.second.board.id]??empty(o.second.board.id)},
  rules:[{days:[0,1,2,3,4,5,6]}],nowMs:now,walk:transferWalk(o.transfer,null),allowanceSeconds:CONNECTION_RULES.allowanceSeconds,quality});
 const [lead]=rankConnections(found,timingOf);
 assert.equal(`${lead.first.line}>${lead.second.line}`,'R1>R2','the one with buses leads');
 // By hand: 800 m to its stop, 13 min on foot (estimated): ready 07:18, so the 07:20 R1, at the crossing
 // 07:32; 60 m (58.5 s) and 2 min to change: 07:34:59, so the 07:40 R2, at its last stop 07:52.
 const row=timingOf(lead).rows.find(r=>r.second);
 assert.equal(`${wall(row.first.departMs)} ${wall(row.second.departMs)} ${wall(row.second.arriveMs)}`,'07:20 07:40 07:52');
});
