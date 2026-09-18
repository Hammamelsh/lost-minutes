# Hosting recommendation

A concrete proposal, costed from measured figures. **Nothing has been provisioned.** This
needs your decision before anything is bought.

## What actually has to run

| Piece | Needs | Can it be static? |
| --- | --- | --- |
| The website (`out/`) | static files | yes |
| `live.json` | rewritten every 20s by one writer | no — but it is one small file |
| The collector | a long-running process, a persistent disk, restart on failure | no |
| DuckDB history | a persistent disk that survives restarts | no |

Measured on the real 10-minute capture: **30 KB gzipped per response** (456 KB raw),
**0.13 GB/day** of raw captures at a 20-second interval, ~540,000 observations/day, and the
published `live.json` at **66 KB** for 155 vehicles.

## Recommendation: one small VPS, with Cloudflare in front

**Hetzner Cloud CX23** (2 vCPU, 4 GB RAM, 40 GB NVMe, Falkenstein, Nuremberg or Helsinki; the size
this proposal first called CX22) running:

- the collector under **systemd** with `Restart=always` and `RestartSec=30`, so a crash, an
  OOM or a reboot brings it back without anyone watching;
- **Caddy** serving `out/` and `data/published/live.json` over TLS;
- the DuckDB file and `data/live-capture/` on the same SSD, which is what makes restart-safe
  resumption work — the checkpointing already implemented is worthless on ephemeral storage;
- **Cloudflare (free plan)** in front for TLS, caching and a stable hostname.

**Why this and not the alternatives.** Cloudflare Pages or Netlify host the site for nothing
but cannot run a 24/7 writer with a disk. Fly.io works and is comparable in price, but its
volumes are per-machine and the free allowances have moved more than once. A Raspberry Pi at
home is genuinely cheaper and a legitimate choice — the trade-off is your home IP, your
electricity and your uptime, which is a poor story for a portfolio link. GitHub Actions is
not an option: a scheduled job every 20 seconds is outside what the free tier is for, and
each run would start with no warehouse.

One machine, one bill, one thing to restart. Add a second only when there is a reason.

## Cache settings

| Path | Header | Why |
| --- | --- | --- |
| `/data/live.json` | `Cache-Control: public, max-age=10, stale-while-revalidate=20` | Absorbs load without ever serving something more than ~10s behind the collector, which publishes every 20s. |
| `/data/config.json` | `Cache-Control: public, max-age=60` | Repointing the live URL should take effect within a minute. |
| `/data/replay.json`, `/data/roads.json` | `Cache-Control: public, max-age=3600` | Change rarely; 1.6 MB, so worth caching. |
| `/_next/static/*` | `Cache-Control: public, max-age=31536000, immutable` | Content-hashed filenames. |
| `/`, `/index.html` | `Cache-Control: no-cache` | Must revalidate so a deploy is picked up. |
| `/sw.js` | `Cache-Control: no-cache` | Never pin an old service worker. |

The frontend already requests the live state with `cache: 'no-store'` and a cache-busting
query, so a misconfigured edge cache cannot freeze the map; these headers are about
protecting the origin, not about correctness.

## Retention

- Raw position captures: keep **14 days** (~1.9 GB), then delete. They are reproducible
  evidence for recent publications, not an archive we are obliged to keep.
- Timetable versions: keep every distinct content hash. They are ~10 MB each and change
  rarely, and they are the record of what the schedule said at the time.
- DuckDB observations, runs, cycles, quarantine and publications: keep indefinitely for now;
  revisit once a month of real growth has been measured rather than estimated.
- Published snapshots in `data/published/`: keep 7 days of rejected candidates for
  inspection; keep every successful publication's metadata in the warehouse regardless.

## Itemised estimate

**Re-checked on 17 September 2026 against Hetzner's own price-adjustment page, and unchanged since
14 September.** For new orders from 15 June 2026 the **CX23** (2 vCPU, 4 GB RAM, 40 GB NVMe, 20 TB
traffic) is **€5.49 a month net (€0.0088 an hour), excluding IPv4**, up from €3.99; the Arm CAX11
is €5.99, up from €4.49. That page states "All prices are excluding VAT". Hetzner's IP pricing page
lists a cloud Primary IPv4 at **€0.50 a month**, and billing is the lower of the hourly rate and
the monthly cap, charged whether the server is running or not.

Source: <https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/> and
<https://docs.hetzner.com/cloud/billing/faq/>. The main pricing page renders its figures in the
browser and still cannot be read here; confirm the total in the console before ordering.
- Backups: the price is shown only on the product page, which renders its figures in the browser
  and could not be read here. They are listed as 20% of the server's price, as recorded earlier.
- VAT: UK consumers are charged 20% on top of the net prices, as recorded earlier.
- Sterling: the figures below use about £0.85 to the euro, an assumption.

**Confirm the total in the Hetzner console before ordering.**

| Item | Monthly |
| --- | --- |
| Hetzner CX23 (2 vCPU, 4 GB, 40 GB NVMe) | €5.49 net |
| Primary IPv4 | €0.50 net |
| Server with IPv4, with 20% VAT | about €7.19 (~£6.10) |
| Hetzner **Backups** — automatic, daily, 7 kept; 20% of the server price (optional, currently off) | about €1.10 net, €1.32 with VAT (~£1.12) |
| Hetzner **Snapshots** — manual, per GB of compressed image (a different product; also off) | pennies, but only if someone remembers to take one |
| Cloudflare free plan (optional) | £0.00 |
| Object storage | £0.00: not needed, since 40 GB covers the retention below with room to spare |
| Domain (amortised) | ~£0.85 (~£10 a year); needed for HTTPS unless an existing domain is used |
| **Total** | **~£7 a month without backups, ~£8 with backups, both with a domain** |

First year, with backups and a domain: roughly **£95**.

**Storage, measured on this machine on 14 September 2026.** After about two days of intermittent
bounded runs, the DuckDB warehouse is 124 MB and the raw live captures 153 MB, with 32 MB of
archive downloads. At the measured 0.13 GB a day of raw captures, 14 days of retention is about
1.9 GB, well inside the 40 GB local NVMe disk. That disk is persistent across restarts, which is
what the collector's checkpointing needs.

## What the collector actually needs, measured

### A correction to what this document said on 17 September

It said the resident set was "**~1.55 GB, steady** over repeated samples — it is not growing, so
24/7 operation is not a leak risk". **That was an overclaim and it is withdrawn.** Three samples
over sixty seconds cannot tell a plateau from a slow climb, and a longer look on 18 September
showed a climb: **1,148 MB → 1,237 → 1,334 → 1,402 → 1,411 → 1,426 → 1,466 MB across three minutes**
of collection.

The cause was not a leak. **DuckDB's default memory limit is 80% of the machine's RAM** — 12.6 GB
on this 16 GB laptop — so it took what it was offered and kept taking. On a 4 GB server the same
default would reach for 3.2 GB and meet the OOM killer.

**What changed:** `pipeline/warehouse.py` now sets an explicit limit when it connects, **1 GB by
default**, with `LM_DB_MEMORY_LIMIT` and `LM_DB_THREADS` to override. Over the limit DuckDB spills
to disk beside the database rather than failing.

**What that did not change, and it is the finding that matters:** with the limit in force the
resident set went on rising. Sampled every thirty seconds through **63 minutes** of continuous
collection, the median by six-minute window was:

```
1465  1573  1563  1626  1626  1686  1698  1673  1690  1719  1784   MB
```

**That is not a cache warming to a plateau. It rises in almost every window, by roughly 300 MB an
hour, and had not flattened when the run ended at 1,807 MB.** Extrapolated — and extrapolation is
all it is — that reaches the 2,400 MB ceiling in the collector's unit in two to three hours, where
systemd would restart it and the climb would begin again.

That looked like a leak, and it was tested rather than assumed. There is no per-cycle accumulation
in `pipeline/collect.py` and no module-level cache anywhere in the pipeline, so the growth had to be
below the Python: DuckDB's own allocation, or glibc's arenas — **and both scale with thread count.**
DuckDB takes a thread per core, so 32 on this 16-core laptop, where a CX23 gives 2.

### Re-run with two threads, which is what the server will have

The same collector, same feed, same code, with `LM_DB_THREADS=2` and `MALLOC_ARENA_MAX=2`:

| | 32 threads (this laptop's default) | **2 threads (a CX23)** |
|---|---|---|
| Resident set, early in the run | ~1,378 MB | **342–497 MB** |
| After an hour | 1,766 MB and still rising | — |
| Over 19 minutes | **+300 MB an hour, no plateau** | **flat: median 376 MB across 26 readings, no upward trend** |

**The growth does not reproduce at the thread count the server will run.** It was the allocator
scaling with cores, not the application accumulating anything — which also explains why bounding
DuckDB's `memory_limit` barely moved the total: the memory was in arenas, not in the buffer pool.

The unit now pins `LM_DB_THREADS=2` and `MALLOC_ARENA_MAX=2` explicitly rather than relying on the
server having two cores, so the figure does not change if it is ever moved to a larger machine.

**Two caveats, because this is the kind of result it is tempting to over-read.** Both variables were
changed together, so which of the two does the work is not established — only that the pair removes
the growth. And the flat run lasted 19 minutes, not days: the 48-hour observation is still what settles
it. What has changed is that there is no longer a reason to expect a leak, and the expected
footprint on the server is **about 376 MB rather than 1.8 GB and climbing**.

### The figures

| | | How |
|---|---|---|
| Collector resident set | **~1.4 GB** with the 1 GB database limit in force | `ps` every 30 s through a bounded run, 18 Sep |
| Nightly timetable refresh, peak | **853 MB**, 3 min 05 s wall clock, 34% CPU | `/usr/bin/time -v .venv/bin/python -m pipeline.patterns build`, 18 Sep |
| Warehouse on disk | 172 MB after a few days of intermittent runs | |
| Raw captures on disk | 220 MB, **3,821 captures**, growing at a measured 0.13 GB a day | |

**These are the numbers that decide a host.** The nightly rebuild alone peaks at 853 MB, so a
platform selling 512 MB cannot run it, and the collector wants about 1.4 GB beside that. The
Hetzner CX23's 4 GB is comfortable; 1 GB would not be.

### What is still unknown, and should not be claimed

**Whether the resident set is stable over many hours or days is not established.** Nothing here has
run for more than about ninety minutes at a stretch, and the longest run this machine has managed
ended when it went to sleep. A leak that shows itself after six hours would look exactly like these
measurements. That is what the 48-hour observation in `docs/RELEASE.md` exists to find out, and
until it has run, this document claims nothing about leaks in either direction.

## Platforms that host a static site, and why they do not host this

Raised on 17 September 2026: could Render or Netlify carry the beta "for now"?

**Netlify: no.** It serves static files and serverless functions. There is no long-running process
and no persistent disk, so `live.json` would be frozen at whatever the build produced. That is the
one file the whole app exists to keep fresh.

**Render: possible, and more expensive than it looks.** Read from Render's own documentation the
same day:
- a persistent disk attaches to **one service instance only**, and **cron jobs cannot mount one at
  all**. So the collector and the file serving must be the *same* service, and the nightly timetable
  rebuild has to run inside that process rather than as a scheduled job;
- **free instances spin down after 15 minutes without traffic and cannot have disks**, so a free
  service cannot collect;
- the **Starter web service is $7 a month with 512 MB of RAM and 0.5 CPU**; disks are **$0.25 per GB
  a month**. Against the 1.55 GB measured above, the honest tier is the next one up at $25.
- Sources: <https://render.com/docs/disks>, <https://render.com/docs/free>, and Render's pricing as
  reported in September 2026.

Render *is* the right home for a static page over an exported file — it already serves Energy
Reconciliation's front door. It is the collector that does not fit.

**For comparison, the Hetzner CX23 is 2 vCPU and 4 GB for about £6.10 a month with VAT**, and
everything in `deploy/` — the systemd units, the Caddyfile, the watchdog, the nightly rebuild, the
rollback — is written for it and validated on this machine. None of that transfers to Render.

## Can the beta run on a provider hostname, without buying a domain?

Not reliably, and it is worth being precise about why, because "it has a hostname" is not the same
as "it can have a certificate".

* **Hetzner's own rDNS name** (`static.<ip>.clients.your-server.de`) does resolve to the server, so
  an ACME HTTP-01 challenge would work in principle. In practice Let's Encrypt counts certificates
  per registered domain, and `your-server.de` is shared by every Hetzner customer, so that budget
  is permanently exhausted. Issuance fails, unpredictably, and a portfolio link that intermittently
  shows a certificate warning is worse than no link.
* **A free dynamic-DNS subdomain** — DuckDNS, afraid.org and similar — is a real answer. It is a
  normal DNS name under a domain with spare certificate budget, Caddy obtains a certificate for it
  the usual way, and it costs nothing. `lost-minutes.duckdns.org` would carry the beta perfectly
  well. The cost is that it reads as a hobby address on a CV.
* **A domain of your own**, about £10 a year, is the one that reads right next to your name, and it
  is what saved stops and a home-screen icon need to keep working.

**So: yes, the beta can start today without buying anything, on a free dynamic-DNS subdomain, and
the domain can be added later without changing the server** — Caddy takes a new name from
`/etc/lost-minutes/caddy.env` and obtains its certificate on restart. Anyone who saved stops under
the old address would lose them, which is an argument for choosing the final name before inviting
more than a handful of testers.

## Backups and recovery

Nothing here is irreplaceable in the same way, so the policy differs by kind:

| What | If the disk is lost | Policy |
|---|---|---|
| The site and the pipeline | re-uploaded from this repository in one command | no backup needed |
| The DuckDB warehouse | rebuilt from the raw captures it was loaded from | no backup needed |
| Raw position captures | **cannot be re-collected**: the feed has no history | the only thing worth paying for |
| Timetable versions | re-downloadable, but a withdrawn registration is gone for good (route 256's Monday–Friday file already is) | worth keeping |

### Hetzner's two things are not the same thing

This document used "backups" and "snapshot" interchangeably until 18 September 2026. They are
different products with different failure modes, and the difference is the whole argument:

| | **Backups** | **Snapshots** |
|---|---|---|
| Created | **automatically, once a day** | **by hand, when someone asks** |
| Kept | 7 slots; the oldest is deleted when a new one is made | up to 30 per project; **never deleted automatically** |
| Priced | **a flat 20% of the server's price** | **per GB per month** of the compressed image |
| Tied to | that server (convert one to a Snapshot to move it) | the project; moveable |
| For this CX23 | **≈ €1.10 net a month, €1.32 with VAT (~£1.12)** | a few GB at about €0.0143/GB, so **pennies** |

Sources: <https://docs.hetzner.com/cloud/servers/backups-snapshots/faq/> and
<https://docs.hetzner.com/cloud/billing/faq/> for the mechanics and the 20%; the per-GB snapshot
figure is from secondary reporting after an April 2026 increase and should be read off the console
rather than trusted here.

**The cheap one is cheap for a reason.** A Snapshot costs almost nothing precisely because somebody
has to remember to take it — which is the same weakness as `deploy/backup.sh` below, not a
substitute for it. **Backups are the only option on this list that survives being forgotten**, and
that, not the storage, is what the £1.12 buys.

**Recommendation, unchanged: turn Backups on.** It is the easiest decision in this document.

**Decided on 17 September 2026, and unchanged on 19 September: neither Backups nor Snapshots.** The free substitute is `deploy/backup.sh`, which
pulls `data/live-capture/` — the raw captures and every preserved timetable version — from the
server to this machine over SSH. It copies only what is not already held, because those files are
content-addressed and never rewritten, and it deliberately does not mirror the server's 14-day
deletions: outliving them is the point.

### What that script is, stated plainly

On 17 September this document presented it as though it settled the matter. It does not, and the
limits matter more than the script does:

* **It is manual.** Nothing runs it. There is no timer, no systemd unit, no cron entry and no
  reminder. If it is not typed, no copy is taken. Hetzner's paid snapshots run whether anyone
  remembers or not, and that — not the storage — is what £1.10 a month actually buys.
* **It is a pull from this laptop**, so it can only run while this machine is on, awake and able to
  reach the server. The night this machine slept mid-collection is the ordinary case, not an
  unlucky one.
* **It is not a bare-metal restore.** Losing the server still means provisioning a new one and
  running `publish.sh` and `install.sh`. What the copy protects is the data behind those commands.

### Restoring from the copy: demonstrated, 18 September 2026

On 17 September the claim that "the warehouse is rebuilt from the raw captures it was loaded from"
was **untested, and in fact there was no code that could do it.** The captures were files with no
door: `pipeline.run reprocess` reloads the *archive* selection, not live captures. A copy nobody can
read back is not a backup, so `pipeline/restore.py` now exists and the restore was actually run:

| | |
|---|---|
| Copied out of the capture store, as `backup.sh` would pull them | **60 captures, 3.1 MB** |
| Restored into an **empty** warehouse from that copy | `.venv/bin/python -m pipeline.restore --captures <copy> --db <new.duckdb>` |
| Recovered | **25,232 observations, 1,396 distinct vehicles**, spanning 12–17 September |
| Integrity | every capture verified against the SHA-256 in its own filename before being read; **0 corrupt, 0 undated, 0 malformed** |
| Run a second time over the same copy | **0 new observations, 35,145 recognised as repeats**, the count unchanged at 25,232 — restoring twice cannot double anything |
| Cost | about **0.76 s per capture**, so the 3,821 captures now held would take roughly 50 minutes |

Two things it is careful about. **Integrity is proved, not assumed:** each file is named by the
SHA-256 of its own bytes, so a damaged copy is detected and skipped rather than loaded. **The three
clocks stay apart:** a restored capture carries only the producer's own `ResponseTimestamp`, so that
is what is recorded, and the run says it did so. The moment this collector originally fetched the
file lived in the warehouse that was lost, and is not reinvented. Observation identity does not
include the retrieval time, so the same observations come back exactly.

### What that test recovered, and what it did not

**Recovered, and checked:** the raw SIRI-VM responses themselves, and the observations parsed out of
them — vehicle, operator, route, direction, journey reference, position, bearing and the source's
own timestamp — for 60 captures, into a warehouse that started empty. Their integrity was proved
rather than assumed, because each file is named by the SHA-256 of its own bytes. Loading the same
copy twice changed nothing, so a restore cannot double the history.

**Not recovered, because it is not in the captures:** the *derived* layers. The 60 captures restore
observations; they do not restore the timetable patterns, the road shapes, the motion evaluation or
the publication history. Patterns and shapes are rebuilt by their own commands from the preserved
timetable datasets, which `backup.sh` also copies — but that path has not been exercised after a
restore.

**Not demonstrated at all, and these are the gaps that matter:**

1. **A whole-store restore.** Sixty captures took 46 seconds; the 3,821 now held would take about
   fifty minutes, and nothing has run at that size.
2. **Publishing from a restored warehouse.** `pipeline.live publish` has never been pointed at one.
   Until it is, "the data is back" means the rows are back, not that the site could serve from them.
3. **A restore onto a rebuilt server.** Every step so far has been on this laptop.
4. **The copy itself.** `backup.sh` has never been run against a real server, because there has not
   been one. The restore was from a local copy standing in for its output.

A proof of the mechanism, not a rehearsal of the disaster. Items 1 and 2 are worth doing once the
server exists and there is something on it worth losing.

## Deploying and rolling back

* **Deploy:** `deploy/publish.sh deploy@<server>` builds here, keeps the release that is running at
  `/srv/lost-minutes/previous`, uploads, and writes a `RELEASE` file naming the commit. The page
  carries the same stamp, so what a tester reports can be matched to a commit.
* **Roll back:** `ssh deploy@<server> sudo bash /srv/lost-minutes/app/deploy/rollback.sh`. It puts
  the previous release back and restarts the collector. It deliberately does **not** restore
  `live.json`, `config.json` or `operations.json`: those are the collector's output, and a rollback
  must not put a stale publication in front of passengers.
* **Verify either way:** `curl -sI https://<domain>/ | head -3`, then
  `curl -s https://<domain>/data/live.json | head -c 200`, then open it on a phone.

One release of history is kept, not many. Anything older is a `git checkout` and a rebuild.

## Supervision and freshness monitoring

- **Collector supervision:** `lost-minutes-collector.service` runs under systemd with
  `Restart=always`. Every 5 minutes the watchdog (`lost-minutes-health.timer`, `check-health.sh`)
  restarts a collector that has not published for 10 minutes. It leaves the nightly timetable
  rebuild alone.
- **The watchdog now tells four failures apart**, because an HTTP 200 hides all of them
  (`deploy/check-health.sh`):
  1. the collector is not running → restart it;
  2. it is running but has stopped publishing → restart it;
  3. it is publishing, but the feed is not live (upstream quiet, or the key refused) → a restart
     would not help, so it records the state and restarts nothing;
  4. it is publishing a live feed whose newest vehicle report is over 5 minutes old → upstream's
     problem, which the page already shows to passengers.
- **What is still missing is a person being told.** The watchdog restarts; it tells nobody. If the
  server stops, or restarts do not help, the public feed goes stale unnoticed.
- **Prepared, and off until you choose the destination: an external dead man's switch.** The
  watchdog pings `LM_HEALTH_PING_URL` whenever a fresh publication exists, and `<url>/fail` when it
  has had to restart the collector. Silence from those pings means the site has stopped publishing
  for any reason at all, including this machine being off.
  - Healthchecks.io's free "Hobbyist" plan (checked 14 September 2026: $0 a month, 20 checks, email
    alerts) is the obvious destination, but **no account has been created and nothing is
    configured**. The URL goes in `/etc/lost-minutes/health.env` (see `deploy/health.env.example`),
    chmod 600, never in Git.
  - **Confirm the destination — which address should be emailed — before it is switched on.**

## Deployment configuration (ready, not provisioned)

`deploy/` holds everything the server needs: a Caddyfile (HTTPS, the cache headers above,
security headers), systemd units for the collector, the nightly timetable rebuild, a publication
watchdog and an optional retention job, an install script for a fresh Debian or Ubuntu server, an
upload script, and `deploy/validate.sh`, which checks all of it on this machine, including running
the Caddyfile locally. The steps are in `deploy/README.md`.

## What I would do

**Hetzner Cloud CX23, in Falkenstein, with its IPv4 and with backups on: €5.49 + €0.50 + €1.10 net
= €7.09, about €8.51 with 20% VAT, roughly £7.25 a month.** Add a domain (~£10 a year, ~£0.85 a
month) and it is about **£8 a month**, or **£97 in the first year**.

Backups are the one place this changes from the earlier recommendation, and the reason is the route
256 finding: TfGM's current registration for that line no longer contains the Monday–Friday service
its previous one did. Timetable versions and raw position captures are the two things that cannot
be collected twice, and £1.10 a month is a small price for not losing them.

**Alternatives, briefly.** Cloudflare Pages, Netlify and GitHub Pages host the site for nothing and
cannot run a 24/7 writer with a disk, which is the actual requirement. Fly.io is comparable in
price; its volumes are per-machine and its free allowances have moved more than once. A Raspberry
Pi at home is genuinely cheaper and a legitimate choice — the trade-off is your home IP, your
electricity and your uptime, which is a poor story for a portfolio link. GitHub Actions is the
wrong shape entirely for a 20-second collector, and each run would start with no warehouse; it is
used here for CI instead (`.github/workflows/checks.yml`).

**The beta can start without buying a domain**, on a free DuckDNS-style subdomain (see above), and
the domain can be added later by changing one line in `/etc/lost-minutes/caddy.env`. Saved stops
and any home-screen icon are tied to whichever address people use, so it is worth choosing the
final name before inviting more than a handful of testers.

## The decision needed, exactly

1. **Spend about £7.25 a month** (CX23 + IPv4 + backups, with VAT), or £6.10 without backups.
   Backups are recommended.
2. **A Hetzner Cloud account, and one of:** an API token in the environment so provisioning can be
   scripted from here, or a server you create yourself plus an SSH key and a sudo user, after which
   `deploy/publish.sh deploy@<host>` and `deploy/install.sh` do the rest.
3. **The address to use**: a domain or subdomain you own, or "use a free DuckDNS subdomain for
   now".
4. **Where a stalled-publication alert should go** — which email — and whether to create the free
   Healthchecks.io account for it. Nothing is created until you say so.

Nothing is provisioned, no account exists and nothing has been bought. The steps after the answer
are in `deploy/README.md`, and the whole configuration is already validated on this machine by
`deploy/validate.sh`.
