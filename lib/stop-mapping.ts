/**
 * Which stop of a pattern each offset along its road shape is: the shape's explicit, versioned stop
 * mapping (pipeline/stop_mapping.py writes it; this reads it by the same rules).
 *
 * A road shape is built through a pattern's stops inside the service area only, so its offsets are not the
 * pattern's stops one for one: a pattern can start outside the area (inbound 15 calls at 14 stops first),
 * end outside it, leave and re-enter it, or call at a stop twice. Until 28 September 2026 a shape carried a
 * bare list of offsets and readers paired the k-th with the pattern's k-th stop, which was wrong for 284 of
 * the 560 published shapes. Version 2 names each offset's stop: its index in the pattern's full stop list and
 * its stop code. A mapping is used only when its version, pattern, stop count and every stop code agree with
 * the pattern held; anything else is refused, never paired by position.
 */
export const STOP_MAPPING_VERSION = 2;

export type StopOccurrence = {index: number; stop: string; offset: number};
export type StopMapping = {version: number; patternId: string; patternStopCount: number; source?: string; occurrences: StopOccurrence[]};

/** The offsets on the pattern's own stop indices (null where the road has no stop), or why the mapping is refused. */
export function alignedOffsets(mapping: unknown, pattern: {id: string; stops: string[]}, length?: number):
 {offsets: (number | null)[]} | {error: string} {
 if (!mapping || typeof mapping !== 'object') return {error: 'the shape carries no stop mapping (published before version 2)'};
 const m = mapping as Partial<StopMapping>;
 if (m.version !== STOP_MAPPING_VERSION) return {error: `stop mapping version ${String(m.version)}, not ${STOP_MAPPING_VERSION}`};
 if (m.patternId !== pattern.id) return {error: `the mapping is for ${String(m.patternId)}, not ${pattern.id}`};
 if (m.patternStopCount !== pattern.stops.length)
  return {error: `the mapping counts ${String(m.patternStopCount)} stops, the pattern ${pattern.stops.length}`};
 if (!Array.isArray(m.occurrences) || !m.occurrences.length) return {error: 'the mapping places no stop'};
 const offsets: (number | null)[] = pattern.stops.map(() => null);
 let lastIndex = -1, lastOffset = -Infinity;
 for (const occ of m.occurrences) {
  const {index, stop, offset} = (occ ?? {}) as Partial<StopOccurrence>;
  if (!Number.isInteger(index) || index! < 0 || index! >= pattern.stops.length || index! <= lastIndex)
   return {error: `occurrence index ${String(index)} out of order or out of range`};
  if (pattern.stops[index!] !== stop) return {error: `the mapping names ${String(stop)} at stop ${index}, the pattern ${pattern.stops[index!]}`};
  if (typeof offset !== 'number' || !Number.isFinite(offset) || offset < lastOffset)
   return {error: `offset ${String(offset)} at stop ${index} is not along the road in order`};
  if (length !== undefined && offset > length + 1) return {error: `offset ${offset} at stop ${index} is beyond the road`};
  offsets[index!] = offset;
  lastIndex = index!; lastOffset = offset;
 }
 return {offsets};
}
