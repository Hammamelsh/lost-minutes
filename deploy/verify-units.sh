#!/usr/bin/env bash
# Verify the systemd units in deploy/systemd without a server: systemd-analyze verify against a scratch root holding
# the paths the units name, so it checks the units rather than this machine. A directive systemd does not know is a
# failure: verify itself exits 0 on one and prints "Unknown key …, ignoring", so a misspelt MemoryMax or
# OOMScoreAdjust would pass and be silently absent on the server.
#
#   deploy/verify-units.sh             skips, and says so, where systemd-analyze is not installed
#   deploy/verify-units.sh --require   fails where it is not installed (CI): an unverified unit is never a pass
#
# Used by deploy/validate.sh and by CI (.github/workflows/checks.yml). Exit 0: verified, or skipped without
# --require. Exit 1: a unit failed, or the tool is missing under --require.
set -uo pipefail
cd "$(dirname "$0")/.."
require=0
[[ "${1:-}" == "--require" ]] && require=1

if ! command -v systemd-analyze >/dev/null; then
  if (( require )); then
    echo "FAIL: systemd-analyze is not available here, so the systemd units were NOT verified."
    [[ -n "${GITHUB_ACTIONS:-}" ]] && echo "::error title=systemd units not verified::systemd-analyze is not available on this runner"
    exit 1
  fi
  echo "skipped: systemd-analyze is not installed, so the systemd units were not verified"
  exit 0
fi

scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
mkdir -p "$scratch/srv/lost-minutes/app/.venv/bin" "$scratch/srv/lost-minutes/app/deploy" \
         "$scratch/srv/lost-minutes/app/data/live-capture" "$scratch/srv/lost-minutes/app/public/data" \
         "$scratch/etc/lost-minutes" "$scratch/etc/systemd/system" "$scratch/usr/bin" "$scratch/bin"
for exe in srv/lost-minutes/app/.venv/bin/python srv/lost-minutes/app/deploy/check-health.sh usr/bin/find bin/systemctl bin/cp; do
  printf '#!/bin/sh\n' > "$scratch/$exe"; chmod +x "$scratch/$exe"
done
touch "$scratch/etc/lost-minutes/collector.env"
# The standard units every unit depends on (sysinit.target, timers.target and the rest), as this machine has them;
# without them verify stops at the first missing target.
if [[ -d /usr/lib/systemd/system ]]; then
  mkdir -p "$scratch/usr/lib/systemd" && cp -r /usr/lib/systemd/system "$scratch/usr/lib/systemd/"
fi
cp deploy/systemd/lost-minutes-*.service deploy/systemd/lost-minutes-*.timer "$scratch/etc/systemd/system/"
units=$(cd deploy/systemd && ls lost-minutes-*.service lost-minutes-*.timer)
# The login sessions' memory ceiling is a drop-in for every user-UID.slice, checked on one of them.
mkdir -p "$scratch/etc/systemd/system/user-.slice.d"
cp deploy/systemd/user-.slice.d/*.conf "$scratch/etc/systemd/system/user-.slice.d/"
printf '[Unit]\nDescription=a login user'"'"'s slice, for the drop-in\n' > "$scratch/etc/systemd/system/user-1000.slice"

# shellcheck disable=SC2086
out=$(cd "$scratch/etc/systemd/system" && systemd-analyze verify --root="$scratch" --man=no $units user-1000.slice 2>&1)
status=$?
if (( status == 0 )) && ! grep -qiE 'unknown (key|section|lvalue)|failed to parse|invalid|ignoring' <<<"$out"; then
  echo "ok: $(echo $units | wc -w) units and the login sessions' memory ceiling ($(systemd-analyze --version | head -1))"
  exit 0
fi
echo "$out" | sed 's/^/    /'
echo "FAIL: the systemd units did not verify (systemd-analyze exit $status)"
[[ -n "${GITHUB_ACTIONS:-}" ]] && echo "::error title=systemd units::deploy/systemd did not verify; see the log above"
exit 1
