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

**Checked again on 14 September 2026, and the price has gone up.** Hetzner's documentation records
a price adjustment for new orders from 15 June 2026: the **CX23** (2 vCPU, 4 GB RAM, 40 GB NVMe,
20 TB traffic) went from €3.99 to **€5.49 a month net (€0.0088 an hour), excluding IPv4**. The Arm
CAX11 went from €4.49 to €5.99. Hetzner's IP pricing page lists a cloud Primary IPv4 at **€0.50 a
month**.
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
| Hetzner automated backups (20% of the server, optional) | about €1.10 net, €1.32 with VAT (~£1.10) |
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

## Supervision and freshness monitoring

- **Collector supervision:** `lost-minutes-collector.service` runs under systemd with
  `Restart=always`. Every 5 minutes the watchdog (`lost-minutes-health.timer`, `check-health.sh`)
  restarts a collector that has not published for 10 minutes. It leaves the nightly timetable
  rebuild alone.
- **What is missing is a person being told.** The watchdog restarts; it tells nobody. If the
  server itself stops, or restarts do not help, the public feed goes stale unnoticed.
- **Recommended: an external dead man's switch.** Healthchecks.io's free "Hobbyist" plan (checked
  14 September 2026: $0 a month, 20 checks, email alerts) gives each check a ping address.
  - The watchdog pings it only when the publication is fresh.
  - When the pings stop, for any reason (collector, server or network), an email follows after the
    grace period.
  - Not configured: it needs an account, and the ping address kept on the server in
    `/etc/lost-minutes/`, never in Git.

## Deployment configuration (ready, not provisioned)

`deploy/` holds everything the server needs: a Caddyfile (HTTPS, the cache headers above,
security headers), systemd units for the collector, the nightly timetable rebuild, a publication
watchdog and an optional retention job, an install script for a fresh Debian or Ubuntu server, an
upload script, and `deploy/validate.sh`, which checks all of it on this machine, including running
the Caddyfile locally. The steps are in `deploy/README.md`.

## What I would do

Take the CX23 with its IPv4 and without backups to start (about **£6 a month with VAT**, ~£7 with
a domain). Backups can wait for three reasons:
- the warehouse is reproducible from the raw captures;
- the raw captures cannot be re-collected, but losing a fortnight of collection is an annoyance,
  not a disaster;
- backups can be added later if the accumulated history starts to matter.

Point a subdomain at it through Cloudflare, and add the Healthchecks.io ping to the watchdog.

This is also what makes returning practical. A home-screen icon and saved stops are tied to the
address. The trial link is a temporary Quick Tunnel, so the page itself advises against installing
it.

**The decision I need from you:**
1. approval of about **£6–8 a month** with VAT (CX23 with IPv4; optional backups; a domain);
2. the domain or subdomain to use;
3. whether to create the free Healthchecks.io account for alerts.

I will not provision anything until you say so. The steps after that are in `deploy/README.md`.
