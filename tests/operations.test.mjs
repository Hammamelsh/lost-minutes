import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseOperations,humanAge,statusTone,stamp,shortId} from '../lib/operations.ts';
import {parseReplay} from '../lib/replay.ts';

const ops=parseOperations(JSON.parse(readFileSync(new URL('../public/data/operations.json',import.meta.url),'utf8')));
const replay=parseReplay(JSON.parse(readFileSync(new URL('../public/data/replay.json',import.meta.url),'utf8')));

test('the operations record describes the snapshot actually being served',()=>{
 assert.equal(ops.servedSnapshot.present,true);
 assert.equal(ops.servedSnapshot.snapshotId,replay.snapshotId);
 assert.equal(ops.servedSnapshot.observationCount,replay.quality.uniqueObservations);
 assert.equal(ops.servedSnapshot.matchesRecordedPublication,true);
 assert.equal(ops.recordedPublication?.snapshotId,replay.snapshotId);
});

test('every published total reconciles against the pipeline history',()=>{
 assert.ok(ops.reconciliation.length>=4);
 for(const row of ops.reconciliation)assert.ok(row.balanced,`unbalanced: ${row.expression}`);
 assert.equal(ops.totals.publishedObservations,replay.quality.uniqueObservations);
 assert.equal(ops.totals.repeatObservations,replay.quality.duplicateObservations);
 assert.equal(ops.totals.conflictIdentities,replay.quality.conflictingObservations);
 assert.equal(ops.totals.outsideCaptureWindow,replay.quality.outsideCaptureWindow);
 assert.equal(ops.totals.activitiesInArea,replay.quality.rawActivitiesInArea);
});

test('processing outcome and publication outcome are recorded separately',()=>{
 for(const run of ops.runs){
  assert.ok(['running','succeeded','failed','interrupted'].includes(run.status));
  assert.ok(run.publicationStatus===null||run.publicationStatus===undefined||
   ['published','failed_validation','held_back'].includes(run.publicationStatus));
 }
 assert.ok(ops.publications.length>=1);
});

test('the record labels each run archive or live, and a live run is read, not refused',()=>{
 assert.equal(ops.mode,'historical_archive');
 assert.throws(()=>parseOperations({...ops,mode:'live'}));
 // Until 21 September 2026 a record with one live run was refused outright, so the served site's
 // Operations view showed nothing from the day it was deployed. A live run is a run.
 const withLive=parseOperations({...ops,runs:[{...ops.runs[0],runId:'live-1',mode:'live_collection',isHistorical:false},...ops.runs]});
 assert.equal(withLive.runs[0].isHistorical,false);
 assert.equal(withLive.runs.length,ops.runs.length+1);
 const text=JSON.stringify(ops).toLowerCase();
 assert.ok(!text.includes('scheduledcoverage'));
 assert.ok(!text.includes('punctual'));
});

test('status tone never flatters an unknown or failed outcome',()=>{
 assert.equal(statusTone('succeeded'),'done');
 assert.equal(statusTone('published'),'done');
 assert.equal(statusTone('interrupted'),'warn');
 assert.equal(statusTone('failed_validation'),'bad');
 assert.equal(statusTone(undefined),'idle');
 assert.equal(statusTone('anything else'),'idle');
});

test('source age is reported honestly, including when unknown',()=>{
 assert.equal(humanAge(null),'Unknown');
 assert.equal(humanAge(0),'0s');
 assert.equal(humanAge(133023),'1d 12h');
 assert.equal(stamp(null),'Never');
 assert.equal(stamp('not a date'),'Unknown');
 assert.equal(shortId(null),'—');
 // The sample is a day-old archive, so the age must not read as fresh.
 assert.ok((ops.freshness.sourceAgeSecondsAtPublication??0)>3600);
});
