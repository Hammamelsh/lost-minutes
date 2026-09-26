# 26 September 2026 — simpler everyday use, and the view from above

The owner's brief: keep two purposes in one app — everyday travel, immediately at hand, and an
exploration of Manchester from above that is distinctive without cluttering the practical flow — walk
the everyday tasks on the deployed build, fix the three most consequential points of confusion, research
genuine photographic 3D and build one bounded prototype, and finish with a decision. Everything here is
Chromium with SwiftShader (desktop and phone emulation) against fixtures or the served site; nothing on a
phone in hand; no user test was run, and none is claimed.

## 1. The deployed build, walked first

`7dd79be` on the served site, at 360 and 390 px, landscape, and two desktop heights
(`scripts/probes/passenger-layouts.mjs`, frames in `outputs/probes/passenger-layouts/before-7dd79be/`;
the three screens this milestone changed in `outputs/probes/everyday-flows/before-7dd79be/`). The audit
found no touch target under 44 px, no control covered, no sideways scroll. What it could not find is
what a first-time passenger does not understand, which the walk did:

- **Which side of the road.** *Stretford Mall* in the search gives Stops A, B, C and D as *eastbound ·
  Kingsway* or *westbound · Kingsway*; the chosen stop's head says the same. A passenger does not know
  which way is "eastbound"; they know they want the bus towards town.
- **Two answers to "when?".** Under the stop: *Next departures* — *11:44 · in 7 min · SCHEDULED* — and,
  below the services, *Coming to your stop* — *256 to Piccadilly Gardens · tracked · 8 stops before
  yours · 38 s ago*. Both true, neither referring to the other, and on a phone each departure row was
  three lines tall because its *SCHEDULED* box wrapped.
- **What the home is for.** Under *Buses near me*: the Explore block (three rides and a recording) came
  *before* *Or follow a route*, which offered a Route dropdown and a Direction dropdown under a route
  panel that already had direction chips; two controls for one choice. *Change* under a stop did not say
  what it changed.

Read but left alone: the planner's *From* field already says *this device, followed while the page is
open* against *a fixed starting point, not this device*, and the map draws *You* and *Starting point*
differently; the walk from a fixed start is labelled by the map's own legend. *Follow a bus, leave the
ride, change stops* worked as the ride record says. Nothing in the phone panel's architecture was
reopened.

## 2. What changed (`components/`, `lib/patterns.ts`)

1. **Where its buses go, at every offer of a stop.** `servicesAt` (one line and destination each, in
   line order, for the day) and `towardsWords` (*to Piccadilly Gardens (15, 255, 256) · to The Trafford
   Centre (250)*, the destination with most lines first, at most two named, the rest counted) in
   `lib/patterns.ts`; used by the search results (`components/stop-search.tsx`, a new line under the
   side of the road), *Stops near you* (`components/nearby.tsx`, in place of a list of lines) and the
   chosen stop's head (`components/follow-view.tsx`, before the compass word and the street). Node:
   `tests/patterns.test.mjs` (grouping, the count, the empty case, the catalogue's own stops).
2. **One answer where the board can tie a bus to a journey.** `components/departure-board.tsx` takes
   `trackedWords` from the stop board: a row whose vehicle reports that journey's own departure reads
   *Tracked · 8 stops before yours · reported 38 s ago* in the stop board's words, so the timetabled
   time and the bus's real place are one line. The per-row *SCHEDULED* box became the word *timetabled*
   beside the time (*timetabled · in 7 min*); the heading's *Scheduled · not live* badge and the basis
   line (*not predictions, and not adjusted for traffic*) are unchanged. `departures.spec` restated for
   the wording, with the heading's badge asserted alongside.
3. **The home, in order.** The Direction dropdown is gone (the chips choose; the Route dropdown stays
   for browsing every route, and six checks still drive it); the Explore block — now headed *Explore
   Manchester · ride along with a bus · the map follows it · not a film* — comes after *Or follow a
   route*; *Change* reads *Change stop* (`layout.spec`'s exact-name locator restated).

**Before and after** (same fixtures, same sizes): `outputs/probes/everyday-flows/{before-7dd79be,
after-simplify}/` — the search with the destinations under each side of the road, the stop with its
head and board, the home with the route panel; and the whole flow in
`outputs/probes/passenger-layouts/{before-7dd79be,after-simplify}/`. What a first-time passenger can now
do more easily: pick the side of the road by where its buses go; read a departure and the bus on it as
one fact; find the everyday controls before the exploration.

**Verified:** 262 Node tests (the new ones among them); typecheck; lint with no errors; the specs the
changes touch — departures, layout, try-ride, search, journey, navigation, journey-state, access,
passenger, scheduled, plan, chooser — **144 passed, 8 skipped by design, 2 failed in 12.5 minutes**,
the two being one check on both profiles that asserted the old *256 to Piccadilly Gardens* wording,
restated to the grouped words and then passing (2 of 2); then the full gate on the final build (§4).

## 3. Photographic 3D: the research, the choice, the prototype

`docs/PHOTO_3D_RESEARCH.md` has the evaluation from the providers' current pages (26 September 2026):
Google Photorealistic 3D Tiles (the only photographic mesh with a public API; Enterprise SKU, 1,000
root-tileset requests a month free then $6 per 1,000, the renderer's tile requests unbilled; no caching
beyond the tiles' headers; attribution by the renderer; and the terms' *no use with non-Google maps*
clause, which this OpenStreetMap-based app has to settle before shipping), Cesium ion (the same tiles
resold, non-commercial on the free tier) and Bluesky MetroVista (a photographic mesh of Manchester,
licensed through Esri UK, not a tile service). **Chosen: Google's tiles rendered by CesiumJS, loaded
only when asked for.**

**Built** (`lib/gods-eye.ts`, `components/gods-eye.tsx`, `scripts/vendor-cesium.mjs`, `pipeline/live.py`):
- offered only where `config.json` carries `photo3d`, which the collector writes from
  `LM_PHOTO3D_GOOGLE_KEY` (a browser key the owner restricts to this site's address and the Map Tiles
  API — the provider's own architecture for a public page; never committed or logged) or
  `LM_PHOTO3D_TILESET` (any tileset, labelled a sample); neither set, nothing is offered;
- CesiumJS 1.145 served from this site (`public/vendor/cesium/<version>/`, 14 MB on disk, the 6 MB
  library gzipping to about 1.5 MB), loaded by a script tag when the row *See Manchester from above* is
  tapped, never before; the version read at runtime from `version.json` beside it;
- **one drawing, two renderers**: the map reports what it drew every tick (`onDrawn`), the view draws
  exactly that — the chosen bus at its drawn place, every other bus stepped for the view's own reach
  (`mirror`); nothing restarts, nothing is chosen for the passenger, nothing hops;
- the interaction: the city from 1,400 m tilted; tap a bus, descend 2.6 s to 150 m behind and 95 m
  above it, follow; a pointer, wheel or touch takes the camera, *Return to bus* gives it back; *Exit*
  to the map with the same bus, stop and journey; reduced motion cuts;
- buses as 12 × 2.55 × 3.3 m boxes (the chosen one lime, the rest grey) with their route numbers,
  turned by the drawn heading, the ground under each measured against the mesh once a second
  (`clampToHeightMostDetailed`; 95 m above the ellipsoid until measured);
- one line says what it is; the renderer's credit line carries the provider's attributions; a tileset
  that cannot be loaded, no WebGL or no renderer gives one message and *Back to the map*.

**Measured** on the fixture tileset (a bounding region with nothing in it — the viewer, not any
imagery; `tests/browser/above.spec.mjs`, both profiles): the renderer ready **756–804 ms** after the tap
on this machine (its 6 MB from the local server), the tileset usable at **918–958 ms**; 9 buses drawn;
the tick **0.6–0.9 ms** at the median; the JavaScript heap 63–88 MB with the view open; the descent to
the chosen bus and the follow; a drag releasing the follow and *Return to bus* restoring it; leaving
with the same bus chosen and the map still drawing it from its reports. Frames:
`test-results/…/desktop-above-following.png`, `mobile-above-following.png`. **What this does not
measure**: the imagery (none was loaded), a phone's GPU, the network transfer of real tiles, and
whether the boxes sit on the photographed roads — all of which need the key (§5 of the research).

## 4. Gate and deploy

261 Node tests and 134 Python tests; typecheck; lint with no errors; the full browser gate on the
candidate **387 passed, 41 skipped by design, 2 failed in 1.2 hours** (Chromium with SwiftShader, desktop
and phone emulation). The two: the ride's drag-during-glide race (backlog 29's known intermittent; passed
on re-run) and the sign-tap check, whose logging this time showed the cause — the tap chose nothing,
because the signs' on-screen points are refreshed at the map's *idle*, which under load lags the
camera's rest by seconds; the points are now refreshed at `moveend` too, the check waits for them to
settle, and it passed 3 of 3 on both profiles with the view's checks. After that a build with three small
tidy-ups (the view's event handler destroyed on leaving, a lint fix, the probe's audit) was the candidate:
`above.spec` and the sign-tap check passed on it, 24 of 24. **Deployed as `b849bbf`**, the served page
chunk identical to the local build's (`43ebca86…`), `7dd79be` kept for rollback; the served
`config.json` carries no `photo3d`, so the view is not offered on the public site; the renderer's files
are served (`/vendor/cesium/version.json`, `Cesium.js` 6.0 MB). On the served site at 12:50 UTC: the three
changed screens captured (`outputs/probes/everyday-flows/served-b849bbf/`), and the fleet still drawing
485 buses, 316 in view and 234 moving at a 1.3 ms tick at a city zoom, a tapped grey bus becoming the
chosen bus with no hop (*Standing · as it was about 60 s ago · report 43 s old*). Seen on the way and
left open: at a neighbourhood zoom two other buses stepped 108 and 217 m between two samples a quarter of
a second apart — a repositioning is said for the chosen bus and silent for the rest (backlog 33), and
which this was is not known. Emulation only.

## 5. Decision

**Revise, not ship and not reject.** The photographic approach is technically sound (one drawing, one
renderer loaded on demand, the imagery a configuration on the server) and affordable at any plausible
use (§4 of the research). It cannot be judged on what matters — how Manchester looks from 1,400 m and
from 95 m behind a bus, and how a phone copes — until a key exists, and it must not go public until
the terms clause is read. The two steps are the owner's (`docs/PHOTO_3D_RESEARCH.md` §5); the day the
key is in the server's environment, the next publication offers the view and the checks in
`above.spec` run against it unchanged. If the low view reads poorly on real tiles, keep the map's own
street preview as the low view and offer this one from above only; backlog 34 holds that and the rest.
