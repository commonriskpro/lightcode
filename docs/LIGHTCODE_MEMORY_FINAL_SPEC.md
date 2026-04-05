# LightCode Memory Final Specification

## 1. Overview

The LightCode Memory Final initiative aims to bridge the remaining gaps in the memory module's production readiness. Over previous iterations, we have established a robust foundation:

- **V1**: Introduced the native memory module with a 5-table schema, working memory, semantic recall (FTS5), handoff/fork persistence, and foundational helpers like `observeSafe()` (never called) and `persistConsolidation()`.
- **V2**: Delivered the OM atomicity fix (sealing inside async after `addBuffer`), wired dream output capture, fixed recall queries to use user message text, integrated working memory into the system prompt via the `update_working_memory` tool, improved recall quality (800-char previews), and removed the Engram gate from `idle()`.
- **V3**: Resolved the fork step guard bug (`=== 0` → `=== 1`), established `Memory.buildContext()` as the canonical path for normal hot paths, ensured durable fork contexts to the database, fixed the `activeContexts` leak, removed the dead `observeSafe()` helper, implemented auto-indexing at session end, added `WORKING_MEMORY_GUIDANCE`, and fully removed Engram imports and `ensure()` from `dream/index.ts`.

The goal of this final iteration is to eliminate architectural debt, finalize the atomicity of the Observational Memory (OM) write path, enrich task handoff contexts, and prune dead code and stale documentation to ensure a reliable and maintainable memory system.

## 2. Problem Statement (Remaining Gaps)

### Gap 1 — OM Atomicity: seal is ephemeral (in-memory only)

- `OMBuf.seal()` writes ONLY to an in-memory `seals` Map (`buffer.ts` line 115).
- **Evidence**: Zero DB persistence for the seal. If the process crashes after `addBuffer()` succeeds but before `trackObserved()` completes, on restart, those message IDs are NOT in `observed_message_ids`. They pass the deduplication filter and get re-observed, resulting in duplicate buffer entries.
- **Need**: `addBufferSafe()` should wrap `addBuffer` + optionally persist seal-equivalent to the DB to guarantee atomicity.

### Gap 2 — Fork context snapshot too minimal

- `task.ts` stores only: `{ parentAgent: ctx.agent, projectId: Instance.project.id }`.
- **Evidence**: No working memory snapshot and no observation snapshot are included. The `memory_agent_handoffs` table (with `working_memory_snap` and `observation_snap` columns) exists but `writeHandoff()` is NEVER called at runtime, making it a dead schema.
- **Need**: A richer snapshot that serializes project Working Memory (WM) records, OM `current_task`/`suggested_continuation`, and session metadata.

### Gap 3 — Auto-index title quality poor

- **Evidence**: The auto-generated title is `"Session observations 2026-04-05"`. This is generic and not searchable by topic. Additionally, `finalObs.reflections` is never indexed—only raw `observations` are, despite reflections being higher quality.
- **Need**: Use `OM.get().current_task || OM.get().observations.slice(0, 80)` as the title and prioritize `reflections` for indexing.

### Gap 4 — Dead helper functions

- **Evidence**: `SystemPrompt.recall()` and `SystemPrompt.projectWorkingMemory()` have zero callers in `src/`. `SystemPrompt.recall()` is bypassed entirely by `Memory.buildContext()`.
- **Need**: Remove these dead functions from the codebase.

### Gap 5 — Stale XML tag: `<engram-recall>`

- **Evidence**: In `system.ts` (line 66), `wrapRecall()` returns the `<engram-recall>` tag, whereas `Memory.buildContext()` correctly returns `<memory-recall>`. Though `SystemPrompt.recall()` has no active callers, the tag definition exists and is misleading.
- **Need**: Rename the tag to `<memory-recall>`.

### Gap 6 — Stale comments in `record.ts` and `config.ts`

- **Evidence**:
  - `record.ts` (lines 40–42) incorrectly states that `addBuffer`/`activate` are "not called from the main path".
  - `config/config.ts` (lines 1027, 1036) contains stale "Requires Engram" JSDoc.
  - `session/system.ts` (lines 149–170): `callEngramTool()` is still documented as a private helper only for `recallEngram()`.
  - `dream/index.ts` (lines 4–5): Stale comments explaining Engram removal.
- **Need**: Audit and update all stale comments.

### Gap 7 — `memory_agent_handoffs` dead schema

- **Evidence**: The table exists and contains snapshot columns, but nothing ever calls `writeHandoff()`.
- **Need**: Either wire it into the fork path or explicitly document it as reserved for future use.

### Gap 8 — `Memory.buildContext()` observations output unused in normal path

- **Evidence**: `Memory.buildContext()` computes observations (raw text), but in `prompt.ts` (line 1806), `obs` is overwritten with `SystemPrompt.observations()` which provides richer XML-wrapped content with instruction suffixes. This split is intentional but undocumented.
- **Need**: Explicitly document this split and ensure the role of `buildContext().observations` is clear.

## 3. Product Goals

- Ensure production-readiness of the Memory module with zero data loss or duplication on process crash.
- Provide rich, context-aware handoffs for parallel/forked agents.
- Guarantee that all auto-generated memory indices are highly searchable and semantically meaningful.
- Deliver a clean, maintainable codebase free of dead code and misleading legacy terminology.

## 4. Technical Goals

- Establish strict transactional atomicity for the Observational Memory write path (`addBufferSafe`).
- Enrich the `memory_fork_contexts` payload with active working memory and task state.
- Refactor the auto-indexing logic to favor reflections over raw observations.
- Purge all lingering Engram-specific artifacts and unused SystemPrompt helpers.

## 5. Success Criteria

1. **SC1**: `addBufferSafe()` is implemented, wrapping `addBuffer` and `trackObserved` in a single DB transaction. No duplicate buffer entries upon crash simulation.
2. **SC2**: Fork contexts stored in `memory_fork_contexts` include `currentTask`, `suggestedContinuation`, and `workingMemoryKeys`.
3. **SC3**: Auto-indexed session titles use the current task or first 80 chars of reflections, and `reflections` are indexed over raw `observations`.
4. **SC4**: `SystemPrompt.recall()` and `SystemPrompt.projectWorkingMemory()` are completely removed from `system.ts`.
5. **SC5**: `wrapRecall()` is renamed to `wrapMemoryRecall` and correctly outputs the `<memory-recall>` tag.
6. **SC6**: Stale comments in `record.ts` and `config.ts` are corrected or removed.
7. **SC7**: The intent of the `memory_agent_handoffs` schema is explicitly documented.
8. **SC8**: The intentional override of `buildContext().observations` in `prompt.ts` is explicitly documented inline.

## 6. Non-Goals

- Complete rewrite of the Memory or OM modules.
- Changes to the underlying Drizzle schema (additive changes/wiring only).
- Altering the semantic search algorithm (FTS5).
- Modifying the existing system prompt instruction text beyond tag renaming.

## 7. Constraints

- **No rebuilds**: We will not reconstruct the DB schema or memory system from scratch.
- **Additive changes**: Modifications should be strictly additive where possible, focusing on wiring existing paths or pruning explicitly dead code.
- **Backward compatibility**: Existing active sessions must not be broken by the transition to the new atomicity model or updated snapshot payloads.

## 8. Canonical Definitions

- **Canonical runtime memory composition path**: The path where `Memory.buildContext()` aggregates raw historical and semantic data, which is then refined and XML-wrapped by `SystemPrompt` helpers (like `observations()`) in `prompt.ts` before reaching the LLM.
- **Canonical OM durability path**: The strict transactional boundary defined by `addBufferSafe()`, guaranteeing that `ObservationBufferTable` inserts and `ObservationTable` updates (`trackObserved`) succeed or fail together, followed by an in-memory `OMBuf.seal()`.
- **Canonical fork/handoff behavior**: The process where a parent agent spawns a child task, persisting a rich JSON snapshot (agent, project, task, and WM state) to `memory_fork_contexts`, ensuring the child boots with complete context.
- **Engram compatibility boundary**: All explicit internal dependencies on Engram have been removed or abstracted. Legacy tables/tools remain only for backward compatibility but do not dictate the core memory flow.

## 9. Migration/Compatibility Expectations

- No schema migrations are required for this update.
- Existing fork contexts in the DB missing the new enriched fields will default to `null` safely.
- In-flight OM buffers will transition transparently to `addBufferSafe()` without interruption.

## 10. Release-Readiness Gates

- **Gate 1**: All 8 Success Criteria verified in a local test environment.
- **Gate 2**: Unit tests for `addBufferSafe()` transactional rollback behavior pass.
- **Gate 3**: End-to-end verification of a fork handoff demonstrates the enriched context payload in the DB.
- **Gate 4**: Code review confirms zero dead code remains from the specified gaps.
