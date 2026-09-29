"""Backlog 43: does the DuckDB extension, loaded in the same process, corrupt the display scoring? A fixed input,
one trial per fresh process, many trials, any interpreter.

A trial scores the fixed service days with the production scripts, in one of three arrangements:

  inprocess    scripts/extract-arrival-inputs.py runs in this process (DuckDB opens the warehouse copy, reads,
               closes), then scripts/evaluate-arrival-display.py scores what it extracted, in the same process.
               This is how the evaluation ran until 28 September 2026, when it failed in 4 of 17 runs.
  import-only  `import duckdb` and nothing else from it, then the scoring on the fixed inputs.
  split        the scoring alone on the fixed inputs; DuckDB is never loaded. The production arrangement.
  legacy       the evaluation exactly as it ran when it failed (scripts/probes/evaluate-arrival-display-inprocess-
               2026-09-28.py): every complete day of the warehouse read and scored in one process. Needs --passages.
               Its result covers more days, so it is judged against its own first clean trial.

LM_DB_THREADS=1 in the environment runs the extraction on one DuckDB thread (pipeline/warehouse.py).

    <python> scripts/probes/duckdb-inprocess.py trials --python <python> --mode inprocess --n 20 \\
        --db data/evaluation/refresh-validation-2026-09-28/data/warehouse/lost-minutes.duckdb \\
        --inputs data/evaluation/refresh-validation-2026-09-28/eval/arrival-display-inputs.pkl \\
        --work <scratch dir> --label <name> [--reference <digest>]

Every trial is judged three ways: its exit (a signal is a crash), its error text, and the SHA-256 of its result
with the scoring time left out, against the reference digest (by default the first clean split trial's). A
result that differs without a crash is counted apart: that is the silent kind.
"""
import argparse
import hashlib
import importlib.metadata
import json
import os
import pickle
import platform
import runpy
import signal
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DAYS = '2026-09-20,2026-09-21,2026-09-22,2026-09-23,2026-09-24,2026-09-25,2026-09-26'


def run_script(path, argv):
    saved = sys.argv
    sys.argv = [str(path), *argv]
    try:
        runpy.run_path(str(path), run_name='__main__')
    finally:
        sys.argv = saved


def digest(path):
    """The result with the scoring time and the code's own digest left out, as one SHA-256: the scores alone."""
    lines = []
    for line in Path(path).read_text().splitlines():
        if line.strip():
            entry = json.loads(line)
            entry.pop('scoredAt', None)
            entry.pop('sourceDigest', None)
            lines.append(json.dumps(entry, sort_keys=True))
    return hashlib.sha256('\n'.join(sorted(lines)).encode()).hexdigest()


def trial(a):
    out = Path(a.out)
    if a.mode == 'legacy':
        return legacy_trial(a)
    days = a.days.split(',')
    fixed = pickle.loads(Path(a.inputs).read_bytes())
    info = {'mode': a.mode, 'python': platform.python_version(), 'implementation': sys.version.replace('\n', ' '),
            'duckdbInstalled': importlib.metadata.version('duckdb'), 'threadsEnv': os.environ.get('LM_DB_THREADS'),
            'gil': sys._is_gil_enabled() if hasattr(sys, '_is_gil_enabled') else None}
    scoring_inputs = out.with_suffix('.inputs.pkl')
    if a.mode == 'inprocess':
        run_script(ROOT / 'scripts/extract-arrival-inputs.py',
                   ['--line', '15', '--db', a.db, '--scored', str(out.with_suffix('.none')), '--out', str(scoring_inputs),
                    '--days', a.days])
        mine = pickle.loads(scoring_inputs.read_bytes())
        info['extractionMatchesFixed'] = (mine['depInfo'] == fixed['depInfo'] and mine['matchable'] == fixed['matchable']
                                          and all(mine['days'][d] == fixed['days'][d] for d in days))
    else:
        if a.mode == 'import-only':
            import duckdb  # noqa: F401  (loaded, never used)
        trimmed = dict(fixed, days={d: fixed['days'][d] for d in days})
        scoring_inputs.write_bytes(pickle.dumps(trimmed, protocol=pickle.HIGHEST_PROTOCOL))
    info['duckdbLoaded'] = 'duckdb' in sys.modules and hasattr(sys.modules['duckdb'], 'connect')
    run_script(ROOT / 'scripts/evaluate-arrival-display.py', ['--inputs', str(scoring_inputs), '--out', str(out)])
    print('TRIAL ' + json.dumps(info))


def legacy_trial(a):
    info = {'mode': a.mode, 'python': platform.python_version(), 'implementation': sys.version.replace('\n', ' '),
            'duckdbInstalled': importlib.metadata.version('duckdb'), 'threadsEnv': os.environ.get('LM_DB_THREADS'),
            'gil': sys._is_gil_enabled() if hasattr(sys, '_is_gil_enabled') else None, 'duckdbLoaded': True}
    run_script(ROOT / 'scripts/probes/evaluate-arrival-display-inprocess-2026-09-28.py',
               ['--line', '15', '--db', a.db, '--passages', a.passages, '--out', str(a.out)])
    print('TRIAL ' + json.dumps(info))


def trials(a):
    work = Path(a.work)
    work.mkdir(parents=True, exist_ok=True)
    reference = a.reference
    results = []
    env = dict(os.environ)
    for k in range(a.n):
        out = work / f'{a.label}-{k:02d}.jsonl'
        for stale in (out, out.with_suffix('.inputs.pkl')):
            stale.unlink(missing_ok=True)
        began = time.monotonic()
        try:
            p = subprocess.run([a.python, str(Path(__file__).resolve()), 'trial', '--mode', a.mode, '--db', a.db,
                                '--inputs', a.inputs, '--out', str(out), '--days', a.days,
                                *(['--passages', a.passages] if a.passages else [])],
                               capture_output=True, text=True, timeout=a.timeout, env=env, cwd=ROOT)
            code, stdout, stderr = p.returncode, p.stdout, p.stderr
        except subprocess.TimeoutExpired as e:
            code, stdout, stderr = 'timeout', e.stdout or '', e.stderr or ''
        seconds = round(time.monotonic() - began, 1)
        info = next((json.loads(line[6:]) for line in (stdout or '').splitlines() if line.startswith('TRIAL ')), None)
        error = [line for line in (stderr or '').splitlines() if line.strip()][-1:] if code != 0 else []
        got = digest(out) if code == 0 and out.exists() else None
        if got and reference is None and a.mode in ('split', 'legacy'):
            reference = got
        crashed = isinstance(code, int) and code < 0
        verdict = ('crash:' + signal.Signals(-code).name if crashed else 'timeout' if code == 'timeout'
                   else 'error' if code != 0 else 'wrong' if reference and got != reference else 'ok')
        row = {'label': a.label, 'trial': k, 'verdict': verdict, 'exit': code, 'seconds': seconds,
               'error': error[0][:200] if error else None, 'digest': got, 'info': info}
        results.append(row)
        print(json.dumps(row), flush=True)
        for done in (out.with_suffix('.inputs.pkl'),):
            done.unlink(missing_ok=True)
    counts = {}
    for r in results:
        counts[r['verdict']] = counts.get(r['verdict'], 0) + 1
    print('SUMMARY ' + json.dumps({'label': a.label, 'mode': a.mode, 'python': a.python, 'n': a.n, 'counts': counts,
                                   'reference': reference,
                                   'versions': next((r['info'] for r in results if r['info']), None)}), flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('command', choices=['trial', 'trials'])
    ap.add_argument('--mode', choices=['inprocess', 'import-only', 'split', 'legacy'], required=True)
    ap.add_argument('--passages')
    ap.add_argument('--db', required=True)
    ap.add_argument('--inputs', required=True)
    ap.add_argument('--days', default=DAYS)
    ap.add_argument('--out')
    ap.add_argument('--python', default=sys.executable)
    ap.add_argument('--n', type=int, default=20)
    ap.add_argument('--work')
    ap.add_argument('--label', default='run')
    ap.add_argument('--reference')
    ap.add_argument('--timeout', type=int, default=240)
    a = ap.parse_args()
    trial(a) if a.command == 'trial' else trials(a)


if __name__ == '__main__':
    main()
