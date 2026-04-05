# Tasks: om-observation-groups

### T-1.1 — Create om/groups.ts with 5 pure functions

- **Files**: `packages/opencode/src/session/om/groups.ts` (NEW)
- **What**: Port the 5 Mastra observation-group string utilities for LightCode.
- **Acceptance**: exports `ObservationGroup`; `parseObservationGroups()` returns `[]` for flat text; `wrapInObservationGroup()` auto-generates `id` with `ulid()` when omitted.
- **Tests required**: yes
- [x]

### T-1.2 — Export groups from om/index.ts

- **Files**: `packages/opencode/src/session/om/index.ts`
- **What**: Re-export all `groups.ts` APIs from the OM barrel.
- **Acceptance**: `import { wrapInObservationGroup, parseObservationGroups } from "./om"` works.
- **Tests required**: no
- [x]

### T-1.3 — Unit tests for all 5 group functions

- **Files**: `packages/opencode/test/session/observer.test.ts`
- **What**: Add a describe block covering wrap/parse/strip/render/reconcile.
- **Acceptance**: round-trip works; strip removes wrappers; render emits markdown headers; reconcile restores wrappers; flat input parses to `[]`.
- **Tests required**: yes
- [x]

### T-2.1 — Add first_msg_id/last_msg_id to ObservationBufferTable

- **Files**: `packages/opencode/src/session/session.sql.ts`
- **What**: Add nullable `first_msg_id` and `last_msg_id` columns for backward-compatible range tracking.
- **Acceptance**: schema compiles; both columns accept null.
- **Tests required**: no
- [x]

### T-2.2 — Generate DB migration

- **Files**: `packages/opencode/migration/` (generated)
- **What**: Run `bun run db generate --name add-om-buffer-msg-ids` from `packages/opencode`.
- **Acceptance**: migration files are generated successfully.
- **Tests required**: no
- [x]

### T-3.1 — Pass message IDs through Observer.run() input

- **Files**: `packages/opencode/src/session/om/observer.ts`
- **What**: Add `msgs?: Array<{id: string}>` to `Observer.run()` input and thread the call-site messages through.
- **Acceptance**: first/last message IDs are available; omitted `msgs` remains safe.
- **Tests required**: no
- [x]

### T-3.2 — Wrap Observer output in observation group

- **Files**: `packages/opencode/src/session/om/observer.ts`
- **What**: After `parseObserverOutput()`, wrap `result.observations` with the input message ID range.
- **Acceptance**: output contains `<observation-group>` with `firstId:lastId`; empty `msgs` skips wrapping.
- **Tests required**: yes
- [x]

### T-3.3 — Strip groups before truncateObsToBudget in Observer

- **Files**: `packages/opencode/src/session/om/observer.ts`
- **What**: Call `stripObservationGroups(prev)` before `truncateObsToBudget()`.
- **Acceptance**: truncation only sees clean text, never XML wrappers.
- **Tests required**: yes
- [x]

### T-3.4 — Pass first/last msg IDs in OM.addBuffer() calls

- **Files**: `packages/opencode/src/session/prompt.ts`, `packages/opencode/src/session/om/record.ts`
- **What**: Persist `first_msg_id`/`last_msg_id` when creating observation buffers.
- **Acceptance**: new buffers store non-null IDs; legacy nulls are handled in `OM.activate()`.
- **Tests required**: no
- [x]

### T-3.5 — Wrap OM.activate() merged output in observation group

- **Files**: `packages/opencode/src/session/om/record.ts`
- **What**: Wrap `condense()` output using the first/last buffer message IDs.
- **Acceptance**: activated observations get a spanning group; missing IDs fall back to plain text.
- **Tests required**: yes
- [x]

### T-4.1 — Render groups before Reflector LLM call

- **Files**: `packages/opencode/src/session/om/reflector.ts`
- **What**: Render observation groups as markdown before building the reflector prompt.
- **Acceptance**: LLM input uses markdown group headers; flat strings pass through unchanged.
- **Tests required**: yes
- [x]

### T-4.2 — Reconcile groups after Reflector output

- **Files**: `packages/opencode/src/session/om/reflector.ts`
- **What**: Re-apply group wrappers to reflector output before persisting reflections.
- **Acceptance**: group lineage is restored; fallback wraps a single full-range group when needed.
- **Tests required**: yes
- [x]

### T-5.1 — Implement recall tool

- **Files**: `packages/opencode/src/tool/recall.ts` (NEW)
- **What**: Add a session-scoped tool that reads `startId:endId`, queries messages, and returns truncated text.
- **Acceptance**: valid ranges return formatted messages; empty ranges say "no messages found"; invalid ranges error clearly; output fits 4000-token budget.
- **Tests required**: yes
- [x]

### T-5.2 — Register RecallTool in registry.ts

- **Files**: `packages/opencode/src/tool/registry.ts`
- **What**: Add `RecallTool` to the tool registry.
- **Acceptance**: recall appears in the agent tool list when OM is active.
- **Tests required**: no
- [x]

### T-6.1 — Add OBSERVATION_RETRIEVAL_INSTRUCTIONS and inject when groups present

- **Files**: `packages/opencode/src/session/system.ts`
- **What**: Append retrieval instructions only when `parseObservationGroups(body).length > 0`.
- **Acceptance**: instructions appear for grouped observations, not flat legacy sessions, and explain recall usage.
- **Tests required**: yes
- [x]

### T-7.1 — Run full test suite

- **Files**: run from `packages/opencode`
- **What**: Execute `bun test --timeout 30000`.
- **Acceptance**: full suite passes.
- **Tests required**: n/a
- [ ]

### T-7.2 — Run typecheck

- **Files**: run from `packages/opencode`
- **What**: Execute `bun typecheck`.
- **Acceptance**: zero type errors.
- **Tests required**: n/a
- [x]

### T-5.2 — Register RecallTool in registry.ts

- **Files**: `packages/opencode/src/tool/registry.ts`
- **What**: Add `RecallTool` to the tool registry.
- **Acceptance**: recall appears in the agent tool list when OM is active.
- **Tests required**: no
- [ ]

### T-6.1 — Add OBSERVATION_RETRIEVAL_INSTRUCTIONS and inject when groups present

- **Files**: `packages/opencode/src/session/system.ts`
- **What**: Append retrieval instructions only when `parseObservationGroups(body).length > 0`.
- **Acceptance**: instructions appear for grouped observations, not flat legacy sessions, and explain recall usage.
- **Tests required**: yes
- [ ]

### T-7.1 — Run full test suite

- **Files**: run from `packages/opencode`
- **What**: Execute `bun test --timeout 30000`.
- **Acceptance**: full suite passes.
- **Tests required**: n/a
- [ ]

### T-7.2 — Run typecheck

- **Files**: run from `packages/opencode`
- **What**: Execute `bun typecheck`.
- **Acceptance**: zero type errors.
- **Tests required**: n/a
- [ ]
