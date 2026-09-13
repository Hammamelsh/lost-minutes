# What Lost Minutes can take from God's Eye View and the Bee Network

Research note, 13 September 2026. Written to answer one question: which ideas from
[God's Eye View](https://github.com/bilawalsidhu/gods-eye-view) (GEV) and from the Bee Network
app would make Lost Minutes easier and better-looking for a passenger, without breaking the
project's own rules. Everything here was read from the sources named; nothing is proposed as
implemented. Status words as in `PROJECT_CONTEXT.md`.

## 1. God's Eye View, as read

**What it is.** A browser globe on CesiumJS with Google Photorealistic 3D Tiles, vanilla
JavaScript and Vite: 625 non-media files, 427 under `src/`, MIT-licensed code. Live layers:
aircraft (OpenSky, adsb.lol), ships (AISStream), satellites (CelesTrak, SGP4), earthquakes
(USGS), public cameras (Austin, Caltrans, TfL JamCams), radio, bikeshare (GBFS), NASA fires,
launches, plus bundled datacenters, dams and submarine cables. Voice control is an OpenAI
Realtime session with 28 tools. It reached #1 on GitHub Trending in August 2026 and has about
30,800 stars.

**What is not MIT.** Its LICENSE carves out every dataset and model: the TeleGeography cables
are CC BY-NC-SA (non-commercial), the OSM extracts are ODbL, Google Map Tiles content may not
be cached or rehosted, OpenSky is non-commercial. Its media GIFs are not licensed for reuse.
So GEV is inspiration for design and technique; none of its data or assets transfers.

**What it needs to look the way it looks.** The photoreal 3D globe needs a Cesium ion token
(free tier is for personal, non-commercial use) or a billed Google Maps key, and both keys are
injected into the browser bundle by design (their `.env.example` says so). Lost Minutes' rules
forbid keys in the browser and paid services without approval, so the photoreal tier is out.
GEV starts keyless on Esri imagery with an OSM fallback, which is the same posture Lost
Minutes already has with OpenFreeMap.

**The engineering ideas worth copying** (from its README "Under the Hood", `docs/`, and the
source files read: `renderGovernor.js`, `retryableLoad.js`, `trailRenderer.js`,
`iconOrientation.js`, `sharelink.js`, `splitFlap.js`, `motionModel.js`,
`docs/APPLICATION.md`, `docs/KNOWN-ISSUES.md`, `docs/PERFORMANCE.md`):

| GEV idea | What it is | Fits the evidence rule? |
|---|---|---|
| World-stable icons | Aircraft and ships point along their true heading at every camera angle | Yes, if the heading is reported, not inferred |
| Click-to-track with a trail | Selecting a contact locks the camera and draws its recent path | Yes for observed fixes; no for a smooth line between them |
| Contacts roster | A list of everything nearby, one tap to jump between them | Yes |
| Share links | Camera, layers and one tracked target serialised into the URL hash | Yes |
| Honest labels | Simulated traffic and reconstructed launches are labelled as such on screen | Already our rule |
| Render governor | Stop repainting when nothing moves; request one frame per change | MapLibre already does this |
| Retryable loader | A failed data pack is retried with doubling backoff, never cached as failed for the session | Yes |
| First-run missions | Four one-tap starting points instead of a blank globe | Yes |
| Split-flap status chips | Departure-board flip when a status label changes | Only under `prefers-reduced-motion: no-preference` |
| Interpolation and dead reckoning | Positions eased between 15–30 s fixes | **Superseded 13 Sep 2026.** The owner approved clearly labelled, bounded estimates. They follow validated road shapes, are scored against held-out reports, and are never drawn or stored as a fix (`lib/motion.ts`) |
| GLSL sensor styles (CRT, NVG, FLIR) | Post-processing over the globe | Not for a passenger; MapLibre has no post-effect pass |
| Voice agent | OpenAI Realtime, metered with a hard cap | No: a key, a cost, and an AI feature for its own sake |
| Photoreal 3D | Google tiles through Cesium | No: browser-exposed key, billing, non-commercial terms |

## 2. The Bee Network app, as read

From [tfgm.com](https://tfgm.com/tickets-and-passes/ways-to-pay/bee-network-mobile-app) the
app offers: journey planning with expected arrival times, live departures for bus, tram and
train, "Track your bus live on map and see live locations for all buses from a stop near
you", ticketing, alerts and journey rating. The live tracker arrived with phase two of
franchising on 24 March 2024 ([CiTTi](https://www.cittimagazine.co.uk/news/buses-commercial-vehicles/tfgm-adds-new-journey-planner-and-live-bus-tracker-to-bee-network-app.html)).

What passengers say, from the App Store listing and its review digest
([App Store](https://apps.apple.com/gb/app/bee-network/id1669705230),
[review digest](https://mwm.ai/apps/bee-network/1669705230)): a 4.0 store rating over about
3,900 ratings, but written reviews average 1.7 over 514. The recurring complaints are ghost
buses on the map, live times "consistently a few minutes out", crashes, tickets that need a
connection, and an interface people "can't make head nor tail of". TfGM has said publicly
that ghost buses are "one of our biggest challenges" and that live countdowns can be based
on where a bus is supposed to be rather than where it is
([Manchester World](https://www.manchesterworld.uk/news/manchester-bee-networks-ghost-buses-leave-passengers-waiting-for-services-that-never-arrive-5009551)).

That is exactly the gap Lost Minutes is built around: it shows the last *reported* position
with its age, never a countdown, and withholds anything older than the cut-off. The product
question is how to make that honesty feel better than the official app, not how to add a
countdown.

Also relevant: [bustimes.org](https://bustimes.org/data) draws every BODS vehicle with its
reported heading and route number and keeps a per-vehicle history page. It is the closest
existing open-data product and a fair benchmark.

## 3. Recommendations, in order

Each item says what it needs and which rule it touches. None is started by this note.

**1. Draw the direction of travel.** The SIRI-VM feed carries `<Bearing>`: in one capture on
12 September, 334 of 539 vehicle activities had one, with 213 distinct values. The collector
drops it. Store `bearing` on each observation, publish it per vehicle, and render a rotated
chevron (`icon-rotate` from the property, `icon-rotation-alignment: map`) in MapLibre and a
rotated path in the SVG fallback; a bus without a bearing keeps the plain dot. This is the
single biggest visual gain available and it is *reported data*, so it needs no inference.
Pipeline change: a column, a publisher field, a schema field, tests. Size: small.

**2. A trail of observed fixes for the selected bus.** The warehouse already holds every
report. Publish the last ten minutes of observed positions for each published vehicle (or a
separate `trails.json`), and draw them as fading dots, no connecting line. GEV's trail is a
polyline; ours must not be, because the road between two fixes was never observed. Size:
medium (payload design, a new file, a layer).

**3. Next and previous bus while following.** GEV's contacts roster, reduced to one thing: a
pair of buttons on the follow panel to step through the other buses on the route, in the
order the list already uses. Frontend only. Size: small.

**4. Share what you are looking at.** Route, direction, stop and selected bus in the URL
hash, restored on load, so "this one, at Stretford Mall" is a link. Frontend only, no
server. Size: small.

**5. First-run cards.** Three starting points above the map on a first visit: *Find my
stop*, *Follow a bus*, *See what was recorded*. This answers the Bee Network complaint about
an interface people cannot read. Size: small.

**6. Light and dark basemap.** OpenFreeMap serves `liberty`, `bright` and `positron` beside
`dark`, all keyless. A one-tap style switch, with the added layers re-applied on `style.load`,
gives daylight readability at a bus stop. Size: small.

**7. Alerts.** BODS also publishes SIRI-SX disruptions. Ingesting them is the one Bee Network
feature Lost Minutes lacks that is available under the same licence. Pipeline change,
separate milestone. Size: medium.

**Answered directly: "can't you use actual road names, maybe Google Maps?"** Road names are
already on the map. They come from OpenStreetMap through OpenFreeMap's vector tiles, free and
without a key, and the browser checks now assert that the glyphs and tiles load. Google Maps
would require a key in the browser and billing, which the project rules forbid.

**Not recommended:** sensor-style shaders, voice control and photoreal 3D, for the reasons in
the table above. Interpolation was on this list until the owner approved labelled, bounded
estimates on 13 September 2026 (`PROJECT_CONTEXT.md`, "Estimated position"). The 3D city view already in the app (OpenMapTiles building
heights) is the keyless equivalent and stays.
