# Lost Minutes — owner-controlled project

Hammam Elshtewi owns this portfolio project and works in VS Code/WSL with Claude Code.
Target roles include Data Engineer, Analytics Engineer, Data Scientist and AI Engineer.
He learns while building. Implement the work; briefly explain important decisions after.
Do not impose worksheets, quizzes, teach-back requirements or mandatory manual coding.
Do not run expensive research, several agents, large downloads or redesigns unprompted.
Make routine reversible changes without repeated permission requests.

## Delivery
- This copy is a standalone Next.js/React frontend and Python pipeline.
- Work in this repository. Do not use ChatGPT Sites or the original Site source remote.
- GitHub stores source; a separate host serves the website. Do not claim they are the same.
- Preserve the existing design and evidence while making focused improvements.
- Keep changes small and explain what changed, why, and the verification result.
- Record real implementation progress. Do not claim unbuilt architecture is implemented.
- Do not send LinkedIn posts or publish/share externally without the owner's instruction.

## Evidence
- The supplied release is historical replay, never live or a validated delay monitor.
- Preserve original timestamp offsets, raw sources, hashes and missing-data states.
- Stored recordedAt comes from the feed; rendered clocks use Europe/London.
- Dedupe key: operator, vehicle, route, direction, journeyRef, observation epoch time.
- Same key and coordinates is a repeat; same key and different coordinates is a conflict.
- New timestamp with unchanged coordinates must survive. It does not prove continuous rest.
- Timetable matching, passage detection, headways and travel-time estimates need validation.
- Missing reports do not prove missing buses, cancelled services, or traffic causation.
- Passage estimates require direction, route membership, ordered geometry and uncertainty.
- Never put API keys, employer data, personal credentials or .env files into Git or the browser.
- Keep bus-data OGL and OSM ODbL attribution and third-party notices.

## Commands
- `pnpm install --frozen-lockfile`
- `pnpm dev` — local UI at http://localhost:3000
- `pnpm build` — standalone static frontend in out/
- `pnpm start` — serve out/ with Python 3 (WSL)
- `pnpm test`
- `pnpm typecheck`
- `python3 -m unittest discover -s tests -v`
- `python3 -m pipeline.import_archive` — opt-in 11-snapshot download; not needed to run UI.

Read docs/CLAUDE_HANDOFF.md and docs/REVIEW.md before substantive work.
