# Upstream Munder baseline

- Repository: https://github.com/chaitanyagiri/munder-difflin
- Commit: `2b0ceb88c081e2384ad7967fd70a6c980f948f21` (`site: Stapler starts surprised and blue on the landing page`)
- Baseline tag: `upstream-baseline-2b0ceb8`
- License: MIT attribution and upstream asset licensing are retained unchanged.

Baseline verification on 2026-09-09:

- `npm install --ignore-scripts`: passed.
- `npm run typecheck`: passed.
- `npm run test:focused`: 827 passed; 4 existing node-pty signal E2E tests failed with `posix_spawnp failed` in this host environment.
