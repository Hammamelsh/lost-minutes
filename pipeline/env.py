"""Load a local .env without adding a dependency.

Values already present in the environment win, so an explicit `export` always beats the
file. Nothing read here is ever printed, logged or written to the warehouse.
"""
from __future__ import annotations

import os
from pathlib import Path

DEFAULT_PATH = Path('.env')


def load_env(path=DEFAULT_PATH, environ=None):
    """Set KEY=VALUE pairs from `path` that are not already set. Returns the names loaded."""
    environ = os.environ if environ is None else environ
    path = Path(path)
    if not path.exists():
        return []
    loaded = []
    for line in path.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        name, _, value = line.partition('=')
        name, value = name.strip(), value.strip()
        if not name or name in environ:
            continue
        if len(value) >= 2 and value[0] == value[-1] and value[0] in '"\'':
            value = value[1:-1]
        environ[name] = value
        loaded.append(name)          # the name only: never the value
    return loaded
