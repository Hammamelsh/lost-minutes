#!/usr/bin/env bash
# A temporary public preview for a phone trial.
#
#   scripts/preview.sh start [--minutes 60]   start whatever is not already running; print the link
#   scripts/preview.sh status                 what is running, the link and the latest publication
#   scripts/preview.sh stop                   stop only what this script started
#
# What it runs:
#   - the collector, unless one already holds the writer lock (then that one is reused): one
#     bounded run, which reads the key from .env itself, so the key never passes through here;
#   - Caddy with deploy/Caddyfile, unchanged, bound to 127.0.0.1 only: the built site from out/,
#     and /data/* from public/data, where the collector publishes (out/data is only the copy taken
#     at build time, which is why `pnpm start` will not do for this);
#   - a Cloudflare Quick Tunnel to that port: a random https://….trycloudflare.com address, with no
#     account and no domain. It lasts as long as the tunnel process and this machine; a restart
#     gives a new address.
# Each process it starts is recorded in outputs/preview/ (git-ignored), and stop signals only
# those, after checking that each is still the program it started. Nothing else is touched.
# LM_PREVIEW_PORT (8098) and LM_PREVIEW_DIR (outputs/preview) change where it listens and records.
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
DIR=${LM_PREVIEW_DIR:-outputs/preview}
PORT=${LM_PREVIEW_PORT:-8098}
CADDY=${CADDY:-$(command -v caddy || echo "$HOME/.local/bin/caddy")}
CLOUDFLARED=${CLOUDFLARED:-$(command -v cloudflared || echo "$HOME/.local/bin/cloudflared")}
LOCK=data/warehouse/collector.lock
mkdir -p "$DIR"

# The pid a name was started with, if that process is alive and still the same program.
ours() {
  local file="$DIR/$1.pid" pid
  [[ -s $file ]] || return 1
  pid=$(<"$file")
  kill -0 "$pid" 2>/dev/null && grep -aq -- "$2" "/proc/$pid/cmdline" 2>/dev/null || return 1
  echo "$pid"
}

# Starts a command in a session of its own, so it outlives the shell that started it, and records
# its pid (exec keeps the pid, so the record is the program itself).
detach() {
  local name=$1; shift
  rm -f "$DIR/$name.pid"
  setsid bash -c 'echo $$ >"$0"; exec "$@"' "$DIR/$name.pid" "$@" >"$DIR/$name.log" 2>&1 </dev/null &
  for _ in $(seq 1 50); do [[ -s $DIR/$name.pid ]] && return 0; sleep 0.1; done
  return 1
}

lock_held() { [[ -e $LOCK ]] && ! flock -n "$LOCK" true 2>/dev/null; }

published() {
  python3 -c "import json;j=json.load(open('public/data/live.json'));print(j.get('publishedAt') or j.get('generatedAt') or '?')" 2>/dev/null
}

start() {
  local minutes=60 pid url=""
  [[ ${1:-} == --minutes && -n ${2:-} ]] && minutes=$2
  [[ -x $CADDY ]] || { echo "No caddy binary (set CADDY=/path/to/caddy)."; exit 1; }
  [[ -x $CLOUDFLARED ]] || { echo "No cloudflared binary (set CLOUDFLARED=/path/to/cloudflared)."; exit 1; }
  [[ -f out/index.html ]] || { echo "out/ is missing: run pnpm build first."; exit 1; }

  if pid=$(ours collector pipeline.collect); then
    echo "collector: already running, started by this script (pid $pid)"
  elif lock_held; then
    echo "collector: another collector holds the writer lock, so it is reused (latest publication $(published))"
  else
    detach collector .venv/bin/python -m pipeline.collect --minutes "$minutes"
    echo "collector: started for $minutes minutes (pid $(<"$DIR/collector.pid")), log $DIR/collector.log"
  fi

  if pid=$(ours caddy caddy); then
    echo "caddy: already running (pid $pid)"
  else
    printf '{\n\tadmin off\n\tdefault_bind 127.0.0.1\n}\n\nimport %s/deploy/Caddyfile\n' "$ROOT" >"$DIR/Caddyfile"
    export LM_DOMAIN="http://:$PORT" LM_ROOT="$ROOT"
    "$CADDY" validate --config "$DIR/Caddyfile" --adapter caddyfile >"$DIR/caddy-validate.log" 2>&1 \
      || { tail -5 "$DIR/caddy-validate.log"; exit 1; }
    detach caddy "$CADDY" run --config "$DIR/Caddyfile" --adapter caddyfile
    for _ in $(seq 1 40); do curl -s -o /dev/null "http://127.0.0.1:$PORT/" && break; sleep 0.25; done
    curl -s -o /dev/null "http://127.0.0.1:$PORT/" \
      || { echo "caddy did not answer on 127.0.0.1:$PORT"; tail -5 "$DIR/caddy.log"; exit 1; }
    echo "caddy: out/ and /data/* from public/data on 127.0.0.1:$PORT (pid $(<"$DIR/caddy.pid"))"
  fi

  if pid=$(ours tunnel cloudflared); then
    echo "tunnel: already running (pid $pid)"
  else
    detach tunnel "$CLOUDFLARED" tunnel --no-autoupdate --url "http://127.0.0.1:$PORT"
    echo "tunnel: started (pid $(<"$DIR/tunnel.pid"))"
  fi
  for _ in $(seq 1 90); do
    url=$(grep -ao 'https://[a-z0-9-]*\.trycloudflare\.com' "$DIR/tunnel.log" | grep -v '//api\.' | head -1)
    [[ -n $url ]] && break
    sleep 0.5
  done
  [[ -n $url ]] || { echo "The tunnel has given no address yet; see $DIR/tunnel.log"; exit 1; }
  echo "$url" >"$DIR/url"
  printf '\n  %s\n\nStop with: scripts/preview.sh stop\n' "$url"
}

status() {
  local pid name
  for pair in collector:pipeline.collect caddy:caddy tunnel:cloudflared; do
    name=${pair%%:*}
    if pid=$(ours "$name" "${pair#*:}"); then echo "$name: running (pid $pid)"
    else echo "$name: not running from this script"; fi
  done
  if lock_held; then echo "writer lock: held, a collector is running"; else echo "writer lock: free, no collector"; fi
  [[ -s $DIR/url ]] && echo "link: $(<"$DIR/url")"
  echo "latest publication: $(published)"
}

stop() {
  local pid
  if pid=$(ours tunnel cloudflared); then kill "$pid"; echo "stopped the tunnel (pid $pid); its address no longer works"; fi
  if pid=$(ours caddy caddy); then kill "$pid"; echo "stopped caddy (pid $pid)"; fi
  if pid=$(ours collector pipeline.collect); then
    kill -INT "$pid"; echo "stopped the collector (pid $pid); it records the stop and releases its lock"
  fi
  # The request log holds the forwarded address of every phone that opened the link: not kept.
  rm -f "$DIR"/*.pid "$DIR/url" "$DIR/caddy.log"
  echo "Nothing else was touched."
}

case ${1:-} in
  start) shift; start "$@" ;;
  status) status ;;
  stop) stop ;;
  *) echo "usage: scripts/preview.sh start [--minutes 60] | status | stop"; exit 2 ;;
esac
