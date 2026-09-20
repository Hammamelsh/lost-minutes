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
| Choose a bus (list, card, map, Follow, Ride) | — | — | pinned | as chosen | replaceState | — | — |
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
