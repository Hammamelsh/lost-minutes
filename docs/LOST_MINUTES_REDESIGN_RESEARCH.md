# Lost Minutes: from bus positions to a useful passenger experience

**Research and implementation brief for Hammam Elshtewi — 12 September 2026**

**Recommendation:** Keep the existing project and data pipeline. Build the passenger experience around a selected stop, a clear destination and the buses that actually serve that stop. Add a geographically rich, optional 3D city view using the same trusted data. This gives the project both practical value and a striking demonstration of the engineering underneath it.

This review uses the three supplied screenshots, Claude Code’s report for commit `f00a1ec`, and the primary sources listed at the end. The latest repository, deployed application and real capture were not independently inspected here. Statements about tests, database contents and live performance are attributed to that report. Visual findings are limited to the screenshots. Proposed interface copy and numerical examples below are illustrative, not measurements of a Manchester service.

## 1. What is good, and what needs to change

Claude’s report describes meaningful progress: preserved raw inputs, queryable history, validation, quarantine, atomic publication, separate timestamps, and a live collection run that reached the browser. Those are relevant data-engineering skills. They should survive the redesign.

The passenger experience is much less developed. A person waiting for a bus needs to resolve a short chain of questions:

1. Is this my stop, on the correct side of the road?
2. Which service here goes towards my destination?
3. Which of the buses shown actually serves this stop and has not already passed it?
4. Where was that bus last reported, and how far along its route is it from me?
5. Can I trust what the screen is telling me right now?

The current interface answers only part of the fourth question. Its largest visual element shows positions with little geographical or passenger context. Better styling alone will not supply the missing relationships.

It is not literally limited to route 142: the other screenshots show routes 42 and 15, and the report mentions 114 observed route labels. The problem is that the available services are poorly introduced and hard to explore. Also, an observed route label is not proof that every direction, variant or stop on that route is supported.

### Screenshot audit

| Finding | Passenger consequence | Required change |
|---|---|---|
| Route selection starts with a bare number such as 142 | New users must already know the service | Offer stop and route search with names, destinations and recent selections |
| Open dropdown has pale text on a white surface | Options are difficult to read | Fix native control colours immediately; then use an accessible searchable picker |
| Map is dominated by coarse roads and a few district labels | A dot is hard to relate to a recognisable place | Add street names, parks, water, landmarks, stop names and scale |
| No selected stop appears | Distance and relevance have no reference point | Make “Your stop” a persistent selection with a prominent map marker |
| “Both ways” mixes directions | Users can follow a bus going away from them | Present destination-based choices; retain all-directions exploration separately |
| Multiple rows repeat the same route and destination | Buses are hard to distinguish | Add supported stop progress, position age and consistent map/list selection |
| Selected bus appears in both a detail card and a similar list row | Space is used without adding much information | Use one dominant selected-bus card, followed by clearly distinct alternatives |
| Most other buses are anonymous cyan dots | Map and list are difficult to connect | Give relevant buses route labels and a consistent selected state |
| Large empty map area and an uneven desktop layout | Screen size does not translate into useful information | Fit the selected stop and relevant buses; balance map and passenger detail |
| One screenshot says “LIVE updated 111s ago” and “reported 24s ago” | Freshness semantics appear inconsistent | Trace the two values before changing wording; see section 8 |
| Screenshots use both localhost:3000 and :3001, and live versus archive modes | Comparisons may involve different builds or sources | Reproduce issues against one known build and explicitly selected data mode |

Do not turn this audit into an instruction to replace the backend. The UI needs richer, validated data products from the existing backend.

## 2. What comparable products teach us

The research focused on first-party product descriptions, published design examples, open-source documentation and official data specifications. It did not include hands-on passenger testing of competing apps, and vendor feature claims are not evidence that Lost Minutes already has equivalent coverage.

| Reference | Relevant pattern | Transfer to Lost Minutes | Boundary |
|---|---|---|---|
| **Transit 6.0** | Strong hierarchy between map, selected route, direction and departure cards | One dominant passenger answer; readable route identity; an ordered stop strip | Its large arrival numbers depend on arrival data. Do not imitate the numbers before earning them |
| **Citymapper’s live bus map** | Tracking is reached through a stop and service; the map relates to departures | Select the stop, then the relevant service; make map and list selection agree | The referenced example concerns Toronto, not verified Manchester coverage |
| **Bee Network** | Local bus tracking, stops, departures and saved favourites | Treat familiar local expectations as a baseline | A general Manchester bus map alone is weak differentiation |
| **Mini Tokyo 3D** | Recognisable geography, simple vehicles, selective tracking and optional replay | An optional city overview with restrained 3D buildings and clear route context | Animated movement is not necessarily a direct GPS observation |

### Transit: hierarchy worth borrowing

Transit’s August 2025 redesign explicitly revisits typography, search, route details and dark mode. Its published before-and-after image makes a selected route and upcoming departures much easier to identify. The useful lesson is priority: a passenger should immediately see the information that determines their next action. Lost Minutes can apply that principle to supported route progress and position age while arrival predictions are unavailable. Use original typography and assets rather than copying Transit’s branding. [1]

### Citymapper: context before tracking

The referenced Citymapper feature starts from a stop’s departures and then a selected route; selecting a vehicle exposes its last update. This is a useful interaction precedent for linking “my stop” to “that bus.” The article also recognises incomplete vehicle visibility. It is a historical Toronto example, not proof of a current feature or feed available to this project. [2]

### Bee Network: the local benchmark

TfGM’s app listing already describes live bus locations, nearest stops, departure information, favourites and journey planning. Lost Minutes therefore needs a sharper reason to exist than “Manchester buses on a map.” My recommendation is unusually clear stop-based tracking, visible freshness, understandable route progress and a credible account of how the data was produced. That is a product hypothesis to test with passengers, not a claim of established superiority. [3]

### Mini Tokyo 3D: the strongest visual reference

Mini Tokyo combines recognisable geography with simplified vehicles and selectable views. Its documentation explains that displayed movement can use schedules and real-time updates; smooth animation should not be mistaken for a sequence of GPS measurements. Borrow its spatial clarity and camera discipline. The repository is MIT-licensed, but external datasets, map services and assets have their own conditions. [4][5]

Reference images inspected for this review: [Transit route details](https://blog.transitapp.com/wp-content/uploads/2025/08/Route-Details-Before-After-EN-8.png), [Transit dark mode](https://blog.transitapp.com/wp-content/uploads/2025/08/DarkMode-6.0-EN-14-scaled.png), and [Mini Tokyo 3D city view](https://minitokyo3d.com/docs/master/images/hero.jpg). These are design references, not assets supplied for reuse in the app.

## 3. The product I recommend

### Primary experience: Your stop

The landing screen should offer **“Find a stop or route”**, **“Use my location”** and saved stops. A returning user can open their saved stop immediately. Location permission should be requested only after the user chooses that action; manual search must work equally well without it.

Do not lead with an unrestricted “Where to?” journey-planning box unless the app can actually plan journeys. Start with a promise it can fulfil: finding a stop or a service.

After a stop is selected, show its name, locality and available direction/stand information. Opposite-side stops can have similar names, so a name alone is insufficient. The user must be able to inspect and change the physical stop.

Present services at that stop as readable cards: route number, destination and an honest availability state. A selected service reveals eligible buses approaching the stop. A small stop sequence then explains the relationship between the selected bus and the passenger’s boarding point.

The map should fit the selected stop and relevant approaching bus or buses with padding for the panel. For a bus far away, avoid zooming so far out that the stop becomes unreadable: offer “Show bus and stop” and keep the stop sequence useful independently of the map.

### Example card hierarchy

All values in this table are interface examples. They must never become production defaults or fixtures presented as live observations.

| Order | Example content | Condition for showing it |
|---|---|---|
| 1 | **Your stop: [verified stop name and stand]** | Stop selected from the stop catalogue |
| 2 | **142 towards [verified destination]** | Direction and service identity resolved |
| 3 | **3 stops before yours** | Ordered stop sequence and bus progress validated; counting convention defined |
| 4 | **About 1.2 km along the route** | Relevant route geometry, direction and bus progress validated |
| 5 | **Position reported 18 seconds ago** | Age derived from the original observation timestamp |
| 6 | **Track this bus** / **Change stop** | Explicit actions with persistent selection |

If route matching is unresolved, replace the progress statement with “We can show this bus’s reported position, but cannot yet confirm its progress to this stop.” Keep that bus out of a list claiming confirmed approaching services.

“Three stops before yours” needs an explicit counting convention: whether the boarding stop itself is included, and what happens when a vehicle is between stops. Prefer a visible sequence that removes ambiguity. Do not translate a coarse GPS observation into “at the stop” without a validated rule.

### Secondary experience: City view

This is the home for the “God’s-eye” visual ambition: Manchester as a recognisable moving transport scene, with selectable routes, real reported positions, map labels and optional building height. Selecting a bus should reveal its service and freshness, and allow the passenger to return to their stop.

City view and Your stop should share one data contract, one selection model and one freshness policy. Do not create a separate cinematic dataset that quietly has different truth rules.

Archive replay remains explicit, with its date and playback controls. Never switch a passenger from unavailable live data into historical motion automatically. An archive demo can be impressive and useful as long as it is unmistakably a replay.

### Navigation

Use passenger language for the first choices: **Your stop** and **City view**. Preserve **Evidence** and **Operations** as accessible secondary destinations. The technical work remains part of the product, but a person finding a bus should not need to understand publication hashes or quarantine tables.

## 4. A visual direction that adds clarity

I recommend MapLibre GL JS with a proper vector basemap. MapLibre’s official building example demonstrates pitched views and building extrusions over an OpenFreeMap style, making a restrained 3D treatment feasible without starting a separate rendering stack. This is a proposed choice; Claude should inspect the current implementation before integrating it. [6]

For an initial pilot, OpenFreeMap is a credible provider to evaluate. It currently advertises a free public instance without keys or registration, supports commercial use and offers several styles. Treat those published terms as a current offering, not a service-level guarantee. Keep the provider configurable and preserve required attribution. [7]

### Art direction

- **Geography first:** legible streets, district labels, waterways, parks and selected landmarks. A muted city surface makes the meaningful overlays stand out.
- **A recognisable selected stop:** a labelled stop marker with a distinct shape. User position and bus position must not share the same icon.
- **Meaningful route colour:** a selected route has one consistent accent in the map, cards and stop sequence. Freshness uses separate text and status symbols.
- **Restrained depth:** optional pitch around 35–45 degrees, modest building extrusion at useful zoom levels, and labels that remain readable. Buildings should not hide the bus or boarding stop.
- **A clear selected bus:** a route badge and an orientation cue when direction or bearing is supported. Keep arbitrary compass rotation out of the passenger view.
- **Motion with a purpose:** gentle camera transitions and a short selection emphasis. Do not make every object pulse continuously.
- **Bright outdoor use:** provide a tested light style as well as the dark treatment. A dark screenshot looking attractive indoors does not establish readability at a bus stop.

The normal passenger view should start in 2D, north up. The user can deliberately enter the tilted city view. If they pan, automatic following stops until they tap a clear recenter action. Returning to 2D should take one action.

Do not label connecting GPS observations as a bus route. Use a validated published or derived route shape with its provenance, or label the line as an observation trail. Sparse observed points cannot establish the exact road the vehicle travelled.

### What to avoid

Avoid decorative radar sweeps, invented accuracy circles, fake live movement, large anonymous glows and map-sized grids that carry no meaning. A ring styled as selection is fine; a ring presented as a quantified location-uncertainty boundary needs evidence.

Begin with MapLibre layers and simple symbols. The reported 155 published vehicles do not by themselves justify introducing deck.gl, Cesium, Kafka, or a custom Three.js city. Introduce another dependency only when an actual requirement or measured limit warrants it.

### Mobile and accessibility

Use a bottom sheet for stop and bus details, with the map remaining visible. Give it a visible expand/collapse control so dragging is not the only interaction. The first useful mobile screen should contain search or the selected stop, service direction, the primary supported status and some geographical context.

Aim for 44 CSS-pixel interactive targets as a design target; do not misstate this as the universal WCAG minimum. Check normal text at 4.5:1 contrast, visible focus, high-contrast and zoomed layouts, keyboard use and reduced-motion behaviour. [17]

A custom search control needs an accessible name, predictable keyboard behaviour, an announced selection and sensible focus restoration. Reuse a suitable maintained component when the current stack already has one; a searchable dropdown is not a reason to invent a fragile accessibility framework. The WAI combobox pattern is a reference for behaviour, not a guarantee that a component is accessible merely because it uses the right roles. [12]

For devices without usable WebGL or a failing tile service, preserve stop search and the textual bus list. A map failure should not remove the product’s essential information.

## 5. Fix discovery and coverage before claiming broad support

Three different catalogues need to remain distinguishable:

1. **Stops:** known physical boarding points from the relevant stop dataset.
2. **Scheduled services:** routes and variants present in the available, applicable timetables.
3. **Observed vehicles:** services currently or recently seen in the selected live feed.

The route picker should not be rebuilt solely from the buses present in the latest publication. A service with no fresh report should remain findable when its catalogue entry is known. Its state may be “No recent vehicle reports” or “Live tracking not yet matched,” not “cancelled.”

Use naturally sorted route labels, including suffixes such as 42A, and display destination and operator or variant when needed to distinguish identical numbers. Preserve the selected stop and service while updates arrive; do not silently switch to a busier route.

Search should work by stop name, locality and route number. A bounded local index of imported stops and routes avoids the need for an external geocoder for this first experience. Do not implement per-keystroke autocomplete against the public Nominatim service: its policy prohibits that use. A later general address-search feature needs an appropriate provider and explicit operating assumptions. [15]

The current Greater Manchester bounding box is another coverage boundary. A route can extend outside it. A bus leaving the collected area has not necessarily finished its service; a stop near the boundary may need observations beyond it to display approaching vehicles usefully. Inspect the configured bounds against the selected pilot corridor and size any expansion deliberately.

## 6. What the timetable and stop data are needed for

The timetable URL was not necessary to prove that the app can show reported positions. It becomes relevant to the features now being requested. A bus-to-stop experience needs to know the stops a particular service visits, their order, direction and applicable service pattern.

NaPTAN provides a national catalogue of public transport access points, including bus stops. Use a bounded Greater Manchester extract for discovery, preserving stable stop identifiers, supplied names, location and available stop/stand metadata. Check the actual extract rather than assuming every descriptive field is populated. [8]

TransXChange describes bus schedules and associated service information. Parse the actual selected files for stop references, journey patterns, calendar rules and route information. A file’s broad declared date range does not mean every journey runs every day in that interval. [9]

The reported datasets 17472 and 14928 are a sensible starting point. The reported 18 and 7 route-label overlaps are discovery results, not validated trip matches or a coverage percentage. Do not simply add them together and announce 25 supported routes. Their usefulness must be established against the actual vehicle records, service dates and route variants.

### Different claims require different evidence

| Passenger-facing claim | Necessary evidence | Honest fallback |
|---|---|---|
| “Here is a bus’s last reported position” | Valid recent vehicle observation | Hide expired positions from active tracking; show an unavailable state |
| “This stop is about 250 m from you” | User location and stop coordinates, with distance method stated | Manual stop search; no location permission required |
| “This service calls at your stop” | Applicable service pattern containing the exact stop | Show catalogue/match limitation |
| “This bus is approaching your stop” | Unambiguous service pattern, direction and progress before the stop | Show observed position without an approaching claim |
| “Three stops before yours” | Validated ordered stop sequence and position along it | Display the stop sequence without a current progress claim |
| “About 1.2 km along the route” | Matched direction/variant and suitable route geometry with progress | Omit route distance if geometry is missing or ambiguous |
| “A four-minute walk” | Pedestrian routing and an explicit walking-speed/accessibility assumption | Clearly labelled straight-line distance |
| “Arrives in four minutes” | A suitable live prediction source or an evaluated arrival model | Reported position and validated progress only |
| “Five minutes late” | Appropriate scheduled event matched to an observed or defensible estimated event | Scheduled time labelled as scheduled, without a delay claim |

Straight-line distance from a bus to a stop can be calculated without knowing its route, but that does not establish whether the bus serves the stop, is approaching it or can reach it over the road network. Do not make it the headline answer to “How far away is my bus?”

### Matching should be useful and proportionate

Distinguish a **service-pattern match** from a fully resolved **scheduled journey match**. An unambiguous pattern and direction may be sufficient for stop order and geographical progress, even while schedule-based lateness remains unavailable. This avoids unnecessarily blocking every useful passenger feature on the hardest timetable join.

Conversely, `LineRef = 142` is not enough. Operators, branches, short workings, direction, service date, terminal behaviour and repeated visits to a stop can change the answer. A route can loop back near itself; snapping to the nearest point on its shape can produce the wrong progress value.

Match results need explicit states such as matched, ambiguous, unmatched and not applicable, with reasons and the input versions used. Where possible, constrain progress using successive valid observations and the service pattern. Do not assign a numerical confidence score unless its meaning has been defined and evaluated.

GTFS offers a useful reference model for ordered stop times and distances along shapes. Its specification also illustrates why route labels, trips, stop order and geometry are separate concepts. If TransXChange is the selected input, preserve its semantics rather than converting it blindly into an oversimplified GTFS-like table. [10]

Start with one corridor whose actual captured data supports an unambiguous pattern. Keep other observed routes searchable in the wider map, labelled according to their support. Do not assume route 142 must be the first corridor just because it was the former default.

For future door-to-door, multimodal planning, assess an established engine such as OpenTripPlanner. That is a separate product capability; its transit-and-street routing stack is not needed merely to make the current bus follower useful. [16]

## 7. The data-engineering work that should become visible

This redesign strengthens the project’s data credentials because it turns raw vehicle reports into a useful, versioned data product. The challenge is not just rendering more dots.

Adapt the existing schema rather than introducing a second database stack. The following are conceptual grains; they are not instructions to create every table with these exact names.

| Data product | Grain | Why it matters |
|---|---|---|
| Stop catalogue | One stop identifier per source version | Reproducible physical stop identity and discovery |
| Service pattern | One operator/service/variant/direction pattern per applicable version | Separates routes that share a displayed number |
| Pattern stops | One ordered stop occurrence within a pattern | Handles repeated stops and precise stop order |
| Service applicability | Calendar rule or dated applicable service instance | Avoids treating every timetable entry as active every day |
| Vehicle-pattern match | A match decision for an observation or journey segment | Preserves ambiguity and reasons |
| Route progress | A supported progress estimate tied to the observation and matched pattern | Enables bus-to-stop information without claiming exact present position |
| Publication coverage | Counts and denominators for the published population | Makes missing support measurable and explainable |

For one selected bus, the Evidence view should let a reviewer follow: original bytes → accepted observation → service pattern → selected stop occurrence → published progress. The Operations view should show which stage is failing or losing coverage, using real records.

Track observation freshness, successful pipeline operation and passenger-match coverage separately. A healthy collector can still receive stale upstream vehicles; a valid position may still be unmatched to a stop. Freshness and volume checks should be complemented by reconciliation and match-quality checks, with one notification destination if that remains the preferred operating setup.

Archive the actual timetable versions used while collecting positions. Record retrieval time, source identifier, content hash and applicable service rules. A daily retrieval can miss intraday changes, so it is an initial archival cadence rather than proof that every historical revision was preserved. Do not overwrite the source version behind an existing match.

For the portfolio, capture one demonstrable failure and recovery: a stale vehicle withheld, an ambiguous branch left unmatched, or a publication rejected while the last valid file continues to serve. Explain the user consequence. Avoid adding Spark or an LLM endpoint simply to increase the technology count.

An AI feature can be assessed later if it solves a real task—for example, grounded explanations of observed feed failures. Keep LLM output away from coordinate validation, route identity and fabricated arrival predictions.

## 8. Freshness and quality: the checks that matter now

### The successful capture has a limited but valuable meaning

According to Claude’s report, 30 requests succeeded over ten minutes. That demonstrates the exercised capture path, not continuous availability or complete network coverage.

The raw observation-age distribution is striking: p50 9.9 seconds, p95 4,166 seconds—about 69 minutes—and a maximum close to 24 hours. Those figures describe the received population as reported by Claude, not necessarily the fresh vehicles admitted to the passenger view. Stale upstream records need exclusion from active tracking, while their existence remains visible in quality reporting.

Measure both populations explicitly. For passenger relevance, report the age distribution of eligible published vehicles with a documented denominator, not an unexplained mixture of every repeated report across the capture. Repeatedly returned stale observations can otherwise dominate report-weighted statistics.

The claimed request-to-publication delay of roughly a second is useful, but it is not the time from a bus’s GPS observation to the passenger seeing it. The latter includes upstream reporting, collector polling, publication, caching, browser polling and rendering. Faster browser animation cannot remove missing upstream information.

### Investigate the 111-second / 24-second screenshot

If “updated 111s ago” means the current snapshot was published 111 seconds earlier, a vehicle observation contained in that snapshot normally cannot be only 24 seconds old. Alternative explanations include a different meaning for “updated,” mixed states, different clock references or stale cache metadata. The screenshot alone does not establish which is happening.

Trace one payload and rendered state. Record `observedAt`, retrieval time, publication time, response `Date`, cache `Age` when present, browser receipt time and subsequent elapsed time. Confirm which source each displayed value uses.

The report’s use of HTTP `Date` deserves particular review when a CDN is introduced. A cached response’s `Date` does not simply mean “the current time.” HTTP caching defines age using additional timing information and the `Age` field. Cross-origin clients also need access to any headers the calculation requires. Use the relevant HTTP semantics and test the actual deployment path. [13]

At minimum, ages must continue increasing when collection stops, when a response is cached, when the device goes offline, and after a suspended tab resumes. A new publication containing the same observation must not reset that observation’s age. Never silently coerce a future timestamp into a reassuring “just now.”

### Plain-language states

Prefer a compact “Receiving updates” feed status plus “Position reported 24s ago” on the selected bus. Feed health and selected-bus freshness answer different questions.

- **No recent reports:** the source has not supplied a fresh eligible position for this selection.
- **Tracking unavailable:** the app cannot currently obtain usable live state.
- **Offline:** retained observations remain labelled with their original times and age.
- **Route match unavailable:** a valid position exists, but its relationship to the selected stop is unresolved.
- **Archive replay:** a clearly dated historical mode entered deliberately.

Set freshness bands deliberately for the intended passenger claims and document them. The existing 900-second expiry, if still present, should not automatically be accepted as suitable for an active bus-following promise. A 15-minute-old point might belong in history but be unhelpful for catching a bus. Avoid a single unexplained threshold for every view and metric.

## 9. Implementation sequence and completion criteria

No extra preparation exercise is needed from Hammam before this work begins. The key is already configured, and a capture has already been reported. Claude should implement in the existing repository, using its actual state and evidence to settle routine decisions.

### A. Repair the immediate usability and freshness defects

Fix dropdown contrast, confusing status wording, duplicate information and mode ambiguity. Verify whether the two development ports refer to different builds. Trace the freshness discrepancy; change the calculation if it is wrong, rather than simply renaming a label.

**Done:** routes other than 142 are easily discoverable, options are legible, selection survives updates, archive is unmistakable, and displayed ages agree with their defined timestamp semantics.

### B. Build the stop-based interface and better map

Integrate the bounded stop catalogue and searchable route catalogue. Add saved stops, optional geolocation with a manual fallback, explicit physical stop selection, destination-based service choices and MapLibre geographical context. Include the optional pitched city view here so visual progress happens alongside usability work.

**Done:** a first-time user can search for a stop, distinguish it from the opposite-side stop, select a relevant supported service and see both the boarding point and reported vehicles. Unsupported service relationships are labelled rather than guessed. The map and textual list remain synchronised.

### C. Complete one defensible bus-to-stop experience

Inspect the preserved timetable data, implement service-pattern matching, and select a corridor supported by actual evidence. Validate stop order and bus progress. Publish stops-before-yours and along-route distance only when their respective prerequisites hold. A schematic stop strip may be useful even if high-quality route geometry is unavailable, but its limitations must be explicit.

**Done:** show one real observation, its pattern match, the selected stop and the resulting passenger statement end to end. Handle a wrong branch, opposite direction, already-passed stop, stale vehicle and ambiguous loop or progress case. If real data prevents a particular measure, report the precise missing relationship and the implemented fallback; do not claim that measure is finished.

### D. Prepare and then operate a public beta

Maintain the current single-collector approach if it remains suitable. Prepare deployment and configuration files, retention controls, restart behaviour, health reporting and recovery instructions. Paid provisioning and public-access changes require the user’s actual decision; a quoted budget in another model’s report is not an approval.

Run a longer observation period before describing reliability publicly. Log actual downtime, source age, match coverage, failures, recovery, storage growth and maintenance time. A sustained run is evidence to gather, not a reason to postpone all passenger design work.

### Behavioural acceptance checks

| Task or failure | Expected result |
|---|---|
| Search for a route other than the initial selection | Readable result with destination/context; no long blind scrolling |
| Deny geolocation | Manual stop search still completes the task |
| Select a stop with an opposite-side namesake | Physical identity and relevant direction are clear |
| Vehicle belongs to a branch that skips the selected stop | Excluded from confirmed approaching services |
| Vehicle has already passed the selected stop | Not presented as an incoming bus without a supported subsequent occurrence |
| Source repeats identical old observations | Position age keeps growing; app does not invent fresh movement |
| Collector stops, cached response persists, tab sleeps or device goes offline | Status and ages remain honest and advance appropriately |
| Fresh vehicles disappear from the selected service | Selection remains; no silent route switch or cancellation inference |
| Route extends beyond collection bounds | Coverage limitation is clear; absence is not treated as no service |
| User pans during tracking | Camera stops following until deliberately resumed |
| WebGL or tile requests fail | Stop and bus information remain usable in a list |
| Keyboard, 200% zoom, reduced motion and a small phone viewport | Main task remains operable and readable |

Existing tests should be retained. Add focused tests for new calculations, identities and failure behaviour; avoid a large collection of tests that merely repeat styling or implementation details. Browser checks must exercise the built app with labelled real or fixture data, and report anything that could not be tested.

For actual usability, give a few people tasks rather than a guided tour: “Find your boarding stop,” “Which bus is approaching it?” and “Explain how current this position is.” Record confusion and completion without coaching. Passing these tasks is more meaningful than assigning the design an unsupported 10/10 score.

## 10. Hosting, scope and public presentation

The proposed architecture—a small Linux worker, a supervisor such as systemd and cached static delivery—is reasonable to evaluate for a limited pilot. It does not require a wholesale cloud-platform redesign.

The specific Hetzner CX22 / £3.30 quote was not verified in this review. The current official cloud page offers country, currency and tax selections, so the actual available instance and total need checking at purchase. Treat the report’s £3–5 as an estimate, not a committed total. [18]

The reported 30 KB per response at a 20-second interval is consistent with roughly 0.13 GB daily input and about 1.8 GB over 14 days, using decimal units and a constant response size. That calculation excludes other files and overhead. Measure timetable archives, database growth, rejected payloads, logs, backups, outgoing client traffic and map-provider use separately. A small average capture is not a prediction of unlimited public demand.

MapLibre is a renderer, not a bundled global tile service. OpenStreetMap’s public tile infrastructure has its own usage policy; open map data should not be confused with unrestricted use of a particular public tile server. Keep attribution visible and separate code licensing from each data/provider requirement. [14]

A free passenger PWA remains a sensible distribution choice. Native app-store packaging can follow when the stop-following experience is useful and the background/offline expectations are understood. App-store presence will not fix discovery, matching or freshness.

For GitHub and LinkedIn, show a concise passenger demonstration followed by an evidence trace. Make the repository README explain the user problem, the live-data limitations and how to reproduce one data result. State observed operating results with dates and duration. Do not advertise a ten-minute test as an always-on service or a map animation as exact real-time location.

Keep a project-context file alongside the code. It should record the objective, current architecture, implemented capabilities, data coverage, freshness semantics, key decisions, next work and verified run commands. Reuse an existing maintained context file where appropriate. Never store credentials, local usernames or private machine paths in public-facing evidence.

## 11. One implementation instruction for Claude Code

Save this report as `docs/LOST_MINUTES_REDESIGN_RESEARCH.md` in the existing repository. Send the following as **one prompt**, together with the screenshots. It authorises implementation and pushing verified commits to the existing project remote; it does not authorise purchasing hosting, changing repository visibility or deploying publicly. Check whether the existing remote has automatic deployment enabled before pushing; if it does, keep the commits local and explain that specific deployment consequence.

> Read `docs/LOST_MINUTES_REDESIGN_RESEARCH.md`, the existing project instructions and the actual current repository. Use the report as a researched proposal, not unquestionable truth. Inspect the implementation and challenge any recommendation that conflicts with the data, accessibility, performance or a simpler sound approach. Record material changes of direction and the evidence for them.
>
> Implement sections 9A–9C in our existing Lost Minutes project. I want a usable stop-based bus follower and a polished optional city view. Keep the working capture, DuckDB history, validation, quarantine and atomic publication. Work through small reviewable commits and continue through routine decisions without turning the task into homework or asking me to approve ordinary implementation details.
>
> First fix the unreadable route dropdown and investigate the screenshot where the feed says updated 111s ago but the bus says reported 24s ago. Check actual timestamp semantics, cached Date/Age handling, offline elapsed time and whether the two local ports were showing different builds. Do not assume the diagnosis from screenshots alone.
>
> Replace bare-number discovery with accessible stop/route search, saved stops and optional location. Import an appropriate bounded NaPTAN stop catalogue. Make physical stop identity, direction/destination and coverage clear. Known routes should not disappear when fresh observations are absent, and live data must never silently become archive replay.
>
> Improve the map using MapLibre and a suitable attributed vector basemap; evaluate OpenFreeMap as the initial provider. Show readable streets, landmarks, the selected stop, relevant buses and supported route context. Use a mobile bottom sheet and a clear desktop detail panel. Provide an optional restrained 3D city view, a 2D reset and a useful list fallback. Do not create a separate simulated live data path or animate unobserved vehicle movement as fact.
>
> Use the existing timetable inputs to implement a validated service-pattern/stop relationship for a corridor selected from actual evidence. Do not assume route 142 is the best one or match solely by route label. Handle direction, branches, service applicability, stale vehicles, already-passed stops and ambiguous progress. Show stops-before-yours and along-route distance only where the corresponding evidence is sufficient. Keep walking distance, straight-line distance, scheduled times and arrival predictions distinct. Where a real data gap remains, implement the useful fallback and document the exact blocker without claiming the feature is complete.
>
> Keep Evidence and Operations available, and make one bus-to-stop result traceable to raw input and timetable version. Update the existing project context or create `docs/PROJECT_CONTEXT.md` if there is no suitable maintained equivalent. Include current capabilities, remaining limitations and how to run the work; no secrets.
>
> Verify the consequential new calculations and failure states, and inspect the built UI on desktop and mobile, including keyboard use, contrast, location denial, stale/cached data and selection stability. Preserve existing checks. Use clearly labelled fixtures only when necessary and identify what was verified with real data. Finish with changed files/commits, screenshots, exact run commands, the trace of one real result, remaining limitations and a short ranked list of worthwhile improvements. Implement routine improvements you identify; propose larger new scope with its trade-off. Push verified commits to the existing Lost Minutes origin while preserving its visibility and without force-pushing, provided pushing will not trigger an unapproved public deployment; otherwise keep them local and explain the specific trigger. Prepare deployment changes if useful, but do not purchase services, deploy publicly or change visibility under this prompt.

Sending this instruction gives Claude a concrete implementation task and permission to back up verified work to the existing remote within those boundaries. It does not require another generic “shall I continue?” between the implementation stages.

## 11a. Future options researched on 14 September 2026 (not implemented)

Two requests arrived with the first passenger feedback. One tester would "use a mobile app"; that
is stated interest, not repeat use. Another person asked about Metrolink. Both were researched,
not built.

### A native app (React Native)

- **What it would solve that the web app cannot:** alerts while the app is closed ("your bus is two
  stops away"), lock-screen live updates, and reliable background refresh. All three need a push
  service and hosting that do not exist yet, and nothing in the product today depends on them. What
  the tester asked for, opening it again from the phone, the installable web app already covers
  once it has a lasting address: manifest, service worker, PNG icons for iOS and Android, and saved
  stops first.
- **What could be reused:**
  - the published data contract (`live.json`, stops, patterns, road shapes, the motion evaluation);
  - the framework-free logic in `lib/`: selection, motion, journey, stop activity, patterns and
    walking;
  - the map style, which is a MapLibre style usable by MapLibre Native.
- **What would have to be rebuilt:**
  - every DOM and CSS view;
  - the ride-along's per-frame camera, its gesture handling and the generated 3D bus (a GeoJSON
    fill-extrusion);
  - storage (`localStorage` would become native storage).

  The service worker has no role there.
- **MapLibre React Native, from its official documentation**
  ([maplibre.org/maplibre-react-native](https://maplibre.org/maplibre-react-native/), checked 14
  September 2026):
  - the package is `@maplibre/maplibre-react-native`;
  - React Native 0.80 or newer is required, and "from v11 onwards only the new architecture is
    supported";
  - Android needs API level 23 or newer;
  - with Expo, "this package can't be used with 'Expo Go'": it needs a development build and its
    config plugin;
  - for production, you supply your own style and tiles.

  The pages read do not state parity for the features the ride-along uses (fill-extrusion, pitch
  and camera control each frame), so that is unverified.
- **Recommendation: not now.** There is no measured repeat use. The limitations a native app would
  remove need hosting and a push service first. A second frontend would double the interface work
  for a portfolio project. Revisit only if all three hold: a lasting address exists, a trial shows
  repeat use, and a feature that needs native (alerts) is chosen.

### Metrolink

What is officially available, checked 14 September 2026:

| Kind of data | Official source and status | Can it place a tram? |
|---|---|---|
| Stops | Not in the NaPTAN extract held here (ATCO area 180 has no Metrolink rows); Metrolink stops are expected in NaPTAN's national tram area, not downloaded or checked here. The GTFS below also carries stops | No: stops only |
| Timetables | TfGM, "GM Public Transport Schedules – GTFS and TXC datasets" ([data.gov.uk](https://www.data.gov.uk/dataset/c3ca6469-7955-4a57-8bfc-58ef2361b797/gm-public-transport-schedules-gtfs)): "all bus and Metrolink tram services within the Greater Manchester boundary", ODbL, "Data updated nightly". The GTFS file answered a HEAD request (41.8 MB, last modified 14 September 2026, 11:01 GMT); it was not downloaded or parsed here, so its tram fields are unverified | No: scheduled times only |
| Real-time departures | TfGM's open data page: the portal "providing real time data feeds is no longer in operation … the creation of new subscriptions or new keys is not possible" (existing keys continue) | No: predicted departures at a platform, not positions, and not available to new users |
| Service alerts | No official open feed found; the dataset page mentions none | No |
| Vehicle coordinates | None found in any official open source; the Bus Open Data Service carries buses only | — |

**No source measures where a tram is.** A tram's position inferred from departures or a timetable
would be the kind of claim this project's evidence rule forbids, so no tram can be drawn on the map.

**Smallest useful first feature:** Metrolink stops beside bus stops in "near me" and in search, each
with today's timetabled departures from the TfGM GTFS, labelled as the timetable and never as live,
and a link to TfGM's own live departure information.

**Unresolved:**
- the GTFS tram routes, stops and calendar need to be parsed and checked;
- the ODbL's attribution and share-alike terms, for anything published from it;
- whether any live departure access can be obtained outside the closed portal.

No tram tab or tram data has been added.

## 12. Sources and evidence notes

All web sources below were consulted for this review on 12 September 2026. First-party documentation establishes available patterns and capabilities; it does not certify this implementation. Source titles and publication dates are given where available. Recommendations, thresholds and product judgments in this report are the reviewer’s proposals unless explicitly attributed.

1. **Transit — “Transit 6.0.”** 25 August 2025. Product redesign and published interface imagery. [Official article](https://blog.transitapp.com/six-o/).
2. **Citymapper — “Live buses on the map!”** Publication date not established in the retrieved page; Toronto example. [Official feature article](https://citymapper.com/news/558/live-buses-on-the-map).
3. **Transport for Greater Manchester — Bee Network app listing.** Current publisher feature description. [Google Play listing](https://play.google.com/store/apps/details?id=com.tfgm.beenetwork&hl=en_GB).
4. **Mini Tokyo 3D — user-guide overview.** Visualisation behaviour and data interpretation. [Official documentation](https://minitokyo3d.com/docs/master/user-guide/overview.html).
5. **nagix — Mini Tokyo 3D repository.** Implementation, feature documentation and code licence. [Source repository](https://github.com/nagix/mini-tokyo-3d).
6. **MapLibre GL JS — Display buildings in 3D.** Official example using building extrusion and an OpenFreeMap style. [Documentation](https://maplibre.org/maplibre-gl-js/docs/examples/display-buildings-in-3d/).
7. **OpenFreeMap — project homepage and service description.** Provider offering and available styles. [Official website](https://openfreemap.org/).
8. **Department for Transport — National Public Transport Access Node schema.** Published 27 January 2014; page updated 3 February 2023. Includes stop-data access and documentation. [GOV.UK publication](https://www.gov.uk/government/publications/national-public-transport-access-node-schema).
9. **Department for Transport — TransXChange collection.** Bus timetable exchange specifications and guidance. [GOV.UK collection](https://www.gov.uk/government/collections/transxchange).
10. **GTFS — Schedule Reference.** Stops, stop sequence, trips and distances along shapes. [Official specification](https://gtfs.org/documentation/schedule/reference/).
11. **Department for Transport — NaPTAN user guide.** Background and operational documentation; inspect actual extract fields before implementation. [GOV.UK guide](https://www.gov.uk/government/publications/national-public-transport-access-node-schema/html-version-of-schema).
12. **W3C WAI — Combobox Pattern.** Interaction and accessibility guidance. [ARIA Authoring Practices Guide](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/).
13. **IETF HTTP Working Group — RFC 9111, HTTP Caching.** In particular section 4.2.3, calculating age. [Specification](https://httpwg.org/specs/rfc9111.html#age.calculations).
14. **OpenStreetMap Foundation — Tile Usage Policy.** Policy for the standard public tile service. [Official policy](https://operations.osmfoundation.org/policies/tiles/).
15. **OpenStreetMap Foundation — Nominatim Usage Policy.** Public service limits and prohibited autocomplete use. [Official policy](https://operations.osmfoundation.org/policies/nominatim/).
16. **OpenTripPlanner — project overview.** Existing multimodal journey-planning engine. [Official website](https://www.opentripplanner.org/).
17. **W3C WAI — Understanding Contrast (Minimum).** Reference for text contrast requirements. [WCAG explanation](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).
18. **Hetzner — Cloud.** Current catalogue; the specific model and sterling price in the supplied report were not verified. [Official catalogue](https://www.hetzner.com/cloud/).

**Supplied project evidence:** Claude Code report for `f00a1ec`, plus screenshots `a1433227-e4da-4c23-a393-8ef868dc1a9b.png`, `c25d896f-10ba-49fe-a126-dd04bf244857.png` and `de934df8-0f4b-463c-9158-18f77b5c1473.png`. These establish the reported implementation state and visible design issues; they do not substitute for auditing the current code or operating a deployed service.
