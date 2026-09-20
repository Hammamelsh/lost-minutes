#!/usr/bin/env bash
# Set up (or bring up to date) a Debian 12 or Ubuntu 24.04/26.04 server for Lost Minutes. Repeatable.
# 26.04 (resolute) was checked on the real server on 20 September 2026: python3-venv resolves to
# python3.14-venv, and Caddy's apt source is any-version rather than codename-keyed.
#
#   sudo bash /srv/lost-minutes/app/deploy/install.sh
#
# Installs Caddy (from its own repository) and Python, creates the service user, the virtual
# environment, the systemd units and the firewall rules, and starts the web server. It never writes
# a key: it stops and asks for /etc/lost-minutes/collector.env to be filled in before collection
# starts. Raw-capture retention is installed but not enabled (docs/HOSTING.md).
set -euo pipefail
APP=/srv/lost-minutes/app
cd "$APP"
[[ ${EUID} -eq 0 ]] || { echo "run as root: sudo bash $0"; exit 1; }
[[ -f pipeline/collect.py && -f out/index.html ]] || { echo "upload the app to $APP first (deploy/publish.sh)"; exit 1; }

apt-get update
apt-get install -y --no-install-recommends python3 python3-venv curl gnupg ufw debian-keyring debian-archive-keyring apt-transport-https
if ! command -v caddy >/dev/null; then
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
fi

id lostminutes >/dev/null 2>&1 || useradd --system --home-dir /srv/lost-minutes --shell /usr/sbin/nologin lostminutes
mkdir -p "$APP/data" /etc/lost-minutes
chown -R lostminutes:lostminutes "$APP/data" "$APP/public/data"
# Two writers share public/data: the collector (lostminutes) rewrites live.json every 20 s, and a
# deploy (the account publish.sh connects as) replaces the catalogue and the road shapes. Without
# this, the first install succeeds and every later upload fails on Permission denied, because the
# chown above has just taken the directory away from the account doing the uploading. The setgid
# bit keeps the group on whatever either of them creates next.
DEPLOY_USER=${SUDO_USER:-deploy}
if id "$DEPLOY_USER" >/dev/null 2>&1 && [[ $DEPLOY_USER != root ]]; then
  usermod -aG lostminutes "$DEPLOY_USER"
fi
chmod -R g+w "$APP/public/data"
find "$APP/public/data" -type d -exec chmod g+s {} +
python3 -m venv "$APP/.venv"
"$APP/.venv/bin/pip" install --quiet --upgrade pip
"$APP/.venv/bin/pip" install --quiet -r "$APP/requirements.txt"

# Configuration files are created once and never overwritten: they hold the key and the domain.
[[ -f /etc/lost-minutes/collector.env ]] || install -m 0640 -o root -g lostminutes deploy/collector.env.example /etc/lost-minutes/collector.env
[[ -f /etc/lost-minutes/caddy.env ]] || install -m 0644 deploy/caddy.env.example /etc/lost-minutes/caddy.env

install -m 0644 deploy/Caddyfile /etc/caddy/Caddyfile
install -d /etc/systemd/system/caddy.service.d
install -m 0644 deploy/systemd/caddy.service.d/lost-minutes.conf /etc/systemd/system/caddy.service.d/lost-minutes.conf
install -m 0644 deploy/systemd/lost-minutes-*.service deploy/systemd/lost-minutes-*.timer /etc/systemd/system/
chmod 0755 deploy/check-health.sh

ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

systemctl daemon-reload
systemctl enable caddy
systemctl restart caddy

if ! grep -Eq '^BODS_API_KEY=.+' /etc/lost-minutes/collector.env; then
  echo
  echo "Fill in /etc/lost-minutes/collector.env (sudo nano /etc/lost-minutes/collector.env),"
  echo "set LM_DOMAIN in /etc/lost-minutes/caddy.env, then run this script again."
  exit 0
fi
# A warehouse that has never been built has no stop table and no patterns, and the matcher then
# refuses every bus with patterns_unavailable. The published JSON that was uploaded does not help:
# the matcher reads the warehouse, not the files. The nightly timer would fix it at 03:40, so a
# first deploy would otherwise serve positions with no timetable behind them until the next
# morning.
#
# The probe must tell three states apart, not two. DuckDB allows one writer, so on a re-run with
# the collector already going the database cannot be opened at all -- and reading that as "empty"
# is what made this script try to import stops into a locked warehouse and abort the install. A
# lock means some collector is running against this warehouse, which means it was bootstrapped, so
# the answer is to skip. Exit 0 means nothing to do; exit 1 means the table is genuinely absent.
needs_bootstrap() {
  ! "$APP/.venv/bin/python" - "$1" <<'PROBE'
import pathlib, sys
sys.path.insert(0, "/srv/lost-minutes/app")
table = sys.argv[1]
from pipeline.warehouse import connect, DEFAULT_DB
try:
    con = connect(pathlib.Path("/srv/lost-minutes/app") / DEFAULT_DB)
except Exception as error:
    # Locked by a running collector, so the warehouse exists and is in use: nothing to do.
    sys.exit(0 if "lock" in str(error).lower() else 1)
try:
    sys.exit(0 if con.execute(f"select count(*) from {table}").fetchone()[0] else 1)
except Exception:
    sys.exit(1)
PROBE
}

if needs_bootstrap stop; then
  echo "First run: importing the stop catalogue (NaPTAN)."
  systemctl stop lost-minutes-collector.service 2>/dev/null || true
  runuser -u lostminutes -- "$APP/.venv/bin/python" -m pipeline.stops import
fi

systemctl enable --now lost-minutes-collector.service lost-minutes-refresh.timer lost-minutes-health.timer lost-minutes-arrival-eval.timer

if needs_bootstrap service_pattern; then
  echo "First run: building the timetable catalogue. This takes a few minutes and pauses collection."
  echo "It needs some collected positions to choose which services to build, so if it selects none,"
  echo "let the collector run for a minute and start lost-minutes-refresh.service again."
  systemctl start lost-minutes-refresh.service
fi

echo
echo "Collecting. Check: systemctl status lost-minutes-collector; journalctl -u lost-minutes-collector -f"
