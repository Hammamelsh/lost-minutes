# Deploying Lost Minutes

Ready to use, **not provisioned**: nothing here has been bought or started. The costs and the
choice of host are in `docs/HOSTING.md`; provisioning needs the owner's approval first.

What runs on the server:

| Piece | How | File |
|---|---|---|
| The website | Caddy serves `out/` over HTTPS, with its own certificate from Let's Encrypt | `Caddyfile` |
| Published data | Caddy serves `/data/*` straight from `public/data`, where the pipeline writes | `Caddyfile` |
| Collection | the collector under systemd, a 24-hour run restarted automatically, stopped with SIGINT so each run records why it ended | `systemd/lost-minutes-collector.service` |
| Timetable patterns | rebuilt nightly at 03:40 (collection pauses for a few minutes: one writer) | `systemd/lost-minutes-refresh.*` |
| Watchdog | every 5 minutes, a collector that has not published for 10 minutes is restarted | `systemd/lost-minutes-health.*`, `check-health.sh` |
| Raw-capture retention | installed, **off** until the 14-day policy is approved | `systemd/lost-minutes-retention.*` |

## Steps

1. **Approve** the cost in `docs/HOSTING.md` and choose a domain (or a subdomain of one you own).
2. **Provision** (owner): one small Debian 12 or Ubuntu 24.04 server, an SSH key, a sudo user
   (called `deploy` below).
3. **DNS:** an A record (and AAAA if the server has IPv6) for the domain, pointing at the server.
   With Cloudflare, leave it "DNS only" at first so Caddy can obtain its certificate.
4. **Upload** from this machine: `deploy/publish.sh deploy@<server>`. It builds the site and copies
   the site, the pipeline and these files; never the key, the warehouse or raw captures.
5. **Install** on the server: `sudo bash /srv/lost-minutes/app/deploy/install.sh`. The first run
   stops and asks for the two configuration files:
   - `/etc/lost-minutes/collector.env`: the BODS key and the timetable dataset URLs (never commit
     it, never paste the key anywhere else);
   - `/etc/lost-minutes/caddy.env`: the domain.
   Then run the same command again: collection starts.
6. **Verify:**
   ```bash
   curl -sI https://<domain>/ | head -5                     # 200, HSTS, no Server header
   curl -s https://<domain>/data/live.json | head -c 300    # a live publication, seconds old
   systemctl status lost-minutes-collector
   systemctl list-timers 'lost-minutes-*'
   journalctl -u lost-minutes-collector -n 50
   ```
   and open the site on a phone.

## Going back, and getting data back

| | |
|---|---|
| `deploy/rollback.sh` (on the server) | puts the previous release back in one command. One release of history is kept; the collector's own published data is deliberately not rolled back |
| `deploy/backup.sh deploy@<host>` (from here) | pulls the raw captures and preserved timetable versions to this machine. **Manual** — nothing runs it but you |
| `.venv/bin/python -m pipeline.restore --captures <copy> --db <warehouse>` | reads those captures back into a warehouse. Verified 18 September 2026: 60 copied captures restored 25,232 observations into an empty database, with every file checked against the SHA-256 in its own name, and a second run adding nothing |

`docs/HOSTING.md` says plainly what the backup does and does not protect.

Updating: run `deploy/publish.sh` again. Site changes are live at once; for pipeline changes,
`sudo systemctl restart lost-minutes-collector`. Stopping collection:
`sudo systemctl stop lost-minutes-collector`.

## Checked here, and what only the server can show

`deploy/validate.sh` checks, on this machine: every script's shell syntax, the systemd units with
`systemd-analyze verify`, and the Caddyfile, validated by Caddy and then run over plain HTTP on
127.0.0.1 against this checkout, with curl checking the page, a shared-journey link, `/data`
from `public/data`, every cache header in `docs/HOSTING.md`, compression, the security headers and
that nothing outside the site is reachable.

Only the server can show: the certificate being issued and renewed, the collector running under
systemd with the real key, the nightly rebuild and the watchdog firing, and the site from a phone
on mobile data.

## Notes

- The walking router is FOSSGIS's free service, for light use. A public site with many users
  should run its own OSRM foot router or switch walking directions off
  (`LM_WALKING_ROUTER=none` in `collector.env`).
- Keep the server patched (`sudo apt install unattended-upgrades`) and SSH key-only.
- The key lives only in `/etc/lost-minutes/collector.env` (root, group `lostminutes`, 0640).
