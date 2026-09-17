# The 48-hour observation

**Status: not started.** It begins the hour Lost Minutes is hosted somewhere that stays up, and
nothing about it may be reported before it has elapsed. The method is in `docs/RELEASE.md`.

This file is appended to while the period runs, so progress can be read at any point rather than
waiting for a summary.

## Record

| When (UK) | What | Observed |
|---|---|---|
| — | started | — |

## Publication gaps

*(each gap over 600 s, from `journalctl -u lost-minutes-health`, with what caused it)*

## The controlled restart

*(when, how long until the next publication, whether the last good file kept serving, whether any
second writer appeared)*

## The failure and recovery check

*(the key withdrawn for ten minutes: what the page said, what kept serving, what the watchdog did,
how recovery happened)*

## Resource use

*(collector CPU and memory from `systemd-cgtop`, disk from `df -h`, and the growth of
`data/live-capture/` against the predicted 0.13 GB a day)*

## The nightly timetable rebuilds

*(two of them: whether collection paused and resumed, and the size of the catalogue published)*
