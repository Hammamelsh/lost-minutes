#!/usr/bin/env bash
# Is Lost Minutes still publishing, and is what it publishes worth anything?
#
# Four different failures look identical to an HTTP check that only wants a 200:
#
#   1. the collector is not running            -> restart it
#   2. it is running but has stopped publishing -> restart it
#   3. it is publishing, but the feed is not live (upstream is quiet, or the key was refused)
#                                               -> restarting would not help; say so
#   4. it is publishing a live feed whose newest vehicle report is old
#                                               -> upstream's problem, and the page already says so
#
# Only 1 and 2 are ours to fix, and only those restart anything. The dead man's switch is pinged
# whenever a fresh publication exists, so silence from it means the site has stopped publishing
# for any reason at all, including this machine being off.
#
# Configuration (all optional), from /etc/lost-minutes/health.env via the systemd unit:
#   LM_ROOT                 where the app is (default /srv/lost-minutes/app)
#   LM_MAX_PUBLICATION_AGE  seconds before a publication counts as stalled (default 600)
#   LM_HEALTH_PING_URL      a dead man's switch, e.g. a Healthchecks.io check. Unset: no ping.
#                           Confirm the destination with the owner before setting it.
set -euo pipefail
ROOT="${LM_ROOT:-/srv/lost-minutes/app}"
LIVE="$ROOT/public/data/live.json"
MAX_AGE="${LM_MAX_PUBLICATION_AGE:-600}"
PING="${LM_HEALTH_PING_URL:-}"

# published epoch, feed state, and the age of the newest vehicle report, from the file itself.
read -r published state newest <<<"$(python3 - "$LIVE" <<'PY' 2>/dev/null || echo "0 unreadable -1"
import datetime, json, sys
with open(sys.argv[1], encoding='utf-8') as handle:
    live = json.load(handle)
stamp = datetime.datetime.fromisoformat(live['publishedAt'].replace('Z', '+00:00'))
ages = [v.get('ageSeconds') for v in live.get('vehicles') or [] if isinstance(v.get('ageSeconds'), (int, float))]
print(int(stamp.timestamp()), live.get('state', 'unknown'), int(min(ages)) if ages else -1)
PY
)"

age=$(( $(date +%s) - published ))
ping_it() {  # $1: '', '/fail' or '/log'; $2: the line to record
  [ -n "$PING" ] || return 0
  curl -fsS -m 10 --retry 3 --data-raw "$2" "${PING}${1}" >/dev/null || true
}

if (( published == 0 )); then
  echo "unreadable: $LIVE could not be read"
  systemctl restart lost-minutes-collector.service
  ping_it /fail "published file unreadable; collector restarted"
  exit 0
fi

if (( age > MAX_AGE )); then
  echo "stalled: last published ${age}s ago (limit ${MAX_AGE}s), feed state ${state}"
  # A Type=oneshot service reads as "activating" for the whole of its ExecStart, never "active",
  # and `is-active --quiet` exits 3 for that. So this guard never fired: the watchdog restarted the
  # collector in the middle of the nightly rebuild, the collector could not take the warehouse lock
  # the rebuild was holding, and Restart=always retried it every 15 s until the rebuild finished.
  # Measured on the server on 20 September 2026: `is-active` printed activating, exit code 3.
  # Both nightly maintenance units are recognised. The rebuild stops the collector on purpose; the
  # arrival evaluation does not touch it, but if it is ever changed to, this guard is already here.
  for unit in lost-minutes-refresh lost-minutes-arrival-eval; do
    state=$(systemctl is-active "$unit.service" 2>/dev/null || true)
    case "$state" in
      active|activating|deactivating|reloading)
        echo "nightly maintenance ($unit) is $state; leaving the collector alone"
        exit 0
        ;;
    esac
  done
  systemctl restart lost-minutes-collector.service
  echo "collector restarted"
  ping_it /fail "no publication for ${age}s (state ${state}); collector restarted"
  exit 0
fi

# Publishing. Whether what is published is useful is a different question, and not one a restart
# answers: these are recorded, and the page shows the same state to passengers.
note="published ${age}s ago, state ${state}, newest report ${newest}s old"
if [ "$state" != "live" ]; then
  echo "publishing, but not live: $note"
  ping_it /log "upstream not live: $note"
elif (( newest < 0 || newest > 300 )); then
  echo "publishing a live feed with old reports: $note"
  ping_it /log "live but reports are old: $note"
else
  echo "healthy: $note"
fi
ping_it "" "$note"
