/**
 * Daylight at Manchester, from the date and the latitude: which phase the sky is in now.
 *
 * The front view paints a sky. Until 20 September 2026 it had two, day and night, switched by
 * the map's theme rather than by the sun, so a ride at dusk was lit like noon. This works out the
 * sun's position from the standard solar equations (the NOAA form of Meeus), which need nothing
 * but the date, the longitude and the latitude: real inputs, no lookup table, no guess. Its
 * output is a phase — day, dusk, night, dawn — and the sunrise and sunset it rests on.
 *
 * Accuracy is a few minutes, which is all a sky colour needs. It is not a source of sunrise and
 * sunset times for anything that matters, and is not presented as one.
 */

export type DaylightPhase = 'day' | 'dusk' | 'night' | 'dawn';

export type Daylight = {
 phase: DaylightPhase;
 sunriseMs: number;
 sunsetMs: number;
 /** How far through the twilight band, 0 at its lit end and 1 at its dark end; 0 by day, 1 by night. */
 dark: number;
};

/** Manchester city centre: the whole service area is within a few minutes of arc of it. */
export const MANCHESTER = {lat: 53.4808, lon: -2.2426};

/** Civil twilight ends when the sun is 6° below the horizon; the sky is dark for our purposes by then. */
const CIVIL_DEPRESSION_DEG = 6;
const RAD = Math.PI / 180;

/** Days since J2000.0 at a given instant. */
const julianDay = (atMs: number) => atMs / 86_400_000 + 2440587.5;

/**
 * Sunrise and sunset on the UTC calendar day containing `atMs`, as epoch ms, for the sun's
 * centre at `depressionDeg` below the horizon (0.833 for the visible sunrise, 6 for civil
 * twilight). Null inside the polar circles, which Manchester is not.
 */
export function sunTimes(atMs: number, place = MANCHESTER, depressionDeg = 0.833): {rise: number; set: number} | null {
 const jd = julianDay(atMs);
 const n = Math.round(jd - 2451545.0 + 0.0008);                 // Julian day number since J2000
 const jStar = n - place.lon / 360;                               // mean solar noon, in days
 const M = (357.5291 + 0.98560028 * jStar) % 360;                // solar mean anomaly, degrees
 const C = 1.9148 * Math.sin(M * RAD) + 0.02 * Math.sin(2 * M * RAD) + 0.0003 * Math.sin(3 * M * RAD);
 const lambda = (M + C + 180 + 102.9372) % 360;                  // ecliptic longitude
 const jTransit = 2451545.0 + jStar + 0.0053 * Math.sin(M * RAD) - 0.0069 * Math.sin(2 * lambda * RAD);
 const delta = Math.asin(Math.sin(lambda * RAD) * Math.sin(23.4397 * RAD));   // declination
 const cosH = (Math.sin(-depressionDeg * RAD) - Math.sin(place.lat * RAD) * Math.sin(delta))
  / (Math.cos(place.lat * RAD) * Math.cos(delta));
 if (cosH < -1 || cosH > 1) return null;
 const H = Math.acos(cosH) / RAD;                                 // hour angle, degrees
 const toMs = (j: number) => (j - 2440587.5) * 86_400_000;
 return {rise: toMs(jTransit - H / 360), set: toMs(jTransit + H / 360)};
}

/** The phase of the sky at an instant, and how dark the twilight is. */
export function daylightAt(atMs: number, place = MANCHESTER): Daylight {
 const visible = sunTimes(atMs, place, 0.833);
 const civil = sunTimes(atMs, place, CIVIL_DEPRESSION_DEG);
 if (!visible || !civil) {
  // Polar day or night: not Manchester, but never crash a sky over it.
  return {phase: 'day', sunriseMs: atMs, sunsetMs: atMs, dark: 0};
 }
 const {rise, set} = visible;
 const dawnStart = civil.rise, duskEnd = civil.set;
 if (atMs >= rise && atMs <= set) return {phase: 'day', sunriseMs: rise, sunsetMs: set, dark: 0};
 if (atMs > set && atMs <= duskEnd) return {phase: 'dusk', sunriseMs: rise, sunsetMs: set, dark: (atMs - set) / Math.max(1, duskEnd - set)};
 if (atMs >= dawnStart && atMs < rise) return {phase: 'dawn', sunriseMs: rise, sunsetMs: set, dark: (rise - atMs) / Math.max(1, rise - dawnStart)};
 return {phase: 'night', sunriseMs: rise, sunsetMs: set, dark: 1};
}
