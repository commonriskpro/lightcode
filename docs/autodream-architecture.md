# AutoDream: Background Memory Consolidation — Complete Architecture

> **Historical Note (2026-04-05):** This document describes Claude Code's AutoDream architecture and was used as reference for LightCode's implementation. LightCode's AutoDream now uses native SQLite memory (no Engram dependency). The integration proposal in Section 14 was implemented, but in reverse: AutoDream writes to `memory_artifacts` natively, not via Engram MCP.

---

_Source: Claude Code (`/Users/saturno/Downloads/src`)_

---

## Overview

AutoDream is a **background memory consolidation agent** that fires automatically after assistant turns. It reviews past session transcripts, consolidates knowledge into topic-based memory files, and prunes stale information — all without user intervention.

---

## 1. File Inventory

| File                                          | Role                                                          |
| --------------------------------------------- | ------------------------------------------------------------- |
| `tasks/DreamTask/DreamTask.ts`                | Task state machine (UI registration, lifecycle, kill handler) |
| `services/autoDream/autoDream.ts`             | Core orchestrator: gates, scheduling, forked agent launch     |
| `services/autoDream/config.ts`                | Enabled-state resolution (user setting vs. GrowthBook)        |
| `services/autoDream/consolidationLock.ts`     | Lock file, last-consolidated timestamp, session scanning      |
| `services/autoDream/consolidationPrompt.ts`   | Full system prompt the dream agent receives                   |
| `utils/forkedAgent.ts`                        | Generic forked-agent runner (shared with extractMemories)     |
| `utils/backgroundHousekeeping.ts`             | Init site: calls `initAutoDream()` at startup                 |
| `query/stopHooks.ts`                          | Trigger site: calls `executeAutoDream()` after each turn      |
| `services/extractMemories/extractMemories.ts` | Sibling system; shares `createAutoMemCanUseTool` with dream   |
| `memdir/paths.ts`                             | Memory directory resolution (`getAutoMemPath`)                |
| `memdir/memdir.ts`                            | Memory prompt builder, MEMORY.md truncation, daily-log mode   |
| `memdir/memoryScan.ts`                        | Scans memory `.md` files, parses frontmatter                  |
| `memdir/memoryTypes.ts`                       | 4-type memory taxonomy (user/feedback/project/reference)      |
| `tasks.ts`                                    | Task registry (DreamTask is one of 6 task types)              |
| `Task.ts`                                     | Base task types, ID generation (prefix `d` for dream)         |
| `tasks/pillLabel.ts`                          | Footer pill label: returns `'dreaming'` for dream tasks       |
| `components/tasks/DreamDetailDialog.tsx`      | Shift+Down detail dialog: turns, files touched, elapsed time  |
| `skills/bundled/index.ts`                     | Manual `/dream` skill registration (KAIROS feature flag)      |

---

## 2. Trigger Mechanism

**Not a cron. Not on session start. Fires at the END of every assistant turn.**

### Trigger Chain

1. **App startup**: `startBackgroundHousekeeping()` calls `initAutoDream()`, creating a closure-scoped `runner` function
2. **Per-turn**: After every model response, `handleStopHooks()` fires `void executeAutoDream(...)` (fire-and-forget)
3. Only runs for the **main agent** (not subagents), and only when NOT in `--bare` mode

---

## 3. Gate Order (Cheapest First)

All gates must pass before dream actually runs:

| #   | Gate                 | Check                                                                | Default                                |
| --- | -------------------- | -------------------------------------------------------------------- | -------------------------------------- |
| 1   | **Feature gate**     | Not KAIROS, not remote, auto-memory enabled, autoDream enabled       | Enabled via settings or GrowthBook     |
| 2   | **Time gate**        | `mtime(.consolidate-lock) >= minHours ago`                           | **24 hours**                           |
| 3   | **Scan throttle**    | `>= 10min since last directory scan`                                 | Prevents expensive FS scans every turn |
| 4   | **Session gate**     | `>= minSessions with mtime > last consolidation` (excluding current) | **5 sessions**                         |
| 5   | **Lock acquisition** | Not held by another live process                                     | PID-based lock file                    |

Config overrides: `minHours` and `minSessions` can be changed via GrowthBook feature `tengu_onyx_plover`.

---

## 4. Lock Mechanism

**The lock file IS the timestamp.** Path: `<autoMemPath>/.consolidate-lock`

- **Lock file body**: PID of the holder process
- **Lock file mtime**: `lastConsolidatedAt` timestamp

### Acquire (`tryAcquireConsolidationLock`)

1. `stat` + `readFile` the lock
2. If mtime < 1 hour ago AND holder PID is alive: return null (blocked)
3. If dead PID or stale (>1h): reclaim
4. Write own PID, then verify re-read (CAS pattern: if PID changed, lost race)
5. Returns prior mtime (for rollback)

### Rollback

On fork failure or kill: rewind mtime to prior value using `utimes()`. If prior was 0 (no lock existed), unlink the file. This ensures the next session can retry.

---

## 5. Session Discovery

`listSessionsTouchedSince(sinceMs)` scans the project directory (`~/.claude/projects/<sanitized-cwd>/`) for session JSONL files:

- Validates UUID session IDs
- Filters by `mtime > sinceMs`
- Excludes the current running session

Sessions with transcripts modified AFTER the last consolidation mtime are "new." Once a dream completes, the lock file's mtime advances to now.

---

## 6. Model Selection

The dream agent uses **the same model as the parent session**. The fork uses identical `system prompt + tools + model + message prefix` to get **prompt cache hits** from the parent session. This is by design.

---

## 7. Tool Sandbox

Defined by `createAutoMemCanUseTool(memoryRoot)`:

| Tool            | Permission                                                              |
| --------------- | ----------------------------------------------------------------------- |
| **FileRead**    | Allowed unconditionally                                                 |
| **Grep**        | Allowed unconditionally                                                 |
| **Glob**        | Allowed unconditionally                                                 |
| **Bash**        | ONLY if `isReadOnly(input)` (ls, find, grep, cat, stat, wc, head, tail) |
| **FileEdit**    | ONLY if `file_path` is within `autoMemPath`                             |
| **FileWrite**   | ONLY if `file_path` is within `autoMemPath`                             |
| **REPL**        | Allowed (VM re-invokes canUseTool for inner primitives)                 |
| Everything else | **DENIED**                                                              |

---

## 8. Consolidation Prompt (4-Phase)

### Phase 1 — Orient

`ls` the memory directory, read `MEMORY.md`, skim existing topic files to avoid duplicates.

### Phase 2 — Gather Recent Signal (priority order)

1. Daily logs (`logs/YYYY/MM/YYYY-MM-DD.md`) if present (KAIROS append-only stream)
2. Existing memories that drifted (facts contradicted by current codebase)
3. Transcript search via grep for narrow terms

The prompt instructs grep-based access:

```
grep -rn "<narrow term>" ${transcriptDir}/ --include="*.jsonl" | tail -50
```

Explicitly says: "Don't exhaustively read transcripts. Look only for things you already suspect matter."

Session IDs to review are appended as context:

```
Sessions since last consolidation (N):
- session-uuid-1
- session-uuid-2
```

### Phase 3 — Consolidate

- Merge new signal into existing topic files (not near-duplicates)
- Convert relative dates to absolute dates
- Delete contradicted facts
- Follow memory type conventions (user/feedback/project/reference)

### Phase 4 — Prune and Index

- Update `MEMORY.md` to stay under 200 lines and ~25KB
- Remove stale pointers
- Demote verbose entries (>200 chars → move detail to topic file)
- Add pointers to newly important memories
- Resolve contradictions between files

---

## 9. Output Files

The dream agent writes ONLY within `getAutoMemPath()`:

```
~/.claude/projects/<sanitized-git-root>/memory/
```

Specifically:

- **Topic files**: `*.md` at the top level of the memory directory
- **MEMORY.md**: The index file, kept under 200 lines and ~25KB
- Does **NOT** write to CLAUDE.md (that is user-managed instructions)

---

## 10. Complete Lifecycle

1. **App startup**: `startBackgroundHousekeeping()` → `initAutoDream()` → creates closure
2. **Every assistant turn end**: `handleStopHooks()` fires `void executeAutoDream(...)` (fire-and-forget)
3. **Gate evaluation**: All 5 gates must pass (feature → time → throttle → sessions → lock)
4. **Task registration**: `registerDreamTask()` creates `DreamTaskState` with `status: 'running'`, `phase: 'starting'`, shows "dreaming" in footer pill
5. **Forked agent launch**: `runForkedAgent()` with:
   - `querySource: 'auto_dream'`
   - `forkLabel: 'auto_dream'`
   - `skipTranscript: true` (no sidechain transcript recording)
   - `canUseTool: createAutoMemCanUseTool(memoryRoot)` (sandbox)
   - `onMessage: makeDreamProgressWatcher(taskId, setAppState)` (UI updates)
6. **Progress watching**: Watches assistant messages, extracts text + tool counts + file paths. Updates phase from `'starting'` to `'updating'` when first file write is detected
7. **Completion**: `completeDreamTask()` sets status to `'completed'`. If files were touched, inline system message: `"Improved"` + list of touched memory files
8. **Failure/Kill**:
   - Kill (user via Shift+Down → `x`): `DreamTask.kill()` aborts controller, rolls back lock mtime
   - Fork failure: `failDreamTask()`, rolls back lock mtime, scan throttle acts as backoff

---

## 11. extractMemories: Sibling System

Both run from `stopHooks.ts`, both use the same tool sandbox:

|                      | extractMemories                              | autoDream                                  |
| -------------------- | -------------------------------------------- | ------------------------------------------ |
| **Trigger**          | Every turn end                               | Every turn end                             |
| **Frequency**        | Every N turns (configurable)                 | Every 24h with >= 5 sessions               |
| **Scope**            | Current session messages                     | Cross-session consolidation                |
| **Writes to**        | Same memory dir                              | Same memory dir                            |
| **Tool sandbox**     | Same `createAutoMemCanUseTool`               | Same `createAutoMemCanUseTool`             |
| **Skip transcript**  | Yes                                          | Yes                                        |
| **Prompt**           | "Extract memories from recent messages"      | "Dream: Memory Consolidation" (4-phase)    |
| **Mutual exclusion** | Skips when main agent already wrote memories | Uses lock file for cross-process exclusion |

---

## 12. Manual `/dream` vs. AutoDream

|                  | Manual `/dream`                                            | AutoDream                                                  |
| ---------------- | ---------------------------------------------------------- | ---------------------------------------------------------- |
| **Trigger**      | User invokes `/dream` command                              | Automatic after turn end                                   |
| **Feature flag** | `KAIROS` or `KAIROS_DREAM`                                 | `tengu_onyx_plover.enabled` or `settings.autoDreamEnabled` |
| **Sandbox**      | Runs in MAIN loop, full tool permissions                   | Forked agent, sandboxed tools                              |
| **Lock stamp**   | Calls `recordConsolidation()` to prevent autoDream overlap | Uses lock file with PID                                    |
| **Prompt**       | Same `buildConsolidationPrompt()`                          | Same `buildConsolidationPrompt()`                          |

---

## 13. Key Design Decisions

| Decision                                | Rationale                                                                                          |
| --------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Lock file mtime IS the timestamp**    | Single-file solution — no separate state file needed                                               |
| **PID in lock body + isProcessRunning** | Handles crash recovery (dead PID = reclaimable)                                                    |
| **1-hour stale threshold**              | Guards against PID reuse (OS can reassign PIDs)                                                    |
| **Scan throttle (10min)**               | Prevents expensive directory scans every turn when time gate passes but session count insufficient |
| **Prompt cache sharing**                | Fork uses identical prefix to share parent's prompt cache                                          |
| **Fire-and-forget**                     | `void executeAutoDream(...)` — non-blocking, best-effort                                           |
| **No CLAUDE.md writes**                 | Memory files only. CLAUDE.md is user-managed instructions                                          |
| **Grep-based transcript access**        | JSONL files are huge — targeted grep is far cheaper than reading whole files                       |

---

## 14. LightCode's Native Implementation

LightCode's AutoDream was implemented with a native approach instead of Engram integration:

### What Was Implemented

1. **Native SQLite backend**: AutoDream writes directly to `memory_artifacts` in `lightcode.db` via `Memory.indexArtifact()`
2. **ObservationTable**: Sessions store observations locally in SQLite (session-scoped)
3. **AutoDream daemon**: Background process with internal scheduler (~1h interval)
4. **Native gate system**: Feature flag, time threshold, session count, Flock lock
5. **No external dependencies**: No Engram binary, no MCP setup required

### Memory Flow

```
Session idle → AutoDream idle() → Dream agent reads ObservationTable + summaries
→ Consolidates knowledge → Memory.indexArtifact() (async, via HybridBackend) → memory_artifacts + memory_artifacts_vec (SQLite)
→ HybridBackend.search() (FTS5 + embeddings via RRF) picks up artifacts in next session
```

### Differences from Claude Code's Engram Approach

| Aspect                | Claude Code + Engram       | LightCode (native)                        |
| --------------------- | -------------------------- | ----------------------------------------- |
| Storage               | `.md` files or Engram MCP  | `lightcode.db` (SQLite + sqlite-vec)      |
| Search                | `mem_search` (Engram FTS5) | FTS5 + embeddings via RRF (HybridBackend) |
| Deduplication         | `topic_key` upserts        | `topic_key` upserts + hash dedupe in FTS5 |
| Dependencies          | Engram binary required     | None (self-contained)                     |
| Consolidation trigger | 24h + 5 sessions (gates)   | ~1h internal scheduler + idle event       |

### Source Files

- `src/dream/index.ts` — AutoDream namespace, gate system, daemon management
- `src/dream/ensure.ts` — Native daemon process management
- `src/dream/daemon.ts` — Daemon HTTP server for dream execution
- `src/dream/prompt.txt` — Consolidation prompt
- `src/memory/provider.ts` — `Memory.buildContext()` for recall
- `src/memory/index.ts` — `Memory.indexArtifact()` for persistence
