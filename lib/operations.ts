import {z} from 'zod';

const nullableString = z.string().nullable().optional();
const count = z.number().int().nonnegative();

const runSchema = z.object({
 runId: z.string(), mode: z.string(), status: z.string(), isHistorical: z.boolean(),
 startedAt: nullableString, finishedAt: nullableString,
 durationSeconds: z.number().nullable().optional(),
 sourcesSeen: count, sourcesProcessed: count,
 resumedFrom: nullableString, errorClass: nullableString, errorDetail: nullableString,
 activitiesTotal: count, activitiesInArea: count, outsideArea: count,
 newObservations: count, repeatObservations: count, conflictingObservations: count,
 rejectedRecords: count,
 publicationStatus: nullableString, publicationSnapshotId: nullableString,
 publicationFailureReason: nullableString,
});

const publicationSchema = z.object({
 publicationId: z.string(), snapshotId: nullableString, status: z.string(),
 builtAt: nullableString, publishedAt: nullableString,
 observationCount: count, journeyCount: count,
 sha256: nullableString, failureReason: nullableString,
 failedChecks: z.array(z.string()),
});

const operationsSchema = z.object({
 schemaVersion: z.literal(1),
 generatedAt: z.string(),
 mode: z.literal('historical_archive'),
 servedSnapshot: z.object({
  path: z.string(), present: z.boolean(), sha256: z.string().optional(),
  bytes: z.number().optional(), snapshotId: nullableString,
  observationCount: z.number().optional(), generatedAt: z.string().optional(),
  matchesRecordedPublication: z.boolean(),
 }),
 recordedPublication: z.object({
  publicationId: z.string(), snapshotId: nullableString, observationCount: count,
  journeyCount: count, windowStartMs: z.number(), windowEndMs: z.number(),
  sha256: nullableString, bytes: z.number().nullable().optional(),
  publishedAt: nullableString, targetPath: nullableString,
 }).nullable(),
 freshness: z.object({
  latestSourceCapturedAt: nullableString, latestSourceRetrievedAt: nullableString,
  lastProcessedAt: nullableString, lastPublishedAt: nullableString,
  sourceAgeSecondsAtPublication: z.number().nullable().optional(),
 }),
 totals: z.object({
  rawSources: count, sourcesProcessed: count, activitiesTotal: count, activitiesInArea: count,
  outsideArea: count, rejectedRecords: count, retainedObservations: count,
  repeatObservations: z.number().int(), conflictIdentities: count, conflictingInputRows: count,
  publishableObservations: count, suppressedObservations: count, publishedObservations: count,
  insideCaptureWindow: count, outsideCaptureWindow: count,
 }),
 reconciliation: z.array(z.object({
  label: z.string(), expression: z.string(),
  left: z.union([z.number(), z.string(), z.null()]),
  right: z.union([z.number(), z.string(), z.null()]),
  balanced: z.boolean(),
 })),
 rejections: z.array(z.object({reason: z.string(), count: count})),
 runs: z.array(runSchema),
 publications: z.array(publicationSchema),
 definitions: z.record(z.string()),
 notes: z.array(z.string()),
});

export type Operations = z.infer<typeof operationsSchema>;
export type PipelineRun = z.infer<typeof runSchema>;

export function parseOperations(value:unknown):Operations{
 const data = operationsSchema.parse(value);
 if(data.runs.some(r=>!r.isHistorical))throw Error('A run claims live collection; this release is archive replay only.');
 return data;
}

/** Human duration for a source age. Deliberately blunt: days matter on an archive. */
export function humanAge(seconds:number|null|undefined):string{
 if(seconds===null||seconds===undefined)return 'Unknown';
 const s=Math.max(0,Math.round(seconds));
 const d=Math.floor(s/86400),h=Math.floor((s%86400)/3600),m=Math.floor((s%3600)/60);
 if(d>0)return `${d}d ${h}h`;
 if(h>0)return `${h}h ${m}m`;
 if(m>0)return `${m}m ${s%60}s`;
 return `${s}s`;
}

export function stamp(value:string|null|undefined,withSeconds=true):string{
 if(!value)return 'Never';
 const t=Date.parse(value);
 if(Number.isNaN(t))return 'Unknown';
 return new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',day:'2-digit',month:'short',
  hour:'2-digit',minute:'2-digit',...(withSeconds?{second:'2-digit'}:{})}).format(t);
}

/** Status words carry their own meaning. No status is rendered as a reassuring tick. */
export function statusTone(status:string|null|undefined):'done'|'warn'|'bad'|'idle'{
 switch(status){
  case 'succeeded': case 'published': return 'done';
  case 'interrupted': case 'held_back': return 'warn';
  case 'failed': case 'failed_validation': return 'bad';
  default: return 'idle';
 }
}

export const shortId = (value:string|null|undefined,length=12) =>
 !value?'—':value.length<=length?value:value.slice(0,length)+'…';
