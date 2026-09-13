"""When a timetabled pattern runs: TransXChange operating profiles as rules a date can be
tested against. Pure functions, no I/O, no DuckDB, so the matcher can use them anywhere.

A rule is the JSON-safe form of one OperatingProfile:
    {"days": [0..6],                     Monday = 0, from RegularDayType/DaysOfWeek
     "holidaysOnly": true,               RegularDayType/HolidaysOnly
     "alsoOn": [[start, end], ...],      SpecialDaysOperation/DaysOfOperation
     "notOn":  [[start, end], ...],      SpecialDaysOperation/DaysOfNonOperation
     "serviced": [{"mode": "only"|"except", "kind": "WorkingDays"|"Holidays",
                   "organisations": [...], "ranges": [[start, end], ...]}],
     "bankHolidays": "declared_not_evaluated"}

Bank-holiday operation is recorded but not evaluated: that needs a bank-holiday calendar we
do not hold, and pretending otherwise would be a guess. It is stated wherever it matters.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

LONDON = ZoneInfo('Europe/London')
WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']


def service_day(observed_at_ms):
    """The calendar day a report belongs to, in Manchester, which is what a timetable means."""
    return datetime.fromtimestamp(observed_at_ms / 1000, tz=timezone.utc).astimezone(LONDON).date()


def _inside(day, ranges):
    iso = day.isoformat()
    return any(start <= iso <= (end or start) for start, end in ranges or [])


def rule_applies(rule, day):
    """Whether one operating profile runs on `day`. Exclusions win over inclusions."""
    if _inside(day, rule.get('notOn')):
        return False
    if _inside(day, rule.get('alsoOn')):
        return True
    if day.weekday() not in (rule.get('days') or []):
        return False
    for serviced in rule.get('serviced') or []:
        hit = _inside(day, serviced.get('ranges'))
        # A school-days-only journey whose calendar we cannot read is not assumed to run.
        if serviced.get('mode') == 'only' and not hit:
            return False
        if serviced.get('mode') == 'except' and hit:
            return False
    return True


def pattern_runs_on(rules, day):
    """True or False from the declared rules; None when the pattern carries no rules at all
    (built before operating days were recorded), which callers must treat as unknown."""
    if rules is None:
        return None
    return any(rule_applies(rule, day) for rule in rules)


def describe(rules):
    """'Mon–Fri', 'Mon–Sat, school days only', or 'days not recorded'. For people, not logic."""
    if rules is None:
        return 'days not recorded'
    days = sorted({d for rule in rules for d in rule.get('days') or []})
    if not days:
        return 'special days only'
    runs, start = [], days[0]
    for previous, current in zip(days, days[1:] + [None]):
        if current != previous + 1 if current is not None else True:
            runs.append(SHORT[start] if start == previous else f'{SHORT[start]}–{SHORT[previous]}')
            start = current
    text = ', '.join(runs)
    if all(any(s.get('mode') == 'only' for s in rule.get('serviced') or []) for rule in rules):
        # A serviced-organisation calendar is a list of dates. TfGM keeps them for school and
        # university holidays as well as terms, so "term days" would be a guess, and was wrong.
        text += ', on listed calendar dates only'
    return text


def parse_iso(value):
    if value in (None, ''):
        return None
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value)[:10])
