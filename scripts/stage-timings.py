"""Where a report's age goes between the operator and the published file (backlog 48), from the collector's own log.

    ssh <server> 'sudo journalctl -u lost-minutes-collector --since "…" --until "…" -o cat' | python3 scripts/stage-timings.py
    python3 scripts/stage-timings.py journal.txt [--json out.json]

Reads the one timing line a cycle the collector writes (pipeline/collect.py, from 2 October 2026) and prints, for each
stage, the sample size, median and 95th percentile:
  - each cycle's stages: fetching the feed, storing the payload, parsing it, the database work, the publication, and
    each part of the publication;
  - how old each new report already was when it reached the collector, split at the feed's own ResponseTimestamp
    (the operator and the feed before it answered, the network after);
  - how long each new report then waited for the file a phone reads to be written (our processing), and so its age
    when that file was in place.
The ages are pooled over reports, not averaged over cycles: a cycle's count per whole second (`arrivalAges`) moves by
that cycle's own delays. A run's first cycle carries no ages (pipeline/collect.py, arrival_ages), and reports past the
expiry (900 s) are counted apart: they are never published.
"""
from __future__ import annotations

import argparse
import json
import sys


def quantile(sorted_values, p):
    if not sorted_values:
        return None
    k = (len(sorted_values) - 1) * p
    f = int(k)
    c = min(f + 1, len(sorted_values) - 1)
    return sorted_values[f] + (sorted_values[c] - sorted_values[f]) * (k - f)


def summary(values):
    values = sorted(values)
    return {'n': len(values), 'p50': quantile(values, 0.5), 'p95': quantile(values, 0.95),
            'max': values[-1] if values else None}


def weighted(pairs):
    """Median and 95th percentile of (value, count) pairs, each count a number of reports."""
    pairs = sorted(pairs)
    total = sum(c for _, c in pairs)
    out = {'n': total}
    for name, p in (('p50', 0.5), ('p95', 0.95)):
        target, seen = p * (total - 1), 0
        out[name] = None
        for value, count in pairs:
            if seen + count > target:
                out[name] = value
                break
            seen += count
    return out


def read(lines):
    cycles = []
    for line in lines:
        start = line.find('{')
        if start < 0:
            continue
        try:
            record = json.loads(line[start:])
        except ValueError:
            continue
        if isinstance(record, dict) and 'ms' in record and 'cycle' in record:
            cycles.append(record)
    return cycles


def analyse(cycles):
    stages, publication = {}, {}
    for c in cycles:
        for k, v in c['ms'].items():
            stages.setdefault(k, []).append(v)
        for k, v in (c.get('publication') or {}).items():
            publication.setdefault(k, []).append(v)
        stages.setdefault('cycle (sum of stages)', []).append(sum(c['ms'].values()))
    feed = [c['receivedAtMs'] - c['responseAtMs'] for c in cycles if c.get('responseAtMs') and c.get('receivedAtMs')]
    built = [c['responseAtMs'] - c['requestedAtMs'] for c in cycles if c.get('responseAtMs') and c.get('requestedAtMs')]
    stamp = [c['stampToWrittenMs'] for c in cycles if c.get('stampToWrittenMs') is not None]
    written_after_receipt = [c['publishedAtMs'] + c['stampToWrittenMs'] - c['receivedAtMs'] for c in cycles
                             if c.get('stampToWrittenMs') is not None and c.get('receivedAtMs')]
    # Report ages, pooled: at receipt; at the feed's answer; and once the file a phone reads was written.
    at_receipt, at_response, at_written, expired = [], [], [], 0
    for c in cycles:
        ages = c.get('arrivalAges')
        if not ages:
            continue
        lag = (c['receivedAtMs'] - c['responseAtMs']) / 1000 if c.get('responseAtMs') else None
        wait = ((c['publishedAtMs'] + c['stampToWrittenMs'] - c['receivedAtMs']) / 1000
                if c.get('stampToWrittenMs') is not None else None)
        for key, count in ages.items():
            if key.startswith('>'):
                expired += count
                continue
            # The whole second counted, read at its middle.
            age = int(key) + 0.5
            at_receipt.append((age, count))
            if lag is not None:
                at_response.append((age - lag, count))
            if wait is not None:
                at_written.append((age + wait, count))
    ms = lambda d: {k: summary(v) for k, v in sorted(d.items(), key=lambda kv: -sorted(kv[1])[len(kv[1]) // 2])}
    first = cycles[0]['receivedAtMs'] if cycles and cycles[0].get('receivedAtMs') else None
    last = cycles[-1]['receivedAtMs'] if cycles and cycles[-1].get('receivedAtMs') else None
    return {
        'cycles': len(cycles), 'firstReceivedAtMs': first, 'lastReceivedAtMs': last,
        'stageMs': ms(stages), 'publicationMs': ms(publication),
        'feedBuiltAfterRequestMs': summary(built), 'feedAnswerToReceiptMs': summary(feed),
        'stampToWrittenMs': summary(stamp), 'receiptToWrittenMs': summary(written_after_receipt),
        'reportAgeSeconds': {'atFeedAnswer': weighted(at_response), 'atReceipt': weighted(at_receipt),
                             'whenFileWritten': weighted(at_written), 'pastExpiryNotCounted': expired},
    }


def show(result):
    from datetime import datetime, timezone
    when = lambda ms: datetime.fromtimestamp(ms / 1000, timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC') if ms else '?'
    print(f"{result['cycles']} cycles, {when(result['firstReceivedAtMs'])} to {when(result['lastReceivedAtMs'])}")
    row = lambda name, s, unit='ms': print(f"  {name:<34} n={s['n']:<7} median={s['p50']:>9.1f} {unit}  p95={s['p95']:>9.1f} {unit}"
                                           if s['n'] else f'  {name:<34} n=0')
    print('cycle stages')
    for k, s in result['stageMs'].items():
        row(k, s)
    print('publication stages')
    for k, s in result['publicationMs'].items():
        row(k, s)
    print('the feed and our file')
    row('request to feed answer', result['feedBuiltAfterRequestMs'])
    row('feed answer to receipt', result['feedAnswerToReceiptMs'])
    row('receipt to file written', result['receiptToWrittenMs'])
    row('publication stamp to file written', result['stampToWrittenMs'])
    print('new reports: age, pooled over reports')
    ages = result['reportAgeSeconds']
    for k in ('atFeedAnswer', 'atReceipt', 'whenFileWritten'):
        s = ages[k]
        print(f"  {k:<34} n={s['n']:<7} median={s['p50'] if s['p50'] is None else round(s['p50'], 1)} s  "
              f"p95={s['p95'] if s['p95'] is None else round(s['p95'], 1)} s")
    print(f"  past the expiry, not counted above: {ages['pastExpiryNotCounted']}")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('journal', nargs='?', help='a saved journal; standard input if not given')
    parser.add_argument('--json', help='also write the result here')
    args = parser.parse_args(argv)
    lines = open(args.journal) if args.journal else sys.stdin
    result = analyse(read(lines))
    show(result)
    if args.json:
        with open(args.json, 'w') as handle:
            json.dump(result, handle, indent=1)


if __name__ == '__main__':
    main()
