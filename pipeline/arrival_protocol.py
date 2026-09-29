"""The arrival display's protocol versions, frozen, and the rules a release may follow from (29 September 2026).

A version is a model, a stop mapping, a display protocol, and one confirmation window of service days nobody had
scored when it was frozen. Three rules hold here, and are tested:

  1. A version is the code that defines it. `sourceDigest` pins the files that define the model and what a page
     would show; tests/test_arrival_protocol.py fails when any of them changes while the version stays the same.
     A change to the model or the display is a new version, with its own window, frozen before that window opens
     and after every day any earlier version scored.
  2. A window is untouched. The release check refuses a version whose window has a day scored under anything
     else, and the nightly scoring never replaces another version's record of a day.
  3. Results approve nothing. A passing window is released only when the approval names it field for field and
     cites `confirmationDigest`, the SHA-256 of that window's own results: it cannot be written before them.

This module is deliberately not among the files it pins.
"""
from __future__ import annotations

import hashlib
import json
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# The files that define the model (its parameters and the estimator), the moments a page would show it (the
# protocol, the live match, the passages it is judged against, the stop mapping) and the page's own display.
DEFINING_FILES = (
    'scripts/arrival-params-frozen.json',
    'scripts/evaluate-arrival.py',
    'scripts/evaluate-arrival-display.py',
    'pipeline/arrival_display.py',
    'pipeline/passages.py',
    'pipeline/match.py',
    'pipeline/stop_mapping.py',
    'lib/arrival.ts',
)

VERSIONS = {
    'display-1': {
        'model': 'blended@9a626129f782',
        'stopMapping': 2,
        # Frozen and pushed at 19:28 UTC on 28 September (fd87d22); its scoring was made two processes and its
        # page display given the validated interval before its first day began (a5e43cc, deployed 21:49 UTC), and
        # its record of the code it runs added on 29 September before its first day was scored. Nothing that
        # decides a number changed in either: the fixed revision input scores identically.
        'frozenAt': '2026-09-28T19:28:00+00:00',
        'confirmation': {'from': '2026-09-29', 'days': 7},
        'sourceDigest': 'c44d743a6386fa230c5c1882445435c81a5df21b1cd79b65b8428c4866c062e4',
    },
}


def source_digest(root=ROOT, files=DEFINING_FILES):
    """One SHA-256 over the defining files, each by its path and its own SHA-256."""
    h = hashlib.sha256()
    for rel in files:
        h.update(f'{rel}\0{hashlib.sha256((Path(root) / rel).read_bytes()).hexdigest()}\n'.encode())
    return h.hexdigest()


def window(version):
    c = VERSIONS[version]['confirmation']
    first = date.fromisoformat(c['from'])
    return [(first + timedelta(days=k)).isoformat() for k in range(c['days'])]


def identity(entry):
    """What a scored day was scored under."""
    return (entry.get('protocol'), entry.get('model'), entry.get('stopMapping'), entry.get('sourceDigest'))


def expected(version):
    v = VERSIONS[version]
    return (version, v['model'], v['stopMapping'], v['sourceDigest'])


def deployed_problems(version, model, root=ROOT):
    """Why the code here cannot stand for the frozen version, if it cannot."""
    if version not in VERSIONS:
        return [f'protocol {version} is not a frozen version']
    v, problems = VERSIONS[version], []
    if model != v['model']:
        problems.append(f"the model here is {model}, and {version} was frozen with {v['model']}")
    digest = source_digest(root)
    if digest != v['sourceDigest']:
        problems.append(f'the code that defines {version} has changed since it was frozen ({digest[:12]}, '
                        f"frozen {v['sourceDigest'][:12]}): a change to the model or the display is a new version")
    return problems


def touched_days(entries, version):
    """Days of the version's window scored under anything else: such a window is no longer untouched."""
    days, own = set(window(version)), expected(version)
    return sorted({e['day'] for e in entries if e.get('day') in days and identity(e) != own})


def confirmation_digest(entries, version, direction):
    """The SHA-256 of a window's own results for one direction: what an approval of them must cite."""
    own, days = expected(version), set(window(version))
    rows = sorted(([e['day'], sorted(e['directions'].get(direction, {}).get('journeys', []), key=lambda j: j['journey'])]
                   for e in entries if e.get('day') in days and identity(e) == own), key=lambda r: r[0])
    return hashlib.sha256(json.dumps([version, direction, rows], sort_keys=True).encode()).hexdigest()
