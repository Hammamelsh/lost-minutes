"""The real collector in a child process, a SIGTERM at a chosen moment, and whether it stops.

    .venv/bin/python scripts/probes/stop-sweep.py <scratch-root> <warehouse-copy.duckdb> <captures-dir> <delays...>

    e.g. scratch=$(mktemp -d); cp data/warehouse/lost-minutes.duckdb $scratch/lm.duckdb
         mkdir -p $scratch/root/public/data
         .venv/bin/python scripts/probes/stop-sweep.py $scratch/root $scratch/lm.duckdb \
             data/live-capture/positions $(seq 0.34 0.02 0.7)

Each delay starts pipeline.collect.collect() afresh in a child process, with the real clock, the real
sleep and a real warehouse (a copy: never the one in use), fed the collector's own stored position
captures in turn, so every cycle loads and publishes as on the server; only the feed is local. After
the delay the parent sends SIGTERM and waits up to 35 s, as systemd does (TimeoutStopSec 30), then
prints one JSON line: how long the stop took (null if it hung), how many cycles were logged after the
signal, which of the collector's steps and warehouse statements were open when it landed, and which
raised. Written on 27 September 2026 to reproduce a deploy's lost stop: 8 and 9 of 19 stops landing
in the batch insert of positions hung before the fix in pipeline/collect.py (_check_stop), 0 of 19
after. Sweep across the first cycle's load, which the delays above cover on this machine; the step
columns say where each signal landed.
"""
import gzip
import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))


def _stamp(**event):
    event['t'] = round(time.monotonic(), 3)
    print(json.dumps(event), flush=True)


def child(root, db, captures):
    import pipeline.collect as pc
    import pipeline.live as pl

    def traced(module, name):
        original = getattr(module, name)

        def wrapper(*args, **kwargs):
            _stamp(step=name, at='start')
            try:
                return original(*args, **kwargs)
            except BaseException as error:
                _stamp(step=name, at='raised', error=type(error).__name__)
                raise
            finally:
                _stamp(step=name, at='end')
        setattr(module, name, wrapper)

    for name in ('close_abandoned_live_runs', 'parse_source', 'load_observations', 'record_cycle',
                 'publish_live', 'claim_source', 'record_raw_source', 'store_payload'):
        if hasattr(pc, name):
            traced(pc, name)
    for name in ('match_all', 'write_runtime_config'):
        if hasattr(pl, name):
            traced(pl, name)

    class Statements:
        """The load's own warehouse statements, timed, through a proxy for its connection."""

        def __init__(self, con):
            self._con = con

        def __getattr__(self, name):
            target = getattr(self._con, name)
            if name not in ('execute', 'executemany'):
                return target

            def call(sql, *args, **kwargs):
                label = f"{name}:{' '.join(str(sql).split())[:40]}"
                _stamp(step=label, at='start')
                try:
                    return target(sql, *args, **kwargs)
                except BaseException as error:
                    _stamp(step=label, at='raised', error=type(error).__name__)
                    raise
                finally:
                    _stamp(step=label, at='end')
            return call

    load = pc.load_observations
    pc.load_observations = lambda con, *args, **kwargs: load(Statements(con), *args, **kwargs)

    files = sorted(Path(captures).glob('*.bin.gz'))[-40:]
    state = {'i': 0}

    def fetch(_url):
        body = gzip.decompress(files[state['i'] % len(files)].read_bytes())
        state['i'] += 1
        return body, 200, {}

    _stamp(child='started', pid=os.getpid())
    try:
        pc.collect(minutes=3, interval=10, root=root, db_path=db, fetch_fn=fetch,
                   log=lambda event: _stamp(**event), api_key='probe-key-not-real')
    except BaseException as error:  # noqa: BLE001 - say how the run ended, then end it the same way
        _stamp(child='ended', by=type(error).__name__)
        raise


def sweep(root, db, captures, delays):
    for delay in delays:
        proc = subprocess.Popen([sys.executable, __file__, 'child', root, db, captures],
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, cwd=str(REPO))
        started = time.monotonic()
        time.sleep(delay)
        sent = time.monotonic()
        proc.send_signal(signal.SIGTERM)
        try:
            out, _ = proc.communicate(timeout=35)
            took = round(time.monotonic() - sent, 2)
        except subprocess.TimeoutExpired:
            proc.kill()
            out, _ = proc.communicate()
            took = None
        events = [json.loads(line) for line in out.splitlines() if line.startswith('{')]
        t0 = next((e['t'] for e in events if e.get('child') == 'started'), None)
        at = sent - started
        steps = [e for e in events if 'step' in e]
        open_at = []
        for e in steps:
            if t0 is None or e['t'] - t0 > at:
                break
            if e['at'] == 'start':
                open_at.append(e['step'])
            elif e['at'] == 'end' and e['step'] in open_at:
                open_at.remove(e['step'])
        print(json.dumps({
            'delay': delay, 'stopTookS': took, 'hung': took is None,
            'cyclesLoggedAfterSignal': sum(1 for e in events if 'cycle' in e and t0 is not None and e['t'] - t0 > at + 0.05),
            'openAtSignal': open_at,
            'raised': [(e['step'], e['error']) for e in steps if e['at'] == 'raised'][:4]}), flush=True)


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'child':
        child(*sys.argv[2:5])
    elif len(sys.argv) > 4:
        sweep(*sys.argv[1:4], [float(x) for x in sys.argv[4:]])
    else:
        sys.exit(__doc__)
