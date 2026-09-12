"""Freshness policy and the measurements that justify it.

Thresholds are configurable and evidence-led, not guessed. Measured on the retained
archive sample (3,496 stored observations, 11 responses over roughly ten minutes):

  publication delay  an observation was already p50 30s / p95 40s old when the response
                     carrying it was built. Our own poll interval is added on top, so a
                     position on screen is never newer than about a minute.
  report interval    p50 60s / p95 73s between consecutive reports for one vehicle - but
                     that is bounded by our 45-75s sampling, not by the operator. The
                     fastest observed gap was 4s, and the published requirement is a
                     10-30s operator cadence, so true upstream intervals are shorter.
  stale payload      56 of 3,496 stored positions were already more than ten minutes old
                     when their response was built, 34 of them between one and 24 hours,
                     the worst 23.1 hours. The feed genuinely carries long-dead positions,
                     so an explicit expiry is required: without one, a vehicle that last
                     reported yesterday would be drawn as a bus on the map today.

`EXPIRY` is therefore a correctness control, not decoration.
"""
from __future__ import annotations

from .core import FUTURE_TOLERANCE_SECONDS

# Age of the observation itself, in seconds. Never the age of our request.
# Three bands are shown and one is withheld, and the last shown band ends exactly where the
# withheld band begins: a position is either drawn with an honest age or not drawn at all.
FRESH = 60          # within one publication delay plus one poll
AGEING = 150        # a missed cycle or two; still worth drawing, visibly older
EXPIRY = 900        # beyond this it is not drawn as a bus at all; counted and explained

# Age of our own published state, in seconds: how long since the collector wrote it.
PUBLICATION_STALE = 120

# Polling. Operators must supply locations every 10-30s (DfT Bus Open Data implementation
# guide), so a faster poll mostly returns a payload we already have. There is no published
# consumer rate limit; the 1 request/second limit applies to archive downloads.
POLL_DEFAULT = 20
POLL_MINIMUM = 10

LABELS = ('fresh', 'ageing', 'stale', 'expired')


def policy():
    """The thresholds, published so the interface uses our numbers rather than its own."""
    return {
        'observationFreshSeconds': FRESH,
        'observationAgeingSeconds': AGEING,
        'observationExpirySeconds': EXPIRY,
        'publicationStaleSeconds': PUBLICATION_STALE,
        'futureToleranceSeconds': FUTURE_TOLERANCE_SECONDS,
        'pollIntervalSeconds': POLL_DEFAULT,
        'basis': 'Measured publication delay p50 30s / p95 40s on the retained sample. '
                 'Expiry exists because that sample carried positions up to 23.1 hours old.',
    }


def label(age_seconds):
    """Classify one observation by its own age. Unknown age is never called fresh."""
    if age_seconds is None:
        return 'unknown'
    if age_seconds < 0:
        return 'ahead_of_clock'
    if age_seconds <= FRESH:
        return 'fresh'
    if age_seconds <= AGEING:
        return 'ageing'
    if age_seconds <= EXPIRY:
        return 'stale'
    return 'expired'


def _summary(con, expression, source, where='TRUE', window=None):
    row = con.execute(f"""
        SELECT count(*), quantile_cont({expression}, 0.5), quantile_cont({expression}, 0.95),
               min({expression}), max({expression})
        FROM {source} WHERE {where} AND {expression} IS NOT NULL
    """).fetchone()
    samples = int(row[0] or 0)
    rounded = lambda v: None if v is None else round(float(v), 1)
    return {'samples': samples, 'p50': rounded(row[1]), 'p95': rounded(row[2]),
            'min': rounded(row[3]), 'max': rounded(row[4]),
            'windowDescription': window or 'all retained history'}


KIND_LABELS = {
    'archive_positions': 'recorded archive sample (not live performance)',
    'live_positions': 'live collection',
}


def measure(con, kind='archive_positions'):
    """Measured ages and intervals for one source kind, each with its sample and window.

    Every measurement is scoped to `kind`. Archive numbers describe a recorded sample and
    must never be presented as live performance, so the label travels with the numbers.

    Two delays are kept apart because they have different owners:
      observationToRetrieval  how old a position already was when we received it. Theirs.
      ourCycle                request to stored, parsed, loaded and published. Ours.
    """
    window = con.execute(
        "SELECT min(captured_at AT TIME ZONE 'UTC'), max(captured_at AT TIME ZONE 'UTC'),"
        ' count(*) FROM raw_source WHERE source_kind = ?', [kind]).fetchone()
    empty = not window or not window[2]
    described = ('no sources of this kind yet' if empty else
                 f'{window[2]} responses, {window[0]:%Y-%m-%d %H:%M} to {window[1]:%H:%M} UTC')

    joined = 'observation o JOIN raw_source r ON r.source_sha256 = o.source_sha256'
    # How old a position already was when the upstream response carrying it was built.
    # Meaningful for both kinds: it is the source's own delay.
    observation_to_source = _summary(
        con, 'epoch(r.captured_at) - o.observed_at_ms / 1000.0', joined,
        f"r.source_kind = '{kind}'", described)
    # How old it was when *we* received it. For live collection these are near-identical.
    # For an archive replay this includes the days between the recording and our download,
    # so it is not a latency measurement and is labelled as such below.
    observation_to_retrieval = _summary(
        con, 'epoch(r.retrieved_at) - o.observed_at_ms / 1000.0', joined,
        f"r.source_kind = '{kind}'", described)

    # Scoped to this kind: without the join a live measurement would quietly include
    # archive observations and report the wrong cadence.
    report_interval = _summary(con, 'gap', f"""(
        SELECT (o.observed_at_ms - lag(o.observed_at_ms) OVER (
                    PARTITION BY o.operator, o.vehicle ORDER BY o.observed_at_ms)) / 1000.0 AS gap
        FROM v_publishable_observation o
        JOIN raw_source r ON r.source_sha256 = o.source_sha256
        WHERE r.source_kind = '{kind}')""", 'gap > 0', described)

    source_cadence = _summary(con, 'gap', f"""(
        SELECT epoch(captured_at - lag(captured_at) OVER (ORDER BY captured_at)) AS gap
        FROM raw_source WHERE source_kind = '{kind}')""", 'gap > 0', described)

    # Our own time, from collection cycles. Archive imports have no cycles, so this is
    # empty for the archive and that is the honest answer rather than a borrowed number.
    our_cycle = _summary(
        con, 'epoch(completed_at - requested_at)', 'collection_cycle',
        "outcome IN ('succeeded', 'repeat_payload')", described)

    caveat = ('Report intervals are bounded by the cadence of the responses we hold, so they '
              'describe our observation cadence, not the operator\'s publication rate. '
              'Operators are required to publish every 10-30 seconds.')
    if kind == 'archive_positions':
        caveat += (' These figures come from a recorded archive sample and are not a '
                   'measurement of live operation. observationToRetrieval measures the gap '
                   'to our download of the recording, not any feed latency; for an archive '
                   'the source delay is observationToSourcePublication.')

    return {
        'measuredFor': kind,
        'measurementLabel': KIND_LABELS.get(kind, kind),
        'isLiveMeasurement': kind == 'live_positions' and not empty,
        'observationToSourcePublicationSeconds': observation_to_source,
        'observationToRetrievalSeconds': observation_to_retrieval,
        'ourCycleSeconds': our_cycle,
        'reportIntervalSeconds': report_interval,
        'sourceCadenceSeconds': source_cadence,
        'caveat': caveat,
    }
