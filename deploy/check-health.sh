#!/usr/bin/env bash
# Is the publication fresh? A collector that has not published for LM_MAX_PUBLICATION_AGE seconds
# (default 600) is restarted once; the nightly rebuild, which stops it on purpose, is left alone.
# The check reads one published file and changes nothing else.
set -euo pipefail
LIVE="${LM_ROOT:-/srv/lost-minutes/app}/public/data/live.json"
MAX_AGE="${LM_MAX_PUBLICATION_AGE:-600}"
published=$(python3 - "$LIVE" <<'PY' 2>/dev/null || echo 0
import datetime, json, sys
with open(sys.argv[1], encoding='utf-8') as handle:
    stamp = json.load(handle)['publishedAt']
print(int(datetime.datetime.fromisoformat(stamp.replace('Z', '+00:00')).timestamp()))
PY
)
age=$(( $(date +%s) - published ))
if (( age <= MAX_AGE )); then
  echo "fresh: published ${age}s ago"
  exit 0
fi
echo "stale: last published ${age}s ago (limit ${MAX_AGE}s)"
if systemctl is-active --quiet lost-minutes-refresh.service; then
  echo "the nightly rebuild is running; not restarting the collector"
  exit 0
fi
systemctl restart lost-minutes-collector.service
echo "collector restarted"
