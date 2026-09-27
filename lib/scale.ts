/**
 * The map's scale: how many metres one CSS pixel covers at a zoom and a latitude.
 *
 * MapLibre's world is 512 pixels wide at zoom 0, so a pixel there covers 40,075,016.686 m / 512 =
 * 78,271.517 m at the equator. The figure more often quoted, 156,543.03 m, is the scale of a
 * 256-pixel tile, and is exactly double. That figure sized the front view's roads until 26 September
 * 2026, so every road, pavement and centre line was drawn at half the width its metres named, and a
 * probe reported every distance it measured in pixels doubled. Everything that turns pixels into
 * metres or metres into pixels on this map takes it from here.
 */
export const EARTH_CIRCUMFERENCE_M=40075016.686;
/** The width of MapLibre's world at zoom 0, in CSS pixels. */
export const WORLD_PX_AT_ZOOM_0=512;

/** Metres per CSS pixel at `zoom`, `lat` degrees north. */
export function metresPerPixel(zoom:number,lat:number):number{
 return EARTH_CIRCUMFERENCE_M*Math.cos(lat*Math.PI/180)/(WORLD_PX_AT_ZOOM_0*2**zoom);
}
