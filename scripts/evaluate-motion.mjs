#!/usr/bin/env node
/**
 * Fits estimated movement and scores it against what buses actually reported next.
 *
 *   node --experimental-strip-types --import ./tests/alias-loader.mjs scripts/evaluate-motion.mjs \
 *     [--reports data/evaluation/motion-reports.json] [--split 2026-09-13T12:50:00Z] \
 *     [--out data/evaluation/motion-evaluation-candidate.json]
 *
 * The published model is frozen (docs/MOTION_MODEL.md). This script writes a candidate; it replaces
 * public/data/motion-evaluation.json only when run with `--out public/data/motion-evaluation.json
 * --replace-frozen yes`, after the replacement rule there has been met. A frozen model is scored on
 * fresh captures, without refitting, by scripts/evaluate-frozen.mjs.
 *
 * For each report, at the moment it had been fetched, the estimator is given only the reports
 * of that journey fetched by then, and asked where the bus was at the time of each later report
 * of the journey up to two minutes on. The estimate's error is its distance from that later
 * report; the baseline's is the distance from the last report itself, which is what the page
 * shows without estimates. Settings are chosen on the earlier captures and scored on the later,
 * held-out ones. The estimator is lib/motion.ts: the code the page runs.
 *
 * Sparse reports cannot check a drawn position between two of them; the evaluation says only
 * how far estimates were from the reports that did arrive.
 */
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {DEFAULT_PARAMS,project} from '../lib/motion.ts';
import {BINS,MAX_AHEAD,fixesOf,loadTracks,mean,quantile,round,score,summarise,visible} from './motion-scoring.mjs';

const args={};
for(let i=2;i<process.argv.length;i+=2)args[process.argv[i].replace(/^--/,'')]=process.argv[i+1];
const REPORTS=args.reports??'data/evaluation/motion-reports.json';
const SHAPES=args.shapes??'public/data/shapes';
const SPLIT=Date.parse(args.split??'2026-09-13T12:50:00Z');
const PUBLISHED='public/data/motion-evaluation.json';
const OUT=args.out??'data/evaluation/motion-evaluation-candidate.json';
const FULL=args.full??(OUT===PUBLISHED?'data/evaluation/motion-evaluation-full.json':OUT.replace(/\.json$/,'-full.json'));
const METHOD='along-route extrapolation at the speed of the journey’s own recent reports, bounded in time';
if(OUT===PUBLISHED&&args['replace-frozen']!=='yes'){
 console.error('The published motion model is frozen (docs/MOTION_MODEL.md). Write the fit elsewhere with --out, '
  +'or add --replace-frozen yes once the replacement rule has been met.');
 process.exit(2);
}

const raw=readFileSync(REPORTS);
const data=JSON.parse(raw);
const {index,tracks}=loadTracks(SHAPES);

// ------------------------------------------------------------------ split by time
const start=sequence=>sequence.fixes[0][0];
const training=data.sequences.filter(s=>start(s)<SPLIT),heldOut=data.sequences.filter(s=>start(s)>=SPLIT);

// maxSpeed: the 99th percentile of along-route speed between consecutive training reports.
const speeds=[];
for(const sequence of training){
 const fixes=fixesOf(sequence);
 for(let i=1;i<fixes.length;i++){
  const a=fixes[i-1],b=fixes[i],dt=(b.at-a.at)/1000,track=b.pattern&&tracks.get(b.pattern);
  if(!track||a.pattern!==b.pattern||dt<8||dt>120)continue;
  const sb=project(track,b).s,sa=project(track,a,sb).s;
  if(sb>=sa)speeds.push((sb-sa)/dt);
 }
}
const maxSpeed=round(Math.max(8,quantile(speeds,0.99)??DEFAULT_PARAMS.maxSpeed),1);

// speedWindow: whichever reads speed best on training, over report ages up to a minute.
let best=null;
for(const speedWindow of [25,45,75]){
 const params={...DEFAULT_PARAMS,maxSpeed,speedWindow,horizon:MAX_AHEAD,stale:MAX_AHEAD+30,version:'fitting'};
 const result=score(training,params,tracks),near=result.rows.filter(r=>r.horizon<=60);
 const mean=near.reduce((total,r)=>total+r.error,0)/Math.max(1,near.length);
 if(!best||mean<best.mean)best={speedWindow,mean,result};
}

// The estimator's family, fitted on training by one rule set before any held-out figure was
// looked at. Buses pause at timetabled stops, and the reports show it: a candidate may pause
// the estimate at each stop it reaches (dwell), read speed from the stretches where the bus
// moved (cruise), hold a bus that its reports show standing (standingHold), or ease speed off
// with report age (decay). Each is scored on accuracy (mean error up to a minute) and on what a
// passenger would see (the mean size of the move each arriving report causes). Within 2% of the
// best mean error, the smallest mean visible move wins: accuracy first, then the least dragging
// about of the drawn bus.
const upToMinute=result=>result.rows.filter(r=>r.horizon<=60).map(r=>r.error);
const fitParams={...DEFAULT_PARAMS,maxSpeed,speedWindow:best.speedWindow,horizon:MAX_AHEAD,stale:MAX_AHEAD+30,version:'fitting'};
const family=[];
for(const cruise of [false,true])for(const standingHold of [0,15])for(const decay of [0,45,60,90,120])
 for(const dwell of [0,6,10,15,20])family.push({dwell,cruise,standingHold,decay});
const candidates=family.map(setting=>{
 const params={...fitParams,...setting},result=score(training,params,tracks),errors=upToMinute(result);
 return {setting,result,p50:quantile(errors,.5),mean:mean(errors),visible:visible(training,params,tracks)};
});
const constant=candidates.find(c=>!c.setting.dwell&&!c.setting.cruise&&!c.setting.standingHold&&!c.setting.decay);
const previous=candidates.find(c=>!c.setting.dwell&&!c.setting.cruise&&!c.setting.standingHold&&c.setting.decay===45);
const bestMean=Math.min(...candidates.map(c=>c.mean));
const chosen=candidates.filter(c=>c.mean<=bestMean*1.02).sort((a,b)=>a.visible.meanMove-b.visible.meanMove)[0]??constant;
const {dwell,cruise,standingHold,decay}=chosen.setting;
const method=[METHOD,
 dwell?`pausing ${dwell} s at each timetabled stop it reaches`:'',
 cruise?'at the speed of the stretches where its reports show it moving':'',
 standingHold?`holding a bus its reports show standing for ${standingHold} s`:'',
 decay?'eased off as the report ages':''].filter(Boolean).join(', ');

// horizon: the longest run of report-age bins, from the start, where the estimate's median
// error beats the last report's on training. None: estimated movement is not supported.
const fitting=summarise(chosen.result,null);
let horizon=0;
for(const bin of fitting){
 if(bin.n>=20&&bin.model.p50!==null&&bin.model.p50<bin.baseline.p50)horizon=bin.upTo;
 else break;
}
const supported=horizon>0;
const version=`motion-3 · ${new Date().toISOString().slice(0,10)} · window ${best.speedWindow}s · `
 +`${dwell?`dwell ${dwell}s`:'no dwell'} · ${cruise?'cruise speed':'window speed'} · `
 +`${decay?`decay ${decay}s`:'no decay'} · horizon ${horizon}s`;
const params={...DEFAULT_PARAMS,maxSpeed,speedWindow:best.speedWindow,...chosen.setting,
 horizon:supported?horizon:DEFAULT_PARAMS.horizon,version};

// The uncertainty band is fitted on training (8 in 10 errors per report-age bin) and checked on
// held-out cases: how often the band actually held the bus is reported beside it.
const trained=score(training,params,tracks);
const profile={version,basis:'training captures: the distance that 8 in 10 estimates at this report age came within',
 bins:BINS.map((upTo,i)=>{
  const lo=BINS[i-1]??0,errors=trained.rows.filter(r=>r.horizon>lo&&r.horizon<=upTo).map(r=>r.error);
  return {upTo,n:errors.length,p50:round(quantile(errors,.5))??0,p80:round(quantile(errors,.8))??0};
 })};
const held=score(heldOut,params,tracks);
const heldSummary=summarise(held,profile),trainSummary=summarise(trained,profile);

// ------------------------------------------------------------------ outputs
const reportsSha=createHash('sha256').update(raw).digest('hex');
const identity=s=>({operator:s.operator,vehicle:s.vehicle,route:s.route,direction:s.direction,journeyRef:s.journeyRef});
const traced=(rows,sequences,split)=>rows.map(r=>({split,...identity(sequences[r.sequence]),pattern:r.pattern,
 method:version,issuedAtMs:r.issuedAt,basisObservedAtMs:r.basisAt,targetObservedAtMs:r.targetAt,
 horizonSeconds:round(r.horizon),predicted:r.predicted,errorMetres:round(r.error),baselineMetres:round(r.baseline),
 alongMetres:round(r.along),speed:round(r.speed,2),capped:r.capped,
 basisSource:data.sources[r.basisSource],targetSource:data.sources[r.targetSource]}));
mkdirSync(dirname(FULL),{recursive:true});
writeFileSync(FULL,JSON.stringify({version,method,reportsSha256:reportsSha,
 rows:[...traced(trained.rows,training,'training'),...traced(held.rows,heldOut,'held_out')]})+'\n');

// A few held-out journeys for the Evidence replay: their reports and every estimate made.
const perSequence=new Map();
for(const row of held.rows)perSequence.set(row.sequence,(perSequence.get(row.sequence)??0)+1);
const replay=[...perSequence.entries()].sort((a,b)=>b[1]-a[1]).slice(0,4).map(([i])=>{
 const sequence=heldOut[i],fixes=fixesOf(sequence);
 const pattern=fixes.find(f=>f.pattern&&tracks.has(f.pattern))?.pattern??null;
 return {...identity(sequence),pattern,shapeFile:pattern?index.patterns[pattern]?.file??null:null,
  fixes:fixes.map(f=>[f.at,f.availableAt,f.lat,f.lon]),
  estimates:held.rows.filter(r=>r.sequence===i).slice(0,400)
   .map(r=>[r.issuedAt,r.basisAt,r.targetAt,r.predicted[0],r.predicted[1],round(r.error),round(r.baseline)])};
});

const near=rows=>rows.filter(r=>r.horizon<=30);
const heldNear=near(held.rows);
const published={
 schemaVersion:1,version,method,generatedAt:new Date().toISOString(),
 supported,
 data:{reportsSha256:reportsSha,lines:data.lines,split:new Date(SPLIT).toISOString(),
  training:{sequences:training.length,fixes:training.reduce((n,s)=>n+s.fixes.length,0)},
  heldOut:{sequences:heldOut.length,fixes:heldOut.reduce((n,s)=>n+s.fixes.length,0)},runs:data.runs},
 params,
 fitted:{maxSpeed:`99th percentile of along-route speed between consecutive training reports (${speeds.length} pairs)`,
  speedWindow:'the window, of 25, 45 and 75 s, with the lowest mean training error up to a minute',
  horizon:'the longest run of report-age bins from the start in which the median training error beat the last report’s',
  family:'dwell of 0, 6, 10, 15 or 20 s at each timetabled stop reached; speed from the whole window or from the moving '
   +'stretches only (cruise); a bus shown standing held 0 or 15 s; decay of 0, 45, 60, 90 or 120 s: 200 candidates',
  rule:'within 2% of the best mean training error up to a minute, the candidate whose arriving reports move the estimate '
   +'least on average; chosen before any held-out figure was read',
  fixedNotFitted:['stationarySpeed','minSpan','maxGap','stale','offTrack','backwardTolerance','largeCorrection',
   'settle','holdBack','turnSettle','catchUp','stopTolerance','standingMetres']},
 corridor:{lines:data.lines,patterns:supported?[...tracks.keys()]:[]},
 errorProfile:supported?profile:null,
 heldOut:{bins:heldSummary,abstained:held.abstained,
  headline:{reportAgeUpTo:30,n:heldNear.length,
   modelMedianMetres:round(quantile(heldNear.map(r=>r.error),.5)),
   baselineMedianMetres:round(quantile(heldNear.map(r=>r.baseline),.5))}},
 training:{bins:trainSummary,abstained:trained.abstained},
 visibleCorrections:{basis:'at the moment each new report reached the page, how far the estimate moved, before any '
   +'smoothing; back means more than holdBack towards the start of the route, snapped more than largeCorrection',
  heldOut:visible(heldOut,params,tracks),
  heldOutConstantSpeed:visible(heldOut,{...params,dwell:0,cruise:false,standingHold:0,decay:0},tracks),
  heldOutPrevious:{setting:'motion-2: constant speed eased off with a 45 s decay, no stops',
   ...visible(heldOut,{...params,dwell:0,cruise:false,standingHold:0,decay:45},tracks)},
  fitting:candidates.map(c=>({...c.setting,medianError:round(c.p50),meanError:round(c.mean),...c.visible}))},
 replay,
 notes:['Scored only against reports that arrived. Sparse reports, about 20 s apart, cannot check a drawn position between two of them.',
  'The baseline is the last report itself, which is what the page draws without estimates.',
  'These scores are for the estimate. While a correction settles, the drawn bus trails it, catching up no faster than a set rate.',
  'An estimate never becomes an observation: none of these is stored or published as a position.'],
};
mkdirSync(dirname(OUT),{recursive:true});
writeFileSync(OUT,JSON.stringify(published)+'\n');
console.log(JSON.stringify({out:OUT,version,supported,maxSpeed,speedWindow:best.speedWindow,setting:chosen.setting,horizon,
 heldOutError:{chosen:{p50:round(quantile(upToMinute(held),.5)),mean:round(mean(upToMinute(held)))},
  constant:constant?{trainP50:round(constant.p50),trainMean:round(constant.mean)}:null,
  previous:previous?{trainP50:round(previous.p50),trainMean:round(previous.mean)}:null},
 visible:published.visibleCorrections.heldOut,visibleConstantSpeed:published.visibleCorrections.heldOutConstantSpeed,
 visiblePrevious:published.visibleCorrections.heldOutPrevious,
 fittingTop:[...candidates].sort((a,b)=>a.mean-b.mean).slice(0,6).map(c=>`${JSON.stringify(c.setting)} p50 ${round(c.p50)} mean ${round(c.mean)} move ${c.visible.meanMove} back ${c.visible.back} snap ${c.visible.snapped}`),
 training:{sequences:training.length,rows:trained.rows.length},heldOut:{sequences:heldOut.length,rows:held.rows.length},
 headline:published.heldOut.headline,heldOutBins:heldSummary.map(b=>`${b.upTo}s n=${b.n} model ${b.model.p50} vs ${b.baseline.p50} cover ${b.bandCoverage}`),
 abstained:held.abstained.slice(0,6).map(a=>`${a.reason}: ${a.count}`)},null,1));
