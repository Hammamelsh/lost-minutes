# The view from above: configuration, private preview and public release

Written 26 September 2026 for the owner. It covers how the photographic view is kept off the public
site, how a private trial works, what it costs and what the first look at real imagery should check.
The terms question is in `docs/PHOTO_3D_TERMS.md`. No Google account, key or billing exists yet.

## 1. Three things, kept apart

| State | What it takes | Public page | Private preview |
|---|---|---|---|
| Nothing configured (today) | nothing | not offered | "No 3D imagery is configured" |
| Configured, private | the key in the server's environment | **not offered** | offered, behind a password |
| Public | the key **and** `LM_PHOTO3D_PUBLIC=1`, the owner's switch | offered | offered |

**Adding the key does not make the view public.** How that is enforced:

- `pipeline/live.py` writes the tileset into the public `config.json` only when `LM_PHOTO3D_PUBLIC=1`.
  With the key alone it writes a private offer to `data/private/photo3d.json`, a folder no public route
  serves. A failed write of that file never stops a publication. Python tests:
  `tests/test_photo3d_config.py`.
- `deploy/Caddyfile` serves `/preview/` only behind HTTP basic authentication. The offer is at
  `/preview/photo3d.json`, behind the same password, with `Cache-Control: no-store` and
  `X-Robots-Tag: noindex`. Until the owner sets a password, the default is the hash of a random password
  nobody holds, so the preview is locked.
- The page at `/preview/` is the same app (`app/preview/page.tsx`). It reads the offer
  (`lib/preview.ts`) and says it is a private preview in a banner. The public page never asks for the
  offer, and the service worker never stores anything under `/preview/`.

A hidden button or an obscure address would not be access control. The password is.

**Verified here:**
- `deploy/validate.sh`, 43 checks, including a locked default, 401 without a password or with a wrong
  one, 200 with the right one, `no-store` and `noindex`, and private paths returning 404.
- `tests/browser/preview.spec.mjs`: the public page makes no request under `/preview/`, and the preview
  banner appears with or without an offer. Desktop and phone profiles, fixture data.

## 2. What the owner does, in order

1. **Decide whether to run a private trial before Google has answered.** A password-protected preview
   is still a use under Google's terms (`docs/PHOTO_3D_TERMS.md` §6).
2. **In Google Cloud:**
   - create a project with billing;
   - enable the *Map Tiles API*;
   - create an API key restricted to **Websites** `https://lost-minutes.duckdns.org/*` and to the **Map
     Tiles API** only;
   - on *Google Maps Platform > Quotas*, set the Photorealistic 3D Tiles daily root tileset quota to
     **25** (§3);
   - add a budget alert at $5. An alert only warns; the quota is what stops spending.
3. **On the server**, from `/srv/lost-minutes/app`:

   ```bash
   sudo nano /etc/lost-minutes/collector.env      # add LM_PHOTO3D_GOOGLE_KEY=...; leave LM_PHOTO3D_PUBLIC unset
   sudo systemctl restart lost-minutes-collector   # it reads the file when it starts
   sudo deploy/set-preview-password.sh             # asks for a user name and a password, shows nothing
   ```

4. **Open** `https://lost-minutes.duckdns.org/preview/`, sign in, then *Explore Manchester* → *See
   Manchester from above*.

To lock the preview again: `sudo deploy/set-preview-password.sh --lock`. To withdraw the key, remove
the line and restart the collector. The collector rewrites the configuration with every publication,
so the private offer file is deleted about 20 s after the restart.

The key restriction should match. The site sends `Referrer-Policy: strict-origin-when-cross-origin`, so
Google sees `https://lost-minutes.duckdns.org/` as the referrer. If the key is refused anyway, the
view says the provider refused the request and leaves the map as it was.

## 3. A bounded private trial

**The billing unit is one root tileset request.** Google bills requests for `root.json`, "per 1000
events". The requests the renderer makes for tiles after that are neither billed nor counted against
the quota. One root request allows "at least three hours" of tile requests.

**What makes a root request:**

| Action | Root requests |
|---|---|
| Loading or reloading the page, map and ride-along included | **0**: nothing is asked of Google until the view is opened (browser check) |
| Opening the view | **1** (browser check: exactly one) |
| Exit and open again | 1 more |
| Reloading while the view is open | the view closes; opening it again is 1 more |
| The view open in a second tab or on another device | 1 each |
| The view left open past about three hours | tiles begin to fail and the view says the session has ended; it **never renews by itself**, and reopening is 1 more |

**Recommendation: a daily quota of 25 root requests.** Three to five testers opening the view a few
times a day fit inside it.

| Daily quota | Most in a 31-day month | Billable after the free 1,000 | Worst-case cost a month |
|---|---|---|---|
| **25** | 775 | 0 | **$0.00** |
| 50 | 1,550 | 550 | 550 × $6.00 / 1,000 = **$3.30** |
| 500 (not recommended) | 15,500 | 14,500 | 14,500 × $6.00 / 1,000 = **$87.00** |

The free 1,000 a month counts usage across every project on the billing account. Other use of
Photorealistic 3D Tiles on the same account shares it.

**When the day's quota runs out:**
- Google "stops responding to requests".
- A new opening shows one message: "Today's allowance of 3D imagery for this site has been used up, so
  the view cannot open until it resets. The map works as before."
- *Back to the map* is one tap, and the map, the buses and the ride-along are unaffected.
- A view already open keeps working until its session ends, because tile requests are not counted.
- The daily count resets on Google's schedule. Google Cloud documents daily quotas as resetting at
  midnight US Pacific time, which is 08:00 in the UK in summer; that was not re-checked for this API.
- The browser check simulates the quota answer as HTTP 429. What Google actually returns at the limit
  was not seen, and cannot be until a key exists.

Public release and any spending above the free tier stay the owner's decisions.

## 4. The first look at real imagery

`scripts/probes/above-imagery.mjs` is the measurement, ready before the key exists.

- Run through the preview: set `LM_PREVIEW_USER` and `LM_PREVIEW_PASS` in the environment and pass
  `--base https://lost-minutes.duckdns.org/preview/`.
- Run locally: set `LM_PHOTO3D_GOOGLE_KEY`.
- The key and the password never appear in its output, and `key=` is removed from every URL it writes.
- `--fixture` checks the harness itself against the fixture tileset. That has been run; the result is
  in the milestone record.
- For each corridor, at phone and desktop sizes, it replays a recorded reel with a pinned bus. It opens
  the view and captures the city, the elevated follow for a minute and the closer follow for a minute.
  It then hides the page for 30 s, shows it again, and exits.
- It records: ready and usable times, root and tile requests, tile bytes, frames, the tick's cost, the
  heap before, during and after, tile failures, recovery after hiding, and whether the same bus is
  still chosen after exit.

**Corridors.** The city centre is built in: two route-192 buses at the Piccadilly terminus, noon on 26
September, including a journey change, a stand and pulling away. For a suburban corridor, pass a reel
and vehicle with `--suburban`, for example a route-15 or route-263 journey through Stretford.

**What to judge by eye, at both distances:**
- buildings;
- whether a bus box sits on the road at the right height;
- bridges and flyovers;
- buildings hiding the bus;
- camera steadiness while following;
- tile loading while moving.

If the closer view reads poorly on real tiles, keep the elevated follow and remove *Closer*. It is
offered, not forced.

**Two ages, kept apart.** The view says the imagery was "captured at an earlier date, which the
provider does not publish", and that it is "not a live view". Each bus card gives its own report's
age: "report 15 s old · drawn a little behind it".

## 5. Status

| Requirement | Status | Evidence |
|---|---|---|
| Public switch, off by default | Implemented and verified | Python tests; the public page never requests the offer (browser check) |
| Restricted preview | Implemented and verified locally | `deploy/validate.sh` against this Caddyfile; the server check is in the milestone record |
| Opens only on request; released on exit | Implemented and verified | No Google request before the tap; after Exit the view and its canvas are gone (browser checks) |
| Same bus and moment as the map | Implemented and verified | The chosen bus in the view is under 5 m and under 400 ms from the map's own drawing (browser check, fixture) |
| Quota, refusal, no answer, failing tiles | Implemented and verified on simulated answers | One browser check each, both profiles |
| Hidden and shown again | Implemented; verified with visibility emulated | Browser check; a real phone may behave differently |
| Session ending after about three hours | Implemented, unverified | Needs a real session held that long |
| Attribution, terms and privacy notices | Implemented and verified on the fixture | Browser check; Google's own credit strings need real tiles |
| Imagery quality, bus fit, bridges, occlusion, frame rate and memory on real tiles | **Blocked** | Needs the key (§2) |
