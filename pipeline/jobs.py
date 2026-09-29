"""What the nightly jobs themselves did, for the Operations view.

Each nightly unit records its own attempt: `start` as it begins (ExecStartPre) and `finish` as it
stops (ExecStopPost, which systemd runs whether the job succeeded, failed, timed out or was killed,
and hands the outcome in SERVICE_RESULT, EXIT_CODE and EXIT_STATUS). Whether the timer started it or
someone did by hand is recorded too (systemd sets TRIGGER_UNIT for a timer's run), so a controlled
run is never mistaken for the scheduled one.

Why this exists: from 24 to 28 September 2026 the arrival evaluation failed every night, and on the
28th the timetable rebuild did, and nothing said so anywhere a person would look. A job that never
starts writes nothing at all, so the page judges "overdue" from the age of the last *scheduled*
attempt against the job's schedule: a timer that stopped firing shows too.

    python -m pipeline.jobs start refresh
    python -m pipeline.jobs step refresh -- python -m pipeline.patterns build   # runs a step, keeps its resident peak
    python -m pipeline.jobs finish refresh          # reads SERVICE_RESULT, EXIT_CODE, EXIT_STATUS
    python -m pipeline.jobs seed refresh --attempt 2026-09-28T02:40:33+00:00 --result failed ...  (once)
    python -m pipeline.jobs publish

Nothing here can stop a job: the units call it with systemd's "-" prefix, so a failure to record is
logged and ignored.
"""
from __future__ import annotations

import argparse
import fcntl
import json
import os
import resource
import subprocess
import sys
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from .core import atomic_json, utc_now

# The jobs, their units and schedules as the timers declare them (deploy/systemd/*.timer). "Every"
# and "grace" are what the page needs to call a job overdue: a daily job whose last scheduled
# attempt is more than a day and three hours old has missed a night.
JOBS = {
    'refresh': {'unit': 'lost-minutes-refresh.service', 'title': 'Timetable rebuild',
                'does': 'rebuilds the timetable catalogue and the stops’ departure boards; '
                        'pauses collection for a few minutes',
                'schedule': 'nightly at 03:40 London time (up to 5 min later)', 'everySeconds': 86_400, 'graceSeconds': 3 * 3600,
                'timeoutSeconds': 30 * 60},
    'arrival-eval': {'unit': 'lost-minutes-arrival-eval.service', 'title': 'Arrival evaluation',
                     'does': 'scores the arrival estimator on last night’s copy of the warehouse; '
                             'collection is not touched',
                     'schedule': 'nightly at 04:10 London time (up to 5 min later)', 'everySeconds': 86_400,
                     'graceSeconds': 3 * 3600, 'timeoutSeconds': 20 * 60},
}
STATE_DIR = Path('data/jobs')
TARGET = Path('public/data/jobs.json')
SCHEMA_VERSION = 1


@contextmanager
def _locked(root):
    """One writer at a time: the refresh's stop and the evaluation's start can meet."""
    lock = Path(root) / STATE_DIR / '.lock'
    lock.parent.mkdir(parents=True, exist_ok=True)
    with open(lock, 'a') as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def _state_path(root, name):
    return Path(root) / STATE_DIR / f'{name}.json'


def _load(root, name):
    try:
        return json.loads(_state_path(root, name).read_text())
    except (OSError, ValueError):
        return {}


def _trigger(env):
    """'timer' when systemd's timer started the run, else 'manual' (a person, or a test)."""
    unit = env.get('TRIGGER_UNIT', '')
    return 'timer' if unit.endswith('.timer') else 'manual'


def outcome(env):
    """The attempt's result from what systemd hands ExecStopPost."""
    result = env.get('SERVICE_RESULT', '')
    return {'result': 'succeeded' if result == 'success' else 'failed',
            'serviceResult': result or None, 'exitCode': env.get('EXIT_CODE') or None,
            'exitStatus': env.get('EXIT_STATUS') or None}


def unit_memory(unit, proc_cgroup='/proc/self/cgroup', cgroup_root='/sys/fs/cgroup'):
    """The unit's own memory peak and ceiling in bytes, read from inside its cgroup: ExecStopPost runs
    there, so after the job the peak is the whole run's. Nothing when this is not that unit's cgroup (a
    run from a shell is in a session's, whose peak is not the job's), or when it cannot be read. With it,
    what the kernel did about that memory (`memory_pressure`)."""
    try:
        group = next(line.split(':', 2)[2] for line in Path(proc_cgroup).read_text().splitlines()
                     if line.startswith('0::'))
        if not group.rstrip('/').endswith('/' + unit):
            return {}
        base = Path(cgroup_root) / group.strip('/')
        peak = int((base / 'memory.peak').read_text().split()[0])
        ceiling = (base / 'memory.max').read_text().strip()
        return {'memoryPeakBytes': peak, 'memoryMaxBytes': None if ceiling == 'max' else int(ceiling),
                **memory_pressure(base)}
    except (OSError, ValueError, IndexError, StopIteration):
        return {}


def memory_pressure(base):
    """What the kernel did about a unit's memory during its run, from the unit's own cgroup: how often it was
    held at its ceiling (the kernel reclaiming, page cache first), its OOM events and OOM kills
    (`memory.events`), and how long its processes waited on memory (`memory.pressure`, `some` for any of them,
    `full` for all at once, in seconds). The unit's peak alone cannot tell a ceiling reached by page cache the
    kernel took back from one that stalled or killed the job. Anything unreadable is left out, never guessed."""
    found = {}
    try:
        events = dict(line.split()[:2] for line in (base / 'memory.events').read_text().splitlines() if line.strip())
        found['memoryEvents'] = {'atCeiling': int(events.get('max', 0)), 'oom': int(events.get('oom', 0)),
                                 'oomKills': int(events.get('oom_kill', 0))}
    except (OSError, ValueError):
        pass
    try:
        stalls = {}
        for line in (base / 'memory.pressure').read_text().splitlines():
            kind, *fields = line.split()
            total = dict(field.split('=', 1) for field in fields).get('total')
            if total is not None:
                stalls[kind] = round(int(total) / 1e6, 3)
        if stalls:
            found['memoryStallSeconds'] = stalls
    except (OSError, ValueError):
        pass
    return found


def parse_size(text):
    """systemd's sizes as the journal and unit files write them: 1.4G, 684.5M, 1500M (powers of 1024)."""
    if text is None:
        return None
    text = str(text).strip()
    units = {'K': 1024, 'M': 1024 ** 2, 'G': 1024 ** 3, 'T': 1024 ** 4}
    if text and text[-1].upper() in units:
        return int(float(text[:-1]) * units[text[-1].upper()])
    return int(float(text))


def start(root, name, now=None, env=None):
    env = os.environ if env is None else env
    now = now or utc_now()
    with _locked(root):
        state = _load(root, name)
        attempt = {'startedAt': now, 'trigger': _trigger(env), 'finishedAt': None, 'result': 'running'}
        state['lastAttempt'] = attempt
        if attempt['trigger'] == 'timer':
            state['lastScheduledAttemptAt'] = now
        atomic_json(_state_path(root, name), state)
        publish(root)
    return state


def step_label(argv):
    """What a step runs, for the record: a module and its subcommand (`pipeline.patterns build`), else a script's
    name (`extract-arrival-inputs.py`), else the program. Never raises: a label is not worth a failed job."""
    try:
        if '-m' in argv[:-1]:
            k = argv.index('-m')
            rest = [a for a in argv[k + 2:k + 3] if not a.startswith('-')]
            return ' '.join([argv[k + 1], *rest])
        for a in argv[1:]:
            if a.endswith(('.py', '.mjs', '.js', '.sh')):
                return os.path.basename(a)
        return os.path.basename(argv[0])
    except Exception:  # noqa: BLE001
        return '?'


def step(root, name, argv, run=subprocess.run):
    """Run one step of a nightly job and add its resident peak to the running attempt. The unit's own peak
    (memory.peak, read by `finish`) counts page cache, which the kernel reclaims before it kills anything, and
    which a job reading a large warehouse fills to near its ceiling whatever its real need; a step's largest
    resident set is the memory that could get it killed. The step's exit status is the job's, unchanged, and a
    failure to record never becomes a failure of the job."""
    began = time.monotonic()
    code = run(argv).returncode
    seconds = round(time.monotonic() - began, 1)
    peak = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss * 1024     # the largest child, in kB on Linux
    try:
        with _locked(root):
            state = _load(root, name)
            attempt = state.get('lastAttempt') or {'startedAt': None, 'result': 'running'}
            attempt['residentPeakBytes'] = max(attempt.get('residentPeakBytes') or 0, peak)
            attempt.setdefault('steps', []).append({'command': step_label(argv), 'seconds': seconds,
                                                    'residentPeakBytes': peak, 'exitStatus': code})
            state['lastAttempt'] = attempt
            atomic_json(_state_path(root, name), state)
            publish(root)
    except OSError as error:
        print(json.dumps({'jobsRecord': 'step not recorded', 'job': name, 'error': type(error).__name__}), file=sys.stderr)
    return code


def finish(root, name, now=None, env=None, memory=None):
    env = os.environ if env is None else env
    now = now or utc_now()
    memory = unit_memory(JOBS[name]['unit']) if memory is None else memory
    with _locked(root):
        state = _load(root, name)
        attempt = state.get('lastAttempt') or {'startedAt': None, 'trigger': _trigger(env)}
        attempt.update({'finishedAt': now, **outcome(env), **memory})
        state['lastAttempt'] = attempt
        if attempt['result'] == 'succeeded':
            state['lastSuccess'] = {'at': now, 'trigger': attempt.get('trigger'), **memory,
                                    **({'residentPeakBytes': attempt['residentPeakBytes']} if attempt.get('residentPeakBytes') else {})}
        else:
            state['lastFailure'] = {'at': now, 'trigger': attempt.get('trigger'),
                                    'serviceResult': attempt.get('serviceResult'),
                                    'exitStatus': attempt.get('exitStatus')}
        atomic_json(_state_path(root, name), state)
        publish(root)
    return state


def seed(root, name, attempt_at, finished_at, result, success_at=None, success_trigger='timer',
         trigger='timer', service_result=None, exit_status=None, source='journal', success_memory_peak=None,
         memory_max=None):
    """The record as it stood before the jobs recorded themselves, read from the journal once, and
    marked as read from there."""
    with _locked(root):
        state = {'lastAttempt': {'startedAt': attempt_at, 'finishedAt': finished_at, 'trigger': trigger,
                                 'result': result, 'serviceResult': service_result,
                                 'exitCode': 'exited' if exit_status else None, 'exitStatus': exit_status},
                 'seededFrom': source}
        if trigger == 'timer':
            state['lastScheduledAttemptAt'] = attempt_at
        if success_at:
            state['lastSuccess'] = {'at': success_at, 'trigger': success_trigger}
            if success_memory_peak:
                # The journal rounds ("1.4G"): said to be from there.
                state['lastSuccess'].update({'memoryPeakBytes': parse_size(success_memory_peak),
                                             'memoryMaxBytes': parse_size(memory_max), 'memorySource': 'journal'})
        if result != 'succeeded':
            state['lastFailure'] = {'at': finished_at, 'trigger': trigger, 'serviceResult': service_result,
                                    'exitStatus': exit_status}
        atomic_json(_state_path(root, name), state)
        publish(root)
    return state


def publish(root):
    """Every job's record in one small file the page reads: validated shape, written atomically."""
    jobs = []
    for name, job in JOBS.items():
        state = _load(root, name)
        jobs.append({'name': name, **job,
                     'lastAttempt': state.get('lastAttempt'),
                     'lastScheduledAttemptAt': state.get('lastScheduledAttemptAt'),
                     'lastSuccess': state.get('lastSuccess'),
                     'lastFailure': state.get('lastFailure'),
                     'seededFrom': state.get('seededFrom')})
    atomic_json(Path(root) / TARGET, {'schemaVersion': SCHEMA_VERSION, 'generatedAt': utc_now(), 'jobs': jobs})


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    parser.add_argument('command', choices=['start', 'step', 'finish', 'seed', 'publish'])
    parser.add_argument('name', nargs='?', choices=sorted(JOBS))
    parser.add_argument('--root', default='.')
    parser.add_argument('--attempt'); parser.add_argument('--finished'); parser.add_argument('--result')
    parser.add_argument('--success'); parser.add_argument('--service-result'); parser.add_argument('--exit-status')
    parser.add_argument('--success-memory-peak', help='the journal\'s "memory peak" for that success, e.g. 1.4G')
    parser.add_argument('--memory-max', help='the unit\'s MemoryMax, e.g. 1500M')
    argv = sys.argv[1:] if argv is None else list(argv)
    command_argv = []
    if '--' in argv:                                   # step: what follows -- is the step to run
        cut = argv.index('--')
        argv, command_argv = argv[:cut], argv[cut + 1:]
    args = parser.parse_args(argv)
    if args.command != 'publish' and not args.name:
        parser.error('a job name is needed')
    if args.command == 'step':
        if not command_argv:
            parser.error('step needs the command to run after --')
        return step(args.root, args.name, command_argv)
    try:
        if args.command == 'start':
            start(args.root, args.name)
        elif args.command == 'finish':
            finish(args.root, args.name)
        elif args.command == 'seed':
            seed(args.root, args.name, args.attempt, args.finished, args.result, success_at=args.success,
                 service_result=args.service_result, exit_status=args.exit_status,
                 success_memory_peak=args.success_memory_peak, memory_max=args.memory_max)
        else:
            publish(args.root)
    except OSError as error:            # never the job's failure: said, and left
        print(json.dumps({'jobsRecord': 'not written', 'job': args.name, 'error': type(error).__name__}),
              file=sys.stderr)
        return 1
    print(json.dumps({'jobsRecord': args.command, 'job': args.name,
                      'at': datetime.now(timezone.utc).isoformat()}))
    return 0


if __name__ == '__main__':
    sys.exit(main())
