#!/usr/bin/env bash
# Pull the two things on the server that cannot be collected twice, onto this machine.
#
#   deploy/backup.sh deploy@your-server [destination]
#
# Run from this checkout. Default destination: ../lost-minutes-backup, outside the repository.
#
# Why only these two. The site and the pipeline are in Git. The DuckDB warehouse is rebuilt from
# the raw captures it was loaded from. But:
#
#   data/live-capture/            raw SIRI-VM responses. The feed has no history: a day lost is
#                                 lost. About 0.13 GB a day, kept 14 days on the server.
#   data/live-capture/timetables/ each distinct timetable version by content hash. Re-downloadable
#                                 only while the operator still publishes it — route 256's
#                                 Monday-to-Friday registration already is not.
#
# This is the free stand-in for the provider's paid snapshots, which were declined. It is worth
# saying plainly what it does not do: it is a pull, so it runs only when this machine is on, and it
# is not a bare-metal restore. Losing the server still means provisioning a new one and running
# deploy/publish.sh and install.sh; what this protects is the data behind those commands.
#
# Restore: rsync the tree back to /srv/lost-minutes/app/data/ and re-run the pattern build.
set -euo pipefail
TARGET="${1:?usage: deploy/backup.sh user@host [destination]}"
DEST="${2:-$(cd "$(dirname "$0")/../.." && pwd)/lost-minutes-backup}"
mkdir -p "$DEST"
echo "pulling raw captures and timetable versions from $TARGET into $DEST"
# --ignore-existing: these files are content-addressed and never rewritten, so nothing already
# held has to be read again. Deletions on the server (the 14-day retention) are not mirrored:
# the point of a copy here is to outlive that.
rsync -az --info=stats1 --ignore-existing \
  "$TARGET:/srv/lost-minutes/app/data/live-capture/" "$DEST/live-capture/"
printf 'pulled %s\nfrom %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$TARGET" > "$DEST/LAST_PULL"
du -sh "$DEST" | sed 's/^/held here: /'
