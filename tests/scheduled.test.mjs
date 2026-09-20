// A timetabled time at your stop: shown only when every premise is established, never estimated.
import test from 'node:test';
import assert from 'node:assert/strict';
import {londonOffsetMinutes,londonWall,londonWallToMs,scheduledAtStop} from '../lib/scheduled.ts';

// Route 15 inbound, as published on 20 September 2026: 61 stops, Hillingdon Road (opp) at
// index 30 is 1,320 s into the schedule. A 06:49 departure is due there at 07:11.
const seconds=[0,0,60,60,120,180,180,240,300,300,360,420,420,480,540,600,600,660,720,720,780,840,900,900,960,1020,1080,1140,1200,1260,1320];
const one={departure:'06:49:00',journeys:1,serviceDay:'2026-09-15'};

test('London wall time on a BST day is an hour ahead of UTC, and on a GMT day is not',()=>{
 assert.equal(londonOffsetMinutes(Date.UTC(2026,8,15,12)),60,'September: BST');
 assert.equal(londonOffsetMinutes(Date.UTC(2026,0,15,12)),0,'January: GMT');
 assert.equal(londonWallToMs('2026-09-15','06:49:00'),Date.UTC(2026,8,15,5,49,0));
 assert.equal(londonWallToMs('2026-01-15','06:49:00'),Date.UTC(2026,0,15,6,49,0));
 assert.equal(londonWall(Date.UTC(2026,8,15,5,49,0)),'06:49');
 assert.equal(londonWallToMs('2026-9-15','06:49:00'),null,'a malformed day is refused');
 assert.equal(londonWallToMs('2026-09-15','6:49'),null,'a malformed time is refused');
});

test('a bus before your stop, on one named journey, gets the timetabled time at your stop',()=>{
 const r=scheduledAtStop({scheduled:one,seconds,busIndex:18,stopIndex:30});
 assert.equal(r.kind,'time');
 assert.equal(r.wall,'07:11');
 assert.equal(r.secondsFromDeparture,1320);
 assert.equal(r.atMs,Date.UTC(2026,8,15,5,49,0)+1320*1000);
});

test('at or past your stop, no time: the schedule there is history',()=>{
 assert.equal(scheduledAtStop({scheduled:one,seconds,busIndex:30,stopIndex:30}).kind,'none');
 assert.match(scheduledAtStop({scheduled:one,seconds,busIndex:30,stopIndex:30}).reason,/nearest your stop already/);
 assert.match(scheduledAtStop({scheduled:one,seconds,busIndex:31,stopIndex:30}).reason,/past your stop/);
});

test('two journeys at one departure give no answer, and say so',()=>{
 const r=scheduledAtStop({scheduled:{...one,journeys:2},seconds,busIndex:18,stopIndex:30});
 assert.equal(r.kind,'none');
 assert.match(r.reason,/2 timetabled journeys leave at 06:49/);
});

test('an undeclared running time to your stop gives no answer, never zero',()=>{
 const partial=seconds.map((s,i)=>i>=25?null:s);
 const r=scheduledAtStop({scheduled:one,seconds:partial,busIndex:18,stopIndex:30});
 assert.equal(r.kind,'none');
 assert.match(r.reason,/does not declare a running time to your stop/);
 assert.match(scheduledAtStop({scheduled:one,seconds:undefined,busIndex:18,stopIndex:30}).reason,/does not declare running times/);
});

test('the pipeline’s reasons for naming no journey are said in words',()=>{
 for(const [reason,words] of [
  ['no_aimed_departure_reported',/did not report which departure/],
  ['aimed_departure_not_in_timetable',/not in the timetable held here/],
  ['pattern_has_no_departure_times',/lists no departures/],
  ['aimed_departure_unreadable',/could not be read/]]){
  const r=scheduledAtStop({scheduled:{reason},seconds,busIndex:18,stopIndex:30});
  assert.equal(r.kind,'none'); assert.match(r.reason,words,reason);
 }
 assert.match(scheduledAtStop({scheduled:null,seconds,busIndex:18,stopIndex:30}).reason,/no scheduled journey/);
});
