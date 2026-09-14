# Passenger test: Lost Minutes beside the tester's usual app

One tester, one real journey they make, about 30 minutes. Lost Minutes on their own phone beside
the app they normally use (Bee Network or Google Maps). Watch; do not help unless they are stuck
for more than a minute, and write down where they hesitate, in their words.

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
