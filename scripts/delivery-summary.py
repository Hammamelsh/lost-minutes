"""The browser's share of a report's age (backlog 48): the delivery probe's receipts joined to the collector's log.

    python3 scripts/delivery-summary.py outputs/probes/delivery/<label>.json journal.txt

The probe (scripts/probes/delivery.mjs) records when the page received each live.json, on the server's clock, and
that file's publishedAtMs. The collector's timing line for the same publication (pipeline/collect.py) gives how long
after its stamp the file was written. So, for each publication the page received, the first receipt less the moment
it was written is the browser's polling and delivery delay. A publication written between two polls and replaced
before the next is never received at all; those are counted, not timed.
"""
from __future__ import annotations

import json
import sys

sys.path.insert(0, __file__.rsplit('/', 1)[0])
from importlib import import_module  # noqa: E402

timings = import_module('stage-timings')


def main(probe_path, journal_path):
    probe = json.load(open(probe_path))
    cycles = timings.read(open(journal_path))
    written = {c['publishedAtMs']: c['publishedAtMs'] + c['stampToWrittenMs'] for c in cycles
               if c.get('publishedAtMs') and c.get('stampToWrittenMs') is not None}
    first_receipt = {}
    for r in probe['responses']:
        first_receipt.setdefault(r['publishedAtMs'], r['at'])
    delays = [(at - written[p]) / 1000 for p, at in first_receipt.items() if p in written]
    span = [r['at'] for r in probe['responses']]
    inside = [p for p, w in written.items() if span and span[0] <= w <= span[-1]]
    missed = [p for p in inside if p not in first_receipt]
    result = {'probe': probe['summary'], 'publicationsReceived': len(first_receipt),
              'joinedToCollectorLog': len(delays), 'writtenWhileWatching': len(inside),
              'neverReceived': len(missed),
              'writtenToFirstReceiptS': timings.summary(delays)}
    print(json.dumps(result, indent=1))


if __name__ == '__main__':
    main(*sys.argv[1:3])
