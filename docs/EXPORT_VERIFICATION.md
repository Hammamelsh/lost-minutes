# Export verification — 12 September 2026

- Standalone Next.js 16.3.4 `next build --webpack`: passed; static out/index.html produced.
- TypeScript `tsc --noEmit`: passed.
- Node replay tests: 5/5 passed.
- Python pipeline tests: 8/8 passed.
- Build reused the already-installed dependency tree with the same lockfile. A fresh
  installation on the owner's Windows/WSL machine has not been performed here.
- No browser rendering/interaction check was performed for this export; that is part of
  the first Claude Code session. Automated success is not a visual-quality guarantee.
- The archive retains the included public bus sample and roads. No API key is needed for
  local replay. Live authenticated collection has not been verified.
- Original source files are compared byte-for-byte against their committed Git blobs.
- No GitHub repository was created, and no website was deployed during the export.
