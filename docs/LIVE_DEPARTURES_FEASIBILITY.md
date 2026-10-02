# Live departure times at a stop: feasibility of NextBuses and TransportAPI

Checked on **2 October 2026**, from the providers' own documents. **Nothing was signed up for, purchased or
requested from a departure endpoint, and no provider was contacted.** No credential for either service is held, so
no sample of our own stops could be taken; what that sample would have answered is listed below. This replaces the
22 September note (`DEPARTURE_DATA.md`) where they differ, and corrects one thing in it: Traveline still offers the
NextBuses API directly, while TransportAPI separately offers it as "NextBuses – powered by TransportAPI".

## What exists

| | Traveline NextBuses API | TransportAPI |
|---|---|---|
| Provider | Traveline Information Limited, a not-for-profit | PLACR Ltd, trading as TransportAPI |
| Departures endpoint | SIRI Stop Monitoring 1.0, an XML `POST` per stop, HTTP Basic authentication | `GET /v3/uk/bus/stop_timetables/{atcocode}.json?live=true` (JSON), and `POST /nextbuses` (SIRI-SM) |
| Disruptions | none | `GET /v3/uk/bus/situations.json`: situations filtered by date, participant, stops, operators or services; 20 a page |
| Manchester | Traveline's real-time feed list (saved 18 May 2026) names "Manchester RT", ATCO area 180 | real-time "where available", from open sources including NextBuses, TfL Countdown and later BODS; or, with `source_config=siri_vm`, its own predictions from timetables and BODS positions, stated to cover about 30% of mainland GB |
| Real-time or timetable | `ExpectedDepartureTime` only where real-time exists; `AimedDepartureTime` always | `expected` null where there is no real-time; `best_departure_estimate` falls back to the aimed time, so it does **not** mean live; `source` names the data used |
| Journey and vehicle identity | `DatedVehicleJourneyRef` is "-" in the documented example; no vehicle reference; operator codes differ between real-time and timetable feeds unless the beta channel's national codes are used | no vehicle reference in the documented departure; `id` is a service timetable URL |
| Freshness | each visit's `RecordedAtTime` is the response time, not the prediction's age | not stated per departure |
| Price | 180,000 hits per username per six months free (about 986 a day on average); then £0.96 per 1,000 plus VAT, invoiced six-monthly | Free: 30 hits a day. Home: £5 a month and a £10 setup fee (both with VAT), 300 a day, described as for monitoring your own stop with home devices (11 August 2022). Business prices for Bus Information are not published; the G-Cloud 15 price list found (January 2026) is for the Bus Fares service and does not apply |
| A hit | "a single request to the NextBuses API for a single stop" (licence, Schedule 1) | each request consumes hits per Schedule 2 (bus stop live: 1), counted when a request with the app's id and key is received |
| Display and caching | Open Government Licence v1.0 (licence v2.2, Schedule 3): use, publish and adapt with attribution; no implied endorsement; no misrepresentation. No caching limit stated | data may be stored and cached "for any period" (Schedule 4, 2.1.3); display "source: http://transportapi.com/" (2.3.6). NextBuses data is "Premium … offered on a limited basis at PLACR's absolute discretion" |
| Access | a request through Traveline's contact form and a signed licence | self-service sign-up at `developer.transportapi.com` |
| Transport security | the documented URL is plain `http://`; on 2 October the HTTPS certificate for `*.mxdata.co.uk` had expired (14 June 2026), and HTTP answered 403 without credentials. Credentials would cross the network unencrypted | HTTPS |

## What a budgeted sample would answer, and could not yet

With a credential, about 50 requests (ten of our busiest stops at five times of day; within either free allowance)
would show:
- the share of departures at Manchester stops with a real expected time, by operator;
- whether `DatedVehicleJourneyRef` is populated for Manchester, and whether operator codes are national codes;
- how expected times move between two requests a minute apart (a freshness proxy, since no prediction time is given);
- TransportAPI's `source` values for those stops, and whether `situations` carries TfGM disruptions.

## Matching to our data, safely

- **Never to a vehicle on the map.** No vehicle reference is documented, and a match by line and time would be a
  guess drawn as a fact.
- **To our timetable row, only on exact agreement.** A provider departure may be joined to our board's row when
  operator (as a national code), line, destination and the aimed time at this stop all agree, which is the rule our
  board already uses for a tracked bus. No candidate, or more than one: show the provider's row on its own, labelled.
- **Label every time by its kind**: "expected 14:07 · live, from NextBuses" only where an expected time is present;
  otherwise "scheduled 14:05". `best_departure_estimate` is never shown as live.

## Recommendation: the smallest pilot (not built)

1. **Provider:** Traveline's NextBuses directly. Its free allowance fits, and the Open Government Licence allows a
   public display with attribution. The conditions: Traveline agrees to a licence for this site, and either HTTPS is
   restored or the username is dedicated, revocable and used only from the server. TransportAPI is the fallback, after
   it confirms in writing that a public portfolio site fits a plan that includes NextBuses data.
2. **Shape:** a small server-side fetcher beside the collector. Credentials stay on the server
   (`/etc/lost-minutes/`), never in the browser. One cache entry per stop for 60 s, **shared by every viewer**.
   Requests are made only for a stop a page is showing, never for the map. A daily hard cap of 900 requests, below
   the free allowance's average, and at the cap the board falls back to the timetable and says why.
3. **Display:** expected times labelled live and the provider named; timetable rows labelled scheduled; the cache's
   age shown; nothing matched to a map vehicle.
4. **Evidence before interface:** the budgeted sample above, recorded, before any page change.
5. **Connections later, separately.** A journey with a change needs usable timing at the interchange stop as well,
   which doubles the requests per journey and needs its own reassessment.

At a 60 s cache, the 900-request cap buys 15 hours a day of one stop watched continuously, or about 900 separate
looks at stops spread over the day.

## The single account step

**Apply to Traveline for a NextBuses API username** (the contact form on the NextBuses page of
`travelinedata.org.uk`) and sign the licence v2.2 in your name. When the credential is put on the server, never
pasted into a chat, the 50-request sample can run.

## Sources (read 2 October 2026)

- Traveline, NextBuses API: <https://travelinedata.org.uk/traveline-open-data/nextbuses-api/>; licence v2.2
  (`mytraveline.info/documentation/NextBuses API Licence v2.2 011022.doc`); developer guidance 2.7 (14 March 2018);
  real-time feed list `RTIfeeds.xls` (saved 18 May 2026).
- TransportAPI: OpenAPI specification <https://docs.transportapi.com/openapi/transportapi.yaml> (paths
  `bus/stop_timetables`, `bus/nextbuses`, `bus/situations`); terms <https://www.transportapi.com/terms/>; Home plan
  <https://www.transportapi.com/blog/2022/08/introducing-the-home-use-plan-for-transportapi/>; developer portal
  <https://developer.transportapi.com/>.
- Not applicable, noted to avoid confusion: TransportAPI's G-Cloud 15 price list for **Bus Fares** (January 2026).
