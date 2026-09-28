#!/usr/bin/env bash
# Put back the release that was running before the last deploy/publish.sh.
#
#   ssh deploy@your-server sudo bash /srv/lost-minutes/app/deploy/rollback.sh
#
# The site changes at once, because Caddy serves files. The collector is restarted, because the
# pipeline it runs may have changed. Everything the server writes itself is left exactly as it is —
# live.json, config.json and operations.json from the collector, the nightly catalogue, boards and
# evaluation verdict, the jobs' own record — by the very list a deploy leaves alone
# (deploy/rsync-exclude.txt): it is the server's output, not part of a release, and a rollback must not
# put a stale publication back in front of passengers or delete a record. (Until 28 September 2026 this
# named only the collector's three files, so it would have put back the catalogue of the deploy's day
# and deleted the jobs' record.)
set -euo pipefail
APP=/srv/lost-minutes/app
PREVIOUS=/srv/lost-minutes/previous
[ -d "$PREVIOUS/out" ] || { echo "no previous release at $PREVIOUS; nothing to roll back to" >&2; exit 1; }

echo "rolling back to:"; cat "$PREVIOUS/RELEASE" 2>/dev/null || echo "  (no RELEASE file; an older upload)"
rsync -a --delete --exclude-from="$APP/deploy/rsync-exclude.txt" --exclude '/.venv/' --exclude '/data/' \
  "$PREVIOUS"/ "$APP"/
systemctl restart lost-minutes-collector.service
echo "rolled back; collector restarted. The release now running:"
cat "$APP/RELEASE" 2>/dev/null || echo "  (no RELEASE file)"
echo "Check: curl -sI https://<domain>/ | head -3 && curl -s https://<domain>/data/live.json | head -c 200"
