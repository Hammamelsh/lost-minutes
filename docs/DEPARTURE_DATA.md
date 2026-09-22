# Real departure times at a stop: what exists, what it costs, and what is built here

Checked on 22 September 2026. **Nothing was signed up for, no key was requested, no request was
made to any paid endpoint and no charge was incurred.** Everything below is from each provider's
own public pages; where a page could not be read, that is said rather than filled in.

The question is narrow and practical: a passenger at a boarding point wants to know when the next
bus leaves. That is a *stop departure board*, and it is a different capability from matching a
vehicle to our motion model. This project already consumes vehicle positions; it has never had
departure predictions.

## 1. What was checked

### TfGM's own real-time portal — closed
`developer.tfgm.com` now redirects to TfGM's open-data page, which states:

> "Our Open Data Portal providing real time data feeds is no longer in operation."
> "The creation of new subscriptions or new keys is not possible."

Existing Metrolink keys keep working; there is no bus departures API there, and no way to obtain
access. TfGM's own data page points developers at the DfT's Bus Open Data Service for bus
real-time. **Not available.**

### Bus Open Data Service (BODS) — positions, not departures
BODS is free, needs no licence, and is what this project already collects: bus **location** data in
the SIRI-VM profile, plus timetables (TransXChange) and fares. It publishes no stop-monitoring
(SIRI-SM) departures API. Turning SIRI-VM into departure minutes is prediction, which is our own
experimental estimator and is gated on an evaluation that has not passed
(`docs/ARRIVAL_RELEASE_CRITERIA.md`). **Already used; does not answer this question.**

### The Bee Network app and website — a board, not an API
TfGM publishes live departures at `tfgm.com/travel-updates/live-departures` and in the Bee Network
app. A departure board a member of the public can see is not a grant of programmatic access, and
the app's own endpoints are undocumented. **We do not scrape it.** The site links to the official
board instead, labelled as the official one, and that link stays whatever else is done.

### NextBuses, now run by TransportAPI — the one practical option
Under an agreement with Traveline, TransportAPI operates NextBuses and describes it as
"the single national service for real time information (RTI) on bus departures, bringing together
all of the regional and local schemes in a single place", with coverage extended to "London,
Manchester and Edinburgh". Data comes two ways: SIRI Stop Monitoring XML over POST, or JSON over
GET through their Bus Information managed service. Access needs an account and a key
(`app_id`/`app_key`, in the query string or as `X-App-Id`/`X-App-Key` headers).

**Cost, from their own pages:**

| Plan | Quota | Price |
|---|---|---|
| Free | 30 requests a day, "free forever" | £0 |
| Home use | 300 requests a day | £5 a month, plus a £10 setup fee, both inclusive of VAT |
| Business | "from dozens of requests to millions of requests at scale" | on application |

**Terms that matter here** (TransportAPI's published terms): data may be accessed, used, copied and
displayed on any device (2.1.2) and **stored and cached for any period** (2.1.3); it may be
deployed through registered services and end-user devices (2.3.3); the service must display
`source: http://transportapi.com/` so it is clear where the data came from (2.3.6), with credit
"wherever technically and commercially feasible" (12.4); re-use is permitted "for any purpose of
commercial or non-commercial re-use" (2.1), subject to the quota and a maximum of five authorised
users. Caching is therefore not merely tolerated, it is explicitly allowed — which is what makes a
300-a-day plan workable for a public site.

**One thing to confirm before paying.** The Home plan is *described* for monitoring your own stop
from home automation hardware. The terms themselves do not restrict it to that, but the description
and the terms are not the same document. Ask TransportAPI, in one line, whether a personal
portfolio website with a handful of visitors is within the Home plan, and take their answer. That
question costs nothing and removes the only real doubt.

## 2. Recommendation

**One option: NextBuses by TransportAPI, on the Home plan, if the owner wants live minutes.**
Nothing else is open to a new developer for Manchester bus departures. The decision is the owner's
because it needs an account in their name, a card, and £70 a year at the stated price.

**The request budget, worked out rather than assumed.** One request answers one stop. With a
shared server-side cache of 60 seconds, a stop being watched costs one request a minute however
many people are watching it:

| Cache | Requests a day | Stop-minutes a day it buys | Practically |
|---|---|---|---|
| 30 s | 300 | 150 | 2.5 hours of somebody watching some stop |
| 60 s | 300 | 300 | 5 hours |
| 60 s | 30 (free) | 30 | half an hour — enough to evaluate, not to serve |

This site's traffic is a portfolio's. Five hours a day of active stop-watching is well beyond it, so
**60 seconds and the Home plan** is the proposal, with the budget enforced in our own code so the
quota can never be exceeded rather than merely expected not to be.

**Exactly what is needed from the owner, if the answer is yes:**
1. an account at `developer.transportapi.com` in their name, and the Home plan (£10 once, £5 a
   month, inclusive of VAT), after asking the question in §1;
2. the `app_id` and `app_key` put on the server by hand into `/etc/lost-minutes/departures.env`,
   mode 0600, owned by the service user — the same handling as the BODS key, never in Git, never in
   the browser, never pasted into a chat;
3. a word on the monthly ceiling they are willing to pay if usage ever exceeded the Home plan.

If the answer is no, nothing breaks: the scheduled board below is what the site shows, and the
official live board stays one tap away.

## 3. What is built now, without any provider

**Scheduled departures, from the timetables we already hold.** The operators' registered
TransXChange files declare every journey's departure from its first stop and its running time to
each later stop. The pipeline already parses both; since 22 September 2026 it also keeps *which
operating profile each departure runs on*, so a board can be asked for a particular day rather than
only for a pattern (`pipeline/patterns.py`, `pipeline/departures.py`).

`python -m pipeline.departures publish` writes one board per boarding point under
`public/data/departures/<ATCO>.json`, with the operating rules they share in
`public/data/departure-rules.json`. It runs nightly on the server beside the catalogue rebuild and
is excluded from deploys, for the same reason the catalogue is: it is the server's own, built from
what the server holds.

What it refuses rather than filling in:
- a stop where the file declares no running time publishes **no** time, never a zero;
- a journey whose operating profile could not be read is listed and **marked**, because dropping it
  would hide a bus that does run and listing it silently would claim a day we cannot check;
- a pattern that *ends* at a stop is not a departure from it;
- a row names a tracked vehicle only where that vehicle reports this journey's own origin departure
  time, on this pattern, on this service day, with one journey at that time. Otherwise the row
  stands alone. A departure is never given the nearest bus, and a bus is never given a departure
  time it did not report.

Every row is labelled **Scheduled**. There is no live row today, and there will not be one until a
live source is configured.

## 4. If the integration is approved: how it would be served

The frontend is a static export behind Caddy, and it must stay that way; the key must never reach
a browser. The shape that fits:

- a small service on the same host, listening on 127.0.0.1, holding the key from
  `/etc/lost-minutes/departures.env` (0600, service user, not in Git, not in any deploy);
- Caddy reverse-proxies one path, `/api/departures/<ATCO>`, to it and nothing else;
- one cache entry per ATCO code, 60 seconds, **shared across every visitor**: one upstream request
  serves everyone watching that stop;
- a daily counter with a hard ceiling below the plan's quota. At the ceiling the service stops
  calling upstream and answers from the scheduled board with the live rows withheld and said to be
  withheld — never a stale prediction presented as current;
- requests only for a stop a passenger is actually looking at. Never for markers on the map, never
  prefetched for a list of stops, never on a timer while the page is hidden;
- a provider failure, a timeout or a malformed answer falls back to the scheduled board and says
  the live source is not answering. A failure is a state, not an empty board;
- `source: http://transportapi.com/` displayed with the data, as the terms require, beside the
  existing OGL and ODbL notices.

None of this is built. Building a dormant service that holds a key nobody has would be
infrastructure ahead of a decision, and the decision is the owner's.

## 5. Answering the question this milestone asked

> Whether real departure minutes are actually available, for which stops and from which source.

- **From TfGM: no.** Their real-time portal is closed to new keys, for every stop.
- **From BODS: no.** It publishes vehicle positions, not stop departures, for every stop.
- **From NextBuses (TransportAPI): yes, for Manchester**, which is what their own announcement
  claims; coverage at *an individual stop* is not something their public pages state and would have
  to be checked with the free 30-a-day tier at the owner's chosen stops — including Westwood Avenue
  (opp), `1800SJ01251` — before any money is spent. That check needs an account, so it needs the
  owner.
- **From our own timetables: yes, as scheduled times, for 2,682 boarding points**, which is what is
  built and shipped in this milestone.
- **From our own estimator: no.** It has not passed its criteria, and nothing here waits on it.
