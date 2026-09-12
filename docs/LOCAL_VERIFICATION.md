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
