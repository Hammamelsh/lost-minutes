"""The arrival estimate judged as a page would show it: the display protocol (docs/ARRIVAL_DISPLAY_PROTOCOL.md).

The release criteria (docs/ARRIVAL_RELEASE_CRITERIA.md) were first read by the *actual* minutes before a bus
passed a stop, which only hindsight knows. A page chooses what to show by its own *predicted* minutes, at the
moment it shows them, from the report it holds then. On 28 September 2026 that difference turned a pass into a
fail for outbound 15 (median 1.20 against 1.57). This module scores exactly the moments a page would show:

  - A report is held by a page from the first live publication after the report's retrieval, plus the
    page's mean wait for its next poll (it polls every 20 s: POLL_WAIT_S), until the page holds the journey's
    next report, or until the report is STALE_S old, whichever is first.
  - While held, the page's clock ticks every SAMPLE_S; at each tick the estimate made from that report (the
    frozen blended estimator, scripts/evaluate-arrival.py) is shown if its minutes from that tick lie in
    BAND, the live match places the report on this one pattern, the report's nearest stop is before the
    passenger's, and the report lies on the road before the stop (lib/arrival.ts, components/follow-view.tsx).
  - Each shown tick is a display moment: its error is the inferred passage less the estimated instant, in
    minutes, positive when the bus came later than estimated.

A page's history of the journey is taken to be complete (it has been open for the last three minutes); that is
the condition under which it shows minutes at all. Errors are kept per journey as histograms of BIN minutes, so
a day is scored once and pooled later, and journeys can be resampled for confidence intervals.
"""
from __future__ import annotations

import bisect
import math
import random
from collections import defaultdict

PROTOCOL = 'display-1'
SAMPLE_S = 5            # the page's clock (app/page.tsx: setNowMs every 5 s)
POLL_WAIT_S = 10        # the page polls live.json every 20 s (config pollSeconds): it holds a publication 10 s on average after it appears
STALE_S = 150           # lib/arrival.ts ARRIVAL_DISPLAY.staleS
BAND = (2.0, 10.0)      # lib/arrival.ts: minutes are shown from 2 to 10, measured from the moment shown
BIN = 0.05              # minutes (3 s): well inside the passages' own ±10 s
ELIGIBLE_ACTUAL = (2.0, 10.0)   # coverage: moments when the bus is in fact 2-10 min from the stop and the card is up
BOOTSTRAP = 1000
BOOTSTRAP_SEED = 20260929

# Frozen 28 September 2026 (docs/ARRIVAL_DISPLAY_PROTOCOL.md), before any confirmation day was scored.
CONFIRMATION_FROM = '2026-09-29'
CONFIRMATION_DAYS = 7
# The only range a page may show: the estimate plus the direction's 10th to 90th percentile of signed error on the
# revision days (21-26 September), each end rounded outwards; it claims the bus comes within it at 80% of moments.
INTERVAL_NOMINAL = 0.80
FROZEN_INTERVALS = {('BNML', '15', 'outbound'): (-1.15, 5.75), ('BNML', '15', 'inbound'): (-1.65, 4.20)}
THRESHOLDS = {'medianAbs': 1.5, 'p80Abs': 3.0, 'betterThanTimetable': 0.5, 'coverage': 0.5, 'minJourneys': 20,
              'minPassages': 150, 'minWeekdays': 1, 'intervalCoverage': INTERVAL_NOMINAL}


def bin_of(minutes):
    return int(round(minutes / BIN))


# ------------------------------------------------------------------ scoring one day

def first_hold(retrieved_ms, publications):
    """When a page first holds a report retrieved at `retrieved_ms`: the first live publication at or after it,
    plus the mean wait for the page's poll. None if no publication followed."""
    k = bisect.bisect_left(publications, retrieved_ms)
    return None if k == len(publications) else publications[k] + POLL_WAIT_S * 1000


def score_journey(ev, pattern, track, dep_info, key, reports, passages, params, cruise, publications):
    """Display moments of one journey. `reports`: [(observed_ms, lat, lon, retrieved_ms, match)] in time order,
    `match` the live matcher's verdict for that report. `passages`: this journey's scoreable first visits.
    Returns the journey's accumulators (see `empty_journey`)."""
    acc = empty_journey(key, pattern['id'])
    # Place every report as the evaluator does (each searched near the last one placed); keep which are placed.
    placed, placed_at, near = [], [], None
    for t, lat, lon, _, _ in reports:
        s, off = track.project((lat, lon), near)
        if off > 40:
            placed_at.append(None)
            continue
        placed_at.append(len(placed))
        placed.append((t, s))
        near = s
    if len(placed) < 6:
        return acc
    holds = [first_hold(r[3], publications) if r[3] is not None else None for r in reports]
    sched = ev.scheduled_for(pattern, dep_info, key)
    timing_any = (sched[0] if sched else None) or pattern.get('seconds')
    if not timing_any:
        return acc
    for target in passages:
        j, offset, t_arr = target['stop_index'], target['stop_offset_m'], target['passed_at_ms']
        # The timetable's own time at the stop, where the journey is named (the comparator of the criteria).
        err_s = None
        if sched:
            timing, dep_ms = sched
            sec = timing[j] if j < len(timing) else None
            if sec is not None:
                err_s = (t_arr - (dep_ms + sec * 1000)) / 60000
        for i, (t_obs, _, _, _, match) in enumerate(reports):
            if t_obs >= t_arr:
                break
            start = holds[i]
            if start is None or (t_arr - t_obs) > 20 * 60000:
                continue
            nxt = next((holds[k] for k in range(i + 1, len(holds)) if holds[k] is not None), None)
            end = min(nxt if nxt is not None else math.inf, t_obs + STALE_S * 1000)
            if end <= start:
                continue                                   # superseded before a page held it, or too old already
            k = placed_at[i]
            if k is None or placed[k][1] >= offset:
                continue                                   # off the road, or at or past the stop: no minutes, and no bus coming
            # The card carries minutes only for a bus the live match puts on this one pattern, its nearest stop
            # before the passenger's. Coverage counts every moment the bus is truly 2-10 min away with a fresh
            # report on the road, matched or not: an unsettled branch is a passenger left without minutes.
            card_up = (match is not None and match.get('matched') and match.get('patternId') == pattern['id']
                       and isinstance(match.get('patternIndex'), int) and match['patternIndex'] < j)
            eta = ev.blended_eta(placed, k, offset, j, track.stop_offsets, params, cruise, track, timing_any) if card_up else None
            t = start
            while t < end:
                actual = (t_arr - t) / 60000
                shown = eta is not None and BAND[0] <= (eta - t) / 60000 <= BAND[1]
                if ELIGIBLE_ACTUAL[0] <= actual <= ELIGIBLE_ACTUAL[1]:
                    acc['eligible'] += 1
                    acc['eligibleShown'] += shown
                if shown:
                    err = (t_arr - eta) / 60000
                    b = bin_of(err)
                    acc['signed'][b] += 1
                    acc['passages'].add(target['stop_id'])
                    if err_s is not None:
                        acc['pairedCandidate'][abs(b)] += 1
                        acc['pairedTimetable'][abs(bin_of(err_s))] += 1
                t += SAMPLE_S * 1000
    return acc


def empty_journey(key, pattern_id):
    return {'journey': key, 'pattern': pattern_id, 'signed': defaultdict(int), 'pairedCandidate': defaultdict(int),
            'pairedTimetable': defaultdict(int), 'eligible': 0, 'eligibleShown': 0, 'passages': set()}


def to_json(acc):
    """A journey's accumulators as stored: histograms as [bin, count] pairs."""
    pairs = lambda h: sorted([int(b), int(c)] for b, c in h.items())
    return {'journey': acc['journey'], 'pattern': acc['pattern'], 'signed': pairs(acc['signed']),
            'pairedCandidate': pairs(acc['pairedCandidate']), 'pairedTimetable': pairs(acc['pairedTimetable']),
            'eligible': acc['eligible'], 'eligibleShown': acc['eligibleShown'], 'passages': len(acc['passages'])}


# ------------------------------------------------------------------ pooling, by journey

def _abs_counts(signed_pairs):
    out = defaultdict(int)
    for b, c in signed_pairs:
        out[abs(b)] += c
    return out


def quantile(counts, q):
    """The q-quantile of a histogram {bin: count}, in minutes (the bin's value); None if empty."""
    total = sum(counts.values())
    if not total:
        return None
    need, seen = q * total, 0
    for b in sorted(counts):
        seen += counts[b]
        if seen >= need:
            return b * BIN
    return max(counts) * BIN


def summarise(journeys, interval=None):
    """Pooled and per-journey results over stored journey records (one direction). `interval`: (q_lo, q_hi) in
    minutes of signed error, the frozen interval whose coverage is measured."""
    signed, abs_all, cand, tt = defaultdict(int), defaultdict(int), defaultdict(int), defaultdict(int)
    eligible = eligible_shown = passages = 0
    per_journey, used = [], []
    for jr in journeys:
        n = sum(c for _, c in jr['signed'])
        eligible += jr['eligible']
        eligible_shown += jr['eligibleShown']
        if not n:
            continue
        used.append(jr)
        passages += jr['passages']
        for b, c in jr['signed']:
            signed[b] += c
        for b, c in jr['pairedCandidate']:
            cand[b] += c
        for b, c in jr['pairedTimetable']:
            tt[b] += c
        a = _abs_counts(jr['signed'])
        per_journey.append({'journey': jr['journey'], 'moments': n, 'medianAbs': quantile(a, 0.5), 'p80Abs': quantile(a, 0.8)})
    for b, c in signed.items():
        abs_all[abs(b)] += c
    n = sum(signed.values())
    late = sum(c for b, c in signed.items() if b > 0)
    covered = None
    if interval and n:
        lo, hi = interval
        covered = sum(c for b, c in signed.items() if lo - 1e-9 <= b * BIN <= hi + 1e-9) / n
    medians = sorted(j['medianAbs'] for j in per_journey)
    result = {
        'moments': n, 'journeys': len(per_journey), 'passages': passages,
        'medianAbs': quantile(abs_all, 0.5), 'p80Abs': quantile(abs_all, 0.8),
        'signedMedian': quantile(signed, 0.5), 'signedP10': quantile(signed, 0.1), 'signedP90': quantile(signed, 0.9),
        'shareLater': (late / n) if n else None,
        'pairedMoments': sum(cand.values()), 'medianAbsWherePaired': quantile(cand, 0.5), 'timetableMedianAbsWherePaired': quantile(tt, 0.5),
        'coverage': (eligible_shown / eligible) if eligible else None, 'eligibleMoments': eligible,
        'intervalCoverage': covered, 'interval': list(interval) if interval else None,
        'byJourney': {'medianOfMedians': medians[len(medians) // 2] if medians else None,
                      'shareWithMedianWithin1_5': (sum(m <= 1.5 for m in medians) / len(medians)) if medians else None,
                      'p20': medians[int(0.2 * (len(medians) - 1))] if medians else None,
                      'p80': medians[int(0.8 * (len(medians) - 1))] if medians else None},
    }
    result['bootstrap'] = bootstrap(used, interval) if len(used) >= 2 else None
    return result


def bootstrap(journeys, interval=None, resamples=BOOTSTRAP, seed=BOOTSTRAP_SEED):
    """95% intervals of the pooled median and 80th percentile of absolute error (and of the interval's
    coverage), resampling whole journeys with replacement: the journey is the independent unit."""
    rng = random.Random(seed)
    grids = []
    for jr in journeys:
        a = _abs_counts(jr['signed'])
        inside = 0
        if interval:
            lo, hi = interval
            inside = sum(c for b, c in jr['signed'] if lo - 1e-9 <= b * BIN <= hi + 1e-9)
        grids.append((sorted(a.items()), sum(a.values()), inside))
    top = max((b for g in grids for b, _ in g[0]), default=0)

    def cumulative(pairs):
        out, running, k = [0] * (top + 1), 0, 0
        for b in range(top + 1):
            while k < len(pairs) and pairs[k][0] == b:
                running += pairs[k][1]
                k += 1
            out[b] = running
        return out
    cums = [cumulative(g[0]) for g in grids]
    totals = [g[1] for g in grids]
    medians, p80s, coverages = [], [], []
    J = len(journeys)
    for _ in range(resamples):
        weights = defaultdict(int)
        for _ in range(J):
            weights[rng.randrange(J)] += 1
        n = sum(totals[j] * w for j, w in weights.items())

        def q(frac):
            lo, hi = 0, top
            while lo < hi:
                mid = (lo + hi) // 2
                if sum(cums[j][mid] * w for j, w in weights.items()) >= frac * n:
                    hi = mid
                else:
                    lo = mid + 1
            return lo * BIN
        medians.append(q(0.5))
        p80s.append(q(0.8))
        if interval:
            coverages.append(sum(grids[j][2] * w for j, w in weights.items()) / n)
    ci = lambda xs: [sorted(xs)[int(0.025 * len(xs))], sorted(xs)[int(0.975 * len(xs)) - 1]] if xs else None
    return {'resamples': resamples, 'medianAbs95': ci(medians), 'p80Abs95': ci(p80s), 'intervalCoverage95': ci(coverages)}
