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

## Verification

- `npm run typecheck` — passed.
- `node --test test/organaisation-core.test.cjs` — passed (4 tests).
- `npm run test:focused` — passed (838 tests).
- `npm run build` — passed.
- Generated the supplied startup roster with `bootstrap_roster.py`; validated all 8 agents, including 2 Pi agents, against `organaisation/roster@1`.

## Important decisions

- Existing Munder hive, approvals, process harness, memory and skills remain intact. OrganAIsation services are additive and accessed through explicit IPC/facade seams.
- Plugin entrypoints are CommonJS in v1, matching the specified `dist/index.js` shape and avoiding unrestricted custom loaders. The SDK exposes only declared capabilities; high-risk permissions require explicit enablement confirmation.
- Plugin authors may stage code, but cannot approve, install or enable it through the factory.

## Remaining evolution work

- Add a provider-neutral post-session reflection adapter that can propose durable memories without promoting them automatically.
- Expand the review panel with full diff rendering and guided roster-file picker integration.
- Add an external memory-provider adapter once a real provider plugin needs it.
