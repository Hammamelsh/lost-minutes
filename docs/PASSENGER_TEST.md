# Passenger test: Lost Minutes beside the tester's usual app

One tester, one real journey they make, about 30 minutes. Lost Minutes on their own phone beside
the app they normally use (Bee Network or Google Maps). Watch; do not help unless they are stuck
for more than a minute, and write down where they hesitate, in their words.

## Feedback so far, and what answered it

Reported by the owner on 14 September 2026; not independently validated.

| Feedback | What changed | Where it shows |
|---|---|---|
| A desktop tester called it a "premium Bee Network" and liked the clean layout | The visual identity is kept, and the changes are targeted | — |
| Explore, Evidence and Operations made no sense to that passenger | The passenger's page has no tabs. The three views moved under **Behind the data**, with a short account of how the app is built, and Explore became **Recorded journeys**, dated and labelled as a recording | the header's "Behind the data" |
| They would use a mobile app (stated interest, not repeat use) | Saved stops and routes come first when the app is opened again. There are PNG icons for installing, fresh positions are fetched on returning to the page, and installation advice is given only on a lasting address. A repeat-use trial is below | "Repeat-use trial" |
| Someone asked about Metrolink | Researched, not built. No official tram positions exist; real-time departures are closed to new users; timetables are open | `docs/LOST_MINUTES_REDESIGN_RESEARCH.md`, section 7 |
| The owner enjoys the outside ride-along; the street preview stays secondary | Both are kept. The landscape overlap is fixed, and a pinch now zooms the outside view | — |

## Short trial (about 10 minutes)

For a first look before the full session below. One tester, one stop they know, a real bus.

**First, the route.** On the day, check the tester's route and stop:
`.venv/bin/python -m pipeline.route_coverage --line <line> --stop <ATCO code>`. If it has no
timetable pattern for that day (route 256 inbound had none on Monday 14 September), the page cannot
say whether a bus calls there. Pick another route for the trial, or rebuild the patterns first.
On Monday 14 September the owner's example was checked: Marston Road (nr) (`1800SJ32231`), route 15
towards Roedean Gardens. Timetable yes (the outbound pattern calls there), road geometry yes,
estimates yes, buses reporting yes. The tester's own route is still to be checked.

**Running it.** On this machine: `pnpm dev:live -- --minutes 60`, then open http://localhost:3000.
On a laptop's own browser that is enough: `localhost` counts as secure, so "Buses near me" can ask
for location. A phone needs an HTTPS address for location. Until the hosted link exists (see
`docs/HOSTING.md`), use a temporary one:

    pnpm build                    # the latest production build, in out/
    scripts/preview.sh start      # prints https://….trycloudflare.com
    scripts/preview.sh status
    scripts/preview.sh stop       # stops only what start started

`start` serves `out/` with `deploy/Caddyfile`, on 127.0.0.1 only, and `/data/*` from `public/data`.
So the phone gets each new publication, not the copy taken at build time, which is why `pnpm start`
will not do. It then opens a Cloudflare Quick Tunnel to that server: free, with no account and no
domain, and a new random address each time.

The collector:
- if one already holds the writer lock, it is reused;
- otherwise one is started for 60 minutes (`--minutes N` changes that);
- a `pnpm dev:live` started meanwhile stops at once, because its collector finds the lock taken.

How long the link lasts:
- it works while the tunnel runs and this machine stays awake with WSL up;
- closing VS Code's WSL window, shutting down or sleeping ends it, and a restart gives a new
  address;
- Quick Tunnels have no uptime guarantee.

Anyone with the link can open the page, so give it only to the tester, and stop it afterwards.
The script needs `caddy` and `cloudflared` on the PATH or in `~/.local/bin`, from their official
GitHub releases.

| # | Task | Done without help? | What they said, in their words |
|---|------|--------------------|--------------------------------|
| A | Find the stop you would board at. Say which side of the road it is and which way the buses go. | | |
| B | Pick a bus that will call there. Say how many stops away its last report was, and how old that report is. | | |
| C | Follow that bus (and ride along if you like) for three to five minutes of reports. Is it the same bus throughout, on the card, in the strip under the map and on the map? If the page says "No current report" or "another journey", what do you do? | | |
| D | Explain its status: "Last reported near …" or "Appears stopped near …", and "Estimated position" or "Last reported position". What does each mean, and what does it not tell you? | | |

**Riding along** means the outside view, which is the default. Front view is optional: a stylised
street preview from above the road where the bus is drawn. Do not steer the tester to it. If they
open it, note what they take it to show. If the map is slow to draw, note whether they find **Use
the simple map**.

Listen for a misreading. Counted as a misreading: an arrival time where none is given; "at the stop"
for "near"; "the doors are open" for "appears stopped"; an estimate taken for a report; the front
view taken for the view from on board, or for the lane the bus is in.

## Repeat-use trial: one week of real journeys

"I would use a mobile app" is interest; this measures use. Run it only on a lasting address, not
on a temporary tunnel, whose address disappears.

- **Set-up, with the tester:** open the address on their phone, find their usual stop and save it.
  Add the page to the home screen only if the address will last.
- **For a week, on each of their journeys:** did they open it without being asked? Did the saved
  stop come up at once? Did it show their bus? Did it help them decide when to leave? Did anything
  look wrong? One line each, in their words.
- **Record:**
  - journeys made;
  - times opened unprompted;
  - times it helped;
  - times it failed, and why (no live data, the wrong stop, a slow map);
  - what they used instead.
- **What counts as repeat use:** opened unprompted on at least half of their journeys that week.
  Anything less is interest.
- **Collection must run all week.** That needs hosting; otherwise the trial measures this
  machine's downtime, not the app.

## Before the session

- **Version and address:** the commit and URL under test (`git rev-parse --short HEAD`; the
  hosted address, or this machine running `pnpm dev:live` on the same Wi-Fi; under WSL, Windows
  must first forward port 3000 to it).
- **Their route:** the line, direction and boarding stop they use. Check it first, and write the
  four answers here:
  `.venv/bin/python -m pipeline.route_coverage --line <line> --stop <ATCO code>`
  (timetable patterns · road geometry · estimated movement · live buses). A route with no
  timetable or no road geometry can still be tested; the tester is told what it cannot show.
- **Device:** phone, operating system, browser, battery level, network, and the light (indoors,
  sunshine, dark).
- **Live feed:** a collector must be running during the session; note its run and end time.
- Tell the tester: it shows where buses last reported and how far they are in stops. It does not
  predict arrival times. Nothing they say is wrong.

## Tasks

For each task: done (D), done with help (H) or not done (N); seconds taken; what confused them;
and whether their usual app did it better, the same or worse, and why.

| # | Task | Done D/H/N | Time | Confusion observed | Usual app: better / same / worse |
|---|------|-----------|------|--------------------|----------------------------------|
| 1 | Find the stop you would use now (search, or "Buses near me"). | | | | |
| 2 | Say which side of the road it is on and which way the buses go. | | | | |
| 3 | Say which services leave from it today. | | | | |
| 4 | Which bus should you take, and how far away is it? (In stops; there is no arrival time.) | | | | |
| 5 | How old is that position, and is the bus drawn at a report or at an estimate? | | | | |
| 6 | Get walking directions to the stop. | | | | |
| 7 | Pick another bus coming to the stop, then go back to the first. | | | | |
| 8 | Ride along with your bus; switch to the front view (if offered) and back; exit. | | | | |
| 9 | Close the page and open it again: is your stop and bus still there? Share the link with yourself: does it open the same stop? | | | | |
| 10 | Pick a bus that is not coming to your stop, or a service with no timetable here: is it clear what the page cannot tell you? | | | | |
| 11 | Press "Follow this bus" on the bus shown, then browse the other buses for a few minutes while they report. Is it still the bus you chose, on the card, in the strip under the map and on the map? | | | | |
| 12 | Read the bus's stop status ("Last reported near …" or "Appears stopped near …"). What do you take it to mean? Would you act on it? | | | | |

## Straight after

- Would you use this to decide when to leave the house? Why, or why not?
- What did your usual app tell you that this did not, and the other way round?
- Did anything look wrong: a bus in the wrong place, a stop on the wrong side, a jumpy map?
- Did the page ever show a different bus from the one you chose, without you asking?
- Did the ride-along or the front view help, or was it decoration?
- One thing to change first.

## Observer notes

- Moments the map stuttered or the bus jumped (time, what the card said about the report age).
- Any words the tester misread (for example "estimated position", "stops before yours").
- Phone warmth and battery use after the session.

## Summary for the project record

| | Lost Minutes | Usual app |
|---|---|---|
| Tasks done without help (of 12) | | |
| Median time per task | | |
| Trust (1–5, the tester's own) | | |
| Biggest confusion | | |
| Most useful thing | | |

Record the result, with the commit tested, in `docs/LOCAL_VERIFICATION.md`. A test on a real phone
outdoors is still the only check of legibility in sunlight, frame rate and battery.
