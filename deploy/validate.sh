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
  for exe in srv/lost-minutes/app/.venv/bin/python srv/lost-minutes/app/deploy/check-health.sh usr/bin/find bin/systemctl; do
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
if "$CADDY" validate --config deploy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then ok "caddy validate"
else "$CADDY" validate --config deploy/Caddyfile --adapter caddyfile 2>&1 | tail -5; bad "caddy validate"; exit 1; fi
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
exit $fail
