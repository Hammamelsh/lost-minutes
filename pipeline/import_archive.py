"""Import the selected public archive sample. Kept as the documented entry point.

Delegates to pipeline.run, which records every input, run and publication in DuckDB.
"""
import sys

from .run import main

if __name__ == '__main__':
    sys.exit(main(['import']))
