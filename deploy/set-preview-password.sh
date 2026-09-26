#!/usr/bin/env bash
# The private preview's password (docs/PHOTO_3D_PREVIEW.md). Run on the server, as root:
#
#   sudo deploy/set-preview-password.sh            # set or change it (asks twice, shows nothing)
#   sudo deploy/set-preview-password.sh --lock     # remove it: the preview is locked to everyone
#
# /preview/ is served only behind HTTP basic authentication (deploy/Caddyfile). Until a password is
# set here, the Caddyfile's own default is the hash of a random password nobody was ever told, so
# the preview is locked. The password is typed at a hidden prompt, hashed with bcrypt by Caddy
# itself, and only the hash is kept: in /etc/lost-minutes/caddy.env (root only), which Caddy's unit
# reads. Nothing is echoed, logged or put on a command line, where other users could see it in the
# process list. Share the password only with the people testing the preview; change it with this
# script, and lock it when the test is over.
set -euo pipefail
ENV_FILE=/etc/lost-minutes/caddy.env
CADDYFILE=/etc/caddy/Caddyfile
[[ $EUID -eq 0 ]] || { echo "run as root: sudo $0 $*" >&2; exit 1; }
[[ -f $ENV_FILE ]] || { echo "$ENV_FILE is missing: run deploy/install.sh first" >&2; exit 1; }
command -v caddy >/dev/null || { echo "caddy is not installed" >&2; exit 1; }

# Everything but the two preview lines, kept as it was.
keep=$(grep -v -E '^LM_PREVIEW_(USER|HASH)=' "$ENV_FILE" || true)

if [[ ${1:-} == --lock ]]; then
  user='' hash=''
else
  read -r -p "Preview user name [preview]: " user
  user=${user:-preview}
  [[ $user =~ ^[A-Za-z0-9._-]{1,32}$ ]] || { echo "use letters, digits, dot, dash or underscore" >&2; exit 1; }
  read -r -s -p "Preview password (at least 12 characters): " pass; echo
  read -r -s -p "The same again: " again; echo
  [[ $pass == "$again" ]] || { echo "the two did not match; nothing changed" >&2; exit 1; }
  (( ${#pass} >= 12 )) || { echo "at least 12 characters; nothing changed" >&2; exit 1; }
  # Hashed from standard input, never from an argument.
  hash=$(printf '%s\n' "$pass" | caddy hash-password --algorithm bcrypt)
  unset pass again
  [[ $hash == \$2[aby]\$* ]] || { echo "caddy did not return a bcrypt hash; nothing changed" >&2; exit 1; }
fi

tmp=$(mktemp "$ENV_FILE.XXXXXX")
trap 'rm -f "$tmp"' EXIT
{
  printf '%s\n' "$keep"
  # Single quotes: the hash is full of '$', which neither systemd nor a shell may expand.
  if [[ -n $hash ]]; then printf "LM_PREVIEW_USER='%s'\nLM_PREVIEW_HASH='%s'\n" "$user" "$hash"; fi
} > "$tmp"
chmod 0600 "$tmp"
chown root:root "$tmp"

# Check the configuration with the new values before Caddy sees them.
if ! (set -a; . "$tmp"; set +a; caddy validate --config "$CADDYFILE" --adapter caddyfile >/dev/null 2>&1); then
  echo "caddy refused the configuration with the new values; nothing changed" >&2; exit 1
fi
mv "$tmp" "$ENV_FILE"
trap - EXIT
systemctl reload caddy

domain=$(grep -E '^LM_DOMAIN=' "$ENV_FILE" | cut -d= -f2- | tr -d "'\"")
code=$(curl -s -o /dev/null -w '%{http_code}' "https://$domain/preview/" || true)
if [[ -n $hash ]]; then
  echo "Set for user '$user'. Without the password https://$domain/preview/ answers $code (401 expected)."
  echo "Open https://$domain/preview/ in a browser and sign in to check it."
else
  echo "Locked. https://$domain/preview/ answers $code to everyone (401 expected)."
fi
