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

**Hetzner Cloud CX22** (2 vCPU, 4 GB RAM, 40 GB SSD, Falkenstein or Helsinki) running:

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

| Item | Monthly |
| --- | --- |
| Hetzner CX22 (2 vCPU, 4 GB, 40 GB SSD) | €3.79 (~£3.30) |
| Hetzner automated backups (20%, optional) | €0.76 (~£0.66) |
| Cloudflare free plan | £0.00 |
| Object storage | £0.00 — not needed; 40 GB SSD covers 14-day retention with room to spare |
| Domain (optional, amortised) | ~£0.85 (~£10/year) |
| **Total** | **~£4–5 per month** |

First year, with backups and a domain: roughly **£58**.

## What I would do

Take the CX22 without backups to start (**£3.30/month**), because the warehouse is
reproducible from the raw captures and the raw captures are reproducible from nothing —
losing a fortnight of collection is an annoyance, not a disaster. Add backups later if the
accumulated history starts to matter. Point a subdomain at it through Cloudflare.

**The decision I need from you:** approval of roughly £3–5 per month, and whether the site
should be publicly reachable at that point. I will not provision anything until you say so.
