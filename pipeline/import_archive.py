"""Import the explicitly selected small archive sample; cache every source locally."""
import hashlib
import json
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from .capture import fetch
from .core import atomic_json, observations, publish_replay, utc_now


def main():
    root = Path(__file__).resolve().parents[1]
    selection = json.loads((root / 'data/archive-selection.json').read_text())
    records, sources, rejected = [], [], Counter()
    for name in selection['files']:
        path = root / 'data/raw' / name
        if not path.exists():
            time.sleep(1.1)  # Archive publisher permits at most one request/second.
            body, _, _ = fetch(selection['base_url'] + name)
            path.write_bytes(body)
        body = path.read_bytes()
        digest = hashlib.sha256(body).hexdigest()
        retrieved = datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat()
        captured = datetime.strptime(name, 'sirivm-%Y%m%dT%H%M%S.zip').replace(tzinfo=timezone.utc).isoformat()
        rows, errors = observations(body, digest, retrieved)
        records.extend(rows)
        rejected.update(errors)
        sources.append({'url': selection['base_url'] + name, 'sha256': digest,
                        'bytes': len(body), 'capturedAt': captured, 'retrievedAt': retrieved})
        print(json.dumps({'file': name, 'areaObservations': len(rows), 'rejected': errors}), flush=True)
    output = publish_replay(records, sources, root / 'public/data/replay.json', dict(rejected))
    atomic_json(root / 'research/source-verification.json', {
        'checkedAt': utc_now(), 'sources': sources, 'quality': output['quality'],
        'distinctTracks': len(output['journeys']),
        'findings': ['Actual public archive responses inspected and parsed.',
                     'Only selected Manchester coordinates are published.',
                     'Source observations deduplicated by compound identity and observation time.',
                     'Conflicting positions with the same observation identity are suppressed.',
                     'Timetable identity and stop-time inference remain unvalidated.'],
    })
    print(json.dumps({'published': len(output['journeys']), 'quality': output['quality']}), flush=True)


if __name__ == '__main__':
    main()
