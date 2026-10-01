# Journey state: what is kept, where, and which wins

Written 20 September 2026 before the implementation it describes, and implemented the same evening
(`lib/journey-context.ts`, `app/page.tsx`, `components/follow-view.tsx`; checked by
`tests/journey-state.test.mjs` and `tests/browser/journey-state.spec.mjs`). It came from two
defects observed on the live site: a stop restored from the device was rewritten into the address bar, so the next
open of that address was treated as a shared link and "won"; and a link's bus key named a
*vehicle*, so a vehicle that had since started another journey was adopted as the passenger's bus
on a stop it did not serve.

## Layers, each in its own store

| Layer | Store | Key | Lifetime | Written by |
|---|---|---|---|---|
| Saved stops | localStorage | `lost-minutes.stops.v1` | until removed | Save / Remove on a stop |
| Saved routes | localStorage | `lost-minutes.favourites.v1` | until removed | the star on a route |
| Recent stops | localStorage | `lost-minutes.recents.v1` | 30 days, last 6 | any deliberate stop choice (search, nearby, map, saved, recent) — never a link or a restore |
| Last journey (an **offer**) | localStorage | `lost-minutes.journey.v1` | 12 h | every journey change |
| Active journey (this tab) | sessionStorage | `lost-minutes.journey.session.v1` | the tab | every journey change |
| Walking origin the passenger chose | sessionStorage | `lost-minutes.walking-origin.v1` | the tab | Choose starting point |
| The address | URL `?stop&service&bus` | — | — | explicit choices and links only |

A **journey** is `{stop, service filter, bus}` where the bus is `operator|vehicle|route|direction`:
a vehicle *on a journey*. The old two-part key is still read, and restores the vehicle only if it
currently serves the linked stop.

## Precedence on load

1. **The address names a stop or a bus** → a link. It is honoured exactly: that stop, that filter
   shown as a removable chip, that bus if it is still on that journey (else "the bus this link
   named is now on another journey", and nothing chosen in its place). Saved preferences never
   change what a link opens.
2. **Else the tab has an active journey** → restored silently. This is a refresh, a return from
   Google Maps, or a return from the background: the same tab, the same passenger, the same choice.
3. **Else the device has a last journey under 12 h old** → **offered**, not applied: one chip,
   "Continue · Hillingdon Road (opp)", on the home screen. The address stays bare.
4. **Else** the home screen: search, saved stops, recent stops, Buses near me, browse routes.

## What each action does

| Action | Stop | Filter | Bus | Camera | Address | Recents | Saved |
|---|---|---|---|---|---|---|---|
| Choose a stop | set | **cleared** | kept only if it serves the new stop, else released and said so | 2D, fit | pushState (Back returns to the previous stop) | added | — |
| Change (no stop yet) | cleared | cleared | kept | 2D | pushState, marked as on the way (`history.state.lmIntermediate`); the stop chosen next replaces that entry, so Back from a stop returns to the previous *stop*, and Back from the way there undoes Change | — | — |
| Choose a service filter | — | set/toggled | — | fit | replaceState | — | — |
| Choose a bus (list, card, map, Follow, Ride) | — | — | pinned | as chosen | the screen below is made to name the bus (replaceState), then its details pushed (since 1 October 2026; replaceState before) | — | — |
| Stop following | — | — | released | 2D | replaceState | — | — |
| **New journey** | cleared | cleared | released | 2D | **`/`** (replaceState) | kept | kept |
| Continue (the offer) | set from the offer | set | restored if still on that journey | 2D, fit | replaceState | — | — |
| Back / Forward | from the address | from the address | from the address | fit | (browser) | — | — |
| Save / Remove stop | — | — | — | — | — | — | toggled |

"Cleared state must not resurrect": New journey clears the session store and the offer, and the
page's own restore record is set to nothing, so the address writer has no fallback to write from.

## What a link carries

Only public things: an ATCO code, a service key and a bus-on-journey key. Never where the
passenger is. The chosen walking origin is session-only and never in a link.

## Selection continuity is unchanged

Within a visit a pinned bus is never substituted: new reports, list order, filters, gestures,
theme changes and absence leave it alone; the same vehicle on another journey is kept, said so,
and neither followed nor estimated until the passenger continues (`lib/selection.ts`). The two
changes here are at the edges: a *stop change* releases a pin that does not serve the new stop
and says so, and a *link* restores a journey rather than a vehicle.

## A recorded ride is not a journey (23 September 2026)

`?ride=<id>` opens a published recording (`public/data/rides/`, `lib/recorded-ride.ts`): one
vehicle's reports on one journey, replayed at their own spacing in place of the live feed and badged
RECORDED RIDE. While one runs, nothing is written to either journey store or to the address as a
journey — a recorded bus must never become "the device's last journey" or a link that names a
vehicle that stopped reporting on the day. The address is `?ride=<id>` and the share inside it
copies that. Leaving (Back to live buses) lets the recorded bus go, restores the address, and the
live feed is fetched again; the layers above then apply as before. A link that names a recording
that does not exist says so and the page is otherwise the ordinary home.

## Screens in history (1 October 2026)

Until 1 October only a stop was a step in the browser's history; the search's matches, the planner, a bus's details
and the ride were the page's own state. The owner, finding his way to a conference from where he had parked, could
not get back from them: the phone's Back left the site from the search, and from a chosen journey went to an empty
start with the plan gone (`scripts/probes/nav-study.mjs`: 6 of 8 steps failed on the served site). Now every screen a
passenger opens is an entry, and the page's own Back (`data-panel-back`, named for where it goes) is the phone's Back:
`window.history.back()` whenever an entry of the page's own lies below, else "Back to the start".

An entry carries its screen in `history.state.lm` (`lib/nav.ts`): `panel` (home, stop, bus, plan), `ride`, `search`,
`route` (a route chosen from the search), `depth` (the page's own entries below it), `back` (the name of the screen
below, for the button) and `name` (its own, kept up to date as it changes: a planner becomes "your options"). The
address still carries the stop, the filter, the bus and the plan, and Back and Forward still apply it (`app/page.tsx`);
the screen is applied beside it (`applyEntry` in `components/follow-view.tsx`).

| Opened | History | Back from it |
|---|---|---|
| The search's matches | pushed, marked as on the way (`lmIntermediate`) | closes them; still on the page |
| A stop, a route or a place chosen from the matches | takes the matches' entry's place | the screen before the search |
| The planner (Plan, a place, Other options) | pushed | the screen it was opened from |
| A journey chosen from the planner (direct or with a change) | its first stop pushed | the options, with the places kept |
| A bus's details | the screen below made to name the bus, then pushed | that screen, the bus still chosen |
| Another bus from the details | in its place | the same screen as before |
| The ride | pushed over the screen it was entered from | that screen (Exit, Escape and Details do the same) |
| A stage of a journey with a change | in place (progress, not a new screen) | — |
| New journey | the start, in place | what came before it, as any undone step |

A reload keeps the screen it was on (the planner, a bus's details) and never a ride or the search's matches. Back or
Forward never begins a ride: a ride is begun by the passenger. On a computer, Escape is Back.
