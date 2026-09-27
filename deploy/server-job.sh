#!/usr/bin/env bash
# One diagnostic job on the server, held so that it cannot take the collector down.
#
#   deploy/server-job.sh [--memory 400M] [--name label] [--keep] -- command [args...]
#
# Run on the server, from /srv/lost-minutes/app, as the deploy user (it asks sudo for the cgroup).
# On 26 September 2026 a replay run by hand filled the 4 GB machine and the kernel killed the collector
# twice. What this gives a job, and why:
#   - its own memory ceiling (default 400M, at most 800M) and no swap, in a scope of its own: past the
#     ceiling the job is killed, and nothing else is touched;
#   - the lowest CPU and I/O priority, so the collector's cycles come first;
#   - scratch on disk: TMPDIR is a fresh directory under /var/tmp/lost-minutes-jobs. /tmp on this
#     server is RAM, so a file written there counts against memory; a /tmp or /dev/shm path anywhere
#     in the command is refused. Put copies of warehouse files in the scratch directory too: DuckDB
#     spills beside the database file it opens.
#   - afterwards: the exit status, whether the ceiling was hit, and any kernel out-of-memory line
#     since the job began, so a global one (which would mean something else suffered) is seen.
# Heavy work — replays, a copy of the warehouse — belongs on a laptop: copy the captures and the few
# tables needed down, and run it there (deploy/README.md, "Memory").
set -euo pipefail
memory=400M name=job keep=0
while (($#)); do
  case $1 in
    --memory) memory=$2; shift 2 ;;
    --name) name=$2; shift 2 ;;
    --keep) keep=1; shift ;;
    --) shift; break ;;
    *) break ;;
  esac
done
(($#)) || { echo "usage: $0 [--memory 400M] [--name label] [--keep] -- command [args...]" >&2; exit 2; }
[[ $memory =~ ^([0-9]+)([MG])$ ]] || { echo "--memory takes a size like 400M or 1G" >&2; exit 2; }
megabytes=${BASH_REMATCH[1]}; [[ ${BASH_REMATCH[2]} == G ]] && megabytes=$((megabytes * 1024))
((megabytes <= 800)) || { echo "at most 800M here: anything bigger is a job for a laptop" >&2; exit 2; }
[[ $name =~ ^[A-Za-z0-9_-]{1,40}$ ]] || { echo "--name: letters, digits, dash and underscore" >&2; exit 2; }
for word in "$@"; do
  if [[ $word == /tmp || $word == /tmp/* || $word == *=/tmp/* || $word == /dev/shm* || $word == *=/dev/shm* ]]; then
    echo "refused: '$word' is in memory on this server; use the job's scratch directory (\$TMPDIR) instead" >&2; exit 2
  fi
done

user=$(id -un)
root=/var/tmp/lost-minutes-jobs
# Directories left by earlier jobs are kept a week for copying down, then removed.
sudo find "$root" -mindepth 1 -maxdepth 1 -type d -mtime +7 -exec rm -rf {} + 2>/dev/null || true
stamp=$(date -u +%Y%m%dT%H%M%SZ)
scratch=$root/$name-$stamp
sudo install -d -m 0755 -o root -g root "$root"
sudo install -d -m 0700 -o "$user" -g "$user" "$scratch"
unit=lm-job-$name-$stamp
since=$(date -u '+%Y-%m-%d %H:%M:%S')
echo "job $unit: ceiling $memory, scratch $scratch" >&2

set +e
sudo systemd-run --scope --quiet --unit="$unit" \
  -p MemoryMax="$memory" -p MemorySwapMax=0 -p MemoryHigh="$((megabytes * 9 / 10))M" \
  -- sudo -u "$user" env TMPDIR="$scratch" nice -n 19 ionice -c 3 "$@"
status=$?
set -e

oom=$(sudo journalctl -k --since "$since" --no-pager 2>/dev/null | grep -E 'oom-kill:|Out of memory|Memory cgroup out of memory' || true)
if [[ -n $oom ]] && grep -q "$unit" <<<"$oom"; then
  echo "job $unit: killed at its ${memory} ceiling (exit $status); nothing else was touched" >&2
fi
if grep -q 'CONSTRAINT_NONE' <<<"$oom"; then
  echo "WARNING: the kernel ran out of memory for the whole machine since this job began:" >&2
  grep 'CONSTRAINT_NONE\|Killed process' <<<"$oom" >&2
fi
echo "job $unit: exit $status" >&2
if ((keep == 0)) && [[ -z $(ls -A "$scratch") ]]; then sudo rmdir "$scratch"; else echo "job $unit: output kept in $scratch" >&2; fi
exit "$status"
