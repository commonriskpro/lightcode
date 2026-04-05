# LightCode Memory Core V3 — Validation Report

**Status**: COMPLETE — PASS  
**Phase**: Validation (Phase 5 of 6)  
**Date**: 2026-04-05  
**Depends On**: `LIGHTCODE_MEMORY_CORE_V3_TASKS.md`

---

## Commands Run

### TypeScript

```bash
cd packages/opencode && bun typecheck
```

**Result**: ✅ PASS — zero errors, zero warnings.

### Tests

```bash
cd packages/opencode && bun test test/memory/
```

**Result**: ✅ PASS — 86 tests, 0 failures, 205 assertions.

```
 86 pass
 0 fail
 205 expect() calls
Ran 86 tests across 4 files.
  - memory-core.test.ts      — 33 tests (V1 regression)
  - memory-core-v2.test.ts   — 25 tests (V2 regression)
  - memory-core-v3.test.ts   — 26 tests (V3 new)
  - abort-leak.test.ts       —  2 tests (existing)
```

---

## Quality Gate Results

| Gate                         | Description                                                                             | Status  |
| ---------------------------- | --------------------------------------------------------------------------------------- | ------- |
| Gate 1 — Fork Path           | Fork runtime path is real, reachable, test-backed                                       | ✅ PASS |
| Gate 2 — Runtime Composition | One canonical memory composition path via `Memory.buildContext()`                       | ✅ PASS |
| Gate 3 — OM Path             | `observeSafe()` removed; `addBuffer + seal` is the documented canonical path            | ✅ PASS |
| Gate 4 — Project Memory      | Auto-indexing at session end; WM guidance added                                         | ✅ PASS |
| Gate 5 — Engram Boundary     | `dream/index.ts` no longer imports or calls Engram anywhere; clearly compatibility-only | ✅ PASS |
| Gate 6 — Validation          | 26 new tests + 58 regression tests = 86 pass / 0 fail                                   | ✅ PASS |

---

## What Was Validated

### V3-1: Fork Step Guard Fixed

**Evidence**: `prompt.ts` fork branch now uses `step === 1` (not `step === 0`).

The critical bug: `step++` fires at line 1511, before the fork check at line 1636. With `step === 0`, the fork branch was **always false** — fork context set by `task.ts` was never consumed. Child sessions always executed without parent context.

Fixed to `step === 1`. Now the fork branch executes on the first loop iteration (when `step` is 1 and the fork map has an entry for this session).

Test: `V3-1: Fork step guard is step === 1 (not 0)` — PASS

---

### V3-2: Fork Path Loads Memory Context

**Evidence**: Fork block now calls `Memory.buildContext()` before `handle.process()`.

Before V3, the fork path passed `recall=undefined`, `obs=undefined`, `workingMem=undefined` to the child session's LLM call. Child agents had zero memory context.

After V3, the fork block:

1. Extracts `forkLastUserText` from the child's message history
2. Calls `Memory.buildContext({ scope: {type:"thread", id: sessionID}, ancestorScopes: [{type:"project"}] })`
3. Populates `recall`, `obs`, `workingMem` from `forkMemCtx`
4. Also deletes the `activeContexts` entry on fork consumption

Test: `V3-2: Fork path calls Memory.buildContext()` — PASS

---

### V3-3: Memory.buildContext() is Canonical

**Evidence**: `prompt.ts` step===1 block replaced scattered calls with `Memory.buildContext()`.

Before V3:

```ts
;[recall, workingMem] =
  yield *
  Effect.all([
    Effect.promise(() => SystemPrompt.recall(Instance.project.id, sessionID, lastUserText)),
    Effect.promise(() => SystemPrompt.projectWorkingMemory(Instance.project.id)),
  ])
```

After V3:

```ts
const memCtx =
  yield *
  Effect.promise(() =>
    Memory.buildContext({
      scope: { type: "thread", id: sessionID },
      ancestorScopes: [{ type: "project", id: Instance.project.id }],
      semanticQuery: lastUserText,
    }),
  )
recall = memCtx.semanticRecall
workingMem = memCtx.workingMemory
```

`Memory.buildContext()` is now the single canonical entry point for runtime memory assembly. `SystemPrompt.recall()` and `SystemPrompt.projectWorkingMemory()` are still available as standalone helpers but are no longer in the hot path.

Test: `V3-3: Memory.buildContext() is canonical in normal hot path` — PASS

---

### V3-4: Durable Fork Context Written to DB

**Evidence**: `task.ts` now calls `Memory.writeForkContext()` after `SessionPrompt.setForkContext()`.

The in-memory `forks` map remains the primary path. The DB write adds restart-safe durability — if the process restarts mid-fork, `Memory.getForkContext(childSessionId)` can recover the fork metadata.

Test: `V3-4: Durable fork context written to DB in task.ts` — PASS

---

### V3-5: activeContexts Memory Leak Fixed

**Evidence**: `activeContexts.delete(sessionID)` added at loop exit in `runLoop`.

Before V3, `activeContexts.set(sessionID, {...})` was called every turn but nothing ever deleted from it. The map grew unboundedly for the process lifetime.

After V3: cleanup at loop exit removes the entry, and the fork path also deletes it on fork consumption.

Test: `V3-5: activeContexts.delete called on loop exit` — PASS

---

### V3-6: observeSafe() Removed

**Evidence**: `session/om/record.ts` no longer contains `export function observeSafe(`.

`observeSafe()` was dead code targeting the old direct-upsert+seal pattern. The real path since V2 is `addBuffer → (later) activate()`. V2 fixed the atomicity by moving `OMBuf.seal()` + `OM.trackObserved()` inside the async closure after `addBuffer` succeeds.

The removal comment documents: "If a true transactional addBuffer+seal is needed, implement `addBufferSafe()` that wraps the buffer insert and seal in `Database.transaction()`."

Test: `V3-6: observeSafe() removed from om/record.ts` — PASS

---

### V3-7: Auto-Indexing OM at Session End

**Evidence**: `prompt.ts` loop exit block now calls `Memory.indexArtifact()` when observations exist.

After each session completes, if the OM record has observations (`length > 100`), they are indexed into `memory_artifacts` with:

- `scope_type: "project"`
- `type: "observation"`
- `topic_key: "session/{sessionID}/observations"` (for deduplication on restart)

This makes project memory grow automatically from real session activity, not just from AutoDream runs.

Test: `V3-7: Auto-indexing writes OM observations to memory_artifacts` — PASS

---

### V3-8: Working Memory Guidance Added

**Evidence**: `SystemPrompt.WORKING_MEMORY_GUIDANCE` exported; `wrapWorkingMemory()` includes it.

The system prompt now includes an agent instruction when working memory is present:

> "When you make a significant architectural decision, technology choice, or discover a key constraint or goal for this project, call `update_working_memory` with scope="project" to persist it for future sessions."

Agents now know when and how to write working memory without inferring it from the tool description alone.

Test: `V3-8: Working memory guidance in wrapWorkingMemory output` — PASS

---

### V3-9: Dream.run() Engram Gate Removed

**Evidence**: `dream/index.ts` no longer imports `Engram`; `run()` no longer calls `Engram.ensure()`.

The `/dream` manual command now works for all users without the Engram binary. The daemon-based dream path (`ensureDaemon`) is fully sufficient.

`dream/engram.ts` is retained as `@deprecated` compatibility module. The only remaining Engram caller is `cli/cmd/tui/app.tsx` which calls `Engram.setRegistrar()` for the TUI legacy auto-registration hook.

Test: `V3-9: Dream.run() no longer calls Engram.ensure()` — PASS

---

## Remaining Engram Dependency Paths After V3

| File                               | Usage                                    | Status                                     |
| ---------------------------------- | ---------------------------------------- | ------------------------------------------ |
| `dream/engram.ts`                  | Module itself                            | `@deprecated` — retained for compatibility |
| `cli/cmd/tui/app.tsx:268`          | `Engram.setRegistrar()`                  | Active — TUI legacy MCP auto-registrar     |
| `session/system.ts:recallEngram()` | Behind `OPENCODE_MEMORY_USE_ENGRAM=true` | Compatibility-only flag                    |

**No core hot path requires Engram in V3.**

---

## Known Limitations (for V4)

1. **`Memory.buildContext()` observations per-turn**: the `obs` variable is still loaded every turn via `SystemPrompt.observations()` separately (not through buildContext). This is intentional — observations change every turn as the Observer fires, and `buildContext()` was not made into a per-turn call for performance reasons. Future: unify observations into buildContext() with per-turn reload option.

2. **Fork context JSON**: the `context` JSON stored to DB contains minimal metadata (`parentAgent`, `projectId`). A richer snapshot (partial WM, key observations) would improve restart continuity. Deferred to V4.

3. **Auto-indexing minimum size**: only observations longer than 100 chars are indexed. Very short sessions don't contribute to project memory. The threshold is a simple heuristic; future work could use token counting.

4. **TUI `Engram.setRegistrar()` cleanup**: the TUI still auto-registers the Engram MCP server on startup. This requires a coordinated UX change (remove from TUI app.tsx) and is out of scope for V3.

5. **Vector/embedding backends**: FTS5 remains the only semantic recall backend. Phase B work.
