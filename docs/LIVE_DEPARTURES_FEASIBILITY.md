# Live departure times at a stop: feasibility of NextBuses through TransportAPI

Checked on **2 October 2026**, from the providers' own pages and specification. **Unverified as an integration:** no
account exists, no departure endpoint has been called with credentials, nothing was bought, and no provider was
contacted. Every statement about what a Manchester stop would return is the providers' description, not an observation.

**Revised the same evening.** The first version recommended applying to Traveline for the NextBuses API and treated
its 2022 licence terms (180,000 requests per six months) as current. They are not: TransportAPI has run NextBuses since
a migration it announced in May 2026. That version also suggested that a server-only credential could make plain HTTP
acceptable. It cannot, and that suggestion is withdrawn: any integration uses HTTPS only.

## What changed in 2026

- **March 2026:** TransportAPI and Traveline announced "NextBuses – powered by TransportAPI", running alongside
  TransportAPI's own endpoints (TransportAPI blog, 18 March 2026).
- **May 2026:** TransportAPI reported the migration complete. It "would become the NextBuses operations and commercial
  provider under an agreement with Traveline". The service "is now the single national service for real time
  information (RTI) on bus departures", "regulated by Traveline on price, data quality and support", with coverage
  extended to "London, Manchester and Edinburgh"; "users have moved seamlessly across to the new platform"
  (TransportAPI blog post at `/blog/2026/05/nextbuses-by-tapi/`; the page carries no other date).
- **What is left of the old arrangement:** Traveline's NextBuses page still offers the 2022 licence (180,000 hits per
  six months, then £0.96 per 1,000) and the old endpoint `http://nextbus.mxdata.co.uk/nextbuses/1.0/1`. That endpoint
  is plain HTTP; on 2 October its host's HTTPS certificate had expired (14 June 2026) and plain HTTP answered 403
  without credentials. **It is not a candidate**, whatever Traveline's page still says.

## The current offer, as published

| | NextBuses – powered by TransportAPI |
|---|---|
| Onboarding | self-service sign-up at <https://developer.transportapi.com/>; the form's "primary use" includes "NextBuses - powered by TransportAPI". No payment for the free tier |
| Allowance | free: **30 requests a day** ("no payment is required unless you wish to use more than the free allowance of 30 requests per day"). Above that, "register a payment method and begin using the data immediately" (Stripe). Paid prices are shown only inside the portal: **not verified here**. The Home plan of 2022 (£5 a month, £10 setup, 300 a day, described for personal home devices) is not re-verified |
| Endpoints, all HTTPS on `transportapi.com` | `POST /nextbuses`: SIRI Stop Monitoring XML. `GET /v3/uk/bus/stop_timetables/{atcocode}.json?live=true`: the same real-time data as JSON. `GET /v3/uk/bus/situations.json`: disruptions ("TAPI Bus Disruptions") |
| Authentication | the application's id and key, in headers (`X-App-Id`, `X-App-Key`), in the query, or as HTTP Basic, over HTTPS. Checked without credentials on 2 October: valid TLS; `stop_timetables` answered 401 |
| A request | the terms count a hit "when a request bearing the Application ID and key … is received"; Schedule 2 lists bus stop live at 1 hit a request |
| Real-time or timetable | JSON: `expected` is null where there is no real-time time, and `best_departure_estimate` falls back to the scheduled time, so it never means "live" by itself; `source` names the data used. SIRI: `ExpectedDepartureTime` only where real-time exists, `AimedDepartureTime` always |
| Identity | no vehicle reference in the documented departure. The SIRI schema describes `DatedVehicleJourneyRef` as the journey's identifier; whether Manchester responses fill it is **unverified** |
| Caching and display | the terms allow storing and caching "for any period" (Schedule 4, 2.1.3) and require "source: http://transportapi.com/" on display (2.3.6). They still call NextBuses data "Premium … offered on a limited basis at PLACR's absolute discretion", which the May post's free tier appears to supersede: **unverified** until an account shows what it receives |

## A sample within the free allowance

Thirty requests on one day, no more:
- **20 departures requests:** ten of our busiest stops, each asked twice, a minute apart, in daytime, which shows how
  expected times move (no prediction time is published);
- **5 disruption requests** for the same area;
- **5 held back** for retries.

It would answer, for those stops only:
- the share of departures with a real expected time, by operator;
- whether journey references and national operator codes are present;
- whether TfGM disruptions appear.

Its credential lives on the server; the results are recorded before any page change.

## Matching to our data, safely

- **Never to a vehicle on the map.** No vehicle reference is documented, and a match by line and time would be a
  guess drawn as a fact.
- **To our timetable row, only on exact agreement.** A provider departure may be joined to our board's row when
  operator (national code), line, destination and the aimed time at this stop all agree. That is the rule our board
  already uses for a tracked bus. No candidate, or more than one: show the provider's row on its own, labelled.
- **Label every time by its kind**: "expected 14:07 · live, from NextBuses" only where an expected time is present;
  otherwise "scheduled 14:05". `best_departure_estimate` is never shown as live.

## Recommendation: the smallest pilot (not built)

1. **Now:** only the sample above, on the free tier, once the owner creates the account.
2. **A pilot on the public site needs a paid plan.** The free tier is for evaluation, and 30 requests a day is 30
   minutes of one stop at a 60 s cache. The plan's price and daily allowance are read in the portal first, and the
   owner decides.
3. **Shape:** a small server-side fetcher beside the collector, over HTTPS, with the credential in `/etc/lost-minutes/`
   and never in the browser:
   - one cache entry per stop for 60 s, shared by every viewer;
   - requests only for a stop a page is showing;
   - a daily hard cap set below the purchased plan's allowance.

   At the cap, the board falls back to the timetable and says why.
4. **Display:** expected times labelled live, with the provider named; timetable rows labelled scheduled; the cache's
   age shown; nothing matched to a map vehicle.
5. **Connections later, separately.** A journey with a change needs usable timing at the interchange stop as well. That
   doubles the requests per journey and needs its own reassessment.

## The single account step

**Create a free TransportAPI developer account** at <https://developer.transportapi.com/signup>, choosing "NextBuses -
powered by TransportAPI" as the primary use, with no payment method. Put its application id and key on the server
yourself (`/etc/lost-minutes/`), never in a chat. Then the 30-request sample can run.

## Sources (read 2 October 2026)

- TransportAPI: "NextBuses joins the managed service line-up at TransportAPI"
  (<https://www.transportapi.com/blog/2026/05/nextbuses-by-tapi/>); "'NextBuses - powered by TransportAPI': announcing
  our new partnership with Traveline" (<https://www.transportapi.com/blog/2026/03/nextbuses-powered-by-transportapi/>,
  18 March 2026); the OpenAPI specification (<https://docs.transportapi.com/openapi/transportapi.yaml>: paths
  `bus/nextbuses`, `bus/stop_timetables`, `bus/situations`); terms (<https://www.transportapi.com/terms/>); the sign-up
  form (<https://developer.transportapi.com/signup>).
- Traveline: the NextBuses API page, licence v2.2 (2022) and developer guidance 2.7 (2018), now describing the
  arrangement that TransportAPI replaced (<https://travelinedata.org.uk/traveline-open-data/nextbuses-api/>).
