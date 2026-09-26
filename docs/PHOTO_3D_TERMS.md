# Google's terms and the view from above

Written 26 September 2026 for the owner, who decides whether and how the view from above goes public.
It covers what Google's terms say, what this app actually does, and the question to send Google.
Nothing has been sent to Google. No account, key or billing has been set up.

## 1. What was read

Everything below was read on 26 September 2026 from Google's own pages. The words in quotation marks
are verbatim.

| Page | Date on the page |
|---|---|
| Google Maps Platform Terms of Service | last modified 26 August 2026 |
| Google Maps Platform Service Specific Terms | no section for the Map Tiles API |
| Map Tiles API policies | last updated 24 September 2026 |
| Photorealistic 3D Tiles overview, and Map Tiles API usage and billing | last updated 24 September 2026 |
| Google Maps Platform pricing list | last updated 24 September 2026 |

The owner's billing address would be in the UK. Google's EEA-specific terms apply to billing addresses
in the European Economic Area, which does not include the UK, so the standard terms above are the
ones that apply.

## 2. The clause in question

Terms of Service, section 3.2.3(e):

> "No Use With Non-Google Maps. To avoid quality issues and/or brand confusion, Customer will not use
> the Google Maps Core Services with or near a non-Google Map in a Customer Application. For example,
> Customer will not (i) display or use Places content on a non-Google Map, (ii) display Street View
> imagery and non-Google Maps on the same screen, or (iii) link a Google Map to non-Google Maps
> Content or a non-Google Map."

Three facts decide how this reads for Lost Minutes.

- **The Map Tiles API is a Core Service.** Google's services list names it among the Maps services.
- **"Google Map" is not defined** in the terms. Neither is "near".
- **"Customer Application" is broad:** "any web page or application (including all source code and
  features) that has material value independent of the Services and is owned or controlled by
  Customer, or that Customer is authorized to use."

That last definition matters for one idea that has come up: moving the view to another hostname. A
second address the owner controls is still a Customer Application, and linking to it from the
OpenStreetMap app is what example (iii) describes. **No evidence was found that another hostname
changes the answer**, so this document does not rely on it.

## 3. Two different permissions

### Cesium, and our own buses on Google's imagery: allowed in principle

The Map Tiles API policies address both directly.

- **A third-party renderer is expected.** The policies have a section headed "Display the Google Maps
  logo with third-party renderers", and Google's own guide names CesiumJS.
- **Our own 3D objects may be overlaid.** The policy says: "You may overlay your own 3D objects on
  Photorealistic 3D Tiles as long as the 3D objects aren't extracted, traced, or otherwise derived by
  hand or machine from Photorealistic 3D Tiles." Our buses are boxes generated from Bus Open Data
  Service positions. Nothing about them is traced from the imagery.
- **A mixed scene must say which part is Google's.** The policy says "you must ensure your audience
  fully understands which portion of the map visualization is attributed to Google and which portions
  are attributed to your own map data."

One detail needs Google's view. To stand each bus on the ground, the app reads the height of the
imagery's surface under that bus while the view is open, using Cesium's `clampToHeightMostDetailed`.
The height is used for drawing only and is never stored. Whether that counts as "derived" is question 3
below.

### Integration with the OpenStreetMap app: not settled by the text

This is where the clause bites. What the app actually does:

- **Separate full-screen views.** The everyday map is MapLibre over OpenStreetMap-based tiles. The view
  from above is a separate full-screen Cesium view showing Google's imagery and nothing from
  OpenStreetMap. The two are never on one screen.
- **Navigation between them.** A row under *Explore Manchester* opens the view. *Exit* returns to the
  map.
- **Shared bus selection.** The bus chosen on the map is the bus followed in the view, and a bus tapped
  in the view becomes the chosen bus on the map.
- **Independent vehicle data.** Every bus position comes from the Department for Transport's Bus Open
  Data Service, published under the Open Government Licence.
- **OSM-derived route geometry.** Buses on a checked route are drawn travelling along a road shape
  built by routing on OpenStreetMap data (Valhalla). No OpenStreetMap map content is displayed in the
  view, but where a bus is drawn can depend on that shape.

Example (ii) is about the same screen, and this app never does that. But the examples are introduced
with "for example", so they are not the whole rule. Whether separate screens in one app are "near",
and whether navigation and a shared selection "link" the two maps, is a reading question. Only Google
can answer it with authority.

## 4. The question to send Google

The owner sends this through Google Maps Platform support, which comes with a billing account, or
through its sales contact form. Nothing is sent from here.

> **Subject: Photorealistic 3D Tiles in an app whose main map is OpenStreetMap — Terms 3.2.3(e)**
>
> Hello. I am building Lost Minutes, a small non-commercial Manchester bus app. Its everyday map is
> MapLibre over OpenStreetMap-based vector tiles. I would like to add an optional view that shows
> Photorealistic 3D Tiles, rendered with CesiumJS. I want to be sure this is allowed under section
> 3.2.3(e) before I release it.
>
> How it works:
> 1. The 3D view is a separate full-screen view. It shows only your tiles, plus simple 3D boxes for
>    buses. It never shares a screen with the OpenStreetMap map.
> 2. A button in the app opens the 3D view, and an Exit button returns to the OpenStreetMap map.
> 3. The bus the user chose on the map is the bus the 3D camera follows. Tapping a bus in the 3D view
>    makes it the chosen bus back on the map.
> 4. Bus positions come from the UK government's Bus Open Data Service (Open Government Licence), not
>    from Google.
> 5. Along some routes, buses are drawn travelling along road shapes derived from OpenStreetMap
>    routing. No OpenStreetMap map content appears in the 3D view.
> 6. To stand each bus on the ground, the app reads your mesh's surface height under the bus while
>    the view is open. Nothing is stored.
> 7. The view shows the Google Maps logo and your data attributions through Cesium's credit display,
>    with our own data credited separately.
>
> My questions:
> 1. Is a separate full-screen 3D view of this kind "with or near a non-Google Map" under 3.2.3(e),
>    given that the same app's main map is OpenStreetMap?
> 2. Do the buttons between the two views, or carrying the selected bus from one to the other, count
>    as linking a Google Map to a non-Google Map (example iii)?
> 3. Is reading the mesh height at runtime to place our own boxes acceptable under the overlay policy
>    ("not extracted, traced, or otherwise derived")?
> 4. Is showing bus positions that follow OpenStreetMap-derived road shapes acceptable as our own
>    overlay content in the 3D view?
>
> If this arrangement is not allowed, is there an arrangement you would accept?
>
> Thank you.

## 5. What applies to this app, and what is built

### Attribution

| Requirement (Map Tiles API policies) | Done here | Checked |
|---|---|---|
| The official "Google Maps" logo, unmodified, outlined on busy imagery | `public/attribution/google-maps-logo-light-outline.svg`, Google's own asset | Browser check, fixture |
| Logo 16–19 dp high; clear space 10 dp left, right and top, 5 dp below | 18 px high, 10 px from the left, 6 px from the bottom | Browser check measures it |
| Accessibility label "Google Maps" | `alt="Google Maps"` | Browser check finds it by that name |
| Not overlapping, and apart from, the renderer's logo | Cesium's logo follows Google's data attributions on the same line, at least 10 px from Google's logo | Browser check measures the gap |
| Google's data attributions shown in full, in the 3D view | Cesium's credit display, which shows the credits of the tiles on screen | **Not verified**: needs real tiles |
| Our data credited apart from Google's | A separate line: "Buses: Bus Open Data Service (OGL) … roads: © OpenStreetMap contributors" | Browser check |
| Mixed scene says which part is Google's | The view's note says the imagery is the provider's and the buses are ours | Browser check |

### Terms notice and privacy

- **Terms notice (section 3.2.2(a)(i)).** The app's terms must tell users it includes Google Maps
  features and content, subject to the Google Maps End User Additional Terms of Service and the Google
  Privacy Policy. The site's notes now include *The view from above* with both links, wherever Google
  imagery is offered. The view links them too.
- **What Google receives (section 4.4(a)).** Google collects "search terms, IP addresses, and
  latitude/longitude coordinates". Opening the view sends Google the device's IP address and the tile
  requests for what is on screen. The site's note says so.
- **No personal data from us (section 4.4(c)(ii)).** Customer must not provide Google "any End User's
  personally identifiable information" or "any European End User's Personal Data", where European
  includes the UK. The view sends no user data of ours, and never the device's location: it opens on
  the city or on the chosen bus.
- **Location (section 4.4(c)(iii)).** Users must be told in advance what is collected, and location
  must not be obtained without consent. The view uses no location. The app's own location use is
  unchanged and already asks first.
- **Cookies and the Consent Policy (section 4.4(c)(i)).** Whether tile responses set cookies was not
  checked. **Check this at the first real load**: look for `set-cookie` on responses from
  tile.googleapis.com in the browser's network panel.
- **Caching.** Content must not be cached beyond what its `Cache-Control` headers allow. The service
  worker only handles this site's own requests, so it never stores Google's tiles.

### Promotional video

The policy allows promotional videos only under all of these conditions:

- no Street View imagery;
- **no more than 30 seconds** long;
- about the app's capabilities;
- **clearly marked "for promotional purposes only"**, with the Google Maps attribution kept visible;
- not resold, separately or as part of anything;
- every takedown request honoured, including third parties' requests.

`scripts/probes/demo-recording.mjs` records about 30 seconds of the app. A recording that shows the view
from above must also keep the logo and credit line uncropped and carry the caption. **No such video
exists yet.** Posting one anywhere is the owner's decision.

## 6. What stays off until the question is answered

- **Public release stays off.** `LM_PHOTO3D_PUBLIC` is unset, so the public page never offers the view
  (`docs/PHOTO_3D_PREVIEW.md`).
- **A private preview is still a use.** It sits inside the same Customer Application, so the same
  terms apply. What a password limits is who sees it, not the reading question. Running a private
  trial before Google answers is the owner's call.
