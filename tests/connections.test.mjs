// A journey with one change: found from the timetable's stop orders, timed from the published boards,
// its walk provisional until routed, its timetable's quality carried with it, and its buses tied to
// journeys only where the operator's own reported departure names them.
import test from 'node:test';
import assert from 'node:assert/strict';
import {CONNECTION_RULES,atStopMs,busOnJourney,busesOnLeg,connectionFromKey,connectionOptions,connectionSentence,familyQuality,legFamily,legService,
 legStanding,lineNames,onwardFromChange,rankConnections,scheduleQuality,timeConnection,timetabledAtBoard,transferWalk,withoutUnreliable} from '../lib/connections.ts';
import {departuresOn,londonInstant} from '../lib/departures.ts';
import {isPlanKey,readPlanLink,withPlan} from '../lib/plan-link.ts';

// Line 9 runs north along one road, a stop every 300 m; line 7 runs east along a road that crosses
// it at the fifth stop. T1 on the 7 is about 100 m from S4 on the 9: a change on foot.
const LAT0=53.45,M_LAT=300/111195;
const S=Array.from({length:8},(_,i)=>({id:`S00${i}`,name:`Stop ${i}`,indicator:'nr',lat:LAT0+i*M_LAT,lon:-2.30}));
const crossLat=S[4].lat,M_LON=300/(111195*Math.cos(crossLat*Math.PI/180));
const T=Array.from({length:6},(_,j)=>({id:`T00${j}`,name:`Cross ${j}`,indicator:'opp',lat:crossLat,lon:-2.303+j*M_LON}));
const stops=[...S,...T];
const base={serviceCode:'X',runs:'Mon–Sun',journeys:20,stopsInArea:8,hasRepeatedStop:false,distancesKnown:true,
 operatingRules:[{days:[0,1,2,3,4,5,6]}],
 timetable:{datasetSha256:'f',file:'x.xml',validFrom:'2026-01-01',validTo:'2031-12-31',modified:'2026-01-01',revision:'1'}};
const seconds=n=>Array.from({length:n},(_,i)=>i*60);
const nine={...base,id:'BNML:9:inbound:aaaa',operator:'BNML',line:'9',direction:'inbound',destination:'North End',
 stops:S.map(s=>s.id),stopCount:8,metres:S.map((_,i)=>i*300),seconds:seconds(8),timings:[seconds(8)]};
const nineBack={...nine,id:'BNML:9:outbound:bbbb',direction:'outbound',destination:'South End',stops:[...S.map(s=>s.id)].reverse()};
const seven={...base,id:'BNSM:7:outbound:cccc',operator:'BNSM',line:'7',direction:'outbound',destination:'East End',
 stops:T.map(t=>t.id),stopCount:6,metres:T.map((_,j)=>j*300),seconds:seconds(6),timings:[seconds(6)]};
const catalogue={schemaVersion:2,generatedAt:'2026-09-28T00:00:00Z',supportedLines:['9','7'],patterns:[nine,nineBack,seven],
 rules:{minimumStops:5},attribution:'test',notes:[]};
const near=s=>({lat:s.lat+0.0002,lon:s.lon+0.0003});   // about 30 m from the stop
const MONDAY='2026-09-28';
const rules=[{days:[0,1,2,3,4,5,6]}];
/** A board for one pattern at one stop: origin departures in seconds from local midnight, one timing. */
const board=(stop,pattern,offset,origins)=>{
 const sorted=[...origins].sort((a,b)=>a-b);
 const run=[0,0,sorted[0]];
 for(let i=1;i<sorted.length;i++)run.push(sorted[i]-sorted[i-1]);
 return {stop,generatedAt:'2026-09-28T00:00:00Z',services:[{patternId:pattern.id,operator:pattern.operator,line:pattern.line,
  direction:pattern.direction,destination:pattern.destination,sequence:pattern.stops.indexOf(stop),rules:[0],offsets:[offset],runs:[run]}]};
};
const hms=(h,m,s=0)=>h*3600+m*60+s;
const NOW=londonInstant(MONDAY,hms(10,0));
const wall=ms=>new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',hour:'2-digit',minute:'2-digit',hour12:false}).format(ms);
const unverified={first:scheduleQuality(nine.id,{patterns:{}}),second:scheduleQuality(seven.id,{patterns:{}})};

test('a change is found where the two lines meet: the 9 to its crossing stop, the 7 from the stop 100 m away', () => {
 const options=connectionOptions(near(S[1]),near(T[4]),catalogue,stops,MONDAY);
 assert.equal(options.length,1);
 const [o]=options;
 assert.equal(o.first.line,'9'); assert.equal(o.first.board.id,'S001'); assert.equal(o.first.alight.id,'S004'); assert.equal(o.first.rideStops,3);
 assert.equal(o.second.line,'7'); assert.equal(o.second.board.id,'T001'); assert.equal(o.second.alight.id,'T004'); assert.equal(o.second.rideStops,3);
 assert.ok(o.transfer.straightMetres>80&&o.transfer.straightMetres<130,`about 100 m: ${o.transfer.straightMetres}`);
 assert.equal(o.transfer.sameStop,false);
 assert.equal(o.key,'c:BNML:9:inbound:aaaa|S001|S004|BNSM:7:outbound:cccc|T001|T004');
 assert.ok(isPlanKey(o.key));
 assert.match(connectionSentence(o),/^Take the 9 towards North End from Stop 1 \(nr\) → get off at Stop 4 \(nr\) \(3 stops\) → walk about 130 m to Cross 1 \(opp\) → take the 7 towards East End → get off at Cross 4 \(opp\) \(3 stops\)\.$/);
});

test('the other direction of the same line is never a change, a stop past walking reach finds nothing, and a detour is not a journey', () => {
 const options=connectionOptions(near(S[1]),near(S[6]),catalogue,stops,MONDAY);
 assert.equal(options.length,0,'the 9 goes there directly; no pair of the 9 with itself or its other direction is offered');
 assert.equal(connectionOptions({lat:53.40,lon:-2.30},near(T[4]),catalogue,stops,MONDAY).length,0,'5 km from any stop');
 // From beside T0 to beside T4: the 7 is direct; a 9-then-7 pair would walk more than the straight line and is refused.
 assert.equal(connectionOptions(near(T[0]),near(T[4]),catalogue,stops,MONDAY).length,0);
});

test('a second line that itself passes near the start is not a change to make, and two second buses to one place are one option', () => {
 // An 8 that runs east along the crossing road but starts beside S1: anyone near S1 would board it there.
 const eightStops=[{id:'E000',name:'Eight 0',lat:S[1].lat,lon:S[1].lon+0.004},...T.slice(1)];
 const eight={...seven,id:'BNSM:8:outbound:dddd',line:'8',destination:'East End',stops:eightStops.map(s=>s.id),stopCount:6,
  metres:eightStops.map((_,j)=>j*300),seconds:seconds(6),timings:[seconds(6)]};
 const options=connectionOptions(near(S[1]),near(T[4]),{...catalogue,patterns:[nine,seven,eight]},[...stops,eightStops[0]],MONDAY);
 assert.deepEqual(options.map(o=>o.second.line),['7'],'the 8 could be boarded 270 m from the start: no change to it is offered');
 // Measured directly, not among the few nearest stops: in a dense centre the stop it passes may not be
 // one of them. An 8 to somewhere else, so it is not simply merged with the 7.
 const eightFar={...eight,destination:'Far East'};
 const dense=connectionOptions(near(S[1]),near(T[4]),{...catalogue,patterns:[nine,seven,eightFar]},[...stops,eightStops[0]],MONDAY,{...CONNECTION_RULES,candidateStops:1});
 assert.deepEqual(dense.map(o=>o.second.line),['7'],'with only the nearest stop a candidate, the 8 is still seen to pass the start');
 assert.deepEqual(dense[0].second.also,[],'nor is it offered as another bus for the second leg');
 // A 7A of the same operator to the same destination from the same change: one option, the better scored.
 const sevenA={...seven,id:'BNSM:7A:outbound:eeee',line:'7A',metres:T.map((_,j)=>j*330)};
 const merged=connectionOptions(near(S[1]),near(T[4]),{...catalogue,patterns:[nine,seven,sevenA]},stops,MONDAY);
 assert.equal(merged.length,1); assert.equal(merged[0].second.line,'7');
 assert.deepEqual(merged[0].second.also.map(l=>l.line),['7A'],'the 7A is the same instruction with another number');
 assert.match(connectionSentence(merged[0]),/take the 7 \(or the 7A\) towards East End/);
 // Timed, the second bus is whichever of the two leaves first after the passenger could be there.
 const boards={first:board('S001',nine,60,[hms(10,5)]),second:{...board('T001',seven,60,[hms(10,30)]),services:[
  ...board('T001',seven,60,[hms(10,30)]).services,...board('T001',sevenA,66,[hms(10,16)]).services]}};
 const timing=timeConnection(merged[0],{boards,rules,nowMs:NOW,walk:transferWalk(merged[0].transfer,null),allowanceSeconds:120,quality:unverified});
 assert.equal(timing.rows[0].second.departure.line,'7A'); assert.equal(wall(timing.rows[0].second.departMs),'10:17');
 // The key restores the same journey on another day the patterns run, and nothing on one they do not.
 const back=connectionFromKey(merged[0].key,new Map([[nine.id,nine],[seven.id,seven]]),new Map(stops.map(s=>[s.id,s])),MONDAY);
 assert.equal(back.first.board.id,'S001'); assert.equal(back.second.alight.id,'T004'); assert.equal(back.transfer.sameStop,false);
 assert.equal(connectionFromKey(merged[0].key,new Map([[nine.id,{...nine,operatingRules:[{days:[5,6]}]}],[seven.id,seven]]),new Map(stops.map(s=>[s.id,s])),MONDAY),null);
 assert.equal(connectionFromKey('c:x|S001|S004|y|T001|T004',new Map(),new Map(),MONDAY),null);
});

test('the scheduled connection: first bus arrives at the change, the walk and the allowance, then the next second bus', () => {
 const [o]=connectionOptions(near(S[1]),near(T[4]),catalogue,stops,MONDAY);
 const boards={first:board('S001',nine,60,[hms(10,5),hms(10,25)]),second:board('T001',seven,60,[hms(10,10),hms(10,14),hms(10,40)])};
 const walk=transferWalk(o.transfer,null);
 assert.equal(walk.basis,'straight');
 assert.ok(walk.seconds>90&&walk.seconds<110,`about 100 m × 1.3 at 80 m/min: ${walk.seconds}`);
 const timing=timeConnection(o,{boards,rules,nowMs:NOW,walk,allowanceSeconds:120,quality:unverified});
 assert.equal(timing.kind,'timed');
 const [a,b]=timing.rows;
 assert.equal(wall(a.first.departMs),'10:06','the 10:05 from the first stop is at S1 a minute later');
 assert.equal(wall(a.first.arriveMs),'10:09','and at S4 four minutes after leaving the origin');
 assert.equal(wall(b.first.departMs),'10:26');
 assert.equal(wall(a.second.departMs),'10:15','the 10:11 at T1 is gone before the walk and the allowance; the 10:15 is the one');
 assert.equal(wall(a.second.arriveMs),'10:18');
 assert.equal(a.changeSeconds,360);
 assert.ok(a.spareSeconds>130&&a.spareSeconds<150,`6 min less the walk and 2 min: ${a.spareSeconds}`);
 assert.equal(wall(b.second.departMs),'10:41');
 // The walk checked by a router and found long: the 10:15 can no longer be reached, and the next is offered.
 const routed=transferWalk(o.transfer,{metres:600,seconds:480});
 assert.equal(routed.basis,'route');
 const again=timeConnection(o,{boards,rules,nowMs:NOW,walk:routed,allowanceSeconds:120,quality:unverified});
 // And the 10:06 would now only wait 32 min for the 10:41 the 10:26 also makes: one connection, shown
 // on the later first bus, which says the earlier makes it too.
 assert.equal(again.rows.length,1);
 assert.equal(wall(again.rows[0].first.departMs),'10:26'); assert.equal(wall(again.rows[0].second.departMs),'10:41');
 assert.equal(again.rows[0].changeSeconds,12*60);
 assert.deepEqual(again.rows[0].earlier,{departMs:a.first.departMs,line:'9',count:1});
});

test('a timetable known to run ahead of its buses gives no times, and says so; an unchecked one is said to be unchecked', () => {
 const anchor={patterns:{[nine.id]:{verified:false,medianOffsetMinutes:15.36,reason:'schedule runs 15 min early against the bus’s own reports at its first stops'},
  [seven.id]:{verified:true,medianOffsetMinutes:2.34}}};
 const q1=scheduleQuality(nine.id,anchor),q2=scheduleQuality(seven.id,anchor),q3=scheduleQuality('other',anchor);
 assert.equal(q1.kind,'unreliable'); assert.match(q1.words,/15 min early/);
 assert.equal(q2.kind,'verified'); assert.match(q2.words,/checked against/);
 assert.equal(q3.kind,'unverified'); assert.match(q3.words,/not been checked/);
 const [o]=connectionOptions(near(S[1]),near(T[4]),catalogue,stops,MONDAY);
 const boards={first:board('S001',nine,60,[hms(10,5)]),second:board('T001',seven,60,[hms(10,10)])};
 const timing=timeConnection(o,{boards,rules,nowMs:NOW,walk:transferWalk(o.transfer,null),allowanceSeconds:120,quality:{first:q1,second:q2}});
 assert.deepEqual(timing,{kind:'withheld',leg:1,reason:q1.words});
 const missing=timeConnection(o,{boards:{first:null,second:boards.second},rules,nowMs:NOW,walk:transferWalk(o.transfer,null),allowanceSeconds:120,quality:{first:q3,second:q2}});
 assert.equal(missing.kind,'unavailable'); assert.match(missing.reason,/no timetable board is published for Stop 1/);
});

test('a running time the timetable does not declare gives no arrival, and no second bus is chained from it', () => {
 const gappy={...nine,seconds:[0,60,120,null,null,null,null,null],timings:[[0,60,120,null,null,null,null,null]]};
 const cat={...catalogue,patterns:[gappy,seven]};
 const [o]=connectionOptions(near(S[1]),near(T[4]),cat,stops,MONDAY);
 const boards={first:board('S001',gappy,60,[hms(10,5)]),second:board('T001',seven,60,[hms(10,10)])};
 const timing=timeConnection(o,{boards,rules,nowMs:NOW,walk:transferWalk(o.transfer,null),allowanceSeconds:120,quality:unverified});
 assert.equal(timing.rows[0].first.arriveMs,null);
 assert.equal(timing.rows[0].second,null);
});

test('with nothing timetabled in the next hours, the next day’s first bus is the answer, said to be later', () => {
 const [o]=connectionOptions(near(S[1]),near(T[4]),catalogue,stops,MONDAY);
 const boards={first:board('S001',nine,60,[hms(6,5)]),second:board('T001',seven,60,[hms(6,20)])};
 const timing=timeConnection(o,{boards,rules,nowMs:NOW,walk:transferWalk(o.transfer,null),allowanceSeconds:120,quality:unverified});
 assert.equal(timing.kind,'timed'); assert.equal(timing.later,true);
 assert.equal(timing.rows[0].first.departure.serviceDay,'2026-09-29'); assert.equal(wall(timing.rows[0].first.departMs),'06:06');
 assert.equal(wall(timing.rows[0].second.departMs),'06:21');
});

test('a first bus timed past midnight reaches a second bus on the next service day', () => {
 const [o]=connectionOptions(near(S[1]),near(T[4]),catalogue,stops,MONDAY);
 const late=londonInstant(MONDAY,hms(23,50));
 const boards={first:board('S001',nine,60,[hms(23,58)]),second:board('T001',seven,60,[hms(0,12)])};
 const timing=timeConnection(o,{boards,rules,nowMs:late,walk:transferWalk(o.transfer,null),allowanceSeconds:120,quality:unverified});
 const [row]=timing.rows;
 assert.equal(wall(row.first.arriveMs),'00:02');
 assert.equal(row.second.departure.serviceDay,'2026-09-29');
 assert.equal(wall(row.second.departMs),'00:13');
 assert.equal(departuresOn(boards.second,rules,seven.id,late,late+3*3600_000).length,1);
 assert.equal(atStopMs(row.first.departure,nine,4)-row.first.departMs,3*60_000);
});

test('a bus is tied to a timetabled journey only by the departure its operator reported, on the day, naming one journey or one timing', () => {
 const bus=(scheduled,patternIndex=0,key='BNML|V1')=>({key,operator:'BNML',vehicle:key.split('|')[1],route:'9',direction:'inbound',journeyRef:'j',destination:'North_End',
  lat:0,lon:0,observedAtMs:NOW,recordedAt:'',ageSeconds:20,freshness:'fresh',ageWords:'20 s',sourceHash:'h',bearing:null,bearingStatus:'absent',
  match:{patternId:nine.id,patternIndex,nearestStop:'S000',evidence:{},scheduled}});
 const [row]=departuresOn(board('S001',nine,60,[hms(10,5)]),rules,nine.id,NOW,NOW+3600_000);
 assert.equal(row.originLocal,'10:05:00'); assert.equal(row.timing,0);
 assert.equal(busOnJourney(row,[bus({departure:'10:05:00',journeys:1,serviceDay:MONDAY})]).key,'BNML|V1');
 assert.equal(busOnJourney(row,[bus({departure:'10:05:00',journeys:3,timing:0,serviceDay:MONDAY})]).key,'BNML|V1','three journeys, one shared timing: the same schedule');
 assert.equal(busOnJourney(row,[bus({departure:'10:05:00',journeys:3,serviceDay:MONDAY})]),null,'three journeys and no timing named: not this one');
 assert.equal(busOnJourney(row,[bus({departure:'10:25:00',journeys:1,serviceDay:MONDAY})]),null);
 assert.equal(busOnJourney(row,[bus({departure:'10:05:00',journeys:1,serviceDay:'2026-09-27'})]),null,'yesterday’s 10:05 is another journey');
 assert.equal(busOnJourney(row,[bus({reason:'no_aimed_departure_reported'})]),null);
 // Where each bus stands on the leg, from the timetable's order.
 const [o]=connectionOptions(near(S[1]),near(T[4]),catalogue,stops,MONDAY);
 assert.deepEqual(legStanding(bus(undefined,0),o.first),{kind:'before',stopsAway:1});
 assert.deepEqual(legStanding(bus(undefined,2),o.first),{kind:'between',stopsToAlight:2});
 assert.deepEqual(legStanding(bus(undefined,5),o.first),{kind:'past'});
 assert.equal(legStanding(bus(undefined,0),o.second),null,'a bus on the 9 says nothing about the 7');
 const coming=busesOnLeg(o.first,[bus(undefined,5,'BNML|A'),bus(undefined,0,'BNML|B'),bus(undefined,2,'BNML|C')]);
 assert.deepEqual(coming.map(c=>c.bus.key),['BNML|C','BNML|B'],'on its way first, then the nearest coming; the one past is left out');
});

test('the chosen journey travels in the address as public identifiers, and is dropped when malformed or without a destination', () => {
 const key='c:BNML:9:inbound:aaaa|S001|S004|BNSM:7:outbound:cccc|T001|T004';
 const to={lat:53.4608,lon:-2.2895,label:'Cross Street'};
 const search=withPlan('?stop=1800SJ00811',null,to,key);
 assert.match(search,/plan=/);
 const read=readPlanLink(search);
 assert.equal(read.plan,key); assert.equal(read.to.label,'Cross Street');
 assert.equal(readPlanLink(withPlan('',null,null,key)).plan,null,'no destination, no plan');
 assert.equal(readPlanLink('?to=53.46,-2.29&plan=c:x%7CS001').plan,null,'too short');
 assert.equal(readPlanLink('?to=53.46,-2.29&plan=d:BNML:9:inbound:aaaa%7CS001%7CS004').plan,'d:BNML:9:inbound:aaaa|S001|S004');
 assert.equal(isPlanKey('c:a|b|c|d|e'),false);
 assert.equal(isPlanKey('d:BNML:9:inbound:aaaa|S001|S004|x'),false);
});

// A 9A to Crossroads and a short working of the 9, both between S1 and S4.
const nineA={...nine,id:'BNML:9A:inbound:ffff',line:'9A',destination:'Crossroads',stops:S.slice(0,6).map(s=>s.id),stopCount:6,
 metres:S.slice(0,6).map((_,i)=>i*300),seconds:seconds(6),timings:[seconds(6)]};
const nineShort={...nine,id:'BNML:9:inbound:gggg',stops:S.slice(0,5).map(s=>s.id),stopCount:5,
 metres:S.slice(0,5).map((_,i)=>i*300),seconds:seconds(5),timings:[seconds(5)]};
const merge=(...boards)=>({stop:boards[0].stop,generatedAt:'x',services:boards.flatMap(b=>b.services)});

test('every bus between a leg’s two stops is one instruction and is timed: other lines, other variants, wherever they go on to', () => {
 // A 9 that turns along the crossing road to T4 is a direct bus, not a first bus to change off; and it
 // is the first leg's own line, so not a second bus either. A 7B that calls at S1 before the change is a loop.
 const nineTurn={...nine,id:'BNML:9:inbound:hhhh',destination:'East End',stops:[...S.slice(0,5).map(s=>s.id),...T.slice(2).map(t=>t.id)],stopCount:9,
  metres:Array.from({length:9},(_,i)=>i*300),seconds:seconds(9),timings:[seconds(9)]};
 const sevenLoop={...seven,id:'BNSM:7B:outbound:iiii',line:'7B',stops:['S001',...T.map(t=>t.id)],stopCount:7,
  metres:Array.from({length:7},(_,i)=>i*300),seconds:seconds(7),timings:[seconds(7)]};
 const cat={...catalogue,patterns:[nine,seven,nineA,nineShort,nineTurn,sevenLoop]};
 const options=connectionOptions(near(S[1]),near(T[4]),cat,stops,MONDAY);
 assert.equal(options.length,1,'the 9, its short working and the 9A from S1 to S4 are one first leg, not three journeys');
 const [o]=options;
 assert.equal(o.first.pattern.id,nine.id);
 assert.deepEqual(legFamily(o.first).map(l=>l.pattern.id),[nine.id,nineShort.id,nineA.id]);
 assert.deepEqual(o.second.also,[],'no 9 onto the second leg, and no 7B that has already passed the start');
 assert.equal(legService(o.first),'9 towards North End (or the 9A towards Crossroads)');
 assert.equal(lineNames(o.first),'9 or 9A');
 assert.match(connectionSentence(o),/^Take the 9 towards North End \(or the 9A towards Crossroads\) from Stop 1/);
 // The 9 itself runs nothing this morning; its short working and the 9A do, and they are the answer.
 const boards={first:merge(board('S001',nine,60,[hms(15,0)]),board('S001',nineShort,60,[hms(10,20),hms(10,40)]),board('S001',nineA,60,[hms(10,10)])),
  second:board('T001',seven,60,[hms(10,30),hms(10,50)])};
 const timing=timeConnection(o,{boards,rules,nowMs:NOW,walk:transferWalk(o.transfer,null),allowanceSeconds:120,quality:unverified});
 assert.deepEqual(timing.rows.map(r=>`${r.first.departure.line} ${wall(r.first.departMs)} → ${r.second.departure.line} ${wall(r.second.departMs)}`),
  ['9 10:21 → 7 10:31','9 10:41 → 7 10:51'],'the 9A’s 10:11 waits for the same 10:31 and is folded into the 10:21');
 assert.equal(wall(timing.rows[0].earlier.departMs),'10:11'); assert.equal(timing.rows[0].earlier.line,'9A','the folded bus is named by its own line');
 // A link or a reload brings back the same buses.
 const back=connectionFromKey(o.key,new Map(cat.patterns.map(p=>[p.id,p])),new Map(stops.map(s=>[s.id,s])),MONDAY);
 assert.deepEqual(legFamily(back.first).map(l=>l.pattern.id),legFamily(o.first).map(l=>l.pattern.id));
 // A tracked bus on the short working is on the leg, and its report names its own journey: the 10:41.
 const onShort={key:'BNML|V9',operator:'BNML',vehicle:'V9',route:'9',direction:'inbound',journeyRef:'j',destination:'North_End',lat:0,lon:0,
  observedAtMs:NOW,recordedAt:'',ageSeconds:20,freshness:'fresh',ageWords:'20 s',sourceHash:'h',bearing:null,bearingStatus:'absent',
  match:{patternId:nineShort.id,patternIndex:0,nearestStop:'S000',evidence:{},scheduled:{departure:'10:40:00',journeys:1,serviceDay:MONDAY}}};
 assert.deepEqual(busesOnLeg(o.first,[onShort]).map(x=>x.standing),[{kind:'before',stopsAway:1}]);
 assert.equal(wall(timetabledAtBoard(onShort,o.first,boards.first,rules).atMs),'10:41');
 assert.equal(timetabledAtBoard({...onShort,match:{...onShort.match,scheduled:{departure:'10:45:00',journeys:1,serviceDay:MONDAY}}},o.first,boards.first,rules),null,
  'a departure the board does not hold names nothing');
});

test('a bus whose timetable is known to mislead is left out of a leg; the leg is unchecked if any of its timetables is', () => {
 const [o]=connectionOptions(near(S[1]),near(T[4]),{...catalogue,patterns:[nine,seven,nineA]},stops,MONDAY);
 assert.deepEqual(o.first.also.map(l=>l.line),['9A']);
 const anchor={patterns:{[nineA.id]:{verified:false,reason:'schedule runs 15 min early'},[nine.id]:{verified:true,medianOffsetMinutes:1}}};
 const trusted=withoutUnreliable(o,anchor);
 assert.deepEqual(trusted.first.also,[],'its times would sit among the 9’s and mislead');
 assert.equal(withoutUnreliable(o,{patterns:{}}),o,'nothing left out: the very same option');
 assert.equal(familyQuality(trusted.first,anchor).kind,'verified');
 assert.equal(familyQuality(o.first,{patterns:{[nine.id]:{verified:true}}}).kind,'unverified','the 9 checked and the 9A not: the leg is not');
});

test('the list leads with the journey that arrives soonest by the timetable; at the same arrival, the one leaving later', () => {
 const timed=(leave,arrive)=>({kind:'timed',rows:[{first:{departMs:leave},second:{departMs:arrive-5,arriveMs:arrive}}]});
 const [a,b,c]=[{key:'a'},{key:'b'},{key:'c'}];
 const first={a:timed(100,200),b:timed(110,150),c:{kind:'withheld',leg:1,reason:'x'}};
 assert.deepEqual(rankConnections([a,b,c],o=>first[o.key]).map(o=>o.key),['b','a','c'],'untimed after the timed, in the planner’s order');
 const tie={a:timed(100,150),b:timed(120,150),c:timed(90,150)};
 assert.deepEqual(rankConnections([a,b,c],o=>tie[o.key]).map(o=>o.key),['b','a','c']);
 assert.equal(rankConnections([a,b,c],o=>first[o.key],2).length,2);
 // Arriving at a stop 800 m from the destination is not arriving: the walk from it counts.
 const far={key:'far',walkFromAlightMetres:800},close={key:'close',walkFromAlightMetres:0};
 const minute=60_000,byStop={far:timed(0,10*minute),close:timed(0,15*minute)};
 assert.deepEqual(rankConnections([far,close],o=>byStop[o.key]).map(o=>o.key),['close','far'],'800 m × 1.3 at 80 m/min is 13 min: 23 min against 15');
});

test('on the first bus, the times are the second bus’s from the change, from the soonest the passenger could be there', () => {
 const [o]=connectionOptions(near(S[1]),near(T[4]),catalogue,stops,MONDAY);
 const second=board('T001',seven,60,[hms(10,0),hms(10,10),hms(10,30),hms(10,50),hms(11,10)]);
 const walk=transferWalk(o.transfer,null);
 const onward=onwardFromChange(o,{board:second,rules,nowMs:NOW,walk,quality:unverified.second});
 assert.equal(onward.kind,'timed');
 assert.deepEqual(onward.rows.map(r=>wall(r.departMs)),['10:11','10:31','10:51'],'the 10:01 leaves before anyone off a bus now could walk there');
 assert.equal(wall(onward.rows[0].arriveMs),'10:14');
 const early=scheduleQuality(seven.id,{patterns:{[seven.id]:{verified:false,reason:'schedule runs early'}}});
 assert.deepEqual(onwardFromChange(o,{board:second,rules,nowMs:NOW,walk,quality:early}),{kind:'withheld',reason:'schedule runs early'});
 assert.equal(onwardFromChange(o,{board:null,rules,nowMs:NOW,walk,quality:unverified.second}).kind,'unavailable');
});
