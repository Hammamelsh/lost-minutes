"""The arrival estimator, fitted on early days and scored once on held-out later days.

Reads the inferred passages (scripts/audit-passages.py) as ground truth, each with its own
uncertainty, and the raw reports. At every report before a scored passage, it asks what each
method would have said *then*, using only reports at or before that moment, the timetable, and
the accepted shape. Nothing from the drawn bus, its eased speed, or anything animated.

Three methods on the same moments:
  progress   remaining road at the observed recent speed, plus a dwell per timetabled stop
             between here and the passenger's stop (the candidate);
  scheduled  the named journey's departure plus the timetable's seconds to the stop;
  adjusted   the scheduled time shifted by the bus's observed delay at its latest inferred
             passage behind it (known only once the report after that passage has arrived).

Fitting chooses the progress method's dwell and speed window on the fit days by median absolute
error at 2-10 min horizons. The test days are then scored exactly once, and the release
criteria (docs/ARRIVAL_RELEASE_CRITERIA.md), fixed before this ran, are checked against them.

    .venv/bin/python scripts/evaluate-arrival.py [--fit-until 2026-09-14] [--line 15]
"""
import argparse
import json
import statistics
import sys
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from pipeline.passages import load_track  # noqa: E402
from pipeline.patterns import _departure_info  # noqa: E402
from pipeline.warehouse import DEFAULT_DB, connect  # noqa: E402

LONDON = ZoneInfo('Europe/London')
HORIZONS = [(1, 2), (2, 5), (5, 10), (10, 20)]        # minutes before the inferred passage
RELEASE_BAND = (2, 10)                                 # the band the criteria are judged in
MIN_LEAD_S = 60                                        # a moment less than a minute before is not a prediction
MAX_SPEED = 20.0                                       # m/s; faster is a jump
JUMP_SPEED = MAX_SPEED * 1.5
STALE_S = 150                                          # a report older than this at the moment: no estimate


def pct(values, q):
    if not values:
        return None
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(q * len(ordered)))]


def local_wall(ms):
    return datetime.fromtimestamp(ms / 1000, LONDON)


def wall_to_ms(day, hms):
    h, m, s = (int(x) for x in hms.split(':'))
    base = datetime(day.year, day.month, day.day, tzinfo=LONDON)
    return int((base + timedelta(hours=h, minutes=m, seconds=s)).timestamp() * 1000)


# ------------------------------------------------------------------ the candidate

def observed_speed(placed, at_index, window_s):
    """Along-road speed from the reports within `window_s` before placed[at_index], reading
    only from after the latest jump. None when there is not enough to read a speed from."""
    t_now, s_now = placed[at_index]
    start = at_index
    while start > 0 and t_now - placed[start - 1][0] <= window_s * 1000:
        # a step faster than a bus, or backwards, is a jump: read only from after it
        dt = (placed[start][0] - placed[start - 1][0]) / 1000
        ds = placed[start][1] - placed[start - 1][1]
        if dt <= 0 or ds < -25 or ds / dt > JUMP_SPEED:
            break
        start -= 1
    if start == at_index:
        return None
    t0, s0 = placed[start]
    span = (t_now - t0) / 1000
    if span < 20:
        return None
    return max(0.0, min(MAX_SPEED, (s_now - s0) / span))


def progress_eta(placed, at_index, stop_offset, stop_offsets, params, cruise):
    """ETA in ms, or None with the reason it is withheld."""
    t_now, s_now = placed[at_index]
    if s_now >= stop_offset:
        return None, 'at or past the stop'
    v = observed_speed(placed, at_index, params['window_s'])
    if v is None:
        return None, 'no speed could be read'
    # Standing (at a stop or lights): the bus will move on at its usual pace, not at zero.
    if v < params['standing_below']:
        v = cruise
    remaining = stop_offset - s_now
    between = sum(1 for so in stop_offsets if so is not None and s_now < so < stop_offset)
    seconds = remaining / max(v, 0.5) + between * params['dwell_s']
    return int(t_now + seconds * 1000), None


# ------------------------------------------------------------------ data

def load_everything(line, operator):
    passages_file = ROOT / f'data/evaluation/passages-{line}.json'
    passages = json.loads(passages_file.read_text())['passages']
    catalogue = json.loads((ROOT / 'public/data/patterns.json').read_text())
    patterns = {p['id']: p for p in catalogue['patterns'] if p['operator'] == operator and p['line'] == line}
    con = connect(ROOT / DEFAULT_DB)
    dep_info = {row[0]: _departure_info(row[1]) for row in
                con.execute("SELECT pattern_id, departure_times FROM service_pattern WHERE line_name = ? AND operator_code = ?",
                            [line, operator]).fetchall()}
    rows = con.execute("""
        SELECT direction, vehicle, aimed_departure, observed_at_ms, lat, lon
        FROM v_publishable_observation
        WHERE operator = ? AND route = ? AND aimed_departure IS NOT NULL AND aimed_departure <> ''
        ORDER BY observed_at_ms""", [operator, line]).fetchall()
    reports = defaultdict(list)
    for direction, vehicle, aimed, t, lat, lon in rows:
        reports[(direction, f'{vehicle}|{aimed}')].append((int(t), lat, lon))
    return passages, patterns, dep_info, reports


def place_reports(track, reports):
    placed, near = [], None
    for t, lat, lon in sorted(reports):
        s, off = track.project((lat, lon), near)
        if off > 40:
            continue
        placed.append((t, s))
        near = s
    return placed


def scheduled_for(pattern, dep_info, journey_key):
    """(seconds-per-stop tuple, departure ms) for the journey, or None when it cannot be named
    or the journeys at that departure differ in timing."""
    aimed = journey_key.split('|', 1)[1]
    when = datetime.fromisoformat(aimed.replace('Z', '+00:00')).astimezone(LONDON)
    local = when.strftime('%H:%M:%S')
    info = dep_info.get(pattern['id']) or {'timings': [], 'departures': []}
    hits = [i for t, i in info['departures'] if t == local]
    if not hits or len(set(hits)) != 1:
        return None
    timing = info['timings'][hits[0]] if info['timings'] else pattern.get('seconds')
    if not timing:
        return None
    return timing, wall_to_ms(when.date(), local)


# ------------------------------------------------------------------ scoring

def score(passages, patterns, dep_info, reports, params, days, cruise_by_pattern):
    """Every scoring moment on the given days: for each scoreable passage, each report at least
    MIN_LEAD_S before it with the bus still before the stop. Returns rows of
    (pattern, journey, stop, horizon_min, err_progress, err_scheduled, err_adjusted, reason)."""
    rows = []
    tracks = {}
    by_journey = defaultdict(list)
    for p in passages:
        if p['scoreable']:
            by_journey[(p['pattern_id'], p['journey_key'])].append(p)
    for (pid, key), plist in by_journey.items():
        pattern = patterns.get(pid)
        if not pattern:
            continue
        day = local_wall(plist[0]['passed_at_ms']).date()
        if day not in days:
            continue
        if pid not in tracks:
            tracks[pid] = load_track(pid)
        track = tracks[pid]
        if track is None:
            continue
        placed = place_reports(track, reports.get((pattern['direction'], key), []))
        if len(placed) < 6:
            continue
        sched = scheduled_for(pattern, dep_info, key)
        # passages behind, in order, for the delay-adjusted comparator
        behind = sorted(plist, key=lambda p: p['stop_index'])
        for target in plist:
            t_arr = target['passed_at_ms']
            for i, (t_now, s_now) in enumerate(placed):
                lead = (t_arr - t_now) / 1000
                if lead < MIN_LEAD_S:
                    break
                if s_now >= target['stop_offset_m']:
                    break
                horizon = lead / 60
                if horizon > 20:
                    continue
                eta, reason = progress_eta(placed, i, target['stop_offset_m'], track.stop_offsets, params,
                                           cruise_by_pattern.get(pid, 8.0))
                err_p = (t_arr - eta) / 60000 if eta else None
                # scheduled
                err_s = None
                if sched:
                    timing, dep_ms = sched
                    sec = timing[target['stop_index']] if target['stop_index'] < len(timing) else None
                    if sec is not None:
                        err_s = (t_arr - (dep_ms + sec * 1000)) / 60000
                # delay-adjusted: latest passage behind, known by t_now (its 'after' report has arrived)
                err_a = None
                if sched:
                    known = [b for b in behind if b['stop_index'] < target['stop_index'] and b['after_ms'] <= t_now]
                    if known:
                        b = known[-1]
                        timing, dep_ms = sched
                        sec_b = timing[b['stop_index']] if b['stop_index'] < len(timing) else None
                        sec_t = timing[target['stop_index']] if target['stop_index'] < len(timing) else None
                        if sec_b is not None and sec_t is not None:
                            delay = b['passed_at_ms'] - (dep_ms + sec_b * 1000)
                            err_a = (t_arr - (dep_ms + sec_t * 1000 + delay)) / 60000
                rows.append((pid, key, target['stop_id'], horizon, err_p, err_s, err_a, reason))
    return rows


def summarise(rows, band):
    lo, hi = band
    inband = [r for r in rows if lo <= r[3] < hi]
    out = {'moments': len(inband)}
    for name, idx in (('progress', 4), ('scheduled', 5), ('adjusted', 6)):
        errs = [r[idx] for r in inband if r[idx] is not None]
        absd = [abs(e) for e in errs]
        out[name] = {'available': len(errs), 'coverage': len(errs) / len(inband) if inband else 0,
                     'medianAbs': statistics.median(absd) if absd else None, 'p80Abs': pct(absd, .8),
                     'p90Abs': pct(absd, .9), 'medianSigned': statistics.median(errs) if errs else None}
    both = [(abs(r[4]), abs(r[5])) for r in inband if r[4] is not None and r[5] is not None]
    out['progressVsScheduledWhereBoth'] = {'moments': len(both),
                                          'progressMedianAbs': statistics.median(p for p, _ in both) if both else None,
                                          'scheduledMedianAbs': statistics.median(s for _, s in both) if both else None}
    return out


def fit(passages, patterns, dep_info, reports, fit_days, cruise):
    grid = [{'dwell_s': d, 'window_s': w, 'standing_below': 1.0} for d in (0, 5, 10, 15, 20, 30) for w in (60, 120, 180)]
    best = None
    for params in grid:
        rows = score(passages, patterns, dep_info, reports, params, fit_days, cruise)
        s = summarise(rows, RELEASE_BAND)
        m = s['progress']['medianAbs']
        if m is not None and (best is None or m < best[0]):
            best = (m, params, s)
    return best


def cruise_speeds(passages, patterns, reports):
    """Typical moving speed per pattern on the fit days: median of observed speeds above 3 m/s."""
    out = {}
    for pid, pattern in patterns.items():
        track = load_track(pid)
        if track is None:
            continue
        speeds = []
        keys = {p['journey_key'] for p in passages if p['pattern_id'] == pid}
        for key in list(keys)[:60]:
            placed = place_reports(track, reports.get((pattern['direction'], key), []))
            for i in range(1, len(placed)):
                dt = (placed[i][0] - placed[i - 1][0]) / 1000
                if dt > 0:
                    v = (placed[i][1] - placed[i - 1][1]) / dt
                    if 3 <= v <= MAX_SPEED:
                        speeds.append(v)
        if speeds:
            out[pid] = statistics.median(speeds)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--line', default='15')
    ap.add_argument('--operator', default='BNML')
    ap.add_argument('--fit-until', default='2026-09-14', help='last fit day, inclusive; later days are held out')
    a = ap.parse_args()
    passages, patterns, dep_info, reports = load_everything(a.line, a.operator)
    days = sorted({local_wall(p['passed_at_ms']).date() for p in passages if p['scoreable']})
    cut = datetime.strptime(a.fit_until, '%Y-%m-%d').date()
    fit_days, test_days = {d for d in days if d <= cut}, {d for d in days if d > cut}
    print(f'fit days:  {", ".join(d.strftime("%a %d %b") for d in sorted(fit_days))}')
    print(f'test days: {", ".join(d.strftime("%a %d %b") for d in sorted(test_days))}')

    fit_passages = [p for p in passages if p['scoreable'] and local_wall(p['passed_at_ms']).date() in fit_days]
    cruise = cruise_speeds(fit_passages, patterns, reports)
    print('cruise speed per pattern (fit days, m/s): ' + ', '.join(f'{k[-10:]} {v:.1f}' for k, v in cruise.items()))
    best = fit(passages, patterns, dep_info, reports, fit_days, cruise)
    m, params, fit_summary = best
    print(f'\nchosen on fit days: dwell {params["dwell_s"]} s, speed window {params["window_s"]} s  '
          f'(median abs error {m:.2f} min at 2-10 min, {fit_summary["moments"]} moments)')

    print('\n=== HELD-OUT DAYS, scored once ===')
    rows = score(passages, patterns, dep_info, reports, params, test_days, cruise)
    journeys = len({(r[0], r[1]) for r in rows})
    stops_scored = len({(r[0], r[1], r[2]) for r in rows})
    print(f'scoring moments {len(rows)}, from {journeys} journeys, {stops_scored} scored passages')
    result = {'line': a.line, 'fitDays': sorted(d.isoformat() for d in fit_days), 'testDays': sorted(d.isoformat() for d in test_days),
              'params': params, 'cruise': cruise, 'fit': fit_summary, 'heldOut': {}, 'moments': len(rows),
              'journeys': journeys, 'scoredPassages': stops_scored}
    hdr = f'{"horizon":10}{"n":>7}   {"progress med/p80/p90 (cov)":30} {"scheduled med/p80 (cov)":26} {"adjusted med/p80 (cov)":24}'
    print(hdr)
    for band in HORIZONS:
        s = summarise(rows, band)
        result['heldOut'][f'{band[0]}-{band[1]}'] = s
        f = lambda x: '   -  ' if x is None else f'{x:5.2f}'
        p, sc, ad = s['progress'], s['scheduled'], s['adjusted']
        print(f'{band[0]:>2}-{band[1]:<2} min {s["moments"]:>7}   {f(p["medianAbs"])}/{f(p["p80Abs"])}/{f(p["p90Abs"])} ({p["coverage"]:.0%})'
              f'   {f(sc["medianAbs"])}/{f(sc["p80Abs"])} ({sc["coverage"]:.0%})     {f(ad["medianAbs"])}/{f(ad["p80Abs"])} ({ad["coverage"]:.0%})')
    band = summarise(rows, RELEASE_BAND)
    result['heldOut']['releaseBand'] = band
    # weekday / weekend
    wk = [r for r in rows if local_wall(next(p['passed_at_ms'] for p in passages if p['journey_key'] == r[1] and p['stop_id'] == r[2])).weekday() < 5]
    we = [r for r in rows if r not in wk]
    for label, sub in (('weekday', wk), ('weekend', we)):
        s = summarise(sub, RELEASE_BAND)
        result['heldOut'][label] = s
        print(f'{label:8} 2-10 min: moments {s["moments"]}, progress median {s["progress"]["medianAbs"] and round(s["progress"]["medianAbs"], 2)}, '
              f'p80 {s["progress"]["p80Abs"] and round(s["progress"]["p80Abs"], 2)}, coverage {s["progress"]["coverage"]:.0%}')
    hill = [r for r in rows if r[2] == '1800SJ32251']
    s = summarise(hill, RELEASE_BAND)
    result['heldOut']['hillingdonOpp'] = s
    print(f'Hillingdon Road (opp) 2-10 min: moments {s["moments"]}, progress median {s["progress"]["medianAbs"] and round(s["progress"]["medianAbs"], 2)}, p80 {s["progress"]["p80Abs"] and round(s["progress"]["p80Abs"], 2)}')

    # the criteria, read against the release band
    b = band['progress']
    vs = band['progressVsScheduledWhereBoth']
    weekday_present = any(d.weekday() < 5 for d in test_days)
    crit = {
        'medianAbs<=1.5': b['medianAbs'] is not None and b['medianAbs'] <= 1.5,
        'p80Abs<=3.0': b['p80Abs'] is not None and b['p80Abs'] <= 3.0,
        'betterThanScheduledBy0.5': vs['progressMedianAbs'] is not None and vs['scheduledMedianAbs'] is not None
                                    and vs['scheduledMedianAbs'] - vs['progressMedianAbs'] >= 0.5,
        'coverage>=50%': b['coverage'] >= 0.5,
        'passages>=150 and journeys>=20': stops_scored >= 150 and journeys >= 20,
        'weekdayHeldOut': weekday_present,
    }
    result['criteria'] = crit
    print('\n=== release criteria (docs/ARRIVAL_RELEASE_CRITERIA.md) ===')
    for k, v in crit.items():
        print(f'  {"PASS" if v else "FAIL"}  {k}')
    print(f'  => {"RELEASE" if all(crit.values()) else "DO NOT RELEASE: run in the background"}')
    out = ROOT / f'data/evaluation/arrival-evaluation-{a.line}.json'
    out.write_text(json.dumps(result, indent=1, default=str))
    print(f'\nwritten {out}')


if __name__ == '__main__':
    main()
