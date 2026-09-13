import {z} from 'zod';

/**
 * A recorded window-seat journey: someone else's film from a real bus, shown through the
 * video service's own permitted embed and never copied. Every fact about it is either stated
 * by the creator, read from the service, or absent; nothing is filled in. It belongs to the
 * Explore tab and has nothing to do with any bus tracked live.
 */
const dateCertainty = z.enum([
 'stated_by_creator',   // the creator wrote the filming date in the description or title
 'published_date_only', // only the upload date is known; filming may have been earlier
 'unknown',
]);

/** A moment in the video tied to a place, kept only once someone has checked both. */
const chapterSchema = z.object({
 seconds: z.number().nonnegative(),
 label: z.string().min(1),
 stopId: z.string().nullable(),
 lat: z.number(), lon: z.number(),
 verified: z.literal(true),
 basis: z.string().min(1),
});

export const journeySchema = z.object({
 id: z.string().regex(/^[a-z0-9-]+$/),
 title: z.string().min(1),
 video: z.object({
  provider: z.literal('youtube'),
  id: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
  url: z.string().url(),
  /** The provider's privacy-enhanced embed host: no cookies until playback starts. */
  embedUrl: z.string().url().startsWith('https://www.youtube-nocookie.com/embed/'),
  titleAsPublished: z.string().min(1),
  creator: z.object({name: z.string().min(1), url: z.string().url(), channelId: z.string().min(1)}),
  publishedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  lengthSeconds: z.number().int().positive(),
  /** When embedding was last confirmed against the service (the owner can turn it off). */
  embeddableCheckedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  licence: z.string().min(1),
 }),
 recording: z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  timeLocal: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  dateCertainty,
  basis: z.string().min(1),
 }),
 route: z.object({
  line: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  direction: z.enum(['inbound', 'outbound']).nullable(),
  basis: z.string().min(1),
  operatorAtRecording: z.string().nullable(),
  operatorNote: z.string().min(1),
  /** The line and direction to look up in today's timetable, for orientation only. */
  todayLookup: z.object({line: z.string(), direction: z.enum(['inbound', 'outbound'])}).nullable(),
 }),
 stopsAsListedByCreator: z.array(z.string().min(1)),
 highlights: z.array(z.object({name: z.string().min(1), note: z.string().min(1)})),
 chapters: z.array(chapterSchema),
 chaptersNote: z.string().min(1),
});

export const windowSeatSchema = z.object({
 schemaVersion: z.literal(1),
 generatedAt: z.string(),
 journeys: z.array(journeySchema).min(1),
 notes: z.array(z.string()),
});

export type WindowSeatJourney = z.infer<typeof journeySchema>;
export type WindowSeat = z.infer<typeof windowSeatSchema>;

export function parseWindowSeat(value: unknown): WindowSeat {
 const parsed = windowSeatSchema.parse(value);
 for (const journey of parsed.journeys) {
  if (!journey.video.embedUrl.endsWith(`/embed/${journey.video.id}`))
   throw Error(`${journey.id}: the embed URL does not name the video`);
  if (journey.recording.dateCertainty === 'stated_by_creator' && !journey.recording.date)
   throw Error(`${journey.id}: a date stated by the creator must be given`);
 }
 return parsed;
}

/** The player URL: the privacy-enhanced host, the message API on, and this page named as the
 *  origin so the player answers only it. Nothing is loaded until the passenger asks. */
export function playerUrl(journey: WindowSeatJourney, origin: string) {
 const query = new URLSearchParams({enablejsapi: '1', rel: '0', playsinline: '1', origin});
 return `${journey.video.embedUrl}?${query}`;
}

/** The player's state numbers, as its message API reports them. */
export const PLAYER_STATE: Record<number, string> = {
 [-1]: 'not started', 0: 'ended', 1: 'playing', 2: 'paused', 3: 'buffering', 5: 'ready',
};

/** "Filmed 3 June 2022, 18:35, as stated by the creator", or what is actually known. */
export function recordingWords(recording: WindowSeatJourney['recording'], publishedAt: string) {
 const day = (iso: string) => new Intl.DateTimeFormat('en-GB', {dateStyle: 'long', timeZone: 'Europe/London'}).format(Date.parse(`${iso}T12:00:00Z`));
 if (recording.dateCertainty === 'stated_by_creator' && recording.date)
  return `Filmed ${day(recording.date)}${recording.timeLocal ? `, ${recording.timeLocal}` : ''}, as stated by the creator`;
 if (recording.dateCertainty === 'published_date_only') return `Published ${day(publishedAt)}; the filming date is not stated`;
 return `Filming date unknown; published ${day(publishedAt)}`;
}
