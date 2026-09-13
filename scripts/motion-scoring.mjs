/**
 * Scoring shared by the fit (evaluate-motion.mjs) and the frozen evaluation (evaluate-frozen.mjs):
 * one definition of an estimate's error, of the correction a passenger sees when a report arrives,
 * and of an abstention, so that a model can be compared with itself on data it has never seen.
 * The estimator scored is lib/motion.ts, the code the page runs.
 */
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {decodePolyline,estimate,historyFrom,makeTrack,metres,project} from '../lib/motion.ts';

export const MAX_AHEAD=120;
export const BINS=[10,20,30,45,60,90,120];

export const quantile=(values,q)=>{
 if(!values.length)return null;
 const sorted=[...values].sort((a,b)=>a-b),k=(sorted.length-1)*q,lo=Math.floor(k),hi=Math.ceil(k);
 return sorted[lo]+(sorted[hi]-sorted[lo])*(k-lo);
};
export const round=(value,places=1)=>value===null||value===undefined?null:Math.round(value*10**places)/10**places;
export const binOf=h=>BINS.find(b=>h<=b)??null;
export const mean=values=>values.reduce((total,value)=>total+value,0)/Math.max(1,values.length);

/** The accepted road shapes, by pattern, exactly as the page loads them. */
export function loadTracks(shapesDir){
 const index=JSON.parse(readFileSync(join(shapesDir,'index.json')));
 const tracks=new Map();
 for(const [id,entry] of Object.entries(index.patterns)){
  if(entry.status!=='accepted'||!entry.file)continue;
  const shape=JSON.parse(readFileSync(join(shapesDir,entry.file)));
  tracks.set(id,makeTrack(id,decodePolyline(shape.polyline6,6),shape.stopOffsets??[]));
 }
 return {index,tracks};
}

export function fixesOf(sequence){
 const service=`${sequence.route}|${sequence.direction}|${sequence.journeyRef}`,seen=new Set(),fixes=[];
 for(const [at,available,lat,lon,bearing,pattern,source,run] of sequence.fixes){
  if(seen.has(at))continue;
  seen.add(at);
  fixes.push({at,availableAt:available??at,lat,lon,bearing,pattern,source,run,service});
 }
 return fixes.sort((a,b)=>a.at-b.at);
}

export function category(reason){
 if(/branch/.test(reason))return 'branch not settled';
 if(/not placed/.test(reason))return 'not placed on a timetable pattern';
 if(/m from the route/.test(reason))return 'report off the road geometry';
 if(/geometry/.test(reason))return 'no accepted road geometry';
 if(/too old/.test(reason))return 'report too old to estimate from';
 if(/jumped/.test(reason))return 'reports jumped further than a bus travels';
 if(/second report/.test(reason))return 'only one report of the journey so far';
 if(/too close/.test(reason))return 'reports too close together';
 if(/apart/.test(reason))return 'reports too far apart';
 if(/backwards/.test(reason))return 'reports went backwards along the route';
 return reason;
}

/**
 * For each report, at the moment it had been fetched, the estimator is given only the reports of
 * that journey fetched by then, and asked where the bus was at the time of each later report of
 * the journey up to MAX_AHEAD seconds on. Its error is its distance from that later report; the
 * baseline's is the distance from the last report itself. Where it declines, the reason is kept.
 */
export function score(sequences,params,tracks){
 const rows=[],abstained=new Map();
 const abstain=(reason,horizon)=>{
  const key=category(reason),entry=abstained.get(key)??{reason:key,count:0,byBin:{}};
  entry.count+=1;
  const bin=binOf(horizon);
  entry.byBin[bin]=(entry.byBin[bin]??0)+1;
  abstained.set(key,entry);
 };
 sequences.forEach((sequence,sequenceIndex)=>{
  const fixes=fixesOf(sequence);
  for(let k=0;k<fixes.length-1;k++){
   const basis=fixes[k],issuedAt=basis.availableAt;
   // Only what had been fetched when this report arrived, and this report the newest of it.
   const known=fixes.filter(f=>f.availableAt<=issuedAt);
   if(known.some(f=>f.at>basis.at))continue;
   const track=basis.pattern?tracks.get(basis.pattern)??null:null;
   const history=historyFrom(known);
   for(let j=k+1;j<fixes.length&&fixes[j].at-basis.at<=MAX_AHEAD*1000;j++){
    const target=fixes[j],horizon=(target.at-basis.at)/1000,baseline=metres(basis,target);
    if(!basis.pattern){abstain('it is not placed on a timetable pattern',horizon);continue}
    if(!track){abstain('no accepted road geometry',horizon);continue}
    const e=estimate(history,track,target.at,params);
    if(e.mode!=='estimated'){abstain(e.reason,horizon);continue}
    rows.push({sequence:sequenceIndex,basis:k,target:j,horizon,issuedAt,basisAt:basis.at,targetAt:target.at,
     predicted:[round(e.lat,6),round(e.lon,6)],error:metres(e,target),baseline,speed:e.speed,capped:e.capped,
     along:e.s-project(track,target,e.s).s,basisSource:basis.source,targetSource:target.source,pattern:basis.pattern});
   }
  }
 });
 return {rows,abstained:[...abstained.values()].sort((a,b)=>b.count-a.count)};
}

export function summarise(result,profile){
 return BINS.map((upTo,i)=>{
  const lo=BINS[i-1]??0,inBin=result.rows.filter(r=>r.horizon>lo&&r.horizon<=upTo);
  const model=inBin.map(r=>r.error),base=inBin.map(r=>r.baseline);
  const band=profile?.bins.find(b=>b.upTo===upTo);
  return {upTo,n:inBin.length,
   model:{p50:round(quantile(model,.5)),p80:round(quantile(model,.8)),p90:round(quantile(model,.9))},
   baseline:{p50:round(quantile(base,.5)),p80:round(quantile(base,.8)),p90:round(quantile(base,.9))},
   betterThanBaseline:inBin.length?round(inBin.filter(r=>r.error<r.baseline).length/inBin.length,3):null,
   bandCoverage:band&&inBin.length?round(inBin.filter(r=>r.error<=band.p80).length/inBin.length,3):null};
 });
}

/**
 * What a passenger sees: when each new report reaches the page, how far the estimate moves, before
 * any smoothing. Forward is the estimate catching up; back draws the bus backwards.
 */
export function visible(sequences,params,tracks){
 const moves=[];
 for(const sequence of sequences){
  const fixes=fixesOf(sequence);
  for(let k=1;k<fixes.length;k++){
   const at=fixes[k].availableAt;
   const before=fixes.filter(f=>f.availableAt<at),after=fixes.filter(f=>f.availableAt<=at);
   if(!before.length||after[after.length-1].at!==fixes[k].at)continue;
   const track=fixes[k].pattern?tracks.get(fixes[k].pattern)??null:null;
   if(!track||before[before.length-1].pattern!==fixes[k].pattern)continue;
   const a=estimate(historyFrom(before),track,at,params),b=estimate(historyFrom(after),track,at,params);
   if(a.mode!=='estimated'||b.mode!=='estimated')continue;
   moves.push(b.s-a.s);
  }
 }
 const size=moves.map(Math.abs),share=test=>moves.length?round(moves.filter(test).length/moves.length,3):null;
 return {n:moves.length,meanMove:round(mean(size)),p50:round(quantile(size,.5)),p80:round(quantile(size,.8)),
  p95:round(quantile(size,.95)),snapped:share(m=>Math.abs(m)>params.largeCorrection),
  back:share(m=>m<-params.holdBack),forward:share(m=>m>params.holdBack)};
}
