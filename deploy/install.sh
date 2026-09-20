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
# morning. Both are safe to repeat, and both are skipped once they have been done.
if ! "$APP/.venv/bin/python" -c "
import pathlib, sys
sys.path.insert(0, '$APP')
from pipeline.warehouse import connect, DEFAULT_DB
try:
    con = connect(pathlib.Path('$APP') / DEFAULT_DB)
    sys.exit(0 if con.execute('select count(*) from stop').fetchone()[0] else 1)
except Exception:
    sys.exit(1)
" 2>/dev/null; then
  echo "First run: importing the stop catalogue (NaPTAN)."
  runuser -u lostminutes -- "$APP/.venv/bin/python" -m pipeline.stops import
fi

systemctl enable --now lost-minutes-collector.service lost-minutes-refresh.timer lost-minutes-health.timer

if ! "$APP/.venv/bin/python" -c "
import pathlib, sys
sys.path.insert(0, '$APP')
from pipeline.warehouse import connect, DEFAULT_DB
try:
    con = connect(pathlib.Path('$APP') / DEFAULT_DB)
    sys.exit(0 if con.execute('select count(*) from service_pattern').fetchone()[0] else 1)
except Exception:
    sys.exit(1)
" 2>/dev/null; then
  echo "First run: building the timetable catalogue. This takes a few minutes and pauses collection."
  echo "It needs some collected positions to choose which services to build, so if it selects none,"
  echo "let the collector run for a minute and start lost-minutes-refresh.service again."
  systemctl start lost-minutes-refresh.service
fi

echo
echo "Collecting. Check: systemctl status lost-minutes-collector; journalctl -u lost-minutes-collector -f"
