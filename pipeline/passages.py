"""Inferred stop passages: when a bus's reports say it went past a stop, and how surely.

A report within 40 m of a stop is not an arrival. It is one position, 20 s or so from the next,
with GPS noise of its own; a bus can report 30 m short of a stop and 30 m past it and never be
seen at it, and a bus standing at lights near a stop can report there three times without
calling. What the reports can support is a *passage*: the bus's along-road position, projected
onto the accepted shape, was before the stop's offset at one report and past it at the next.
The passage time is interpolated between those two reports, and the gap between them is the
uncertainty: the passage happened somewhere inside it.

Rules, each here for a reason:
  - Only the accepted shape is used to project. A pattern with no accepted shape has no
    passages; stop-to-stop straight lines are never used instead.
  - A report further than OFF_ROAD metres from the shape does not count. It cannot be placed.
  - The two reports bracketing a passage must be at most MAX_GAP seconds apart. Wider, the
    passage is recorded as 'unbounded' and never scored.
  - Progress must be monotonic across the bracket: the bus may not have gone backwards along
    the road between the two reports (a GPS jump), or the crossing is not believed.
  - A repeated visit (progress crosses the same stop again later) is kept as a separate passage
    with 'visit' 2, 3, ...; a scorer decides what to do with it. On route 15 there are no loops,
    so a second visit is a jump artefact, and the scorer skips them.
  - The half-gap is the stated uncertainty. It is not GPS accuracy, which is not in the feed.

This is the ground truth the arrival estimator is scored against, and it is only as good as
this inference, which is why every passage carries its own uncertainty and its own evidence.
"""
from __future__ import annotations

import json
import math
from collections import defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SHAPES = ROOT / 'public/data/shapes'

MAX_GAP_S = 60          # a passage bracketed wider than this is recorded but never scored
OFF_ROAD_M = 40         # a report further from the shape than this is not placed
MIN_REPORTS = 6         # a journey with fewer reports is not worth inferring from


@dataclass
class Passage:
    pattern_id: str
    journey_key: str        # "vehicle|aimed_departure"
    stop_id: str
    stop_index: int
    stop_offset_m: float
    passed_at_ms: int       # interpolated
    before_ms: int
    after_ms: int
    gap_s: float
    uncertainty_s: float    # half the gap
    visit: int
    scoreable: bool
    before_offset_m: float
    after_offset_m: float


# ------------------------------------------------------------------ geometry

def decode_polyline(text: str, precision: int = 6):
    points, index, lat, lon = [], 0, 0, 0
    factor = 10 ** precision
    while index < len(text):
        for which in (0, 1):
            result = shift = 0
            while True:
                byte = ord(text[index]) - 63
                index += 1
                result |= (byte & 0x1f) << shift
                shift += 5
                if byte < 0x20:
                    break
            delta = ~(result >> 1) if result & 1 else result >> 1
            if which == 0:
                lat += delta
            else:
                lon += delta
        points.append((lat / factor, lon / factor))
    return points


def metres(a, b):
    return math.hypot((a[0] - b[0]) * 111320, (a[1] - b[1]) * 111320 * math.cos(math.radians(a[0])))


class Track:
    def __init__(self, points, stop_offsets):
        self.points = points
        self.cum = [0.0]
        for i in range(1, len(points)):
            self.cum.append(self.cum[-1] + metres(points[i - 1], points[i]))
        self.length = self.cum[-1]
        self.stop_offsets = stop_offsets

    def project(self, p, near=None):
        """(offset along the track in metres, distance off the track in metres)."""
        best = (0.0, float('inf'))
        lo, hi = 0, len(self.points) - 1
        if near is not None:
            lo = max(0, self._segment_at(near - 600))
            hi = min(len(self.points) - 1, self._segment_at(near + 3000) + 1)
        for i in range(max(1, lo), hi + 1):
            a, b = self.points[i - 1], self.points[i]
            cosl = math.cos(math.radians(a[0]))
            ax, ay = 0.0, 0.0
            bx, by = (b[1] - a[1]) * 111320 * cosl, (b[0] - a[0]) * 111320
            px, py = (p[1] - a[1]) * 111320 * cosl, (p[0] - a[0]) * 111320
            seg = bx * bx + by * by
            t = 0.0 if seg == 0 else max(0.0, min(1.0, (px * bx + py * by) / seg))
            d = math.hypot(px - t * bx, py - t * by)
            if d < best[1]:
                best = (self.cum[i - 1] + t * (self.cum[i] - self.cum[i - 1]), d)
        if near is not None and best[1] > 25:
            return self.project(p)      # the window missed: search the whole track
        return best

    def _segment_at(self, s):
        lo, hi = 0, len(self.cum) - 1
        while lo < hi - 1:
            mid = (lo + hi) >> 1
            if self.cum[mid] <= s:
                lo = mid
            else:
                hi = mid
        return lo


def load_track(pattern_id: str) -> Track | None:
    index = json.loads((SHAPES / 'index.json').read_text())
    entry = index['patterns'].get(pattern_id)
    if not entry or entry.get('status') != 'accepted' or not entry.get('file'):
        return None
    shape = json.loads((SHAPES / entry['file']).read_text())
    return Track(decode_polyline(shape['polyline6'], 6), shape.get('stopOffsets') or [])


# ------------------------------------------------------------------ inference

def infer_passages(pattern_id: str, stops: list[str], reports_by_journey: dict[str, list[tuple[int, float, float]]],
                   track: Track | None = None) -> tuple[list[Passage], dict]:
    """reports_by_journey: journey_key -> [(observed_at_ms, lat, lon)], any order.
    Returns the passages and a summary of what was and was not usable."""
    track = track or load_track(pattern_id)
    summary = {'journeys': len(reports_by_journey), 'journeysUsed': 0, 'reportsPlaced': 0,
               'reportsOffRoad': 0, 'journeysTooFewReports': 0, 'passages': 0, 'scoreable': 0,
               'unbounded': 0, 'repeatVisits': 0, 'backwardsSkipped': 0}
    if track is None:
        summary['reason'] = 'no accepted shape'
        return [], summary
    offsets = track.stop_offsets
    passages: list[Passage] = []
    for key, reports in reports_by_journey.items():
        reports = sorted(reports)
        if len(reports) < MIN_REPORTS:
            summary['journeysTooFewReports'] += 1
            continue
        placed, near = [], None
        for t, lat, lon in reports:
            s, off = track.project((lat, lon), near)
            if off > OFF_ROAD_M:
                summary['reportsOffRoad'] += 1
                continue
            placed.append((t, s))
            near = s
        if len(placed) < MIN_REPORTS:
            summary['journeysTooFewReports'] += 1
            continue
        summary['journeysUsed'] += 1
        summary['reportsPlaced'] += len(placed)
        visits: dict[int, int] = defaultdict(int)
        for i in range(1, len(placed)):
            (t0, s0), (t1, s1) = placed[i - 1], placed[i]
            if s1 < s0 - 5:
                summary['backwardsSkipped'] += 1
                continue            # went backwards along the road: a jump, not a passage
            for j, so in enumerate(offsets):
                if so is None or j >= len(stops):
                    continue
                if s0 < so <= s1:
                    gap = (t1 - t0) / 1000
                    frac = 0.0 if s1 == s0 else (so - s0) / (s1 - s0)
                    visits[j] += 1
                    scoreable = gap <= MAX_GAP_S and visits[j] == 1
                    passages.append(Passage(pattern_id, key, stops[j], j, so, int(t0 + frac * (t1 - t0)),
                                            t0, t1, gap, gap / 2, visits[j], scoreable, s0, s1))
                    summary['passages'] += 1
                    if visits[j] > 1:
                        summary['repeatVisits'] += 1
                    if gap > MAX_GAP_S:
                        summary['unbounded'] += 1
                    if scoreable:
                        summary['scoreable'] += 1
    return passages, summary


def passages_to_json(passages: list[Passage]):
    return [asdict(p) for p in passages]
