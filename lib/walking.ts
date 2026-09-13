/**
 * Walking directions to the chosen boarding point, from a real pedestrian router.
 *
 * The route comes from an OSRM server's foot profile over OpenStreetMap paths: by default the
 * FOSSGIS service at routing.openstreetmap.de, whose policy asks for attribution, a "fix the
 * map" link, at most one request a second and no heavy use, and which logs requests. The
 * request carries your position rounded to about 10 m and the stop's position. It is sent only
 * after you ask, is not logged by this page, and never goes into a link.
 *
 * When there is no walking route the page says so. A straight-line distance is never
 * presented as a walking distance, and a driving route is never substituted.
 */
import {z} from 'zod';

export type LatLon = {lat: number; lon: number};

export const walkingConfigSchema = z.object({
 provider: z.enum(['osrm', 'none']),
 baseUrl: z.string().min(1).nullable().optional(),
 profile: z.string().default('foot'),
 name: z.string().default('the walking router'),
 operator: z.string().default(''),
 policyUrl: z.string().nullable().optional(),
 privacyUrl: z.string().nullable().optional(),
 fixTheMapUrl: z.string().default('https://www.openstreetmap.org/fixthemap'),
 attribution: z.string().default('Walking route from OpenStreetMap data'),
 maxStraightLineMetres: z.number().positive().default(3000),
 minSecondsBetweenRequests: z.number().positive().default(10),
 timeoutSeconds: z.number().positive().default(8),
 inaccurateMetres: z.number().positive().default(200),
 note: z.string().optional(),
});
export type WalkingConfig = z.infer<typeof walkingConfigSchema>;

export const DEFAULT_WALKING: WalkingConfig = {
 provider: 'osrm', baseUrl: 'https://routing.openstreetmap.de/routed-foot', profile: 'foot',
 name: 'routing.openstreetmap.de', operator: 'FOSSGIS e.V.',
 policyUrl: 'https://www.fossgis.de/arbeitsgruppen/osm-server/nutzungsbedingungen/',
 privacyUrl: 'https://www.fossgis.de/datenschutzerklärung',
 fixTheMapUrl: 'https://www.openstreetmap.org/fixthemap',
 attribution: 'Walking route: OSRM foot profile on routing.openstreetmap.de (FOSSGIS e.V.), OpenStreetMap data',
 maxStraightLineMetres: 3000, minSecondsBetweenRequests: 10, timeoutSeconds: 8, inaccurateMetres: 200,
};

export type WalkingRoute = {
 kind: 'route';
 metres: number; seconds: number;
 path: [number, number][];      // lon, lat, as the router returned it
 startGapMetres: number;        // how far the router moved each end onto a mapped path
 endGapMetres: number;
 from: LatLon; to: LatLon; stopId: string;
 fetchedAt: number; provider: string;
};

export type ProblemCode = 'disabled' | 'no_location' | 'inaccurate' | 'too_far' | 'no_route' | 'unreachable'
 | 'rate_limited' | 'timeout' | 'failed';
export type WalkingProblem = {kind: 'problem'; code: ProblemCode; message: string; retry: boolean};

const problem = (code: ProblemCode, message: string, retry = false): WalkingProblem => ({kind: 'problem', code, message, retry});

const EARTH = 6371008.8, RAD = Math.PI / 180;
export function straightMetres(a: LatLon, b: LatLon) {
 const x = (b.lon - a.lon) * Math.cos(((a.lat + b.lat) / 2) * RAD) * EARTH * RAD;
 return Math.hypot(x, (b.lat - a.lat) * EARTH * RAD);
}

export const distanceWords = (m: number) => m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(1)} km`;

/** About 11 m north-south and 7 m east-west here: enough to route from, less than a GPS fix. */
export const roundForRouting = (p: LatLon): LatLon => ({lat: Math.round(p.lat * 1e4) / 1e4, lon: Math.round(p.lon * 1e4) / 1e4});

export function walkingUrl(config: WalkingConfig, from: LatLon, to: LatLon) {
 const base = (config.baseUrl ?? '').replace(/\/+$/, '');
 return `${base}/route/v1/${encodeURIComponent(config.profile)}/${from.lon},${from.lat};${to.lon},${to.lat}`
  + '?overview=full&geometries=geojson&alternatives=false&steps=false';
}

/** Reasons not to ask the router at all, decided before any request leaves the device. */
export function preflight(here: (LatLon & {accuracyMetres?: number}) | null, stop: LatLon,
                          config: WalkingConfig): WalkingProblem | null {
 if (config.provider === 'none' || !config.baseUrl)
  return problem('disabled', 'Walking directions are switched off for this site.');
 if (!here) return problem('no_location', 'Walking directions start from your location. Use Locate me, or find the stop on the map.');
 if ((here.accuracyMetres ?? 0) > config.inaccurateMetres)
  return problem('inaccurate', `Your location is only known to about ${distanceWords(here.accuracyMetres!)}, too rough to plan a walk from. Try Locate me again.`, true);
 const straight = straightMetres(here, stop);
 if (straight > config.maxStraightLineMetres)
  return problem('too_far', `You are about ${distanceWords(straight)} from this stop in a straight line, too far to plan a walk here.`);
 return null;
}

export type RouteRequest = {stopId: string; from: LatLon; at: number};

/**
 * Whether a new location is worth a new route. A phone's fix wanders by tens of metres while
 * it stands still; asking the router again for that would be noise to the passenger and
 * load on a shared service.
 */
export function rerouteDecision(last: RouteRequest | null, next: {stopId: string; here: LatLon & {accuracyMetres?: number}; now: number},
                                config: WalkingConfig): {go: boolean; reason: string} {
 if (!last) return {go: true, reason: 'first route'};
 if (last.stopId !== next.stopId) return {go: true, reason: 'a different stop'};
 const moved = straightMetres(last.from, next.here);
 const jitter = Math.min(300, Math.max(40, 2 * (next.here.accuracyMetres ?? 0)));
 if (moved < jitter) return {go: false, reason: `moved ${Math.round(moved)} m, within location jitter (${Math.round(jitter)} m)`};
 if (next.now - last.at < config.minSecondsBetweenRequests * 1000)
  return {go: false, reason: 'too soon after the last request'};
 return {go: true, reason: `moved ${Math.round(moved)} m`};
}

const osrmSchema = z.object({
 code: z.string(), message: z.string().optional(),
 routes: z.array(z.object({distance: z.number().nonnegative(), duration: z.number().nonnegative(),
  geometry: z.object({type: z.literal('LineString'), coordinates: z.array(z.tuple([z.number(), z.number()])).min(2)})})).optional(),
 waypoints: z.array(z.object({distance: z.number().optional(), location: z.tuple([z.number(), z.number()])})).optional(),
});

/** Read an OSRM answer. Anything that is not a usable walking route becomes a stated problem. */
export function readOsrm(body: unknown, context: {from: LatLon; to: LatLon; stopId: string; at: number; provider: string}):
 WalkingRoute | WalkingProblem {
 const parsed = osrmSchema.safeParse(body);
 if (!parsed.success) return problem('failed', 'The walking router sent an answer this page could not read.', true);
 const data = parsed.data;
 if (data.code === 'NoRoute') return problem('no_route', 'The walking router found no path between you and this stop.');
 if (data.code === 'NoSegment') return problem('unreachable', 'The walking router could not find a mapped path near you or near the stop.');
 const route = data.routes?.[0];
 if (data.code !== 'Ok' || !route) return problem('failed', 'The walking router could not plan this walk.', true);
 const waypoints = data.waypoints ?? [];
 return {kind: 'route', metres: route.distance, seconds: route.duration, path: route.geometry.coordinates,
  startGapMetres: waypoints[0]?.distance ?? 0, endGapMetres: waypoints[waypoints.length - 1]?.distance ?? 0,
  from: context.from, to: context.to, stopId: context.stopId, fetchedAt: context.at, provider: context.provider};
}

/**
 * Ask the router. Only the rounded origin and the stop are sent; the Referer carries this
 * site's origin alone, and no cookies go with it.
 */
export async function fetchWalkingRoute(config: WalkingConfig, here: LatLon, stop: LatLon & {id: string},
                                        options: {fetchImpl?: typeof fetch; now?: () => number; signal?: AbortSignal} = {}):
 Promise<WalkingRoute | WalkingProblem> {
 const from = roundForRouting(here), to = {lat: stop.lat, lon: stop.lon};
 const controller = new AbortController();
 const abort = () => controller.abort();
 options.signal?.addEventListener('abort', abort);
 const timer = setTimeout(abort, config.timeoutSeconds * 1000);
 try {
  const response = await (options.fetchImpl ?? fetch)(walkingUrl(config, from, to),
   {signal: controller.signal, credentials: 'omit', referrerPolicy: 'origin', cache: 'no-store'});
  if (response.status === 429) return problem('rate_limited', 'The walking router asked us to slow down. Try again in a moment.', true);
  const body = await response.json().catch(() => null);
  if (!response.ok && !body) return problem('failed', `The walking router answered ${response.status}.`, true);
  return readOsrm(body, {from, to, stopId: stop.id, at: (options.now ?? Date.now)(), provider: config.name});
 } catch {
  return controller.signal.aborted && !options.signal?.aborted
   ? problem('timeout', 'The walking router did not answer in time.', true)
   : problem('failed', 'Walking directions could not be fetched just now.', true);
 } finally {
  clearTimeout(timer);
  options.signal?.removeEventListener('abort', abort);
 }
}

/** "7 min · 520 m", at the router's own walking pace. */
export function walkWords(route: Pick<WalkingRoute, 'metres' | 'seconds'>) {
 return {time: `${Math.max(1, Math.round(route.seconds / 60))} min`, distance: distanceWords(route.metres)};
}

/** Consent is per browsing session, and can be withdrawn by closing the tab. */
export const WALKING_CONSENT_KEY = 'lost-minutes.walking-consent.v1';
