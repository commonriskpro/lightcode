# LightCode — Superseded Components

This document tracks all components that have been superseded, deprecated, or replaced across the native LightCode memory migration from V1 through the final production architecture.

Deprecated files are retained only when they still serve a clear compatibility or migration purpose. They are not kept as a general runtime rollback mechanism.

---

## Superseded by Memory Core V1

### 1. `packages/opencode/src/dream/engram.ts`

**Status**: REMOVED  
**Superseded by**: `packages/opencode/src/memory/` (native MemoryProvider)  
**Reason**: Manages the external Engram Go binary and registers it as an MCP client. The canonical/default runtime path is now native and SQLite-backed in `lightcode.db`. Engram remains only as a compatibility surface.  
**Rollback**: No runtime rollback flag remains for recall. Engram is now compatibility-only, not a canonical runtime backend.  
**Removal trigger**: Completed — removed once no runtime-adjacent surface needed it.

---

### 2. `packages/opencode/src/dream/ensure.ts`

**Status**: ACTIVE (not superseded)  
**Superseded by**: N/A  
**Reason**: Despite the name, this file manages the native LightCode dream daemon (`ensureDaemon()`), not the Engram binary. It remains part of the native memory path and is NOT deprecated.

---

### 3. `session/system.ts` — legacy Engram recall helpers

**Status**: REMOVED  
**Superseded by**: `Memory.buildContext()` in `packages/opencode/src/memory/provider.ts`  
**Reason**: `SystemPrompt.recall()`, `recallNative()`, `recallEngram()`, and `callEngramTool()` were dead code by the production phase. The hot path had already moved to `Memory.buildContext({ semanticQuery })` in `prompt.ts`. These helpers were removed to eliminate a fake compatibility boundary and stale Engram references.

---

### 4. AutoDream + Engram MCP consolidation path

**Status**: REPLACED (default behavior)  
**Superseded by**: `AutoDream.persistConsolidation()` in `packages/opencode/src/dream/index.ts` → writes to `memory_artifacts` via `Memory.indexArtifact()`  
**Reason**: AutoDream called Engram MCP `mem_save` / `mem_update` to persist cross-session consolidations. Required Engram daemon. Now writes directly to `lightcode.db`.  
**Feature flag**: `OPENCODE_DREAM_USE_NATIVE_MEMORY=false` preserves the legacy consolidation path temporarily.

---

### 5. `SystemPrompt.projectWorkingMemory()`

**Status**: REMOVED  
**Superseded by**: `Memory.buildContext()` in `packages/opencode/src/memory/provider.ts`  
**Reason**: This helper had zero active callers once the runtime adopted `Memory.buildContext()` as the canonical composition path. Keeping it created two competing owners for working-memory assembly.

---

### 6. `observeSafe()` in `session/om/record.ts`

**Status**: REMOVED  
**Superseded by**: `OM.addBufferSafe()` in `packages/opencode/src/session/om/record.ts`  
**Reason**: `observeSafe()` targeted the obsolete direct-upsert OM path. The real runtime path is buffered (`Observer.run()` → `addBufferSafe()` → `activate()`). Keeping `observeSafe()` was misleading because it looked canonical while being unused.

---

### 7. `OPENCODE_MEMORY_USE_ENGRAM`

**Status**: REMOVED  
**Superseded by**: No replacement — native LightCode memory is unconditional for runtime recall  
**Reason**: The flag was defined but never checked by any live runtime call site. It created the illusion of a supported recall fallback when the Engram recall path was already dead. The only remaining memory compatibility flag is `OPENCODE_DREAM_USE_NATIVE_MEMORY` for dream consolidation.

---

## Superseded Storage Patterns

### Cross-session recall via MCP

| Old                                       | New                                                   |
| ----------------------------------------- | ----------------------------------------------------- |
| `callEngramTool(all, "mem_context", ...)` | `Memory.buildContext({ semanticQuery, ... })`         |
| `callEngramTool(all, "mem_search", ...)`  | `SemanticRecall.search()` / `SemanticRecall.recent()` |
| Returns arbitrary MCP tool result text    | Returns typed `MemoryArtifact[]`                      |
| Requires running Engram daemon            | No external process needed                            |

### Fork continuity

| Old                                 | New                                                  |
| ----------------------------------- | ---------------------------------------------------- |
| In-memory `Map<sessionId, context>` | `memory_fork_contexts` table in `lightcode.db`       |
| Lost on process restart             | Survives restart                                     |
| No handoff snapshots                | `memory_agent_handoffs` table with WM + OM snapshots |

### Working memory

| Old             | New                                                       |
| --------------- | --------------------------------------------------------- |
| Not implemented | `memory_working` table in `lightcode.db`                  |
| —               | `Memory.setWorkingMemory(scope, key, value)`              |
| —               | Scope-aware: thread, agent, project, user, global_pattern |

---

## Remaining Compatibility Flags

| Flag                               | Default | Effect when set to rollback value                           |
| ---------------------------------- | ------- | ----------------------------------------------------------- |
| `OPENCODE_DREAM_USE_NATIVE_MEMORY` | `true`  | Set to `false` → use Engram MCP for AutoDream consolidation |

---

## What Was NOT Removed

The following are explicitly preserved and unchanged:

- `packages/opencode/src/session/om/` — intra-session observational memory pipeline (observer, reflector, buffer, groups) — **retained and upgraded** (`addBufferSafe()` is now the canonical write path)
- `packages/opencode/src/session/session.sql.ts` — session/message/part/todo/permission tables — **unchanged**
- `ObservationTable` and `ObservationBufferTable` — **unchanged schema** (runtime path now uses `addBufferSafe()` rather than `observeSafe()`)
- All existing Engram data in `~/.engram/engram.db` — **untouched** by this initiative

---

## Final Native Memory Boundary

After the production initiative:

- **Canonical runtime memory path**: `Memory.buildContext()` in `prompt.ts`
- **Canonical OM durability path**: `OM.addBufferSafe()` in `prompt.ts` observer closure
- **Canonical project memory plane**: `memory_working` + `memory_artifacts`
- **Core runtime Engram dependency**: **none**

Remaining Engram surface:

- No active runtime or runtime-adjacent Engram module remains in `src/`
