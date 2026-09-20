/**
 * Where a walk starts from, and how much that is worth believing.
 *
 * Until 20 September 2026 the page kept a bare {lat, lon} and a sometimes-present accuracy, used
 * accuracy once as a 200 m gate, and threw away the fix's own timestamp. So when an owner standing
 * on Kenwood Road was given a confident "5 min walk · 400 m" that appeared to start from Norwood
 * Road, nothing on the page or in the code could say why: a wrong fix, a stale fix and a correct
 * fix all looked identical afterwards. That is the defect this module exists to remove. It does not
 * assert what caused that particular discrepancy; it makes the next one answerable.
 *
 * Two kinds of origin, kept apart on purpose:
 *   device  — what the browser's geolocation reported, with its own accuracy and timestamp;
 *   chosen  — a point the passenger confirmed themselves, which outranks the device until they
 *             explicitly go back to it.
 *
 * Nothing here talks to a network. The Google Maps link is a URL, not an API: no key, no billing,
 * no request from this page.
 */

export type LatLon = {lat: number; lon: number};

export type DeviceOrigin = LatLon & {
 kind: 'device';
 /** `coords.accuracy`: the radius of 95% confidence in metres, or undefined if the browser withheld it. */
 accuracyMetres?: number;
 /** `position.timestamp`, not when we stored it. */
 takenAtMs: number;
};

export type ChosenOrigin = LatLon & {
 kind: 'chosen';
 /** What the passenger picked it as: an address they searched, or "a point on the map". */
 label: string;
 chosenAtMs: number;
};

export type Origin = DeviceOrigin | ChosenOrigin;

/**
 * How far wrong the start could be, in bands rather than a number, because a number invites
 * arithmetic the accuracy figure does not support.
 *
 * `confident`  a fix tight enough that the street it lands on is probably the right street;
 * `uncertain`  usable, but the start could be a street or two out, and the page must say so;
 * `too_rough`  not worth routing from at all;
 * `unknown`    the browser gave no accuracy, which is not the same as a good fix.
 */
export type ConfidenceBand = 'confident' | 'uncertain' | 'too_rough' | 'unknown';

export type OriginConfidence = {
 band: ConfidenceBand;
 accuracyMetres?: number;
 ageMs?: number;
 /** One short clause for beside the walking estimate, or null when nothing needs saying. */
 caveat: string | null;
 /** Whether a walking time may be stated as a plain answer rather than a hedged one. */
 mayStateConfidently: boolean;
};

export const ORIGIN_RULES = {
 /** A good phone fix outdoors. Below this, the street is very likely right. */
 confidentMetres: 40,
 /** Above this the start could be several streets out; routing from it is not worth doing. */
 tooRoughMetres: 150,
 /** A fix this old may describe where you were, not where you are. */
 staleMs: 5 * 60_000,
} as const;

const metres = (m: number) => m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;

function ageWords(ms: number) {
 const s = Math.round(ms / 1000);
 if (s < 90) return `${s}s`;
 const m = Math.round(s / 60);
 return m < 90 ? `${m} min` : `${Math.round(m / 60)} h`;
}

/** Judge an origin. `nowMs` is passed in so this stays pure and testable. */
export function originConfidence(origin: Origin | null, nowMs: number): OriginConfidence {
 if (!origin) return {band: 'unknown', caveat: null, mayStateConfidently: false};

 // A point the passenger confirmed is as good as we can get. We do not second-guess it, and it
 // carries no accuracy radius because it is not a measurement.
 if (origin.kind === 'chosen') return {band: 'confident', caveat: null, mayStateConfidently: true};

 const accuracyMetres = origin.accuracyMetres;
 const ageMs = Math.max(0, nowMs - origin.takenAtMs);
 const stale = ageMs > ORIGIN_RULES.staleMs;

 if (accuracyMetres === undefined) {
  return {band: 'unknown', ageMs, mayStateConfidently: false,
   caveat: 'your device did not say how accurate this position is'};
 }
 if (accuracyMetres > ORIGIN_RULES.tooRoughMetres) {
  return {band: 'too_rough', accuracyMetres, ageMs, mayStateConfidently: false,
   caveat: `your position is only known to about ${metres(accuracyMetres)}`};
 }
 if (accuracyMetres > ORIGIN_RULES.confidentMetres) {
  return {band: 'uncertain', accuracyMetres, ageMs, mayStateConfidently: false,
   caveat: `your position could be about ${metres(accuracyMetres)} out, so the street this starts from may be wrong`};
 }
 if (stale) {
  return {band: 'uncertain', accuracyMetres, ageMs, mayStateConfidently: false,
   caveat: `this position was taken ${ageWords(ageMs)} ago`};
 }
 return {band: 'confident', accuracyMetres, ageMs, caveat: null, mayStateConfidently: true};
}

/** The options for `getCurrentPosition`. A separate export so a test can assert on them. */
export const FRESH_POSITION_OPTIONS: PositionOptions = {
 // Ask for the best the device will give. This is a request, not a guarantee: the browser may
 // answer with a network fix anyway, which is exactly why accuracy is now recorded and shown
 // rather than assumed.
 enableHighAccuracy: true,
 timeout: 15_000,
 // Never reuse a cached fix when the passenger has asked to be located. The old value, 60 s,
 // could answer an explicit "Locate me" with the position from before they walked round a corner.
 maximumAge: 0,
};

export function fromGeolocation(position: {coords: {latitude: number; longitude: number; accuracy: number}; timestamp: number}): DeviceOrigin {
 return {
  kind: 'device',
  lat: position.coords.latitude,
  lon: position.coords.longitude,
  accuracyMetres: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : undefined,
  takenAtMs: Number.isFinite(position.timestamp) ? position.timestamp : Date.now(),
 };
}

// ------------------------------------------------------------------ Google Maps hand-off

/**
 * A walking hand-off to Google Maps, as a plain URL in their documented `api=1` form.
 *
 * The destination is always **coordinates**, never the stop's name. Hillingdon Road has two
 * boarding points 40 m apart facing opposite ways (1800SJ32251 heading north-east, 1800SJ32261
 * heading south-west); a search for the name could land on either, or on the road itself, and
 * would send a passenger across the carriageway. The ATCO code travels in the link's own text for
 * anyone checking, not as a search term.
 *
 * The origin is omitted unless the passenger has chosen one. Omitting it lets Google use the
 * device's own location, which is likely better than ours and is theirs to ask for; sending a
 * doubtful origin would launder our uncertainty into somebody else's app.
 */
export function googleMapsWalkingUrl(
 stop: {lat: number; lon: number},
 origin?: Origin | null,
): string {
 const parameters = new URLSearchParams({
  api: '1',
  destination: `${stop.lat},${stop.lon}`,
  travelmode: 'walking',
 });
 if (origin && origin.kind === 'chosen') parameters.set('origin', `${origin.lat},${origin.lon}`);
 return `https://www.google.com/maps/dir/?${parameters.toString()}`;
}

/** What the hand-off button should say, given whether a start point will be sent. */
export function googleMapsLinkLabel(origin?: Origin | null) {
 return origin && origin.kind === 'chosen'
  ? 'Google Maps, from your chosen start'
  : 'Google Maps';
}
