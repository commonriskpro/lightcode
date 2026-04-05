# LightCode Memory Production Tasks

## T1 — Fix WM precedence dedup (CRITICAL BUG)

- **Goal:** Ensure "most specific wins" logic works for working memory.
- **Files:** `packages/opencode/src/memory/working-memory.ts`
- **Dependencies:** None.
- **Acceptance Criteria:** `k = r.key` is used instead of combining with scope type.
- **Tests:** Add/update a test in `memory-core-production.test.ts` verifying that if thread and project have the same key, only the thread's value is returned.

## T2 — FTS5 two-mode query (MEDIUM)

- **Goal:** Improve semantic search recall quality using prefix matching and OR-fallback.
- **Files:** `packages/opencode/src/memory/semantic-recall.ts`
- **Dependencies:** None.
- **Acceptance Criteria:** `sanitizeFTS` and `sanitizeFTSPrefix` are implemented as specified. `search()` tries AND-mode, then falls back to OR-mode if results are 0.
- **Tests:** Add tests ensuring multi-word queries match partial words and that fallback triggers successfully when strict match fails.

## T3 — Add FTS5 fallback to Memory.buildContext() (MEDIUM)

- **Goal:** Ensure the runtime hot path always provides memory context if it exists.
- **Files:** `packages/opencode/src/memory/provider.ts`
- **Dependencies:** T2 (FTS fixes).
- **Acceptance Criteria:** `Memory.buildContext()` checks FTS results length and calls `SemanticRecall.recent(scopes, 5)` if empty.
- **Tests:** Mock an empty FTS response and verify `recent()` is called and returned.

## T4 — Add agent scope to hot path + UpdateWorkingMemoryTool (LOW)

- **Goal:** Operationalize the agent scope.
- **Files:** `packages/opencode/src/session/prompt.ts`, tool definitions for `UpdateWorkingMemoryTool`.
- **Dependencies:** None.
- **Acceptance Criteria:** `{ type: "agent", id: lastUser.agent }` is passed as a scope. The tool schema accepts `"agent"`.
- **Tests:** Verify tool schema validation and that agent memory is retrieved during context building.

## T5 — Clarify runLoop ownership boundaries (MEDIUM)

- **Goal:** Improve maintainability of the main run loop without risky late-stage behavioral refactors.
- **Files:** `packages/opencode/src/session/prompt.ts`
- **Dependencies:** None.
- **Acceptance Criteria:** The loop has explicit ownership boundaries for OM coordination and memory assembly in code/comments, and no production behavior regresses.
- **Tests:** Ensure existing end-to-end session tests pass without modification.

## T6 — Remove dead Engram recall code (LOW)

- **Goal:** Reduce technical debt by removing unused Engram code and flags.
- **Files:** `packages/opencode/src/flag/flag.ts`, `packages/opencode/src/session/system.ts`
- **Dependencies:** None.
- **Acceptance Criteria:** `OPENCODE_MEMORY_USE_ENGRAM`, `recallEngram()`, `callEngramTool()`, and `recallNative()` are deleted.
- **Tests:** `bun typecheck` passes.

## T7 — Document scope dormancy (LOW)

- **Goal:** Clarify the state of different memory scopes for future maintainers.
- **Files:** `packages/opencode/src/memory/contracts.ts`
- **Dependencies:** None.
- **Acceptance Criteria:** Code comments clearly state that `user` and `global_pattern` are dormant in V1, while `agent` is operational.

## T8 — Durable child hydration from DB-backed state (MEDIUM)

- **Goal:** Ensure child sessions can consume durable fork/handoff state, not just write it.
- **Files:** `packages/opencode/src/session/prompt.ts`, `packages/opencode/src/tool/task.ts`
- **Dependencies:** None.
- **Acceptance Criteria:** `prompt.ts` reads `Memory.getHandoff()` / `Memory.getForkContext()` via a helper and merges useful context into child-session runtime memory. `task.ts` stores `workingMemorySnapshot` values, not only key names.
- **Tests:** Add/adjust tests for durable child hydration and richer fork snapshot content.

## T9 — Tests (HIGH)

- **Goal:** Ensure production readiness and prevent regressions.
- **Files:** `packages/opencode/tests/memory-core-production.test.ts` (or equivalent)
- **Dependencies:** T1, T2, T3, T4.
- **Acceptance Criteria:** Dedicated tests exist for precedence deduplication, FTS5 two-mode fallback, and hot-path recent fallback. All tests pass.

## T10 — Production validation doc (MEDIUM)

- **Goal:** Document the manual or automated validation steps to prove the system is production-ready.
- **Files:** `docs/LIGHTCODE_MEMORY_PRODUCTION_VALIDATION.md`
- **Dependencies:** T1-T8.
- **Acceptance Criteria:** A clear checklist exists for QA or automated pipelines to verify the memory system end-to-end.

## T11 — Final SUPERSEDED.md update + release signoff (LOW)

- **Goal:** Formally document architectural shifts and sign off on the release.
- **Files:** `SUPERSEDED.md` (root or docs)
- **Dependencies:** T6, T9.
- **Acceptance Criteria:** `SUPERSEDED.md` explains the removal of the dead Engram local bridge code. Initiative is marked ready for merge.
