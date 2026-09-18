# Approaching TfGM — drafts, not sent

**Nothing here has been sent and no contact has been made.** These are drafts for Hammam to edit,
address and send if and when he chooses. No individual is named because no name has been verified;
the routes to a real contact are listed instead.

Two things are being asked for, and they are worth keeping separate:

1. **Feedback on a data-quality observation**, which costs them ten minutes and is useful to them
   whatever they think of the app.
2. **A conversation about a small pilot**, which is a bigger ask and should follow the first, not
   ride on it.

The first is the door. Lead with something useful to them rather than something you want.

## The observation, stated exactly

On **Friday 18 September 2026**, four vehicles were reporting on **route 256** in the BODS SIRI-VM
feed inside the collection area. The TfGM TransXChange registration for that line that is in force
from 30 August 2026 contains, in the dataset this project consumes:

| File | Operating days | Directions | Journeys |
|---|---|---|---|
| `…_20260830_20310719_2416002.xml` | Saturday | inbound and outbound | 90 |
| `…_20260830_20310719_2416003.xml` | Sunday (and Friday outbound, school holidays only) | inbound and outbound | 148 |
| `…_20260830_20310719_2416004.xml` | Mon–Thu, school days | outbound only | 1 |
| `…_20260830_20310719_2416005.xml` | Friday, school holidays only | outbound only | 1 |
| `…_20260830_20310719_2416006.xml` | Mon–Thu, school days | outbound only | 1 |

So **on a Friday in term time the registration contains no journeys at all for that line**, while
buses are reporting against it. The previous registration, which expired on **29 August 2026**
(`…_20260719_20260829_2390029.xml`), carried a full **Monday–Friday** service of **101 journeys in
both directions**.

**How this was found, so it can be checked independently:** the files are parsed out of the
published dataset with `pipeline/patterns.py`, which reads each `VehicleJourney`'s operating profile
including the school-day `ServicedOrganisation` ranges, and publishes only patterns that some
journey actually runs. Repeat with
`.venv/bin/python -m pipeline.patterns build --lines 256` and read
`public/data/patterns.json`.

**What is not being claimed.** That the service does not run — it plainly does, the buses are
there. That TfGM has made an error — the weekday service may be registered in a dataset this
project does not read, or published under another operator or line code, or there may be a reason
this reading misses. The question is exactly that: *where should a consumer look for it?*

## Draft: the first email

> **Subject:** Route 256 weekday journeys missing from the published TransXChange registration?
>
> Hello,
>
> I'm a Manchester data engineer building an open-source bus companion for my own area, on the
> DfT's Bus Open Data Service and your published TransXChange timetables. It isn't a product and
> I'm not selling anything — the source is public and the whole thing runs on one small server.
>
> While matching live vehicle positions to timetables I found something I think is worth flagging.
> For **route 256**, the registration in force from 30 August 2026 appears to contain only Saturday,
> Sunday and a few single school-day journeys: on a Friday in term time it has no journeys at all,
> yet four 256 vehicles were reporting positions that day. The registration that expired on
> 29 August carried a full Monday–Friday service of 101 journeys.
>
> I may well be reading it wrong, or looking in the wrong dataset. If there's somewhere else a
> consumer should be reading the weekday 256 from, I'd be glad to know — and if it is a gap, you
> have it early. I'm happy to send the exact file names and the code that reads them.
>
> Separately, and with no expectation: if it would ever be useful to have an independent view of
> how well the published timetables explain the live feed — I generate a per-service ledger of
> which services can and cannot be placed on a pattern, and why — I'd be glad to share it or talk
> it through.
>
> Best wishes,
> Hammam Elshtewi
> [repository link] · [contact]

**Before sending:** re-run the check that morning, because a new registration may have been
published since. The observation is only worth sending while it is true.

## Draft: one page they can forward

> ### Lost Minutes — an independent bus companion built on open Manchester data
>
> **What it is.** A personal, open-source project by one Manchester data engineer. It finds a stop,
> shows which buses are timetabled to call there, how old each bus's last report is, and follows
> one on a map. It is not a commercial product, has no users beyond invited testers, and is not
> affiliated with TfGM or any operator.
>
> **What it is built on.** Vehicle positions from the DfT's Bus Open Data Service (SIRI-VM, Open
> Government Licence v3.0). Timetables from TfGM's published TransXChange datasets on BODS. Stops
> from NaPTAN (ATCO area 180). Basemap and road geometry from OpenStreetMap (ODbL). Every one is
> credited in the app.
>
> **What it will not say.** It never predicts an arrival time. It never claims a bus called at a
> stop. Where the evidence does not support a statement it says so and shows why — a bus whose
> timetable cannot be found is still drawn at its last reported position, with the age of that
> report, and the app says plainly that it cannot tell you what it calls at.
>
> **What might be useful to you.** Because it refuses rather than guesses, it produces a
> by-product: a per-service ledger of how far the published timetable can explain the live feed.
> On one publication of 587 vehicles it placed 285 on a timetable pattern and recorded a reason for
> each of the rest — an unsettled branch between two paths, no registration held for that operator
> and line, no journeys on that day, a position too far from any stop on the route. That is a
> consumer's-eye view of published data quality, and it is free to produce.
>
> **What no personal data means here.** The app is static files. A passenger's location never
> leaves their browser except when they ask for walking directions, when a position rounded to
> about 10 m goes to a public OpenStreetMap routing service. Nothing is stored about anyone and
> there are no accounts.
>
> **What a small pilot could look like.** A handful of real passengers on one or two corridors for
> a few weeks, with the feedback shared back. Nothing is needed from TfGM to run it. The one thing
> that would genuinely help is access to real-time departure predictions, which the public portal
> is closed to new registrations for; without it the app deliberately shows no predicted times at
> all.

## Where to find a real contact

No name is given here because none has been verified. Reasonable routes, in order:

1. **The BODS dataset's own publisher contact.** Each dataset page on
   <https://data.bus-data.dft.gov.uk> lists the publishing organisation and a contact address —
   the right door for a data-quality question about that dataset, and the most likely to be read
   by someone who can act.
2. **TfGM's open data / developer pages**, for a general enquiry address.
3. **LinkedIn**, for someone in a data or Bee Network digital role — better for the pilot
   conversation than for the data-quality note.

Send the data-quality note through route 1 first. It is the one with a clear owner.

## What not to do

- Do not present the 256 finding as an error until they have had a chance to explain it.
- Do not imply any endorsement, partnership or affiliation, in the app or anywhere else.
- Do not claim users, uptime or accuracy the project does not have. It is an early beta with
  invited testers and it should say so.
- Do not ask for data access in the first message. Ask a question they can answer in ten minutes.
