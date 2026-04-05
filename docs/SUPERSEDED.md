# LightCode — Superseded Components

This document tracks all components that have been superseded, deprecated, or replaced as part of the LightCode Memory Core V1 initiative (`docs/LIGHTCODE_MEMORY_CORE_V1_SPEC.md`).

Deprecated files are **retained** in the codebase for rollback capability. They are NOT deleted unless the initiative is declared fully stable and the rollback period has ended.

---

## Superseded by Memory Core V1

### 1. `packages/opencode/src/dream/engram.ts`

**Status**: DEPRECATED  
**Superseded by**: `packages/opencode/src/memory/` (native MemoryProvider)  
**Reason**: Manages the external Engram Go binary and registers it as an MCP client. LightCode Memory Core V1 replaces the need for an external binary. All cross-session memory is now stored natively in `lightcode.db`.  
**Rollback**: Set `OPENCODE_MEMORY_USE_ENGRAM=true` to re-enable the Engram MCP path.  
**Removal trigger**: Memory Core V1 declared fully stable (Phase B milestone).

---

### 2. `packages/opencode/src/dream/ensure.ts`

**Status**: DEPRECATED (when used for Engram daemon health check)  
**Superseded by**: No replacement needed — the daemon is no longer required.  
**Reason**: Ensured the Engram daemon was running before AutoDream could fire. With native memory, there is no daemon to manage.  
**Rollback**: Still used by the Engram fallback path (`OPENCODE_MEMORY_USE_ENGRAM=true`).

---

### 3. `session/system.ts` — `recall()` (legacy Engram MCP implementation)

**Status**: REPLACED  
**Superseded by**: `Memory.searchArtifacts()` in `packages/opencode/src/memory/provider.ts`  
**Reason**: Called `MCP.tools()` to find `mem_context` and `mem_search` Engram tools. Required Engram daemon to be running. Silent failure on any MCP/network error. Replaced by native FTS5 search against `memory_artifacts` in `lightcode.db`.  
**Feature flag**: `OPENCODE_MEMORY_USE_ENGRAM=true` restores old behavior.  
**Rollback safety**: The old implementation is preserved in `system.ts:recallEngram()`.

---

### 4. AutoDream + Engram MCP consolidation path

**Status**: REPLACED (default behavior)  
**Superseded by**: `AutoDream.persistConsolidation()` in `packages/opencode/src/dream/index.ts` → writes to `memory_artifacts` via `Memory.indexArtifact()`  
**Reason**: AutoDream called Engram MCP `mem_save` / `mem_update` to persist cross-session consolidations. Required Engram daemon. Now writes directly to `lightcode.db`.  
**Feature flag**: `OPENCODE_DREAM_USE_NATIVE_MEMORY=false` restores old AutoDream Engram path.

---

## Superseded Storage Patterns

### Cross-session recall via MCP

| Old                                       | New                                       |
| ----------------------------------------- | ----------------------------------------- |
| `callEngramTool(all, "mem_context", ...)` | `Memory.searchArtifacts(pid, scopes, 20)` |
| `callEngramTool(all, "mem_search", ...)`  | `Memory.searchArtifacts(pid, scopes, 10)` |
| Returns arbitrary MCP tool result text    | Returns typed `MemoryArtifact[]`          |
| Requires running Engram daemon            | No external process needed                |

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

## Rollback Flags

| Flag                               | Default | Effect when set to rollback value                           |
| ---------------------------------- | ------- | ----------------------------------------------------------- |
| `OPENCODE_MEMORY_USE_ENGRAM`       | `false` | Set to `true` → use Engram MCP for cross-session recall     |
| `OPENCODE_DREAM_USE_NATIVE_MEMORY` | `true`  | Set to `false` → use Engram MCP for AutoDream consolidation |

---

## What Was NOT Removed

The following are explicitly preserved and unchanged:

- `packages/opencode/src/session/om/` — intra-session observational memory pipeline (observer, reflector, buffer, groups) — **unchanged**
- `packages/opencode/src/session/session.sql.ts` — session/message/part/todo/permission tables — **unchanged**
- `ObservationTable` and `ObservationBufferTable` — **unchanged** (only extended with `observeSafe()` guard)
- All existing Engram data in `~/.engram/engram.db` — **untouched** by this initiative
