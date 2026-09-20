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
#
# Before each upload the whole app directory is copied to /srv/lost-minutes/previous, so there is
# always exactly one release to go back to: deploy/rollback.sh. The server's own live data is never
# part of either copy.
set -euo pipefail
TARGET="${1:?usage: deploy/publish.sh user@host}"
cd "$(dirname "$0")/.."
git diff --quiet || echo "note: uploading uncommitted changes; the server will not match any commit"
COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo unknown)
pnpm install --frozen-lockfile
pnpm build
# What the server is running, readable on the server and matching the build stamp in the page.
printf 'commit=%s\nbuiltAt=%s\nuploadedBy=%s\n' \
  "$COMMIT" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(git config user.email 2>/dev/null || echo unknown)" > RELEASE
ssh "$TARGET" 'sudo mkdir -p /srv/lost-minutes/app && sudo chown "$(id -un)" /srv/lost-minutes/app
  if [ -d /srv/lost-minutes/app/out ]; then
    sudo rm -rf /srv/lost-minutes/previous
    sudo cp -a /srv/lost-minutes/app /srv/lost-minutes/previous
    echo "kept the running release at /srv/lost-minutes/previous"
  fi'
# Two writers share public/data: the collector rewrites live.json every 20 s as its own user, and
# this upload replaces the catalogue, the road shapes and the site. That mixed ownership is why the
# transfer runs through sudo on the far side — an unprivileged account cannot chmod a file it does
# not own, so every deploy after the first install failed on Permission denied. --no-owner and
# --no-group stop rsync carrying this machine's numeric ids across, which mean nothing there.
# Ownership is then set once, explicitly, to what install.sh asks for.
rsync -az --no-owner --no-group --rsync-path="sudo rsync" --delete \
  --exclude-from=deploy/rsync-exclude.txt ./ "$TARGET:/srv/lost-minutes/app/"
ssh "$TARGET" 'sudo chown -R lostminutes:lostminutes /srv/lost-minutes/app/public/data
  sudo chmod -R g+w /srv/lost-minutes/app/public/data
  sudo find /srv/lost-minutes/app/public/data -type d -exec chmod g+s {} +'
rm -f RELEASE
echo "uploaded $COMMIT to $TARGET"
