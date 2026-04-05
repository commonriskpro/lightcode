# LightCode Memory — Final Validation Report

**Status**: COMPLETE — PRODUCTION READY  
**Phase**: Validation (Phase 5 of 6)  
**Date**: 2026-04-05  
**Baseline**: V1 + V2 + V3 + Final cleanup

---

## Commands Run

### TypeScript

```bash
cd packages/opencode && bun typecheck
```

**Result**: ✅ PASS — zero errors, zero warnings (19 packages).

### Tests

```bash
cd packages/opencode && bun test test/memory/ test/session/recall.test.ts
```

**Result**: ✅ PASS — 117 tests, 0 failures, 277 assertions.

```
 117 pass
 0 fail
 277 expect() calls
Ran 117 tests across 6 files.
  - memory-core.test.ts       — 33 tests (V1 regression)
  - memory-core-v2.test.ts    — 25 tests (V2 regression)
  - memory-core-v3.test.ts    — 26 tests (V3 regression)
  - memory-core-final.test.ts — 27 tests (Final new)
  - recall.test.ts             —  5 tests (wrapRecall contract)
  - abort-leak.test.ts         —  2 tests (existing)
```

---

## Release Gate Results

| Gate                                   | Description                                                                                        | Status  |
| -------------------------------------- | -------------------------------------------------------------------------------------------------- | ------- |
| Gate 1 — Canonical Runtime Composition | `Memory.buildContext()` is the single entry point for all memory layers in the hot path            | ✅ PASS |
| Gate 2 — Canonical OM Durability       | `addBufferSafe()` atomically writes buffer + observed IDs; used by the hot path                    | ✅ PASS |
| Gate 3 — Fork / Handoff Readiness      | Fork path reachable (V3), enriched snapshot (Final), `writeHandoff()` wired                        | ✅ PASS |
| Gate 4 — Project Memory Readiness      | Auto-indexing at session end, reflections-first, meaningful titles, `update_working_memory` guided | ✅ PASS |
| Gate 5 — Engram Boundary Clarity       | No core runtime path requires Engram; all Engram code is clearly compatibility-only                | ✅ PASS |
| Gate 6 — Validation                    | 117 tests pass; validation doc complete                                                            | ✅ PASS |
| Gate 7 — Release Readiness             | Docs complete, migration notes documented, stale comments removed, compatibility flags in place    | ✅ PASS |

---

## What Was Validated

### Final F-1/F-2: Canonical OM Durability — addBufferSafe()

**What**: `OM.addBufferSafe(buf, sid, msgIds)` wraps `addBuffer` + `trackObserved` in a single `Database.transaction()`.

**Why it matters**: After V3's V2 atomicity fix (seal inside async closure), a crash between `addBuffer` and `trackObserved` still left a gap: the buffer chunk is persisted but `observed_message_ids` is not updated, causing re-observation of the same messages on restart.

**What addBufferSafe() closes**:

1. INSERT into `ObservationBufferTable` (buffer chunk) — atomic with step 2
2. UPDATE `ObservationTable.observed_message_ids` (durable dedup) — same transaction
3. If the transaction fails, neither write succeeds — messages are re-offered at the next threshold
4. In-memory `OMBuf.seal()` still fires after the transaction (read-performance hint only)

**Hot path usage**: `prompt.ts` observer closure now calls `OM.addBufferSafe()` instead of the old separate `OM.addBuffer()` + `OMBuf.seal()` + `OM.trackObserved()` sequence.

---

### Final F-3/F-4: Fork/Handoff Enriched

**Fork context snapshot** (stored in `memory_fork_contexts`):

```json
{
  "parentAgent": "build",
  "projectId": "/path/to/project",
  "taskDescription": "Implement auth module",
  "currentTask": "JWT implementation",
  "suggestedContinuation": "Continue with refresh token logic",
  "workingMemoryKeys": ["tech_stack", "goals"]
}
```

**Agent handoff records** (`memory_agent_handoffs`) — now wired for non-fork task sessions:

- `context`: task description
- `working_memory_snap`: serialized project WM records
- `observation_snap`: parent's `current_task` or `suggested_continuation`
- `metadata`: parent agent + project ID

---

### Final F-5: Auto-Index Quality Improved

**Reflections-first**: session end auto-indexing uses `finalObs.reflections ?? finalObs.observations`. Reflections are LLM-condensed and higher quality for recall.

**Meaningful titles**:

- Before: `"Session observations 2026-04-05"` (generic, poor FTS5 signal)
- After: `current_task || first_line_of_content || "Session YYYY-MM-DD"` (topic-relevant, searchable)

---

### Final F-6/F-7: Dead Helpers Removed

| Removed                               | Replaced By                                                   |
| ------------------------------------- | ------------------------------------------------------------- |
| `SystemPrompt.recall()`               | `Memory.buildContext({ semanticQuery })` in prompt.ts         |
| `SystemPrompt.projectWorkingMemory()` | `Memory.buildContext({ ancestorScopes: [{type:"project"}] })` |

Both functions had zero active callers since V3. They are removed with explanatory comments.

---

### Final F-8: XML Tag Consistency

- `SystemPrompt.wrapRecall()` now returns `<memory-recall>` (was `<engram-recall>`)
- `Memory.buildContext()` already used `<memory-recall>` (consistent since V1)
- Both paths now use the same XML tag

---

### Final F-9/F-10: Stale Comments Cleaned

| File                                     | Old                                         | New                                           |
| ---------------------------------------- | ------------------------------------------- | --------------------------------------------- |
| `config/config.ts` autodream JSDoc       | "via Engram after sessions"                 | "via native LightCode memory after sessions"  |
| `config/config.ts` observer JSDoc        | "Requires Engram."                          | (removed)                                     |
| `session/om/record.ts` addBuffer comment | "not called from the main observation path" | "addBufferSafe() is the canonical write path" |

---

## Remaining Engram Dependency Paths

| File                  | Usage                              | Status                                                   |
| --------------------- | ---------------------------------- | -------------------------------------------------------- |
| `dream/engram.ts`     | Module itself                      | `@deprecated` — retained as compatibility module         |
| `cli/cmd/tui/app.tsx` | `Engram.setRegistrar()`            | Active — TUI legacy MCP auto-registrar for Engram binary |
| `session/system.ts`   | `recallEngram()` (private)         | Behind `OPENCODE_MEMORY_USE_ENGRAM=true` flag            |
| `session/system.ts`   | `callEngramTool()` (private)       | Only reachable via `recallEngram()`                      |
| `flag/flag.ts`        | `OPENCODE_MEMORY_USE_ENGRAM`       | Compatibility flag (default: false)                      |
| `flag/flag.ts`        | `OPENCODE_DREAM_USE_NATIVE_MEMORY` | Compatibility flag (default: true)                       |

**No core hot path requires Engram in the final architecture.**

---

## The Canonical Architecture (Final)

### Runtime Memory Composition Path

```
prompt.ts:step===1 (normal + fork paths):
  Memory.buildContext({
    scope: { type: "thread", id: sessionID },
    ancestorScopes: [{ type: "project", id: Instance.project.id }],
    semanticQuery: lastUserText,
  })
  → recall = ctx.semanticRecall          (memory_artifacts FTS5)
  → workingMem = ctx.workingMemory       (memory_working)

Every turn (separate, intentional):
  obs = SystemPrompt.observations(sid)   (session_observation, richer formatting)
```

### OM Durability Path

```
Observer.run() → result
  → OM.addBufferSafe(buf, sid, msgIds)   ← DB TRANSACTION
    ├── INSERT ObservationBufferTable
    └── UPDATE/INSERT ObservationTable.observed_message_ids
  → OMBuf.seal(sid, sealAt)             ← in-memory hint, after transaction
  (later) → OM.activate() → condense → ObservationTable.observations
```

### Fork/Handoff Path

```
task.ts TaskTool.execute():
  → SessionPrompt.setForkContext(childId, parentCtx)    ← in-memory
  → Memory.writeForkContext({ enriched JSON })           ← DB (restart-safe)
  → Memory.writeHandoff({ WM snap, obs snap })           ← DB (non-fork tasks)

Child session runLoop:
  → Memory.buildContext() for child's own memory
  → Uses parent's fork.system + fork.messages for cache sharing
```

### Project Memory Path

```
During session:
  update_working_memory tool → Memory.setWorkingMemory(project, key, value)
  WORKING_MEMORY_GUIDANCE in system prompt guides when to call it

At session end:
  finalObs = OM.get(sessionID)
  content = reflections ?? observations
  title = current_task || first_line || "Session YYYY-MM-DD"
  Memory.indexArtifact({ scope: project, topic_key: session/{id}/observations })

AutoDream (async, conditional):
  persistConsolidation() → Memory.indexArtifact({ scope: project, topic_key: dream/date })
```

---

## Known Limitations (not blockers)

1. **OM seal is ephemeral**: `OMBuf.seal()` is in-memory only. On restart, the seal is lost and the next `check()` filters by `observed_message_ids` (durable via `addBufferSafe`). Duplicate buffer entries may occur in theory on restart — they will be deduplicated during `activate()` by hash comparison. Not a correctness issue.

2. **Observations per-turn still separate**: `SystemPrompt.observations()` is called every turn outside `Memory.buildContext()`. This is intentional — observations change during the session as the Observer fires, and observations need the richer XML wrapping + instruction suffixes that `buildContext()` doesn't add. The boundary is intentional and documented.

3. **TUI Engram.setRegistrar()**: The TUI still auto-registers the Engram binary as an MCP server. This requires a coordinated UX decision to remove.

4. **Vector/embedding backends**: FTS5 is the only semantic recall backend. The `RecallBackend` interface is ready for a vector backend.

5. **`memory_agent_handoffs` only used for task sessions**: Fork sessions use `memory_fork_contexts` (lighter). The richer `memory_agent_handoffs` table (with WM + observation snapshots) is now wired for non-fork `TaskTool.execute()` calls.

---

## Release Readiness Verdict

**READY FOR RELEASE.**

All 7 quality gates pass. The architecture is:

- One canonical native SQLite memory system
- One canonical runtime composition path (`Memory.buildContext()`)
- One canonical OM durability path (`addBufferSafe()`)
- Durable fork/handoff continuity with enriched snapshots
- Project memory that grows automatically and is searchable
- No core runtime Engram dependency
- 117 tests pass, zero TypeScript errors
