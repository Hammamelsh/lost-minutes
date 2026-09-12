# First local session — 12 September 2026 (VS Code / WSL)

The existing export was installed and run in place. Nothing was rebuilt from scratch and no
hosting platform was provisioned. This file records what was actually executed and observed.

## Environment measured on this machine
- Node v22.23.2 (WSL-native, `~/.local/bin/node`), npm 10.9.8.
- pnpm 11.25.0, installed in this session to match `packageManager`.
- Python 3.14.4 (`/usr/bin/python3`, WSL-native), git 2.53.0, GitHub CLI 2.100.0.
- `corepack` on PATH resolves to the Windows install and fails under WSL with
  `/bin/sh^M: bad interpreter` (CRLF shebang). pnpm was installed with
  `npm install -g pnpm@11.25.0` and symlinked into `~/.local/bin` instead.

## Commands run and results
- `pnpm install --frozen-lockfile` — passed from a clean tree, 43.7s. The lockfile was
  accepted unchanged; no dependency was upgraded.
- `pnpm test` (Node replay tests) — 5 passed, 0 failed, on Node 22.23.2.
- `python3 -m unittest discover -s tests -v` — 8 passed.
- `pnpm typecheck` (`tsc --noEmit`) — passed.
- `pnpm build` (`next build --webpack`) — passed; static export written to `out/` (35 files,
  3.7 MB), routes `/` and `/_not-found` prerendered.
- `pnpm lint` — failed initially on one real error; fixed in this session, now passes.
- `pnpm start` (Python static server on `out/`) — `/` 200, `/data/replay.json` 200,
  unknown path 404, heading present in served HTML.

## Browser inspection actually performed
Headless Chromium in WSL could not start (`libnspr4.so` missing; would need a system
package install). The Windows Chrome binary was driven from WSL instead.
- Desktop 1440px: map, roads, route/direction filters, journey list, per-bus panel and
  replay controls all render from `public/data/replay.json`. Clock shows `08:05:01 BST`.
- Mobile 390px: single-column layout, heading wraps, map card and panels stack.
- Layout was measured, not eyeballed: `documentElement.scrollWidth` equals `clientWidth`
  at 360, 390, 768 and 1440 px, and no element extends past the viewport. There is no
  horizontal overflow. An early screenshot that appeared clipped was an artifact of the
  Windows headless screenshot crop, not a layout defect.
- Evidence view was opened by dispatching real pointer events and its rendered text read
  back: 11 source snapshots, 3,426 accepted, 740 repeats, 0 conflicts, the raw
  `2026-09-11T07:04:38+00:00` observation string, a separate archive capture time, the
  SHA-256 source fingerprint and the full observation sequence for MF74NRL.

## Fixes made in this session
1. `next.config.ts`: `agentRules: false`. Next.js 16.3.4 `next dev` appends a vendor block
   to `AGENTS.md` on every start, which overwrites part of the owner's instruction file and
   dirties the working tree. Confirmed the option exists in
   `node_modules/next/dist/server/config-schema.js`; after the change `next dev` leaves
   `AGENTS.md` untouched.
2. `app/page.tsx`: the masthead brand link now uses `next/link` instead of a raw `<a
   href="/">`. This clears the only `pnpm lint` error and, unlike a raw anchor, respects a
   future `basePath` if the site is ever served from a repository subpath.

## Repository state
- Remote `origin` is `https://github.com/Hammamelsh/lost-minutes.git`, owned by the
  authenticated account `Hammamelsh`. It is **public** and was created before this session.
  It is not a ChatGPT Sites remote and no Sites deployment was touched.
- 100 tracked files, 1.4 MB of Git history. No `.env`, no API key, no raw archive ZIP and no
  build output is tracked; `.env.example` is tracked and empty of values.
- `out/`, `.next/`, `node_modules/`, `.pnpm-store/`, `data/raw/`, `data/live-capture/` and
  `__pycache__/` are all ignored and were confirmed ignored in the working tree.

## Not done, and still true
- No website was deployed and no cloud resource was created.
- Live authenticated BODS collection was not exercised; no BODS key exists here.
- Automated checks passing is not a visual-quality or accessibility judgement, and the two
  screenshots above cover two widths in one browser engine only.

---

# Pipeline milestone verification — 12 September 2026

Added: raw-input preservation with a DuckDB history, restart-safe reruns, validate-then-swap
publication and an Operations view. Everything below was executed, not estimated.

## Environment additions
- `duckdb==1.5.5` and `pytz==2026.3.post1` in `.venv` (`requirements.txt`). System Python is
  externally managed, so a virtual environment is required; `python3 -m venv .venv`.
- DuckDB raises `Required module 'pytz' failed to import` when returning a TIMESTAMPTZ to
  Python, which is why pytz is pinned rather than left implicit.

## Commands run and results
- `.venv/bin/python -m pipeline.run import` — 11 sources, 312,123 vehicle reports parsed,
  4,236 in area, 3,496 new observations, 740 repeats, 0 conflicts, 0 refused. Published
  3,426 observations across 419 journeys with all 10 validation checks passing.
- `.venv/bin/python -m pipeline.run import` **a second time** — 4,236 in-area records,
  **0 new observations, 4,236 repeats**, stored total unchanged at 3,496. Reruns add no
  analytical rows.
- `.venv/bin/python -m unittest discover -s tests` — 15 passed (8 parser, 7 pipeline history).
- `python3 -m unittest discover -s tests` — 15 run, 8 passed, **7 skipped**: the documented
  system-Python command still works without DuckDB installed.
- `pnpm test` — 11 passed (5 replay contract, 6 operations contract).
- `pnpm typecheck`, `pnpm lint`, `pnpm build` — all passed.

## Behaviours demonstrated
Controlled SIRI-VM fixtures in a throwaway warehouse, one test each:
- repeated import adds no analytical observation;
- a crash *mid-source* leaves the run `running` with a `pending` checkpoint and publishes
  nothing; the next run marks it `interrupted`, names the unfinished source and completes
  the work to the same result;
- conflicting coordinates for one identity are recorded with both readings, the first
  reading stays stored, and the identity is withheld from the published file;
- a stationary bus reporting again with a new timestamp is kept as a second observation;
- an older snapshot imported after a newer one extends the window backwards and adds
  observations without moving the served window end earlier;
- a candidate built from part of the warehouse fails `built_from_full_warehouse`, the served
  file is byte-identical afterwards, and the rejected candidate is kept as `rejected-*.json`;
- a run records `succeeded` processing while its publication records `failed_validation`.

## Reconciliation measured on the real sample
All five identities balanced, each side computed from different tables:
`312,123 = 4,236 + 307,887 + 0`; `4,236 = 3,496 + 740 + 0`; `3,496 = 3,496 - 0`;
`3,426 + 70 = 3,496`; and the served file's SHA-256 equals the recorded publication's.

## Browser inspection
Windows Chrome driven from WSL against the static export. The Operations tab renders the
four freshness measures, the served-snapshot card, the reconciliation table, run history
with per-run outcomes, the definitions and the notes. The map, filters, journey list and
Evidence view are unchanged. `documentElement.scrollWidth` equals `clientWidth` at 390px
and 768px with the Operations tab active; the wide tables scroll inside their own
containers rather than the page.

Two defects found by that inspection and fixed: the served-file path was published as an
absolute path containing the local username, and the definitions list inherited the
right-aligned value styling.

## Still requires credentials or deployment
- `BODS_API_KEY` is not set and no `.env` exists, so **no live capture was exercised** and
  `data/live-capture/` has never been written. The archive replay needs no key.
- There is no scheduler and no hosted worker. The pipeline runs in one local WSL process
  and stops when that process, the terminal or the machine stops. Nothing is labelled live.
