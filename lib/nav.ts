/**
 * The passenger's screens in the browser's own history (1 October 2026).
 *
 * The owner, at a conference across the city, wanted the buses to it from where he had parked, and found the page
 * hard to find his way round: "when you click on something it's hard to go back". Walked as a phone on the served
 * site, the page's screens (the search's matches, the planner, a bus's details, the ride) were each its own state,
 * not a step in the browser's history: the phone's Back closed none of them. From the search it left the site; from
 * a chosen journey it went to an empty home and the plan was gone; and the planner had three ways out (Close, Back,
 * Show map), the stop none. Here every screen a passenger opens is one entry, and the page's own Back is the
 * phone's Back: the same step, named for where it goes.
 *
 * What an entry records, beside the address (which keeps the stop, the filter, the bus and the plan):
 *  - `panel`, the screen: the start, a stop's board, a bus's details, the planner, or a trip being made (4 October);
 *  - `ride`, whether the ride-along is on; `search`, whether the search's matches are open;
 *  - `route`, a route chosen from the search (at the start, with no stop);
 *  - `depth`, how many of the page's own entries lie below it: with none, Back would leave the site, and the page's
 *    button goes to the start instead;
 *  - `back`, the name of the screen below, for the button's words; `name`, this screen's own, kept up to date by the
 *    page as it changes (a stop's planner becomes "your options" once there are some), for the next one's `back`.
 */
export type Panel = 'home' | 'stop' | 'bus' | 'plan' | 'trip';
export type Screen = {panel: Panel; ride: boolean; search: boolean; route: string | null; depth: number; back: string | null; name: string};

const KEY = 'lm';
const PANELS = new Set<Panel>(['home', 'stop', 'bus', 'plan', 'trip']);

/** The screen a history entry records, or null for an entry the page did not write (or wrote before 1 October). */
export function screenOf(state: unknown): Screen | null {
 const s = (state as Record<string, unknown> | null | undefined)?.[KEY] as Partial<Screen> | undefined;
 if (!s || typeof s !== 'object' || !PANELS.has(s.panel as Panel)) return null;
 return {panel: s.panel as Panel, ride: Boolean(s.ride), search: Boolean(s.search),
  route: typeof s.route === 'string' ? s.route : null,
  depth: Number.isInteger(s.depth) && (s.depth as number) > 0 ? s.depth as number : 0,
  back: typeof s.back === 'string' ? s.back : null, name: typeof s.name === 'string' ? s.name : 'the start'};
}

/** A history state carrying `screen`, keeping whatever else the entry held (the page's other keys). */
export function withScreen(state: unknown, screen: Screen, extra: Record<string, unknown> = {}): Record<string, unknown> {
 return {...((state && typeof state === 'object') ? state as Record<string, unknown> : {}), ...extra, [KEY]: screen};
}

/** The next entry's screen, opened over `current`, whose name is its Back. */
export function pushed(current: Screen | null, next: Partial<Screen> & {panel: Panel}): Screen {
 return {ride: false, search: false, route: null, name: 'the start', ...next, depth: (current?.depth ?? 0) + 1, back: current?.name ?? 'the start'};
}

/** The same entry made into another screen: its depth and its way back are kept. */
export function replaced(current: Screen | null, next: Partial<Screen> & {panel: Panel}): Screen {
 return {ride: false, search: false, route: null, name: 'the start', ...next, depth: current?.depth ?? 0, back: current?.back ?? null};
}

/** The words on the page's Back: where it goes. With nothing of the page's own below, it goes to the start. */
export function backWords(screen: Screen | null): string {
 return `Back to ${screen && screen.depth > 0 && screen.back ? screen.back : 'the start'}`;
}

/** What a screen is called, as the Back of the screen above it names it. */
export function screenName(panel: Panel, {stop, route, planned}: {stop?: string | null; route?: string | null; planned?: boolean} = {}): string {
 if (panel === 'stop' && stop) return stop;
 if (panel === 'bus') return route ? `the ${route}` : 'the bus';
 if (panel === 'plan') return planned ? 'your options' : 'the planner';
 if (panel === 'trip') return 'your trip';
 return 'the start';
}
