#!/usr/bin/env bash
# Build the site here and upload what the server runs: the static site, the pipeline, the published
# data files and these deployment files. Never the key, the warehouse, raw captures, node_modules or
# the server's own live state (deploy/rsync-exclude.txt).
#
#   deploy/publish.sh deploy@your-server
#
# The first time, run `sudo bash /srv/lost-minutes/app/deploy/install.sh` on the server afterwards.
# Later uploads take effect at once for the site; restart the collector for pipeline changes:
#   ssh deploy@your-server sudo systemctl restart lost-minutes-collector
set -euo pipefail
TARGET="${1:?usage: deploy/publish.sh user@host}"
cd "$(dirname "$0")/.."
git diff --quiet || echo "note: uploading uncommitted changes; the server will not match any commit"
pnpm install --frozen-lockfile
pnpm build
ssh "$TARGET" 'sudo mkdir -p /srv/lost-minutes/app && sudo chown "$(id -un)" /srv/lost-minutes/app'
rsync -az --delete --exclude-from=deploy/rsync-exclude.txt ./ "$TARGET:/srv/lost-minutes/app/"
echo "uploaded $(git rev-parse --short HEAD) to $TARGET"
