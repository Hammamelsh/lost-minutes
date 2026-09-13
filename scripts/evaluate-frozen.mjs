#!/usr/bin/env node
/**
 * The frozen motion model scored on captures it has never seen, with nothing refitted.
 *
 *   .venv/bin/python -m pipeline.motion_data export --lines 15,250,256 \
 *     --since 2026-09-13T19:44:00Z --out data/evaluation/motion-reports-fresh.json
 *   node --experimental-strip-types --import ./tests/alias-loader.mjs scripts/evaluate-frozen.mjs \
 *     --reports data/evaluation/motion-reports-fresh.json --label fresh-2026-09-13-evening
 *
 * Reported beside the last report itself (what the page draws without estimates) and beside
 * constant speed, on the same journeys:
 *   - positional error by report age: median, mean, 80th and 95th percentile;
 *   - corrections: how often, and how far, an arriving report moves the drawn estimate;
 *   - abstention: how often the model declined to estimate, and why;
 *   - uncertainty: how often the published band (8 in 10 of training errors) held the bus.
 * Only journeys that began after the model was generated are scored unless --since says
 * otherwise, and an overlap with the development window is flagged. Nothing is published, and
 * no single aggregate decides a replacement (docs/MOTION_MODEL.md).
 */
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {DEFAULT_PARAMS} from '../lib/motion.ts';
import {BINS,loadTracks,mean,quantile,round,score,visible} from './motion-scoring.mjs';

const args={};
for(let i=2;i<process.argv.length;i+=2)args[process.argv[i].replace(/^--/,'')]=process.argv[i+1];
if(!args.reports||!args.label){
 console.error('usage: --reports <file> --label <name> [--since ISO] [--until ISO] [--model file] [--out file]');
 process.exit(2);
}
const MODEL=args.model??'public/data/motion-evaluation.json';
const OUT=args.out??`data/evaluation/frozen-${args.label}.json`;

const modelRaw=readFileSync(MODEL);
const model=JSON.parse(modelRaw);
if(!model.supported||!model.errorProfile){console.error('This model supports no estimates; there is nothing to score.');process.exit(2)}
const params={...DEFAULT_PARAMS,...model.params};
const paramsSha256=createHash('sha256').update(JSON.stringify(model.params)).digest('hex');
const profile=model.errorProfile;
const modelBorn=Date.parse(model.generatedAt);
const since=args.since?Date.parse(args.since):modelBorn;
const until=args.until?Date.parse(args.until):Infinity;
const {tracks}=loadTracks(args.shapes??'public/data/shapes');

const raw=readFileSync(args.reports);
const data=JSON.parse(raw);
const start=sequence=>sequence.fixes[0][0];
const sequences=data.sequences.filter(s=>start(s)>=since&&start(s)<until);
if(!sequences.length){console.error(`No journey in ${args.reports} began inside the window.`);process.exit(1)}

const stats=values=>({n:values.length,p50:round(quantile(values,.5)),mean:values.length?round(mean(values)):null,
 p80:round(quantile(values,.8)),p95:round(quantile(values,.95))});
const constantParams={...params,dwell:0,cruise:false,standingHold:0,decay:0,version:'constant speed'};
const frozen=score(sequences,params,tracks),constant=score(sequences,constantParams,tracks);
const inBin=(rows,upTo,i)=>rows.filter(r=>r.horizon>(BINS[i-1]??0)&&r.horizon<=upTo);
const byAge=BINS.map((upTo,i)=>{
 const rows=inBin(frozen.rows,upTo,i),flat=inBin(constant.rows,upTo,i),band=profile.bins.find(b=>b.upTo===upTo);
 return {upTo,model:stats(rows.map(r=>r.error)),lastReport:stats(rows.map(r=>r.baseline)),
  constantSpeed:stats(flat.map(r=>r.error)),
  betterThanLastReport:rows.length?round(rows.filter(r=>r.error<r.baseline).length/rows.length,3):null,
  band:band?{p80:band.p80,trainingN:band.n,coverage:rows.length?round(rows.filter(r=>r.error<=band.p80).length/rows.length,3):null}:null};
});
const minute=rows=>rows.filter(r=>r.horizon<=60);
const abstained=frozen.abstained.reduce((n,a)=>n+a.count,0),opportunities=frozen.rows.length+abstained;
const iso=ms=>Number.isFinite(ms)?new Date(ms).toISOString():null;

const report={
 schemaVersion:1,label:args.label,generatedAt:new Date().toISOString(),
 model:{file:MODEL,version:model.version,generatedAt:model.generatedAt,paramsSha256,
  fileSha256:createHash('sha256').update(modelRaw).digest('hex')},
 data:{reports:args.reports,reportsSha256:createHash('sha256').update(raw).digest('hex'),lines:data.lines,
  window:{since:iso(since),until:iso(until),rule:'a journey is scored when its first report is inside the window'},
  overlapsDevelopment:since<modelBorn,
  sequences:sequences.length,fixes:sequences.reduce((n,s)=>n+s.fixes.length,0),
  firstReport:iso(Math.min(...sequences.map(start))),lastReport:iso(Math.max(...sequences.map(s=>s.fixes.at(-1)[0])))},
 error:{basis:'distance from each later report of the journey, at that report’s time, of the estimate made when the earlier '
   +'one had been fetched; the last report’s own distance is the baseline',
  upToMinute:{model:stats(minute(frozen.rows).map(r=>r.error)),lastReport:stats(minute(frozen.rows).map(r=>r.baseline)),
   constantSpeed:stats(minute(constant.rows).map(r=>r.error))},
  byReportAge:byAge},
 corrections:{basis:'at the moment each new report reached the page, how far the estimate moved before any smoothing; '
   +'back and forward mean more than holdBack, snapped more than largeCorrection',
  model:visible(sequences,params,tracks),constantSpeed:visible(sequences,constantParams,tracks)},
 abstention:{opportunities,estimated:frozen.rows.length,abstained,share:round(abstained/Math.max(1,opportunities),3),
  reasons:frozen.abstained},
 uncertainty:{target:0.8,basis:'the published band is the distance within which 8 in 10 training estimates fell, per report age; '
   +'coverage is the share of these errors inside it',byReportAge:byAge.map(b=>({upTo:b.upTo,n:b.model.n,coverage:b.band?.coverage??null}))},
 development:{note:'the figures published with the model, on the 13 September development captures, for comparison only',
  heldOutHeadline:model.heldOut?.headline??null,heldOutCorrections:model.visibleCorrections?.heldOut??null},
 notes:['Scored only against reports that arrived; a position between two reports cannot be checked.',
  'Nothing was fitted or published. A replacement is decided by the rule in docs/MOTION_MODEL.md, not by any one figure here.'],
};
mkdirSync(dirname(OUT),{recursive:true});
writeFileSync(OUT,JSON.stringify(report,null,1)+'\n');

const m=report.error.upToMinute,c=report.corrections,a=report.abstention;
console.log([`Frozen ${model.version} (params sha256 ${paramsSha256.slice(0,12)}), ${args.label}: `
  +`${report.data.sequences} journeys, ${report.data.fixes} reports, ${report.data.firstReport} to ${report.data.lastReport}`
  +(report.data.overlapsDevelopment?' — WARNING: the window starts before the model was generated':''),
 `Error up to a minute: model median ${m.model.p50} m, mean ${m.model.mean} m (n=${m.model.n}); last report ${m.lastReport.p50} m, `
  +`${m.lastReport.mean} m; constant speed ${m.constantSpeed.p50} m, ${m.constantSpeed.mean} m`,
 ...byAge.filter(b=>b.model.n).map(b=>`  ≤${b.upTo}s n=${b.model.n}: model p50 ${b.model.p50} p80 ${b.model.p80} p95 ${b.model.p95} · `
  +`last report p50 ${b.lastReport.p50} · constant p50 ${b.constantSpeed.p50} · better ${b.betterThanLastReport} · band ${b.band?.p80} m covers ${b.band?.coverage}`),
 `Corrections (n=${c.model.n}): mean ${c.model.meanMove} m, p95 ${c.model.p95} m; back ${c.model.back}, forward ${c.model.forward}, snapped ${c.model.snapped}`
  +` · constant speed mean ${c.constantSpeed.meanMove} m, back ${c.constantSpeed.back}, snapped ${c.constantSpeed.snapped}`,
 `Abstained ${a.abstained} of ${a.opportunities} (${a.share}): ${a.reasons.slice(0,5).map(r=>`${r.reason} ${r.count}`).join('; ')}`,
 `Written to ${OUT}`].join('\n'));
