#!/usr/bin/env bash
# Put back the release that was running before the last deploy/publish.sh.
#
#   ssh deploy@your-server sudo bash /srv/lost-minutes/app/deploy/rollback.sh
#
# The site changes at once, because Caddy serves files. The collector is restarted, because the
# pipeline it runs may have changed. The server's own published data — live.json, config.json,
# operations.json — is left exactly as it is: it is the collector's output, not part of a release,
# and a rollback must not put a stale publication back in front of passengers.
set -euo pipefail
APP=/srv/lost-minutes/app
PREVIOUS=/srv/lost-minutes/previous
[ -d "$PREVIOUS/out" ] || { echo "no previous release at $PREVIOUS; nothing to roll back to" >&2; exit 1; }

echo "rolling back to:"; cat "$PREVIOUS/RELEASE" 2>/dev/null || echo "  (no RELEASE file; an older upload)"
rsync -a --delete \
  --exclude 'public/data/live.json' --exclude 'public/data/config.json' \
  --exclude 'public/data/operations.json' --exclude '.venv/' --exclude 'data/' \
  "$PREVIOUS"/ "$APP"/
systemctl restart lost-minutes-collector.service
echo "rolled back; collector restarted. The release now running:"
cat "$APP/RELEASE" 2>/dev/null || echo "  (no RELEASE file)"
echo "Check: curl -sI https://<domain>/ | head -3 && curl -s https://<domain>/data/live.json | head -c 200"
