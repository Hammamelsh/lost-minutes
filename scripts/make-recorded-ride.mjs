/**
 * One recorded ride, cut from a reel of rebuilt publications, for the page to replay when no live
 * bus suits a ride-along.
 *
 *   node scripts/make-recorded-ride.mjs --reel data/evaluation/reel-163-3426.json \
 *     --operator BNGN --vehicle 3426 --journey 1147 --id 2026-09-23-bngn-3426-163
 *
 * The reel is what `pipeline/replay_publications.py` rebuilds from the collector's own retained
 * position captures: the sequence of live.json payloads a phone was served over a past window,
 * each with the moment it was received. This takes the one vehicle on the one journey, keeps
 * every report exactly as it was published — its recorded time, its source file's SHA-256, its
 * match and its trail — and stores the publication envelope once instead of eighty-six times.
 * Nothing is smoothed, resampled or invented: the page replays the same reports at the same
 * spacing, and says it is a recording.
 */
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';

const arg = (k, d) => {const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d};
const reelPath = arg('reel');
const operator = arg('operator');
const vehicle = arg('vehicle');
const journey = arg('journey');
const id = arg('id');
if (!reelPath || !operator || !vehicle || !journey || !id || !/^[0-9a-z][0-9a-z-]{2,79}$/.test(id)) {
  console.error('usage: --reel FILE --operator OP --vehicle V --journey REF --id kebab-id');
  process.exit(2);
}
const reel = JSON.parse(readFileSync(reelPath, 'utf8'));
const publications = [];
for (const entry of reel.publications) {
  const v = entry.live.vehicles.find(x => x.operator === operator && x.vehicle === vehicle && x.journeyRef === journey);
  if (!v) continue;
  const {vehicles, publishedAt, publishedAtMs, trailSources, ...envelope} = entry.live;
  void vehicles;
  publications.push({receivedAtMs: entry.receivedAtMs, publishedAt, publishedAtMs,
    trailSources: trailSources ?? [], vehicle: v, envelope});
}
if (!publications.length) {console.error('that vehicle on that journey is in no publication of the reel'); process.exit(1)}
// One envelope, the first publication's: the collector, the freshness policy and the counts as
// they were at the start of the ride. The counts are about the whole feed on the day, not the ride.
const envelope = publications[0].envelope;
// The trail's source files are the same few dozen captures named over and over (98 distinct in
// 3,585 listings on the first ride), so they are listed once and each publication indexes them.
const sources = [];
const sourceIndex = new Map();
const indexOf = hash => {
  if (!sourceIndex.has(hash)) {sourceIndex.set(hash, sources.length); sources.push(hash)}
  return sourceIndex.get(hash);
};
for (const p of publications) p.trailSources = p.trailSources.map(indexOf);
const first = publications[0], last = publications.at(-1);
const v0 = first.vehicle;
const london = new Intl.DateTimeFormat('en-GB', {timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit'});
const day = new Intl.DateTimeFormat('en-GB', {timeZone: 'Europe/London', dateStyle: 'long'});
const ride = {
  schemaVersion: 1,
  id,
  title: `${v0.route} to ${(v0.destination ?? '').replace(/_/g, ' ')}`,
  operator, vehicle, route: v0.route, direction: v0.direction, journeyRef: journey,
  destination: v0.destination ?? '', origin: v0.origin ?? null,
  recordedOn: day.format(new Date(v0.observedAtMs)),
  from: new Date(first.receivedAtMs).toISOString(), to: new Date(last.receivedAtMs).toISOString(),
  fromLocal: london.format(new Date(first.receivedAtMs)), toLocal: london.format(new Date(last.receivedAtMs)),
  seconds: Math.round((last.receivedAtMs - first.receivedAtMs) / 1000),
  reports: publications.length,
  basis: 'Rebuilt from the collector’s retained position captures (pipeline/replay_publications.py): the '
    + 'publications a phone was served over this window, in order, each report with its original time, '
    + 'its source file’s SHA-256 and its match. Replayed at the same spacing; nothing between reports is recorded.',
  source: {reel: reelPath.replace(/^.*\//, ''), recordedFrom: reel.recordedFrom ?? null, rebuiltBy: reel.rebuiltBy ?? null},
  sources,
  envelope,
  publications: publications.map(({envelope: _e, ...p}) => p),
};
const outPath = join('public', 'data', 'rides', `${id}.json`);
writeFileSync(outPath, JSON.stringify(ride));
// The index the page reads first: everything it needs to offer the ride, and nothing it must
// download to do so.
const indexPath = join('public', 'data', 'rides', 'index.json');
const index = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf8')) : {schemaVersion: 1, rides: []};
const summary = {id, title: ride.title, operator, vehicle, route: ride.route, direction: ride.direction,
  destination: ride.destination, recordedOn: ride.recordedOn, from: ride.from, fromLocal: ride.fromLocal,
  toLocal: ride.toLocal, seconds: ride.seconds, reports: ride.reports, file: `/data/rides/${id}.json`};
index.rides = [...index.rides.filter(r => r.id !== id), summary];
writeFileSync(indexPath, JSON.stringify(index, null, 1) + '\n');
console.log(JSON.stringify({...summary, bytes: readFileSync(outPath).length}, null, 1));
