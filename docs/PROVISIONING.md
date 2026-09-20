# Provisioning the beta — the runbook for the choice already made

**Decided:** Hetzner Cloud, a **2 vCPU / 4 GB** shared-vCPU server, **no paid backups**, on a
**free subdomain**.

> **20 September 2026, in the console: CX23 is out of stock in Falkenstein, and the price is
> unchanged.** The console shows **CX23 at €6.59 a month including 20% VAT, plus €0.60 for the
> IPv4 — €7.19, about £6.10**, exactly the documented figure. Hetzner's public page flags all four
> CX plans "not available", but the console's own tooltip is the precise version: *"Not available.
> Please choose another location or type."* **Stock is per location.**
>
> **In order: try Nuremberg, then Helsinki, with CX23.** If no location has it, switch Architecture
> to **Arm64 (Ampere)** and take **CAX11** (2 vCPU, 4 GB) — `install.sh` installs only `python3`,
> `python3-venv`, `curl`, `gnupg`, `ufw` and Caddy from Cloudsmith's apt repository, all of which
> publish arm64, and DuckDB ships aarch64 wheels; no Node and no compiled x86 binary runs on the
> server, because the frontend is built here and shipped as static files.
>
> **Do not fall back to CPX22 without deciding to.** The console prices it at **€23.99 a month**,
> 3.6 times the CX23 for the same 2 vCPU and 4 GB, buying only 80 GB of disk instead of 40 GB,
> which this workload does not need. Every number below that matters — the 853 MB rebuild peak, the
> 376 MB collector, `LM_DB_THREADS=2` — depends on **4 GB of RAM and 2 vCPU**, which CX23, CAX11 and
> CPX22 all give. Costs and the
reasoning are in `docs/HOSTING.md`; this page is only the doing.

Everything that could be prepared without an account has been. What is left needs either your money
or your credentials, so it is split plainly: **three steps are yours, the rest are mine.**

---

## Yours — step 1: create the server, and read the total before you pay

Deliberately yours rather than mine. Creating it through Hetzner's console keeps the spend in your
hands and means no billing credential has to exist anywhere else. An API token would let me do it,
and I would rather not hold one.

In <https://console.hetzner.cloud> → **Add Server**:

| | |
|---|---|
| Image | **Ubuntu 24.04 LTS** (Debian 12 also works; `deploy/install.sh` targets and was validated against those two). The console may default to a newer Ubuntu — change it; there is no reason to debug a fresh release on the first deploy |
| Location | Falkenstein, Nuremberg or Helsinki — **stock differs between them**, so if the type you want is greyed out, change this before changing the type |
| Type | **Cost-Optimized → CX23** (2 vCPU, 4 GB, 40 GB NVMe). If no location has it, **Arm64 (Ampere) → CAX11**. Never CPX12 — 2 GB will not run the nightly rebuild |
| Networking | **IPv4 enabled** — needed, and billed separately |
| Backups | **leave the tick box off.** Hetzner's *Backups* (automatic, daily, 20% of the server price) and its *Snapshots* (manual, per GB) are different products; both stay off unless you say otherwise. `docs/HOSTING.md` sets out the difference |
| SSH key | **Add SSH key**, and paste the public key below. Without one Hetzner emails a root password, which is worse in every way |
| Name | anything; `lost-minutes` is tidy |

### The key to paste

A key dedicated to this server was generated on your machine on 20 September 2026,
`~/.ssh/lost-minutes`. It is separate from your GitHub key on purpose: either can be revoked without
touching the other. The private half has not left the machine and is in nothing published.

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDGhchdbednJamKTfnm0c7yI2HG+NNccf4pfGQAzd4Bo lost-minutes server
```

Hetzner will show you the fingerprint `SHA256:AvbCPQHZKKbglRxrLqzDmLoZyKGZrgb1cDWjpjrF0ZQ`. If it
shows anything else, the paste went wrong. It has no passphrase, matching your existing key; that is
a deliberate trade for unattended deploys, and the protection is the file permissions on a machine
only you use.

### Read the total before you pay

**Read against the console on 20 September 2026 and unchanged:** CX23 **€6.59 a month including
20% VAT**, IPv4 **€0.60**, **total €7.19, about £6.10**. The console prints "All prices incl. 20 %
VAT" beneath the total, so that figure needs nothing added to it.

The console's own figure still decides — stock and prices move. *If the total is not close to
€7.19, stop and tell me rather than paying more than you meant to.* It costs nothing to check,
and the panel shows the total before the Create & Buy now button, not after.

Why 4 GB and not something smaller: the nightly timetable rebuild peaks at **853 MB**, measured on
18 September 2026, and the collector sits at about **376 MB** at the two threads a CX23 gives it.
(It reached 1.8 GB and climbing on a 16-core laptop, where DuckDB took 32 threads — an allocator
artefact, not the application; the unit pins the thread count so the figure travels.) A 1 GB machine
still cannot run the rebuild.

## Yours — step 2: a free subdomain, pointed at that server

Two minutes, no payment. <https://www.duckdns.org> signs in with an account you already have
(GitHub, Google, Reddit or Twitter), then:

1. choose a name — `lost-minutes.duckdns.org` if it is free;
2. paste the server's IPv4 into the **current ip** box and press **update ip**.

The IP is static, so this is a one-off; nothing needs to keep it up to date.

**How the certificate works, and the one thing that could go wrong.** Caddy obtains it from Let's
Encrypt over HTTP-01 on port 80, which Hetzner leaves open by default. Let's Encrypt counts
certificates per *registered domain*, worked out from the Public Suffix List. That is exactly why
Hetzner's own `…clients.your-server.de` hostname is a poor choice — the whole of Hetzner shares
that budget. DuckDNS documents Let's Encrypt support and is very widely used this way; I have
**not** independently confirmed that `duckdns.org` carries its own Public Suffix List entry, so if
issuance is ever refused, the fallback is a real domain at about £10 a year, and moving to one is a
single line in `/etc/lost-minutes/caddy.env`.

**Choose the name you mean to keep.** Saved stops, saved routes and any home-screen icon are tied to
whichever address people first use; moving later loses them.

## Yours — step 3: the BODS key, typed by you, onto the server

**The key never passes through me, this repository, a commit, or any chat.** `install.sh` stops the
first time and asks for it; you put it in place yourself, then the same command again starts it:

```bash
ssh deploy@<host>
sudo install -d -m 700 /etc/lost-minutes
sudo nano /etc/lost-minutes/collector.env      # BODS_API_KEY=… and BODS_TIMETABLE_URL=…
sudo chmod 600 /etc/lost-minutes/collector.env
```

`deploy/collector.env.example` shows the shape. The timetable URLs need no key and are already in
your local `.env`.

---

## Mine — everything else

Tell me the hostname and the sudo user, and:

```bash
deploy/publish.sh deploy@<host>                                  # build here, upload, keep the
                                                                 # previous release for rollback
ssh deploy@<host> sudo bash /srv/lost-minutes/app/deploy/install.sh
# stops and asks for the two env files; after step 3 above, the same command again starts it
```

Then I verify, and none of it is a matter of opinion:

```bash
curl -sI https://<address>/ | head -5            # 200, HSTS, no Server header
curl -s https://<address>/data/live.json | head -c 300   # a publication seconds old
systemctl status lost-minutes-collector
systemctl list-timers 'lost-minutes-*'           # the nightly rebuild and the watchdog
journalctl -u lost-minutes-collector -n 50
```

and then run the checks that only a server can answer, recording them in `docs/OBSERVATION.md`:
the certificate being issued, the collector under systemd surviving a reboot, the nightly rebuild
firing at 03:40, the watchdog restarting a stalled collector, and the 48 hours of publication gaps
and resource use.

## What I will not do without another word from you

* buy anything, or resize anything that is billed;
* create any account in your name;
* turn on the **retention job** (it deletes raw captures older than 14 days — installed, off);
* turn on the **stalled-publication alert**, which needs a destination you have not yet named;
* point any existing domain of yours at it.

## After it is up

* `deploy/backup.sh deploy@<host>` pulls the raw captures and timetable versions here. It is
  **manual** — nothing runs it but you. Worth doing weekly; `docs/HOSTING.md` says exactly what it
  does and does not protect, and `pipeline/restore.py` is the proven way back.
* `deploy/rollback.sh` on the server puts the previous release back in one command.
* The temporary tunnel (`scripts/preview.sh`) can stop being used the moment the real address works.
