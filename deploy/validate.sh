#!/usr/bin/env bash
# Checks the deployment files here, without a server:
#   1. the shell syntax of every script;
#   2. the systemd units (systemd-analyze verify, against a scratch root holding the paths the
#      units name, so it checks the units rather than this machine);
#   3. the Caddyfile: validated by caddy, then run over plain HTTP on 127.0.0.1 against this
#      checkout's out/ and public/data, with curl checking the routes and headers the site needs.
# CADDY=/path/to/caddy picks the binary; without one, step 3 is skipped and says so.
# What only the server can prove (the certificate, the collector running under systemd) is listed
# in deploy/README.md.
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT_DIR=$(pwd)
fail=0
ok() { echo "   ok   $*"; }
bad() { echo "   FAIL $*"; fail=1; }

echo "1. shell syntax"
for f in deploy/*.sh; do bash -n "$f" && ok "$f" || bad "$f"; done

echo "2. systemd units"
if command -v systemd-analyze >/dev/null; then
  scratch=$(mktemp -d)
  mkdir -p "$scratch/srv/lost-minutes/app/.venv/bin" "$scratch/srv/lost-minutes/app/deploy" \
           "$scratch/srv/lost-minutes/app/data/live-capture" "$scratch/srv/lost-minutes/app/public/data" \
           "$scratch/etc/lost-minutes" "$scratch/etc/systemd/system" "$scratch/usr/bin" "$scratch/bin"
  for exe in srv/lost-minutes/app/.venv/bin/python srv/lost-minutes/app/deploy/check-health.sh usr/bin/find bin/systemctl bin/cp; do
    printf '#!/bin/sh\n' > "$scratch/$exe"; chmod +x "$scratch/$exe"
  done
  touch "$scratch/etc/lost-minutes/collector.env"
  # The standard units every unit depends on (sysinit.target, timers.target and the rest), as
  # this machine has them; without them verify stops at the first missing target.
  if [[ -d /usr/lib/systemd/system ]]; then
    mkdir -p "$scratch/usr/lib/systemd" && cp -r /usr/lib/systemd/system "$scratch/usr/lib/systemd/"
  fi
  cp deploy/systemd/lost-minutes-*.service deploy/systemd/lost-minutes-*.timer "$scratch/etc/systemd/system/"
  units=$(cd deploy/systemd && ls lost-minutes-*.service lost-minutes-*.timer)
  # shellcheck disable=SC2086
  if out=$(cd "$scratch/etc/systemd/system" && systemd-analyze verify --root="$scratch" --man=no $units 2>&1); then
    ok "$(echo $units | wc -w) units"
  else
    echo "$out" | sed 's/^/        /'
    bad "units"
  fi
  rm -rf "$scratch"
else
  echo "   skipped: systemd-analyze is not installed"
fi

echo "3. Caddyfile"
CADDY=${CADDY:-$(command -v caddy || true)}
if [[ -z "$CADDY" ]]; then
  echo "   skipped: no caddy binary (set CADDY=/path/to/caddy)"
  exit $fail
fi
[[ -f out/index.html ]] || { bad "out/ is missing: run pnpm build first"; exit 1; }
export LM_DOMAIN=http://127.0.0.1:8099 LM_ROOT="$ROOT_DIR"
# The preview's lock, checked with a password made up for this run only.
PREVIEW_PASS="validate-$(date +%s%N)"
LM_PREVIEW_USER=check LM_PREVIEW_HASH=$(printf '%s\n' "$PREVIEW_PASS" | "$CADDY" hash-password --algorithm bcrypt)
export LM_PREVIEW_USER LM_PREVIEW_HASH
# Without a password set, the preview is locked with a hash of a password nobody holds.
if env -u LM_PREVIEW_USER -u LM_PREVIEW_HASH "$CADDY" adapt --config deploy/Caddyfile --adapter caddyfile 2>/dev/null \
   | grep -q '0H/8Q8GMbZzHLtbPd4oiceIIY6ns5OduSGNQGGBQSOoBwbmXUvLGG'; then ok "preview locked by default"
else bad "preview not locked by default"; fi
if "$CADDY" validate --config deploy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then ok "caddy validate"
else "$CADDY" validate --config deploy/Caddyfile --adapter caddyfile 2>&1 | tail -5; bad "caddy validate"; exit 1; fi
# Anything already answering on the port would be checked in Caddy's place, and every route would
# be judged against the wrong server (26 September 2026: a repro server left running since two days
# before answered every request, and fourteen checks failed for no fault of the Caddyfile).
if curl -s -o /dev/null --max-time 2 http://127.0.0.1:8099/; then
  bad "127.0.0.1:8099 is already in use: stop what is listening there and run this again"; exit 1
fi
log=$(mktemp)
"$CADDY" run --config deploy/Caddyfile --adapter caddyfile >"$log" 2>&1 &
pid=$!
trap 'kill $pid 2>/dev/null; rm -f "$log"' EXIT
for _ in $(seq 1 40); do curl -s -o /dev/null http://127.0.0.1:8099/ && break; sleep 0.25; done
base=http://127.0.0.1:8099
header() { curl -s -D - -o /dev/null -H 'Accept-Encoding: gzip' "$base$1" | tr -d '\r' | grep -i "^$2:" | head -1 | cut -d' ' -f2-; }
status() { curl -s -o /dev/null -w '%{http_code}' "$base$1"; }
expect() { # path, header, expected substring
  local got; got=$(header "$1" "$2")
  [[ "$got" == *"$3"* ]] && ok "$1  $2: $got" || bad "$1  $2: expected '$3', got '${got:-none}'"
}
[[ $(status /) == 200 ]] && ok "/ 200" || bad "/ $(status /)"
[[ $(status '/?stop=1800SJ32231') == 200 ]] && ok "/?stop=… 200 (a shared journey link)" || bad "/?stop=…"
expect / Cache-Control no-cache
expect / Content-Type text/html
expect /data/live.json Cache-Control "max-age=10"
expect /data/live.json Content-Type application/json
expect /data/live.json Content-Encoding gzip
expect /data/config.json Cache-Control "max-age=60"
expect /data/replay.json Cache-Control "max-age=3600"
expect /data/patterns.json Cache-Control "max-age=300"
expect /sw.js Cache-Control no-cache
static=$(cd out && ls _next/static/chunks/*.js | head -1)
expect "/$static" Cache-Control immutable
# MapLibre's modules are under a version folder, so they are immutable too; the typefaces keep a
# stable name, so they revalidate after a day rather than being pinned for a year.
vendor=$(cd out && ls vendor/maplibre-gl/*/maplibre-gl.mjs | head -1)
expect "/$vendor" Cache-Control immutable
expect /fonts/inter-variable.woff2 Cache-Control "max-age=86400"
expect /fonts/inter-variable.woff2 Content-Type font/woff2
expect / X-Content-Type-Options nosniff
expect / Referrer-Policy strict-origin-when-cross-origin
expect / Permissions-Policy "geolocation=(self)"
[[ -z $(header / Server) ]] && ok "/ no Server header" || bad "/ Server header present"
# /data is served from public/, never beyond it; nothing outside the site is reachable.
[[ $(status '/data/../.env') == 404 ]] && ok "/data/../.env 404" || bad "/data/../.env $(status '/data/../.env')"
[[ $(status '/data/../../pipeline/collect.py') == 404 ]] && ok "../pipeline 404" || bad "../pipeline"
[[ $(status '/data/') != 200 ]] && ok "/data/ lists nothing ($(status '/data/'))" || bad "/data/ lists files"
# The private preview: nothing without the password, the right headers with it, and the tileset
# offer (the provider's key) reachable by no other path.
auth() { curl -s -o /dev/null -w '%{http_code}' -u "$1" "$base$2"; }
authheader() { curl -s -D - -o /dev/null -u "$1" "$base$2" | tr -d '\r' | grep -i "^$3:" | head -1 | cut -d' ' -f2-; }
made_private=0
if [[ ! -f data/private/photo3d.json ]]; then
  mkdir -p data/private && printf '{"schemaVersion":1,"photo3d":{"provider":"sample","tilesetUrl":"https://example.org/t.json","attribution":"validate"}}\n' > data/private/photo3d.json
  made_private=1
fi
[[ $(status /preview/) == 401 ]] && ok "/preview/ 401 without a password" || bad "/preview/ $(status /preview/) without a password"
[[ $(status /preview/photo3d.json) == 401 ]] && ok "/preview/photo3d.json 401 without a password" || bad "/preview/photo3d.json $(status /preview/photo3d.json)"
[[ $(auth "check:wrong" /preview/) == 401 ]] && ok "/preview/ 401 with a wrong password" || bad "/preview/ with a wrong password"
if [[ -f out/preview/index.html ]]; then
  [[ $(auth "check:$PREVIEW_PASS" /preview/) == 200 ]] && ok "/preview/ 200 with the password" || bad "/preview/ $(auth "check:$PREVIEW_PASS" /preview/) with the password"
  [[ $(authheader "check:$PREVIEW_PASS" /preview/ Cache-Control) == *no-store* ]] && ok "/preview/ Cache-Control no-store" || bad "/preview/ Cache-Control"
  [[ $(authheader "check:$PREVIEW_PASS" /preview/ X-Robots-Tag) == *noindex* ]] && ok "/preview/ X-Robots-Tag noindex" || bad "/preview/ X-Robots-Tag"
else bad "out/preview/index.html missing: the preview page was not built"; fi
[[ $(auth "check:$PREVIEW_PASS" /preview/photo3d.json) == 200 ]] && ok "/preview/photo3d.json 200 with the password" || bad "/preview/photo3d.json with the password"
[[ $(authheader "check:$PREVIEW_PASS" /preview/photo3d.json Cache-Control) == *no-store* ]] && ok "/preview/photo3d.json no-store" || bad "/preview/photo3d.json Cache-Control"
[[ $(status /data/private/photo3d.json) == 404 ]] && ok "/data/private/photo3d.json 404" || bad "/data/private/photo3d.json $(status /data/private/photo3d.json)"
[[ $(status '/data/../data/private/photo3d.json') == 404 ]] && ok "/data/../data/private 404" || bad "/data/../data/private $(status '/data/../data/private/photo3d.json')"
[[ $(status '/preview/../data/private/photo3d.json') == 404 || $(status '/preview/../data/private/photo3d.json') == 401 ]] && ok "/preview/../data/private not served" || bad "/preview/../data/private $(status '/preview/../data/private/photo3d.json')"
[[ $made_private == 1 ]] && rm -f data/private/photo3d.json && rmdir data/private 2>/dev/null
exit $fail
