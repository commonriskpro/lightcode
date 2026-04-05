# LightCode Memory Core V3 — Implementation Tasks

## Dependency Graph

`T1 → T2 → T4`

`T1 → T3`

`T5, T6, T7, T8, T9` are independent.

`T10` validates all completed work.

## Execution Order

1. Unblock the fork branch and clean fork state (`T1`, `T5`).
2. Hydrate fork children and persist fork context (`T2`, `T4`).
3. Canonicalize normal-path memory assembly and OM cleanup (`T3`, `T7`).
4. Remove dead code and legacy gates (`T6`, `T9`).
5. Add working-memory guidance (`T8`).
6. Run the full regression suite (`T10`).

## Phase 1: Fork Path / State Hygiene

- [ ] 1.1 `packages/opencode/src/session/prompt.ts`: change `if (fork && step === 0)` to `if (fork && step === 1)` so the fork branch is reachable.
- [ ] 1.2 `packages/opencode/src/session/prompt.ts`: call `activeContexts.delete(sessionID)` on loop exit and after fork consumption to stop the leak.

## Phase 2: Fork Durability

- [ ] 2.1 `packages/opencode/src/session/prompt.ts`: in the fork branch, call `Memory.buildContext()` before `handle.process()` and pass `recall`, `obs`, and `workingMem` to the child.
- [ ] 2.2 `packages/opencode/src/tool/task.ts`: after `SessionPrompt.setForkContext(session.id, parent)`, call `Memory.writeForkContext(...)` so fork context survives restarts.

## Phase 3: Canonical Memory Composition

- [ ] 3.1 `packages/opencode/src/session/prompt.ts`: replace the step-1 `SystemPrompt.recall()` + `projectWorkingMemory()` pair with `Memory.buildContext()`; keep `SystemPrompt.observations()` per turn.
- [ ] 3.2 `packages/opencode/src/session/prompt.ts`: at loop exit, if OM has observations, call `Memory.indexArtifact()` with `scope=project` and a session-scoped `topic_key`.
- [ ] 3.3 `packages/opencode/src/session/system.ts`: add `WORKING_MEMORY_GUIDANCE` and append it from `wrapWorkingMemory()`.

## Phase 4: Cleanup / Legacy Removal

- [ ] 4.1 `packages/opencode/src/session/om/record.ts`: remove `observeSafe()` and leave a comment that the live path is `addBuffer+activate`.
- [ ] 4.2 `packages/opencode/src/dream/index.ts`: remove `Engram.ensure()` from `run()` so `/dream` uses the daemon path directly.

## Phase 5: Verification

- [ ] 5.1 `packages/opencode/test/memory/memory-core-v3.test.ts`: add code-audit tests for T1, T3, T6, and T9.
- [ ] 5.2 `packages/opencode/test/memory/memory-core-v3.test.ts`: add behavior tests for fork reachability, `activeContexts` cleanup, and `writeForkContext` after `setForkContext`.
- [ ] 5.3 `packages/opencode/test/memory/memory-core-v3.test.ts`: add regression tests for session-end artifact indexing, working-memory guidance, and project-scope artifact survival.

## Acceptance Criteria

- Fork sessions enter the hydration block on the first loop turn.
- Fork children receive populated memory context, not `undefined` values.
- Fork context is written to `memory_fork_contexts`.
- `activeContexts` is cleared when the session ends.
- Normal turns use `Memory.buildContext()` for recall + working memory.
- `observeSafe()` is gone; `/dream` no longer requires Engram.
- Session end can write observation artifacts to `memory_artifacts`.
- Working-memory guidance is present whenever a working-memory block is rendered.

## Test Requirements

- Code-audit assertions for: fork guard value, `Memory.buildContext()` hot-path usage, `observeSafe()` removal, and `Engram.ensure()` removal.
- Behavioral assertions for: fork branch reachability, cleanup calls, and DB write ordering.
- Regression assertions for: `memory_artifacts` persistence, project-scope artifact survival, and prompt guidance output.
