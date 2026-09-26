# Photographic 3D for Lost Minutes: what exists, what it costs, what was built

26 September 2026. The owner asked for an optional "God's-eye" experience with recognisable real
Manchester buildings — photographic 3D, not another presentation of the map's extruded blocks — and
for one bounded prototype. This is the research behind the choice, from the providers' own current
documentation (fetched on 26 September 2026; figures quoted, not remembered), and the decision.

Terms used strictly. **Photographic 3D mesh**: a textured surface model built from aerial photographs
by photogrammetry, buildings and ground in one skin (Google Earth's 3D cities). **Satellite imagery**:
a flat picture draped on terrain; no building sides. **Building extrusion**: footprints raised to a
height (what the map's City view draws from OpenStreetMap). **Street panoramas**: photographs from a
car at street level (Street View), not a model. Only the first is what was asked for.

## 1. The candidates

### Google Photorealistic 3D Tiles (Map Tiles API)

- **What it is.** Google's photogrammetric mesh — the same data as Google Earth's 3D cities — served in
  the OGC 3D Tiles format for any conforming renderer. Google documents CesiumJS (1.91+) and Cesium
  for Unreal, and gives deck.gl examples (8.9.13+); a root tileset request is
  `https://tile.googleapis.com/v1/3dtiles/root.json?key=…`, after which "the renderer can make at least
  three hours of tile requests from a single root tileset request".
- **Coverage.** Google publishes no city list on the tiles' pages ("many of the world's populated
  areas"); coverage is Google Earth's 3D coverage. Greater Manchester has had 3D mesh in Google Earth
  for years, and a 2024 Google Earth update note names "north and east Manchester and parts of Salford,
  Urmston and Stretford" as refreshed. **Coverage and quality in the city centre, at Trafford Bar and
  in Stretford were not seen from here**: the tiles need a key with billing, and nothing was bought
  (§4). This is the first thing to look at once a key exists.
- **Price** (Google's pricing list, 26 September 2026): SKU *Map Tiles API: Photorealistic 3D Tiles*
  (C6E1-98B2-DBD0), **Enterprise** tier, billed **per 1,000 root tileset requests** ("events"):
  **1,000 free a month**, then **$6.00 per 1,000** up to 100,000, $5.10 to 500,000, falling to $2.40
  above five million. The renderer's tile requests after the root are **not billed and not quota'd**
  ("Tile requests for Photorealistic 3D Tiles don't impact your daily quota"); the root requests are
  capped at **10,000 a day** by default, a cap the owner can lower in the console — a genuine limit,
  unlike a budget alert, which only warns.
- **Terms that bind** (Map Tiles API policies and the Maps Platform terms):
  - the renderer must display the attributions: "you must use a 3D Tiles renderer that supports the
    display of copyright attribution", aggregated "in a line", and the Google Maps logo (16–19 dp, with
    clear space) — CesiumJS does this with `showCreditsOnScreen: true`, which is why it is the renderer
    here;
  - no caching beyond what the tiles' own `Cache-Control` allows: "must not pre-fetch, index, store, or
    cache any Content" except as the headers permit; no offline use, no extraction;
  - our own 3D objects may be overlaid "as long as the 3D objects aren't extracted, traced, or
    otherwise derived … from Photorealistic 3D Tiles" — our buses qualify;
  - **the clause that matters most for this app**: "Customer will not use the Google Maps Core Services
    with or near a non-Google Map in a Customer Application" (Terms of Service, *No Use With Non-Google
    Maps*). Lost Minutes is built on an OpenStreetMap basemap. The Map Tiles API is a Google Maps Core
    Service. Whether a view that shows only Google's tiles and our buses, opened from an app whose
    everyday map is OpenStreetMap, is "with or near a non-Google Map in a Customer Application" is a
    question of the terms' reading, not of engineering. **It has to be settled before the view is
    shipped publicly** (§5).
- **Renderer integration.** CesiumJS is Google's reference (`Cesium3DTileset.fromUrl(root, {showCreditsOnScreen:
  true})`, plus `RequestScheduler.requestsByServer['tile.googleapis.com:443'] = 18`), with terrain in
  the mesh itself (no separate elevation), picking, `clampToHeightMostDetailed` for putting our own
  objects on the mesh, a camera that flies and follows, and touch controls. Cost: the library is
  6 MB of JavaScript before compression (about 1.5 MB gzipped) plus workers and assets loaded on
  demand, served from this site like MapLibre (`scripts/vendor-cesium.mjs`), and it is loaded only
  when the view is opened. deck.gl's `Tile3DLayer` would be lighter and could sit over the MapLibre
  map, but its markers live at ground height zero while the mesh carries real terrain (the city sits
  40–60 m above sea level and about 95 m above the WGS84 ellipsoid), it does not handle attribution
  for us, and it would put Google's tiles directly on the OpenStreetMap canvas — the very thing the
  terms clause is about.

### Cesium ion (Google tiles resold, and Cesium's own data)

Cesium ion offers Google's Photorealistic 3D Tiles through its own token: Community (free) **1,000 root
tiles a month, "personal and non-commercial use"** only; Commercial $149 a month, 5,000; Premium $499,
10,000 (Cesium's pricing page, 26 September 2026). Its own global data (Cesium World Terrain, OSM
Buildings) is not photographic. It adds a second provider and a second set of terms for the same
imagery, and the free tier's non-commercial restriction is a poor fit for a public site; a direct
Google key is simpler and cheaper. **Not chosen.**

### Bluesky MetroVista (UK photographic mesh, via Esri UK)

Bluesky's MetroVista is a photogrammetric mesh of British cities, and **Manchester is in its coverage**
(with London, Birmingham, Bristol, Nottingham and others), distributed through Esri UK as I3S scene
layers and as OBJ/FBX. It is licensed data for GIS and digital-twin customers, not a pay-as-you-go
tile service: no public price, a licence and an ArcGIS platform to host it. For a portfolio site
with a free basemap it is the wrong shape. **Not chosen; noted as the one alternative photographic
source for Manchester.**

### What is not photographic, and is not offered as such

Esri's and Cesium's "3D buildings", Mapbox Standard's landmark models and OpenStreetMap extrusions are
building blocks or hand-made models; satellite imagery on terrain has no building sides. None answers
the request, and none is presented here as if it did.

## 2. The decision

**Google Photorealistic 3D Tiles, rendered by CesiumJS, as an optional view loaded on request** — the
only photographic source with a public API, affordable at any plausible use of this site, with
attribution handled by the renderer. **Blocked on two things the owner holds: a key with billing, and
a reading of the "no use with non-Google maps" clause** (§5). Everything else is built (§3).

## 3. What was built (`lib/gods-eye.ts`, `components/gods-eye.tsx`)

- **Configuration, not code.** The server offers the view through `config.json`'s `photo3d` block,
  written by the collector from `LM_PHOTO3D_GOOGLE_KEY` in the server's `.env` — a browser key the
  owner restricts to this site's address and to the Map Tiles API, which is Google's own architecture
  for a public page; never in Git, never in a log. Without it the block is absent and nothing is
  offered. `LM_PHOTO3D_TILESET` names any other 3D Tiles tileset, labelled as a sample: a check of
  the viewer, never presented as Manchester.
- **One drawing, two renderers.** The map reports every bus it draws, every tick, at its drawn
  position (`onDrawn`); the view draws those and nothing else. Choosing, following, opening and
  leaving never restart a journey, choose another bus, or move one. While the view is open the map
  steps the buses the view can see (`mirror`) and leaves its own canvas alone.
- **The interaction.** Open on the city from 1,400 m, tilted; tap a bus to descend behind it (2.6 s)
  and follow from 150 m back and 95 m up; a drag, wheel or pinch takes the camera ("Looking around"),
  *Return to bus* gives it back; *Exit* returns to the map. Reduced motion: cuts, no glides.
- **On the imagery, not floating.** The ground under each bus is measured against the mesh once a
  second (`clampToHeightMostDetailed`), so buses sit on the photographed roads rather than at an
  assumed height; until measured, 95 m above the ellipsoid (Manchester's centre).
- **Said plainly, once.** The bar: *Imagery captured earlier by the provider, not a live camera; buses
  where their own reports put them, a little behind.* The renderer's credit line carries the
  provider's logo and data attributions.
- **Fails safe.** No WebGL, no renderer, no tileset (a wrong key, no network): one message and *Back
  to the map*; the map underneath is untouched.
- **Measured** (`data-above-ready-ms`, `data-above-usable-ms`, `data-above-stats`: buses drawn, the
  tick's median cost, frames rendered, JavaScript heap): see `docs/RELEASE.md` for the figures on the
  fixture tileset. The figures that matter — imagery quality at the two camera heights, frame times
  on a phone's GPU, network transfer of Google's tiles — **need the key and a phone**.

## 4. Cost, with the provider's own units

Superseded on 26 September 2026 by `docs/PHOTO_3D_PREVIEW.md` §3, which states the unit exactly: **one
root tileset request** each time the view is opened (a reload or a second tab is another), none for
the tiles after it, and a new one only if the view is reopened after its session of about three hours.
It recommends a daily quota of 25 for a private trial, which bounds a 31-day month at 775 requests,
inside the free 1,000, so $0.00 at most. This section's earlier example of 500 a day would allow up to
$87.00 a month and is not recommended.

## 5. The steps only the owner can take

Superseded on 26 September 2026 by two documents.
- **`docs/PHOTO_3D_TERMS.md`** has the terms clause verbatim, what this app does, and the question to
  send Google. The earlier suggestion here, to host the view at its own address, is withdrawn: a second
  address the owner controls is still a "Customer Application", and no evidence was found that it
  changes the reading.
- **`docs/PHOTO_3D_PREVIEW.md`** has the key's setup, now private by default.

Putting the key on the server no longer offers the view to the public. It offers it only at the
password-protected `/preview/`. The public page needs `LM_PHOTO3D_PUBLIC=1` as well, and that is the
owner's decision once the terms question is settled.

Until a key exists, the viewer is exercised with a sample tileset (`LM_PHOTO3D_TILESET`), and is
labelled as a sample wherever it shows.
