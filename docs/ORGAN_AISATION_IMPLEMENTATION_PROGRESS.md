# OrganAIsation Core implementation progress

## Completed

- Recorded the upstream baseline at commit `2b0ceb88c081e2384ad7967fd70a6c980f948f21`; retained its licensing and asset attribution.
- Added `organaisation/roster@1` parsing with provider options derived from Munder's runtime registry. Imports return reviewable Add Agent drafts and never create processes.
- Added a provider-neutral actor profile and a renderer-neutral `OrganisationClient` contract.
- Added an application-plugin runtime: validated manifests, staged/reviewed/installed/enabled/disabled/failed states, declared permission broker, per-plugin data directories, event bus, tool registration, health checks, failure containment, clean uninstall, and a proposal scaffold.
- Kept Pi package bindings separate from application plugins. Requests are scoped to one Pi agent and require a separate confirmation before becoming enabled.
- Added Memory V2 with agent/founder/project/company/session scopes, bounded pre-turn retrieval, candidate approval/rejection, supersession, session JSONL, secret filtering and durable mirrors. SQLite FTS is used when the bundled native dependency is available; a local JSON persistence fallback keeps the service safe and usable on hosts that cannot load the native module.
- Added Skills V2: metadata-only catalog, on-demand body loads, pending proposals, explicit human approval, immutable previous-version history, and source-task provenance.
- Added a compact pixel-office OrganAIsation panel backed by the shared facade; it visibly distinguishes Pi packages from application plugins.
- Added a bundled eight-person startup roster and a one-click action that loads it into the existing human-reviewed Add Agent queue.
- Split the fork into a real macOS application identity: `OrganAIsation`, bundle id `ai.organaisation.desktop`, its own `organaisation://` protocol, explicit isolated user-data path, and a separate supplied icon.
- Disabled upstream auto-updates for this local fork so it cannot replace itself with a Munder Difflin release.
- Hardened the plugin lifecycle after review: the installed manifest must match the reviewed manifest, and subscriptions are detached on disable/failure/uninstall.
- Corrected the generated plugin scaffold to CommonJS, matching the v1 runtime it is intended to exercise.
- Corrected roster compatibility so the bootstrap generator's legacy `token_cap` spelling retains employee budgets.
- Corrected Memory V2 to use its FTS5 index, reject invalid durable candidates, and verify the target exists before creating a superseding memory.

## Verification

- `npm run typecheck` — passed.
- `npm run test:focused` — passed (840 tests).
- `npm run build` — passed.
- `npm run dev` — Electron main, preload and renderer all built; the app started successfully and the local broker/telemetry listeners initialized.
- Generated the supplied startup roster with `bootstrap_roster.py`; validated all 8 agents, including 2 Pi agents, against `organaisation/roster@1`.
- `electron-builder --mac --arm64 --dir` — passed; the signed bundle contains the exact supplied `.icns` and bundled roster.
- `/Applications/OrganAIsation.app` — installed and launched against `/Users/agamairi/Library/Application Support/OrganAIsation` and `/Users/agamairi/development/OrganAIsation`.

## Important decisions

- Existing Munder hive, approvals, process harness, memory and skills remain intact. OrganAIsation services are additive and accessed through explicit IPC/facade seams.
- Plugin entrypoints are CommonJS in v1, matching the specified `dist/index.js` shape. Plugins are trusted local code once approved: SDK capabilities are permission-gated, but the CommonJS process is not an OS security sandbox. Source review therefore remains a required boundary, especially for high-risk permissions.
- Plugin authors may stage code, but cannot approve, install or enable it through the factory.

## Remaining evolution work

- Add a provider-neutral post-session reflection adapter that can propose durable memories without promoting them automatically.
- Expand plugin review with full source diffs and move third-party plugin execution into a separate restricted process before accepting untrusted marketplace code.
- Add an external memory-provider adapter once a real provider plugin needs it.
