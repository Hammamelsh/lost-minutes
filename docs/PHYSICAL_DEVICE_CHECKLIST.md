# Physical-device checklist

Everything in this repository has been checked in Chromium on a Linux laptop: desktop and phone
*emulation* (390 × 844, touch events, device scale 3), WebGL through SwiftShader (a software
renderer), and real publications from the server through a local proxy or the served site. No
check below has been run on a physical phone. Each is written so that whoever holds the phone can
answer it in a minute and write the answer next to it, with the phone model, OS version and
browser.

Status words: **unchecked** (nobody has held a phone), **passed**, **failed** (with what was seen).

## Before starting

- [ ] Phone model, OS and browser: ____________________. Location permission state before the
      test: ____________________.
- [ ] Open https://lost-minutes.duckdns.org over mobile data, not Wi-Fi, once; note the time to the
      first map paint: ____ s. (Emulation: 2–4 s on a fast connection; a slow tile is waited for up
      to 40 s and the simple map is offered after 3 s.)

## Location and the walk (needs a real GPS fix)

- [ ] **Buses near me** on a street: the nearest stops are the right ones, on the right side of the
      road, and the "about … m" hedge appears only when the fix is coarse. *unchecked*
- [ ] Choose a stop; the walk guide's distance and minutes are plausible against the street.
      "Update my location" after walking 50 m moves the start. *unchecked*
- [ ] **Walk to stop in Google Maps** opens Maps at the boarding point's coordinates, and coming
      back to the browser keeps the stop and the chosen bus (the tab's own state). *unchecked*
- [ ] Indoors or under cover: the fix is refused as too coarse (over 150 m) rather than routed;
      "Choose starting point" on the map works with a finger. *unchecked*

## Touch

- [ ] Every control is reachable with a thumb; nothing under 44 px is missed twice in a row
      (the header wordmark is the one known exception). *unchecked*
- [ ] A tap on a bus marker chooses it; a tap where two buses overlap opens the small chooser at
      the finger, and "Neither" closes it. *unchecked*
- [ ] In the ride-along a pinch zooms and keeps following; a one-finger drag pauses following and
      **Return to bus** resumes it; in the front view a pinch pauses. *unchecked*
- [ ] Search results stay above the keyboard while typing a stop name. *unchecked*

## The ride on a real GPU and screen

- [ ] Outside view at zoom 20 with the 3D bus: frame rate feels continuous (the ride card's
      `data-frame-ms` is in the feedback report; note it: ____ ms). *unchecked*
- [ ] Front view (street preview): the buildings, kerbs and names draw; the camera does not stall
      while the bus is drawn moving; the phone does not become hot within five minutes; battery
      drop over ten minutes of riding: ____ %. *unchecked*
- [ ] Day theme in direct sunlight: the lime chosen-bus marker, the orange stop and the blue "You"
      are still distinguishable; the ride card's text is readable. *unchecked*
- [ ] Night theme at night: same. *unchecked*
- [ ] Landscape: the ride card does not cover **Front view** / **Outside view**. *unchecked*

## Movement, watched for two full minutes on one bus

- [ ] A bus with **Estimated movement**: it moves continuously between reports and a new report
      corrects it without a visible jump; a large correction shows the dashed trace and the card's
      "Moved N m to its latest report" line for a few seconds. *unchecked*
- [ ] A bus with **Reported positions · may pause**: it travels between its reports and waits at
      the newest; the card's "latest N s ago" keeps counting while it waits; it never runs ahead
      of the marker ring of its newest report. *unchecked*
- [ ] After 30 s with the phone locked and unlocked again: the bus is where its newest report is,
      the age is right, no stale animation plays out. *unchecked*

## Returning and installing

- [ ] Add to home screen (iOS Safari "Add to Home Screen"; Android Chrome "Install"): the icon,
      name and splash are right; opening from the icon restores the last stop as an *offer*
      ("Continue · …"), not silently. *unchecked*
- [ ] Airplane mode with the page open: the badge says OFFLINE; the last positions stay listed as
      old; turning data back on resumes within one poll. *unchecked*
- [ ] A shared link (`?stop=…&bus=…`) opened on a second phone lands on that stop and that bus,
      or says what became of the bus. *unchecked*

## The sheet, on a real phone (added 22 September 2026)

Emulation cannot answer any of these: the on-screen keyboard, the browser's own bars and a real
finger are all absent from Chromium.

- [ ] Dragging the sheet's handle up and down snaps to its three heights, and the drag never
      scrolls the page behind it. *unchecked*
- [ ] Tapping the handle (not dragging) opens and closes it, first time, with a thumb. *unchecked*
- [ ] Tapping the search field folds the sheet and the matches are above the keyboard, with the
      list scrollable and nothing under the browser's bottom bar. *unchecked*
- [ ] With the keyboard open, the map and the top bar are still where they were, and closing it
      restores the sheet's height. *unchecked*
- [ ] Turning the phone on its side while a stop is open keeps the stop, the chosen bus and the
      map, and the two-column layout is reachable without scrolling to it. *unchecked*
- [ ] With the system font set larger, the panel's text grows or, if it does not (the type is in
      pixels), page zoom at 125% and 150% leaves nothing clipped or overlapping. *unchecked*
- [ ] The sheet at its full height still shows a strip of map, and the map's own controls are not
      under the sheet. *unchecked*

## The ride-along, the movement and the departure board (added 23 September 2026)

- [ ] **Come back to a backgrounded tab.** Leave the page riding a bus, switch to another app for
      three or four minutes, come back. The bus should either be travelling from where it was, or
      be repositioned with a line saying how far and why — never appear somewhere else with no
      account. **This is the one thing emulation could not test**: headless Chromium kept drawing
      when the probe put another tab in front, so nothing is claimed about it. *unchecked*
- [ ] Lock the screen for two minutes mid-ride, unlock, and watch the first few seconds. *unchecked*
- [ ] On a real GPU, is the bus's travel between reports smooth, or does the frame rate make it
      look like stepping? Read `data-frame-ms` from the feedback report. *unchecked*
- [ ] A bus with an accepted road (route 25 inbound, say): does the drawn bus stay on the street,
      or cut corners into buildings, at street zoom by eye? *unchecked*
- [ ] Ride a bus through a real correction and watch the ease-back: it should read as the bus being
      corrected over several seconds, not as a dart. *unchecked*
- [ ] **Front view** on a service that has no road: the button says why on its face, and pressing
      it gives the whole reason without leaving a dead control. *unchecked*
- [ ] The departure board at a real stop: are the scheduled times right against the printed
      timetable at that stop, or against the Bee Network board? Check one stop at a quiet hour and
      one at a busy one, and a stop with journeys after midnight. *unchecked*
- [ ] The departure board with the phone's clock set to another timezone: the times should still be
      Manchester's. *unchecked*
- [ ] With the sheet at half height, is the departure board the first thing under the handle, and
      can the next departure be read without opening the sheet fully? *unchecked*
- [ ] **The sheet, in Safari with its bars showing and again with them hidden** (scroll the page
      first): drag the handle to the top of the screen — does it stay expanded, and is the search
      bar still above it? Flick it up from half; flick it down from full. Press **Open full list**
      and **Show map**. Then scroll the list to its end, wait for three or four publications, tap the
      search and dismiss the keyboard: the sheet must be where you left it each time. This was
      reproduced and fixed in emulation at 390 × 664 only; the physical case is the report. *unchecked*
- [ ] With the keyboard up on iOS, does the sheet sit above the keyboard (it is fixed to the visual
      viewport) rather than under it? *unchecked*
- [ ] **Try Ride-along** on the home screen: are the rows honest about the ride each bus gives, and
      does choosing one start the ride at once on that bus, with Exit one tap away? *unchecked*
- [ ] **Watch a recorded ride** (offered under Try Ride-along, and first when nothing live suits):
      the bar, the handle, the panel and the ride card all say it is a recording from 23 September
      2026; the bus moves between its reports; **Back to live buses** brings the feed back and the
      recorded bus is gone. Share it: the copied link reopens the recording. *unchecked*
- [ ] Ride a bus on a service with a checked road (a 142 on Wilmslow Road, a 163 on Rochdale Road):
      the bus should sit *on* the road, headed along it, and move at a bus's pace — pulling away,
      slowing, never surging or teleporting — about 30–60 s behind its newest report (the card says
      how far). Watch one for three minutes and count anything that looks like a jump. Then a bus
      with no checked road: the same, along the straight lines between its reports. *unchecked*

- [ ] The way in: on the home screen, under **Buses near me**, the line *Or try Ride-along* opens
      the sheet and lands on the section with three different services (not one route three
      times) and the recording, every title whole. *unchecked*
- [ ] Entering a ride: the camera settles behind the bus rather than arriving at speed; the
      controls fade in; the bus sits in the lower half of the clear band with the road ahead above
      it; a soft lime ribbon lies on the road ahead and the next stops are named on it (on a bus
      with a checked road — a 142, a 163, a 250); no ribbon on a bus without one. *unchecked*
- [ ] With reduced motion on (iOS: Settings › Accessibility › Motion): no fade, no glide, the ride
      simply appears on the bus. *unchecked*
- [ ] The card reads *drawn about N s behind* and N is 30 to 60; it changes by fives, never
      flickers. *unchecked*

- [ ] The route-43 incident's ride, on a phone: a 43 outbound from Piccadilly Gardens along Portland
      Street, Princess Street, Whitworth Street and Oxford Street. The bus faces along its road
      through each turn; the view never swings round in one jump; it stays on the road on the
      Whitworth Street–Oxford Street corner. Put the browser away for a minute and come back: the
      card says the bus was moved while the page was in the background. The card's "drawn about N s
      behind" stays between 30 and 60. *unchecked*

- [ ] A bus standing at Piccadilly Gardens (a 216, 143 or 142 at its stand), ridden for a minute:
      it faces along its road and does not turn while it stands, and the card does not call it off
      its road. If it is shown from above, the ride says it reported no direction; when it moves
      off, the view turns round to it over about a second, not in one jump. *unchecked*

- [ ] Try Ride-along's rows, each ridden for three minutes: the bus moves along its road, faces the way
      it goes through corners, and does not jump. If the list is empty, it says why and offers the
      recording. *unchecked*

- [ ] A 250 or a 15 ridden from its stop's board: on the map it is *Estimated*; in the ride *Moving
      between its reports* or *Standing*, with how far behind; the board's "N stops before yours" does
      not wait for the drawing. Entering and leaving, the bus does not hop backwards on screen. A quick
      drag at the very start of the ride pauses following on a slow phone too. *unchecked*

## When something looks wrong

Open **Send feedback** at the foot of the page and press **Copy this report**: it copies a report
with the publication hash, the map's frame time and the state of the ride to the clipboard. Paste
it into an issue with the phone model. Do not describe an emulation result as a phone result, and do not describe a phone
result without the phone.
