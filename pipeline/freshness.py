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
FRESH = 60          # within one publication delay plus one poll
AGEING = 150        # a missed cycle or two; still worth drawing, visibly older
STALE = 600         # beyond any plausible reporting gap for a running bus
EXPIRY = 900        # not drawn as a bus at all; counted and explained instead

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
        'observationStaleSeconds': STALE,
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
    if age_seconds <= STALE:
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


def measure(con, kind='archive_positions'):
    """Measured intervals and ages, always reported with their sample size and window."""
    window = con.execute(
        "SELECT min(captured_at AT TIME ZONE 'UTC'), max(captured_at AT TIME ZONE 'UTC'),"
        ' count(*) FROM raw_source WHERE source_kind = ?', [kind]).fetchone()
    described = ('no sources of this kind' if not window or window[2] == 0 else
                 f'{window[2]} responses, {window[0]:%Y-%m-%d %H:%M} to {window[1]:%H:%M} UTC')

    publication_delay = _summary(
        con, 'epoch(r.captured_at) - o.observed_at_ms / 1000.0',
        'observation o JOIN raw_source r ON r.source_sha256 = o.source_sha256',
        f"r.source_kind = '{kind}'", described)

    report_interval = _summary(con, 'gap', f"""(
        SELECT (observed_at_ms - lag(observed_at_ms) OVER (
                    PARTITION BY operator, vehicle ORDER BY observed_at_ms)) / 1000.0 AS gap
        FROM v_publishable_observation)""", 'gap > 0', described)

    # Cadence between the responses themselves. For live collection this is our poll
    # interval; for the archive selection it is the spacing we chose between snapshots.
    source_cadence = _summary(con, 'gap', f"""(
        SELECT epoch(captured_at - lag(captured_at) OVER (ORDER BY captured_at)) AS gap
        FROM raw_source WHERE source_kind = '{kind}')""", 'gap > 0', described)

    return {
        'publicationDelaySeconds': publication_delay,
        'reportIntervalSeconds': report_interval,
        'sourceCadenceSeconds': source_cadence,
        'caveat': 'Report intervals are bounded by the cadence of the responses we hold, so '
                  'they describe our observation cadence, not the operator\'s publication '
                  'rate. Operators are required to publish every 10-30 seconds.',
    }
