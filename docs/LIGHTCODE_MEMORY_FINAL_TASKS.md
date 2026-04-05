# LightCode Memory Final Tasks

This document outlines the execution plan to finalize the LightCode Memory initiative. Tasks are ordered by priority and dependencies.

## T1 — `addBufferSafe()` Implementation (CRITICAL)

- **Goal**: Implement strict transactional atomicity for the OM write path.
- **Files**: `packages/opencode/src/session/om/record.ts`
- **Dependencies**: None.
- **Acceptance Criteria**: `addBufferSafe(buf, sealAt, msgIds)` is implemented using `Database.transaction()`, wrapping both the `ObservationBufferTable` insert and `trackObserved` update.
- **Tests Required**: Write a test simulating a crash/exception in the transaction to ensure no partial writes occur.

## T2 — Wire `addBufferSafe()` in `prompt.ts` (CRITICAL)

- **Goal**: Replace the unsafe sequential OM write operations with the new atomic function.
- **Files**: `packages/opencode/src/session/prompt.ts`
- **Dependencies**: T1
- **Acceptance Criteria**: Lines ~1580–1601 use `addBufferSafe(buf, sealAt, msgIds)` followed by `OMBuf.seal(sealAt)`.
- **Tests Required**: Run existing session memory integration tests to ensure no regressions in buffer storage.

## T3 — Enrich Fork Context Snapshot (HIGH)

- **Goal**: Store a comprehensive state snapshot when forking agents.
- **Files**: `packages/opencode/src/tool/task.ts`
- **Dependencies**: None.
- **Acceptance Criteria**: `context` JSON payload includes `currentTask`, `suggestedContinuation`, and an array of `workingMemoryKeys`.
- **Tests Required**: Verify the generated `memory_fork_contexts` row contains the new JSON structure.

## T4 — Wire `Memory.writeHandoff()` for Task Handoffs (MEDIUM)

- **Goal**: Utilize the existing `memory_agent_handoffs` table for explicit parent→child task handoffs.
- **Files**: `packages/opencode/src/tool/task.ts`, `packages/opencode/src/memory/handoff.ts`
- **Dependencies**: T3
- **Acceptance Criteria**: `Memory.writeHandoff()` is invoked when a task specifies a detailed description/handoff payload.
- **Tests Required**: E2E verification of a task delegation to ensure the handoff row is created.

## T5 — Improve Auto-Index Title & Use Reflections (MEDIUM)

- **Goal**: Make auto-indexed memory titles semantically meaningful and prioritize high-quality reflections.
- **Files**: `packages/opencode/src/session/prompt.ts`
- **Dependencies**: None.
- **Acceptance Criteria**: The session-end auto-indexing logic sets the title to `current_task` or the first 80 characters of the content, and indexes `finalObs.reflections` if available.
- **Tests Required**: Unit test validating title generation logic with various combinations of task, reflections, and raw observations.

## T6 — Remove Dead `SystemPrompt.recall()` & `projectWorkingMemory()` (LOW)

- **Goal**: Clean up dead code that has been superseded by `Memory.buildContext()`.
- **Files**: `packages/opencode/src/session/system.ts`
- **Dependencies**: None.
- **Acceptance Criteria**: Functions are removed. TS compilation succeeds.
- **Tests Required**: Verify no imports or tests fail due to the removal.

## T7 — Rename `wrapRecall` → `wrapMemoryRecall` & Fix XML Tag (LOW)

- **Goal**: Eradicate legacy Engram nomenclature from the system prompt.
- **Files**: `packages/opencode/src/session/system.ts`
- **Dependencies**: T6
- **Acceptance Criteria**: Function renamed to `wrapMemoryRecall`; returned tag is `<memory-recall>`.
- **Tests Required**: Ensure system prompt generation tests expect the correct XML tags.

## T8 — Fix Stale Comments (LOW)

- **Goal**: Align documentation and inline comments with the current architecture.
- **Files**:
  - `packages/opencode/src/session/om/record.ts`
  - `packages/opencode/src/config/config.ts`
  - `packages/opencode/src/session/system.ts`
  - `packages/opencode/src/dream/index.ts`
  - `packages/opencode/src/session/prompt.ts` (Document buildContext override)
- **Dependencies**: None.
- **Acceptance Criteria**: All factually incorrect, legacy Engram-specific comments, and undocumented overrides are resolved.
- **Tests Required**: Code review audit.

## T9 — Memory Core Final Tests (HIGH)

- **Goal**: Ensure the comprehensive stability of the final memory architecture.
- **Files**: `packages/opencode/tests/memory-core-final.test.ts` (or equivalent test file)
- **Dependencies**: T1-T8
- **Acceptance Criteria**: All tests pass. Code coverage on `addBufferSafe` and fork context generation is 100%.
- **Tests Required**: Execution of the full suite.

## T10 — Final Validation Doc & `docs/SUPERSEDED.md` Update (MEDIUM)

- **Goal**: Formally document the deprecations and architectural decisions.
- **Files**: `docs/SUPERSEDED.md`, `packages/opencode/src/memory/handoff.ts`
- **Dependencies**: T1-T9
- **Acceptance Criteria**: `SUPERSEDED.md` reflects the removal of Engram logic and outlines the intent of `memory_agent_handoffs`.
- **Tests Required**: None. Review by technical lead.
